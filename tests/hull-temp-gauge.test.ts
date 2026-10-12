/**
 * The hull-temperature gauge on the glass (#931, #871 D6): on while the hull is
 * above ambient, off at ambient, and in the duel band's own floor grammar.
 */
import { describe, expect, test } from "bun:test";
import {
	HEAT_ACTION_FRACTION,
	HULL_TEMP_LABEL,
	hullTempCells,
	hullTempWidest,
} from "../src/duel-hud";
import {
	HULL_HEAT_RISE_PER_S,
	HULL_TEMP_AMBIENT,
	HULL_TEMP_COOL_TAU_S,
	HULL_TEMP_SNAP,
	HULL_TEMP_TOP,
	SKIM_SHELL_R,
	fullCondition,
	stepHullTemperature,
} from "../src/ship-condition";

const at = (hullTemp: number) => ({ hullTemp });

describe("the gauge", () => {
	test("is absent at ambient", () => {
		expect(hullTempCells(at(HULL_TEMP_AMBIENT))).toEqual([]);
		expect(hullTempCells(fullCondition("courier"))).toEqual([]);
	});

	test("shows above ambient, as one cell, in percent of the top", () => {
		expect(hullTempCells(at(0.34))).toEqual([
			{ label: HULL_TEMP_LABEL, value: "34%", tone: "passive" },
		]);
	});

	test("a hull above ambient never reads 0%", () => {
		for (const t of [1e-9, HULL_TEMP_SNAP, 0.0049])
			expect(hullTempCells(at(t))[0]?.value).toBe("1%");
	});

	test("amber near the top, at the gun's share; red only above the top", () => {
		const amber = HEAT_ACTION_FRACTION * HULL_TEMP_TOP;
		expect(hullTempCells(at(amber - 0.01))[0]?.tone).toBe("passive");
		expect(hullTempCells(at(amber))[0]?.tone).toBe("action");
		expect(hullTempCells(at(HULL_TEMP_TOP))[0]?.tone).toBe("action");
		// The tone reads the print: 100.4% prints 100% and takes no hull worth
		// a red; 100.6% prints 101%.
		expect(hullTempCells(at(1.004))[0]?.tone).toBe("action");
		expect(hullTempCells(at(1.006))[0]?.tone).toBe("refused");
	});

	test("the label is not the gun's HEAT", () => {
		expect(HULL_TEMP_LABEL).not.toBe("HEAT");
	});
});

describe("the gauge's fit", () => {
	test("the widest reading is the hottest a hull can get, held at the shell", () => {
		const hottest = HULL_HEAT_RISE_PER_S * HULL_TEMP_COOL_TAU_S;
		expect(hullTempWidest()).toBe(`${Math.round(hottest * 100)}%`);
	});

	test("no reading on the way there is wider", () => {
		let c = fullCondition("dreadnought");
		const widest = hullTempWidest().length;
		for (let i = 0; i < 120 * 60; i++) {
			c = stepHullTemperature(c, 1 / 60, SKIM_SHELL_R);
			for (const cell of hullTempCells(c))
				expect(cell.value.length).toBeLessThanOrEqual(widest);
		}
	});
});

test("a pass shows the gauge, and cooling away from the star takes it off", () => {
	let c = fullCondition("courier");
	for (let i = 0; i < 4 * 60; i++) c = stepHullTemperature(c, 1 / 60, 1.2);
	expect(hullTempCells(c)).toHaveLength(1);
	for (let i = 0; i < 200 * 60; i++) c = stepHullTemperature(c, 1 / 60, 50);
	expect(hullTempCells(c)).toEqual([]);
});
