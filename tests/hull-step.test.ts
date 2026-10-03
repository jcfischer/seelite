/**
 * The Hull step (#646, CONTEXT "Hull step"): one call that turns and moves a
 * hull by its vents, flown by the pilot, the raider, the scoop pilot and the
 * docking harness alike.
 *
 * Each row is a property of the step a caller relies on, stated without the
 * caller: the turn's push lands in the same step's velocity, a regime that
 * moves the hull itself gets the turn and nothing else, the two Saturation
 * families come out already collapsed, and the attitude turns the way the
 * player's quaternion always did.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import * as THREE from "three";
import { HULL_IDS, PLAYER_BASELINE_HULL } from "../src/hull";
import {
	ASSIST_CAP_KMS,
	type Angular,
	type Attitude,
	type HullControl,
	type Ship,
	flightPerformance,
	speedDemand,
	stepHull,
	thrustShares,
	turnAttitude,
} from "../src/sim";
import { MAX_DT } from "../src/units";
import { cross, dot, length, sub, v3 } from "../src/vec3";
import { codeOf, repoPath, scriptFiles, srcFiles } from "./lib/source-scan";

const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };
const LEVEL: Attitude = { nose: v3(0, 0, -1), up: v3(0, 1, 0) };
const PERF = flightPerformance(PLAYER_BASELINE_HULL);
const DTS = [1 / 120, 1 / 60, 1 / 30, MAX_DT];

const ship = (): Ship => ({ pos: v3(), vel: v3() });
const control = (over: Partial<HullControl> = {}): HullControl => ({
	stick: STILL,
	turnAssist: true,
	translation: { demand: speedDemand(0), assist: true },
	...over,
});

describe("the Hull step", () => {
	test("a lone attitude vent pushes the hull in the same step it turns it", () => {
		// A single vent is a couple and a force (§3.2). The force is owed to
		// the velocity of the step that fired it, not to the next one.
		const lone = PERF.axisSlots.yaw.plus[0];
		for (const dt of DTS) {
			const flown = ship();
			const step = stepHull(
				flown,
				{ ...LEVEL, rates: STILL },
				control({
					direct: { [lone]: 1 },
					translation: { demand: speedDemand(0), assist: false },
				}),
				dt,
				PERF,
			);
			expect(step.firing[lone]).toBe(1);
			expect(length(flown.vel)).toBeGreaterThan(0);
		}
	});

	test("a regime that moves the hull itself gets the turn and nothing else", () => {
		// Cruise supplies its own translation (#646 D5): the step turns the
		// hull through the attitude vents, and leaves position and velocity
		// to the regime.
		for (const dt of DTS) {
			const flown = { pos: v3(1, 2, 3), vel: v3(4, 5, 6) };
			const step = stepHull(
				flown,
				{ ...LEVEL, rates: STILL },
				control({ stick: { pitch: 1, yaw: 0, roll: 0 }, translation: null }),
				dt,
				PERF,
			);
			expect(flown).toEqual({ pos: v3(1, 2, 3), vel: v3(4, 5, 6) });
			expect(step.rates.pitch).toBeGreaterThan(0);
			expect(thrustShares(step.firing, PERF)).toMatchObject({
				main: 0,
				lateral: 0,
			});
			expect(thrustShares(step.firing, PERF).rotation).toBeGreaterThan(0);
			expect(step.saturated.linear).toBe(false);
		}
	});

	test("the turn is flown before the translation: the drive pushes along the turned nose", () => {
		// The translation reads the attitude the step has just turned to.
		const dt = MAX_DT;
		const flown = ship();
		const step = stepHull(
			flown,
			{ ...LEVEL, rates: { pitch: 0, yaw: 1, roll: 0 } },
			control({
				translation: { demand: speedDemand(1), assist: false },
			}),
			dt,
			PERF,
		);
		const along = dot(flown.vel, step.nose) / length(flown.vel);
		expect(along).toBeGreaterThan(
			dot(flown.vel, LEVEL.nose) / length(flown.vel),
		);
	});

	test("each Saturation family comes out as one flag", () => {
		// The assist cannot return a hull far above the cap in one step, and
		// it cannot meet a full stick from rest above the couple's authority
		// when the rate is past the envelope.
		const fast = { pos: v3(), vel: v3(0, 0, -10 * ASSIST_CAP_KMS) };
		const linear = stepHull(
			fast,
			{ ...LEVEL, rates: STILL },
			control(),
			MAX_DT,
			PERF,
		);
		expect(linear.saturated).toEqual({ linear: true, angular: false });

		const spinning: Angular = {
			pitch: 10 * PERF.angularMax.pitch,
			yaw: 0,
			roll: 0,
		};
		const angular = stepHull(
			ship(),
			{ ...LEVEL, rates: spinning },
			control(),
			MAX_DT,
			PERF,
		);
		expect(angular.saturated).toEqual({ linear: false, angular: true });
	});

	test("the attitude stays a unit, perpendicular pair over a long tumble", () => {
		let at: Attitude = LEVEL;
		const rates: Angular = { pitch: 0.7, yaw: -1.3, roll: 2.1 };
		for (let i = 0; i < 6000; i++) at = turnAttitude(at, rates, 1 / 60);
		expect(length(at.nose)).toBeCloseTo(1, 12);
		expect(length(at.up)).toBeCloseTo(1, 12);
		expect(dot(at.nose, at.up)).toBeCloseTo(0, 12);
	});
});

describe("the one integrator turns the way the player's quaternion did", () => {
	// The player composed `Euler(pitch·dt, yaw·dt, roll·dt, "XYZ")` on the
	// right of its quaternion, with the nose on -Z and up on +Y. The Hull step
	// turns by the axis-angle of the same body rates. The two agree to first
	// order in `rate·dt`: the same sense on every axis, and a difference of
	// second order, which is what #646 D10 accepted.
	const quaternionTurn = (from: Attitude, rates: Angular, dt: number) => {
		const right = cross(from.nose, from.up);
		const basis = new THREE.Matrix4().makeBasis(
			new THREE.Vector3(right.x, right.y, right.z),
			new THREE.Vector3(from.up.x, from.up.y, from.up.z),
			new THREE.Vector3(-from.nose.x, -from.nose.y, -from.nose.z),
		);
		const q = new THREE.Quaternion().setFromRotationMatrix(basis);
		q.multiply(
			new THREE.Quaternion().setFromEuler(
				new THREE.Euler(
					rates.pitch * dt,
					rates.yaw * dt,
					rates.roll * dt,
					"XYZ",
				),
			),
		);
		const n = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
		const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
		return { nose: v3(n.x, n.y, n.z), up: v3(u.x, u.y, u.z) };
	};
	const tilted: Attitude = {
		nose: v3(0.6, 0, -0.8),
		up: v3(0, 1, 0),
	};

	for (const axis of ["pitch", "yaw", "roll"] as const)
		test(`${axis} alone matches exactly`, () => {
			const rates = { ...STILL, [axis]: 1.7 };
			const dt = 1 / 60;
			const ours = turnAttitude(tilted, rates, dt);
			const theirs = quaternionTurn(tilted, rates, dt);
			expect(length(sub(ours.nose, theirs.nose))).toBeLessThan(1e-12);
			expect(length(sub(ours.up, theirs.up))).toBeLessThan(1e-12);
		});

	test("all three at once differ by second order only", () => {
		const rates: Angular = { pitch: 1, yaw: 1, roll: 1 };
		const at = (dt: number) => {
			const ours = turnAttitude(tilted, rates, dt);
			const theirs = quaternionTurn(tilted, rates, dt);
			return Math.max(
				length(sub(ours.nose, theirs.nose)),
				length(sub(ours.up, theirs.up)),
			);
		};
		// Halving the step quarters the difference.
		const ratio = at(1 / 60) / at(1 / 120);
		expect(ratio).toBeGreaterThan(3.8);
		expect(ratio).toBeLessThan(4.2);
		expect(at(1 / 60)).toBeLessThan(2e-4);
	});
});

describe("one firing table gives the shares the two used to", () => {
	// The pilot read `rotation` off the attitude step's firing and `main` and
	// `lateral` off the translation step's. One merged table reads the same
	// only because the axes are disjoint by family: a translation axis fires
	// translation vents, an attitude axis attitude vents.
	for (const id of HULL_IDS)
		test(`${id}: no axis fires the other family's vents`, () => {
			const perf = flightPerformance(id);
			const family = new Map(perf.vents.map((v) => [v.slot, v.family]));
			for (const axis of ["surge", "sway", "heave"] as const)
				for (const slot of [
					...perf.axisSlots[axis].plus,
					...perf.axisSlots[axis].minus,
				])
					expect(["main", "retro", "strafe"]).toContain(
						family.get(slot) ?? "none",
					);
			for (const axis of ["pitch", "yaw", "roll"] as const)
				for (const slot of [
					...perf.axisSlots[axis].plus,
					...perf.axisSlots[axis].minus,
				])
					expect(family.get(slot)).toBe(axis);
		});
});

describe("no caller composes the step by hand (#646 D9)", () => {
	// Before #646 the step "stick → attitude → translation" was written out in
	// four places with four attitude integrators, and each copy drifted on its
	// own (`raider-flight-rules.test.ts` exists because two did). A fifth copy
	// is a red run here rather than a review finding. The halves stay exported
	// for the law's own rows and for one instrument that reads rates alone.
	const HALVES = ["stepAngular", "stepFlight"];
	const CALL = new RegExp(`\\b(?:${HALVES.join("|")})\\(`);
	const ALLOWED: Record<string, string> = {
		"src/sim.ts": "the Hull step and the halves it composes",
		"scripts/measure-vent-shares.ts":
			"reads the rates the attitude law gives one hull, with no translation " +
			"and no attitude to turn: a measurement of the law, not a pilot",
		"tests/vents.test.ts": "the vent law's own rows (#619)",
		"tests/sim.test.ts": "the flight law's own rows",
		"tests/thrust-share.test.ts": "the shares read off one half's table",
		"tests/vent-cue.test.ts": "the cue read off each half's flags",
		"tests/attitude-hold.test.ts":
			"the follower's stick turned by the attitude law alone",
	};
	const readDir = (dir: string, ext: string[]) =>
		(readdirSync(repoPath(dir), { recursive: true }) as string[])
			.filter((f) => ext.some((e) => f.endsWith(e)))
			.map((f) => `${dir}/${f}`);
	const files = [
		...srcFiles(),
		...scriptFiles([".ts", ".mjs"]),
		...readDir("tests", [".ts"]),
	];

	test("only the allowed files call either half", () => {
		const callers = files.filter((f) => CALL.test(codeOf(f))).sort();
		expect(callers).toEqual(Object.keys(ALLOWED).sort());
	});
});
