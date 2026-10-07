/**
 * The persistent world state model — `docs/specs/persistent-world-state.md`.
 *
 * seelite regenerates its universe from the world seed and the authoritative
 * game clock, then overlays *only* what a seed cannot produce: what the player
 * knows, how carriers currently deviate from their generated condition, why,
 * and the other typed per-galaxy domains (§7). This module is that overlay and
 * nothing else — no geometry, no positions, no capability projections. §8's
 * rule is a rule about this file: if it can be derived from the baseline plus
 * the clock, it does not live here.
 *
 * **Headless, and it must stay that way.** Nothing here imports Three.js or
 * touches the DOM; the model is arithmetic and a state machine, which is what
 * lets §9's obligations be checked in `bun test` alone.
 *
 * Three properties are easy to lose and expensive to get back:
 *
 * - **Recovery is derived, never ticked** (§4). A repair that ends at minute 70
 *   is a `completesAt` on a row, and reading at 69.999 and at 70 gives
 *   different answers with no loop in between. `advanceTo` exists to *persist*
 *   that materialization, not to discover it, and it records `occurredAt =
 *   completesAt` however late it runs — so when the completion is first noticed
 *   cannot leak into the save.
 * - **Knowledge and condition are independent axes** (§3). A carrier can be
 *   wreckage the player still believes is trading. Only a player-caused
 *   transition or an explicit `observe` moves the knowledge row; a lazily
 *   materialized completion never does, because the player knew the schedule
 *   and not its outcome.
 * - **Growth is bounded by the carrier set, not by hours played** (§6). At most
 *   one objective delta, one causal-episode summary and one knowledge row per
 *   carrier key, whatever happens to it. There is no event log here.
 */

import {
	type CarrierKey,
	carrierKey,
	compareCarrierKeys,
	isCarrierKey,
	localCarrierIdOfKey,
	systemIndexOfKey,
} from "./carrier-key";
import { type DeficitMap, parseDeficits } from "./deficits";
import {
	DERELICT_FITTINGS,
	DERELICT_MAX_CONTAINERS,
	type DerelictContainerKind,
	type DerelictPhase,
	derelictContents,
	derelictOrdinalOf,
	derelictSlotCount,
	derelictSlots,
	derelictTimeline,
} from "./derelict-slots";
import { generateGalaxy, type SystemRecord, systemAt } from "./galaxy";
import { COMMODITIES, EQUIPMENT, ESCAPE_POD } from "./market";
import { HULL_IDS, type HullId } from "./hull";
import type { Vec3 } from "./vec3";
import { fnv1a } from "./rng";
import { RAIDER_HULL_ID, raiderSlots } from "./raider-slots";
import {
	RELAY_TENDER_HULL_ID,
	relayPlan,
	relaySlot,
	relayTenderSlot,
} from "./relay-slot";
import type { StationType } from "./station";
import {
	NO_FLOWN_VOYAGE,
	nextTrafficDepartureAtS,
	stationTrafficRoster,
	type TrafficActor,
} from "./station-traffic";
import { generateContents } from "./system";

// **Not re-exported.** `carrier-key.ts` is the one owner; a second path to the
// same names is the coupling it was extracted to prevent. Import from there.

/**
 * The mutable-state schema version (§2). Bump when the shape of anything in a
 * `GalaxyEnvelope` changes; the save/load node owns migration and rejection.
 *
 * **3 is #364's scan record.** A `KnowledgeRow` gained a `scan` member and
 * relaxed its condition triple from required to optional, and §9.6's rule is
 * that a mismatch refuses with a named message and leaves the record on disk
 * rather than reading an old body as though the new member had always been
 * there — which is how §9.10 handled the black-market marker's arrival, and the
 * reason a v2 save is refused here rather than interpreted.
 */
export const WORLD_SCHEMA_VERSION = 3;

/**
 * The seeded-baseline version (§2). Bump on **any** generator change that can
 * alter a carrier's identity, type, parent or generated placement — which is
 * exactly the set `carrierBaselineFingerprint` hashes, so the pinned
 * fingerprints in `world-state.test.ts` go red at the same moment.
 */
export const WORLD_GENERATOR_VERSION = 10;

/**
 * Generator versions a snapshot may still carry. Version 6 → 7 was a pure
 * relabel (#351). Version 8 changes the generated parent and position of some
 * shipyards (#590), so 6/7 now migrate by rebasing their overlays onto the new
 * baseline. No carrier geometry is persisted; every old carrier key and type
 * still names the same station or vessel. `tests/world-state.test.ts` pins
 * those identities against fingerprints captured on the version-7 generator.
 * A docked commander keeps its station key and resumes at arrival, as the
 * loader already does; an in-flight commander keeps its saved position.
 * Version 8 → 9 (node #491) only **adds**: a raider outpost and its Traffic
 * Carrier slots in every system at the lawless end of the government scale. No
 * version-8 carrier changes identity, type, parent or placement, which
 * `tests/world-state.test.ts` pins twice over every carrier but the outpost's:
 * the identity goldens for system, Carrier slot and type, and version 8's full
 * baseline fingerprints for parent and placement. So an 8 save rebases exactly
 * as a 7 does.
 * Version 9 → 10 (node #731) only **adds** too: one to three derelict slots in
 * every system, by government (`derelict-slots.ts`). Nothing drawn moved, and
 * `tests/world-state.test.ts` holds version 9's full baseline fingerprints over
 * every carrier but the derelicts, so a 9 save rebases exactly as an 8 does.
 * Version 5 is not here, and listing it would open nothing: saves
 * shipped on 2026-09-11 at version 5, but `WORLD_SCHEMA_VERSION` 3 arrived on
 * 09-18 after version 6, so every version-5 snapshot carries schema 2 and the
 * schema check refuses it first.
 */
// glossary-ignore: slot
export const LEGACY_WORLD_GENERATOR_VERSIONS: readonly number[] = [9, 8, 7, 6];

export const GALAXY_COUNT = 8;

// ---------------------------------------------------------------------------
// §3 — the two state axes
// ---------------------------------------------------------------------------

/** §3.2. There is no "partly operational": degradation is a per-capability
 *  projection over one of these, never a percentage in the save. */
export type OperationalCondition =
	| "operational"
	| "disabled"
	| "destroyed"
	| "repairing";

/** §5's player role. `opposed` is the player fighting *against* a recovery. */
export type PlayerRole = "direct" | "assisted" | "opposed" | "none";

export type RecoveryKind = "repair" | "replacement";

/**
 * §4's transition kinds.
 *
 * `restore` is the one family the spec lists as a state pair without naming
 * ("disabled → operational"): an instant restoration with no recovery process
 * behind it. `recovery-change` is §5's "assistance" widened to the three things
 * §4 allows to change a live descriptor — assistance, opposition, rescheduling
 * — because all three are the same edit to the same row and only the
 * provenance differs.
 */
export type TransitionKind =
	| "disable"
	| "destroy"
	| "restore"
	| "repair-start"
	| "replacement-start"
	| "recovery-change"
	| "interrupt"
	| "repair-complete"
	| "replacement-complete";

/** §5's cause. Every transition carries one; routine orbital motion, market
 *  epochs and mere observations are not transitions and have none. */
export interface Provenance {
	causeKind: string;
	actorId: string;
	playerRole: PlayerRole;
}

/** §4's recovery-process descriptor. Named and interruptible, so later flight
 *  can put a convoy or a construction stage in front of the player. */
export interface RecoveryDescriptor {
	kind: RecoveryKind;
	processId: string;
	consequenceArea: string;
	startedAt: number;
	completesAt: number;
	initiatedBy: Provenance;
}

/**
 * A replacement a destruction schedules for later (#324 part d, by the
 * principal's ruling). **Its start materializes lazily at `startsAt`, as a
 * completion does at `completesAt` (§4)**, so it needs no observer: a raider
 * killed before the player leaves its system is repairing on time wherever the
 * player is. An explicit start could not do that, because `applyTransition`
 * refuses a time before the clock.
 *
 * The process identity is fixed at the destruction, from its episode, so the
 * start it materializes is the same process an explicit start would have been.
 */
export interface ScheduledRecovery {
	processId: string;
	consequenceArea: string;
	startsAt: number;
	completesAt: number;
	initiatedBy: Provenance;
}

/** §5's bounded transition fact. */
export interface TransitionFact {
	key: CarrierKey;
	instanceOrdinal: number;
	episodeOrdinal: number;
	kind: TransitionKind;
	occurredAt: number;
	cause: Provenance;
	processId?: string;
}

/**
 * §5's causal episode: the initiating transition, the intervention that opened
 * a recovery inside it, and the latest outcome. Not a log — a later unrelated
 * episode replaces this one wholesale, and losing the older attribution is the
 * accepted cost of the §6 bound.
 */
export interface CausalEpisode {
	ordinal: number;
	initiating: TransitionFact;
	intervention?: TransitionFact;
	latest: TransitionFact;
	/** An episode is closed by a completion, a restoration or an interruption.
	 *  A start after that opens the next one, which is what makes a restarted
	 *  process a *different* process (§4). */
	closed: boolean;
}

/** §6's "current objective delta". Absent means the generated carrier is
 *  operational with nothing scheduled. */
export interface ObjectiveDelta {
	instanceOrdinal: number;
	condition: OperationalCondition;
	recovery?: RecoveryDescriptor;
	/** On a destroyed row only: the replacement its destruction scheduled. */
	scheduled?: ScheduledRecovery;
}

/** §3.1's report vocabulary gains one channel (`carrier-identity.md` §5). Named
 *  here because it is written twice in one row — the row's last-contact stamp
 *  and the scan's own record — and a third copy in the display tier is where a
 *  label and its channel part company. */
export const SCAN_SOURCE = "scan";

/** §3.1's snapshot of a recovery as the player last saw it. Deliberately a
 *  copy, not a reference: it is intelligence, and it goes stale. */
export interface ObservedRecovery {
	processId: string;
	kind: RecoveryKind;
	consequenceArea: string;
	startedAt: number;
	completesAt: number;
}

/**
 * `carrier-identity.md` §5's scan observation, and nothing else.
 *
 * **What was read is not stored.** Standing and the hold are pure functions, so
 * the reading is re-derived from these four terms at display time — the same
 * idiom `knownPrivateFacts.blackMarket` two lines below is built on, and for the
 * same reason: a stored copy would duplicate derivable state inside a versioned
 * save.
 *
 * **The two ordinals are here because #362 made them unrecoverable.** The
 * instance the reading was taken on, and the voyage it was taken during, are
 * what `carrierStanding` and `carrierManifest` need as arguments; the voyage is
 * `flownVoyageOrdinal`, which depends on the route as it stood at that moment
 * and cannot be recomputed from the clock. A row that stored only the clock
 * would re-derive a *different* hold than the one the pilot was shown, which is
 * the disagreement §5 refuses to ship.
 *
 * **A condition observation is not here, and that is the shape's whole point.**
 * F5 grants a scan its standing and its hold, not its hull condition: writing
 * `operational` because the ship is visibly flying would be knowledge the verb
 * did not earn, shown on the galaxy map as though the pilot had checked.
 */
export interface CarrierScanObservation {
	observedAt: number;
	source: string;
	observedInstanceOrdinal: number;
	/**
	 * The voyage whose hold was read (F11). **It may hold Traffic's
	 *  `NO_FLOWN_VOYAGE` sentinel**, which is what `trafficVoyage` answers for a
	 *  carrier that has not departed and is the value `carrierManifest` is already
	 *  asked for on the Flight console. Storing what was read, rather than a 0
	 *  that was never read, is what keeps the record and the console from being
	 *  two answers to one question.
	 */
	observedVoyageOrdinal: number;
}

/**
 * §3.1's last-known row. No row at all means undiscovered.
 *
 * **One row, up to two observations.** The condition triple — instance,
 * condition, and the `observedRecovery` snapshot that only means something
 * beside a condition — is one observation, and `scan` is another. Each carries
 * its own clock and channel, because a pilot can scan a carrier they docked at
 * and a carrier they docked at can be scanned, in either order, and neither
 * fact may overwrite the other.
 *
 * **The condition triple is optional since #364, as a group.** A scanned
 * ordinary carrier is *known* and has never had its condition observed, and
 * §5's alternative — a scan that also records a condition observation — would
 * fabricate the one thing F5 does not reveal. The parser enforces the grouping:
 * a row carries both or neither, and carries at least one observation.
 *
 * `observedAt` and `source` are the row's **last contact** stamp: when this
 * carrier was last heard of by any channel, and which. That is what the record
 * card prints beside the condition, and it is the reading a two-observation row
 * has to have; the condition's own age is not stored separately, which is true
 * of the single-observation row too.
 */
export interface KnowledgeRow {
	observedInstanceOrdinal?: number;
	observedCondition?: OperationalCondition;
	observedAt: number;
	source: string;
	observedRecovery?: ObservedRecovery;
	/** The last completed scan of this carrier, and none of what it read. */
	scan?: CarrierScanObservation;
	/**
	 * Private facility facts, each known only after an explicit docking report.
	 *
	 * **Plural container, optional members.** `blackMarket` was mandatory
	 * whenever the container existed, so a carrier whose only checked fact was a
	 * later one had no representable row — and this shape is behind
	 * `WORLD_SCHEMA_VERSION`, where correcting it once saves exist costs a
	 * migration rather than an edit.
	 */
	knownPrivateFacts?: {
		blackMarket?: { learnedAt: number; source: string };
	};
}

/**
 * §7's per-galaxy legal-status slot.
 *
 * The *semantics* — thresholds, decay, what counts as an offence, which station
 * this makes hostile — belong to the law (`legal.ts`), not here. What §7
 * requires of this model is that the domain has a typed home inside the
 * envelope and survives a round trip. Anything derived from it (a Clean /
 * Wanted / Fugitive label, a station's hostility, a police response) is a §8
 * projection and must not be saved.
 *
 * **`witnesses` is the third member, and it is saved rather than derived
 * because nothing it can be derived from is saved** (#366 H6). Which berths were
 * in earshot is where the *victim* stood at one instant of a session;
 * session-only hostility lets a reload or a jump out and back clear what decay
 * is meant to clear. It holds each station at most once — `legal.ts`'s write
 * keeps it so — and it is empty far more often than not, which is why
 * `canonicalEnvelope` omits it when it is: writing `"witnesses": []` onto every
 * row would change the bytes every save ever taken hashes to, and the integrity
 * check would then refuse an old save as corrupt rather than migrating it.
 */
export interface LegalStatus {
	heat: number;
	updatedAt: number;
	/** The stations that heard an offence, in `compareCarrierKeys` order. */
	witnesses: CarrierKey[];
	/**
	 * The ordinary carriers whose **sustained-fire charge** this pilot has
	 * already paid, in `compareCarrierKeys` order (#396, `legal.ts`).
	 *
	 * The fourth member, arriving by the same door as the third and for the same
	 * two reasons: absent on the wire when empty, so the integrity hash of every
	 * save taken before #396 still matches its own body, and no
	 * `WORLD_SCHEMA_VERSION` bump — which would refuse the whole save rather than
	 * migrate one member.
	 *
	 * It is a list of carriers and not a field on each carrier's row because an
	 * assault is the one offence that leaves no mark on the ship: H3d's `disable`
	 * is the only transition a civilian under fire ever gets, and the rung exists
	 * precisely to charge a pilot *before* the hull gives way. `legal.ts`'s header
	 * owns that argument; this is where the fact is kept.
	 */
	assaulted: CarrierKey[];
}

/**
 * One container on a wreck's row (`salvage.md` S6, S20): what it holds, the
 * tonnes it was drawn with, and the tonnes still in it.
 *
 * **`tonnes` is stored, not re-derived**, and that is a reading of the node
 * worth stating. The parse refuses a container whose `left` is above its line,
 * and the line it reads is this one — the tonnes the draw gave when the row was
 * written — rather than a fresh draw, because a stored instance is never
 * re-derived: a parser that re-drew would refuse every saved wreck the day the
 * draw was retuned. A changed draw reaches only the instances no row holds yet,
 * which is S6's promise as node #731 reads it: contents are pinned on first
 * touch, not at the loss (`persistent-world-state.md` §7).
 */
export interface DerelictContainer {
	kind: DerelictContainerKind;
	/** A commodity name for a good, an `EQUIPMENT` name for a fitting. */
	id: string;
	/** Initial quantity: tonnes, or native kg/g for a death wreck's small good. */
	tonnes: number;
	/** Remaining quantity in the same unit. Zero is a scooped-out container, still listed,
	 *  so a container index names one container for the instance's life. */
	left: number;
}

/**
 * A derelict slot's saved row (`salvage.md` S1, S2, S6, S16): **one per slot
 * key**, whatever happens to the slot, which is §6's bound.
 *
 * It records one instance — the one the pilot last touched — and anchors the
 * schedule there (`derelictTimeline`). A slot with no row is derived whole from
 * the clock; a row that later instances have overtaken still anchors the walk,
 * and the next write replaces it. `condition` is not stored: an instance on a
 * row is `destroyed` until `salvaged` is written or other salvagers take it
 * on the clock, so storing it would be a second copy of the schedule.
 */
export interface DerelictRow {
	instanceOrdinal: number;
	/** When this instance was lost, from the schedule. */
	lostAt: number;
	/** Index order is container order: a Salvage job's operand names one by it. */
	containers: DerelictContainer[];
	/** Written when the pilot strips the last container (S2). Other salvagers'
	 *  strip is the clock's and is never written. */
	salvaged?: { at: number; cause: Provenance };
}

/** One commander-owned wreck across the eight galaxies, never a generated slot.
 * Shares the salvage row; only its non-derivable placement is extra. */
export interface DeathWreckRow extends DerelictRow {
	key: CarrierKey;
	hull: HullId;
	bodyId: string;
	offset: Vec3;
}
export const isDeathWreckKey = (key: CarrierKey) =>
	localCarrierIdOfKey(key) === "commander-wreck";
export const DEATH_WRECK_MAX_CONTAINERS = 512;

/**
 * §7's typed per-galaxy envelope: **eight state domains** — objective deltas,
 * causal episodes, knowledge, market deficits, visited flags, legal status and // glossary-ignore: slot, Legal status
 * derelict rows and the commander death wreck.
 *
 * `galaxyIndex` is the container's identity rather than a state domain. It
 * lives here once, and every station-keyed domain stores the envelope-relative
 * `(systemIndex, localCarrierId)` pair and gets its galaxy from the container.
 */
export interface GalaxyEnvelope {
	deathWreck?: DeathWreckRow;
	galaxyIndex: number;
	objective: Record<CarrierKey, ObjectiveDelta>;
	episodes: Record<CarrierKey, CausalEpisode>;
	knowledge: Record<CarrierKey, KnowledgeRow>;
	deficits: DeficitMap;
	/** System indices the player has visited, ascending. */
	visited: number[];
	legalStatus: LegalStatus;
	/** Derelict slots the pilot has touched (`salvage.md`, node #731). Empty // glossary-ignore: slot
	 *  means every slot is on its derived schedule, untouched. */
	derelicts: Record<CarrierKey, DerelictRow>;
}

export interface WorldState {
	worldSchemaVersion: number;
	worldGeneratorVersion: number;
	seed: number;
	/** The authoritative clock (§4). Every lazy derivation reads it. */
	gameTime: number;
	galaxies: GalaxyEnvelope[];
}

/**
 * The envelope's declared fields: **eight state domains plus the container's
 * own identity**, `galaxyIndex`, which is not one of them. Anything else in a
 * serialized envelope is rejected (§9.2) — a save is not an open bag.
 */
const ENVELOPE_DOMAINS = [
	"galaxyIndex",
	"objective",
	"episodes",
	"knowledge",
	"deficits",
	"visited",
	"legalStatus",
	"derelicts",
	"deathWreck",
] as const;

/**
 * The declared domains a serialized envelope may leave out, because absent
 * means empty. `derelicts` arrived after saves shipped (node #731), and an
 * envelope that writes `"derelicts": {}` would move the integrity hash of every
 * save taken before it — the reason `witnesses` is omitted when empty (§7).
 */
const OPTIONAL_ENVELOPE_DOMAINS: ReadonlySet<string> = new Set([
	"derelicts",
	"deathWreck",
]);

const WORLD_FIELDS = [
	"worldSchemaVersion",
	"worldGeneratorVersion",
	"seed",
	"gameTime",
	"galaxies",
	"integrity",
] as const;

export const emptyEnvelope = (galaxyIndex: number): GalaxyEnvelope => ({
	galaxyIndex,
	objective: {},
	episodes: {},
	knowledge: {},
	deficits: {},
	visited: [],
	legalStatus: { heat: 0, updatedAt: 0, witnesses: [], assaulted: [] },
	derelicts: {},
});

export const newWorld = (seed: number): WorldState => ({
	worldSchemaVersion: WORLD_SCHEMA_VERSION,
	worldGeneratorVersion: WORLD_GENERATOR_VERSION,
	seed,
	gameTime: 0,
	galaxies: Array.from({ length: GALAXY_COUNT }, (_, i) => emptyEnvelope(i)),
});

// ---------------------------------------------------------------------------
// §2 — identity, and the baseline it is pinned against
// ---------------------------------------------------------------------------

/** One generated carrier slot, as the persistence layer sees it. */
interface GeneratedCarrierBase {
	systemIndex: number;
	localCarrierId: string;
	key: CarrierKey;
	parentId: string | null;
}

/** A generated orbit: a station's, and the station's Traffic's. */
interface GeneratedPlacement {
	orbitRadiusKm: number;
	orbitTheta0: number;
}

/** Generated facts for the fingerprint only. They are never persisted. */
export type GeneratedCarrier = GeneratedCarrierBase &
	(
		| ({ kind: "station"; stationType: StationType } & GeneratedPlacement)
		| ({
				kind: "traffic";
				homeStationType: StationType;
				hullId: HullId;
		  } & GeneratedPlacement)
		/** A raider encounter slot (`raider-slots.ts`, #324). It belongs to its
		 *  system rather than to a station, so it has no parent and no orbit —
		 *  and carries no placeholder zeros for one, which the fingerprint would
		 *  otherwise pin (sage round 1). */
		| { kind: "raider"; hullId: HullId }
		/** The pirate relay (#351): a system slot like a raider's, whose generated
		 *  placement is its plan — the station it watches and where it stands
		 *  relative to it — rather than an orbit of its own. */
		| {
				kind: "relay";
				watchedLocalCarrierId: string;
				leadKm: number;
				offPlaneKm: number;
		  }
		/** The relay's repair tender (#351), parented to the relay. It flies in
		 *  when it is sent, so like a raider it has no generated placement. */
		| { kind: "relay-tender"; hullId: HullId }
		/** A derelict slot (`derelict-slots.ts`, node #731). A system's, with no // glossary-ignore: slot
		 *  parent. Its hull and its seeded offset are the drawing build's
		 *  (`salvage.md` S11, S26), so it has no generated placement yet. */
		| { kind: "derelict" }
	);

/**
 * Every generated carrier slot in one galaxy, in system order.
 *
 * This is the *baseline* half of §1's split, exposed so a test can assert the
 * namespace over the whole corpus rather than over the handful of systems a
 * play session happens to reach.
 */
export function* enumerateCarriers(
	worldSeed: number,
	galaxyIndex: number,
): Generator<GeneratedCarrier> {
	const galaxy = generateGalaxy(worldSeed, galaxyIndex);
	for (
		let systemIndex = 0;
		systemIndex < galaxy.systems.length;
		systemIndex++
	) {
		const record = galaxy.systems[systemIndex];
		const contents = generateContents(record);
		for (const station of contents.stations) {
			yield {
				systemIndex,
				localCarrierId: station.localCarrierId,
				key: carrierKey(systemIndex, station.localCarrierId),
				kind: "station",
				stationType: station.type,
				parentId: station.parentId,
				orbitRadiusKm: station.orbit.radiusKm,
				orbitTheta0: station.orbit.theta0,
			};
			for (const actor of stationTrafficRoster(systemIndex, station))
				yield {
					systemIndex,
					localCarrierId: actor.localCarrierId,
					key: actor.key,
					kind: "traffic",
					homeStationType: station.type,
					hullId: actor.hullId,
					parentId: station.id,
					orbitRadiusKm: station.orbit.radiusKm,
					orbitTheta0: station.orbit.theta0,
				};
		}
		for (const slot of raiderSlots(systemIndex, record.government))
			yield {
				systemIndex,
				localCarrierId: slot.localCarrierId,
				key: slot.key,
				kind: "raider",
				hullId: RAIDER_HULL_ID,
				parentId: null,
			};
		const plan = relayPlan(contents, record.seed);
		if (plan) {
			const relay = relaySlot(systemIndex);
			yield {
				systemIndex,
				localCarrierId: relay.localCarrierId,
				key: relay.key,
				kind: "relay",
				parentId: null,
				watchedLocalCarrierId: plan.watchedLocalCarrierId,
				leadKm: plan.leadKm,
				offPlaneKm: plan.offPlaneKm,
			};
			const tender = relayTenderSlot(systemIndex);
			yield {
				systemIndex,
				localCarrierId: tender.localCarrierId,
				key: tender.key,
				kind: "relay-tender",
				hullId: RELAY_TENDER_HULL_ID,
				parentId: relay.localCarrierId,
			};
		}
		// glossary-ignore: slot
		for (const slot of derelictSlots(systemIndex, record.government))
			yield {
				systemIndex,
				localCarrierId: slot.localCarrierId,
				key: slot.key,
				kind: "derelict",
				parentId: null,
			};
	}
}

/** The generated type a fingerprint line carries, per kind. */
const fingerprintType = (c: GeneratedCarrier): string => {
	switch (c.kind) {
		case "station":
			return c.stationType;
		case "traffic":
			return `traffic:${c.homeStationType}:${c.hullId}`;
		case "raider":
			return `raider:${c.hullId}`;
		case "relay":
			return "relay";
		case "relay-tender":
			return `relay-tender:${c.hullId}`;
		case "derelict":
			return "derelict";
	}
};

/**
 * A fingerprint line's placement, per kind. A raider or tender slot has none,
 * so its line ends at the parent. The station and Traffic lines are byte for
 * byte what version 5 hashed and the raider lines what version 6 did, which
 * `tests/world-state.test.ts` holds against both versions' goldens. A relay's
 * placement is its plan: the watched station and the standoff.
 */
const fingerprintPlacement = (c: GeneratedCarrier): string => {
	switch (c.kind) {
		case "station":
		case "traffic":
			return `|${c.orbitRadiusKm.toFixed(6)}|${c.orbitTheta0.toFixed(6)}`;
		case "relay":
			return `|${c.watchedLocalCarrierId}|${c.leadKm.toFixed(6)}|${c.offPlaneKm.toFixed(6)}`;
		case "raider":
		case "relay-tender":
		case "derelict":
			return "";
	}
};

/**
 * §9.1's baseline fingerprint: identity, type, parent and generated placement
 * for a whole galaxy, hashed.
 *
 * **The point is that it is brittle.** Any generator edit that moves a station
 * or renames its slot changes this number, and a changed number with no
 * `WORLD_GENERATOR_VERSION` bump is a save-migration bug caught at the moment
 * it is introduced rather than by a player whose market memory has silently
 * moved to a different station.
 *
 * `keep` narrows the hashed set and is the identity by default. It exists so a
 * release that only **adds** carriers can be checked against the version before
 * it: hash every carrier but the added ones and compare with that version's
 * goldens, which is how node #491's outpost is held to have moved nothing.
 */
export const carrierBaselineFingerprint = (
	worldSeed: number,
	galaxyIndex: number,
	keep: (c: GeneratedCarrier) => boolean = () => true,
): number => {
	const parts: string[] = [];
	for (const c of enumerateCarriers(worldSeed, galaxyIndex))
		if (keep(c))
			parts.push(
				`${c.systemIndex}|${c.localCarrierId}|${fingerprintType(c)}|${c.parentId ?? "-"}${fingerprintPlacement(c)}`,
			);
	return fnv1a(parts.join("\n"));
};

const sortedKeys = <T>(map: Record<string, T>): CarrierKey[] =>
	(Object.keys(map) as CarrierKey[]).sort(compareCarrierKeys);

/** §4's deterministic process identity: carrier slot, causal episode, kind. A
 *  restart lands in a new episode, so it gets a new identity for free. */
export const recoveryProcessId = (
	key: CarrierKey,
	episodeOrdinal: number,
	kind: RecoveryKind,
): string => `${key}#${episodeOrdinal}:${kind}`;

// ---------------------------------------------------------------------------
// §4 — lazy recovery
// ---------------------------------------------------------------------------

/** The effective state of one carrier at `gameTime`, with any due completion
 *  applied *virtually* — a read never has to write to be right. */
export interface EffectiveCarrier {
	instanceOrdinal: number;
	condition: OperationalCondition;
	recovery: RecoveryDescriptor | undefined;
}

const materialized = (delta: ObjectiveDelta): ObjectiveDelta => ({
	instanceOrdinal:
		delta.recovery?.kind === "replacement"
			? delta.instanceOrdinal + 1
			: delta.instanceOrdinal,
	condition: "operational",
});

/** A scheduled start, applied: the destroyed row becomes the repairing one its
 *  schedule named. */
const started = (
	delta: ObjectiveDelta,
	s: ScheduledRecovery,
): ObjectiveDelta => ({
	instanceOrdinal: delta.instanceOrdinal,
	condition: "repairing",
	recovery: {
		kind: "replacement",
		processId: s.processId,
		consequenceArea: s.consequenceArea,
		startedAt: s.startsAt,
		completesAt: s.completesAt,
		initiatedBy: s.initiatedBy,
	},
});

const startDue = (
	delta: ObjectiveDelta | undefined,
	gameTime: number,
): delta is ObjectiveDelta & { scheduled: ScheduledRecovery } =>
	delta?.condition === "destroyed" &&
	delta.scheduled !== undefined &&
	gameTime >= delta.scheduled.startsAt;

const completionDue = (
	delta: ObjectiveDelta | undefined,
	gameTime: number,
): boolean =>
	delta?.condition === "repairing" &&
	delta.recovery !== undefined &&
	gameTime >= delta.recovery.completesAt;

const isDue = (delta: ObjectiveDelta | undefined, gameTime: number): boolean =>
	startDue(delta, gameTime) || completionDue(delta, gameTime);

/** Every lazy step due on one row, in time order: a scheduled start, then the
 *  completion, which may already be due too. */
const settle = (delta: ObjectiveDelta, gameTime: number): ObjectiveDelta => {
	const afterStart = startDue(delta, gameTime)
		? started(delta, delta.scheduled)
		: delta;
	return completionDue(afterStart, gameTime)
		? materialized(afterStart)
		: afterStart;
};

/**
 * §3/§4's read: what the world *is* at `gameTime`, whether or not anybody has
 * written the completion down yet.
 *
 * An absent row is not a missing answer — it is the answer (§1): the generated
 * carrier, operational, with nothing scheduled.
 */
export const effectiveCarrier = (
	env: GalaxyEnvelope,
	key: CarrierKey,
	gameTime: number,
): EffectiveCarrier => {
	const delta = env.objective[key];
	if (!delta)
		return {
			instanceOrdinal: 0,
			condition: "operational",
			recovery: undefined,
		};
	const settled = settle(delta, gameTime);
	return {
		instanceOrdinal: settled.instanceOrdinal,
		condition: settled.condition,
		recovery: settled.recovery,
	};
};

/**
 * A Traffic carrier's saved condition, and the departure it rejoins its
 * schedule at after a completed repair or replacement (0 when none is saved).
 */
export function haulerAvailability(
	actor: Pick<TrafficActor, "key" | "schedule">,
	env: GalaxyEnvelope,
	atS: number,
): { condition: string; rejoinsAtS: number } {
	const row = env.objective[actor.key],
		latest = env.episodes[actor.key]?.latest;
	const completesAt =
		row?.recovery?.completesAt ??
		(latest && ["repair-complete", "replacement-complete"].includes(latest.kind)
			? latest.occurredAt
			: 0);
	return {
		condition: effectiveCarrier(env, actor.key, atS).condition,
		rejoinsAtS:
			completesAt > 0
				? nextTrafficDepartureAtS(actor.schedule, completesAt)
				: 0,
	};
}

/**
 * §4's persisted materialization, in canonical key order.
 *
 * Returns the order as well as the envelope because §9.5 asks for it out loud:
 * an ordering that is only ever an internal detail is an ordering nothing
 * checks.
 */
export function materializeDue(
	env: GalaxyEnvelope,
	gameTime: number,
): { envelope: GalaxyEnvelope; order: CarrierKey[] } {
	const due = sortedKeys(env.objective).filter((k) =>
		isDue(env.objective[k], gameTime),
	);
	if (due.length === 0) return { envelope: env, order: [] };

	const objective = { ...env.objective };
	const episodes = { ...env.episodes };
	for (const key of due) {
		let current = env.objective[key];
		let episode = episodes[key];
		// A scheduled start first. It joins the destruction's open episode and
		// is that episode's intervention, as an explicit start would be (§5).
		if (startDue(current, gameTime)) {
			const s = current.scheduled;
			current = started(current, s);
			if (episode) {
				const fact: TransitionFact = {
					key,
					instanceOrdinal: current.instanceOrdinal,
					episodeOrdinal: episode.ordinal,
					kind: "replacement-start",
					occurredAt: s.startsAt,
					cause: s.initiatedBy,
					processId: s.processId,
				};
				episode = {
					...episode,
					intervention: episode.intervention ?? fact,
					latest: fact,
					closed: false,
				};
			}
		}
		const recovery = current.recovery;
		if (completionDue(current, gameTime) && recovery) {
			const next = materialized(current);
			if (episode) {
				// `occurredAt` is `completesAt`, never the moment somebody looked.
				// Access time in the save would make one timeline serialize two ways.
				const fact: TransitionFact = {
					key,
					instanceOrdinal: next.instanceOrdinal,
					episodeOrdinal: episode.ordinal,
					kind:
						recovery.kind === "repair"
							? "repair-complete"
							: "replacement-complete",
					occurredAt: recovery.completesAt,
					cause: recovery.initiatedBy,
					processId: recovery.processId,
				};
				episode = { ...episode, latest: fact, closed: true };
			}
			current = next;
		}
		objective[key] = current;
		if (episode) episodes[key] = episode;
	}
	return { envelope: { ...env, objective, episodes }, order: due };
}

/** Every galaxy materialized up to `gameTime`, and the clock moved to it.
 *  Idempotent: running it twice, or late, gives the same snapshot. */
export const advanceTo = (world: WorldState, gameTime: number): WorldState => {
	// **One clock, used twice.** Clamping the stored time while materializing
	// against the raw argument let `advanceTo(w, 5)` on a world at t = 100
	// record a clock of 100 and leave a completion due at t = 50 unmaterialized
	// — two worlds on one timeline serializing to different bytes.
	const t = Math.max(world.gameTime, gameTime);
	return {
		...world,
		gameTime: t,
		galaxies: world.galaxies.map((g) => materializeDue(g, t).envelope),
	};
};

// ---------------------------------------------------------------------------
// §4 — the transition table
// ---------------------------------------------------------------------------

export type TransitionEvent =
	| {
			kind: "disable" | "restore";
			occurredAt: number;
			cause: Provenance;
	  }
	| {
			kind: "destroy";
			occurredAt: number;
			cause: Provenance;
			/** The replacement this destruction schedules, started and completed
			 *  lazily. `cause` is the actor that does the work, not the destroyer. */
			schedule?: {
				startsAt: number;
				completesAt: number;
				consequenceArea: string;
				cause: Provenance;
			};
	  }
	| {
			kind: "repair-start" | "replacement-start";
			occurredAt: number;
			cause: Provenance;
			consequenceArea: string;
			completesAt: number;
	  }
	| {
			kind: "recovery-change";
			occurredAt: number;
			cause: Provenance;
			completesAt: number;
			consequenceArea?: string;
	  }
	| {
			kind: "interrupt";
			occurredAt: number;
			cause: Provenance;
			resulting: "disabled" | "destroyed";
	  }
	| {
			kind: "repair-complete" | "replacement-complete";
			occurredAt: number;
			cause: Provenance;
	  };

/** The kinds that end an episode. A start after one of these opens the next
 *  episode, and therefore a new process identity (§4). */
const CLOSING: ReadonlySet<TransitionKind> = new Set([
	"restore",
	"interrupt",
	"repair-complete",
	"replacement-complete",
]);

// A function *declaration*, not an arrow const: TypeScript narrows through a
// `never`-returning call only in this form, and every guard below relies on it.
function fail(message: string): never {
	throw new Error(`world-state: ${message}`);
}

/**
 * The preamble every writer shares: the galaxy, the clock, the materialization,
 * and swapping one envelope back in.
 *
 * It was copied into four entry points, and the diff that added the third one
 * already records a bug from getting it wrong — a writer that moved the clock
 * and materialized nothing. A fifth writer should not have to rediscover the
 * sequence.
 */
function withEnvelope(
	world: WorldState,
	galaxyIndex: number,
	at: number,
	edit: (env: GalaxyEnvelope) => GalaxyEnvelope,
): WorldState {
	assertGalaxy(galaxyIndex);
	if (!Number.isFinite(at)) fail(`a write at ${at} has no finite time`);
	if (at < world.gameTime)
		fail(`a write at ${at} is before the clock (${world.gameTime})`);
	const advanced = advanceTo(world, at);
	const galaxies = advanced.galaxies.slice();
	galaxies[galaxyIndex] = edit(galaxies[galaxyIndex]);
	return { ...advanced, galaxies };
}

/** The parser's key shape, applied at the write. `carrierKey(3, "")` yields
 *  `"3:"`, which the type accepts and every writer stored — `splitCarrierKey`
 *  then feeds `NaN` into the canonical order, and the damage first shows up as
 *  a save that will not load. */
function assertCarrierKey(key: CarrierKey): void {
	if (!isCarrierKey(key)) fail(`${key} is not a carrier key`);
}

/**
 * The one bounds check every writer shares.
 *
 * It was on `applyTransition` alone, and the other three writers spread
 * `galaxies[8]` — `undefined` — into a ninth envelope holding one domain. The
 * corruption then surfaced a long way from its cause, inside a canonicaliser
 * or as "expected eight galaxy envelopes" on the next load.
 */
/** §7's visited domain range, in one place: `visit` applies it at the write,
 *  `parseVisited` at the load, and `save-envelope.ts` on the commander's own
 *  system index — three readers of one range, which is why it is exported
 *  rather than restated. */
export const isSystemIndex = (v: unknown): boolean =>
	typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255;

function assertGalaxy(galaxyIndex: number): void {
	if (
		!Number.isInteger(galaxyIndex) ||
		galaxyIndex < 0 ||
		galaxyIndex >= GALAXY_COUNT
	)
		fail(`galaxy ${galaxyIndex} is outside 0..${GALAXY_COUNT - 1}`);
}

/**
 * §4's table, and only §4's table.
 *
 * Split out of `applyTransition` so that adding a transition kind touches the
 * validation and the resulting delta in one place, and the caller keeps the
 * parts that are the same for every kind: the transition fact, the episode
 * summary and the knowledge write.
 */
function nextDelta(
	key: CarrierKey,
	current: ObjectiveDelta,
	event: TransitionEvent,
	open: CausalEpisode | undefined,
): { next: ObjectiveDelta; episodeOrdinal: number; opensEpisode: boolean } {
	const episodeOpen = open !== undefined && !open.closed;
	/** Join the open episode, or allocate the next one (§4). */
	const nextOrdinal = episodeOpen ? open.ordinal : (open?.ordinal ?? 0) + 1;
	let next: ObjectiveDelta;
	let episodeOrdinal: number;
	let opensEpisode = false;

	switch (event.kind) {
		case "disable":
		case "destroy": {
			if (event.kind === "disable" && current.condition !== "operational")
				fail(`cannot disable a carrier that is ${current.condition}`);
			if (
				event.kind === "destroy" &&
				current.condition !== "operational" &&
				current.condition !== "disabled"
			)
				fail(`cannot destroy a carrier that is ${current.condition}`);
			opensEpisode = !episodeOpen;
			episodeOrdinal = nextOrdinal;
			let scheduled: ScheduledRecovery | undefined;
			if (event.kind === "destroy" && event.schedule) {
				const s = event.schedule;
				// Strictly later on both edges, for the explicit start's reason: a
				// schedule that starts at the destruction is an explicit start, and
				// one that completes as it starts is no process at all.
				if (!Number.isFinite(s.startsAt) || s.startsAt <= event.occurredAt)
					fail("a scheduled replacement starts no later than the destruction");
				if (!Number.isFinite(s.completesAt) || s.completesAt <= s.startsAt)
					fail("a scheduled replacement completes no later than it starts");
				scheduled = {
					processId: recoveryProcessId(key, episodeOrdinal, "replacement"),
					consequenceArea: s.consequenceArea,
					startsAt: s.startsAt,
					completesAt: s.completesAt,
					initiatedBy: s.cause,
				};
			}
			next = {
				instanceOrdinal: current.instanceOrdinal,
				condition: event.kind === "disable" ? "disabled" : "destroyed",
				...(scheduled ? { scheduled } : {}),
			};
			break;
		}
		case "restore": {
			if (current.condition !== "disabled")
				fail(`cannot restore a carrier that is ${current.condition}`);
			// An opener like the other two. A restore after an interruption acts
			// on a *closed* episode, and folding into it overwrote the interrupt
			// outcome and credited the restoration to the old initiating cause —
			// while the same close followed by a `disable` correctly opened the
			// next episode.
			opensEpisode = !episodeOpen;
			episodeOrdinal = nextOrdinal;
			next = {
				instanceOrdinal: current.instanceOrdinal,
				condition: "operational",
			};
			break;
		}
		case "repair-start":
		case "replacement-start": {
			const kind: RecoveryKind =
				event.kind === "repair-start" ? "repair" : "replacement";
			if (kind === "repair" && current.condition !== "disabled")
				fail(
					`a repair needs a disabled carrier, not a ${current.condition} one`,
				);
			if (
				kind === "replacement" &&
				current.condition !== "destroyed" &&
				current.condition !== "disabled"
			)
				fail(
					`a replacement needs a destroyed or disabled carrier, not a ${current.condition} one`,
				);
			// **Strictly later.** `completesAt === occurredAt` returned a world
			// whose clock already equalled the deadline with the row still
			// `repairing` — the one state the suite says no verb can produce, and
			// `serializeWorld` would have written it down. A recovery that takes
			// no time is not a recovery; §4 wants a process something can be
			// flown at.
			if (
				!Number.isFinite(event.completesAt) ||
				event.completesAt <= event.occurredAt
			)
				fail(`${event.kind} completes no later than it starts`);
			opensEpisode = !episodeOpen;
			episodeOrdinal = nextOrdinal;
			next = {
				instanceOrdinal: current.instanceOrdinal,
				condition: "repairing",
				recovery: {
					kind,
					processId: recoveryProcessId(key, episodeOrdinal, kind),
					consequenceArea: event.consequenceArea,
					startedAt: event.occurredAt,
					completesAt: event.completesAt,
					initiatedBy: event.cause,
				},
			};
			break;
		}
		case "recovery-change": {
			if (current.condition !== "repairing" || !current.recovery)
				fail(`nothing to change: the carrier is ${current.condition}`);
			if (
				!Number.isFinite(event.completesAt) ||
				event.completesAt <= event.occurredAt
			)
				fail("recovery-change completes no later than now");
			episodeOrdinal = open?.ordinal ?? 0;
			next = {
				instanceOrdinal: current.instanceOrdinal,
				condition: "repairing",
				// Same episode, same process: assistance and opposition change the
				// schedule, they do not restart the work.
				recovery: {
					...current.recovery,
					completesAt: event.completesAt,
					consequenceArea:
						event.consequenceArea ?? current.recovery.consequenceArea,
				},
			};
			break;
		}
		case "interrupt": {
			if (current.condition !== "repairing")
				fail(`cannot interrupt a carrier that is ${current.condition}`);
			episodeOrdinal = open?.ordinal ?? 0;
			next = {
				instanceOrdinal: current.instanceOrdinal,
				condition: event.resulting,
			};
			break;
		}
		case "repair-complete":
		case "replacement-complete": {
			// **Earlier than `completesAt` only.** A completion event landing
			// exactly *at* it arrives after the lazy one has already run (§4's
			// "before applying a new event at that same timestamp"), so there is
			// nothing left to complete and this throws. Loud rather than silent,
			// and `world-state.test.ts` §9.4 pins it.
			if (current.condition !== "repairing" || !current.recovery)
				fail(`nothing to complete: the carrier is ${current.condition}`);
			const wanted: RecoveryKind =
				event.kind === "repair-complete" ? "repair" : "replacement";
			if (current.recovery.kind !== wanted)
				fail(
					`a ${current.recovery.kind} episode cannot close with ${event.kind}`,
				);
			episodeOrdinal = open?.ordinal ?? 0;
			next = materialized(current);
			break;
		}
	}

	return { next, episodeOrdinal, opensEpisode };
}

/**
 * §5's "initiating intervention when one exists": the recovery start inside the
 * episode, kept for as long as the episode is.
 *
 * A new episode has one only if it *is* a start; a joined episode keeps the one
 * it already had, and adopts this transition only when it is the first start
 * inside it.
 */
function pickIntervention(
	opensEpisode: boolean,
	isStart: boolean,
	open: CausalEpisode | undefined,
	fact: TransitionFact,
): TransitionFact | undefined {
	if (opensEpisode) return isStart ? fact : undefined;
	if (open?.intervention) return open.intervention;
	return isStart ? fact : undefined;
}

/**
 * Applies one transition, or throws.
 *
 * Two orderings matter and both are §4's:
 *
 * 1. **Due completions resolve first.** A disable arriving at the same instant
 *    a repair finishes acts on an *operational* carrier, not on a repairing
 *    one — otherwise a legal event would be rejected because nobody had looked
 *    at the clock yet.
 * 2. **Process kind fixes the completion.** A repair episode cannot close as a
 *    replacement, and a destroyed-origin replacement cannot close as a repair;
 *    the second is the one that would silently lose an instance ordinal.
 */
export function applyTransition(
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	event: TransitionEvent,
): WorldState {
	assertGalaxy(galaxyIndex);
	assertCarrierKey(key);
	if (!Number.isFinite(event.occurredAt))
		fail(`${event.kind} has no finite occurredAt`);
	if (event.occurredAt < world.gameTime)
		fail(
			`${event.kind} at ${event.occurredAt} is before the clock (${world.gameTime})`,
		);

	const advanced = advanceTo(world, event.occurredAt);
	const env = advanced.galaxies[galaxyIndex];
	const current = env.objective[key] ?? {
		instanceOrdinal: 0,
		condition: "operational" as OperationalCondition,
	};
	const open = env.episodes[key];

	const { next, episodeOrdinal, opensEpisode } = nextDelta(
		key,
		current,
		event,
		open,
	);

	// **The process the transition touched, not the one that survives it.**
	// Reading it off `next` dropped it from every completion and every
	// interrupt — `next` has no recovery — so one episode outcome serialized
	// with the process identity when it materialized lazily and without it when
	// it was explicit, and nothing recorded which process an interrupt stopped.
	const processId = next.recovery?.processId ?? current.recovery?.processId;
	const fact: TransitionFact = {
		key,
		instanceOrdinal: next.instanceOrdinal,
		episodeOrdinal,
		kind: event.kind,
		occurredAt: event.occurredAt,
		cause: event.cause,
		...(processId === undefined ? {} : { processId }),
	};

	const isStart =
		event.kind === "repair-start" || event.kind === "replacement-start";
	// The episode an opener starts keeps only this transition; one it joins
	// keeps the initiating transition and the first intervention inside it.
	const initiating = opensEpisode ? fact : (open?.initiating ?? fact);
	const intervention = pickIntervention(opensEpisode, isStart, open, fact);
	const episode: CausalEpisode = {
		ordinal: episodeOrdinal,
		initiating,
		...(intervention ? { intervention } : {}),
		latest: fact,
		closed: CLOSING.has(event.kind),
	};

	let envelope: GalaxyEnvelope = {
		...env,
		objective: { ...env.objective, [key]: next },
		episodes: { ...env.episodes, [key]: episode },
	};

	// §3.1: a player-caused explicit transition is witnessed by definition.
	// A cause with role `none` happened out of sight and leaves knowledge alone.
	if (event.cause.playerRole !== "none")
		envelope = withKnowledgeRow(
			envelope,
			key,
			knowledgeRowFor(envelope, key, next, event.occurredAt, "intervention"),
		);

	const galaxies = advanced.galaxies.slice();
	galaxies[galaxyIndex] = envelope;
	return { ...advanced, gameTime: event.occurredAt, galaxies };
}

// ---------------------------------------------------------------------------
// §3.1 — knowledge
// ---------------------------------------------------------------------------

/** The row one observation writes. Separate from the envelope write so a report
 *  covering many carriers can copy the map once rather than once per carrier. */
const knowledgeRowFor = (
	env: GalaxyEnvelope,
	key: CarrierKey,
	state: {
		instanceOrdinal: number;
		condition: OperationalCondition;
		recovery?: RecoveryDescriptor;
	},
	observedAt: number,
	source: string,
): KnowledgeRow => {
	const prior = env.knowledge[key];
	const row: KnowledgeRow = {
		observedInstanceOrdinal: state.instanceOrdinal,
		observedCondition: state.condition,
		observedAt,
		source,
		...(state.condition === "repairing" && state.recovery
			? {
					// A copy, not a live reference (§3.1): the schedule as it was
					// reported. The objective descriptor may be rescheduled tomorrow
					// and the player will not know.
					observedRecovery: {
						processId: state.recovery.processId,
						kind: state.recovery.kind,
						consequenceArea: state.recovery.consequenceArea,
						startedAt: state.recovery.startedAt,
						completesAt: state.recovery.completesAt,
					},
				}
			: {}),
		// Everything this channel did not read survives, from the one list.
		...carriedForward(prior, "condition"),
	};
	return row;
};

/**
 * The members a new observation carries forward from the row it replaces.
 *
 * **One list rather than one per writer.** Each writer used to enumerate its own
 *  carry-forward, which meant that adding a fifth member to `KnowledgeRow`
 *  required remembering every writer — and a writer that forgot did not fail, it
 *  quietly deleted a player's knowledge on the next unrelated observation
 *  (sage #384 round 1). `refreshed` names the one channel this write is speaking
 *  for; everything else in the row is somebody else's intelligence and survives
 *  by default.
 */
const carriedForward = (
	prior: KnowledgeRow | undefined,
	refreshed: "condition" | "scan",
): Partial<KnowledgeRow> => ({
	...(refreshed === "condition" || prior?.observedCondition === undefined
		? {}
		: {
				observedInstanceOrdinal: prior.observedInstanceOrdinal,
				observedCondition: prior.observedCondition,
				...(prior.observedRecovery
					? { observedRecovery: prior.observedRecovery }
					: {}),
			}),
	...(refreshed === "scan" || !prior?.scan ? {} : { scan: prior.scan }),
	...(prior?.knownPrivateFacts
		? { knownPrivateFacts: prior.knownPrivateFacts }
		: {}),
});

/** One row into an envelope. */
const withKnowledgeRow = (
	env: GalaxyEnvelope,
	key: CarrierKey,
	row: KnowledgeRow,
): GalaxyEnvelope => ({
	...env,
	knowledge: { ...env.knowledge, [key]: row },
});

export const readKnowledge = (
	env: GalaxyEnvelope,
	key: CarrierKey,
): KnowledgeRow | undefined => env.knowledge[key];

/** A flown wreck reading uses its own operational condition, never effectiveCarrier's
 * absent-row operational default. An empty or salvaged carrier writes nothing. */
export const observeDerelict = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	at: number,
	source: string,
): WorldState => {
	const wreck = effectiveDerelict(world, galaxyIndex, key, at);
	if (wreck.condition !== "destroyed") return world;
	return withEnvelope(world, galaxyIndex, at, (env) =>
		withKnowledgeRow(env, key, {
			...env.knowledge[key],
			observedCondition: "destroyed",
			observedInstanceOrdinal: wreck.instanceOrdinal,
			observedAt: at,
			source,
		}),
	);
};

/**
 * §3.1's revisit, report or relay: the player now knows what is objectively
 * true at `gameTime`.
 *
 * It reads the *effective* state, so observing a carrier whose repair finished
 * while nobody was looking records the finished repair — the player is standing
 * there.
 */
export const observe = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	gameTime: number,
	source: string,
): WorldState => {
	assertCarrierKey(key);
	return withEnvelope(world, galaxyIndex, gameTime, (env) =>
		withKnowledgeRow(
			env,
			key,
			knowledgeRowFor(
				env,
				key,
				effectiveCarrier(env, key, gameTime),
				gameTime,
				source,
			),
		),
	);
};

/** The System relay reports condition intelligence for every local station. */
export const observeSystemRelay = (
	world: WorldState,
	galaxyIndex: number,
	keys: readonly CarrierKey[],
	gameTime: number,
): WorldState => {
	for (const key of keys) assertCarrierKey(key);
	// **One envelope write and one map copy for the whole report.** Folding
	// `observe` over the keys paid `advanceTo` — a `materializeDue` sweep with
	// its sort over every galaxy — once per station, and copied a knowledge map
	// that grows for the whole session once per station too. The first fix
	// removed the `advanceTo` and left the per-station copy in place while a
	// comment claimed both; the rows are built against one envelope and spread
	// into one object now.
	return withEnvelope(world, galaxyIndex, gameTime, (env) => {
		const rows: Record<string, KnowledgeRow> = {};
		for (const key of keys)
			rows[key] = knowledgeRowFor(
				env,
				key,
				effectiveCarrier(env, key, gameTime),
				gameTime,
				"system-relay",
			);
		return { ...env, knowledge: { ...env.knowledge, ...rows } };
	});
};

/** Docking reports one station and, only at a refinery, checks its private fact. */
export const observeDocking = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	gameTime: number,
	isRefinery: boolean,
): WorldState => {
	const observed = observe(world, galaxyIndex, key, gameTime, "docking");
	if (!isRefinery) return observed;
	const env = observed.galaxies[galaxyIndex];
	const row = env.knowledge[key];
	if (!row) throw new Error(`docking observation did not write ${key}`);
	const galaxies = observed.galaxies.slice();
	galaxies[galaxyIndex] = {
		...env,
		knowledge: {
			...env.knowledge,
			[key]: {
				...row,
				// **`learnedAt` is when it was learned, not when it was last
				// checked.** Written unconditionally, every later docking at the
				// same refinery moved it forward — so a fact learned on the
				// first visit reported the most recent visit's clock, and
				// §3.1's "learned by visiting" would age backwards on a return
				// trip. A marker already there is kept.
				knownPrivateFacts: row.knownPrivateFacts ?? {
					blackMarket: { learnedAt: gameTime, source: "docking" },
				},
			},
		},
	};
	return { ...observed, galaxies };
};

/**
 * A completed scan writes the record `carrier-identity.md` §5 defines: when it
 * was read, that a scan was its source, and the two ordinals the reading was
 * taken at. Nothing of what it read.
 *
 * **It writes no condition, and it does not clear one.** A scan reveals standing
 * and a hold (F5), not a hull: writing `operational` because the carrier is
 * visibly flying would be knowledge the verb did not grant, shown afterwards on
 * the galaxy map as though the pilot had checked. Equally, a pilot who docked at
 * a carrier in repair does not un-know it because they later scanned it, so a
 * condition observation already on the row is carried forward untouched — the
 * same preservation rule `knownPrivateFacts` runs on.
 *
 * **The caller fixes the voyage when it reads.** `flownVoyageOrdinal` depends on
 * the route as it stood at that instant (§3's amendment by #362), so it cannot
 * be recovered here from the clock, and a row that stored only the clock would
 * re-derive a different hold from the one the pilot was shown.
 */
export const observeScan = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	gameTime: number,
	reading: { instanceOrdinal: number; voyageOrdinal: number },
): WorldState => {
	assertCarrierKey(key);
	return withEnvelope(world, galaxyIndex, gameTime, (env) => {
		const prior = env.knowledge[key];
		return withKnowledgeRow(env, key, {
			// Everything this channel did not read survives, from the one list: a
			// scan says nothing about the hull, so the condition triple and any
			// learned private fact carry forward exactly as they did.
			...carriedForward(prior, "scan"),
			observedAt: gameTime,
			source: SCAN_SOURCE,
			scan: {
				observedAt: gameTime,
				source: SCAN_SOURCE,
				observedInstanceOrdinal: reading.instanceOrdinal,
				observedVoyageOrdinal: reading.voyageOrdinal,
			},
		});
	});
};

/** §7's visited-flag domain. Sorted and unique, so insertion order cannot
 *  reach the canonical snapshot. */
export const visit = (
	world: WorldState,
	galaxyIndex: number,
	systemIndex: number,
): WorldState => {
	// The parser's range, applied at the write. Accepting a value only the next
	// load rejects is the distance-from-cause `assertGalaxy` exists to close.
	if (!isSystemIndex(systemIndex))
		fail(`visit: ${systemIndex} is not a system index`);
	return withEnvelope(world, galaxyIndex, world.gameTime, (env) =>
		env.visited.includes(systemIndex)
			? env
			: {
					...env,
					visited: [...env.visited, systemIndex].sort((a, b) => a - b),
				},
	);
};

/**
 * §7's deficit domain: the market's memory of the player, installed whole.
 *
 * `economy-trade.md` §5.5's arithmetic stays in `deficits.ts` — this writer
 * takes the map that `recordTrade` (or `transactAtStation`, which wraps it)
 * already returned and files it under the galaxy, with `withEnvelope`'s bound,
 * clock refusal and materialization. It is a setter for the same reason
 * `setLegalHeat` is: the domain's rules are not this module's, and duplicating
 * them here would be the second copy `deficits.ts`'s own header refuses.
 *
 * **`at` is seconds, and it is the only unit this module speaks.** A
 * `DeficitRow.updatedAt` is game *minutes* — `deficits.ts` says so — and
 * `World.gameTime` in `sim.ts` is seconds. The conversion belongs at the call
 * that builds the row, never at the clock: the caller that got it the other way
 * round divided the world clock by sixty on its way in, and the damage would
 * have surfaced as a save whose every `completesAt` sat an hour in the future.
 */
export const setDeficits = (
	world: WorldState,
	galaxyIndex: number,
	deficits: DeficitMap,
	at: number,
): WorldState =>
	withEnvelope(world, galaxyIndex, at, (env) => ({ ...env, deficits }));

/**
 * §7's legal-status domain: the heat and its stamp. The standing label and the
 * police response are §8 projections.
 *
 * **It carries `witnesses` through untouched, and that is the whole reason it
 * reads the old row instead of building one.** Heat and the witness list are two
 * halves of one saved row, and an offence may change either alone: a lawful kill
 * beside a station writes the list with no heat, and decay-and-heat writes the
 * heat with no new list. A writer that rebuilt `{ heat, updatedAt }` from
 * nothing would empty the list on the second offence — quietly, in the one case
 * a pilot has offended twice.
 */
export const setLegalHeat = (
	world: WorldState,
	galaxyIndex: number,
	heat: number,
	updatedAt: number,
): WorldState => {
	if (!Number.isFinite(heat))
		fail(`setLegalHeat: ${heat} is not a finite heat`);
	return withEnvelope(world, galaxyIndex, updatedAt, (env) => ({
		...env,
		legalStatus: { ...env.legalStatus, heat, updatedAt },
	}));
};

/**
 * The one writer for `LegalStatus`'s two carrier-key lists.
 *
 * **It does not touch `updatedAt`, and it must not.** That stamp is the heat's,
 * and decay is read from it — restamping it to write a witness would decay a
 * pilot's existing heat from now and hold them Wanted past the duration H4
 * set, on an act that costs nothing. `at` here is the *world* clock, which is
 * what `withEnvelope` bounds a write against.
 *
 * The list is the law's to build; this checks its shape the way every other
 * writer checks its input, because a `Station.id` in here would read as this
 * system's station in every system in the galaxy.
 *
 * **And it stores them in canonical order, not the order they were written
 * in.** `canonicalEnvelope` has to write canonical bytes, and a model whose row
 * came out in offence order would be a model that does not equal its own save —
 * which is the §9.6 round trip, not a tidiness. Sorting here is what lets the
 * envelope omit rather than re-derive.
 *
 * **One implementation, two names, because the two lists must never drift.**
 * They are the same shape, they are omitted from the envelope under the same
 * condition, they are parsed by the same rules, and they are cleared together by
 * the same read of the heat. A second copy of this check — with, say, one of the
 * two orders forgotten — is a save that round-trips into a different model.
 */
const setLegalCarrierList = (
	world: WorldState,
	galaxyIndex: number,
	field: "witnesses" | "assaulted",
	keys: readonly CarrierKey[],
	at: number,
): WorldState => {
	const seen = new Set<string>();
	for (const key of keys) {
		assertCarrierKey(key);
		if (seen.has(key))
			fail(`setLegalCarrierList(${field}): ${key} is listed twice in one row`);
		seen.add(key);
	}
	return withEnvelope(world, galaxyIndex, at, (env) => ({
		...env,
		legalStatus: {
			...env.legalStatus,
			[field]: [...keys].sort(compareCarrierKeys),
		},
	}));
};

/**
 * §7's legal-status domain: the stations that heard an offence (`legal.ts` H6,
 * and #396's amendment — heard, not seen).
 */
export const setLegalWitnesses = (
	world: WorldState,
	galaxyIndex: number,
	witnesses: readonly CarrierKey[],
	at: number,
): WorldState =>
	setLegalCarrierList(world, galaxyIndex, "witnesses", witnesses, at);

/**
 * §7's legal-status domain: the ordinary carriers whose sustained-fire charge
 * this pilot has already paid (#396, `legal.ts`). Same clock rule as
 * `setLegalWitnesses` above — it does not touch `updatedAt`.
 */
export const setLegalAssaulted = (
	world: WorldState,
	galaxyIndex: number,
	assaulted: readonly CarrierKey[],
	at: number,
): WorldState =>
	setLegalCarrierList(world, galaxyIndex, "assaulted", assaulted, at);

// ---------------------------------------------------------------------------
// Derelict slots — `salvage.md` S1, S2, S6, S16 (node #731)
// ---------------------------------------------------------------------------
// glossary-ignore: slot

/** Other salvagers' strip: the clock's, never the pilot's, so it carries no
 *  player provenance (S16). It is never written; a read derives it. */
export const OTHER_SALVAGERS: Provenance = {
	causeKind: "salvage",
	actorId: "salvagers",
	playerRole: "none",
};

/** The pilot's strip: the last container scooped to zero (S2). */
export const PLAYER_SALVAGE: Provenance = {
	causeKind: "salvage",
	actorId: "player",
	playerRole: "direct",
};

/** A derelict slot at one game time, with its contents when an instance is
 *  adrift. `stored` says whether they came off the row or off the draw. */
export type EffectiveDerelict =
	| { condition: "empty"; firstLossAt: number }
	| {
			condition: "destroyed";
			instanceOrdinal: number;
			lostAt: number;
			salvagerAt: number;
			containers: DerelictContainer[];
			stored: boolean;
	  }
	| {
			condition: "salvaged";
			instanceOrdinal: number;
			lostAt: number;
			salvagedAt: number;
			cause: Provenance;
			nextLossAt: number;
	  };

/**
 * The system holding the derelict slot a key names, or `null` when the key
 * names none: a system index outside the galaxy, an id that is not a derelict
 * slot's, or an ordinal past what the system's government holds. The one home
 * of that rule — the reads refuse by it and so does the parse.
 */
const heldDerelictSlot = (
	worldSeed: number,
	galaxyIndex: number,
	key: CarrierKey,
): SystemRecord | null => {
	const systemIndex = systemIndexOfKey(key);
	if (!isSystemIndex(systemIndex)) return null;
	const ordinal = derelictOrdinalOf(localCarrierIdOfKey(key));
	if (ordinal === null) return null;
	const record = systemAt(worldSeed, galaxyIndex, systemIndex);
	return ordinal < derelictSlotCount(record.government) ? record : null;
};

/** The system a derelict key belongs to, as the draws need it — or a refusal
 *  when the key names no derelict slot that system holds. */
const derelictSite = (
	worldSeed: number,
	galaxyIndex: number,
	key: CarrierKey,
): { seed: number; government: number } => {
	assertGalaxy(galaxyIndex);
	assertCarrierKey(key);
	const record = heldDerelictSlot(worldSeed, galaxyIndex, key);
	if (!record) fail(`${key} is not a derelict slot in galaxy ${galaxyIndex}`);
	return { seed: record.seed, government: record.government };
};

const anchorOf = (row: DerelictRow) => ({
	instanceOrdinal: row.instanceOrdinal,
	lostAt: row.lostAt,
	...(row.salvaged
		? {
				stripped: {
					at: row.salvaged.at,
					byPlayer: row.salvaged.cause.playerRole !== "none",
				},
			}
		: {}),
});

const effectiveFrom = (
	site: { seed: number; government: number },
	key: CarrierKey,
	row: DerelictRow | undefined,
	gameTime: number,
): EffectiveDerelict => {
	const phase: DerelictPhase = derelictTimeline(
		site.seed,
		key,
		gameTime,
		row ? anchorOf(row) : undefined,
	);
	switch (phase.condition) {
		case "empty":
			return phase;
		case "destroyed": {
			const stored =
				row !== undefined && row.instanceOrdinal === phase.instanceOrdinal;
			return {
				...phase,
				containers: stored
					? row.containers.map((c) => ({ ...c }))
					: derelictContents(
							site.seed,
							site.government,
							key,
							phase.instanceOrdinal,
						).map((c) => ({ ...c, left: c.tonnes })),
				stored,
			};
		}
		case "salvaged": {
			const { byPlayer: _, ...rest } = phase;
			const cause =
				row?.salvaged && row.instanceOrdinal === phase.instanceOrdinal
					? row.salvaged.cause
					: OTHER_SALVAGERS;
			return { ...rest, cause };
		}
	}
};

/**
 * A derelict slot at `gameTime`: empty before its first loss, an instance
 * adrift with its containers, or salvaged — by the pilot, off the row, or by
 * other salvagers, off the clock — until the next loss. Derived; nothing is
 * written, and a slot nobody touched needs no row to answer.
 */
export const effectiveDerelict = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	gameTime: number,
): EffectiveDerelict => {
	if (isDeathWreckKey(key)) {
		const row = world.galaxies[galaxyIndex].deathWreck;
		if (!row || row.key !== key)
			return { condition: "empty", firstLossAt: Infinity };
		if (row.salvaged)
			return {
				condition: "salvaged",
				instanceOrdinal: row.instanceOrdinal,
				lostAt: row.lostAt,
				salvagedAt: row.salvaged.at,
				cause: row.salvaged.cause,
				nextLossAt: Infinity,
			};
		return {
			...row,
			condition: "destroyed",
			salvagerAt: Infinity,
			stored: true,
		};
	}
	return effectiveFrom(
		derelictSite(world.seed, galaxyIndex, key),
		key,
		world.galaxies[galaxyIndex].derelicts[key],
		gameTime,
	);
};

/** The row an instance adrift writes when it is first touched: its drawn
 *  contents, every container full. */
const rowFor = (
	e: Extract<EffectiveDerelict, { condition: "destroyed" }>,
): DerelictRow => ({
	instanceOrdinal: e.instanceOrdinal,
	lostAt: e.lostAt,
	containers: e.containers.map((c) => ({ ...c })),
});

/**
 * Stores the adrift instance's contents on the slot's row (S6), so nothing
 * reads the draw for it again. The drawing build calls this when the pilot
 * meets a wreck, which is what makes a generator change or an appended fitting
 * unable to move a wreck a pilot has seen. A slot that is empty or salvaged,
 * or whose row already holds this instance, is left as it is.
 */
export const materializeDerelict = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	at: number,
): WorldState => {
	const site = derelictSite(world.seed, galaxyIndex, key);
	return withEnvelope(world, galaxyIndex, at, (env) => {
		const e = effectiveFrom(site, key, env.derelicts[key], at);
		if (e.condition !== "destroyed" || e.stored) return env;
		return { ...env, derelicts: { ...env.derelicts, [key]: rowFor(e) } };
	});
};

/**
 * Takes `tonnes` out of one container of the instance adrift (S3, S20), and
 * writes `salvaged` with the pilot's provenance when that empties the last one
 * (S2). The next loss is then scheduled from `at` (S16), off the row.
 *
 * Refuses, by name: a slot with nothing adrift, a container index the instance
 * does not have, and more tonnes than the container holds. How much fits the
 * hold is the caller's to decide; this is the world's side of the scoop.
 */
export const scoopDerelict = (
	world: WorldState,
	galaxyIndex: number,
	key: CarrierKey,
	containerIndex: number,
	tonnes: number,
	at: number,
): WorldState => {
	if (isDeathWreckKey(key)) {
		return withEnvelope(world, galaxyIndex, at, (env) => {
			const row = env.deathWreck;
			const item =
				row?.key === key && Number.isInteger(containerIndex)
					? row.containers[containerIndex]
					: undefined;
			if (
				!item ||
				!Number.isInteger(tonnes) ||
				tonnes <= 0 ||
				tonnes > item.left
			)
				fail("death wreck: invalid scoop");
			const containers = row!.containers.map((c, i) =>
				i === containerIndex ? { ...c, left: c.left - tonnes } : c,
			);
			if (containers.every((c) => c.left === 0)) {
				const { deathWreck, ...rest } = env;
				const knowledge = { ...env.knowledge };
				delete knowledge[key];
				return { ...rest, knowledge };
			}
			return { ...env, deathWreck: { ...row!, containers } };
		});
	}
	const site = derelictSite(world.seed, galaxyIndex, key);
	if (!Number.isInteger(tonnes) || tonnes <= 0)
		fail(`scoopDerelict: ${tonnes} is not a whole number of tonnes`);
	return withEnvelope(world, galaxyIndex, at, (env) => {
		const e = effectiveFrom(site, key, env.derelicts[key], at);
		if (e.condition !== "destroyed")
			fail(`scoopDerelict: ${key} is ${e.condition}; nothing is adrift`);
		const row = rowFor(e);
		const container = Number.isInteger(containerIndex)
			? row.containers[containerIndex]
			: undefined;
		if (!container)
			fail(
				`scoopDerelict: container ${containerIndex} is unknown on ${key} instance ${e.instanceOrdinal}`,
			);
		if (tonnes > container.left)
			fail(
				`scoopDerelict: container ${containerIndex} holds ${container.left} t, not ${tonnes}`,
			);
		container.left -= tonnes;
		const stripped = row.containers.every((c) => c.left === 0);
		return {
			...env,
			derelicts: {
				...env.derelicts,
				[key]: stripped
					? { ...row, salvaged: { at, cause: PLAYER_SALVAGE } }
					: row,
			},
		};
	});
};

// ---------------------------------------------------------------------------
// §6 — compaction
// ---------------------------------------------------------------------------

/**
 * §6's bound, applied.
 *
 * The only row compaction drops is the one that is *derivable*: an original
 * instance, operational, with nothing scheduled — which is exactly §1's "an
 * absent objective row means the original generated carrier is operational".
 * A replacement keeps its row because its ordinal is not derivable, and
 * disabled, destroyed or repairing state never expires merely to save bytes.
 *
 * Episodes and knowledge are *not* dropped here: §6 bounds them at one row per
 * carrier each, and one row is what they already are.
 */
export const compactWorld = (
	world: WorldState,
	gameTime: number,
): WorldState => {
	const advanced = advanceTo(world, gameTime);
	return {
		...advanced,
		galaxies: advanced.galaxies.map((env) => {
			const objective: Record<CarrierKey, ObjectiveDelta> = {};
			for (const key of sortedKeys(env.objective)) {
				const delta = env.objective[key];
				const derivable =
					delta.condition === "operational" &&
					delta.instanceOrdinal === 0 &&
					delta.recovery === undefined &&
					delta.scheduled === undefined;
				if (!derivable) objective[key] = delta;
			}
			return { ...env, objective };
		}),
	};
};

// ---------------------------------------------------------------------------
// §7/§9 — the serialization boundary
// ---------------------------------------------------------------------------

const canonicalMap = <T>(
	map: Record<string, T>,
	each: (value: T) => unknown,
): Record<string, unknown> => {
	const out: Record<string, unknown> = {};
	for (const key of sortedKeys(map)) out[key] = each(map[key]);
	return out;
};

const canonicalProvenance = (p: Provenance) => ({
	causeKind: p.causeKind,
	actorId: p.actorId,
	playerRole: p.playerRole,
});

const canonicalRecovery = (r: RecoveryDescriptor) => ({
	kind: r.kind,
	processId: r.processId,
	consequenceArea: r.consequenceArea,
	startedAt: r.startedAt,
	completesAt: r.completesAt,
	initiatedBy: canonicalProvenance(r.initiatedBy),
});

const canonicalScheduled = (s: ScheduledRecovery) => ({
	processId: s.processId,
	consequenceArea: s.consequenceArea,
	startsAt: s.startsAt,
	completesAt: s.completesAt,
	initiatedBy: canonicalProvenance(s.initiatedBy),
});

const canonicalFact = (f: TransitionFact) => ({
	key: f.key,
	instanceOrdinal: f.instanceOrdinal,
	episodeOrdinal: f.episodeOrdinal,
	kind: f.kind,
	occurredAt: f.occurredAt,
	cause: canonicalProvenance(f.cause),
	...(f.processId === undefined ? {} : { processId: f.processId }),
});

/** A derelict row's wire form. Containers are keyed by their index, which is
 *  the identity a Salvage job's operand names (S18), so the parse can refuse
 *  an index the instance does not have by name. */
const canonicalDerelict = (r: DerelictRow) => ({
	instanceOrdinal: r.instanceOrdinal,
	lostAt: r.lostAt,
	containers: Object.fromEntries(
		r.containers.map((c, i) => [
			String(i),
			{ kind: c.kind, id: c.id, tonnes: c.tonnes, left: c.left },
		]),
	),
	...(r.salvaged
		? {
				salvaged: {
					at: r.salvaged.at,
					cause: canonicalProvenance(r.salvaged.cause),
				},
			}
		: {}),
});

const canonicalEnvelope = (env: GalaxyEnvelope) => ({
	galaxyIndex: env.galaxyIndex,
	...(env.deathWreck
		? {
				deathWreck: {
					...canonicalDerelict(env.deathWreck),
					key: env.deathWreck.key,
					hull: env.deathWreck.hull,
					bodyId: env.deathWreck.bodyId,
					offset: {
						x: env.deathWreck.offset.x,
						y: env.deathWreck.offset.y,
						z: env.deathWreck.offset.z,
					},
				},
			}
		: {}),
	objective: canonicalMap(env.objective, (d) => ({
		instanceOrdinal: d.instanceOrdinal,
		condition: d.condition,
		...(d.recovery ? { recovery: canonicalRecovery(d.recovery) } : {}),
		...(d.scheduled ? { scheduled: canonicalScheduled(d.scheduled) } : {}),
	})),
	episodes: canonicalMap(env.episodes, (e) => ({
		ordinal: e.ordinal,
		initiating: canonicalFact(e.initiating),
		...(e.intervention ? { intervention: canonicalFact(e.intervention) } : {}),
		latest: canonicalFact(e.latest),
		closed: e.closed,
	})),
	knowledge: canonicalMap(env.knowledge, (k) => ({
		// **Each member is emitted only when it is there.** Spreading a missing
		// one out of an optional container used to write `blackMarket: {}`, which
		// the parser then rejected as a marker with no `learnedAt` — a row the
		// model calls legal that could not be loaded back. §5's scan record makes
		// half-filled rows the normal case rather than a hand-edited curiosity,
		// so the rule is spelled out per member now.
		...(k.observedInstanceOrdinal === undefined
			? {}
			: { observedInstanceOrdinal: k.observedInstanceOrdinal }),
		...(k.observedCondition === undefined
			? {}
			: { observedCondition: k.observedCondition }),
		observedAt: k.observedAt,
		source: k.source,
		...(k.observedRecovery
			? { observedRecovery: { ...k.observedRecovery } }
			: {}),
		...(k.scan ? { scan: { ...k.scan } } : {}),
		...(k.knownPrivateFacts?.blackMarket
			? {
					knownPrivateFacts: {
						blackMarket: { ...k.knownPrivateFacts.blackMarket },
					},
				}
			: {}),
	})),
	deficits: canonicalMap(env.deficits, (row) => {
		const goods: Record<string, number> = {};
		for (const name of Object.keys(row.goods).sort())
			goods[name] = row.goods[name];
		return { goods, updatedAt: row.updatedAt };
	}),
	visited: [...env.visited].sort((a, b) => a - b),
	legalStatus: {
		heat: env.legalStatus.heat,
		updatedAt: env.legalStatus.updatedAt,
		// **Omitted when empty, as `knownPrivateFacts` above is.** The hash is
		// over these bytes, so a `"witnesses": []` written onto every row would
		// change the integrity of every save taken before #366 and have
		// `parseWorld` refuse it as corrupt. Absent means empty, which is what the
		// parser reads too.
		//
		// Canonical order, not the order the offences happened in: two pilots who
		// offended in opposite orders have to write the same bytes.
		...(env.legalStatus.witnesses.length
			? {
					witnesses: [...env.legalStatus.witnesses].sort(compareCarrierKeys),
				}
			: {}),
		// The same rule for #396's second list, for the same reason: an
		// `"assaulted": []` on every row would move the hash of every save taken
		// before it, and the integrity check would call that corruption.
		...(env.legalStatus.assaulted.length
			? {
					assaulted: [...env.legalStatus.assaulted].sort(compareCarrierKeys),
				}
			: {}),
	},
	// **Omitted when empty**, for the legal lists' reason: a `"derelicts": {}`
	// on every envelope would move the hash of every save taken before node #731
	// and have the integrity check call an old save corrupt.
	...(Object.keys(env.derelicts).length
		? { derelicts: canonicalMap(env.derelicts, canonicalDerelict) }
		: {}),
});

const canonicalBody = (world: WorldState) => ({
	worldSchemaVersion: world.worldSchemaVersion,
	worldGeneratorVersion: world.worldGeneratorVersion,
	seed: world.seed,
	gameTime: world.gameTime,
	galaxies: world.galaxies.map(canonicalEnvelope),
});

/**
 * §9.4/§9.5's canonical snapshot: the same seed, snapshot and `gameTime` give
 * the same string, whatever order anything was written in and whenever the
 * completions were first noticed.
 */
export const canonicalSnapshot = (
	world: WorldState,
	gameTime: number,
): string => JSON.stringify(canonicalBody(compactWorld(world, gameTime)));

/**
 * The model → save boundary (§7). Not a file format: no bytes, no slots, no
 * migration — §10 defers all three. What it does own is the **atomicity
 * check**: `integrity` is a 32-bit FNV-1a over the whole body, so a snapshot
 * assembled from two different saves is rejected rather than loading as a
 * plausible third one. A non-cryptographic hash catches an accidental splice
 * with high probability, not by proof, and nothing here resists a deliberate
 * forgery — a save file is the player's own.
 */
export const serializeWorld = (world: WorldState): unknown => {
	const body = canonicalBody(world);
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

const asObject = (raw: unknown, what: string): Record<string, unknown> => {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		fail(`${what} is not an object`);
	return raw as Record<string, unknown>;
};

const num = (
	raw: Record<string, unknown>,
	field: string,
	what: string,
): number => {
	const value = raw[field];
	if (typeof value !== "number" || !Number.isFinite(value))
		fail(`${what}: ${field} is not a finite number`);
	return value as number;
};

/** An ordinal is a count. `num` alone accepted `-2.5`, which `materialized`
 *  then handed back as `-1.5` — a value no writer can produce. */
const ordinal = (
	raw: Record<string, unknown>,
	field: string,
	what: string,
): number => {
	const value = num(raw, field, what);
	if (!Number.isInteger(value) || value < 0)
		fail(`${what}: ${field} is not a non-negative integer`);
	return value;
};

const str = (
	raw: Record<string, unknown>,
	field: string,
	what: string,
): string => {
	const value = raw[field];
	if (typeof value !== "string") fail(`${what}: ${field} is not a string`);
	return value as string;
};

const CONDITIONS: ReadonlySet<string> = new Set([
	"operational",
	"disabled",
	"destroyed",
	"repairing",
]);
const ROLES: ReadonlySet<string> = new Set([
	"direct",
	"assisted",
	"opposed",
	"none",
]);
const KINDS: ReadonlySet<string> = new Set([
	"disable",
	"destroy",
	"restore",
	"repair-start",
	"replacement-start",
	"recovery-change",
	"interrupt",
	"repair-complete",
	"replacement-complete",
]);

const parseProvenance = (raw: unknown, what: string): Provenance => {
	const o = asObject(raw, `${what} cause`);
	const playerRole = str(o, "playerRole", what);
	if (!ROLES.has(playerRole))
		fail(`${what}: playerRole ${playerRole} is unknown`);
	return {
		causeKind: str(o, "causeKind", what),
		actorId: str(o, "actorId", what),
		playerRole: playerRole as PlayerRole,
	};
};

/** The five fields an objective recovery descriptor and §3.1's `observedRecovery`
 *  share. The observed copy is exactly this and no more — it is intelligence,
 *  and it does not carry the objective descriptor's initiating provenance. */
const parseObservedRecovery = (
	raw: unknown,
	what: string,
): ObservedRecovery => {
	const o = asObject(raw, `${what} recovery`);
	const kind = str(o, "kind", what);
	if (kind !== "repair" && kind !== "replacement")
		fail(`${what}: recovery kind ${kind} is unknown`);
	const startedAt = num(o, "startedAt", what);
	const completesAt = num(o, "completesAt", what);
	if (completesAt <= startedAt)
		fail(
			`${what}: a recovery completing at ${completesAt} started at ${startedAt}`,
		);
	return {
		processId: str(o, "processId", what),
		kind: kind as RecoveryKind,
		consequenceArea: str(o, "consequenceArea", what),
		startedAt,
		completesAt,
	};
};

const parseRecovery = (raw: unknown, what: string): RecoveryDescriptor => {
	const shared = parseObservedRecovery(raw, what);
	const o = asObject(raw, `${what} recovery`);
	return { ...shared, initiatedBy: parseProvenance(o.initiatedBy, what) };
};

const parseScheduled = (raw: unknown, what: string): ScheduledRecovery => {
	const o = asObject(raw, `${what} schedule`);
	const startsAt = num(o, "startsAt", what);
	const completesAt = num(o, "completesAt", what);
	if (completesAt <= startsAt)
		fail(
			`${what}: a schedule completing at ${completesAt} starts at ${startsAt}`,
		);
	return {
		processId: str(o, "processId", what),
		consequenceArea: str(o, "consequenceArea", what),
		startsAt,
		completesAt,
		initiatedBy: parseProvenance(o.initiatedBy, what),
	};
};

const parseFact = (raw: unknown, what: string): TransitionFact => {
	const o = asObject(raw, `${what} transition`);
	const kind = str(o, "kind", what);
	if (!KINDS.has(kind)) fail(`${what}: transition kind ${kind} is unknown`);
	const key = str(o, "key", what);
	if (!isCarrierKey(key)) fail(`${what}: ${key} is not a carrier key`);
	return {
		key: key as CarrierKey,
		instanceOrdinal: ordinal(o, "instanceOrdinal", what),
		episodeOrdinal: ordinal(o, "episodeOrdinal", what),
		kind: kind as TransitionKind,
		occurredAt: num(o, "occurredAt", what),
		cause: parseProvenance(o.cause, what),
		...(o.processId === undefined
			? {}
			: { processId: str(o, "processId", what) }),
	};
};

const parseCarrierMap = <T>(
	raw: unknown,
	domain: string,
	each: (value: unknown, key: string) => T,
): Record<CarrierKey, T> => {
	const o = asObject(raw, `${domain} domain`);
	const out: Record<CarrierKey, T> = {};
	for (const [key, value] of Object.entries(o)) {
		// The same check every boundary makes, for the same reason: a bare
		// `Station.id` as a save key files one system's state under every
		// system's, and a cast would let it through silently.
		if (!isCarrierKey(key))
			fail(
				`${domain}: ${key} is not a carrier key (systemIndex:localCarrierId)`,
			);
		out[key as CarrierKey] = each(value, key);
	}
	return out;
};

const parseObjectiveRow = (value: unknown, key: string): ObjectiveDelta => {
	const row = asObject(value, `objective row ${key}`);
	const condition = str(row, "condition", `objective ${key}`);
	if (!CONDITIONS.has(condition))
		fail(`objective ${key}: condition ${condition} is unknown`);
	const delta: ObjectiveDelta = {
		instanceOrdinal: ordinal(row, "instanceOrdinal", `objective ${key}`),
		condition: condition as OperationalCondition,
		...(row.recovery === undefined
			? {}
			: { recovery: parseRecovery(row.recovery, `objective ${key}`) }),
		...(row.scheduled === undefined
			? {}
			: { scheduled: parseScheduled(row.scheduled, `objective ${key}`) }),
	};
	// A schedule is a destruction's. On any other row nothing can start it, and
	// `settle` would carry it forever.
	if (delta.scheduled && delta.condition !== "destroyed")
		fail(`objective ${key}: a schedule on a ${delta.condition} row`);
	// Both directions. The one-sided check let an `operational` row carry a
	// live descriptor that `isDue` can never fire and `effectiveCarrier` hands
	// straight back — an immortal recovery.
	if (delta.condition === "repairing" && !delta.recovery)
		fail(`objective ${key}: repairing with no recovery descriptor`);
	if (delta.condition !== "repairing" && delta.recovery)
		fail(`objective ${key}: ${delta.condition} with a recovery descriptor`);
	return delta;
};

const parseEpisodeRow = (value: unknown, key: string): CausalEpisode => {
	const row = asObject(value, `episode ${key}`);
	if (typeof row.closed !== "boolean")
		fail(`episode ${key}: closed is not a boolean`);
	return {
		ordinal: ordinal(row, "ordinal", `episode ${key}`),
		initiating: parseFact(row.initiating, `episode ${key} initiating`),
		...(row.intervention === undefined
			? {}
			: {
					intervention: parseFact(
						row.intervention,
						`episode ${key} intervention`,
					),
				}),
		latest: parseFact(row.latest, `episode ${key} latest`),
		closed: row.closed as boolean,
	};
};

/** One scan observation, as §5 defines it: a clock, a channel, and the two
 *  ordinals the reading was taken at. */
const parseScan = (raw: unknown, key: string): CarrierScanObservation => {
	const o = asObject(raw, `knowledge ${key} scan`);
	return {
		observedAt: num(o, "observedAt", `knowledge ${key} scan`),
		source: str(o, "source", `knowledge ${key} scan`),
		observedInstanceOrdinal: ordinal(
			o,
			"observedInstanceOrdinal",
			`knowledge ${key} scan`,
		),
		observedVoyageOrdinal: voyageOrdinal(
			o,
			"observedVoyageOrdinal",
			`knowledge ${key} scan`,
		),
	};
};

/**
 * A voyage ordinal, or Traffic's `-1` for a carrier that has not flown yet.
 *
 * Separate from `ordinal` because this member is allowed the sentinel and
 * nothing else below zero: a voyage count is a count, and the one value that is
 * not a count is the one the writer can legitimately hand over.
 */
const voyageOrdinal = (
	raw: Record<string, unknown>,
	field: string,
	what: string,
): number => {
	const value = num(raw, field, what);
	// `NO_FLOWN_VOYAGE`, not a literal: this is the persistence half of a value
	// the traffic layer defines, and two copies of -1 agree only by luck.
	if (!Number.isInteger(value) || value < NO_FLOWN_VOYAGE)
		fail(
			`${what}: ${field} ${value} is neither a voyage count nor the sentinel`,
		);
	return value;
};

const parseKnowledgeRow = (value: unknown, key: string): KnowledgeRow => {
	const row = asObject(value, `knowledge row ${key}`);
	// **The condition triple is one observation, and a row may carry none of
	// it** (§3.1 as amended by #364): the only thing known about a scanned
	// ordinary carrier is its scan. Half a triple is not a row anything can
	// write, and a row carrying no observation is a row that knows nothing, so
	// both are refused by name — the pair of checks that keeps the model's
	// legality and the parser's the same claim.
	const hasCondition = row.observedCondition !== undefined;
	const hasInstance = row.observedInstanceOrdinal !== undefined;
	if (hasCondition !== hasInstance)
		fail(
			`knowledge ${key}: observedCondition and observedInstanceOrdinal are one observation; one was absent`,
		);
	if (row.observedRecovery !== undefined && !hasCondition)
		fail(
			`knowledge ${key}: observedRecovery belongs to a condition observation`,
		);
	const scan = row.scan === undefined ? undefined : parseScan(row.scan, key);
	if (!hasCondition && scan === undefined)
		fail(
			`knowledge ${key}: a row carries a condition observation, a scan, or both`,
		);
	const condition = hasCondition
		? str(row, "observedCondition", `knowledge ${key}`)
		: undefined;
	if (condition !== undefined && !CONDITIONS.has(condition))
		fail(`knowledge ${key}: observedCondition ${condition} is unknown`);
	const observedRecovery =
		row.observedRecovery === undefined
			? undefined
			: parseObservedRecovery(row.observedRecovery, `knowledge ${key}`);
	const facts = row.knownPrivateFacts;
	let knownPrivateFacts: KnowledgeRow["knownPrivateFacts"];
	if (facts !== undefined) {
		const factObject = asObject(facts, `knowledge ${key} knownPrivateFacts`);
		// **Each member is optional, and the container may hold none.** The
		// parser required `blackMarket` while the model stopped requiring it,
		// which is the pair that lets a shape the model calls legal fail to load.
		if (factObject.blackMarket === undefined) knownPrivateFacts = {};
		else {
			const blackMarket = asObject(
				factObject.blackMarket,
				`knowledge ${key} knownPrivateFacts.blackMarket`,
			);
			knownPrivateFacts = {
				blackMarket: {
					learnedAt: num(
						blackMarket,
						"learnedAt",
						`knowledge ${key} blackMarket`,
					),
					source: str(blackMarket, "source", `knowledge ${key} blackMarket`),
				},
			};
		}
	}
	return {
		...(hasCondition
			? {
					observedInstanceOrdinal: ordinal(
						row,
						"observedInstanceOrdinal",
						`knowledge ${key}`,
					),
					observedCondition: condition as OperationalCondition,
				}
			: {}),
		observedAt: num(row, "observedAt", `knowledge ${key}`),
		source: str(row, "source", `knowledge ${key}`),
		...(observedRecovery ? { observedRecovery } : {}),
		...(scan ? { scan } : {}),
		...(knownPrivateFacts ? { knownPrivateFacts } : {}),
	};
};

/**
 * The ids a container may name: a tonne good a station trades, or a module on
 * the append-only fitting list. A row naming anything else was not written by
 * a draw.
 *
 * **So a commodity's name is now persisted identity that refuses.** A market
 * deficit also stores goods by name, but `parseDeficits` keeps an unknown one
 * and it only stops mattering; a derelict container naming one fails the whole
 * world parse. Renaming or removing a tonne good therefore owes a save
 * migration for these rows.
 */
const DERELICT_GOOD_IDS: ReadonlySet<string> = new Set(
	COMMODITIES.filter((c) => c.unit === "t").map((c) => c.name),
);
const DERELICT_FITTING_IDS: ReadonlySet<string> = new Set(DERELICT_FITTINGS);
const DEATH_GOOD_IDS: ReadonlySet<string> = new Set(
	COMMODITIES.map((c) => c.name),
);
const DEATH_FITTING_IDS: ReadonlySet<string> = new Set(
	EQUIPMENT.filter((e) => e.name !== ESCAPE_POD).map((e) => e.name),
);

const parseDerelictContainer = (
	raw: unknown,
	what: string,
	death = false,
): DerelictContainer => {
	const o = asObject(raw, what);
	const kind = str(o, "kind", what);
	if (kind !== "good" && kind !== "fitting")
		fail(`${what}: container kind ${kind} is unknown`);
	const id = str(o, "id", what);
	if (
		!(
			death
				? kind === "good"
					? DEATH_GOOD_IDS
					: DEATH_FITTING_IDS
				: kind === "good"
					? DERELICT_GOOD_IDS
					: DERELICT_FITTING_IDS
		).has(id)
	)
		fail(`${what}: ${id} is not a ${kind} a derelict can hold`);
	const tonnes = ordinal(o, "tonnes", what);
	if (tonnes === 0) fail(`${what}: a container drawn with no tonnes`);
	const left = ordinal(o, "left", what);
	if (left > tonnes)
		fail(
			`${what}: ${left} t left is above the ${tonnes} t line it was drawn with`,
		);
	return { kind: kind as DerelictContainerKind, id, tonnes, left };
};

/**
 * A derelict slot's row (node #731). Refuses, by name, what no writer can // glossary-ignore: slot
 * produce: a key that is not a derelict slot, a container index the row does
 * not hold, more than five containers, tonnes above the drawn line, and a
 * stripped row that is not marked salvaged or the reverse.
 */
const parseDerelictRow = (
	value: unknown,
	key: string,
	death = false,
): DerelictRow => {
	const what = `derelict ${key}`;
	if (
		!death &&
		derelictOrdinalOf(localCarrierIdOfKey(key as CarrierKey)) === null
	)
		fail(`derelicts: ${key} is not a derelict slot`);
	const row = asObject(value, what);
	const lostAt = num(row, "lostAt", what);
	const raw = asObject(row.containers, `${what} containers`);
	const indices = Object.keys(raw);
	const maximum = death ? DEATH_WRECK_MAX_CONTAINERS : DERELICT_MAX_CONTAINERS;
	if (indices.length === 0 || indices.length > maximum)
		fail(`${what}: ${indices.length} containers; a row holds 1 to ${maximum}`);
	const containers: DerelictContainer[] = [];
	for (const index of indices) {
		const i = Number(index);
		if (!Number.isInteger(i) || String(i) !== index || i >= indices.length)
			fail(`${what}: container index ${index} is unknown`);
		containers[i] = parseDerelictContainer(
			raw[index],
			`${what} container ${index}`,
			death,
		);
	}
	let salvaged: DerelictRow["salvaged"];
	if (row.salvaged !== undefined) {
		const o = asObject(row.salvaged, `${what} salvaged`);
		const at = num(o, "at", `${what} salvaged`);
		// A strip comes after its loss. **Its end is not checked**: the
		// salvagers' time is a starting figure the principal's flight tunes, and a
		// parse that read it would refuse every legitimately stripped row the day
		// it was shortened — `tonnes`'s reason, below. The clock bounds it instead
		// (`parseWorld`).
		if (at < lostAt)
			fail(`${what}: salvaged at ${at}, before its loss at ${lostAt}`);
		salvaged = { at, cause: parseProvenance(o.cause, `${what} salvaged`) };
	}
	const empty = containers.every((c) => c.left === 0);
	if (empty !== (salvaged !== undefined))
		fail(
			empty
				? `${what}: every container is empty and the row is not salvaged`
				: `${what}: salvaged with tonnes still in a container`,
		);
	return {
		instanceOrdinal: ordinal(row, "instanceOrdinal", what),
		lostAt,
		containers,
		...(salvaged ? { salvaged } : {}),
	};
};

const parseDeathWreck = (raw: unknown): DeathWreckRow => {
	const o = asObject(raw, "death wreck");
	const key = str(o, "key", "death wreck") as CarrierKey;
	if (
		!isCarrierKey(key) ||
		!isSystemIndex(systemIndexOfKey(key)) ||
		!isDeathWreckKey(key)
	)
		fail("death wreck: invalid commander key");
	const hull = str(o, "hull", "death wreck");
	if (!(HULL_IDS as readonly string[]).includes(hull))
		fail("death wreck: unknown hull");
	const offset = asObject(o.offset, "death wreck offset");
	return {
		...parseDerelictRow(raw, key, true),
		key,
		hull: hull as HullId,
		bodyId: str(o, "bodyId", "death wreck"),
		offset: {
			x: num(offset, "x", "death wreck"),
			y: num(offset, "y", "death wreck"),
			z: num(offset, "z", "death wreck"),
		},
	};
};

/** §7's visited flags. **Checked, never normalised**: re-sorting on the way in
 *  is exactly what would let a save differ from what the integrity hash was
 *  computed over. */
const parseVisited = (raw: unknown, slot: number): number[] => {
	if (!Array.isArray(raw)) fail(`galaxy ${slot}: visited is not an array`);
	const seen = new Set<number>();
	let previous: number | undefined;
	return (raw as unknown[]).map((v) => {
		if (!isSystemIndex(v))
			fail(`galaxy ${slot}: ${String(v)} is not a system index`);
		if (seen.has(v as number))
			fail(`galaxy ${slot}: visited system ${String(v)} is listed twice`);
		if (previous !== undefined && (v as number) < previous)
			fail(`galaxy ${slot}: visited is not in ascending order`);
		previous = v as number;
		seen.add(v as number);
		return v as number;
	});
};

/**
 * One of `LegalStatus`'s two carrier-key lists, and **an absent member is the
 * empty list**.
 *
 * This is what lets `witnesses` (#366) and `assaulted` (#396) each arrive with no
 * `WORLD_SCHEMA_VERSION` bump. A version mismatch refuses the whole save (§9), and
 * an optional member with a default needs no version — so a save written before
 * either landed loads, and reads as nothing having been witnessed and nobody yet
 * charged. `canonicalEnvelope` is what makes that honest: it omits an empty list,
 * so the bytes an old save hashes to are the bytes it was written with.
 *
 * The shape checks are `parseVisited`'s, for the same reason: a `Station.id`
 * that is not a carrier key would read as this system's station in every system,
 * and a list the canonicaliser could not have written means a writer stopped
 * holding each entry once.
 */
const parseLegalKeyList = (
	raw: unknown,
	galaxy: number,
	field: "witnesses" | "assaulted",
): CarrierKey[] => {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) fail(`galaxy ${galaxy}: ${field} is not an array`);
	const seen = new Set<string>();
	let previous: string | undefined;
	return (raw as unknown[]).map((v) => {
		if (typeof v !== "string" || !isCarrierKey(v))
			fail(`galaxy ${galaxy}: ${String(v)} is not a ${field} carrier key`);
		const key = v as CarrierKey;
		if (seen.has(key))
			fail(`galaxy ${galaxy}: ${field} carrier ${key} is listed twice`);
		if (previous !== undefined && compareCarrierKeys(previous, key) > 0)
			fail(`galaxy ${galaxy}: ${field} are not in canonical order`);
		previous = key;
		seen.add(key);
		return key;
	});
};

/** One envelope: the declared-field check, then six named domain parsers, then
 *  the one invariant that spans two of them. */
const parseEnvelope = (raw: unknown, slot: number): GalaxyEnvelope => {
	const o = asObject(raw, `galaxy ${slot}`);
	for (const field of Object.keys(o))
		if (!(ENVELOPE_DOMAINS as readonly string[]).includes(field))
			fail(`galaxy ${slot}: ${field} is not a declared state domain`);
	for (const field of ENVELOPE_DOMAINS)
		if (o[field] === undefined && !OPTIONAL_ENVELOPE_DOMAINS.has(field))
			fail(`galaxy ${slot}: the ${field} domain is missing`);

	const galaxyIndex = num(o, "galaxyIndex", `galaxy ${slot}`);
	if (galaxyIndex !== slot)
		fail(`galaxy ${slot}: galaxyIndex says ${galaxyIndex}`);

	const objective = parseCarrierMap(
		o.objective,
		"objective",
		parseObjectiveRow,
	);
	const episodes = parseCarrierMap(o.episodes, "episodes", parseEpisodeRow);
	const knowledge = parseCarrierMap(
		o.knowledge,
		"knowledge",
		parseKnowledgeRow,
	);
	const legal = asObject(o.legalStatus, `galaxy ${slot} legalStatus`);

	// **A cross-domain invariant, because the maps are written together.** Every
	// objective row is created alongside its episode, and compaction drops
	// objective rows without touching episodes — so `objective` is a subset of
	// `episodes` in anything this model produced. Without the check, a repairing
	// row with no episode materialized to operational with no transition fact
	// and no closure, losing the one causal summary §6 promises.
	for (const key of Object.keys(objective) as CarrierKey[])
		if (!episodes[key])
			fail(`galaxy ${slot}: objective row ${key} has no causal episode`);

	return {
		galaxyIndex,
		...(o.deathWreck === undefined
			? {}
			: { deathWreck: parseDeathWreck(o.deathWreck) }),
		objective,
		episodes,
		knowledge,
		deficits: parseDeficits(o.deficits),
		visited: parseVisited(o.visited, slot),
		legalStatus: {
			heat: num(legal, "heat", `galaxy ${slot}`),
			updatedAt: num(legal, "updatedAt", `galaxy ${slot}`),
			witnesses: parseLegalKeyList(legal.witnesses, galaxyIndex, "witnesses"),
			assaulted: parseLegalKeyList(legal.assaulted, galaxyIndex, "assaulted"),
		},
		derelicts:
			o.derelicts === undefined
				? {}
				: parseCarrierMap(o.derelicts, "derelicts", parseDerelictRow),
	};
};

/**
 * The save → model boundary, and the place §7's "reject a truncated or
 * partially written snapshot atomically" is enforced.
 *
 * Order is deliberate: **shape first, integrity last.** A missing domain, an
 * undeclared one or a mismatched galaxy index gets the error that names it,
 * because "integrity failed" is useless to whoever has to fix the save. The
 * hash then catches what shape checks cannot see — a body assembled from two
 * timelines, each half of it perfectly well-formed.
 */
export function parseWorld(raw: unknown): WorldState {
	const o = asObject(raw, "snapshot");
	// **Versions before every shape check, top-level included.** They decide
	// which shape is legal. Moving them ahead of the *envelope* loops was half
	// the fix: the `WORLD_FIELDS` loop still ran first, so a v2 save adding a
	// top-level field died as "is not a declared field" — exactly the useless
	// error the move was meant to stop.
	const worldSchemaVersion = num(o, "worldSchemaVersion", "snapshot");
	if (worldSchemaVersion !== WORLD_SCHEMA_VERSION)
		fail(
			`snapshot: worldSchemaVersion ${worldSchemaVersion} needs a migration`,
		);
	const savedGeneratorVersion = num(o, "worldGeneratorVersion", "snapshot");
	if (
		savedGeneratorVersion !== WORLD_GENERATOR_VERSION &&
		!LEGACY_WORLD_GENERATOR_VERSIONS.includes(savedGeneratorVersion)
	)
		fail(
			`snapshot: worldGeneratorVersion ${savedGeneratorVersion} needs a migration`,
		);
	for (const field of Object.keys(o))
		if (!(WORLD_FIELDS as readonly string[]).includes(field))
			fail(`snapshot: ${field} is not a declared field`);
	if (!Array.isArray(o.galaxies) || o.galaxies.length !== GALAXY_COUNT)
		fail(`snapshot: expected eight galaxy envelopes`);

	const world: WorldState = {
		worldSchemaVersion,
		// Rebase old overlays onto the generated current catalog. The integrity
		// hash below still checks the body that arrived; the next write hashes one
		// stamped with the current version. Old physical placements are not stored.
		worldGeneratorVersion: WORLD_GENERATOR_VERSION,
		seed: num(o, "seed", "snapshot"),
		gameTime: num(o, "gameTime", "snapshot"),
		galaxies: (o.galaxies as unknown[]).map((g, i) => parseEnvelope(g, i)),
	};
	if (world.galaxies.filter((g) => g.deathWreck).length > 1)
		fail("death wreck: more than one commander wreck");
	for (const env of world.galaxies) {
		const ownKeys = (Object.keys(env.knowledge) as CarrierKey[]).filter(
			isDeathWreckKey,
		);
		if (ownKeys.some((key) => key !== env.deathWreck?.key))
			fail("death wreck: orphan own loss knowledge");
		const row = env.deathWreck;
		if (!row) continue;
		if (row.lostAt < 0 || row.lostAt > world.gameTime || row.salvaged)
			fail("death wreck: invalid loss time or stripped row");
		const record = systemAt(
			world.seed,
			env.galaxyIndex,
			systemIndexOfKey(row.key),
		);
		const contents = generateContents(record);
		const ids = [
			contents.star.id,
			...contents.planets.flatMap((p) => [p.id, ...p.moons.map((m) => m.id)]),
			...contents.stations.map((s) => s.id),
		];
		if (
			!ids.includes(row.bodyId) &&
			!(row.bodyId === "relay-00" && relayPlan(contents, record.seed))
		)
			fail("death wreck: unknown frame");
		const known = env.knowledge[row.key];
		if (
			!known ||
			known.observedInstanceOrdinal !== row.instanceOrdinal ||
			known.source !== "own loss" ||
			known.observedAt !== row.lostAt ||
			known.observedCondition !== "destroyed"
		)
			fail("death wreck: missing own loss knowledge");
	}
	// glossary-ignore: slot
	// **A derelict key names a slot its system holds**, which needs the seed and
	// so cannot be checked inside one envelope. `derelict-02` in a lawful system
	// matches the id pattern; let through, it loads cleanly and then throws "is
	// not a derelict slot" on the first read, a long way from the save.
	//
	// **And a row's times are on the clock**, which is also only here. Every
	// writer advances the clock to the time it writes, so no written loss or
	// strip is after `gameTime`, and a first loss is never before zero. A row
	// outside that was not written: one stamped in the future throws on its
	// first read, and one stamped far in the past sends the schedule's walk
	// through every instance since.
	for (const env of world.galaxies)
		for (const [key, row] of Object.entries(env.derelicts) as [
			CarrierKey,
			DerelictRow,
		][]) {
			if (!heldDerelictSlot(world.seed, env.galaxyIndex, key))
				fail(
					`derelicts: ${key} is not a derelict slot in galaxy ${env.galaxyIndex}`,
				);
			if (row.lostAt < 0 || row.lostAt > world.gameTime)
				fail(
					`derelict ${key}: lost at ${row.lostAt}, outside the clock's 0 to ${world.gameTime}`,
				);
			if (row.salvaged && row.salvaged.at > world.gameTime)
				fail(
					`derelict ${key}: salvaged at ${row.salvaged.at}, after the clock's ${world.gameTime}`,
				);
		}

	// **Over what arrived, not over what parsing made of it.** Hashing the
	// re-canonicalised model made every difference canonicalisation smooths away
	// invisible to the check — the hash agreed with itself by construction.
	//
	// The cost is that this hash cannot say *which* difference it found. A
	// snapshot assembled from two timelines and one merely re-encoded with its
	// keys in another order both land here, so the message names the class and
	// not a diagnosis it cannot make.
	const { integrity, ...received } = o;
	// Named, not diagnosed as a mismatch: §7 asks truncation to be reported as
	// truncation, and a save with the field cut off is the commonest way to
	// arrive here.
	if (typeof integrity !== "number")
		fail("snapshot: the integrity field is missing");
	if (integrity !== fnv1a(JSON.stringify(received)))
		fail(
			"snapshot: integrity check failed — the body does not match its hash (re-encoded, re-ordered, or assembled from more than one save)",
		);

	return world;
}
