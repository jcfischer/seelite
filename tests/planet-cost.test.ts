/**
 * The parts of #206's planet-cost sweep that are not a browser.
 *
 * The sweep itself is a headed Playwright script and cannot run here — that is
 * the whole reason it exists, since the point of it is a renderer no headless
 * run has. What *can* be held is everything between the browser and the table:
 * how a reading is lifted out of the `?fps` readout, what makes a cell's pair
 * of readings noise rather than a measurement, and the three refusals that stop
 * a garbage run being transcribed into a spec.
 *
 * `economy-trade.md`'s rule from #7 is the shape of this file: **a measurement
 * instrument must fail loudly.** An instrument that quietly reports a NaN is
 * worse than one that dies, because its numbers get quoted. So every guard
 * here is asserted from both sides — it passes what it should pass, and it
 * throws on what it exists to catch.
 */
import { describe, expect, test } from "bun:test";
import { fpsReadout } from "../src/fps-meter.ts";
import { VIEWS } from "../scripts/lib/view-set.mjs";
import {
	RADII,
	RELIEF_PATHS,
	finite,
	parseFpsReadout,
	radiiRefusal,
	vsyncRefusal,
} from "../scripts/lib/planet-cost.mjs";

/** What a browser hands back for an element: the tags gone, the text left. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

describe("reading the fps meter", () => {
	/**
	 * **Round-tripped through the writer, not through a typed-out string.**
	 *
	 * A parser tested against a literal proves the parser matches what the test
	 * author remembered the meter printing. This one is fed the meter's own
	 * output, so the day `fps-meter.ts` changes its line, the test that goes red
	 * is this one rather than nothing at all.
	 */
	test("reads back what the meter writes", () => {
		const read = parseFpsReadout(textOf(fpsReadout(412.7, 9, 143)));
		expect(read.fps).toBe(412.7);
		expect(read.worstMs).toBe(9);
		expect(read.peakMs).toBe(143);
	});

	/**
	 * The one figure the parser does *not* take from the meter.
	 *
	 * `fpsReadout` rounds its millisecond figure to whole numbers, which is
	 * right for a reader at 15 fps and useless at 400: 2 ms and 3 ms are a 50%
	 * difference in the thing this sweep measures. The rate carries a decimal,
	 * so the parser divides.
	 */
	test("derives the frame time from the rate rather than the rounded figure", () => {
		const line = textOf(fpsReadout(412.7, 9, 143));
		// What the meter printed, and what it would have to be for the printed
		// figure to be usable.
		expect(line).toContain("2 ms");
		expect(parseFpsReadout(line).ms).toBeCloseTo(1000 / 412.7, 10);
	});

	test("reads a stalled meter as a refusal rather than as a rate", () => {
		// The meter's other line. It carries no rate at all, and a parser that
		// shrugged would hand a `NaN` to the table.
		expect(() => parseFpsReadout("stalled · 6.2 s")).toThrow(/stalled/);
	});

	test("refuses a line it cannot read rather than returning a NaN", () => {
		expect(() => parseFpsReadout("— fps")).toThrow(/could not read/);
		expect(() => parseFpsReadout("")).toThrow(/could not read/);
	});

	/**
	 * **A zero rate, and which guard actually catches it.**
	 *
	 * Written first as "the division to an infinity is what refuses it", which
	 * was wrong and the run said so: at `fps` 0 the *meter's own* division has
	 * already blown up, so the line it writes carries a literal `Infinity ms`
	 * and no rate-shaped regex matches it at all. The refusal is the shape one,
	 * one step earlier than expected. Recorded as what happens rather than
	 * patched into what was predicted — a window with no frames in it is a real
	 * case and this is really how it fails.
	 */
	test("refuses a zero rate", () => {
		const line = textOf(fpsReadout(0, 0, 0));
		expect(line).toContain("Infinity ms");
		expect(() => parseFpsReadout(line)).toThrow(/could not read/);
	});

	/**
	 * And the division guard is not thereby dead code. It is the second line,
	 * against a line that parses: nothing stops `fps-meter.ts` from printing a
	 * finite millisecond figure beside a zero rate one day, and this is what
	 * would meet it. Asserted rather than argued, because a guard nothing has
	 * watched fail is a guard nothing has watched.
	 */
	test("refuses a zero rate that arrives in a readable line", () => {
		expect(() =>
			parseFpsReadout("0.0 fps · 0 ms · worst 0 ms · peak 0 ms"),
		).toThrow(/frame time is not finite/);
	});
});

describe("the finite guard", () => {
	test("passes a number through and names what it was", () => {
		expect(finite("terran at 1.2 radii", 12.5)).toBe(12.5);
	});

	test("throws on every non-finite value, naming the cell", () => {
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1 / 0])
			expect(() => finite("terran at 1.2 radii", bad)).toThrow(
				/terran at 1\.2 radii/,
			);
	});
});

/**
 * **The refusal that says the launch flags did not take.**
 *
 * This is the trap #98 and `browser-measurement-traps` both record: a headed
 * browser composites at the display's refresh, so a meter counting
 * `requestAnimationFrame` callbacks reads 60 for every cell whether a frame
 * costs 2 ms or 16. The sweep launches with `--disable-gpu-vsync
 * --disable-frame-rate-limit` to lift that, and a flag that silently stopped
 * working would produce a complete, plausible, entirely worthless table where
 * every cheap column reads the same.
 *
 * The tell is the **control** column, and that is why the sweep has one: a
 * planet drawn as a dot at 200 radii cannot cost 16 ms on any GPU this targets.
 * If the cheapest cell in the run is still pinned at the refresh rate, the
 * clamp is the display and not the renderer.
 */
describe("the vsync refusal", () => {
	test("passes a run whose cheapest cell is well above a refresh rate", () => {
		expect(vsyncRefusal([16.1, 4.2, 2.1, 43.6])).toBe(null);
	});

	test("refuses a run pinned at a refresh rate, and says so", () => {
		// Every cell at 60 fps: the shape of a run where the flags did nothing.
		const refusal = vsyncRefusal([16.7, 16.7, 16.68, 16.7]);
		expect(refusal).toMatch(/vsync/i);
	});

	test("refuses a run pinned at 120 too, not just at 60", () => {
		// The machine this targets has a 120 Hz panel available, so a threshold
		// written against 60 alone would pass a fully clamped run on it. The
		// guard is about the *spread* being absent, not about one rate.
		expect(vsyncRefusal([8.33, 8.34, 8.33, 8.33])).toMatch(/vsync/i);
	});

	test("refuses an empty run rather than passing one with nothing in it", () => {
		expect(vsyncRefusal([])).toMatch(/no readings/i);
	});
});

describe("the sweep's declared columns", () => {
	/**
	 * The control is the widest column and it is first, because the guard above
	 * reads the cheapest cell in the run — a sweep with no cheap column has
	 * nothing to compare a clamp against.
	 */
	test("opens on a control column far enough out to be a dot", () => {
		expect(RADII[0]).toBe(200);
		expect(RADII).toEqual([...RADII].sort((a, b) => b - a));
	});

	/**
	 * The column and the view are the same placement on purpose — the table
	 * prices the picture — so this reads the view rather than restating its
	 * number. A re-framing of `planet-fill` that left the sweep behind would go
	 * red here, which is the only way the two stay one claim.
	 */
	test("prices the placement planet-fill captures", () => {
		const fill = VIEWS.find((v) => v.name === "planet-fill");
		const radii = (fill?.shot as { radii?: number } | undefined)?.radii;
		// Guarded, so the row cannot pass by the view having gone missing —
		// `toContain(undefined)` on a frozen array of numbers would simply fail,
		// but it would fail saying the wrong thing.
		expect(typeof radii).toBe("number");
		expect(RADII).toContain(radii as number);
	});

	test("keeps a column closer than the view, where the cost is", () => {
		// The expensive readings are inside the frame the sheet shows, and 1.2 is
		// where `planet-fill` was first placed before it was flown and rejected.
		// The picture there is a wash; the cost is real.
		expect(RADII).toContain(1.2);
	});

	/**
	 * **Every column stands outside the body, and #206's own list did not.**
	 *
	 * The node prescribed a closing column at 0.05 radii. `__sunOffset` measures
	 * its range from the body's **centre**, so on `planet-5` — 5,473 km — that
	 * put the camera 274 km from the centre and **5,199 km below the surface**,
	 * measured by placing it and reading the distance back. A hull is drawn
	 * `FrontSide`, so from in there the planet renders nothing at all: the
	 * column came back at 1.9 ms and 4.4 ms, the cheapest in the whole table,
	 * indistinguishable from the 200-radii control.
	 *
	 * That is the exact shape of a figure that gets quoted — "a planet up close
	 * is free" — so the fix is not only the column but the guard, and the guard
	 * is here rather than in a comment.
	 */
	test("stands every column outside the body it is measuring", () => {
		expect(radiiRefusal(RADII)).toBe(null);
		for (const radii of RADII) expect(radii).toBeGreaterThan(1);
	});

	test("refuses a column inside the body, naming it", () => {
		expect(radiiRefusal([200, 3, 0.05])).toMatch(/0\.05/);
		// One radius is the surface exactly, which is no better: the camera is in
		// the hull rather than outside it.
		expect(radiiRefusal([1])).toMatch(/inside/i);
	});

	test("closes on a low skim, which is the real worst case", () => {
		// 1.02 radii is 109 km over `planet-5`, measured. The surface fills the
		// frame and the near layer draws it at 1:1.
		expect(RADII.at(-1)).toBe(1.02);
	});

	test("sweeps both relief paths, which is what makes the third column a comparison", () => {
		expect([...RELIEF_PATHS]).toEqual(["four-tap", "screen-space"]);
	});
});
