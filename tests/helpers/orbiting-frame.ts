/**
 * The frame #529 was charted on, as a fixture: USBISO's shipyard (seed
 * 3852403550), low over a gas giant on a circular orbit, accelerating at the
 * 71.7 m/s² measured when the node was opened.
 *
 * One copy for every row that flies in it, so a re-measured orbit is one edit.
 */
import type { FrameMotion } from "../../src/sim";
import { type Vec3, v3 } from "../../src/vec3";

/** The orbit's radius, km: r/R ≈ 1.026 over a 38,762 km gas giant. */
export const ORBIT_KM = 39_770;
/** Its acceleration, km/s². */
export const ACCEL_KMS2 = 0.0717;
/** Its angular rate, rad/s, from `a = r·ω²`. */
export const OMEGA = Math.sqrt(ACCEL_KMS2 / ORBIT_KM);

/** Where the frame is at `t`, km. */
export const framePos = (t: number): Vec3 =>
	v3(ORBIT_KM * Math.cos(OMEGA * t), ORBIT_KM * Math.sin(OMEGA * t), 0);

/** Its velocity at `t`, km/s: the exact derivative of `framePos`. */
export const frameVel = (t: number): Vec3 =>
	v3(
		-ORBIT_KM * OMEGA * Math.sin(OMEGA * t),
		ORBIT_KM * OMEGA * Math.cos(OMEGA * t),
		0,
	);

/** The frame across one step from `t`, as a caller hands it to the step. */
export const frameOver = (t: number, dt: number): FrameMotion => ({
	start: frameVel(t),
	end: frameVel(t + dt),
});
