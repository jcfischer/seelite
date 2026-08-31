/**
 * **Which zero does a roll get measured from?** (#157, #158)
 *
 * Two implementations answered that differently for as long as both existed,
 * and neither was wrong on its own terms. `evaluateEntry`'s check 4 measured
 * `|dot(shipUp, basis.across)|`, so its perfect roll stood a ship's *up-vector*
 * along the slot's 120 m side; `tests/aperture-fit.test.ts` sizes the opening
 * with the hull's *beam* along that same side. Transposed, and the aperture's
 * size cannot tell them apart: at the 50° limit the correct reading needs
 * 62.8 m across and 63.4 m up against a 120 x 70 m slot, and transposing it
 * needs 63.4 and 62.8 — both clear, so every non-capital hull is admitted
 * either way and no row in the repo went red.
 *
 * They disagreed because **nothing here compared a ship pose with a slot.**
 * `probe-dock-arrival.mjs` compares the drawn slot with `slotBasis` — mesh
 * against basis, which is the axis question. The fit test compares hulls with
 * an opening and never builds a pose. Each half was separately checked and the
 * seam between them was not, which is the shape this file exists to close.
 *
 * #157 ratified the fit test's zero: **a ship's beam lies along the slot's long
 * side.** So every row below asks the same question of a different consumer —
 * *given the pose your convention calls perfect, where does the hull's beam
 * point?* — and the answer is `across` or the row is red.
 *
 * The rows read the shipped code rather than restating a convention, for
 * `docking-director.test.ts`'s reason: a check derived from the thing it checks
 * passes under both answers. These were run against the pre-#158 tree and four
 * of the five were red there.
 */

import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import {
	type ApertureFrame,
	type EntryPose,
	ROLL_TOLERANCE_DEG,
	V_GATE_KMS,
	apertureFrame,
	dockingComputerStep,
	evaluateEntry,
	newDockingState,
	orthonormalise,
	signedRollDeg,
	slotBasis,
} from "../src/docking";
import { arrivalAttitude, beginLaunch } from "../src/arrival";
import { ASSIST_CAP_KMS } from "../src/sim";
import { rolledEnvelope } from "./helpers/rolled-envelope";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { type Vec3, add, cross, dot, length, scale, v3 } from "../src/vec3";

/** Awkward on purpose, for `docking.test.ts`'s reason: on a world axis a
 *  transposition can hide behind coordinates that happen to agree. */
const AXIS = ((): Vec3 => {
	const a = v3(0.37, -0.82, 0.44);
	return scale(a, 1 / length(a));
})();

const REFERENCE = ((): Vec3 => {
	const p = cross(AXIS, v3(0, 0, 1));
	return scale(p, 1 / length(p));
})();

/** A phase that is not zero and not a right angle, so a row cannot pass by
 *  `across` and `up` happening to coincide with the reference. */
const frameFor = (phaseRad = 0.7): ApertureFrame =>
	apertureFrame("trade", AXIS, phaseRad, REFERENCE);

/**
 * The ship's **beam axis** for an attitude — its local +X, which is the
 * `size.x` `aperture-fit.test.ts` calls `w`.
 *
 * `Ship.setAttitude` builds `right = cross(nose, up)` and makes that the mesh's
 * local X (`main.ts`), so this is the renderer's own law rather than a second
 * spelling of it. Taken through `orthonormalise` for the same reason it is
 * there: two directions are not an attitude until they are perpendicular.
 */
function beamAxis(nose: Vec3, up: Vec3): Vec3 {
	const basis = orthonormalise(nose, up);
	if (!basis)
		throw new Error("degenerate attitude — the row cannot mean anything");
	return cross(basis.nose, basis.up);
}

/** How square a direction is with another, as `|cos|` — a slot is symmetric
 *  through 180°, so `across` and `−across` are the same answer. */
const alignment = (a: Vec3, b: Vec3): number => Math.abs(dot(a, b));

/** Rotate a direction about an axis by `deg` — Rodrigues, spelled out because
 *  `vec3.ts` is a leaf and this is the only file that wanted it. */
function rotateAbout(v: Vec3, axis: Vec3, deg: number): Vec3 {
	const rad = (deg * Math.PI) / 180;
	const k = scale(axis, 1 / length(axis));
	const kv = cross(k, v);
	return add(
		add(scale(v, Math.cos(rad)), scale(kv, Math.sin(rad))),
		scale(k, dot(k, v) * (1 - Math.cos(rad))),
	);
}

/** An entry pose at the plane, nominal but for its attitude — the sibling
 *  files' `nominal(frame, over)`, narrowed to the one thing these rows vary. */
const poseAt = (
	frame: ApertureFrame,
	nose: Vec3,
	up: Vec3,
	standoffKm = 0,
): EntryPose => ({
	rel: scale(frame.axis, frame.planeKm + standoffKm),
	vRel: scale(frame.axis, -V_GATE_KMS / 2),
	nose,
	up,
});

/**
 * The roll that check 4 scores as perfect, found by **searching the shipped
 * check** rather than by constructing it from the convention.
 *
 * A constructed pose would be this file agreeing with itself: it would move
 * with any edit to check 4 and never go red. Sweeping the whole turn and taking
 * the best-scoring pose asks `evaluateEntry` where its own zero is.
 */
function checkFourZero(frame: ApertureFrame): { nose: Vec3; up: Vec3 } {
	const basis = slotBasis(frame);
	const nose = scale(frame.axis, -1);
	// **The sweep's origin is deliberately off the basis by 0.37°**, so the
	// answer does not sit on an integer degree. Parameterised from `across`
	// exactly, check 4's zero lands at 90.000°, and a search that only ever
	// evaluates integer degrees would return it correct with a residual of
	// zero — indistinguishable from a search that works. Both earlier versions
	// of the loop below passed on exactly that coincidence. Offset, the zero is
	// at 89.63° and only a search that actually refines can reach it.
	const ORIGIN_OFFSET_DEG = 0.37;
	const atDeg = (deg: number): Vec3 => {
		const rad = ((deg + ORIGIN_OFFSET_DEG) * Math.PI) / 180;
		return add(
			scale(basis.across, Math.cos(rad)),
			scale(basis.up, Math.sin(rad)),
		);
	};
	const scoreAt = (deg: number): number =>
		Math.abs(
			evaluateEntry(frame, poseAt(frame, nose, atDeg(deg)), { hostile: false })
				.rollAngleDeg,
		);

	// **Coarse sweep to the zero plateau, then bisect to its two edges and take
	// the midpoint.** Three earlier versions searched for a minimum, and all
	// three were wrong in the same way, which is what the plateau explains:
	//
	// `rollAngleDeg` reaches the caller through `cosToDeg`, an `acos` of a
	// clamped cosine — and `acos` near 1 is the worst-conditioned place in the
	// function. `evaluateEntry` reports **exactly 0.0** across a band about
	// 1e-3° wide, so "minimise the reported angle" stops improving the instant
	// the search enters that band and hands back whichever edge it reached
	// first. No refinement fixes it: measured, the residual is 0.000e+0 at
	// twelve passes and at sixteen alike, and the pose is still up to 1e-3°
	// out — enough to move a hull extent by 1e-6 m, which is what the rows
	// below were failing on once the origin came off the integer grid.
	//
	// The band's *edges* are sharp, so bisecting to each and taking the middle
	// locates the zero to float precision — and it does it by reading the
	// shipped check, which is the property that matters here. `docking.ts` says
	// the degrees are "a **diagnostic**, never a comparison"; this is what that
	// costs a consumer that has to invert it.
	const isZero = (deg: number): boolean => scoreAt(deg) === 0;
	// Coarse pass on the reported angle, which is well conditioned everywhere
	// except the band itself — one degree is plenty to bracket a zero the check
	// reports as tens of degrees away on either side.
	let coarse = -180;
	let bestDeg = Number.POSITIVE_INFINITY;
	for (let deg = -180; deg <= 180; deg += 1) {
		const score = scoreAt(deg);
		if (score < bestDeg) {
			bestDeg = score;
			coarse = deg;
		}
	}
	// Then a fine scan for a point actually inside the band. The band is about
	// 1e-3° wide and the coarse pass lands within half a degree of it, so the
	// step has to be finer than the band by enough to be sure of hitting it.
	let inside = Number.NaN;
	for (let deg = coarse - 0.5; deg <= coarse + 0.5; deg += 1e-4)
		if (isZero(deg)) {
			inside = deg;
			break;
		}
	expect(Number.isNaN(inside)).toBe(false);
	/** The edge of the zero band, bisected between a point inside and one out. */
	const edge = (out: number): number => {
		let lo = inside;
		let hi = out;
		for (let i = 0; i < 60; i++) {
			const mid = (lo + hi) / 2;
			if (isZero(mid)) lo = mid;
			else hi = mid;
		}
		return lo;
	};
	const centre = (edge(inside - 1) + edge(inside + 1)) / 2;
	// The band is real and narrow: wide enough that a minimum-search lands
	// anywhere in it, far too narrow to be a second zero.
	const width = edge(inside + 1) - edge(inside - 1);
	expect(width).toBeGreaterThan(0);
	expect(width).toBeLessThan(0.01);
	return { nose, up: atDeg(centre) };
}

describe("check 4's zero and the aperture-fit measurement agree (#157)", () => {
	test("the pose check 4 calls a perfect roll puts the hull's beam along the slot's long side", () => {
		const frame = frameFor();
		const basis = slotBasis(frame);
		// **`across` is the long side, asserted rather than assumed.** The row's
		// title says "long", and without this it would only say "`across`" — it
		// would stay green if the basis were ever re-keyed so that `across` ran
		// along the short side, which is a transposition of exactly the class
		// this file exists to catch. `station-mesh.ts` draws the mouth as
		// `BoxGeometry(widthKm, heightKm, …)` on a local X that `main.ts` puts on
		// the phase-zero `across`, so this is the tie to what is drawn.
		expect(frame.aperture.widthKm).toBeGreaterThan(frame.aperture.heightKm);
		const { nose, up } = checkFourZero(frame);
		const beam = beamAxis(nose, up);
		// The whole disagreement in one row. Pre-#158 this read 0.000 against
		// `across` and 1.000 against `up`: the ship on its side.
		expect(alignment(beam, basis.across)).toBeCloseTo(1, 6);
		expect(alignment(beam, basis.up)).toBeCloseTo(0, 6);
	});

	test("the extent the aperture's width must admit is the beam, which is what the fit test sizes it from", () => {
		// **The tie to `aperture-fit.test.ts`, through the code it actually
		// uses.** An earlier version re-derived `w·cos θ + h·sin θ` here from a
		// mesh box, which left the seam one-sided: swapping `size.x` for
		// `size.y` in the fit test would have re-transposed the pair and this
		// row would have stayed green. Both files read
		// `tests/helpers/rolled-envelope.ts` now, so the beam is named as the
		// `across` term in one place and this row is checking that place.
		const frame = frameFor();
		const basis = slotBasis(frame);
		const { nose, up } = checkFourZero(frame);
		const orth = orthonormalise(nose, up);
		if (!orth) throw new Error("degenerate attitude");
		const beam = cross(orth.nose, orth.up);

		// At zero roll the envelope collapses to the hull's own two dimensions:
		// `across` is the beam and `up` is the height, which is the convention
		// under test stated in the fit test's own units.
		// One named variant, so the arithmetic below is exact: the helper maxes
		// each term over variants independently, and the widest hull need not be
		// the tallest.
		const flat = rolledEnvelope("courier", 0, "a");
		// The Kestrel is 4.4x wider than it is tall, so the two readings are far
		// apart and no tolerance can straddle them. Floored rather than pinned:
		// what the row needs is the separation, and a hull edit may move it.
		expect(flat.across / flat.up).toBeGreaterThan(3);

		const needAcrossM =
			alignment(beam, basis.across) * flat.across +
			alignment(orth.up, basis.across) * flat.up;
		const needUpM =
			alignment(beam, basis.up) * flat.across +
			alignment(orth.up, basis.up) * flat.up;
		expect(needAcrossM).toBeCloseTo(flat.across, 6);
		expect(needUpM).toBeCloseTo(flat.up, 6);

		// **And at the roll limit, where the fit test actually reads it.** At
		// zero roll the envelope hands back `(w, h)` unchanged, so the two
		// assertions above reduce to the previous row plus the ratio floor —
		// the `w·cos θ + h·sin θ` arithmetic that sizes the aperture never
		// enters. Rolling the pose to check 4's tolerance and measuring the
		// same extents is where the fit test's formula and the check's zero
		// meet, and it is the comparison `docking.md` §3 names.
		const atLimit = orthonormalise(
			nose,
			rotateAbout(up, frame.axis, ROLL_TOLERANCE_DEG),
		);
		if (!atLimit) throw new Error("degenerate attitude at the roll limit");
		const limitBeam = cross(atLimit.nose, atLimit.up);
		const rolled = rolledEnvelope(
			"courier",
			(ROLL_TOLERANCE_DEG * Math.PI) / 180,
			"a",
		);
		expect(
			alignment(limitBeam, basis.across) * flat.across +
				alignment(atLimit.up, basis.across) * flat.up,
		).toBeCloseTo(rolled.across, 6);
		expect(
			alignment(limitBeam, basis.up) * flat.across +
				alignment(atLimit.up, basis.up) * flat.up,
		).toBeCloseTo(rolled.up, 6);
		expect(rolled.up / flat.up).toBeGreaterThan(3);
		expect(rolled.across).toBeLessThan(flat.across);
		// The whole point of measuring at the limit rather than at zero: the `up`
		// term takes a share of the beam and grows by 3.5x on this hull, while
		// the `across` term *shrinks* — a flat hull rolled presents less width
		// and much more height. `aperture-fit.test.ts`'s "both are larger than
		// either" holds for a near-square hull and not for this one, which is
		// why the roster's tightest margin lands on the slot's height.
	});

	test("the docking computer flies at the pose the check accepts", () => {
		// It aims the ship at a roll of its own, and a computer aimed at the
		// convention the check refuses is the defect a player flies: #157 was
		// reported as a ship entering the slot at 90°.
		const frame = frameFor();
		const basis = slotBasis(frame);
		// **Seeded 30° out, not at the answer.** With `basis.up` as the input the
		// row passed under a computer that dropped its slot branch entirely and
		// handed `pose.up` straight back — the input already satisfied the
		// assertion, so only the re-aim is under test here.
		const misrolled = rotateAbout(basis.up, frame.axis, 30);
		const aimed = dockingComputerStep({
			frame,
			pose: poseAt(frame, scale(frame.axis, -1), misrolled, 2),
			state: {
				...newDockingState(),
				clearance: { kind: "granted", expiresAtS: 600 },
			},
			gameTime: 0,
			maxSpeedKms: ASSIST_CAP_KMS,
		});
		expect(aimed.engaged).toBe(true);
		// The control: the pose handed in does *not* satisfy the assertion, so a
		// pass is the computer's own work.
		expect(
			alignment(beamAxis(scale(frame.axis, -1), misrolled), basis.across),
		).toBeLessThan(0.9);
		const beam = beamAxis(aimed.nose, aimed.up);
		expect(alignment(beam, basis.across)).toBeCloseTo(1, 6);
	});

	test("the HUD's signed cue reads zero at exactly the pose check 4 accepts", () => {
		// `signedRollDeg` is display only and no check reads it — but the roll
		// ring sends the pilot toward its zero, so a cue left on the old
		// reference would aim at the pose the corrected check refuses. This is
		// the agreement row: it goes red if check 4 moves and the cue does not.
		const frame = frameFor();
		const { nose, up } = checkFourZero(frame);
		expect(signedRollDeg(frame, poseAt(frame, nose, up))).toBeCloseTo(0, 4);
	});

	test("a launch settles onto the reference the check measures", () => {
		// The other end of the traversal. `arrivalAttitude` ends a launch square
		// with the slot, and "square" has to mean the same thing there as it
		// does at the plane, or a ship leaves in a pose it could not have
		// arrived in.
		const frame = frameFor();
		const basis = slotBasis(frame);
		const interior = stationInterior(
			"trade",
			STATION_GEOMETRY.trade.aperturePlaneKm,
			3,
		);
		const law = beginLaunch(frame, interior, interior.berths[0], 0);
		const settled = arrivalAttitude(law, 1, frame.phaseRad);
		const beam = beamAxis(settled.nose, settled.up);
		expect(alignment(beam, basis.across)).toBeCloseTo(1, 6);
	});
});
