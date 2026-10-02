import { describe, expect, test } from "bun:test";
import {
	AttitudeFollower,
	type Attitude,
	attitudeError,
	attitudeStick,
	turnAttitude,
} from "../src/attitude-hold";
import { HULL_IDS } from "../src/hull";
import { type Angular, flightPerformance, stepAngular } from "../src/sim";
import { dot, length, v3 } from "../src/vec3";

const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };
const LEVEL: Attitude = { nose: v3(0, 0, -1), up: v3(0, 1, 0) };

/** Fly `from` onto `want` through the vents; return the attitude and the
 *  largest error left over the last second. */
function hold(
	from: Attitude,
	want: (t: number) => Attitude,
	id: (typeof HULL_IDS)[number],
	seconds: number,
	dt: number,
) {
	const perf = flightPerformance(id);
	let at = from;
	let rates = STILL;
	let worst = 0;
	for (let t = 0; t < seconds; t += dt) {
		const target = want(t);
		const step = stepAngular(
			rates,
			attitudeStick(at, target, perf, dt),
			STILL,
			true,
			dt,
			perf,
		);
		rates = step.rates;
		at = turnAttitude(at, rates, dt);
		if (t > seconds - 1)
			worst = Math.max(worst, length(attitudeError(at, want(t + dt))));
	}
	return { at, worst };
}

describe("holding an attitude through the vents (#619)", () => {
	test("the error of an attitude against itself is zero", () => {
		expect(length(attitudeError(LEVEL, LEVEL))).toBe(0);
	});

	test("a positive pitch rate turns the nose toward a pitched-up target", () => {
		const want = {
			nose: v3(0, Math.sin(0.3), -Math.cos(0.3)),
			up: v3(0, Math.cos(0.3), Math.sin(0.3)),
		};
		const stick = attitudeStick(
			LEVEL,
			want,
			flightPerformance("courier"),
			0.05,
		);
		expect(stick.pitch).toBeGreaterThan(0);
		const turned = turnAttitude(LEVEL, { pitch: 0.3, yaw: 0, roll: 0 }, 1);
		expect(dot(turned.nose, want.nose)).toBeCloseTo(1, 9);
	});

	test("a positive roll rate lays up toward a target rolled the same way", () => {
		const want = { nose: LEVEL.nose, up: v3(-Math.sin(0.4), Math.cos(0.4), 0) };
		const stick = attitudeStick(
			LEVEL,
			want,
			flightPerformance("courier"),
			0.05,
		);
		expect(stick.roll).toBeGreaterThan(0);
		const turned = turnAttitude(LEVEL, { pitch: 0, yaw: 0, roll: 0.4 }, 1);
		expect(dot(turned.up, want.up)).toBeCloseTo(1, 9);
	});

	for (const id of HULL_IDS)
		test(`${id} settles on a fixed attitude 120° away`, () => {
			const target = turnAttitude(
				LEVEL,
				{ pitch: 0.9, yaw: -1.2, roll: 1.5 },
				1,
			);
			const { worst } = hold(LEVEL, () => target, id, 90, 0.05);
			expect(worst).toBeLessThan(1e-6);
		});

	test("a follower asked for no nose at all keeps the hull's, and asks nothing", () => {
		const stick = new AttitudeFollower().stick(
			LEVEL,
			{ nose: v3(), up: v3(0, 1, 0) },
			flightPerformance("courier"),
			0.05,
		);
		expect(stick).toEqual({ pitch: 0, yaw: 0, roll: 0 });
	});

	test("a slot spinning at 3 rpm is followed with a lag under a degree", () => {
		const spin = (3 * 2 * Math.PI) / 60;
		const want = (t: number): Attitude => ({
			nose: LEVEL.nose,
			up: v3(-Math.sin(spin * t), Math.cos(spin * t), 0),
		});
		const { worst } = hold(LEVEL, want, "courier", 20, 1 / 60);
		expect(worst).toBeLessThan((1 * Math.PI) / 180);
	});
});
