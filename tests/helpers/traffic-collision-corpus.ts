/**
 * `collision.md` §6 item 1 and §9.1.14's corpus row (node #664): does any
 * projected Traffic route, outside its exempt phases, bring a carrier's box
 * into a station proxy, a body's sphere, or another carrier's box?
 *
 * **Swept, never sampled.** Each carrier is projected on one shared clock at
 * `stepS`, and its box is swept from one sample's pose to the next against
 * every solid `worldSolids` names for that step and against every other
 * carrier collidable on the same step (the MAX_DT Constraint, #75). A sample
 * that sat inside a solid would be a **ghost** to `sweepShip` (§4.3), which
 * fails open by design — so a ghost is counted as a meeting here, not as
 * clear. The one ghost §4.3 sanctions is the end of a launch, where the
 * centre has cleared the plane and the rear of the hull may not have; that
 * is counted apart (`launchGhosts`), against the station launched from, and
 * only on the first collidable step after `departing`.
 *
 * **What the projection is.** Every roster and inbound actor of a system,
 * projected by the shipped route law (`projectSystemTrafficAuthority`) with
 * the hauler voyages `Game` hands it, on one clock, in the order
 * `Game.updateTrafficAuthority` takes them: each station's turn order, each
 * actor against the lanes the ones before it have won (the carrier timeline),
 * and each one's visit carried from the tick before. What it leaves out is the
 * player, berth occupancy — a berth is exempt, so two carriers dealt one never
 * meet here — and the authority's re-anchoring of a visit to the tick a queue
 * promotes it, which moves a start by under one tick.
 *
 * **Cruise is counted, not judged.** `cruise` and `regenerating` are the
 * cruise regime, which C5 leaves to cruise's own guards
 * (`trafficCollisionClass`). Their meetings are printed so the exclusion is a
 * number rather than a silence.
 */

import {
	type Primitive,
	type SolidMotion,
	hullBox,
	reachKm,
	shipPose,
	sweepShip,
} from "../../src/collision";
import {
	type TrafficCollision,
	trafficCollisionClass,
} from "../../src/dock-session";
import type { Galaxy, SystemRecord } from "../../src/galaxy";
import { HULL_SPECS, type HullId } from "../../src/hull";
import {
	type HaulerPlan,
	buildHaulerPlans,
	inboundCandidates,
	routeVoyages,
} from "../../src/inter-system-traffic";
import {
	type System,
	makeSystem,
	worldSolids,
	worldStarts,
} from "../../src/sim";
import {
	type SystemTrafficProjection,
	type TrafficArbitrationEvent,
	type TrafficCruiseCache,
	type TrafficLanePointArrivalCache,
	type TrafficRoutePhase,
	projectSystemTrafficAuthority,
} from "../../src/station-route";
import {
	type StationTurn,
	type TrafficActor,
	compareStationTurns,
} from "../../src/station-traffic";
import { type SystemContents, generateContents } from "../../src/system";
import { length, scale, sub } from "../../src/vec3";

export interface CorpusOptions {
	/** Seconds between samples; the sweep covers each interval. */
	stepS: number;
	/** The window, game seconds. */
	fromS: number;
	toS: number;
	/**
	 * The red build (§9.1.8's split): treat the exempt phases as collidable
	 * too. A pad role's deck and berths are solid, so this must meet something. // glossary-ignore: pad
	 */
	includeExempt?: boolean;
	/** Restrict to these actor keys; all actors when absent. */
	only?: ReadonlySet<string>;
	/** Called with every projection the run makes, for a diagnosis. */
	trace?: (atS: number, projection: SystemTrafficProjection) => void;
}

/** One meeting, as the row reports it. */
export interface Meeting {
	key: string;
	atS: number;
	phase: TrafficRoutePhase;
	/** What was met: a body or station id, or `carrier:<key>`. */
	met: string;
	kind: "impact" | "ghost";
	closingKms: number;
	/** Seconds since the carrier entered `phase`, at the interval's start. */
	phaseAgeS: number;
}

export interface CorpusResult {
	systemIndex: number;
	actors: number;
	/** Carrier-steps swept, by phase: the N of every bucket. */
	steps: Record<string, number>;
	/** Meetings in a collidable phase: the row's red. */
	meetings: Meeting[];
	/** Meetings in a cruise phase: counted under C5, not judged. */
	cruiseMeetings: Meeting[];
	/** §4.3's sanctioned case: the hull still in the aperture at launch end. */
	launchGhosts: Meeting[];
	/** Carrier-against-carrier pairs tested (both collidable on one step). */
	pairSteps: number;
}

interface Sample {
	projection: SystemTrafficProjection;
	cls: TrafficCollision;
}

const BOX_CACHE = new Map<HullId, Primitive[]>();
const boxOf = (hullId: HullId): Primitive[] => {
	let box = BOX_CACHE.get(hullId);
	if (!box) {
		box = [hullBox(HULL_SPECS[hullId].env, HULL_SPECS[hullId].envCentre)];
		BOX_CACHE.set(hullId, box);
	}
	return box;
};

/** Whether a class is swept this run. */
const swept = (cls: TrafficCollision, includeExempt: boolean): boolean =>
	cls === "collides" || cls === "cruise" || (includeExempt && cls === "exempt");

const finite = (value: number, what: string): number => {
	if (!Number.isFinite(value)) throw new Error(`${what} is not finite`);
	return value;
};

/**
 * A carrier's motion across one interval, from two samples. Its velocity is
 * the interval's own displacement, not the projections' `vel`: a projection
 * reports the velocity of the law it interpolates, which on a smoothed leg is
 * not the rate its position moves at, and a closing speed read off it would
 * misstate what a meeting costs.
 */
function motionOf(
	actor: TrafficActor,
	a: SystemTrafficProjection,
	b: SystemTrafficProjection,
	stepS: number,
): SolidMotion | null {
	if (!a.nose || !a.up || !b.nose || !b.up) return null;
	const vel = scale(sub(b.pos, a.pos), 1 / stepS);
	return {
		primitives: boxOf(actor.hullId),
		start: shipPose(a.pos, a.nose, a.up),
		end: shipPose(b.pos, b.nose, b.up),
		velStart: vel,
		velEnd: vel,
	};
}

/**
 * Run the corpus over one system. `contentsFor` is shared across systems so
 * the inbound candidates are generated once per system in range.
 */
export function trafficCollisionCorpus(
	galaxy: Galaxy,
	record: SystemRecord,
	contentsFor: (index: number) => SystemContents,
	options: CorpusOptions,
): CorpusResult {
	const includeExempt = options.includeExempt ?? false;
	const plans: HaulerPlan[] = [
		...buildHaulerPlans(galaxy, record.index, contentsFor),
		...inboundCandidates(galaxy, record.index, contentsFor),
	];
	const haulers = new Map(
		plans
			.filter((plan) => plan.vocation === "hauler")
			.map((plan) => [plan.actor.key as string, plan]),
	);
	const actors = plans
		.map((plan) => plan.actor)
		.filter((actor) => !options.only || options.only.has(actor.key));
	const cruiseCache: TrafficCruiseCache = new Map();
	const lanePointArrivalCache: TrafficLanePointArrivalCache = new Map();
	/** The lanes carriers have already won, as `Game` keeps them. */
	const timeline: TrafficArbitrationEvent[] = [];
	/** Each actor's last projection: its visit, and its turn at the station. */
	const prior = new Map<string, SystemTrafficProjection>();
	/** A projection's turn at its station, as `Game` sorts the baselines. */
	const turnOf = (
		actor: TrafficActor,
		projection: SystemTrafficProjection,
	): StationTurn =>
		projection.laneRequest
			? {
					participant: projection.laneRequest.participant,
					readyAt: projection.laneRequest.readyAt,
					kind: projection.laneRequest.kind,
				}
			: {
					participant: { kind: "carrier", key: actor.key },
					readyAt: projection.queueRequest?.readyAt ?? Number.POSITIVE_INFINITY,
					kind: "clearance",
				};
	const activeVisitOf = (key: string) => {
		const last = prior.get(key);
		return last &&
			last.phase !== "parked-home" &&
			last.visitDepartureAtS !== undefined &&
			last.visitLaunchReadyAtS !== undefined &&
			last.visitAwayOrdinal !== undefined
			? {
					departureAtS: last.visitDepartureAtS,
					launchReadyAtS: last.visitLaunchReadyAtS,
					awayOrdinal: last.visitAwayOrdinal,
					homeBerthId: last.visitHomeBerthId,
					outboundDepartureAtS: last.visitOutboundDepartureAtS,
					outboundArrivalAtS: last.visitOutboundArrivalAtS,
					returnDepartureAtS: last.visitReturnDepartureAtS,
					returnArrivalAtS: last.visitReturnArrivalAtS,
				}
			: undefined;
	};
	/** `Game.recordCarrierTrafficLane`: a lane a carrier is in, held to now. */
	const holdLane = (projection: SystemTrafficProjection, toS: number) => {
		if (
			!projection.terminalStationId ||
			projection.laneStartedAtS === null ||
			(projection.phase !== "departing" && projection.phase !== "arriving")
		)
			return;
		const movement = projection.phase === "departing" ? "launch" : "arrival";
		const existing = timeline.find(
			(event) =>
				event.stationId === projection.terminalStationId &&
				event.participant.kind === "carrier" &&
				event.participant.key === projection.key &&
				event.movement === movement &&
				event.fromS === projection.laneStartedAtS,
		);
		if (existing) existing.toS = Math.max(existing.toS, toS);
		else
			timeline.push({
				stationId: projection.terminalStationId,
				kind: "lane",
				fromS: projection.laneStartedAtS,
				toS,
				participant: { kind: "carrier", key: projection.key },
				movement,
				committed: true,
			});
	};
	/**
	 * One authority tick, as `Game.updateTrafficAuthority` orders it: actors
	 * in their stations' turn order, each projected against the lanes the ones
	 * before it have won, and each lane it is in held for the next.
	 */
	const project = (system: System, atS: number, stepS: number): Sample[] => {
		const inputOf = (actor: TrafficActor) => {
			const plan = haulers.get(actor.key);
			return {
				record,
				actor,
				gameTime: atS,
				projectionSystem: system,
				playerTimeline: timeline,
				cruiseCache,
				lanePointArrivalCache,
				activeVisit: activeVisitOf(actor.key),
				haulerVoyages: plan
					? routeVoyages(
							galaxy,
							plan,
							record.index,
							atS,
							contentsFor,
							prior.get(actor.key)?.visitAwayOrdinal,
						)
					: undefined,
			};
		};
		// The baselines first, against the lanes already won, and the turn
		// order read off them — not off the tick before, whose order is stale
		// the tick a carrier first asks for a lane.
		const ordered = actors
			.map((actor, index) => ({
				actor,
				index,
				turn: turnOf(actor, projectSystemTrafficAuthority(inputOf(actor))),
			}))
			.sort((a, b) => compareStationTurns(a.turn, b.turn));
		const samples: Sample[] = new Array(actors.length);
		for (const { actor, index } of ordered) {
			const projection = projectSystemTrafficAuthority(inputOf(actor));
			prior.set(actor.key, projection);
			options.trace?.(atS, projection);
			holdLane(projection, atS + stepS);
			samples[index] = {
				projection,
				cls:
					projection.present === false
						? "absent"
						: trafficCollisionClass(projection.phase),
			};
		}
		return samples;
	};

	const result: CorpusResult = {
		systemIndex: record.index,
		actors: actors.length,
		steps: {},
		meetings: [],
		cruiseMeetings: [],
		launchGhosts: [],
		pairSteps: 0,
	};
	/** The phase each actor held one sample back. */
	const previousPhase = new Map<string, TrafficRoutePhase>();
	/** When each actor entered the phase it holds now. */
	const phaseSince = new Map<string, number>();
	let systemA = makeSystem(record, options.fromS);
	let samplesA = project(systemA, options.fromS, options.stepS);
	for (
		let atS = options.fromS;
		atS + options.stepS <= options.toS + 1e-9;
		atS += options.stepS
	) {
		const toS = atS + options.stepS;
		const starts = worldStarts(systemA, atS);
		const systemB = makeSystem(record, toS);
		const samplesB = project(systemB, toS, options.stepS);
		/** The carriers collidable across this interval, with their motions. */
		const live: {
			index: number;
			motion: SolidMotion;
			cls: TrafficCollision;
			phase: TrafficRoutePhase;
		}[] = [];
		actors.forEach((actor, index) => {
			const a = samplesA[index];
			const b = samplesB[index];
			// Collidable at both ends: a phase boundary inside the interval is a
			// placement (a launch end, a cruise exit) and is judged from the
			// first interval that starts in the new phase.
			if (!swept(a.cls, includeExempt) || !swept(b.cls, includeExempt)) return;
			if (a.cls !== b.cls) return;
			const motion = motionOf(actor, a.projection, b.projection, options.stepS);
			if (!motion) throw new Error(`${actor.key} has no attitude at ${atS}`);
			const phase = a.projection.phase;
			result.steps[phase] = (result.steps[phase] ?? 0) + 1;
			live.push({ index, motion, cls: a.cls, phase });
			// A launch end is the interval whose start is the first collidable
			// sample after `departing`.
			const prior = previousPhase.get(actor.key);
			const phaseAgeS = atS - (phaseSince.get(actor.key) ?? options.fromS);
			const launchEnd = phase === "local-departure" && prior === "departing";
			const { owner, motions } = worldSolids(
				systemB,
				{
					start: motion.start.origin,
					end: motion.end.origin,
					reachKm: reachKm(motion.primitives),
				},
				starts,
				{ fromTime: atS, toTime: toS },
			);
			if (motions.length === 0) return;
			const sweep = sweepShip(motion, motions, options.stepS);
			const report = (meeting: Meeting) => {
				if (a.cls === "cruise") result.cruiseMeetings.push(meeting);
				else if (
					launchEnd &&
					meeting.kind === "ghost" &&
					meeting.met === a.projection.terminalStationId
				)
					result.launchGhosts.push(meeting);
				else result.meetings.push(meeting);
			};
			for (const ghost of new Set(sweep.ghosts.map((i) => owner[i])))
				report({
					key: actor.key,
					atS,
					phase,
					met: ghost,
					kind: "ghost",
					closingKms: 0,
					phaseAgeS,
				});
			for (const impact of sweep.impacts)
				report({
					key: actor.key,
					atS,
					phase,
					met: owner[impact.solid],
					kind: "impact",
					closingKms: finite(impact.closingKms, "closing speed"),
					phaseAgeS,
				});
		});
		// Carrier against carrier: every pair collidable on this interval.
		for (let i = 0; i < live.length; i++)
			for (let j = i + 1; j < live.length; j++) {
				const a = live[i];
				const b = live[j];
				const gap = length(sub(a.motion.start.origin, b.motion.start.origin));
				const travel =
					length(sub(a.motion.end.origin, a.motion.start.origin)) +
					length(sub(b.motion.end.origin, b.motion.start.origin));
				if (
					gap >
					reachKm(a.motion.primitives) + reachKm(b.motion.primitives) + travel
				)
					continue;
				result.pairSteps++;
				const sweep = sweepShip(a.motion, [b.motion], options.stepS);
				const keyA = actors[a.index].key;
				const keyB = actors[b.index].key;
				const meeting = (kind: "impact" | "ghost", closingKms: number) => ({
					key: keyA,
					atS,
					phase: a.phase,
					met: `carrier:${keyB}:${b.phase}`,
					kind,
					closingKms,
					phaseAgeS: atS - (phaseSince.get(keyA) ?? options.fromS),
				});
				const both = a.cls === "cruise" || b.cls === "cruise";
				const sink = both ? result.cruiseMeetings : result.meetings;
				if (sweep.ghosts.length > 0) sink.push(meeting("ghost", 0));
				for (const impact of sweep.impacts)
					sink.push(meeting("impact", impact.closingKms));
			}
		for (const [index, actor] of actors.entries()) {
			previousPhase.set(actor.key, samplesA[index].projection.phase);
			if (samplesB[index].projection.phase !== samplesA[index].projection.phase)
				phaseSince.set(actor.key, toS);
		}
		systemA = systemB;
		samplesA = samplesB;
	}
	return result;
}

/** The contents of every system in a galaxy, generated once each. */
export const contentsCache = (galaxy: Galaxy) => {
	const cache = new Map<number, SystemContents>();
	return (index: number): SystemContents => {
		let contents = cache.get(index);
		if (!contents) {
			const record = galaxy.systems.find((r) => r.index === index);
			if (!record) throw new Error(`no system ${index}`);
			contents = generateContents(record);
			cache.set(index, contents);
		}
		return contents;
	};
};

/** The earliest first departure among a system's actors, for a window. */
export function firstDepartureS(
	galaxy: Galaxy,
	record: SystemRecord,
	contentsFor: (index: number) => SystemContents,
): number {
	const actors = buildHaulerPlans(galaxy, record.index, contentsFor).map(
		(plan) => plan.actor,
	);
	return Math.min(...actors.map((actor) => actor.schedule.departureAtS));
}

/**
 * The classes the first runs found (`docs/findings/traffic-collision-corpus.md`),
 * so a run reports which of them it met and anything new stands apart.
 *
 * - **`launch-aperture`** — a station met in the first `LAUNCH_APERTURE_S` of a
 *   local departure: the hull released with its rear still in a spinning
 *   bay, which turns into it once the carrier stops turning with it.
 * - **`release-point`** — two carriers both in local departure: every launch
 *   from one station ends at one point on its axis, and a hauler holds there
 *   for its jump charge while the next launch arrives.
 * - **`approach-through`** — a station met on a local approach: the straight
 *   line from the cruise drop to the hold passes through it.
 * - **`other`** — anything else, which no class explains.
 */
export type MeetingClass =
	| "launch-aperture"
	| "release-point"
	| "approach-through"
	| "other";

/** How long after a launch a station met is still the aperture's. */
export const LAUNCH_APERTURE_S = 10;

export function meetingClass(m: Meeting): MeetingClass {
	const carrier = m.met.startsWith("carrier:");
	if (
		m.phase === "local-departure" &&
		carrier &&
		m.met.endsWith(":local-departure")
	)
		return "release-point";
	if (
		m.phase === "local-departure" &&
		!carrier &&
		m.phaseAgeS < LAUNCH_APERTURE_S
	)
		return "launch-aperture";
	if (m.phase === "local-approach" && !carrier && m.met.includes("station-"))
		return "approach-through";
	return "other";
}

/**
 * One meeting per distinct meeting: a carrier stays met, step after step,
 * until its phase ends, so the first step of each (carrier, what it met,
 * phase entry) stands for the meeting and the steps after it are not new
 * events.
 */
export function distinctMeetings(meetings: readonly Meeting[]): Meeting[] {
	const seen = new Set<string>();
	const out: Meeting[] = [];
	for (const m of meetings) {
		const id = `${m.key}|${m.met}|${m.phase}|${m.atS - m.phaseAgeS}`;
		if (seen.has(id)) continue;
		seen.add(id);
		out.push(m);
	}
	return out;
}
