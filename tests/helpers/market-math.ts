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
 */

/** Elite's byte→credits step: a price byte is 0.4 Cr. */
export const PRICE_STEP_CR = 0.4;

/** Bell's `& 0x3F` — the cap that forces multi-good baskets. */
export const QUANTITY_CAP = 0x3f;

/** Economy runs 0 = Rich Industrial → 7 = Poor Agricultural. */
export const ECONOMY_MIN = 0;
export const ECONOMY_MAX = 7;

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

/** Two's-complement read of a byte literal, for the `baseQuantity` column. */
const i8 = (byte: number): number => (byte << 24) >> 24;

/**
 * Research §2.2's table, hex literals kept so the transcription can be checked
 * against the source column by column. `Gem-Strones` is Bell's own typo and is
 * spelled correctly here; nothing else is changed.
 */
export const COMMODITIES: readonly Commodity[] = [
	{
		name: "Food",
		basePrice: 0x13,
		gradient: -2,
		baseQuantity: i8(0x06),
		mask: 0x01,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Textiles",
		basePrice: 0x14,
		gradient: -1,
		baseQuantity: i8(0x0a),
		mask: 0x03,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Radioactives",
		basePrice: 0x41,
		gradient: -3,
		baseQuantity: i8(0x02),
		mask: 0x07,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Slaves",
		basePrice: 0x28,
		gradient: -5,
		baseQuantity: i8(0xe2),
		mask: 0x1f,
		unit: "t",
		illegal: true,
		sellOnly: false,
	},
	{
		name: "Liquor/Wines",
		basePrice: 0x53,
		gradient: -5,
		baseQuantity: i8(0xfb),
		mask: 0x0f,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Luxuries",
		basePrice: 0xc4,
		gradient: 8,
		baseQuantity: i8(0x36),
		mask: 0x03,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	// The one divergence from Bell's column — see NARCOTICS_RETUNE below.
	{
		name: "Narcotics",
		basePrice: 0x14,
		gradient: 13,
		baseQuantity: i8(0x08),
		mask: 0x70,
		unit: "t",
		illegal: true,
		sellOnly: false,
	},
	{
		name: "Computers",
		basePrice: 0x9a,
		gradient: 14,
		baseQuantity: i8(0x38),
		mask: 0x03,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Machinery",
		basePrice: 0x75,
		gradient: 6,
		baseQuantity: i8(0x28),
		mask: 0x07,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Alloys",
		basePrice: 0x4e,
		gradient: 1,
		baseQuantity: i8(0x11),
		mask: 0x1f,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Firearms",
		basePrice: 0x7c,
		gradient: 13,
		baseQuantity: i8(0x1d),
		mask: 0x07,
		unit: "t",
		illegal: true,
		sellOnly: false,
	},
	{
		name: "Furs",
		basePrice: 0xb0,
		gradient: -9,
		baseQuantity: i8(0xdc),
		mask: 0x3f,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Minerals",
		basePrice: 0x20,
		gradient: -1,
		baseQuantity: i8(0x35),
		mask: 0x03,
		unit: "t",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Gold",
		basePrice: 0x61,
		gradient: -1,
		baseQuantity: i8(0x42),
		mask: 0x07,
		unit: "kg",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Platinum",
		basePrice: 0xab,
		gradient: -2,
		baseQuantity: i8(0x37),
		mask: 0x1f,
		unit: "kg",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Gem-Stones",
		basePrice: 0x2d,
		gradient: -1,
		baseQuantity: i8(0xfa),
		mask: 0x0f,
		unit: "g",
		illegal: false,
		sellOnly: false,
	},
	{
		name: "Alien Items",
		basePrice: 0x35,
		gradient: 15,
		baseQuantity: i8(0xc0),
		mask: 0x07,
		unit: "t",
		illegal: false,
		sellOnly: true,
	},
] as const;

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

/** Economy runs 0…7, and every sweep in the suite covers all of it. */
export const ALL_ECONOMIES: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];

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

	// Bell clips a negative quantity to zero and caps at 63; the saturating read
	// of that is a straight clamp.
	const baseQuantity = clamp(
		commodity.baseQuantity + changing - product,
		0,
		QUANTITY_CAP,
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
	let stocked = 0;
	let rows = 0;
	for (const economy of ALL_ECONOMIES)
		for (const fluct of ALL_FLUCT) {
			const buy = marketRow(commodity, economy, fluct, buyStation, mode);
			rows++;
			if (buy.quantity > 0) {
				stocked++;
				minBuy = Math.min(minBuy, buy.priceCr);
			}
			maxSell = Math.max(
				maxSell,
				marketRow(commodity, economy, fluct, sellStation, mode).priceCr,
			);
		}
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

/**
 * **No floor here, deliberately.** The ±`DEFICIT_MAX` clamp bounds the
 * multiplier at `1 − 0.1 × 63 / 20` = 0.685, so the response can never invert,
 * zero, or push a price below §3's floor — it can only ever scale it by between
 * 0.685 and 1.315. A `Math.max(PRICE_STEP_CR, …)` here would be a guard that
 * provably cannot fire, which is the dead weight `station-types.md` §5.2
 * objects to. The bound is asserted in the suite instead.
 */
export const stockResponse = (priceCr: number, deficit: number): number =>
	priceCr *
	(1 +
		(PRICE_ELASTICITY * clamp(deficit, -DEFICIT_MAX, DEFICIT_MAX)) /
			HOLD_REFERENCE_T);

/** The tightest the response can ever squeeze a price — see `stockResponse`. */
export const MIN_STOCK_RESPONSE_FACTOR =
	1 - (PRICE_ELASTICITY * DEFICIT_MAX) / HOLD_REFERENCE_T;
