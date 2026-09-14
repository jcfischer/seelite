/**
 * One step of a production duel between the player and a raider (node #324
 * part b), in the authoritative sim.
 *
 * **The same rules on both sides (`combat-model.md` §1).** Both ships carry a
 * `ShipCondition` and both guns go through `stepCondition`: the player's is
 * stepped by `Game` every frame with the pilot's trigger, and the raider's
 * here with the trigger #53's controller pulls — which is gated on its nose
 * being on the player, and is the controller's trigger discipline rather than
 * a different weapon. A hit selects the pool facing the shooter on either
 * side, and the raider is hit-tested at its hull's true size rather than the
 * rig's drawn 3x.
 *
 * **What it returns rather than does.** The raider's hit on the player comes
 * back as an amount and a side for `Game.takeDamage` to land, because that is
 * the one place damage lands on the player and it cancels a jump charge and a
 * spool-up on the way. This module owns no world and no renderer.
 */
import {
	type CombatEnemyState,
	type EnemyReadout,
	stepCombatEnemy,
} from "./combat-enemy";
import { HULL_SPECS } from "./hull";
import { RAIDER_HULL_ID } from "./raider-slots";
import {
	type ShieldSide,
	type ShipCondition,
	applyDamage,
	isAlive,
	sideStruck,
	stepCondition,
} from "./ship-condition";
import type { Ship } from "./sim";
import { type Vec3, cross, length, scale, sub, v3 } from "./vec3";

/** The raider's hit sphere: half its built length. */
export const RAIDER_HIT_RADIUS_KM = HULL_SPECS[RAIDER_HULL_ID].env.lengthKm / 2;

export interface Raider {
	flight: CombatEnemyState;
	condition: ShipCondition;
}

/** What the duel reads of the player this step. */
export interface DuelPilot {
	ship: Ship;
	nose: Vec3;
	/** The cockpit sightline, which the beam follows (not always the nose). */
	aimOrigin: Vec3;
	aimNose: Vec3;
	hull: number;
}

/** The player's gun this step, as `stepCondition` already settled it. */
export interface PlayerShot {
	fired: boolean;
	damage: number;
}

export interface DuelStep {
	raider: Raider;
	/** Whether the player's shot this step struck the raider. */
	playerHit: boolean;
	/** The raider's fire this step, for `Game.takeDamage` to land, or null. */
	raiderHit: { amount: number; side: ShieldSide } | null;
	raiderDestroyed: boolean;
}

const unit = (v: Vec3, fallback: Vec3): Vec3 => {
	const m = length(v);
	return m === 0 ? fallback : scale(v, 1 / m);
};

/**
 * A raider's flight state at the moment a contest drops both ships out of
 * cruise: where the contest left it, moving with the player, nose on them, and
 * starting #53's machine from `acquire`.
 */
export function raiderAtDrop(
	pos: Vec3,
	player: Ship,
	seed: number,
): CombatEnemyState {
	const nose = unit(sub(player.pos, pos), v3(0, 0, -1));
	const reference = Math.abs(nose.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0);
	const across = unit(cross(nose, reference), v3(1, 0, 0));
	return {
		ship: { pos: { ...pos }, vel: { ...player.vel } },
		nose,
		up: cross(across, nose),
		phase: "acquire",
		phaseSeconds: 0,
		maneuverSeconds: 30,
		evadeCooldown: 0,
		pullAxis: across,
		seed,
		draws: 8,
	};
}

export function stepDuel(
	raider: Raider,
	pilot: DuelPilot,
	shot: PlayerShot,
	dt: number,
): DuelStep {
	const readout: EnemyReadout = {
		targetHull: raider.condition.hull,
		targetHullMax: raider.condition.hullMax,
		targetEnergy: raider.condition.energy,
		targetHeatLocked: raider.condition.heatLocked,
		playerHull: pilot.hull,
	};
	// The hit test inside the controller is against the raider's position at
	// the top of the step, which is where the player aimed.
	const before = raider.flight.ship.pos;
	const flown = stepCombatEnemy(
		raider.flight,
		pilot.ship,
		pilot.nose,
		readout,
		shot.fired,
		dt,
		pilot.aimOrigin,
		pilot.aimNose,
		RAIDER_HIT_RADIUS_KM,
	);

	let condition = raider.condition;
	const playerHit = shot.fired && shot.damage > 0 && flown.targetInCone;
	if (playerHit)
		condition = applyDamage(
			condition,
			shot.damage,
			sideStruck(raider.flight.nose, sub(pilot.ship.pos, before)),
		);

	// Its own gun, through the same step the player's goes through. A dead
	// raider pulls no trigger.
	const gun = stepCondition(
		condition,
		dt,
		isAlive(condition) && flown.enemyFiring,
	);
	condition = gun.condition;
	const raiderHit =
		gun.fired && gun.damage > 0 && pilot.hull > 0
			? {
					amount: gun.damage,
					side: sideStruck(pilot.nose, sub(before, pilot.ship.pos)),
				}
			: null;

	return {
		raider: { flight: flown.state, condition },
		playerHit,
		raiderHit,
		raiderDestroyed: !isAlive(condition),
	};
}
