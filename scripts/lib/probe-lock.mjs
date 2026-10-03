/**
 * One browser suite on this machine at a time (#84).
 *
 * Two suites on one machine starve each other, and each then reports reds that
 * read like defects: #84 traced a 2746 s run that lost four probes to a second
 * agent's `npm run probe` from a sibling worktree, at a load average of 30–112.
 * `probe-guard` could not see it — both servers served their own tree, which is
 * correct by its test — and neither could `probe-all`, which serialises only
 * its own probes.
 *
 * So `probe-all` and `capture-views` take this lock, and a second run **waits**
 * rather than refusing: the runs this protects are mostly unattended agents,
 * and a refusal hands an agent an exit 1 that reads as a red. A single probe run
 * directly (`node scripts/probe-x.mjs`) does not take it. That is how a red is
 * re-run "alone", and `probe-all`'s own children would otherwise wait on their
 * parent.
 *
 * ## Where it lives
 *
 * At one fixed path, `/tmp/seelite-probe.lock`, because the contention is
 * the machine's and not a checkout's. #84's incidents were sibling worktrees,
 * but this machine also runs seelite work from a separate clone (an agent's
 * `ranger-repos` checkout), which a lock in one clone's git dir would not see.
 * And not `os.tmpdir()`: a session can set its own `TMPDIR`, and two sessions
 * with two temp dirs would each hold a lock the other cannot see.
 * `PROBE_LOCK_PATH` overrides the path, for tests.
 *
 * ## How it is taken
 *
 * The record is written to a private file and **hard-linked** into place:
 * `link` fails if the name exists and publishes a complete file when it
 * succeeds, so there is no window where a reader sees half a record.
 *
 * A holder that is not alive is taken over at once — a suite killed by
 * `SIGKILL` cannot release anything. The takeover renames the stale record
 * aside and checks that what it moved is the record it judged stale. If another
 * waiter took the lock in between, the rename moved *that* lock, and it is
 * linked back. Liveness is `kill(pid, 0)`, so a dead holder whose pid has been
 * reused looks alive. The wait limit bounds that case, and the `NOT RUN` line
 * names the pid so a person can see it.
 *
 * ## How long it waits
 *
 * `PROBE_LOCK_WAIT_MS`, default an hour: about 3.5× a clean suite and less than
 * the 5598 s a suite took beside a sage review. A wait that runs out exits
 * `LOCK_EXIT_CODE` and says `NOT RUN`, never a red — a run that did not happen
 * is not evidence about the code. While waiting it names the holder once a
 * minute, so a log being watched does not read as a hang.
 */
import {
	linkSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { constants } from "node:os";

/** `EX_TEMPFAIL`: the run did not happen and can be tried again. */
export const LOCK_EXIT_CODE = 75;

const HOUR_MS = 3_600_000;

/**
 * @typedef {{ pid: number, label: string, tree: string, startedAt: string }} Holder
 */

/** The one lock on this machine; see "Where it lives" above. */
export const MACHINE_LOCK_PATH = "/tmp/seelite-probe.lock";

/**
 * The lock file: `PROBE_LOCK_PATH` if set, else the machine's.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function defaultLockPath(env = process.env) {
	return env.PROBE_LOCK_PATH || MACHINE_LOCK_PATH;
}

/**
 * The record at `path`, `null` if there is no lock, or `"corrupt"` if there is
 * one that is not a holder record.
 *
 * @param {string} path
 * @returns {Holder | null | "corrupt"}
 */
function readRecord(path) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (e) {
		if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") return null;
		throw e;
	}
	try {
		const h = JSON.parse(text);
		return Number.isInteger(h?.pid) ? h : "corrupt";
	} catch {
		return "corrupt";
	}
}

/**
 * Who holds the lock at `path`, or `null` if nobody readable does.
 *
 * @param {string} path
 * @returns {Holder | null}
 */
export function readHolder(path) {
	const r = readRecord(path);
	return r === "corrupt" ? null : r;
}

/** @param {number} pid */
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM: it exists and belongs to someone else
		return /** @type {NodeJS.ErrnoException} */ (e).code === "EPERM";
	}
}

/** @param {string} path */
function unlinkQuiet(path) {
	try {
		unlinkSync(path);
	} catch {}
}

/**
 * Publish `record` at `path` if nobody holds it. True if this call took it.
 *
 * @param {string} path
 * @param {Holder} record
 */
function tryLink(path, record) {
	const mine = `${path}.${process.pid}.tmp`;
	writeFileSync(mine, JSON.stringify(record));
	try {
		linkSync(mine, path);
		return true;
	} catch (e) {
		if (/** @type {NodeJS.ErrnoException} */ (e).code === "EEXIST")
			return false;
		throw e;
	} finally {
		unlinkQuiet(mine);
	}
}

/**
 * Move a stale record aside, and put back anything moved by mistake.
 *
 * @param {string} path
 * @param {Holder | "corrupt"} stale what was judged stale
 * @param {(line: string) => void} log
 */
function clearStale(path, stale, log) {
	const aside = `${path}.stale.${process.pid}.${Date.now()}`;
	try {
		renameSync(path, aside);
	} catch (e) {
		// someone else cleared it first
		if (/** @type {NodeJS.ErrnoException} */ (e).code === "ENOENT") return;
		throw e;
	}
	const moved = readRecord(aside);
	const same =
		stale === "corrupt"
			? moved === "corrupt"
			: moved !== null && moved !== "corrupt" && moved.pid === stale.pid;
	if (!same) {
		// another waiter cleared the stale record and took the lock in the
		// gap; the rename moved their lock, so it goes back
		try {
			linkSync(aside, path);
		} catch {
			log(
				"probe lock: a lock taken during a stale takeover could not be restored; two runs may overlap",
			);
		}
	} else if (stale !== "corrupt") {
		log(
			`probe lock: taking over from pid ${stale.pid} (${stale.label}), which is no longer running`,
		);
	}
	unlinkQuiet(aside);
}

/**
 * Take the probe lock, waiting up to `waitMs` for a live holder.
 *
 * @param {{
 *   path: string,
 *   label: string,
 *   waitMs: number,
 *   pollMs?: number,
 *   statusEveryMs?: number,
 *   log?: (line: string) => void,
 *   isAlive?: (pid: number) => boolean,
 * }} options
 * @returns {Promise<
 *   | { ok: true, waitedMs: number, release: () => void }
 *   | { ok: false, waitedMs: number, holder: Holder }
 * >}
 */
export async function acquireProbeLock({
	path,
	label,
	waitMs,
	pollMs = 1_000,
	statusEveryMs = 60_000,
	log = console.log,
	isAlive = pidAlive,
}) {
	const started = Date.now();
	/** @type {Holder} */
	const record = {
		pid: process.pid,
		label,
		tree: process.cwd(),
		startedAt: new Date(started).toISOString(),
	};
	let lastStatus = -Infinity;
	/** @type {Holder | null} */
	let lastHolder = null;
	for (;;) {
		if (tryLink(path, record)) {
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				// only ever this process's own record: a lock taken over from
				// us, or replaced by hand, is somebody else's now
				if (readHolder(path)?.pid === process.pid) unlinkQuiet(path);
			};
			return { ok: true, waitedMs: Date.now() - started, release };
		}
		const current = readRecord(path);
		if (current === null) continue;
		if (current === "corrupt" || !isAlive(current.pid)) {
			clearStale(path, current, log);
			continue;
		}
		lastHolder = current;
		const waited = Date.now() - started;
		if (waited >= waitMs)
			return { ok: false, waitedMs: waited, holder: lastHolder };
		if (waited - lastStatus >= statusEveryMs) {
			lastStatus = waited;
			log(
				`probe lock: waiting ${Math.round(waited / 1000)}s for ${describe(current)}`,
			);
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}

/** @param {Holder} h */
function describe(h) {
	return `pid ${h.pid} (${h.label}) in ${h.tree} since ${h.startedAt}`;
}

/**
 * The line a run that never got the lock prints instead of a verdict.
 *
 * @param {Holder} holder
 * @param {number} waitedMs
 * @param {string} path
 */
export function notRunMessage(holder, waitedMs, path) {
	return (
		`NOT RUN: the probe lock is held by ${describe(holder)}; ` +
		`waited ${Math.round(waitedMs / 1000)}s (PROBE_LOCK_WAIT_MS). ` +
		`This is not a red. Lock: ${path}`
	);
}

/**
 * Take the lock for the rest of this process, or exit `LOCK_EXIT_CODE`.
 *
 * Released on any exit, and on SIGINT, SIGTERM and SIGHUP, which then exit
 * with the shell's `128 + signal` code. A run stopped by SIGKILL leaves its
 * record behind, and the next run takes it over because its pid is gone.
 *
 * @param {string} label what holds it, as a waiting run will print it
 */
export async function holdProbeLockOrExit(label) {
	const path = defaultLockPath();
	const waitMs = Number(process.env.PROBE_LOCK_WAIT_MS ?? HOUR_MS);
	const r = await acquireProbeLock({ path, label, waitMs });
	if (!r.ok) {
		console.log(notRunMessage(r.holder, r.waitedMs, path));
		process.exit(LOCK_EXIT_CODE);
	}
	if (r.waitedMs > 1_000)
		console.log(`probe lock: taken after ${Math.round(r.waitedMs / 1000)}s`);
	process.on("exit", r.release);
	for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM", "SIGHUP"]))
		process.once(sig, () => {
			r.release();
			process.exit(128 + constants.signals[sig]);
		});
	return r.release;
}
