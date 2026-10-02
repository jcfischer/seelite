/**
 * The control shape most rows in the suite were written in before #619: a
 * nose, a throttle and the assist. Every one of them asks for a speed along
 * the nose and turns no vent, so it is a `FlightControl` with a speed demand,
 * any up across the nose, and no attitude step.
 *
 * For rows about something other than the control — the clock, the frame law,
 * a reset — so they keep reading as what they test. Rows about the vents
 * themselves build a `FlightControl` in full (`tests/vents.test.ts`).
 */

import {
	type FlightControl,
	type FrameMotion,
	NO_ATTITUDE,
	speedDemand,
} from "../../src/sim";
import { type Vec3, cross, length, scale, v3 } from "../../src/vec3";

export interface SpeedControl {
	nose: Vec3;
	throttle: number;
	assist: boolean;
	frame?: FrameMotion;
}

/** A unit vector across `nose`: world up unless the nose lies along it. */
export const upAcross = (nose: Vec3): Vec3 => {
	const side = cross(nose, Math.abs(nose.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0));
	const up = cross(side, nose);
	return scale(up, 1 / length(up));
};

export const speedControl = (c: SpeedControl): FlightControl => ({
	nose: c.nose,
	up: upAcross(c.nose),
	demand: speedDemand(c.throttle),
	assist: c.assist,
	attitude: NO_ATTITUDE,
	frame: c.frame,
});
