/**
 * The galaxy chart's sticky hover candidate — #108's D1, as arithmetic.
 *
 * The rule is three numbers against a cursor and a list of projected points,
 * and none of that needs a pointer event, a canvas or a camera. Kept out of
 * `galaxy-map.ts` so it is reachable here: a rule that can only be exercised
 * through `pointermove` is one whose boundaries are only ever checked at the
 * grid positions a probe happens to drive it to, and #108 is explicit that the
 * *behaviour* is what the browser tier pins rather than the constants.
 *
 * The three cases are separate on purpose. **Hold** and **switch** are not one
 * rule seen twice: the release radius answers a cursor drifting off the
 * labelled system, and the switch margin answers two systems a pixel apart —
 * §5.1 measures 68.4%-77.7% of hovers in the shipped cell having such a
 * neighbour. A build with either half alone passes about half of what is below.
 */
import { describe, expect, test } from "bun:test";
import {
	type HoverPoint,
	type HoverRule,
	hoverCandidate,
} from "../src/hover-candidate";

/** The shipped numbers: the click's own 14 px radius, D1's 20 px release and
 *  3 px switch margin. The cases below are written against these rather than
 *  against invented ones, because a boundary is only interesting where the
 *  game actually puts it. */
const RULE: HoverRule = {
	pickRadiusPx: 14,
	releaseRadiusPx: 20,
	switchMarginPx: 3,
};

/** A point at a given distance to the right of the origin, which is where every
 *  case below puts the cursor. Distances are the only axis these cases vary. */
const at = (index: number, distancePx: number): HoverPoint => ({
	index,
	x: distancePx,
	y: 0,
});

const candidate = (
	points: readonly HoverPoint[],
	held: number | null,
	rule: HoverRule = RULE,
) => hoverCandidate(points, 0, 0, held, rule);

describe("a fresh hover is plain nearest-wins inside the pick radius", () => {
	test("nothing inside the pick radius produces no label", () => {
		expect(candidate([at(1, 14.5), at(2, 30)], null)).toBeNull();
	});

	test("the nearest system inside the radius is the one named", () => {
		expect(candidate([at(1, 12), at(2, 5), at(3, 9)], null)?.index).toBe(2);
	});

	test("the pick radius is exclusive, as the click's own search is", () => {
		// `pick()` in `galaxy-map.ts` tests `d < PICK_RADIUS_PX`. Two searches
		// over one radius that disagree on its boundary are the "two
		// implementations of one quantity" D1 routes the click through the hover
		// candidate to avoid, and the boundary is where they would differ.
		expect(candidate([at(1, 14)], null)).toBeNull();
		expect(candidate([at(1, 13.999)], null)?.index).toBe(1);
	});

	test("an empty sky produces no label and no throw", () => {
		expect(candidate([], null)).toBeNull();
		expect(candidate([], 7)).toBeNull();
	});
});

describe("the release radius holds a label the cursor has drifted off", () => {
	test("a held system outside the pick radius but inside the release keeps it", () => {
		// The failure this exists for: without it the label blinks off at
		// exactly 14 px, which is the distance the cursor spends most of its
		// time near while reading a point.
		const held = candidate([at(1, 17), at(2, 25)], 1);
		expect(held?.index).toBe(1);
		expect(held?.distancePx).toBeCloseTo(17, 6);
	});

	test("past the release radius the label lets go", () => {
		expect(candidate([at(1, 20), at(2, 25)], 1)).toBeNull();
	});

	test("letting go falls back to whatever is inside the pick radius", () => {
		expect(candidate([at(1, 21), at(2, 8)], 1)?.index).toBe(2);
	});

	test("a held system that has left the projection is dropped", () => {
		// Behind the camera, or off the far side of an orbit. The caller filters
		// those out, so the held index simply is not in the list.
		expect(candidate([at(2, 9)], 1)?.index).toBe(2);
		expect(candidate([at(2, 30)], 1)).toBeNull();
	});
});

describe("the switch margin decides between two systems a pixel apart", () => {
	test("a rival nearer by less than the margin does not take the label", () => {
		expect(candidate([at(1, 10), at(2, 8)], 1)?.index).toBe(1);
	});

	test("a rival nearer by exactly the margin does not take it either", () => {
		expect(candidate([at(1, 15), at(2, 12)], 1)?.index).toBe(1);
	});

	test("a rival nearer by more than the margin does take it", () => {
		expect(candidate([at(1, 15), at(2, 11.9)], 1)?.index).toBe(2);
	});

	test("a rival outside the pick radius cannot take the label at all", () => {
		// The click takes the hovered candidate, so a rival the click could not
		// select must not become the label either — otherwise `pointerup` would
		// select a system more than 14 px from the cursor that no fresh `pick()`
		// would ever return.
		expect(candidate([at(1, 19), at(2, 14.5)], 1)?.index).toBe(1);
	});

	test("the margin applies only to a held candidate, never to a fresh one", () => {
		// Nearest-wins on the first hover: there is nothing to be sticky about,
		// and a margin applied with no incumbent would be a tie-break rule
		// nobody specified.
		expect(candidate([at(1, 10), at(2, 8)], null)?.index).toBe(2);
	});
});

describe("the contested count predicts the click, not the label's tolerance", () => {
	test("it counts the systems inside the pick radius other than the labelled one", () => {
		const one = candidate([at(1, 4), at(2, 9), at(3, 12)], null);
		expect(one?.index).toBe(1);
		expect(one?.contested).toBe(2);
	});

	test("an uncontested position carries no count", () => {
		expect(candidate([at(1, 4), at(2, 40)], null)?.contested).toBe(0);
	});

	test("it is taken against the pick radius and not the release radius", () => {
		// A system at 17 px is inside the release radius and outside the pick
		// one. Counting it would make the badge describe how far the label will
		// stretch rather than how ambiguous a click here is, which is the
		// opposite of what D1 says the badge means.
		expect(candidate([at(1, 4), at(2, 17)], null)?.contested).toBe(0);
	});

	test("a held candidate outside the pick radius still counts what is inside it", () => {
		// The label says the held system; the badge says a click here is
		// ambiguous anyway. Both are true at once and the badge is the half that
		// tells the player so.
		//
		// **The window this can happen in is one switch margin wide**, and the
		// first version of this case sat outside it: a held system at 17 px
		// against a rival at 9 px does not hold at all, because 9 is nearer by
		// 8 and the margin is 3. Holding *and* being contested requires every
		// rival to be both inside the 14 px pick radius and no more than 3 px
		// nearer, so the held distance lies in [14, 17). Past 17 a held label
		// implies an empty pick radius, and the badge is then zero by
		// construction rather than by choice.
		const held = candidate([at(1, 16), at(2, 13.5), at(3, 13.8)], 1);
		expect(held?.index).toBe(1);
		expect(held?.contested).toBe(2);
	});

	test("past the switch margin a held label implies an empty pick radius", () => {
		// The other side of the window above, so the claim is measured rather
		// than asserted: at 17.5 px the same rivals take the label.
		expect(candidate([at(1, 17.5), at(2, 13.5), at(3, 13.8)], 1)?.index).toBe(
			2,
		);
	});
});

describe("the rule is a pure function of its arguments", () => {
	test("it reads the radii it is given rather than any constant of its own", () => {
		const wide: HoverRule = {
			pickRadiusPx: 30,
			releaseRadiusPx: 40,
			switchMarginPx: 0,
		};
		expect(candidate([at(1, 25)], null, wide)?.index).toBe(1);
		// A zero switch margin is nearest-wins with a release radius, which is
		// the half-built defect #108 names. It is expressible, and the check
		// that catches it is the browser tier's — here it merely must not throw.
		expect(candidate([at(1, 12), at(2, 11.99)], 1, wide)?.index).toBe(2);
	});

	test("it does not mutate the points it is handed", () => {
		const points = [at(1, 4), at(2, 9)];
		const before = JSON.stringify(points);
		hoverCandidate(points, 0, 0, null, RULE);
		expect(JSON.stringify(points)).toBe(before);
	});
});
