/**
 * The pirate relay's identity and placement (#43, enrolled by #351).
 *
 * **Split out of `pirate-relay.ts` so `world-state.ts` can enumerate the
 * slot.** The relay module reaches `sim.ts` through `combat-enemy.ts`, and the
 * generator's carrier enumeration may not import that. What lives here is
 * what `enumerateCarriers` reads: the two persistence ids and the plan, which
 * is the relay's generated placement and so is part of the fingerprint.
 *
 * **Two slots per system with a station.** `relay-00` is the relay; its
 * `tender` is the repair ship #351's recovery sends to a destroyed one, a
 * carrier of its own so a kill of it saves like any other. Both are enumerated
 * whether or not the system's relay is *active*: activity is a runtime roll
 * (`pirate-relay.ts`), so re-tuning it is not a generator bump.
 *
 * Imports the generator's contents and orbit types, the galaxy's stream helper,
 * the domain table and the hull id type, and nothing that renders or simulates.
 */
import { type CarrierKey, carrierKey } from "./carrier-key";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import type { HullId } from "./hull";
import type { Orbit, SystemContents } from "./system";

/** The slot's persistence id. One per system; renaming it is a migration. */
export const RELAY_LOCAL_CARRIER_ID = "relay-00";

export interface RelaySlot {
	localCarrierId: string;
	key: CarrierKey;
}

export const relaySlot = (systemIndex: number): RelaySlot => ({
	localCarrierId: RELAY_LOCAL_CARRIER_ID,
	key: carrierKey(systemIndex, RELAY_LOCAL_CARRIER_ID),
});

/** The relay's repair tender (#351). Parented to the relay, so the id nests
 *  under it the way a Traffic ship's nests under its station. */
export const RELAY_TENDER_LOCAL_CARRIER_ID = `${RELAY_LOCAL_CARRIER_ID}/tender`;

export const relayTenderSlot = (systemIndex: number): RelaySlot => ({
	localCarrierId: RELAY_TENDER_LOCAL_CARRIER_ID,
	key: carrierKey(systemIndex, RELAY_TENDER_LOCAL_CARRIER_ID),
});

/**
 * How far along the watched station's orbit the relay stands, km. Hundreds
 * rather than thousands because it is reached in normal flight at the 2 km/s
 * assist cap — 120 km a minute — and a search is a few minutes, not a
 * commute. Drawn between the two, ahead or behind.
 */
export const RELAY_STANDOFF_KM = [400, 800] as const;
/** How far off the orbital plane it stands, km, either side. */
export const RELAY_OFFPLANE_KM = 120;
/** The search region: a sphere of this radius about the watched station. It
 *  holds every standoff the draw can give. */
export const RELAY_REGION_KM = 1_000;

/** The plan: which station the relay watches, and where it stands relative to
 *  that station. Pure in the system, so it is never saved. */
export interface RelayPlan {
	watchedStationId: string;
	watchedLocalCarrierId: string;
	/** The station's parent planet, or null for a star-centric orbit. */
	parentId: string | null;
	/** The watched station's orbit, phase-shifted by the standoff. */
	orbit: Orbit;
	/** Signed: positive is ahead of the station along its orbit. */
	leadKm: number;
	/** Signed: along the orbit's normal. */
	offPlaneKm: number;
}

/** The station a system's relay watches: the trade station where there is
 *  one, otherwise the next role in this order. */
const WATCH_ORDER = ["trade", "shipyard", "refinery", "outpost"] as const;

export function relayPlan(
	contents: SystemContents,
	systemSeed: number,
): RelayPlan | null {
	const { stations } = contents;
	if (stations.length === 0) return null;
	const watched =
		WATCH_ORDER.map((type) => stations.find((s) => s.type === type)).find(
			(s) => s !== undefined,
		) ?? stations[0];
	const rand = stream(systemSeed, DOMAIN.RELAY);
	const ahead = rand() < 0.5;
	const standoff =
		RELAY_STANDOFF_KM[0] +
		(RELAY_STANDOFF_KM[1] - RELAY_STANDOFF_KM[0]) * rand();
	const offPlaneKm = (rand() < 0.5 ? -1 : 1) * RELAY_OFFPLANE_KM;
	const leadKm = ahead ? standoff : -standoff;
	return {
		watchedStationId: watched.id,
		watchedLocalCarrierId: watched.localCarrierId,
		parentId: watched.parentId,
		orbit: {
			...watched.orbit,
			theta0: watched.orbit.theta0 + leadKm / watched.orbit.radiusKm,
		},
		leadKm,
		offPlaneKm,
	};
}

/** The tender's hull: the salvage role's, which is what a repair ship is. It
 *  is generated type, so changing it is a generator bump. */
export const RELAY_TENDER_HULL_ID: HullId = "tug";
