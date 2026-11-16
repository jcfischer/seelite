import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	EXCLUSIVE,
	PROBE_SECONDS,
	exclusiveLines,
	parseProbeLog,
	schedule,
} from "../scripts/lib/probe-schedule.mjs";
import { discoverProbeFiles } from "../scripts/lib/probe-inventory.mjs";

const SCRIPTS = join(import.meta.dir, "..", "scripts");

describe("schedule", () => {
	const seconds = new Map([
		["probe-a.mjs", 10],
		["probe-b.mjs", 200],
		["probe-c.mjs", 50],
	]);

	test("pooled probes start longest first", () => {
		const { pooled } = schedule(["probe-a.mjs", "probe-b.mjs", "probe-c.mjs"], {
			seconds,
			exclusive: new Map(),
		});
		expect(pooled).toEqual(["probe-b.mjs", "probe-c.mjs", "probe-a.mjs"]);
	});

	test("a probe with no recorded duration starts before every timed one, by name", () => {
		const { pooled } = schedule(
			["probe-a.mjs", "probe-z-new.mjs", "probe-b.mjs", "probe-m-new.mjs"],
			{ seconds, exclusive: new Map() },
		);
		expect(pooled).toEqual([
			"probe-m-new.mjs",
			"probe-z-new.mjs",
			"probe-b.mjs",
			"probe-a.mjs",
		]);
	});

	test("equal durations fall back to the name, so the order never depends on input order", () => {
		const tied = new Map([
			["probe-x.mjs", 30],
			["probe-y.mjs", 30],
		]);
		const one = schedule(["probe-y.mjs", "probe-x.mjs"], {
			seconds: tied,
			exclusive: new Map(),
		});
		const two = schedule(["probe-x.mjs", "probe-y.mjs"], {
			seconds: tied,
			exclusive: new Map(),
		});
		expect(one).toEqual(two);
		expect(one.pooled).toEqual(["probe-x.mjs", "probe-y.mjs"]);
	});

	test("exclusive probes leave the pool and keep the same ordering among themselves", () => {
		const exclusive = new Map([
			["probe-a.mjs", "why a"],
			["probe-c.mjs", "why c"],
		]);
		const plan = schedule(["probe-a.mjs", "probe-b.mjs", "probe-c.mjs"], {
			seconds,
			exclusive,
		});
		expect(plan.pooled).toEqual(["probe-b.mjs"]);
		expect(plan.exclusive).toEqual(["probe-c.mjs", "probe-a.mjs"]);
	});

	test("an exclusive probe that was not selected is not scheduled", () => {
		const plan = schedule(["probe-b.mjs"], {
			seconds,
			exclusive: new Map([["probe-a.mjs", "why a"]]),
		});
		expect(plan).toEqual({ pooled: ["probe-b.mjs"], exclusive: [] });
	});
});

describe("the exclusive group", () => {
	const inventory = new Set(discoverProbeFiles(SCRIPTS));

	test("names the probes #1175 requires, each with a reason", () => {
		for (const file of [
			"probe-station-interior-kit.mjs",
			"probe-occlusion.mjs",
			"probe-live-cockpit.mjs",
			"probe-planet-surfaces.mjs",
		]) {
			expect(EXCLUSIVE.get(file)?.length ?? 0).toBeGreaterThan(0);
		}
	});

	test("every member is a probe the suite runs", () => {
		for (const file of EXCLUSIVE.keys()) expect(inventory.has(file)).toBe(true);
	});

	test("every probe that opens a visible window is a member", () => {
		const visible = readdirSync(SCRIPTS).filter(
			(f) =>
				inventory.has(f) &&
				/probeWindow:\s*PROBE_WINDOW_VISIBLE/.test(
					readFileSync(join(SCRIPTS, f), "utf8"),
				),
		);
		expect(visible.length).toBeGreaterThan(0);
		for (const file of visible) expect(EXCLUSIVE.has(file)).toBe(true);
	});

	test("the summary names each member that ran and why", () => {
		const lines = exclusiveLines(["probe-b.mjs", "probe-occlusion.mjs"]);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("probe-occlusion.mjs");
		expect(lines[0]).toContain(String(EXCLUSIVE.get("probe-occlusion.mjs")));
		expect(exclusiveLines([])).toEqual([]);
	});
});

describe("recorded durations", () => {
	test("parseProbeLog keeps green probes' seconds and skips reds", () => {
		const log = [
			"probing http://127.0.0.1:1 (dev server) — 3 probes, 1 at a time",
			"ok   probe-a.mjs (18.5s)",
			"ok   probe-b.mjs (125.0s) · peak load 5.0",
			"FAIL probe-c.mjs (133.0s) exit=1 assert · peak load 3.8",
			"warn probe-d.mjs (20.9s) exit=1 assert",
			"     │   ok   a probe's own line (9.9s)",
		].join("\n");
		expect(parseProbeLog(log)).toEqual(
			new Map([
				["probe-a.mjs", 18.5],
				["probe-b.mjs", 125],
			]),
		);
	});

	test("the tracked table names only probes the suite runs, each with positive seconds", () => {
		const inventory = new Set(discoverProbeFiles(SCRIPTS));
		expect(PROBE_SECONDS.size).toBeGreaterThan(0);
		for (const [file, s] of PROBE_SECONDS) {
			expect(inventory.has(file)).toBe(true);
			expect(s).toBeGreaterThan(0);
		}
	});
});
