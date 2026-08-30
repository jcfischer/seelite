import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { marketStationOf, readDeficit } from "../src/market";
import {
	STARTING_HOLD_T,
	newCommander,
	transactAtStation,
} from "../src/station-commerce";
import { newWorld, parseWorld, serializeWorld } from "../src/world-state";

const STATION = marketStationOf(
	{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
	0x51a7_10,
);
const KEY = carrierKey(0, "station-trade");

const input = (
	overrides: Partial<Parameters<typeof transactAtStation>[0]> = {},
) => ({
	commander: newCommander(),
	deficits: {},
	station: STATION,
	stationKey: KEY,
	economy: 3,
	gameTimeMin: 0,
	displayTL: 8,
	action: { type: "buy-commodity", commodity: "Food" } as const,
	...overrides,
});

test("a commodity buy atomically moves credits, cargo, and this station's deficit", () => {
	const before = input();
	const bought = transactAtStation(before);
	expect(bought.accepted).toBe(true);
	expect(bought.commander.credits).toBeLessThan(before.commander.credits);
	expect(bought.commander.cargo.Food).toBe(1);
	expect(readDeficit(bought.deficits, KEY, "Food", 0)).toBe(1);

	const sold = transactAtStation(
		input({
			commander: bought.commander,
			deficits: bought.deficits,
			action: { type: "sell-commodity", commodity: "Food" },
		}),
	);
	expect(sold.accepted).toBe(true);
	expect(sold.commander.cargo.Food).toBeUndefined();
	expect(readDeficit(sold.deficits, KEY, "Food", 0)).toBe(0);
});

test("rejected actions are atomic no-ops", () => {
	const before = input({
		commander: { ...newCommander(), credits: 0 },
	});
	const result = transactAtStation(before);
	expect(result).toMatchObject({
		accepted: false,
		reason: "insufficient-credits",
	});
	expect(result.commander).toBe(before.commander);
	expect(result.deficits).toBe(before.deficits);
});

test("tonne cargo observes the hold while sub-tonne goods bypass it", () => {
	const full = {
		...newCommander(),
		credits: 100_000,
		cargo: { Food: STARTING_HOLD_T },
	};
	expect(transactAtStation(input({ commander: full }))).toMatchObject({
		accepted: false,
		reason: "cargo-full",
	});
	expect(
		transactAtStation(
			input({
				commander: full,
				action: { type: "buy-commodity", commodity: "Gold" },
			}),
		).accepted,
	).toBe(true);
});

test("available equipment is charged once, then becomes owned and unavailable", () => {
	const before = input({
		commander: { ...newCommander(), credits: 1_000 },
		action: { type: "buy-equipment", equipment: "Large Cargo Bay" },
	});
	const bought = transactAtStation(before);
	expect(bought).toMatchObject({ accepted: true });
	expect(bought.commander.credits).toBe(600);
	expect(bought.commander.ownedEquipment).toContain("Large Cargo Bay");
	const again = transactAtStation(
		input({
			commander: bought.commander,
			action: { type: "buy-equipment", equipment: "Large Cargo Bay" },
		}),
	);
	expect(again).toMatchObject({ accepted: false, reason: "equipment-owned" });
});

test("a transaction deficit survives the existing world-state serialization boundary", () => {
	const bought = transactAtStation(input());
	if (!bought.accepted) throw new Error("fixture buy was rejected");
	const world = newWorld(0x51a7_10);
	world.galaxies[0] = { ...world.galaxies[0], deficits: bought.deficits };
	const restored = parseWorld(serializeWorld(world));
	expect(readDeficit(restored.galaxies[0].deficits, KEY, "Food", 0)).toBe(1);
});
