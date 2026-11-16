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
import { HULL_IDS } from "../src/hull";
import {
	FlickMeter,
	MOUSE_MAX_STEP,
	MOUSE_RAD_PER_PX,
	FLICK_PEAK_WINDOW_S,
	couplePxS,
	mouseRadPerPx,
	pointerImpulse,
} from "../src/pointer";
import { DEFAULT_SETTINGS, SettingsStore } from "../src/settings";
import {
	type Angular,
	type FlightPerformance,
	flightPerformance,
	stepAngular,
} from "../src/sim";
import { MAX_DT } from "../src/units";
import { codeOf, methodBodyOf } from "./lib/source-scan";

const STILL: Angular = { pitch: 0, yaw: 0, roll: 0 };
const DTS = [1 / 240, 1 / 144, 1 / 60, 1 / 30, MAX_DT];

/** The pitch-rate change one frame of `px` delivers from rest. */
function oneFrame(
	perf: FlightPerformance,
	px: number,
	dt: number,
	assist: boolean,
) {
	const impulse = pointerImpulse(0, -px, 1);
	return stepAngular(STILL, STILL, impulse, assist, dt, perf).rates.pitch;
}

describe("how much of one frame's pointer delta reaches the rate", () => {
	test("prints the limit per hull, the same on pitch and yaw", () => {
		const lines: string[] = [];
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			// The table is one column for both axes because they print the same:
			// the solved shares agree to about one part in a million.
			expect(Math.round(couplePxS(perf.angularAuthority.yaw, 1))).toBe(
				Math.round(couplePxS(perf.angularAuthority.pitch, 1)),
			);
			const limit = couplePxS(perf.angularAuthority.pitch, 1);
			const cells = DTS.map((dt) => {
				const guardPxS = MOUSE_MAX_STEP / MOUSE_RAD_PER_PX / dt;
				return `${Math.round(1 / dt)}Hz ${Math.round(Math.min(limit, guardPxS))}`;
			});
			lines.push(
				`${id.padEnd(12)} couple ${Math.round(limit).toString().padStart(5)} px/s · max ${perf.angularMax.pitch.toFixed(2)} rad/s · limit px/s: ${cells.join("  ")}`,
			);
		}
		console.log(
			`\n#641 pointer limit, pitch = yaw on every hull:\n${lines.join("\n")}`,
		);
	});

	test("one frame reaches the spike guard, then the couple, and no more", () => {
		for (const id of HULL_IDS) {
			const perf = flightPerformance(id);
			const a = perf.angularAuthority.pitch;
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
	});
});

describe("the mouse sensitivity row (node #640)", () => {
	const steps = new SettingsStore({ ...DEFAULT_SETTINGS }).allowed(
		"mouseSensitivity",
	);
	const ends = [steps[0], steps[steps.length - 1]] as const;

	test("100% is the figure every pilot flew before the row, and it is the default", () => {
		expect(DEFAULT_SETTINGS.mouseSensitivity).toBe(1);
		expect(mouseRadPerPx(DEFAULT_SETTINGS.mouseSensitivity)).toBe(0.0022);
		expect(pointerImpulse(0, -1, DEFAULT_SETTINGS.mouseSensitivity).pitch).toBe(
			MOUSE_RAD_PER_PX,
		);
	});

	test("prints the turn per pixel at each end of the range, and the guard's pixels there", () => {
		const lines = ends.map((s) => {
			const perPx = pointerImpulse(1, 0, s).yaw;
			expect(perPx).toBeCloseTo(-MOUSE_RAD_PER_PX * s, 15);
			const courier = flightPerformance("courier").angularAuthority.yaw;
			return `${Math.round(s * 100)}%: ${(-perPx).toFixed(5)} rad/s per px · guard ${Math.round(MOUSE_MAX_STEP / -perPx)} px a frame · courier couple ${Math.round(couplePxS(courier, s))} px/s`;
		});
		console.log(
			`\n#640 turn per pixel at the ends of the range:\n${lines.join("\n")}`,
		);
		// The range brackets the old figure from both sides.
		expect(ends[0]).toBeLessThan(1);
		expect(ends[1]).toBeGreaterThan(1);
	});

	test("linear at every step: no deadzone, no curve", () => {
		for (const s of steps) {
			const one = pointerImpulse(1, 1, s);
			// One pixel turns the nose: nothing is swallowed near zero.
			expect(one.pitch).toBeLessThan(0);
			expect(one.yaw).toBeLessThan(0);
			// n pixels ask n times one pixel, up to the spike guard.
			const belowGuard = Math.floor(MOUSE_MAX_STEP / mouseRadPerPx(s));
			for (const n of [2, 3, 7, belowGuard])
				expect(pointerImpulse(n, 0, s).yaw).toBeCloseTo(n * one.yaw, 12);
		}
	});

	test("the spike guard stays in radians at every step", () => {
		for (const s of steps) {
			const huge = pointerImpulse(5000, -5000, s);
			expect(huge.yaw).toBe(-MOUSE_MAX_STEP);
			expect(huge.pitch).toBe(MOUSE_MAX_STEP);
		}
	});

	test("the couple's limit in px/s scales inversely with the row", () => {
		const a = flightPerformance("courier").angularAuthority.pitch;
		for (const s of steps)
			expect(couplePxS(a, s)).toBeCloseTo(couplePxS(a, 1) / s, 9);
	});

	test("the flick meter reads what was asked at the row's sensitivity", () => {
		const m = new FlickMeter();
		m.frame(30, 40, 1 / 60, { pitch: 0, yaw: 0 }, false, ends[1]);
		for (let i = 0; i < 20; i++)
			m.frame(0, 0, 1 / 60, { pitch: 0, yaw: 0 }, false, ends[1]);
		expect(m.last?.askedRadS).toBeCloseTo(70 * mouseRadPerPx(ends[1]), 12);
	});
});

describe("main.ts flies the pointer at the settings row", () => {
	const src = codeOf("src/main.ts");
	test("the impulse and the flick meter both read mouseSensitivity", () => {
		expect(src).toMatch(
			/const sensitivity = this\.settings\.value\.mouseSensitivity;[\s\S]{0,200}pointerImpulse\(dx, dy, sensitivity\)/,
		);
		expect(src).toMatch(/this\.assist,\s*sensitivity,\s*\);/);
	});
});

describe("stepAngular reports the impulse it could not pay", () => {
	const perf = flightPerformance("courier");
	const dt = 1 / 60;
	const step = perf.angularAuthority.pitch * dt;
	const unpaid = (stick: number, kick: number, assist = false) =>
		stepAngular(
			STILL,
			{ ...STILL, pitch: stick },
			{ ...STILL, pitch: kick },
			assist,
			dt,
			perf,
		).impulseUnpaid.pitch;

	test("a kick inside the couple is paid in full", () => {
		expect(unpaid(0, step / 2)).toBe(0);
	});
	test("a kick beyond it leaves the excess", () => {
		expect(unpaid(0, step * 3)).toBeCloseTo(step * 2, 12);
	});
	test("a full stick the same way leaves the whole kick", () => {
		expect(unpaid(1, step / 2)).toBeCloseTo(step / 2, 12);
	});
	test("a kick against the stick is paid, and nothing is left", () => {
		expect(unpaid(1, -step / 2)).toBe(0);
	});
	test("the assist on reports nothing: unpaid has no single meaning there", () => {
		expect(unpaid(0, step * 3, true)).toBe(0);
	});
});

describe("the flick meter", () => {
	const dt = 1 / 60;
	const quiet = (m: FlickMeter, frames: number) => {
		for (let i = 0; i < frames; i++)
			m.frame(0, 0, dt, { pitch: 0, yaw: 0 }, false, 1);
	};
	test("reads peak speed, asked and delivered, and closes on quiet", () => {
		const m = new FlickMeter();
		m.frame(30, 40, dt, { pitch: 0.05, yaw: 0.04 }, false, 1);
		quiet(m, 1);
		expect(m.last).toBeNull();
		quiet(m, 20);
		const last = m.last;
		expect(last).not.toBeNull();
		expect(last?.peakPxS).toBeCloseTo(50 / FLICK_PEAK_WINDOW_S, 6);
		expect(last?.askedRadS).toBeCloseTo(70 * MOUSE_RAD_PER_PX, 12);
		expect(last?.deliveredRadS).toBeCloseTo(0.09, 12);
		expect(last?.assisted).toBe(false);
		expect(m.hardest).toBe(last);
		// A slower flick after it replaces `last` and keeps `hardest`.
		m.frame(3, 0, dt, { pitch: 0, yaw: 0.006 }, false, 1);
		quiet(m, 20);
		expect(m.last?.peakPxS).toBeCloseTo(3 / FLICK_PEAK_WINDOW_S, 6);
		expect(m.hardest).toBe(last);
	});
	test("a steady movement reads its own speed, and one event cannot pin the peak", () => {
		const m = new FlickMeter();
		for (let i = 0; i < 30; i++)
			m.frame(20, 0, dt, { pitch: 0, yaw: 0 }, false, 1);
		quiet(m, 30);
		expect(m.last?.peakPxS).toBeCloseTo(20 / dt, 6);
		// 600 px in one frame is 36,000 px/s read over that frame alone.
		m.frame(600, 0, dt, { pitch: 0, yaw: 0 }, false, 1);
		quiet(m, 30);
		expect(m.last?.peakPxS).toBeCloseTo(600 / FLICK_PEAK_WINDOW_S, 6);
	});
	test("a flick's duration runs from its first move to its last", () => {
		const m = new FlickMeter();
		for (let i = 0; i < 6; i++)
			m.frame(10, 0, dt, { pitch: 0, yaw: 0 }, false, 1);
		quiet(m, 30);
		expect(m.last?.durationS).toBeCloseTo(6 * dt, 9);
	});
	test("a flick with the assist on for any frame is marked assisted", () => {
		const m = new FlickMeter();
		m.frame(10, 0, dt, { pitch: 0, yaw: 0 }, false, 1);
		m.frame(10, 0, dt, { pitch: 0, yaw: 0 }, true, 1);
		quiet(m, 30);
		expect(m.last?.assisted).toBe(true);
	});
});

describe("main.ts drops the pointer in one place", () => {
	const src = codeOf("src/main.ts");
	const body = (name: string) => methodBodyOf(src, name, "src/main.ts");
	test("only dropPointer and takePointer zero the delta", () => {
		expect((src.match(/this\.mouseD[xy] = 0;/g) ?? []).length).toBe(4);
		for (const name of ["dropPointer", "takePointer"])
			expect((body(name).match(/this\.mouseD[xy] = 0;/g) ?? []).length).toBe(2);
	});
	test("dropping the pointer drops the flick being read", () => {
		expect(body("dropPointer")).toContain("this.flickMeter.reset()");
	});
});
