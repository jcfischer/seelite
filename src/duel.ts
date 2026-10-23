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
 * rig's drawn 3x. It also flies by the player's flight rules: it turns and
 * moves through the player's Hull step (#646), and its assist holds speed in the player's local frame
 * (`DuelPilot.frame`), so the 2 km/s cap is one speed for both ships.
 *
 * **What it returns rather than does.** The raider's hit on the player comes
 * back as an amount and a side for `Game.takeDamage` to land, because that is
 * the one place damage lands on the player and it cancels a jump charge and a
 * spool-up on the way. This module owns no world and no renderer.
 */
import {
	type CombatEnemyState,
	type EnemyIntent,
	type EnemyReadout,
	NO_ROTATION,
	playerLaserHit,
	stepEnemyShip,
} from "./combat-enemy";
import { HULL_SPECS, type HullId } from "./hull";
import { PLAYER_LASER_RANGE_KM } from "./laser";
import { type Loadout, fittedMassT } from "./loadout";
import { groupLaserRates } from "./laser-modules";
import { fireGroups } from "./fire-group";
import { RAIDER_HULL_ID } from "./raider-slots";
import {
	type ShieldSide,
	type LaserRates,
	type ShipCondition,
	applyDamage,
	isAlive,
	sideStruck,
	stepCondition,
} from "./ship-condition";
import {
	type AvoidSphere,
	type FlightPerformance,
	type FrameMotion,
	type Ship,
	flightPerformance,
} from "./sim";
import { type Vec3, cross, frameAcross, normalizeOr, sub, v3 } from "./vec3";

/** The raider's hit sphere: half its built length. */
export const RAIDER_HIT_RADIUS_KM = HULL_SPECS[RAIDER_HULL_ID].env.lengthKm / 2;

/**
 * Past this gap a raider has got away (#367 D3).
 *
 * **Derived, not declared.** The duel used to end a rout at `FLED_KM`, a
 * separate 25 km, while the beam stops at `PLAYER_LASER_RANGE_KM`'s 12 — and
 * both ships are capped at 2 km/s, so a raider in the band between the two
 * could neither be hit nor leave. The playtest of 2026-09-16 sat at a frozen
 * 12.34 km for two minutes with its shields climbing.
 *
 * The furthest centre the beam can reach is the hypotenuse of its range and the
 * target's radius, because `playerLaserHit` admits a hit on the projection
 * along the sightline and the offset across it. Past here no shot can land, so
 * what the player cannot hit has got away: one figure, derived from the beam,
 * rather than two that drift.
 *
 * **This is the rout's exit, not a statement about the last frame the beam
 * lands in.** The encounter measures gap ship to ship while the beam leaves the
 * cockpit sightline, so the two disagree by more than one thing: a raider off
 * the nose shortens the beam's reach, and a pilot facing a fleeing raider has
 * that sightline *forward* of the ship, toward it, which lengthens it. So a shot
 * can still land on either side of this figure, by metres against twelve
 * kilometres. What the figure is for is that a rout ends, and a frame or two of
 * a beam at its limit changes nothing about that.
 */
export const RAIDER_OUT_OF_BEAM_KM = Math.hypot(
	PLAYER_LASER_RANGE_KM,
	RAIDER_HIT_RADIUS_KM,
);

/**
 * Whether a shot along the sightline would land on the raider now — the HUD's
 * on-target mark (#324 part c). The same beam test and the same hull radius
 * `stepDuel` hits with, so the mark cannot promise a hit the duel refuses.
 *
 * **It is not a promise about the next frame.** `stepDuel` tests the hit at the
 * raider's position *before* its own step, while `stepEncounter` reads this
 * after it; the mark is therefore a second behind the duel by one frame of the
 * raider's speed, and a shot the mark calls good can land on where the raider
 * was. That is one frame, and the mark is drawn from the same predicate rather
 * than a copy of it, which is what keeps the two from drifting apart.
 */
export const raiderInSights = (
	aimOrigin: Vec3,
	aimNose: Vec3,
	raiderPos: Vec3,
): boolean =>
	playerLaserHit(aimOrigin, aimNose, raiderPos, RAIDER_HIT_RADIUS_KM).hit;

export interface Raider {
	flight: CombatEnemyState;
	condition: ShipCondition;
	combat?: CombatFit;
}

/** What the duel reads of the player this step. */
export interface DuelPilot {
	ship: Ship;
	nose: Vec3;
	/** The cockpit sightline, which the beam follows (not always the nose). */
	aimOrigin: Vec3;
	aimNose: Vec3;
	hull: number;
	/** The player's local frame, which the raider's assist holds its speed in
	 *  too (#324): one frame for the fight, so both caps are the same speed.
	 *  **Required** (sage #345), for `FlightPerformance`'s reason: a builder
	 *  that forgot it would silently fly the raider in the star's frame. Pass
	 *  `v3()` at both ends to mean the star's frame. Across the step, because
	 *  the frame accelerates and the raider shares that too (#529). */
	frame: FrameMotion;
	/**
	 * The solids beside the fight this step (`avoidanceSolids`), which every
	 * ship fighting the player steers clear of (node #665). Carried with the
	 * pilot because the fight is the pilot's: one list per step, read at the
	 * clock the frame is read at. **Required**, for `frame`'s reason: a builder
	 * that forgot it would fly the raider blind into a station. `[]` is open
	 * space.
	 */
	solids: readonly AvoidSphere[];
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
	const nose = normalizeOr(sub(player.pos, pos), v3(0, 0, -1));
	const across = frameAcross(nose);
	return {
		ship: { pos: { ...pos }, vel: { ...player.vel } },
		nose,
		up: cross(across, nose),
		rates: NO_ROTATION,
		firing: {},
		phase: "acquire",
		phaseSeconds: 0,
		maneuverSeconds: 30,
		evadeCooldown: 0,
		pullAxis: across,
		seed,
		draws: 8,
	};
}

export interface CombatFit {
	performance: FlightPerformance;
	laserRates: LaserRates | undefined;
}

/** Snapshot fixed fit metrics once; ammunition does not change mass or laser rates. */
export const combatFit = (hull: HullId, loadout?: Loadout): CombatFit => ({
	performance: flightPerformance(
		hull,
		{},
		loadout ? fittedMassT(hull, loadout) : HULL_SPECS[hull].massT,
	),
	laserRates: loadout
		? groupLaserRates(
				loadout,
				fireGroups(loadout, hull).find((group) => group.kind === "lasers"),
			)
		: undefined,
});

const RAIDER_COMBAT = combatFit(RAIDER_HULL_ID);

export function stepDuel(
	raider: Raider,
	pilot: DuelPilot,
	shot: PlayerShot,
	dt: number,
): DuelStep {
	const step = stepCombatShip(raider, pilot, shot, dt, {
		hitRadiusKm: RAIDER_HIT_RADIUS_KM,
		...(raider.combat ?? RAIDER_COMBAT),
		intent: "attacker",
	});
	return {
		raider: { ...raider, flight: step.flight, condition: step.condition },
		playerHit: step.playerHit,
		raiderHit: step.returnFire,
		raiderDestroyed: step.destroyed,
	};
}

/** What one ship in a fight with the player is flown as. */
export interface CombatShipRules {
	hitRadiusKm: number;
	/** **Required**, for `FlightPerformance`'s reason. */
	performance: FlightPerformance;
	intent: EnemyIntent;
	laserRates?: LaserRates;
}

export interface CombatShipStep {
	flight: CombatEnemyState;
	condition: ShipCondition;
	playerHit: boolean;
	returnFire: { amount: number; side: ShieldSide } | null;
	destroyed: boolean;
}

/**
 * One step of any ship fighting the player under §1's shared rules: its
 * controller, the player's shot landing on the pool facing the shooter, and its
 * own gun through `stepCondition`. The raider's duel and a Traffic engagement
 * (#362) are both this step, so a change to hit sides or return fire is made
 * once.
 */
export function stepCombatShip(
	ship: { flight: CombatEnemyState; condition: ShipCondition },
	pilot: DuelPilot,
	shot: PlayerShot,
	dt: number,
	rules: CombatShipRules,
): CombatShipStep {
	const readout: EnemyReadout = {
		targetHull: ship.condition.hull,
		targetHullMax: ship.condition.hullMax,
		targetEnergy: ship.condition.energy,
		targetHeatLocked: ship.condition.heatLocked,
		playerHull: pilot.hull,
	};
	// The hit test inside the controller is against the ship's position at the
	// top of the step, which is where the player aimed.
	const before = ship.flight.ship.pos;
	const flown = stepEnemyShip(
		ship.flight,
		pilot.ship,
		pilot.nose,
		readout,
		shot.fired,
		dt,
		{
			laserOrigin: pilot.aimOrigin,
			laserNose: pilot.aimNose,
			hitRadiusKm: rules.hitRadiusKm,
			frame: pilot.frame,
			performance: rules.performance,
			intent: rules.intent,
			solids: pilot.solids,
		},
	);

	let condition = ship.condition;
	const playerHit = shot.fired && shot.damage > 0 && flown.targetInCone;
	if (playerHit)
		condition = applyDamage(
			condition,
			shot.damage,
			sideStruck(ship.flight.nose, sub(pilot.ship.pos, before)),
		);

	// Its own gun, through the same step the player's goes through. A dead ship
	// pulls no trigger.
	const gun = stepCondition(
		condition,
		dt,
		isAlive(condition) && flown.enemyFiring,
		rules.laserRates,
	);
	condition = gun.condition;
	const returnFire =
		gun.fired && gun.damage > 0 && pilot.hull > 0
			? {
					amount: gun.damage,
					side: sideStruck(pilot.nose, sub(before, pilot.ship.pos)),
				}
			: null;

	return {
		flight: flown.state,
		condition,
		playerHit,
		returnFire,
		destroyed: !isAlive(condition),
	};
}
