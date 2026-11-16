import {
	migrateEquipment,
	equipmentNames,
	stockLoadout,
	moduleRow,
} from "../src/loadout";
import { TOP_RUNGS } from "../src/ladder";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	CARGO_COMMODITIES,
	COMMODITIES,
	type Commodity,
	DEFICIT_SATURATION_RUNS,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	EQUIPMENT,
	FUEL_CR_PER_LY,
	HOLD_REFERENCE_T,
	LONG_RANGE_SCANNER,
	type MarketStation,
	PRICE_STEP_CR,
	MARKET_PERIOD_MIN,
	QUANTITY_CAP,
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
import { codeOf } from "./lib/source-scan";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import {
	LARGE_CARGO_BAY_BONUS_T,
	commanderHold,
	newCommander,
} from "../src/station-commerce";
import {
	REFUSAL_REASONS,
	SHELF_MAX_MARK,
	SHELF_MAX_TITLE,
	type ConsoleMarketRow,
	flightFloorVisible,
	marketDisplayValues,
	refusalSentence,
	requiredDisplayTL,
	priceLabel,
	signedDelta,
	stationConsoleVisible,
	stationEquipmentScreen,
	marketDisplayChanged,
	stationMarketScreen,
	universalItemsAt,
} from "../src/station-console";

const ECONOMY = 3;
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

test("a market redraw is needed only when a printed row changes", () => {
	const before = stationMarketScreen({
		station: TRADE,
		economy: ECONOMY,
		gameTimeMin: 0,
		deficitOf: noDeficit,
		holdT: HOLD_REFERENCE_T,
		cargo: {},
		displayTL: SCREEN_TL,
	});
	const unchanged = before.map((row) => ({ ...row }));
	expect(marketDisplayChanged(before, unchanged)).toBe(false);
	const food = before.findIndex((row) => row.commodity.name === "Food");
	expect(food).toBeGreaterThanOrEqual(0);
	const thinner = unchanged.map((row, index) =>
		index === food ? { ...row, quantity: (row.quantity ?? 0) - 1 } : row,
	);
	expect(marketDisplayChanged(before, thinner)).toBe(true);
	const dearer = unchanged.map((row, index) =>
		index === food ? { ...row, buyCr: (row.buyCr ?? 0) + 0.1 } : row,
	);
	expect(marketDisplayChanged(before, dearer)).toBe(true);
	const subDigit = unchanged.map((row, index) =>
		index === food ? { ...row, buyCr: (row.buyCr ?? 0) + 0.001 } : row,
	);
	expect(marketDisplayChanged(before, subDigit)).toBe(false);
});

test("obligation 3: the builder calls marketRow only where listsCommodity is true", () => {
	for (const station of [TRADE, FENCE]) {
		const asked: string[] = [];
		stationMarketScreen(
			{
				station,
				economy: ECONOMY,
				gameTimeMin: 0,
				deficitOf: noDeficit,
				holdT: HOLD_REFERENCE_T,
				cargo: {},
				displayTL: SCREEN_TL,
			},
			(commodity, economy, s, gameTimeMin) => {
				asked.push(commodity.name);
				return marketRow(commodity, economy, s, gameTimeMin);
			},
		);
		const listed = CARGO_COMMODITIES.filter((c) =>
			listsCommodity(c, station),
		).map((c) => c.name);
		expect(asked).toEqual(listed);
	}
});

test("obligation 3: a non-fence station is the case that separates the builds", () => {
	const tradeListed = CARGO_COMMODITIES.filter((c) => listsCommodity(c, TRADE));
	const fenceListed = CARGO_COMMODITIES.filter((c) => listsCommodity(c, FENCE));
	expect(tradeListed.length).toBe(29);
	expect(fenceListed.length).toBe(32);
	expect(tradeListed.length).toBeLessThan(fenceListed.length);
});

test("M5: a row for every good at every station, priced iff the station lists it", () => {
	for (const station of [TRADE, FENCE]) {
		const rows = stationMarketScreen({
			station,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: noDeficit,
			holdT: HOLD_REFERENCE_T,
			cargo: {},
			displayTL: SCREEN_TL,
		});
		expect(rows.length).toBe(CARGO_COMMODITIES.length);
		expect(rows.map((r) => r.commodity.name)).toEqual(
			CARGO_COMMODITIES.map((c) => c.name),
		);
		for (const row of rows) {
			expect(row.listed).toBe(listsCommodity(row.commodity, station));
			expect(row.buyCr !== undefined).toBe(row.listed);
			expect(row.sellCr !== undefined).toBe(row.listed);
			expect(row.quantity !== undefined).toBe(row.listed);
		}
	}
});

const moved = (goodName: string, units: number) => (name: string) =>
	name === goodName ? units : 0;

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
		cargo: {},
		displayTL: SCREEN_TL,
	});
	const movedRow = rows.find((r) => r.commodity.name === good.name);
	if (!movedRow) throw new Error("the moved good is not on the screen");
	expect(movedRow.priceDeltaCr).toBeDefined();
	expect(movedRow.quantityDelta).toBeDefined();
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
	const twoEpochs = [0, MARKET_PERIOD_MIN * 3];
	for (const gameTimeMin of twoEpochs) {
		const base = marketRow(good, ECONOMY, TRADE, gameTimeMin);
		const rows = stationMarketScreen({
			station: TRADE,
			economy: ECONOMY,
			gameTimeMin,
			deficitOf: moved(good.name, 12),
			holdT: HOLD_REFERENCE_T,
			cargo: {},
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
	const [firstEpochBase, laterEpochBase] = twoEpochs.map(
		(t) => marketRow(good, ECONOMY, TRADE, t).priceCr,
	);
	expect(firstEpochBase).not.toBeCloseTo(laterEpochBase, 6);
});

const UNIVERSAL_ORDER_FROM_SPEC = (() => {
	const spec = readFileSync(
		new URL("../docs/specs/economy-trade.md", import.meta.url),
		"utf8",
	);
	const names: string[] = [];
	for (const line of spec.split("\n")) {
		const cells = line.split("|").map((cell) => cell.trim());
		const isUniversalTableRow = cells.length === 5 && cells[3] === "universal";
		if (!isUniversalTableRow) continue;
		const withoutParenthetical = cells[1].replace(/\s*\(.*\)$/, "");
		names.push(withoutParenthetical);
	}
	return names;
})();

test("the §7 order this file checks against was read out of the spec", () => {
	expect(UNIVERSAL_ORDER_FROM_SPEC.length).toBe(10);
	expect(UNIVERSAL_ORDER_FROM_SPEC[0]).toBe("Fuel");
	expect(UNIVERSAL_ORDER_FROM_SPEC.at(-1)).toBe("Galactic Hyperdrive");
});

test("obligation 8: Fuel is the first universal item and the one absent from EQUIPMENT", () => {
	expect(UNIVERSAL_ITEMS.map((e) => e.name)).toEqual(UNIVERSAL_ORDER_FROM_SPEC);
	expect(UNIVERSAL_ITEMS.length).toBe(UNIVERSAL_GATE_CAP);
	expect(EQUIPMENT.some((e) => e.name === "Fuel")).toBe(false);
	expect(EQUIPMENT.filter((e) => e.scope === "universal").length).toBe(9);
	const fuel = UNIVERSAL_ITEMS[0];
	expect(fuel.per).toBe("ly");
	expect(fuel.priceCr).toBe(FUEL_CR_PER_LY);
});

test("obligation 8: the universal set at displayTL d is §7's order truncated to min(d + 3, 10)", () => {
	for (let d = 0; d <= 12; d += 1) {
		const expected = UNIVERSAL_ORDER_FROM_SPEC.slice(0, Math.min(d + 3, 10));
		expect(universalItemsAt(d).map((e) => e.name)).toEqual(expected);
		expect(new Set(universalItemsAt(d).map((e) => e.name))).toEqual(
			new Set(expected),
		);
	}
});

test("obligation 8: the slice off EQUIPMENT is the trap, and it differs at every d", () => {
	const universalRows = EQUIPMENT.filter((e) => e.scope === "universal");
	for (let d = 0; d <= 12; d += 1) {
		const buggy = universalRows
			.slice(0, Math.min(d + 3, 10))
			.map((e) => e.name);
		const correct = universalItemsAt(d).map((e) => e.name);
		expect(new Set(buggy)).not.toEqual(new Set(correct));
		expect(buggy).not.toContain("Fuel");
		if (d <= 6) expect(buggy.length).toBe(correct.length);
		else expect(buggy.length).toBe(9);
	}
});

test("obligation 8: the gate puts the galactic hyperdrive at displayTL 7", () => {
	expect(requiredDisplayTL(9)).toBe(7);
	expect(universalItemsAt(6).map((e) => e.name)).not.toContain(
		"Galactic Hyperdrive",
	);
	expect(universalItemsAt(7).map((e) => e.name)).toContain(
		"Galactic Hyperdrive",
	);
});

test("obligation 6: a low-TL trade station lists what it sells and names what it does not", () => {
	const screen = stationEquipmentScreen({
		type: "trade",
		displayTL: 4,
		rungs: TOP_RUNGS,
	});
	expect(screen.available.length).toBeGreaterThan(0);
	expect(screen.unavailable.length).toBeGreaterThan(0);
	for (const entry of screen.unavailable) {
		expect(entry.reason.length).toBeGreaterThan(0);
		expect(entry.name.length).toBeGreaterThan(0);
	}
	const reasons = new Set(screen.unavailable.map((e) => e.reason));
	expect(reasons).toContain("requires TL 7");
	expect(reasons).toContain("refineries only");
	expect(reasons).toContain("shipyards only");
	const shown = [
		...screen.available.map((e) => e.name),
		...screen.unavailable.map((e) => e.name),
	];
	expect(new Set(shown).size).toBe(shown.length);
	expect(new Set(shown)).toEqual(
		new Set([
			...UNIVERSAL_ORDER_FROM_SPEC,
			...EQUIPMENT.filter((e) => e.scope !== "universal").map((e) => e.name),
		]),
	);
});

test("obligation 6: type exclusives are sold at their own type and named everywhere else", () => {
	const refinery = stationEquipmentScreen({
		type: "refinery",
		displayTL: 9,
		rungs: TOP_RUNGS,
	});
	expect(refinery.available.map((e) => e.name)).toContain("Fuel Scoops");
	expect(refinery.available.map((e) => e.name)).toContain("Mining Laser");
	expect(refinery.unavailable.map((e) => e.reason)).toContain("shipyards only");

	const shipyard = stationEquipmentScreen({
		type: "shipyard",
		displayTL: 11,
		rungs: TOP_RUNGS,
	});
	expect(shipyard.available.map((e) => e.name)).toContain("Military Laser");
	expect(shipyard.unavailable.map((e) => e.reason)).toContain(
		"refineries only",
	);
	expect(shipyard.available.map((e) => e.name)).toEqual([
		...UNIVERSAL_ORDER_FROM_SPEC,
		"Mining Laser",
		"Extra Energy Unit",
		"Military Laser",
		"Identity Scanner",
		"Long-Range Scanner",
	]);
	expect(
		shipyard.unavailable.filter((e) => e.reason.startsWith("requires TL")),
	).toEqual([]);

	const trade = stationEquipmentScreen({
		type: "trade",
		displayTL: 11,
		rungs: TOP_RUNGS,
	});
	for (const screen of [refinery, trade]) {
		expect(screen.available.map((e) => e.name)).not.toContain(
			LONG_RANGE_SCANNER,
		);
		expect(
			screen.unavailable.find((e) => e.name === LONG_RANGE_SCANNER)?.reason,
		).toBe("shipyards only");
	}
});

test("§8.3 as #556 D1 amends it: the Equipment tab carries no hull heading", () => {
	expect(
		Object.keys(
			stationEquipmentScreen({
				type: "shipyard",
				displayTL: 11,
				rungs: TOP_RUNGS,
			}),
		).sort(),
	).toEqual(["available", "unavailable"]);
});

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
	const prose = readFileSync(
		new URL("../docs/specs/docking.md", import.meta.url),
		"utf8",
	).replace(/\s+/g, " ");
	const sectionStart = prose.indexOf(
		"**Traversal duration scales with route length**",
	);
	const sectionEnd = prose.indexOf(
		"**Both traversals are unconditionally skippable.**",
	);
	expect(sectionStart).toBeGreaterThan(0);
	expect(sectionEnd).toBeGreaterThan(sectionStart);
	const traversalSection = prose.slice(sectionStart, sectionEnd);
	expect(traversalSection.length).toBeGreaterThan(100);
	expect(traversalSection).toContain("about six seconds for a near");
	expect(traversalSection).toContain("nine seconds for a deep");
	expect(TRAVERSAL_SECONDS_NEAR).toBe(6);
	expect(TRAVERSAL_SECONDS_DEEP).toBe(9);
});

test("M6: a delta that rounds to zero gets no arrow", () => {
	expect(signedDelta(0.04, 1)).toBe("·0.0");
	expect(signedDelta(-0.04, 1)).toBe("·0.0");
	expect(signedDelta(0, 1)).toBe("·0.0");
	expect(signedDelta(-0, 0)).toBe("·0");
	expect(signedDelta(4.83, 1)).toBe("↑4.8");
	expect(signedDelta(-12, 0)).toBe("↓12");
});

test("#182: the screen's prices follow the flown hold, bay included", () => {
	const good = priceyGood(TRADE);
	const bare = newCommander(PLAYER_BASELINE_HULL);
	const withBay = {
		...bare,
		loadout: migrateEquipment("courier", ["Large Cargo Bay"]).loadout,
	};
	expect(commanderHold(bare, 0).capacityT).toBe(HOLD_REFERENCE_T);
	expect(commanderHold(withBay, 0).capacityT).toBe(
		HOLD_REFERENCE_T + LARGE_CARGO_BAY_BONUS_T,
	);
	const priceAt = (holdT: number) => {
		const row = stationMarketScreen({
			station: TRADE,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: moved(good.name, 12),
			holdT,
			cargo: {},
			displayTL: SCREEN_TL,
		}).find((r) => r.commodity.name === good.name);
		if (!row) throw new Error("the moved good is not on the screen");
		return row.buyCr as number;
	};
	expect(priceAt(commanderHold(withBay, 0).capacityT)).toBeLessThan(
		priceAt(commanderHold(bare, 0).capacityT),
	);
	const unmarkedPriceAt = (holdT: number) =>
		(
			stationMarketScreen({
				station: TRADE,
				economy: ECONOMY,
				gameTimeMin: 0,
				deficitOf: noDeficit,
				holdT,
				cargo: {},
				displayTL: SCREEN_TL,
			}).find((r) => r.commodity.name === good.name) as { buyCr: number }
		).buyCr;
	expect(unmarkedPriceAt(20)).toBe(unmarkedPriceAt(60));
});

describe("the price column says what the player is charged", () => {
	test("the cheapest possible row does not read as free", () => {
		expect(priceLabel(PRICE_STEP_CR)).toBe("0.4 Cr");
		expect(priceLabel(PRICE_STEP_CR)).not.toContain("0 Cr");
	});

	test("a whole-credit render loses every base price, not only the floor", () => {
		for (const steps of [1, 2, 3, 7, 34]) {
			const priceCr = steps * PRICE_STEP_CR;
			expect([steps, priceLabel(priceCr)]).toEqual([
				steps,
				`${priceCr.toFixed(1)} Cr`,
			]);
		}
	});

	test("it agrees with the two figures drawn beside it", () => {
		expect(priceLabel(12.6)).toBe("12.6 Cr");
		expect(signedDelta(0.4, 1)).toBe("↑0.4");
	});
});

describe("§5.6 the market row shows what the station pays as well as what it asks", () => {
	const rowAt = (name: string, displayTL: number, station = TRADE) => {
		const rows = stationMarketScreen({
			station,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf: noDeficit,
			holdT: HOLD_REFERENCE_T,
			cargo: {},
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
		expect(row.buyCr).toBe(quantizeToDisplayStepCr(mid));
		expect(row.sellCr).toBe(
			quantizeToDisplayStepCr(
				Math.max(PRICE_STEP_CR, mid * (1 - bidCutAtTl(SCREEN_TL))),
			),
		);
		expect(row.sellCr).toBeLessThan(row.buyCr as number);
	});

	test("a frontier station cuts less than a core one, at the same console", () => {
		const good = priceyGood(TRADE);
		expect(rowAt(good.name, DISPLAY_TL_MIN).sellCr).toBeGreaterThan(
			rowAt(good.name, DISPLAY_TL_MAX).sellCr as number,
		);
	});

	test("both columns survive the floor as numbers, never as a rounded whole", () => {
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
});

describe("#443 — every refusal has a sentence", () => {
	test("no member of the union is a sentence nothing can reach", () => {
		const source = codeOf("src/station-commerce.ts");
		const passed = [
			...source.matchAll(/rejected\(\s*input\s*,\s*"([^"]+)"/g),
		].map((m) => m[1]);
		expect(passed.length).toBeGreaterThan(8);
		const listed = new Set<string>(REFUSAL_REASONS);
		for (const reason of passed) expect(listed.has(reason), reason).toBe(true);
		expect([...new Set(passed)].sort()).toEqual([...listed].sort());
	});

	test("every member renders a sentence, and none of them is empty", () => {
		for (const reason of REFUSAL_REASONS) {
			const sentence = refusalSentence(reason, {
				freeT: 4,
				capacityT: 20,
				entrustedT: 8,
			});
			expect(sentence.length, reason).toBeGreaterThan(0);
			expect(sentence.endsWith("."), reason).toBe(true);
		}
	});

	test("`cargo-full` names the room that is missing and what is holding it", () => {
		expect(
			refusalSentence("cargo-full", {
				freeT: 11,
				capacityT: 20,
				entrustedT: 8,
			}),
		).toBe("No room — 11 t free of 20, with 8 t entrusted to a job.");
	});

	test("an over-capacity hold says so rather than reading as zero", () => {
		expect(
			refusalSentence("cargo-full", {
				freeT: -10,
				capacityT: 20,
				entrustedT: 8,
			}),
		).toBe("No room — -10 t free of 20, with 8 t entrusted to a job.");
	});

	test("with nothing entrusted the clause is absent, not zeroed", () => {
		expect(
			refusalSentence("cargo-full", {
				freeT: 0,
				capacityT: 35,
				entrustedT: 0,
			}),
		).toBe("No room — 0 t free of 35.");
	});
});

describe("a capped shelf reads MAX and every row says what is held (#473)", () => {
	const screen = (
		deficitOf: (name: string) => number,
		cargo: Readonly<Record<string, number>> = {},
	) =>
		stationMarketScreen({
			station: TRADE,
			economy: ECONOMY,
			gameTimeMin: 0,
			deficitOf,
			holdT: HOLD_REFERENCE_T,
			displayTL: SCREEN_TL,
			cargo,
		});
	const rowOf = (rows: readonly ConsoleMarketRow[], name: string) => {
		const row = rows.find((r) => r.commodity.name === name);
		if (!row) throw new Error(`no ${name} row`);
		return row;
	};

	test("the mark is keyed on the cap and nothing below it", () => {
		const food = rowOf(screen(noDeficit), "Food");
		expect(food.listed).toBe(true);
		const at = (quantity: number) => marketDisplayValues({ ...food, quantity });
		expect(at(QUANTITY_CAP).shelfMark).toBe(SHELF_MAX_MARK);
		expect(at(QUANTITY_CAP - 1).shelfMark).toBeNull();
		expect(at(0).shelfMark).toBeNull();
		expect(at(QUANTITY_CAP).shelf).toBe(
			`${QUANTITY_CAP} ${food.commodity.unit}`,
		);
		expect(SHELF_MAX_MARK).toBe("MAX");
	});

	test("Gold, untraded, shows MAX — its generated shelf is always the cap", () => {
		const gold = rowOf(screen(noDeficit), "Gold");
		expect(gold.listed).toBe(true);
		expect(gold.quantity).toBe(QUANTITY_CAP);
		expect(gold.quantityDelta).toBeUndefined();
		const shown = marketDisplayValues(gold);
		expect(shown.shelf).toBe(`${QUANTITY_CAP} kg`);
		expect(shown.shelfMark).toBe(SHELF_MAX_MARK);
	});

	test("a sale into a capped shelf keeps the mark", () => {
		const sold = rowOf(screen(moved("Gold", -5)), "Gold");
		expect(sold.listed).toBe(true);
		expect(sold.quantity).toBe(QUANTITY_CAP);
		expect(sold.quantityDelta).toBe(0);
		expect(marketDisplayValues(sold).shelfMark).toBe(SHELF_MAX_MARK);
	});

	test("a sale into a capped shelf lowers the price while the market is below saturation", () => {
		const before = rowOf(screen(noDeficit), "Gold");
		const sold = rowOf(screen(moved("Gold", -5)), "Gold");
		expect(before.listed && sold.listed).toBe(true);
		expect(before.quantity).toBe(QUANTITY_CAP);
		expect(sold.quantity).toBe(QUANTITY_CAP);
		expect(sold.buyCr as number).toBeLessThan(before.buyCr as number);
		expect(sold.sellCr as number).toBeLessThan(before.sellCr as number);
	});

	test("past saturation a sale into a capped shelf leaves the price where it was", () => {
		const saturated = -DEFICIT_SATURATION_RUNS * HOLD_REFERENCE_T;
		const at = rowOf(screen(moved("Gold", saturated)), "Gold");
		const past = rowOf(screen(moved("Gold", saturated - 1)), "Gold");
		expect(at.listed && past.listed).toBe(true);
		expect(at.quantity).toBe(QUANTITY_CAP);
		expect(past.quantity).toBe(QUANTITY_CAP);
		expect(marketDisplayValues(past).shelfMark).toBe(SHELF_MAX_MARK);
		expect(past.buyCr).toBe(at.buyCr as number);
		expect(past.sellCr).toBe(at.sellCr as number);
		const untouched = rowOf(screen(noDeficit), "Gold");
		expect(at.buyCr as number).toBeLessThan(untouched.buyCr as number);
	});

	test("an unlisted row carries no mark", () => {
		const illegal = COMMODITIES.find((c) => !listsCommodity(c, TRADE));
		if (!illegal) throw new Error("the trade station lists every good");
		expect(
			marketDisplayValues(rowOf(screen(noDeficit), illegal.name)).shelfMark,
		).toBeNull();
	});

	test("the hover text reads the cap off QUANTITY_CAP and says the station still buys", () => {
		expect(SHELF_MAX_TITLE).toBe(
			`Shelf at its ${QUANTITY_CAP}-unit limit. The station still buys; sales lower the price, down to a floor.`,
		);
		const source = readFileSync("src/station-console.ts", "utf8");
		const declaration = /export const SHELF_MAX_TITLE = `([^`]*)`/.exec(source);
		expect(declaration?.[1]).toContain("${QUANTITY_CAP}");
		expect(declaration?.[1]).not.toMatch(/\d/);
	});

	test("HELD is the carried units in the good's own unit, and blank when none", () => {
		const illegal = COMMODITIES.find((c) => !listsCommodity(c, TRADE));
		if (!illegal) throw new Error("the trade station lists every good");
		const rows = screen(noDeficit, { Food: 5, Gold: 3, [illegal.name]: 2 });
		expect(marketDisplayValues(rowOf(rows, "Food")).held).toBe("5 t");
		expect(marketDisplayValues(rowOf(rows, "Gold")).held).toBe("3 kg");
		const unlisted = rowOf(rows, illegal.name);
		expect(unlisted.listed).toBe(false);
		expect(marketDisplayValues(unlisted).held).toBe(`2 ${illegal.unit}`);
		expect(marketDisplayValues(rowOf(rows, "Textiles")).held).toBeNull();
		expect(rowOf(rows, "Textiles").held).toBe(0);
		expect(
			marketDisplayValues(rowOf(screen(noDeficit, { Food: 0 }), "Food")).held,
		).toBeNull();
	});

	test("a change in what is held redraws the market", () => {
		const before = screen(noDeficit);
		expect(marketDisplayChanged(before, screen(noDeficit, { Food: 1 }))).toBe(
			true,
		);
		expect(marketDisplayChanged(before, screen(noDeficit, {}))).toBe(false);
	});
});

test("the Mining Laser is listed at refineries and shipyards, and nowhere new (#1147, #920 D-D18)", () => {
	const listed = (type: "refinery" | "shipyard" | "trade") =>
		stationEquipmentScreen({ type, displayTL: 11, rungs: TOP_RUNGS })
			.available.map((e) => e.name)
			.filter((n) => n === "Mining Laser").length;
	expect(listed("shipyard")).toBe(1);
	expect(listed("refinery")).toBe(1);
	expect(listed("trade")).toBe(0);
	const shipyard = stationEquipmentScreen({
		type: "shipyard",
		displayTL: 11,
		rungs: TOP_RUNGS,
	});
	expect(shipyard.unavailable.map((e) => e.name)).not.toContain("Mining Laser");
	expect(
		shipyard.unavailable.find((e) => e.name === "Fuel Scoops")?.reason,
	).toBe("refineries only");
});
