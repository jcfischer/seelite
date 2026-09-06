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
	FAR_COLUMN_OUTLIER_FACTOR,
	RADII,
	RELIEF_PATHS,
	farColumnVerdict,
	finite,
	flagExcursions,
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
 * The tell is **quantization**, which took two wrong answers to reach: a
 * clamped run's cells are integer multiples of one refresh interval, because
 * that is all a composited frame can cost. A rate list alone missed 144 Hz; a
 * flatness rule missed the stepped case, where heavy cells miss refreshes and
 * the run spans 2x while every figure is still the display's.
 */
describe("the vsync refusal", () => {
	test("passes a real run, whose cells are not multiples of anything", () => {
		// The measured ratio-1 table's terran row. Its floor is 1.8 ms, which is on
		// no refresh interval at all.
		expect(vsyncRefusal([1.8, 1.8, 1.9, 3.6, 7.2, 11.6, 11.6])).toBe(null);
		expect(vsyncRefusal([16.1, 4.2, 2.1, 43.6])).toBe(null);
	});

	test("refuses a flat run pinned at a refresh rate, and names it", () => {
		const refusal = vsyncRefusal([16.7, 16.7, 16.68, 16.7]);
		expect(refusal).toMatch(/quantized/i);
		expect(refusal).toMatch(/60 Hz/);
	});

	/**
	 * **The case that sent the second version back** (sage, PR #214, round 2).
	 *
	 * That version called a clamp *flat* and refused on `max / min`. Under vsync
	 * a frame that misses its refresh takes two intervals, so a clamped run reads
	 * 6.94 and 13.89 and spans 2x — it sailed through a 1.5x spread rule. The
	 * property was never flatness; it is that every cell is a whole number of
	 * intervals.
	 */
	/**
	 * **The case that sent the third version back** (sage, PR #214, round 3).
	 *
	 * That version asked whether the floor sat on a *named* rate and passed when
	 * it did not, so a fully quantized 100 Hz run walked through a list that
	 * happened to hold 90 and 120. Falling back to passing reads as the cautious
	 * direction and is the opposite: every version of this guard that has failed
	 * has failed open. A band cannot be short an entry.
	 */
	test("refuses a quantized run at a rate no list would have held", () => {
		expect(vsyncRefusal([10, 10, 20, 30])).toMatch(/quantized/i);
		// 110 Hz and 55 Hz — both inside the band, neither a rate anyone names.
		expect(vsyncRefusal([9.09, 9.09, 18.18, 27.27])).toMatch(/quantized/i);
		expect(vsyncRefusal([18.2, 18.2, 36.4, 18.2])).toMatch(/quantized/i);
	});

	/**
	 * And the band has ends. A run flooring below 240 Hz's interval is this
	 * game's actual control cell — under 2 ms — and no display produced it.
	 */
	test("passes a quantized run whose floor is faster than any display", () => {
		expect(vsyncRefusal([1.8, 1.8, 3.6, 7.2])).toBe(null);
	});

	test("refuses a stepped run, where heavy cells miss refreshes", () => {
		expect(vsyncRefusal([6.94, 6.94, 13.89, 20.83])).toMatch(/quantized/i);
		expect(vsyncRefusal([16.7, 33.3, 50.0, 16.7])).toMatch(/quantized/i);
		// 120 Hz, doubling twice.
		expect(vsyncRefusal([8.33, 8.33, 16.67, 33.33])).toMatch(/quantized/i);
	});

	/**
	 * And it must not accuse a machine that is merely slow. A clamp quantizes; a
	 * slow GPU only scales, so the cells land off the grid.
	 */
	test("passes a slow run whose cells are off the grid", () => {
		expect(vsyncRefusal([16.7, 40, 90, 180])).toBe(null);
	});

	/**
	 * Both halves of the rule are needed, and each is asserted alone.
	 *
	 * A run *floored* on an interval but not quantized above it is a real machine
	 * that happens to be that fast; a run quantized on a floor that is on no
	 * interval is a coincidence, not a compositor.
	 */
	test("needs both a refresh floor and multiples above it", () => {
		// Floor on 60 Hz, but 1.4x and 2.7x are not whole intervals.
		expect(vsyncRefusal([16.7, 23.4, 45.1, 16.9])).toBe(null);
		// Tidy multiples, but a 2 ms floor is faster than any display.
		//
		// This row read `[5, 5, 10, 20]` while the rule was a list of named rates,
		// on the reasoning that 5 ms was on no such rate. The band refuses it now
		// and is right to: 5 ms is 200 Hz, which is a display. The row moved to a
		// floor that is genuinely outside the band rather than merely unlisted.
		expect(vsyncRefusal([2, 2, 4, 8])).toBe(null);
	});

	test("refuses an empty run rather than passing one with nothing in it", () => {
		expect(vsyncRefusal([])).toMatch(/no readings/i);
	});

	test("refuses a run carrying a zero, which has no floor to divide by", () => {
		expect(vsyncRefusal([0, 12, 40])).toMatch(/not a frame cost/);
	});
});

describe("the sweep's declared columns", () => {
	/**
	 * The control is the widest column and it is first, because the guard above
	 * reads the run's spread — a sweep with no cheap column has nothing for its
	 * dear ones to be spread against.
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

	/**
	 * **Every path the renderer can select, which is now three** (#207).
	 *
	 * `none` was `perfAblate` 1 — an ablation the panel offered and no shipped
	 * code path chose. It is a compiled program now and the apparent-size band
	 * selects it in flight, so a sweep that skipped it would be leaving a column
	 * of the shipped renderer unpriced rather than leaving out a diagnostic.
	 *
	 * Ordered, because the table's columns are printed in this order and a
	 * receipt quoting "the third column" wants that to keep meaning one thing.
	 */
	test("sweeps every relief path the renderer can select", () => {
		expect([...RELIEF_PATHS]).toEqual(["four-tap", "screen-space", "none"]);
	});
});

/**
 * The widest column as the run's own invariant.
 *
 * Asserted from both sides, like every other guard here: it passes a column
 * whose cells agree, and it names the ones in a column that does not. The
 * numbers in the failing case are #248's actual first run — 44.1 ms against a
 * 2.4 ms floor — rather than round invented ones, so the test fails the day the
 * factor stops catching the thing it was written for.
 */
describe("the widest column's verdict", () => {
	const at = (radii: number, ms: number, arm: string) => ({ radii, ms, arm });

	test("a column whose cells agree reports no excursion", () => {
		const v = farColumnVerdict(
			[
				at(200, 2.6, "full"),
				at(200, 2.5, "screen-space"),
				at(200, 2.4, "bare"),
				at(1.02, 43.5, "full"),
			],
			200,
		);
		expect(v.excursion).toBe(false);
		expect(v.outliers).toHaveLength(0);
		expect(v.floorMs).toBeCloseTo(2.4, 5);
		// The close column is not the invariant and must not be dragged into it:
		// 43.5 is eighteen times the floor and is the reading the sweep exists for.
		expect(v.cells).toBe(3);
	});

	test("the excursion #248 measured is named and flagged on the run", () => {
		const v = farColumnVerdict(
			[
				at(200, 2.6, "full"),
				at(200, 2.4, "no-atmosphere"),
				at(200, 44.1, "no-clouds"),
			],
			200,
		);
		expect(v.excursion).toBe(true);
		expect(v.outliers.map((r) => r.arm)).toEqual(["no-clouds"]);
	});

	/**
	 * The endpoint drift control passes this run and the invariant does not,
	 * which is the whole reason the invariant exists — `full at 200r` read 2.5 ms
	 * at both ends of the run whose middle read 44.
	 */
	test("a cell exactly at the factor is not an outlier and just past it is", () => {
		const floor = 2.4;
		const edge = farColumnVerdict(
			[at(200, floor, "full"), at(200, floor * FAR_COLUMN_OUTLIER_FACTOR, "x")],
			200,
		);
		expect(edge.excursion).toBe(false);
		const past = farColumnVerdict(
			[
				at(200, floor, "full"),
				at(200, floor * FAR_COLUMN_OUTLIER_FACTOR + 0.01, "x"),
			],
			200,
		);
		expect(past.excursion).toBe(true);
	});

	test("a run with no cell in that column is a throw, not a pass", () => {
		expect(() => farColumnVerdict([at(3, 10.5, "full")], 200)).toThrow(/200/);
	});

	test("a non-finite cell in the column is named rather than compared", () => {
		expect(() =>
			farColumnVerdict([{ radii: 200, ms: Number.NaN, arm: "full" }], 200),
		).toThrow(/widest cell/);
	});
});

/**
 * Propagating a run's verdict onto its rows.
 *
 * The three lines this covers were wrong once, in the way a three-line loop is:
 * they carried the flag onto the widest column only, so the 30r cell of an
 * excursion run — 44.6 ms beside a 2.6 ms neighbour — came out clean.
 */
describe("flagging a run's rows with its verdict", () => {
	const row = (pixelRatio: number, radii: number, ms: number) => ({
		pixelRatio,
		radii,
		ms,
	});

	test("every row of an excursion run is flagged, at every radius", () => {
		const rows = [
			row(2, 200, 44.1),
			row(2, 30, 44.6),
			row(2, 1.02, 43.5),
			row(1, 200, 1.8),
			row(1, 1.02, 12.1),
		];
		const flagged = flagExcursions(rows, {
			1: { excursion: false },
			2: { excursion: true },
		});
		expect(
			flagged.filter((r) => r.pixelRatio === 2).map((r) => r.runExcursion),
		).toEqual([true, true, true]);
		// The other run is a separate browser and a separate verdict; a clean run
		// must not inherit its neighbour's doubt.
		expect(
			flagged.filter((r) => r.pixelRatio === 1).map((r) => r.runExcursion),
		).toEqual([false, false]);
	});

	test("a row from a run with no verdict is a throw, not an unflagged row", () => {
		expect(() =>
			flagExcursions([row(4, 200, 2.0)], { 2: { excursion: false } }),
		).toThrow(/pixel ratio 4/);
	});
});
