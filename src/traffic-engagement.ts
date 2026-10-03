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

/**
 * How many seconds of **landing fire** on one ordinary carrier makes a deliberate
 * act rather than a stray hit — `civilian-combat.md` H4's sustained-fire rung
 * (#396), whose heat is `legal.ts`'s `OFFENCE_HEAT.assault`.
 *
 * A **declared starting form** (H12's precedent), set against one measured
 * quantity: a beam held on a Clean freighter takes **17.7 s of landed fire** to
 * open its facing, so five seconds is 28% of that beam and the charge lands with
 * the better part of the facing's armour still between the pilot and the hull.
 * **That figure has an instrument** — `probe-witnesses.mjs` tethers exactly that
 * beam and carries both durations in its strike row, both read off the world's
 * own clock: `landedFireAtDivert` is what this clock counted and `secondsToDivert`
 * is how long the fight ran. **The
 * second bounds the first**, and not by measurement: landed fire adds `dt` only
 * on frames the same clock is already counting, so no beam can land more seconds
 * than the fight ran for, and a run that opens a facing without ever losing the
 * target reads the same number on both arms to within the frame each is sampled
 * at — 17.8 s of fight against 17.7 s of landed fire on the run that shipped, and
 * the pair cannot come out the other way round for the reason just stated.
 * That is a consistency check on the instrument, and it is why the pair is
 * printed rather than one of them: **a share quoted across the two is a share
 * between unlike quantities**, so this fraction is taken of the landed one. Anyone retuning the dial re-measures it the same way
 * (`PROBE_ORIGIN=… node scripts/probe-witnesses.mjs` prints both lines) rather
 * than reading a number out of a comment, which is why the figure is quoted with
 * its instrument rather than from the author's memory.
 *
 * What the fraction is *for* is the sentence after it: the pilot is charged for
 * what they did to a citizen, not for how long it took the gun to get through
 * the armour, so the rung sits at a share of the strike rather than beside it.
 *
 * **The clock holds across gaps.** A clock that reset the moment the beam left
 * the target would make the charge a marksmanship test — punishing a pilot for
 * holding a crosshair steadily rather than for meaning it, and handing one who
 * jinks a discount on the same act. So `landedFireS` stops on the frames nothing
 * lands and starts again when something does. It never unwinds.
 *
 * **What sits on the other side of the figure is the interval the heat may not
 * leave**, not this number: the seconds decide *when*, and `tests/legal.test.ts`
 * holds the charge's price inside the 10 … 15 it has to live in.
 */
export const ASSAULT_FIRE_S = 5;

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
	/**
	 * Seconds of the pilot's fire that have **landed** on this carrier, held
	 * across the gaps between (`ASSAULT_FIRE_S`'s clock). Not the time since the
	 * fight started and not the time the crosshair has been on it: a beam kept on
	 * a fleeing target that keeps missing has not yet done anything to it.
	 */
	landedFireS: number;
	/**
	 * Whether this carrier's sustained-fire clock has been drawn on this carrier,
	 * **for the life of this fight**. It is the latch, and inside a fight it is
	 * authoritative: the world's copy (`legal.ts`'s `assaultCharged`) exists only
	 * to seed this one at `engage`, and it can be cleared underneath a live
	 * engagement by the settle on a later read — which is right, because that
	 * settle ends an *incident* and this field remembers a *fight*, and a fight
	 * already past its five seconds must not get a second one because the pilot's
	 * heat happened to dip.
	 *
	 * It latches whether or not the charge cost anything, so a lawful five seconds
	 * (F7) cannot be run again inside the same fight; the world records nothing
	 * for it, and `legal.ts`'s `chargeOffence` says why that is the correct
	 * asymmetry: a mark is the record of a charge, written only when it cost.
	 */
	assaultCharged: boolean;
	/** Whether any of this pilot's fire has landed on it at all (the hail's mark). */
	struckOnce: boolean;
}

/**
 * What a carrier arrives with. Required, for `FlightPerformance`'s reason: an
 * optional field here would let a caller that forgot it silently hand a
 * long-running fight a fresh assault clock, and a fresh clock is a second charge
 * for the same five seconds.
 */
export interface EngagementStart {
	/**
	 * Whether the **world** says this carrier's sustained-fire charge is already
	 * paid (`legal.ts`'s `assaultCharged`). A fight resumed after a reload is the
	 * same incident, and the engagement is the only place the clock lives.
	 */
	assaultAlreadyCharged: boolean;
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
	prior: EngagementStart,
): Engagement {
	const armed = ARMED_TRAFFIC_HULLS.has(target.hullId);
	return {
		key: target.key,
		hullId: target.hullId,
		armed,
		condition: fullCondition(target.hullId),
		voyageOrdinal: target.voyageOrdinal,
		landedFireS: 0,
		assaultCharged: prior.assaultAlreadyCharged,
		struckOnce: false,
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
	/**
	 * The **first hit of this engagement has landed** — the moment the struck
	 * carrier hails (#396 §3, `civilian-combat.md` H5 as amended). Stated as the
	 * fact rather than as a threshold, as `hullStruck` is: a pilot who has spent
	 * one quarter-second of the pulse laser on a citizen has been told to stop by
	 * that citizen, whether or not anything has been charged for it yet. The
	 * sustained-fire clock is still running at this frame, and the hail says
	 * nothing about it.
	 */
	firstHit: boolean;
	/**
	 * The frame the sustained-fire clock crosses `ASSAULT_FIRE_S` — an **edge**,
	 * true on exactly that frame and `false` on every other, and `false` forever
	 * once the engagement was seeded with the charge already paid, which is the
	 * whole reason the seed exists.
	 *
	 * **Named apart from `Engagement.assaultCharged` on purpose.** That field is
	 * the latch, true forever after; this is the crossing, and a caller that read
	 * the latch here would charge the offence on every frame of the rest of the
	 * fight. One name for both is how that mistake gets written.
	 */
	assaultCrossed: boolean;
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
	// Held, not reset, when nothing lands this frame. A pilot who breaks off to
	// line up another shot has not un-done the seconds they already spent.
	const landedFireS = engagement.landedFireS + (step.playerHit ? dt : 0);
	const assaultCrossed =
		!engagement.assaultCharged && landedFireS >= ASSAULT_FIRE_S;
	return {
		engagement: {
			...engagement,
			flight: step.flight,
			condition: step.condition,
			landedFireS,
			assaultCharged: engagement.assaultCharged || assaultCrossed,
			struckOnce: engagement.struckOnce || step.playerHit,
		},
		returnFire: step.returnFire,
		destroyed: step.destroyed,
		hullStruck: step.condition.hull < engagement.condition.hull,
		firstHit: step.playerHit && !engagement.struckOnce,
		assaultCrossed,
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

/**
 * The clock of the strike this carrier is standing in its home berth for, or
 * `null` (H9; #633's D2). What `legal.ts`'s `chargeOffence` takes as
 * `carrier.struckAt`.
 *
 * A carrier `parked-home` under a recovery is a strike's incident still open:
 * the divert booked the repair in the strike's tick, so the recovery's
 * `startedAt` is the clock the strike's standing derives from. Anywhere else —
 * flying, absent, or a disable with no recovery written — there is no strike to
 * stand for, and `null` makes the law charge in full rather than discount.
 *
 * **This reads presence, not provenance.** `recovery.initiatedBy` is the home
 * station's — a `disable` names the shooter and a `repair-start` cannot carry
 * two causes — so nothing on the row says the strike was the player's doing.
 * Today the player's own fire is the only thing that diverts a carrier. The day
 * another actor can (a raider, station fire), this rule has to read that
 * provenance instead, or it hands the player a discount on a fight they did not
 * start.
 */
export const strikeClock = (carrier: {
	condition: OperationalCondition;
	recovery?: { kind: RecoveryKind; startedAt: number } | undefined;
}): number | null =>
	trafficPresence(carrier) === "parked-home"
		? (carrier.recovery?.startedAt ?? null)
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
