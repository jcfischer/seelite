/**
 * The production duel step (node #324 part b): the player and a raider under
 * one condition model, one pulse laser and #53's controller.
 */
import { describe, expect, test } from "bun:test";
import {
	ENEMY_COLLISION_RADIUS_KM,
	PLAYER_LASER_RANGE_KM,
	playerLaserHit,
} from "../src/combat-enemy";
import {
	type DuelPilot,
	RAIDER_ESCAPE_KM,
	RAIDER_HIT_RADIUS_KM,
	type Raider,
	raiderAtDrop,
	raiderInSights,
	stepDuel,
} from "../src/duel";
import { HULL_SPECS } from "../src/hull";
import {
	PULSE_LASER,
	SHIELD_POOL,
	fullCondition,
	stepCondition,
} from "../src/ship-condition";
import { type Vec3, scale, v3 } from "../src/vec3";

const DT = 1 / 60;
const FORWARD = v3(0, 0, -1);

function pilot(over: Partial<DuelPilot> = {}): DuelPilot {
	const ship = { pos: v3(0, 0, 0), vel: v3(0, 0, 0) };
	return {
		ship,
		nose: FORWARD,
		aimOrigin: ship.pos,
		aimNose: FORWARD,
		hull: fullCondition("courier").hull,
		frameVel: v3(0, 0, 0),
		...over,
	};
}

/** A raider `km` dead ahead of the player, nose back at them. */
function raiderAhead(km: number): Raider {
	return {
		flight: raiderAtDrop(v3(0, 0, -km), pilot().ship, 7),
		condition: fullCondition("raider"),
	};
}

const SHOT = { fired: true, damage: PULSE_LASER.damagePerS * DT };

describe("the hit sphere", () => {
	test("is the raider's true half-length, not the rig's drawn 3x", () => {
		expect(RAIDER_HIT_RADIUS_KM).toBe(HULL_SPECS.raider.env.lengthKm / 2);
		expect(RAIDER_HIT_RADIUS_KM).toBeLessThan(ENEMY_COLLISION_RADIUS_KM);
	});

	test("a shot inside the rig's sphere but outside the true one misses", () => {
		const aside = (RAIDER_HIT_RADIUS_KM + ENEMY_COLLISION_RADIUS_KM) / 2;
		const enemy = v3(aside, 0, -3);
		expect(playerLaserHit(v3(0, 0, 0), FORWARD, enemy).hit).toBe(true);
		expect(
			playerLaserHit(v3(0, 0, 0), FORWARD, enemy, RAIDER_HIT_RADIUS_KM).hit,
		).toBe(false);
	});
});

describe("the HUD's on-target mark (part c)", () => {
	test("agrees with the duel's own hit at the true radius, not the rig's", () => {
		// Between the two radii the rig's beam lands and the duel's does not; the
		// mark must side with the duel, or it promises a hit that never comes.
		const aside = (RAIDER_HIT_RADIUS_KM + ENEMY_COLLISION_RADIUS_KM) / 2;
		const between = v3(aside, 0, -3);
		expect(raiderInSights(v3(0, 0, 0), FORWARD, between)).toBe(false);
		const r = raiderAhead(3);
		const off: Raider = {
			...r,
			flight: {
				...r.flight,
				ship: { ...r.flight.ship, pos: between },
			},
		};
		expect(stepDuel(off, pilot(), SHOT, DT).playerHit).toBe(false);
		const inside = v3(RAIDER_HIT_RADIUS_KM / 2, 0, -3);
		expect(raiderInSights(v3(0, 0, 0), FORWARD, inside)).toBe(true);
	});

	test("reads the sightline, so looking off the nose moves the mark", () => {
		const ahead = v3(0, 0, -3);
		expect(raiderInSights(v3(0, 0, 0), FORWARD, ahead)).toBe(true);
		expect(raiderInSights(v3(0, 0, 0), v3(1, 0, 0), ahead)).toBe(false);
	});
});

describe("the player's shot", () => {
	test("lands on the raider's pool facing the player", () => {
		const step = stepDuel(raiderAhead(3), pilot(), SHOT, DT);
		expect(step.playerHit).toBe(true);
		expect(step.raider.condition.fore).toBeCloseTo(
			SHIELD_POOL - SHOT.damage,
			9,
		);
		expect(step.raider.condition.aft).toBe(SHIELD_POOL);
	});

	test("an aim off the raider does nothing to it", () => {
		const step = stepDuel(
			raiderAhead(3),
			pilot({ aimNose: v3(1, 0, -1) }),
			SHOT,
			DT,
		);
		expect(step.playerHit).toBe(false);
		expect(step.raider.condition.fore).toBe(SHIELD_POOL);
	});

	test("an unfired gun does nothing, however well aimed", () => {
		const step = stepDuel(
			raiderAhead(3),
			pilot(),
			{ fired: false, damage: 0 },
			DT,
		);
		expect(step.playerHit).toBe(false);
		expect(step.raider.condition.fore).toBe(SHIELD_POOL);
	});

	test("a raider whose hull reaches zero is destroyed", () => {
		const r = raiderAhead(3);
		const nearlyDead: Raider = {
			...r,
			condition: { ...r.condition, fore: 0, hull: SHOT.damage / 2 },
		};
		expect(stepDuel(nearlyDead, pilot(), SHOT, DT).raiderDestroyed).toBe(true);
	});
});

describe("the raider's fire", () => {
	/** Step until the raider fires, returning that step. */
	function firstShot(r: Raider, p: DuelPilot) {
		let raider = r;
		for (let i = 0; i < 600; i++) {
			const step = stepDuel(raider, p, { fired: false, damage: 0 }, DT);
			if (step.raiderHit) return { step, before: raider };
			raider = step.raider;
		}
		throw new Error("the raider never fired");
	}

	test("is returned for the caller to land, at the pulse's rate", () => {
		const { step } = firstShot(raiderAhead(3), pilot());
		expect(step.raiderHit?.amount).toBeCloseTo(PULSE_LASER.damagePerS * DT, 9);
	});

	test("strikes the player's fore pool from ahead and the aft pool from behind", () => {
		expect(firstShot(raiderAhead(3), pilot()).step.raiderHit?.side).toBe(
			"fore",
		);
		// The player facing away from the raider: it is on their six.
		expect(
			firstShot(
				raiderAhead(3),
				pilot({ nose: v3(0, 0, 1), aimNose: v3(0, 0, 1) }),
			).step.raiderHit?.side,
		).toBe("aft");
	});

	test("costs the raider energy and heat through the same step as the player's gun", () => {
		const { step, before } = firstShot(raiderAhead(3), pilot());
		const expected = stepCondition(before.condition, DT, true).condition;
		expect(step.raider.condition.energy).toBeCloseTo(expected.energy, 9);
		expect(step.raider.condition.heat).toBeCloseTo(expected.heat, 9);
	});

	test("a dead player is not fired upon", () => {
		let raider = raiderAhead(3);
		for (let i = 0; i < 600; i++) {
			const step = stepDuel(
				raider,
				pilot({ hull: 0 }),
				{ fired: false, damage: 0 },
				DT,
			);
			expect(step.raiderHit).toBeNull();
			raider = step.raider;
		}
	});
});

/**
 * #367 D3. `FLED_KM` was 25 km against a beam that stops at 12, and both ships
 * are capped at 2 km/s, so a raider in that band could neither be hit nor
 * leave. The exit is now one figure derived from the beam's own reach.
 */
describe("out of the beam is out of the fight (#367 D3)", () => {
	const straightAt = (km: number) => scale(FORWARD, km);

	test("the escape distance is the beam's reach at the raider's own size", () => {
		expect(RAIDER_ESCAPE_KM).toBeCloseTo(
			Math.hypot(PLAYER_LASER_RANGE_KM, RAIDER_HIT_RADIUS_KM),
			9,
		);
	});

	test("it is not the figure it was, which was twice the beam", () => {
		expect(RAIDER_ESCAPE_KM).toBeLessThan(PLAYER_LASER_RANGE_KM * 1.01);
	});

	test("dead ahead, a raider inside it can be hit and one outside it cannot", () => {
		for (const km of [
			RAIDER_ESCAPE_KM * 0.5,
			RAIDER_ESCAPE_KM * 0.9,
			RAIDER_ESCAPE_KM * 0.9999,
		])
			expect(
				playerLaserHit(v3(), FORWARD, straightAt(km), RAIDER_HIT_RADIUS_KM).hit,
			).toBe(true);
		for (const km of [
			RAIDER_ESCAPE_KM * 1.0001,
			RAIDER_ESCAPE_KM * 1.5,
			RAIDER_ESCAPE_KM * 2,
		])
			expect(
				playerLaserHit(v3(), FORWARD, straightAt(km), RAIDER_HIT_RADIUS_KM).hit,
			).toBe(false);
	});

	test("the mark says the same thing the beam does at that distance", () => {
		for (const km of [RAIDER_ESCAPE_KM * 0.9, RAIDER_ESCAPE_KM * 1.5])
			expect(raiderInSights(v3(), FORWARD, straightAt(km))).toBe(
				playerLaserHit(v3(), FORWARD, straightAt(km), RAIDER_HIT_RADIUS_KM).hit,
			);
	});
});

describe("a raider at the drop", () => {
	test("moves with the player, noses onto them, and starts acquiring", () => {
		const player = { pos: v3(5, 0, 0), vel: v3(0.3, 0, -1.2) };
		const flight = raiderAtDrop(v3(5, 0, 30), player, 3);
		expect(flight.ship.vel).toEqual(player.vel);
		expect(flight.nose.z).toBeCloseTo(-1, 12);
		expect(flight.phase).toBe("acquire");
		// The roll reference is a frame: perpendicular to the nose and unit.
		const dot =
			flight.up.x * flight.nose.x +
			flight.up.y * flight.nose.y +
			flight.up.z * flight.nose.z;
		expect(dot).toBeCloseTo(0, 12);
		expect(Math.hypot(flight.up.x, flight.up.y, flight.up.z)).toBeCloseTo(
			1,
			12,
		);
	});
});
