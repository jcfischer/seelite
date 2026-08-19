/**
 * The headless tier for `economy-trade.md` — the market math, which the spec
 * requires never to need a browser.
 *
 * These are properties, not a golden file. There is no oracle: seelite's
 * arithmetic saturates where txtelite wraps (§2.2) and its Narcotics row is
 * deliberately not Bell's (§2.3), so a byte-for-byte comparison against
 * txtelite would fail by construction on exactly the rows that matter.
 *
 * What is pinned instead is the set of claims the spec makes in prose, so a
 * later edit that breaks one fails here rather than in play:
 *
 * - the trade lanes run the researched direction (§2.4);
 * - overflow touches no good but Bell's Narcotics row (§2.2);
 * - the retuned Narcotics row still pays and still stocks (§2.3);
 * - the type offset survives at the extremes and never empties a shelf (§3);
 * - the stock deficit brakes a repeated run rather than merely nudging it (§5).
 *
 * Every sweep covers the **whole** fluctuation domain. An earlier version
 * strided by 8 and so tested nine of the seventeen goods at zero fluctuation
 * only — see `ALL_FLUCT` in `helpers/market-math.ts`.
 */

import { describe, expect, test } from "bun:test";
import {
	ALL_ECONOMIES,
	ALL_FLUCT,
	ALL_STATIONS,
	COMMODITIES,
	type Commodity,
	DEFICIT_HALF_LIFE_MIN,
	DEFICIT_MAX,
	NARCOTICS_BELL,
	NARCOTICS_RETUNE,
	OFFSET_STATIONS,
	PRICE_ELASTICITY,
	MIN_STOCK_RESPONSE_FACTOR,
	PRICE_STEP_CR,
	QUANTITY_CAP,
	TYPE_OFFSET,
	addDeficit,
	bestMargin,
	decayDeficit,
	marketRow,
	stockResponse,
} from "./helpers/market-math";

const byName = (name: string): Commodity =>
	COMMODITIES.find((c) => c.name === name) as Commodity;

/** Buyable, hold-consuming goods — the population §8's pump actually trades. */
const TRADEABLE = COMMODITIES.filter((c) => !c.sellOnly && c.unit === "t");

describe("the commodity table", () => {
	test("is Bell's 17 goods", () => {
		expect(COMMODITIES.length).toBe(17);
	});

	test("reads baseQuantity as a signed byte", () => {
		// The transcription trap: 0xFB, 0xE2, 0xDC, 0xFA and 0xC0 are negative.
		// Read unsigned, each of these goods sits at the 63-unit cap in every
		// system, which inverts the lanes the whole economy is built on.
		expect(byName("Liquor/Wines").baseQuantity).toBe(-5);
		expect(byName("Slaves").baseQuantity).toBe(-30);
		expect(byName("Furs").baseQuantity).toBe(-36);
		expect(byName("Gem-Stones").baseQuantity).toBe(-6);
		expect(byName("Alien Items").baseQuantity).toBe(-64);
		// …and basePrice is genuinely unsigned.
		expect(byName("Narcotics").basePrice).toBeGreaterThan(0);
		expect(byName("Luxuries").basePrice).toBe(0xc4);
	});

	test("scopes exactly three goods as illegal", () => {
		const illegal = COMMODITIES.filter((c) => c.illegal).map((c) => c.name);
		expect(illegal.sort()).toEqual(["Firearms", "Narcotics", "Slaves"]);
	});

	test("keeps Gold, Platinum and Gem-Stones sub-tonne", () => {
		// station-types.md §3.4 depends on this: the goods that skip the hold
		// check are all legal, so contraband cannot be smuggled at high density.
		const subTonne = COMMODITIES.filter((c) => c.unit !== "t");
		expect(subTonne.map((c) => c.name).sort()).toEqual([
			"Gem-Stones",
			"Gold",
			"Platinum",
		]);
		expect(subTonne.every((c) => !c.illegal)).toBe(true);
	});

	test("Alien Items can be sold but never bought", () => {
		const alien = byName("Alien Items");
		expect(alien.sellOnly).toBe(true);
		for (const economy of ALL_ECONOMIES)
			for (const fluct of ALL_FLUCT)
				expect(marketRow(alien, economy, fluct, "trade").quantity).toBe(0);
	});
});

describe("the trade lanes run the researched direction", () => {
	test("negative-gradient goods are cheap and plentiful at Poor Agricultural", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.gradient >= 0 || commodity.sellOnly) continue;
			for (const fluct of ALL_FLUCT) {
				const rich = marketRow(commodity, 0, fluct, "trade");
				const poor = marketRow(commodity, 7, fluct, "trade");
				expect(poor.priceCr).toBeLessThan(rich.priceCr);
				expect(poor.quantity).toBeGreaterThanOrEqual(rich.quantity);
			}
		}
	});

	test("positive-gradient goods are cheap and plentiful at Rich Industrial", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.gradient <= 0 || commodity.sellOnly) continue;
			for (const fluct of ALL_FLUCT) {
				const rich = marketRow(commodity, 0, fluct, "trade");
				const poor = marketRow(commodity, 7, fluct, "trade");
				expect(rich.priceCr).toBeLessThan(poor.priceCr);
				expect(rich.quantity).toBeGreaterThanOrEqual(poor.quantity);
			}
		}
	});

	test("Computers out, Furs back — the canonical loop still pays", () => {
		const computers = byName("Computers");
		const furs = byName("Furs");
		const outward =
			marketRow(computers, 7, 0, "trade").priceCr -
			marketRow(computers, 0, 0, "trade").priceCr;
		const homeward =
			marketRow(furs, 0, 0, "trade").priceCr -
			marketRow(furs, 7, 0, "trade").priceCr;
		expect(outward).toBeCloseTo(39.2, 1);
		expect(homeward).toBeCloseTo(25.2, 1);
	});
});

describe("§2.2 overflow is confined to Bell's Narcotics row", () => {
	test("no good in the shipped table reaches a byte end", () => {
		// Not "no legal good": Slaves and Firearms are illegal and are inside
		// this assertion, which is the point — the retune left them alone.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT)
					for (const station of ALL_STATIONS)
						expect(
							marketRow(commodity, economy, fluct, station).priceOverflowed,
						).toBe(false);
	});

	test("the retuned Narcotics row cannot overflow, by construction", () => {
		const narcotics = byName("Narcotics");
		const worst = narcotics.basePrice + narcotics.mask + 7 * narcotics.gradient;
		expect(worst).toBe(NARCOTICS_RETUNE.maxPriceByte);
		expect(worst).toBeLessThanOrEqual(255);
	});

	test("Bell's own row does overflow — the reason for the divergence", () => {
		// The rejected form, scored. Without this the spec's case for retuning is
		// prose, and a later editor restoring Bell's constants gets no warning.
		let overflowed = 0;
		let rows = 0;
		for (const economy of ALL_ECONOMIES)
			for (const fluct of ALL_FLUCT) {
				if (marketRow(NARCOTICS_BELL, economy, fluct, "trade").priceOverflowed)
					overflowed++;
				rows++;
			}
		expect(overflowed / rows).toBeGreaterThan(0.9);
	});
});

describe("§2.3 the retuned Narcotics keeps the smuggling trade alive", () => {
	// These are refinery→refinery numbers. A fence is a refinery whose
	// `blackMarket` flag is set (station-types.md §5.2), and the flag does not
	// enter pricing at all — `typeOffset` is a property of the type — so the two
	// coincide for every figure here. Named for what is measured.
	test("it pays, and it is stocked", () => {
		const { margin, inStock } = bestMargin(
			byName("Narcotics"),
			"refinery",
			"refinery",
		);
		expect(margin).toBeGreaterThan(NARCOTICS_RETUNE.minMarginCr);
		expect(inStock).toBeGreaterThan(NARCOTICS_RETUNE.minInStock);
	});

	test("Bell's row under the clamp would not — the collapse being avoided", () => {
		expect(
			bestMargin(NARCOTICS_BELL, "refinery", "refinery").margin,
		).toBeLessThan(10);
	});

	test("contraband stays worth more than the best legal good", () => {
		// station-types.md §3.4 sells contraband as a risk premium. If an
		// ordinary good out-earns it, the fence geography buys nothing.
		const bestLegal = Math.max(
			...TRADEABLE.filter((c) => !c.illegal).map(
				(c) => bestMargin(c, "refinery", "refinery").margin,
			),
		);
		expect(
			bestMargin(byName("Narcotics"), "refinery", "refinery").margin,
		).toBeGreaterThan(bestLegal);
	});
});

describe("§3 the type offset", () => {
	test("shifts price in the direction the spec claims", () => {
		const computers = byName("Computers");
		const minerals = byName("Minerals");
		const at = (c: Commodity, s: "trade" | "refinery" | "shipyard") =>
			marketRow(c, 3, 0, s).priceCr;
		// A shipyard is cheap for manufactured goods, dear for extractives.
		expect(at(computers, "shipyard")).toBeLessThan(at(computers, "trade"));
		expect(at(minerals, "shipyard")).toBeGreaterThan(at(minerals, "trade"));
		// A refinery is the mirror image.
		expect(at(minerals, "refinery")).toBeLessThan(at(minerals, "trade"));
		expect(at(computers, "refinery")).toBeGreaterThan(at(computers, "trade"));
	});

	test("is never eaten by saturation — it applies after the clamp", () => {
		// The property that disqualified the economy-shift form (#13 §3.2): at
		// every point in the domain, the delta is exactly what the offset says.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT) {
					const base = marketRow(commodity, economy, fluct, "trade");
					for (const station of OFFSET_STATIONS) {
						const shifted = marketRow(commodity, economy, fluct, station);
						const expected =
							TYPE_OFFSET[station] * commodity.gradient * PRICE_STEP_CR;
						expect(
							shifted.unflooredPriceCr - base.unflooredPriceCr,
						).toBeCloseTo(expected, 6);
						// …and the floor is the only thing that ever intervenes.
						if (!shifted.floorFired)
							expect(shifted.priceCr - base.priceCr).toBeCloseTo(expected, 6);
						else expect(shifted.priceCr).toBeCloseTo(PRICE_STEP_CR, 6);
					}
				}
	});

	test("the floor fires on well under 1% of the rows it can reach", () => {
		// Measured over the two types the rule applies to. Including `trade`
		// pads the denominator with rows where the offset is 0 and the floor is
		// unreachable by construction, which flatters the figure.
		let fired = 0;
		let rows = 0;
		for (const commodity of COMMODITIES)
			for (const station of OFFSET_STATIONS)
				for (const economy of ALL_ECONOMIES)
					for (const fluct of ALL_FLUCT) {
						if (marketRow(commodity, economy, fluct, station).floorFired)
							fired++;
						rows++;
					}
		expect(fired / rows).toBeLessThan(0.01);
		// The trade station's offset is zero, so its floor can never fire.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				expect(marketRow(commodity, economy, 0, "trade").floorFired).toBe(
					false,
				);
	});

	test("never makes a good scarcer than the trade station", () => {
		// The one-sided quantity delta. The symmetric form empties the fence's
		// contraband shelf, which is the reason it is one-sided.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT) {
					const base = marketRow(commodity, economy, fluct, "trade").quantity;
					for (const station of OFFSET_STATIONS)
						expect(
							marketRow(commodity, economy, fluct, station).quantity,
						).toBeGreaterThanOrEqual(base);
				}
	});

	test("the fence still stocks contraband under the quantity delta", () => {
		for (const good of ["Narcotics", "Firearms", "Slaves"]) {
			const { inStock } = bestMargin(byName(good), "refinery", "refinery");
			expect(inStock).toBeGreaterThan(0);
		}
	});

	test("quantity never exceeds Bell's 63-unit cap", () => {
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT)
					for (const station of ALL_STATIONS) {
						const q = marketRow(commodity, economy, fluct, station).quantity;
						expect(q).toBeGreaterThanOrEqual(0);
						expect(q).toBeLessThanOrEqual(QUANTITY_CAP);
					}
	});
});

describe("§5 the stock deficit", () => {
	test("moves price proportionally, so cheap goods are not wrecked", () => {
		// A flat byte shift would move a ~7 Cr good by more than its entire
		// economy sweep for one hold of cargo.
		for (const price of [7, 61, 100]) {
			expect(stockResponse(price, 20)).toBeCloseTo(
				price * (1 + PRICE_ELASTICITY),
				6,
			);
			expect(stockResponse(price, -20)).toBeCloseTo(
				price * (1 - PRICE_ELASTICITY),
				6,
			);
			expect(stockResponse(price, 0)).toBeCloseTo(price, 6);
		}
	});

	test("saturates at the cap rather than running away", () => {
		expect(addDeficit(60, 40)).toBe(DEFICIT_MAX);
		expect(addDeficit(-60, -40)).toBe(-DEFICIT_MAX);
		// …and a price built from a runaway deficit is still bounded.
		expect(stockResponse(61, 10_000)).toBeCloseTo(
			stockResponse(61, DEFICIT_MAX),
			6,
		);
	});

	test("cannot invert or zero a price, so it needs no floor of its own", () => {
		// The ±63 clamp bounds the multiplier at 0.685, so §3's floor is the only
		// one in the pipeline. Asserted rather than guarded against.
		expect(MIN_STOCK_RESPONSE_FACTOR).toBeCloseTo(0.685, 6);
		expect(MIN_STOCK_RESPONSE_FACTOR).toBeGreaterThan(0);
		for (const price of [PRICE_STEP_CR, 5, 61, 102])
			expect(stockResponse(price, -1000)).toBeCloseTo(
				price * MIN_STOCK_RESPONSE_FACTOR,
				6,
			);
	});

	test("decays by half over one half-life", () => {
		expect(decayDeficit(40, DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(20, 6);
		expect(decayDeficit(40, 2 * DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(10, 6);
		expect(decayDeficit(40, 0)).toBeCloseTo(40, 6);
	});

	test("exhausts the best intra-system pair within four runs", () => {
		// The reason the shipyard→refinery loop does not collapse the galaxy into
		// single-system trading (§5.4). The pair is *searched*, not hardcoded, so
		// a retune that promotes another good keeps this pointed at the real
		// best arb rather than at a stale one.
		const HOLD_T = 20;
		const RUN_MINUTES = 4; // §8: a full run is 3–5 minutes.
		const ECONOMY = 3;

		let bestGood = TRADEABLE[0];
		let bestSpread = Number.NEGATIVE_INFINITY;
		for (const commodity of TRADEABLE) {
			const buy = marketRow(commodity, ECONOMY, 0, "shipyard");
			if (buy.quantity === 0) continue;
			const spread =
				marketRow(commodity, ECONOMY, 0, "refinery").priceCr - buy.priceCr;
			if (spread > bestSpread) {
				bestSpread = spread;
				bestGood = commodity;
			}
		}
		expect(bestSpread).toBeGreaterThan(0);

		const buyBase = marketRow(bestGood, ECONOMY, 0, "shipyard").priceCr;
		const sellBase = marketRow(bestGood, ECONOMY, 0, "refinery").priceCr;
		let bought = 0;
		let sold = 0;
		let runs = 0;
		while (runs < 20) {
			if (stockResponse(sellBase, -sold) - stockResponse(buyBase, bought) <= 0)
				break;
			runs++;
			// Time passes while the run is flown, so the mark left by the previous
			// run has already begun to fade. Without this the exhaustion count is
			// independent of DEFICIT_HALF_LIFE, and the constant is untested.
			bought = addDeficit(decayDeficit(bought, RUN_MINUTES), HOLD_T);
			sold = addDeficit(decayDeficit(sold, RUN_MINUTES), HOLD_T);
		}
		expect(runs).toBeGreaterThan(0);
		expect(runs).toBeLessThanOrEqual(4);
	});
});
