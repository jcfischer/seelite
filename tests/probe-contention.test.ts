/**
 * Saying when a probe run did not have the machine (#84).
 *
 * The lock makes two *suites* take turns. It says nothing about a probe run
 * directly — deliberately, since that is how a red gets re-run alone — and
 * nothing about a `sage review` or a test run alongside either. What a run
 * under that load reports is inflated times, and since only reds carried a load
 * figure, a slow green line looked like the probe's own fault: a pasted suite of
 * 63 probes at 1992 s read as a slow suite when the box was at load 23–47 on
 * eight physical cores with another agent's probes running in it.
 *
 * So the two things that were invisible become visible: a direct run names who
 * holds the lock, and a slow probe says the load it ran under. Neither gates.
 * #84 measured no threshold worth refusing on, and a run that shares the machine
 * is still evidence — just not evidence about how long something takes.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	contentionNotice,
	directRunNotice,
	sharesMachine,
	SLOW_PROBE_MS,
	SUITE_PID_ENV,
	slowestLine,
	slowRunNote,
} from "../scripts/lib/probe-contention.mjs";

const HOLDER = {
	pid: 54115,
	label: "probe-all, 100 probes",
	tree: "/Users/x/work/seelite/.worktrees/seelite-876",
	startedAt: "2026-10-10T21:34:56.122Z",
};

describe("sharesMachine", () => {
	test("nobody holds the lock, so the run is alone", () => {
		expect(sharesMachine({ holder: null, selfPid: 7, suitePid: null })).toBe(
			false,
		);
	});

	test("this process holds it: capture-views took the lock itself", () => {
		expect(
			sharesMachine({ holder: HOLDER, selfPid: 54115, suitePid: null }),
		).toBe(false);
	});

	test("the suite this probe is a child of holds it", () => {
		expect(
			sharesMachine({
				holder: HOLDER,
				selfPid: 1857,
				suitePid: 54115,
			}),
		).toBe(false);
	});

	test("someone else's suite holds it", () => {
		expect(
			sharesMachine({
				holder: HOLDER,
				selfPid: 1857,
				suitePid: null,
			}),
		).toBe(true);
	});

	test("the runner names the variable it reads, so a stale value is traceable", () => {
		expect(SUITE_PID_ENV).toBe("PROBE_LOCK_PID");
	});
});

describe("contentionNotice", () => {
	test("nothing is printed when the run is alone", () => {
		expect(contentionNotice({ holder: null, selfPid: 7 })).toBe("");
	});

	test("it names the holder the way a waiting suite would", () => {
		const line = contentionNotice({ holder: HOLDER, selfPid: 1857 });
		expect(line).toContain("pid 54115");
		expect(line).toContain("probe-all, 100 probes");
		expect(line).toContain(HOLDER.tree);
		expect(line).toContain(HOLDER.startedAt);
	});

	test("it says what the run is not evidence about", () => {
		const line = contentionNotice({ holder: HOLDER, selfPid: 1857 });
		expect(line).toContain("times here are inflated");
		expect(line).toContain("unattributed");
		expect(line).toContain("#84");
	});

	test("a suite's own children hear nothing", () => {
		expect(
			contentionNotice({
				holder: HOLDER,
				selfPid: 1857,
				suitePid: HOLDER.pid,
			}),
		).toBe("");
	});
});

describe("directRunNotice", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	});

	/** A lock file holding `record`, in a directory this test cleans up. */
	const lock = (record: string | null) => {
		const dir = mkdtempSync(join(tmpdir(), "probe-contention-"));
		dirs.push(dir);
		const path = join(dir, "probe.lock");
		if (record !== null) writeFileSync(path, record);
		return path;
	};

	test("no lock file, no notice", () => {
		expect(directRunNotice({ path: lock(null), env: {} })).toBe("");
	});

	test("a holder that is not running is stale, not a contender", () => {
		expect(
			directRunNotice({
				path: lock(JSON.stringify(HOLDER)),
				env: {},
				isAlive: () => false,
			}),
		).toBe("");
	});

	test("a live holder someone else owns is named", () => {
		const line = directRunNotice({
			path: lock(JSON.stringify(HOLDER)),
			env: {},
			isAlive: () => true,
			selfPid: 1857,
		});
		expect(line).toContain("pid 54115");
	});

	test("the runner's own child hears nothing, and the variable is what says so", () => {
		const path = lock(JSON.stringify(HOLDER));
		const live = { isAlive: () => true, selfPid: 1857 };
		expect(
			directRunNotice({ path, env: { [SUITE_PID_ENV]: "54115" }, ...live }),
		).toBe("");
		// The same child without the variable is indistinguishable from a
		// direct run, so it is warned: the notice errs toward saying more.
		expect(directRunNotice({ path, env: {}, ...live })).toContain("pid 54115");
	});

	test("a lock file that is not a record warns nobody", () => {
		expect(
			directRunNotice({ path: lock("not json"), env: {}, isAlive: () => true }),
		).toBe("");
	});
});

describe("slowRunNote", () => {
	test("a probe under the threshold says nothing", () => {
		expect(slowRunNote({ ms: SLOW_PROBE_MS - 1, peak: 40 })).toBe("");
	});

	test("a slow probe prints the peak load it ran under", () => {
		expect(slowRunNote({ ms: 410_800, peak: 34.62 })).toContain(
			"peak load 34.6",
		);
	});

	test("no figure read means no figure claimed", () => {
		expect(slowRunNote({ ms: 410_800, peak: null })).toBe("");
	});
});

describe("slowestLine", () => {
	const results = [
		{ file: "probe-boot.mjs", ms: 29_900 },
		{ file: "probe-music.mjs", ms: 410_800 },
		{ file: "probe-opening.mjs", ms: 422_500 },
		{ file: "probe-galaxy-map.mjs", ms: 3_800 },
	];

	test("nothing is printed for a run with no results", () => {
		expect(slowestLine([])).toBe("");
	});

	test("the slowest are named in order with their seconds", () => {
		const line = slowestLine(results, { limit: 2 });
		expect(line).toContain("probe-opening.mjs 422.5s");
		expect(line).toContain("probe-music.mjs 410.8s");
		expect(line.indexOf("probe-opening")).toBeLessThan(
			line.indexOf("probe-music"),
		);
	});

	test("it says what share of the run those were, and names what it left out", () => {
		const line = slowestLine(results, { limit: 2 });
		// 422.5 + 410.8 of 867.0 total
		expect(line).toContain("833.3s of 867.0s");
		expect(line).toContain("2 more");
	});

	test("a limit at or past the run's size leaves nothing untold", () => {
		expect(slowestLine(results, { limit: 9 })).not.toContain("more");
	});
});
