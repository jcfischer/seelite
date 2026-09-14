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
 * interdiction. The contest function is role-free, so the player's path will
 * call `stepContest` with the roles swapped rather than a second function.
 */
import { type CarrierKey } from "./carrier-key";
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
	beginContest,
	followHeading,
	interdictionTurnRate,
	stepContest,
} from "./interdiction";
import {
	type EncounterBearing,
	RAIDER_HULL_ID,
	type RaiderSlot,
	legEncounter,
	raiderSlots,
} from "./raider-slots";
import { mix } from "./rng";
import type { ShieldSide } from "./ship-condition";
import { fullCondition } from "./ship-condition";
import { flightPerformance } from "./sim";
import { type Vec3, add, cross, length, scale, sub, v3 } from "./vec3";

export type EncounterPhase = "inbound" | "contest" | "duel" | "over";

export type EncounterEnd =
	/** The leg ended before the raider appeared. */
	| "missed"
	/** The player broke the lock. */
	| "broken"
	/** The raider never got a lock. */
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
}

/** A fled raider this far from the player has left the fight. */
export const FLED_KM = 25;

const RAIDER_LOCK_RATE = interdictionTurnRate(
	flightPerformance(RAIDER_HULL_ID),
);

const unit = (v: Vec3, fallback: Vec3): Vec3 => {
	const m = length(v);
	return m === 0 ? fallback : scale(v, 1 / m);
};

function perpendicular(nose: Vec3, rollUnit: number): Vec3 {
	const reference = Math.abs(nose.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0);
	const a = unit(cross(nose, reference), v3(1, 0, 0));
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
	const forward = unit(nose, v3(0, 0, -1));
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
		name: `Raider ${String(ordinal + 1).padStart(2, "0")}`,
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
	systemIndex: number,
	record: { seed: number; government: number },
	legOrdinal: number,
	startedAtS: number,
): Encounter | null {
	const drawn = legEncounter(record.seed, record.government, legOrdinal);
	if (!drawn) return null;
	const slot = raiderSlots(systemIndex, record.government)[drawn.slotIndex];
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

/** An encounter on demand, for a probe or a playtest: slot 0 of the system. */
export function forceEncounter(
	systemIndex: number,
	government: number,
	bearing: EncounterBearing,
	appearsAtS: number,
	rangeKm: number,
): Encounter {
	return makeEncounter(
		raiderSlots(systemIndex, government)[0],
		0,
		bearing,
		rangeKm,
		0.25,
		appearsAtS,
		mix(systemIndex, 0x5eed),
	);
}

const over = (e: Encounter, end: EncounterEnd): EncounterStep => ({
	encounter: { ...e, phase: "over", end, raider: null, offset: null },
	drop: false,
	raiderHit: null,
	contact: null,
});

function upFor(nose: Vec3): Vec3 {
	const reference = Math.abs(nose.y) < 0.85 ? v3(0, 1, 0) : v3(1, 0, 0);
	const across = unit(cross(nose, reference), v3(1, 0, 0));
	return cross(across, nose);
}

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

	if (e.phase === "over")
		return { encounter: e, drop: false, raiderHit: null, contact: null };

	if (e.phase === "inbound") {
		if (f.gameTime < e.appearsAtS)
			return { encounter: e, drop: false, raiderHit: null, contact: null };
		if (!f.inCruise) return over(e, "missed");
		const offset = offsetFor(pilot.nose, e.bearing, e.rangeKm, e.rollUnit);
		const nose = unit(pilot.nose, v3(0, 0, -1));
		const encounter: Encounter = { ...e, phase: "contest", offset, nose };
		return {
			encounter,
			drop: false,
			raiderHit: null,
			contact: contactOf(add(pilot.ship.pos, offset), pilot.ship.vel, nose),
		};
	}

	if (e.phase === "contest") {
		const offset = e.offset ?? offsetFor(pilot.nose, e.bearing, e.rangeKm, 0);
		const pos = add(pilot.ship.pos, offset);
		// A player who drops out mid-contest has submitted: the raider is on
		// them and the duel starts where the contest left it.
		if (!f.inCruise)
			return {
				encounter: { ...e, phase: "duel", raider: null },
				drop: false,
				raiderHit: null,
				contact: contactOf(pos, pilot.ship.vel, e.nose),
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
	if (step.raiderDestroyed) return over(e, "destroyed");
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
	};
}

/** The raider's hit sphere for a contact the scanner draws. */
export const RAIDER_CONTACT_RADIUS_KM =
	Math.max(
		HULL_SPECS[RAIDER_HULL_ID].env.lengthKm,
		HULL_SPECS[RAIDER_HULL_ID].env.beamKm,
		HULL_SPECS[RAIDER_HULL_ID].env.heightKm,
	) / 2;

/** Whether the encounter is showing a contact this frame. */
export const encounterVisible = (e: Encounter | null): boolean =>
	e !== null && (e.phase === "contest" || e.phase === "duel");
