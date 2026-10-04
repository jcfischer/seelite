/** Manual §13.2 instrument. Prints every station, then corpus spreads. */
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import { stationInterior, trafficBerths } from "../src/station-interior";
import { STATION_GEOMETRY } from "../src/station";
import {
	buildHaulerPlans,
	haulerVoyage,
	HAULER_SHARE,
	inboundHaulers,
} from "../src/inter-system-traffic";
import { performance } from "node:perf_hooks";

const seeds = (process.env.TRAFFIC_SEEDS ?? "1,47,1234").split(",").map(Number);
const galaxyCount = Number(process.env.TRAFFIC_GALAXIES ?? 8);
const finite = (x: number) => {
	if (!Number.isFinite(x)) throw new Error(`non-finite instrument value ${x}`);
	return x;
};
if (
	!seeds.length ||
	seeds.some((x) => !Number.isInteger(x)) ||
	!Number.isInteger(galaxyCount) ||
	galaxyCount < 1 ||
	galaxyCount > 8
)
	throw new Error("invalid corpus");
const spread = (values: number[]) => {
	const a = values.map(finite).sort((a, b) => a - b);
	return {
		n: a.length,
		min: a[0],
		median: a[Math.floor(a.length / 2)],
		max: a.at(-1),
		mean: finite(a.reduce((x, y) => x + y, 0) / a.length),
	};
};
const shares: number[] = [],
	ratios: number[] = [],
	galaxyMax: number[] = [];
let stationCount = 0;
for (const seed of seeds)
	for (let index = 0; index < galaxyCount; index++) {
		const galaxy = generateGalaxy(seed, index);
		const contents = new Map(
			galaxy.systems.map((r) => [r.index, generateContents(r)]),
		);
		const get = (i: number) => contents.get(i)!;
		const plans = galaxy.systems.flatMap((r) =>
			buildHaulerPlans(galaxy, r.index, get),
		);
		const haulers = plans.filter((p) => p.vocation === "hauler");
		const slots = plans.filter((p) => p.actor.ordinal > 0).length;
		const realised = finite(haulers.length / slots);
		shares.push(realised);
		const perGalaxy: number[] = [];
		for (const record of galaxy.systems)
			for (const station of get(record.index).stations) {
				const capacity = trafficBerths(
					stationInterior(
						station.type,
						STATION_GEOMETRY[station.type].aperturePlaneKm,
						station.berthSeed,
					),
				).length;
				const candidates = haulers.filter((p) =>
					p.eligible.some(
						(d) => d.systemIndex === record.index && d.stationId === station.id,
					),
				);
				// One simulated day, 30 s samples. Max is sampled, never sold as a bound.
				let maxInbound = 0,
					total = 0;
				const samples = 2880;
				for (let k = 0; k < samples; k++) {
					const at = 86400 + k * 30;
					let inbound = 0;
					for (const p of candidates) {
						const n = Math.floor(
							(at - p.actor.schedule.departureAtS) / p.actor.schedule.cycleS,
						);
						const v = haulerVoyage(p, n);
						if (
							v.destinationSystemIndex === record.index &&
							v.destinationStationId === station.id &&
							at >= v.tOut &&
							at < v.tBack
						)
							inbound++;
					}
					maxInbound = Math.max(maxInbound, inbound);
					total += inbound;
				}
				const ratio = finite(maxInbound / capacity);
				ratios.push(ratio);
				perGalaxy.push(ratio);
				stationCount++;
				console.log(
					JSON.stringify({
						kind: "station",
						seed,
						galaxy: index,
						system: record.index,
						station: station.id,
						capacity,
						candidates: candidates.length,
						sampleStepS: 30,
						samples,
						meanInbound: finite(total / samples),
						maxInbound,
						maxInboundToCapacity: ratio,
					}),
				);
			}
		galaxyMax.push(Math.max(...perGalaxy));
		console.log(
			JSON.stringify({
				kind: "galaxy",
				seed,
				galaxy: index,
				nonSignatureSlots: slots,
				haulers: haulers.length,
				nominalShare: HAULER_SHARE,
				realisedShare: realised,
				maxSampledInboundToCapacity: Math.max(...perGalaxy),
			}),
		);
	}
// Cold costs include regeneration of both hops on every query, no retained cache.
const cold: {
	days: number;
	ms: number;
	systemsGenerated: number;
	haulers: number;
}[] = [];
for (const days of [1, 365])
	for (let run = 0; run < 7; run++) {
		const g = generateGalaxy(47, 0);
		let generated = 0;
		const cache = new Map<number, ReturnType<typeof generateContents>>();
		const start = performance.now();
		const inbound = inboundHaulers(
			g,
			0,
			days * 86400,
			(i) => {
				let c = cache.get(i);
				if (!c) {
					c = generateContents(g.systems.find((r) => r.index === i)!);
					cache.set(i, c);
					generated++;
				}
				return c;
			},
			() => "operational",
		);
		cold.push({
			days,
			ms: finite(performance.now() - start),
			systemsGenerated: generated,
			haulers: inbound.length,
		});
	}
console.log(
	JSON.stringify({
		kind: "summary",
		worldSeeds: seeds,
		galaxiesPerSeed: galaxyCount,
		galaxies: seeds.length * galaxyCount,
		stations: stationCount,
		nominalShare: HAULER_SHARE,
		realisedShare: spread(shares),
		stationMaxInboundToCapacity: spread(ratios),
		galaxyMaxInboundToCapacity: spread(galaxyMax),
		cold: [1, 365].map((days) => ({
			days,
			ms: spread(cold.filter((x) => x.days === days).map((x) => x.ms)),
			generatedSystems: spread(
				cold.filter((x) => x.days === days).map((x) => x.systemsGenerated),
			),
		})),
	}),
);
