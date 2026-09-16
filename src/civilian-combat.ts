/**
 * An ordinary carrier under fire (`civilian-combat.md` H2, H3), in the
 * authoritative sim.
 *
 * **A civilian is a combat ship** (H2). An engaged carrier carries its hull's
 * `fullCondition`, is hit at its hull's half-length as the raider is, and flies
 * `stepEnemyShip` on its own hull's `flightPerformance` — so a freighter turns
 * and accelerates like a freighter, and `combat-model.md` §1's shared rules hold
 * without a second model.
 *
 * **The reaction is per role** (H3). Patrol and interceptor hulls take the
 * attacker's intent and fight back; every other hull takes the civilian intent,
 * which spirals while hit, runs otherwise and never fires. An engagement exists
 * only once a shot has landed, so an armed hull returns fire and never starts a
 * fight: pursuing a Wanted pilot would be police AI, which #362 excludes.
 *
 * **What it returns rather than does**, as `duel.ts`: return fire comes back
 * for `Game.takeDamage`, and a kill comes back as a flag for `Game` to turn
 * into a world-state destroy, a drop and a heat write. No world, no renderer.
 */
import type { CarrierKey } from "./carrier-key";
import {
	type CombatEnemyState,
	type EnemyReadout,
	NO_ROTATION,
	playerLaserHit,
	stepEnemyShip,
} from "./combat-enemy";
import type { DuelPilot, PlayerShot } from "./duel";
import { HULL_SPECS, type HullId } from "./hull";
import {
	type ShieldSide,
	type ShipCondition,
	applyDamage,
	fullCondition,
	isAlive,
	sideStruck,
	stepCondition,
} from "./ship-condition";
import { flightPerformance } from "./sim";
import { type Vec3, frameAcross, sub } from "./vec3";

/** The roles that fight back when struck (H3). */
export const ARMED_TRAFFIC_HULLS: ReadonlySet<HullId> = new Set<HullId>([
	"patrol",
	"interceptor",
]);

/** A carrier's hit sphere: its hull's half-length, as the raider's is. */
export const trafficHitRadiusKm = (hullId: HullId): number =>
	HULL_SPECS[hullId].env.lengthKm / 2;

/** Whether a shot along the sightline lands on this hull now. The HUD's mark
 *  and the engagement's hit read this one test. */
export const trafficInSights = (
	aimOrigin: Vec3,
	aimNose: Vec3,
	pos: Vec3,
	hullId: HullId,
): boolean =>
	playerLaserHit(aimOrigin, aimNose, pos, trafficHitRadiusKm(hullId)).hit;

export interface Engagement {
	key: CarrierKey;
	hullId: HullId;
	armed: boolean;
	flight: CombatEnemyState;
	condition: ShipCondition;
}

/**
 * Hand a carrier from its projection to flight at the pose it was drawn in.
 * A civilian starts running; an armed hull starts closing.
 */
export function engage(
	target: {
		key: CarrierKey;
		hullId: HullId;
		pos: Vec3;
		vel: Vec3;
		nose: Vec3;
		up: Vec3 | null;
	},
	seed: number,
): Engagement {
	const armed = ARMED_TRAFFIC_HULLS.has(target.hullId);
	return {
		key: target.key,
		hullId: target.hullId,
		armed,
		condition: fullCondition(target.hullId),
		flight: {
			ship: { pos: { ...target.pos }, vel: { ...target.vel } },
			nose: target.nose,
			up: target.up ?? frameAcross(target.nose),
			rates: NO_ROTATION,
			phase: armed ? "acquire" : "flee",
			phaseSeconds: 0,
			maneuverSeconds: 30,
			evadeCooldown: 0,
			pullAxis: frameAcross(target.nose),
			seed,
			draws: 8,
		},
	};
}

export interface EngagementStep {
	engagement: Engagement;
	/** Whether the player's shot this step struck it. */
	playerHit: boolean;
	/** Whether that shot reached hull points rather than stopping in a shield —
	 *  the strike #365 diverts on (H3d). */
	hullStruck: boolean;
	/** An armed hull's fire this step, for `Game.takeDamage`, or null. */
	returnFire: { amount: number; side: ShieldSide } | null;
	destroyed: boolean;
}

export function stepEngagement(
	engagement: Engagement,
	pilot: DuelPilot,
	shot: PlayerShot,
	dt: number,
): EngagementStep {
	const { condition: before } = engagement;
	const readout: EnemyReadout = {
		targetHull: before.hull,
		targetHullMax: before.hullMax,
		targetEnergy: before.energy,
		targetHeatLocked: before.heatLocked,
		playerHull: pilot.hull,
	};
	const at = engagement.flight.ship.pos;
	const flown = stepEnemyShip(
		engagement.flight,
		pilot.ship,
		pilot.nose,
		readout,
		shot.fired,
		dt,
		{
			laserOrigin: pilot.aimOrigin,
			laserNose: pilot.aimNose,
			hitRadiusKm: trafficHitRadiusKm(engagement.hullId),
			frameVel: pilot.frameVel,
			performance: flightPerformance(engagement.hullId),
			intent: engagement.armed ? "attacker" : "civilian",
		},
	);
	let condition = before;
	const playerHit = shot.fired && shot.damage > 0 && flown.targetInCone;
	if (playerHit)
		condition = applyDamage(
			condition,
			shot.damage,
			sideStruck(engagement.flight.nose, sub(pilot.ship.pos, at)),
		);
	const hullStruck = condition.hull < before.hull;
	const gun = stepCondition(
		condition,
		dt,
		isAlive(condition) && flown.enemyFiring,
	);
	condition = gun.condition;
	const returnFire =
		gun.fired && gun.damage > 0 && pilot.hull > 0
			? {
					amount: gun.damage,
					side: sideStruck(pilot.nose, sub(at, pilot.ship.pos)),
				}
			: null;
	return {
		engagement: { ...engagement, flight: flown.state, condition },
		playerHit,
		hullStruck,
		returnFire,
		destroyed: !isAlive(condition),
	};
}
