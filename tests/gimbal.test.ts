/**
 * The pulse laser's gimbal (#324): it tracks the selected target inside a ±5°
 * cone at a finite slew, returns to the boresight otherwise, and never leaves
 * the cone.
 */
import { describe, expect, test } from "bun:test";
import {
	GIMBAL_CONE_RAD,
	GIMBAL_SLEW_RAD_S,
	angleBetween,
	stepGimbal,
} from "../src/gimbal";
import { type Vec3, v3 } from "../src/vec3";

const DEG = Math.PI / 180;
/** A unit vector `deg` degrees off the forward axis (-z), turned about y. */
const off = (deg: number): Vec3 =>
	v3(Math.sin(deg * DEG), 0, -Math.cos(deg * DEG));
const BORE = off(0);
const DT = 1 / 60;

function run(
	aim: Vec3,
	bore: Vec3,
	target: Vec3 | null,
	steps: number,
	dt = DT,
) {
	let a = aim;
	for (let i = 0; i < steps; i++) a = stepGimbal(a, bore, target, dt);
	return a;
}

describe("the gimbal", () => {
	test("the cone is ±5° and the slew 1.5 rad/s, by the principal's ruling", () => {
		expect(GIMBAL_CONE_RAD).toBeCloseTo(5 * DEG, 12);
		expect(GIMBAL_SLEW_RAD_S).toBe(1.5);
	});

	test("it settles on a selected target inside the cone", () => {
		const target = off(3);
		// 1e-6 rad, not 1e-9: `acos` near 1 cannot resolve below about 1.5e-8,
		// so a unit vector's angle to itself reads 1.5e-8 from rounding alone.
		expect(angleBetween(run(BORE, BORE, target, 60), target)).toBeLessThan(
			1e-6,
		);
	});

	test("it turns no faster than its slew", () => {
		// From 4.5° one side to 4.5° the other is 9°, more than one 0.1 s step of
		// slew (8.6°), so one step must fall short by the difference.
		const from = off(-4.5);
		const target = off(4.5);
		const after = stepGimbal(from, BORE, target, 0.1);
		const moved = angleBetween(from, after);
		expect(moved).toBeCloseTo(GIMBAL_SLEW_RAD_S * 0.1, 9);
		expect(angleBetween(after, target)).toBeGreaterThan(0);
	});

	test("a target outside the cone is not tracked: the beam returns to the boresight", () => {
		const aim = off(4);
		const back = run(aim, BORE, off(8), 60);
		expect(angleBetween(back, BORE)).toBeLessThan(1e-9);
	});

	test("with no target the beam is the boresight", () => {
		expect(angleBetween(run(off(2), BORE, null, 60), BORE)).toBeLessThan(1e-9);
	});

	test("it never points outside the cone, however the ship swings", () => {
		// The boresight jumps 20° in one step while the beam still points at the
		// old target: the result is dragged back inside the new cone.
		const bore = off(20);
		const after = stepGimbal(off(0), bore, off(0), DT);
		expect(angleBetween(after, bore)).toBeLessThanOrEqual(
			GIMBAL_CONE_RAD + 1e-9,
		);
	});
});
