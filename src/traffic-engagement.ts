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
	NO_ROTATION,
	playerLaserHit,
} from "./combat-enemy";
import { type DuelPilot, type PlayerShot, stepCombatShip } from "./duel";
import { HULL_SPECS, type HullId } from "./hull";
import {
	type ShieldSide,
	type ShipCondition,
	fullCondition,
} from "./ship-condition";
import { playerKillDestruction } from "./raider-wreck";
import { flightPerformance } from "./sim";
import { type Vec3, frameAcross } from "./vec3";
import type { Provenance, TransitionEvent } from "./world-state";

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
	/**
	 * The voyage its hold is drawn for, **fixed when the fight starts**. An
	 * engaged carrier no longer flies its schedule, so the schedule's ordinal at
	 * the kill tick is not the voyage it was on: a fight crossing a departure
	 * boundary would drop a different hold from the one shown (sage #368).
	 */
	voyageOrdinal: number;
}

/**
 * The voyage a carrier is flying now (`carrier-identity.md` F11): the visit its
 * route projects, and the schedule's ordinal only when there is no route. A
 * return running late is projected as the *previous* visit
 * (`station-route.ts`), while the schedule has already moved to the next.
 */
export const flownVoyageOrdinal = (
	route: { visitAwayOrdinal?: number } | undefined,
	scheduleOrdinal: number,
): number => route?.visitAwayOrdinal ?? scheduleOrdinal;

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
		voyageOrdinal: number;
	},
	seed: number,
): Engagement {
	const armed = ARMED_TRAFFIC_HULLS.has(target.hullId);
	return {
		key: target.key,
		hullId: target.hullId,
		armed,
		condition: fullCondition(target.hullId),
		voyageOrdinal: target.voyageOrdinal,
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
	const step = stepCombatShip(engagement, pilot, shot, dt, {
		hitRadiusKm: trafficHitRadiusKm(engagement.hullId),
		performance: flightPerformance(engagement.hullId),
		intent: engagement.armed ? "attacker" : "civilian",
	});
	return {
		engagement: {
			...engagement,
			flight: step.flight,
			condition: step.condition,
		},
		returnFire: step.returnFire,
		destroyed: step.destroyed,
	};
}

/** Who replaces a destroyed ordinary carrier: its home station. Out of sight,
 *  so it updates no knowledge. */
const trafficReplacementActor = (
	systemIndex: number,
	homeStationId: string,
): Provenance => ({
	causeKind: "traffic-replacement",
	actorId: `${systemIndex}:${homeStationId}`,
	playerRole: "none",
});

/**
 * The world-state transition a player's kill applies to an ordinary carrier:
 * `combat-model.md` §4's destroyed → repairing → replaced transitions, on the
 * raider's figures — destroyed for `RAIDER_WRECK_S`, repairing for
 * `RAIDER_REPAIR_S` — and a replacement at the next `instanceOrdinal`, which
 * draws its own standing and hold (H1). No H decision sets the durations; they
 * are `raider-wreck.ts`'s, reused.
 */
export const trafficDestruction = (
	systemIndex: number,
	homeStationId: string,
	now: number,
): TransitionEvent =>
	playerKillDestruction(
		systemIndex,
		now,
		trafficReplacementActor(systemIndex, homeStationId),
	);

/**
 * The actors that fly their projection now: the operational ones. A destroyed
 * carrier is absent from its route and holds no berth until its replacement is
 * operational, which is what makes a kill visible and a replacement come back.
 * A repairing carrier is filtered too, which is right for a replacement under
 * construction; a *diverted* one parked at home is #365's (H3c) to draw.
 */
export const flyingTrafficActors = <T extends { key: CarrierKey }>(
	actors: readonly T[],
	conditionOf: (key: CarrierKey) => { condition: string },
): T[] => actors.filter((a) => fliesItsRoute(conditionOf(a.key)));

/** The one rule for who flies a route: an operational carrier. */
export const fliesItsRoute = (carrier: { condition: string }): boolean =>
	carrier.condition === "operational";
