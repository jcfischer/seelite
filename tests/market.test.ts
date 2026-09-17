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
	BID_CUT_FLOOR,
	BID_CUT_GRADE,
	COMMODITIES,
	type Commodity,
	DEFICIT_HALF_LIFE_MIN,
	DEFICIT_MAX,
	DEFICIT_SATURATION_RUNS,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	EQUIPMENT,
	FUEL_CR_PER_LY,
	FUEL_TANK_LY,
	HOLD_REFERENCE_T,
	MARKET_PERIOD_MIN,
	MIN_STOCK_RESPONSE_FACTOR,
	NARCOTICS_RETUNE,
	PRICE_ELASTICITY,
	PRICE_DISPLAY_STEP_CR,
	PRICE_STEP_CR,
	type MarketQuote,
	quantizeToDisplayStepCr,
	QUANTITY_CAP,
	SATURATE,
	TYPE_OFFSET,
	addDeficit,
	bidCutAtTl,
	commodity,
	decayDeficit,
	fullKitCr,
	marketEpoch,
	marketQuote,
	marketRowAt,
	shelfQuantity,
	stockResponse,
} from "../src/market";
import {
	HULL_CEILING_HOLD_T,
	HULL_SPECS,
	PURCHASABLE_HULL_IDS,
} from "../src/hull";
import {
	ALL_ECONOMIES,
	ALL_FLUCT,
	ALL_STATIONS,
	BELL_WRAP,
	CLOSABLE_RATIO,
	FLUCT_PAIRS,
	NARCOTICS_BELL,
	OFFSET_STATIONS,
	bestMargin,
	bestRunValueCr,
	fixedReferenceResponse,
	floorRate,
	forEachLegalPair,
	residualMarginCr,
	runTotalCr,
	runValueCr,
	runsToExhaustion,
	runsUntilHoldLimited,
	saturatedDeficitT,
	surveyResiduals,
	sweepDomain,
} from "./helpers/market-math";
import { generateGalaxy } from "../src/galaxy";
import { ALL_GALAXIES, worldSeeds } from "./helpers/station-rows";

/** The file's short local name; the lookup itself is shared, not copied. */
const byName = commodity;

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
				expect(marketRowAt(alien, economy, fluct, "trade").quantity).toBe(0);
	});
});

describe("the trade lanes run the researched direction", () => {
	test("negative-gradient goods are cheap and plentiful at Poor Agricultural", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.gradient >= 0 || commodity.sellOnly) continue;
			for (const fluct of ALL_FLUCT) {
				const rich = marketRowAt(commodity, 0, fluct, "trade");
				const poor = marketRowAt(commodity, 7, fluct, "trade");
				expect(poor.priceCr).toBeLessThan(rich.priceCr);
				expect(poor.quantity).toBeGreaterThanOrEqual(rich.quantity);
			}
		}
	});

	test("positive-gradient goods are cheap and plentiful at Rich Industrial", () => {
		for (const commodity of COMMODITIES) {
			if (commodity.gradient <= 0 || commodity.sellOnly) continue;
			for (const fluct of ALL_FLUCT) {
				const rich = marketRowAt(commodity, 0, fluct, "trade");
				const poor = marketRowAt(commodity, 7, fluct, "trade");
				expect(rich.priceCr).toBeLessThan(poor.priceCr);
				expect(rich.quantity).toBeGreaterThanOrEqual(poor.quantity);
			}
		}
	});

	test("Computers out, Furs back — the canonical loop still pays", () => {
		const computers = byName("Computers");
		const furs = byName("Furs");
		const outward =
			marketRowAt(computers, 7, 0, "trade").priceCr -
			marketRowAt(computers, 0, 0, "trade").priceCr;
		const homeward =
			marketRowAt(furs, 0, 0, "trade").priceCr -
			marketRowAt(furs, 7, 0, "trade").priceCr;
		expect(outward).toBeCloseTo(39.2, 1);
		expect(homeward).toBeCloseTo(25.2, 1);
	});
});

describe("§2.2 overflow is confined to Bell's Narcotics row", () => {
	test("no good in the shipped table overflows the byte", () => {
		// Named for overflow, not for "reaching a byte end" — Computers reaches
		// exactly 255 at economy 7 (154 + 3 + 7×14) without overflowing, so the
		// stronger-sounding claim would be false. Not "no *legal* good" either:
		// Slaves and Firearms are illegal and inside this assertion, which is the
		// point — the retune left them alone.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT)
					for (const station of ALL_STATIONS)
						expect(
							marketRowAt(commodity, economy, fluct, station).priceOverflowed,
						).toBe(false);
	});

	test("two goods sit exactly on the ceiling, with no headroom", () => {
		// §12 weak joint 2 calls the clamp "a guard that cannot fire". That is
		// true of the table as shipped, but the margin is zero, not comfortable:
		// one point of basePrice, gradient or mask on either good and it fires.
		// **Luxuries as well as Computers** — an earlier version pinned only the
		// one it happened to notice, so a Luxuries retune would have fired the
		// clamp unannounced.
		for (const name of ["Computers", "Luxuries"]) {
			const good = byName(name);
			expect(good.basePrice + good.mask + 7 * good.gradient).toBe(255);
		}
		// …and nothing else in the table is within 10 of it, so the pair is the
		// whole population this weak joint is about.
		const nearCeiling = COMMODITIES.filter(
			(c) => c.basePrice + c.mask + 7 * Math.max(0, c.gradient) > 245,
		).map((c) => c.name);
		expect(nearCeiling.sort()).toEqual(["Computers", "Luxuries"]);
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
		const { hits, rows } = sweepDomain(
			(economy, fluct) =>
				marketRowAt(NARCOTICS_BELL, economy, fluct, "trade").priceOverflowed,
		);
		expect(hits / rows).toBeGreaterThan(0.9);
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
		// Compared as **run value**, not per-unit margin. Two earlier versions got
		// this wrong in opposite directions: the first ranked only tonne goods,
		// excluding the sub-tonne ones the quantity clamp enriched; the second
		// included them but ranked Gold's Cr/**kg** against Narcotics' Cr/**t**,
		// so they cleared the bar on unit scale rather than economics — Gold's
		// spread is 5,600 Cr per tonne-equivalent. `runValueCr` is what makes them
		// commensurable: a hold of tonne goods, or 63 units of a sub-tonne good
		// riding free alongside it.
		// …and over **every leg a legal good may use**, not the fence's own.
		// Restricting legal goods to refinery→refinery is a rule §4 imposes on
		// contraband by design and on nothing else: Computers bought at a shipyard
		// and sold at a refinery picks up the full five-step type spread. Ranking
		// legal goods on the contraband leg understated them, and so overstated
		// the premium this test exists to establish.
		const bestLegal = COMMODITIES.filter((c) => !c.illegal && !c.sellOnly)
			.map((c) => bestRunValueCr(c, HOLD_REFERENCE_T).runCr)
			.reduce((a, b) => Math.max(a, b), 0);
		// Measured: Narcotics 1,624 Cr a run against Platinum's 1,386 — a 17%
		// premium, not the 43% an earlier version claimed by holding legal goods
		// to the fence leg.
		//
		// **This is a per-good comparison and it is not the whole story.** A run
		// carries a hold *and* every sub-tonne good, and the test below measures
		// that — where the ordering reverses. Kept because §4's table is a
		// per-good ranking and this is what guards it; the run-level truth is
		// weak joint 11 rather than something hidden behind this assertion.
		expect(
			bestRunValueCr(byName("Narcotics"), HOLD_REFERENCE_T).runCr,
		).toBeGreaterThan(bestLegal);
	});
});

describe("§3 the type offset", () => {
	test("shifts price in the direction the spec claims", () => {
		const computers = byName("Computers");
		const minerals = byName("Minerals");
		const at = (c: Commodity, s: "trade" | "refinery" | "shipyard") =>
			marketRowAt(c, 3, 0, s).priceCr;
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
					const base = marketRowAt(commodity, economy, fluct, "trade");
					for (const station of OFFSET_STATIONS) {
						const shifted = marketRowAt(commodity, economy, fluct, station);
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
		const { fired, rows } = floorRate(OFFSET_STATIONS);
		expect(fired / rows).toBeLessThan(0.01);
		// The trade station's offset is zero, so its floor can never fire.
		for (const good of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				expect(marketRowAt(good, economy, 0, "trade").floorFired).toBe(false);
	});

	test("never makes a good scarcer than the trade station", () => {
		// The one-sided quantity delta. The symmetric form empties the fence's
		// contraband shelf, which is the reason it is one-sided.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT) {
					const base = marketRowAt(commodity, economy, fluct, "trade").quantity;
					for (const station of OFFSET_STATIONS)
						expect(
							marketRowAt(commodity, economy, fluct, station).quantity,
						).toBeGreaterThanOrEqual(base);
				}
	});

	test("the fence still stocks contraband under the quantity delta", () => {
		for (const good of ["Narcotics", "Firearms", "Slaves"]) {
			const { inStock } = bestMargin(byName(good), "refinery", "refinery");
			expect(inStock).toBeGreaterThan(0);
		}
	});

	test("the shelf stays inside the cap after a deficit, in both directions", () => {
		// §1's pipeline put `− deficit` *outside* the clamp, so dumping a hold
		// yielded a 126-unit shelf while §10.1 claimed the cap held everywhere —
		// on the strength of a test calling `marketRow`, which takes no deficit
		// and cannot observe the case.
		expect(shelfQuantity(QUANTITY_CAP, -DEFICIT_MAX)).toBe(QUANTITY_CAP);
		expect(shelfQuantity(40, -DEFICIT_MAX)).toBe(QUANTITY_CAP);
		expect(shelfQuantity(40, DEFICIT_MAX)).toBe(0);
		expect(shelfQuantity(40, 10)).toBe(30);
		expect(shelfQuantity(40, -10)).toBe(50);
		// …and a runaway deficit cannot push it out either way.
		expect(shelfQuantity(40, 10_000)).toBe(0);
		expect(shelfQuantity(40, -10_000)).toBe(QUANTITY_CAP);
	});

	test("the shelf is whole units under a decayed deficit (#316)", () => {
		// #316, §5.2: a decayed mark is almost never whole; the shelf is floored.
		expect(shelfQuantity(40, 10.4)).toBe(29);
		expect(shelfQuantity(40, -10.4)).toBe(50);
		for (let minutes = 0; minutes <= 60; minutes += 0.7) {
			for (const mark of [16, -16, 39.2, -39.2]) {
				const shelf = shelfQuantity(40, decayDeficit(mark, minutes));
				expect(Number.isInteger(shelf)).toBe(true);
			}
		}
	});

	test("quantity never exceeds Bell's 63-unit cap", () => {
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT)
					for (const station of ALL_STATIONS) {
						const q = marketRowAt(commodity, economy, fluct, station).quantity;
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
						marketRowAt(commodity, economy, fluct, "trade").quantity !==
						marketRowAt(commodity, economy, fluct, "trade", BELL_WRAP).quantity
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
		const gold = byName("Gold");
		for (const economy of ALL_ECONOMIES)
			for (const fluct of ALL_FLUCT) {
				expect(marketRowAt(gold, economy, fluct, "trade").quantity).toBe(
					QUANTITY_CAP,
				);
				expect(
					marketRowAt(gold, economy, fluct, "trade", BELL_WRAP).quantity,
				).toBeLessThan(20);
			}
	});
});

describe('§2.2 "wrap" mode is Bell on both bytes, not just on price', () => {
	test("wrap mode wraps the quantity byte too", () => {
		// An earlier version clamped quantity regardless of mode, so every
		// "Bell + wrap" figure was a hybrid — his price arithmetic with seelite's
		// shelf — quoted in the very table justifying the divergence from him.
		const gold = byName("Gold");
		expect(marketRowAt(gold, 0, 0, "trade", BELL_WRAP).quantity).toBe(
			(0x42 + 0 - 0) & QUANTITY_CAP,
		);
		expect(marketRowAt(gold, 0, 0, "trade", SATURATE).quantity).toBe(
			QUANTITY_CAP,
		);
	});

	test("Bell's Narcotics row is more scarce under the clamp than under his wrap", () => {
		// The figure §2.3 quotes. Measured with the clamp applied to quantity it
		// read 36% for both Bell rows, which was seelite's shelf wearing Bell's
		// name; his own arithmetic stocks the good on ~47% of rows.
		const wrapped = bestMargin(
			NARCOTICS_BELL,
			"refinery",
			"refinery",
			BELL_WRAP,
		);
		const clamped = bestMargin(
			NARCOTICS_BELL,
			"refinery",
			"refinery",
			SATURATE,
		);
		expect(wrapped.inStock).toBeGreaterThan(clamped.inStock);
		expect(wrapped.inStock).toBeGreaterThan(0.4);
	});
});

describe("§4/§4.1 run value", () => {
	test("a legal run out-earns a smuggling run once sub-tonne goods stack", () => {
		// The finding §4 and weak joint 11 record, pinned so it cannot drift
		// silently in either direction — including back to "contraband wins",
		// which would mean the premium was restored without anyone deciding to.
		//
		// The cause is structural: Narcotics has a **positive** gradient, so it
		// buys at low economy and sells at high; the metals are negative-gradient
		// and want exactly the opposite leg. A smuggling route therefore cannot
		// also carry peak-value metals.
		const BYTES = [0x00, 0x3d, 0x7a, 0xb1, 0xee];
		let bestLegalRun = 0;
		let bestSmugglingRun = 0;
		for (const buyEconomy of ALL_ECONOMIES)
			for (const sellEconomy of ALL_ECONOMIES)
				for (const buyFluct of BYTES)
					for (const sellFluct of BYTES) {
						for (const buyStation of ALL_STATIONS)
							for (const sellStation of ALL_STATIONS) {
								if (buyStation === sellStation) continue;
								bestLegalRun = Math.max(
									bestLegalRun,
									runTotalCr({
										buyEconomy,
										sellEconomy,
										buyStation,
										sellStation,
										buyFluct,
										sellFluct,
										holdGood: (g) => !g.illegal,
										holdT: HOLD_REFERENCE_T,
									}).totalCr,
								);
							}
						// Contraband trades only fence→fence (§4).
						bestSmugglingRun = Math.max(
							bestSmugglingRun,
							runTotalCr({
								buyEconomy,
								sellEconomy,
								buyStation: "refinery",
								sellStation: "refinery",
								buyFluct,
								sellFluct,
								holdGood: (g) => g.illegal,
								holdT: HOLD_REFERENCE_T,
							}).totalCr,
						);
					}
		// Measured: 3,746 Cr legal against 2,314 Cr smuggling.
		expect(bestLegalRun).toBeGreaterThan(3000);
		expect(bestSmugglingRun).toBeLessThan(bestLegalRun);
	});

	test("the sub-tonne goods the clamp enriched are worth what §2.2 claims", () => {
		// §2.2 puts a number on what the divergence hands the player. Committed
		// here because every other sweep in the suite drops non-tonne goods, so
		// the figure had no measurement behind it at all.
		const fenceValue = (name: string) =>
			runValueCr(
				byName(name),
				bestMargin(byName(name), "refinery", "refinery").margin,
				HOLD_REFERENCE_T,
			);
		expect(fenceValue("Gold")).toBeGreaterThan(300);
		expect(fenceValue("Gold")).toBeLessThan(400);
		expect(fenceValue("Platinum")).toBeGreaterThan(1000);
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

describe("§6 compounding out of the starting capital", () => {
	test("the player is capital-limited for six runs, not five", () => {
		// §6 said five and called it arithmetic while committing none. It is six
		// on the canonical lane at zero fluctuation, and §1's rule is that a
		// quoted figure has a re-derivation path.
		const computers = byName("Computers");
		const runs = runsUntilHoldLimited({
			startCr: 100,
			buyCr: marketRowAt(computers, 0, 0, "trade").priceCr,
			sellCr: marketRowAt(computers, 7, 0, "trade").priceCr,
		});
		expect(runs).toBe(6);
	});
});

describe("§5 the stock deficit", () => {
	test("moves price proportionally, so cheap goods are not wrecked", () => {
		// A flat byte shift would move a ~7 Cr good by more than its entire
		// economy sweep for one hold of cargo.
		for (const price of [7, 61, 100]) {
			expect(
				stockResponse(price, HOLD_REFERENCE_T, HOLD_REFERENCE_T),
			).toBeCloseTo(price * (1 + PRICE_ELASTICITY), 6);
			expect(
				stockResponse(price, -HOLD_REFERENCE_T, HOLD_REFERENCE_T),
			).toBeCloseTo(price * (1 - PRICE_ELASTICITY), 6);
			expect(stockResponse(price, 0, HOLD_REFERENCE_T)).toBeCloseTo(price, 6);
			// **One full run of any hull moves the price by the same 10%** — #182's
			// answer to #26's D6, and the property the old expression lost above a
			// 63 t hold. A hull is not punished for its size; it is punished for
			// the number of runs it has made.
			for (const hull of PURCHASABLE_HULL_IDS) {
				const holdT = HULL_SPECS[hull].holdT;
				expect(stockResponse(price, holdT, holdT)).toBeCloseTo(
					price * (1 + PRICE_ELASTICITY),
					6,
				);
			}
		}
	});

	test("saturates at the cap rather than running away", () => {
		expect(addDeficit(60, 40, HOLD_REFERENCE_T)).toBe(DEFICIT_MAX);
		expect(addDeficit(-60, -40, HOLD_REFERENCE_T)).toBe(-DEFICIT_MAX);
		// …and a price built from a runaway deficit is still bounded.
		expect(stockResponse(61, 10_000, HOLD_REFERENCE_T)).toBeCloseTo(
			stockResponse(61, DEFICIT_MAX, HOLD_REFERENCE_T),
			6,
		);
	});

	test("the cap is a ratchet, so a downgrade cannot launder a mark", () => {
		// Sell the freighter, trade once in a courier, buy the freighter back.
		// If the courier's own cap were applied to somebody else's mark, that
		// sequence would wash a saturated 189 t deficit down to 63 — a brake with
		// an off switch, and the reason `addDeficit` takes the larger of the two.
		const freighterHold = HULL_SPECS.freighter.holdT;
		const saturated = DEFICIT_SATURATION_RUNS * freighterHold;
		expect(addDeficit(0, saturated * 2, freighterHold)).toBeCloseTo(
			saturated,
			6,
		);
		expect(addDeficit(saturated, 5, HOLD_REFERENCE_T)).toBeCloseTo(
			saturated,
			6,
		);
		// It still fades: the ratchet is on the clamp, not on the decay.
		expect(decayDeficit(saturated, DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(
			saturated / 2,
			6,
		);
	});

	test("every hull saturates after the same number of runs", () => {
		// #26's D6 asked for a response that scales with the hold, and #13's
		// constraint says where a scaling may not live: on a bounded index, where
		// the clamp deletes it. The old expression divided a ±63 *tonne* clamp by
		// a fixed 20, so a 63 t hull and a 200 t hull left an identical mark —
		// the scaling was clamped away exactly where the ladder begins.
		//
		// The control is the rejected arm, kept runnable in `market-math.ts` for
		// the reason `BELL_WRAP` is: a rejection with no runnable counterpart is
		// an assertion. It must go *red* on this property, or the property is not
		// evidence for the change.
		const oneRun = (holdT: number) =>
			stockResponse(100, holdT, holdT) / 100 - 1;
		const oneRunFixed = (holdT: number) =>
			fixedReferenceResponse(100, holdT, holdT) / 100 - 1;
		const holds = [8, 20, 60, 63, 120, 197];
		for (const holdT of holds)
			expect(oneRun(holdT)).toBeCloseTo(PRICE_ELASTICITY, 9);
		// …and the control cannot tell 63 t from 197 t at all.
		expect(oneRunFixed(63)).toBeCloseTo(oneRunFixed(197), 9);
		expect(oneRunFixed(63)).toBeGreaterThan(oneRunFixed(20));
	});

	test("the invariance is the tonne goods', and the sub-tonne ones are not it", () => {
		// **The claim above is narrower than it reads, so the boundary is pinned.**
		// Gold, Platinum and Gem-Stones bypass the hold check (research §2.2), so
		// a run of one is Bell's 63 units whatever the ship — and 63 units over a
		// bigger hold is a *smaller* mark. A build that quietly gave sub-tonne
		// goods the tonne goods' invariance would pass every other row in this
		// file.
		const goldRun = (holdT: number) =>
			stockResponse(100, QUANTITY_CAP, holdT) / 100 - 1;
		// At and below the reference hold the ±3.15-hold clamp binds, so the move
		// is the saturated one; above it the run is a shrinking fraction of a hold.
		expect(goldRun(8)).toBeCloseTo(goldRun(HOLD_REFERENCE_T), 9);
		expect(goldRun(HULL_SPECS.freighter.holdT)).toBeLessThan(
			goldRun(HOLD_REFERENCE_T),
		);
		expect(goldRun(HULL_CEILING_HOLD_T)).toBeLessThan(
			goldRun(HULL_SPECS.freighter.holdT),
		);
		// The saturated end is the clamp's, so it is the same 31.5% the tonne
		// goods reach after 3.15 runs — the two differ in how *fast*, not how far.
		expect(goldRun(HOLD_REFERENCE_T)).toBeCloseTo(
			PRICE_ELASTICITY * DEFICIT_SATURATION_RUNS,
			9,
		);
	});

	test("never prices a good below §3's floor", () => {
		// An earlier version removed this floor, reasoning that the ±63 clamp
		// bounds the multiplier at 0.685 so it could never fire. That holds only
		// above 0.4 / 0.685 ≈ 0.584 Cr — and the rows §3's floor pins at exactly
		// 0.4 Cr are the population below it. A bound that holds for most of the
		// domain is not a bound.
		expect(MIN_STOCK_RESPONSE_FACTOR).toBeCloseTo(0.685, 6);
		expect(
			stockResponse(PRICE_STEP_CR, -DEFICIT_MAX, HOLD_REFERENCE_T),
		).toBeCloseTo(PRICE_STEP_CR, 6);
		expect(stockResponse(0.5, -DEFICIT_MAX, HOLD_REFERENCE_T)).toBeCloseTo(
			PRICE_STEP_CR,
			6,
		);
		// …and above the crossover it is the multiplier, not the floor, that binds.
		for (const price of [5, 61, 102])
			expect(stockResponse(price, -DEFICIT_MAX, HOLD_REFERENCE_T)).toBeCloseTo(
				price * MIN_STOCK_RESPONSE_FACTOR,
				6,
			);
		// The strong claim, over every price the table can actually produce —
		// **and over every hold in the roster**, because #182 made the response a
		// function of one. `MIN_STOCK_RESPONSE_FACTOR` is hold-invariant now, so
		// the floor's whole domain grew and a check pinned to 20 t would no longer
		// cover it.
		for (const commodity of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const station of ALL_STATIONS) {
					const row = marketRowAt(commodity, economy, 0, station);
					for (const hull of PURCHASABLE_HULL_IDS) {
						const holdT = HULL_SPECS[hull].holdT;
						expect(
							stockResponse(row.priceCr, -saturatedDeficitT(holdT), holdT),
						).toBeGreaterThanOrEqual(PRICE_STEP_CR);
					}
				}
	});

	test("decays by half over one half-life", () => {
		expect(decayDeficit(40, DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(20, 6);
		expect(decayDeficit(40, 2 * DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(10, 6);
		expect(decayDeficit(40, 0)).toBeCloseTo(40, 6);
	});

	test("every closable intra-system pair is exhausted within four runs", () => {
		// **All six ordered station legs**, not the one written first. An earlier
		// version searched shipyard→refinery only — and §5.4's richest residual
		// sits on refinery→shipyard, the excluded direction, so the leg asserted
		// was provably not the one the brake most has to survive.
		//
		// The claim is necessarily conditional, and saying so is the point: a pair
		// above CLOSABLE_RATIO never reaches zero however many runs are flown, so
		// "every pair exhausts" would be false. What holds is that every pair the
		// deficit *can* close, closes fast — and the test below bounds what the
		// rest keep paying.
		let checked = 0;
		let slowest = 0;
		forEachLegalPair((pair) => {
			if (pair.sellCr <= pair.buyCr) return; // never profitable to begin with
			if (residualMarginCr(pair.buyCr, pair.sellCr, HOLD_REFERENCE_T) > 0)
				return; // unclosable
			checked++;
			const { runs } = runsToExhaustion({
				buyBaseCr: pair.buyCr,
				sellBaseCr: pair.sellCr,
				holdT: HOLD_REFERENCE_T,
			});
			slowest = Math.max(slowest, runs);
		}, FLUCT_PAIRS);
		expect(checked).toBeGreaterThan(100);
		expect(slowest).toBeGreaterThan(0);
		expect(slowest).toBeLessThanOrEqual(4);
	});

	test("no intra-system pair stays worth farming once the deficit saturates", () => {
		// **The ratio bound is the wrong property**, and an earlier version of this
		// test asserted it in one direction only — buying at a shipyard, selling at
		// a refinery, one of six ordered pairs. The reverse legs hold the cheap
		// goods: Food at economy 6 is 0.4 Cr at a refinery and 4.8 Cr at a
		// shipyard, a ratio of 12, so "the deficit closes every pair" is false.
		//
		// What matters is not whether a pair reaches exactly zero but what it still
		// pays at the ±63 steady state. Food's ratio of 12 leaves pocket change
		// because it is a 0.4 Cr good. The bound worth guarding is the richest
		// residual, and it comes from the same survey the instrument prints.
		const { worst, worstPerUnit, worstRatio, unclosableRows, rows } =
			surveyResiduals(HOLD_REFERENCE_T);
		// Measured over **every** legal good, sub-tonne included: 7.9 Cr/t (Furs,
		// refinery→shipyard at economy 7) = 158 Cr per run. Ranked by run value,
		// because Gold's Cr/kg and Furs' Cr/t are not comparable — and because
		// §2.2 names the sub-tonne goods as the ones the clamp enriched, so a
		// sweep that excluded them could not support this bound at all.
		expect(worst.runCr).toBeLessThan(200);
		// …and the per-unit bound on the pair that actually maximises *it*. The
		// two argmaxes differ — run value scales by 63 for sub-tonne goods and 20
		// for tonne goods — so asserting one against the other's winner guarded
		// the wrong pair, and only looked right because sub-tonne residuals are
		// non-positive today.
		expect(worstPerUnit.residualCr).toBeLessThan(10);
		// …and the ratio view, kept because §5.4 reports it: a real minority of
		// rows exceed the closable ratio, which is why the residual is the bound.
		expect(worstRatio.ratio).toBeGreaterThan(CLOSABLE_RATIO);
		expect(unclosableRows / rows).toBeLessThan(0.05);
	});
});

describe("§5.6 the bid cut closes the round trip at one console", () => {
	/**
	 * The counted figure, read off a run of the row below. It is a transcription
	 * guard rather than a bound: a retune that moves the table moves this number
	 * and this line together, or the suite goes red.
	 */
	// Re-pinned from 8,400 to a measured 8,760 when the cut's endpoints moved onto
	// `BID_CUT_FLOOR` and `BID_CUT_GRADE` themselves: the rim's cut went from 0.110
	// to 0.100, which is closer to what the floor swallows, so three more tech
	// levels' markets joined the erased set. The figure is the row's own output; a
	// transcription that stops matching is the point of the row.
	const ERASED_CUT_ROWS = 8_760;
	test("the floor is the mark one full hold of tonnage leaves", () => {
		// **The node in one equation, and the equation is not the one this row was
		// written with.** The first version asked for
		// `PRICE_ELASTICITY × DEFICIT_SATURATION_RUNS` = 0.315, the far end of
		// `stockResponse`'s whole range, on the argument that the cut must exceed
		// whatever the market's memory can move a price. That figure is still the
		// closure requirement, and the sweep below still measures it — what changed
		// is that 0.315 cannot be shipped: `scripts/measure-greedy-trader.ts` §5.6
		// finds the honest trade loop reaching the Combat Engine in **1 of 4
		// galaxies** at a flat mean cut of 0.30, with 2 of the 4 stalling out of
		// trading altogether. Four galaxies is what the instrument sweeps; an
		// earlier draft of this comment said "six of eight", a figure from a run the
		// instrument no longer makes.
		//
		// What ships is the mark **a trade can actually leave in ordinary goods**: a
		// hold-full of tonnage, which is `PRICE_ELASTICITY × (holdT / holdT)`, which
		// is `PRICE_ELASTICITY` at every hull in the roster. Derived, not tabulated,
		// so a retune of the elasticity moves the floor with it and cannot silently
		// re-open the tonnage cycle.
		expect(BID_CUT_FLOOR).toBe(PRICE_ELASTICITY);
		// One full hold of a good whose units are tonnes moves the deficit by
		// exactly `holdT` units, and the response is linear in that ratio: this is
		// the swing the floor has to exceed, recomputed from the function rather
		// than quoted from here.
		const oneHoldSwing =
			stockResponse(100, HOLD_REFERENCE_T, HOLD_REFERENCE_T) / 100 -
			stockResponse(100, 0, HOLD_REFERENCE_T) / 100;
		expect(oneHoldSwing).toBeCloseTo(BID_CUT_FLOOR, 15);
	});

	test("the swing the floor does *not* reach is the sub-tonne one, and is named", () => {
		// **The residue, encoded as a row rather than as a paragraph.** §5.2's memory
		// counts *units*, so one purchase of the shelf cap in Platinum — 63 units,
		// 0.2 t of cargo — saturates a hull of 20 t or less and moves the price by the
		// far end of the response's range. A cut has to exceed that to close the cycle,
		// which is why `tests/station-commerce.test.ts` §5.6 finds metal cycles still
		// netting at the shipped floor.
		//
		// Platinum because it is the cheapest of the three metals and therefore the last
		// one a cut prices out; the binding row in the closure corpus is a Platinum
		// cycle, and naming a different metal would describe a pump already closed.
		// **Measured off the shipped response, not off the formula that produces it.**
		// `PRICE_ELASTICITY × DEFICIT_SATURATION_RUNS` is an identity: it holds at
		// whatever value those two constants take, so a row written that way cannot go
		// red for the re-anchor it claims to watch. This is one purchase of 63 units of
		// Platinum through `stockResponse` at the hull the game starts a player on, and
		// the answer is pinned as a literal.
		// **The pump's own direction, not its mirror.** A sale of the cap is a
		// *negative* deficit — the station is now holding 63 units the player shoved at
		// it — and the price it moves to is the one the second leg buys back at. A
		// purchase of the same size moves the price up by the same magnitude, so a row
		// written with `+63` would pass for the wrong reason.
		const saturationSwing =
			1 - stockResponse(100, -QUANTITY_CAP, HOLD_REFERENCE_T) / 100;
		// The cap is the 63 that the 0.315 is made of, so it is asserted as a number
		// here rather than trusted from its own module.
		expect(QUANTITY_CAP).toBe(63);
		expect(saturationSwing).toBeCloseTo(0.315, 12);
		// **What this row can and cannot see, said plainly.** `swing / floor` reduces to
		// `DEFICIT_SATURATION_RUNS`, so the literal below pins one thing: the cap-to-hold
		// relation, that 3.15 stacks of 63 units weigh the baseline hold. It is a scale
		// check and not a watch on the re-anchor, because the units are counted in
		// `addDeficit` and `recordTrade`, neither of which this row calls. The row that
		// *does* go red when the sub-tonne mark moves is the metals row in
		// `tests/station-commerce.test.ts` §5.6, which flies a Platinum cycle through
		// `transactAtStation` and pins the surviving credit — that is the falsifier §12's
		// weak joint 12 points at, and it is worth reading before this one.
		expect(saturationSwing / BID_CUT_FLOOR).toBeCloseTo(63 / 20, 12);
	});

	test(
		"the cut is strictly increasing, its ends are the two constants, and the rim " +
			"is therefore on the closure mark",
		() => {
			// **#191 D4, ruled on the sweep** in `scripts/measure-greedy-trader.ts`: cheap
			// at the rim, dear in the core — which is the same table said the other way as
			// *wide at high tech level*. The monotonicity is asserted rather than the figure,
			// so a retune of `BID_CUT_GRADE` re-derives this row instead of rewriting it; the
			// figure the spec quotes is pinned by the count row below.
			//
			// **Both ends, not the top one.** The first version of this law put the rim at
			// floor + grade/15 = 0.110 and left `BID_CUT_FLOOR` naming a cut no market in
			// the game pays. A row asserting only the core end passed while three sentences
			// in three files said the rim was 0.10, which is this repo's own third-copy
			// drift and was caught by reading the shipped function at TL 1 rather than by
			// anything that was red.
			//
			// Because the rim end *is* `BID_CUT_FLOOR`, and `BID_CUT_FLOOR` *is*
			// `PRICE_ELASTICITY` (asserted below), the cheapest market in the game sits
			// exactly on the mark one full hold of tonnage moves a price. A tonnage trip
			// sold and bought back there nets exactly nothing, and the closure ladder counts
			// cycles netting *more* than nothing — so the rim is closed exactly rather than
			// strictly, and the rung below the floor is the one that is not closed at all.
			// `station-commerce.test.ts` §5.6 counts the rows; this one fixes which mark the
			// rim is supposed to land on.
			expect(bidCutAtTl(DISPLAY_TL_MIN)).toBe(BID_CUT_FLOOR);
			expect(bidCutAtTl(DISPLAY_TL_MAX)).toBeCloseTo(
				BID_CUT_FLOOR + BID_CUT_GRADE,
				12,
			);
			for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
				// A bid is never zero or negative: the cut is a haircut, not a
				// repudiation, at either end of the tech range.
				expect(bidCutAtTl(tl)).toBeLessThan(1);
				if (tl > DISPLAY_TL_MIN)
					expect(bidCutAtTl(tl)).toBeGreaterThan(bidCutAtTl(tl - 1));
			}
		},
	);

	test("a tech level outside the generator's range throws rather than clamps", () => {
		// #13's clamp warning, applied to this index: an offset on a bounded index
		// gets clamped away where that type lives, and a silently clamped `displayTL`
		// would hand a station a cut no table declares. The generator's own range is
		// measured by `tests/galaxy.test.ts`, so this throw is the loud half of that
		// pair rather than a guard against an impossible input.
		expect(() => bidCutAtTl(DISPLAY_TL_MIN - 1)).toThrow();
		expect(() => bidCutAtTl(DISPLAY_TL_MAX + 1)).toThrow();
		expect(() => bidCutAtTl(7.5)).toThrow();
	});

	test("the generator never leaves the table's domain, and reaches both ends", () => {
		// The throw in `bidCutAtTl` is only safe because this is true, and it is the
		// half #13's warning actually asks for: not "the index is clamped", but "the
		// index cannot leave the range the table was authored over". Both ends are
		// asserted because a declared domain wider than the generator's reach is the
		// same drift in the other direction — a grade spread over values nobody
		// occupies is a table whose real span is a fiction.
		//
		// `generateGalaxy` alone, not `forEachSystem`: tech level is a property of
		// the record, and generating contents for 16,384 systems to read a field the
		// record already holds is a slower row for the same claim.
		const CORPUS_WORLDS = 6;
		let lo = Number.POSITIVE_INFINITY;
		let hi = Number.NEGATIVE_INFINITY;
		for (const world of worldSeeds(CORPUS_WORLDS))
			for (const g of ALL_GALAXIES)
				for (const s of generateGalaxy(world, g).systems) {
					lo = Math.min(lo, s.displayTL);
					hi = Math.max(hi, s.displayTL);
				}
		expect(lo).toBe(DISPLAY_TL_MIN);
		expect(hi).toBe(DISPLAY_TL_MAX);
	});

	/**
	 * Every priced row of the domain, walked once rather than written out four times.
	 *
	 * `marketRowAt` then `marketQuote` over `(good, economy, fluct, station, TL)` is the
	 * same five-deep nest in four §5.6 rows, and only the body differed. A domain stated
	 * four places is a domain that gets walked three of them after someone changes one,
	 * and a sweep that silently shrank still reports a clean zero.
	 *
	 * **The row is computed outside the tech level, because a base price does not depend
	 * on one.** The first version of this helper took a `tlStep` and called `marketRowAt`
	 * inside the loop, which asked the generator 1,566,720 questions to make 104,448 of
	 * them — fifteen times the work, in a gated suite. Each visit gets its row once and a
	 * `quoteAt` for the tech levels it wants, so a row that samples the ladder and a row
	 * that walks it are both reading one priced cell.
	 */
	const forEachPriceRow = (
		visit: (
			good: (typeof COMMODITIES)[number],
			row: ReturnType<typeof marketRowAt>,
			quoteAt: (displayTL: number) => MarketQuote,
		) => void,
	) => {
		for (const good of COMMODITIES)
			for (const economy of ALL_ECONOMIES)
				for (const fluct of ALL_FLUCT)
					for (const station of ALL_STATIONS) {
						const row = marketRowAt(good, economy, fluct, station);
						visit(good, row, (displayTL) =>
							marketQuote(row.priceCr, displayTL),
						);
					}
	};

	test("the ask is the market price, and the cut falls on the bid alone", () => {
		// **#7's law, reversed on one side only.** #191 D1 read as written — *a
		// station buys lower than it sells* — and it is also the cheapest closure:
		// a round trip crosses the wedge once whichever way it is arranged, so a
		// symmetric spread needs `r/(1 − r/2)`… where a one-sided one needs `r`.
		// Measured (§5.6's closure rows): a split wedge needs 0.053 a side — 0.105
		// of total wedge — to close what 0.100 on the bid alone closes.
		//
		// The consequence worth pinning: the BUY column is `stockResponse`'s figure
		// itself, moved only by the tenth-credit quote step §5.6 quantizes to. That
		// quantization is not cosmetic — it is what makes the number the console
		// prints the number the till charges — and the row below is where it is held.
		forEachPriceRow((_good, row, quoteAt) => {
			for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl += 3)
				expect(quoteAt(tl).buyCr).toBe(quantizeToDisplayStepCr(row.priceCr));
		});
	});

	test("a quote is expressed to the precision the console prints, both columns", () => {
		// **#193's rule, taken to the decimal place it did not reach.** The glass
		// renders a price with `toFixed(1)`; until this row, the till charged the
		// unquoted figure behind it, so a commander reading 3.5 Cr was paid 3.51 and
		// nothing on the screen said the two were different numbers. A quote is
		// therefore a whole number of tenths, which makes the label a lossless
		// rendering rather than a rounding.
		//
		// Asserted across the domain rather than on an example, because the defect
		// only shows on a mid whose second decimal is not zero — which is most of
		// them, since a responded price is a multiple of nothing.
		let unquantized = 0;
		forEachPriceRow((_good, _row, quoteAt) => {
			for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl += 2) {
				const q = quoteAt(tl);
				for (const cr of [q.buyCr, q.sellCr]) {
					const tenths = cr / PRICE_DISPLAY_STEP_CR;
					if (Math.abs(tenths - Math.round(tenths)) > 1e-9) unquantized++;
				}
			}
		});
		expect(unquantized).toBe(0);
		// And the label is the quote rather than an approximation of it, which is the
		// direction the old failure ran in.
		const q = marketQuote(3.504_9, DISPLAY_TL_MIN);
		expect(Number(q.sellCr.toFixed(1))).toBe(q.sellCr);
		expect(Number(q.buyCr.toFixed(1))).toBe(q.buyCr);
	});

	test("the bid is the mid less the cut, and never under one price step", () => {
		// §3's floor is re-asserted *after* the cut, which is the order that bites:
		// a row the floor already pins at 0.4 Cr cannot be cut further, so the floor
		// eats the spread there. That erasure is the clamp this node owes a collapse
		// rate for, and the next test counts it rather than arguing it away.
		// **Counted, not asserted per cell.** 1,566,720 cells x three `expect` calls is
		// 4.7M assertions, which measured 335 ms of a 2.4 s pair of files — an eighth of
		// the gated suite for a row whose whole answer is "none of them". A counter gives
		// the same verdict, and the failure message names all three counts rather than
		// stopping at the first cell like a per-cell expect does.
		let belowFloor = 0;
		let inverted = 0;
		let offFormula = 0;
		forEachPriceRow((_good, row, quoteAt) => {
			for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
				const q = quoteAt(tl);
				if (q.sellCr < PRICE_STEP_CR) belowFloor++;
				if (q.sellCr > q.buyCr) inverted++;
				if (
					q.sellCr !==
					quantizeToDisplayStepCr(
						Math.max(PRICE_STEP_CR, row.priceCr * (1 - bidCutAtTl(tl))),
					)
				)
					offFormula++;
			}
		});
		expect({ belowFloor, inverted, offFormula }).toEqual({
			belowFloor: 0,
			inverted: 0,
			offFormula: 0,
		});
	});

	test("the number of rows whose cut the floor erases is a counted figure", () => {
		// **A threshold is not a measurement (#25), and this one is quoted in the
		// spec.** Over the whole `(good, economy, fluct, type, TL)` domain —
		// 17 × 8 × 256 × 3 × 15 = 1,566,720 rows — this is how many carry no cut at
		// all because §3's floor already pins the mid at one price step.
		//
		// **The erasure is not a hole**, and the row below is what says so rather
		// than a sentence: on exactly those rows the round trip nets nothing either,
		// because the floor that swallows the spread swallows the deficit's mark on
		// the way through `stockResponse`. #13's warning is that an offset dies
		// where the type lives; here it dies where the *floor* lives, and the thing
		// it exists to prevent dies with it.
		let erased = 0;
		let erasedWithAPump = 0;
		forEachPriceRow((good, row, quoteAt) => {
			for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
				const q = quoteAt(tl);
				if (q.sellCr !== q.buyCr) continue;
				erased++;
				// Sell a hold into it, buy the same hold back at the same console: the
				// two-step cycle §12.12 measured.
				const after = stockResponse(
					row.priceCr,
					good.unit === "t" ? -HOLD_REFERENCE_T : -DEFICIT_MAX,
					HOLD_REFERENCE_T,
				);
				if (q.sellCr - marketQuote(after, tl).buyCr > 0) erasedWithAPump++;
			}
		});
		expect(erased).toBe(ERASED_CUT_ROWS);
		expect(erasedWithAPump).toBe(0);
		// 8,760 of 1,566,720 is 0.56%, and the claim in prose is "a minority". The
		// denominator is the domain's own size — 17 goods × 8 economies × 256 fluct
		// × 3 station types × 15 tech levels — so this also fails if the walk above
		// stops visiting something it used to visit.
		expect(17 * 8 * 256 * 3 * 15).toBe(1_566_720);
		expect(erased / 1_566_720).toBeLessThan(0.1);
	});
});

describe("§7/§8 equipment prices and the fitting-out total", () => {
	test("the price list is station-types.md §4.1's scope, and the two new items", () => {
		// The one number block that used to live only in prose. §6.1 is what an
		// unpinned transcribed constant costs.
		expect(EQUIPMENT.filter((e) => e.scope === "universal").length).toBe(9);
		expect(EQUIPMENT.filter((e) => e.scope === "refinery").length).toBe(2);
		expect(EQUIPMENT.filter((e) => e.scope === "shipyard").length).toBe(2);
		// Fuel is the tenth universal item; it is priced per LY, not per unit,
		// so it lives in its own constants rather than in the list.
		expect(FUEL_CR_PER_LY * FUEL_TANK_LY).toBe(14);
		// The two items Elite's cassette never had.
		expect(
			EQUIPMENT.filter((e) => e.newToSeelite)
				.map((e) => e.name)
				.sort(),
		).toEqual(["Military Laser", "Mining Laser"]);
	});

	test("§8's fitting-out total is derived from the list", () => {
		expect(fullKitCr()).toBe(19125);
		expect(fullKitCr({ withMissiles: true })).toBe(19245);
	});
});
