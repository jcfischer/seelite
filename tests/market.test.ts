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
 * - saturation touches no good but Narcotics (§2.2);
 * - the retuned Narcotics row still pays and still stocks (§2.3);
 * - the type offset survives at the extremes and never empties a shelf (§3);
 * - the stock deficit brakes a repeated run rather than merely nudging it (§5).
 */

import { describe, expect, test } from "bun:test";
import {
	COMMODITIES,
	type Commodity,
	NARCOTICS_BELL,
	NARCOTICS_RETUNE,
	PRICE_ELASTICITY,
	PRICE_STEP_CR,
	QUANTITY_CAP,
	TYPE_OFFSET,
	marketRow,
	stockResponse,
} from "./helpers/market-math";

const ECONOMIES = [0, 1, 2, 3, 4, 5, 6, 7];
/** Every 8th byte. Every mask in the table is a run of low bits, and the
 *  coarsest of them (0x70, 0x78) steps by 8, so this sweep is exact for them
 *  and a strict superset of the finer masks' behaviour. */
const FLUCT = Array.from({ length: 32 }, (_, i) => i * 8);
const ALL_FLUCT = Array.from({ length: 256 }, (_, i) => i);

const byName = (name: string): Commodity =>
	COMMODITIES.find((c) => c.name === name) as Commodity;

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
		for (const economy of ECONOMIES)
			for (const fluct of FLUCT)
				expect(marketRow(alien, economy, fluct, "trade").quantity).toBe(0);
	});
});

describe("the trade lanes run the researched direction", () => {
	test("negative-gradient goods are cheap and plentiful at Poor Agricultural", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.gradient >= 0 || commodity.sellOnly) continue;
			const rich = marketRow(commodity, 0, 0, "trade");
			const poor = marketRow(commodity, 7, 0, "trade");
			expect(poor.priceCr).toBeLessThan(rich.priceCr);
			expect(poor.quantity).toBeGreaterThanOrEqual(rich.quantity);
		}
	});

	test("positive-gradient goods are cheap and plentiful at Rich Industrial", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.gradient <= 0 || commodity.sellOnly) continue;
			const rich = marketRow(commodity, 0, 0, "trade");
			const poor = marketRow(commodity, 7, 0, "trade");
			expect(rich.priceCr).toBeLessThan(poor.priceCr);
			expect(rich.quantity).toBeGreaterThanOrEqual(poor.quantity);
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
		expect(outward).toBeGreaterThan(30);
		expect(homeward).toBeGreaterThan(20);
	});
});

describe("§2.2 saturation is confined to one good", () => {
	test("no legal good ever reaches a byte end", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.name === "Narcotics") continue;
			for (const economy of ECONOMIES)
				for (const fluct of ALL_FLUCT)
					expect(
						marketRow(commodity, economy, fluct, "trade").priceSaturated,
					).toBe(false);
		}
	});

	test("the retuned Narcotics row does not saturate either", () => {
		const narcotics = byName("Narcotics");
		const worst = narcotics.basePrice + narcotics.mask + 7 * narcotics.gradient;
		expect(worst).toBe(NARCOTICS_RETUNE.maxPriceByte);
		expect(worst).toBeLessThanOrEqual(255);
		for (const economy of ECONOMIES)
			for (const fluct of ALL_FLUCT)
				expect(
					marketRow(narcotics, economy, fluct, "trade").priceSaturated,
				).toBe(false);
	});

	test("Bell's own row does saturate — the reason for the divergence", () => {
		// The rejected form, scored. Without this the spec's case for retuning is
		// prose, and a later editor restoring Bell's constants gets no warning.
		let saturated = 0;
		let rows = 0;
		for (const economy of ECONOMIES)
			for (const fluct of ALL_FLUCT) {
				if (marketRow(NARCOTICS_BELL, economy, fluct, "trade").priceSaturated)
					saturated++;
				rows++;
			}
		expect(saturated / rows).toBeGreaterThan(0.9);
	});
});

/** Best fence→fence margin, with independent fluctuation bytes per station —
 *  two stations have different seeds, so pairing them on one byte understates
 *  every margin. */
function fenceMargin(commodity: Commodity): {
	margin: number;
	inStock: number;
} {
	let margin = 0;
	let inStock = 0;
	let rows = 0;
	for (const buyEconomy of ECONOMIES)
		for (const buyFluct of FLUCT) {
			const buy = marketRow(commodity, buyEconomy, buyFluct, "refinery");
			rows++;
			if (buy.quantity === 0) continue;
			inStock++;
			for (const sellEconomy of ECONOMIES)
				for (const sellFluct of FLUCT) {
					const sell = marketRow(commodity, sellEconomy, sellFluct, "refinery");
					margin = Math.max(margin, sell.priceCr - buy.priceCr);
				}
		}
	return { margin, inStock: inStock / rows };
}

describe("§2.3 the retuned Narcotics keeps the smuggling trade alive", () => {
	test("it pays, and it is stocked", () => {
		const { margin, inStock } = fenceMargin(byName("Narcotics"));
		expect(margin).toBeGreaterThan(NARCOTICS_RETUNE.minMarginCr);
		expect(inStock).toBeGreaterThan(NARCOTICS_RETUNE.minInStock);
	});

	test("Bell's row under saturation would not — the collapse being avoided", () => {
		const { margin } = fenceMargin(NARCOTICS_BELL);
		expect(margin).toBeLessThan(10);
	});

	test("contraband stays worth more than the best legal good", () => {
		// station-types.md §3.4 sells contraband as a risk premium. If an
		// ordinary good out-earns it, the fence geography buys nothing.
		const best = Math.max(
			...COMMODITIES.filter(
				(c) => !c.illegal && !c.sellOnly && c.unit === "t",
			).map((c) => fenceMargin(c).margin),
		);
		expect(fenceMargin(byName("Narcotics")).margin).toBeGreaterThan(best);
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
			for (const economy of ECONOMIES)
				for (const fluct of FLUCT) {
					const base = marketRow(commodity, economy, fluct, "trade").priceCr;
					for (const station of ["refinery", "shipyard"] as const) {
						const shifted = marketRow(
							commodity,
							economy,
							fluct,
							station,
						).priceCr;
						const expected =
							TYPE_OFFSET[station] * commodity.gradient * PRICE_STEP_CR;
						// Equality except where the floor legitimately intervenes.
						if (base + expected >= PRICE_STEP_CR)
							expect(shifted - base).toBeCloseTo(expected, 6);
						else expect(shifted).toBeCloseTo(PRICE_STEP_CR, 6);
					}
				}
	});

	test("the floor fires on well under 1% of rows", () => {
		// A floor that fires often is a price rule that is a constant, which is
		// the failure #13 measured and wrote into the map's constraints.
		let fired = 0;
		let rows = 0;
		for (const commodity of COMMODITIES)
			for (const station of ["trade", "refinery", "shipyard"] as const)
				for (const economy of ECONOMIES)
					for (const fluct of ALL_FLUCT) {
						const base = marketRow(commodity, economy, fluct, "trade").priceCr;
						const delta =
							TYPE_OFFSET[station] * commodity.gradient * PRICE_STEP_CR;
						if (base + delta < PRICE_STEP_CR) fired++;
						rows++;
					}
		expect(fired / rows).toBeLessThan(0.01);
	});

	test("never makes a good scarcer than the trade station", () => {
		// The one-sided quantity delta. The symmetric form empties the fence's
		// contraband shelf, which is the reason it is one-sided.
		for (const commodity of COMMODITIES)
			for (const economy of ECONOMIES)
				for (const fluct of FLUCT) {
					const base = marketRow(commodity, economy, fluct, "trade").quantity;
					for (const station of ["refinery", "shipyard"] as const)
						expect(
							marketRow(commodity, economy, fluct, station).quantity,
						).toBeGreaterThanOrEqual(base);
				}
	});

	test("the fence still stocks contraband under the quantity delta", () => {
		const narcotics = byName("Narcotics");
		const stocked = ECONOMIES.flatMap((economy) =>
			FLUCT.map(
				(fluct) => marketRow(narcotics, economy, fluct, "refinery").quantity,
			),
		).filter((q) => q > 0);
		expect(stocked.length).toBeGreaterThan(0);
	});

	test("quantity never exceeds Bell's 63-unit cap", () => {
		for (const commodity of COMMODITIES)
			for (const economy of ECONOMIES)
				for (const fluct of ALL_FLUCT)
					for (const station of ["trade", "refinery", "shipyard"] as const) {
						const q = marketRow(commodity, economy, fluct, station).quantity;
						expect(q).toBeGreaterThanOrEqual(0);
						expect(q).toBeLessThanOrEqual(QUANTITY_CAP);
					}
	});
});

describe("§5 the stock deficit brakes a repeated run", () => {
	test("buying raises the price and selling lowers it, proportionally", () => {
		// Proportional, not a flat byte: a flat shift would move a ~7 Cr good by
		// more than its entire economy sweep for one hold of cargo.
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

	test("it never prices a good below the floor", () => {
		expect(stockResponse(5, -1000)).toBeCloseTo(PRICE_STEP_CR, 6);
	});

	test("the best intra-system pair is exhausted within four runs", () => {
		// The reason the shipyard→refinery loop does not collapse the galaxy into
		// single-system trading. Removing the deficit reopens that, which is why
		// this is a test and not a comment.
		const computers = byName("Computers");
		const HOLD_T = 20;
		let bought = 0;
		let sold = 0;
		let runs = 0;
		while (runs < 20) {
			const buy = stockResponse(
				marketRow(computers, 3, 0x7a, "shipyard").priceCr,
				bought,
			);
			const sell = stockResponse(
				marketRow(computers, 3, 0x1c, "refinery").priceCr,
				-sold,
			);
			if (sell - buy <= 0) break;
			runs++;
			bought += HOLD_T;
			sold += HOLD_T;
		}
		expect(runs).toBeGreaterThan(0);
		expect(runs).toBeLessThanOrEqual(4);
	});
});
