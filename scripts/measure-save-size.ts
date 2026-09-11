/**
 * Worst-case save size, measured rather than guessed (#89, shipped by #90).
 *
 * Enumerates every generated carrier — stations plus #148's Traffic roster —
 * through the real generator, fills the largest representable row in each of
 * `persistent-world-state.md` §9.8's three per-carrier domains, and reports the
 * serialized size and the cost of one round trip.
 *
 * **T1 is a ceiling, not a save.** A Traffic actor's hull, callsign, schedule
 * and berth are `f(station, berthSeed)` and re-derive on system entry; a row
 * exists only where the player changed something. So T1 is the state of someone
 * who has personally destroyed all 21,570 Traffic ships in all eight galaxies,
 * and **T5 and T6 are what play actually writes**. The first framing of #89's
 * evidence presented T1 as a storage requirement and the principal rejected the
 * reading; the tier names say which is which so the next reader cannot repeat
 * it.
 *
 * **The timings are not a browser's.** They are `serializeWorld` +
 * `JSON.stringify` and `parseWorld` + `JSON.parse` under bun. No IndexedDB
 * transaction is in them, and they price no part of a hitch a player would
 * feel — `scripts/probe-save.mjs` is what does that.
 *
 * The figures are **not restated in prose anywhere**. This script is their one
 * owner, so a run reprints them rather than a reader trusting a table that has
 * had a chance to go stale.
 *
 * ```
 * npx tsx scripts/measure-save-size.ts     # or: bun scripts/measure-save-size.ts
 * ```
 */

import { carrierKey } from "../src/carrier-key";
import { GALAXY_COUNT } from "../src/world-state";
import { generateGalaxy } from "../src/galaxy";
import { COMMODITIES } from "../src/market";
import { stationTrafficRoster } from "../src/station-traffic";
import { generateContents } from "../src/system";
import {
	type GalaxyEnvelope,
	newWorld,
	parseWorld,
	serializeWorld,
	type WorldState,
} from "../src/world-state";

const SEED = 1;
const GOODS = COMMODITIES.map((c) => c.name);

interface Tier {
	name: string;
	systems: number;
	galaxies: number;
	traffic: boolean;
	knowledge: boolean;
	objective: boolean;
	deficitGoods: number;
}

const TIERS: Tier[] = [
	{
		name: "T1 saturated: every carrier incl. Traffic, all 8 galaxies",
		systems: 256,
		galaxies: 8,
		traffic: true,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
	},
	{
		name: "T2 stations only, all 8 galaxies saturated",
		systems: 256,
		galaxies: 8,
		traffic: false,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
	},
	{
		name: "T3 one galaxy saturated incl. Traffic",
		systems: 256,
		galaxies: 1,
		traffic: true,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
	},
	{
		name: "T4 one galaxy, stations only, saturated",
		systems: 256,
		galaxies: 1,
		traffic: false,
		knowledge: true,
		objective: true,
		deficitGoods: 17,
	},
	{
		name: "T5 heavy play: 200 systems, stations, knowledge+deficits",
		systems: 200,
		galaxies: 1,
		traffic: false,
		knowledge: true,
		objective: false,
		deficitGoods: 6,
	},
	{
		name: "T6 typical: 50 systems, stations, knowledge+deficits",
		systems: 50,
		galaxies: 1,
		traffic: false,
		knowledge: true,
		objective: false,
		deficitGoods: 4,
	},
];

/** Every figure below goes through this. An instrument that quietly reports
 *  garbage is worse than one that dies, because its numbers get transcribed
 *  into a spec (the map's constraint, from #7). */
const finite = (what: string, value: number): number => {
	if (!Number.isFinite(value)) throw new Error(`${what} is ${value}`);
	return value;
};

interface Row {
	name: string;
	carriers: number;
	kibUtf16: number;
	kibUtf8: number;
	writeMs: number;
	readMs: number;
}

function build(tier: Tier): Row {
	const world: WorldState = newWorld(SEED);
	let carriers = 0;
	for (let g = 0; g < tier.galaxies && g < GALAXY_COUNT; g++) {
		const galaxy = generateGalaxy(SEED, g);
		const env: GalaxyEnvelope = world.galaxies[g];
		const records = galaxy.systems.slice(0, tier.systems);
		let inGalaxy = 0;
		env.visited = records.map((_, i) => i);
		for (const record of records) {
			const contents = generateContents(record);
			const keys: string[] = [];
			for (const station of contents.stations) {
				keys.push(carrierKey(record.index, station.localCarrierId));
				if (tier.traffic)
					for (const actor of stationTrafficRoster(record.index, station))
						keys.push(actor.key);
			}
			for (const key of keys as ReturnType<typeof carrierKey>[]) {
				carriers++;
				inGalaxy++;
				if (tier.objective) {
					env.objective[key] = {
						instanceOrdinal: 3,
						condition: "repairing",
						recovery: {
							kind: "replacement",
							processId: `${key}#e7#replacement`,
							consequenceArea: "station-services",
							startedAt: 123456.789,
							completesAt: 234567.891,
							initiatedBy: {
								causeKind: "player-attack",
								actorId: "player",
								playerRole: "direct",
							},
						},
					};
					const fact = (kind: "destroy" | "replacement-start" | "interrupt") =>
						({
							key,
							instanceOrdinal: 3,
							episodeOrdinal: 7,
							kind,
							occurredAt: 123456.789,
							cause: {
								causeKind: "player-attack",
								actorId: "player",
								playerRole: "direct",
							},
							processId: `${key}#e7#replacement`,
						}) as const;
					env.episodes[key] = {
						ordinal: 7,
						initiating: fact("destroy"),
						intervention: fact("replacement-start"),
						latest: fact("interrupt"),
						closed: false,
					};
				}
				if (tier.knowledge)
					env.knowledge[key] = {
						observedInstanceOrdinal: 1,
						observedCondition: "operational",
						observedAt: 123456.789,
						source: "system-relay",
						knownPrivateFacts: {
							blackMarket: { learnedAt: 123456.789, source: "docking" },
						},
					};
				if (tier.deficitGoods > 0) {
					const goods: Record<string, number> = {};
					for (const name of GOODS.slice(0, tier.deficitGoods))
						goods[name] = -63.4;
					env.deficits[key] = { goods, updatedAt: 123456.789 };
				}
			}
		}
		// **Keys must be distinct per carrier**, or the counter and the store
		// disagree and every size below is understated. `parseWorld` cannot see
		// this: a colliding key is a perfectly well-formed row that happens to
		// have overwritten another.
		const check = (domain: string, count: number) => {
			if (count !== inGalaxy)
				throw new Error(
					`galaxy ${g}: ${inGalaxy} carriers but ${count} ${domain} rows — colliding keys`,
				);
		};
		if (tier.objective) check("objective", Object.keys(env.objective).length);
		if (tier.knowledge) check("knowledge", Object.keys(env.knowledge).length);
		if (tier.deficitGoods > 0)
			check("deficit", Object.keys(env.deficits).length);
	}
	const t0 = performance.now();
	const json = JSON.stringify(serializeWorld(world));
	const t1 = performance.now();
	parseWorld(JSON.parse(json));
	const t2 = performance.now();
	return {
		name: tier.name,
		carriers: finite("carriers", carriers),
		kibUtf16: finite("kibUtf16", Math.round((json.length * 2) / 1024)),
		kibUtf8: finite(
			"kibUtf8",
			Math.round(new TextEncoder().encode(json).length / 1024),
		),
		writeMs: finite("writeMs", Number((t1 - t0).toFixed(1))),
		readMs: finite("readMs", Number((t2 - t1).toFixed(1))),
	};
}

const rows = TIERS.map(build);
console.log(
	"| Tier | Carriers | KiB UTF-16 | KiB UTF-8 | write ms | read ms |",
);
console.log("|---|---|---|---|---|---|");
for (const row of rows)
	console.log(
		`| ${row.name} | ${row.carriers} | ${row.kibUtf16} | ${row.kibUtf8} | ${row.writeMs} | ${row.readMs} |`,
	);
