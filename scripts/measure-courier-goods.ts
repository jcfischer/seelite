/**
 * What a courier consignment is actually carrying, over a galaxy (#442).
 *
 * `bindCourier` took the **cheapest tonne good both stations list** until #455;
 * its header called that a proxy for *what this economy has to spare* and not
 * an export test, and #411 found the board landing on Food at very nearly
 * every station it touched. This measured that rather than asserting it, and
 * measured three candidate rules beside it, so the choice was made against a
 * spread instead of an impression.
 *
 * **Since #455 the shipped rule is the spread one**, drawn per episode from
 * its top `COURIER_SPREAD_POOL`. The four ranking columns below are kept as
 * the comparison the decision was made on — `cheapest` is the former rule, not
 * the shipped one — and the shipped distribution is measured by calling
 * `bindCourier` across episodes rather than by a second copy of its draw.
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
	COURIER_SPREAD_POOL,
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
	/** The former rule (pre-#455): the cheapest thing both ends trade. */
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

/** The pool in one rule's order. One comparator, so a tie-break change lands
 *  in one place rather than in every caller that re-types it. */
const rankBy = (
	rule: RuleName,
	candidates: Commodity[],
	from: SystemRecord,
	at: Station,
	destination: JobDestination,
): Commodity[] => {
	const key = RULES[rule];
	return [...candidates].sort(
		(a, b) =>
			key(a, from, at, destination) - key(b, from, at, destination) ||
			(a.name < b.name ? -1 : 1),
	);
};

const pick = (
	rule: RuleName,
	candidates: Commodity[],
	from: SystemRecord,
	at: Station,
	destination: JobDestination,
): Commodity | null =>
	rankBy(rule, candidates, from, at, destination)[0] ?? null;

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
		// The control is no longer "cheapest agrees with bindCourier" — since
		// #455 it does not, and it is not meant to. What this file must not be
		// allowed to do is rank a pool the binder does not rank, so the check
		// is **membership**: the good `bindCourier` bound is in this file's own
		// top `COURIER_SPREAD_POOL` by spread. That is stream-independent — it
		// catches a pool, a ranking or a tie-break that has drifted apart,
		// without a second copy of the draw.
		if (rule === "spread") {
			const top = rankBy("spread", candidateGoods, system, station, destination)
				.slice(0, COURIER_SPREAD_POOL)
				.map((c) => c.name);
			if (top.includes(shipped.goodName)) shippedAgrees += 1;
		}
	}
}

const pct = (n: number, of: number) => `${((100 * n) / of).toFixed(1)}%`;

console.log(
	`galaxy ${GALAXY_INDEX} of seed 0x${GALAXY_SEED.toString(16)} · ${systems.length} systems · ${boards} courier boards\n`,
);
console.log(
	`control: bindCourier's good is in this file's top ${COURIER_SPREAD_POOL} by spread on ${shippedAgrees}/${boards} boards (${pct(shippedAgrees, boards)})`,
);
if (shippedAgrees !== boards)
	throw new Error(
		"the reimplemented spread ranking disagrees with bindCourier; every column below would be measuring this script",
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

// **Varying the good across episodes at one requester**, which was the node's
// second question and is now the shipped rule. Both arms below measure
// `bindCourier` itself across episodes — the draw is not reimplemented here,
// because after #455 a copy of it in this file would be the thing under test
// measuring itself.
const EPISODES = 8;

/** Eight episodes of every board, counting the cargo `bindCourier` binds.
 *  `legFor` chooses what the binder is offered: every candidate, which is the
 *  game, or the one destination it drew first, which is the framing #442's
 *  prediction was made on. */
const sweepEpisodes = (
	legFor: (
		system: SystemRecord,
		station: Station,
		candidates: JobDestination[],
	) => JobDestination[] | null,
): { counts: Map<string, number>; perStation: number[] } => {
	const counts = new Map<string, number>();
	const perStation: number[] = [];
	for (const { system, station } of places) {
		const key = carrierKey(system.index, station.localCarrierId);
		const candidates = deliveryCandidates(
			systems,
			system,
			generateContents,
			key,
		);
		const offered = legFor(system, station, candidates);
		if (!offered) continue;
		const here = new Set<string>();
		for (let episode = 1; episode <= EPISODES; episode += 1) {
			const offer = bindCourier({
				galaxyIndex: GALAXY_INDEX,
				system,
				station,
				destinations: offered,
				deficits: {},
				gameTimeMin: GAME_TIME_MIN,
				settled: { courier: episode - 1 },
			});
			if (!offer) continue;
			if (offer.episode !== episode)
				throw new Error(
					`episode ${episode} bound as ${offer.episode} at ${station.id}`,
				);
			counts.set(offer.goodName, (counts.get(offer.goodName) ?? 0) + 1);
			here.add(offer.goodName);
		}
		if (here.size > 0) perStation.push(here.size);
	}
	return { counts, perStation };
};

const sorted = (counts: Map<string, number>) =>
	[...counts.entries()].sort((a, b) => b[1] - a[1]);

const summarise = (counts: Map<string, number>) => {
	const rows = sorted(counts);
	const total = rows.reduce((sum, [, n]) => sum + n, 0);
	console.log(
		`  ${rows.length} distinct goods over ${total} draws; top ${rows[0]?.[0]} at ${pct(rows[0]?.[1] ?? 0, total)}`,
	);
};

const listRows = (counts: Map<string, number>) => {
	const rows = sorted(counts);
	const total = rows.reduce((sum, [, n]) => sum + n, 0);
	for (const [good, n] of rows)
		console.log(
			`    ${good.padEnd(16)} ${String(n).padStart(4)}  ${pct(n, total)}`,
		);
};

console.log(
	`\nshipped: drawn from the top ${COURIER_SPREAD_POOL} across ${EPISODES} episodes\n`,
);
{
	const { counts, perStation } = sweepEpisodes((_system, _station, all) => all);
	const meanPerStation =
		perStation.reduce((a, b) => a + b, 0) / perStation.length;
	summarise(counts);
	console.log(
		`  one freight desk shows ${finite("mean per station", meanPerStation).toFixed(2)} distinct goods across ${EPISODES} episodes (max ${Math.max(...perStation)})`,
	);
	listRows(counts);
}

// **The arm the prediction is read against.** #442's candidate column held the
// leg still — it drew one destination and ran eight episodes of the good draw
// over that one pool — while the shipped rule redraws the destination every
// episode too. So the section above is a wider set than the prediction by
// construction, and comparing the two straight compares two experiments. Here
// the leg is pinned by handing `bindCourier` a one-destination context, which
// is the binder's own draw on the prediction's framing.
//
// **What agreement here is worth.** The two draws are different streams, so
// neither the share nor the count is forced to match: which members of a top-3
// set come up over eight finite episodes is as much the stream's as the share
// is. The count agreeing is evidence that the pool and the ranking are the
// same, not a proof that they are — it is the strongest arm available without
// copying the shipped draw into this file, which is the thing that would make
// the control circular.
console.log(
	`\nshipped, leg held: top ${COURIER_SPREAD_POOL} across ${EPISODES} episodes\n`,
);
{
	const { counts } = sweepEpisodes((system, station, all) => {
		const opening = bindCourier({
			galaxyIndex: GALAXY_INDEX,
			system,
			station,
			destinations: all,
			deficits: {},
			gameTimeMin: GAME_TIME_MIN,
			settled: {},
		});
		if (!opening) return null;
		const destination = all.find(
			(d) =>
				carrierKey(d.system.index, d.station.localCarrierId) ===
				opening.reportAt.carrierKey,
		);
		// The first loop throws on this and so does this one: a destination the
		// offer names and the candidate list does not hold is drift, and
		// skipping it would quietly shrink the sample the count rests on.
		if (!destination) throw new Error(`no destination for ${opening.id}`);
		return [destination];
	});
	summarise(counts);
}

console.log("\nfull distribution, the former cheapest rule\n");
for (const [good, n] of [...counts.cheapest.entries()].sort(
	(a, b) => b[1] - a[1],
))
	console.log(
		`  ${good.padEnd(16)} ${String(n).padStart(4)}  ${pct(n, boards)}`,
	);
