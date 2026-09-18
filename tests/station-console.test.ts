/**
 * `hud-and-scanner.md` §8.6's four headless obligations — 3, 4, 6 and 8.
 *
 * Each of the four is written against a way the obvious implementation passes
 * on a broken build, and §8.5 names the three defects that ship green. They are
 * asserted here as the spec words them rather than as the easier check beside
 * each one:
 *
 * - **3** is a construction check, not an absence-of-throw check. Both the
 *   correct build and the broken one throw nothing at a fence, where every good
 *   lists, so a test that only visits a fence cannot fail.
 * - **8** asserts the universal-item *set*, not its count. §8.6 measured that a
 *   count check is blind from `displayTL` 0 through 6 — exactly the half a
 *   reader thinking about frontier stations would write against.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	COMMODITIES,
	type Commodity,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	EQUIPMENT,
	FUEL_CR_PER_LY,
	HOLD_REFERENCE_T,
	type MarketStation,
	PRICE_STEP_CR,
	MARKET_PERIOD_MIN,
	quantizeToDisplayStepCr,
	UNIVERSAL_GATE_CAP,
	UNIVERSAL_ITEMS,
	bidCutAtTl,
	listsCommodity,
	marketRow,
	marketStationOf,
	shelfQuantity,
	stockResponse,
} from "../src/market";
import { TRAVERSAL_SECONDS_DEEP, TRAVERSAL_SECONDS_NEAR } from "../src/docking";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import {
	LARGE_CARGO_BAY_BONUS_T,
	commanderHold,
	newCommander,
} from "../src/station-commerce";
import {
	flightFloorVisible,
	requiredDisplayTL,
	priceLabel,
	signedDelta,
	stationConsoleVisible,
	stationEquipmentScreen,
	stationMarketScreen,
	universalItemsAt,
} from "../src/station-console";

const ECONOMY = 3;
/**
 * The tech level this file draws its screens at.
 *
 * Named rather than inlined at six call sites because §5.6's cut is a function of
 * it, and a test that quotes a price and a test that quotes a cut have to agree
 * on which market they are talking about.
 */
const SCREEN_TL = 8;

const stationOf = (
	type: "trade" | "refinery" | "shipyard",
	blackMarket: boolean,
): MarketStation =>
	marketStationOf(
		{ type, localCarrierId: `station-${type}`, blackMarket },
		0x5ee1_17e,
	);

const TRADE = stationOf("trade", false);
const FENCE = stationOf("refinery", true);

const noDeficit = () => 0;

// ---------------------------------------------------------------------------
// Obligation 3 — the row builder never asks for a price it cannot have
// ---------------------------------------------------------------------------

test("obligation 3: the builder calls marketRow only where listsCommodity is true", () => {
	// By construction: the injected row function records who it was asked about,
	// so the check reads the *calls* rather than the absence of a throw.
	for (const station of [TRADE, FENCE]) {
		const asked: string[] = [];
		stationMarketScreen(
			{
				station,
				economy: ECONOMY,
				gameTimeMin: 0,
				deficitOf: noDeficit,
				holdT: HOLD_REFERENCE_T,
				displayTL: SCREEN_TL,
			},
			(commodity, economy, s, gameTimeMin) => {
				asked.push(commodity.name);
				return marketRow(commodity, economy, s, gameTimeMin);
			},
		);
		const listed = COMMODITIES.filter((c) => listsCommodity(c, station)).map(
			(c) => c.name,
		);
		expect(asked).toEqual(listed);
	}
});

test("obligation 3: a non-fence station is the case that separates the builds", () => {
	// The guard on the guard. If both stations listed every good, the assertion
	// above would hold on a builder that ignored `listsCommodity` entirely.
	const tradeListed = COMMODITIES.filter((c) => listsCommodity(c, TRADE));
	const fenceListed = COMMODITIES.filter((c) => listsCommodity(c, FENCE));
	expect(tradeListed.length).toBe(14);
	expect(fenceListed.length).toBe(17);
});

test("M5: seventeen rows at every station, priced iff the station lists the good", () => {
	for (const station of [TRADE, FENCE]) {
		const rows = stationMarketScreen({
			station,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: noDeficit,
			holdT: HOLD_REFERENCE_T,
			displayTL: SCREEN_TL,
		});
		expect(rows.length).toBe(COMMODITIES.length);
		expect(rows.map((r) => r.commodity.name)).toEqual(
			COMMODITIES.map((c) => c.name),
		);
		for (const row of rows) {
			// The biconditional §8.6 obligation 2 asks for, not the constant 14.
			expect(row.listed).toBe(listsCommodity(row.commodity, station));
			expect(row.buyCr !== undefined).toBe(row.listed);
			expect(row.sellCr !== undefined).toBe(row.listed);
			expect(row.quantity !== undefined).toBe(row.listed);
		}
	}
});

// ---------------------------------------------------------------------------
// Obligation 4 — the delta is against this epoch's base, and absent at zero
// ---------------------------------------------------------------------------

const moved = (goodName: string, units: number) => (name: string) =>
	name === goodName ? units : 0;

/** A good the trade station lists whose price the floor does not pin, so the
 *  delta the obligation is about is a real number rather than a floored zero. */
const priceyGood = (station: MarketStation): Commodity => {
	const found = COMMODITIES.find(
		(c) =>
			listsCommodity(c, station) &&
			marketRow(c, ECONOMY, station, 0).priceCr > 10 &&
			marketRow(c, ECONOMY, station, 0).quantity > 20,
	);
	if (!found) throw new Error("no priced, stocked good at this station");
	return found;
};

test("obligation 4: a non-zero deficit carries a signed delta, a zero one carries none", () => {
	const good = priceyGood(TRADE);
	const rows = stationMarketScreen({
		station: TRADE,
		economy: ECONOMY,
		gameTimeMin: 0,
		deficitOf: moved(good.name, 12),
		holdT: HOLD_REFERENCE_T,
		displayTL: SCREEN_TL,
	});
	const movedRow = rows.find((r) => r.commodity.name === good.name);
	if (!movedRow) throw new Error("the moved good is not on the screen");
	expect(movedRow.priceDeltaCr).toBeDefined();
	expect(movedRow.quantityDelta).toBeDefined();
	// The player bought: dearer, and a thinner shelf.
	expect(movedRow.priceDeltaCr as number).toBeGreaterThan(0);
	expect(movedRow.quantityDelta as number).toBeLessThan(0);

	for (const row of rows)
		if (row.commodity.name !== good.name) {
			expect(row.priceDeltaCr).toBeUndefined();
			expect(row.quantityDelta).toBeUndefined();
		}
});

test("obligation 4: the delta is measured against this epoch's base, not the last one", () => {
	const good = priceyGood(TRADE);
	// Two moments inside different epochs. The base moves between them, and the
	// delta must move with it — a delta held against a remembered price would
	// keep the old base and drift.
	const times = [0, MARKET_PERIOD_MIN * 3];
	for (const gameTimeMin of times) {
		const base = marketRow(good, ECONOMY, TRADE, gameTimeMin);
		const rows = stationMarketScreen({
			station: TRADE,
			economy: ECONOMY,
			gameTimeMin,
			deficitOf: moved(good.name, 12),
			holdT: HOLD_REFERENCE_T,
			displayTL: SCREEN_TL,
		});
		const row = rows.find((r) => r.commodity.name === good.name);
		if (!row) throw new Error("the moved good is not on the screen");
		expect(row.buyCr).toBeCloseTo(
			quantizeToDisplayStepCr(
				stockResponse(base.priceCr, 12, HOLD_REFERENCE_T),
			),
			9,
		);
		// The delta the commander reads is between two *quoted* prices, since a
		// quote is the only figure the console has. The obligation this row exists
		// for — which epoch's base the delta is measured against — is untouched by
		// that; only the domain both terms live in moved.
		expect(row.priceDeltaCr as number).toBeCloseTo(
			quantizeToDisplayStepCr(
				stockResponse(base.priceCr, 12, HOLD_REFERENCE_T),
			) - quantizeToDisplayStepCr(base.priceCr),
			9,
		);
		expect(row.quantity).toBe(shelfQuantity(base.quantity, 12));
		expect(row.quantityDelta as number).toBe(
			shelfQuantity(base.quantity, 12) - base.quantity,
		);
	}
	// The guard: the two epochs must actually differ, or the loop above proves
	// nothing about which base was used.
	const bases = times.map((t) => marketRow(good, ECONOMY, TRADE, t).priceCr);
	expect(bases[0]).not.toBeCloseTo(bases[1], 6);
});

// ---------------------------------------------------------------------------
// Obligation 8 — the universal set, Fuel included, at every displayTL
// ---------------------------------------------------------------------------

/**
 * `economy-trade.md` §7's table order — **read out of the spec**, not typed here
 * and not derived from `EQUIPMENT`.
 *
 * Derived from the array under test it could not catch that array's missing
 * first element, which is the whole of §8.5.3. Typed here it is a second copy
 * of the spec's order with nothing tying it back, and the entire tech-gate
 * mapping — `requiredDisplayTL(9) === 7` — rests on that order. Parsed, a retune
 * of §7 that does not reach `UNIVERSAL_ITEMS` turns this file red.
 */
const ECONOMY_TRADE_7 = (() => {
	const spec = readFileSync(
		new URL("../docs/specs/economy-trade.md", import.meta.url),
		"utf8",
	);
	const names: string[] = [];
	for (const line of spec.split("\n")) {
		const cells = line.split("|").map((cell) => cell.trim());
		// `| Item | Price | Where |` — the universal rows of §7's table, in the
		// order they appear. `Missile (max 4)` carries a parenthetical the item
		// list does not.
		if (cells.length !== 5 || cells[3] !== "universal") continue;
		names.push(cells[1].replace(/\s*\(.*\)$/, ""));
	}
	return names;
})();

test("the §7 order this file checks against was read out of the spec", () => {
	// The guard on the parser. A selector that matched nothing would leave every
	// assertion below comparing two empty lists and agreeing.
	expect(ECONOMY_TRADE_7.length).toBe(10);
	expect(ECONOMY_TRADE_7[0]).toBe("Fuel");
	expect(ECONOMY_TRADE_7.at(-1)).toBe("Galactic Hyperdrive");
});

test("obligation 8: Fuel is the first universal item and the one absent from EQUIPMENT", () => {
	expect(UNIVERSAL_ITEMS.map((e) => e.name)).toEqual(ECONOMY_TRADE_7);
	expect(UNIVERSAL_ITEMS.length).toBe(UNIVERSAL_GATE_CAP);
	expect(EQUIPMENT.some((e) => e.name === "Fuel")).toBe(false);
	expect(EQUIPMENT.filter((e) => e.scope === "universal").length).toBe(9);
	const fuel = UNIVERSAL_ITEMS[0];
	expect(fuel.per).toBe("ly");
	expect(fuel.priceCr).toBe(FUEL_CR_PER_LY);
});

test("obligation 8: the universal set at displayTL d is §7's order truncated to min(d + 3, 10)", () => {
	for (let d = 0; d <= 12; d += 1) {
		const expected = ECONOMY_TRADE_7.slice(0, Math.min(d + 3, 10));
		expect(universalItemsAt(d).map((e) => e.name)).toEqual(expected);
		// Membership, not length: §8.6 measured that a count check is blind from
		// d = 0 to 6, which is where the frontier stations a reader has in mind
		// live.
		expect(new Set(universalItemsAt(d).map((e) => e.name))).toEqual(
			new Set(expected),
		);
	}
});

test("obligation 8: the slice off EQUIPMENT is the trap, and it differs at every d", () => {
	// The broken build §8.5.3 describes, run here so the obligation is measured
	// against a real rival rather than against a description of one.
	const universalRows = EQUIPMENT.filter((e) => e.scope === "universal");
	for (let d = 0; d <= 12; d += 1) {
		const buggy = universalRows
			.slice(0, Math.min(d + 3, 10))
			.map((e) => e.name);
		const correct = universalItemsAt(d).map((e) => e.name);
		expect(new Set(buggy)).not.toEqual(new Set(correct));
		// Fuel is hidden at every tech level …
		expect(buggy).not.toContain("Fuel");
		// … and below saturation the count agrees, which is why the set is what
		// is asserted.
		if (d <= 6) expect(buggy.length).toBe(correct.length);
		else expect(buggy.length).toBe(9);
	}
});

test("obligation 8: the gate puts the galactic hyperdrive at displayTL 7", () => {
	// §8.5.3's named consequence of the missing first element: the broken slice
	// sells it one tech level early.
	expect(requiredDisplayTL(9)).toBe(7);
	expect(universalItemsAt(6).map((e) => e.name)).not.toContain(
		"Galactic Hyperdrive",
	);
	expect(universalItemsAt(7).map((e) => e.name)).toContain(
		"Galactic Hyperdrive",
	);
});

// ---------------------------------------------------------------------------
// Obligation 6 — the equipment screen names what is missing, and why
// ---------------------------------------------------------------------------

test("obligation 6: a low-TL trade station lists what it sells and names what it does not", () => {
	const screen = stationEquipmentScreen({ type: "trade", displayTL: 4 });
	expect(screen.available.length).toBeGreaterThan(0);
	expect(screen.unavailable.length).toBeGreaterThan(0);
	for (const entry of screen.unavailable) {
		expect(entry.reason.length).toBeGreaterThan(0);
		expect(entry.name.length).toBeGreaterThan(0);
	}
	// M8's three reason shapes, all three reachable at one frontier trade station.
	const reasons = new Set(screen.unavailable.map((e) => e.reason));
	expect(reasons).toContain("requires TL 7");
	expect(reasons).toContain("refineries only");
	expect(reasons).toContain("shipyards only");
	// The two sets are disjoint and together cover the whole catalogue —
	// `station-types.md` §4's disjointness, asserted rather than assumed.
	const shown = [
		...screen.available.map((e) => e.name),
		...screen.unavailable.map((e) => e.name),
	];
	expect(new Set(shown).size).toBe(shown.length);
	expect(new Set(shown)).toEqual(
		new Set([
			...ECONOMY_TRADE_7,
			...EQUIPMENT.filter((e) => e.scope !== "universal").map((e) => e.name),
		]),
	);
});

test("obligation 6: type exclusives are sold at their own type and named everywhere else", () => {
	const refinery = stationEquipmentScreen({ type: "refinery", displayTL: 9 });
	expect(refinery.available.map((e) => e.name)).toContain("Fuel Scoops");
	expect(refinery.available.map((e) => e.name)).toContain("Mining Laser");
	expect(refinery.unavailable.map((e) => e.reason)).toContain("shipyards only");

	const shipyard = stationEquipmentScreen({ type: "shipyard", displayTL: 11 });
	expect(shipyard.available.map((e) => e.name)).toContain("Military Laser");
	expect(shipyard.unavailable.map((e) => e.reason)).toContain(
		"refineries only",
	);
	// Saturated: every universal item is on the shelf. Asserted as the positive,
	// because the negative it replaced — no reason reads "requires TL 10" —
	// names a string `requiredDisplayTL` maxes out below and so cannot fail.
	expect(shipyard.available.map((e) => e.name)).toEqual([
		...ECONOMY_TRADE_7,
		"Extra Energy Unit",
		"Military Laser",
		"Identity Scanner",
	]);
	expect(
		shipyard.unavailable.filter((e) => e.reason.startsWith("requires TL")),
	).toEqual([]);
});

test("§8.3: the hull section exists at a shipyard and is empty until #26", () => {
	expect(
		stationEquipmentScreen({ type: "shipyard", displayTL: 11 }).hullsSection,
	).toBe(true);
	expect(
		stationEquipmentScreen({ type: "shipyard", displayTL: 11 }).hulls,
	).toEqual([]);
	expect(
		stationEquipmentScreen({ type: "trade", displayTL: 11 }).hullsSection,
	).toBe(false);
});

// ---------------------------------------------------------------------------
// M4 and M10 — the two negatives, as laws rather than as pixels
// ---------------------------------------------------------------------------

test("M4: the console is not up during the arrival", () => {
	expect(stationConsoleVisible("arriving")).toBe(false);
	expect(stationConsoleVisible("docked")).toBe(true);
});

test("M10: the persistent flight floor is hidden the moment flight is suspended", () => {
	expect(flightFloorVisible("flying")).toBe(true);
	expect(flightFloorVisible("arriving")).toBe(false);
	expect(flightFloorVisible("docked")).toBe(false);
});

test("the traversal bounds here are the ones docking.md ratified", () => {
	// Not a tautology, and **anchored to the section rather than to the file**:
	// a whole-file `toContain` would stay green on a retune that changed the
	// bounds while any other sentence still carried the phrase.
	const prose = readFileSync(
		new URL("../docs/specs/docking.md", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	// §13.3 re-fixed E3's band, so the ratified figures are read from there.
	const start = prose.indexOf(
		"**Traversal duration scales with route length**",
	);
	const end = prose.indexOf(
		"**Both traversals are unconditionally skippable.**",
	);
	// **Both** indices guarded, not only the first. With the closing sentence
	// renamed, `indexOf` returns -1 and `slice(start, -1)` yields everything to
	// the end of the file — restoring exactly the whole-file match this slice
	// exists to close, on a green test.
	expect(start).toBeGreaterThan(0);
	expect(end).toBeGreaterThan(start);
	const e3 = prose.slice(start, end);
	expect(e3.length).toBeGreaterThan(100);
	expect(e3).toContain("about six seconds for a near");
	expect(e3).toContain("nine seconds for a deep");
	expect(TRAVERSAL_SECONDS_NEAR).toBe(6);
	expect(TRAVERSAL_SECONDS_DEEP).toBe(9);
});

test("M6: a delta that rounds to zero gets no arrow", () => {
	// **Measured on `signed` itself**, because the gallery's own moved row is
	// well above §3's floor and therefore cannot produce the case. The first
	// version of this test rendered the default view and asserted the absence of
	// "↑0.0" — which held on a build that emitted it, since no row could.
	expect(signedDelta(0.04, 1)).toBe("·0.0");
	expect(signedDelta(-0.04, 1)).toBe("·0.0");
	expect(signedDelta(0, 1)).toBe("·0.0");
	expect(signedDelta(-0, 0)).toBe("·0");
	// And the two live cases keep their arrows, or the rule above would be a
	// screen with no deltas on it at all.
	expect(signedDelta(4.83, 1)).toBe("↑4.8");
	expect(signedDelta(-12, 0)).toBe("↓12");
});

test("#182: the screen's prices follow the flown hold, bay included", () => {
	// **The rendered consequence of §5.2's change, covered headlessly.**
	// `main.ts` feeds `stationMarketScreen` the flown hold through
	// `commanderHold(...).capacityT`, so a Large Cargo Bay changes what a marked
	// station *draws* — and nothing else in this repo asserts that pair. The
	// browser tier is where the wiring itself is checked; what is checkable here
	// is that the two functions `main.ts` composes disagree in the direction the
	// spec says.
	const good = priceyGood(TRADE);
	const bare = newCommander(PLAYER_BASELINE_HULL);
	const withBay = {
		...bare,
		ownedEquipment: ["Large Cargo Bay"],
	};
	expect(commanderHold(bare).capacityT).toBe(HOLD_REFERENCE_T);
	expect(commanderHold(withBay).capacityT).toBe(
		HOLD_REFERENCE_T + LARGE_CARGO_BAY_BONUS_T,
	);
	const priceAt = (holdT: number) => {
		const row = stationMarketScreen({
			station: TRADE,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: moved(good.name, 12),
			holdT,
			displayTL: SCREEN_TL,
		}).find((r) => r.commodity.name === good.name);
		if (!row) throw new Error("the moved good is not on the screen");
		return row.buyCr as number;
	};
	// A bigger hold divides the same mark by more, so the same 12 t deficit moves
	// the price less — the response is scale-free in the hold since #182.
	expect(priceAt(commanderHold(withBay).capacityT)).toBeLessThan(
		priceAt(commanderHold(bare).capacityT),
	);
	// …and with no mark at all the hold makes no difference, which is what stops
	// the row above passing on a build that simply scaled every price by hold.
	const unmarked = (holdT: number) =>
		(
			stationMarketScreen({
				station: TRADE,
				economy: ECONOMY,
				gameTimeMin: 0,
				deficitOf: noDeficit,
				holdT,
				displayTL: SCREEN_TL,
			}).find((r) => r.commodity.name === good.name) as { buyCr: number }
		).buyCr;
	expect(unmarked(20)).toBe(unmarked(60));
});

/**
 * §8's price column, and the row the principal found in playtest.
 *
 * A refinery listed Food at **`0 Cr`** and charged 0.4. `live-cockpit.ts`
 * rendered the price with `Math.round`, while `station-commerce.ts` charges the
 * unrounded `priceCr * quantity` — so a hundred tonnes of "free" Food cost
 * 40 Cr.
 *
 * The floor is ordinary rather than an edge: `PRICE_STEP_CR` is enforced twice,
 * by `marketRowAt` and again by `stockResponse`, so no shelf price in the game
 * can be below it — and a refinery is industrial while Food has a positive
 * gradient, which puts Food there on the floor at a whole station role.
 *
 * **The formatter is here rather than in the renderer** so a headless tier can
 * hold it at all. That is what the defect turned on: the tests read `priceCr`
 * and nothing read the string the player sees.
 */
describe("the price column says what the player is charged", () => {
	test("the cheapest possible row does not read as free", () => {
		// The floor, not a literal: this is the row that shipped as `0 Cr`.
		expect(priceLabel(PRICE_STEP_CR)).toBe("0.4 Cr");
		expect(priceLabel(PRICE_STEP_CR)).not.toContain("0 Cr");
	});

	test("a whole-credit render loses every base price, not only the floor", () => {
		// The argument for one decimal beyond the floor case. A base price is
		// `closedPrice × PRICE_STEP_CR + offset × gradient × PRICE_STEP_CR`, so
		// **every base price is a multiple of 0.4** and no whole number can
		// represent one exactly. Rounding is lossy on every row.
		for (const steps of [1, 2, 3, 7, 34]) {
			const priceCr = steps * PRICE_STEP_CR;
			expect([steps, priceLabel(priceCr)]).toEqual([
				steps,
				`${priceCr.toFixed(1)} Cr`,
			]);
		}
	});

	test("it agrees with the two figures drawn beside it", () => {
		// The credits line renders `toFixed(1)` and the delta column asks
		// `signedDelta(..., 1)`. The price column was the only one of the three
		// rounding to whole credits, which is how it read as free next to a
		// delta that did not.
		expect(priceLabel(12.6)).toBe("12.6 Cr");
		expect(signedDelta(0.4, 1)).toBe("↑0.4");
	});
});

// ---------------------------------------------------------------------------
// §5.6 — the row carries two prices, and the cut is the tech level's
// ---------------------------------------------------------------------------

describe("§5.6 the market row shows what the station pays as well as what it asks", () => {
	/** One row, at one tech level, with no mark on the market. */
	const rowAt = (name: string, displayTL: number, station = TRADE) => {
		const rows = stationMarketScreen({
			station,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: noDeficit,
			holdT: HOLD_REFERENCE_T,
			displayTL,
		});
		const row = rows.find((r) => r.commodity.name === name);
		if (!row) throw new Error(`${name} is not on the screen`);
		return row;
	};

	test("the two columns are the market price and that price less the cut", () => {
		const good = priceyGood(TRADE);
		const row = rowAt(good.name, SCREEN_TL);
		const mid = marketRow(good, ECONOMY, TRADE, 0).priceCr;
		// The buy column is the market's own figure, unchanged — #191 D1's
		// asymmetry, and the cheapest closure measured.
		// Both sides of the pair are quotes, and the row says so rather than
		// asserting the product: a quote is the figure on the glass, so the expected
		// number has to pass through the same tenth-credit step the law applies.
		expect(row.buyCr).toBe(quantizeToDisplayStepCr(mid));
		expect(row.sellCr).toBe(
			quantizeToDisplayStepCr(
				Math.max(PRICE_STEP_CR, mid * (1 - bidCutAtTl(SCREEN_TL))),
			),
		);
		// And they are two numbers rather than one printed twice, which is what
		// makes the spread a thing the commander reads (#191 D3).
		expect(row.sellCr).toBeLessThan(row.buyCr as number);
	});

	test("a frontier station cuts less than a core one, at the same console", () => {
		// The direction #191 D4 handed to a measurement, asserted where the player
		// sees it. A row the floor pins would read equal in both, so this uses the
		// good `priceyGood` exists to find.
		const good = priceyGood(TRADE);
		expect(rowAt(good.name, DISPLAY_TL_MIN).sellCr).toBeGreaterThan(
			rowAt(good.name, DISPLAY_TL_MAX).sellCr as number,
		);
	});

	test("both columns survive the floor as numbers, never as a rounded whole", () => {
		// #193's obligation, widened to the column it did not cover: a base price
		// is a multiple of `PRICE_STEP_CR` and a cut of one is a multiple of
		// nothing, so the SELL column is the one most likely to be rendered as a
		// tidy figure that no till would honour.
		for (const displayTL of [DISPLAY_TL_MIN, SCREEN_TL, DISPLAY_TL_MAX])
			for (const good of COMMODITIES) {
				if (!listsCommodity(good, FENCE)) continue;
				const row = rowAt(good.name, displayTL, FENCE);
				for (const value of [row.buyCr, row.sellCr]) {
					if (value === undefined) continue;
					expect(value).toBeGreaterThanOrEqual(PRICE_STEP_CR);
					expect(priceLabel(value)).toMatch(/\d\.\d Cr$/);
				}
			}
	});

	// The screen-vs-till contract is held in `station-commerce.test.ts` §5.6, at the
	// console where the deficit and the printed label are checked beside the till. It
	// lived here too, as a second copy of the same three-tech-level round trip, and a
	// change to that contract meant editing two files.
});
