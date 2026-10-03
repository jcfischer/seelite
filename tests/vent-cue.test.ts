/**
 * `flight-model.md` §3.8.1's two cues (#621): what saturation means on the
 * sim's side, and the latch and pulse the HUD draws it with. Where each
 * firing vent's throat is drawn is `tests/vent-plumes.test.ts`'s.
 *
 * Every law here is swept over frame deltas, for `vents.test.ts`'s reason.
 */

import { describe, expect, test } from "bun:test";
import { HULL_IDS } from "../src/hull";
import {
	ASSIST_CAP_KMS,
	type Angular,
	type FlightControl,
	NO_ATTITUDE,
	type Ship,
	flightPerformance,
	speedDemand,
	stepAngular,
	stepFlight,
} from "../src/sim";
import { MAX_DT } from "../src/units";
import { length, scale, v3 } from "../src/vec3";
import {
	SATURATION_HOLD_S,
	SATURATION_PULSE_FLOOR,
	SATURATION_PULSE_HZ,
	type SaturationCue,
	cueAlpha,
	pulseAlpha,
	quietCue,
	stepSaturationCue,
	withAlpha,
} from "../src/vent-cue";

const STEPS = [1 / 120, 1 / 60, 0.05, MAX_DT];
const NOSE = v3(0, 0, -1);
const UP = v3(0, 1, 0);
const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };

const control = (over: Partial<FlightControl> = {}): FlightControl => ({
	nose: NOSE,
	up: UP,
	demand: speedDemand(0),
	assist: true,
	attitude: NO_ATTITUDE,
	...over,
});

describe("§3.8.1 a full burn toward a commanded speed is not saturation", () => {
	// #5's law was always a burn at the drive's authority toward the commanded
	// speed, so a throttle change is a demand the vents meet in full. Only a
	// speed the assist must *return* from — above the cap, or above the room a
	// sideways speed leaves — is one it cannot meet (§3.10).
	for (const dt of STEPS)
		test(`throttle 0 → full → 0 never saturates the surge on any hull, dt ${dt.toFixed(4)}`, () => {
			for (const id of HULL_IDS) {
				const perf = flightPerformance(id);
				const ship: Ship = { pos: v3(), vel: v3() };
				const reach = ASSIST_CAP_KMS / perf.thrustKms2;
				const stop = ASSIST_CAP_KMS / perf.retroKms2;
				let fired = 0;
				for (let i = 0; i < (reach + 1) / dt; i++) {
					const step = stepFlight(
						ship,
						control({ demand: speedDemand(1) }),
						dt,
						perf,
					);
					expect(step.saturated.surge).toBe(false);
					fired += step.firing.main ?? 0;
				}
				expect(fired).toBeGreaterThan(0);
				expect(length(ship.vel)).toBeCloseTo(ASSIST_CAP_KMS, 6);
				for (let i = 0; i < (stop + 1) / dt; i++) {
					const step = stepFlight(ship, control(), dt, perf);
					expect(step.saturated.surge).toBe(false);
				}
				expect(length(ship.vel)).toBeLessThan(1e-9);
			}
		});

	for (const dt of STEPS)
		test(`above the cap the surge is saturated until the hull is back, dt ${dt.toFixed(4)}`, () => {
			for (const id of HULL_IDS) {
				const perf = flightPerformance(id);
				const ship: Ship = { pos: v3(), vel: scale(NOSE, 4) };
				const first = stepFlight(
					ship,
					control({ demand: speedDemand(1) }),
					dt,
					perf,
				);
				expect(first.saturated.surge).toBe(true);
				expect(first.firing["retro-port"]).toBe(1);
			}
		});

	for (const dt of STEPS)
		test(`astern above the cap is saturated too, dt ${dt.toFixed(4)}`, () => {
			// Sage round 1: a one-sided guard clamped an astern overspeed and
			// never flagged it, and the only over-cap row ran forward.
			for (const id of HULL_IDS) {
				const perf = flightPerformance(id);
				const ship: Ship = { pos: v3(), vel: scale(NOSE, -4) };
				const first = stepFlight(
					ship,
					control({ demand: speedDemand(1) }),
					dt,
					perf,
				);
				expect(first.saturated.surge).toBe(true);
				expect(first.firing.main).toBe(1);
			}
		});

	for (const dt of STEPS)
		test(`with the assist off nothing saturates, dt ${dt.toFixed(4)}`, () => {
			// §4.1's "only with the assist on" rests on the sim, so it is held
			// here: above the cap, spinning past the envelope, every axis full.
			for (const id of HULL_IDS) {
				const perf = flightPerformance(id);
				const ship: Ship = { pos: v3(), vel: scale(NOSE, -4) };
				const turn = stepAngular(
					{ pitch: 9, yaw: -9, roll: 9 },
					{ pitch: 1, yaw: -1, roll: 1 },
					{ pitch: 5, yaw: 5, roll: 5 },
					false,
					dt,
					perf,
				);
				expect(Object.values(turn.saturated).some(Boolean)).toBe(false);
				const step = stepFlight(
					ship,
					control({
						assist: false,
						attitude: turn,
						demand: { surge: 1, sway: -1, heave: 1 },
					}),
					dt,
					perf,
				);
				expect(Object.values(step.saturated).some(Boolean)).toBe(false);
			}
		});

	test("the firing is the same as before the clamp: the clamp moved only the flag", () => {
		// A throttle step on the courier fires the main drive at full, which
		// is what `fireAxis` gave the unclamped fraction too.
		const ship: Ship = { pos: v3(), vel: v3() };
		const step = stepFlight(
			ship,
			control({ demand: speedDemand(1) }),
			1 / 60,
			flightPerformance("courier"),
		);
		expect(step.firing.main).toBe(1);
	});

	test("a stick held inside the envelope never saturates on any hull", () => {
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			let rates = STILL;
			for (let i = 0; i < 3 / (1 / 60); i++) {
				const step = stepAngular(
					rates,
					{ pitch: 1, yaw: -1, roll: 1 },
					STILL,
					true,
					1 / 60,
					perf,
				);
				expect(Object.values(step.saturated).some(Boolean)).toBe(false);
				rates = step.rates;
			}
		}
	});
});

const cueAt = (
	steps: { linear: boolean; angular: boolean; dt: number }[],
): { cue: SaturationCue; t: number } => {
	let cue = quietCue();
	let t = 0;
	for (const s of steps) {
		t += s.dt;
		cue = stepSaturationCue(cue, s, t);
	}
	return { cue, t };
};

describe("§3.8.1 the cue is latched, so a flag that flickers does not", () => {
	for (const dt of STEPS)
		test(`one saturated step holds the cue for SATURATION_HOLD_S, dt ${dt.toFixed(4)}`, () => {
			let cue = stepSaturationCue(
				quietCue(),
				{ linear: true, angular: false },
				0,
			);
			expect(cue.linear).not.toBeNull();
			let t = 0;
			while (t + dt < SATURATION_HOLD_S - 1e-9) {
				t += dt;
				cue = stepSaturationCue(cue, { linear: false, angular: false }, t);
				expect(cue.linear).not.toBeNull();
			}
			cue = stepSaturationCue(
				cue,
				{ linear: false, angular: false },
				SATURATION_HOLD_S + 1e-6,
			);
			expect(cue.linear).toBeNull();
		});

	test("a flag toggling every step keeps one onset, so the pulse does not restart", () => {
		const steps = Array.from({ length: 60 }, (_, i) => ({
			linear: i % 2 === 0,
			angular: false,
			dt: 1 / 60,
		}));
		const { cue } = cueAt(steps);
		expect(cue.linear?.onsetS).toBeCloseTo(1 / 60, 12);
	});

	test("the two families latch apart", () => {
		const { cue } = cueAt([{ linear: false, angular: true, dt: 0.1 }]);
		expect(cue.linear).toBeNull();
		expect(cue.angular).not.toBeNull();
	});
});

describe("§3.8.1 the pulse changes alpha and nothing else", () => {
	test("at onset the marker is at full strength, so a frame taken then shows it", () => {
		expect(pulseAlpha(0)).toBe(1);
	});

	test("the pulse is bounded by its floor and its period", () => {
		const period = 1 / SATURATION_PULSE_HZ;
		let lo = 1;
		for (let i = 0; i <= 400; i++) {
			const a = pulseAlpha((i / 400) * 3 * period);
			expect(a).toBeLessThanOrEqual(1);
			expect(a).toBeGreaterThanOrEqual(SATURATION_PULSE_FLOOR - 1e-12);
			lo = Math.min(lo, a);
			expect(pulseAlpha((i / 400) * period + period)).toBeCloseTo(
				pulseAlpha((i / 400) * period),
				12,
			);
		}
		expect(lo).toBeCloseTo(SATURATION_PULSE_FLOOR, 6);
	});

	test("a quiet cue is full strength, always", () => {
		for (const t of [0, 0.13, 7.7])
			expect(cueAlpha(quietCue(), "angular", t)).toBe(1);
	});

	test("a latched cue pulses from its onset", () => {
		const cue = stepSaturationCue(
			quietCue(),
			{ linear: false, angular: true },
			10,
		);
		const half = 0.5 / SATURATION_PULSE_HZ;
		expect(cueAlpha(cue, "angular", 10)).toBe(1);
		expect(cueAlpha(cue, "angular", 10 + half)).toBeCloseTo(
			SATURATION_PULSE_FLOOR,
			9,
		);
		expect(cueAlpha(cue, "linear", 10 + half)).toBe(1);
	});

	test("withAlpha scales the alpha of an rgba() and leaves its channels", () => {
		expect(withAlpha("rgba(150, 255, 190, 0.85)", 0.5)).toBe(
			"rgba(150, 255, 190, 0.425)",
		);
		expect(withAlpha("rgba(200, 230, 255, 0.55)", 1)).toBe(
			"rgba(200, 230, 255, 0.55)",
		);
	});

	test("withAlpha refuses a colour it cannot read rather than passing it", () => {
		expect(() => withAlpha("#96ffbe", 0.5)).toThrow();
	});
});
