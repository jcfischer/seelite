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
	addDeficit,
	bestMargin,
	decayDeficit,
	marketRow,
	stockResponse,
} from "../tests/helpers/market-math";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(2)}%`;
const named = (name: string): Commodity =>
	COMMODITIES.find((c) => c.name === name) as Commodity;

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

/** Prints one row and returns whether the clamp collapsed the good's span. */
function report(commodity: Commodity, label = commodity.name): boolean {
	let overflows = 0;
	let rows = 0;
	const wrapSpan = span();
	const clampSpan = span();
	for (const economy of ALL_ECONOMIES)
		for (const fluct of ALL_FLUCT) {
			widen(
				wrapSpan,
				marketRow(commodity, economy, fluct, "trade", "wrap").priceCr,
			);
			const clamped = marketRow(commodity, economy, fluct, "trade", "saturate");
			widen(clampSpan, clamped.priceCr);
			if (clamped.priceOverflowed) overflows++;
			rows++;
		}
	console.log(
		`${label.padEnd(16)}  ${pct(overflows, rows).padStart(7)}   ` +
			`${fmt(wrapSpan).padStart(13)}     ${fmt(clampSpan).padStart(13)}`,
	);
	// A good whose clamped span is a small fraction of its wrapped span has had
	// its price variation removed, not merely tidied.
	const wrapWidth = wrapSpan.hi - wrapSpan.lo;
	return wrapWidth > 0 && (clampSpan.hi - clampSpan.lo) / wrapWidth < 0.25;
}

const flattened = COMMODITIES.filter((c) => report(c)).map((c) => c.name);
console.log(
	`\nshipped table — goods whose price span collapses under the clamp: ${
		flattened.join(", ") || "none"
	}`,
);

// ── 2. Bell's Narcotics row, which the retune replaced ──────────────────────

console.log("\n── §2.3: the row the retune replaced ──");
console.log(
	`Bell's row collapses under the clamp: ${report(NARCOTICS_BELL, "Narcotics (Bell)")}`,
);

console.log(
	"\nbest margin, refinery → refinery (a fence is a refinery; blackMarket does not price)",
);
const NARCOTICS_ROWS: [string, Commodity, ByteMode][] = [
	["Bell + wrap", NARCOTICS_BELL, "wrap"],
	["Bell + clamp", NARCOTICS_BELL, "saturate"],
	["seelite + clamp", named("Narcotics"), "saturate"],
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
		for (const station of stations)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT) {
					if (marketRow(commodity, economy, fluct, station).floorFired) fired++;
					rows++;
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
}
const systems: SystemMarket[] = [];

for (const world of worlds) {
	forEachSystem(world, ALL_GALAXIES, (record, contents) => {
		if (contents.stations.length === 0) return;
		systems.push({
			economy: record.economy,
			stations: contents.stations.map((s) => s.type as StationTypeKey),
		});
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

/** Five independent byte pairs — one station's draw is not its neighbour's. */
const FLUCT_PAIRS: [number, number][] = [
	[0x00, 0x91],
	[0x3d, 0x1c],
	[0x7a, 0xc6],
	[0xb1, 0x58],
	[0xee, 0x2f],
];
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const intra: number[] = [];
let multiStation = 0;
for (const system of systems) {
	if (system.stations.length < 2) continue;
	multiStation++;
	intra.push(
		avg(
			FLUCT_PAIRS.map(([buyFluct, sellFluct]) => {
				let best = 0;
				for (const buy of system.stations)
					for (const sell of system.stations) {
						if (buy === sell) continue;
						best = Math.max(
							best,
							pairMargin(
								{ economy: system.economy, station: buy, fluct: buyFluct },
								{ economy: system.economy, station: sell, fluct: sellFluct },
							).margin,
						);
					}
				return best;
			}),
		),
	);
}

// Interstellar: the same measurement across system pairs, which is what the
// galaxy is supposed to be built around.
const inter: number[] = [];
for (let i = 0; i + 1 < systems.length; i += 97) {
	const from = systems[i];
	const to = systems[i + 1];
	inter.push(
		avg(
			FLUCT_PAIRS.map(([buyFluct, sellFluct]) => {
				let best = 0;
				for (const buy of from.stations)
					for (const sell of to.stations)
						best = Math.max(
							best,
							pairMargin(
								{ economy: from.economy, station: buy, fluct: buyFluct },
								{ economy: to.economy, station: sell, fluct: sellFluct },
							).margin,
						);
				return best;
			}),
		),
	);
}

const quantile = (xs: number[], q: number) =>
	[...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] ?? 0;

console.log(
	"\n── §5.4/§8: intra-system vs interstellar margin (Cr/t, legal goods) ──",
);
console.log(
	`worlds ${worlds.length}, docked systems ${systems.length}, multi-station ${multiStation}`,
);
for (const [label, xs] of [
	["intra-system", intra],
	["interstellar", inter],
] as [string, number[]][])
	console.log(
		`${label}   mean ${avg(xs).toFixed(1)}\tmedian ${quantile(xs, 0.5).toFixed(1)}\tp95 ${quantile(
			xs,
			0.95,
		).toFixed(1)}\tmax ${Math.max(...xs).toFixed(1)}`,
	);

// ── 5. Does the deficit brake exhaust the intra-system loop? ────────────────

console.log("\n── §5.4: runs to exhaustion on the best intra-system pair ──");
const HOLD_T = 20;
/** §8: a full run is 3–5 minutes, so the previous run's mark is already fading
 *  by the time you dock again. Without this the count is independent of
 *  DEFICIT_HALF_LIFE and the constant is unexercised. */
const RUN_MINUTES = 4;
for (const economy of [0, 3, 7]) {
	const pair = pairMargin(
		{ economy, station: "shipyard", fluct: 0x7a },
		{ economy, station: "refinery", fluct: 0x1c },
	);
	if (pair.margin <= 0) {
		console.log(`economy ${economy}: no profitable shipyard→refinery pair`);
		continue;
	}
	const commodity = named(pair.good);
	const buyBase = marketRow(commodity, economy, 0x7a, "shipyard").priceCr;
	const sellBase = marketRow(commodity, economy, 0x1c, "refinery").priceCr;
	let bought = 0;
	let sold = 0;
	let runs = 0;
	let profit = 0;
	const legs: string[] = [];
	while (runs < 12) {
		const margin =
			stockResponse(sellBase, -sold) - stockResponse(buyBase, bought);
		if (margin <= 0) break;
		runs++;
		profit += margin * HOLD_T;
		legs.push(margin.toFixed(1));
		bought = addDeficit(decayDeficit(bought, RUN_MINUTES), HOLD_T);
		sold = addDeficit(decayDeficit(sold, RUN_MINUTES), HOLD_T);
	}
	console.log(
		`economy ${economy}: ${pair.good.padEnd(13)} runs ${runs}\tmargins ${legs.join(
			" → ",
		)}\ttotal ${profit.toFixed(0)} Cr`,
	);
}
