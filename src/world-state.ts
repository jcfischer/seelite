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

import { generateGalaxy } from "./galaxy";
import {
	type CarrierKey,
	type DeficitMap,
	carrierKey,
	parseDeficits,
} from "./market";
import { generateContents } from "./system";

export type { CarrierKey };
export { carrierKey };

/**
 * The mutable-state schema version (§2). Bump when the shape of anything in a
 * `GalaxyEnvelope` changes; the save/load node owns migration and rejection.
 */
export const WORLD_SCHEMA_VERSION = 1;

/**
 * The seeded-baseline version (§2). Bump on **any** generator change that can
 * alter a carrier's identity, type, parent or generated placement — which is
 * exactly the set `carrierBaselineFingerprint` hashes, so the pinned
 * fingerprints in `world-state.test.ts` go red at the same moment.
 */
export const WORLD_GENERATOR_VERSION = 1;

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
}

/** §3.1's snapshot of a recovery as the player last saw it. Deliberately a
 *  copy, not a reference: it is intelligence, and it goes stale. */
export interface ObservedRecovery {
	processId: string;
	kind: RecoveryKind;
	consequenceArea: string;
	startedAt: number;
	completesAt: number;
}

/** §3.1's last-known row. No row at all means undiscovered. */
export interface KnowledgeRow {
	observedInstanceOrdinal: number;
	observedCondition: OperationalCondition;
	observedAt: number;
	source: string;
	observedRecovery?: ObservedRecovery;
}

/**
 * §7's per-galaxy legal-status slot.
 *
 * The *semantics* — thresholds, decay, what counts as an offence — belong to
 * the combat node, not here. What §7 requires of this model is that the domain
 * has a typed home inside the envelope and survives a round trip, so this is
 * the persisted pair and nothing more. Anything derived from it (a Clean /
 * Wanted / Fugitive label, a police response) is a §8 projection and must not
 * be saved.
 */
export interface LegalStatus {
	heat: number;
	updatedAt: number;
}

/** §7's typed per-galaxy envelope. The galaxy index lives here once; every
 *  station-keyed domain stores the envelope-relative `(systemIndex,
 *  localCarrierId)` pair and gets its galaxy from the container. */
export interface GalaxyEnvelope {
	galaxyIndex: number;
	objective: Record<CarrierKey, ObjectiveDelta>;
	episodes: Record<CarrierKey, CausalEpisode>;
	knowledge: Record<CarrierKey, KnowledgeRow>;
	deficits: DeficitMap;
	/** System indices the player has visited, ascending. */
	visited: number[];
	legalStatus: LegalStatus;
}

export interface WorldState {
	worldSchemaVersion: number;
	worldGeneratorVersion: number;
	seed: number;
	/** The authoritative clock (§4). Every lazy derivation reads it. */
	gameTime: number;
	galaxies: GalaxyEnvelope[];
}

/** The envelope's declared domains. Anything else in a serialized envelope is
 *  rejected (§9.2): a save is not an open bag. */
const ENVELOPE_DOMAINS = [
	"galaxyIndex",
	"objective",
	"episodes",
	"knowledge",
	"deficits",
	"visited",
	"legalStatus",
] as const;

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
	legalStatus: { heat: 0, updatedAt: 0 },
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
export interface GeneratedCarrier {
	systemIndex: number;
	localCarrierId: string;
	key: CarrierKey;
	/** Generated facts, for the fingerprint only. They are never persisted. */
	stationType: string;
	parentId: string | null;
	orbitRadiusKm: number;
	orbitTheta0: number;
}

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
		for (const station of generateContents(record).stations)
			yield {
				systemIndex,
				localCarrierId: station.localCarrierId,
				key: carrierKey(systemIndex, station.localCarrierId),
				stationType: station.type,
				parentId: station.parentId,
				orbitRadiusKm: station.orbit.radiusKm,
				orbitTheta0: station.orbit.theta0,
			};
	}
}

/** FNV-1a, 32-bit. A hash, not a checksum with any cryptographic claim: what
 *  it has to do is change when its input does. */
const fnv1a = (text: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
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
 */
export const carrierBaselineFingerprint = (
	worldSeed: number,
	galaxyIndex: number,
): number => {
	const parts: string[] = [];
	for (const c of enumerateCarriers(worldSeed, galaxyIndex))
		parts.push(
			`${c.systemIndex}|${c.localCarrierId}|${c.stationType}|${c.parentId ?? "-"}|${c.orbitRadiusKm.toFixed(6)}|${c.orbitTheta0.toFixed(6)}`,
		);
	return fnv1a(parts.join("\n"));
};

/**
 * §4/§5's canonical carrier order: system index **numerically**, then the local
 * id.
 *
 * A plain string sort is wrong here and quietly so — `"11:station-trade"` sorts
 * before `"2:station-trade"` — and the order is load-bearing, because
 * same-timestamp completions materialize in it.
 */
export const compareCarrierKeys = (a: string, b: string): number => {
	const [sa, ia] = splitKey(a);
	const [sb, ib] = splitKey(b);
	if (sa !== sb) return sa - sb;
	return ia < ib ? -1 : ia > ib ? 1 : 0;
};

/**
 * The persisted key's shape, in one place.
 *
 * `parseDeficits` in `market.ts` holds a third copy, which stays until that
 * module's save-format block moves out to `src/deficits.ts` — the note at the
 * bottom of `market.ts` §5.5 owns that move, and duplicating the regex here to
 * avoid one import would be the wrong half of the fix.
 */
export const isCarrierKey = (key: string): boolean => /^\d+:.+$/.test(key);

const splitKey = (key: string): [number, string] => {
	const at = key.indexOf(":");
	return [Number(key.slice(0, at)), key.slice(at + 1)];
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

const isDue = (delta: ObjectiveDelta | undefined, gameTime: number): boolean =>
	delta?.condition === "repairing" &&
	delta.recovery !== undefined &&
	gameTime >= delta.recovery.completesAt;

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
	const settled = isDue(delta, gameTime) ? materialized(delta) : delta;
	return {
		instanceOrdinal: settled.instanceOrdinal,
		condition: settled.condition,
		recovery: settled.recovery,
	};
};

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
		const delta = env.objective[key];
		const recovery = delta.recovery;
		if (!recovery) continue;
		const next = materialized(delta);
		objective[key] = next;
		const episode = episodes[key];
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
			episodes[key] = { ...episode, latest: fact, closed: true };
		}
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
			kind: "disable" | "destroy" | "restore";
			occurredAt: number;
			cause: Provenance;
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
 * The one bounds check every writer shares.
 *
 * It was on `applyTransition` alone, and the other three writers spread
 * `galaxies[8]` — `undefined` — into a ninth envelope holding one domain. The
 * corruption then surfaced a long way from its cause, inside a canonicaliser
 * or as "expected eight galaxy envelopes" on the next load.
 */
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
			next = {
				instanceOrdinal: current.instanceOrdinal,
				condition: event.kind === "disable" ? "disabled" : "destroyed",
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
			if (
				!Number.isFinite(event.completesAt) ||
				event.completesAt < event.occurredAt
			)
				fail(`${event.kind} completes before it starts`);
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
				event.completesAt < event.occurredAt
			)
				fail("recovery-change completes before now");
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
	const intervention = opensEpisode
		? isStart
			? fact
			: undefined
		: (open?.intervention ?? (isStart ? fact : undefined));
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
		envelope = writeKnowledge(
			envelope,
			key,
			next,
			event.occurredAt,
			"intervention",
		);

	const galaxies = advanced.galaxies.slice();
	galaxies[galaxyIndex] = envelope;
	return { ...advanced, gameTime: event.occurredAt, galaxies };
}

// ---------------------------------------------------------------------------
// §3.1 — knowledge
// ---------------------------------------------------------------------------

const writeKnowledge = (
	env: GalaxyEnvelope,
	key: CarrierKey,
	state: {
		instanceOrdinal: number;
		condition: OperationalCondition;
		recovery?: RecoveryDescriptor;
	},
	observedAt: number,
	source: string,
): GalaxyEnvelope => {
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
	};
	return { ...env, knowledge: { ...env.knowledge, [key]: row } };
};

export const readKnowledge = (
	env: GalaxyEnvelope,
	key: CarrierKey,
): KnowledgeRow | undefined => env.knowledge[key];

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
	assertGalaxy(galaxyIndex);
	// The same clock rule `applyTransition` enforces. Without it `advanceTo`'s
	// `Math.max` silently accepted an observation from the past and let it
	// overwrite fresher intelligence with a stale `observedAt`.
	if (!Number.isFinite(gameTime) || gameTime < world.gameTime)
		fail(`observe at ${gameTime} is before the clock (${world.gameTime})`);
	// **Through `advanceTo`, not past it.** Moving the clock while leaving a due
	// completion unwritten put the world in a state no other verb can produce:
	// clock ahead of a `completesAt` nothing had materialized. `advanceTo` is
	// idempotent, so paying for it here costs a pass over eight envelopes.
	const advanced = advanceTo(world, gameTime);
	const galaxies = advanced.galaxies.slice();
	const env = galaxies[galaxyIndex];
	galaxies[galaxyIndex] = writeKnowledge(
		env,
		key,
		effectiveCarrier(env, key, gameTime),
		gameTime,
		source,
	);
	return { ...advanced, galaxies };
};

/** §7's visited-flag domain. Sorted and unique, so insertion order cannot
 *  reach the canonical snapshot. */
export const visit = (
	world: WorldState,
	galaxyIndex: number,
	systemIndex: number,
): WorldState => {
	assertGalaxy(galaxyIndex);
	// The parser's range, applied at the write. Accepting a value only the next
	// load rejects is the distance-from-cause `assertGalaxy` exists to close.
	if (!Number.isInteger(systemIndex) || systemIndex < 0 || systemIndex > 255)
		fail(`visit: ${systemIndex} is not a system index`);
	const galaxies = world.galaxies.slice();
	const env = galaxies[galaxyIndex];
	if (env.visited.includes(systemIndex)) return world;
	galaxies[galaxyIndex] = {
		...env,
		visited: [...env.visited, systemIndex].sort((a, b) => a - b),
	};
	return { ...world, galaxies };
};

/** §7's legal-status domain. The persisted pair only — the label and the
 *  police response are §8 projections. */
export const setLegalHeat = (
	world: WorldState,
	galaxyIndex: number,
	heat: number,
	updatedAt: number,
): WorldState => {
	assertGalaxy(galaxyIndex);
	if (!Number.isFinite(heat) || !Number.isFinite(updatedAt))
		fail(`setLegalHeat: ${heat}/${updatedAt} is not a finite pair`);
	const galaxies = world.galaxies.slice();
	galaxies[galaxyIndex] = {
		...galaxies[galaxyIndex],
		legalStatus: { heat, updatedAt },
	};
	return { ...world, galaxies };
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
					delta.recovery === undefined;
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

const canonicalFact = (f: TransitionFact) => ({
	key: f.key,
	instanceOrdinal: f.instanceOrdinal,
	episodeOrdinal: f.episodeOrdinal,
	kind: f.kind,
	occurredAt: f.occurredAt,
	cause: canonicalProvenance(f.cause),
	...(f.processId === undefined ? {} : { processId: f.processId }),
});

const canonicalEnvelope = (env: GalaxyEnvelope) => ({
	galaxyIndex: env.galaxyIndex,
	objective: canonicalMap(env.objective, (d) => ({
		instanceOrdinal: d.instanceOrdinal,
		condition: d.condition,
		...(d.recovery ? { recovery: canonicalRecovery(d.recovery) } : {}),
	})),
	episodes: canonicalMap(env.episodes, (e) => ({
		ordinal: e.ordinal,
		initiating: canonicalFact(e.initiating),
		...(e.intervention ? { intervention: canonicalFact(e.intervention) } : {}),
		latest: canonicalFact(e.latest),
		closed: e.closed,
	})),
	knowledge: canonicalMap(env.knowledge, (k) => ({
		observedInstanceOrdinal: k.observedInstanceOrdinal,
		observedCondition: k.observedCondition,
		observedAt: k.observedAt,
		source: k.source,
		...(k.observedRecovery
			? { observedRecovery: { ...k.observedRecovery } }
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
	},
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
 * guarantee**: `integrity` is a hash of the whole canonical body, so a snapshot
 * assembled from two different timelines is rejected instead of loading as a
 * plausible third one.
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
	return {
		processId: str(o, "processId", what),
		kind: kind as RecoveryKind,
		consequenceArea: str(o, "consequenceArea", what),
		startedAt: num(o, "startedAt", what),
		completesAt: num(o, "completesAt", what),
	};
};

const parseRecovery = (raw: unknown, what: string): RecoveryDescriptor => {
	const shared = parseObservedRecovery(raw, what);
	const o = asObject(raw, `${what} recovery`);
	return { ...shared, initiatedBy: parseProvenance(o.initiatedBy, what) };
};

const parseFact = (raw: unknown, what: string): TransitionFact => {
	const o = asObject(raw, `${what} transition`);
	const kind = str(o, "kind", what);
	if (!KINDS.has(kind)) fail(`${what}: transition kind ${kind} is unknown`);
	const key = str(o, "key", what);
	if (!isCarrierKey(key)) fail(`${what}: ${key} is not a carrier key`);
	return {
		key: key as CarrierKey,
		instanceOrdinal: num(o, "instanceOrdinal", what),
		episodeOrdinal: num(o, "episodeOrdinal", what),
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
		// The same check `parseDeficits` makes, for the same reason: a bare
		// `Station.id` as a save key files one system's state under every
		// system's, and a cast would let it through silently.
		if (!/^\d+:.+$/.test(key))
			fail(
				`${domain}: ${key} is not a carrier key (systemIndex:localCarrierId)`,
			);
		out[key as CarrierKey] = each(value, key);
	}
	return out;
};

const parseEnvelope = (raw: unknown, slot: number): GalaxyEnvelope => {
	const o = asObject(raw, `galaxy ${slot}`);
	for (const field of Object.keys(o))
		if (!(ENVELOPE_DOMAINS as readonly string[]).includes(field))
			fail(`galaxy ${slot}: ${field} is not a declared state domain`);
	for (const field of ENVELOPE_DOMAINS)
		if (o[field] === undefined)
			fail(`galaxy ${slot}: the ${field} domain is missing`);

	const galaxyIndex = num(o, "galaxyIndex", `galaxy ${slot}`);
	if (galaxyIndex !== slot)
		fail(`galaxy ${slot}: galaxyIndex says ${galaxyIndex}`);

	const objective = parseCarrierMap(o.objective, "objective", (value, key) => {
		const row = asObject(value, `objective row ${key}`);
		const condition = str(row, "condition", `objective ${key}`);
		if (!CONDITIONS.has(condition))
			fail(`objective ${key}: condition ${condition} is unknown`);
		const delta: ObjectiveDelta = {
			instanceOrdinal: num(row, "instanceOrdinal", `objective ${key}`),
			condition: condition as OperationalCondition,
			...(row.recovery === undefined
				? {}
				: { recovery: parseRecovery(row.recovery, `objective ${key}`) }),
		};
		// Both directions. The one-sided check let an `operational` row carry a
		// live descriptor that `isDue` can never fire and `effectiveCarrier`
		// hands straight back — an immortal recovery.
		if (delta.condition === "repairing" && !delta.recovery)
			fail(`objective ${key}: repairing with no recovery descriptor`);
		if (delta.condition !== "repairing" && delta.recovery)
			fail(`objective ${key}: ${delta.condition} with a recovery descriptor`);
		return delta;
	});

	const episodes = parseCarrierMap(o.episodes, "episodes", (value, key) => {
		const row = asObject(value, `episode ${key}`);
		if (typeof row.closed !== "boolean")
			fail(`episode ${key}: closed is not a boolean`);
		return {
			ordinal: num(row, "ordinal", `episode ${key}`),
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
		} satisfies CausalEpisode;
	});

	const knowledge = parseCarrierMap(o.knowledge, "knowledge", (value, key) => {
		const row = asObject(value, `knowledge row ${key}`);
		const condition = str(row, "observedCondition", `knowledge ${key}`);
		if (!CONDITIONS.has(condition))
			fail(`knowledge ${key}: observedCondition ${condition} is unknown`);
		const observedRecovery =
			row.observedRecovery === undefined
				? undefined
				: parseObservedRecovery(row.observedRecovery, `knowledge ${key}`);
		return {
			observedInstanceOrdinal: num(
				row,
				"observedInstanceOrdinal",
				`knowledge ${key}`,
			),
			observedCondition: condition as OperationalCondition,
			observedAt: num(row, "observedAt", `knowledge ${key}`),
			source: str(row, "source", `knowledge ${key}`),
			...(observedRecovery ? { observedRecovery } : {}),
		} satisfies KnowledgeRow;
	});

	if (!Array.isArray(o.visited))
		fail(`galaxy ${slot}: visited is not an array`);
	const seen = new Set<number>();
	let previous: number | undefined;
	const visited = (o.visited as unknown[]).map((v) => {
		if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255)
			fail(`galaxy ${slot}: ${String(v)} is not a system index`);
		// `visit` promises **strictly ascending**, so the canonical snapshot
		// cannot carry insertion order. Checked here rather than normalised,
		// because normalising is exactly what would let a save differ from what
		// the integrity hash was computed over.
		if (seen.has(v as number))
			fail(`galaxy ${slot}: visited system ${String(v)} is listed twice`);
		if (previous !== undefined && (v as number) < previous)
			fail(`galaxy ${slot}: visited is not in ascending order`);
		previous = v as number;
		seen.add(v as number);
		return v as number;
	});

	const legal = asObject(o.legalStatus, `galaxy ${slot} legalStatus`);

	return {
		galaxyIndex,
		objective,
		episodes,
		knowledge,
		deficits: parseDeficits(o.deficits),
		visited,
		legalStatus: {
			heat: num(legal, "heat", `galaxy ${slot}`),
			updatedAt: num(legal, "updatedAt", `galaxy ${slot}`),
		},
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
	for (const field of Object.keys(o))
		if (!(WORLD_FIELDS as readonly string[]).includes(field))
			fail(`snapshot: ${field} is not a declared field`);
	if (!Array.isArray(o.galaxies) || o.galaxies.length !== GALAXY_COUNT)
		fail(`snapshot: expected eight galaxy envelopes`);

	const world: WorldState = {
		worldSchemaVersion: num(o, "worldSchemaVersion", "snapshot"),
		worldGeneratorVersion: num(o, "worldGeneratorVersion", "snapshot"),
		seed: num(o, "seed", "snapshot"),
		gameTime: num(o, "gameTime", "snapshot"),
		galaxies: (o.galaxies as unknown[]).map((g, i) => parseEnvelope(g, i)),
	};

	// **Over what arrived, not over what parsing made of it.** Hashing the
	// re-canonicalised model made every difference canonicalisation smooths away
	// invisible to the check — the hash agreed with itself by construction. The
	// received body is hashed instead, which is why the shape checks above
	// refuse anything canonicalisation would have quietly reordered.
	const { integrity, ...received } = o;
	if (integrity !== fnv1a(JSON.stringify(received)))
		fail("snapshot: integrity check failed — the save is not one timeline");

	if (world.worldSchemaVersion !== WORLD_SCHEMA_VERSION)
		fail(
			`snapshot: worldSchemaVersion ${world.worldSchemaVersion} needs a migration`,
		);
	if (world.worldGeneratorVersion !== WORLD_GENERATOR_VERSION)
		fail(
			`snapshot: worldGeneratorVersion ${world.worldGeneratorVersion} needs a migration`,
		);
	return world;
}
