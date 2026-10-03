/**
 * The pointer's turn (#641): how much of a mouse movement reaches the rate,
 * and the `carry` arm that banks what the vents could not pay in one step.
 *
 * The measurement row prints, per hull and regime, the pointer speed at which
 * the attitude couples stop paying a delta in full. It is swept over frame
 * deltas because two clips act on it and only one is frame-rate invariant:
 * the couple's (`angularAuthority × dt`, so `A / MOUSE_RAD_PER_PX` px/s) and
 * the spike guard's (`MOUSE_MAX_STEP` a frame, so fewer px/s at a low rate).
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { HULL_IDS } from "../src/hull";
import {
	FlickMeter,
	MOUSE_MAX_STEP,
	MOUSE_RAD_PER_PX,
	POINTER_DEFAULTS,
	type PointerTuning,
	asked,
	pointerImpulse,
	pointerTuningFrom,
	settleBank,
} from "../src/pointer";
import {
	type Angular,
	type FlightPerformance,
	flightPerformance,
	stepAngular,
} from "../src/sim";
import { MAX_DT } from "../src/units";

const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };
const DTS = [1 / 240, 1 / 144, 1 / 60, 1 / 30, MAX_DT];
const DROP: PointerTuning = { ...POINTER_DEFAULTS, law: "drop" };
const CARRY: PointerTuning = { ...POINTER_DEFAULTS, law: "carry" };

/** The pitch-rate change one frame of `px` delivers from rest, today's law. */
function oneFrame(
	perf: FlightPerformance,
	px: number,
	dt: number,
	assist: boolean,
) {
	const impulse = pointerImpulse(DROP, { pitch: 0, yaw: 0 }, 0, -px);
	return stepAngular(STILL, STILL, impulse, assist, dt, perf).rates.pitch;
}

describe("how much of one frame's pointer delta reaches the rate", () => {
	test("prints the limit per hull and regime, and it is the clip that binds first", () => {
		const lines: string[] = [];
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			const a = perf.angularAuthority.pitch;
			const couplePxS = a / MOUSE_RAD_PER_PX;
			const cells = DTS.map((dt) => {
				const guardPxS = MOUSE_MAX_STEP / MOUSE_RAD_PER_PX / dt;
				return `${Math.round(1 / dt)}Hz ${Math.round(Math.min(couplePxS, guardPxS))}`;
			});
			lines.push(
				`${id.padEnd(12)} couple ${Math.round(couplePxS).toString().padStart(5)} px/s · max ${perf.angularMax.pitch.toFixed(2)} rad/s · limit px/s: ${cells.join("  ")}`,
			);
			for (const assist of [false, true]) {
				for (const dt of DTS) {
					// What one frame of `px` should reach: the spike guard, then the
					// couple. The assist on also eases the kick out inside the same
					// step, and holds the rate under the envelope.
					const ease = assist ? Math.exp(-dt / perf.angularDampTauS) : 1;
					const cap = assist ? perf.angularMax.pitch : Number.POSITIVE_INFINITY;
					const reach = (px: number) =>
						Math.min(
							Math.min(px * MOUSE_RAD_PER_PX, MOUSE_MAX_STEP) * ease,
							a * dt,
							cap,
						);
					const limitPx = Math.min(a * dt, MOUSE_MAX_STEP) / MOUSE_RAD_PER_PX;
					for (const px of [limitPx * 0.9, limitPx * 4])
						expect(oneFrame(perf, px, dt, assist)).toBeCloseTo(reach(px), 9);
					// Below the limit the assist off pays every pixel; above it, the
					// limit and no more.
					if (!assist) {
						expect(reach(limitPx * 0.9)).toBeCloseTo(
							limitPx * 0.9 * MOUSE_RAD_PER_PX,
							12,
						);
						expect(reach(limitPx * 4)).toBeCloseTo(
							limitPx * MOUSE_RAD_PER_PX,
							12,
						);
					}
				}
			}
		}
		console.log(
			`\n#641 pointer limit, pitch = yaw on every hull:\n${lines.join("\n")}`,
		);
	});
});

describe("stepAngular reports the pointer kick it could not pay", () => {
	const perf = flightPerformance("courier");
	const dt = 1 / 60;
	const step = perf.angularAuthority.pitch * dt;

	test("a kick inside the couple is paid in full", () => {
		const s = stepAngular(
			STILL,
			STILL,
			{ ...STILL, pitch: step / 2 },
			false,
			dt,
			perf,
		);
		expect(s.pointerUnspent.pitch).toBe(0);
	});
	test("a kick beyond it leaves the excess", () => {
		const s = stepAngular(
			STILL,
			STILL,
			{ ...STILL, pitch: step * 3 },
			false,
			dt,
			perf,
		);
		expect(s.pointerUnspent.pitch).toBeCloseTo(step * 2, 12);
	});
	test("a full stick the same way leaves the whole kick", () => {
		const s = stepAngular(
			STILL,
			{ ...STILL, pitch: 1 },
			{ ...STILL, pitch: step / 2 },
			false,
			dt,
			perf,
		);
		expect(s.pointerUnspent.pitch).toBeCloseTo(step / 2, 12);
	});
	test("a kick against the stick is paid, and nothing is left", () => {
		const s = stepAngular(
			STILL,
			{ ...STILL, pitch: 1 },
			{ ...STILL, pitch: -step / 2 },
			false,
			dt,
			perf,
		);
		expect(s.pointerUnspent.pitch).toBe(0);
	});
	test("the assist on leaves nothing to carry: the arm is assist-off only", () => {
		const s = stepAngular(
			STILL,
			STILL,
			{ ...STILL, pitch: step * 3 },
			true,
			dt,
			perf,
		);
		expect(s.pointerUnspent.pitch).toBe(0);
	});
});

/** Fly `frames` steps of `law` from one frame of `px`, assist off; the
 *  pitch rate it ends at. */
function flick(
	perf: FlightPerformance,
	tuning: PointerTuning,
	px: number,
	dt: number,
	seconds = 2,
) {
	let bank = { pitch: 0, yaw: 0 };
	let rates = STILL;
	for (let t = 0, first = true; t < seconds; t += dt, first = false) {
		const dy = first ? -px : 0;
		const impulse = pointerImpulse(tuning, bank, 0, dy);
		const s = stepAngular(rates, STILL, impulse, false, dt, perf);
		rates = s.rates;
		bank = settleBank(tuning, s.pointerUnspent, dt);
	}
	return { rate: rates.pitch, bank };
}

describe("the carry arm", () => {
	test("today's law banks nothing", () => {
		const perf = flightPerformance("courier");
		expect(flick(perf, DROP, 200, 1 / 60).bank).toEqual({ pitch: 0, yaw: 0 });
	});

	test("a delta inside the limit turns the same on both arms", () => {
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			const dt = 1 / 60;
			const px = (perf.angularAuthority.pitch * dt * 0.5) / MOUSE_RAD_PER_PX;
			expect(flick(perf, CARRY, px, dt).rate).toBeCloseTo(
				flick(perf, DROP, px, dt).rate,
				12,
			);
		}
	});

	test("a delta beyond it turns more with carry, and never more than was asked", () => {
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			for (const dt of DTS) {
				const px = 200;
				const drop = flick(perf, DROP, px, dt).rate;
				const carry = flick(perf, CARRY, px, dt).rate;
				expect(carry).toBeGreaterThan(drop);
				expect(carry).toBeLessThanOrEqual(px * MOUSE_RAD_PER_PX + 1e-12);
			}
		}
	});

	test("the bank empties: a flick is over within a few time constants", () => {
		const perf = flightPerformance("miner");
		const { bank } = flick(
			perf,
			CARRY,
			400,
			1 / 60,
			POINTER_DEFAULTS.tauS * 20,
		);
		expect(Math.abs(bank.pitch)).toBeLessThan(1e-6);
	});

	test("the bank is capped: a re-focused window's spike cannot bank a spin", () => {
		const impulse = pointerImpulse(
			CARRY,
			{ pitch: 0, yaw: 0 },
			50_000,
			-50_000,
		);
		expect(Math.abs(impulse.pitch)).toBe(CARRY.capRadS);
		expect(Math.abs(impulse.yaw)).toBe(CARRY.capRadS);
	});

	test("the carry turn barely depends on the frame rate", () => {
		const perf = flightPerformance("courier");
		// `MAX_DT` is left out: at 10 Hz the first step alone pays 0.3 rad/s.
		const rates = DTS.filter((dt) => dt < MAX_DT).map(
			(dt) => flick(perf, CARRY, 200, dt).rate,
		);
		const lo = Math.min(...rates);
		const hi = Math.max(...rates);
		expect((hi - lo) / hi).toBeLessThan(0.1);
	});
});

describe("the flick meter", () => {
	test("reads peak speed, asked and delivered, and closes on quiet", () => {
		const m = new FlickMeter();
		const dt = 1 / 60;
		m.frame(30, 40, dt, asked(30, 40), { pitch: 0.05, yaw: 0.04 });
		m.frame(0, 0, dt, asked(0, 0), { pitch: 0, yaw: 0 }, 0);
		expect(m.last).toBeNull();
		for (let i = 0; i < 20; i++)
			m.frame(0, 0, dt, asked(0, 0), { pitch: 0, yaw: 0 }, 0);
		const last = m.last;
		expect(last).not.toBeNull();
		expect(last?.peakPxS).toBeCloseTo(50 / dt, 6);
		expect(last?.askedRadS).toBeCloseTo(70 * MOUSE_RAD_PER_PX, 12);
		expect(last?.deliveredRadS).toBeCloseTo(0.09, 12);
		expect(m.hardest).toBe(last);
		// A slower flick after it replaces `last` and keeps `hardest`.
		m.frame(3, 0, dt, asked(3, 0), { pitch: 0, yaw: 0.006 });
		for (let i = 0; i < 20; i++)
			m.frame(0, 0, dt, asked(0, 0), { pitch: 0, yaw: 0 }, 0);
		expect(m.last?.peakPxS).toBeCloseTo(3 / dt, 6);
		expect(m.hardest).toBe(last);
	});
});

describe("the flight test's URL", () => {
	test("reads the law and its tuning, and keeps a default for anything unreadable", () => {
		expect(pointerTuningFrom("")).toEqual(POINTER_DEFAULTS);
		expect(
			pointerTuningFrom("?pointer=carry&pointerTau=0.5&pointerCap=0.4"),
		).toEqual({
			law: "carry",
			tauS: 0.5,
			capRadS: 0.4,
		});
		expect(
			pointerTuningFrom("?pointer=carry&pointerTau=-1&pointerCap=x"),
		).toEqual({
			...POINTER_DEFAULTS,
			law: "carry",
		});
		expect(pointerTuningFrom("?pointer=elite").law).toBe("drop");
	});
});

describe("main.ts drops the pointer in one place", () => {
	const src = readFileSync("src/main.ts", "utf8");
	const body = (name: string) => {
		const from = src.slice(src.indexOf(`private ${name}(`));
		return from.slice(0, from.indexOf("\n\t}"));
	};
	test("only dropPointer and takePointer zero the delta", () => {
		expect((src.match(/this\.mouseD[xy] = 0;/g) ?? []).length).toBe(4);
		for (const name of ["dropPointer", "takePointer"])
			expect((body(name).match(/this\.mouseD[xy] = 0;/g) ?? []).length).toBe(2);
	});
	test("dropping the pointer empties the bank and the flick", () => {
		expect(body("dropPointer")).toContain("this.pointerBank = EMPTY_BANK");
		expect(body("dropPointer")).toContain("this.flickMeter.reset()");
	});
});
