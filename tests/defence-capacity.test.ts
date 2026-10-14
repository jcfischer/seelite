/**
 * Armour plating and shield boosters raise the flown condition (#927): one
 * capacity projection, `fittedCapacity`, carries integrity, each pool's shield
 * and the boosters' draw; the condition and kill credit read it.
 */
import { describe, expect, test } from "bun:test";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import { killCredit, strength } from "../src/kill-credit";
import {
	fittedCapacity,
	type Loadout,
	makeModule,
	moduleRow,
	stockLoadout,
} from "../src/loadout";
import { fitReadout } from "../src/outfitting";
import {
	fullCondition,
	refitCondition,
	SHIELD_RECHARGE_ENERGY_PER_POINT,
	SHIELD_RECHARGE_PER_S,
	stepCondition,
	stockCapacity,
} from "../src/ship-condition";
import { newCommander } from "../src/station-commerce";

const PLATE = makeModule("armour-plating", 1, "E");
const BOOSTER = makeModule("shield-booster", 1, "E");
const BOOSTER_DRAW_PER_S = moduleRow(BOOSTER).drawPerS;

const courierWith = (extra: Record<string, ReturnType<typeof makeModule>>) =>
	({ ...stockLoadout("courier"), ...extra }) as Loadout;
const courier = (extra: Record<string, ReturnType<typeof makeModule>> = {}) =>
	fittedCapacity("courier", courierWith(extra));

describe("fittedCapacity carries integrity and shields", () => {
	test("a courier with a 1E plate has hullMax 125; with a 1E booster as well, shieldMax 131", () => {
		expect(HULL_SPECS.courier.integrity).toBe(100);
		expect(HULL_SPECS.courier.shieldPool).toBe(106);
		const plated = fullCondition("courier", courier({ i1: PLATE }));
		expect(plated.hullMax).toBe(125);
		expect(plated.hull).toBe(125);
		expect(plated.shieldMax).toBe(106);
		const both = fullCondition("courier", courier({ i1: PLATE, u1: BOOSTER }));
		expect([both.hullMax, both.shieldMax, both.fore, both.aft]).toEqual([
			125, 131, 131, 131,
		]);
	});

	test("every plate and every booster adds; boosters' draws add", () => {
		const c = courier({
			i1: PLATE,
			i2: PLATE,
			u1: BOOSTER,
			u2: makeModule("shield-booster", 1, "A"),
		});
		expect(c.integrity).toBe(150);
		expect(c.shieldPool).toBe(106 + 25 + 37.5);
		expect(c.boosterDrawPerS).toBe(
			BOOSTER_DRAW_PER_S +
				moduleRow(makeModule("shield-booster", 1, "A")).drawPerS,
		);
	});

	test("every hull's stock loadout projects the hull's own integrity and pool, and no draw", () => {
		for (const id of HULL_IDS) {
			const c = fittedCapacity(id, stockLoadout(id));
			expect([c.integrity, c.shieldPool, c.boosterDrawPerS]).toEqual([
				HULL_SPECS[id].integrity,
				HULL_SPECS[id].shieldPool,
				0,
			]);
			// The condition's part of the projection is `stockCapacity`'s.
			const { bankE, regenPerS, integrity, shieldPool, boosterDrawPerS } = c;
			expect({
				bankE,
				regenPerS,
				integrity,
				shieldPool,
				boosterDrawPerS,
			}).toEqual(stockCapacity(id));
		}
	});

	test("without capacity, every hull's condition is its stock one (NPCs, the tender)", () => {
		for (const id of HULL_IDS) {
			const c = fullCondition(id);
			expect([c.hullMax, c.shieldMax, c.boosterDrawPerS]).toEqual([
				HULL_SPECS[id].integrity,
				HULL_SPECS[id].shieldPool,
				0,
			]);
		}
	});
});

describe("the booster draws only while a pool recharges", () => {
	const boosted = () =>
		fullCondition("courier", courier({ i1: PLATE, u1: BOOSTER }));

	test("a pool below max past the delay: the booster's draw first, then the recharge's per-point cost", () => {
		const dt = 0.1;
		const c = { ...boosted(), fore: 50, energy: 80 };
		const { condition } = stepCondition(c, dt, false);
		const points = SHIELD_RECHARGE_PER_S * dt;
		expect(condition.fore).toBeCloseTo(50 + points, 12);
		// The idle gun's regen tops the bank afterwards; read the spend alone by
		// removing it.
		const spent = c.energy - (condition.energy - c.energyRegenPerS * dt);
		expect(spent).toBeCloseTo(
			BOOSTER_DRAW_PER_S * dt + points * SHIELD_RECHARGE_ENERGY_PER_POINT,
			12,
		);
	});

	test("the draw is capped at the bank and the recharge pays from what is left", () => {
		const dt = 0.1;
		const draw = BOOSTER_DRAW_PER_S * dt;
		const c = { ...boosted(), fore: 50, energy: draw * 0.5 };
		const { condition } = stepCondition(c, dt, false);
		expect(condition.fore).toBe(50);
		expect(condition.energy).toBeCloseTo(c.energyRegenPerS * dt, 12);
		const short = { ...boosted(), fore: 50, energy: draw + 0.05 };
		const after = stepCondition(short, dt, false).condition;
		expect(after.fore).toBeCloseTo(
			50 + 0.05 / SHIELD_RECHARGE_ENERGY_PER_POINT,
			12,
		);
	});

	test("both pools full: no draw, so 10 s of quiet flight banks what an unboosted ship banks", () => {
		const dt = 1 / 60;
		let a = { ...boosted(), energy: 10 };
		let b = { ...fullCondition("courier", courier({ i1: PLATE })), energy: 10 };
		for (let i = 0; i < 600; i++) {
			a = stepCondition(a, dt, false).condition;
			b = stepCondition(b, dt, false).condition;
		}
		expect(a.energy).toBe(b.energy);
	});

	test("inside the delay, or crippled, the booster draws nothing", () => {
		const dt = 0.1;
		const struck = { ...boosted(), fore: 50, energy: 50, sinceStruckS: 0 };
		const s = stepCondition(struck, dt, false).condition;
		expect(s.energy).toBeCloseTo(50 + struck.energyRegenPerS * dt, 12);
		const crippled = { ...boosted(), fore: 50, energy: 50, hull: 1 };
		const k = stepCondition(crippled, dt, false).condition;
		expect(k.energy).toBeCloseTo(50 + crippled.energyRegenPerS * dt, 12);
	});
});

describe("a refit at a dock moves the hull and the pools", () => {
	test("a fitted plate raises the current hull by its points; removing it clamps", () => {
		const worn = { ...fullCondition("courier"), hull: 60 };
		const plated = refitCondition(worn, courier({ i1: PLATE }));
		expect([plated.hull, plated.hullMax]).toEqual([85, 125]);
		const bare = refitCondition(
			{ ...fullCondition("courier", courier({ i1: PLATE })), hull: 120 },
			courier(),
		);
		expect([bare.hull, bare.hullMax]).toEqual([100, 100]);
		const low = refitCondition(
			{ ...fullCondition("courier", courier({ i1: PLATE })), hull: 40 },
			courier(),
		);
		expect(low.hull).toBe(40);
	});

	test("a fitted booster arrives charged on each pool; removing it clamps both pools", () => {
		const c = refitCondition(
			{ ...fullCondition("courier"), fore: 100, aft: 30 },
			courier({ u1: BOOSTER }),
		);
		expect([c.fore, c.aft, c.shieldMax, c.boosterDrawPerS]).toEqual([
			125,
			55,
			131,
			BOOSTER_DRAW_PER_S,
		]);
		const off = refitCondition(
			fullCondition("courier", courier({ u1: BOOSTER })),
			courier(),
		);
		expect([off.fore, off.aft, off.shieldMax, off.boosterDrawPerS]).toEqual([
			106, 106, 106, 0,
		]);
	});
});

describe("kill credit reads the fitted defence", () => {
	test("strength is (fitted shield + fitted integrity) × fitted DPS × skill", () => {
		const ship = {
			hull: "courier" as const,
			loadout: courierWith({ i1: PLATE, u1: BOOSTER }),
		};
		expect(strength(ship)).toBe(
			(131 + 125) * moduleRow(stockLoadout("courier").h1).output.damagePerS,
		);
	});

	test("armour on a pulse-armed ship lowers the credit for a raider", () => {
		const stock = {
			hull: "courier" as const,
			loadout: stockLoadout("courier"),
		};
		const plated = { ...stock, loadout: courierWith({ i1: PLATE }) };
		const boosted = { ...stock, loadout: courierWith({ u1: BOOSTER }) };
		expect(killCredit(plated, "raider")).toBeLessThan(
			killCredit(stock, "raider"),
		);
		expect(killCredit(boosted, "raider")).toBeLessThan(
			killCredit(stock, "raider"),
		);
	});

	test("no combat laser: strength 0 whatever defence is fitted", () => {
		const { h1: _, ...unarmed } = courierWith({ i1: PLATE, u1: BOOSTER });
		expect(strength({ hull: "courier", loadout: unarmed })).toBe(0);
	});

	test("the Equipment tab's credit readout falls with a plate before purchase", () => {
		const c = newCommander("courier");
		const plated = { ...c, loadout: { ...c.loadout, i1: PLATE } };
		expect(fitReadout(plated, 0).credit).toBeLessThan(fitReadout(c, 0).credit);
	});
});
