import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { TOP_RUNGS } from "../src/ladder";
import { emptyLadderRecord, ladderAfterMarket } from "../src/ladder";
import { moduleGate } from "../src/module-stock";
import { parseModule, carriedModule, transferLoadout } from "../src/loadout";
import { outfittingScreen, fitReadout } from "../src/outfitting";
import { makeModule, moduleRow } from "../src/loadout";
import { marketStationOf } from "../src/market";
import {
	commanderHold,
	newCommander,
	transactAtStation,
	type StationCommerceInput,
} from "../src/station-commerce";

const input = (): StationCommerceInput => ({
	commander: newCommander("courier"),
	deficits: {},
	station: marketStationOf(
		{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
		123,
	),
	stationKey: carrierKey(0, "station-trade"),
	economy: 3,
	gameTimeMin: 0,
	displayTL: 8,
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 1 }),
	action: { type: "remove-module", slot: "h1" },
});

test("removal carries the exact module as one tonne and selling returns ninety percent", () => {
	const i = input();
	const laser = { ...makeModule("pulse-laser", 1, "D"), variant: "kept-trait" };
	i.commander = {
		...i.commander,
		loadout: { ...i.commander.loadout, h1: laser },
	};
	const out = transactAtStation(i);
	expect(out.accepted).toBe(true);
	expect(out.commander.loadout.h1).toBeUndefined();
	expect(out.commander.recoveredFittings).toEqual([
		{ ...laser, id: "Extra Pulse Laser", tonnes: 1 },
	]);
	expect(out.commander.credits).toBe(i.commander.credits);
	const sold = transactAtStation({
		...i,
		commander: out.commander,
		action: { type: "sell-recovered", index: 0 },
	});
	expect(sold.accepted).toBe(true);
	expect(sold.commander.credits - i.commander.credits).toBeCloseTo(
		moduleRow(laser).priceCr * 0.9,
	);
});

test("removal refuses a full hold without changing any state", () => {
	const i = input();
	i.entrustedT = commanderHold(i.commander, 0).capacityT;
	const out = transactAtStation(i);
	expect(out.accepted).toBe(false);
	expect(out.reason).toBe("cargo-full");
	expect(out.commander).toBe(i.commander);
	expect(out.deficits).toBe(i.deficits);
});

test("rack removal checks the resulting capacity, including its own carried tonne", () => {
	const i = input();
	i.commander = {
		...i.commander,
		loadout: { ...i.commander.loadout, flex: makeModule("cargo-rack", 1) },
	};
	i.entrustedT = commanderHold(newCommander("courier"), 0).capacityT;
	i.action = { type: "remove-module", slot: "flex" };
	expect(transactAtStation(i).reason).toBe("cargo-full");
	i.entrustedT -= 1;
	expect(transactAtStation(i).accepted).toBe(true);
});

test("core plant and unknown slots cannot be removed", () => {
	const i = input();
	expect(
		transactAtStation({
			...i,
			action: { type: "remove-module", slot: "plant" },
		}).reason,
	).toBe("core-required");
	expect(
		transactAtStation({
			...i,
			action: { type: "remove-module", slot: "missing" },
		}).reason,
	).toBe("equipment-unavailable");
});

test("module grades use the approved ladder and A adds exactly one rung", () => {
	expect(moduleGate(makeModule("power-plant", 1, "A"))).toEqual({
		ladder: "combat",
		rung: 1,
	});
	expect(moduleGate(makeModule("shield-booster", 1))).toEqual({
		ladder: "combat",
		rung: 2,
	});
	expect(moduleGate(makeModule("armour-plating", 1))).toEqual({
		ladder: "combat",
		rung: 1,
	});
	expect(moduleGate(makeModule("fuel-tank", 1, "A"))).toEqual({
		ladder: "exploration",
		rung: 1,
	});
	expect(moduleGate(makeModule("docking-computer", 1))).toEqual({
		ladder: "exploration",
		rung: 0,
	});
});

test("buy replaces the selected slot, carries the old fit and charges catalogue price", () => {
	const i = input();
	i.commander = { ...i.commander, credits: 100_000 };
	i.action = {
		type: "buy-module",
		slot: "h1",
		module: makeModule("pulse-laser", 1),
	};
	const out = transactAtStation(i);
	expect(out.accepted).toBe(true);
	expect(out.commander.recoveredFittings?.[0].module).toBe("pulse-laser");
	const price = moduleRow(makeModule("pulse-laser", 1)).priceCr;
	expect(out.commander.credits).toBe(i.commander.credits - price);
	expect(out.commander.loadout.h1.purchaseCostCr).toBe(price);
	expect(
		transactAtStation({
			...i,
			entrustedT: commanderHold(i.commander, 0).capacityT,
		}).reason,
	).toBe("cargo-full");
	expect(
		transactAtStation({ ...i, rungs: { combat: 0, trade: 0, exploration: 0 } })
			.reason,
	).toBe("equipment-locked");
	expect(
		transactAtStation({ ...i, action: { ...i.action, slot: "plant" } }).reason,
	).toBe("module-slot");
});

test("purchase cost survives removal and hull transfer; resale banks profit, salvage banks proceeds", () => {
	const i = input();
	const module = { ...makeModule("pulse-laser", 1), purchaseCostCr: 1000 };
	i.commander = {
		...i.commander,
		loadout: { ...i.commander.loadout, h1: module },
	};
	const removed = transactAtStation(i).commander;
	expect(removed.recoveredFittings?.[0].purchaseCostCr).toBe(1000);
	expect(
		transferLoadout(i.commander.loadout, "freighter").loadout.h1.purchaseCostCr,
	).toBe(1000);
	for (const cost of [0, 1000]) {
		const before = {
			...removed,
			recoveredFittings: [carriedModule({ ...module, purchaseCostCr: cost })],
		};
		const action = { type: "sell-recovered", index: 0 } as const;
		const after = transactAtStation({
			...i,
			commander: before,
			action,
		}).commander;
		expect(
			ladderAfterMarket(emptyLadderRecord(), action, before, after).banked
				.trade,
		).toBeCloseTo(Math.max(0, after.credits - before.credits - cost));
	}
});

test("module cost rejects negative and non-finite provenance", () => {
	for (const purchaseCostCr of [-1, NaN, Infinity, "100"])
		expect(() =>
			parseModule({ ...makeModule("pulse-laser", 1), purchaseCostCr }),
		).toThrow();
	expect(
		parseModule({ ...makeModule("pulse-laser", 1), purchaseCostCr: 0 })
			.purchaseCostCr,
	).toBe(0);
});
test("preview equals the committed fit, including the replaced module's carried mass", () => {
	const i = input();
	i.commander = { ...i.commander, credits: 100_000 };
	const screen = outfittingScreen(i, "h1", "stock:pulse-laser/1/E");
	expect(screen.action).not.toBeNull();
	const after = transactAtStation({ ...i, action: screen.action! });
	expect(after.accepted).toBe(true);
	expect(screen.after).toEqual(fitReadout(after.commander, i.entrustedT));
	expect(screen.after!.accel).toBeLessThan(screen.before.accel);
	expect(screen.before.jump).toBe(screen.after!.jump);
	expect(screen.before.credit).toBe(screen.after!.credit);
});
