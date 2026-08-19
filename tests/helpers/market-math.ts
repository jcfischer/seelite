/**
 * The executable statement of `economy-trade.md` §2–§3: Bell's commodity table
 * and the price/quantity arithmetic seelite derives from it.
 *
 * It lives under `tests/helpers/` for the reason `station-rows.ts` gives — the
 * guarded tier must not depend on operator tooling — and because #7 is a
 * decision node: it owes a decision and the instrument that checks it, not a
 * wired module. **The implement node moves this to `src/market.ts`**; until it
 * does, this is the one copy, imported by both the suite and the measurement
 * script so the number in the spec and the number under test cannot drift.
 *
 * Two transcription traps are handled here rather than discovered later:
 *
 * 1. **`baseQuantity` is a signed byte.** Liquor 0xFB, Slaves 0xE2, Furs 0xDC,
 *    Gem-Stones 0xFA and Alien Items 0xC0 are −5, −30, −36, −6 and −64 — the
 *    6502 reads them as two's complement. Read them unsigned and every one of
 *    those goods is at the 63-unit cap in every system, which inverts the trade
 *    lanes the whole economy is built on. `basePrice` is genuinely unsigned.
 * 2. **`gradient` is signed and applies as `economy × gradient`** to price
 *    *added* and to quantity *subtracted*. That opposite sign is what makes
 *    cheap imply plentiful, and it is the mechanism the type offset (§3) and
 *    the stock deficit (§5) each reuse rather than inventing their own.
 *
 * **`marketRow` is keyed on station *type*, and must widen.** §5.1 derives the
 * fluctuation byte from `hash(stationSeed, epoch)` and §5.2 keys the deficit per
 * station, so both need station *identity*. Type is all this spec's arithmetic
 * needs and all the measurements exercise, so the narrower signature stands
 * here; the implement node widens it to a `{ type, seed }` struct along with
 * every call site, and §11 records that as owed.
 */

/** Elite's byte→credits step: a price byte is 0.4 Cr. */
export const PRICE_STEP_CR = 0.4;

/** Bell's `& 0x3F` — the cap that forces multi-good baskets. */
export const QUANTITY_CAP = 0x3f;

/** Economy runs 0 = Rich Industrial → 7 = Poor Agricultural. */
const ECONOMY_MIN = 0;
const ECONOMY_MAX = 7;

type CommodityUnit = "t" | "kg" | "g";

export interface Commodity {
	name: string;
	/** Unsigned byte. */
	basePrice: number;
	/** Signed: "five bits plus sign" in the 6502. */
	gradient: number;
	/** **Signed** byte — see this module's header. */
	baseQuantity: number;
	/** Which bits of the fluctuation byte this good reads. */
	mask: number;
	unit: CommodityUnit;
	/** §4: the scoped class. Traded only at a fence. */
	illegal: boolean;
	/** Alien Items: quantity forced to 0, so it can be sold and never bought. */
	sellOnly: boolean;
}

/** Two's-complement read of a byte literal, for the `baseQuantity` column. */
const i8 = (byte: number): number => (byte << 24) >> 24;

/**
 * Builds one row. The four numeric columns are what a reader checks against
 * `txtelite.c`, so they are positional and aligned; the three flags are
 * defaults on fourteen of the seventeen rows and are named only where they
 * differ. Spelling them out on every row buried the table's real content in
 * boilerplate the spec asks readers to verify column by column.
 */
const good = (
	name: string,
	basePrice: number,
	gradient: number,
	baseQuantityByte: number,
	mask: number,
	extra: Partial<Pick<Commodity, "unit" | "illegal" | "sellOnly">> = {},
): Commodity => ({
	name,
	basePrice,
	gradient,
	baseQuantity: i8(baseQuantityByte),
	mask,
	unit: "t",
	illegal: false,
	sellOnly: false,
	...extra,
});

/**
 * Research §2.2's table, hex literals kept so the transcription can be checked
 * against the source column by column: name, basePrice, gradient, baseQuantity,
 * mask. `Gem-Strones` is Bell's own typo and is spelled correctly here.
 */
export const COMMODITIES: readonly Commodity[] = [
	good("Food", 0x13, -2, 0x06, 0x01),
	good("Textiles", 0x14, -1, 0x0a, 0x03),
	good("Radioactives", 0x41, -3, 0x02, 0x07),
	good("Slaves", 0x28, -5, 0xe2, 0x1f, { illegal: true }),
	good("Liquor/Wines", 0x53, -5, 0xfb, 0x0f),
	good("Luxuries", 0xc4, 8, 0x36, 0x03),
	// The one divergence from Bell's column — see NARCOTICS_BELL below.
	good("Narcotics", 0x14, 13, 0x08, 0x70, { illegal: true }),
	good("Computers", 0x9a, 14, 0x38, 0x03),
	good("Machinery", 0x75, 6, 0x28, 0x07),
	good("Alloys", 0x4e, 1, 0x11, 0x1f),
	good("Firearms", 0x7c, 13, 0x1d, 0x07, { illegal: true }),
	good("Furs", 0xb0, -9, 0xdc, 0x3f),
	good("Minerals", 0x20, -1, 0x35, 0x03),
	good("Gold", 0x61, -1, 0x42, 0x07, { unit: "kg" }),
	good("Platinum", 0xab, -2, 0x37, 0x1f, { unit: "kg" }),
	good("Gem-Stones", 0x2d, -1, 0xfa, 0x0f, { unit: "g" }),
	good("Alien Items", 0x35, 15, 0xc0, 0x07, { sellOnly: true }),
];

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
 * What the retune has to hold, asserted in `tests/market.test.ts` so a later
 * edit to the row cannot quietly reintroduce the collapse.
 */
export const NARCOTICS_RETUNE = {
	/** Never overflows: `20 + 112 + 7×13` = 223 ≤ 255. */
	maxPriceByte: 223,
	/** Measured fence→fence, independent fluctuation bytes. */
	minMarginCr: 75,
	/** Fraction of (economy, fluct) rows carrying stock. Bell's row gives 36%. */
	minInStock: 0.5,
} as const;

/** §3: the per-station-type price offset, in economy-equivalent steps. */
export const TYPE_OFFSET = { trade: 0, refinery: 3, shipyard: -2 } as const;
export type StationTypeKey = keyof typeof TYPE_OFFSET;

const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(Math.max(v, lo), hi);

/** One good by name. Both consumers had their own copy of this lookup. */
export const commodity = (name: string): Commodity => {
	const found = COMMODITIES.find((c) => c.name === name);
	if (!found) throw new Error(`no commodity named ${name}`);
	return found;
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
export const residualMarginCr = (buyCr: number, sellCr: number): number =>
	shelfPriceCr(sellCr, -DEFICIT_MAX) - shelfPriceCr(buyCr, DEFICIT_MAX);

/**
 * The two arithmetics, kept side by side because §2 rejects one of them and a
 * rejection with no runnable counterpart is an assertion.
 *
 * `wrap` is Bell verbatim — `& 0xFF`, overflow and all. `saturate` is seelite's
 * choice. They agree everywhere the sum stays inside a byte and part company
 * only at the ends, which is exactly the population the instrument measures.
 */
export type ByteMode = "wrap" | "saturate";

const closeByte = (v: number, mode: ByteMode): number =>
	mode === "wrap" ? ((v % 256) + 256) % 256 : clamp(v, 0, 255);

/**
 * The quantity byte's close — and **`mode` governs it too**.
 *
 * An earlier version clamped the quantity regardless of mode, which made every
 * `"wrap"` measurement a hybrid: Bell's price arithmetic with seelite's shelf.
 * §2.3's "Bell + wrap" row was quoting an availability figure that was never
 * Bell's, in a table written to justify diverging from him.
 *
 * `wrap` is his: clip a negative to zero, then `& 0x3F`, which folds 64…127
 * back down. `saturate` caps at the same 63 instead — §2.2's choice, and a
 * recorded divergence (§12 weak joint 8) rather than a transcription.
 */
const closeQuantity = (v: number, mode: ByteMode): number => {
	if (mode === "saturate") return clamp(v, 0, QUANTITY_CAP);
	const byte = ((v % 256) + 256) % 256;
	return byte & 0x80 ? 0 : byte & QUANTITY_CAP;
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
	visit: (economy: number, fluct: number) => boolean | void,
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

export interface MarketRow {
	commodity: Commodity;
	/** Credits per unit, before any stock-deficit response. */
	priceCr: number;
	/** The same price before §3's floor — what the floor is measured against. */
	unflooredPriceCr: number;
	/** Units on the shelf, 0…63. */
	quantity: number;
	/** True when the raw byte left 0…255, whichever mode closed it.
	 *  Named for the *input* condition rather than for what `saturate` does to
	 *  it, because it is set under `wrap` too. */
	priceOverflowed: boolean;
	/** True when §3's floor changed the price. */
	floorFired: boolean;
}

/**
 * One good's price and stock at one station, given the system's economy, the
 * visit's fluctuation byte and the station's type offset.
 *
 * The type offset lands in two different places on purpose (§3):
 * - **price** as a delta in *credits*, after the byte closes, so saturation
 *   cannot eat it — the map constraint from #13;
 * - **quantity** in units, and **only when it is positive**, so a type never
 *   makes a good scarcer. The symmetric form empties the fence's contraband
 *   shelf, which is measured rather than argued in the instrument.
 *
 * Everything a caller might want to measure is returned from here rather than
 * recomputed outside. The first instrument hand-rolled the floor check from the
 * raw byte with its own copy of `TYPE_OFFSET`, which is precisely the second
 * copy this module exists to prevent.
 */
export function marketRow(
	commodity: Commodity,
	economy: number,
	fluct: number,
	station: StationTypeKey,
	mode: ByteMode = "saturate",
): MarketRow {
	const product = economy * commodity.gradient;
	const changing = fluct & commodity.mask;
	const offset = TYPE_OFFSET[station];

	const rawPrice = commodity.basePrice + changing + product;
	const closedPrice = closeByte(rawPrice, mode);
	const priceOverflowed = closedPrice !== rawPrice;

	// §3: credits, after the clamp, floored at one price step.
	const unflooredPriceCr =
		closedPrice * PRICE_STEP_CR + offset * commodity.gradient * PRICE_STEP_CR;
	const priceCr = Math.max(PRICE_STEP_CR, unflooredPriceCr);

	// §2.2's clamp applies to the quantity byte too, and **that is a divergence
	// from Bell, not a transcription of him** — see `closeQuantity`. Gold's raw
	// quantity is always 66–80, so txtelite shows 2–16 units where seelite shows
	// a permanent 63.
	const baseQuantity = closeQuantity(
		commodity.baseQuantity + changing - product,
		mode,
	);
	const quantityDelta = Math.max(0, -offset * commodity.gradient);
	const quantity = commodity.sellOnly
		? 0
		: clamp(baseQuantity + quantityDelta, 0, QUANTITY_CAP);

	return {
		commodity,
		priceCr,
		unflooredPriceCr,
		quantity,
		priceOverflowed,
		floorFired: unflooredPriceCr < PRICE_STEP_CR,
	};
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
	mode: ByteMode = "saturate",
): { margin: number; inStock: number } {
	let minBuy = Number.POSITIVE_INFINITY;
	let maxSell = 0;
	const { hits: stocked, rows } = sweepDomain((economy, fluct) => {
		const buy = marketRow(commodity, economy, fluct, buyStation, mode);
		maxSell = Math.max(
			maxSell,
			marketRow(commodity, economy, fluct, sellStation, mode).priceCr,
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

/**
 * §5's stock response: the market's memory of what the player took or dumped.
 *
 * Proportional, not a flat byte shift. A flat shift is the obvious reading of
 * "deficit behaves like `product`", and it breaks the cheap goods: one 20 t
 * hold of Food would move its price by 8 Cr against a ~7 Cr base — more than
 * the entire Rich→Poor economy sweep moves it. Scaling by the price keeps the
 * response legible at both ends of the table.
 */
export const PRICE_ELASTICITY = 0.1;
export const HOLD_REFERENCE_T = 20;

/** §5.1: how often the base market re-rolls, in minutes of game time. */
export const MARKET_PERIOD_MIN = 30;
/** §5.2: how fast the player's mark on a market fades, in minutes. */
export const DEFICIT_HALF_LIFE_MIN = 20;
/** §5.2: the deficit cannot exceed Bell's quantity cap in either direction. */
export const DEFICIT_MAX = QUANTITY_CAP;
/** §8: a full trade run is 3–5 minutes, so the previous run's mark is already
 *  fading by the time you dock again. */
export const RUN_MINUTES = 4;

/** §5.2's exponential decay, applied lazily on read from `updatedAt`. */
export const decayDeficit = (deficit: number, elapsedMin: number): number =>
	deficit * 2 ** (-elapsedMin / DEFICIT_HALF_LIFE_MIN);

/** §5.2's accumulation, which saturates at the cap rather than running away. */
export const addDeficit = (deficit: number, units: number): number =>
	clamp(deficit + units, -DEFICIT_MAX, DEFICIT_MAX);

/**
 * §5.1: which market epoch a game time falls in for one station. The `phase`
 * term staggers stations so every market in a system does not flip together.
 */
export const marketEpoch = (phaseMin: number, gameTimeMin: number): number =>
	Math.floor((gameTimeMin + phaseMin) / MARKET_PERIOD_MIN);

/** The tightest the response can squeeze a price *before* the floor: the
 *  ±`DEFICIT_MAX` clamp bounds the multiplier at `1 − 0.1 × 63 / 20`. */
export const MIN_STOCK_RESPONSE_FACTOR =
	1 - (PRICE_ELASTICITY * DEFICIT_MAX) / HOLD_REFERENCE_T;

/**
 * **The floor is needed here, and an earlier version removed it on a false
 * premise.** The reasoning was that the ±63 clamp bounds the multiplier at
 * 0.685, so the result could never fall below §3's floor. That is true only for
 * prices at or above `PRICE_STEP_CR / MIN_STOCK_RESPONSE_FACTOR` ≈ 0.584 Cr —
 * and the rows §3's floor pins at exactly 0.4 Cr are precisely the population
 * below it: 0.4 × 0.685 = 0.274 Cr, under the floor the row was just given.
 * A bound that holds for most of the domain is not a bound.
 */
export const stockResponse = (priceCr: number, deficit: number): number =>
	Math.max(
		PRICE_STEP_CR,
		priceCr *
			(1 +
				(PRICE_ELASTICITY * clamp(deficit, -DEFICIT_MAX, DEFICIT_MAX)) /
					HOLD_REFERENCE_T),
	);

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
	holdT?: number;
	/** Game minutes a full run takes to fly — the mark fades while you do. */
	runMinutes?: number;
	maxRuns?: number;
}): { runs: number; margins: number[]; profitCr: number } {
	const holdT = opts.holdT ?? HOLD_REFERENCE_T;
	const runMinutes = opts.runMinutes ?? RUN_MINUTES;
	const maxRuns = opts.maxRuns ?? 20;
	const margins: number[] = [];
	let bought = 0;
	let sold = 0;
	let profitCr = 0;
	while (margins.length < maxRuns) {
		const margin =
			stockResponse(opts.sellBaseCr, -sold) -
			stockResponse(opts.buyBaseCr, bought);
		if (margin <= 0) break;
		margins.push(margin);
		profitCr += margin * holdT;
		bought = addDeficit(decayDeficit(bought, runMinutes), holdT);
		sold = addDeficit(decayDeficit(sold, runMinutes), holdT);
	}
	return { runs: margins.length, margins, profitCr };
}

/**
 * §1's pipeline, composed: the price actually shown on the shelf.
 *
 * `marketRow().priceCr` is the price *before* §5's stock response, which is a
 * trap for a consumer that reads the field and stops. Every caller that wants
 * what the player pays goes through here, and §5's response is not exported for
 * direct use by anything but this.
 */
export const shelfPriceCr = (basePriceCr: number, deficit: number): number =>
	stockResponse(basePriceCr, deficit);

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
	const legal = COMMODITIES.filter(
		(c) => !c.sellOnly && c.unit === "t" && !c.illegal,
	);
	for (const good of legal)
		for (const economy of ALL_ECONOMIES)
			for (const buyStation of ALL_STATIONS)
				for (const sellStation of ALL_STATIONS) {
					if (buyStation === sellStation) continue;
					if (fluctPairs) {
						for (const [buyFluct, sellFluct] of fluctPairs) {
							const buy = marketRow(good, economy, buyFluct, buyStation);
							if (buy.quantity === 0) continue;
							visit({
								good,
								economy,
								buyStation,
								sellStation,
								buyCr: buy.priceCr,
								sellCr: marketRow(good, economy, sellFluct, sellStation)
									.priceCr,
							});
						}
						continue;
					}
					for (const buyFluct of ALL_FLUCT) {
						const buy = marketRow(good, economy, buyFluct, buyStation);
						if (buy.quantity === 0) continue;
						for (const sellFluct of ALL_FLUCT)
							visit({
								good,
								economy,
								buyStation,
								sellStation,
								buyCr: buy.priceCr,
								sellCr: marketRow(good, economy, sellFluct, sellStation)
									.priceCr,
							});
					}
				}
}

/** The ratio the deficit can drive to zero: 1.315 / 0.685. */
export const CLOSABLE_RATIO =
	(2 - MIN_STOCK_RESPONSE_FACTOR) / MIN_STOCK_RESPONSE_FACTOR;

export interface ResidualSurvey {
	/** The richest margin any legal intra-system pair still pays at the ±63 cap. */
	worst: LegalPair & { residualCr: number };
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
export function surveyResiduals(): ResidualSurvey {
	const empty = COMMODITIES[0];
	let worst = {
		good: empty,
		economy: 0,
		buyStation: "trade" as StationTypeKey,
		sellStation: "trade" as StationTypeKey,
		buyCr: 0,
		sellCr: 0,
		residualCr: 0,
	};
	let worstRatio: LegalPair & { ratio: number } = { ...worst, ratio: 0 };
	let unclosableRows = 0;
	let rows = 0;
	forEachLegalPair((pair) => {
		rows++;
		const residualCr = residualMarginCr(pair.buyCr, pair.sellCr);
		if (residualCr > worst.residualCr) worst = { ...pair, residualCr };
		const ratio = pair.sellCr / pair.buyCr;
		if (ratio > CLOSABLE_RATIO) unclosableRows++;
		if (ratio > worstRatio.ratio) worstRatio = { ...pair, ratio };
	});
	return { worst, worstRatio, unclosableRows, rows };
}
