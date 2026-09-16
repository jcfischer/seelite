/**
 * An ordinary carrier under fire (`civilian-combat.md` H2, H3): the shared
 * condition model, its own hull's handling, and a reaction per role.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	ARMED_TRAFFIC_HULLS,
	type Engagement,
	engage,
	stepEngagement,
	trafficHitRadiusKm,
	trafficInSights,
} from "../src/civilian-combat";
import type { DuelPilot } from "../src/duel";
import { HULL_SPECS, type HullId } from "../src/hull";
import { PULSE_LASER, SHIELD_POOL, fullCondition } from "../src/ship-condition";
import { flightPerformance } from "../src/sim";
import { length, normalizeOr, sub, v3 } from "../src/vec3";

const DT = 1 / 60;
const KEY = carrierKey(12, "station-trade/traffic-02");

/** A civilian `km` ahead of a stationary player, flying away at rest. */
function ahead(hullId: HullId, km: number, seed = 5): Engagement {
	return engage(
		{
			key: KEY,
			hullId,
			pos: v3(0, 0, -km),
			vel: v3(),
			nose: v3(0, 0, -1),
			up: v3(0, 1, 0),
		},
		seed,
	);
}

/** A pilot who keeps the nose and the beam on the target and holds the trigger. */
function chaser(
	target: Engagement,
	from: { pos: ReturnType<typeof v3> },
): DuelPilot {
	const nose = normalizeOr(sub(target.flight.ship.pos, from.pos), v3(0, 0, -1));
	return {
		ship: { pos: from.pos, vel: v3() },
		nose,
		aimOrigin: from.pos,
		aimNose: nose,
		hull: 100,
		frameVel: v3(),
	};
}

const SHOT = { fired: true, damage: PULSE_LASER.damagePerS * DT };

describe("H2: the shared condition model", () => {
	test("an engaged carrier starts at its hull's full condition", () => {
		for (const hull of ["freighter", "miner", "courier", "patrol"] as const)
			expect(ahead(hull, 2).condition).toEqual(fullCondition(hull));
	});

	test("is hit at its own hull's half-length", () => {
		expect(trafficHitRadiusKm("freighter")).toBe(
			HULL_SPECS.freighter.env.lengthKm / 2,
		);
		const r = trafficHitRadiusKm("freighter");
		expect(
			trafficInSights(v3(), v3(0, 0, -1), v3(r * 0.9, 0, -2), "freighter"),
		).toBe(true);
		expect(
			trafficInSights(v3(), v3(0, 0, -1), v3(r * 1.1, 0, -2), "freighter"),
		).toBe(false);
	});

	test("dies after about a shield side and its hull on target", () => {
		// Held in the beam, recharge never starts: every frame is a hit.
		let e = ahead("courier", 1);
		let frames = 0;
		for (; frames < 60 * 120; frames++) {
			// Pin it in the beam so the row is about the arithmetic, not the chase.
			e = {
				...e,
				flight: { ...e.flight, ship: { pos: v3(0, 0, -1), vel: v3() } },
			};
			const step = stepEngagement(e, chaser(e, { pos: v3() }), SHOT, DT);
			e = step.engagement;
			if (step.destroyed) break;
		}
		const seconds = frames * DT;
		const expected =
			(SHIELD_POOL + HULL_SPECS.courier.integrity) / PULSE_LASER.damagePerS;
		expect(seconds).toBeGreaterThan(expected - 1);
		expect(seconds).toBeLessThan(expected + 1);
	});
});

describe("H3: the reaction per role", () => {
	test("the armed roles are patrol and interceptor", () => {
		expect([...ARMED_TRAFFIC_HULLS].sort()).toEqual(["interceptor", "patrol"]);
	});

	/**
	 * The engagement's opening: a pilot holding still, beam on the ship, who
	 * fires for the first `strikeS` seconds and then lets go.
	 */
	function fly(hull: HullId, seconds: number, strikeS = 1) {
		let e = ahead(hull, 3, 11);
		const phases = new Set<string>();
		let fired = false;
		const player = v3(0, 0, 0);
		for (let t = 0; t < seconds; t += DT) {
			const pilot = chaser(e, { pos: player });
			const shot = t < strikeS ? SHOT : { fired: false, damage: 0 };
			const step = stepEngagement(e, pilot, shot, DT);
			e = step.engagement;
			phases.add(e.flight.phase);
			if (step.returnFire) fired = true;
			if (step.destroyed) break;
		}
		return { phases, fired, e };
	}

	test("a civilian hull only evades and flees, and never fires", () => {
		for (const hull of ["freighter", "miner", "courier", "tug"] as const) {
			// Held under fire the whole time, which is when an attacker would
			// shoot back.
			const run = fly(hull, 30, 30);
			expect(run.fired).toBe(false);
			for (const phase of run.phases)
				expect(["evade", "flee"]).toContain(phase);
		}
	});

	test("an armed hull fights back", () => {
		const run = fly("patrol", 30);
		expect(run.fired).toBe(true);
		expect(run.phases.has("attack")).toBe(true);
	});

	test("flies on its own hull's thrust, not the raider's", () => {
		let e = ahead("freighter", 5);
		const pilot: DuelPilot = {
			ship: { pos: v3(0, 0, 0), vel: v3() },
			nose: v3(1, 0, 0),
			aimOrigin: v3(),
			aimNose: v3(1, 0, 0),
			hull: 100,
			frameVel: v3(),
		};
		// A fleeing ship already nosed away runs at full throttle.
		e = { ...e, flight: { ...e.flight, phase: "flee", maneuverSeconds: 30 } };
		const quiet = { fired: false, damage: 0 };
		const steps = 30;
		for (let i = 0; i < steps; i++)
			e = stepEngagement(e, pilot, quiet, DT).engagement;
		const speed = length(e.flight.ship.vel);
		const expected = flightPerformance("freighter").thrustKms2 * steps * DT;
		expect(speed).toBeCloseTo(expected, 2);
		expect(speed).toBeLessThan(
			flightPerformance("raider").thrustKms2 * steps * DT,
		);
	});
});
