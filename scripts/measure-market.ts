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
	ALL_ECONOMIES,
	ALL_FLUCT,
	ALL_STATIONS,
	type ByteMode,
	COMMODITIES,
	type Commodity,
	NARCOTICS_BELL,
	OFFSET_STATIONS,
	type StationTypeKey,
	DEFICIT_MAX,
	FLUCT_PAIRS,
	MIN_STOCK_RESPONSE_FACTOR,
	bestMargin,
	commodity,
	marketRow,
	residualMarginCr,
	runsToExhaustion,
	stockResponse,
	sweepDomain,
} from "../tests/helpers/market-math";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";
import { JUMP_RANGE_LY, distanceLy } from "../src/galaxy";
import type { Vec3 } from "../src/vec3";

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(2)}%`;

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
const fmt = (s: Span) => `${s.lo.toFixed(1)}–${s.hi.toFixed(1)}`;

/** Measures one good. Printing is the caller's, so `filter(report)` cannot read
 *  as a filter with a side effect. */
function measure(commodity: Commodity): {
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
			marketRow(commodity, economy, fluct, "trade", "wrap").priceCr,
		);
		const clamped = marketRow(commodity, economy, fluct, "trade", "saturate");
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
		`${label.padEnd(16)}  ${`${(100 * m.overflowRate).toFixed(2)}%`.padStart(7)}   ` +
			`${fmt(m.wrapSpan).padStart(13)}     ${fmt(m.clampSpan).padStart(13)}`,
	);
}

const flattened: string[] = [];
for (const commodity of COMMODITIES) {
	const m = measure(commodity);
	print(commodity.name, m);
	if (m.collapsed) flattened.push(commodity.name);
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
const NARCOTICS_ROWS: [string, Commodity, ByteMode][] = [
	["Bell + wrap", NARCOTICS_BELL, "wrap"],
	["Bell + clamp", NARCOTICS_BELL, "saturate"],
	["seelite + clamp", commodity("Narcotics"), "saturate"],
];
for (const [label, commodity, mode] of NARCOTICS_ROWS) {
	const { margin, inStock } = bestMargin(
		commodity,
		"refinery",
		"refinery",
		mode,
	);
	console.log(
		`${label.padEnd(18)} ${margin.toFixed(1).padStart(6)} Cr/t   in stock ${(
			100 * inStock
		).toFixed(0)}%`,
	);
}

console.log("\nall three illegal goods, shipped table:");
for (const commodity of COMMODITIES.filter((c) => c.illegal)) {
	const { margin, inStock } = bestMargin(commodity, "refinery", "refinery");
	console.log(
		`  ${commodity.name.padEnd(12)} ${margin.toFixed(1).padStart(6)} Cr/t   in stock ${(
			100 * inStock
		).toFixed(0)}%`,
	);
}

// ── 3. Does the §3 price floor bite? ────────────────────────────────────────

console.log("\n── §3: how often the 0.4 Cr floor fires ──");
function floorRate(stations: readonly StationTypeKey[]): string {
	let fired = 0;
	let rows = 0;
	for (const commodity of COMMODITIES)
		for (const station of stations) {
			const swept = sweepDomain(
				(economy, fluct) =>
					marketRow(commodity, economy, fluct, station).floorFired,
			);
			fired += swept.hits;
			rows += swept.rows;
		}
	return `${pct(fired, rows)} of ${rows} rows`;
}
// The two figures differ because the trade station's offset is zero, so its
// rows can never fire and only pad the denominator. The first is the honest one.
console.log(
	`offset types only (refinery, shipyard): ${floorRate(OFFSET_STATIONS)}`,
);
console.log(
	`all three types:                        ${floorRate(ALL_STATIONS)}`,
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
	legalOnly = true,
): { margin: number; good: string } {
	let best = { margin: 0, good: "—" };
	for (const commodity of COMMODITIES) {
		if (commodity.sellOnly) continue;
		if (legalOnly && commodity.illegal) continue;
		if (commodity.unit !== "t") continue; // §6: sub-tonne goods skip the hold
		const b = marketRow(commodity, buy.economy, buy.fluct, buy.station);
		if (b.quantity === 0) continue;
		const s = marketRow(commodity, sell.economy, sell.fluct, sell.station);
		if (s.priceCr - b.priceCr > best.margin)
			best = { margin: s.priceCr - b.priceCr, good: commodity.name };
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
let unreachable = 0;
for (const bucket of byGalaxy.values()) {
	// Every 8th system as the origin, which keeps the sweep O(n²/8) per galaxy.
	// Destinations are the **first four in generation order that fall inside the
	// jump range** — not the four nearest. Order does not bias the margin here
	// (it correlates with nothing in the price formula); what the earlier version
	// got wrong was not the ordering but the absence of any range check at all,
	// which admitted pairs no ship can fly.
	for (let i = 0; i < bucket.length; i += 8) {
		const from = bucket[i];
		let found = 0;
		for (let j = 0; j < bucket.length && found < 4; j++) {
			if (j === i) continue;
			const to = bucket[j];
			if (distanceLy(from.pos, to.pos) > JUMP_RANGE_LY) continue;
			found++;
			inter.push(bestBetween(from, to, false));
		}
		if (found === 0) unreachable++;
	}
}

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

console.log("\n── §5.4: runs to exhaustion on the best intra-system pair ──");
for (const economy of [0, 3, 7]) {
	const pair = pairMargin(
		{ economy, station: "shipyard", fluct: 0x7a },
		{ economy, station: "refinery", fluct: 0x1c },
	);
	if (pair.margin <= 0) {
		console.log(`economy ${economy}: no profitable shipyard→refinery pair`);
		continue;
	}
	const good = commodity(pair.good);
	const { runs, margins, profitCr } = runsToExhaustion({
		buyBaseCr: marketRow(good, economy, 0x7a, "shipyard").priceCr,
		sellBaseCr: marketRow(good, economy, 0x1c, "refinery").priceCr,
		maxRuns: 12,
	});
	console.log(
		`economy ${economy}: ${pair.good.padEnd(13)} runs ${runs}\tmargins ${margins
			.map((m) => m.toFixed(1))
			.join(" → ")}\ttotal ${profitCr.toFixed(0)} Cr`,
	);
}

// ── 6. Bell's quantity wrap, which §2.2's clamp diverges from ───────────────

console.log("\n── §12: goods whose stock differs from Bell's `& 0x3F` wrap ──");
for (const commodity of COMMODITIES) {
	let worst = 0;
	const { hits: differing, rows } = sweepDomain((economy, fluct) => {
		const mine = marketRow(commodity, economy, fluct, "trade").quantity;
		const theirs = marketRow(
			commodity,
			economy,
			fluct,
			"trade",
			"wrap",
		).quantity;
		if (mine === theirs) return false;
		worst = Math.max(worst, Math.abs(mine - theirs));
		return true;
	});
	if (differing > 0)
		console.log(
			`  ${commodity.name.padEnd(14)} differs on ${pct(differing, rows).padStart(7)} of rows, by up to ${worst} units`,
		);
}

// ── 7. The brake's reach, in every direction ────────────────────────────────
//
// §5.4 states the brake as a ratio: at the ±63 cap the multipliers are 1.315
// and 0.685, so the deficit closes any pair below 1.315/0.685 and none above
// it. An earlier version measured that bound **buying at a shipyard and selling
// at a refinery only** — one of six ordered station pairs — and reported a
// comfortable 1.571 worst case. The reverse legs are where the cheap goods sit,
// and they are the ones the floor pins at 0.4 Cr.

console.log("\n── §5.4: sell/buy ratios the deficit cannot close ──");
const CLOSABLE_RATIO =
	(2 - MIN_STOCK_RESPONSE_FACTOR) / MIN_STOCK_RESPONSE_FACTOR;
const LEGAL_TRADEABLE = COMMODITIES.filter(
	(c) => !c.sellOnly && c.unit === "t" && !c.illegal,
);
let worstRatio = { ratio: 0, good: "—", economy: 0, leg: "", marginCr: 0 };
let bestUnclosableMargin = { marginCr: 0, good: "—", leg: "", ratio: 0 };
let unclosableRows = 0;
let ratioRows = 0;
for (const good of LEGAL_TRADEABLE)
	for (const economy of ALL_ECONOMIES)
		for (const buyStation of ALL_STATIONS)
			for (const sellStation of ALL_STATIONS) {
				if (buyStation === sellStation) continue;
				for (const buyFluct of ALL_FLUCT) {
					const buy = marketRow(good, economy, buyFluct, buyStation);
					if (buy.quantity === 0) continue;
					for (const sellFluct of ALL_FLUCT) {
						const sellCr = marketRow(
							good,
							economy,
							sellFluct,
							sellStation,
						).priceCr;
						const ratio = sellCr / buy.priceCr;
						const leg = `${buyStation}→${sellStation}`;
						ratioRows++;
						if (ratio > CLOSABLE_RATIO) {
							unclosableRows++;
							if (sellCr - buy.priceCr > bestUnclosableMargin.marginCr)
								bestUnclosableMargin = {
									marginCr: sellCr - buy.priceCr,
									good: good.name,
									leg,
									ratio,
								};
						}
						if (ratio > worstRatio.ratio)
							worstRatio = {
								ratio,
								good: good.name,
								economy,
								leg,
								marginCr: sellCr - buy.priceCr,
							};
					}
				}
			}
console.log(`the deficit closes any ratio below ${CLOSABLE_RATIO.toFixed(3)}`);
console.log(
	`worst legal intra-system ratio: ${worstRatio.ratio.toFixed(2)} — ${worstRatio.good} at economy ${worstRatio.economy}, ${worstRatio.leg}, margin only ${worstRatio.marginCr.toFixed(1)} Cr/t`,
);
console.log(
	`rows above the closable ratio: ${pct(unclosableRows, ratioRows)} of ${ratioRows}`,
);
console.log(
	`richest unclosable pair: ${bestUnclosableMargin.marginCr.toFixed(1)} Cr/t — ${bestUnclosableMargin.good}, ${bestUnclosableMargin.leg}, ratio ${bestUnclosableMargin.ratio.toFixed(2)}`,
);

// The ratio is the wrong headline. What a farmer actually earns is the margin
// that survives once both deficits sit at the ±63 cap — the *steady state*,
// not whether it reached exactly zero. A ratio of 12 on a 0.4 Cr good leaves
// pocket change; the question is whether any pair leaves real money.
let worstResidual = { cr: 0, good: "—", economy: 0, leg: "" };
for (const good of LEGAL_TRADEABLE)
	for (const economy of ALL_ECONOMIES)
		for (const buyStation of ALL_STATIONS)
			for (const sellStation of ALL_STATIONS) {
				if (buyStation === sellStation) continue;
				for (const buyFluct of ALL_FLUCT) {
					const buy = marketRow(good, economy, buyFluct, buyStation);
					if (buy.quantity === 0) continue;
					for (const sellFluct of ALL_FLUCT) {
						const sellCr = marketRow(
							good,
							economy,
							sellFluct,
							sellStation,
						).priceCr;
						const residual = residualMarginCr(buy.priceCr, sellCr);
						if (residual > worstResidual.cr)
							worstResidual = {
								cr: residual,
								good: good.name,
								economy,
								leg: `${buyStation}→${sellStation}`,
							};
					}
				}
			}
console.log(
	`richest steady-state residual: ${worstResidual.cr.toFixed(1)} Cr/t — ${worstResidual.good} at economy ${worstResidual.economy}, ${worstResidual.leg} (${(worstResidual.cr * 20).toFixed(0)} Cr per 20 t run)`,
);
