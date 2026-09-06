/**
 * Can the near layer's depth reach the approach pass — node #247.
 *
 * #242 measured that from inside a trade station's bay, 236,024 pixels of a
 * planet are visible and 5,182,559 are drawn: **4.6% shows**, and roughly 33 ms
 * a frame is shaded and composited away. The cause is structural. A body's
 * render layer is its distance (#15), so the planet is in the approach layer
 * and the station in the near one, and each layer is its own `RenderPass` with
 * its own depth buffer. Nothing in the approach pass has ever heard of the
 * station.
 *
 * #247 asks whether that depth can cross the scale seam, and asks for the
 * arithmetic rather than an assertion. This file is the arithmetic. It runs
 * headless because it is arithmetic: no pixel is drawn, and every number comes
 * out of the same `PerspectiveCamera` construction `main.ts` makes from the
 * same `units.ts` constants.
 *
 * **It is not a proposal and it prices nothing.** Whether a prepass is worth a
 * pass is a cost question and belongs to the instrument, not here. What is
 * settled here is the narrower thing #247 asks first: whether the answer is
 * available at all, and where it stops being trustworthy.
 */
import * as THREE from "three";
import { describe, expect, test } from "bun:test";
import {
	APPROACH_FAR_UNITS,
	APPROACH_NEAR_UNITS,
	APPROACH_SCALE,
	HANDOFF_HYSTERESIS,
	HANDOFF_KM,
	NEAR_FAR_KM,
	NEAR_NEAR_KM,
} from "../src/units";
import { VIEWPORT } from "../scripts/lib/view-set.mjs";
import { codeOf } from "./lib/source-scan";
import {
	flightFraming,
	OCCLUSION_FRAMINGS,
} from "../scripts/lib/view-placement.mjs";

/**
 * The two cameras, built exactly as `main.ts` builds them.
 *
 * The field of view is restated — `main.ts` holds it as a local `const fov = 60`
 * inside the constructor and exports nothing — and that is the one figure here
 * that could drift. It is read back out of that source below rather than left as
 * a hopeful copy; an earlier version of this comment claimed a check by name
 * that did not exist, which sage caught on PR #251 and which is the prose-ahead-
 * of-the-code failure this repo has in writing.
 */
const FOV = 60;
const aspect = VIEWPORT.width / VIEWPORT.height;
const nearCamera = new THREE.PerspectiveCamera(
	FOV,
	aspect,
	NEAR_NEAR_KM,
	NEAR_FAR_KM,
);
const approachCamera = new THREE.PerspectiveCamera(
	FOV,
	aspect,
	APPROACH_NEAR_UNITS,
	APPROACH_FAR_UNITS,
);
for (const cam of [nearCamera, approachCamera]) cam.updateMatrixWorld(true);

/** Where a physical point lands in a layer's clip space. `km` are physical;
 *  the layer's own scale is applied here rather than by the caller. */
const project = (
	camera: THREE.PerspectiveCamera,
	scale: number,
	xKm: number,
	yKm: number,
	distanceKm: number,
) =>
	new THREE.Vector3(xKm * scale, yKm * scale, -distanceKm * scale).project(
		camera,
	);

const inNear = (x: number, y: number, d: number) =>
	project(nearCamera, 1, x, y, d);
const inApproach = (x: number, y: number, d: number) =>
	project(approachCamera, APPROACH_SCALE, x, y, d);

/**
 * One step of a 24-bit depth buffer, in NDC z.
 *
 * The buffer stores window z in [0, 1] and NDC z spans [-1, 1], so a step of
 * `2^-24` in the buffer is twice that in NDC.
 */
const DEPTH_STEP_NDC = 2 * 2 ** -24;

/** How far a point at `distanceKm` must move before the near camera's depth
 *  buffer can tell, in metres. Bisected rather than derived, so the answer
 *  comes from the projection the renderer uses and not from a rearrangement of
 *  it that could be rearranged wrong. */
function depthResolutionM(distanceKm: number): number {
	const at = inNear(0, 0, distanceKm).z;
	let indistinguishable = 0;
	let distinguishable = distanceKm * 10;
	for (let i = 0; i < 200; i++) {
		const mid = (indistinguishable + distinguishable) / 2;
		if (Math.abs(inNear(0, 0, distanceKm + mid).z - at) < DEPTH_STEP_NDC)
			indistinguishable = mid;
		else distinguishable = mid;
	}
	return distinguishable * 1000;
}

describe("the camera these cameras stand in for", () => {
	/**
	 * **The field of view is a copy, so it is read back out of `main.ts`.**
	 *
	 * `main.ts` builds all four cameras from a local `const fov = 60` and exports
	 * nothing, so nothing can import it. What can be done is read the source —
	 * `perf-panel-keys.test.ts` reads `main.ts`'s key bindings the same way, and
	 * for the same reason: a constant checked by eye is a constant that drifts.
	 *
	 * Comments are stripped first, so a `60` inside a docstring cannot satisfy it.
	 */
	test("the field of view here is the one main.ts builds its cameras with", () => {
		const source = codeOf("src/main.ts");
		const declared = source.match(/const fov = (\d+(?:\.\d+)?);/);
		expect(declared).not.toBeNull();
		expect(Number(declared?.[1])).toBe(FOV);
	});

	/**
	 * And that one `fov` really does drive both cameras, so reading it settles
	 * both. A future near camera given its own field of view would break the
	 * x-and-y agreement below, and this is what would notice.
	 */
	test("and one fov drives every camera in the ladder", () => {
		const source = codeOf("src/main.ts");
		expect(source.match(/const fov = /g)).toHaveLength(1);
		for (const camera of [
			"backdropCamera",
			"farCamera",
			"approachCamera",
			"nearCamera",
		])
			expect(source).toMatch(
				new RegExp(
					`this\\.${camera} = new THREE\\.PerspectiveCamera\\(\\s*fov,`,
				),
			);
	});
});

describe("the scale seam, in x and y", () => {
	/**
	 * **The seam is a depth remap and nothing else, and this is the finding.**
	 *
	 * All four cameras sit at the origin with the ship's head-look orientation
	 * (`main.ts`, "All three cameras share the ship's head-look orientation and
	 * sit at the origin"), share one field of view and one aspect, and each
	 * layer's contents are multiplied by that layer's scale. So a physical point
	 * lands at the *same* clip x and y in both, to within a rounding of the
	 * scale multiply, and only its z differs.
	 *
	 * That is what makes the question answerable. A depth buffer that had to be
	 * reprojected in x and y would need the two frusta to be reconciled; these
	 * two are the same frustum sampled at two depth ranges, so a texel of the
	 * near depth buffer already corresponds to the approach pass's texel at the
	 * same coordinate.
	 *
	 * **To a unit in the last place, not to the last bit**, and the first
	 * version of this test asserted the stronger thing and went red on one row:
	 * the approach path multiplies the point by `APPROACH_SCALE` before
	 * projecting, and that multiply rounds. The disagreement is 2·10⁻¹⁶ of the
	 * NDC range — about 10⁻¹³ of a pixel across a 1440-wide frame — so the
	 * tolerance below is a statement that the two agree to float64 precision and
	 * not a slack anything can hide in. A real reprojection error would be
	 * larger than this by ten orders of magnitude or more.
	 */
	test("a physical point lands at the same clip x and y in both layers", () => {
		for (const [x, y, d] of [
			// A station's berth: metres off axis, a kilometre out.
			[0.02, 0.01, 0.5],
			// A hull in chase.
			[1, 0.5, 12],
			// The planet #242 framed through the aperture.
			[100, 50, 6700],
			// Past the near layer's far plane, where the near camera clips it and
			// the approach camera does not — the x and y still agree, so the seam
			// is not where the disagreement is.
			[3000, -1000, 200000],
		]) {
			const near = inNear(x, y, d);
			const approach = inApproach(x, y, d);
			// Absolute, against the NDC range of 2, so the bound is one figure for
			// every row rather than one that loosens as a point nears the edge.
			expect(Math.abs(approach.x - near.x)).toBeLessThan(1e-15);
			expect(Math.abs(approach.y - near.y)).toBeLessThan(1e-15);
		}
	});

	/**
	 * And the depths genuinely differ, so the test above is not passing because
	 * the two cameras are the same object.
	 */
	test("and at a different depth, which is the only thing that differs", () => {
		expect(inApproach(0, 0, 6700).z).not.toBe(inNear(0, 0, 6700).z);
	});
});

describe("what the near layer can occlude", () => {
	/**
	 * **Every possible near-layer occluder is inside the near camera's reach.**
	 *
	 * A body is in the near layer only within `HANDOFF_KM`, and the hysteresis
	 * lets one already admitted stay until `HANDOFF_KM × HANDOFF_HYSTERESIS`
	 * (`units.ts`). That is the farthest anything can be and still write near
	 * depth, and it is well inside the near camera's far plane — so no occluder
	 * is silently clipped out of the prepass.
	 *
	 * `tests/headless.test.ts` already asserts the inequality as a unit-scheme
	 * invariant. What is asserted here is the *margin*, because the prepass is
	 * what would consume it: a future `NEAR_FAR_KM` trimmed towards the handoff
	 * would start clipping occluders before it broke anything the existing
	 * assertion watches.
	 */
	test("the farthest occluder is well inside the near camera's far plane", () => {
		const farthestOccluderKm = HANDOFF_KM * HANDOFF_HYSTERESIS;
		expect(farthestOccluderKm).toBe(10500);
		expect(NEAR_FAR_KM / farthestOccluderKm).toBeCloseTo(1.9, 2);
	});

	/**
	 * The approach camera's near plane, in kilometres, so the other end of the
	 * seam is stated too: nothing physically closer than 5 km is in the approach
	 * pass at all, which is every occluder a bay has and no planet ever.
	 */
	test("the approach layer starts at 5 km and reaches two million", () => {
		expect(APPROACH_NEAR_UNITS / APPROACH_SCALE).toBe(5);
		expect(APPROACH_FAR_UNITS / APPROACH_SCALE).toBe(2e6);
	});
});

describe("whether the depth is precise enough to answer with", () => {
	/**
	 * **The near camera's depth is precise where the occluders are and useless
	 * where they cannot be, and those are the same fact.**
	 *
	 * A 24-bit buffer over a 2·10⁶:1 range distributes its precision as 1/z, so
	 * the numbers below span eleven orders of magnitude across the layer. They
	 * are asserted rather than described because they are the whole answer to
	 * "is this usable": a bay's occluder sits in the millimetre rows.
	 */
	test("millimetres at a berth, metres at a hundred kilometres", () => {
		expect(depthResolutionM(0.5)).toBeLessThan(0.01);
		expect(depthResolutionM(5)).toBeLessThan(0.2);
		expect(depthResolutionM(100)).toBeLessThan(100);
	});

	/**
	 * **And hundreds of kilometres at the handoff edge**, which is the honest
	 * limit of the whole scheme and the row a proposal must answer for.
	 *
	 * A station admitted to the near layer at 10,500 km resolves depth to about
	 * 700 km there, and a station orbits its planet at 400–2,000 km
	 * (`system.ts`). So at that range the prepass genuinely cannot tell the
	 * station from the planet behind it.
	 *
	 * It does not matter, and the reason is geometric rather than lucky: a
	 * 0.6 km station at 10,500 km subtends about one pixel, so the fragments it
	 * would wrongly keep or wrongly reject are that one pixel. The precision
	 * fails exactly where the saving is nil.
	 */
	test("but hundreds of kilometres at the handoff edge, where it does not pay", () => {
		expect(
			depthResolutionM(HANDOFF_KM * HANDOFF_HYSTERESIS) / 1000,
		).toBeGreaterThan(500);
	});

	/**
	 * The comparison the prepass would actually make, in depth units.
	 *
	 * #242's framing: the bay's structure a kilometre or so from the camera, the
	 * planet 6,700 km beyond it. The two are hundreds of thousands of buffer
	 * steps apart, so the test is not close to marginal — which is what the
	 * millimetre rows above imply and what this states as the number a reader
	 * wants.
	 */
	test("a bay's structure and its planet are hundreds of thousands of steps apart", () => {
		const structure = inNear(0, 0, 0.5).z;
		const planet = inNear(0, 0, 6700).z;
		const steps = Math.abs(planet - structure) / DEPTH_STEP_NDC;
		expect(steps).toBeGreaterThan(1e5);
	});
});

describe("recovering a physical distance from a near-layer depth", () => {
	/**
	 * The conversion a prepass needs, round-tripped.
	 *
	 * Both projections are the standard perspective one, so a near-layer NDC z
	 * inverts to a view-space distance in kilometres, and the approach pass
	 * compares against its own fragment's distance in the same kilometres. No
	 * reprojection, no frustum reconciliation — one divide and a scale.
	 */
	const distanceFromNdc = (ndcZ: number) => {
		const n = NEAR_NEAR_KM;
		const f = NEAR_FAR_KM;
		return (2 * f * n) / (f + n - ndcZ * (f - n));
	};

	test("the inversion returns the kilometres the projection was given", () => {
		for (const d of [0.5, 5, 100, 1000, 10500]) {
			expect(distanceFromNdc(inNear(0, 0, d).z)).toBeCloseTo(d, 3);
		}
	});
});

/**
 * The framings #247's sweep needs, and the roles they have to cover.
 *
 * `measure-bay-frame-cost.mjs --mask-sweep` is a headed script and cannot be
 * held here. What can be is the half that decides whether the sweep answers the
 * question: that a framing exists for each station role, and that the flight
 * framings vary the two things a coverage mask is actually sensitive to.
 *
 * #242 measured one berth of one station. The whole of #247's first bullet is
 * that one is not enough, so a role silently dropping out of the sweep would
 * leave the node answerable-looking and unanswered.
 */
describe("the framings #247's coverage sweep is built from", () => {
	test("every station role in the game has a framing", () => {
		// Slot roles and a pad role (#165) — the distinction the sweep exists to
		// test, since a pad has no shell for a planet to hide behind.
		expect(Object.keys(OCCLUSION_FRAMINGS)).toEqual(
			expect.arrayContaining(["berth", "shipyardBerth", "refineryCradle"]),
		);
	});

	/**
	 * **The pad role is on another seed and the framing has to say so.**
	 *
	 * Seed 47 generates a trade station and a shipyard and nothing else
	 * (`view-set.mjs`), so a sweep that assumed one seed would run the refinery
	 * framing against a station that is not there. The declaration is what lets
	 * the runner group by seed instead.
	 */
	test("the pad framing declares the seed that has a refinery", () => {
		expect(OCCLUSION_FRAMINGS.refineryCradle.seed).toBe(2);
		expect(OCCLUSION_FRAMINGS.berth.seed).toBeUndefined();
	});

	test("a flight framing carries its view and a placement", () => {
		const f = flightFraming("planet-4", 8, "cockpit");
		expect(f.view).toBe("cockpit");
		expect(typeof f.place).toBe("function");
	});
});
