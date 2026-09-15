/**
 * `combat-model.md` §2's ship condition — the headless half of node #324 (a).
 *
 * Every row builds from the exported constants rather than from 106, 6 and 3,
 * so a retune moves one figure and the rows follow it.
 */
import { describe, expect, test } from "bun:test";
import { COMBAT_PROTOTYPE_DEFAULTS } from "../src/combat-prototype";
import { DOCKING_DAMAGE_SCALE, V_GATE_KMS, entryDamage } from "../src/docking";
import { HULL_IDS, HULL_SPECS } from "../src/hull";
import {
	ENERGY_BANK,
	ENERGY_REGEN_PER_S,
	HEAT_COOL_PER_S,
	HEAT_LOCK,
	HEAT_RELEASE,
	PULSE_LASER,
	SHIELD_POOL,
	SHIELD_RECHARGE_DELAY_S,
	SHIELD_RECHARGE_ENERGY_PER_POINT,
	SHIELD_RECHARGE_PER_S,
	type ShipCondition,
	applyDamage,
	fullCondition,
	headOnPool,
	isAlive,
	sideStruck,
	stepCondition,
} from "../src/ship-condition";
import { v3 } from "../src/vec3";

const DT = 1 / 60;

/** Step `seconds` of sim time with the trigger held or not. */
function run(c: ShipCondition, seconds: number, trigger: boolean) {
	let condition = c;
	let delivered = 0;
	for (let i = 0; i < Math.round(seconds / DT); i++) {
		const step = stepCondition(condition, DT, trigger);
		condition = step.condition;
		delivered += step.damage;
	}
	return { condition, delivered };
}

describe("a fresh condition", () => {
	test("hull is the flown hull's integrity, shields and energy are full", () => {
		for (const id of HULL_IDS) {
			const c = fullCondition(id);
			expect(c.hull).toBe(HULL_SPECS[id].integrity);
			expect(c.hullMax).toBe(HULL_SPECS[id].integrity);
			expect(c.fore).toBe(SHIELD_POOL);
			expect(c.aft).toBe(SHIELD_POOL);
			expect(c.energy).toBe(ENERGY_BANK);
			expect(c.heat).toBe(0);
			expect(c.heatLocked).toBe(false);
			expect(isAlive(c)).toBe(true);
		}
	});

	test("starts clear of the recharge delay", () => {
		const c = applyDamage(fullCondition("courier"), 10, "fore");
		// A fresh condition that was never struck recharges on its first step.
		const fresh = { ...fullCondition("courier"), fore: SHIELD_POOL - 10 };
		expect(stepCondition(fresh, DT, false).condition.fore).toBeGreaterThan(
			SHIELD_POOL - 10,
		);
		expect(stepCondition(c, DT, false).condition.fore).toBe(SHIELD_POOL - 10);
	});
});

describe("damage by direction", () => {
	test("the side facing the source takes it", () => {
		const nose = v3(0, 0, -1);
		expect(sideStruck(nose, v3(0, 0, -1))).toBe("fore");
		expect(sideStruck(nose, v3(0, 0, 1))).toBe("aft");
		expect(sideStruck(nose, v3(1, 0, -0.01))).toBe("fore");
		expect(sideStruck(nose, v3(1, 0, 0.01))).toBe("aft");
	});

	test("fore damage leaves the aft pool untouched, and the reverse", () => {
		const full = fullCondition("courier");
		const fore = applyDamage(full, 30, "fore");
		expect(fore.fore).toBe(SHIELD_POOL - 30);
		expect(fore.aft).toBe(SHIELD_POOL);
		const aft = applyDamage(full, 30, "aft");
		expect(aft.aft).toBe(SHIELD_POOL - 30);
		expect(aft.fore).toBe(SHIELD_POOL);
	});

	test("a depleted pool bleeds exactly the remainder to hull", () => {
		const full = fullCondition("courier");
		const c = applyDamage(full, SHIELD_POOL + 12, "aft");
		expect(c.aft).toBe(0);
		expect(c.fore).toBe(SHIELD_POOL);
		expect(c.hull).toBe(full.hullMax - 12);
	});

	test("the other pool does not shelter the hull", () => {
		const c = applyDamage(fullCondition("courier"), SHIELD_POOL + 1, "fore");
		expect(c.hull).toBe(fullCondition("courier").hullMax - 1);
	});

	test("hull floors at zero and a zero hull is dead", () => {
		const c = applyDamage(fullCondition("courier"), 1e6, "fore");
		expect(c.hull).toBe(0);
		expect(isAlive(c)).toBe(false);
	});

	test("a hit restarts the recharge delay", () => {
		const c = applyDamage(fullCondition("courier"), 1, "fore");
		expect(c.sinceStruckS).toBe(0);
	});
});

describe("the pulse laser", () => {
	test("a held trigger delivers the pulse's damage rate", () => {
		const { delivered } = run(fullCondition("courier"), 2, true);
		expect(delivered).toBeCloseTo(PULSE_LASER.damagePerS * 2, 6);
	});

	test("firing spends energy and builds heat, and does not regenerate", () => {
		const { condition } = run(fullCondition("courier"), 2, true);
		expect(condition.energy).toBeCloseTo(
			ENERGY_BANK - PULSE_LASER.energyPerS * 2,
			6,
		);
		expect(condition.heat).toBeCloseTo(PULSE_LASER.heatPerS * 2, 6);
	});

	test("an idle gun cools and the bank refills, bounded by their scales", () => {
		const warm = {
			...fullCondition("courier"),
			energy: 10,
			heat: 50,
		};
		const { condition } = run(warm, 1, false);
		expect(condition.heat).toBeCloseTo(50 - HEAT_COOL_PER_S, 6);
		expect(condition.energy).toBeCloseTo(10 + ENERGY_REGEN_PER_S, 6);
		const long = run(warm, 60, false).condition;
		expect(long.heat).toBe(0);
		expect(long.energy).toBe(ENERGY_BANK);
	});

	test("heat at the ceiling locks the gun and it delivers nothing", () => {
		const hot = { ...fullCondition("courier"), heat: HEAT_LOCK };
		const step = stepCondition(hot, DT, true);
		expect(step.condition.heatLocked).toBe(true);
		expect(step.damage).toBe(0);
		expect(step.fired).toBe(false);
	});

	test("the lock holds until heat falls to half the ceiling", () => {
		let c = { ...fullCondition("courier"), heat: HEAT_LOCK, heatLocked: true };
		let seconds = 0;
		while (c.heatLocked && seconds < 60) {
			c = stepCondition(c, DT, true).condition;
			seconds += DT;
		}
		expect(c.heat).toBeLessThanOrEqual(HEAT_RELEASE);
		expect(c.heat).toBeGreaterThan(HEAT_RELEASE - HEAT_COOL_PER_S * DT - 1e-9);
	});

	test("heat never exceeds the instrument scale", () => {
		const hot = { ...fullCondition("courier"), heat: HEAT_LOCK - 0.001 };
		expect(stepCondition(hot, 1, true).condition.heat).toBeLessThanOrEqual(
			HEAT_LOCK,
		);
	});

	test("an empty bank cannot fire", () => {
		const flat = { ...fullCondition("courier"), energy: 0 };
		const step = stepCondition(flat, DT, true);
		expect(step.fired).toBe(false);
		expect(step.damage).toBe(0);
	});
});

describe("shield recharge", () => {
	test("waits out the delay after a hit", () => {
		const hit = applyDamage(fullCondition("courier"), 20, "fore");
		const early = run(hit, SHIELD_RECHARGE_DELAY_S - 0.1, false).condition;
		expect(early.fore).toBe(SHIELD_POOL - 20);
		const late = run(hit, SHIELD_RECHARGE_DELAY_S + 1, false).condition;
		expect(late.fore).toBeGreaterThan(SHIELD_POOL - 20);
	});

	test("recharges the lower pool first", () => {
		const c = {
			...fullCondition("courier"),
			fore: SHIELD_POOL - 5,
			aft: SHIELD_POOL - 40,
		};
		const after = run(c, 1, false).condition;
		expect(after.fore).toBe(SHIELD_POOL - 5);
		expect(after.aft).toBeCloseTo(SHIELD_POOL - 40 + SHIELD_RECHARGE_PER_S, 6);
	});

	test("draws on the energy bank, so fire and recovery compete", () => {
		const c = {
			...fullCondition("courier"),
			aft: SHIELD_POOL - 40,
			energy: 50,
		};
		const idle = run(c, 1, false).condition;
		expect(idle.energy).toBeCloseTo(
			50 +
				ENERGY_REGEN_PER_S -
				SHIELD_RECHARGE_PER_S * SHIELD_RECHARGE_ENERGY_PER_POINT,
			6,
		);
		const firing = run(c, 1, true).condition;
		expect(firing.energy).toBeCloseTo(
			50 -
				PULSE_LASER.energyPerS -
				SHIELD_RECHARGE_PER_S * SHIELD_RECHARGE_ENERGY_PER_POINT,
			6,
		);
	});

	test("an empty bank recharges nothing", () => {
		const c = { ...fullCondition("courier"), aft: 10, energy: 0 };
		const step = stepCondition(c, DT, true).condition;
		expect(step.aft).toBe(10);
	});

	test("never recharges hull", () => {
		const c = applyDamage(fullCondition("courier"), SHIELD_POOL + 30, "fore");
		expect(run(c, 120, false).condition.hull).toBe(c.hull);
	});
});

describe("docking damage lands through it (docking.md §2.1, §10)", () => {
	test("the exported scale costs at most a quarter of the head-on pool, on every hull", () => {
		// §10's obligation: the **exported** constant, not a parameter — and
		// every row, because a hull's integrity is its own.
		for (const id of HULL_IDS) {
			const full = fullCondition(id);
			const damage = entryDamage(V_GATE_KMS, DOCKING_DAMAGE_SCALE);
			const after = applyDamage(full, damage, "fore");
			expect(headOnPool(full) - headOnPool(after)).toBeLessThanOrEqual(
				headOnPool(full) / 4,
			);
			expect(isAlive(after)).toBe(true);
		}
	});

	test("the head-on pool is the fore shield and the hull", () => {
		const c = fullCondition("courier");
		expect(headOnPool(c)).toBe(c.fore + c.hull);
	});
});

test("the production numbers start where #48 tuned them", () => {
	// Until part (d) moves the rig onto these, two copies exist. This row makes
	// a retune of one without the other loud rather than silent.
	const P = COMBAT_PROTOTYPE_DEFAULTS;
	expect(SHIELD_POOL).toBe(P.shield);
	expect(ENERGY_BANK).toBe(P.energy);
	expect(HEAT_LOCK).toBe(P.heatLock);
	expect(PULSE_LASER.damagePerS).toBe(P.pulseDamagePerSecond);
	expect(PULSE_LASER.energyPerS).toBe(P.pulseEnergyPerSecond);
	expect(PULSE_LASER.heatPerS).toBe(P.pulseHeatPerSecond);
	expect(ENERGY_REGEN_PER_S).toBe(P.energyRegenPerSecond);
	expect(HEAT_COOL_PER_S).toBe(P.heatCoolPerSecond);
	// **The one ruled divergence.** The principal slowed production recharge to
	// 2/s after the second playtest of #324; the rig keeps its own 6/s until part
	// d2 moves it onto these rules. Both halves are pinned, so neither side moves
	// silently.
	expect(SHIELD_RECHARGE_PER_S).toBe(2);
	expect(P.shieldRechargePerSecond).toBe(6);
	expect(SHIELD_RECHARGE_DELAY_S).toBe(P.shieldRechargeDelaySeconds);
});
