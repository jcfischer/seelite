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
 * **A survivor is diverted, and the diversion is saved** (H3b, H3c, H3d). The
 * first hit that reaches hull points writes two transitions in one tick — the
 * player's `disable`, then the home station's `repair-start` — and the carrier
 * spends the repair parked in its own berth. This module writes neither: it
 * returns the transitions, as it returns everything.
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
import { type Offence, type Standing, offenceHeat } from "./legal";
import {
	PLAYER_KILL,
	RAIDER_REPAIR_S,
	playerKillDestruction,
} from "./raider-wreck";
import {
	type ShieldSide,
	type ShipCondition,
	fullCondition,
} from "./ship-condition";
import {
	type TrafficSchedule,
	nextTrafficDepartureAtS,
} from "./station-traffic";
import { flightPerformance } from "./sim";
import { type Vec3, frameAcross } from "./vec3";
import type {
	OperationalCondition,
	Provenance,
	RecoveryKind,
	TransitionEvent,
} from "./world-state";

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
	/**
	 * This step spent **hull points** — H3d's trigger, stated as the fact rather
	 * than as a threshold. A step that only moved shields is not one: shields
	 * recharge, and the principal chose the hull strike over the shipped 20%
	 * flee threshold precisely so that a pilot who never touches the hull
	 * changes nothing in the world.
	 */
	hullStruck: boolean;
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
		hullStruck: step.condition.hull < engagement.condition.hull,
	};
}

// ---------------------------------------------------------------------------
// The divert (`civilian-combat.md` H3b, H3c, H3d)
// ---------------------------------------------------------------------------

/**
 * Who repairs a diverted ordinary carrier: its home station, out of sight.
 *
 * Role `none`, so the repair writes no knowledge row — the pilot who fired the
 * hit knows what they did from their own gun, and §3.1's last-known condition
 * stays the player's `disable` rather than quietly advancing because a berth
 * booked the work.
 */
const trafficRepairActor = (
	systemIndex: number,
	homeStationId: string,
): Provenance => ({
	causeKind: "traffic-repair",
	actorId: `${systemIndex}:${homeStationId}`,
	playerRole: "none",
});

/**
 * The two transitions a hull strike applies to an ordinary carrier, in one tick
 * (H3c): the player's `disable`, then the home station's `repair-start`.
 *
 * **Two facts, not one, because §4 says the row cannot carry both.** A
 * `disable` records who did it and has no clock; a `repair-start` is the only
 * carrier event that can name a completion, and it needs a `disabled` carrier
 * to act on. Widening `disable` to carry its own schedule is the alternative
 * the principal declined (`station-damage.md` E4 declined it for the same
 * reason), and the explicit start is what makes the lazy completion enough.
 *
 * **The clock is the next departure, not `now + T`.** H3d's `T` is
 * `RAIDER_REPAIR_S`, and H3c has the ship rejoin "at the next departure after"
 * its completion — so the repair is booked to the first departure at or after
 * `now + T`, and the row turns operational exactly when the schedule takes it
 * away from the berth. The principal was offered `now + T` exactly and chose the
 * rounding; what the rounding buys is that the two clocks never disagree about
 * where the ship is. Booked to `now + T` alone, a repair that ends inside the
 * carrier's own away-leg would leave it written operational on a leg it never
 * flew, and a ship repaired under the player's eyes would have to jump out of
 * its berth into the middle of it. So `T` is a floor on the absence, never
 * shorter than it, and never longer than one cycle more.
 *
 * **`PLAYER_KILL` is the provenance of the player's own gun**, not of a
 * destruction: §5's cause names the actor and the weapon, and it is the
 * transition kind that says what the hull did.
 */
export const trafficDiversion = (
	systemIndex: number,
	actor: { schedule: TrafficSchedule; homeStationId: string },
	now: number,
): TransitionEvent[] => [
	{ kind: "disable", occurredAt: now, cause: PLAYER_KILL },
	{
		kind: "repair-start",
		occurredAt: now,
		cause: trafficRepairActor(systemIndex, actor.homeStationId),
		// The work happens at the berth, which is also where the player will look
		// for the ship they struck.
		consequenceArea: `station:${actor.homeStationId}`,
		completesAt: nextTrafficDepartureAtS(actor.schedule, now + RAIDER_REPAIR_S),
	},
];

/**
 * The transitions a player's kill applies, from whatever condition the carrier
 * is in now.
 *
 * From `operational` and `disabled` it is the one destroy change 1 shipped. From
 * `repairing` it is two, because §4's table lets `destroy` act on an
 * `operational` or `disabled` carrier only, and `interrupt` is the only way out
 * of a repair — so the kill interrupts the repair **to `disabled`** rather than
 * straight to destroyed. That is not a stylistic choice: `interrupt` drops the
 * recovery with it, and a carrier already sitting in `destroyed` cannot then be
 * destroyed, so the shorter route would leave a wreck with no replacement
 * schedule and a berth nobody comes back to.
 */
export const trafficKillTransitions = (
	systemIndex: number,
	actor: { homeStationId: string },
	from: OperationalCondition,
	now: number,
): TransitionEvent[] => {
	const destroy = trafficDestruction(systemIndex, actor.homeStationId, now);
	if (from !== "repairing") return [destroy];
	return [
		{
			kind: "interrupt",
			occurredAt: now,
			cause: PLAYER_KILL,
			resulting: "disabled",
		},
		destroy,
	];
};

/**
 * Where one carrier's row leaves it, as far as Traffic's projection is
 * concerned. Three answers, because there are three things a pilot can find:
 * a ship on a route, a ship in a berth, or nothing.
 */
export type TrafficPresence = "flying" | "parked-home" | "absent";

/**
 * What `world-state.ts`'s `effectiveCarrier` answers for one key, as far as
 * Traffic's projection reads it: the condition, and the recovery that gives a
 * `repairing` row its meaning.
 */
export interface CarrierConditionRow {
	condition: OperationalCondition;
	recovery?: { kind: RecoveryKind } | undefined;
}

/**
 * The one rule for who flies a route, who sits at home, and who is not there.
 *
 * A `repair` recovery is the divert: the ship that was struck, whole enough to
 * have flown home, standing in its own berth until its schedule takes it away.
 * A `replacement` recovery is **not** that ship — it is the next instance being
 * built, and drawing it in the berth of the carrier the player just killed
 * would put the wreck back in the water. That is why the recovery's kind
 * decides this and the bare condition cannot: both rows read `repairing`.
 */
export const trafficPresence = (
	carrier: CarrierConditionRow,
): TrafficPresence => {
	if (carrier.condition === "operational") return "flying";
	// Unreachable from flight — the divert books the repair in the same tick it
	// disables — but a `disable` with no completion is still a ship at home, and
	// answering `absent` here would let a half-written divert empty a berth.
	if (carrier.condition === "disabled") return "parked-home";
	if (carrier.condition === "repairing" && carrier.recovery?.kind === "repair")
		return "parked-home";
	return "absent";
};

/** H9: the offence this carrier's row says the pilot has already paid for.
 *
 *  The divert *is* the strike's incident: `disable` opened it, the repair is
 *  running, and the kill that interrupts it closes it. So a carrier sitting in
 *  its home berth under a repair the player's own fire caused has already cost
 *  them H4's strike heat, and the kill that finishes it owes the difference and
 *  not a second offence. Read off the row rather than a counter, because the
 *  incident outlives the session that opened it.
 *
 *  **`standingAtStrike` is not decoration, and `null` does not mean "clean".**
 *  Only an offence against a Clean carrier costs anything (H4), so a strike on a
 *  carrier that was Wanted charged nothing, and the kill that follows it is
 *  worth its full 40 even if the rotation has since made the target Clean again
 *  — the rotation runs six hours and the repair 1200 s plus up to a cycle, so
 *  those two clocks do disagree sometimes. The row carries the strike's own clock
 *  (`recovery.startedAt`), and standing is a pure derivation from a clock, so a
 *  caller can hand over the standing the strike was judged on. `null` says that
 *  cannot be established, and the answer to that is that nothing has been paid:
 *  the safe direction, because the alternative is a discount for a hit the
 *  player was never charged for.
 *
 *  **This reads presence, not provenance.** `recovery.initiatedBy` is the home
 *  station's — a `disable` names the shooter and a `repair-start` cannot carry
 *  two causes — so nothing on the row says the strike was the player's doing.
 *  Today the player's own fire is the only thing that diverts a carrier. The day
 *  another actor can (a raider, station fire), this rule has to read that
 *  provenance instead, or it hands the player a discount on a fight they did not
 *  start.
 */
export const chargedOffence = (
	carrier: CarrierConditionRow,
	standingAtStrike: Standing | null,
): Offence | null =>
	trafficPresence(carrier) === "parked-home" &&
	standingAtStrike !== null &&
	offenceHeat(standingAtStrike, "struck") > 0
		? "struck"
		: null;

/** The actors standing in a home berth instead of flying a route (H3b): the
 *  struck ones, drawn where the world says they are. */
export const parkedHomeTrafficActors = <T extends { key: CarrierKey }>(
	actors: readonly T[],
	conditionOf: (key: CarrierKey) => CarrierConditionRow,
): T[] =>
	actors.filter((a) => trafficPresence(conditionOf(a.key)) === "parked-home");

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
 * The actors that fly their projection now.
 *
 * A destroyed carrier is absent from its route and holds no berth until its
 * replacement is operational, which is what makes a kill visible and a
 * replacement come back. A diverted one holds its route for the same reason —
 * it is not flying it — and `parkedHomeTrafficActors` is where it is drawn instead.
 */
export const flyingTrafficActors = <T extends { key: CarrierKey }>(
	actors: readonly T[],
	conditionOf: (key: CarrierKey) => CarrierConditionRow,
): T[] => actors.filter((a) => fliesItsRoute(conditionOf(a.key)));

/** The one rule for who flies a route, read off the three-way answer above. */
export const fliesItsRoute = (carrier: CarrierConditionRow): boolean =>
	trafficPresence(carrier) === "flying";
