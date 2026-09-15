/**
 * The pirate sensor relay (node #43): the first infrastructure carrier, and
 * the prototype for #41's discover → intervene → persist → revisit loop.
 *
 * **What it is.** One carrier slot per system, `relay-00`, standing a few
 * hundred kilometres off one station's approach and moving with it. Its
 * **capability** (`operational-consequences`, #41) is that the system's raiders
 * are told about every ship on the route to that station: a cruise leg whose
 * target is the watched station meets a raider on **every** leg while the relay
 * is operational (`RouteDetection` `certain`, given an operational raider slot
 * to send), and on **no** leg while it is destroyed or repairing (`none`).
 * Every other route keeps the leg law. The consequence area is that one route,
 * which is #41's "most carriers affect one station, one system, or one named
 * route".
 *
 * **What it is not, yet.** Not in `enumerateCarriers` and not in the golden
 * persistence table: `parseWorld` refuses a `worldGeneratorVersion` it does not
 * know, so enrolling the slot bumps the version and refuses every existing
 * save until a migration exists. The prototype writes its rows under this
 * reserved id and leaves enrolment, the fingerprint and the version to the
 * node that makes the relay production content — not yet charted; #344
 * consumes this result and is not that node — which is where the missions
 * spec put that decision. The rows round-trip through the save
 * unchanged either way, because the parser checks a key's shape and not its
 * membership.
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
import { type CarrierKey, carrierKey } from "./carrier-key";
import { playerLaserHit } from "./combat-enemy";
import { DOMAIN } from "./domains";
import { stream } from "./galaxy";
import { lifecycleLines, newestFirst, type RaiderLogLine } from "./raider-log";
import { PLAYER_KILL } from "./raider-wreck";
import type { RouteDetection } from "./raider-slots";
import {
	type Orbit,
	type SystemContents,
	orbitNormal,
	positionOnOrbit,
	velocityOnOrbit,
} from "./system";
import { type Vec3, add, length, scale, sub, v3 } from "./vec3";
import type {
	GalaxyEnvelope,
	Provenance,
	TransitionEvent,
} from "./world-state";

/** The slot's persistence id. One per system; renaming it is a migration. */
export const RELAY_LOCAL_CARRIER_ID = "relay-00";

/** What the cockpit calls it once identified, and what the log calls it. */
export const RELAY_NAME = "Pirate relay";

export interface RelaySlot {
	localCarrierId: string;
	key: CarrierKey;
}

export const relaySlot = (systemIndex: number): RelaySlot => ({
	localCarrierId: RELAY_LOCAL_CARRIER_ID,
	key: carrierKey(systemIndex, RELAY_LOCAL_CARRIER_ID),
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
/** Inside this range of the relay the cockpit reads its signal. */
export const RELAY_SIGNAL_RANGE_KM = 2_500;
/** Inside this range the relay is identified: a knowledge row, a contact, a
 *  target. Well under scanner range, so the scanner cannot find it first. */
export const RELAY_IDENTIFY_RANGE_KM = 150;

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
 *  one, otherwise the first. */
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
 * `certain` while the relay is operational and `none` while it is not; every
 * other leg is `law`. `legTargetId` is the cruise leg's selected target.
 */
export function relayDetection(
	plan: Pick<RelayPlan, "watchedStationId"> | null,
	legTargetId: string | null,
	relayOperational: boolean,
): RouteDetection {
	if (!plan || legTargetId !== plan.watchedStationId) return "law";
	return relayOperational ? "certain" : "none";
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

/** Who replaces a system's relay. Out of sight, so it updates no knowledge. */
export const relayReplacementActor = (systemIndex: number): Provenance => ({
	causeKind: "raider-replacement",
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
			consequenceArea: `route:${systemIndex}:${watchedStationId}`,
			cause: relayReplacementActor(systemIndex),
		},
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
