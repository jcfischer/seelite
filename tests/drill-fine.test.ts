import { describe, expect, test } from "bun:test";
import { anchorPose } from "../spikes/longwall-miner/kinematics";
import { HULL_SPECS } from "../src/hull";
import {
	DRILL,
	DRILL_SURFACE_SHARE,
	FINE,
	fineDemand,
	fineReadout,
	ANCHOR,
	anchorAllowed,
	drillFaceKm,
	FINE_STICK,
	seatBlend,
	seatPose,
	longwallFrame,
	rescaleThrottle,
	shipPointKm,
	stepDrillSurface,
	strutPose,
	strutReach,
} from "../src/rock-drill";
import {
	ASSIST_CAP_KMS,
	flightPerformance,
	type LinearDemand,
	type Ship,
	stepHull,
} from "../src/sim";
import { dot, length, sub, v3 } from "../src/vec3";

const cutter = HULL_SPECS.miner.cutter;
if (!cutter) throw new Error("the miner carries a cutter");
const PERF = flightPerformance("miner");
const NOSE = v3(0, 0, -1);
const UP = v3(0, 1, 0);
const STILL = { pitch: 0, yaw: 0, roll: 0 };
const SURFACE_VEL = v3(0.004, -0.002, 0.003);
const DT = 1 / 60;

const fly = (ship: Ship, demand: LinearDemand, seconds: number) => {
	for (let s = 0; s < seconds - 1e-9; s += DT)
		stepHull(
			ship,
			{ nose: NOSE, up: UP, rates: STILL },
			{
				stick: STILL,
				turnAssist: true,
				translation: {
					demand,
					assist: true,
					frame: { start: SURFACE_VEL, end: SURFACE_VEL },
				},
			},
			DT,
			PERF,
		);
};
const against = (ship: Ship) => sub(ship.vel, SURFACE_VEL);
const lever = (throttle: number): LinearDemand => ({
	surge: throttle,
	sway: 0,
	heave: 0,
});

describe("fine control: what one input changes, flown through the miner's Hull step", () => {
	test("one frame of the throttle key moves the held closing speed by surgeCap / 60", () => {
		const tap = DT;
		const ship = { pos: v3(), vel: { ...SURFACE_VEL } };
		fly(ship, fineDemand(lever(tap)), 3);
		const closing = dot(against(ship), NOSE);
		expect(closing).toBeCloseTo((FINE.surgeCapKms * tap) / 1, 6);
		expect(closing * 1000).toBeLessThan(0.2);
		const coarse = { pos: v3(), vel: { ...SURFACE_VEL } };
		fly(coarse, lever(tap), 3);
		expect(dot(against(coarse), NOSE) * 1000).toBeGreaterThan(30);
	});

	test("a lever at 10% holds 1 m/s closing, inside the 2 m/s window, for 10 s", () => {
		const ship = { pos: v3(), vel: { ...SURFACE_VEL } };
		fly(ship, fineDemand(lever(0.1)), 2);
		let worst = 0;
		for (let i = 0; i < 600; i++) {
			fly(ship, fineDemand(lever(0.1)), DT);
			worst = Math.max(worst, Math.abs(dot(against(ship), NOSE) - 0.001));
		}
		expect(worst * 1000).toBeLessThan(0.01);
		expect(FINE.surgeCapKms * 0.1).toBeLessThan(DRILL.closingKms);
	});

	test("a held strafe key slides at strafeCap, inside the 3 m/s window, and a tap leaves nothing", () => {
		const ship = { pos: v3(), vel: { ...SURFACE_VEL } };
		fly(ship, fineDemand({ surge: 0, sway: 1, heave: 0 }), 3);
		expect(length(against(ship))).toBeLessThanOrEqual(FINE.strafeCapKms);
		expect(length(against(ship))).toBeGreaterThan(FINE.strafeCapKms / 2);
		expect(FINE.strafeCapKms).toBeLessThan(DRILL.slideKms);
		const tapped = { pos: v3(), vel: { ...SURFACE_VEL } };
		fly(tapped, fineDemand({ surge: 0, sway: 1, heave: 0 }), DT);
		const peak = length(against(tapped));
		fly(tapped, fineDemand(lever(0)), 2);
		expect(peak).toBeLessThanOrEqual(FINE.strafeCapKms + 1e-9);
		expect(length(against(tapped)) * 1000).toBeLessThan(0.01);
	});

	test("entering and leaving fine control keeps the asked speed", () => {
		expect(
			rescaleThrottle(0.002, ASSIST_CAP_KMS, FINE.surgeCapKms),
		).toBeCloseTo(0.4, 9);
		expect(rescaleThrottle(0.3, ASSIST_CAP_KMS, FINE.surgeCapKms)).toBe(1);
		expect(rescaleThrottle(0.4, FINE.surgeCapKms, ASSIST_CAP_KMS)).toBeCloseTo(
			0.002,
			9,
		);
	});

	test("the readout splits the speed against the frame along and across the nose", () => {
		const r = fineReadout(NOSE, v3(0.001, 0, -0.0015), v3(), 0.03);
		expect(r.closingKms).toBeCloseTo(0.0015, 12);
		expect(r.slideKms).toBeCloseTo(0.001, 12);
	});
});

describe("the Longwall frame", () => {
	const frame = longwallFrame(cutter);
	test("the stowed rotor face is the bow plane, its axis downKm below the ship's", () => {
		const face = frame.toShip([0, -5, 37.4]);
		expect(face.fore).toBeCloseTo(cutter.bowKm * 1000, 9);
		expect(face.up).toBeCloseTo(-cutter.downKm * 1000, 9);
		expect(face.starboard).toBeCloseTo(0, 12);
		const back = frame.toExport(frame.toShip([3, -2, 10]));
		expect(back[0]).toBeCloseTo(3, 12);
		expect(back[1]).toBeCloseTo(-2, 12);
		expect(back[2]).toBeCloseTo(10, 12);
	});

	test("starboard is nose × up, so the export's −x is the ship's right", () => {
		const right = shipPointKm(v3(), NOSE, UP, frame.toShip([-1000, 0, 0]));
		expect(right.x).toBeGreaterThan(0.99);
	});
});

describe("the struts (D-D1)", () => {
	test("stowed is the export's pose; deployed reaches the target found", () => {
		for (let i = 0; i < 4; i++) {
			const stowed = strutPose(i, 0, [20, 0, 50]);
			expect(stowed.foot).toEqual(anchorPose(i, 0).foot as typeof stowed.foot);
			const target = [i % 2 ? 15 : -15, 4, 46] as [number, number, number];
			expect(strutPose(i, 1, target).foot).toEqual(target);
		}
	});

	test("the study's deployed foot is inside a strut's reach", () => {
		for (let i = 0; i < 4; i++) {
			const r = strutReach(i);
			const d = Math.hypot(
				r.foot[0] - r.base[0],
				r.foot[1] - r.base[1],
				r.foot[2] - r.base[2],
			);
			expect(d).toBeLessThan(r.reachM);
		}
	});

	test("key 4 anchors with the cutter or one foot in reach, below scrape speed", () => {
		const ok = { extension: 1, faceGapKm: 0.01, feetOnRock: 0, relKms: 0.02 };
		expect(anchorAllowed(ok)).toBe("OK");
		expect(anchorAllowed({ ...ok, faceGapKm: null, feetOnRock: 1 })).toBe("OK");
		expect(anchorAllowed({ ...ok, extension: 0.5 })).toBe("DEPLOYING");
		expect(
			anchorAllowed({ ...ok, faceGapKm: ANCHOR.reachKm * 1.1, feetOnRock: 0 }),
		).toBe("NO ROCK IN REACH");
		expect(anchorAllowed({ ...ok, relKms: ANCHOR.maxKms * 1.1 })).toBe(
			"TOO FAST",
		);
		expect(ANCHOR.maxKms).toBe(0.05);
	});

	test("the seat squares the nose into the surface with the cutter face gapKm off it", () => {
		const n = { x: 0.6, y: 0, z: 0.8 };
		const point = v3(1, 2, 3);
		const seat = seatPose(point, n, v3(0, 1, 0), cutter);
		expect(dot(seat.nose, n)).toBeCloseTo(-1, 12);
		expect(dot(seat.up, seat.nose)).toBeCloseTo(0, 12);
		const face = drillFaceKm(seat.pos, seat.nose, seat.up, cutter, 1);
		const gap = sub(face, point);
		expect(length(gap)).toBeCloseTo(ANCHOR.gapKm, 12);
		expect(dot(gap, n)).toBeCloseTo(ANCHOR.gapKm, 12);
		expect(seatBlend(0)).toBe(0);
		expect(seatBlend(1)).toBe(1);
		expect(seatBlend(0.5)).toBe(0.5);
	});
});

describe("fine control on the turn keys (A and D yaw, S and W pitch, F faces)", () => {
	const LEVER_KM = cutter.bowKm + cutter.feedTravelKm;
	const tapPeak = (axis: "yaw" | "pitch", share: number, frames: number) => {
		let rates = { pitch: 0, yaw: 0, roll: 0 };
		let attitude = { nose: NOSE, up: UP };
		let peak = 0;
		const ship = { pos: v3(), vel: v3() };
		for (let i = 0; i < 240; i++) {
			const stick = { pitch: 0, yaw: 0, roll: 0 };
			if (i < frames) stick[axis] = share;
			const step = stepHull(
				ship,
				{ ...attitude, rates },
				{
					stick,
					turnAssist: true,
					translation: { demand: lever(0), assist: true },
				},
				DT,
				PERF,
			);
			rates = step.rates;
			attitude = { nose: step.nose, up: step.up };
			peak = Math.max(peak, Math.abs(rates[axis]));
		}
		return { peak, rest: Math.abs(rates[axis]) };
	};

	test("one frame of A, D or S peaks under 1 m/s at the cutter face with fine control, and stops", () => {
		for (const axis of ["yaw", "pitch"] as const) {
			const coarse = tapPeak(axis, 1, 1);
			const fine = tapPeak(axis, FINE_STICK, 1);
			expect(fine.peak * LEVER_KM * 1000).toBeLessThan(1);
			expect(fine.peak).toBeLessThan(coarse.peak);
			expect(fine.rest * LEVER_KM * 1000).toBeLessThan(0.01);
		}
	});

	test("a held turn key, or the full-stick turn F flies, moves the face under the 3 m/s slide window", () => {
		for (const axis of ["yaw", "pitch"] as const) {
			const held = tapPeak(axis, FINE_STICK, 240);
			expect(held.peak * LEVER_KM).toBeLessThan(DRILL.slideKms);
		}
	});
});

describe("surface drilling (D-D3)", () => {
	const run = (seconds: number, holdFreeT: number, reserveLeftT: number) => {
		let cut = { key: null as string | null, oreT: 0, wasteT: 0 };
		let ore = 0;
		let waste = 0;
		const stops = new Set<string>();
		for (let s = 0; s < seconds - 1e-9; s += DT) {
			const step = stepDrillSurface(cut, {
				key: "rock:a:1",
				powered: true,
				spin: 1,
				rateTPerS: DRILL.rateTPerS,
				dt: DT,
				holdFreeT: holdFreeT - ore,
				reserveLeftT: reserveLeftT - ore,
			});
			cut = step.cut;
			ore += step.ore;
			waste += step.waste;
			if (step.stop) stops.add(step.stop);
		}
		return { ore, waste, stops };
	};

	test("it cuts at the drill's rate at the laser's grade-E share", () => {
		const r = run(20.1, 1e9, 1e9);
		expect(DRILL_SURFACE_SHARE).toBe(0.5);
		expect(r.ore).toBe(Math.floor(20 * DRILL.rateTPerS * DRILL_SURFACE_SHARE));
		expect(r.waste).toBe(r.ore);
	});

	test("a full hold stops it at capacity, an empty surface leaves only waste", () => {
		const full = run(30, 2, 1e9);
		expect(full.ore).toBe(2);
		expect(full.stops.has("HOLD FULL")).toBe(true);
		const spent = run(30, 1e9, 3);
		expect(spent.ore).toBe(3);
		expect(spent.stops.has("DEPLETED")).toBe(true);
	});

	test("no power, no output", () => {
		const s = stepDrillSurface(
			{ key: "rock:a:1", oreT: 0.9, wasteT: 0.9 },
			{
				key: "rock:a:1",
				powered: false,
				spin: 1,
				rateTPerS: 1,
				dt: 1,
				holdFreeT: 10,
				reserveLeftT: 10,
			},
		);
		expect(s.ore + s.waste).toBe(0);
	});
});

test("every strut aims at the cutter's face plane, so the four reach alike", () => {
	const reaches = [0, 1, 2, 3].map((i) => strutReach(i));
	for (const r of reaches) expect(r.foot[2]).toBe(48);
	expect(reaches[0].reachM).toBeCloseTo(reaches[1].reachM, 9);
	expect(reaches[2].reachM).toBeCloseTo(reaches[3].reachM, 9);
});
