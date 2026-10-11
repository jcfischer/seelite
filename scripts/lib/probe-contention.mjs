/**
 * Saying when a probe run did not have the machine (#84, #882).
 *
 * The lock makes two **suites** take turns. It cannot see a probe run directly —
 * deliberately, since a direct run is how a red gets re-run alone — and it cannot
 * see a `sage review`, a test run, or another agent's dev server. What a run
 * under that load reports is inflated seconds, and until #882 only a **red**
 * carried a load figure. A pasted suite of 63 probes at 1992 s therefore read as
 * a slow suite — `probe-music` 410 s, `probe-opening` 422 s — when the box was
 * holding a load average of 23–47 on eight physical cores while a second
 * worktree ran probes straight off it.
 *
 * This module turns the two invisible things into printed ones:
 *
 * - a **direct run names whoever holds the lock** (`contentionNotice`), so its
 *   output says it was not alone;
 * - a **slow probe prints the load it ran under** (`slowRunNote`), green
 *   included;
 * - the **summary names the slowest probes and what share of the run they
 *   were** (`slowestLine`), so 100 lines of seconds point at somewhere to look.
 *
 * **None of it gates.** #84 measured no load threshold worth refusing on, and a
 * run that shared the machine is still evidence about *behaviour* — a red under
 * load is unattributed, not worthless. What it is not is evidence about how long
 * something takes, and the notice says so rather than leaving that to be guessed
 * from a load average nobody printed.
 */
import {
	defaultLockPath,
	describeHolder,
	pidAlive,
	readHolder,
} from "./probe-lock.mjs";

/**
 * The variable `probe-all` sets in each child, naming the pid that took the
 * lock. A child is *inside* the run that holds it, so it must not warn — and it
 * cannot tell that from its own pid, which is a different one every time.
 */
export const SUITE_PID_ENV = "PROBE_LOCK_PID";

/** A probe at or over this gets a load figure on its line, red or green. */
export const SLOW_PROBE_MS = 60_000;

/**
 * Whether this run shares the machine with the lock's holder.
 *
 * False in the two cases where the holder **is** this run: the process itself
 * took the lock (`capture-views` does), or its parent suite did. Reading the
 * parent's pid from the environment rather than walking the process table is
 * what makes that answer cheap, and stale inherited value is harmless: a pid
 * that matches nothing is simply not the holder's.
 *
 * @param {{ holder: import("./probe-lock.mjs").Holder | null, selfPid: number, suitePid?: number | null }} a
 */
export function sharesMachine({ holder, selfPid, suitePid = null }) {
	if (!holder) return false;
	return holder.pid !== selfPid && holder.pid !== suitePid;
}

/**
 * The line a direct run prints when the lock is held by someone else, or `""`.
 *
 * It goes to stderr beside the guard's own lines: stderr is where the probes
 * already put anything that is not the verdict, and a suite collecting a probe's
 * stdout for its own summary should not gain a line nobody asked for.
 *
 * @param {{ holder: import("./probe-lock.mjs").Holder | null, selfPid: number, suitePid?: number | null }} a
 */
export function contentionNotice({ holder, selfPid, suitePid = null }) {
	if (!sharesMachine({ holder, selfPid, suitePid })) return "";
	return (
		`[probe] sharing the machine with ${describeHolder(holder)} — ` +
		"its probes and this one contend for the same renderer and CPU, so times here are " +
		"inflated and a red is unattributed until it is re-run with the lock free (#84). " +
		"Nothing in this run is evidence about how long anything takes."
	);
}

/**
 * Whether this process is a suite's child rather than a run someone typed.
 *
 * Cheap on purpose — one environment read, no process table — because both
 * notices this file owns have to decide the same thing: a suite chose its lane
 * and holds the lock, so telling it about either is 100 lines of noise about a
 * condition it declared. `PROBE_LOCK_PID` names 0 for anything unset, and 0 is
 * no pid at all.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function isSuiteChild(env = process.env) {
	const named = Number(env[SUITE_PID_ENV] ?? "");
	return Number.isInteger(named) && named > 0;
}

/**
 * The notice for a run happening **now**, read off the lock file.
 *
 * A holder whose pid is gone is not a contender: the lock's own takeover rule
 * treats that record as stale, and warning about it would tell a lone run it was
 * sharing the machine with a process that no longer exists. `isAlive` is a
 * parameter for the same reason `probe-lock`'s is — a test that wants a dead
 * holder should not have to kill one.
 *
 * @param {{ env?: Record<string, string | undefined>, path?: string, isAlive?: (pid: number) => boolean, selfPid?: number }} [options]
 */
export function directRunNotice({
	env = process.env,
	path = defaultLockPath(env),
	isAlive = pidAlive,
	selfPid = process.pid,
} = {}) {
	const holder = readHolder(path);
	if (!holder || !isAlive(holder.pid)) return "";
	return contentionNotice({
		holder,
		selfPid,
		suitePid: isSuiteChild(env) ? Number(env[SUITE_PID_ENV]) : null,
	});
}

/**
 * The load suffix on a probe's own line, or `""` when there is nothing to say.
 *
 * Quiet below `slowMs` on purpose: every red already prints its peak load, and a
 * green line at 6 s under a load of 40 makes the point once the reader has seen
 * the slow ones. Absent on a run where no load could be read — a figure that is
 * not there is not a figure to print.
 *
 * @param {{ ms: number, peak: number | null, slowMs?: number }} r
 */
export function slowRunNote({ ms, peak, slowMs = SLOW_PROBE_MS }) {
	if (ms < slowMs) return "";
	return ` · peak load ${formatLoad(peak)}`;
}

/**
 * A load average as printed, or `?` where none could be read.
 *
 * One spelling for both the runner's own summary line and each probe's suffix,
 * because two rules for the same figure drift: the red branch printed `?` for no
 * reading and the green one printed nothing, so a green line without a load said
 * either "fast probe" or "no reading" (#882, sage round 1). A probe that ran long
 * and had no reading says so, which is the answer a reader needs.
 *
 * @param {number | null} l
 */
export const formatLoad = (l) =>
	typeof l === "number" && Number.isFinite(l) ? l.toFixed(1) : "?";

/**
 * One summary line naming the slowest probes and their share of the run.
 *
 * The seconds a suite prints are 100 lines in file order, which is alphabetical
 * and tells nobody where the wall clock went. This says which few probes held it
 * and how much of the run they account for — the figure that decides whether a
 * suite is slow because of two probes or because of the machine.
 *
 * `total` is the sum of the probes' own seconds, not the run's wall clock: with
 * `PROBE_CONCURRENCY` above one those two differ, and the share that means
 * something here is of the work, not of the window.
 *
 * @param {{ file: string, ms: number }[]} results
 * @param {{ limit?: number }} [options]
 */
export function slowestLine(results, { limit = 5 } = {}) {
	if (!results.length) return "";
	const sorted = [...results].sort((a, b) => b.ms - a.ms);
	const top = sorted.slice(0, limit);
	const total = results.reduce((s, r) => s + r.ms, 0);
	const shown = top.reduce((s, r) => s + r.ms, 0);
	const left = sorted.length - top.length;
	return (
		`slowest ${top.length} of ${sorted.length}: ` +
		top.map((r) => `${r.file} ${(r.ms / 1000).toFixed(1)}s`).join(" · ") +
		` — ${(shown / 1000).toFixed(1)}s of ${(total / 1000).toFixed(1)}s` +
		(left > 0 ? ` (${left} more under)` : "")
	);
}
