/**
 * How hard the drive and the thrusters work in one step (#544): what the
 * flight sound's `thrust` arm hears. Since #619 it is read off the step's
 * firing table (`flight-model.md` §4), so a ship holding its speed is a silent
 * drive because no vent fired, not because a second law said so.
 */
import { expect, test } from "bun:test";
import {
	ASSIST_CAP_KMS,
	type Angular,
	type FlightControl,
	NO_ATTITUDE,
	flightPerformance,
	speedDemand,
	stepAngular,
	stepFlight,
	thrustShares,
} from "../src/sim";
import { type Vec3, v3 } from "../src/vec3";

const perf = flightPerformance("courier");
const nose = v3(0, 0, -1);
const up = v3(0, 1, 0);
const dt = 1 / 60;
const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };

const control = (over: Partial<FlightControl> = {}): FlightControl => ({
	nose,
	up,
	demand: speedDemand(0),
	assist: true,
	attitude: NO_ATTITUDE,
	...over,
});
/** The shares of one step flown from `vel`. */
const sharesOf = (vel: Vec3, over: Partial<FlightControl> = {}) =>
	thrustShares(
		stepFlight({ pos: v3(), vel }, control(over), dt, perf).firing,
		perf,
	);

test("assist on: accelerating is full drive, holding speed is none", () => {
	const full = { demand: speedDemand(1) };
	expect(sharesOf(v3(), full).main).toBe(1);
	expect(sharesOf(v3(0, 0, -ASSIST_CAP_KMS), full).main).toBe(0);
	// Braking fires the retro pair as hard as accelerating fires the drive.
	expect(sharesOf(v3(0, 0, -ASSIST_CAP_KMS)).main).toBe(1);
	// The last sliver before the setpoint is a share, not all or nothing.
	const near = ASSIST_CAP_KMS - 0.5 * perf.thrustKms2 * dt;
	expect(sharesOf(v3(0, 0, -near), full).main).toBeCloseTo(0.5, 9);
});

test("assist on: removing drift is the translation pairs' work", () => {
	expect(sharesOf(v3()).lateral).toBe(0);
	const drifting = sharesOf(v3(1, 0, 0));
	expect(drifting.lateral).toBeGreaterThan(0);
	expect(drifting.lateral).toBeLessThanOrEqual(1);
});

test("assist off: the drive is the lever, and no one removes drift", () => {
	const s = sharesOf(v3(1, 0, -2), { assist: false, demand: speedDemand(0.4) });
	expect(s.main).toBe(0.4);
	expect(s.lateral).toBe(0);
});

test("the frame is what the drive works against", () => {
	// Holding speed in a moving frame is still holding speed.
	const frameVel = v3(30, 0, 0);
	const s = sharesOf(v3(30, 0, -ASSIST_CAP_KMS), {
		demand: speedDemand(1),
		frame: { start: frameVel, end: frameVel },
	});
	expect(s.main).toBe(0);
	expect(s.lateral).toBe(0);
});

test("rotation: the attitude vents' level", () => {
	const rotation = (rates: Angular, stick: Angular, impulse = STILL) =>
		thrustShares(
			stepAngular(rates, stick, impulse, true, dt, perf).firing,
			perf,
		).rotation;
	expect(rotation(STILL, STILL)).toBe(0);
	expect(rotation(STILL, { pitch: 1, yaw: 0, roll: 0 })).toBe(1);
	// A steady turn at the commanded rate fires nothing; a pointer kick past
	// the couple's authority fires it at full.
	const steady = { pitch: perf.angularMax.pitch, yaw: 0, roll: 0 };
	expect(rotation(steady, { pitch: 1, yaw: 0, roll: 0 })).toBe(0);
	expect(rotation(STILL, STILL, { pitch: 0, yaw: 0.5, roll: 0 })).toBe(1);
	expect(
		thrustShares(stepAngular(STILL, STILL, STILL, true, 0, perf).firing, perf)
			.rotation,
	).toBe(0);
});

test("the shares are the change each step applied", () => {
	// Sage round 1 on #544: a share restated beside the law could leave the
	// drive sound out of step with flight. It is the firing now, and this
	// holds the firing to the change the step actually made.
	const cases: { vel: Vec3; throttle: number; assist: boolean }[] = [
		{ vel: v3(), throttle: 1, assist: true },
		{ vel: v3(0, 0, -ASSIST_CAP_KMS), throttle: 0.5, assist: true },
		{ vel: v3(0, 0, -1.99), throttle: 1, assist: true },
		{
			vel: v3(0, 0, -(ASSIST_CAP_KMS - 0.5 * perf.thrustKms2 * dt)),
			throttle: 1,
			assist: true,
		},
		{ vel: v3(0.8, 0, -0.5), throttle: 0.5, assist: true },
		{ vel: v3(0.2, 0, -0.5), throttle: 0.25, assist: true },
		{ vel: v3(1, 0, -2), throttle: 0.4, assist: false },
	];
	for (const c of cases) {
		const ship = { pos: v3(), vel: { ...c.vel } };
		const step = stepFlight(
			ship,
			control({ demand: speedDemand(c.throttle), assist: c.assist }),
			dt,
			perf,
		);
		const shares = thrustShares(step.firing, perf);
		const along = -(ship.vel.z - c.vel.z);
		const authority = (along >= 0 ? perf.thrustKms2 : perf.retroKms2) * dt;
		expect(Math.abs(along) / authority).toBeCloseTo(shares.main, 9);
		const lateral = Math.max(
			Math.abs(ship.vel.x - c.vel.x),
			Math.abs(ship.vel.y - c.vel.y),
		);
		expect(lateral / (perf.strafeKms2 * dt)).toBeCloseTo(shares.lateral, 9);
	}
});
