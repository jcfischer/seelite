/**
 * What a courier consignment is actually carrying, over a galaxy (#442).
 *
 * `bindCourier` takes the **cheapest tonne good both stations list**, read off
 * the fixed base price. Its own header calls that a proxy for *what this
 * economy has to spare* and not an export test, and #411 found the board
 * landing on Food at very nearly every station it touched. This measures that
 * rather than asserting it, and measures three candidate rules beside it, so
 * the choice is made against a spread instead of an impression.
 *
 * The question `ordinary-requests.md` D1 makes load-bearing is **texture**:
 * authored templates with live operands were chosen precisely so a job could
 * not ask a pilot to haul grain to a station that does not want grain, and a
 * rule that is live but nearly constant loses the variety D2's five families
 * were chosen to supply.
 *
 * Every figure here is computed through `jobs.ts` and `market.ts` and none is
 * restated; a non-finite number throws rather than being printed, which is the
 * guard `measure-job-pay.ts` carries for the same reason.
 *
 * Run: `npx tsx scripts/measure-courier-goods.ts` or `bun scripts/measure-courier-goods.ts`
 */
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import {
	NO_EXCLUDED_STATION,
	bindCourier,
	canPostJobs,
	deliveryCandidates,
	type BindContext,
	type JobDestination,
} from "../src/jobs";
import {
	type Commodity,
	marketRowAt,
	marketStationOf,
	stationCommodities,
} from "../src/market";
import { DOMAIN } from "../src/domains";
import { fnv1a, mix, seededRand } from "../src/rng";
import { type Station, generateContents } from "../src/system";

const GALAXY_SEED = 0x5ee11e;
const GALAXY_INDEX = 0;
const GAME_TIME_MIN = 0;

const finite = (label: string, value: number): number => {
	if (!Number.isFinite(value))
		throw new Error(`${label} is not finite: ${value}`);
	return value;
};

/** The base price a station quotes, with no fluctuation byte and no deficit —
 *  the same figure `bindCourier` sorts on. */
const basePriceCr = (
	commodity: Commodity,
	system: SystemRecord,
	station: Station,
): number =>
	finite(
		`base price of ${commodity.name}`,
		marketRowAt(
			commodity,
			system.economy,
			0,
			marketStationOf(station, system.seed).type,
		).priceCr,
	);

const listedAt = (station: Station, system: SystemRecord): Commodity[] => [
	...stationCommodities(marketStationOf(station, system.seed)),
];

/** The candidate pool `bindCourier` sorts: a legal tonne good both ends list. */
const pool = (
	system: SystemRecord,
	station: Station,
	destination: JobDestination,
): Commodity[] => {
	const there = new Set(
		listedAt(destination.station, destination.system).map((c) => c.name),
	);
	return listedAt(station, system).filter(
		(c) => there.has(c.name) && !c.sellOnly && !c.illegal && c.unit === "t",
	);
};

/**
 * The four rules, each a total order over the same pool.
 *
 * **The same pool for every rule**, which is the point: a comparison whose
 * arms are offered different menus measures the framing (#25). What differs is
 * only the key each sorts by, and every one breaks a tie by name so a run is
 * reproducible.
 */
const RULES = {
	/** Shipped: the cheapest thing both ends trade. */
	cheapest: (c: Commodity, from: SystemRecord, at: Station) =>
		basePriceCr(c, from, at),
	/**
	 * An **export**: the origin's negative-gradient goods are what its economy
	 * has a surplus of (`economy-trade.md` §2), and the steeper the gradient
	 * the more of a surplus. Sorted ascending on `gradient`, so the most
	 * negative comes first.
	 */
	export: (c: Commodity) => c.gradient,
	/**
	 * A **need**: what the destination's economy wants — the most positive
	 * gradient there, which is the same table read from the other end.
	 */
	need: (c: Commodity) => -c.gradient,
	/**
	 * The **spread**: the widest base-price gap between the two ends, which is
	 * what a freight desk would pay to move and what a trader would fly anyway.
	 */
	spread: (
		c: Commodity,
		from: SystemRecord,
		at: Station,
		destination: JobDestination,
	) =>
		-(
			basePriceCr(c, destination.system, destination.station) -
			basePriceCr(c, from, at)
		),
} as const;

type RuleName = keyof typeof RULES;
const RULE_NAMES = Object.keys(RULES) as RuleName[];

const pick = (
	rule: RuleName,
	candidates: Commodity[],
	from: SystemRecord,
	at: Station,
	destination: JobDestination,
): Commodity | null => {
	if (candidates.length === 0) return null;
	const key = RULES[rule];
	return [...candidates].sort(
		(a, b) =>
			key(a, from, at, destination) - key(b, from, at, destination) ||
			(a.name < b.name ? -1 : 1),
	)[0];
};

/** Every station in a galaxy that can post work, with its system. */
const postings = (systems: readonly SystemRecord[]) => {
	const out: { system: SystemRecord; station: Station }[] = [];
	for (const system of systems)
		for (const station of generateContents(system).stations)
			if (canPostJobs(station)) out.push({ system, station });
	return out;
};

const galaxy = generateGalaxy(GALAXY_SEED, GALAXY_INDEX);
const systems = galaxy.systems;
const places = postings(systems);

// The board a pilot actually sees at each station: `bindCourier`'s own
// destination draw, so the leg is the shipped one and only the good varies.
const counts: Record<RuleName, Map<string, number>> = {
	cheapest: new Map(),
	export: new Map(),
	need: new Map(),
	spread: new Map(),
};
/** Per system: which goods a pilot sees on the boards of that system. */
const perSystem = new Map<number, Record<RuleName, Set<string>>>();
let boards = 0;
let shippedAgrees = 0;

for (const { system, station } of places) {
	const key = carrierKey(system.index, station.localCarrierId);
	const candidates = deliveryCandidates(systems, system, generateContents, key);
	const ctx: BindContext = {
		galaxyIndex: GALAXY_INDEX,
		system,
		station,
		destinations: candidates,
		deficits: {},
		gameTimeMin: GAME_TIME_MIN,
		settled: {},
	};
	const shipped = bindCourier(ctx);
	if (!shipped) continue;
	// The destination `bindCourier` drew, recovered from the offer so every
	// rule is measured over the **same** leg.
	const destination = candidates.find(
		(d) =>
			carrierKey(d.system.index, d.station.localCarrierId) ===
			shipped.reportAt.carrierKey,
	);
	if (!destination) throw new Error(`no destination for ${shipped.id}`);
	const candidateGoods = pool(system, station, destination);
	boards += 1;
	const row =
		perSystem.get(system.index) ??
		({
			cheapest: new Set<string>(),
			export: new Set<string>(),
			need: new Set<string>(),
			spread: new Set<string>(),
		} as Record<RuleName, Set<string>>);
	perSystem.set(system.index, row);
	for (const rule of RULE_NAMES) {
		const good = pick(rule, candidateGoods, system, station, destination);
		if (!good) continue;
		counts[rule].set(good.name, (counts[rule].get(good.name) ?? 0) + 1);
		row[rule].add(good.name);
		// The control: the shipped rule reimplemented here must agree with
		// `bindCourier` itself, or every column below is measuring this file.
		if (rule === "cheapest" && good.name === shipped.goodName)
			shippedAgrees += 1;
	}
}

const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;

console.log(
	`galaxy ${GALAXY_INDEX} of seed 0x${GALAXY_SEED.toString(16)} · ${systems.length} systems · ${boards} courier boards\n`,
);
console.log(
	`control: the reimplemented cheapest rule agrees with bindCourier on ${shippedAgrees}/${boards} boards (${pct(shippedAgrees, boards)})`,
);
if (shippedAgrees !== boards)
	throw new Error(
		"the reimplemented shipped rule disagrees with bindCourier; every column below would be measuring this script",
	);

console.log("\nwhat a courier consignment is, per rule\n");
console.log(
	"rule      distinct  top good           share  second           share",
);
for (const rule of RULE_NAMES) {
	const rows = [...counts[rule].entries()].sort((a, b) => b[1] - a[1]);
	const [first, second] = rows;
	console.log(
		`${rule.padEnd(9)} ${String(rows.length).padStart(8)}  ${(first?.[0] ?? "—").padEnd(17)} ${pct(first?.[1] ?? 0, boards).padStart(5)}  ${(second?.[0] ?? "—").padEnd(15)} ${pct(second?.[1] ?? 0, boards).padStart(5)}`,
	);
}

// **What a pilot sees within one jump**, which is the node's own question.
// A system's neighbourhood is every system inside jump range, and the boards
// a pilot can reach without a second jump are that system's and its
// neighbours'.
console.log("\ndistinct goods on the boards within one jump\n");
console.log("rule       mean   min   max   systems seeing 1 good");
for (const rule of RULE_NAMES) {
	const spreads: number[] = [];
	let singletons = 0;
	for (const system of systems) {
		const seen = new Set<string>();
		for (const other of systems) {
			if (!perSystem.has(other.index)) continue;
			const near =
				other.index === system.index ||
				deliveryCandidates(
					systems,
					system,
					generateContents,
					NO_EXCLUDED_STATION,
				).some((d) => d.system.index === other.index);
			if (!near) continue;
			for (const good of perSystem.get(other.index)?.[rule] ?? [])
				seen.add(good);
		}
		if (seen.size === 0) continue;
		spreads.push(seen.size);
		if (seen.size === 1) singletons += 1;
	}
	const mean = spreads.reduce((a, b) => a + b, 0) / spreads.length;
	console.log(
		`${rule.padEnd(9)} ${finite(`${rule} mean`, mean).toFixed(2).padStart(6)} ${String(Math.min(...spreads)).padStart(5)} ${String(Math.max(...spreads)).padStart(5)}   ${singletons} of ${spreads.length} (${pct(singletons, spreads.length)})`,
	);
}

// **Varying the good across episodes at one requester**, which is the node's
// second question. Any rule above is a total order, so the top *k* of it is a
// pool a per-episode draw can pick from — the same shape `pickRow` already
// uses for prose. Measured at k = 3 over the spread rule, and over eight
// episodes of each board, because a second consignment from one freight desk
// not being the first one is the thing being asked about.
const EPISODES = 8;
const POOL_K = 3;
console.log(
	`\nspread, drawn from the top ${POOL_K} across ${EPISODES} episodes\n`,
);
{
	const seen = new Map<string, number>();
	const perStation: number[] = [];
	for (const { system, station } of places) {
		const key = carrierKey(system.index, station.localCarrierId);
		const candidates = deliveryCandidates(
			systems,
			system,
			generateContents,
			key,
		);
		const ctx: BindContext = {
			galaxyIndex: GALAXY_INDEX,
			system,
			station,
			destinations: candidates,
			deficits: {},
			gameTimeMin: GAME_TIME_MIN,
			settled: {},
		};
		const shipped = bindCourier(ctx);
		if (!shipped) continue;
		const destination = candidates.find(
			(d) =>
				carrierKey(d.system.index, d.station.localCarrierId) ===
				shipped.reportAt.carrierKey,
		);
		if (!destination) continue;
		const ranked = [...pool(system, station, destination)].sort(
			(a, b) =>
				RULES.spread(a, system, station, destination) -
					RULES.spread(b, system, station, destination) ||
				(a.name < b.name ? -1 : 1),
		);
		if (ranked.length === 0) continue;
		const here = new Set<string>();
		for (let episode = 1; episode <= EPISODES; episode += 1) {
			// Its own stream, so a board moves no station, berth or market —
			// `jobs.ts`'s own rule for every draw it makes.
			const roll = seededRand(
				mix(mix(fnv1a(key), DOMAIN.JOB_OFFERS), episode),
			)();
			const width = Math.min(POOL_K, ranked.length);
			const good = ranked[Math.min(Math.floor(roll * width), width - 1)];
			seen.set(good.name, (seen.get(good.name) ?? 0) + 1);
			here.add(good.name);
		}
		perStation.push(here.size);
	}
	const rows = [...seen.entries()].sort((a, b) => b[1] - a[1]);
	const total = rows.reduce((sum, [, n]) => sum + n, 0);
	const meanPerStation =
		perStation.reduce((a, b) => a + b, 0) / perStation.length;
	console.log(
		`  ${rows.length} distinct goods over ${total} draws; top ${rows[0]?.[0]} at ${pct(rows[0]?.[1] ?? 0, total)}`,
	);
	console.log(
		`  one freight desk shows ${finite("mean per station", meanPerStation).toFixed(2)} distinct goods across ${EPISODES} episodes (max ${Math.max(...perStation)})`,
	);
	for (const [good, n] of rows)
		console.log(
			`    ${good.padEnd(16)} ${String(n).padStart(4)}  ${pct(n, total)}`,
		);
}

console.log("\nfull distribution, shipped rule\n");
for (const [good, n] of [...counts.cheapest.entries()].sort(
	(a, b) => b[1] - a[1],
))
	console.log(
		`  ${good.padEnd(16)} ${String(n).padStart(4)}  ${pct(n, boards)}`,
	);
