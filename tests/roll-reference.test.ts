/**
 * **Which zero does a roll get measured from?** (#157, #158)
 *
 * Two implementations answered that differently for as long as both existed,
 * and neither was wrong on its own terms. `evaluateEntry`'s check 4 measured
 * `|dot(shipUp, basis.across)|`, so its perfect roll stood a ship's *up-vector*
 * along the slot's 120 m side; `tests/aperture-fit.test.ts` sizes the opening
 * with the hull's *beam* along that same side. Transposed, and the aperture's
 * size cannot tell them apart — at the 50° limit the binding figure is 62.8 m
 * against 63.4 m, so both conventions admit every non-capital hull and no row
 * in the repo went red.
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
import { buildShipMesh } from "../src/ship-mesh";
import { STATION_GEOMETRY } from "../src/station";
import { stationInterior } from "../src/station-interior";
import { type Vec3, cross, dot, length, scale, sub, v3 } from "../src/vec3";

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
	let best = { up: basis.across, deg: Number.POSITIVE_INFINITY };
	for (let deg = 0; deg < 180; deg += 0.01) {
		const rad = (deg * Math.PI) / 180;
		const up = {
			x: basis.across.x * Math.cos(rad) + basis.up.x * Math.sin(rad),
			y: basis.across.y * Math.cos(rad) + basis.up.y * Math.sin(rad),
			z: basis.across.z * Math.cos(rad) + basis.up.z * Math.sin(rad),
		};
		const pose: EntryPose = {
			rel: scale(frame.axis, frame.planeKm),
			vRel: scale(frame.axis, -V_GATE_KMS / 2),
			nose,
			up,
		};
		const rolled = Math.abs(
			evaluateEntry(frame, pose, { hostile: false }).rollAngleDeg,
		);
		if (rolled < best.deg) best = { up, deg: rolled };
	}
	expect(best.deg).toBeLessThan(0.01);
	return { nose, up: best.up };
}

describe("check 4's zero and the aperture-fit measurement agree (#157)", () => {
	test("the pose check 4 calls a perfect roll puts the hull's beam along the slot's long side", () => {
		const frame = frameFor();
		const basis = slotBasis(frame);
		const { nose, up } = checkFourZero(frame);
		const beam = beamAxis(nose, up);
		// The whole disagreement in one row. Pre-#158 this read 0.000 against
		// `across` and 1.000 against `up`: the ship on its side.
		expect(alignment(beam, basis.across)).toBeCloseTo(1, 6);
		expect(alignment(beam, basis.up)).toBeCloseTo(0, 6);
	});

	test("the extent the aperture's width must admit is the beam, which is what the fit test sizes it from", () => {
		// The tie to `aperture-fit.test.ts`, in the units that test works in.
		// It compares `w·cos θ + h·sin θ` against the aperture's **width**, with
		// `w` the hull's beam — so at zero roll the width must be admitting the
		// beam and the height the hull's height. Measured off a real mesh rather
		// than a chosen pair of numbers, because a transposition is invisible in
		// a hull that is square.
		const frame = frameFor();
		const basis = slotBasis(frame);
		const { nose, up } = checkFourZero(frame);
		const orth = orthonormalise(nose, up);
		if (!orth) throw new Error("degenerate attitude");
		const beam = cross(orth.nose, orth.up);

		const root = buildShipMesh("courier", "a").root;
		root.updateMatrixWorld(true);
		const size = new THREE.Box3()
			.setFromObject(root)
			.getSize(new THREE.Vector3());
		const beamM = size.x * 1000;
		const heightM = size.y * 1000;
		// A courier is 4.4x wider than it is tall, so the two readings are far
		// apart and no tolerance can straddle them.
		expect(beamM / heightM).toBeGreaterThan(3);

		const needAcrossM =
			alignment(beam, basis.across) * beamM +
			alignment(orth.up, basis.across) * heightM;
		const needUpM =
			alignment(beam, basis.up) * beamM +
			alignment(orth.up, basis.up) * heightM;
		expect(needAcrossM).toBeCloseTo(beamM, 6);
		expect(needUpM).toBeCloseTo(heightM, 6);
	});

	test("the docking computer flies at the pose the check accepts", () => {
		// It aims the ship at a roll of its own, and a computer aimed at the
		// convention the check refuses is the defect a player flies: #157 was
		// reported as a ship entering the slot at 90°.
		const frame = frameFor();
		const basis = slotBasis(frame);
		const aimed = dockingComputerStep({
			frame,
			pose: {
				rel: scale(frame.axis, frame.planeKm + 2),
				vRel: scale(frame.axis, -V_GATE_KMS / 2),
				nose: scale(frame.axis, -1),
				up: basis.up,
			},
			state: {
				...newDockingState(),
				clearance: { kind: "granted", expiresAtS: 600 },
			},
			gameTime: 0,
			maxSpeedKms: ASSIST_CAP_KMS,
		});
		expect(aimed.engaged).toBe(true);
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
		expect(
			signedRollDeg(frame, {
				rel: scale(frame.axis, frame.planeKm),
				vRel: scale(frame.axis, -V_GATE_KMS / 2),
				nose,
				up,
			}),
		).toBeCloseTo(0, 4);
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
