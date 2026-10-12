/**
 * The fitted power plant and Extra Energy Units set the energy bank (#925):
 * one capacity projection, `fittedCapacity`, read by the flown condition.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { duelConsoleReadout } from "../src/duel-hud";
import { HULL_IDS, HULL_SPECS, stockPlant } from "../src/hull";
import {
	fittedCapacity,
	type Loadout,
	makeModule,
	stockLoadout,
} from "../src/loadout";
import { fullCondition, refitCondition } from "../src/ship-condition";

const courierWith = (extra: Record<string, ReturnType<typeof makeModule>>) =>
	({ ...stockLoadout("courier"), ...extra }) as Loadout;

describe("fittedCapacity", () => {
	test("a stock courier keeps today's bank: 100 and 12", () => {
		expect(fittedCapacity("courier", stockLoadout("courier"))).toEqual({
			bankE: 100,
			regenPerS: 12,
		});
	});

	test("a 1A plant is 150 and 18; an Extra Energy Unit adds bank, never regen", () => {
		const plant = makeModule("power-plant", 1, "A");
		expect(fittedCapacity("courier", courierWith({ plant }))).toEqual({
			bankE: 150,
			regenPerS: 18,
		});
		expect(
			fittedCapacity(
				"courier",
				courierWith({ plant, flex: makeModule("extra-energy-unit", 1, "E") }),
			),
		).toEqual({ bankE: 200, regenPerS: 18 });
	});

	test("a freighter's stock 2E plant is 150 and 18", () => {
		expect(fittedCapacity("freighter", stockLoadout("freighter"))).toEqual({
			bankE: 150,
			regenPerS: 18,
		});
	});

	test("every hull's stock loadout projects its stock plant", () => {
		for (const id of HULL_IDS) {
			const { bankE, regenPerS } = stockPlant(id);
			expect(fittedCapacity(id, stockLoadout(id))).toEqual({
				bankE,
				regenPerS,
			});
		}
	});
});

describe("the condition takes capacity as numbers", () => {
	test("a fresh condition carries the given bank, full", () => {
		const c = fullCondition("courier", { bankE: 200, regenPerS: 18 });
		expect([c.energy, c.energyMax, c.energyRegenPerS]).toEqual([200, 200, 18]);
	});

	test("without capacity, every hull keeps its stock plant (NPCs, the tender)", () => {
		for (const id of HULL_IDS) {
			const c = fullCondition(id);
			expect([c.energyMax, c.energyRegenPerS]).toEqual([
				stockPlant(id).bankE,
				stockPlant(id).regenPerS,
			]);
		}
	});

	test("added capacity arrives charged, so a full bank stays full", () => {
		const c = refitCondition(fullCondition("courier"), {
			bankE: 200,
			regenPerS: 18,
		});
		expect([c.energy, c.energyMax, c.energyRegenPerS]).toEqual([200, 200, 18]);
		const drained = refitCondition(
			{ ...fullCondition("courier"), energy: 40 },
			{ bankE: 150, regenPerS: 18 },
		);
		expect(drained.energy).toBe(90);
	});

	test("removed capacity clamps the bank", () => {
		const c = refitCondition(
			fullCondition("courier", { bankE: 200, regenPerS: 18 }),
			{ bankE: 150, regenPerS: 18 },
		);
		expect([c.energy, c.energyMax]).toEqual([150, 150]);
	});

	test("a refit leaves shields, hull and heat alone", () => {
		const before = { ...fullCondition("courier"), fore: 3, hull: 7, heat: 9 };
		const after = refitCondition(before, { bankE: 150, regenPerS: 18 });
		expect([after.fore, after.hull, after.heat]).toEqual([3, 7, 9]);
	});

	test("ship-condition.ts imports neither loadout nor the module catalogue", () => {
		const src = readFileSync("src/ship-condition.ts", "utf8");
		expect(src).not.toMatch(/from "\.\/(loadout|module-catalog)"/);
	});
});

test("the bank prints whole points when a fitted capacity is fractional", () => {
	// A size-3 A-grade Extra Energy Unit is 168.75 points of bank.
	const hull = HULL_IDS.find(
		(id) => HULL_SPECS[id].slots.find((s) => s.key === "flex")?.size === 3,
	)!;
	const loadout = {
		...stockLoadout(hull),
		flex: makeModule("extra-energy-unit", 3, "A"),
	};
	const capacity = fittedCapacity(hull, loadout);
	expect(Number.isInteger(capacity.bankE)).toBe(false);
	expect(duelConsoleReadout(fullCondition(hull, capacity)).bank).toMatch(
		/^\d+ \/ \d+$/,
	);
});
