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
	MARKET_PERIOD_MIN,
	PRICE_STEP_CR,
	QUANTITY_CAP,
	TYPE_OFFSET,
	addDeficit,
	bestMargin,
	decayDeficit,
	marketEpoch,
	marketRow,
	runsToExhaustion,
	stockResponse,
} from "./helpers/market-math";

const byName = (name: string): Commodity =>
	COMMODITIES.find((c) => c.name === name) as Commodity;

/** Buyable, hold-consuming goods — the population §8's pump actually trades. */
const TRADEABLE = COMMODITIES.filter((c) => !c.sellOnly && c.unit === "t");
/** …and of those, the ones a shipyard or trade station will actually handle.
 *  §4 scopes contraband to fences, so a shipyard→refinery contraband run is not
 *  a transaction that exists — including it in an intra-system search finds a
 *  "best pair" no player can fly. */
const LEGAL_TRADEABLE = TRADEABLE.filter((c) => !c.illegal);

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

describe("§2.2 the clamp applies to quantity too, and diverges from Bell there", () => {
	test("four goods read differently from txtelite, and the set is pinned", () => {
		// Bell's `& 0x3F` wraps 64…127 back down; §2.2 clamps. The spec records
		// this in §12 rather than claiming the table is Bell's throughout, and
		// this test is what stops the recorded set drifting from the real one.
		const diverging: string[] = [];
		for (const commodity of COMMODITIES) {
			let differs = false;
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT)
					if (
						marketRow(commodity, economy, fluct, "trade").quantity !==
						marketRow(commodity, economy, fluct, "trade", "wrap").quantity
					)
						differs = true;
			if (differs) diverging.push(commodity.name);
		}
		expect(diverging.sort()).toEqual(["Furs", "Gold", "Narcotics", "Platinum"]);
	});

	test("Gold is the extreme case — always capped where Bell keeps it scarce", () => {
		// baseQuantity 0x42 = 66 never leaves 66…80, so Bell's mask reads 2…16
		// units and the clamp reads a permanent 63. Named because it makes a
		// precious metal abundant that Bell made scarce.
		const gold = COMMODITIES.find((c) => c.name === "Gold") as Commodity;
		for (const economy of ALL_ECONOMIES)
			for (const fluct of ALL_FLUCT) {
				expect(marketRow(gold, economy, fluct, "trade").quantity).toBe(
					QUANTITY_CAP,
				);
				expect(
					marketRow(gold, economy, fluct, "trade", "wrap").quantity,
				).toBeLessThan(20);
			}
	});
});

describe('§2.2 "wrap" mode is Bell on both bytes, not just on price', () => {
	test("wrap mode wraps the quantity byte too", () => {
		// An earlier version clamped quantity regardless of mode, so every
		// "Bell + wrap" figure was a hybrid — his price arithmetic with seelite's
		// shelf — quoted in the very table justifying the divergence from him.
		const gold = COMMODITIES.find((c) => c.name === "Gold") as Commodity;
		expect(marketRow(gold, 0, 0, "trade", "wrap").quantity).toBe(
			(0x42 + 0 - 0) & QUANTITY_CAP,
		);
		expect(marketRow(gold, 0, 0, "trade", "saturate").quantity).toBe(
			QUANTITY_CAP,
		);
	});

	test("Bell's Narcotics row is more scarce under the clamp than under his wrap", () => {
		// The figure §2.3 quotes. Measured with the clamp applied to quantity it
		// read 36% for both Bell rows, which was seelite's shelf wearing Bell's
		// name; his own arithmetic stocks the good on ~47% of rows.
		const wrapped = bestMargin(NARCOTICS_BELL, "refinery", "refinery", "wrap");
		const clamped = bestMargin(
			NARCOTICS_BELL,
			"refinery",
			"refinery",
			"saturate",
		);
		expect(wrapped.inStock).toBeGreaterThan(clamped.inStock);
		expect(wrapped.inStock).toBeGreaterThan(0.4);
	});
});

describe("§5.1 the market epoch", () => {
	test("advances once per period, and phase staggers the boundary", () => {
		expect(marketEpoch(0, 0)).toBe(0);
		expect(marketEpoch(0, MARKET_PERIOD_MIN - 1)).toBe(0);
		expect(marketEpoch(0, MARKET_PERIOD_MIN)).toBe(1);
		expect(marketEpoch(0, 3 * MARKET_PERIOD_MIN)).toBe(3);
		// A station with a phase offset flips earlier in wall time, which is the
		// point: markets in one system must not all re-roll together.
		expect(marketEpoch(MARKET_PERIOD_MIN - 1, 1)).toBe(1);
		expect(marketEpoch(1, 1)).toBe(0);
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

	test("never prices a good below §3's floor", () => {
		// An earlier version removed this floor, reasoning that the ±63 clamp
		// bounds the multiplier at 0.685 so it could never fire. That holds only
		// above 0.4 / 0.685 ≈ 0.584 Cr — and the rows §3's floor pins at exactly
		// 0.4 Cr are the population below it. A bound that holds for most of the
		// domain is not a bound.
		expect(MIN_STOCK_RESPONSE_FACTOR).toBeCloseTo(0.685, 6);
		expect(stockResponse(PRICE_STEP_CR, -DEFICIT_MAX)).toBeCloseTo(
			PRICE_STEP_CR,
			6,
		);
		expect(stockResponse(0.5, -DEFICIT_MAX)).toBeCloseTo(PRICE_STEP_CR, 6);
		// …and above the crossover it is the multiplier, not the floor, that binds.
		for (const price of [5, 61, 102])
			expect(stockResponse(price, -DEFICIT_MAX)).toBeCloseTo(
				price * MIN_STOCK_RESPONSE_FACTOR,
				6,
			);
		// The strong claim, over every price the table can actually produce.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const station of ALL_STATIONS) {
					const row = marketRow(commodity, economy, 0, station);
					expect(
						stockResponse(row.priceCr, -DEFICIT_MAX),
					).toBeGreaterThanOrEqual(PRICE_STEP_CR);
				}
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
		// Searched across goods, economies **and** fluctuation-byte pairs, because
		// §10.1 claims the *best* pair is exhausted and a fixed configuration is
		// not it: the instrument reports an intra-system max of 28.0 Cr/t while
		// one hardcoded setup started at 27.2, so the pair the brake most has to
		// survive was never the pair asserted. Bytes are independent — pairing
		// them understates the margin, and an understated margin exhausts sooner.
		const FLUCT_PAIRS: [number, number][] = [
			[0x00, 0x91],
			[0x3d, 0x1c],
			[0x7a, 0xc6],
			[0xb1, 0x58],
			[0xee, 0x2f],
		];
		let worst = { spread: Number.NEGATIVE_INFINITY, buyCr: 0, sellCr: 0 };
		for (const commodity of LEGAL_TRADEABLE)
			for (const economy of ALL_ECONOMIES)
				for (const [buyFluct, sellFluct] of FLUCT_PAIRS) {
					const buy = marketRow(commodity, economy, buyFluct, "shipyard");
					if (buy.quantity === 0) continue;
					const sellCr = marketRow(
						commodity,
						economy,
						sellFluct,
						"refinery",
					).priceCr;
					if (sellCr - buy.priceCr > worst.spread)
						worst = {
							spread: sellCr - buy.priceCr,
							buyCr: buy.priceCr,
							sellCr,
						};
				}
		expect(worst.spread).toBeGreaterThan(0);

		const { runs } = runsToExhaustion({
			buyBaseCr: worst.buyCr,
			sellBaseCr: worst.sellCr,
		});
		expect(runs).toBeGreaterThan(0);
		expect(runs).toBeLessThanOrEqual(4);
	});

	test("the brake's reach exceeds the worst legal intra-system spread", () => {
		// Stronger than counting runs, and the property the run count depends on.
		// At the ±63 cap the multipliers are 1.315 and 0.685, so the deficit can
		// close any pair whose sell/buy ratio is below 1.315/0.685 = 1.920 and
		// **no** pair above it, however many runs are flown. The worst legal
		// intra-system ratio is 1.571 (Computers at economy 0), leaving 18%
		// headroom. If a retune pushes a pair past 1.920 the loop stops being a
		// burst and becomes a farm, and the run-count test alone would only say
		// "more than four".
		const closable =
			(2 - MIN_STOCK_RESPONSE_FACTOR) / MIN_STOCK_RESPONSE_FACTOR;
		expect(closable).toBeCloseTo(1.92, 2);

		let worstRatio = 0;
		for (const commodity of LEGAL_TRADEABLE)
			for (const economy of ALL_ECONOMIES)
				for (const buyFluct of ALL_FLUCT) {
					const buy = marketRow(commodity, economy, buyFluct, "shipyard");
					if (buy.quantity === 0) continue;
					for (const sellFluct of ALL_FLUCT)
						worstRatio = Math.max(
							worstRatio,
							marketRow(commodity, economy, sellFluct, "refinery").priceCr /
								buy.priceCr,
						);
				}
		expect(worstRatio).toBeLessThan(closable);
	});
});
