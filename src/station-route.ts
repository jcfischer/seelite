/** Pure in-system Traffic route selection and canonical cruise replay. */

import {
	arrivalAttitude,
	arrivalProgress,
	arrivalRel,
	arrivalRelVelocity,
	beginArrival,
	beginLaunch,
} from "./arrival";
import type { CarrierKey } from "./carrier-key";
import {
	advanceCruise,
	CHARGE_PER_AU,
	type CruiseParams,
	chargeAfterRegen,
	chargeAfterTravel,
	DEFAULT_CRUISE,
	type Mass,
} from "./cruise";
import { cruiseRouteBlocker, planCruiseDetour } from "./cruise-detour";
import {
	beginCruiseGuidance,
	type CruiseGuidanceError,
	type CruiseGuidanceState,
	stepCruiseGuidance,
} from "./cruise-guidance";
import { apertureFrame } from "./docking";
import type { SystemRecord } from "./galaxy";
import type { HullEnvelope, HullId } from "./hull";
import { HULL_SPECS } from "./hull";
import {
	advanceSystem,
	bodyAccelerationBound,
	bodyVelocity,
	makeSystem,
	type System,
	stationOf,
	stationPose,
} from "./sim";
import { STATION_GEOMETRY } from "./station";
import { berthFits, stationInterior } from "./station-interior";
import {
	type ClearanceQueueRequest,
	clearancePromotion,
	type LaneRequest,
	laneWinner,
	parkedTrafficProjection,
	type StationParticipant,
	TRAFFIC_MIN_DOCKED_S,
	TRAFFIC_STATION_EXCLUSION_KM,
	TRAFFIC_STATION_LOCAL_SPEED_KM_S,
	TRAFFIC_STATION_RELEASE_MARGIN_KM,
	type TrafficActor,
	type TrafficProjection,
	trafficHoldProjection,
	trafficScheduleAt,
} from "./station-traffic";
import { AU_KM } from "./units";
import { add, length, scale, sub, type Vec3 } from "./vec3";

export const CANONICAL_ROUTE_DT_S = 0.1;

export interface RouteActorIdentity {
	key: CarrierKey;
	ordinal: number;
	hullId: HullId;
}

export interface RouteDestinationCandidate {
	id: string;
	fits: boolean;
	hold: Vec3;
	parentId?: string | null;
}

export interface SelectedTrafficDestination extends RouteDestinationCandidate {
	chain: readonly Vec3[];
	plannedKm: number;
}

const chainLength = (points: readonly Vec3[]): number => {
	let total = 0;
	for (let i = 1; i < points.length; i++)
		total += length(sub(points[i], points[i - 1]));
	return total;
};

export function selectTrafficDestination(input: {
	actor: RouteActorIdentity;
	homeStationId: string;
	from: Vec3;
	candidates: readonly RouteDestinationCandidate[];
	masses: readonly Mass[];
	capacityAu: number;
	awayOrdinal: number;
}): SelectedTrafficDestination | null {
	const eligible: SelectedTrafficDestination[] = [];
	for (const candidate of [...input.candidates].sort((a, b) =>
		a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
	)) {
		if (candidate.id === input.homeStationId || !candidate.fits) continue;
		const blocker = cruiseRouteBlocker(
			input.from,
			candidate.hold,
			input.masses,
			candidate.parentId ?? null,
		);
		let chain: Vec3[] = [input.from, candidate.hold];
		if (blocker) {
			const detour = planCruiseDetour({
				from: input.from,
				target: candidate.hold,
				blocker,
				masses: input.masses,
				targetParentId: candidate.parentId ?? null,
			});
			if (!detour) continue;
			chain = [input.from, ...detour.waypoints, candidate.hold];
		}
		const plannedKm = chainLength(chain);
		if ((plannedKm / AU_KM) * CHARGE_PER_AU > input.capacityAu + 1e-12)
			continue;
		eligible.push({ ...candidate, chain, plannedKm });
	}
	if (eligible.length === 0) return null;
	const index =
		(((input.actor.ordinal + input.awayOrdinal) % eligible.length) +
			eligible.length) %
		eligible.length;
	return eligible[index];
}

export type TrafficCruisePhase =
	| "cruise"
	| "local-approach"
	| "regenerating"
	| "blocked";

export interface TrafficCruiseState {
	phase: TrafficCruisePhase;
	pos: Vec3;
	vel: Vec3;
	nose: Vec3;
	chargeAu: number;
	startedAtS: number;
	atS: number;
	workTicks: number;
	initialPos?: Vec3;
	initialNose?: Vec3;
	initialChargeAu?: number;
	completedAtS?: number;
	guidance?: CruiseGuidanceState | null;
	initialGuidance?: CruiseGuidanceState | null;
	initialPhase?: "cruise" | "blocked";
	initialBlockedById?: string;
	blockedById?: string;
}

/** Bounded to 256 physical legs by deterministic oldest-entry eviction. */
export type TrafficCruiseCache = Map<string, TrafficCruiseState>;

export interface TrafficCruiseEnvironment {
	params?: CruiseParams;
	targetAt(gameTime: number): Mass;
	massesAt(gameTime: number): readonly Mass[];
	targetParentId: string | null;
	capacityAu?: number;
	guide?: (
		state: Readonly<TrafficCruiseState>,
		gameTime: number,
		dt: number,
		target: Mass,
		masses: readonly Mass[],
	) => {
		nose: Vec3;
		throttle: number;
		guidance?: CruiseGuidanceState | null;
		error?: CruiseGuidanceError | null;
	};
}

const normal = (v: Vec3, fallback: Vec3): Vec3 => {
	const n = length(v);
	return n > 0 ? scale(v, 1 / n) : fallback;
};

const reachableChargeAu = (
	from: Vec3,
	target: Mass,
	masses: readonly Mass[],
	targetParentId: string | null,
): number => {
	const blocker = cruiseRouteBlocker(from, target.pos, masses, targetParentId);
	if (!blocker) return (length(sub(target.pos, from)) / AU_KM) * CHARGE_PER_AU;
	const detour = planCruiseDetour({
		from,
		target: target.pos,
		blocker,
		masses,
		targetParentId,
	});
	if (!detour) return Number.POSITIVE_INFINITY;
	return (
		(chainLength([from, ...detour.waypoints, target.pos]) / AU_KM) *
		CHARGE_PER_AU
	);
};

const advanceTrafficCruiseStep = (
	state: TrafficCruiseState,
	dt: number,
	environment: TrafficCruiseEnvironment,
): TrafficCruiseState => {
	if (state.phase === "regenerating") {
		const atS = state.atS + dt;
		const chargeAu = chargeAfterRegen(
			state.chargeAu,
			dt,
			environment.capacityAu,
		);
		const target = environment.targetAt(atS);
		const required = reachableChargeAu(
			state.pos,
			target,
			environment.massesAt(atS),
			environment.targetParentId,
		);
		return {
			...state,
			phase: chargeAu + 1e-12 >= required ? "cruise" : "regenerating",
			chargeAu,
			atS,
			workTicks: state.workTicks + 1,
		};
	}
	const target = environment.targetAt(state.atS);
	const masses = environment.massesAt(state.atS);
	const guidance = environment.guide?.(
		state,
		state.atS,
		dt,
		target,
		masses,
	) ?? {
		nose: normal(sub(target.pos, state.pos), state.nose),
		throttle: 1,
	};
	if (guidance.error) {
		const blocker = masses.find(
			(candidate) => candidate.id === guidance.error?.blockerId,
		);
		return {
			...state,
			phase: "blocked",
			vel: blocker?.vel ? { ...blocker.vel } : { x: 0, y: 0, z: 0 },
			guidance: null,
			blockedById: guidance.error.blockerId,
			atS: state.atS + dt,
			workTicks: state.workTicks + 1,
		};
	}
	const step = advanceCruise({
		pos: state.pos,
		nose: guidance.nose,
		throttle: guidance.throttle,
		dt,
		masses,
		target,
		params: environment.params ?? DEFAULT_CRUISE,
		chargeAu: state.chargeAu,
		targetParentId: environment.targetParentId,
	});
	const completedAtS = state.atS + dt;
	const stoppedBy = masses.find((mass) => mass.id === step.exitBodyId);
	return {
		...state,
		phase:
			step.exit === "arrival"
				? "local-approach"
				: step.exit === "proximity"
					? "blocked"
					: step.starved
						? "regenerating"
						: "cruise",
		pos: step.pos,
		vel:
			step.exit === "proximity"
				? stoppedBy?.vel
					? { ...stoppedBy.vel }
					: { x: 0, y: 0, z: 0 }
				: scale(guidance.nose, step.speedKms),
		nose: guidance.nose,
		guidance:
			step.exit === "proximity"
				? null
				: guidance.guidance === undefined
					? state.guidance
					: guidance.guidance,
		chargeAu: chargeAfterTravel(state.chargeAu, step.travelledKm),
		atS: completedAtS,
		workTicks: state.workTicks + 1,
		blockedById: step.exit === "proximity" ? step.exitBodyId : undefined,
		...(step.exit === "arrival" ? { completedAtS } : {}),
	};
};

/**
 * Re-evaluate from the physical leg boundary on canonical 0.1 s ticks. A state
 * on a canonical boundary resumes incrementally; fractional/non-monotonic
 * queries replay from the boundary so render cadence never changes the result.
 */
export function evaluateTrafficCruise(
	state: TrafficCruiseState,
	queryTimeS: number,
	environment: TrafficCruiseEnvironment,
): TrafficCruiseState {
	const initialPos = state.initialPos ?? state.pos;
	const initialNose = state.initialNose ?? state.nose;
	const initialChargeAu = state.initialChargeAu ?? state.chargeAu;
	const initialGuidance =
		state.initialGuidance === undefined
			? (state.guidance ?? null)
			: state.initialGuidance;
	const initialPhase =
		state.initialPhase ??
		(state.atS === state.startedAtS && state.phase === "blocked"
			? "blocked"
			: "cruise");
	const initialBlockedById =
		state.initialBlockedById ??
		(initialPhase === "blocked" ? state.blockedById : undefined);
	const elapsed = Math.max(0, queryTimeS - state.startedAtS);
	const fullTicks = Math.floor((elapsed + 1e-10) / CANONICAL_ROUTE_DT_S);
	const fullDuration = fullTicks * CANONICAL_ROUTE_DT_S;
	const fractional = Math.max(0, elapsed - fullDuration);
	const stateTick = Math.round(
		(state.atS - state.startedAtS) / CANONICAL_ROUTE_DT_S,
	);
	const stateIsCanonical =
		state.atS >= state.startedAtS &&
		Math.abs(
			state.atS - (state.startedAtS + stateTick * CANONICAL_ROUTE_DT_S),
		) < 1e-8;
	const resume =
		stateIsCanonical && state.atS > state.startedAtS && state.atS <= queryTimeS;
	let current: TrafficCruiseState = resume
		? {
				...state,
				pos: { ...state.pos },
				vel: { ...state.vel },
				nose: { ...state.nose },
			}
		: {
				phase: initialPhase,
				pos: { ...initialPos },
				vel: { x: 0, y: 0, z: 0 },
				nose: { ...initialNose },
				chargeAu: initialChargeAu,
				startedAtS: state.startedAtS,
				atS: state.startedAtS,
				workTicks: 0,
				initialPos: { ...initialPos },
				initialNose: { ...initialNose },
				initialChargeAu,
				guidance: initialGuidance,
				initialGuidance,
				initialPhase,
				initialBlockedById,
				blockedById: initialBlockedById,
			};
	for (let tick = resume ? stateTick : 0; tick < fullTicks; tick++) {
		if (current.phase === "local-approach") break;
		current = advanceTrafficCruiseStep(
			current,
			CANONICAL_ROUTE_DT_S,
			environment,
		);
	}
	if (fractional > 1e-9 && current.phase !== "local-approach")
		current = advanceTrafficCruiseStep(current, fractional, environment);
	return { ...current, atS: queryTimeS };
}

export type TrafficRoutePhase =
	| "parked-home"
	| "launch-queued"
	| "departing"
	| "local-departure"
	| "cruise"
	| "regenerating"
	| "local-approach"
	| "clearance-queued"
	| "lane-queued"
	| "arriving"
	| "docked-away"
	| "abstract-away";

export interface TrafficArbitrationEvent {
	stationId: string;
	kind: "clearance" | "lane";
	fromS: number;
	toS: number;
	participant: StationParticipant;
	movement?: "arrival" | "launch";
	/** A movement already in the shared lane is non-preemptive. */
	committed?: boolean;
	/** Required for a shared Clearance queue contender. */
	hull?: HullEnvelope;
}

/** Session cache for berth decisions already made by one physical visit. */
export type TrafficBerthCache = Map<string, string>;

export interface SystemTrafficProjection extends TrafficProjection {
	phase: TrafficRoutePhase;
	destinationStationId: string | null;
	chargeAu: number;
	pendingIntent: { desired: "parked" | "away"; readyAt: number } | null;
	queueRequest: ClearanceQueueRequest | null;
	laneRequest: LaneRequest | null;
	/** Actual start of an active non-preemptive lane traversal. */
	laneStartedAtS: number | null;
	originBerthOccupied: boolean;
	workTicks: number;
	berthId: string | null;
	terminalStationId: string | null;
	/** Physical completion boundary for a stationary terminal phase. */
	completedAtS?: number;
	/** Identity of the physical visit retained across later schedule boundaries. */
	visitDepartureAtS?: number;
	visitLaunchReadyAtS?: number;
	visitAwayOrdinal?: number;
	visitHomeBerthId?: string;
	visitOutboundDepartureAtS?: number;
	visitOutboundArrivalAtS?: number;
	visitReturnDepartureAtS?: number;
	visitReturnArrivalAtS?: number;
	/** Committed lane starts retained after their traversal phase has ended. */
	departureStartedAtS?: number;
	arrivalStartedAtS?: number;
	/** A cache-warm call stopped at its fixed canonical tick budget. */
	warmIncomplete: boolean;
}

const systemAt = (record: SystemRecord, gameTime: number) =>
	makeSystem(record, gameTime);

const frameInSystem = (system: System, stationId: string, gameTime: number) => {
	const station = stationOf(system, stationId);
	const pose = stationPose(system, stationId, gameTime);
	return {
		system,
		station,
		pose,
		frame: apertureFrame(
			station.type,
			pose.axis,
			pose.phaseRad,
			pose.reference,
		),
	};
};

const frameAt = (record: SystemRecord, stationId: string, gameTime: number) =>
	frameInSystem(systemAt(record, gameTime), stationId, gameTime);

const massesAt = (record: SystemRecord, gameTime: number): Mass[] => {
	const system = systemAt(record, gameTime);
	return massesFromSystem(system, gameTime);
};

const massesFromSystem = (
	system: ReturnType<typeof makeSystem>,
	gameTime: number,
): Mass[] => {
	return system.bodies
		.filter((body) => body.kind === "star" || body.kind === "planet")
		.map((body) => ({
			id: body.id,
			pos: { ...body.pos },
			radiusKm: body.radiusKm,
			vel: bodyVelocity(system, body.id, gameTime),
			accelerationBoundKms2: bodyAccelerationBound(system, body.id),
		}));
};

const placedBody = (system: ReturnType<typeof makeSystem>, id: string) => {
	const body = system.byId.get(id);
	if (!body) throw new Error(`station ${id} has no placed body`);
	return body;
};

const withRoute = (
	actor: TrafficActor,
	phase: TrafficRoutePhase,
	projection: TrafficProjection,
	extra: Partial<SystemTrafficProjection> = {},
): SystemTrafficProjection => ({
	key: actor.key,
	phase,
	pos: projection.pos,
	vel: projection.vel,
	...(projection.nose ? { nose: projection.nose } : {}),
	...(projection.up ? { up: projection.up } : {}),
	destinationStationId: null,
	chargeAu: HULL_SPECS[actor.hullId].chargeAu,
	pendingIntent: null,
	queueRequest: null,
	laneRequest: null,
	laneStartedAtS: null,
	originBerthOccupied: phase === "parked-home" || phase === "departing",
	workTicks: 0,
	berthId: null,
	terminalStationId: null,
	warmIncomplete: false,
	...extra,
});

/**
 * A truthful presentation while canonical route replay is still warming.
 *
 * The caller selects home-owned actors from the base schedule without replaying
 * a cruise leg. Showing exactly those actors gives the player visible occupancy
 * immediately; actors whose current intent is away leave their home berth free.
 * The authoritative projector later reuses the same CarrierKey, so presentation
 * identity survives the hand-off.
 */
export function projectParkedTrafficActor(input: {
	actor: TrafficActor;
	gameTime: number;
	projectionSystem: System;
}): SystemTrafficProjection {
	const home = frameInSystem(
		input.projectionSystem,
		input.actor.homeStationId,
		input.gameTime,
	);
	const interior = stationInterior(
		home.station.type,
		STATION_GEOMETRY[home.station.type].aperturePlaneKm,
		home.station.berthSeed,
	);
	const berth = interior.berths[input.actor.ordinal % interior.berths.length];
	if (!berth) throw new Error(`no cold berth at ${input.actor.homeStationId}`);
	return withRoute(
		input.actor,
		"parked-home",
		parkedTrafficProjection(
			home.system,
			input.actor.homeStationId,
			berth.id,
			input.actor,
			input.gameTime,
		),
		{
			berthId: berth.id,
			terminalStationId: input.actor.homeStationId,
		},
	);
}

const interpolate = (a: Vec3, b: Vec3, u: number): Vec3 => ({
	x: a.x + (b.x - a.x) * u,
	y: a.y + (b.y - a.y) * u,
	z: a.z + (b.z - a.z) * u,
});
const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

const blockedUntil = (
	timeline: readonly TrafficArbitrationEvent[],
	stationId: string,
	kind: TrafficArbitrationEvent["kind"],
	readyAt: number,
	request?: { key: CarrierKey; movement: "arrival" | "launch" },
): number => {
	let end = readyAt;
	for (const event of [...timeline].sort(
		(a, b) => a.fromS - b.fromS || a.toS - b.toS,
	))
		if (
			event.stationId === stationId &&
			event.kind === kind &&
			event.fromS <= end &&
			event.toS > end
		) {
			if (
				kind === "lane" &&
				request &&
				event.participant.kind === "carrier" &&
				event.participant.key === request.key
			)
				continue;
			if (kind === "lane" && request && event.movement && !event.committed) {
				const winner = laneWinner([
					{
						participant: { kind: "carrier", key: request.key },
						readyAt: end,
						kind: request.movement,
					},
					{
						participant: event.participant,
						readyAt: event.fromS,
						kind: event.movement,
					},
				]);
				if (
					winner?.participant.kind === "carrier" &&
					winner.participant.key === request.key
				)
					continue;
			}
			end = Math.max(end, event.toS);
		}
	return end;
};

interface TrafficLegInput {
	record: SystemRecord;
	actor: TrafficActor;
	gameTime: number;
	timeline: readonly TrafficArbitrationEvent[];
	occupiedByStation?: ReadonlyMap<string, ReadonlySet<string>>;
	cruiseCache?: TrafficCruiseCache;
	berthCache?: TrafficBerthCache;
	berthCacheTouched?: Set<string>;
	recordBerthAssignments?: boolean;
	projectionSystem?: System;
	originStationId: string;
	originBerthId: string;
	destinationStationId: string | null;
	readyAtS: number;
	awayOrdinal: number;
	finalPhase: "docked-away" | "parked-home";
	pendingIntent: SystemTrafficProjection["pendingIntent"];
	committedDepartureAtS?: number;
	committedArrivalAtS?: number;
	/** Shared across every leg one actor projection may visit. */
	cruiseBudget?: { remainingTicks: number };
}

/** Project one non-preemptive station-to-station physical leg. */
function projectTrafficLeg(input: TrafficLegInput): SystemTrafficProjection {
	const {
		record,
		actor,
		gameTime,
		timeline,
		originStationId,
		originBerthId,
		readyAtS,
		awayOrdinal,
		finalPhase,
		pendingIntent,
	} = input;
	const originNow = input.projectionSystem
		? frameInSystem(input.projectionSystem, originStationId, gameTime)
		: frameAt(record, originStationId, gameTime);
	const originInterior = stationInterior(
		originNow.station.type,
		STATION_GEOMETRY[originNow.station.type].aperturePlaneKm,
		originNow.station.berthSeed,
	);
	const originBerth = originInterior.berths.find(
		(candidate) => candidate.id === originBerthId,
	);
	if (!originBerth)
		throw new Error(`no berth ${originBerthId} at ${originStationId}`);
	const departureAtS =
		input.committedDepartureAtS ??
		blockedUntil(timeline, originStationId, "lane", readyAtS, {
			key: actor.key,
			movement: "launch",
		});
	const departureCommit = { departureStartedAtS: departureAtS };
	if (gameTime < departureAtS)
		return withRoute(
			actor,
			"launch-queued",
			parkedTrafficProjection(
				originNow.system,
				originStationId,
				originBerth.id,
				actor,
				gameTime,
			),
			{
				berthId: originBerth.id,
				terminalStationId: originStationId,
				laneStartedAtS: departureAtS,
				laneRequest: {
					participant: { kind: "carrier", key: actor.key },
					readyAt: readyAtS,
					kind: "launch",
				},
				pendingIntent,
				originBerthOccupied: originStationId === actor.homeStationId,
			},
		);

	const homeStart = frameAt(record, originStationId, departureAtS);
	const launch = beginLaunch(
		homeStart.frame,
		originInterior,
		originBerth,
		departureAtS,
	);
	const launchEndS = departureAtS + launch.durationS;
	if (gameTime < launchEndS) {
		const u = arrivalProgress(launch, gameTime);
		const current = frameAt(record, originStationId, gameTime);
		const body = placedBody(current.system, originStationId);
		const rel = arrivalRel(launch, u, current.pose.phaseRad);
		const spin = STATION_GEOMETRY[current.station.type].spins
			? (2 * Math.PI * current.station.spinRpm) / 60
			: 0;
		return withRoute(
			actor,
			"departing",
			{
				key: actor.key,
				pos: {
					x: body.pos.x + rel.x,
					y: body.pos.y + rel.y,
					z: body.pos.z + rel.z,
				},
				vel: add(
					bodyVelocity(current.system, originStationId, gameTime),
					arrivalRelVelocity(launch, u, current.pose.phaseRad, spin),
				),
				...arrivalAttitude(launch, u, current.pose.phaseRad),
			},
			{
				...departureCommit,
				berthId: originBerth.id,
				terminalStationId: originStationId,
				laneStartedAtS: departureAtS,
				laneRequest: {
					participant: { kind: "carrier", key: actor.key },
					readyAt: readyAtS,
					kind: "launch",
				},
				pendingIntent,
				originBerthOccupied: originStationId === actor.homeStationId,
			},
		);
	}

	const crossingFrame = frameAt(record, originStationId, launchEndS);
	const crossingBody = placedBody(crossingFrame.system, originStationId);
	const crossingRel = arrivalRel(launch, 1, crossingFrame.pose.phaseRad);
	const crossingPos = add(crossingBody.pos, crossingRel);
	const contents = crossingFrame.system.contents;
	const candidates = contents.stations.map((station) => {
		const interior = stationInterior(
			station.type,
			STATION_GEOMETRY[station.type].aperturePlaneKm,
			station.berthSeed,
		);
		return {
			id: station.id,
			fits: interior.berths.some((berth) =>
				berthFits(berth, HULL_SPECS[actor.hullId].env),
			),
			hold: trafficHoldProjection(
				crossingFrame.system,
				station.id,
				actor.key,
				launchEndS,
			).pos,
			parentId: station.parentId,
		};
	});
	const selectable = input.destinationStationId
		? candidates.filter(
				(candidate) => candidate.id === input.destinationStationId,
			)
		: candidates;
	const selected = selectTrafficDestination({
		actor,
		homeStationId: input.destinationStationId
			? originStationId
			: actor.homeStationId,
		from: crossingPos,
		candidates: selectable,
		masses: massesAt(record, launchEndS),
		capacityAu: HULL_SPECS[actor.hullId].chargeAu,
		awayOrdinal,
	});
	if (!selected)
		return withRoute(
			actor,
			"abstract-away",
			{
				key: actor.key,
				pos: crossingPos,
				vel: bodyVelocity(crossingFrame.system, originStationId, launchEndS),
			},
			{ ...departureCommit, originBerthOccupied: false, pendingIntent },
		);

	const releaseDirection = normal(crossingRel, crossingFrame.pose.axis);
	const releaseRangeKm = length(crossingRel);
	const localDepartureKm = Math.max(
		0,
		TRAFFIC_STATION_EXCLUSION_KM +
			TRAFFIC_STATION_RELEASE_MARGIN_KM -
			releaseRangeKm,
	);
	// A smoothstep peaks at 1.5 times its average speed. Price the duration on
	// that peak so the whole visible station-zone leg stays under the same speed
	// ceiling as a player crossing the aperture.
	const localDepartureS = Math.max(
		CANONICAL_ROUTE_DT_S,
		(1.5 * localDepartureKm) / TRAFFIC_STATION_LOCAL_SPEED_KM_S,
	);
	const spoolEndS = launchEndS + localDepartureS;
	let movingSystem = systemAt(record, spoolEndS);
	let movingAtS = spoolEndS;
	const movingSystemAt = (t: number) => {
		if (t + 1e-9 < movingAtS) {
			movingSystem = systemAt(record, t);
			movingAtS = t;
		} else if (t !== movingAtS) {
			advanceSystem(movingSystem, t);
			movingAtS = t;
		}
		return movingSystem;
	};
	const holdAt = (t: number) =>
		trafficHoldProjection(movingSystemAt(t), selected.id, actor.key, t);
	const cruiseMassesAt = (t: number) => massesFromSystem(movingSystemAt(t), t);
	const departureRelAt = (elapsedS: number) => {
		const u = smooth(clamp01(elapsedS / localDepartureS));
		const rangeKm = releaseRangeKm + localDepartureKm * u;
		return scale(releaseDirection, rangeKm);
	};
	const departureRelVelocityAt = (elapsedS: number) => {
		const u = clamp01(elapsedS / localDepartureS);
		return scale(
			releaseDirection,
			(localDepartureKm * 6 * u * (1 - u)) / localDepartureS,
		);
	};
	if (gameTime < spoolEndS) {
		const dt = gameTime - launchEndS;
		const current = frameAt(record, originStationId, gameTime);
		const body = placedBody(current.system, originStationId);
		// Stay in the translating station frame until physically clear. Using the
		// launch-end world position as a fixed origin made an orbiting station move
		// tens of kilometres away from its own departing ship before cruise began.
		return withRoute(
			actor,
			"local-departure",
			{
				key: actor.key,
				pos: add(body.pos, departureRelAt(dt)),
				vel: add(
					bodyVelocity(current.system, originStationId, gameTime),
					departureRelVelocityAt(dt),
				),
				nose: releaseDirection,
			},
			{
				...departureCommit,
				destinationStationId: selected.id,
				originBerthOccupied: false,
				pendingIntent,
			},
		);
	}

	const cruiseStartFrame = frameAt(record, originStationId, spoolEndS);
	const cruiseStartBody = placedBody(cruiseStartFrame.system, originStationId);
	const cruiseStartPos = add(
		cruiseStartBody.pos,
		departureRelAt(localDepartureS),
	);
	const initialGuidance = beginCruiseGuidance({
		from: cruiseStartPos,
		target: { id: selected.id, pos: selected.hold },
		masses: cruiseMassesAt(spoolEndS),
		targetParentId: selected.parentId ?? null,
	});
	const cruiseInitial: TrafficCruiseState = {
		phase: initialGuidance.error ? "blocked" : "cruise",
		pos: cruiseStartPos,
		vel: add(
			bodyVelocity(cruiseStartFrame.system, originStationId, spoolEndS),
			departureRelVelocityAt(localDepartureS),
		),
		nose: releaseDirection,
		chargeAu: HULL_SPECS[actor.hullId].chargeAu,
		startedAtS: spoolEndS,
		atS: spoolEndS,
		workTicks: 0,
		guidance: initialGuidance.guidance,
		initialPhase: initialGuidance.error ? "blocked" : "cruise",
		initialBlockedById: initialGuidance.error?.blockerId,
		blockedById: initialGuidance.error?.blockerId,
	};
	const cruiseEnvironment: TrafficCruiseEnvironment = {
		params: DEFAULT_CRUISE,
		targetAt: (t) => {
			const hold = holdAt(t);
			return { id: selected.id, pos: hold.pos, vel: hold.vel, radiusKm: 0 };
		},
		massesAt: cruiseMassesAt,
		targetParentId: selected.parentId ?? null,
		capacityAu: HULL_SPECS[actor.hullId].chargeAu,
		guide: (state, _t, dt, target, masses) => {
			const restarted =
				state.phase === "blocked"
					? beginCruiseGuidance({
							from: state.pos,
							target: { id: target.id, pos: target.pos },
							masses,
							targetParentId: selected.parentId ?? null,
						})
					: { guidance: state.guidance ?? null, error: null };
			if (restarted.error)
				return {
					nose: state.nose,
					throttle: 0,
					guidance: null,
					error: restarted.error,
				};
			const guided = stepCruiseGuidance({
				guidance: restarted.guidance,
				pos: state.pos,
				nose: state.nose,
				target: { id: target.id, pos: target.pos },
				masses,
				targetParentId: selected.parentId ?? null,
				dt,
				speedKms: length(state.vel),
				steerDirect: true,
				turnRateRadS: 0.4,
			});
			return {
				nose: guided.nose,
				throttle: guided.throttle,
				guidance: guided.guidance,
				error: guided.error,
			};
		},
	};
	// A schedule query can project the previous and current visit in one call.
	// Their otherwise-identical route keys must not evict each other while an
	// incremental warm-up alternates between those visits.
	const cacheKey = `${record.index}|${actor.key}|${selected.id}|${finalPhase}|${spoolEndS}`;
	const canonicalTicks = Math.floor(
		(gameTime - spoolEndS + 1e-10) / CANONICAL_ROUTE_DT_S,
	);
	const requestedCanonicalAtS =
		spoolEndS + Math.max(0, canonicalTicks) * CANONICAL_ROUTE_DT_S;
	const cached = input.cruiseCache?.get(cacheKey);
	const base =
		cached &&
		cached.startedAtS === spoolEndS &&
		cached.atS <= requestedCanonicalAtS + 1e-9
			? cached
			: cruiseInitial;
	const budgetTicks = Math.max(
		0,
		Math.floor(input.cruiseBudget?.remainingTicks ?? Infinity),
	);
	const canonicalAtS = Number.isFinite(budgetTicks)
		? Math.min(
				requestedCanonicalAtS,
				base.atS + budgetTicks * CANONICAL_ROUTE_DT_S,
			)
		: requestedCanonicalAtS;
	const canonical = evaluateTrafficCruise(
		base,
		canonicalAtS,
		cruiseEnvironment,
	);
	if (input.cruiseBudget)
		input.cruiseBudget.remainingTicks = Math.max(
			0,
			input.cruiseBudget.remainingTicks -
				Math.max(0, canonical.workTicks - base.workTicks),
		);
	if (!cached || canonical.atS >= cached.atS) {
		if (!cached && input.cruiseCache && input.cruiseCache.size >= 256) {
			const oldest = input.cruiseCache.keys().next().value;
			if (oldest !== undefined) input.cruiseCache.delete(oldest);
		}
		input.cruiseCache?.set(cacheKey, canonical);
	}
	if (
		canonicalAtS < requestedCanonicalAtS - 1e-9 &&
		(canonical.phase === "cruise" ||
			canonical.phase === "regenerating" ||
			canonical.phase === "blocked")
	)
		return withRoute(
			actor,
			canonical.phase === "blocked" ? "local-departure" : canonical.phase,
			{ ...canonical, key: actor.key },
			{
				...departureCommit,
				destinationStationId: selected.id,
				chargeAu: canonical.chargeAu,
				pendingIntent,
				originBerthOccupied: false,
				workTicks: canonical.workTicks,
				warmIncomplete: true,
			},
		);
	const cruise =
		gameTime > canonicalAtS + 1e-9
			? evaluateTrafficCruise(canonical, gameTime, cruiseEnvironment)
			: canonical;
	if (cruise.phase === "cruise" || cruise.phase === "regenerating")
		return withRoute(
			actor,
			cruise.phase,
			{ ...cruise, key: actor.key },
			{
				...departureCommit,
				destinationStationId: selected.id,
				chargeAu: cruise.chargeAu,
				pendingIntent,
				originBerthOccupied: false,
				workTicks: cruise.workTicks,
			},
		);
	if (cruise.phase === "blocked")
		return withRoute(
			actor,
			"local-departure",
			{ ...cruise, key: actor.key },
			{
				...departureCommit,
				destinationStationId: selected.id,
				chargeAu: cruise.chargeAu,
				pendingIntent,
				originBerthOccupied: false,
				workTicks: cruise.workTicks,
			},
		);

	const dropAtS = cruise.completedAtS ?? gameTime;
	const drop = cruise;
	const holdAtDrop = holdAt(dropAtS);
	const approachS = Math.max(1, length(sub(drop.pos, holdAtDrop.pos)) / 2);
	const holdReachedS = dropAtS + approachS;
	if (gameTime < holdReachedS) {
		const hold = holdAt(gameTime);
		const u = smooth(clamp01((gameTime - dropAtS) / approachS));
		// Arrive at the hold already aligned to the station. Previously the nose
		// stayed on the interplanetary leg until this phase ended, then changed by
		// as much as 93.7 degrees in one 10 Hz authority tick.
		const approachNose = normal(
			interpolate(drop.nose, hold.nose ?? drop.nose, u),
			drop.nose,
		);
		return withRoute(
			actor,
			"local-approach",
			{
				key: actor.key,
				pos: interpolate(drop.pos, hold.pos, u),
				vel: interpolate(drop.vel, hold.vel, u),
				nose: approachNose,
			},
			{
				...departureCommit,
				destinationStationId: selected.id,
				chargeAu: drop.chargeAu,
				pendingIntent,
				originBerthOccupied: false,
				workTicks: drop.workTicks,
			},
		);
	}

	const destinationNow = input.projectionSystem
		? frameInSystem(input.projectionSystem, selected.id, gameTime)
		: frameAt(record, selected.id, gameTime);
	const destinationInterior = stationInterior(
		destinationNow.station.type,
		STATION_GEOMETRY[destinationNow.station.type].aperturePlaneKm,
		destinationNow.station.berthSeed,
	);
	const request: ClearanceQueueRequest = {
		participant: { kind: "carrier", key: actor.key },
		readyAt: holdReachedS,
		hull: HULL_SPECS[actor.hullId].env,
	};
	const compatibleClearanceTimeline = timeline.filter((event) => {
		if (event.kind !== "clearance") return true;
		const hull = event.hull;
		return Boolean(
			hull &&
				destinationInterior.berths.some((berth) => berthFits(berth, hull)),
		);
	});
	const clearanceAtS = blockedUntil(
		compatibleClearanceTimeline,
		selected.id,
		"clearance",
		holdReachedS,
	);
	const occupied =
		input.occupiedByStation?.get(selected.id) ?? new Set<string>();
	if (gameTime < clearanceAtS || !Number.isFinite(clearanceAtS))
		return withRoute(actor, "clearance-queued", holdAt(gameTime), {
			...departureCommit,
			destinationStationId: selected.id,
			chargeAu: drop.chargeAu,
			queueRequest: request,
			pendingIntent,
			originBerthOccupied: false,
			workTicks: drop.workTicks,
		});
	const berthAssignmentKey = [
		record.index,
		actor.key,
		originStationId,
		selected.id,
		awayOrdinal,
		finalPhase,
		readyAtS,
	].join("|");
	input.berthCacheTouched?.add(berthAssignmentKey);
	const assignedBerthId = input.berthCache?.get(berthAssignmentKey);
	const assignedBerth = assignedBerthId
		? destinationInterior.berths.find(
				(candidate) =>
					candidate.id === assignedBerthId &&
					berthFits(candidate, HULL_SPECS[actor.hullId].env),
			)
		: null;
	const promotion = assignedBerth
		? {
				participant: { kind: "carrier" as const, key: actor.key },
				berthId: assignedBerth.id,
			}
		: clearancePromotion(
				[request],
				destinationInterior,
				occupied,
				clearanceAtS,
			);
	const berth = promotion
		? destinationInterior.berths.find(
				(candidate) => candidate.id === promotion.berthId,
			)
		: null;
	if (
		!berth ||
		promotion?.participant.kind !== "carrier" ||
		promotion.participant.key !== actor.key
	)
		return withRoute(actor, "clearance-queued", holdAt(gameTime), {
			...departureCommit,
			destinationStationId: selected.id,
			chargeAu: drop.chargeAu,
			queueRequest: request,
			pendingIntent,
			originBerthOccupied: false,
			workTicks: drop.workTicks,
		});
	if (!assignedBerth && berth && input.recordBerthAssignments !== false)
		input.berthCache?.set(berthAssignmentKey, berth.id);
	const laneAtS =
		input.committedArrivalAtS ??
		blockedUntil(timeline, selected.id, "lane", clearanceAtS, {
			key: actor.key,
			movement: "arrival",
		});
	if (gameTime < laneAtS)
		return withRoute(actor, "lane-queued", holdAt(gameTime), {
			...departureCommit,
			destinationStationId: selected.id,
			terminalStationId: selected.id,
			chargeAu: drop.chargeAu,
			pendingIntent,
			queueRequest: request,
			laneRequest: {
				participant: { kind: "carrier", key: actor.key },
				readyAt: clearanceAtS,
				kind: "arrival",
			},
			originBerthOccupied: false,
			workTicks: drop.workTicks,
			berthId: berth.id,
		});

	const laneFrame = frameAt(record, selected.id, laneAtS);
	const laneBody = placedBody(laneFrame.system, selected.id);
	const laneHoldRel = sub(
		trafficHoldProjection(laneFrame.system, selected.id, actor.key, laneAtS)
			.pos,
		laneBody.pos,
	);
	const laneEntryRel = scale(
		laneFrame.frame.axis,
		laneFrame.frame.planeKm + 1e-6,
	);
	const terminalApproachKm = length(sub(laneEntryRel, laneHoldRel));
	const terminalApproachS = Math.max(
		CANONICAL_ROUTE_DT_S,
		(1.5 * terminalApproachKm) / TRAFFIC_STATION_LOCAL_SPEED_KM_S,
	);
	const entryAtS = laneAtS + terminalApproachS;
	if (gameTime < entryAtS) {
		const current = frameAt(record, selected.id, gameTime);
		const body = placedBody(current.system, selected.id);
		const entryRel = scale(current.frame.axis, current.frame.planeKm + 1e-6);
		const rawU = clamp01((gameTime - laneAtS) / terminalApproachS);
		const u = smooth(rawU);
		const hold = holdAt(gameTime);
		const holdRel = sub(hold.pos, body.pos);
		return withRoute(
			actor,
			"arriving",
			{
				key: actor.key,
				pos: add(body.pos, interpolate(holdRel, entryRel, u)),
				vel: add(
					bodyVelocity(current.system, selected.id, gameTime),
					scale(
						sub(entryRel, holdRel),
						(6 * rawU * (1 - rawU)) / terminalApproachS,
					),
				),
				nose: scale(current.frame.axis, -1),
			},
			{
				...departureCommit,
				arrivalStartedAtS: laneAtS,
				destinationStationId: selected.id,
				terminalStationId: selected.id,
				laneStartedAtS: laneAtS,
				chargeAu: drop.chargeAu,
				pendingIntent,
				queueRequest: request,
				laneRequest: {
					participant: { kind: "carrier", key: actor.key },
					readyAt: clearanceAtS,
					kind: "arrival",
				},
				originBerthOccupied: false,
				workTicks: drop.workTicks,
				berthId: berth.id,
			},
		);
	}

	const entryFrame = frameAt(record, selected.id, entryAtS);
	const entryRel = scale(
		entryFrame.frame.axis,
		entryFrame.frame.planeKm + 1e-6,
	);
	const arrival = beginArrival(
		entryFrame.frame,
		destinationInterior,
		berth,
		entryRel,
		entryAtS,
		{ nose: scale(entryFrame.frame.axis, -1), up: entryFrame.pose.reference },
	);
	const arrivalEndS = entryAtS + arrival.durationS;
	if (gameTime < arrivalEndS) {
		const current = frameAt(record, selected.id, gameTime);
		const body = placedBody(current.system, selected.id);
		const u = arrivalProgress(arrival, gameTime);
		const rel = arrivalRel(arrival, u, current.pose.phaseRad);
		const spin = STATION_GEOMETRY[current.station.type].spins
			? (2 * Math.PI * current.station.spinRpm) / 60
			: 0;
		return withRoute(
			actor,
			"arriving",
			{
				key: actor.key,
				pos: add(body.pos, rel),
				vel: add(
					bodyVelocity(current.system, selected.id, gameTime),
					arrivalRelVelocity(arrival, u, current.pose.phaseRad, spin),
				),
				...arrivalAttitude(arrival, u, current.pose.phaseRad),
			},
			{
				...departureCommit,
				arrivalStartedAtS: laneAtS,
				destinationStationId: selected.id,
				terminalStationId: selected.id,
				laneStartedAtS: laneAtS,
				chargeAu: drop.chargeAu,
				pendingIntent,
				queueRequest: request,
				laneRequest: {
					participant: { kind: "carrier", key: actor.key },
					readyAt: clearanceAtS,
					kind: "arrival",
				},
				originBerthOccupied: false,
				workTicks: drop.workTicks,
				berthId: berth.id,
			},
		);
	}

	return withRoute(
		actor,
		finalPhase,
		parkedTrafficProjection(
			destinationNow.system,
			selected.id,
			berth.id,
			actor,
			gameTime,
		),
		{
			...departureCommit,
			arrivalStartedAtS: laneAtS,
			destinationStationId: finalPhase === "docked-away" ? selected.id : null,
			terminalStationId: selected.id,
			chargeAu: HULL_SPECS[actor.hullId].chargeAu,
			pendingIntent,
			queueRequest: request,
			laneRequest: {
				participant: { kind: "carrier", key: actor.key },
				readyAt: clearanceAtS,
				kind: "arrival",
			},
			originBerthOccupied: false,
			workTicks: drop.workTicks,
			berthId: berth.id,
			completedAtS: arrivalEndS,
		},
	);
}

interface TrafficVisitInput {
	record: SystemRecord;
	actor: TrafficActor;
	gameTime: number;
	playerTimeline?: readonly TrafficArbitrationEvent[];
	occupiedByStation?: ReadonlyMap<string, ReadonlySet<string>>;
	cruiseCache?: TrafficCruiseCache;
	berthCache?: TrafficBerthCache;
	berthCacheTouched?: Set<string>;
	recordBerthAssignments?: boolean;
	projectionSystem?: System;
	departureAtS: number;
	launchReadyAtS: number;
	awayOrdinal: number;
	desired: "parked" | "away";
	desiredBoundaryS: number;
	/** A return may continue past this boundary, but may not begin after it. */
	returnStartBeforeS?: number;
	homeBerthId?: string;
	outboundDepartureAtS?: number;
	outboundArrivalAtS?: number;
	returnDepartureAtS?: number;
	returnArrivalAtS?: number;
	cruiseBudget?: { remainingTicks: number };
}

function projectTrafficVisit(
	input: TrafficVisitInput,
): SystemTrafficProjection {
	const { record, actor, gameTime } = input;
	const timeline = input.playerTimeline ?? [];
	const departureAtS = input.departureAtS;
	const returnReadyAtS = departureAtS + actor.schedule.awayS;
	const homeNow = input.projectionSystem
		? frameInSystem(input.projectionSystem, actor.homeStationId, gameTime)
		: frameAt(record, actor.homeStationId, gameTime);
	const homeInterior = stationInterior(
		homeNow.station.type,
		STATION_GEOMETRY[homeNow.station.type].aperturePlaneKm,
		homeNow.station.berthSeed,
	);
	const homeBerth = input.homeBerthId
		? homeInterior.berths.find((berth) => berth.id === input.homeBerthId)
		: homeInterior.berths[actor.ordinal % homeInterior.berths.length];
	if (!homeBerth)
		throw new Error(
			`no home berth ${input.homeBerthId} at ${actor.homeStationId}`,
		);
	const markVisit = (
		projection: SystemTrafficProjection,
		commitments: Partial<SystemTrafficProjection> = {},
	): SystemTrafficProjection => ({
		...projection,
		visitDepartureAtS: input.departureAtS,
		visitLaunchReadyAtS: input.launchReadyAtS,
		visitAwayOrdinal: input.awayOrdinal,
		visitHomeBerthId: homeBerth.id,
		...commitments,
	});

	const returnIntent =
		input.desired === "parked" && gameTime >= input.desiredBoundaryS
			? { desired: "parked" as const, readyAt: input.desiredBoundaryS }
			: null;
	const outbound = projectTrafficLeg({
		record,
		actor,
		gameTime,
		timeline,
		occupiedByStation: input.occupiedByStation,
		cruiseCache: input.cruiseCache,
		berthCache: input.berthCache,
		berthCacheTouched: input.berthCacheTouched,
		recordBerthAssignments: input.recordBerthAssignments,
		projectionSystem: input.projectionSystem,
		originStationId: actor.homeStationId,
		originBerthId: homeBerth.id,
		destinationStationId: null,
		readyAtS: input.launchReadyAtS,
		awayOrdinal: input.awayOrdinal,
		finalPhase: "docked-away",
		pendingIntent: returnIntent,
		committedDepartureAtS: input.outboundDepartureAtS,
		committedArrivalAtS: input.outboundArrivalAtS,
		cruiseBudget: input.cruiseBudget,
	});
	const outboundCommitments = {
		visitOutboundDepartureAtS: outbound.departureStartedAtS,
		visitOutboundArrivalAtS: outbound.arrivalStartedAtS,
	};
	if (outbound.phase === "abstract-away" && gameTime >= returnReadyAtS)
		return markVisit(
			withRoute(
				actor,
				"parked-home",
				parkedTrafficProjection(
					homeNow.system,
					actor.homeStationId,
					homeBerth.id,
					actor,
					gameTime,
				),
				{
					berthId: homeBerth.id,
					terminalStationId: actor.homeStationId,
					completedAtS: returnReadyAtS,
				},
			),
			outboundCommitments,
		);
	const returnStartS =
		outbound.phase === "docked-away" && outbound.completedAtS !== undefined
			? Math.max(returnReadyAtS, outbound.completedAtS + TRAFFIC_MIN_DOCKED_S)
			: Number.POSITIVE_INFINITY;
	const returnWasCommitted =
		input.desired === "parked" ||
		(input.returnStartBeforeS !== undefined &&
			returnStartS < input.returnStartBeforeS);
	if (gameTime < returnStartS) return markVisit(outbound, outboundCommitments);
	if (
		outbound.phase !== "docked-away" ||
		!returnWasCommitted ||
		!outbound.destinationStationId ||
		!outbound.berthId ||
		outbound.completedAtS === undefined
	)
		return markVisit(outbound, outboundCommitments);

	const returned = projectTrafficLeg({
		record,
		actor,
		gameTime,
		timeline,
		occupiedByStation: input.occupiedByStation,
		cruiseCache: input.cruiseCache,
		berthCache: input.berthCache,
		berthCacheTouched: input.berthCacheTouched,
		recordBerthAssignments: input.recordBerthAssignments,
		projectionSystem: input.projectionSystem,
		originStationId: outbound.destinationStationId,
		originBerthId: outbound.berthId,
		destinationStationId: actor.homeStationId,
		readyAtS: returnStartS,
		awayOrdinal: input.awayOrdinal,
		finalPhase: "parked-home",
		pendingIntent:
			input.desired === "away"
				? { desired: "away", readyAt: input.desiredBoundaryS }
				: null,
		committedDepartureAtS: input.returnDepartureAtS,
		committedArrivalAtS: input.returnArrivalAtS,
		cruiseBudget: input.cruiseBudget,
	});
	return markVisit(returned, {
		...outboundCommitments,
		visitReturnDepartureAtS: returned.departureStartedAtS,
		visitReturnArrivalAtS: returned.arrivalStartedAtS,
	});
}

/**
 * Project one complete home-owned visit. The base schedule supplies intent;
 * active traversal never reverses or teleports when that intent changes.
 */
export interface SystemTrafficProjectionInput {
	record: SystemRecord;
	actor: TrafficActor;
	gameTime: number;
	playerTimeline?: readonly TrafficArbitrationEvent[];
	occupiedByStation?: ReadonlyMap<string, ReadonlySet<string>>;
	projectionSystem?: System;
}

export interface SystemTrafficAuthorityInput
	extends SystemTrafficProjectionInput {
	cruiseCache?: TrafficCruiseCache;
	berthCache?: TrafficBerthCache;
	berthCacheTouched?: Set<string>;
	/** False for an arbitration preview which must not commit a berth. */
	recordBerthAssignments?: boolean;
	/** Fixed canonical replay budget used only by incremental cache warm-up. */
	cruiseTickBudget?: number;
	/** Continue this already-authoritative visit instead of reselecting by intent. */
	activeVisit?: {
		departureAtS: number;
		launchReadyAtS: number;
		awayOrdinal: number;
		homeBerthId?: string;
		outboundDepartureAtS?: number;
		outboundArrivalAtS?: number;
		returnDepartureAtS?: number;
		returnArrivalAtS?: number;
	};
}

function projectSystemTrafficActorWithCaches(
	input: SystemTrafficAuthorityInput,
): SystemTrafficProjection {
	const cruiseBudget =
		input.cruiseTickBudget === undefined
			? undefined
			: { remainingTicks: Math.max(0, Math.floor(input.cruiseTickBudget)) };
	const visitInput = { ...input, cruiseBudget };
	if (input.activeVisit)
		return projectTrafficVisit({
			...visitInput,
			departureAtS: input.activeVisit.departureAtS,
			launchReadyAtS: input.activeVisit.launchReadyAtS,
			awayOrdinal: input.activeVisit.awayOrdinal,
			homeBerthId: input.activeVisit.homeBerthId,
			outboundDepartureAtS: input.activeVisit.outboundDepartureAtS,
			outboundArrivalAtS: input.activeVisit.outboundArrivalAtS,
			returnDepartureAtS: input.activeVisit.returnDepartureAtS,
			returnArrivalAtS: input.activeVisit.returnArrivalAtS,
			desired:
				input.gameTime <
				input.activeVisit.departureAtS + input.actor.schedule.awayS
					? "away"
					: "parked",
			desiredBoundaryS:
				input.activeVisit.departureAtS + input.actor.schedule.awayS,
		});
	// The world begins with the authored home roster. Schedule arithmetic has a
	// mathematically valid negative cycle before the first departure, but it is
	// not a physical visit and must never replace that initial parked state.
	if (input.gameTime < input.actor.schedule.departureAtS)
		return projectParkedTrafficActor({
			actor: input.actor,
			gameTime: input.gameTime,
			projectionSystem:
				input.projectionSystem ?? systemAt(input.record, input.gameTime),
		});
	const schedule = trafficScheduleAt(input.actor, input.gameTime);
	const departureAtS =
		schedule.desired === "away"
			? schedule.boundaryS
			: schedule.boundaryS - input.actor.schedule.awayS;
	if (schedule.desired === "parked") {
		const priorDepartureAtS = departureAtS - input.actor.schedule.cycleS;
		const prior =
			priorDepartureAtS >= input.actor.schedule.departureAtS
				? projectTrafficVisit({
						...visitInput,
						departureAtS: priorDepartureAtS,
						launchReadyAtS: priorDepartureAtS,
						awayOrdinal: schedule.awayOrdinal - 1,
						desired: "parked",
						desiredBoundaryS: priorDepartureAtS + input.actor.schedule.awayS,
					})
				: null;
		if (prior && prior.phase !== "parked-home") return prior;
		return projectTrafficVisit({
			...visitInput,
			departureAtS,
			launchReadyAtS: Math.max(
				departureAtS,
				prior?.completedAtS !== undefined
					? prior.completedAtS + TRAFFIC_MIN_DOCKED_S
					: departureAtS,
			),
			awayOrdinal: schedule.awayOrdinal,
			desired: "parked",
			desiredBoundaryS: schedule.boundaryS,
			homeBerthId: prior?.berthId ?? undefined,
		});
	}

	const previousDepartureAtS = departureAtS - input.actor.schedule.cycleS;
	const previous =
		previousDepartureAtS >= input.actor.schedule.departureAtS
			? projectTrafficVisit({
					...visitInput,
					departureAtS: previousDepartureAtS,
					launchReadyAtS: previousDepartureAtS,
					awayOrdinal: schedule.awayOrdinal - 1,
					desired: "away",
					desiredBoundaryS: schedule.boundaryS,
					returnStartBeforeS: schedule.boundaryS,
				})
			: null;
	if (previous && previous.phase !== "parked-home") return previous;

	return projectTrafficVisit({
		...visitInput,
		departureAtS,
		launchReadyAtS: Math.max(
			departureAtS,
			previous?.completedAtS !== undefined
				? previous.completedAtS + TRAFFIC_MIN_DOCKED_S
				: departureAtS,
		),
		awayOrdinal: schedule.awayOrdinal,
		desired: "away",
		desiredBoundaryS: schedule.boundaryS,
		homeBerthId: previous?.berthId ?? undefined,
	});
}

/** Pure route projection: deterministic output with no authority/cache writes. */
export function projectSystemTrafficActor(
	input: SystemTrafficProjectionInput,
): SystemTrafficProjection {
	return projectSystemTrafficActorWithCaches(input);
}

/** Stateful authority wrapper which owns bounded replay and berth-decision caches. */
export function projectSystemTrafficAuthority(
	input: SystemTrafficAuthorityInput,
): SystemTrafficProjection {
	return projectSystemTrafficActorWithCaches(input);
}
