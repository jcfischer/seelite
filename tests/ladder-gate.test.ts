/**
 * #564: the ladder gate on the Equipment tab and at the till (#183 D6, #562
 * D6-D7).
 *
 * A locked row lists, names its ladder and rung, and draws no BUY — the
 * #489/#508 locked-row pattern. The till refuses a locked item with its own
 * reason, and an item already owned stays owned: a gate blocks only new
 * purchases (#183 D9). The hull half of the gate is law only here; no screen
 * sells a hull until #556.
 */
import { describe, expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import { PLAYER_BASELINE_HULL } from "../src/hull";
import { marketStationOf } from "../src/market";
import { RUNG_NAMES, type Rungs, TOP_RUNGS, gateRefusal } from "../src/ladder";
import { newCommander, transactAtStation } from "../src/station-commerce";
import { stationEquipmentScreen } from "../src/station-console";

const START: Rungs = { combat: 0, trade: 0, exploration: 0 };

const buy = (equipment: string, rungs: Rungs, owned: string[] = []) =>
	transactAtStation({
		commander: {
			...newCommander(PLAYER_BASELINE_HULL),
			credits: 100_000,
			ownedEquipment: owned,
		},
		deficits: {},
		station: marketStationOf(
			{
				type: "shipyard",
				localCarrierId: "station-shipyard",
				blackMarket: false,
			},
			0x51a7_10,
		),
		stationKey: "1:station-shipyard" as CarrierKey,
		economy: 3,
		gameTimeMin: 0,
		displayTL: 11,
		entrustedT: 0,
		rungs,
		action: { type: "buy-equipment", equipment },
	});

describe("the Equipment tab's locked rows", () => {
	test("a gated item lists, locked, naming its ladder and rung", () => {
		const screen = stationEquipmentScreen({
			type: "shipyard",
			displayTL: 11,
			rungs: START,
		});
		const laser = screen.available.find((e) => e.name === "Military Laser");
		expect(laser?.locked).toEqual({
			ladder: "combat",
			rung: 6,
			name: RUNG_NAMES.combat[6],
		});
		const computer = screen.available.find(
			(e) => e.name === "Docking Computer",
		);
		expect(computer).toBeDefined();
		expect(computer?.locked).toBeUndefined();
	});

	test("the rung unlocks it", () => {
		const screen = stationEquipmentScreen({
			type: "shipyard",
			displayTL: 11,
			rungs: { ...START, combat: 6 },
		});
		const laser = screen.available.find((e) => e.name === "Military Laser");
		expect(laser?.locked).toBeUndefined();
	});

	test("Fuel is never gated", () => {
		const screen = stationEquipmentScreen({
			type: "trade",
			displayTL: 11,
			rungs: START,
		});
		expect(screen.available.find((e) => e.per === "ly")?.locked).toBeUndefined();
	});
});

describe("the till", () => {
	test("refuses a locked item and charges nothing", () => {
		const out = buy("Military Laser", START);
		expect(out).toMatchObject({ accepted: false, reason: "equipment-locked" });
		expect(out.commander.credits).toBe(100_000);
	});

	test("sells it at the rung", () => {
		expect(buy("Military Laser", { ...START, combat: 6 }).accepted).toBe(true);
	});

	test("the Docking Computer and the Long-Range Scanner sell at rung 0", () => {
		expect(buy("Docking Computer", START).accepted).toBe(true);
		expect(buy("Long-Range Scanner", START).accepted).toBe(true);
	});

	test("an owned gated item is already fitted, not locked", () => {
		expect(buy("Military Laser", START, ["Military Laser"])).toMatchObject({
			accepted: false,
			reason: "equipment-owned",
		});
	});

	test("TOP_RUNGS opens every gate", () => {
		expect(buy("Military Laser", TOP_RUNGS).accepted).toBe(true);
	});
});

describe("the hull gate, as law (#556 draws its row)", () => {
	test("a gated hull refuses below its rung with the ladder and rung", () => {
		expect(gateRefusal("freighter", START)).toEqual({
			ladder: "trade",
			rung: 5,
			name: RUNG_NAMES.trade[5],
		});
		expect(gateRefusal("freighter", { ...START, trade: 5 })).toBeNull();
		expect(gateRefusal("courier", START)).toBeNull();
	});
});
