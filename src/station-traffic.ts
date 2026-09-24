/**
 * Deterministic station-owned Traffic: identity, home schedule, shared queue
 * ordering, and the presentation projection. No Three.js and no mutable RNG.
 */

import { berthCentre, parkedAttitude, recomposeOffset } from "./arrival";
import { type CarrierKey, carrierKey, compareCarrierKeys } from "./carrier-key";
import { trafficRegistry } from "./carrier-name";
import type { DisplayContact } from "./display-contact";
import type { TrafficRoutePhase } from "./station-route";
import { apertureFrame, frameAtPhase, slotBasis, V_GATE_KMS } from "./docking";
import { fnv1a } from "./rng";
import { HULL_SPECS, type HullEnvelope, type HullId } from "./hull";
import { bodyVelocity, type System, stationOf, stationPose } from "./sim";
import { STATION_GEOMETRY, type StationType } from "./station";
import {
	berthFits,
	chooseBerthFrom,
	trafficBerths,
	type StationInterior,
	stationInterior,
} from "./station-interior";
import type { Station } from "./system";
import { add, length, scale, sub, type Vec3 } from "./vec3";

export const TRAFFIC_HULL_POOLS: Readonly<
	Record<StationType, readonly HullId[]>
> = {
	trade: ["courier", "freighter", "miner", "explorer", "tug", "prospector"],
	shipyard: ["interceptor", "patrol", "courier", "tug"],
	refinery: ["miner", "prospector", "freighter", "tug"],
	outpost: ["courier", "prospector", "tug", "interceptor"],
};

export const TRAFFIC_ROLE: Readonly<
	Record<
		StationType,
		{
			intervalS: readonly [number, number];
			parkedDuty: readonly [number, number];
			signature: HullId;
			code: string;
		}
	>
> = {
	trade: {
		intervalS: [20, 40],
		parkedDuty: [0.55, 0.75],
		signature: "freighter",
		code: "TR",
	},
	shipyard: {
		intervalS: [30, 60],
		parkedDuty: [0.65, 0.85],
		signature: "patrol",
		code: "SY",
	},
	refinery: {
		intervalS: [45, 90],
		parkedDuty: [0.6, 0.8],
		signature: "miner",
		code: "RF",
	},
	outpost: {
		intervalS: [60, 120],
		parkedDuty: [0.25, 0.55],
		signature: "courier",
		code: "OP",
	},
};

/* The registry half of a Traffic actor's identity is `carrier-name.ts`'s (§1:
 * one module owns both naming halves for every carrier). The role code is
 * passed in there because it is this module's fact — `TRAFFIC_ROLE` — not a
 * naming one. */

const unit = (text: string): number => fnv1a(text) / 0x1_0000_0000;
const lerp = (band: readonly [number, number], u: number): number =>
	band[0] + (band[1] - band[0]) * u;

/** Slow station-zone legs need enough room to finish before the next visit. */
export const TRAFFIC_MIN_CYCLE_S = 900;
/** A completed arrival remains visibly parked before another launch can begin. */
export const TRAFFIC_MIN_DOCKED_S = 30;

export interface TrafficSchedule {
	cycleS: number;
	departureAtS: number;
	parkedDuty: number;
	awayS: number;
}

export interface TrafficActor {
	key: CarrierKey;
	homeStationId: string;
	localCarrierId: string;
	ordinal: number;
	hullId: HullId;
	variant: (typeof HULL_SPECS)[HullId]["variant"];
	callsign: string;
	schedule: TrafficSchedule;
}

/** One home-owned actor per berth Traffic may call home — the catalogue minus
 *  the visitor berth §277 reserves. */
export function stationTrafficRoster(
	systemIndex: number,
	station: Station,
): TrafficActor[] {
	const interior = stationInterior(
		station.type,
		STATION_GEOMETRY[station.type].aperturePlaneKm,
		station.berthSeed,
	);
	// #277: the catalogue minus the visitor berth. Sized from the same rule the
	// home-berth map reads, so the two cannot disagree about who owns what.
	const count = trafficBerths(interior).length;
	const role = TRAFFIC_ROLE[station.type];
	const cadence = lerp(
		role.intervalS,
		unit(`${station.id}|cadence|${station.berthSeed}`),
	);
	const cycleS = Math.max(2 * count * cadence, TRAFFIC_MIN_CYCLE_S);
	const sharedPhase = unit(`${station.id}|phase|${station.berthSeed}`) * cycleS;
	const compatible = TRAFFIC_HULL_POOLS[station.type].filter((id) =>
		interior.berths.some((berth) => berthFits(berth, HULL_SPECS[id].env)),
	);
	if (!compatible.includes(role.signature))
		throw new Error(
			`Traffic signature ${role.signature} fits no ${station.type} berth`,
		);

	return Array.from({ length: count }, (_, ordinal) => {
		const localCarrierId = `${station.localCarrierId}/traffic-${String(ordinal).padStart(2, "0")}`;
		const hullId =
			ordinal === 0
				? role.signature
				: compatible[
						Math.floor(
							unit(`${localCarrierId}|hull|${station.berthSeed}`) *
								compatible.length,
						)
					];
		const parkedDuty = lerp(
			role.parkedDuty,
			unit(`${localCarrierId}|duty|${station.berthSeed}`),
		);
		return {
			key: carrierKey(systemIndex, localCarrierId),
			homeStationId: station.id,
			localCarrierId,
			ordinal,
			hullId,
			variant: HULL_SPECS[hullId].variant,
			callsign: trafficRegistry(hullId, role.code, ordinal),
			schedule: {
				cycleS,
				departureAtS: (sharedPhase + ordinal * 2 * cadence) % cycleS,
				parkedDuty,
				awayS: cycleS * (1 - parkedDuty),
			},
		};
	});
}

export interface TrafficScheduleState {
	desired: "parked" | "away";
	boundaryS: number;
	awayOrdinal: number;
}

/** Locate the current base interval arithmetically; epoch age is irrelevant. */
/**
 * What a carrier's voyage ordinal answers **before its first departure**: no
 * voyage has been flown yet, so there is no count to give. Traffic produces this
 * value; `world-state.ts`'s scan reader is the one place below zero that a saved
 * record admits, and it reads this constant rather than agreeing with Traffic on
 * a literal by hand (sage #384 round 1). `carrierManifest` is already asked with
 * it for a carrier that has not left its station, and answers with the hold it
 * would fly.
 */
export const NO_FLOWN_VOYAGE = -1;

export function trafficScheduleAt(
	actor: TrafficActor,
	gameTime: number,
): TrafficScheduleState {
	const { cycleS, departureAtS, awayS } = actor.schedule;
	const cycle = Math.floor((gameTime - departureAtS) / cycleS);
	const departure = departureAtS + cycle * cycleS;
	const elapsed = gameTime - departure;
	if (elapsed >= 0 && elapsed < awayS)
		return { desired: "away", boundaryS: departure, awayOrdinal: cycle };
	const arrival = departure + awayS;
	return {
		desired: "parked",
		boundaryS: elapsed < 0 ? arrival - cycleS : arrival,
		// `cycle` is never negative, so `cycle - 1` bottoms out at exactly
		// `NO_FLOWN_VOYAGE` on the first cycle before the first departure.
		awayOrdinal: elapsed < 0 ? cycle - 1 : cycle,
	};
}

/**
 * The first departure **at or after** `atLeastS`.
 *
 * `trafficScheduleAt` answers where the cycle is now; a carrier that has to wait
 * for a departure needs the next term forward, and nothing here asks for one
 * yet — every other consumer takes the current term or the one behind it. The
 * terms are an arithmetic progression, so this is closed form and materializes
 * no list.
 *
 * **The tolerance is a clock's, not a fudge.** `departureAtS + n·cycleS` fed
 * back through this same division is `n` to within a float's memory of the
 * multiply, and a bare `ceil` would turn that into the *following* departure —
 * so asking when the next departure after a departure is would move the answer
 * by a whole cycle. 10 Hz is the finest anything reads a schedule at (the
 * authority tick), and a term within a billionth of a cycle of the clock asked
 * is that term.
 */
export function nextTrafficDepartureAtS(
	schedule: TrafficSchedule,
	atLeastS: number,
): number {
	const { cycleS, departureAtS } = schedule;
	const cycles = Math.ceil((atLeastS - departureAtS) / cycleS - 1e-9);
	return departureAtS + cycles * cycleS;
}

/** Identity used only while ordering a station turn; it is never persisted. */
export type StationParticipant =
	| { kind: "carrier"; key: CarrierKey }
	| { kind: "player" };

export interface ClearanceQueueRequest {
	participant: StationParticipant;
	readyAt: number;
	hull: HullEnvelope;
}

export interface ClearancePromotion {
	participant: StationParticipant;
	berthId: string;
}

/** Oldest-compatible-first; the shared best-fit allocator still picks the berth. */
export function clearancePromotion(
	requests: readonly ClearanceQueueRequest[],
	interior: StationInterior,
	occupied: ReadonlySet<string>,
	gameTime: number,
): ClearancePromotion | null {
	for (const request of [...requests].sort(
		(a, b) =>
			a.readyAt - b.readyAt ||
			compareStationParticipants(a.participant, b.participant),
	)) {
		// Traffic's own allocator, so it may not reach the visitor berth (#277) —
		// a visiting carrier that took it would re-close the station to the
		// player for as long as it stayed. The player's promotion goes through
		// `chooseBerth` in `docking.ts` and sees the whole catalogue.
		const berth = chooseBerthFrom(
			trafficBerths(interior),
			request.hull,
			occupied,
			gameTime,
		);
		if (berth) return { participant: request.participant, berthId: berth.id };
	}
	return null;
}

export interface LaneRequest {
	participant: StationParticipant;
	readyAt: number;
	kind: "arrival" | "launch";
}

export interface StationTurn {
	participant: StationParticipant;
	readyAt: number;
	kind: "launch" | "arrival" | "clearance";
}

const compareStationParticipants = (
	a: StationParticipant,
	b: StationParticipant,
): number => {
	if (a.kind === "player") return b.kind === "player" ? 0 : -1;
	if (b.kind === "player") return 1;
	return compareCarrierKeys(a.key, b.key);
};

/** Total order used before committing non-preemptive station work. */
export const compareStationTurns = (a: StationTurn, b: StationTurn): number =>
	a.readyAt - b.readyAt ||
	(a.kind === b.kind
		? 0
		: a.kind === "launch"
			? -1
			: b.kind === "launch"
				? 1
				: a.kind === "arrival"
					? -1
					: 1) ||
	compareStationParticipants(a.participant, b.participant);

export function laneWinner(
	requests: readonly LaneRequest[],
): LaneRequest | null {
	return [...requests].sort(compareStationTurns)[0] ?? null;
}

/** Apply the same total order without inventing a persisted CarrierKey for the player. */
export function playerWinsLane(
	requests: readonly LaneRequest[],
	readyAt: number,
	kind: LaneRequest["kind"],
): boolean {
	const turns: StationTurn[] = [
		...requests,
		{ participant: { kind: "player" }, readyAt, kind },
	];
	return [...turns].sort(compareStationTurns)[0]?.participant.kind === "player";
}

/** Why Traffic will not give the player the lane yet (#314). */
export type LaneRefusal =
	| "traffic-starting"
	| "carrier-in-lane"
	| "carrier-queued-ahead";

/**
 * What the player's lane arbitration reads of a route. `phase` is the route's
 * own union, through a type-only import: `station-route.ts` imports this
 * module, and a type import is erased before it could close that cycle.
 */
export interface LaneRouteView {
	key: CarrierKey;
	terminalStationId: string | null;
	phase: TrafficRoutePhase;
	laneRequest?: Pick<LaneRequest, "readyAt" | "kind"> | null;
	/** When the route gives the lane back (#521); `station-route.ts` owns it. */
	laneEndsAtS?: number;
}

/**
 * The player's turn at a station's lane, as a reason rather than a yes/no.
 *
 * `null` is the lane. The order is `laneBlockers`'s, below.
 */
export function playerLaneRefusal(input: {
	authorityReady: boolean;
	routes: readonly LaneRouteView[];
	stationId: string;
	readyAt: number;
	movement: LaneRequest["kind"];
}): LaneRefusal | null {
	return laneBlockers(input).refusal;
}

/**
 * Why the lane is not the player's yet, and how long until it is (#521).
 *
 * `null` is the lane. `waitS` is the time until the **last** route the
 * player waits behind gives the lane back — the one in it, and every older
 * request `playerLaneRefusal`'s order puts ahead — read off each route's own
 * `laneEndsAtS`, which the composition that flies it predicts. It is `null`,
 * never a guess, while Traffic is warming (it cannot see the lane) or when any
 * blocker carries no predicted end. A collision can still interrupt a route
 * (#75), so the figure is an estimate and is worded as one.
 */
export function playerLaneWait(input: {
	authorityReady: boolean;
	routes: readonly LaneRouteView[];
	stationId: string;
	readyAt: number;
	movement: LaneRequest["kind"];
	gameTime: number;
}): { refusal: LaneRefusal; waitS: number | null } | null {
	const { refusal, blockers } = laneBlockers(input);
	if (refusal === null) return null;
	if (refusal === "traffic-starting") return { refusal, waitS: null };
	let releaseAtS = input.gameTime;
	for (const route of blockers) {
		if (route.laneEndsAtS === undefined) return { refusal, waitS: null };
		releaseAtS = Math.max(releaseAtS, route.laneEndsAtS);
	}
	return { refusal, waitS: releaseAtS - input.gameTime };
}

/**
 * The routes the player waits behind at one station's lane, and the reason
 * the first of them gives. The reason's order is the one `Game` used: a
 * Traffic authority still warming cannot see an actor already committed to
 * the lane, a carrier moving through it is non-preemptive, and otherwise the
 * oldest ready request wins by `playerWinsLane`'s total order. **A refused
 * request that keeps its `readyAt` keeps its place** in that order, which is
 * what a held launch is.
 */
function laneBlockers(input: {
	authorityReady: boolean;
	routes: readonly LaneRouteView[];
	stationId: string;
	readyAt: number;
	movement: LaneRequest["kind"];
}): { refusal: LaneRefusal | null; blockers: LaneRouteView[] } {
	if (!input.authorityReady)
		return { refusal: "traffic-starting", blockers: [] };
	const here = input.routes.filter(
		(route) => route.terminalStationId === input.stationId,
	);
	const inLane = here.filter(
		(route) => route.phase === "departing" || route.phase === "arriving",
	);
	const queued = here.filter(
		(route) =>
			route.laneRequest &&
			(route.phase === "launch-queued" || route.phase === "lane-queued"),
	);
	const player: StationTurn = {
		participant: { kind: "player" },
		readyAt: input.readyAt,
		kind: input.movement,
	};
	const ahead = queued.filter((route) => {
		const request = route.laneRequest as Pick<LaneRequest, "readyAt" | "kind">;
		return (
			compareStationTurns(
				{
					participant: { kind: "carrier", key: route.key },
					readyAt: request.readyAt,
					kind: request.kind,
				},
				player,
			) < 0
		);
	});
	const refusal =
		inLane.length > 0
			? "carrier-in-lane"
			: ahead.length > 0
				? "carrier-queued-ahead"
				: null;
	return { refusal, blockers: [...inLane, ...ahead] };
}

/** Station-owned local traversal laws used by route composition. */
export const TRAFFIC_STATION_EXCLUSION_KM = 5;
/** Prevent the first cruise correction from dipping back inside the boundary. */
export const TRAFFIC_STATION_RELEASE_MARGIN_KM = 0.5;
/** Local station flight shares the player's aperture crossing speed ceiling. */
export const TRAFFIC_STATION_LOCAL_SPEED_KM_S = V_GATE_KMS;

export const TRAFFIC_MATERIALIZE_KM = 10_000;
/** Once visible, retain a ship through this wider boundary to prevent popping. */
export const TRAFFIC_DEMATERIALIZE_KM = 12_000;

export interface TrafficProjection {
	key: CarrierKey;
	pos: Vec3;
	vel: Vec3;
	nose?: Vec3;
	up?: Vec3;
}

/** Stable off-axis hold in the translating station frame. */
export function trafficHoldProjection(
	system: System,
	stationId: string,
	key: CarrierKey,
	gameTime: number,
): TrafficProjection {
	const station = stationOf(system, stationId);
	const body = system.byId.get(stationId);
	if (!body) throw new Error(`station ${stationId} has no placed body`);
	const pose = stationPose(system, stationId, gameTime);
	const frame = apertureFrame(
		station.type,
		pose.axis,
		pose.phaseRad,
		pose.reference,
	);
	// Holds do not rotate with the aperture: phase-zero is the smooth along-track
	// reference and Carrier identity chooses a spoke around the aperture axis.
	const basis = slotBasis(frameAtPhase(frame, 0));
	const angle = unit(`${key}|hold`) * Math.PI * 2;
	const radialKm = 1.5 + unit(`${key}|hold-radius`) * 1.5;
	const rel = add(
		scale(frame.axis, 5),
		add(
			scale(basis.across, Math.cos(angle) * radialKm),
			scale(basis.up, Math.sin(angle) * radialKm),
		),
	);
	return {
		key,
		pos: add(body.pos, rel),
		vel: bodyVelocity(system, stationId, gameTime),
		nose: scale(frame.axis, -1),
		up: basis.up,
	};
}

/** Place an actor in one reserved berth using the same parked law as the player. */
export function parkedTrafficProjection(
	system: System,
	stationId: string,
	berthId: string,
	actor: Pick<TrafficActor, "key">,
	gameTime: number,
	knownInterior?: StationInterior,
): TrafficProjection {
	const station = stationOf(system, stationId);
	const body = system.byId.get(stationId);
	if (!body) throw new Error(`station ${stationId} has no placed body`);
	const interior =
		knownInterior ??
		stationInterior(
			station.type,
			STATION_GEOMETRY[station.type].aperturePlaneKm,
			station.berthSeed,
		);
	const berth = interior.berths.find((candidate) => candidate.id === berthId);
	if (!berth) throw new Error(`no berth ${berthId} at ${stationId}`);
	const pose = stationPose(system, stationId, gameTime);
	const frame = apertureFrame(
		station.type,
		pose.axis,
		pose.phaseRad,
		pose.reference,
	);
	const rel = recomposeOffset(frame, berthCentre(berth), pose.phaseRad);
	const attitude = parkedAttitude(
		{ frame, berthNormal: berth.normal, berthNose: berth.parkedNose },
		pose.phaseRad,
	);
	return {
		key: actor.key,
		pos: add(body.pos, rel),
		vel: bodyVelocity(system, stationId, gameTime),
		...attitude,
	};
}

export function materializeTrafficContact(
	actor: TrafficActor,
	projection: TrafficProjection | null,
	observer: Vec3,
	maxDistanceKm = TRAFFIC_MATERIALIZE_KM,
): DisplayContact | null {
	if (!projection || length(sub(projection.pos, observer)) > maxDistanceKm)
		return null;
	const env = HULL_SPECS[actor.hullId].env;
	return {
		id: actor.key,
		name: actor.callsign,
		kind: "ship",
		pos: { ...projection.pos },
		velocity: { ...projection.vel },
		radiusKm: Math.max(env.lengthKm, env.beamKm, env.heightKm) / 2,
		color: actor.hullId === "patrol" ? 0x80b8ff : 0xb8c4cc,
		shipType: actor.hullId,
		standing: null,
		scannerClass: actor.hullId === "patrol" ? "unknown" : "civilian",
	};
}
