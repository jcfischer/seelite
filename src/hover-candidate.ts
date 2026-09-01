/**
 * The galaxy chart's sticky hover candidate — #108's D1.
 *
 * **A leaf, and deliberately so.** The chart's hover rule is arithmetic over a
 * cursor and a list of projected points, and putting it inside
 * `galaxy-map.ts` would make it reachable only through a `pointermove` on a
 * mounted canvas — which means its boundaries are only ever checked at whatever
 * grid positions a probe happens to drive it to. #108 pins the *behaviour* in
 * the browser tier and leaves the constants as retune territory, so the
 * arithmetic owes a headless test of its own.
 *
 * Three numbers, answering three different failures:
 *
 * - **The pick radius** is the click's own (`PICK_RADIUS_PX`, 14). A fresh
 *   candidate must be inside it, and the contested count is taken against it,
 *   because the badge predicts what a *click* would do rather than describing
 *   how far the label will stretch.
 * - **The release radius** (20) holds the labelled system while the cursor
 *   drifts off it. Without it the label blinks off at exactly 14 px.
 * - **The switch margin** (3) stops two systems a pixel apart trading the label
 *   on sub-pixel movement. `galaxy-map.md` §5.1 measures 68.4%-77.7% of hovers
 *   in the shipped console cell as having such a neighbour, which is what makes
 *   this the failure the node was raised about rather than a corner case.
 *
 * The release radius alone leaves the flicker; the margin alone leaves the
 * blink. Neither substitutes for the other.
 *
 * **A rival must be inside the pick radius to take the label.** The click takes
 * the hovered candidate rather than re-running `pick()` (D1), so a rival that
 * no `pick()` would return must not become one here either — otherwise
 * `pointerup` would select a system the click path could never have reached.
 * The held candidate is the one exception, and it is the point of the release
 * radius.
 */

/** One system's projected position, in the same canvas-relative pixels the
 *  cursor is given in. Whether a point is in front of the camera and inside the
 *  viewport is the caller's filter, not this rule's — a system that is not
 *  drawn is simply absent from the list. */
export interface HoverPoint {
	index: number;
	x: number;
	y: number;
}

/** The three radii, passed in rather than owned here. `galaxy-map.ts` holds the
 *  shipped values beside the pick radius they are set against. */
export interface HoverRule {
	pickRadiusPx: number;
	releaseRadiusPx: number;
	switchMarginPx: number;
}

export interface HoverCandidate {
	index: number;
	/** The labelled system's own pixel distance from the cursor. Exposed because
	 *  it is the quantity the hold is about, and a caller that recomputed it
	 *  would be a second implementation of this rule's own arithmetic. */
	distancePx: number;
	/** Systems inside the **pick** radius other than the labelled one. Zero is
	 *  the uncontested case and is what suppresses the badge. */
	contested: number;
}

/**
 * The system a hover at `(cursorX, cursorY)` names, given the one it named
 * last.
 *
 * `held` is the previously labelled index, or `null` on a first hover or after
 * a release. Returns `null` when nothing is close enough to name.
 */
export function hoverCandidate(
	points: readonly HoverPoint[],
	cursorX: number,
	cursorY: number,
	held: number | null,
	rule: HoverRule,
): HoverCandidate | null {
	let nearestIndex: number | null = null;
	let nearestPx = Number.POSITIVE_INFINITY;
	let heldPx: number | null = null;
	let insidePick = 0;

	for (const p of points) {
		const d = Math.hypot(p.x - cursorX, p.y - cursorY);
		if (p.index === held) heldPx = d;
		// `<`, matching `pick()`'s own test. Two searches over one radius that
		// disagreed on its boundary would be exactly the divergence D1 routes
		// the click through this candidate to prevent.
		if (d < rule.pickRadiusPx) {
			insidePick++;
			if (d < nearestPx) {
				nearestPx = d;
				nearestIndex = p.index;
			}
		}
	}

	// The hold: still on screen, still inside the release radius, and no rival
	// the click could reach is nearer by more than the margin.
	const holds =
		heldPx !== null &&
		heldPx < rule.releaseRadiusPx &&
		(nearestIndex === null ||
			nearestIndex === held ||
			nearestPx >= heldPx - rule.switchMarginPx);

	const index = holds ? (held as number) : nearestIndex;
	if (index === null) return null;
	const distancePx = holds ? (heldPx as number) : nearestPx;

	// The badge counts against the pick radius, so a held candidate sitting
	// outside it is not one of the systems it counts — subtract only when the
	// labelled system is itself inside.
	const contested =
		distancePx < rule.pickRadiusPx ? insidePick - 1 : insidePick;
	return { index, distancePx, contested };
}
