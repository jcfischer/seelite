/**
 * How hard the drive and the thrusters work in one step (#544): what the
 * flight sound's `thrust` arm hears. Read off the same laws `stepFlight` and
 * `stepAngular` fly, so a ship holding its speed is a silent drive.
 */
import { expect, test } from "bun:test";
import {
	ASSIST_CAP_KMS,
	type FlightPerformance,
	rotationShare,
	thrustShares,
} from "../src/sim";

const perf: FlightPerformance = {
	thrustKms2: 0.2,
	assistLateralTauS: 1.5,
	angularMax: { pitch: 1, yaw: 1, roll: 1.5 },
	angularAccel: 2,
	angularDampTauS: 0.4,
};
const nose = { x: 0, y: 0, z: 1 };
const dt = 1 / 60;
const ship = (vel: { x: number; y: number; z: number }) => ({
	pos: { x: 0, y: 0, z: 0 },
	vel,
});

test("assist on: accelerating is full drive, holding speed is none", () => {
	const control = { nose, throttle: 1, assist: true };
	expect(thrustShares(ship({ x: 0, y: 0, z: 0 }), control, dt, perf).main).toBe(
		1,
	);
	expect(
		thrustShares(ship({ x: 0, y: 0, z: ASSIST_CAP_KMS }), control, dt, perf)
			.main,
	).toBe(0);
	// Braking fires the drive as hard as accelerating does.
	expect(
		thrustShares(
			ship({ x: 0, y: 0, z: ASSIST_CAP_KMS }),
			{ ...control, throttle: 0 },
			dt,
			perf,
		).main,
	).toBe(1);
	// The last sliver before the setpoint is a share, not all or nothing.
	const near = ASSIST_CAP_KMS - 0.5 * perf.thrustKms2 * dt;
	expect(
		thrustShares(ship({ x: 0, y: 0, z: near }), control, dt, perf).main,
	).toBeCloseTo(0.5, 9);
});

test("assist on: removing drift is the thrusters' work", () => {
	const control = { nose, throttle: 0, assist: true };
	expect(
		thrustShares(ship({ x: 0, y: 0, z: 0 }), control, dt, perf).lateral,
	).toBe(0);
	const drifting = thrustShares(ship({ x: 1, y: 0, z: 0 }), control, dt, perf);
	expect(drifting.lateral).toBeGreaterThan(0);
	expect(drifting.lateral).toBeLessThanOrEqual(1);
});

test("assist off: the drive is the lever, and no one removes drift", () => {
	const control = { nose, throttle: 0.4, assist: false };
	const s = thrustShares(ship({ x: 1, y: 0, z: 2 }), control, dt, perf);
	expect(s.main).toBe(0.4);
	expect(s.lateral).toBe(0);
});

test("the frame is what the drive works against", () => {
	// Holding speed in a moving frame is still holding speed.
	const frameVel = { x: 30, y: 0, z: 0 };
	const control = {
		nose,
		throttle: 1,
		assist: true,
		frame: { start: frameVel, end: frameVel },
	};
	const s = thrustShares(
		ship({ x: 30, y: 0, z: ASSIST_CAP_KMS }),
		control,
		dt,
		perf,
	);
	expect(s.main).toBe(0);
	expect(s.lateral).toBe(0);
});

test("rotation: the change of rate against full authority", () => {
	const still = { pitch: 0, yaw: 0, roll: 0 };
	expect(rotationShare(still, still, dt, perf)).toBe(0);
	const full = { pitch: perf.angularAccel * dt, yaw: 0, roll: 0 };
	expect(rotationShare(still, full, dt, perf)).toBeCloseTo(1, 9);
	// A steady turn fires nothing; a mouse kick past authority is clamped.
	expect(rotationShare(full, full, dt, perf)).toBe(0);
	expect(rotationShare(still, { pitch: 0, yaw: 0.5, roll: 0 }, dt, perf)).toBe(
		1,
	);
	expect(rotationShare(still, full, 0, perf)).toBe(0);
});
