/**
 * The pirate sensor relay (node #43, production since #351): the first
 * infrastructure carrier, and #41's discover → intervene → persist → revisit
 * loop.
 *
 * **What it is.** One carrier slot per system, `relay-00`, standing a few
 * hundred kilometres off one station's approach and moving with it. Its
 * **capability** (`operational-consequences`, #41) is that the system's raiders
 * are told about ships on the route to that station: a cruise leg whose target
 * is the watched station meets a raider on `RELAY_WATCHED_LEG_CHANCE` of legs
 * while the relay is operational (`RouteDetection` `watched`, given an
 * operational raider slot to send), and on **no** leg while it is destroyed or
 * repairing (`none`). Only a system whose relay rolled active
 * (`relayActive`) has one at all.
 * Every other route keeps the leg law. The consequence area is that one route,
 * which is #41's "most carriers affect one station, one system, or one named
 * route".
 *
 * **Enrolled (#351).** The slot and its repair tender are in
 * `enumerateCarriers`, the golden table and the fingerprint at generator
 * version 7, and a version-6 save loads by relabelling, because enrolment moved
 * no older slot (`LEGACY_WORLD_GENERATOR_VERSIONS`). The ids and the plan live
 * in `relay-slot.ts`, which the enumeration can import without reaching `sim.ts`.
 *
 * **Discovery.** A bounded search region around the watched station
 * (`RELAY_REGION_KM`), a signal the cockpit reads inside `RELAY_SIGNAL_RANGE_KM`
 * — strength and bearing, never a marker — and identification inside
 * `RELAY_IDENTIFY_RANGE_KM`, which is the knowledge write that makes the relay
 * a contact and a target. #343's close records the principal's requirement:
 * bounded region, useful guidance, discoverable signal, exact position hidden.
 *
 * **Intervention.** The pulse laser, against a hull sphere, until
 * `RELAY_INTEGRITY` is spent. The kill is a world-state `destroy` with the
 * player's provenance and a scheduled replacement, the raider's lifecycle at
 * twice its length — so the Communications log shows the same three lines and
 * the wreck stays drawn until the replacement completes.
 *
 * Headless: imports the generator's orbit arithmetic and the world-state types
 * and nothing that renders.
 */
import type { CarrierKey } from "./carrier-key";
import { playerLaserHit } from "./combat-enemy";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import { equipmentFitted, LONG_RANGE_SCANNER } from "./market";
import { lifecycleLines, newestFirst, type RaiderLogLine } from "./raider-log";
import { PLAYER_KILL } from "./raider-wreck";
import type { RouteDetection } from "./raider-slots";
import { type RelayPlan, relayPlan, relaySlot } from "./relay-slot";
import {
	type Orbit,
	type SystemContents,
	orbitNormal,
	positionOnOrbit,
	velocityOnOrbit,
} from "./system";
import { type Vec3, add, length, scale, sub, v3 } from "./vec3";
import {
	type GalaxyEnvelope,
	type Provenance,
	type TransitionEvent,
	effectiveCarrier,
} from "./world-state";

/** What the cockpit calls it once identified, and what the log calls it. */
export const RELAY_NAME = "Pirate relay";

/**
 * The chance a system's relay is active, by the principal's ruling on #351:
 * most lawless systems have one, a corporate state rarely. Linear in
 * government between the two ends, like `RAIDER_LEG_CHANCE`.
 */
export const RELAY_ACTIVE_CHANCE = { anarchy: 0.8, corporate: 0.1 } as const;

export const relayActiveChance = (government: number): number => {
	const g = Math.max(0, Math.min(7, Math.round(government)));
	return (
		RELAY_ACTIVE_CHANCE.anarchy +
		((RELAY_ACTIVE_CHANCE.corporate - RELAY_ACTIVE_CHANCE.anarchy) * g) / 7
	);
};

/**
 * Is this system's relay active? One seeded draw per system on its own tag.
 *
 * **A runtime roll, not a generator fact** (#351, D1). The slot and its plan
 * are enumerated in every system with a station whatever this says, so
 * re-tuning the chance moves no identity and owes no generator bump. An
 * inactive relay is absent from the game: not drawn, no signal, no dial on
 * the leg law. A row a save already holds for it is kept and read by nothing.
 */
export const relayActive = (record: {
	seed: number;
	government: number;
}): boolean =>
	stream(record.seed, DOMAIN.RELAY_ACTIVE)() <
	relayActiveChance(record.government);

/** Inside this range of the relay the cockpit reads its signal. */
export const RELAY_SIGNAL_RANGE_KM = 2_500;
/** Inside this range the relay is identified: a knowledge row, a contact, a
 *  target. Well under scanner range, so the scanner cannot find it first. */
export const RELAY_IDENTIFY_RANGE_KM = 150;

/**
 * Both ranges are a **bought module's** reading, not a hull's (#481, #479).
 *
 * The channel is the long-range scanner's: fitted, the cockpit reads strength
 * and bearing inside the signal's range and identifies inside the near one;
 * unfitted it reads nothing at all — no cue, no knowledge row, no contact.
 * What is deliberately *not* gated is the relay's dial on the watched route,
 * so an unequipped pilot still meets the raiders it sends and cannot find the
 * cause. That asymmetry is the whole of #479's ruling.
 *
 * **The name is a persisted identity.** `ownedEquipment` saves the display
 * string itself, so renaming the row in `market.ts` unfits the module in every
 * existing save whatever reads this constant — it is a save migration, not a
 * rename.
 *
 * The lookup is `market.ts`'s `equipmentFitted`; what lives here is the rule,
 * so the relay's module owns every question about reading a relay.
 */
export const relayScannerFitted = (
	ownedEquipment: readonly string[],
): boolean => equipmentFitted(ownedEquipment, LONG_RANGE_SCANNER);

/**
 * Has this pilot found this relay? **The gated read, so a second consumer
 * inherits the gate rather than re-deriving it.**
 *
 * `relay-codex.md` already names one in view — the Galaxy Map's station card
 * would carry the row if it listed relays — and the rule is not "is there a
 * row" but "is there a row *and* a module to read it with". The row is never
 * unwritten: what the gate withholds is the reading.
 */
export const relayIdentified = (
	ownedEquipment: readonly string[],
	knowledgeRow: unknown,
): boolean => relayScannerFitted(ownedEquipment) && knowledgeRow !== undefined;

/** Hull points. Ten seconds of pulse fire (`PULSE_LASER.damagePerS` 6). */
export const RELAY_INTEGRITY = 60;

/**
 * The form's dimensions, km, owned here so the sim owns the shape and
 * `relay-mesh.ts` authors no figure of its own (the station-interior rule).
 * An 80 m mast with a 30 m dish on top, and two panels reaching 60 m either
 * side of it at half height.
 */
export const RELAY_MAST_KM = 0.08;
export const RELAY_DISH_KM = 0.03;
export const RELAY_PANEL_REACH_KM = 0.06;
/** The form's height, foot to lamp. */
export const RELAY_HEIGHT_KM = RELAY_MAST_KM + RELAY_DISH_KM * 0.5 + 0.004;
/**
 * The hit sphere, centred on the form's midpoint — the mesh is built with its
 * midpoint at the root, so `relayPosition` is that centre. It contains the
 * form's bounding box, corner and all: half the height, the panels' reach and
 * the dish's radius, one per axis.
 * `tests/relay-mesh.test.ts` builds the mesh and holds its box inside this.
 */
export const RELAY_HIT_RADIUS_KM = Math.hypot(
	RELAY_HEIGHT_KM / 2,
	RELAY_PANEL_REACH_KM,
	RELAY_DISH_KM,
);

/**
 * Whether a shot along the sightline lands on the relay: the duel's own beam
 * test (`playerLaserHit`) against the relay's hull sphere, so there is one
 * copy of the hit arithmetic. `Game` fires along the gimballed aim, as it does
 * at a raider.
 */
export const relayInSights = (
	aimOrigin: Vec3,
	aimNose: Vec3,
	relayPos: Vec3,
): boolean =>
	playerLaserHit(aimOrigin, aimNose, relayPos, RELAY_HIT_RADIUS_KM).hit;

/** Destroyed for twenty minutes, then repairing for forty: the raider's
 *  lifecycle at twice its length, because infrastructure is slower to replace
 *  than a hull. An hour in all. */
export const RELAY_WRECK_S = 1_200;
export const RELAY_REPAIR_S = 2_400;

function parentOrbit(plan: RelayPlan, contents: SystemContents): Orbit | null {
	if (!plan.parentId) return null;
	const parent = contents.planets.find((p) => p.id === plan.parentId);
	if (!parent) throw new Error(`relay: no planet ${plan.parentId}`);
	return parent.orbit;
}

/** Where the relay is at `gameTime`, star-centred km — composed as
 *  `placeBodies` composes a station's position. */
export function relayPosition(
	plan: RelayPlan,
	contents: SystemContents,
	gameTime: number,
): Vec3 {
	const parent = parentOrbit(plan, contents);
	return add(
		add(
			parent ? positionOnOrbit(parent, gameTime) : v3(),
			positionOnOrbit(plan.orbit, gameTime),
		),
		scale(orbitNormal(plan.orbit), plan.offPlaneKm),
	);
}

/** Its velocity, km/s: the exact derivative of `relayPosition`. */
export function relayVelocity(
	plan: RelayPlan,
	contents: SystemContents,
	gameTime: number,
): Vec3 {
	const parent = parentOrbit(plan, contents);
	return add(
		parent ? velocityOnOrbit(parent, gameTime) : v3(),
		velocityOnOrbit(plan.orbit, gameTime),
	);
}

/**
 * The capability, as the leg law reads it: the route to the watched station is
 * `watched` while the relay is operational and `none` while it is not; every
 * other leg is `law`. `legTargetId` is the cruise leg's selected target.
 */
export function relayDetection(
	plan: Pick<RelayPlan, "watchedStationId"> | null,
	legTargetId: string | null,
	relayOperational: boolean,
): RouteDetection {
	if (!plan || legTargetId !== plan.watchedStationId) return "law";
	return relayOperational ? "watched" : "none";
}

export interface RelaySignal {
	km: number;
	/** 0 at the edge of the signal's range, 1 at identification range. */
	strength: number;
}

/** What the cockpit reads of the relay's transmission, or null beyond its
 *  range. Range only: the bearing is the cockpit's to draw from the position. */
export function relaySignal(shipPos: Vec3, relayPos: Vec3): RelaySignal | null {
	const km = length(sub(relayPos, shipPos));
	if (km > RELAY_SIGNAL_RANGE_KM) return null;
	const span = RELAY_SIGNAL_RANGE_KM - RELAY_IDENTIFY_RANGE_KM;
	const strength = Math.max(
		0,
		Math.min(1, (RELAY_SIGNAL_RANGE_KM - km) / span),
	);
	return { km, strength };
}

/** The consequence area of a relay's capability: the route it watches.
 *  One spelling, read by the relay's kill and its tender's. */
export const relayRouteArea = (
	systemIndex: number,
	watchedStationId: string,
): string => `route:${systemIndex}:${watchedStationId}`;

/** Who replaces a system's relay. Out of sight, so it updates no knowledge. */
export const relayReplacementActor = (systemIndex: number): Provenance => ({
	causeKind: "relay-replacement",
	actorId: `raider-network-${systemIndex}`,
	playerRole: "none",
});

/** The world-state transition a player's kill applies to the relay's slot.
 *  The consequence area names the route, not the system. */
export function relayDestruction(
	systemIndex: number,
	now: number,
	/** Required, for `holdT`'s reason: a default would let a caller that
	 *  forgot the plan persist another station's route as the area. */
	watchedStationId: string,
): TransitionEvent {
	return {
		kind: "destroy",
		occurredAt: now,
		cause: PLAYER_KILL,
		schedule: {
			startsAt: now + RELAY_WRECK_S,
			completesAt: now + RELAY_WRECK_S + RELAY_REPAIR_S,
			consequenceArea: relayRouteArea(systemIndex, watchedStationId),
			cause: relayReplacementActor(systemIndex),
		},
	};
}

/**
 * The relay as something a job may name. Declared here rather than imported
 * from `jobs.ts`, so a carrier module does not depend on the job board: the
 * board's `BountyTarget` is the same shape and accepts this structurally.
 */
export interface RelayTarget {
	carrierKey: CarrierKey;
	name: string;
	watchedStationName: string;
}

/**
 * The system's relay as a Bounty target, or null when there is nothing to post
 * against (#495 D4, #508).
 *
 * **The roll first, then the condition.** An inactive relay has no world row,
 * and an absent row reads `operational` (`effectiveCarrier`, §1), so a check
 * on the condition alone would post a bounty on a relay that is not there.
 * While destroyed or repairing it is null too, which is the Bounty's whole
 * throttle (`ordinary-requests.md` D9): the repair window.
 */

export function bountyTargetOf(
	record: { index: number; seed: number; government: number },
	contents: SystemContents,
	env: GalaxyEnvelope,
	gameTime: number,
): RelayTarget | null {
	if (!relayActive(record)) return null;
	const plan = relayPlan(contents, record.seed);
	if (!plan) return null;
	const key = relaySlot(record.index).key;
	if (effectiveCarrier(env, key, gameTime).condition !== "operational")
		return null;
	const watched = contents.stations.find((s) => s.id === plan.watchedStationId);
	return {
		carrierKey: key,
		name: RELAY_NAME,
		watchedStationName: watched?.name ?? plan.watchedStationId,
	};
}

/** The relay's Communications lines for one system at `gameTime`, newest
 *  first: the same derivation as the raider's. */
export function relayLog(
	env: GalaxyEnvelope,
	systemIndex: number,
	gameTime: number,
): RaiderLogLine[] {
	return newestFirst(
		lifecycleLines(env, relaySlot(systemIndex).key, RELAY_NAME, gameTime),
	);
}
