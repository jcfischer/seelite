import { expect, test } from "bun:test";
import {
	hasOreBay,
	miningHold,
	oreCapacityLabel,
	withOre,
} from "../src/mining-capacity";
import { holdBody } from "../src/hold-view";
import { DRILL, beginDrillCut, stepDrillCut } from "../src/rock-drill";

const general = {
	usedT: 40,
	capacityT: 40,
	freeT: 0,
	entrustedT: 0,
	lines: [],
};

test("Longwall skips hold 3000 tonnes independently of a full general hold", () => {
	expect(miningHold("miner", general, 2999)).toEqual({
		usedT: 2999,
		capacityT: 3000,
	});
	const hold = withOre("miner", general, { iron: 3000 });
	expect(hold.usedT).toBe(40);
	expect(hold.freeT).toBe(0);
	expect(hold.oreBay).toEqual({ usedT: 3000, capacityT: 3000, freeT: 0 });
	expect(holdBody(hold, null)).toContain("RAW ORE 3000 / 3000 t");
});

test("other hulls share their general hold with raw ore", () => {
	const hold = { ...general, usedT: 18, capacityT: 20, freeT: 2 };
	expect(miningHold("courier", hold, 2)).toEqual({ usedT: 20, capacityT: 20 });
	expect(withOre("courier", hold, { iron: 2 }).freeT).toBe(0);
});

test("raw-ore projection preserves ordinary lines and excludes empty or negative lots", () => {
	const lines = [
		{
			goodName: "Food",
			amount: 18,
			unit: "t" as const,
			owner: "pilot" as const,
		},
	];
	const hold = { usedT: 18, capacityT: 20, freeT: 2, entrustedT: 0, lines };
	const shared = withOre("courier", hold, { iron: 2, empty: 0, invalid: -1 });
	expect(shared).toEqual({
		...hold,
		usedT: 20,
		freeT: 0,
		lines: [
			...lines,
			{ goodName: "iron", amount: 2, unit: "t", owner: "pilot", kind: "ore" },
		],
	});
	expect(shared.oreBay).toBeUndefined();
	expect(withOre("miner", hold, { empty: 0 }).lines).toEqual(lines);
	expect(hasOreBay("miner")).toBe(true);
	expect(hasOreBay("courier")).toBe(false);
	expect(oreCapacityLabel("miner")).toBe("RAW ORE");
	expect(oreCapacityLabel("courier")).toBe("HOLD");
});

test("fast drilling stops exactly at skip and reserve boundaries", () => {
	const input = {
		key: "rock",
		powered: true,
		spin: 1,
		rateTPerS: DRILL.rateTPerS,
		dt: 1,
		holdFreeT: 1,
		reserveLeftT: 100,
	};
	expect(DRILL.rateTPerS).toBe(37.5);
	expect(stepDrillCut(beginDrillCut(), input).tonnes).toBe(1);
	expect(stepDrillCut(beginDrillCut(), { ...input, holdFreeT: 0 }).tonnes).toBe(
		0,
	);
	expect(
		stepDrillCut(beginDrillCut(), {
			...input,
			holdFreeT: 3000,
			reserveLeftT: 7,
		}).tonnes,
	).toBe(7);
	expect(
		stepDrillCut(beginDrillCut(), { ...input, powered: false }).tonnes,
	).toBe(0);
});
