/**
 * The machine load a probe ran under (#84).
 *
 * A red under outside load — a second suite, a sage review, a test run — reads
 * like a defect. `probe-all` does not gate on load, because no threshold has
 * been measured; it reports the peak beside each failure and in the summary,
 * so the red says what the machine was doing while it went red.
 */
import { describe, expect, test } from "bun:test";
import { loadSampler } from "../scripts/lib/probe-load.mjs";

/** A sampler driven by hand: a settable clock and a settable load. */
function manual() {
	const state = { t: 0, load: 0 };
	const s = loadSampler({
		everyMs: 0,
		now: () => state.t,
		read: () => state.load,
	});
	const at = (t: number, load: number) => {
		state.t = t;
		state.load = load;
		s.sample();
	};
	return { s, at, state };
}

describe("loadSampler", () => {
	test("the peak over a window is the largest sample inside it", () => {
		const { s, at } = manual();
		at(0, 1);
		at(10, 9);
		at(20, 4);
		at(30, 30);
		expect(s.peakBetween(5, 25)).toBe(9);
	});

	test("the sample just before the window counts, so a short probe has one", () => {
		const { s, at, state } = manual();
		at(0, 12);
		at(100, 2);
		state.t = 60;
		// no timed sample falls in 50..60; the one at 0 is the load it started under
		expect(s.peakBetween(50, 60)).toBe(12);
	});

	test("the end of a window is sampled when it is read", () => {
		const { s, at, state } = manual();
		at(0, 1);
		state.t = 50;
		state.load = 20;
		expect(s.peakBetween(0, 50)).toBe(20);
	});

	test("the run's peak is the largest sample of all", () => {
		const { s, at } = manual();
		at(0, 3);
		at(10, 17);
		at(20, 5);
		expect(s.peak()).toBe(17);
	});

	test("with no samples and nothing to read the peak is null", () => {
		const s = loadSampler({ everyMs: 0, now: () => 0, read: () => null });
		expect(s.peak()).toBeNull();
		expect(s.peakBetween(0, 10)).toBeNull();
	});

	test("a timed sampler samples on its own and stops", async () => {
		let n = 0;
		const s = loadSampler({ everyMs: 20, read: () => ++n });
		await new Promise((r) => setTimeout(r, 120));
		s.stop();
		const after = n;
		await new Promise((r) => setTimeout(r, 60));
		expect(after).toBeGreaterThanOrEqual(3);
		expect(n).toBe(after);
	});
});
