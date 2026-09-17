/**
 * What every carrier is called (`carrier-identity.md` §1, F3; `H1` of
 * `civilian-combat.md`).
 *
 * **Two strings, and both survive.** A **drawn proper name** — the thing a
 * pilot remembers and hunts — and a **composed registry** — the model, the
 * role and the ordinal a report is unambiguous about. `Kestrel TR-03` alone is
 * a registration number and not a quarry; a drawn name alone cannot settle
 * which of a station's three Porters a message means.
 *
 * **One module owns both halves for every carrier.** Naming was split between
 * `station-traffic.ts`'s callsign and `raider-slots.ts`'s `raiderName`, and a
 * shared drawn name left in either one makes that module the owner of the other
 * kind's identity. Both halves are here; the two kinds call into it.
 *
 * **The draw is per carrier key, never an ordered pass** (§1). Roster size is
 * conditional — on the berth catalogue, on government, on which station types a
 * system generated — so drawing names in roster order lets a conditional
 * carrier shift every later name. That is `domains.ts`'s own recorded hazard,
 * and `STATION_NAME`'s per-slot sub-stream exists for it. Seeding on
 * `carrierKeySeed(systemSeed, key)` under `DOMAIN.CARRIER_NAME` is what removes
 * the order from the draw; `tests/carrier-name.test.ts` flies a roster with a
 * carrier missing from it to hold that.
 *
 * **Uniqueness inside a system is not required**, and this is a deliberate
 * departure from `station-name.ts`'s `drawUniqueStationName`. The registry
 * disambiguates two ships that draw the same name, and a redraw loop would
 * reintroduce the ordered pass the per-key draw exists to escape.
 *
 * **A name is display; the key is identity** (#109's rule, F3). Nothing that
 * keys, saves or looks up may switch to a name, and the name is therefore
 * derived at the display tier rather than stored — it is a pure function of the
 * system seed, the carrier key and the instance, so there is no cache to
 * invalidate and nothing to migrate.
 */
import type { CarrierKey } from "./carrier-key";
import { carrierInstanceSeed } from "./carrier-standing";
import { DOMAIN } from "./domains";
import type { HullId } from "./hull";
import { systemName } from "./names";
import { seededRand } from "./rng";

/**
 * The model name beside each hull, the first half of a registry.
 *
 * Owned here rather than by the module that first printed one: a raider's model
 * and a freighter's belong to the same vocabulary, and `station-traffic.ts` is
 * not the authority on what a Marauder is called.
 */
export const HULL_MODEL_NAME: Readonly<Record<HullId, string>> = {
	courier: "Kestrel",
	interceptor: "Lance",
	freighter: "Porter",
	miner: "Longwall",
	patrol: "Warden",
	explorer: "Pilgrim",
	raider: "Marauder",
	carrier: "Carrier",
	tug: "Towline",
	prospector: "Prospector",
	dreadnought: "Dreadnought",
	voyager: "Odyssey",
};

/** Ordinals are shown one-based and two wide: `TR-01`, `Raider 01`. */
const ordinalLabel = (ordinal: number): string =>
	String(ordinal + 1).padStart(2, "0");

/**
 * The registry of one carrier flying one station's traffic: model, role code
 * and ordinal — `Porter TR-03`.
 *
 * The role code is the caller's because it is the *station's* fact
 * (`TRAFFIC_ROLE`), not a naming one; this module owns how the halves are put
 * together, which is the part that was duplicated.
 */
export const trafficRegistry = (
	hullId: HullId,
	roleCode: string,
	ordinal: number,
): string => `${HULL_MODEL_NAME[hullId]} ${roleCode}-${ordinalLabel(ordinal)}`;

/**
 * A raider slot's registry: `Raider 01`.
 *
 * The slot keeps a registry rather than a hull-and-role one because a raider is
 * enumerated by its slot, and the lifecycle log reports on the slot —
 * a replacement is a new ship (`H1`) in the same slot.
 */
export const raiderRegistry = (ordinal: number): string =>
	`Raider ${ordinalLabel(ordinal)}`;

/**
 * The drawn proper name of one carrier instance.
 *
 * Bell's digram vocabulary, the same one system and station names are built
 * from, drawn from the instance's own `DOMAIN.CARRIER_NAME` sub-stream. It
 * takes the instance ordinal because a replacement is a new ship: a killed
 * Porter does not come back wearing its own name, which would read as the
 * persistence layer confusing two vessels.
 */
export const carrierName = (
	systemSeed: number,
	key: CarrierKey,
	instanceOrdinal: number,
): string =>
	systemName(
		seededRand(
			carrierInstanceSeed(
				systemSeed,
				key,
				instanceOrdinal,
				DOMAIN.CARRIER_NAME,
			),
		),
	);
