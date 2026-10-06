/**
 * The instrument behind §3.2's table.
 *
 * §3.2's whole case for expressing the type offset as a price delta rather than
 * as an economy shift is a measurement: how often would `clamp(economy + offset,
 * 0, 7)` actually swallow the offset? The first draft asserted a figure and got
 * it wrong. A conclusion with no committed instrument is the same failure one
 * step later — a later reader re-deciding this has the number but no way to
 * check it.
 *
 * It also reports the undockable rate behind §5.4, for the same reason: that
 * figure sets `tests/station-orbits.test.ts`'s band, §5.4's prose and
 * `src/system.ts`'s comment, and the committed test sweeps eight worlds where
 * the quoted number is forty. One sweep, both numbers, reproducible.
 *
 * §5.6's third column on this page: where does the *bid cut* die?
 *
 * #13's warning is that an offset placed on a bounded index gets clamped away
 * where that index's population lives, and §5.6's cut is such an offset — a
 * grade spread across `displayTL`. So the same question gets the same instrument
 * rather than a sentence: over the rows the generator actually prices, what share
 * of them end up with no spread at all, and does the share climb at one end of the
 * index?
 *
 * **The population is a realized row, not a table cell**: one good, at one
 * station, in one system, at game time zero. `spreadless` counts the rows where
 * `marketQuote` returns two equal columns, which happens when §3's price floor has
 * already pinned the mid at one price step — `max(PRICE_STEP_CR, mid × (1 − cut))`
 * then returns the mid itself and the cut has nothing to bite. That is a different
 * thing from §3.2's offset being swallowed by a clamp, and the two are counted
 * separately and printed separately; the row's own denominator is the number of
 * rows priced, so neither figure is ever a share of the other's population.
 *
 * **What this table is evidence about, and what it is not.** Over 40 worlds the cut
 * dies on 0.5% of priced rows. The per-tech-level share is not flat (2.5% at TL 1, 0.7%
 * at TL 5, nothing from TL 8 up), and that slope used to be read here as the cut's grade
 * biting the rim. **It is not.** A flat cut erases the same 8,760 rows as the graded one
 * — 584 at every tech level, every one pinned at one price step — so the TL column here
 * reports *which markets exist at which tech level*, not how hard the ladder bites. The
 * claim this instrument does carry is the per-**type** table: 1.9% of a refinery's rows
 * against 0.0% at a trade station and 0.0% at a shipyard, which is #13's shape (a
 * per-type offset dying where the type lives) at a fiftieth of its size. An earlier
 * revision printed the rim reading as the conclusion at the bottom of its own output;
 * the spec withdrew it and this file did not, which is how a retracted claim survives in
 * the place a reader trusts most. Two things make the residue tolerable rather than
 * merely small. The population it dies in is the one where the
 * round trip nets nothing anyway, because the floor that swallows the spread
 * swallows the deficit's mark on the way through `stockResponse` — the row in
 * `tests/market.test.ts` §5.6 flies that on every row of the whole table and finds
 * no pump surviving on an erased row. And the realized rate agrees with the
 * whole-table rate the test pins (8,760 of 1,566,720 cells, 0.56%, against 0.5% of these
 * 1.8M rows), from two populations that share only the mechanism.
 *
 *   bun run scripts/measure-clamp-bite.ts [worldCount]
 */

import {
	BID_CUT_FLOOR,
	BID_CUT_GRADE,
	COMMODITIES,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	listsCommodity,
	marketQuote,
	quoteWithCut,
	type QuoteFn,
	PRICE_STEP_CR,
	marketRow,
	hasMarket,
	marketStationOf,
} from "../src/market";
import {
	ALL_GALAXIES,
	forEachSystem,
	worldSeeds,
} from "../tests/helpers/station-rows";

const worlds = worldSeeds(Number(process.argv[2] ?? 40));

let systems = 0;
/** Keyed, not counted: §5.4 claims the stationless systems are *the same* ones
 *  that are planetless, and two independent counters cannot show that. */
const planetless = new Set<string>();
const stationless = new Set<string>();
let shipyards = 0;

interface Acc {
	clamped: number;
	erased: number;
}
const shipyardAcc: Acc = { clamped: 0, erased: 0 };
const refineryAcc: Acc = { clamped: 0, erased: 0 };
let refineries = 0;
const shipyardEconomy = new Map<number, number>();

/**
 * The rejected implementation, scored: `clamp(economy + offset, 0, 7)`.
 *
 * One function rather than one block per station type, so the two arms cannot
 * drift and the explanation is not attached to only one of them. **`clamped`
 * and `erased` are nested populations, not disjoint ones** — every erased
 * offset is also a clamped one, and conflating the two overstated §3.2's case
 * in two successive drafts.
 */
function tally(economy: number, offset: number, acc: Acc): void {
	const effective = Math.min(Math.max(economy + offset, 0), 7);
	if (effective !== economy + offset) acc.clamped++;
	if (effective === economy) acc.erased++;
}

for (const world of worlds) {
	// The same traversal the guard uses, rather than a second walk with a weaker
	// galaxy-index check — see that helper's header for why.
	forEachSystem(world, ALL_GALAXIES, (record, contents) => {
		systems++;
		if (contents.planets.length === 0)
			planetless.add(`${world}:${record.seed}`);
		if (contents.stations.length === 0)
			stationless.add(`${world}:${record.seed}`);
		for (const station of contents.stations) {
			if (station.type === "shipyard") {
				shipyards++;
				shipyardEconomy.set(
					record.economy,
					(shipyardEconomy.get(record.economy) ?? 0) + 1,
				);
				tally(record.economy, -2, shipyardAcc);
			}
			if (station.type === "refinery") {
				refineries++;
				tally(record.economy, +3, refineryAcc);
			}
		}
	});
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)}%`;
console.log(`worlds ${worlds.length}, systems ${systems}`);
console.log(
	`shipyards  ${shipyards}\tclamped ${pct(shipyardAcc.clamped, shipyards)}\tof which erased ${pct(shipyardAcc.erased, shipyards)}`,
);
console.log(
	`refineries ${refineries}\tclamped ${pct(refineryAcc.clamped, refineries)}\tof which erased ${pct(refineryAcc.erased, refineries)}`,
);
console.log(
	`undockable ${stationless.size}\t(${((100 * stationless.size) / systems).toFixed(3)}% of systems)`,
);
const sameSets =
	planetless.size === stationless.size &&
	[...stationless].every((k) => planetless.has(k));
console.log(
	`planetless ${planetless.size}\tsame systems as the undockable set: ${sameSets}`,
);
console.log(
	`shipyard economies: ${[...shipyardEconomy.entries()]
		.sort((a, b) => a[0] - b[0])
		.map(([e, n]) => `${e}: ${n}`)
		.join(" · ")}`,
);

// --- §5.6 — the bid cut's own bite ------------------------------------------
// The paragraph that explains this section is in the module docstring above,
// because it is about what the two populations on this page are, not about the
// rows below.

/**
 * Per-tech-level accumulator for the cut's own bite.
 *
 * **`spreadless` and `pinnedAtStep` answer different questions and are not
 * guaranteed to agree.** "Did the spread survive?" and "was this row already pinned at
 * the floor?" come apart wherever a mid *above* the floor loses its spread to the
 * tenth-credit quote step instead — §10.3 counts 360 such rows over the whole priced
 * domain. Over the realized rows this script walks the two percentages happen to land
 * together, and printing both is how that stays visible; asserting they must be equal
 * would be wrong, and an earlier comment here asserted it.
 */
interface SpreadAcc {
	rows: number;
	spreadless: number;
	pinnedAtStep: number;
	/** Rows the **flat** control cut erases, counted in the same walk. Printed per
	 *  station type as well as in the total: the total answers "does the grade decide the
	 *  erasure?" and a per-type column is what shows a type where it does. */
	flatSpreadless: number;
	/** Sum of `(ask − bid) / ask`, so a printed mean spread is a mean of realized
	 *  rows rather than of the table's declared endpoints. */
	spreadSum: number;
}

/** The one place an empty bucket is written. `SpreadAcc` has four dials; a literal
 *  copied into two places is the drift the comment below warns about. */
const emptyAcc = (): SpreadAcc => ({
	rows: 0,
	spreadless: 0,
	pinnedAtStep: 0,
	flatSpreadless: 0,
	spreadSum: 0,
});

/**
 * The control the conclusion needs: the same total bite, no tech-level grade.
 *
 * **`BID_CUT_FLOOR + BID_CUT_GRADE / 2` is the graded ladder's own mean**, which is what
 * makes this a control rather than a third arm: same level of spread on average, none of
 * the rim-to-core difference. If the erased set is unchanged, the grade decided none of it.
 */
const flatCut: QuoteFn = quoteWithCut(() => BID_CUT_FLOOR + BID_CUT_GRADE / 2);

const cutByTl = new Map<number, SpreadAcc>();
const cutByType = new Map<string, SpreadAcc>();
/** The grand totals, as the same accumulator the buckets use. Three scalars here
 *  re-implemented the bucket update one field at a time, which is how a total and
 *  its buckets stop agreeing: add a fourth dial to `SpreadAcc` and the totals go
 *  quietly missing rather than loudly wrong. */
const cutTotal: SpreadAcc = emptyAcc();
// Generic over the key, because the two tables are keyed by TL and by station type
// and the old signature took `number | string` and cast the key back on the way in.
const accFor = <K>(table: Map<K, SpreadAcc>, key: K): SpreadAcc => {
	let acc = table.get(key);
	if (!acc) {
		acc = emptyAcc();
		table.set(key, acc);
	}
	return acc;
};

for (const world of worlds) {
	forEachSystem(world, ALL_GALAXIES, (record, contents) => {
		// Priced stations only: a raider outpost has no market (node #491).
		for (const station of contents.stations.filter(hasMarket)) {
			const market = marketStationOf(station, record.seed);
			for (const good of COMMODITIES) {
				// §4's legality is a law about the shelf, and `marketRow` throws rather
				// than price a good the station does not carry. A row that cannot be
				// quoted is not a row where the cut died, so it is skipped rather than
				// counted — and the denominator stays "rows priced".
				if (!listsCommodity(good, market)) continue;
				// Game time zero, the same instant every other row in this file is
				// scored at. The fluctuation byte has not rolled, so this is the
				// population of *base* prices rather than of one later epoch — which
				// is the population §3's floor is a rule about.
				const mid = marketRow(good, record.economy, market, 0).priceCr;
				const quote = marketQuote(mid, record.displayTL);
				// **The flat control, flown in the same walk.** The claim under this table
				// is that the cut's tech-level grade decides none of the erasure — that a
				// flat cut at the ladder's own mean erases the same rows. That is a
				// measurement and not a mood, so the control runs here and its count is
				// printed beside the graded one. A conclusion that quotes a figure this
				// script never computed is what the last two review rounds were about.
				const flatQuote = flatCut(mid, record.displayTL);
				const byTl = accFor(cutByTl, record.displayTL);
				const byType = accFor(cutByType, station.type);
				for (const acc of [byTl, byType, cutTotal]) {
					acc.rows++;
					acc.spreadSum += 1 - quote.sellCr / quote.buyCr;
					if (quote.sellCr === quote.buyCr) acc.spreadless++;
					if (quote.sellCr === PRICE_STEP_CR) acc.pinnedAtStep++;
					if (flatQuote.sellCr === flatQuote.buyCr) acc.flatSpreadless++;
				}
			}
		}
	});
}

console.log("\n§5.6 — where the bid cut dies, over realized rows");
console.log(
	`  rows priced ${cutTotal.rows.toLocaleString()}   no spread at all ${pct(cutTotal.spreadless, cutTotal.rows)}   pinned at one price step ${pct(cutTotal.pinnedAtStep, cutTotal.rows)}`,
);
console.log(
	`  table's own endpoints: cut ${BID_CUT_FLOOR.toFixed(3)} at TL${DISPLAY_TL_MIN}, ${(BID_CUT_FLOOR + BID_CUT_GRADE).toFixed(3)} at TL${DISPLAY_TL_MAX}`,
);
console.log(
	"  TL   rows        no spread   pinned at step   mean realized spread",
);
for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
	const acc = cutByTl.get(tl);
	if (!acc || acc.rows === 0) continue;
	console.log(
		`${String(tl).padStart(3)}   ${acc.rows.toLocaleString()}`.padEnd(16) +
			`${pct(acc.spreadless, acc.rows)}`.padStart(13) +
			`${pct(acc.pinnedAtStep, acc.rows)}`.padStart(16) +
			`${((100 * acc.spreadSum) / acc.rows).toFixed(2)}%`.padStart(23),
	);
}
console.log(
	"  by station type (the axis #13's warning was actually about), graded and flat:",
);
console.log(
	"      type            rows      no spread     flat too   mean spread",
);
for (const [type, acc] of [...cutByType.entries()].sort())
	console.log(
		`  ${type}`.padEnd(14) +
			`${acc.rows.toLocaleString()}`.padStart(11) +
			`${pct(acc.spreadless, acc.rows)}`.padStart(14) +
			`${pct(acc.flatSpreadless, acc.rows)}`.padStart(14) +
			`${((100 * acc.spreadSum) / acc.rows).toFixed(2)}%`.padStart(20),
	);
console.log(
	`  the FLAT control erases ${cutTotal.flatSpreadless.toLocaleString()} rows against the graded ` +
		`${cutTotal.spreadless.toLocaleString()} — ${cutTotal.flatSpreadless === cutTotal.spreadless ? "the same set, so the tech-level grade decides none of the erasure" : "DIFFERENT sets, so the grade does decide some of it"}.`,
);
console.log(
	"  Read the TL column as a mix, not as a grade: the cut dies at §3's price floor, where",
);
console.log(
	"  any cut collides. The axis #13's warning was about is the station-type table above —",
);
console.log(
	"  a per-type offset dying where the type lives — at a fiftieth of its size here.",
);
console.log(
	"  On an erased row the round trip nets nothing either, because the floor swallows the",
);
console.log(
	"  deficit's mark on the way through `stockResponse`; tests/market.test.ts §5.6 checks",
);
console.log(
	"  that per erased row, at the shipped quantization and the sell-first order.",
);
