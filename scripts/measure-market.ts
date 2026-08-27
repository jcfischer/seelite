/**
 * The instrument behind `economy-trade.md` §2, §3, §5 and §8.
 *
 * Five claims in that spec are numbers, and a number in prose with no committed
 * way to re-derive it is the failure `measure-clamp-bite.ts` exists to answer:
 *
 * 1. **§2.2 — what the clamp costs.** Replacing Bell's `& 0xFF` wrap changes a
 *    price only where the raw byte leaves 0…255. How often is that, and which
 *    goods does it flatten?
 * 2. **§2.3 — was the Narcotics retune necessary?** Bell's own row is measured
 *    here beside the shipped one, or the divergence's justification is prose.
 * 3. **§3 — does the price floor bite?** A floor that fires often is a price
 *    rule that is a constant, which is what #13 disqualified the economy-shift
 *    form for.
 * 4. **§5.4/§8 — does intra-system trade beat interstellar trade?** Type
 *    offsets span 5 steps within one system; the economy spans 7 across the
 *    galaxy. If the first is comparable to the second, the galaxy collapses
 *    into single-system loops.
 * 5. **§5.4 — does the stock deficit exhaust the loop?** The brake is the
 *    reason (4) is safe. It has to be measured, not asserted.
 *
 * **Every number is computed through `market-math.ts`.** The first version of
 * this script hand-rolled the byte close, the floor check and its own copy of
 * `TYPE_OFFSET`, which is exactly the second copy that module exists to
 * prevent — a retune there would have silently invalidated the figures here.
 *
 *   bun run scripts/measure-market.ts [worldCount]
 */

import {
	type ByteClose,
	COMMODITIES,
	type Commodity,
	HOLD_REFERENCE_T,
	SATURATE,
	type StationTypeKey,
	commodity,
	marketRowAt,
} from "../src/market";
import {
	ALL_STATIONS,
	BELL_WRAP,
	CLOSABLE_RATIO,
	FLUCT_PAIRS,
	NARCOTICS_BELL,
	OFFSET_STATIONS,
	bestMargin,
	bestResidualBetween,
	bestRunValueCr,
	floorRate,
	forEachLegalPair,
	residualMarginCr,
	runsToExhaustion,
	surveyResiduals,
	sweepDomain,
} from "../tests/helpers/market-math";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";
import { JUMP_RANGE_LY, distanceLy } from "../src/galaxy";
import type { Vec3 } from "../src/vec3";

/**
 * Every number printed goes through here.
 *
 * A rename once left `marketRow` reading a *function* as its commodity, so
 * every field was `undefined`, every price was NaN, and the table printed
 * "NaN–NaN" with a 100% overflow rate while the suite stayed green — the
 * instrument's whole claim to re-derive §2.2's figures, quietly false. A
 * reported NaN is now a crash rather than a row.
 */
function fixed(value: number, places: number): string {
	if (!Number.isFinite(value))
		throw new Error(`instrument produced a non-finite figure: ${value}`);
	return value.toFixed(places);
}

const pct = (n: number, d: number) => `${fixed((100 * n) / d, 2)}%`;

// ── 1. What the clamp costs, per good ───────────────────────────────────────
//
// Swept over the whole input space rather than sampled: 17 goods × 8 economies
// × 256 fluctuation bytes is 34,816 rows, so there is no reason to estimate.

console.log("── §2.2: overflow under Bell's wrap, per good ──");
console.log("good              overflows   wrap Cr range     clamp Cr range");

interface Span {
	lo: number;
	hi: number;
}
const span = (): Span => ({ lo: Number.POSITIVE_INFINITY, hi: 0 });
const widen = (s: Span, v: number) => {
	s.lo = Math.min(s.lo, v);
	s.hi = Math.max(s.hi, v);
};
const fmt = (s: Span) => `${fixed(s.lo, 1)}–${fixed(s.hi, 1)}`;

/** Measures one good. Printing is the caller's, so `filter(report)` cannot read
 *  as a filter with a side effect. */
function measure(good: Commodity): {
	overflowRate: number;
	wrapSpan: Span;
	clampSpan: Span;
	collapsed: boolean;
} {
	const wrapSpan = span();
	const clampSpan = span();
	const { hits, rows } = sweepDomain((economy, fluct) => {
		widen(
			wrapSpan,
			marketRowAt(good, economy, fluct, "trade", BELL_WRAP).priceCr,
		);
		const clamped = marketRowAt(good, economy, fluct, "trade", SATURATE);
		widen(clampSpan, clamped.priceCr);
		return clamped.priceOverflowed;
	});
	// A good whose clamped span is a small fraction of its wrapped span has had
	// its price variation removed, not merely tidied.
	const wrapWidth = wrapSpan.hi - wrapSpan.lo;
	return {
		overflowRate: hits / rows,
		wrapSpan,
		clampSpan,
		collapsed:
			wrapWidth > 0 && (clampSpan.hi - clampSpan.lo) / wrapWidth < 0.25,
	};
}

function print(label: string, m: ReturnType<typeof measure>): void {
	console.log(
		`${label.padEnd(16)}  ${`${fixed(100 * m.overflowRate, 2)}%`.padStart(7)}   ` +
			`${fmt(m.wrapSpan).padStart(13)}     ${fmt(m.clampSpan).padStart(13)}`,
	);
}

const flattened: string[] = [];
for (const good of COMMODITIES) {
	const m = measure(good);
	print(good.name, m);
	if (m.collapsed) flattened.push(good.name);
}
console.log(
	`\nshipped table — goods whose price span collapses under the clamp: ${
		flattened.join(", ") || "none"
	}`,
);

// ── 2. Bell's Narcotics row, which the retune replaced ──────────────────────

console.log("\n── §2.3: the row the retune replaced ──");
const bell = measure(NARCOTICS_BELL);
print("Narcotics (Bell)", bell);
console.log(`Bell's row collapses under the clamp: ${bell.collapsed}`);

console.log(
	"\nbest margin, refinery → refinery (a fence is a refinery; blackMarket does not price)",
);
const NARCOTICS_ROWS: [string, Commodity, ByteClose][] = [
	["Bell + wrap", NARCOTICS_BELL, BELL_WRAP],
	["Bell + clamp", NARCOTICS_BELL, SATURATE],
	["seelite + clamp", commodity("Narcotics"), SATURATE],
];
for (const [label, good, mode] of NARCOTICS_ROWS) {
	const { margin, inStock } = bestMargin(good, "refinery", "refinery", mode);
	console.log(
		`${label.padEnd(18)} ${margin.toFixed(1).padStart(6)} Cr/t   in stock ${(
			100 * inStock
		).toFixed(0)}%`,
	);
}

console.log("\nall three illegal goods, shipped table:");
for (const good of COMMODITIES.filter((c) => c.illegal)) {
	const { margin, inStock } = bestMargin(good, "refinery", "refinery");
	console.log(
		`  ${good.name.padEnd(12)} ${margin.toFixed(1).padStart(6)} Cr/t   in stock ${(
			100 * inStock
		).toFixed(0)}%`,
	);
}

// ── 3. Does the §3 price floor bite? ────────────────────────────────────────

console.log("\n── §3: how often the 0.4 Cr floor fires ──");
const floorRateLine = (stations: readonly StationTypeKey[]): string => {
	const { fired, rows } = floorRate(stations);
	return `${pct(fired, rows)} of ${rows} rows`;
};
// The two figures differ because the trade station's offset is zero, so its
// rows can never fire and only pad the denominator. The first is the honest one.
console.log(
	`offset types only (refinery, shipyard): ${floorRateLine(OFFSET_STATIONS)}`,
);
console.log(
	`all three types:                        ${floorRateLine(ALL_STATIONS)}`,
);

// ── 4. Intra-system vs interstellar margin, on the real galaxy ──────────────

const worlds = worldSeeds(Number(process.argv[2] ?? 8));

interface SystemMarket {
	economy: number;
	stations: StationTypeKey[];
	pos: Vec3;
}
const systems: SystemMarket[] = [];
/** Keyed by world and galaxy: a jump never crosses either. */
const byGalaxy = new Map<string, SystemMarket[]>();

for (const world of worlds) {
	forEachSystem(world, ALL_GALAXIES, (record, contents, galaxy) => {
		if (contents.stations.length === 0) return;
		const entry: SystemMarket = {
			economy: record.economy,
			stations: contents.stations.map((s) => s.type as StationTypeKey),
			pos: record.pos,
		};
		systems.push(entry);
		const key = `${world}:${galaxy}`;
		const bucket = byGalaxy.get(key);
		if (bucket) bucket.push(entry);
		else byGalaxy.set(key, [entry]);
	});
}

interface Endpoint {
	economy: number;
	station: StationTypeKey;
	fluct: number;
}

/**
 * Best per-tonne margin between two concrete endpoints.
 *
 * Each endpoint carries its **own** fluctuation byte, because the two stations
 * have different seeds (§5.1). A struct per endpoint rather than six positional
 * arguments is what makes a call site legible about which side is which.
 */
function pairMargin(
	buy: Endpoint,
	sell: Endpoint,
): { margin: number; good: string } {
	// Illegal goods are excluded unconditionally: §4 scopes contraband to
	// fences, so it cannot fly these legs at any price. This was a `legalOnly`
	// parameter that all three call sites left at its default.
	let best = { margin: 0, good: "—" };
	for (const candidate of COMMODITIES) {
		if (candidate.sellOnly) continue;
		if (candidate.illegal) continue;
		if (candidate.unit !== "t") continue; // §6: sub-tonne goods skip the hold
		const b = marketRowAt(candidate, buy.economy, buy.fluct, buy.station);
		if (b.quantity === 0) continue;
		const s = marketRowAt(candidate, sell.economy, sell.fluct, sell.station);
		if (s.priceCr - b.priceCr > best.margin)
			best = { margin: s.priceCr - b.priceCr, good: candidate.name };
	}
	return best;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

/**
 * Best margin over every station pairing between two systems, averaged across
 * the independent fluctuation draws. `skipSelf` excludes a station trading with
 * itself, which is the only difference between the intra- and inter-system
 * sweeps — they were two near-identical blocks before.
 */
function bestBetween(
	from: SystemMarket,
	to: SystemMarket,
	skipSelf: boolean,
): number {
	return avg(
		FLUCT_PAIRS.map(([buyFluct, sellFluct]) => {
			let best = 0;
			for (const buy of from.stations)
				for (const sell of to.stations) {
					if (skipSelf && buy === sell) continue;
					best = Math.max(
						best,
						pairMargin(
							{ economy: from.economy, station: buy, fluct: buyFluct },
							{ economy: to.economy, station: sell, fluct: sellFluct },
						).margin,
					);
				}
			return best;
		}),
	);
}

/**
 * Every sampled origin paired with reachable destinations inside one galaxy.
 *
 * §4's route-margin sweep and §8's saturated comparison each had this walk
 * written out — same bucket loop, same `distanceLy > JUMP_RANGE_LY` skip,
 * differing only in stride and destination cap. A change to the reachability
 * rule had to land in both, or the two reported figures would sample different
 * route sets while claiming to be comparable.
 */
function forEachReachablePair(
	opts: { stride: number; maxDest: number },
	visit: (from: SystemMarket, to: SystemMarket) => void,
): { origins: number; unreachable: number } {
	let origins = 0;
	let unreachable = 0;
	for (const bucket of byGalaxy.values())
		for (let i = 0; i < bucket.length; i += opts.stride) {
			const from = bucket[i];
			origins++;
			let paired = 0;
			for (let j = 0; j < bucket.length && paired < opts.maxDest; j++) {
				if (j === i) continue;
				const to = bucket[j];
				if (distanceLy(from.pos, to.pos) > JUMP_RANGE_LY) continue;
				paired++;
				visit(from, to);
			}
			if (paired === 0) unreachable++;
		}
	return { origins, unreachable };
}

const intra: number[] = [];
let multiStation = 0;
for (const system of systems) {
	if (system.stations.length < 2) continue;
	// `bestBetween(..., skipSelf)` compares station *types*, which is only the
	// same as comparing identities because `generateStations` emits at most one
	// station per type (`src/system.ts`: fixed ids station-trade /
	// station-refinery / station-shipyard). If that ever changes, same-type
	// pairs would silently score 0 and drag the intra-system mean down.
	if (new Set(system.stations).size !== system.stations.length)
		throw new Error(
			"a system has two stations of one type — bestBetween's self-check is no longer identity",
		);
	multiStation++;
	intra.push(bestBetween(system, system, true));
}

/**
 * Interstellar, over pairs a player can actually fly.
 *
 * **An earlier version paired systems adjacent in generation order** with
 * `i += 97`, across every world and galaxy and with no jump-range check. That
 * is a baseline no ship can reach — and §5.4's whole "interstellar trade wins,
 * so intra-system loops are safe" conclusion rests on this number. Pairs are
 * now drawn within `JUMP_RANGE_LY` inside a single galaxy, which is what one
 * hyperspace jump actually offers.
 */
const inter: number[] = [];
// Destinations are the first `maxDest` in generation order that fall inside the
// jump range — a sample, not a census, and not the nearest four. An earlier
// version had no range check at all, which admitted pairs no ship can fly.
const interSample = forEachReachablePair(
	{ stride: 8, maxDest: 4 },
	(from, to) => inter.push(bestBetween(from, to, false)),
);
const unreachable = interSample.unreachable;

const quantile = (xs: number[], q: number) =>
	[...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] ?? 0;

console.log(
	"\n── §5.4/§8: intra-system vs interstellar margin (Cr/t, legal goods) ──",
);
console.log(
	`worlds ${worlds.length}, docked systems ${systems.length}, multi-station ${multiStation}`,
);
console.log(
	`intra-system pairs ${intra.length}, interstellar pairs ${inter.length} (within ${JUMP_RANGE_LY} LY, same galaxy; ${unreachable} sampled origins had no docked neighbour in range)`,
);
for (const [label, xs] of [
	["intra-system", intra],
	["interstellar", inter],
] as [string, number[]][])
	console.log(
		`${label}   mean ${avg(xs).toFixed(1)}\tmedian ${quantile(xs, 0.5).toFixed(1)}\tp95 ${quantile(
			xs,
			0.95,
		).toFixed(1)}\tmax ${xs.reduce((a, b) => Math.max(a, b), 0).toFixed(1)}`,
	);

// ── 5. Does the deficit brake exhaust the intra-system loop? ────────────────

console.log(
	"\n── §5.4: runs to exhaustion on the richest *closable* intra-system pair ──",
);
// **Searched, not hardcoded.** An earlier version fixed fluct 0x7a / 0x1c on
// the shipyard→refinery leg and called the result "the best pair" — which it
// was not: the 27.2 Cr/t it reported was purely the Computers type spread at
// those two constants, identical at every economy, while §5.4's own residual
// table names the richest pairs as the unclosable ones on the excluded
// direction. The pair that matters here is the richest one the deficit *can*
// close, since the unclosable ones are bounded by the residual instead.
let richestClosable = {
	buyCr: 0,
	sellCr: 0,
	margin: 0,
	good: "—",
	leg: "",
	economy: 0,
};
forEachLegalPair((pair) => {
	const margin = pair.sellCr - pair.buyCr;
	if (margin <= richestClosable.margin) return;
	if (residualMarginCr(pair.buyCr, pair.sellCr) > 0) return; // unclosable
	richestClosable = {
		buyCr: pair.buyCr,
		sellCr: pair.sellCr,
		margin,
		good: pair.good.name,
		leg: `${pair.buyStation}→${pair.sellStation}`,
		economy: pair.economy,
	};
}, FLUCT_PAIRS);
const exhaustion = runsToExhaustion({
	buyBaseCr: richestClosable.buyCr,
	sellBaseCr: richestClosable.sellCr,
	maxRuns: 12,
});
console.log(
	`${richestClosable.good} at economy ${richestClosable.economy}, ${richestClosable.leg}: opens at ${fixed(richestClosable.margin, 1)} Cr/t`,
);
console.log(
	`runs ${exhaustion.runs}\tmargins ${exhaustion.margins.map((m) => fixed(m, 1)).join(" → ")}\ttotal ${fixed(exhaustion.profitCr, 0)} Cr`,
);

// ── 6. Bell's quantity wrap, which §2.2's clamp diverges from ───────────────

console.log("\n── §12: goods whose stock differs from Bell's `& 0x3F` wrap ──");
for (const good of COMMODITIES) {
	let worst = 0;
	const { hits: differing, rows } = sweepDomain((economy, fluct) => {
		const mine = marketRowAt(good, economy, fluct, "trade").quantity;
		const theirs = marketRowAt(
			good,
			economy,
			fluct,
			"trade",
			BELL_WRAP,
		).quantity;
		if (mine === theirs) return false;
		worst = Math.max(worst, Math.abs(mine - theirs));
		return true;
	});
	if (differing > 0)
		console.log(
			`  ${good.name.padEnd(14)} differs on ${pct(differing, rows).padStart(7)} of rows, by up to ${fixed(worst, 0)} units`,
		);
}

// ── 7. The brake's reach, in every direction ────────────────────────────────
//
// §5.4 states the brake as a ratio: at the ±63 cap the multipliers are 1.315
// and 0.685, so the deficit closes any pair below 1.315/0.685 and none above
// it. An earlier version measured that bound **buying at a shipyard and selling
// at a refinery only** — one of six ordered station pairs — and reported a
// comfortable 1.571 worst case. The reverse legs hold the cheap goods, the ones
// §3.1's floor pins at 0.4 Cr.
//
// The survey itself lives in `market-math.ts`: this block and the suite's
// residual test were two verbatim six-level nests differing only in what they
// accumulated, so a change to the domain had to land in both or the two
// reported figures would quietly disagree.

console.log("\n── §5.4: sell/buy ratios the deficit cannot close ──");
const survey = surveyResiduals();
console.log(`the deficit closes any ratio below ${CLOSABLE_RATIO.toFixed(3)}`);
console.log(
	`worst legal intra-system ratio: ${survey.worstRatio.ratio.toFixed(2)} — ${survey.worstRatio.good.name} at economy ${survey.worstRatio.economy}, ${survey.worstRatio.buyStation}→${survey.worstRatio.sellStation}, margin only ${(survey.worstRatio.sellCr - survey.worstRatio.buyCr).toFixed(1)} Cr/t`,
);
console.log(
	`rows above the closable ratio: ${pct(survey.unclosableRows, survey.rows)} of ${survey.rows}`,
);
console.log(
	`richest steady-state residual: ${survey.worst.residualCr.toFixed(1)} Cr/t — ${survey.worst.good.name} at economy ${survey.worst.economy}, ${survey.worst.buyStation}→${survey.worst.sellStation} (${(survey.worst.residualCr * HOLD_REFERENCE_T).toFixed(0)} Cr per ${HOLD_REFERENCE_T} t run)`,
);

// ── 8. The same steady state, applied to an interstellar route ──────────────
//
// §5.4 compares a saturated intra-system residual against a *fresh* interstellar
// margin, which is not like for like: one side has been farmed to the ±63 cap
// and the other has not. This measures the interstellar route under the same
// saturation, so the farm-versus-fly comparison is between two numbers of the
// same kind.

console.log("\n── §5.4: the same comparison, both sides saturated ──");
let bestInterFresh = 0;
let bestInterSaturated = 0;
forEachReachablePair({ stride: 64, maxDest: 1 }, (from, to) => {
	const { freshCr, saturatedCr } = bestResidualBetween(from, to);
	bestInterFresh = Math.max(bestInterFresh, freshCr);
	bestInterSaturated = Math.max(bestInterSaturated, saturatedCr);
});

console.log(
	`intra-system, saturated: ${survey.worst.residualCr.toFixed(1)} Cr/t (${(survey.worst.residualCr * HOLD_REFERENCE_T).toFixed(0)} Cr per run)`,
);
console.log(
	`interstellar, saturated: ${bestInterSaturated.toFixed(1)} Cr/t (${(bestInterSaturated * HOLD_REFERENCE_T).toFixed(0)} Cr per run)`,
);
console.log(
	`interstellar, fresh:     ${bestInterFresh.toFixed(1)} Cr/t (${(bestInterFresh * HOLD_REFERENCE_T).toFixed(0)} Cr per run)`,
);

// ── 9. Run value: what a good is worth per trip ─────────────────────────────
//
// §4 claims contraband out-earns every legal good. Per-unit margins cannot
// establish that — Gold's 5.6 Cr/kg is 5,600 Cr per tonne-equivalent — and the
// commensurable quantity is what one run can carry: a hold of tonne goods, or
// 63 units of a sub-tonne good riding free beside it (research §2.2).

console.log("\n── §4: best margin and run value, every good ──");
console.log(
	"  (legal goods over every ordered leg; contraband held to the fence leg, which §4 scopes it to)",
);
const valued = COMMODITIES.filter((c) => !c.sellOnly)
	.map((c) => ({ good: c, ...bestRunValueCr(c) }))
	.sort((a, b) => b.runCr - a.runCr);
for (const row of valued)
	console.log(
		`  ${row.good.name.padEnd(14)} ${row.good.illegal ? "illegal" : "legal  "} ${fixed(row.marginCr, 1).padStart(6)} Cr/${row.good.unit.padEnd(2)} ${row.leg.padEnd(21)} run ${fixed(row.runCr, 0).padStart(5)} Cr`,
	);
const topLegal = valued.find((r) => !r.good.illegal);
const topIllegal = valued.find((r) => r.good.illegal);
if (topLegal && topIllegal)
	console.log(
		`\ncontraband premium over the best legal good: ${fixed((100 * (topIllegal.runCr - topLegal.runCr)) / topLegal.runCr, 0)}% (${topIllegal.good.name} ${fixed(topIllegal.runCr, 0)} Cr vs ${topLegal.good.name} ${fixed(topLegal.runCr, 0)} Cr)`,
	);
