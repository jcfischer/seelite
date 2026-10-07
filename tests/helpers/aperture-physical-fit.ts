/**
 * The aperture as a physical fit (`collision.md` §2.3, §9.1.9, P1): whether a
 * hull's box, flown in on the docking axis with its centre on it, reaches the
 * plane without meeting the station's proxy.
 *
 * One measurement for two callers: `tests/collision-stations.test.ts` asserts
 * the 0° rows, and `scripts/measure-aperture-fit.ts` prints the whole table for
 * the principal (§11, joint 2). It lives under `tests/helpers/` for the reason
 * `station-proxy-measure.ts` gives — the dependency points from the operator
 * tooling into the gated suite, never the other way.
 *
 * **What a centred entry is.** The station is held at one slot phase and the // glossary-ignore: slot
 * ship's roll is measured against that slot, which is what a pilot matching the // glossary-ignore: slot
 * spin flies: relative to the slot, nothing turns. The ship's centre runs down // glossary-ignore: slot
 * the axis from well outside the proxy to the plane, the instant §3's checks
 * run and the exemption begins (§5); past the plane it is not collidable, so a
 * fit is owed only up to it. Pitch turns the nose toward the slot's short side // glossary-ignore: slot
 * (about the ship's starboard axis), yaw toward its long side (about the ship's
 * up), and the roll is then taken about the docking axis, so it is the angle
 * check 4 reads.
 */

import { shipPose, type SolidMotion, sweepShip } from "../../src/collision";
import { apertureFrame, slotBasis } from "../../src/docking";
import type { HullId } from "../../src/hull";
import { hullSolid } from "./hull-solid";
import type { StationSeeds } from "./station-plan-corpus";
import type { StationType } from "../../src/station";
import { stationProxyOf, stationMotions } from "../../src/station-proxy";
import { type Vec3, cross, scale, v3 } from "../../src/vec3";
import {
	FIXTURE_AXIS,
	FIXTURE_REFERENCE,
	rotateAbout,
} from "./fly-the-computer";

export interface EntryAngles {
	pitchDeg: number;
	yawDeg: number;
	rollDeg: number;
}

/** How far out the run starts, beyond the plane: past every proxy's reach. */
const RUN_IN_KM = 2;
/** Sub-steps the run is swept in. The sweep cannot step over a primitive; this
 *  only keeps each sub-step's advances short of the resolver's cap. */
const SUB_STEPS = 40;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** The attitude a centred entry flies at these angles: nose and up. */
export function entryAttitude(
	type: StationType,
	angles: EntryAngles,
): { nose: Vec3; up: Vec3 } {
	const frame = apertureFrame(type, FIXTURE_AXIS, 0, FIXTURE_REFERENCE);
	const { up: slotUp } = slotBasis(frame);
	let nose = scale(frame.axis, -1);
	let up = slotUp;
	// Pitch about starboard, then yaw about the (pitched) up.
	const starboard = cross(nose, up);
	nose = rotateAbout(nose, starboard, rad(angles.pitchDeg));
	up = rotateAbout(up, starboard, rad(angles.pitchDeg));
	nose = rotateAbout(nose, up, rad(angles.yawDeg));
	// The roll about the docking axis: check 4's angle.
	nose = rotateAbout(nose, frame.axis, rad(angles.rollDeg));
	up = rotateAbout(up, frame.axis, rad(angles.rollDeg));
	return { nose, up };
}

/**
 * Whether the hull's box reaches the plane on the axis without meeting the
 * selected form's proxy: no impact on the way and no overlap at the start.
 */
export function clearsAperture(
	type: StationType,
	hull: HullId,
	angles: EntryAngles,
	seeds: StationSeeds,
): boolean {
	const frame = apertureFrame(type, FIXTURE_AXIS, 0, FIXTURE_REFERENCE);
	const proxy = stationProxyOf({ type, ...seeds });
	const still = { frame, origin: v3(), vel: v3() };
	const solids = stationMotions(proxy, still, still);
	const box = hullSolid(hull);
	const { nose, up } = entryAttitude(type, angles);
	const at = (k: number): Vec3 =>
		scale(frame.axis, frame.planeKm + RUN_IN_KM * (1 - k / SUB_STEPS));
	for (let k = 0; k < SUB_STEPS; k++) {
		const motion: SolidMotion = {
			primitives: box,
			start: shipPose(at(k), nose, up),
			end: shipPose(at(k + 1), nose, up),
			velStart: v3(),
			velEnd: v3(),
		};
		const swept = sweepShip(motion, solids, 1);
		if (swept.impacts.length > 0 || swept.ghosts.length > 0) return false;
	}
	return true;
}

/**
 * The largest angle, in `stepDeg` steps from zero, at which a centred entry
 * still clears — both signs, so the smaller side is the answer. `null` when
 * even zero does not clear. Capped at `maxDeg`: past check 2's 35° the entry
 * is refused at the plane whatever it fits.
 */
export function largestClearAngleDeg(
	type: StationType,
	hull: HullId,
	axis: "pitch" | "yaw",
	rollDeg: number,
	maxDeg: number,
	seeds: StationSeeds,
	stepDeg = 0.5,
): number | null {
	let best: number | null = null;
	for (let deg = 0; deg <= maxDeg + 1e-9; deg += stepDeg) {
		const fits = [deg, -deg].every((signed) =>
			clearsAperture(
				type,
				hull,
				{
					pitchDeg: axis === "pitch" ? signed : 0,
					yawDeg: axis === "yaw" ? signed : 0,
					rollDeg,
				},
				seeds,
			),
		);
		if (!fits) break;
		best = deg;
	}
	return best;
}
