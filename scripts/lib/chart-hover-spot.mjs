/**
 * Where #540's chart rows put the pointer (#177 D2, D4).
 *
 * The capture placer reads the chart's projected systems, its viewport and its
 * pick radius off the page, asks this module for a spot, moves a real pointer
 * there, and then compares what the chart labelled against the index returned
 * here. So this is a **prediction**, and it is written without the chart's own
 * hover rule (`src/hover-candidate.ts`): a spot chosen by the code under test
 * would agree with it by construction, and the readback would prove nothing.
 *
 * The search is `probe-navigation-console.mjs`'s `findContested` and
 * `findUncontested`, with two differences worth knowing:
 *
 * - **What counts as drawn is the chart's `drawn`**, near plane included. The
 *   probe's `__seeliteOnScreen` omits `depth >= -1`; a point clipped there is
 *   absent from the hover's list, so counting it would predict a badge the
 *   chart never draws.
 * - **Candidates are visited by ascending index**, then by angle, and the first
 *   candidate that meets the condition wins a tie. `projected()` lists systems
 *   in generation order today, and a sheet should not re-frame the day that
 *   changes.
 *
 * Every cursor sits 0.6 pick radii off its system's centre, and at least
 * `2r + 4` px inside the canvas so the label is not clamped at an edge.
 */

import { CHART_SPOTS } from "./view-set.mjs";

/**
 * @typedef {{ index: number, x: number, y: number, behind: boolean, depth: number }} ProjectedPoint
 * @typedef {{ pickRadiusPx: number, width: number, height: number }} ChartView
 * @typedef {{ x: number, y: number, index: number, contested: number }} ChartSpot
 */

/**
 * The spot a row asks for, or `null` where the framing offers none.
 *
 * - `crowded` — the sampled position with the most drawn systems inside the
 *   pick radius, at least two, naming the nearest of them. `contested` is the
 *   badge's number: the systems there other than the named one.
 * - `isolated` — a position with exactly one drawn system inside the pick
 *   radius, which is the one it names. `contested` is 0.
 *
 * @param {ReadonlyArray<ProjectedPoint>} points
 * @param {ChartView} view
 * @param {"crowded" | "isolated"} spot
 * @returns {ChartSpot | null}
 */
export function chartHoverSpot(points, view, spot) {
	if (!CHART_SPOTS.includes(spot))
		throw new Error(
			`chart spot: "${spot}" is not one of ${CHART_SPOTS.join(", ")}`,
		);
	const r = view.pickRadiusPx;
	const drawn = points
		.filter(
			(p) =>
				!p.behind &&
				p.depth >= -1 &&
				p.x >= 0 &&
				p.y >= 0 &&
				p.x <= view.width &&
				p.y <= view.height,
		)
		.sort((a, b) => a.index - b.index);
	const inset = 2 * r + 4;
	const inside = (x, y) =>
		x > inset && y > inset && x < view.width - inset && y < view.height - inset;
	// Strict `<`, as the chart's own pick test is.
	const within = (x, y) =>
		drawn.filter((p) => Math.hypot(p.x - x, p.y - y) < r);

	/** @type {ChartSpot | null} */
	let best = null;
	for (const p of drawn)
		for (let a = 0; a < 12; a++) {
			const angle = (a / 12) * Math.PI * 2;
			const x = p.x + Math.cos(angle) * r * 0.6;
			const y = p.y + Math.sin(angle) * r * 0.6;
			if (!inside(x, y)) continue;
			const hits = within(x, y);
			if (spot === "isolated") {
				if (hits.length === 1 && hits[0].index === p.index)
					return { x, y, index: p.index, contested: 0 };
				continue;
			}
			if (hits.length < 2) continue;
			if (best !== null && hits.length - 1 <= best.contested) continue;
			let nearest = hits[0];
			for (const h of hits)
				if (
					Math.hypot(h.x - x, h.y - y) <
					Math.hypot(nearest.x - x, nearest.y - y)
				)
					nearest = h;
			best = { x, y, index: nearest.index, contested: hits.length - 1 };
		}
	return best;
}

/**
 * `chartHoverSpot`, or a thrown error naming the row's condition.
 *
 * A framing that offers no such spot is a red run and not a skipped row: a
 * sheet with a hole in it reads exactly like a whole one.
 *
 * @param {ReadonlyArray<ProjectedPoint>} points
 * @param {ChartView} view
 * @param {"crowded" | "isolated"} spot
 * @returns {ChartSpot}
 */
export function requireChartSpot(points, view, spot) {
	const found = chartHoverSpot(points, view, spot);
	if (found === null)
		throw new Error(
			`chart placer: no ${spot} spot on this framing — ${points.length} systems projected into ${view.width}x${view.height} at a ${view.pickRadiusPx} px pick radius`,
		);
	return found;
}
