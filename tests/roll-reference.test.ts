/**
 * **Which zero does a roll get measured from?** (#157, #158)
 *
 * Two implementations answered that differently for as long as both existed,
 * and neither was wrong on its own terms. `evaluateEntry`'s check 4 measured
 * `|dot(shipUp, basis.across)|`, so its perfect roll stood a ship's *up-vector*
 * along the slot's 120 m side; `tests/aperture-fit.test.ts` sizes the opening
 * with the hull's *beam* along that same side. Transposed, and the aperture's
 * size cannot tell them apart — both clear a 120 x 70 m slot at the 50° limit,
 * so every non-capital hull is admitted either way and no row in the repo went
 * red. `docking.md` §3 carries the measured margins; a second copy here would
 * drift the day the roster moves.
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

/** The extent a hull needs along one slot axis, metres — the beam and the
 *  height each projected onto it. The four calls below differ only in which
 *  axis and which envelope, which is what made the inline form hard to compare
 *  against its siblings. */
const extentAlong = (
	beam: Vec3,
	shipUp: Vec3,
	axis: Vec3,
	env: { across: number; up: number },
): number =>
	alignment(beam, axis) * env.across + alignment(shipUp, axis) * env.up;

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
 * The centre of the band where a score reads exactly zero.
 *
 * **`evaluateEntry`'s `rollAngleDeg` has a plateau, so a minimum search cannot
 * find its zero.** That angle reaches a caller through `cosToDeg` — an `acos` of
 * a clamped cosine, worst-conditioned exactly at 1 — so the check reports 0.0
 * across a band measured at 2.94e-6°, about one ulp of the cosine near 1. A
 * search for the minimum stops improving at whichever edge it reaches first, and
 * refining it further changes nothing.
 *
 * Hence ternary search into the band, then bisection out to each of its sharp
 * edges. Four earlier versions of this looked right and were not; node #158's
 * receipt records which and why.
 */
function zeroBandCentre(scoreAt: (deg: number) => number): number {
	let coarse = -180;
	let best = Number.POSITIVE_INFINITY;
	// Well conditioned everywhere but the band, so one degree brackets it.
	for (let deg = -180; deg <= 180; deg += 1) {
		const score = scoreAt(deg);
		if (score < best) {
			best = score;
			coarse = deg;
		}
	}

	let lo = coarse - 1;
	let hi = coarse + 1;
	// Each pass keeps two thirds, so the interval falls below 1e-9° in about
	// fifty — three orders inside the band, and stopped there deliberately.
	// Run to float collapse instead and `a` and `b` meet: the comparison then
	// reads `false` forever and the interval walks off to one side, which is
	// how this first came back with a score of 1.2e-6 instead of zero.
	for (let i = 0; i < 200 && hi - lo > 1e-9; i++) {
		const a = lo + (hi - lo) / 3;
		const b = hi - (hi - lo) / 3;
		if (scoreAt(a) < scoreAt(b)) hi = b;
		else lo = a;
	}
	const inside = (lo + hi) / 2;
	expect(scoreAt(inside)).toBe(0);

	/** One sharp edge of the band, bisected between a point in and one out. */
	const edge = (out: number): number => {
		let within = inside;
		let beyond = out;
		for (let i = 0; i < 80; i++) {
			const mid = (within + beyond) / 2;
			if (scoreAt(mid) === 0) within = mid;
			else beyond = mid;
		}
		return within;
	};
	const low = edge(inside - 1);
	const high = edge(inside + 1);
	// Real and narrow: wide enough that a minimum search lands anywhere in it,
	// far too narrow to be a second zero. **Measured at 2.94e-6°**, which is a
	// property of float64 and `acos` rather than a number this repo chose — so
	// the check is a band and not a pinned figure.
	expect(high - low).toBeGreaterThan(0);
	expect(high - low).toBeLessThan(1e-4);
	return (low + high) / 2;
}

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
	// **The sweep's origin is off the basis by 0.37°**, so the answer does not
	// sit on an integer degree. Parameterised from `across` exactly, check 4's
	// zero lands on 90.000°, and a grid search returns it correct with a
	// residual of zero — indistinguishable from a search that works, which is
	// how three earlier versions of `zeroBandCentre` looked right.
	//
	// It is a tripwire and not a load-bearing constant: the search reaches the
	// zero by narrowing rather than by sampling, and passes at offsets of 0,
	// 0.123456, 0.37005 and 7.919 alike. Any other non-integer would do.
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

	const centre = zeroBandCentre(scoreAt);
	return { nose, up: atDeg(centre) };
}

describe("check 4's zero and the aperture-fit measurement agree (#157)", () => {
	test("the pose check 4 calls a perfect roll puts the hull's beam along the slot's long side", () => {
		const frame = frameFor();
		const basis = slotBasis(frame);
		// **That `across` is the long side is assumed here, not asserted — and no
		// headless row can assert it.** `slotBasis` returns two unit vectors and
		// nothing in the sim labels either "long": swap the two keys in it and
		// every consumer swaps with them, so this file, `dockingTunnel` and the
		// checks stay green together. An earlier version of this comment claimed
		// the row below caught that re-key; it does not, and the claim was
		// tested and withdrawn.
		//
		// The binding is a **renderer** fact — `station-mesh.ts` draws the mouth
		// as `BoxGeometry(widthKm, heightKm, …)` and `main.ts` puts that local X
		// on the phase-zero `across` — and it is checked in the browser tier, by
		// `probe-dock-arrival.mjs`'s row that holds the drawn slot to `slotBasis`
		// within 0.1°. That probe and these rows are the two halves: it fixes
		// which direction `across` points, and these fix where the beam goes
		// relative to it.
		//
		// What the aperture table *can* say is that the two dimensions differ, so
		// "long" and "short" name something at all.
		expect(frame.aperture.widthKm).toBeGreaterThan(frame.aperture.heightKm);
		const { nose, up } = checkFourZero(frame);
		const beam = beamAxis(nose, up);
		// The whole disagreement in one row. Pre-#158 this read 0.000 against
		// `across` and 1.000 against `up`: the ship on its side.
		expect(alignment(beam, basis.across)).toBeCloseTo(1, 6);
		expect(alignment(beam, basis.up)).toBeCloseTo(0, 6);
	});

	test("the extent the aperture's width must admit is the beam, which is what the fit test sizes it from", () => {
		// **The tie to `aperture-fit.test.ts`, and what carries it.** Both files
		// read `tests/helpers/rolled-envelope.ts`, so the beam is named as the
		// `across` term in one place rather than derived twice.
		//
		// Be precise about which assertion below does the discriminating,
		// because it is not the obvious one. The `extentAlong` rows compute an
		// extent *from* `flat` and compare it *to* `flat`, so a transposition
		// inside the helper flips both sides together and they pass either way —
		// they check that the pose decomposes onto the basis, not which
		// dimension is which. **The shape floors are the guard**: with the beam
		// on `across` (row 1) and `flat.across` measured at 4.4x `flat.up`, a
		// helper that handed back height as its `across` term fails them. That
		// is the whole discrimination, and the earlier version of this comment
		// claimed it came from somewhere else.
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
		// The Kestrel is 4.4x wider than it is tall (51.20 / 11.65 m). Floored
		// at 3 rather than pinned at 4.4 because a hull edit may move it — but
		// floored well above 1, because this is the row that discriminates and a
		// floor near 1 would stop doing so.
		expect(flat.across / flat.up).toBeGreaterThan(3);

		expect(extentAlong(beam, orth.up, basis.across, flat)).toBeCloseTo(
			flat.across,
			6,
		);
		expect(extentAlong(beam, orth.up, basis.up, flat)).toBeCloseTo(flat.up, 6);

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
		// Four decimals, not six: the pose comes from a zero this file measures
		// as a 2.94e-6° band, and at 50° that slack maps to a few 1e-7 m of
		// extent — within a 5e-7 m tolerance today and not for a larger hull.
		// Still four orders below the 0.6 m the row discriminates.
		expect(extentAlong(limitBeam, atLimit.up, basis.across, flat)).toBeCloseTo(
			rolled.across,
			4,
		);
		expect(extentAlong(limitBeam, atLimit.up, basis.up, flat)).toBeCloseTo(
			rolled.up,
			4,
		);
		expect(rolled.up / flat.up).toBeGreaterThan(3);
		expect(rolled.across).toBeLessThan(flat.across);
		// The whole point of measuring at the limit rather than at zero: the `up`
		// term takes a share of the beam and grows 4.0x on this hull (11.65 to
		// 46.71 m), while
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
			previousPhase: "idle",
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
		// `signedRollDeg` has no consumer outside `docking.ts` and
		// `docking-director.ts` — the roll ticks went with #94's corridor. Left
		// on the old reference it would report 90° for the pose the check calls
		// perfect, which is a correct number under a convention the repo no
		// longer holds. This is the agreement row: it goes red if check 4 moves
		// and the diagnostic does not.
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
		const law = beginLaunch(frame, interior, interior.berths[0], 0, 0);
		const settled = arrivalAttitude(law, 1, frame.phaseRad);
		const beam = beamAxis(settled.nose, settled.up);
		expect(alignment(beam, basis.across)).toBeCloseTo(1, 6);
	});
});
