/**
 * Raider encounter carriers, and the law that brings one onto a cruise leg
 * (node #324 part b).
 *
 * **A raider is a named carrier slot, not a spawn.** `combat-model.md` §4 has a
 * resolved encounter change a named carrier rather than delete a generic
 * spawn, and §6 forbids an unbounded encounter ledger — so each system holds a
 * fixed, generated set of raider slots, keyed like any other carrier. The
 * principal's ruling (2026-09-14) is that they are **enumerated** with the
 * station and Traffic slots, and that a system can hold more than one, because
 * several raiders may attack together later. `station-traffic.md` §1 keeps
 * raider hulls out of the station rosters; this is where they live instead.
 *
 * **The leg law** is a seeded draw per system and leg: the chance falls with
 * the system's `government` and a Corporate State keeps a smaller one (also
 * the principal's). The draw names which slot, at which bearing — behind,
 * alongside or ahead — how far into the leg, and at what range.
 *
 * Imports only leaves and the galaxy's stream helper, so `world-state.ts` can
 * enumerate these slots without a cycle.
 */
import { type CarrierKey, carrierKey } from "./carrier-key";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import type { HullId } from "./hull";
import { mix } from "./rng";

export const RAIDER_HULL_ID: HullId = "raider";

/** How many raider slots a system holds: four in the two most lawless
 *  governments, one in the two most lawful. Never none. */
export const raiderSlotCount = (government: number): number =>
	4 - Math.floor(clampGovernment(government) / 2);

export interface RaiderSlot {
	localCarrierId: string;
	key: CarrierKey;
}

/** A system's raider slots, in ordinal order. The id table is persistence
 *  identity: renaming it is a save migration. */
export const raiderSlots = (
	systemIndex: number,
	government: number,
): RaiderSlot[] =>
	Array.from({ length: raiderSlotCount(government) }, (_, ordinal) => {
		const localCarrierId = `raider-${String(ordinal).padStart(2, "0")}`;
		return { localCarrierId, key: carrierKey(systemIndex, localCarrierId) };
	});

/** The chance in an Anarchy (government 0) and a Corporate State (7), by the
 *  principal's ruling of 2026-09-15; `combat-model.md` §3 gives the figures it
 *  replaced, the reason and what it changes. */
export const RAIDER_LEG_CHANCE = { anarchy: 0.6, corporate: 0.2 } as const;

/** A cruise leg's chance of an encounter, linear in government between the two
 *  ends. */
export const raiderLegChance = (government: number): number =>
	RAIDER_LEG_CHANCE.anarchy +
	((RAIDER_LEG_CHANCE.corporate - RAIDER_LEG_CHANCE.anarchy) *
		clampGovernment(government)) /
		7;

/** Seconds into a leg before the raider appears. */
export const ENCOUNTER_DELAY_S = [8, 40] as const;
/** How far from the player it appears, km. Inside the contest's range. */
export const ENCOUNTER_RANGE_KM = [20, 50] as const;

/**
 * The pirate relay's dial on the leg law (node #43, `pirate-relay.ts`).
 *
 * `law` is the draw above. `certain` is a route the relay watches while it is
 * operational: the raiders are told about every ship on it, so every leg
 * meets one (given an operational slot to send). `none` is that route while
 * the relay is down: the raiders are blind there. Other routes are never
 * anything but `law`.
 */
export type RouteDetection = "law" | "certain" | "none";

export type EncounterBearing = "behind" | "alongside" | "ahead";
const BEARINGS: readonly EncounterBearing[] = ["behind", "alongside", "ahead"];

export interface LegEncounter {
	slotIndex: number;
	bearing: EncounterBearing;
	delayS: number;
	rangeKm: number;
	/** A unit draw for which way round "alongside" falls, and the offset's roll
	 *  about the heading for the other two. */
	rollUnit: number;
}

/**
 * Whether a leg meets a raider, and the encounter if it does.
 *
 * `legOrdinal` identifies the leg. `Game` passes the whole second of game time
 * at which the spool completes, so **the chance is per spool, not per route**:
 * a leg cancelled and spooled again draws again, and a replay reproduces a
 * draw only if its spool completes in the same second (sage round 1 — an
 * earlier version of this comment promised a replayed leg the same encounter,
 * which nothing held). The stream is the system's own seed split by
 * `DOMAIN.ENCOUNTER` and then by that ordinal, so no other draw in the system
 * shifts it.
 */
export function legEncounter(
	systemSeed: number,
	government: number,
	legOrdinal: number,
	detection: RouteDetection = "law",
): LegEncounter | null {
	if (detection === "none") return null;
	const rand = stream(mix(systemSeed, legOrdinal >>> 0), DOMAIN.ENCOUNTER);
	// The chance is drawn whatever the dial says, so a `certain` leg meets the
	// same raider the same way the law would have: the dial skips the test and
	// not the draw.
	const chance = rand();
	if (detection === "law" && chance >= raiderLegChance(government)) return null;
	const count = raiderSlotCount(government);
	return {
		slotIndex: Math.min(count - 1, Math.floor(rand() * count)),
		bearing: BEARINGS[Math.min(2, Math.floor(rand() * 3))],
		delayS: lerp(ENCOUNTER_DELAY_S, rand()),
		rangeKm: lerp(ENCOUNTER_RANGE_KM, rand()),
		rollUnit: rand(),
	};
}

function clampGovernment(government: number): number {
	return Math.max(0, Math.min(7, Math.round(government)));
}

const lerp = (range: readonly [number, number], t: number): number =>
	range[0] + (range[1] - range[0]) * t;
