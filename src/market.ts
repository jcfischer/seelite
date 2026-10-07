/**
 * The market: `economy-trade.md` §2–§7, wired.
 *
 * This is the runtime half of what node
 * [#7](https://github.com/jcfischer/seelite/issues/7) decided and
 * [#25](https://github.com/jcfischer/seelite/issues/25) built. It holds Bell's
 * commodity table, the price and stock arithmetic, §5's clock-derived
 * fluctuation and §5.2's response to a deficit, and §7's equipment prices — the
 * things the game calls.
 *
 * **The saved deficit map is `deficits.ts`'s** since
 * [#67](https://github.com/jcfischer/seelite/issues/67). §5.2's response to a
 * deficit is pricing and is here; §5.5's record of which station holds one is
 * save format and is not. The §6–§7 divider below says which way the dependency
 * runs and why.
 *
 * **It does not hold the measurement surface**, and that split is the point.
 * `tests/helpers/market-math.ts` keeps Bell's own Narcotics row, the wrapping
 * byte close, the domain sweeps and the residual surveys: code that exists to
 * check this module's arithmetic against the spec's claims and that the game
 * never calls. §11 of the spec names the split as owed by this node, because
 * moving the file wholesale would have shipped the instrument inside the
 * runtime module.
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
 * ## Two entry points, one arithmetic
 *
 * `marketRowAt` is the pure function of `(good, economy, fluctuation byte,
 * station type)` — what every sweep in the suite and the instrument exercises.
 * `marketRow` is the game's: it takes a **station identity** and a game time,
 * derives the epoch and the fluctuation byte from them per §5.1, and calls
 * `marketRowAt`. The spec's §11 asked for the signature to widen from station
 * *type* to `{ type, seed }`, and this is that widening: the seed is what the
 * fluctuation hash and the deficit key are both functions of, and neither is
 * derivable from a type.
 */

import { DOMAIN } from "./domains";
import { HULL_SPECS, PLAYER_BASELINE_HULL, requirePositiveHold } from "./hull";
import { mix, seededRand } from "./rng";

/** Elite's byte→credits step: a price byte is 0.4 Cr. */
export const PRICE_STEP_CR = 0.4;

/** Bell's `& 0x3F` — the cap that forces multi-good baskets. */
export const QUANTITY_CAP = 0x3f;

/** Economy runs 0 = Rich Industrial → 7 = Poor Agricultural. */
export const ECONOMY_MIN = 0;
export const ECONOMY_MAX = 7;

/** The three units the table uses. Exported since #443: the hold projection
 *  carries a line's unit so a renderer prints it rather than re-deriving it. */
export type CommodityUnit = "t" | "kg" | "g";

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

/** Two's-complement read of a byte literal, for the `baseQuantity` column.
 *  Exported for `NARCOTICS_BELL`, which is the one row transcribed outside this
 *  module and needs the same reading of it. */
export const i8 = (byte: number): number => (byte << 24) >> 24;

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
	// The one divergence from Bell's column — see `NARCOTICS_BELL` in
	// `tests/helpers/market-math.ts`, where the rejected row is kept runnable.
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
 * What the retune has to hold, asserted in `tests/market.test.ts` so a later
 * edit to the row cannot quietly reintroduce the collapse Bell's own constants
 * produce under §2.2's saturating close.
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

/** Exported because `tests/helpers/market-math.ts` had a byte-identical copy —
 *  two definitions of the same three-token function, in the two files the split
 *  exists to keep from drifting. */
export const clamp = (v: number, lo: number, hi: number): number =>
	Math.min(Math.max(v, lo), hi);

/** One good by name. Both consumers had their own copy of this lookup. */
export const commodity = (name: string): Commodity => {
	const found = COMMODITIES.find((c) => c.name === name);
	if (!found) throw new Error(`no commodity named ${name}`);
	return found;
};

/**
 * How the two bytes are closed when the arithmetic leaves their range.
 *
 * **Injected rather than selected by a mode string, so the rejected arithmetic
 * does not ship.** §2.2 chose saturation over Bell's wrap, and §2.3 requires
 * the rejection to stay runnable — but a `"wrap"` branch inside this module
 * would be dead code in the game and a live path in the instrument. `SATURATE`
 * is the only close defined here; `tests/helpers/market-math.ts` defines
 * `BELL_WRAP` and passes it, which puts the divergence in the one place that
 * measures it.
 */
export interface ByteClose {
	price(v: number): number;
	quantity(v: number): number;
}

/** §2.2's choice: clamp at 0 and 255, and at 0 and 63 on the shelf. */
export const SATURATE: ByteClose = {
	price: (v) => clamp(v, 0, 255),
	quantity: (v) => clamp(v, 0, QUANTITY_CAP),
};

export interface MarketRow {
	commodity: Commodity;
	/** Credits per unit, before any stock-deficit response. */
	priceCr: number;
	/** The same price before §3's floor — what the floor is measured against. */
	unflooredPriceCr: number;
	/** Units on the shelf, 0…63. */
	quantity: number;
	/** True when the raw byte left 0…255, whichever close handled it.
	 *  Named for the *input* condition rather than for what `SATURATE` does to
	 *  it, because it is set under `BELL_WRAP` too. */
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
 *
 * **This is the sweepable form**, taking a fluctuation byte directly. The game
 * calls `marketRow`, which derives that byte from station identity and the
 * clock.
 */
export function marketRowAt(
	commodity: Commodity,
	economy: number,
	fluct: number,
	station: StationTypeKey,
	close: ByteClose = SATURATE,
): MarketRow {
	const product = economy * commodity.gradient;
	const changing = fluct & commodity.mask;
	const offset = TYPE_OFFSET[station];
	// `StationType` has four members and §3's offset table has three, so both
	// call sites narrow a station's type to reach this function. An `outpost`
	// would arrive here as an `undefined` offset and every price would come back
	// `NaN` with nothing thrown — the silent-garbage failure the instrument's own
	// `finite()` guard exists to prevent, one layer lower. Node #491 generates
	// outposts, and `station-types.md` §3 still owes them an offset (#490 D6);
	// `hasMarket` is how a caller asks first.
	if (offset === undefined)
		throw new Error(`no type offset for station type ${station}`);

	const rawPrice = commodity.basePrice + changing + product;
	const closedPrice = close.price(rawPrice);
	const priceOverflowed = closedPrice !== rawPrice;

	// §3: credits, after the clamp, floored at one price step.
	const unflooredPriceCr =
		closedPrice * PRICE_STEP_CR + offset * commodity.gradient * PRICE_STEP_CR;
	const priceCr = Math.max(PRICE_STEP_CR, unflooredPriceCr);

	// §2.2's clamp applies to the quantity byte too, and **that is a divergence
	// from Bell, not a transcription of him** — see `BELL_WRAP`. Gold's raw
	// quantity is always 66–80, so txtelite shows 2–16 units where seelite shows
	// a permanent 63.
	const baseQuantity = close.quantity(
		commodity.baseQuantity + changing - product,
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
 * §5's stock response: the market's memory of what the player took or dumped.
 *
 * Proportional, not a flat byte shift. A flat shift is the obvious reading of
 * "deficit behaves like `product`", and it breaks the cheap goods: one 20 t
 * hold of Food would move its price by 8 Cr against a ~7 Cr base — more than
 * the entire Rich→Poor economy sweep moves it. Scaling by the price keeps the
 * response legible at both ends of the table.
 */
export const PRICE_ELASTICITY = 0.1;
/**
 * The hold the deficit response is calibrated against, tonnes.
 *
 * **The baseline hull's, read off the roster** (#181) rather than a second copy
 * of the figure. It is deliberately the *baseline* hull's and not the flown
 * one: #26's D6 defers the multiplier a bigger hold leans on a market by to the
 * pricing node, and a reference that moved with the ship would retune §5.2's
 * response every time the player bought a freighter.
 */
export const HOLD_REFERENCE_T = HULL_SPECS[PLAYER_BASELINE_HULL].holdT;

/** §5.1: how often the base market re-rolls, in minutes of game time. */
export const MARKET_PERIOD_MIN = 30;
/** §5.2: how fast the player's mark on a market fades, in minutes. */
export const DEFICIT_HALF_LIFE_MIN = 20;
/** §5.2: the deficit cannot exceed Bell's quantity cap in either direction. */
export const DEFICIT_MAX = QUANTITY_CAP;

/** §5.2's exponential decay, applied lazily on read from `updatedAt`. */
export const decayDeficit = (deficit: number, elapsedMin: number): number =>
	deficit * 2 ** (-elapsedMin / DEFICIT_HALF_LIFE_MIN);

/**
 * §5.2's saturation point, **in runs of whatever hull is flying** — #182's
 * answer to #26's D6.
 *
 * `DEFICIT_MAX` is 63 *tonnes*, which is Bell's shelf cap borrowed as a memory
 * cap, and it was the right number for exactly as long as every ship in the
 * game held 20 t. Against a roster it is the map's #13 failure — a per-hull
 * scaling on a bounded index gets clamped away where that type lives — and #13's
 * own fix applies: the deficit is read **as a multiple of the flown hold** and
 * the clamp is on that ratio, where it cannot reach. One full run of any hull
 * then leaves the same mark and every hull saturates after the same number of
 * runs.
 *
 * **`economy-trade.md` §5.2 owns the measurement and the argument**; this
 * docstring carries the rule and the one fact a reader of the module needs:
 * `DEFICIT_MAX / HOLD_REFERENCE_T` and not a fresh figure, so at the baseline
 * hull's hold the new expression is the old one term for term.
 */
export const DEFICIT_SATURATION_RUNS = DEFICIT_MAX / HOLD_REFERENCE_T;

/**
 * The cap never falls below one full shelf, `DEFICIT_MAX`: the shelf reads this
 * memory, and a smaller cap left it unable to empty (#316, `economy-trade.md`
 * §5.2).
 */
export const addDeficit = (
	deficit: number,
	units: number,
	holdT: number,
): number => {
	requirePositiveHold(holdT);
	const cap = Math.max(
		DEFICIT_SATURATION_RUNS * holdT,
		DEFICIT_MAX,
		Math.abs(deficit),
	);
	return clamp(deficit + units, -cap, cap);
};

/**
 * §5.1: which market epoch a game time falls in for one station. The `phase`
 * term staggers stations so every market in a system does not flip together.
 */
export const marketEpoch = (phaseMin: number, gameTimeMin: number): number =>
	Math.floor((gameTimeMin + phaseMin) / MARKET_PERIOD_MIN);

/**
 * The tightest the response can squeeze a price *before* the floor.
 *
 * **A constant again, and now it really is one.** It was `1 − 0.1 × 63 / 20`,
 * which was the bound only for a 20 t hull; `DEFICIT_SATURATION_RUNS` makes the
 * saturated factor the same for every hull in the roster, so §5.4's 0.685 and
 * the 1.920 closable ratio derived from it hold at every hold rather than at
 * one. Same value, and that is the point of deriving the new constant from the
 * old pair rather than choosing it.
 */
export const MIN_STOCK_RESPONSE_FACTOR =
	1 - PRICE_ELASTICITY * DEFICIT_SATURATION_RUNS;

/**
 * **The floor is needed here, and an earlier version removed it on a false
 * premise.** The reasoning was that the ±63 clamp bounds the multiplier at
 * 0.685, so the result could never fall below §3's floor. That is true only for
 * prices at or above `PRICE_STEP_CR / MIN_STOCK_RESPONSE_FACTOR` ≈ 0.584 Cr —
 * and the rows §3's floor pins at exactly 0.4 Cr are precisely the population
 * below it: 0.4 × 0.685 = 0.274 Cr, under the floor the row was just given.
 * A bound that holds for most of the domain is not a bound.
 */
export const stockResponse = (
	priceCr: number,
	deficit: number,
	holdT: number,
): number => {
	requirePositiveHold(holdT);
	return Math.max(
		PRICE_STEP_CR,
		priceCr *
			(1 +
				PRICE_ELASTICITY *
					clamp(
						deficit / holdT,
						-DEFICIT_SATURATION_RUNS,
						DEFICIT_SATURATION_RUNS,
					)),
	);
};

/**
 * The units actually on the shelf once the deficit is applied.
 *
 * **Clamped at both ends, and the upper one is not decorative.** A deficit runs
 * to −63 when the player dumps cargo, so `generatedQuantity − deficit` reaches
 * 126 — twice Bell's cap — and §1's pipeline had the subtraction outside the
 * clamp. Selling into an already-full shelf therefore adds nothing visible,
 * which is right: the cap is a shelf, not an accumulator. The *price* still
 * falls, because §5's response is what carries the effect.
 *
 * Round the signed mark to the nearest unit, with half-units away from zero.
 * Flooring the shelf erased a one-unit sale as soon as its mark decayed below
 * one (node #777). The continuous mark still prices the good; this projection
 * alone turns it into whole stock, shared by the console and till (#316).
 */
export const shelfQuantity = (
	generatedQuantity: number,
	deficit: number,
): number =>
	Math.floor(
		clamp(
			generatedQuantity -
				Math.sign(deficit) *
					Math.round(Math.min(Math.abs(deficit), DEFICIT_MAX)),
			0,
			QUANTITY_CAP,
		),
	);

/**
 * The tech range the bid table is authored over, and the only reason
 * `displayTL` is bounded anywhere in this module.
 *
 * `galaxy.ts` derives tech level as `techBonus + (economy ^ 7) + (government >>
 * 1) + (government & 1) + 1`, which spans 1…15 arithmetically and — measured
 * over a generated corpus in `tests/market.test.ts` — exactly that in practice,
 * hitting both ends. The bounds are declared rather than derived because a
 * *table* needs its domain named, and because the alternative is a clamp: #13's
 * warning is that an offset on a bounded index gets clamped away where that
 * type lives, and a clamped `displayTL` would hand a station a cut no table
 * declares. So the domain is checked and throws, and the corpus row is what
 * makes the throw unreachable in play rather than merely asserted.
 */
export const DISPLAY_TL_MIN = 1;
export const DISPLAY_TL_MAX = 15;

/**
 * §5.6: the floor of the bid cut, which the rim carries.
 *
 * **It is `PRICE_ELASTICITY`, and the road to that figure runs through a number
 * this module used to carry instead.** The first version was
 * `PRICE_ELASTICITY × DEFICIT_SATURATION_RUNS` = 0.315, on the argument that the
 * cut must exceed the deepest mark §5.2's memory can move a price, since §12's
 * round trip harvests exactly that swing. The argument was sound and the figure
 * is still right, and the two rungs it lives between are worth keeping apart: the
 * closure ladder in `scripts/measure-greedy-trader.ts` reports **no profitable
 * tonnage cycle from 0.100 up**, and its rungs at 0.20 and 0.315 bracket the cut that
 * closes the sub-tonne rows too — 11,895 of them still clear at 0.200, none at 0.315.
 * (The bisected figure in `closingCut` is the tonnage one; it runs on the tonnage rows
 * alone, so do not read a sub-tonne bracket off it.)
 * **0.315 closes the pump completely and costs the trade loop; 0.100 closes the
 * tonnage half and does not.** The row in `tests/market.test.ts` §5.6 that pins the
 * 0.315 swing is what makes that ladder falsifiable: the mark is a derived quantity,
 * not a constant, so a law that named it here would be the third copy §5.6 forbids.
 *
 * **And 0.315 is not shippable, which is #196's finding.** The §5.6 section of
 * `scripts/measure-greedy-trader.ts` runs the honest trade loop — a trader that
 * never visits a console twice in a row, so it is neither the pump nor rigged —
 * against the cut ladder, and at the wide rungs that loop stops reaching the
 * Combat Engine inside a four-hour session and stops finding a profitable hop at
 * all. **The sweep's figures are not transcribed here**: that report is their only
 * owner, it reprints them beside whatever a fresh run derives, and this paragraph
 * carried a count that had already gone stale against the table fifteen lines above
 * it — `economy-trade.md` §5.6's rule about third copies, applied to this file. The
 * two counts further down this comment are the deliberate exception: they are this
 * comment's own claim about a specific experiment, and `tests/station-commerce.test.ts`
 * pins every one of them, so moving a figure reddens a row rather than leaving a sentence
 * as a rumour. What
 * the shape says, and what no rerun has moved: a spread which closes the pump by
 * making ordinary trading unprofitable has not repaired the economy, it has
 * cancelled it, and §8's time-to-kit goes the wrong way with it.
 *
 * **So the floor is the mark one full hold of ordinary tonnage leaves**, which is
 * `PRICE_ELASTICITY × (holdT / holdT)` — that is, `PRICE_ELASTICITY`, exact at
 * every hull in the roster, because no trade can move the deficit by more than
 * the hold it was made in. A round trip at one console in Food, Textiles or
 * Machines, goods whose units *are* tonnes, is then never a profit at any station,
 * any hull, in either order — a loss away from the rim, and exactly nothing at it,
 * which is what "no profitable cycle" means to the ladder. `tests/market.test.ts` §5.6 counts those rows and
 * `tests/station-commerce.test.ts` §5.6 walks the tonnage roster through the
 * shipped calculator, so the claim is the till's and not the comment's.
 *
 * **And the sentence is true of a market the trader has not already moved.** Chained
 * cycles at one console stay shut (4,410 chains of four, none positive), because a cycle
 * hands the mark straight back. But a *dump* first — sell two holds in without buying
 * them back, then cycle — leaves the console 40 units short of a price, and a hold sold
 * into a depressed market is quoted off that depression while the buy-back is the same
 * depression with no cut on it. Measured over **every dockable hull**, because §182 made
 * the mark scale with the flown hold and the dump's size is the hull's: **6,327 of 188,325
 * such cycles clear, the worst by +90.00 Cr** (Luxuries, a shipyard, economy 0, TL 1, two
 * holds thrown first, at the 60 t hauler — +40.00 Cr at the 20 t baseline). The floor that
 * closes that door is the 0.315 one §5.6 already prices and declines for costing the trade
 * loop, and that arm is flown in the same sweep rather than asserted beside it: same
 * 188,325 legs, **0 clear**. So this is a residue with a measured price on it, and
 * `tests/station-commerce.test.ts` pins every figure in this sentence. Throwing two holds
 * away is not free — that is why 90 Cr is a residue and not a living — but the claim a
 * comment makes has to be the claim the instrument measured.
 *
 * **What that leaves open is the sub-tonne case, and it is reported rather than
 * hidden.** Sixty-three **units** of Platinum is 0.2 t of cargo — Platinum
 * because it is the cheapest of the three metals and so the last one a cut prices
 * out — and §5.2's memory is written in units: one purchase saturates a hull of
 * 20 t or less, the swing is the full 0.315, and the binding cycle still clears a
 * fifth of its working capital per click above this floor. That residue is #182's
 * weak joint 14 — the
 * sub-tonne goods saturating at a single purchase, which #182's D6 chose to
 * preserve rather than re-anchor §5.4's farm calibration on. Closing it from the
 * spread side costs the trade loop the figure above, so the cheaper lever is the
 * unit the deficit is counted in, and §12 carries the joint.
 * `tests/market.test.ts` §5.6 and `tests/station-commerce.test.ts` §5.6 both
 * name the surviving rows, so a node that re-anchors the sub-tonne mark finds
 * those rows red and knows what it closed.
 */
export const BID_CUT_FLOOR = PRICE_ELASTICITY;

/**
 * §5.6: how much wider a core market's cut is than a frontier one, in cut.
 *
 * **The direction is #191 D4's, and it was a measurement.** Both directions were
 * argued in that node and neither won, so both arms were flown in
 * `scripts/measure-greedy-trader.ts` at *matched mean cut* — a grade of twice
 * the mean, so the two tables hold the same multiset of cuts in the other order
 * and a difference between them is the direction rather than the level.
 *
 * **#191 D4's direction was measured, and one reading of that measurement had to
 * be withdrawn.** What holds: the arm that charges the rim more pulls trade inward
 * as its level rises, and the shipped direction pushes it outward (§10.3 has the
 * radius figures and the caveat that matching is over the tech-level index, not over
 * realized dock visits). What was withdrawn: an earlier revision of this comment
 * reported D4's other concern — that a spread dear at high tech level charges a
 * commander who starts somewhere developed, which in this generator is the **core** —
 * as refuted, on a matched-mean sweep whose arms were built at floor 0 and so charged
 * nothing at the rim where most of their own docks sat. That comparison could not
 * reach the question.
 *
 * **The pair that does reach it is in §5.6: the shipped law against the same two
 * constants with the ends swapped, flown from an arbitrary start and from the galaxy's
 * highest-tech market.** Its verdict is that **D4 was right about the level** — a core
 * market takes `BID_CUT_FLOOR + BID_CUT_GRADE` off a sale against the floor alone under
 * the mirror, so a commander who stays in developed space does pay the wider cut — and
 * that **the loop question is bounded rather than settled**: four galaxies move the same
 * arm's rate band further by changing where the trader is dropped than either direction
 * does, so what survives is a paired ordering (kit first in 6 of 8 draws) and §4's
 * double-charge argument, not a rate claim. The direction is bought with a real charge on
 * the core end. §5.6 and §10.3 own that ruling, and a retune of either dial has to reopen
 * it there rather than here.
 *
 * Radius is the generator's normalised galactic distance, averaged over the
 * systems a trader docked at, so 0 is the core and 1 the rim: narrow-at-the-rim
 * pulls trade *outward*, and #191 D4 said the reading that decides is the route
 * mix, not the hop ratio. §10.3 disqualifies the ratio — it reports the option
 * pools, and `jumpOptions` enumerates eight systems while `intraOptions`
 * enumerates one or two.
 *
 * **The independent argument points the same way, and it is not the destination's
 * third verb.** §4's own table already loads the frontier with price *risk*: a
 * TL 1 market's whole historical range is 3.3× its base against 1.92× at TL 15,
 * which is why §4 exists as its own section. A spread is the other charge — the
 * price of immediacy, not of movement — and loading the same markets with both
 * double-charges the one thing they are already paying for. The core, where the
 * range is narrow and the book is thick, is where a marginal tonne is worth
 * least to the station buying it.
 *
 * **The grade itself is 0.15, chosen and then swept at the shipped floor.** A
 * matched-mean direction sweep is the wrong instrument for a *span*: raising the
 * grade raises the mean with it, so an arm matched on the mean attributes to the
 * rim-to-core difference what a wider average paid for. So §5.6's third section
 * holds `BID_CUT_FLOOR` at its shipped 0.10 and runs the grade alone, which is the
 * only ladder that can say what a wider difference costs a new commander. Read the
 * rung beside 0.15 there rather than trusting this sentence — the grade is a chosen
 * figure, and §12 carries its retune as §8's obligation, because the only thing
 * that would make it wrong is a change to what a margin is worth.
 */
export const BID_CUT_GRADE = 0.15;

/** Loud rather than clamped — see `DISPLAY_TL_MIN`'s header for why. */
export const requireDisplayTl = (displayTL: number): number => {
	if (
		!Number.isInteger(displayTL) ||
		displayTL < DISPLAY_TL_MIN ||
		displayTL > DISPLAY_TL_MAX
	)
		throw new Error(
			`displayTL ${displayTL} is outside the spread table's domain ` +
				`(${DISPLAY_TL_MIN}…${DISPLAY_TL_MAX}, economy-trade.md §5.6)`,
		);
	return displayTL;
};

/**
 * A bid cut from its two dials, in the shipped direction: `floor` at the rim,
 * `floor + grade` at the core.
 *
 * **The direction is not a parameter here.** #191 D4's rejected arm is the mirror of
 * this table, and a mirror is an *arm*: it belongs beside `NO_WEDGE` in
 * `tests/helpers/console-cycle.ts`, which is where the repo keeps the rejected laws
 * (`BELL_WRAP`, `fixedReferenceResponse`), not in the module that states what ships.
 * It also cannot be named honestly as an option: `{ wideAtHighTl: true }` builds the
 * arm that is *narrow* at high TL, and that inversion cost this node a review round.
 *
 * **One copy of the offset.** `scripts/measure-greedy-trader.ts` used to re-type
 * `(tl − MIN) / (MAX − MIN)` for its guard, so the check that "compares an arm to the
 * law" compared two copies of one formula and proved only that the copies agree.
 */
export const bidCutLadder = (floor: number, grade: number) => {
	const span = DISPLAY_TL_MAX - DISPLAY_TL_MIN;
	// **Checked, not clamped** — see `DISPLAY_TL_MIN`'s header. The check sits here
	// rather than in each branch because the row that says an out-of-range tech level
	// throws went red the first time it lived on one side of a ternary.
	return (rawTL: number): number => {
		const displayTL = requireDisplayTl(rawTL);
		return floor + (grade * (displayTL - DISPLAY_TL_MIN)) / span;
	};
};

/**
 * A station's bid cut at one tech level. **The domain's ends are the two
 * constants**: TL 1 pays exactly `BID_CUT_FLOOR` and TL 15 pays
 * `BID_CUT_FLOOR + BID_CUT_GRADE`, so the span of the law is its declaration
 * rather than a figure that appears somewhere else. The numerator runs from 0
 * rather than 1 because a `+ 1` there put the cheapest market at floor + grade/15
 * = 0.110 and left `BID_CUT_FLOOR` naming a cut no market in the game pays — this
 * repo's third-copy drift, caught by reading the shipped function at TL 1 instead
 * of reading the constant, and it had already been copied into three files.
 *
 * **At the rim that puts a tonnage round trip at exactly zero**, a wash rather
 * than a loss, and that is what the closure is measured as: the ladder in
 * `scripts/measure-greedy-trader.ts` counts cycles netting *more* than nothing, so
 * a rung whose binding rows break even closes the pump and the rung below it does
 * not.
 *
 * **It is a cut on the *bid* and nothing else, which is a ruling rather than a
 * default** — see `marketQuote`.
 *
 * **The shipped instance of `bidCutLadder`, and the function the game calls.**
 */
export const bidCutAtTl: (displayTL: number) => number = bidCutLadder(
	BID_CUT_FLOOR,
	BID_CUT_GRADE,
);

/** The two figures one market quotes for one good, one per end of the wedge. */
export interface MarketQuote {
	/** What the commander pays this station for one unit. */
	buyCr: number;
	/** What this station pays the commander for one unit. */
	sellCr: number;
}

export type QuoteFn = (midCr: number, displayTL: number) => MarketQuote;

/**
 * The precision a quote is expressed in: **one tenth of a credit**, because that is
 * the finest figure the console can print.
 *
 * **This is #193's rule, applied to the second decimal place it did not reach.**
 * `priceLabel` renders `toFixed(1)`, and the rule that made it do so was that a
 * rounded price is a figure the till will not honour — the defect that let a Food
 * row print `0 Cr` while the transaction charged 2.2 Cr. Quantizing the quote to
 * what the glass prints is that rule taken to its conclusion: an unquoted cent is
 * worse than a coarse one, because the player reads 3.5, the till pays 3.51, and
 * nothing on the screen says the two are different numbers. Both columns go through
 * it, so the spread the commander reads is the spread charged, to the last digit
 * shown.
 */
export const PRICE_DISPLAY_STEP_CR = 0.1;

/** The quote's own rounding, applied before any caller sees a number. */
export const quantizeToDisplayStepCr = (cr: number): number => {
	// Divide on the way back down rather than multiply. `53 × 0.1` is
	// 5.300000000000001, which prints as `5.3` and is not `5.3` — the exact defect
	// this function exists to remove, re-introduced by the arithmetic that removes
	// it. `1 / 0.1` is 10 exactly, so `53 / 10` is the nearest double to 5.3, which
	// is the number `priceLabel` prints and `Number` reads back.
	const steps = 1 / PRICE_DISPLAY_STEP_CR;
	return Math.round(cr * steps) / steps;
};

/**
 * The one place the wedge's shape is written, so an arm of a sweep is a *cut
 * schedule* rather than a second implementation of the quote.
 *
 * Every alternative in `scripts/measure-greedy-trader.ts` — flat, graded either
 * way, one-sided against split — goes through here, because an arm that re-types
 * `Math.max(PRICE_STEP_CR, mid * (1 - cut))` can differ from the shipped law in
 * anything except the dial its name advertises, and then a report is comparing two
 * implementations rather than two spreads. The split wedge is the one shape this
 * factory cannot express, since it moves the *ask* too; it is `quoteSplitting`,
 * and the report guards both against `marketQuote` before printing.
 *
 * @param quantize Turn the tenth-credit quote step off, which only an instrument
 *   has a reason to do: `tests/helpers/console-cycle.ts` needs to tell a cycle the
 *   law closed apart from a cycle the *rounding* closed, and it cannot do that with
 *   the same factory that did the rounding. A false here is an arm of a sweep, not a
 *   build setting — nothing the player runs takes it.
 */
export const quoteWithCut = (
	cutAtTl: (displayTL: number) => number,
	// **The knob is the law's own precision rule, which §10.3's taxonomy re-flies
	// without it.** A reviewer asked for it out of the shipped API, and the alternative is
	// a helper that rebuilds this body — the floor and the step — which is exactly how a
	// test starts disagreeing with the law it means to vary (round 6 caught one of those).
	// One optional dial, whose default *is* the shipped quote, keeps the comparison honest
	// and the law single-sourced.
	{ quantize = true }: { quantize?: boolean } = {},
): QuoteFn => {
	const step = (cr: number): number =>
		quantize ? quantizeToDisplayStepCr(cr) : cr;
	// **The ask is not a parameter, and that is the law rather than an omission.** #191 D1
	// declined the symmetric wedge, so the only shipped builder lifts one side; the
	// rejected arm is flown as an arm (`quoteSplitting` in the greedy instrument), the way
	// `NO_WEDGE` and `fixedReferenceResponse` are flown. An `askAtTl` here was tried in
	// review round 6 and removed: it would have had no caller in the game, and routing the
	// declined arm through it moved that arm's arithmetic, because a shared builder floors
	// both sides.
	return (midCr, displayTL) => ({
		buyCr: step(midCr),
		sellCr: step(Math.max(PRICE_STEP_CR, midCr * (1 - cutAtTl(displayTL)))),
	});
};

/**
 * The shipped law: ask at the mid, bid cut by `bidCutAtTl`, and the only place
 * the spread is applied.
 *
 * **The ask is the mid, unchanged.** That asymmetry is #191 D1 read as it was
 * written — *a station buys lower than it sells* — and it is also the cheapest
 * closure available, because a round trip crosses the wedge once whichever end it
 * starts at and so pays the *sum* of the two sides. Measured in
 * `scripts/measure-greedy-trader.ts` §5.6: a cut of 0.100 on the bid alone closes
 * every tonnage round trip at one console, while splitting the same closure needs
 * 0.053 a side — a total wedge of 0.105 — and buys the extra half-point by taking
 * money out of what the player *pays*, which #191 D1 declined to do. Keeping
 * `buyCr === midCr` is also what lets §3's floor and M6's delta arrow keep
 * describing a price the player is actually charged, rather than a mid nobody
 * trades at.
 *
 * **Floored after the cut, not before.** §3's floor is a rule about the price a
 * player pays, and the cut changes that price; a row the floor already pins at
 * one price step cannot be cut further. That erasure is real and counted —
 * `tests/market.test.ts` pins how many domain rows lose their cut to it, and
 * that none of them still carries a pump, because the floor swallows the
 * deficit's mark on the way through `stockResponse` too.
 *
 * **Injectable at both call sites for one reason**: #7's no-wedge law was
 * ratified and has to stay runnable to be measurable, the way `BELL_WRAP` and
 * `fixedReferenceResponse` are. The game never passes anything but this.
 */
export const marketQuote: QuoteFn = quoteWithCut(bidCutAtTl);

// ---------------------------------------------------------------------------
// §5.1 — station identity, and the market it derives
// ---------------------------------------------------------------------------

/**
 * A station, as the market sees it.
 *
 * §11 of the spec asked for `marketRow`'s parameter to widen from a station
 * *type* to `{ type, seed }`, and this is why: §5.1's fluctuation byte is
 * `hash(stationSeed, epoch)` and §5.2's deficit is keyed per station, so both
 * need identity that a type does not carry. A system's three stations share an
 * economy and differ only by offset without it, which would flip all three
 * markets on the same boundary and give them the same byte.
 */
export interface MarketStation {
	type: StationTypeKey;
	/** From `marketSeedFor` — the station's own stream root, `DOMAIN.MARKET`. */
	seed: number;
	/**
	 * `marketPhaseMin(seed)`, carried rather than recomputed.
	 *
	 * It is a pure function of the seed and never varies for the life of a
	 * station, and `marketRow` is called once per good per quote — seventeen
	 * times a port, thousands of times a run in the instrument — each of which
	 * was allocating a generator to re-derive the same number.
	 */
	phaseMin: number;
	/**
	 * `station-types.md` §5.2's fence flag, carried here because §4's scope is
	 * the market's rule and not the station record's.
	 *
	 * **This is the only commodity scoping in the game.** Everything else in the
	 * table trades everywhere; Narcotics, Firearms and Slaves trade at a fence
	 * and nowhere else.
	 */
	blackMarket: boolean;
}

/**
 * Whether this station lists this good at all — §4's one scoped class.
 *
 * **It lives here rather than in a caller**, and an earlier round of this node
 * had it only in `scripts/measure-greedy-trader.ts`. That put the rule in the
 * instrument and not in the game: the market screen the HUD node is handed
 * would have priced Narcotics at every station in the galaxy, and no test would
 * have gone red. §4's exception is the whole of what makes a fence a place
 * worth flying to.
 */
export const listsCommodity = (
	commodity: Commodity,
	station: MarketStation,
): boolean => !commodity.illegal || station.blackMarket;

/**
 * FNV-1a over the carrier id.
 *
 * The station's persistence identity is a *string* (`persistent-world-state.md`
 * §2), and the market stream has to be a function of it rather than of the
 * station's index in generation order: an inserted station would otherwise
 * re-roll every market after it, which is the coupling `DOMAIN` exists to
 * prevent one level up.
 */
const hashCarrierId = (id: string): number => {
	let h = 0x811c9dc5;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
};

/**
 * §5.1's `stationSeed`: one station's market stream root.
 *
 * `DOMAIN.MARKET` is its own tag for the reason `station-types.md` §5.3 gives
 * about `STATION_FLAGS` — reusing an existing tag silently correlates the
 * market with whatever else draws from that stream.
 */
export const marketSeedFor = (
	systemSeed: number,
	localCarrierId: string,
): number => mix(mix(systemSeed, DOMAIN.MARKET), hashCarrierId(localCarrierId));

/** Separates the phase draw from the epoch-0 fluctuation draw. Without it the
 *  two are the same number, so a station's stagger would be a function of its
 *  own opening market. */
const PHASE_TAG = 0x9e37;

/**
 * §5.1's `phase(station)`: `hash(stationSeed) mod MARKET_PERIOD`, in minutes.
 *
 * Staggers the stations of one system so their markets do not all flip on the
 * same 30-minute boundary — which is what "regenerates on jump" would have done
 * to all three at once, and #6's clock forbids.
 */
export const marketPhaseMin = (stationSeed: number): number =>
	seededRand(mix(stationSeed, PHASE_TAG))() * MARKET_PERIOD_MIN;

/**
 * §5.1's fluctuation byte: `hash(stationSeed, epoch)`, 0…255.
 *
 * **Not stored.** Elite kept the byte in the save and re-rolled it on every
 * hyperspace jump; here it is a function of the seed and the clock, so the base
 * market stays derivable and the map's determinism constraint holds without an
 * exception carved for it.
 */
export const stationFluct = (stationSeed: number, epoch: number): number =>
	Math.floor(seededRand(mix(stationSeed, epoch))() * 256) & 0xff;

/**
 * Whether a station has a market at all: whether §3 has an offset for its type.
 *
 * Every type but the raider outpost does. Node #491 placed outposts before
 * #490 D6's market for them exists, so anything that walks a system's
 * stations to price them — the console, the job binders, an instrument, a
 * corpus test — skips the ones this refuses rather than meeting
 * `marketStationOf`'s throw. The day the outpost gets an offset, this answers
 * yes for it with nothing else to change.
 */
export const hasMarket = (station: { type: string }): boolean =>
	station.type in TYPE_OFFSET;

/**
 * A generated station, narrowed to what the market can price.
 *
 * **The narrowing happens once, here, rather than at every call site.**
 * `StationType` has four members and §3's `TYPE_OFFSET` three, so a caller
 * holding a `Station` has to bridge the gap somehow; two of them were doing it
 * with a cast, which moves the obligation outward and puts a `NaN` price one
 * typo away. This validates instead, and `marketRowAt` keeps its own throw as
 * the backstop for anyone constructing a `MarketStation` by hand.
 *
 * `station-types.md` §3 still owes the outpost an offset (#490 D6), and node
 * #491 generates outposts, so this is where that gap is felt, loudly. The game
 * never reaches it — an outpost's berths are closed (`STATION_BERTHS_OPEN`) and
 * it posts no work — and a caller walking every station asks `hasMarket` first.
 */
export function marketStationOf(
	station: { type: string; localCarrierId: string; blackMarket: boolean },
	systemSeed: number,
): MarketStation {
	if (!hasMarket(station))
		throw new Error(
			`station type ${station.type} has no market offset (economy-trade.md §3)`,
		);
	const seed = marketSeedFor(systemSeed, station.localCarrierId);
	return {
		type: station.type as StationTypeKey,
		seed,
		phaseMin: marketPhaseMin(seed),
		blackMarket: station.blackMarket,
	};
}

/** Everything this station lists, in table order — what a market screen shows
 *  and the one place §4's scope has to be applied. */
export const stationCommodities = (
	station: MarketStation,
): readonly Commodity[] =>
	COMMODITIES.filter((c) => listsCommodity(c, station));

/**
 * The game's entry point: one good at one station at one moment.
 *
 * Derives the epoch and the fluctuation byte from the station's identity and
 * the #6 game clock, then defers to `marketRowAt`. There is one copy of the
 * arithmetic; this function only decides *which* byte it is applied to.
 */
export function marketRow(
	commodity: Commodity,
	economy: number,
	station: MarketStation,
	gameTimeMin: number,
	close: ByteClose = SATURATE,
): MarketRow {
	// Loud rather than a zero row: a price for a good the station does not sell
	// is a bug in the caller, and a silently empty shelf is how it would ship.
	if (!listsCommodity(commodity, station))
		throw new Error(
			`${station.type} does not list ${commodity.name} (economy-trade.md §4)`,
		);
	const epoch = marketEpoch(station.phaseMin, gameTimeMin);
	return marketRowAt(
		commodity,
		economy,
		stationFluct(station.seed, epoch),
		station.type,
		close,
	);
}

// ---------------------------------------------------------------------------
// §6–§7 — cargo, fuel, and what a station sells
// ---------------------------------------------------------------------------
//
// **§5.5's deficit map is not here, and this module does not import it.** It
// was; `deficits.ts`'s header carries why it moved and when. What stayed is
// §5.2's arithmetic above — `decayDeficit`, `addDeficit`,
// `DEFICIT_HALF_LIFE_MIN` and `DEFICIT_MAX` — because the price response reads
// it: `stockResponse`, `shelfQuantity` and `MIN_STOCK_RESPONSE_FACTOR` each
// clamp by `DEFICIT_MAX`, which is `QUANTITY_CAP`, and
// `tests/helpers/market-math.ts` reaches `decayDeficit` and `addDeficit` to
// price a saturated run without ever building a `DeficitMap`. `deficits.ts`
// imports that arithmetic from here, and the reverse would close a cycle
// rather than move a dependency — `DEFICIT_MAX` being `QUANTITY_CAP` is what
// makes it a cycle and not merely a redirection.
//
// **This paragraph is the one copy of that argument**, as `deficits.ts`'s
// header is the one copy of the move's history. Each points at the other
// rather than restating it, so a fourth reader of `DEFICIT_MAX` leaves one
// comment stale and not three. `tests/deficits.test.ts` is what keeps the
// direction itself true.

/**
 * §7's equipment list.
 *
 * **Prices are the BBC cassette PRXS table** as recorded in
 * `docs/research/elite-1984-mechanics.md` §3.1. That section explicitly notes
 * that the *Elite Players Guide* publishes different figures for some items
 * (ECM 500, Beam 750) and adjudicates in favour of what the cassette code
 * charges; #4 closed on that reading, so it is the one used here.
 *
 * `scope` is `station-types.md` §4.1's: ten universal items gated by tech
 * level, four exclusive to a station type. Hulls are absent because §7 does not
 * price them — the ship-roster node does.
 */
export interface Equipment {
	name: string;
	priceCr: number;
	scope: "universal" | "refinery" | "shipyard";
	/** Not in Elite's cassette list — introduced by station-types.md §4.1 and
	 *  priced here from the disc/Master figures research §3.1 cites. */
	newToSeelite?: boolean;
}

/**
 * The carrier identity scanner, by name (`carrier-identity.md` F12).
 *
 * **Named here, beside the row it buys.** A behaviour gate, a console line and a
 * shipyard's list all have to mean the same purchase, and `station-commerce.ts`
 * still reads `"Large Cargo Bay"` as a literal because no module ever named that
 * one — the second copy is the bug, not the string.
 *
 * **A shipyard exclusive, at the E.C.M.'s figure**, which is F12's ruling rather
 * than a derivation: the eleven-universal slot is closed (§4.1's table holds
 * exactly ten and §4.2's saturation argument counts them), and a refinery
 * exclusive was rejected on fiction. The consequence is stated there too: no
 * shipyard, no scanner, so the Bounty family waits for a reason to travel.
 */
export const SCAN_MODULE = "Identity Scanner";
/** E.C.M.'s price, per F12. */
export const SCAN_MODULE_PRICE_CR = 600;

/**
 * The long-range scanner, by name (#481, under #468).
 *
 * **Named here, beside the row it buys**, for `SCAN_MODULE`'s reason: a
 * behaviour gate, a console line and a shipyard's list all have to mean the
 * same purchase, and a second copy of the string is the bug.
 *
 * **A shipyard exclusive at 1,000 Cr, flat.** The universal column is closed —
 * `station-types.md` §4.1's table holds exactly ten and §4.2's saturation
 * argument counts them — and a non-hull item is priced flat rather than by a
 * curve. The figure sits between the Identity Scanner's 600 and the Extra
 * Energy Unit's 1,500, which is #468's pricing.
 *
 * What owning it changes, and what it deliberately does not, is #479's ruling
 * and is stated once at `relayScannerFitted` (`pirate-relay.ts`).
 */
export const LONG_RANGE_SCANNER = "Long-Range Scanner";
/** #468's figure, flat. */
export const LONG_RANGE_SCANNER_PRICE_CR = 1000;

/**
 * The escape pod, by name (node #703), beside the row it buys for
 * `SCAN_MODULE`'s reason. Whether one is fitted decides whether the eject
 * control has anything to send (`ejectRefusal` in `eject.ts`); what an eject
 * costs is #660 D2's.
 */
export const ESCAPE_POD = "Escape Pod";

export const EQUIPMENT: readonly Equipment[] = [
	{ name: "Missile", priceCr: 30, scope: "universal" },
	{ name: "Large Cargo Bay", priceCr: 400, scope: "universal" },
	{ name: "Extra Pulse Laser", priceCr: 400, scope: "universal" },
	{ name: "E.C.M. System", priceCr: 600, scope: "universal" },
	{ name: "Extra Beam Laser", priceCr: 1000, scope: "universal" },
	{ name: ESCAPE_POD, priceCr: 1000, scope: "universal" },
	{ name: "Energy Bomb", priceCr: 900, scope: "universal" },
	{ name: "Docking Computer", priceCr: 1000, scope: "universal" },
	{ name: "Galactic Hyperdrive", priceCr: 5000, scope: "universal" },
	{ name: "Fuel Scoops", priceCr: 525, scope: "refinery" },
	{ name: "Mining Laser", priceCr: 800, scope: "refinery", newToSeelite: true },
	{ name: "Extra Energy Unit", priceCr: 1500, scope: "shipyard" },
	{
		name: "Military Laser",
		priceCr: 6000,
		scope: "shipyard",
		newToSeelite: true,
	},
	{
		name: SCAN_MODULE,
		priceCr: SCAN_MODULE_PRICE_CR,
		scope: "shipyard",
		newToSeelite: true,
	},
	{
		name: LONG_RANGE_SCANNER,
		priceCr: LONG_RANGE_SCANNER_PRICE_CR,
		scope: "shipyard",
		newToSeelite: true,
	},
];

/**
 * Is a module fitted? **One predicate, beside the list that sells them.**
 *
 * `scanFitted` and `relayScannerFitted` are this with their own row's name
 * bound, and each still lives in the module that owns the *rule* rather than
 * here — the answer to "what does the identity scanner gate" is
 * `carrier-scan.ts`'s and the relay's is `pirate-relay.ts`'s. What was
 * duplicated is the lookup, and a third gate would have made it three.
 *
 * It is a name in a list rather than a flag, which is the idiom
 * `station-commerce.ts` already uses for the Large Cargo Bay: a flag can
 * disagree with the purchase that set it.
 */
export const equipmentFitted = (
	ownedEquipment: readonly string[],
	name: string,
): boolean => ownedEquipment.includes(name);

/** §6.1: 0.2 Cr per 0.1 LY — 2 Cr/LY, 14 Cr for the 7 LY tank. */
export const FUEL_CR_PER_LY = 2;

/**
 * `economy-trade.md` §7's **ten universal items, in its table order, Fuel
 * first** — and the list `station-types.md` §4.1's `min(displayTL + 3, 10)`
 * gate is taken over.
 *
 * **It lives beside `EQUIPMENT` rather than in the screen that first needed
 * it.** `EQUIPMENT` holds nine of the ten because fuel is priced by the light
 * year as `FUEL_CR_PER_LY` rather than as a unit item, and a gate applied to
 * those nine is wrong in two directions at once: it hides Fuel at every tech
 * level, *and* below saturation it sells one item a level early — a slice of
 * items 1…n taken from a list missing its **first** member differs from the
 * correct set only by which items it holds, never by length, so nothing
 * counting catches it. `hud-and-scanner.md` §8.5.3 is that defect written out.
 * Leaving the corrected catalogue in the console module would have left the
 * next reader of `EQUIPMENT` to walk into it again.
 */
export interface UniversalItem {
	name: string;
	priceCr: number;
	/** Fuel is the one item §7 prices by distance rather than by the unit. */
	per: "unit" | "ly";
}

/** `station-types.md` §4.1's ceiling: ten universal items. */
export const UNIVERSAL_GATE_CAP = 10;

export const UNIVERSAL_ITEMS: readonly UniversalItem[] = [
	{ name: "Fuel", priceCr: FUEL_CR_PER_LY, per: "ly" },
	...EQUIPMENT.filter((e) => e.scope === "universal").map(
		(e): UniversalItem => ({ name: e.name, priceCr: e.priceCr, per: "unit" }),
	),
];
export const MAX_MISSILES = 4;

/** §8's fitting-out cost, derived rather than asserted. */
export const fullKitCr = (opts: { withMissiles?: boolean } = {}): number =>
	EQUIPMENT.filter((e) => e.name !== "Missile").reduce(
		(sum, e) => sum + e.priceCr,
		0,
	) +
	(opts.withMissiles
		? MAX_MISSILES *
			(EQUIPMENT.find((e) => e.name === "Missile") as Equipment).priceCr
		: 0);
