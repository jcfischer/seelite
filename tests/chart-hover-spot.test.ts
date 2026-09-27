/**
 * Where #540's chart rows put the pointer — the half of the placer a
 * headless test can reach.
 *
 * The placer reads `projected()`, `viewport()` and `pickRadiusPx` off the
 * page and hands them here; the page then says what it labelled, and the run
 * compares. So this module is a **prediction** made independently of the
 * chart's own hover rule, and it is not allowed to import that rule: a spot
 * chosen by the code under test would agree with it by construction.
 */
import { describe, expect, test } from "bun:test";
import {
	CHART_SPOTS,
	chartHoverSpot,
	requireChartSpot,
} from "../scripts/lib/chart-hover-spot.mjs";

const VIEW = { pickRadiusPx: 14, width: 400, height: 300 };
const at = (index: number, x: number, y: number, extra = {}) => ({
	index,
	x,
	y,
	behind: false,
	depth: 0.5,
	...extra,
});
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	Math.hypot(a.x - b.x, a.y - b.y);

describe("the crowded spot", () => {
	test("is at the densest neighbourhood, naming the nearest system there", () => {
		const points = [
			at(0, 60, 60),
			at(1, 66, 60), // a pair
			at(2, 200, 150),
			at(3, 205, 150),
			at(4, 200, 155), // a triple
			at(5, 330, 240),
		];
		const spot = requireChartSpot(points, VIEW, "crowded");
		expect([2, 3, 4]).toContain(spot.index);
		expect(spot.contested).toBe(2);
		const near = points.filter((p) => dist(p, spot) < VIEW.pickRadiusPx);
		expect(near.map((p) => p.index).sort()).toEqual([2, 3, 4]);
		const nearest = [...near].sort((a, b) => dist(a, spot) - dist(b, spot))[0];
		expect(nearest.index).toBe(spot.index);
	});

	test("is refused where no two drawn systems share a pick radius", () => {
		const points = [at(0, 60, 60), at(1, 200, 150), at(2, 330, 240)];
		expect(chartHoverSpot(points, VIEW, "crowded")).toBeNull();
		expect(() => requireChartSpot(points, VIEW, "crowded")).toThrow(
			/no crowded spot/,
		);
	});
});

describe("the isolated spot", () => {
	test("has exactly one system inside the pick radius, and names it", () => {
		// Three pixels apart, so no off-centre spot escapes the pair: a cursor
		// 0.6 radii (8.4 px) off one is at most 11.4 px from the other. Six apart
		// was the first fixture, and the finder rightly found an isolated spot on
		// the pair's outer side.
		const points = [at(0, 60, 60), at(1, 63, 60), at(2, 200, 150)];
		const spot = requireChartSpot(points, VIEW, "isolated");
		expect(spot.index).toBe(2);
		expect(spot.contested).toBe(0);
		// Off the system's centre, for the reason the probe gives: a hit test
		// driven to a point's exact centre passes a build wrong at the boundary.
		const d = dist(spot, points[2]);
		expect(d).toBeGreaterThan(0);
		expect(d).toBeLessThan(VIEW.pickRadiusPx);
	});

	test("is refused where every drawn system has a neighbour", () => {
		const points = [
			at(0, 60, 60),
			at(1, 63, 60),
			at(2, 200, 150),
			at(3, 203, 150),
		];
		expect(chartHoverSpot(points, VIEW, "isolated")).toBeNull();
		expect(() => requireChartSpot(points, VIEW, "isolated")).toThrow(
			/no isolated spot/,
		);
	});
});

describe("what counts as drawn", () => {
	/**
	 * The chart's own `drawn` predicate: in front of the camera, not clipped by
	 * the near plane, inside the canvas box. A point failing any half is absent
	 * from the hover's list, so counting it here would predict a badge the
	 * chart never draws.
	 */
	test("a system behind the camera, past the near plane or off the canvas is no neighbour", () => {
		for (const ghost of [
			at(9, 206, 150, { behind: true }),
			at(9, 206, 150, { depth: -1.5 }),
		]) {
			const spot = requireChartSpot([at(2, 200, 150), ghost], VIEW, "isolated");
			expect(spot.index).toBe(2);
			expect(spot.contested).toBe(0);
		}
		// Off the right edge, a few pixels out: inside a pick radius of a point
		// near that edge, and rasterised by nothing.
		expect(
			chartHoverSpot([at(2, 395, 150), at(9, 403, 150)], VIEW, "crowded"),
		).toBeNull();
	});

	test("the cursor keeps clear of the edges, so the label is not clamped", () => {
		const inset = 2 * VIEW.pickRadiusPx + 4;
		expect(chartHoverSpot([at(0, 10, 150)], VIEW, "isolated")).toBeNull();
		const spot = requireChartSpot(
			[at(0, 10, 150), at(1, 200, 20 + inset)],
			VIEW,
			"isolated",
		);
		expect(spot.index).toBe(1);
		expect(spot.x).toBeGreaterThan(inset);
		expect(spot.y).toBeGreaterThan(inset);
	});
});

test("the choice does not depend on the order the page lists systems in", () => {
	const points = [
		at(0, 60, 60),
		at(1, 66, 60),
		at(2, 200, 150),
		at(3, 205, 150),
		at(4, 200, 155),
		at(5, 330, 240),
		at(6, 120, 200),
	];
	for (const kind of CHART_SPOTS)
		expect(chartHoverSpot([...points].reverse(), VIEW, kind)).toEqual(
			chartHoverSpot(points, VIEW, kind),
		);
});

test("names the two spots the rows ask for", () => {
	expect([...CHART_SPOTS]).toEqual(["crowded", "isolated"]);
	expect(() => requireChartSpot([], VIEW, "somewhere" as never)).toThrow(
		/somewhere/,
	);
});
