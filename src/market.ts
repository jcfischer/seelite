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
	// `finite()` guard exists to prevent, one layer lower. `station-types.md`
	// §3 owes the outpost an offset before one can be generated.
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

export const addDeficit = (
	deficit: number,
	units: number,
	holdT: number,
): number => {
	requirePositiveHold(holdT);
	const cap = Math.max(DEFICIT_SATURATION_RUNS * holdT, Math.abs(deficit));
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
 */
export const shelfQuantity = (
	generatedQuantity: number,
	deficit: number,
): number =>
	clamp(
		generatedQuantity - clamp(deficit, -DEFICIT_MAX, DEFICIT_MAX),
		0,
		QUANTITY_CAP,
	);

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
 * A generated station, narrowed to what the market can price.
 *
 * **The narrowing happens once, here, rather than at every call site.**
 * `StationType` has four members and §3's `TYPE_OFFSET` three, so a caller
 * holding a `Station` has to bridge the gap somehow; two of them were doing it
 * with a cast, which moves the obligation outward and puts a `NaN` price one
 * typo away. This validates instead, and `marketRowAt` keeps its own throw as
 * the backstop for anyone constructing a `MarketStation` by hand.
 *
 * `station-types.md` §3 owes the outpost an offset before one can be generated;
 * until then this is where that gap is felt, loudly.
 */
export function marketStationOf(
	station: { type: string; localCarrierId: string; blackMarket: boolean },
	systemSeed: number,
): MarketStation {
	if (!(station.type in TYPE_OFFSET))
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

export const EQUIPMENT: readonly Equipment[] = [
	{ name: "Missile", priceCr: 30, scope: "universal" },
	{ name: "Large Cargo Bay", priceCr: 400, scope: "universal" },
	{ name: "Extra Pulse Laser", priceCr: 400, scope: "universal" },
	{ name: "E.C.M. System", priceCr: 600, scope: "universal" },
	{ name: "Extra Beam Laser", priceCr: 1000, scope: "universal" },
	{ name: "Escape Pod", priceCr: 1000, scope: "universal" },
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
];

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
/** The baseline hull's tank, light years — read off the roster (#181) rather
 *  than declared twice. `galaxy.ts`'s `JUMP_RANGE_LY` is the same quantity from
 *  the same row; the router is not hull-aware yet, which is its own node. */
export const FUEL_TANK_LY = HULL_SPECS[PLAYER_BASELINE_HULL].tankLy;
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
