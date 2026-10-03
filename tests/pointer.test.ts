/**
 * The pointer's turn (#641): how much of a mouse movement reaches the rate.
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
	asked,
	pointerImpulse,
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

/** The pitch-rate change one frame of `px` delivers from rest. */
function oneFrame(
	perf: FlightPerformance,
	px: number,
	dt: number,
	assist: boolean,
) {
	const impulse = pointerImpulse(0, -px);
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
	test("the assist on reports nothing: the readout is the assist off's", () => {
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

describe("the flick meter", () => {
	test("reads peak speed, asked and delivered, and closes on quiet", () => {
		const m = new FlickMeter();
		const dt = 1 / 60;
		m.frame(30, 40, dt, asked(30, 40), { pitch: 0.05, yaw: 0.04 });
		m.frame(0, 0, dt, asked(0, 0), { pitch: 0, yaw: 0 });
		expect(m.last).toBeNull();
		for (let i = 0; i < 20; i++)
			m.frame(0, 0, dt, asked(0, 0), { pitch: 0, yaw: 0 });
		const last = m.last;
		expect(last).not.toBeNull();
		expect(last?.peakPxS).toBeCloseTo(50 / dt, 6);
		expect(last?.askedRadS).toBeCloseTo(70 * MOUSE_RAD_PER_PX, 12);
		expect(last?.deliveredRadS).toBeCloseTo(0.09, 12);
		expect(m.hardest).toBe(last);
		// A slower flick after it replaces `last` and keeps `hardest`.
		m.frame(3, 0, dt, asked(3, 0), { pitch: 0, yaw: 0.006 });
		for (let i = 0; i < 20; i++)
			m.frame(0, 0, dt, asked(0, 0), { pitch: 0, yaw: 0 });
		expect(m.last?.peakPxS).toBeCloseTo(3 / dt, 6);
		expect(m.hardest).toBe(last);
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
	test("dropping the pointer drops the flick being read", () => {
		expect(body("dropPointer")).toContain("this.flickMeter.reset()");
	});
});
