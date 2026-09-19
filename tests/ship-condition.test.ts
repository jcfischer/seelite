/**
 * `combat-model.md` §2's ship condition — the headless half of node #324 (a).
 *
 * Every row builds from the exported constants rather than from 106, 6 and 3,
 * so a retune moves one figure and the rows follow it.
 */
import { describe, expect, test } from "bun:test";
import { COMBAT_PROTOTYPE_DEFAULTS } from "../src/combat-prototype";
import { DOCKING_DAMAGE_SCALE, V_GATE_KMS, entryDamage } from "../src/docking";
import { HULL_IDS, type HullId, HULL_SPECS } from "../src/hull";
import {
	CRIPPLED_HULL_FRACTION,
	ENERGY_BANK,
	ENERGY_REGEN_PER_S,
	HEAT_COOL_PER_S,
	HEAT_LOCK,
	HEAT_RELEASE,
	HULL_KILL_TOLERANCE,
	HULL_PRINT_STEP,
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
	isCrippled,
	printHull,
	printHullPercent,
	sideStruck,
	stepCondition,
} from "../src/ship-condition";
import { v3 } from "../src/vec3";
import { walkDownToKill } from "./helpers/pulse-walk";

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

describe("what a ship has to be to be dead (#367 D1)", () => {
	test("the print rounds to its step, and the tolerance is half of it", () => {
		// The helper itself, so a change to it is caught where the law reads it
		// rather than only where a readout happens to notice.
		expect(printHull(HULL_PRINT_STEP * 0.6)).toBe(1);
		expect(printHull(HULL_PRINT_STEP * 0.4)).toBe(0);
		// A tick-shaped tolerance is `damagePerS × dt`, and #352 made dt move with
		// frame cost. This one is a property of the glass, not of the step.
		expect(HULL_KILL_TOLERANCE).toBe(HULL_PRINT_STEP / 2);
	});

	test("a strike leaving less than half the print step finishes the ship", () => {
		const wounded = {
			...fullCondition("courier"),
			fore: 0,
			aft: 0,
			hull: HULL_KILL_TOLERANCE + 0.1,
		};
		const after = applyDamage(wounded, 0.2, "fore");
		expect(after.hull).toBe(0);
		expect(isAlive(after)).toBe(false);
	});

	test("a hull left exactly at the tolerance is alive, and prints a digit", () => {
		const wounded = {
			...fullCondition("courier"),
			fore: 0,
			aft: 0,
			hull: HULL_KILL_TOLERANCE * 2,
		};
		const after = applyDamage(wounded, HULL_KILL_TOLERANCE, "fore");
		expect(after.hull).toBe(HULL_KILL_TOLERANCE);
		expect(isAlive(after)).toBe(true);
		expect(Math.round(after.hull)).toBeGreaterThanOrEqual(1);
	});

	test("no hull the funnel leaves standing is small enough to print 0, on every hull", () => {
		// The law in one place, so no consumer re-derives a threshold. Driven with
		// one pulse tick at a time, which is how a duel walks a hull down.
		for (const id of HULL_IDS) {
			const walk = walkDownToKill(fullCondition(id));
			const c = walk.at(-1) as ShipCondition;
			const smallestLive = Math.min(...walk.filter(isAlive).map((s) => s.hull));
			expect(c.hull).toBe(0);
			expect(smallestLive).toBeGreaterThanOrEqual(HULL_KILL_TOLERANCE);
			// The print, not a number: a hull left standing has to be able to show
			// a digit, which is the whole of D1 in one line.
			expect(printHull(smallestLive)).toBeGreaterThanOrEqual(1);
		}
	});
});

// ---------------------------------------------------------------------------
// #395. The selected target's line prints a hull as a share of its own capacity,
// because a bare 215 is whole on a miner and impossible on a freighter and the
// glass never says which hull it is looking at. The principal's ruling is that
// the percentage carries #367 D1 with it: "anything below 0.5% is the same as
// 0.5 points in terms of how the game works", so a hull that would round under
// half a percent reads 1% and is alive, and 0% means dead.
// ---------------------------------------------------------------------------
describe("a hull printed as a share of its own hull (#395)", () => {
	test("a whole hull is 100% on every hull in the roster", () => {
		for (const id of HULL_IDS)
			expect(printHullPercent(fullCondition(id))).toBe(100);
	});

	test("a share is not clamped at the top, and that is the loud direction", () => {
		// The title used to claim nothing prints more than 100% and only ever
		// measured hulls at exactly capacity, which is a claim about a case it never
		// built. There is **no** upper clamp, and the honesty of that is the point:
		// a `hull` above `hullMax` is a broken invariant, not a display case, and
		// `HULL 104%` is the symptom reaching the glass where a pilot can see it.
		// Clamping here would be a formatter quietly covering for whatever wrote the
		// figure, which is the silence `printHullPercent` exists to avoid. Nothing in
		// the game reaches this: `applyDamage` is the writer and cannot raise a hull
		// past its capacity.
		expect(
			printHullPercent({
				...fullCondition("raider"),
				hull: fullCondition("raider").hullMax * 1.04,
			}),
		).toBe(104);
	});

	test("the share is of its own hull, not of the largest one in the game", () => {
		// The whole point of the form: two hulls two and a half thousand points
		// apart, at the same share, read the same. `carrier` at 2635 against
		// `courier` at 100 is the case that would read 4% if the denominator were
		// a constant.
		const half = (id: HullId): number =>
			printHullPercent({
				...fullCondition(id),
				hull: HULL_SPECS[id].integrity / 2,
			});
		expect(half("courier")).toBe(50);
		expect(half("carrier")).toBe(50);
		expect(half("miner")).toBe(50);
	});

	test("a dead hull prints 0%, and no hull the funnel leaves standing does", () => {
		for (const id of HULL_IDS) {
			const walk = walkDownToKill(fullCondition(id));
			const dead = walk.at(-1) as ShipCondition;
			expect(isAlive(dead)).toBe(false);
			expect(printHullPercent(dead)).toBe(0);
			// Every live state on the walk, not just the smallest: the band is
			// where this law lives, and the walk is what puts states inside it.
			for (const c of walk.filter(isAlive))
				expect(printHullPercent(c)).toBeGreaterThanOrEqual(1);
		}
	});

	test("under half a percent a hull still standing reads 1%, not 0%", () => {
		// Hand-built, because the funnel cannot put a live hull this low: it
		// zeroes anything under half a *point*, which on a 2635-point capital
		// leaves a band 0.019% wide that the print must survive on its own.
		// This is the case the point form cannot make honest — `printHull`'s floor
		// is in points, so a live capital at 0.4 points prints 0. A share is a
		// strictly better reading of D1 than a point figure ever was, and it holds
		// for a fixture the shipped tolerance deliberately does not reach.
		const band = (id: HullId): number =>
			printHullPercent({
				...fullCondition(id),
				hull: HULL_SPECS[id].integrity * 0.004,
			});
		for (const id of HULL_IDS) expect(band(id)).toBe(1);
	});

	test("it is monotone in hull, so the glass cannot heal by rounding", () => {
		// A reading that fell and then rose again while the hull only ever went
		// down would be a new lie of the same shape as D1's.
		for (const id of HULL_IDS) {
			let last = 101;
			for (const c of walkDownToKill(fullCondition(id))) {
				const printed = printHullPercent(c);
				expect(printed).toBeLessThanOrEqual(last);
				last = printed;
			}
		}
	});
});

describe("a crippled ship does not rebuild shields (#367 D2)", () => {
	const crippled = (id: HullId, over: Partial<ShipCondition> = {}) => ({
		...fullCondition(id),
		fore: 10,
		aft: 10,
		hull: CRIPPLED_HULL_FRACTION * HULL_SPECS[id].integrity - 0.1,
		// Past the delay, so the delay is not what is being measured.
		sinceStruckS: SHIELD_RECHARGE_DELAY_S,
		...over,
	});

	test("the share is the principal's figure, and its own", () => {
		// Not `FLEE_HULL_FRACTION`: that is the controller's nerve, this is the
		// repair law. A literal here because a retune is a ruling, not a drift.
		expect(CRIPPLED_HULL_FRACTION).toBe(0.25);
	});

	test("below the share the bank buys no shields, and just above it still does", () => {
		expect(isCrippled(crippled("courier"))).toBe(true);
		expect(run(crippled("courier"), 5, false).condition.fore).toBe(10);
		const sound = crippled("courier", {
			hull: CRIPPLED_HULL_FRACTION * HULL_SPECS.courier.integrity + 0.1,
		});
		expect(isCrippled(sound)).toBe(false);
		expect(run(sound, 5, false).condition.fore).toBeGreaterThan(10);
	});

	test("it is every hull's law at that hull's own scale", () => {
		for (const id of HULL_IDS) {
			const c = crippled(id, { fore: 0, aft: 0 });
			expect(isCrippled(c)).toBe(true);
			const after = run(c, 10, false).condition;
			expect(after.fore).toBe(0);
			expect(after.aft).toBe(0);
		}
	});

	test("the raider of the playtest stops rebuilding at 20.25 of its 81", () => {
		// The reported reading was `SHD F 22 A 22 HULL 0` — 22 points recovered on
		// each pool out of a hull that should not have had a bank at all.
		expect(CRIPPLED_HULL_FRACTION * HULL_SPECS.raider.integrity).toBeCloseTo(
			20.25,
			9,
		);
		expect(run(crippled("raider"), 22, false).condition.fore).toBe(10);
	});

	test("a crippled ship still shoots, still spends the bank and still cools", () => {
		// The gate is on recovery, not on the fight. A crippled ship that could not
		// fire is a ship that cannot leave, and #367 is about those.
		const c = crippled("courier", { fore: 0, aft: 0 });
		const { condition, delivered } = run(c, 1, true);
		expect(delivered).toBeGreaterThan(0);
		expect(condition.heat).toBeGreaterThan(0);
		expect(condition.energy).toBeLessThan(ENERGY_BANK);
	});

	test("being crippled does not stop damage landing", () => {
		const c = crippled("courier", { fore: 0, aft: 0 });
		const after = applyDamage(c, 5, "fore");
		expect(after.hull).toBeCloseTo(c.hull - 5, 9);
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
