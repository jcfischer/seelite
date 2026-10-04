/** Home-owned haulers: static cross-system facts only. No foreign queue replay. */
import { beginArrival, beginLaunch } from "./arrival";
import {
	type CarrierKey,
	compareCarrierKeys,
	systemIndexOfKey,
} from "./carrier-key";
import { DEFAULT_CRUISE, legSeconds } from "./cruise";
import { apertureFrame, slotBasis } from "./docking";
import { type Galaxy, type SystemRecord, distanceLy } from "./galaxy";
import { HULL_SPECS, type HullId } from "./hull";
import { JUMP_CHARGE_S } from "./hyperspace";
import { fnv1a } from "./rng";
import { stationPose, makeSystem } from "./sim";
import { STATION_GEOMETRY } from "./station";
import { stationInterior, trafficBerths, berthFits } from "./station-interior";
import {
	stationTrafficRoster,
	TRAFFIC_HULL_POOLS,
	TRAFFIC_MIN_DOCKED_S,
	TRAFFIC_STATION_EXCLUSION_KM,
	TRAFFIC_STATION_RELEASE_MARGIN_KM,
	TRAFFIC_STATION_LOCAL_SPEED_KM_S,
	type TrafficActor,
	nextTrafficDepartureAtS,
} from "./station-traffic";
import {
	type SystemContents,
	type Station,
	arrivalPoint,
	ARRIVAL_DISTANCE_AU,
	ARRIVAL_CLEARANCE_AU,
} from "./system";
import { AU_KM } from "./units";
import { type Vec3, add, sub, scale, cross, normalizeOr } from "./vec3";

const normalize = (v: Vec3) => normalizeOr(v, { x: 0, y: 0, z: 1 });

export const HAULER_SHARE = 1 / 3;
export const HAULER_SLACK_S = 60;
export const LANE_ANNULUS_KM = [2, 20] as const;
export const TRAFFIC_TANK_LY = Math.max(
	...Object.values(TRAFFIC_HULL_POOLS)
		.flat()
		.map((h) => HULL_SPECS[h].tankLy),
);
export type ContentsQuery = (systemIndex: number) => SystemContents;
export interface HaulerBounds {
	distanceAu: number;
	nominalOutS: number;
	nominalInS: number;
}
export interface HaulerDestination {
	systemIndex: number;
	stationId: string;
	bounds: HaulerBounds;
}
export interface HaulerPlan {
	actor: TrafficActor;
	vocation: "local" | "hauler";
	cycleMultiple: number;
	homeRecord: SystemRecord;
	homeBounds: HaulerBounds;
	eligible: readonly HaulerDestination[];
}
export interface HaulerVoyage {
	awayOrdinal: number;
	destinationSystemIndex: number;
	destinationStationId: string;
	awayBoundaryS: number;
	parkedBoundaryS: number;
	tOut: number;
	tBack: number;
}

/** Circular orbit solver: a moon/station's bound includes its parent's orbit. */
export function bodyRadiusBoundsKm(c: SystemContents): Map<string, number> {
	const radii = new Map<string, number>([[c.star.id, 0]]);
	for (const p of c.planets) {
		radii.set(p.id, p.orbit.radiusKm);
		for (const m of p.moons)
			radii.set(m.id, p.orbit.radiusKm + m.orbit.radiusKm);
	}
	for (const s of c.stations)
		radii.set(
			s.id,
			s.orbit.radiusKm + (s.parentId ? radii.get(s.parentId)! : 0),
		);
	return radii;
}
export function arrivalRadiusBoundAu(c: SystemContents): number {
	return Math.max(
		ARRIVAL_DISTANCE_AU,
		...[...bodyRadiusBoundsKm(c).values()].map(
			(r) => r / AU_KM + ARRIVAL_CLEARANCE_AU,
		),
	);
}
export function haulerBounds(
	record: SystemRecord,
	c: SystemContents,
	s: Station,
	hull: HullId,
): HaulerBounds {
	const distanceAu =
		arrivalRadiusBoundAu(c) +
		LANE_ANNULUS_KM[1] / AU_KM +
		bodyRadiusBoundsKm(c).get(s.id)! / AU_KM;
	const interior = stationInterior(
		s.type,
		STATION_GEOMETRY[s.type].aperturePlaneKm,
		s.berthSeed,
	);
	const fitting = trafficBerths(interior).filter((b) =>
		berthFits(b, HULL_SPECS[hull].env),
	);
	if (!fitting.length)
		throw new Error(`no Traffic berth for ${hull} at ${s.id}`);
	const pose = stationPose(makeSystem(record, 0), s.id, 0);
	const frame = apertureFrame(s.type, pose.axis, pose.phaseRad, pose.reference);
	const entry = scale(frame.axis, frame.planeKm + 1e-6);
	const arrival = Math.max(
		...fitting.map(
			(b) =>
				beginArrival(frame, interior, b, entry, 0, {
					nose: scale(frame.axis, -1),
					up: slotBasis(frame).up,
				}).durationS,
		),
	);
	const launch = Math.max(
		...fitting.map((b) => beginLaunch(frame, interior, b, 0, 0).durationS),
	);
	// Same pacing law and smooth local speed gate as station-route. Spool shares
	// hyperspace's charge duration; local approach has a 50 km cruise drop.
	const cruise = legSeconds(
		{ x: 0, y: 0, z: 0 },
		{ pos: { x: distanceAu * AU_KM, y: 0, z: 0 }, radiusKm: 0 },
		[],
		DEFAULT_CRUISE,
	);
	const departure =
		(1.5 * (TRAFFIC_STATION_EXCLUSION_KM + TRAFFIC_STATION_RELEASE_MARGIN_KM)) /
		TRAFFIC_STATION_LOCAL_SPEED_KM_S;
	const tunnel =
		(1.5 * Math.hypot(5 + Math.abs(frame.planeKm), 3)) /
		TRAFFIC_STATION_LOCAL_SPEED_KM_S;
	const approach = DEFAULT_CRUISE.dropRadiusKm / 2;
	return {
		distanceAu,
		nominalOutS: launch + departure + JUMP_CHARGE_S + cruise + JUMP_CHARGE_S,
		nominalInS: JUMP_CHARGE_S + cruise + approach + tunnel + arrival,
	};
}

export function buildHaulerPlans(
	galaxy: Galaxy,
	homeIndex: number,
	contentsFor: ContentsQuery,
): HaulerPlan[] {
	const home = galaxy.systems.find((r) => r.index === homeIndex);
	if (!home) throw new Error(`no system ${homeIndex}`);
	const c = contentsFor(homeIndex);
	const neighbours = galaxy.systems
		.filter(
			(r) =>
				r.index !== homeIndex && distanceLy(home.pos, r.pos) <= TRAFFIC_TANK_LY,
		)
		.sort((a, b) => a.index - b.index);
	return c.stations
		.flatMap((s) =>
			stationTrafficRoster(homeIndex, s).map((base) => {
				const homeBounds = haulerBounds(home, c, s, base.hullId);
				const eligible: HaulerDestination[] = [];
				if (
					base.ordinal > 0 &&
					fnv1a(`${base.localCarrierId}|vocation|${s.berthSeed}`) /
						0x1_0000_0000 <
						HAULER_SHARE
				) {
					for (const r of neighbours) {
						if (
							r.galaxy !== home.galaxy ||
							distanceLy(home.pos, r.pos) > HULL_SPECS[base.hullId].tankLy
						)
							continue;
						const away = contentsFor(r.index);
						for (const dest of [...away.stations].sort((a, b) =>
							a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
						)) {
							const interior = stationInterior(
								dest.type,
								STATION_GEOMETRY[dest.type].aperturePlaneKm,
								dest.berthSeed,
							);
							if (
								!trafficBerths(interior).some((b) =>
									berthFits(b, HULL_SPECS[base.hullId].env),
								)
							)
								continue;
							const bounds = haulerBounds(r, away, dest, base.hullId);
							if (
								homeBounds.distanceAu + bounds.distanceAu <=
								HULL_SPECS[base.hullId].chargeAu
							)
								eligible.push({
									systemIndex: r.index,
									stationId: dest.id,
									bounds,
								});
						}
					}
				}
				const vocation = eligible.length
					? ("hauler" as const)
					: ("local" as const);
				const awayNeed =
					homeBounds.nominalOutS +
					HAULER_SLACK_S +
					Math.max(0, ...eligible.map((d) => d.bounds.nominalInS)) +
					TRAFFIC_MIN_DOCKED_S;
				const parkedNeed =
					Math.max(0, ...eligible.map((d) => d.bounds.nominalOutS)) +
					HAULER_SLACK_S +
					homeBounds.nominalInS +
					TRAFFIC_MIN_DOCKED_S;
				const cycleMultiple =
					vocation === "local"
						? 1
						: Math.max(
								1,
								Math.ceil(awayNeed / base.schedule.awayS),
								Math.ceil(
									parkedNeed /
										(base.schedule.cycleS * base.schedule.parkedDuty),
								),
							);
				const actor = stationTrafficRoster(homeIndex, s, () => ({
					vocation,
					cycleMultiple,
				}))[base.ordinal];
				return {
					actor,
					vocation,
					cycleMultiple,
					homeRecord: home,
					homeBounds,
					eligible,
				};
			}),
		)
		.sort((a, b) => compareCarrierKeys(a.actor.key, b.actor.key));
}
export function haulerVoyage(p: HaulerPlan, awayOrdinal: number): HaulerVoyage {
	if (!p.eligible.length)
		throw new Error(`local actor ${p.actor.key} has no voyage`);
	const d =
		p.eligible[
			(((p.actor.ordinal + awayOrdinal) % p.eligible.length) +
				p.eligible.length) %
				p.eligible.length
		];
	const awayBoundaryS =
		p.actor.schedule.departureAtS + awayOrdinal * p.actor.schedule.cycleS;
	const parkedBoundaryS = awayBoundaryS + p.actor.schedule.awayS;
	return {
		awayOrdinal,
		destinationSystemIndex: d.systemIndex,
		destinationStationId: d.stationId,
		awayBoundaryS,
		parkedBoundaryS,
		tOut: awayBoundaryS + p.homeBounds.nominalOutS + HAULER_SLACK_S,
		tBack: parkedBoundaryS + d.bounds.nominalOutS + HAULER_SLACK_S,
	};
}
export function lanePoint(
	record: SystemRecord,
	c: SystemContents,
	otherPos: Vec3,
	atS: number,
	key: CarrierKey,
	ordinal: number,
): { pos: Vec3; nose: Vec3 } {
	const bearing = normalize(sub(otherPos, record.pos));
	const planeBearing =
		(bearing.x || bearing.y || bearing.z) < 0 ? scale(bearing, -1) : bearing;
	const across = normalize(
		cross(
			planeBearing,
			Math.abs(bearing.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
		),
	);
	const up = cross(planeBearing, across);
	const hash = fnv1a(`${key}|lane|${ordinal}`);
	const radius =
		LANE_ANNULUS_KM[0] +
		((LANE_ANNULUS_KM[1] - LANE_ANNULUS_KM[0]) * hash) / 0x1_0000_0000;
	const angle = 2 * Math.PI * (fnv1a(`${hash}|angle`) / 0x1_0000_0000);
	return {
		pos: add(
			arrivalPoint(record, c, otherPos, atS),
			add(
				scale(across, radius * Math.cos(angle)),
				scale(up, radius * Math.sin(angle)),
			),
		),
		nose: scale(bearing, -1),
	};
}
/** Candidate generation is two hops, bounded by reach, never by clock age. */
export function inboundCandidates(
	galaxy: Galaxy,
	currentIndex: number,
	contentsFor: ContentsQuery,
): HaulerPlan[] {
	const current = galaxy.systems.find((r) => r.index === currentIndex)!;
	return galaxy.systems
		.filter(
			(r) =>
				r.galaxy === current.galaxy &&
				r.index !== currentIndex &&
				distanceLy(r.pos, current.pos) <= TRAFFIC_TANK_LY,
		)
		.flatMap((r) => buildHaulerPlans(galaxy, r.index, contentsFor))
		.filter(
			(p) =>
				p.vocation === "hauler" &&
				p.eligible.some((d) => d.systemIndex === currentIndex),
		)
		.sort((a, b) => compareCarrierKeys(a.actor.key, b.actor.key));
}
export function inboundHaulers(
	galaxy: Galaxy,
	currentIndex: number,
	atS: number,
	contentsFor: ContentsQuery,
	condition: (
		key: CarrierKey,
	) => string | { condition: string; rejoinsAtS: number },
): HaulerPlan[] {
	return inboundCandidates(galaxy, currentIndex, contentsFor).filter((p) => {
		const row = condition(p.actor.key);
		if (
			["destroyed", "repairing"].includes(
				typeof row === "string" ? row : row.condition,
			) ||
			(typeof row !== "string" && atS < row.rejoinsAtS)
		)
			return false;
		const ordinal = Math.floor(
			(atS - p.actor.schedule.departureAtS) / p.actor.schedule.cycleS,
		);
		if (ordinal < 0) return false;
		const v = haulerVoyage(p, ordinal);
		return (
			v.destinationSystemIndex === currentIndex &&
			atS >= v.tOut &&
			atS < v.tBack
		);
	});
}

import {
	projectTrafficLaneDeparture,
	type TrafficHaulerVoyage,
} from "./station-route";
const jumpChargeCache = new WeakMap<HaulerPlan, Map<string, number>>();
/** Only local lane endpoints cross the route seam; no foreign body/queue does. */
export function routeVoyages(
	galaxy: Galaxy,
	p: HaulerPlan,
	currentIndex: number,
	atS: number,
	contentsFor: ContentsQuery,
	activeOrdinal?: number,
	rejoinsAtS = 0,
): TrafficHaulerVoyage[] {
	const current = galaxy.systems.find((r) => r.index === currentIndex)!;
	const ordinal = Math.floor(
		(atS - p.actor.schedule.departureAtS) / p.actor.schedule.cycleS,
	);
	const ordinals = [
		...new Set(
			[activeOrdinal, ordinal - 1, Math.max(0, ordinal)].filter(
				(n): n is number => n !== undefined && n >= 0,
			),
		),
	].sort((a, b) => a - b);
	return ordinals.flatMap((n) => {
		const v = haulerVoyage(p, n);
		if (v.awayBoundaryS < rejoinsAtS || atS < rejoinsAtS) return [];
		const home = currentIndex === p.homeRecord.index;
		if (!home && currentIndex !== v.destinationSystemIndex) return [];
		const other = home
			? galaxy.systems.find((r) => r.index === v.destinationSystemIndex)!
			: p.homeRecord;
		const arrivalS = home ? v.tBack : v.tOut;
		const departureS = home ? v.tOut : v.tBack;
		const chargeKey = n + "|" + currentIndex;
		let charges = jumpChargeCache.get(p);
		if (!charges) {
			charges = new Map();
			jumpChargeCache.set(p, charges);
		}
		let arrivalChargeAu = charges.get(chargeKey);
		if (arrivalChargeAu === undefined && atS >= arrivalS) {
			const lane = {
				...lanePoint(
					other,
					contentsFor(other.index),
					current.pos,
					arrivalS,
					p.actor.key,
					n,
				),
				atS: arrivalS,
				chargeAu: HULL_SPECS[p.actor.hullId].chargeAu,
			};
			arrivalChargeAu = projectTrafficLaneDeparture({
				record: other,
				actor: p.actor,
				gameTime: arrivalS,
				stationId: home ? v.destinationStationId : p.actor.homeStationId,
				readyAtS: home ? v.parkedBoundaryS : v.awayBoundaryS,
				awayOrdinal: n,
				lane,
			}).chargeAu;
			if (charges.size >= 4) charges.delete(charges.keys().next().value!);
			charges.set(chargeKey, arrivalChargeAu);
		}
		return [
			{
				awayOrdinal: n,
				departureAtS: v.awayBoundaryS,
				parkedBoundaryS: v.parkedBoundaryS,
				stationId: home ? p.actor.homeStationId : v.destinationStationId,
				home,
				departure: {
					...lanePoint(
						current,
						contentsFor(currentIndex),
						other.pos,
						departureS,
						p.actor.key,
						n,
					),
					atS: departureS,
					chargeAu: HULL_SPECS[p.actor.hullId].chargeAu,
				},
				arrival: {
					...lanePoint(
						current,
						contentsFor(currentIndex),
						other.pos,
						arrivalS,
						p.actor.key,
						n,
					),
					atS: arrivalS,
					chargeAu: arrivalChargeAu ?? HULL_SPECS[p.actor.hullId].chargeAu,
				},
			},
		];
	});
}

import { type GalaxyEnvelope, effectiveCarrier } from "./world-state";
export function haulerAvailability(
	p: HaulerPlan,
	env: GalaxyEnvelope,
	atS: number,
): { condition: string; rejoinsAtS: number } {
	const row = env.objective[p.actor.key],
		latest = env.episodes[p.actor.key]?.latest;
	const completesAt =
		row?.recovery?.completesAt ??
		(latest && ["repair-complete", "replacement-complete"].includes(latest.kind)
			? latest.occurredAt
			: 0);
	return {
		condition: effectiveCarrier(env, p.actor.key, atS).condition,
		rejoinsAtS:
			completesAt > 0
				? nextTrafficDepartureAtS(p.actor.schedule, completesAt)
				: 0,
	};
}
export function trafficIdentityRecord(
	galaxy: Galaxy,
	key: CarrierKey,
): SystemRecord {
	const record = galaxy.systems.find((r) => r.index === systemIndexOfKey(key));
	if (!record) throw new Error("Traffic home record missing");
	return record;
}
