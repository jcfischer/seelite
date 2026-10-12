/**
 * Hull temperature (#931): a star heats every hull inside the skim band, the
 * hull cools away from it, and above the top it loses integrity.
 *
 * The figures are #930's approved table, which `scripts/measure-star-skim.ts`
 * derived. That script prints rather than exports, so the rows below restate
 * its two formulas — the heat shape and the exact relaxation step — from the
 * table's own text and hold the module to them. A retune that moves the module
 * and not the table goes red here.
 */
import { describe, expect, test } from "bun:test";
import { SURFACE_MARGIN } from "../src/cruise";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { fittedCapacity, makeModule, stockLoadout } from "../src/loadout";
import {
	HULL_HEAT_DAMAGE_PER_S,
	HULL_HEAT_RISE_PER_S,
	HULL_KILL_TOLERANCE,
	HULL_TEMP_AMBIENT,
	HULL_TEMP_COOL_TAU_S,
	HULL_TEMP_SNAP,
	HULL_TEMP_TOP,
	SKIM_BAND_R,
	SKIM_SHELL_R,
	type ShipCondition,
	fullCondition,
	isAlive,
	starHeat,
	stepCondition,
	stepHullTemperature,
} from "../src/ship-condition";

const DT = 1 / 60;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** #930's heat shape, as the table writes it. */
const tableHeat = (r: number) =>
	clamp01((1 / r ** 2 - 1 / 4) / (1 / 1.05 ** 2 - 1 / 4));
/** The instrument's `heatStep`: exact relaxation over `dt` with `h` held. */
const instrumentStep = (t: number, h: number, dt: number) => {
	const eq = 0.185 * h * 15;
	return eq + (t - eq) * Math.exp(-dt / 15);
};

/** Step `seconds` at a fixed star distance, in R. */
function hold(c: ShipCondition, rOverR: number, seconds: number) {
	let next = c;
	for (let i = 0; i < Math.round(seconds / DT); i++)
		next = stepHullTemperature(next, DT, rOverR);
	return next;
}

describe("the approved table (#930)", () => {
	test("the module carries the table's figures", () => {
		expect(SKIM_BAND_R).toBe(2);
		expect(HULL_HEAT_RISE_PER_S).toBe(0.185);
		expect(HULL_TEMP_COOL_TAU_S).toBe(15);
		expect(HULL_TEMP_AMBIENT).toBe(0);
		expect(HULL_TEMP_TOP).toBe(1);
		expect(HULL_HEAT_DAMAGE_PER_S).toBe(0.2);
	});

	test("the shell is cruise's drop-out shell", () => {
		// ship-condition cannot import cruise (sim imports ship-condition and
		// cruise imports sim), so the figure is held equal here instead.
		expect(SKIM_SHELL_R).toBe(SURFACE_MARGIN);
	});

	test("the heat shape is the table's, 1 at and inside the shell, 0 at and past the edge", () => {
		for (const r of [0.5, 1, 1.05, 1.06, 1.2, 1.5, 1.9, 1.99, 2, 3, 100])
			expect(starHeat(r)).toBeCloseTo(tableHeat(r), 12);
		expect(starHeat(1.05)).toBe(1);
		expect(starHeat(0.9)).toBe(1);
		expect(starHeat(2)).toBe(0);
		expect(starHeat(Number.POSITIVE_INFINITY)).toBe(0);
	});

	test("the step is the instrument's exact relaxation", () => {
		const c = fullCondition("courier");
		for (const [t0, r, dt] of [
			[0, 1.2, DT],
			[0.4, 1.06, 0.1],
			[1.3, 1.5, 1 / 30],
			[0.7, 3, 0.05],
		] as const) {
			const next = stepHullTemperature({ ...c, hullTemp: t0 }, dt, r);
			expect(next.hullTemp).toBeCloseTo(
				instrumentStep(t0, tableHeat(r), dt),
				12,
			);
		}
	});

	test("held at the shell from ambient, the hull reaches the top in 6.7 s", () => {
		// −τ·ln((eq − 1)/eq) with eq = 0.185·15. The table's 6.00 s for a G
		// drop-out starts from the pass's own heat, not from ambient.
		const c = hold(fullCondition("courier"), SKIM_SHELL_R, 6.6);
		expect(c.hullTemp).toBeLessThan(HULL_TEMP_TOP);
		expect(hold(c, SKIM_SHELL_R, 0.2).hullTemp).toBeGreaterThan(HULL_TEMP_TOP);
	});
});

describe("heating inside the band", () => {
	test("a second at 1.2 R rises by the approved rate at that distance, and laser heat is untouched", () => {
		const start = { ...fullCondition("courier"), heat: 40 };
		const after = hold(start, 1.2, 1);
		const rate = HULL_HEAT_RISE_PER_S * tableHeat(1.2);
		// The rate at ambient is the rise times the shape; over one second the
		// cooling term takes back T/τ of it, so the exact figure sits just under.
		expect(after.hullTemp).toBeCloseTo(instrumentStep(0, tableHeat(1.2), 1), 9);
		expect(after.hullTemp).toBeLessThan(rate);
		expect(after.hullTemp).toBeGreaterThan(rate * (1 - 1 / 15));
		expect(after.heat).toBe(40);
		expect(after.heatLocked).toBe(false);
	});

	test("the gun's step leaves hull temperature alone", () => {
		const c = { ...fullCondition("courier"), hullTemp: 0.6 };
		expect(stepCondition(c, DT, true).condition.hullTemp).toBe(0.6);
		expect(stepCondition(c, DT, false).condition.hullTemp).toBe(0.6);
	});

	test("closer in heats faster", () => {
		const c = fullCondition("courier");
		const at = (r: number) => stepHullTemperature(c, 1, r).hullTemp;
		expect(at(1.06)).toBeGreaterThan(at(1.2));
		expect(at(1.2)).toBeGreaterThan(at(1.5));
		expect(at(1.5)).toBeGreaterThan(at(1.9));
		expect(at(2)).toBe(0);
	});

	test("every hull heats alike: the rule reads distance and nothing of the ship", () => {
		const temps = HULL_IDS.map(
			(id) => hold(fullCondition(id), 1.2, 3).hullTemp,
		);
		for (const t of temps) expect(t).toBe(temps[0]);
	});

	test("a ship with no fuel scoop heats exactly as one with a scoop", () => {
		const slot = HULL_SPECS.courier.slots.find(
			(s) =>
				s.kind === "internal" &&
				(s.accepts === "any" || s.accepts.includes("fuel")),
		);
		if (!slot)
			throw new Error("the courier has no slot that takes a fuel scoop");
		const bare = stockLoadout("courier");
		const scooped = {
			...bare,
			[slot.key]: makeModule("fuel-scoop", slot.size),
		};
		const a = fullCondition("courier", fittedCapacity("courier", bare));
		const b = fullCondition("courier", fittedCapacity("courier", scooped));
		expect(hold(b, 1.06, 12)).toEqual(hold(a, 1.06, 12));
	});
});

describe("cooling outside the band", () => {
	test("falls toward ambient at the approved time constant", () => {
		const c = { ...fullCondition("courier"), hullTemp: 0.8 };
		const after = hold(c, 5, HULL_TEMP_COOL_TAU_S);
		expect(after.hullTemp).toBeCloseTo(0.8 * Math.exp(-1), 9);
	});

	test("never goes below ambient, and reaches it rather than approaching it forever", () => {
		let c: ShipCondition = { ...fullCondition("courier"), hullTemp: 1.4 };
		let lowest = c.hullTemp;
		for (let i = 0; i < 200 * 60; i++) {
			c = stepHullTemperature(c, DT, 10);
			lowest = Math.min(lowest, c.hullTemp);
		}
		expect(lowest).toBeGreaterThanOrEqual(HULL_TEMP_AMBIENT);
		expect(c.hullTemp).toBe(HULL_TEMP_AMBIENT);
	});

	test("the snap to ambient is below the gauge's resolution and only outside the band", () => {
		const cooling = {
			...fullCondition("courier"),
			hullTemp: HULL_TEMP_SNAP * 1.0001,
		};
		expect(stepHullTemperature(cooling, DT, 3).hullTemp).toBe(
			HULL_TEMP_AMBIENT,
		);
		// Inside the band a hull at the edge of ambient is heating, not cooling.
		const edge = { ...fullCondition("courier"), hullTemp: 0 };
		expect(stepHullTemperature(edge, DT, 1.99).hullTemp).toBeGreaterThan(0);
		expect(HULL_TEMP_SNAP).toBeLessThan(0.01);
	});

	test("a step of zero or negative time changes nothing", () => {
		const c = { ...fullCondition("courier"), hullTemp: 0.5 };
		expect(stepHullTemperature(c, 0, 1.1)).toEqual(c);
		expect(stepHullTemperature(c, -1, 1.1)).toEqual(c);
	});
});

describe("damage above the top", () => {
	test("at the top, the hull loses nothing while it holds there", () => {
		// Equilibrium at the top: rise·h·τ = 1. The loss is k·(T − 1), zero here.
		const h = 1 / (HULL_HEAT_RISE_PER_S * HULL_TEMP_COOL_TAU_S);
		const r = 1 / Math.sqrt(h * (1 / 1.05 ** 2 - 1 / 4) + 1 / 4);
		expect(starHeat(r)).toBeCloseTo(h, 12);
		const c = { ...fullCondition("courier"), hullTemp: HULL_TEMP_TOP };
		const after = hold(c, r, 1);
		expect(after.hullTemp).toBeCloseTo(HULL_TEMP_TOP, 9);
		expect(after.hull).toBeCloseTo(c.hullMax, 6);
	});

	test("above it, integrity falls by k·(T − 1) of the hull each second, shields untouched", () => {
		for (const id of ["courier", "freighter", "dreadnought"] as const) {
			const start = { ...fullCondition(id), hullTemp: 1.5 };
			const h = 1.5 / (HULL_HEAT_RISE_PER_S * HULL_TEMP_COOL_TAU_S);
			const r = 1 / Math.sqrt(h * (1 / 1.05 ** 2 - 1 / 4) + 1 / 4);
			const after = hold(start, r, 1);
			// Held at its own equilibrium, T stays 1.5 and the share is 0.2·0.5.
			expect(after.hullTemp).toBeCloseTo(1.5, 9);
			const share = (start.hull - after.hull) / start.hullMax;
			expect(share).toBeCloseTo(HULL_HEAT_DAMAGE_PER_S * 0.5, 9);
			expect(after.fore).toBe(start.fore);
			expect(after.aft).toBe(start.aft);
			expect(after.sinceStruckS).toBe(start.sinceStruckS);
			expect(after.energy).toBe(start.energy);
		}
	});

	test("the loss over a step is the trapezoid of the excess, as the instrument's", () => {
		const c = { ...fullCondition("courier"), hullTemp: 0.99 };
		const t1 = instrumentStep(0.99, 1, 0.5);
		const expected =
			HULL_HEAT_DAMAGE_PER_S *
			Math.max(0, (0.99 + t1) / 2 - 1) *
			0.5 *
			c.hullMax;
		const after = stepHullTemperature(c, 0.5, 1.05);
		expect(c.hull - after.hull).toBeCloseTo(expected, 12);
		expect(expected).toBeGreaterThan(0);
	});

	test("below the top, no step costs hull", () => {
		const c = { ...fullCondition("courier"), hullTemp: 0.5 };
		expect(hold(c, 1.05, 2).hull).toBe(c.hullMax);
	});

	test("held at the shell, the hull runs to zero and the ship is dead", () => {
		let c = fullCondition("courier");
		let seconds = 0;
		while (isAlive(c) && seconds < 600) {
			c = stepHullTemperature(c, DT, SKIM_SHELL_R);
			seconds += DT;
		}
		expect(isAlive(c)).toBe(false);
		expect(c.hull).toBe(0);
		expect(c.fore).toBe(c.shieldMax);
	});

	test("a hull left under the kill tolerance by heat is zero, as a hit leaves it", () => {
		const c = {
			...fullCondition("courier"),
			hullTemp: 2,
			hull: HULL_KILL_TOLERANCE * 1.01,
		};
		const after = stepHullTemperature(c, DT, SKIM_SHELL_R);
		expect(after.hull).toBe(0);
	});
});

test("a fresh condition, and so a loaded save, starts at ambient", () => {
	for (const id of HULL_IDS)
		expect(fullCondition(id).hullTemp).toBe(HULL_TEMP_AMBIENT);
});
