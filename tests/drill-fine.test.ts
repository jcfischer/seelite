import { describe, expect, test } from "bun:test";
import { anchorPose } from "../spikes/longwall-miner/kinematics";
import { HULL_SPECS } from "../src/hull";
import {
	DRILL,
	DRILL_SURFACE_SHARE,
	FINE,
	fineDemand,
	fineReadout,
	holdAllowed,
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
		expect(rescaleThrottle(0.002, ASSIST_CAP_KMS, FINE.surgeCapKms)).toBeCloseTo(
			0.4,
			9,
		);
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

	test("the hold needs the feed out, every foot on rock and the speed window", () => {
		const ok = {
			extension: 1,
			feetOnRock: 4,
			feetNeeded: 4,
			closingKms: 0,
			slideKms: 0,
		};
		expect(holdAllowed(ok)).toBe("OK");
		expect(holdAllowed({ ...ok, extension: 0.9 })).toBe("DEPLOYING");
		expect(holdAllowed({ ...ok, feetOnRock: 3 })).toBe("FEET");
		expect(holdAllowed({ ...ok, closingKms: DRILL.closingKms * 1.1 })).toBe(
			"CLOSING",
		);
		expect(holdAllowed({ ...ok, closingKms: -DRILL.closingKms * 1.1 })).toBe(
			"CLOSING",
		);
		expect(holdAllowed({ ...ok, slideKms: DRILL.slideKms * 1.1 })).toBe(
			"SLIDING",
		);
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
