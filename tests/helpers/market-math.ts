/**
 * The **measurement** half of `economy-trade.md` — everything the game never
 * calls.
 *
 * The shipping arithmetic moved to `src/market.ts` when node
 * [#25](https://github.com/jcfischer/seelite/issues/25) wired the market; §11
 * of the spec named that split as owed, and named it a split rather than a
 * move. What is left here is the surface that exists to *check* the module:
 * Bell's own Narcotics row, his wrapping byte close, the domain sweeps, the
 * legal-pair walks and the residual surveys. None of it belongs inside a
 * runtime module, and the import direction now runs the right way — this file
 * and `scripts/measure-market.ts` both depend on `src/market.ts`, where before
 * `scripts/` depended on `tests/` for arithmetic the game ships.
 *
 * It lives under `tests/helpers/` for the reason `station-rows.ts` gives: the
 * guarded tier must not depend on operator tooling. The suite and the
 * instrument share it so the number in the spec and the number under test
 * cannot drift.
 */

import {
	type ByteClose,
	type Commodity,
	COMMODITIES,
	DEFICIT_MAX,
	DEFICIT_SATURATION_RUNS,
	ECONOMY_MAX,
	ECONOMY_MIN,
	HOLD_REFERENCE_T,
	MIN_STOCK_RESPONSE_FACTOR,
	PRICE_ELASTICITY,
	PRICE_STEP_CR,
	QUANTITY_CAP,
	SATURATE,
	type StationTypeKey,
	TYPE_OFFSET,
	addDeficit,
	clamp,
	commodity,
	decayDeficit,
	i8,
	marketRowAt,
	stockResponse,
} from "../../src/market";

/**
 * Bell's own Narcotics row, kept so the divergence can be re-measured rather
 * than taken on trust (§2.3).
 *
 * `0xEB` with a `+29` gradient and a `0x78` mask **cannot** stay inside a byte:
 * `235 + 120 + 7×29` is 558. Bell chose those constants *to* overflow, and the
 * wrap is where the good's entire price variation lives. Under §2's saturating
 * arithmetic it flattens to 94.0–102.0 Cr and the fence→fence margin falls from
 * 100.4 Cr/t to 8.0 Cr/t, which deletes the smuggling trade `station-types.md`
 * §3.4 is built on.
 */
export const NARCOTICS_BELL: Commodity = {
	name: "Narcotics",
	basePrice: 0xeb,
	gradient: 29,
	baseQuantity: i8(0x08),
	mask: 0x78,
	unit: "t",
	illegal: true,
	sellOnly: false,
};

/**
 * The margin a pair still pays once **both** deficits sit at the ±63 cap — the
 * steady state a farmer actually earns, which is what §5.4 turns on.
 *
 * The ratio bound (`1.315 / 0.685` = 1.920) says only whether a pair reaches
 * exactly zero, and that is the wrong question: Food at a ratio of 12 leaves
 * 2.8 Cr/t because it is a 0.4 Cr good. What matters is whether any pair leaves
 * real money, and this is the number that answers it.
 */
export const saturatedDeficitT = (holdT: number): number =>
	DEFICIT_SATURATION_RUNS * holdT;

/**
 * A §5.2 response, as a function two arms of a sweep can both be run through.
 *
 * One parameter rather than two copies of every loop below: #182 compares the
 * shipped response against the one it replaced, and #25's three riggings were
 * all the same shape — the two arms of a comparison built by different code.
 * The arms here differ in this argument and in nothing else.
 */
export type StockResponse = (
	priceCr: number,
	deficit: number,
	holdT: number,
) => number;

/**
 * §5.2's response **as it stood before #182**: a ±63 *tonne* clamp over a fixed
 * 20 t reference, whatever the hull.
 *
 * Kept runnable rather than described, for the reason `BELL_WRAP` above is kept
 * — a rejection with no runnable counterpart is an assertion. It is the control
 * arm of #182's sweep and the thing `measure-hull-pricing.ts` compares against,
 * and the suite requires it to go *red* on the property the change was made
 * for: above `DEFICIT_MAX` tonnes of hold this expression cannot tell one hull
 * from another, because a single run already reaches the clamp.
 *
 * It agrees with `stockResponse` exactly at `HOLD_REFERENCE_T`, which is what
 * makes every figure §5.4 was ratified on survive the change.
 */
export const fixedReferenceResponse: StockResponse = (
	priceCr: number,
	deficit: number,
): number =>
	Math.max(
		PRICE_STEP_CR,
		priceCr *
			(1 +
				(PRICE_ELASTICITY * clamp(deficit, -DEFICIT_MAX, DEFICIT_MAX)) /
					HOLD_REFERENCE_T),
	);

export const residualMarginCr = (
	buyCr: number,
	sellCr: number,
	holdT: number,
	response: StockResponse = stockResponse,
): number =>
	response(sellCr, -saturatedDeficitT(holdT), holdT) -
	response(buyCr, saturatedDeficitT(holdT), holdT);

/**
 * Bell's byte arithmetic, kept runnable because §2 rejects it and a rejection
 * with no runnable counterpart is an assertion.
 *
 * `BELL_WRAP` is Bell verbatim — `& 0xFF`, overflow and all; `SATURATE` in
 * `src/market.ts` is seelite's choice. They agree everywhere the sum stays
 * inside a byte and part company only at the ends, which is exactly the
 * population the instrument measures.
 *
 * **The quantity byte is Bell's here too.** An earlier version clamped the
 * quantity regardless of mode, which made every wrapping measurement a hybrid:
 * Bell's price arithmetic with seelite's shelf. §2.3's "Bell + wrap" row was
 * quoting an availability figure that was never Bell's, in a table written to
 * justify diverging from him. His is: clip a negative to zero, then `& 0x3F`,
 * which folds 64…127 back down.
 */
export const BELL_WRAP: ByteClose = {
	price: (v) => ((v % 256) + 256) % 256,
	quantity: (v) => {
		const byte = ((v % 256) + 256) % 256;
		return byte & 0x80 ? 0 : byte & QUANTITY_CAP;
	},
};

/**
 * The whole fluctuation domain.
 *
 * **Sweep this, not a stride.** The first version of the suite swept every 8th
 * byte on the reasoning that the coarse masks (0x70, 0x78) step by 8 — but
 * `8k & 0x01`, `& 0x03` and `& 0x07` are identically zero, so nine of the
 * seventeen goods were exercised at zero fluctuation only, and the comment
 * claiming a "strict superset" had it exactly backwards. 256 values is cheap;
 * the shortcut cost more than it saved.
 */
export const ALL_FLUCT: readonly number[] = Array.from(
	{ length: 256 },
	(_, i) => i,
);

/** Every sweep in the suite and the instrument covers the whole range. */
export const ALL_ECONOMIES: readonly number[] = Array.from(
	{ length: ECONOMY_MAX - ECONOMY_MIN + 1 },
	(_, i) => ECONOMY_MIN + i,
);

/**
 * Five independent (buy, sell) fluctuation pairs.
 *
 * Shared rather than written out in both consumers: two stations have different
 * seeds, so their bytes are unrelated, and a byte changed in one copy would
 * silently make §5.4's reported margins and the suite's assertions two
 * different measurements.
 */
export const FLUCT_PAIRS: readonly [number, number][] = [
	[0x00, 0x91],
	[0x3d, 0x1c],
	[0x7a, 0xc6],
	[0xb1, 0x58],
	[0xee, 0x2f],
];

/** The two types whose offset is non-zero — the only ones §3's floor can reach. */
export const OFFSET_STATIONS: readonly StationTypeKey[] = [
	"refinery",
	"shipyard",
];

export const ALL_STATIONS: readonly StationTypeKey[] = [
	"trade",
	"refinery",
	"shipyard",
];

/**
 * The full (economy, fluct) domain, walked once.
 *
 * Four measurements had this nest written out by hand, each with its own
 * `rows++` accumulator — a fifth would have been a fifth chance to forget one.
 * `hit` is counted when the callback returns true.
 */
export function sweepDomain(
	visit: (economy: number, fluct: number) => boolean | undefined,
): { hits: number; rows: number } {
	let hits = 0;
	let rows = 0;
	for (const economy of ALL_ECONOMIES)
		for (const fluct of ALL_FLUCT) {
			if (visit(economy, fluct) === true) hits++;
			rows++;
		}
	return { hits, rows };
}

/**
 * Best per-unit margin buying one good at a station of `buyStation` type and
 * selling it at a `sellStation` one, over the whole (economy, fluct) domain.
 *
 * The buy and sell sides are searched **independently** — two stations have
 * different seeds, so their fluctuation bytes are unrelated, and a paired sweep
 * both understates the margin and costs a 4-million-iteration cross product for
 * no gain. `minBuy` is restricted to rows that actually carry stock; `maxSell`
 * is not, because selling needs no shelf.
 *
 * Shared by the suite and the instrument so §2.3's table and the test guarding
 * it are the same measurement rather than two that agree today.
 */
export function bestMargin(
	commodity: Commodity,
	buyStation: StationTypeKey,
	sellStation: StationTypeKey,
	close: ByteClose = SATURATE,
): { margin: number; inStock: number } {
	let minBuy = Number.POSITIVE_INFINITY;
	let maxSell = 0;
	const { hits: stocked, rows } = sweepDomain((economy, fluct) => {
		const buy = marketRowAt(commodity, economy, fluct, buyStation, close);
		maxSell = Math.max(
			maxSell,
			marketRowAt(commodity, economy, fluct, sellStation, close).priceCr,
		);
		if (buy.quantity === 0) return false;
		minBuy = Math.min(minBuy, buy.priceCr);
		return true;
	});
	return {
		margin: stocked === 0 ? 0 : maxSell - minBuy,
		inStock: stocked / rows,
	};
}

/** §8: a full trade run is 3–5 minutes, so the previous run's mark is already
 *  fading by the time you dock again. */
export const RUN_MINUTES = 4;

/**
 * §5.4's brake, measured: how many times the same station pair can be run
 * before the deficit closes the margin.
 *
 * Shared by the suite and the instrument, for the reason `bestMargin` is — an
 * earlier version had the loop written out in both, including its own copies of
 * `holdT` and `runMinutes`, so "the same measurement" was a claim about two
 * bodies of code that happened to agree.
 */
export function runsToExhaustion(opts: {
	buyBaseCr: number;
	sellBaseCr: number;
	/** The flown hull's hold, tonnes. **Required since #182**: the response
	 *  saturates in `DEFICIT_SATURATION_RUNS` runs of *this* hold, so a default
	 *  would silently measure the courier's brake for a freighter. */
	holdT: number;
	/** Game minutes a full run takes to fly — the mark fades while you do. */
	runMinutes?: number;
	maxRuns?: number;
	/** Which §5.2 response to farm against — #182's two arms. */
	response?: StockResponse;
}): { runs: number; margins: number[]; profitCr: number } {
	const holdT = opts.holdT;
	const response = opts.response ?? stockResponse;
	const runMinutes = opts.runMinutes ?? RUN_MINUTES;
	const maxRuns = opts.maxRuns ?? 20;
	const margins: number[] = [];
	let bought = 0;
	let sold = 0;
	let profitCr = 0;
	while (margins.length < maxRuns) {
		const margin =
			response(opts.sellBaseCr, -sold, holdT) -
			response(opts.buyBaseCr, bought, holdT);
		if (margin <= 0) break;
		margins.push(margin);
		profitCr += margin * holdT;
		bought = addDeficit(decayDeficit(bought, runMinutes), holdT, holdT);
		sold = addDeficit(decayDeficit(sold, runMinutes), holdT, holdT);
		// **Both arms accumulate the same tonnes.** The rejected arm differs only
		// in how a mark is *read*, which is the one thing #182 is comparing; an
		// arm that also accumulated differently would be two changes wearing one
		// label.
	}
	return { runs: margins.length, margins, profitCr };
}

/** One legal intra-system trade: buy at one station type, sell at another. */
export interface LegalPair {
	good: Commodity;
	economy: number;
	buyStation: StationTypeKey;
	sellStation: StationTypeKey;
	buyCr: number;
	sellCr: number;
}

/**
 * Every legal intra-system (good, economy, buy-leg, sell-leg, byte, byte) tuple
 * whose buy side actually carries stock.
 *
 * **All six ordered station legs**, because the direction matters and two
 * separate measurements each searched only the one written first: the richest
 * residual sits on refinery→shipyard, the leg both of them excluded.
 *
 * Illegal goods are out by construction — §4 scopes contraband to fences, so a
 * shipyard leg is not a transaction that exists, and including them finds a
 * "best pair" at a ratio of 59 that no player can fly.
 */
export function forEachLegalPair(
	visit: (pair: LegalPair) => void,
	fluctPairs?: readonly (readonly [number, number])[],
): void {
	// **Sub-tonne goods are in.** An earlier version filtered `unit === "t"`,
	// which left weak joint 8's "richest surviving farm" claim swept over a
	// domain excluding Gold, Platinum and Gem-Stones — the goods §2.2 of the
	// same spec calls the ones the quantity clamp enriched. Callers that need
	// per-run comparability use `runValueCr`.
	const legal = COMMODITIES.filter((c) => !c.sellOnly && !c.illegal);
	// One byte source, resolved once: the two branches this replaced built an
	// identical visit payload and repeated the same stock check.
	const pairsFor = (buyFluct: number): readonly number[] =>
		fluctPairs
			? fluctPairs.filter(([b]) => b === buyFluct).map(([, sell]) => sell)
			: ALL_FLUCT;
	const buyBytes = fluctPairs ? fluctPairs.map(([buy]) => buy) : ALL_FLUCT;
	for (const good of legal)
		for (const economy of ALL_ECONOMIES)
			for (const buyStation of ALL_STATIONS)
				for (const sellStation of ALL_STATIONS) {
					if (buyStation === sellStation) continue;
					for (const buyFluct of buyBytes) {
						const buy = marketRowAt(good, economy, buyFluct, buyStation);
						if (buy.quantity === 0) continue;
						for (const sellFluct of pairsFor(buyFluct))
							visit({
								good,
								economy,
								buyStation,
								sellStation,
								buyCr: buy.priceCr,
								sellCr: marketRowAt(good, economy, sellFluct, sellStation)
									.priceCr,
							});
					}
				}
}

/** The ratio the deficit can drive to zero: 1.315 / 0.685. */
export const CLOSABLE_RATIO =
	(2 - MIN_STOCK_RESPONSE_FACTOR) / MIN_STOCK_RESPONSE_FACTOR;

export interface ResidualSurvey {
	/** The richest *run* any legal intra-system pair still pays at the ±63 cap.
	 *  Ranked by run value, not per-unit margin: the sweep includes sub-tonne
	 *  goods, whose Cr/kg is not comparable with a tonne good's Cr/t. */
	worst: LegalPair & { residualCr: number; runCr: number };
	/** The largest *per-unit* residual, which is a different argmax — §10.1
	 *  bounds both, and asserting one against the other's winner was guarding
	 *  the wrong pair. It only looked right because sub-tonne residuals are
	 *  non-positive today, so the two happen to coincide. */
	worstPerUnit: LegalPair & { residualCr: number };
	/** Ratio-based view, kept because §5.4 reports both. */
	worstRatio: LegalPair & { ratio: number };
	unclosableRows: number;
	rows: number;
}

/**
 * The §5.4 survey: how much an intra-system farm still earns once both deficits
 * saturate, and how often the ratio bound is exceeded at all.
 *
 * One body, called by the suite and the instrument. Two near-identical
 * six-level nests lived in those two files and differed only in what they
 * accumulated, so a change to the domain had to be made twice or the two
 * reported figures would silently disagree.
 */
export function surveyResiduals(
	holdT: number,
	response: StockResponse = stockResponse,
): ResidualSurvey {
	const empty = COMMODITIES[0];
	let worst = {
		good: empty,
		economy: 0,
		buyStation: "trade" as StationTypeKey,
		sellStation: "trade" as StationTypeKey,
		buyCr: 0,
		sellCr: 0,
		residualCr: 0,
		runCr: 0,
	};
	let worstPerUnit: LegalPair & { residualCr: number } = { ...worst };
	let worstRatio: LegalPair & { ratio: number } = { ...worst, ratio: 0 };
	let unclosableRows = 0;
	let rows = 0;
	forEachLegalPair((pair) => {
		rows++;
		const residualCr = residualMarginCr(
			pair.buyCr,
			pair.sellCr,
			holdT,
			response,
		);
		const runCr = runValueCr(pair.good, residualCr, holdT);
		if (runCr > worst.runCr) worst = { ...pair, residualCr, runCr };
		if (residualCr > worstPerUnit.residualCr)
			worstPerUnit = { ...pair, residualCr };
		const ratio = pair.sellCr / pair.buyCr;
		if (ratio > CLOSABLE_RATIO) unclosableRows++;
		if (ratio > worstRatio.ratio) worstRatio = { ...pair, ratio };
	});
	return { worst, worstPerUnit, worstRatio, unclosableRows, rows };
}

/**
 * What one run of a good is actually worth, in credits.
 *
 * **Per-unit margins are not comparable across the table**, and a test that
 * ranked them was measuring unit scale rather than economics: Gold's ~5.6 Cr/kg
 * is 5,600 Cr per tonne-equivalent beside Narcotics' 81.2 Cr/t, so sub-tonne
 * goods "win" any straight comparison of `bestMargin`.
 *
 * The quantity a run can carry differs by unit, and that is what makes them
 * commensurable:
 *
 * - **tonne goods** fill the hold, so a run carries `HOLD_REFERENCE_T` of them;
 * - **sub-tonne goods** (Gold, Platinum, Gem-Stones) skip the hold check
 *   entirely — research §2.2 — so a run is limited only by Bell's 63-unit
 *   shelf cap, and rides *alongside* a full hold rather than inside it.
 */
export const runValueCr = (
	good: Commodity,
	marginCr: number,
	holdT: number,
): number => marginCr * (good.unit === "t" ? holdT : QUANTITY_CAP);

/**
 * Best fresh and saturated margin between two concrete endpoints, over every
 * legal tonne good and a set of independent fluctuation-byte pairs.
 *
 * Shared with the interstellar sweep in the instrument, which had its own copy
 * of the legal-good filter, the stock check and the residual accumulation —
 * the same duplication `forEachLegalPair` was extracted to remove for the
 * intra-system case, reintroduced one section further down the same file.
 */
export function bestResidualBetween(
	from: { economy: number; stations: readonly StationTypeKey[] },
	to: { economy: number; stations: readonly StationTypeKey[] },
	holdT: number,
	fluctPairs: readonly (readonly [number, number])[] = FLUCT_PAIRS,
	response: StockResponse = stockResponse,
): { freshCr: number; saturatedCr: number } {
	let freshCr = 0;
	let saturatedCr = 0;
	for (const good of COMMODITIES) {
		if (good.sellOnly || good.illegal || good.unit !== "t") continue;
		for (const [buyFluct, sellFluct] of fluctPairs)
			for (const buyStation of from.stations)
				for (const sellStation of to.stations) {
					const buy = marketRowAt(good, from.economy, buyFluct, buyStation);
					if (buy.quantity === 0) continue;
					const sellCr = marketRowAt(
						good,
						to.economy,
						sellFluct,
						sellStation,
					).priceCr;
					freshCr = Math.max(freshCr, sellCr - buy.priceCr);
					saturatedCr = Math.max(
						saturatedCr,
						residualMarginCr(buy.priceCr, sellCr, holdT, response),
					);
				}
	}
	return { freshCr, saturatedCr };
}

/**
 * Best margin for one good over **all six ordered station legs**, not just
 * refinery→refinery.
 *
 * §4's run-value table compared legal goods on the fence's own leg, which is a
 * restriction §4 imposes on *contraband* by design and on nothing else: a legal
 * good bought at a shipyard and sold at a refinery picks up the full five-step
 * type spread. Ranking legal goods on the contraband leg understated them and
 * so overstated the premium the section exists to justify.
 */
export function bestMarginAnyLeg(
	good: Commodity,
	close: ByteClose = SATURATE,
): { margin: number; buyStation: StationTypeKey; sellStation: StationTypeKey } {
	let best = {
		margin: 0,
		buyStation: "trade" as StationTypeKey,
		sellStation: "trade" as StationTypeKey,
	};
	for (const buyStation of ALL_STATIONS)
		for (const sellStation of ALL_STATIONS) {
			if (buyStation === sellStation) continue;
			const { margin } = bestMargin(good, buyStation, sellStation, close);
			if (margin > best.margin) best = { margin, buyStation, sellStation };
		}
	return best;
}

/**
 * The run value §4 ranks on: best margin over every leg the good may legally
 * trade on, times what one trip carries.
 *
 * **Contraband is held to the fence leg**, because §4 scopes it there — a
 * shipyard will not buy it at any price. Everything else is free to use the
 * whole table, which is what makes the comparison a fair one.
 */
export function bestRunValueCr(
	good: Commodity,
	holdT: number = HOLD_REFERENCE_T,
): {
	runCr: number;
	marginCr: number;
	leg: string;
} {
	if (good.illegal) {
		const { margin } = bestMargin(good, "refinery", "refinery");
		return {
			runCr: runValueCr(good, margin, holdT),
			marginCr: margin,
			leg: "refinery→refinery",
		};
	}
	const { margin, buyStation, sellStation } = bestMarginAnyLeg(good);
	return {
		runCr: runValueCr(good, margin, holdT),
		marginCr: margin,
		leg: `${buyStation}→${sellStation}`,
	};
}

/**
 * What **one run** is worth, carrying the best legal cargo available on a leg.
 *
 * `runValueCr` prices one good in isolation, and reading §4's table as a ranking
 * of *runs* was the error it hid: a run carries a full hold **and** all three
 * sub-tonne goods, because Gold, Platinum and Gem-Stones skip the hold check
 * (research §2.2). The "or" in that sentence is inclusive, and treating it as
 * exclusive understated every route that can stack.
 *
 * `holdGood` restricts what fills the hold — contraband for a smuggling run,
 * any legal tonne good otherwise — while the metals ride along either way.
 */
export function runTotalCr(opts: {
	buyEconomy: number;
	sellEconomy: number;
	buyStation: StationTypeKey;
	sellStation: StationTypeKey;
	buyFluct: number;
	sellFluct: number;
	holdGood: (good: Commodity) => boolean;
	/** The flown hull's hold, tonnes. §4's run-value table is the baseline
	 *  hull's, which is what it has always been; #182 made the figure nameable
	 *  rather than implicit. */
	holdT?: number;
}): { totalCr: number; holdCr: number; subTonneCr: number } {
	const holdT = opts.holdT ?? HOLD_REFERENCE_T;
	let holdCr = 0;
	let subTonneCr = 0;
	for (const good of COMMODITIES) {
		if (good.sellOnly) continue;
		const buy = marketRowAt(
			good,
			opts.buyEconomy,
			opts.buyFluct,
			opts.buyStation,
		);
		if (buy.quantity === 0) continue;
		const margin =
			marketRowAt(good, opts.sellEconomy, opts.sellFluct, opts.sellStation)
				.priceCr - buy.priceCr;
		if (margin <= 0) continue;
		const value = runValueCr(good, margin, holdT);
		if (good.unit === "t") {
			if (opts.holdGood(good)) holdCr = Math.max(holdCr, value);
		} else if (!good.illegal) {
			// Every sub-tonne good rides, and they are all legal (§3.4).
			subTonneCr += value;
		}
	}
	return { totalCr: holdCr + subTonneCr, holdCr, subTonneCr };
}

/**
 * How often §3.1's floor fires across a set of station types.
 *
 * Shared, because the suite's assertion and the instrument's reported figure
 * were the same two-line nest in two files — the duplication `surveyResiduals`
 * was extracted to collapse, still standing one measurement over.
 */
export function floorRate(stations: readonly StationTypeKey[]): {
	fired: number;
	rows: number;
} {
	let fired = 0;
	let rows = 0;
	for (const good of COMMODITIES)
		for (const station of stations) {
			const swept = sweepDomain(
				(economy, fluct) =>
					marketRowAt(good, economy, fluct, station).floorFired,
			);
			fired += swept.hits;
			rows += swept.rows;
		}
	return { fired, rows };
}

/**
 * §6's compounding: how many runs before the hold, rather than capital, is what
 * limits a trade.
 *
 * Derived rather than asserted — §1's rule is that a quoted figure has a
 * re-derivation path, and this one was prose arithmetic that came out one run
 * short. The lane is research §2.3's canonical one, priced at zero fluctuation:
 * Computers out of Rich Industrial into Poor Agricultural.
 */
export function runsUntilHoldLimited(opts: {
	startCr: number;
	buyCr: number;
	sellCr: number;
	holdT?: number;
	maxRuns?: number;
}): number {
	const holdT = opts.holdT ?? HOLD_REFERENCE_T;
	let capital = opts.startCr;
	let runs = 0;
	while (runs < (opts.maxRuns ?? 50)) {
		const tonnes = capital / opts.buyCr;
		if (tonnes >= holdT) return runs;
		capital += tonnes * (opts.sellCr - opts.buyCr);
		runs++;
	}
	return runs;
}
