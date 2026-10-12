/**
 * Fuel tanks add carried fuel, not jump range (#926, #873 R1).
 *
 * A fitted tank raises what the ship buys, carries and shows by its `fuelLy`;
 * the longest single jump stays the hull's `tankLy`. Two readers, one per
 * quantity: `commanderFuelCapacityLy` (the tank) and `commanderJumpRangeLy`
 * (the drive). Both rest on `fittedCapacity`, the one capacity projection.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateGalaxy, startSystem, type SystemRecord } from "../src/galaxy";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { planJump } from "../src/hyperspace";
import { TOP_RUNGS } from "../src/ladder";
import {
	fittedCapacity,
	type Loadout,
	makeModule,
	stockLoadout,
} from "../src/loadout";
import { FUEL_CR_PER_LY, marketStationOf } from "../src/market";
import { fitReadout, outfittingScreen } from "../src/outfitting";
import { carrierKey } from "../src/carrier-key";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import {
	type CommanderState,
	type StationCommerceInput,
	commanderFuelCapacityLy,
	commanderJumpRangeLy,
	newCommander,
	transactAtStation,
} from "../src/station-commerce";
import { newWorld } from "../src/world-state";

const COURIER_TANK_LY = HULL_SPECS.courier.tankLy;
/** The 1E tank's `fuelLy` — read off the catalogue, not restated. */
const TANK_1E = makeModule("fuel-tank", 1, "E");
const withTank = (fuelLy: number, credits = 1_000): CommanderState => {
	const c = newCommander("courier");
	return {
		...c,
		credits,
		fuelLy,
		loadout: { ...c.loadout, i1: TANK_1E } as Loadout,
	};
};

const STATION = marketStationOf(
	{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
	0x926,
);
const input = (
	over: Partial<StationCommerceInput> = {},
): StationCommerceInput => ({
	commander: withTank(0),
	deficits: {},
	station: STATION,
	stationKey: carrierKey(0, "station-trade"),
	economy: 3,
	gameTimeMin: 0,
	displayTL: 10,
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 1 }) as const,
	action: { type: "buy-fuel" },
	...over,
});

describe("the fixture is what it claims", () => {
	test("the courier's tank is 7 LY and a 1E tank adds 2", () => {
		expect(COURIER_TANK_LY).toBe(7);
		expect(fittedCapacity("courier", withTank(0).loadout).fuelCapacityLy).toBe(
			9,
		);
	});
});

describe("two readers: capacity and range", () => {
	test("a ship with no tank holds its hull's tankLy, so stock ships are unchanged", () => {
		for (const id of HULL_IDS) {
			expect([id, fittedCapacity(id, stockLoadout(id)).fuelCapacityLy]).toEqual(
				[id, HULL_SPECS[id].tankLy],
			);
			const c = newCommander(id);
			expect([id, commanderFuelCapacityLy(c)]).toEqual([
				id,
				HULL_SPECS[id].tankLy,
			]);
			expect(c.fuelLy).toBe(HULL_SPECS[id].tankLy);
		}
	});

	test("a tank raises capacity and leaves the jump range on the hull", () => {
		const c = withTank(9);
		expect(commanderFuelCapacityLy(c)).toBe(9);
		expect(commanderJumpRangeLy(c)).toBe(COURIER_TANK_LY);
	});
});

describe("buy-fuel fills to capacity", () => {
	test("an empty courier with a 1E tank buys 9 LY and pays 9 × FUEL_CR_PER_LY", () => {
		const out = transactAtStation(input());
		expect(out.accepted).toBe(true);
		expect(out.commander.fuelLy).toBe(9);
		expect(1_000 - out.commander.credits).toBeCloseTo(9 * FUEL_CR_PER_LY, 10);
	});

	test("full at 9 LY, a purchase is refused fuel-full", () => {
		const out = transactAtStation(input({ commander: withTank(9) }));
		expect(out.accepted).toBe(false);
		expect(out.reason).toBe("fuel-full");
		expect(out.commander.fuelLy).toBe(9);
	});
});

describe("a loadout change clamps fuel to the new capacity", () => {
	test("removing the tank from a full ship is accepted and fuel clamps to 7", () => {
		const out = transactAtStation(
			input({
				commander: withTank(9),
				action: { type: "remove-module", slot: "i1" },
			}),
		);
		expect(out.accepted).toBe(true);
		expect(out.commander.loadout.i1).toBeUndefined();
		expect(out.commander.fuelLy).toBe(COURIER_TANK_LY);
	});

	test("removing it from a ship holding less than the hull's tank leaves fuel alone", () => {
		const out = transactAtStation(
			input({
				commander: withTank(5),
				action: { type: "remove-module", slot: "i1" },
			}),
		);
		expect(out.accepted).toBe(true);
		expect(out.commander.fuelLy).toBe(5);
	});

	test("replacing the tank with a cargo rack clamps fuel too", () => {
		const out = transactAtStation(
			input({
				commander: withTank(9),
				action: {
					type: "buy-module",
					slot: "i1",
					module: makeModule("cargo-rack", 1, "E"),
				},
			}),
		);
		expect(out.accepted).toBe(true);
		expect(out.commander.loadout.i1?.module).toBe("cargo-rack");
		expect(out.commander.fuelLy).toBe(COURIER_TANK_LY);
	});
});

describe("planJump keeps the hull's range", () => {
	const HOME = startSystem(generateGalaxy(20260902, 0));
	/** Records on one axis, so each leg is an exact distance. */
	const at = (index: number, x: number): SystemRecord => ({
		...HOME,
		index,
		pos: { x, y: 0, z: 0 },
	});
	const A = at(900, 0);
	const B = at(901, 4.5);
	const C = at(902, 9);
	const EIGHT = at(903, 8);

	test("with 9 LY aboard, a system 8 LY away is refused out-of-range", () => {
		const d = planJump(A, EIGHT, 9, "courier");
		expect(d).toEqual({ ok: false, refusal: "out-of-range" });
	});

	test("two jumps of 4.5 LY in a row succeed without a dock", () => {
		const first = planJump(A, B, 9, "courier");
		if (!first.ok) throw new Error(`refused: ${first.refusal}`);
		expect(first.plan.fuelLeftLy).toBe(4.5);
		const second = planJump(B, C, first.plan.fuelLeftLy, "courier");
		if (!second.ok) throw new Error(`refused: ${second.refusal}`);
		expect(second.plan.fuelLeftLy).toBe(0);
	});
});

describe("the Equipment tab's readout", () => {
	test("a tank's preview shows the capacity change and an unchanged jump", () => {
		const i = input({ commander: withTank(7, 100_000) });
		i.commander = {
			...i.commander,
			loadout: stockLoadout("courier"),
		};
		const screen = outfittingScreen(i, "i1", "stock:fuel-tank/1/E");
		expect(screen.action).not.toBeNull();
		expect(screen.before.fuelCapacityLy).toBe(COURIER_TANK_LY);
		expect(screen.after?.fuelCapacityLy).toBe(9);
		expect(screen.before.jump).toBe(COURIER_TANK_LY);
		expect(screen.after?.jump).toBe(COURIER_TANK_LY);
	});

	test("fitReadout reads the two readers", () => {
		const c = withTank(9);
		expect(fitReadout(c, 0).fuelCapacityLy).toBe(commanderFuelCapacityLy(c));
		expect(fitReadout(c, 0).jump).toBe(commanderJumpRangeLy(c));
	});
});

describe("a save keeps the carried fuel", () => {
	const save = (state: CommanderState) => {
		const base = newCommanderRecord("courier", { permadeath: false });
		return parseSave(
			serializeSave({
				world: newWorld(0x926),
				commander: { ...base, state },
			}),
		);
	};

	test("a courier saved full at 9 LY with a tank loads at 9", () => {
		expect(save(withTank(9)).commander.state.fuelLy).toBe(9);
	});

	test("without the tank, 9 LY still clamps to the hull's 7", () => {
		const c = { ...withTank(9), loadout: stockLoadout("courier") };
		expect(save(c).commander.state.fuelLy).toBe(COURIER_TANK_LY);
	});
});

describe("main.ts reads range and capacity through separate readers", () => {
	const src = readFileSync("src/main.ts", "utf8");
	test("fuelCapacityLy is the capacity reader and jumpRangeLy the range one", () => {
		expect(src).toMatch(
			/get fuelCapacityLy\(\): number \{\s*return commanderFuelCapacityLy\(this\.commander\);/,
		);
		expect(src).toMatch(
			/get jumpRangeLy\(\): number \{\s*return commanderJumpRangeLy\(this\.commander\);/,
		);
	});
});

describe("a hull purchase clamps to the new hull's capacity", () => {
	const SHIPYARD = marketStationOf(
		{
			type: "shipyard",
			localCarrierId: "station-shipyard",
			blackMarket: false,
		},
		0x926,
	);
	const buy = (hull: "freighter" | "interceptor") =>
		transactAtStation(
			input({
				commander: withTank(9, 1_000_000),
				station: SHIPYARD,
				stationKey: carrierKey(0, "station-shipyard"),
				action: { type: "buy-hull", hull },
			}),
		);

	test("the tank moves across, so a freighter keeps 9 LY over its 7 LY hull", () => {
		const out = buy("freighter");
		expect(out.accepted).toBe(true);
		expect(HULL_SPECS.freighter.tankLy).toBe(7);
		expect(commanderFuelCapacityLy(out.commander)).toBe(9);
		expect(out.commander.fuelLy).toBe(9);
	});

	test("a smaller hull clamps to its tank plus the moved tank", () => {
		const out = buy("interceptor");
		expect(out.accepted).toBe(true);
		const capacity = HULL_SPECS.interceptor.tankLy + 2;
		expect(capacity).toBeLessThan(9);
		expect(commanderFuelCapacityLy(out.commander)).toBe(capacity);
		expect(out.commander.fuelLy).toBe(capacity);
	});
});
