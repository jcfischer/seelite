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
 * restated. `finite` guards the derived means rather than every printed
 * number: a share whose denominator is zero prints `NaN%`, and on a galaxy
 * with no courier board at all there is nothing to say anyway.
 *
 * **This file owns the figures**, so they are here rather than in `jobs.ts`,
 * where a copy would be a claim about one seed sitting on a module's public
 * surface. Measured on galaxy 0 of seed 0x5ee11e, 392 boards, at
 * `COURIER_SPREAD_POOL` 3: ten distinct goods over eight episodes with the top
 * at 17.3%, nine at 17.0% with the leg held. At 1 — one edit to the constant,
 * reverted — two goods at 45.7% and 45.3%, against the former cheapest rule's
 * Food at 94.6% of boards. Every one of them is reprinted by a run.
 *
 * Run: `npx tsx scripts/measure-courier-goods.ts` or `bun scripts/measure-courier-goods.ts`
 */
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy, type SystemRecord } from "../src/galaxy";
import {
	COURIER_SPREAD_POOL,
	NO_EXCLUDED_STATION,
	bindCourier,
	canPostJobs,
	cargoOf,
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

/** The courier's tank: this instrument models the baseline hull, and the
 *  reach is a hull's since #554 rather than the galaxy's constant. */
const COURIER_TANK_LY = HULL_SPECS[PLAYER_BASELINE_HULL].tankLy;
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

/** One `BindContext`, so a field added to it lands in one place here. */
const ctxFor = (
	system: SystemRecord,
	station: Station,
	destinations: JobDestination[],
	settled: Record<string, number> = {},
): BindContext => ({
	galaxyIndex: GALAXY_INDEX,
	system,
	station,
	destinations,
	deficits: {},
	gameTimeMin: GAME_TIME_MIN,
	settled,
	// This instrument measures the courier, which reads no bounty target.
	bountyTarget: null,
});

/** A courier offer's cargo; a courier always carries one (#508). */
const goodOf = (offer: Parameters<typeof cargoOf>[0]): string => {
	const cargo = cargoOf(offer);
	if (!cargo) throw new Error("a courier offer carried no cargo");
	return cargo.goodName;
};

/** The leg an offer names, recovered from the candidate list it was drawn
 *  from. A miss is drift, never a sample to skip. */
const legOf = (
	offer: { id: string; reportAt: { carrierKey: string } },
	candidates: JobDestination[],
): JobDestination => {
	const destination = candidates.find(
		(d) =>
			carrierKey(d.system.index, d.station.localCarrierId) ===
			offer.reportAt.carrierKey,
	);
	if (!destination) throw new Error(`no destination for ${offer.id}`);
	return destination;
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
	const candidates = deliveryCandidates(
		systems,
		system,
		generateContents,
		key,
		COURIER_TANK_LY,
	);
	const shipped = bindCourier(ctxFor(system, station, candidates));
	if (!shipped) continue;
	// The destination `bindCourier` drew, recovered from the offer so every
	// rule is measured over the **same** leg.
	const destination = legOf(shipped, candidates);
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
	}

	// **The control, and it is its own measurement rather than a column.** It
	// is no longer "cheapest agrees with bindCourier" — since #455 it does
	// not, and it is not meant to. What this file must not be allowed to do is
	// rank a pool the binder does not rank, so the check is **membership**:
	// the good `bindCourier` bound is in this file's own top
	// `COURIER_SPREAD_POOL` by spread, which needs no copy of the draw.
	//
	// **Membership is blind inside the set.** It catches a pool that has
	// drifted, and a ranking or tie-break change that moves a good across the
	// k-th position. It cannot see a reordering *within* the top k — those
	// goods are all admissible either way — and on a pool of
	// `COURIER_SPREAD_POOL` or fewer it passes for any good at all. The rank
	// distribution in `tests/jobs.test.ts` is what watches the order.
	const top = rankBy("spread", candidateGoods, system, station, destination)
		.slice(0, COURIER_SPREAD_POOL)
		.map((c) => c.name);
	if (top.includes(goodOf(shipped))) shippedAgrees += 1;
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
// A system's neighbourhood is the systems holding a destination a job may
// name — `deliveryCandidates`' own reach, so a system inside jump range with
// no eligible station is not counted — and the boards a pilot can reach
// without a second jump are that system's and its neighbours'.
console.log("\ndistinct goods on the boards within one jump\n");
console.log("rule       mean   min   max   systems seeing 1 good");
// Invariant in the loop below, so it is built once rather than re-derived per
// rule and per pair of systems.
const neighbours = new Map<number, Set<number>>();
for (const system of systems)
	neighbours.set(
		system.index,
		new Set([
			system.index,
			...deliveryCandidates(
				systems,
				system,
				generateContents,
				NO_EXCLUDED_STATION,
				COURIER_TANK_LY,
			).map((d) => d.system.index),
		]),
	);

for (const rule of RULE_NAMES) {
	const spreads: number[] = [];
	let singletons = 0;
	for (const system of systems) {
		const seen = new Set<string>();
		for (const other of systems) {
			if (!perSystem.has(other.index)) continue;
			if (!neighbours.get(system.index)?.has(other.index)) continue;
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
			COURIER_TANK_LY,
		);
		const offered = legFor(system, station, candidates);
		if (!offered) continue;
		const here = new Set<string>();
		for (let episode = 1; episode <= EPISODES; episode += 1) {
			const offer = bindCourier(
				ctxFor(system, station, offered, { courier: episode - 1 }),
			);
			if (!offer) continue;
			if (offer.episode !== episode)
				throw new Error(
					`episode ${episode} bound as ${offer.episode} at ${station.id}`,
				);
			const good = goodOf(offer);
			counts.set(good, (counts.get(good) ?? 0) + 1);
			here.add(good);
		}
		if (here.size > 0) perStation.push(here.size);
	}
	return { counts, perStation };
};

const sorted = (counts: Map<string, number>) =>
	[...counts.entries()].sort((a, b) => b[1] - a[1]);

const drawTotal = (counts: Map<string, number>) =>
	[...counts.values()].reduce((sum, n) => sum + n, 0);

const summarise = (counts: Map<string, number>) => {
	const rows = sorted(counts);
	const total = drawTotal(counts);
	console.log(
		`  ${rows.length} distinct goods over ${total} draws; top ${rows[0]?.[0]} at ${pct(rows[0]?.[1] ?? 0, total)}`,
	);
};

/** One row per good. `of` is the denominator a share is read against — the
 *  draws for an episode sweep, the boards for a per-board column. */
const listRows = (
	counts: Map<string, number>,
	of: number = drawTotal(counts),
	indent = "    ",
) => {
	for (const [good, n] of sorted(counts))
		console.log(
			`${indent}${good.padEnd(16)} ${String(n).padStart(4)}  ${pct(n, of)}`,
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
		`  one requester shows ${finite("mean per station", meanPerStation).toFixed(2)} distinct goods across ${EPISODES} episodes (max ${Math.max(...perStation)})`,
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
// **What agreement here is worth, and it is less than it reads.** The two
// draws are different streams, so neither the share nor the count is forced to
// match: which members of a top-3 set come up over eight finite episodes is as
// much the stream's as the share is. And the count is **near its own ceiling**
// — the shipped arm above names ten goods that ever appear at all, so nine is
// one short of everything observed and almost any non-degenerate draw over a
// three-wide pool would reach it. So read this as the prediction's framing
// reproduced rather than as a discriminating test; the membership control
// above and the rank distribution in `tests/jobs.test.ts` are what actually
// hold the rule.
console.log(
	`\nshipped, leg held: top ${COURIER_SPREAD_POOL} across ${EPISODES} episodes\n`,
);
{
	const { counts } = sweepEpisodes((system, station, all) => {
		const opening = bindCourier(ctxFor(system, station, all));
		if (!opening) return null;
		// `legOf` throws rather than returning null: a destination the offer
		// names and the candidate list does not hold is drift, and skipping it
		// would quietly shrink the sample the count rests on.
		return [legOf(opening, all)];
	});
	summarise(counts);
}

console.log("\nfull distribution, the former cheapest rule\n");
listRows(counts.cheapest, boards, "  ");
