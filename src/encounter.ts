/**
 * One raider encounter, from a cruise leg's draw to its end (node #324 part b).
 *
 * The phases are the fiction in order:
 *
 * - **inbound** — scheduled on the leg, not yet on the scanner;
 * - **contest** — it has appeared behind, alongside or ahead, riding a pinned
 *   offset from the player (a raider cannot fly a 2 km/s dogfight controller
 *   at cruise speed), and is trying to hold a heading lock;
 * - **duel** — the contest succeeded, or the player dropped out and submitted,
 *   and #53's controller flies it in normal flight;
 * - **over** — with one of the ends below.
 *
 * `Game` steps this and does the three things only it can: drop the player
 * out of cruise, land the raider's fire through `takeDamage`, and draw the
 * contact. This module owns no world, no renderer and no save.
 *
 * **Not yet here, by the node's own split:** the world-state `destroy` event
 * and the lifecycle a destroyed slot runs (part d), and a player-initiated
 * interdiction. The raider applies the contest's turn cost here
 * (`interdictionTurnRate`); a player path must apply the same cost to the
 * player while the player holds a lock — see `interdiction.ts`.
 */
import type { CarrierKey } from "./carrier-key";
import {
	type DuelPilot,
	type PlayerShot,
	type Raider,
	raiderAtDrop,
	stepDuel,
} from "./duel";
import { HULL_SPECS } from "./hull";
import {
	type Contest,
	INTERDICTION_RANGE_KM,
	beginContest,
	followHeading,
	interdictionTurnRate,
	stepContest,
} from "./interdiction";
import {
	type EncounterBearing,
	RAIDER_HULL_ID,
	type RaiderSlot,
	type RouteDetection,
	legEncounter,
	raiderName,
	raiderSlots,
} from "./raider-slots";
import { mix } from "./rng";
import type { ShieldSide } from "./ship-condition";
import { fullCondition } from "./ship-condition";
import { flightPerformance } from "./sim";
import {
	type Vec3,
	add,
	cross,
	frameAcross,
	length,
	normalizeOr,
	scale,
	sub,
	v3,
} from "./vec3";

export type EncounterPhase = "inbound" | "contest" | "duel" | "over";

export type EncounterEnd =
	/** The leg ended before the raider appeared. */
	| "missed"
	/** The player broke the lock. */
	| "broken"
	/** The raider never got a lock, or appeared too far away to try. */
	| "lost"
	/** The player was back in cruise during the duel. */
	| "escaped"
	/** The raider fled out of the fight. */
	| "fled"
	/** The raider's hull reached zero. */
	| "destroyed";

export interface Encounter {
	slot: RaiderSlot;
	/** The slot's display name. */
	name: string;
	bearing: EncounterBearing;
	rangeKm: number;
	rollUnit: number;
	appearsAtS: number;
	/** The duel's seeded stream. */
	seed: number;
	phase: EncounterPhase;
	contest: Contest;
	/** The pinned offset from the player while in contest. */
	offset: Vec3 | null;
	/** The raider's heading while in contest. */
	nose: Vec3;
	raider: Raider | null;
	end: EncounterEnd | null;
}

/** What the encounter reads of the game this frame. */
export interface EncounterFrame {
	gameTime: number;
	dt: number;
	inCruise: boolean;
	pilot: DuelPilot;
	shot: PlayerShot;
}

/** The raider as the renderer and scanner see it. */
export interface EncounterContact {
	key: CarrierKey;
	name: string;
	pos: Vec3;
	vel: Vec3;
	nose: Vec3;
	up: Vec3;
}

export interface EncounterStep {
	encounter: Encounter;
	/** The contest succeeded this frame: drop the player out of cruise. */
	drop: boolean;
	/** The raider's fire this frame, for `Game.takeDamage` to land. */
	raiderHit: { amount: number; side: ShieldSide } | null;
	contact: EncounterContact | null;
	/** Where the raider came apart, on the frame it did (#324 part d): the
	 *  cargo drops from here. `null` on every other frame. */
	wreck: { pos: Vec3; vel: Vec3 } | null;
}

/** Whether a raider slot can field a raider now: operational in world state.
 *  Required, so a caller cannot forget it and respawn a destroyed raider. */
export type SlotOperational = (key: CarrierKey) => boolean;

/** A fled raider this far from the player has left the fight. */
export const FLED_KM = 25;

const RAIDER_LOCK_RATE = interdictionTurnRate(
	flightPerformance(RAIDER_HULL_ID),
);

function perpendicular(nose: Vec3, rollUnit: number): Vec3 {
	const a = frameAcross(nose);
	const b = cross(nose, a);
	const angle = rollUnit * Math.PI * 2;
	return add(scale(a, Math.cos(angle)), scale(b, Math.sin(angle)));
}

function offsetFor(
	nose: Vec3,
	bearing: EncounterBearing,
	rangeKm: number,
	rollUnit: number,
): Vec3 {
	const forward = normalizeOr(nose, v3(0, 0, -1));
	if (bearing === "ahead") return scale(forward, rangeKm);
	if (bearing === "behind") return scale(forward, -rangeKm);
	return scale(perpendicular(forward, rollUnit), rangeKm);
}

function makeEncounter(
	slot: RaiderSlot,
	ordinal: number,
	bearing: EncounterBearing,
	rangeKm: number,
	rollUnit: number,
	appearsAtS: number,
	seed: number,
): Encounter {
	return {
		slot,
		name: raiderName(ordinal),
		bearing,
		rangeKm,
		rollUnit,
		appearsAtS,
		seed,
		phase: "inbound",
		contest: beginContest(),
		offset: null,
		nose: v3(0, 0, -1),
		raider: null,
		end: null,
	};
}

/**
 * The encounter a cruise leg draws, or null. `legOrdinal` identifies the leg;
 * `startedAtS` is when it began.
 */
export function scheduleEncounter(
	operational: SlotOperational,
	systemIndex: number,
	record: { seed: number; government: number },
	legOrdinal: number,
	startedAtS: number,
	/** The pirate relay's dial on this leg (#43): `law` unless the leg is on
	 *  a watched route. Required, for `holdT`'s reason. */
	detection: RouteDetection,
): Encounter | null {
	const drawn = legEncounter(
		record.seed,
		record.government,
		legOrdinal,
		detection,
	);
	if (!drawn) return null;
	const slot = raiderSlots(systemIndex, record.government)[drawn.slotIndex];
	// **The route threat is gone while the carrier is not operational** (#41,
	// #324 part d). The draw is not moved to another slot: a system that lost a
	// raider is less dangerous, not equally dangerous with a different name.
	if (!operational(slot.key)) return null;
	return makeEncounter(
		slot,
		drawn.slotIndex,
		drawn.bearing,
		drawn.rangeKm,
		drawn.rollUnit,
		startedAtS + drawn.delayS,
		mix(record.seed, legOrdinal ^ 0x5eed),
	);
}

/** An encounter on demand, for a probe or a playtest: the system's first
 *  operational slot, or `null` when every slot is destroyed or repairing. */
export function forceEncounter(
	operational: SlotOperational,
	systemIndex: number,
	government: number,
	bearing: EncounterBearing,
	appearsAtS: number,
	rangeKm: number,
): Encounter | null {
	const slots = raiderSlots(systemIndex, government);
	const ordinal = slots.findIndex((s) => operational(s.key));
	if (ordinal < 0) return null;
	return makeEncounter(
		slots[ordinal],
		ordinal,
		bearing,
		rangeKm,
		0.25,
		appearsAtS,
		mix(systemIndex, 0x5eed),
	);
}

/** A frame in which nothing is shown and nothing happens. */
const idle = (e: Encounter): EncounterStep => ({
	encounter: e,
	drop: false,
	raiderHit: null,
	contact: null,
	wreck: null,
});

const over = (e: Encounter, end: EncounterEnd): EncounterStep =>
	idle({ ...e, phase: "over", end, raider: null, offset: null });

const upFor = (nose: Vec3): Vec3 => cross(frameAcross(nose), nose);

export function stepEncounter(e: Encounter, f: EncounterFrame): EncounterStep {
	const { pilot } = f;
	const contactOf = (
		pos: Vec3,
		vel: Vec3,
		nose: Vec3,
		up: Vec3 = upFor(nose),
	): EncounterContact => ({
		key: e.slot.key,
		name: e.name,
		pos,
		vel,
		nose,
		up,
	});

	if (e.phase === "over") return idle(e);

	if (e.phase === "inbound") {
		// A raider belongs to the leg it was drawn on. The moment that leg ends —
		// before the raider has appeared or at the frame it would — it is missed,
		// so it cannot follow the player onto the next leg.
		if (!f.inCruise) return over(e, "missed");
		if (f.gameTime < e.appearsAtS) return idle(e);
		// A contest only runs against a contact near enough to lock.
		if (e.rangeKm > INTERDICTION_RANGE_KM) return over(e, "lost");
		const offset = offsetFor(pilot.nose, e.bearing, e.rangeKm, e.rollUnit);
		const nose = normalizeOr(pilot.nose, v3(0, 0, -1));
		return {
			encounter: { ...e, phase: "contest", offset, nose },
			drop: false,
			raiderHit: null,
			contact: contactOf(add(pilot.ship.pos, offset), pilot.ship.vel, nose),
			wreck: null,
		};
	}

	if (e.phase === "contest") {
		// The inbound step sets the offset on the frame it enters the contest.
		if (!e.offset) throw new Error("an encounter in contest has no offset");
		const pos = add(pilot.ship.pos, e.offset);
		// A player who drops out mid-contest has submitted: the raider is on
		// them and the duel starts where the contest left it.
		if (!f.inCruise)
			return {
				encounter: { ...e, phase: "duel", raider: null },
				drop: false,
				raiderHit: null,
				contact: contactOf(pos, pilot.ship.vel, e.nose),
				wreck: null,
			};
		const nose = followHeading(e.nose, pilot.nose, RAIDER_LOCK_RATE, f.dt);
		const contest = stepContest(e.contest, nose, pilot.nose, f.dt);
		if (contest.phase === "broken" || contest.phase === "lost")
			return over({ ...e, contest }, contest.phase);
		const succeeded = contest.phase === "succeeded";
		return {
			encounter: {
				...e,
				nose,
				contest,
				phase: succeeded ? "duel" : "contest",
			},
			drop: succeeded,
			raiderHit: null,
			contact: contactOf(pos, pilot.ship.vel, nose),
			wreck: null,
		};
	}

	// The duel.
	if (f.inCruise) return over(e, "escaped");
	const raider: Raider = e.raider ?? {
		flight: raiderAtDrop(
			add(pilot.ship.pos, e.offset ?? v3()),
			pilot.ship,
			e.seed,
		),
		condition: fullCondition(RAIDER_HULL_ID),
	};
	const step = stepDuel(raider, pilot, f.shot, f.dt);
	if (step.raiderDestroyed)
		return {
			...over(e, "destroyed"),
			wreck: {
				pos: step.raider.flight.ship.pos,
				vel: step.raider.flight.ship.vel,
			},
		};
	const flight = step.raider.flight;
	if (
		flight.phase === "flee" &&
		length(sub(flight.ship.pos, pilot.ship.pos)) > FLED_KM
	)
		return over(e, "fled");
	return {
		encounter: { ...e, raider: step.raider, offset: null },
		drop: false,
		raiderHit: step.raiderHit,
		contact: contactOf(
			flight.ship.pos,
			flight.ship.vel,
			flight.nose,
			flight.up,
		),
		wreck: null,
	};
}

/** The raider's hit sphere for a contact the scanner draws. */
export const RAIDER_CONTACT_RADIUS_KM =
	Math.max(
		HULL_SPECS[RAIDER_HULL_ID].env.lengthKm,
		HULL_SPECS[RAIDER_HULL_ID].env.beamKm,
		HULL_SPECS[RAIDER_HULL_ID].env.heightKm,
	) / 2;
