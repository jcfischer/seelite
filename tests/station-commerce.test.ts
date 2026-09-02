import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { readDeficit } from "../src/deficits";
import { marketStationOf } from "../src/market";
import { HULL_SPECS, PLAYER_BASELINE_HULL } from "../src/hull";
import { JUMP_TANK_LY } from "../src/hyperspace";
import {
	STARTING_CREDITS,
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
	commander: newCommander(PLAYER_BASELINE_HULL),
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
		commander: { ...newCommander(PLAYER_BASELINE_HULL), credits: 0 },
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
		...newCommander(PLAYER_BASELINE_HULL),
		credits: 100_000,
		// The hull's hold, read off the roster: `STARTING_HOLD_T` was a second
		// copy of the courier's 20 t and is gone (#181).
		cargo: { Food: HULL_SPECS[PLAYER_BASELINE_HULL].holdT },
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
		commander: { ...newCommander(PLAYER_BASELINE_HULL), credits: 1_000 },
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

/**
 * §6.1's fuel, which had a price, a row on the equipment screen and no way to
 * buy it — the screen said "FUEL SYSTEM PENDING" where its action belongs
 * (#187).
 */
test("a full tank is refused as full, not as unaffordable", () => {
	const full = transactAtStation(input({ action: { type: "buy-fuel" } }));
	expect(full.accepted).toBe(false);
	expect(full.reason).toBe("fuel-full");
	// And nothing moved.
	expect(full.commander.credits).toBe(STARTING_CREDITS);
	expect(full.commander.fuelLy).toBe(JUMP_TANK_LY);
});

test("a full tank costs 14 Cr, which is §6.1's figure", () => {
	const empty = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 0 };
	const filled = transactAtStation(
		input({ commander: empty, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBe(JUMP_TANK_LY);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(14, 10);
});

test("a partial tank buys the shortfall and not a whole tank", () => {
	const half = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 4 };
	const filled = transactAtStation(
		input({ commander: half, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBe(JUMP_TANK_LY);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(6, 10);
});

test("short of credits buys what they cover rather than refusing", () => {
	// The anti-stranding half: a pilot with three credits and a dry tank needs
	// the 1.5 LY those buy more than they need a refusal.
	const broke = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: 0,
		credits: 3,
	};
	const filled = transactAtStation(
		input({ commander: broke, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBeCloseTo(1.5, 10);
	expect(filled.commander.credits).toBeCloseTo(0, 10);
});

test("no credits at all is refused as credits, not as a full tank", () => {
	const skint = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: 0,
		credits: 0,
	};
	const refused = transactAtStation(
		input({ commander: skint, action: { type: "buy-fuel" } }),
	);
	expect(refused.accepted).toBe(false);
	expect(refused.reason).toBe("insufficient-credits");
});

test("the tank never overfills, however many times it is topped up", () => {
	let commander = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 6.5 };
	for (let i = 0; i < 5; i++) {
		const next = transactAtStation(
			input({ commander, action: { type: "buy-fuel" } }),
		);
		commander = next.commander;
		expect(commander.fuelLy).toBeLessThanOrEqual(JUMP_TANK_LY);
	}
	expect(commander.fuelLy).toBe(JUMP_TANK_LY);
});

test("a fractional shortfall can be bought back, so the tank reaches 7.0 again", () => {
	// The defect this is written for: flooring the shortfall to §6.1's pricing
	// tenth left a residue no purchase could take, so a tank drained by a jump
	// of non-decimal distance — which is every jump — could never be refilled,
	// and the next attempt was refused as *insufficient credits* on a full purse.
	const afterAJump = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: JUMP_TANK_LY - 2.34,
	};
	const filled = transactAtStation(
		input({ commander: afterAJump, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBeCloseTo(JUMP_TANK_LY, 12);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(4.68, 12);

	// And a second press is refused as full rather than as money.
	const again = transactAtStation(
		input({ commander: filled.commander, action: { type: "buy-fuel" } }),
	);
	expect(again.accepted).toBe(false);
	expect(again.reason).toBe("fuel-full");
});
