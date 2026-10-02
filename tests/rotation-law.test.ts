/**
 * #618 — the flag-gated arm that flies `flight-model.md` §3.9 before the vent
 * substrate is built on it. The arm differs from `main` in one law only:
 * with the assist off, a held axis is angular acceleration at today's
 * `angularAccel`, there is no `angularMax`, and a released axis keeps its rate.
 * With the assist on, or with the flag absent, the player flies `stepAngular`.
 */
import { describe, expect, test } from "bun:test";
import {
	type Angular,
	flightPerformance,
	rotationLaw,
	stepAngular,
	stepAngularNewtonian,
	stepPlayerAngular,
} from "../src/sim";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import { callArguments, codeOf } from "./lib/source-scan";

const BASELINE = flightPerformance(PLAYER_BASELINE_HULL);
const NONE: Angular = { pitch: 0, yaw: 0, roll: 0 };
const DTS = [0.004, 0.016, 1 / 30, 0.05];

describe("rotationLaw — the ?rotation= flag", () => {
	test("only `newtonian` selects the arm", () => {
		expect(rotationLaw("newtonian")).toBe("newtonian");
		for (const other of [null, "", "Newtonian", "newton", "rate", "on", "1"])
			expect(rotationLaw(other)).toBe("rate");
	});
});

describe("stepAngularNewtonian — uncapped, torque-limited rotation", () => {
	test("a held axis accelerates at angularAccel, linearly, past angularMax", () => {
		for (const dt of DTS) {
			const seconds = 10;
			const steps = Math.round(seconds / dt);
			let rates = NONE;
			for (let i = 0; i < steps; i++)
				rates = stepAngularNewtonian(
					rates,
					{ ...NONE, yaw: 1 },
					NONE,
					dt,
					BASELINE,
				);
			const expected = BASELINE.angularAccel * steps * dt;
			expect(rates.yaw).toBeCloseTo(expected, 9);
			expect(rates.yaw).toBeGreaterThan(BASELINE.angularMax.yaw * 2);
			expect(rates.pitch).toBe(0);
			expect(rates.roll).toBe(0);
		}
	});

	test("a partial stick is a partial torque", () => {
		const half = stepAngularNewtonian(
			NONE,
			{ ...NONE, pitch: 0.5 },
			NONE,
			0.016,
			BASELINE,
		);
		expect(half.pitch).toBeCloseTo(0.5 * BASELINE.angularAccel * 0.016, 12);
		const over = stepAngularNewtonian(
			NONE,
			{ ...NONE, pitch: 7 },
			NONE,
			0.016,
			BASELINE,
		);
		expect(over.pitch).toBeCloseTo(BASELINE.angularAccel * 0.016, 12);
	});

	test("a released axis keeps its rate exactly, whatever the rate", () => {
		for (const dt of DTS) {
			let rates = { pitch: 9.5, yaw: -0.2, roll: 31 };
			for (let i = 0; i < 500; i++)
				rates = stepAngularNewtonian(rates, NONE, NONE, dt, BASELINE);
			expect(rates).toEqual({ pitch: 9.5, yaw: -0.2, roll: 31 });
		}
	});

	test("the opposite stick slows the spin through zero and out the other side", () => {
		const dt = 0.016;
		let rates = { ...NONE, roll: 3 };
		let crossed = false;
		let previous = rates.roll;
		for (let i = 0; i < 2000; i++) {
			rates = stepAngularNewtonian(
				rates,
				{ ...NONE, roll: -1 },
				NONE,
				dt,
				BASELINE,
			);
			expect(rates.roll).toBeLessThan(previous);
			previous = rates.roll;
			if (rates.roll < 0) crossed = true;
		}
		expect(crossed).toBe(true);
		expect(rates.roll).toBeCloseTo(3 - BASELINE.angularAccel * 2000 * dt, 9);
	});

	test("the mouse is a demand bounded by the same authority, not a free rate", () => {
		// Today a pointer delta adds straight to the rate and only the angularMax
		// clamp stops it. With no clamp, a flick would be a permanent spin no vent
		// paid for, so the arm bounds stick and pointer together by
		// `angularAccel × dt` per step.
		const dt = 0.016;
		const authority = BASELINE.angularAccel * dt;
		const flicked = stepAngularNewtonian(
			NONE,
			NONE,
			{ ...NONE, yaw: 99 },
			dt,
			BASELINE,
		);
		expect(flicked.yaw).toBeCloseTo(authority, 12);
		const nudged = stepAngularNewtonian(
			NONE,
			NONE,
			{ ...NONE, yaw: authority / 4 },
			dt,
			BASELINE,
		);
		expect(nudged.yaw).toBeCloseTo(authority / 4, 12);
		const both = stepAngularNewtonian(
			NONE,
			{ ...NONE, yaw: 1 },
			{ ...NONE, yaw: 0.5 },
			dt,
			BASELINE,
		);
		expect(both.yaw).toBeCloseTo(authority, 12);
		const opposed = stepAngularNewtonian(
			NONE,
			{ ...NONE, yaw: 1 },
			{ ...NONE, yaw: -authority },
			dt,
			BASELINE,
		);
		expect(opposed.yaw).toBeCloseTo(0, 12);
	});

	test("a zero delta changes nothing", () => {
		const rates = { pitch: 0.3, yaw: 0.2, roll: 0.1 };
		expect(
			stepAngularNewtonian(
				rates,
				{ pitch: 1, yaw: 1, roll: 1 },
				NONE,
				0,
				BASELINE,
			),
		).toBe(rates);
	});
});

describe("stepPlayerAngular — the arm differs from main in one law only", () => {
	const commands: Angular[] = [
		NONE,
		{ pitch: 1, yaw: 0, roll: 0 },
		{ pitch: -0.4, yaw: 0.7, roll: 1 },
	];
	const impulses: Angular[] = [NONE, { pitch: 0.003, yaw: -0.01, roll: 0 }];
	const startRates: Angular[] = [
		NONE,
		{ pitch: 0.4, yaw: -0.2, roll: 0.1 },
		{ pitch: 0, yaw: BASELINE.angularMax.yaw, roll: 0 },
	];

	/** Every combination of the sweep, handed to `check`. */
	const sweep = (
		check: (
			rates: Angular,
			command: Angular,
			impulse: Angular,
			dt: number,
		) => void,
	) => {
		for (const dt of DTS)
			for (const rates of startRates)
				for (const command of commands)
					for (const impulse of impulses) check(rates, command, impulse, dt);
	};

	test("with the flag absent, assist on or off, it is stepAngular bit for bit", () => {
		for (const assist of [true, false])
			sweep((rates, command, impulse, dt) =>
				expect(
					stepPlayerAngular(
						"rate",
						rates,
						command,
						impulse,
						assist,
						dt,
						BASELINE,
					),
				).toEqual(stepAngular(rates, command, impulse, assist, dt, BASELINE)),
			);
	});

	test("with the flag on and the assist on, it is stepAngular bit for bit", () => {
		sweep((rates, command, impulse, dt) =>
			expect(
				stepPlayerAngular(
					"newtonian",
					rates,
					command,
					impulse,
					true,
					dt,
					BASELINE,
				),
			).toEqual(stepAngular(rates, command, impulse, true, dt, BASELINE)),
		);
	});

	test("with the flag on and the assist off, it is the Newtonian law", () => {
		sweep((rates, command, impulse, dt) =>
			expect(
				stepPlayerAngular(
					"newtonian",
					rates,
					command,
					impulse,
					false,
					dt,
					BASELINE,
				),
			).toEqual(stepAngularNewtonian(rates, command, impulse, dt, BASELINE)),
		);
	});
});

describe("the player's step is wired to the flag and the assist", () => {
	// The laws above are proven in isolation. This reads `main.ts` for the one
	// call that flies them, so a wrong law or assist argument there is red here
	// rather than only in a browser.
	const main = codeOf("src/main.ts");

	test("the player's rotation is the one stepPlayerAngular call, with the page's law and the assist", () => {
		const calls = callArguments(main, /\bstepPlayerAngular\(/g);
		expect(calls).toHaveLength(1);
		const args = calls[0].args.map((a) => a.trim());
		expect(args[0]).toBe("this.rotationLaw");
		expect(args[1]).toBe("this.rates");
		expect(args[4]).toBe("this.assist");
		expect(args[6]).toBe("this.flownPerformance");
	});

	test("main.ts no longer calls stepAngular for the player", () => {
		expect(callArguments(main, /\bstepAngular\(/g)).toHaveLength(0);
	});

	test("the page's law is read from ?rotation= through rotationLaw", () => {
		expect(main).toMatch(
			/rotationLaw\(\s*new URLSearchParams\(window\.location\.search\)\.get\("rotation"\),?\s*\)/,
		);
		expect(main).toMatch(/readonly rotationLaw: RotationLaw = ROTATION_LAW;/);
	});
});
