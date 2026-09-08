/**
 * Deterministic station-owned Traffic: identity, home schedule, shared queue
 * ordering, and the presentation projection. No Three.js and no mutable RNG.
 */

import { berthCentre, parkedAttitude, recomposeOffset } from "./arrival";
import { type CarrierKey, carrierKey, compareCarrierKeys } from "./carrier-key";
import type { DisplayContact } from "./display-contact";
import { apertureFrame, frameAtPhase, slotBasis } from "./docking";
import { HULL_SPECS, type HullEnvelope, type HullId } from "./hull";
import { bodyVelocity, type System, stationOf, stationPose } from "./sim";
import { STATION_GEOMETRY, type StationType } from "./station";
import {
	berthFits,
	chooseBerth,
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

const SELECTED_MODEL_NAME: Readonly<Record<HullId, string>> = {
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
};

const fnv1a = (text: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
};

const unit = (text: string): number => fnv1a(text) / 0x1_0000_0000;
const lerp = (band: readonly [number, number], u: number): number =>
	band[0] + (band[1] - band[0]) * u;

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

/** One home-owned actor per generated berth. */
export function stationTrafficRoster(
	systemIndex: number,
	station: Station,
): TrafficActor[] {
	const interior = stationInterior(
		station.type,
		STATION_GEOMETRY[station.type].aperturePlaneKm,
		station.berthSeed,
	);
	const count = interior.berths.length;
	const role = TRAFFIC_ROLE[station.type];
	const cadence = lerp(
		role.intervalS,
		unit(`${station.id}|cadence|${station.berthSeed}`),
	);
	const cycleS = 2 * count * cadence;
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
			callsign: `${SELECTED_MODEL_NAME[hullId]} ${role.code}-${String(ordinal + 1).padStart(2, "0")}`,
			schedule: {
				cycleS,
				departureAtS: sharedPhase + ordinal * 2 * cadence,
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
		awayOrdinal: elapsed < 0 ? cycle - 1 : cycle,
	};
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
		const berth = chooseBerth(interior, request.hull, occupied, gameTime);
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

/** Station-owned local traversal laws used by route composition. */
export const TRAFFIC_SPOOL_S = 8;
export const TRAFFIC_TERMINAL_APPROACH_S = 14;

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
): TrafficProjection {
	const station = stationOf(system, stationId);
	const body = system.byId.get(stationId);
	if (!body) throw new Error(`station ${stationId} has no placed body`);
	const interior = stationInterior(
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
		legalStatus: null,
		scannerClass: actor.hullId === "patrol" ? "unknown" : "civilian",
	};
}
