/**
 * The instrument behind `economy-trade.md` §2, §3, §5 and §8.
 *
 * Four claims in that spec are numbers, and a number in prose with no committed
 * way to re-derive it is the failure `measure-clamp-bite.ts` exists to answer:
 *
 * 1. **§2 — what saturation costs.** Replacing Bell's `& 0xFF` wrap with a
 *    clamp changes prices only where the byte overflows. How often is that, and
 *    which goods does it flatten?
 * 2. **§3 — does the price floor bite?** The type delta is applied in credits
 *    after the clamp and floored at one price step. A floor that fires often is
 *    a price rule that is a constant, which is what #13 disqualified the economy
 *    -shift form for.
 * 3. **§5/§8 — does intra-system trade beat interstellar trade?** Type offsets
 *    span 5 steps within one system; the economy spans 7 across the galaxy. If
 *    the first is comparable to the second, the galaxy collapses into
 *    single-system loops.
 * 4. **§5 — does the stock deficit exhaust the loop?** The brake is the reason
 *    (3) is safe. It has to be measured, not asserted.
 *
 *   bun run scripts/measure-market.ts [worldCount]
 */

import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";
import {
	type ByteMode,
	COMMODITIES,
	type Commodity,
	PRICE_STEP_CR,
	type StationTypeKey,
	marketRow,
	stockResponse,
} from "../tests/helpers/market-math";

const STATIONS: StationTypeKey[] = ["trade", "refinery", "shipyard"];
const ALL_FLUCT = Array.from({ length: 256 }, (_, i) => i);
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(2)}%`;

// ── 1. What saturation costs, per good ──────────────────────────────────────
//
// Swept over the whole input space rather than sampled: 17 goods × 8 economies
// × 256 fluctuation bytes is 34,816 rows, so there is no reason to estimate.

console.log("── §2: saturation vs Bell's wrap, per good ──");
console.log(
	"good              saturates   wrap Cr range     saturate Cr range",
);

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

let saturatedRows = 0;
let totalRows = 0;
const flattened: string[] = [];

for (const commodity of COMMODITIES) {
	let saturates = 0;
	let rows = 0;
	const wrapSpan = span();
	const satSpan = span();
	for (let economy = 0; economy <= 7; economy++) {
		for (const fluct of ALL_FLUCT) {
			const w = marketRow(commodity, economy, fluct, "trade", "wrap");
			const s = marketRow(commodity, economy, fluct, "trade", "saturate");
			widen(wrapSpan, w.priceCr);
			widen(satSpan, s.priceCr);
			if (s.priceSaturated) saturates++;
			rows++;
		}
	}
	saturatedRows += saturates;
	totalRows += rows;
	// A good whose saturating span is a small fraction of its wrapped span has
	// had its price variation removed, not merely tidied.
	const wrapWidth = wrapSpan.hi - wrapSpan.lo;
	const satWidth = satSpan.hi - satSpan.lo;
	if (wrapWidth > 0 && satWidth / wrapWidth < 0.25)
		flattened.push(commodity.name);
	console.log(
		`${commodity.name.padEnd(16)}  ${pct(saturates, rows).padStart(7)}   ` +
			`${fmt(wrapSpan).padStart(13)}     ${fmt(satSpan).padStart(13)}`,
	);
}
console.log(`\noverall saturation rate: ${pct(saturatedRows, totalRows)}`);
console.log(
	`goods whose price span collapses to <25% of Bell's: ${flattened.join(", ") || "none"}`,
);

// ── 2. Does the §3 price floor bite? ────────────────────────────────────────

console.log("\n── §3: how often the 0.4 Cr floor fires ──");
let floorFires = 0;
let floorRows = 0;
for (const commodity of COMMODITIES) {
	for (const station of STATIONS) {
		for (let economy = 0; economy <= 7; economy++) {
			for (const fluct of ALL_FLUCT) {
				const row = marketRow(commodity, economy, fluct, station, "saturate");
				// The floor fired iff the unfloored value would have been below it.
				const closed = Math.min(
					Math.max(
						commodity.basePrice +
							(fluct & commodity.mask) +
							economy * commodity.gradient,
						0,
					),
					255,
				);
				const unfloored =
					closed * PRICE_STEP_CR +
					{ trade: 0, refinery: 3, shipyard: -2 }[station] *
						commodity.gradient *
						PRICE_STEP_CR;
				if (unfloored < PRICE_STEP_CR) floorFires++;
				floorRows++;
				void row;
			}
		}
	}
}
console.log(
	`floor fires on ${pct(floorFires, floorRows)} of ${floorRows} rows`,
);

// ── 3. Intra-system vs interstellar margin, on the real galaxy ──────────────

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

/**
 * Best per-tonne margin buying at one station and selling at another.
 *
 * **The two fluctuation bytes are independent**, because the two stations have
 * different seeds (§5). Pairing them on one byte — which the first version of
 * this instrument did — understates every margin it reports, and understates
 * them unequally, so it also distorts the intra-vs-interstellar comparison the
 * measurement exists to make.
 */
function bestMargin(
	buyEconomy: number,
	buyStation: StationTypeKey,
	sellEconomy: number,
	sellStation: StationTypeKey,
	buyFluct: number,
	sellFluct: number,
	legalOnly = true,
): { margin: number; good: string } {
	let best = { margin: 0, good: "—" };
	for (const commodity of COMMODITIES) {
		if (commodity.sellOnly) continue;
		if (legalOnly && commodity.illegal) continue;
		if (commodity.unit !== "t") continue; // §6: sub-tonne goods skip the hold
		const buy = marketRow(commodity, buyEconomy, buyFluct, buyStation);
		if (buy.quantity === 0) continue;
		const sell = marketRow(commodity, sellEconomy, sellFluct, sellStation);
		const margin = sell.priceCr - buy.priceCr;
		if (margin > best.margin) best = { margin, good: commodity.name };
	}
	return best;
}

const FLUCT_SAMPLE = [0x00, 0x3d, 0x7a, 0xb1, 0xee];
/** A second, independent draw — one station's byte is not its neighbour's. */
const FLUCT_SAMPLE_B = [0x91, 0x1c, 0xc6, 0x58, 0x2f];
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const intra: number[] = [];
let multiStation = 0;
for (const system of systems) {
	if (system.stations.length < 2) continue;
	multiStation++;
	const best: number[] = [];
	for (let i = 0; i < FLUCT_SAMPLE.length; i++) {
		let m = 0;
		for (const buy of system.stations)
			for (const sell of system.stations) {
				if (buy === sell) continue;
				m = Math.max(
					m,
					bestMargin(
						system.economy,
						buy,
						system.economy,
						sell,
						FLUCT_SAMPLE[i],
						FLUCT_SAMPLE_B[i],
					).margin,
				);
			}
		best.push(m);
	}
	intra.push(avg(best));
}

// Interstellar: the same measurement across system pairs, which is what the
// galaxy is supposed to be built around.
const inter: number[] = [];
for (let s = 0; s + 1 < systems.length; s += 97) {
	const a = systems[s];
	const b = systems[s + 1];
	const best: number[] = [];
	for (let i = 0; i < FLUCT_SAMPLE.length; i++) {
		let m = 0;
		for (const buy of a.stations)
			for (const sell of b.stations)
				m = Math.max(
					m,
					bestMargin(
						a.economy,
						buy,
						b.economy,
						sell,
						FLUCT_SAMPLE[i],
						FLUCT_SAMPLE_B[i],
					).margin,
				);
		best.push(m);
	}
	inter.push(avg(best));
}

const p = (xs: number[], q: number) =>
	[...xs].sort((x, y) => x - y)[Math.floor(q * (xs.length - 1))] ?? 0;

console.log(
	"\n── §8: intra-system vs interstellar margin (Cr/t, legal goods) ──",
);
console.log(
	`worlds ${worlds.length}, docked systems ${systems.length}, multi-station ${multiStation}`,
);
console.log(
	`intra-system   mean ${avg(intra).toFixed(1)}\tmedian ${p(intra, 0.5).toFixed(1)}\tp95 ${p(intra, 0.95).toFixed(1)}\tmax ${Math.max(...intra).toFixed(1)}`,
);
console.log(
	`interstellar   mean ${avg(inter).toFixed(1)}\tmedian ${p(inter, 0.5).toFixed(1)}\tp95 ${p(inter, 0.95).toFixed(1)}\tmax ${Math.max(...inter).toFixed(1)}`,
);

// ── 4. Does the deficit brake exhaust the intra-system loop? ────────────────

console.log("\n── §5: runs to exhaustion on the best intra-system pair ──");
const HOLD_T = 20;
for (const economy of [0, 3, 7]) {
	const pair = bestMargin(economy, "shipyard", economy, "refinery", 0x7a, 0x1c);
	if (pair.margin <= 0) {
		console.log(`economy ${economy}: no profitable shipyard→refinery pair`);
		continue;
	}
	const commodity = COMMODITIES.find((c) => c.name === pair.good) as Commodity;
	let buyDeficit = 0;
	let sellDeficit = 0;
	let run = 0;
	let profit = 0;
	const legs: string[] = [];
	while (run < 12) {
		const buy = stockResponse(
			marketRow(commodity, economy, 0x7a, "shipyard").priceCr,
			buyDeficit,
		);
		const sell = stockResponse(
			marketRow(commodity, economy, 0x1c, "refinery").priceCr,
			-sellDeficit,
		);
		const margin = sell - buy;
		if (margin <= 0) break;
		run++;
		profit += margin * HOLD_T;
		legs.push(`${margin.toFixed(1)}`);
		buyDeficit += HOLD_T;
		sellDeficit += HOLD_T;
	}
	console.log(
		`economy ${economy}: ${pair.good.padEnd(13)} runs ${run}\tmargins ${legs.join(" → ")}\ttotal ${profit.toFixed(0)} Cr`,
	);
}

// ── 5. The contraband trade, which §4 makes load-bearing ────────────────────

console.log("\n── §4: contraband margin, fence → fence (both refineries) ──");
/** Every 8th byte: the masks in play are multiples of 8, so this is exact. */
const FLUCT_SWEEP = Array.from({ length: 32 }, (_, i) => i * 8);
for (const mode of ["wrap", "saturate"] as ByteMode[]) {
	const illegal = COMMODITIES.filter((c) => c.illegal);
	const parts: string[] = [];
	for (const commodity of illegal) {
		let best = 0;
		for (let buyEco = 0; buyEco <= 7; buyEco++)
			for (let sellEco = 0; sellEco <= 7; sellEco++)
				for (const buyFluct of FLUCT_SWEEP)
					for (const sellFluct of FLUCT_SWEEP) {
						const buy = marketRow(
							commodity,
							buyEco,
							buyFluct,
							"refinery",
							mode,
						);
						if (buy.quantity === 0) continue;
						const sell = marketRow(
							commodity,
							sellEco,
							sellFluct,
							"refinery",
							mode,
						);
						best = Math.max(best, sell.priceCr - buy.priceCr);
					}
		parts.push(`${commodity.name} ${best.toFixed(1)}`);
	}
	console.log(`${mode.padEnd(9)} best Cr/t: ${parts.join("  ·  ")}`);
}
