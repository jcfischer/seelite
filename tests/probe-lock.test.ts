/**
 * The machine-wide lock a browser suite holds while it runs (#84).
 *
 * Two suites on one machine starve each other, and what each one then reports
 * is a red that reads like a defect. The lock makes the second run wait, and a
 * wait that runs out exits with its own code and says `NOT RUN` — never a red.
 *
 * The holders here are real processes, because what the lock answers is a
 * question about processes: whether one is alive, and what is left behind when
 * one is killed.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	acquireProbeLock,
	defaultLockPath,
	LOCK_EXIT_CODE,
	lockWaitMs,
	MACHINE_LOCK_PATH,
	notRunMessage,
	readHolder,
} from "../scripts/lib/probe-lock.mjs";

const LIB = resolve(import.meta.dir, "../scripts/lib/probe-lock.mjs");

let dir = "";
let path = "";
const children: ReturnType<typeof spawn>[] = [];

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "probe-lock-"));
	path = join(dir, "probe.lock");
});

afterEach(() => {
	for (const c of children.splice(0)) c.kill("SIGKILL");
	rmSync(dir, { recursive: true, force: true });
});

/** A pid that existed and does not any more. */
function deadPid() {
	const r = spawnSync(process.execPath, ["-e", ""]);
	return r.pid as number;
}

/**
 * A separate process that takes the lock through the same entry point the
 * scripts use, prints `held`, and keeps it for `holdMs` before exiting.
 */
function holder(holdMs: number, env: Record<string, string> = {}) {
	const code = `
		import { holdProbeLockOrExit } from ${JSON.stringify(LIB)};
		await holdProbeLockOrExit("holder-under-test");
		console.log("held");
		setTimeout(() => process.exit(0), ${holdMs});
	`;
	const child = spawn("node", ["--input-type=module", "-e", code], {
		env: { ...process.env, PROBE_LOCK_PATH: path, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	children.push(child);
	let out = "";
	child.stdout?.on("data", (d) => (out += d));
	child.stderr?.on("data", (d) => (out += d));
	const held = new Promise<void>((done, fail) => {
		child.stdout?.on("data", () => /^held$/m.test(out) && done());
		child.on("exit", () => fail(new Error(`holder exited first: ${out}`)));
	});
	// a holder that is refused never prints `held`; only a test that awaits
	// `held` should hear about that
	held.catch(() => {});
	const exited = new Promise<{ code: number | null; signal: string | null }>(
		(done) => child.on("exit", (code, signal) => done({ code, signal })),
	);
	return { child, pid: child.pid as number, held, exited, out: () => out };
}

describe("taking the lock", () => {
	test("a free lock is taken at once and names this process", async () => {
		const r = await acquireProbeLock({ path, label: "first", waitMs: 0 });
		expect(r.ok).toBe(true);
		const h = readHolder(path);
		expect(h?.pid).toBe(process.pid);
		expect(h?.label).toBe("first");
		expect(h?.tree).toBe(process.cwd());
		if (r.ok) r.release();
		expect(existsSync(path)).toBe(false);
	});

	test("a lock whose holder is dead is taken over without waiting", async () => {
		const stale = { pid: deadPid(), label: "gone", tree: "/x", startedAt: "" };
		writeFileSync(path, JSON.stringify(stale));
		const r = await acquireProbeLock({ path, label: "next", waitMs: 0 });
		expect(r.ok).toBe(true);
		expect(readHolder(path)?.pid).toBe(process.pid);
		if (r.ok) r.release();
	});

	test("a lock that is not a holder record is treated as stale", async () => {
		writeFileSync(path, "not json");
		const r = await acquireProbeLock({ path, label: "next", waitMs: 0 });
		expect(r.ok).toBe(true);
		if (r.ok) r.release();
	});

	test("release leaves a lock that another process now holds", async () => {
		const r = await acquireProbeLock({ path, label: "mine", waitMs: 0 });
		const other = { pid: 1, label: "theirs", tree: "/y", startedAt: "" };
		writeFileSync(path, JSON.stringify(other));
		if (r.ok) r.release();
		expect(readHolder(path)?.label).toBe("theirs");
	});
});

describe("waiting for a live holder", () => {
	test("a second run waits, then takes the lock when the holder exits", async () => {
		const h = holder(800);
		await h.held;
		const r = await acquireProbeLock({
			path,
			label: "second",
			waitMs: 10_000,
			pollMs: 50,
		});
		expect(r.ok).toBe(true);
		expect(r.waitedMs).toBeGreaterThan(400);
		expect(readHolder(path)?.pid).toBe(process.pid);
		if (r.ok) r.release();
	});

	test("while it waits it names the holder on a cadence", async () => {
		const h = holder(5_000);
		await h.held;
		const lines: string[] = [];
		const r = await acquireProbeLock({
			path,
			label: "second",
			waitMs: 700,
			pollMs: 50,
			statusEveryMs: 200,
			log: (l: string) => lines.push(l),
		});
		expect(r.ok).toBe(false);
		const naming = lines.filter((l) => l.includes(String(h.pid)));
		expect(naming.length).toBeGreaterThanOrEqual(2);
		expect(naming[0]).toContain("holder-under-test");
	});

	test("a wait that runs out reports the holder and does not take the lock", async () => {
		const h = holder(5_000);
		await h.held;
		const r = await acquireProbeLock({
			path,
			label: "second",
			waitMs: 300,
			pollMs: 50,
			log: () => {},
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(r.holder.pid).toBe(h.pid);
		expect(readHolder(path)?.pid).toBe(h.pid);
		const msg = notRunMessage(r.holder, r.waitedMs, path);
		expect(msg).toStartWith("NOT RUN");
		expect(msg).toContain(String(h.pid));
		expect(msg).toContain("holder-under-test");
		expect(msg).toContain("PROBE_LOCK_WAIT_MS");
	});
});

describe("the entry point the scripts call", () => {
	test("a run that cannot get the lock exits 75 and says NOT RUN", async () => {
		const first = holder(5_000);
		await first.held;
		const second = holder(0, { PROBE_LOCK_WAIT_MS: "300" });
		const { code } = await second.exited;
		expect(LOCK_EXIT_CODE).toBe(75);
		expect(code).toBe(75);
		expect(second.out()).toContain("NOT RUN");
		expect(second.out()).not.toMatch(/^held$/m);
	});

	test("a holder stopped by SIGTERM leaves no lock behind", async () => {
		const h = holder(60_000);
		await h.held;
		expect(readHolder(path)?.pid).toBe(h.pid);
		h.child.kill("SIGTERM");
		const { code } = await h.exited;
		expect(code).toBe(143);
		expect(existsSync(path)).toBe(false);
	});

	test("a holder stopped by SIGKILL is taken over by the next run", async () => {
		const h = holder(60_000);
		await h.held;
		h.child.kill("SIGKILL");
		await h.exited;
		expect(existsSync(path)).toBe(true);
		const r = await acquireProbeLock({ path, label: "next", waitMs: 0 });
		expect(r.ok).toBe(true);
		if (r.ok) r.release();
	});
});

describe("where the lock lives", () => {
	test("at one fixed path, whatever the checkout or the session's TMPDIR", () => {
		expect(MACHINE_LOCK_PATH).toBe("/tmp/seelite-probe.lock");
		expect(defaultLockPath({ TMPDIR: "/somewhere/else" })).toBe(
			MACHINE_LOCK_PATH,
		);
	});

	test("PROBE_LOCK_PATH overrides it", () => {
		expect(defaultLockPath({ PROBE_LOCK_PATH: "/tmp/elsewhere" })).toBe(
			"/tmp/elsewhere",
		);
	});

	test("a holder record is readable as written", () => {
		writeFileSync(
			path,
			JSON.stringify({ pid: 7, label: "l", tree: "/t", startedAt: "s" }),
		);
		expect(readHolder(path)).toEqual({
			pid: 7,
			label: "l",
			tree: "/t",
			startedAt: "s",
		});
		expect(readFileSync(path, "utf8")).toContain('"pid":7');
	});
});

describe("how long a run waits", () => {
	const HOUR = 3_600_000;
	const quiet = () => {};

	test("unset is an hour", () => {
		expect(lockWaitMs({}, quiet)).toBe(HOUR);
	});

	test("a whole number of milliseconds is taken as given, zero included", () => {
		expect(lockWaitMs({ PROBE_LOCK_WAIT_MS: "300" }, quiet)).toBe(300);
		expect(lockWaitMs({ PROBE_LOCK_WAIT_MS: "0" }, quiet)).toBe(0);
	});

	test("anything else is the hour, said out loud, never NaN or an instant refusal", () => {
		for (const raw of ["1h", "", "-5", "1e3", "abc"]) {
			const lines: string[] = [];
			expect(
				lockWaitMs({ PROBE_LOCK_WAIT_MS: raw }, (l) => lines.push(l)),
			).toBe(HOUR);
			expect(lines.join()).toContain("PROBE_LOCK_WAIT_MS");
		}
	});
});
