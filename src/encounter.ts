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
 * **A defender skips the first two (#515).** A hit on the pirate relay or its
 * tender calls one in normal flight beside a body (`relay-defender.ts`): it
 * waits out its delay as `inbound` and then drops straight into the duel,
 * beside the pilot and at rest in the pilot's frame.
 *
 * **Not yet here, by the node's own split:** the world-state `destroy` event
 * and the lifecycle a destroyed slot runs (part d), and a player-initiated
 * interdiction. The raider applies the contest's turn cost here
 * (`interdictionTurnRate`); a player path must apply the same cost to the
 * player while the player holds a lock — see `interdiction.ts`.
 */
import type { CarrierKey } from "./carrier-key";
import { raiderRegistry } from "./carrier-name";
import {
	type DuelPilot,
	type PlayerShot,
	type Raider,
	RAIDER_OUT_OF_BEAM_KM,
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
	raiderSlots,
} from "./raider-slots";
import { defenderDraw } from "./relay-defender";
import { mix } from "./rng";
import type { ShieldSide } from "./ship-condition";
import { applyDamage, fullCondition, isAlive } from "./ship-condition";
import { type VentLevels, flightPerformance } from "./sim";
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

/** Where an encounter came from: a cruise leg's draw, or a relay's call. */
export type EncounterOrigin = "leg" | "defender";

export interface Encounter {
	origin: EncounterOrigin;
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
	/**
	 * The vents the raider fired on its last step (node #637), for its plumes.
	 * Empty outside the duel: the interdiction's lock turns the nose by
	 * `followHeading`, through no vent, so there is no table to draw.
	 */
	firing: VentLevels;
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
	origin: EncounterOrigin,
	slot: RaiderSlot,
	ordinal: number,
	bearing: EncounterBearing,
	rangeKm: number,
	rollUnit: number,
	appearsAtS: number,
	seed: number,
): Encounter {
	return {
		origin,
		slot,
		// The registry, not the drawn name: `carrier-identity.md` §6 keeps a raider
		// reading as it does today, and the log reports on the slot.
		name: raiderRegistry(ordinal),
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
		"leg",
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
		"leg",
		slots[ordinal],
		ordinal,
		bearing,
		rangeKm,
		0.25,
		appearsAtS,
		mix(systemIndex, 0x5eed),
	);
}

/** One call on a target: `instance` and `ordinal` are `defenderDraw`'s, and
 *  `calledAtS` is the hit. */
export interface DefenderCall {
	target: CarrierKey;
	instance: number;
	ordinal: number;
	calledAtS: number;
}

/**
 * The raider a hit on the relay or its tender calls (#515), or `null` when
 * the drawn slot is destroyed or repairing.
 */
export function defenderEncounter(
	operational: SlotOperational,
	systemIndex: number,
	record: { seed: number; government: number },
	call: DefenderCall,
): Encounter | null {
	const drawn = defenderDraw(
		record.seed,
		record.government,
		call.target,
		call.instance,
		call.ordinal,
	);
	const slot = raiderSlots(systemIndex, record.government)[drawn.slotIndex];
	// Not moved to another slot, for `scheduleEncounter`'s reason (#511 D2).
	if (!operational(slot.key)) return null;
	return makeEncounter(
		"defender",
		slot,
		drawn.slotIndex,
		drawn.bearing,
		drawn.rangeKm,
		drawn.rollUnit,
		call.calledAtS + drawn.delayS,
		drawn.encounterSeed,
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

/**
 * What one step's collisions did to the duel's raider (`collision.md` §3,
 * node #664): every meeting landed on its condition, at the pose the step
 * left it in. **A raider they finish is destroyed in this tick**, its wreck
 * where it came apart — the same `over` and the same wreck a kill by fire
 * gives — rather than on the duel step after: a ram that kills the pilot as
 * well holds the clock, and no step after it ever comes. `null` outside a
 * duel, where there is no raider in flight to land anything on.
 *
 * `view` is the contact the duel step drew, which stood where the raider
 * was before this step moved it; `contact` is that view moved to where the
 * step left the raider, so the hull and the scanner draw what the collision
 * body did. `null` with no view, and on a kill, which takes the view away.
 */
export function landRaiderImpacts(
	e: Encounter,
	landed: {
		pos: Vec3;
		vel: Vec3;
		impacts: readonly { damage: number; side: ShieldSide }[];
	},
	view: EncounterContact | null,
): {
	encounter: Encounter;
	wreck: { pos: Vec3; vel: Vec3 } | null;
	contact: EncounterContact | null;
} | null {
	const raider = e.phase === "duel" ? e.raider : null;
	if (!raider) return null;
	let condition = raider.condition;
	for (const impact of landed.impacts)
		condition = applyDamage(condition, impact.damage, impact.side);
	const ship = { pos: landed.pos, vel: landed.vel };
	if (isAlive(raider.condition) && !isAlive(condition))
		return {
			encounter: over(e, "destroyed").encounter,
			wreck: { pos: { ...ship.pos }, vel: { ...ship.vel } },
			contact: null,
		};
	return {
		encounter: {
			...e,
			raider: { flight: { ...raider.flight, ship }, condition },
		},
		wreck: null,
		contact: view
			? { ...view, pos: { ...ship.pos }, vel: { ...ship.vel } }
			: null,
	};
}

export function stepEncounter(e: Encounter, f: EncounterFrame): EncounterStep {
	const { pilot } = f;
	const contactOf = (
		pos: Vec3,
		vel: Vec3,
		nose: Vec3,
		up: Vec3 = upFor(nose),
		firing: VentLevels = {},
	): EncounterContact => ({
		key: e.slot.key,
		name: e.name,
		pos,
		vel,
		nose,
		up,
		firing,
	});

	if (e.phase === "over") return idle(e);

	if (e.phase === "inbound") {
		// A raider belongs to the leg it was drawn on. The moment that leg ends —
		// before the raider has appeared or at the frame it would — it is missed,
		// so it cannot follow the player onto the next leg.
		//
		// A defender is the reverse: it is called in normal flight, and a pilot
		// who is back in cruise before it arrives has left it behind.
		if (f.inCruise !== (e.origin === "leg")) return over(e, "missed");
		if (f.gameTime < e.appearsAtS) return idle(e);
		if (e.origin === "defender") {
			// Straight into the duel, with no contest: there is no cruise to
			// interdict. At rest in the pilot's frame rather than at the pilot's
			// velocity — beside a station that frame moves ~30 km/s (#104), and
			// the defender is a ship that arrived there, not one matching the
			// pilot's own drift through it.
			const offset = offsetFor(pilot.nose, e.bearing, e.rangeKm, e.rollUnit);
			//
			// And stepped on the frame it arrives in, as every later frame is. The
			// pilot is stepped after this frame's encounter, so a raider placed
			// and not flown stands one `frame.start × dt` behind at render — 3 km at
			// `MAX_DT` beside a station. #515's probe read 11.36 km at arrival
			// against a range drawn under `DEFENDER_RANGE_KM`'s 10.
			const flight = raiderAtDrop(
				add(pilot.ship.pos, offset),
				{ pos: pilot.ship.pos, vel: pilot.frame.start },
				e.seed,
			);
			return stepEncounter(
				{
					...e,
					phase: "duel",
					raider: { flight, condition: fullCondition(RAIDER_HULL_ID) },
				},
				f,
			);
		}
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

	// The duel. **A raider already at no hull is destroyed** before anything
	// else is asked of it (node #664). A collision kill is resolved in its own
	// tick (`landRaiderImpacts`); this is the backstop, so a raider that
	// reaches a duel step dead by any route is never flown, nor let escape
	// into cruise.
	if (e.raider && !isAlive(e.raider.condition))
		return {
			...over(e, "destroyed"),
			wreck: { pos: e.raider.flight.ship.pos, vel: e.raider.flight.ship.vel },
		};
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
	// **Out of the beam is out of the fight (#367 D3).** `FLED_KM` was a figure of
	// the encounter's own — 25 km, past a beam that stops at 12 — and with both
	// ships capped at 2 km/s the band between the two was a place a rout could
	// live forever. The exit is the beam's reach at the raider's size now, so it
	// cannot outstrip the thing it was derived from.
	if (
		flight.phase === "flee" &&
		length(sub(flight.ship.pos, pilot.ship.pos)) > RAIDER_OUT_OF_BEAM_KM
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
			flight.firing,
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
