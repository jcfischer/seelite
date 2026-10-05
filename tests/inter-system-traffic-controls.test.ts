/** Unchanged acceptance assertions run against isolated production mutants. */
import { expect, test } from "bun:test";
import { generateGalaxy, distanceLy } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { generateContents, arrivalPoint, placeBodies } from "../src/system";
import {
	stationInterior,
	trafficBerths,
	berthFits,
} from "../src/station-interior";
import { STATION_GEOMETRY, STATION_LAWFUL } from "../src/station";
import { length, sub } from "../src/vec3";
import { AU_KM } from "../src/units";
import {
	buildHaulerPlans,
	haulerVoyage,
	inboundHaulers,
	routeVoyages,
	trafficIdentityRecord,
} from "../src/inter-system-traffic";
import {
	projectSystemTrafficActor,
	projectSystemTrafficAuthority,
} from "../src/station-route";
import { carrierName } from "../src/carrier-name";
import { carrierManifest } from "../src/carrier-manifest";
import { carrierStanding } from "../src/carrier-standing";
const galaxy = generateGalaxy(47, 0);
const contents = new Map(
	galaxy.systems.map((r) => [r.index, generateContents(r)]),
);
const get = (i: number) => contents.get(i)!;
const fixture = buildHaulerPlans(galaxy, 0, get).find(
	(p) => p.vocation === "hauler",
)!;
const voyage = haulerVoyage(fixture, 0);

test("identity: equal home/destination name manifest standing", () => {
	const identity = (currentIndex: number) => {
		const r = trafficIdentityRecord(
			galaxy,
			fixture.actor.key,
			galaxy.systems.find((r) => r.index === currentIndex)!,
		);
		return {
			name: carrierName(r.seed, fixture.actor.key, 0),
			manifest: carrierManifest(r.seed, fixture.actor.key, 0, 0, {
				holdT: HULL_SPECS[fixture.actor.hullId].holdT,
				government: r.government,
			}),
			standing: carrierStanding(r.seed, fixture.actor.key, 0, voyage.tOut),
		};
	};
	expect(identity(0)).toEqual(identity(voyage.destinationSystemIndex));
});
test("late: injected committed home lane delays observed jump but not inbound", () => {
	const timeline = [
		{
			stationId: fixture.actor.homeStationId,
			kind: "lane" as const,
			fromS: voyage.awayBoundaryS,
			toS: voyage.tOut + 30,
			participant: { kind: "player" as const },
			movement: "launch" as const,
			committed: true,
		},
	];
	const projection = projectSystemTrafficActor({
		record: fixture.homeRecord,
		actor: fixture.actor,
		gameTime: voyage.tOut,
		playerTimeline: timeline,
		haulerVoyages: routeVoyages(galaxy, fixture, 0, voyage.tOut, get),
	});
	expect(projection.phase).toBe("launch-queued");
	const late = projectSystemTrafficActor({
		record: fixture.homeRecord,
		actor: fixture.actor,
		gameTime: voyage.tOut + 800,
		playerTimeline: timeline,
		haulerVoyages: routeVoyages(galaxy, fixture, 0, voyage.tOut + 800, get),
	});
	expect(late.phase).toBe("hyperspace-away");
	expect(late.jump?.atS).toBeGreaterThan(voyage.tOut);
	expect(
		inboundHaulers(
			galaxy,
			voyage.destinationSystemIndex,
			voyage.tOut,
			get,
			() => "operational",
		).some((p) => p.actor.key === fixture.actor.key),
	).toBe(true);
});
test("crossing: recomputing actual charge eligibility at a delayed outward crossing changes inbound destinations", () => {
	// A distant circular station makes actual-distance eligibility clock-dependent.
	// Its static bound still rejects it at every clock.
	const localContents = new Map(contents);
	localContents.set(1, structuredClone(contents.get(1)!));
	const get = (i: number) => localContents.get(i)!;
	const distant = get(1);
	for (const station of distant.stations) {
		station.parentId = null;
		station.orbit = {
			radiusKm: 9 * AU_KM,
			periodS: 2000,
			theta0: 0,
			inclination: 0,
			node: 0,
		};
	}
	let witness: { normal: string; delayed: string; static: string } | undefined;
	for (const record of galaxy.systems) {
		for (const p of buildHaulerPlans(galaxy, record.index, get).filter(
			(p) => p.vocation === "hauler",
		)) {
			const selectedAt = (time: number) => {
				const list: { systemIndex: number; stationId: string }[] = [];
				const homeStation = placeBodies(get(record.index), time).find(
					(b) => b.id === p.actor.homeStationId,
				)!;
				for (const dest of galaxy.systems) {
					if (
						dest.index === record.index ||
						distanceLy(record.pos, dest.pos) > HULL_SPECS[p.actor.hullId].tankLy
					)
						continue;
					const homeLane = arrivalPoint(
							record,
							get(record.index),
							dest.pos,
							time,
						),
						awayLane = arrivalPoint(dest, get(dest.index), record.pos, time);
					const homeLawful =
						STATION_LAWFUL[
							get(record.index).stations.find(
								(s) => s.id === p.actor.homeStationId,
							)!.type
						];
					for (const s of get(dest.index).stations) {
						if (STATION_LAWFUL[s.type] !== homeLawful) continue;
						const interior = stationInterior(
							s.type,
							STATION_GEOMETRY[s.type].aperturePlaneKm,
							s.berthSeed,
						);
						if (
							!trafficBerths(interior).some((b) =>
								berthFits(b, HULL_SPECS[p.actor.hullId].env),
							)
						)
							continue;
						const body = placeBodies(get(dest.index), time).find(
							(b) => b.id === s.id,
						)!;
						if (
							(length(sub(homeLane, homeStation.pos)) +
								length(sub(awayLane, body.pos))) /
								AU_KM <=
							HULL_SPECS[p.actor.hullId].chargeAu
						)
							list.push({ systemIndex: dest.index, stationId: s.id });
					}
				}
				list.sort(
					(a, b) =>
						a.systemIndex - b.systemIndex ||
						(a.stationId < b.stationId ? -1 : 1),
				);
				const d = list[p.actor.ordinal % list.length];
				return d ? `${d.systemIndex}:${d.stationId}` : "absent";
			};
			const v = haulerVoyage(p, 0);
			const lateAt = v.tOut + Math.min(30, (v.tBack - v.tOut) / 2);
			const normal = selectedAt(v.tOut);
			const delayed = selectedAt(lateAt);
			const staticDestination = `${v.destinationSystemIndex}:${v.destinationStationId}`;
			if (normal !== delayed && delayed !== staticDestination) {
				const observed = projectSystemTrafficAuthority({
					record: p.homeRecord,
					actor: p.actor,
					gameTime: lateAt + 0.01,
					haulerVoyages: routeVoyages(
						galaxy,
						p,
						record.index,
						lateAt + 0.01,
						get,
						0,
					),
					activeVisit: {
						departureAtS: v.awayBoundaryS,
						launchReadyAtS: v.awayBoundaryS,
						awayOrdinal: 0,
					},
					playerTimeline: [
						{
							stationId: p.actor.homeStationId,
							kind: "lane",
							fromS: v.awayBoundaryS,
							toS: lateAt,
							participant: { kind: "player" },
							movement: "launch",
							committed: true,
						},
					],
				});
				expect(observed.departureStartedAtS).toBe(lateAt);
				const destinationAt = (atS: number) => {
					const inbound = inboundHaulers(
						galaxy,
						v.destinationSystemIndex,
						atS,
						get,
						() => "operational",
					).find((candidate) => candidate.actor.key === p.actor.key);
					if (!inbound) return "absent";
					const received = haulerVoyage(inbound, 0);
					return `${received.destinationSystemIndex}:${received.destinationStationId}`;
				};
				// The far side receives the same voyage before and after the observed
				// home crossing is delayed. Assert the query's output, not the fixture.
				expect(destinationAt(v.tOut)).toBe(staticDestination);
				expect(destinationAt(lateAt)).toBe(staticDestination);
				witness = {
					normal,
					delayed,
					static: staticDestination,
				};
				break;
			}
		}
		if (witness) break;
	}
	expect(witness).toBeDefined();
	expect(witness!.normal).not.toBe(witness!.delayed);
});
