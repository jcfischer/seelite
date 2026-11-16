/**
 * A ship's condition — `combat-model.md` §2's fore and aft shields, persistent
 * hull, shared energy bank, laser heat with its lockout, and the forward pulse
 * laser that spends them (node #324 part a).
 *
 * **One condition per ship, stepped by one function.** §1 gives every combat
 * ship the same rules, so there is no player variant and no enemy variant: the
 * throwaway balance model (`combat-prototype.ts`) held both ships in one state
 * object and recharged only the player's shields, which is the asymmetry this
 * module exists not to inherit.
 *
 * No Three.js and no world: sim tier. The laser here is a resource and a damage
 * rate. What it hits is the caller's to decide.
 */
import {
	type FittedCapacity,
	HULL_SPECS,
	type HullId,
	stockPlant,
} from "./hull";
import { type Vec3, dot } from "./vec3";

/** Laser heat at which the gun locks. */
export const HEAT_LOCK = 100;
/** Heat a locked gun must cool to before it fires again. */
export const HEAT_RELEASE = HEAT_LOCK * 0.5;

/** §2's starter weapon. Rates per second of sim time. */
export interface LaserRates {
	readonly damagePerS: number;
	readonly energyPerS: number;
	readonly heatPerS: number;
}

export const PULSE_LASER: LaserRates = {
	damagePerS: 6,
	energyPerS: 1,
	heatPerS: 1.5,
} as const;

/** Gun cooling, only while the gun is not firing. The bank's regeneration is
 *  the power plant's (`ShipCondition.energyRegenPerS`, #866). */
export const HEAT_COOL_PER_S = 16;

/**
 * Shield points recovered per second once the delay below has passed.
 *
 * **Two, by the principal's ruling after the second playtest of #324.** It was
 * #48's 6, equal to the pulse's damage rate, so every hit-free break over the
 * delay refilled a shield as fast as a pilot could take it down, and duels ran
 * "extremely long". The rule is every ship's, so the player's shields also come
 * back slower.
 */
export const SHIELD_RECHARGE_PER_S = 2;
/**
 * How long a struck ship's shields stay down. #48 found it necessary: with
 * recharge then equal to the pulse's damage rate, intermittent fire never
 * landed.
 */
export const SHIELD_RECHARGE_DELAY_S = 3;
/**
 * Energy one recharged shield point costs.
 *
 * **Not tuned by #48.** The prototype recharged shields for free; §2 says the
 * bank recharges them, "so weapon fire and recovery compete". One for one is
 * the plainest reading and is the principal's to retune after a flown duel.
 */
export const SHIELD_RECHARGE_ENERGY_PER_POINT = 1;

/**
 * The step both combat readouts print hull in (`duel-hud.ts`: `Math.round`).
 */
export const HULL_PRINT_STEP = 1;

/**
 * The hull as the Flight console shows it: the print step, rounded.
 *
 * **Every readout that prints hull in points goes through this**, and since #395
 * one of them does not: the line under a selected target's name prints a share
 * through `printHullPercent` below, because a bare 215 is whole on a miner and
 * impossible on a freighter. #367's defect was a hull printed here and a kill
 * decided elsewhere: the cue showed `Math.round` while `isAlive` asked for more
 * than nothing, so a ship at a third of a point was alive and read dead. The
 * kill tolerance below is half the step this function rounds to, so a hull that
 * can print no digit cannot survive a frame. **Not by construction** — the two
 * still ask different questions, one rounds and one compares — and what holds
 * them together is that neither does its own arithmetic. Give either one its own
 * number and the reading comes back.
 */
export const printHull = (hull: number): number =>
	Math.round(hull / HULL_PRINT_STEP) * HULL_PRINT_STEP;

/**
 * A hull too small to print a digit is gone.
 *
 * **Half the print step, by the principal's ruling (#367 D1).** The playtest of
 * 2026-09-16 reported `HULL 0` on a raider that was alive and rebuilding: the
 * kill was `hull > 0` and the glass was `Math.round(hull)`, so every hull under
 * half a point was alive and read dead — a band five frames wide at the pulse's
 * rate, and the last fraction of a duel was harder than the start of it.
 *
 * It is a share of the *print*, not of a tick. The tick is `damagePerS × dt`, so
 * a tick-shaped tolerance would move with the frame time, and #352 made the
 * frame time adaptive. Half the print step reads no `dt` at all, and it is what
 * makes the glass agree with the law rather than merely usually agree with it.
 *
 * It belongs here rather than at each readout so that every consumer — the cue,
 * the console, the duel, the docking bound — agrees without re-deriving it.
 *
 * **Honest bound: the tolerance is in the writer, not in the predicate.**
 * `isAlive` is still `hull > 0`, so the glass and the law are joined for every
 * state that comes out of `applyDamage` or `stepHullTemperature` — both write
 * hull through `settledHull` — which is every state the game itself reaches. A script that hand-builds a condition at `hull: 0.01` — three of them
 * do, to stand a raider on its last point — is alive and prints `HULL 0`. Moving
 * the tolerance into `isAlive` would close that too and would move those three
 * scripts' fixture above the line with it; that is a node of its own, not a line
 * in this one.
 */
export const HULL_KILL_TOLERANCE = HULL_PRINT_STEP / 2;

/**
 * Below this share of a ship's own hull, its Energy bank stops buying shields.
 *
 * **A quarter, by the principal's ruling (#367 D2).** Recharge used to be gated
 * on time alone, so a raider at a third of a point of hull, left unhit for the
 * delay, was rebuilding shields at all — the reading the playtest reported had 22
 * of 106 coming back on each pool. One pulse tick spends 0.1 of a hull, and 3 s
 * without a hit returns 6 points of *shield* — which is why the defect showed on
 * a raider the pilot had stopped landing shots on, and why it made the last
 * fraction of a fight harder than the beginning rather than merely longer.
 *
 * It is every ship's law, so the player's shields stop coming back at the same
 * share. **It is not `FLEE_HULL_FRACTION`, and does not share it**: that is the
 * controller's nerve for when to run, this is the shield-recharge law, which says
 * what a running ship can still recover. Giving them one constant is a coupling neither asked
 * for, and one retune would silently move the other.
 */
export const CRIPPLED_HULL_FRACTION = 0.25;

/**
 * Hull temperature, #930's approved table (the principal, 2026-10-12).
 * `scripts/measure-star-skim.ts` flew it; the resolution comment on #930 says
 * why each figure and not its alternatives. `r` is the distance from the star's
 * centre in units of its radius.
 *
 * Temperature is in units of the top: ambient 0, the top 1.
 */
export const HULL_TEMP_AMBIENT = 0;
export const HULL_TEMP_TOP = 1;
/** The skim band's edge: no heat at or beyond it. */
export const SKIM_BAND_R = 2;
/**
 * Where heat reaches 1: cruise's drop-out shell, `SURFACE_MARGIN` in
 * `cruise.ts`. Restated rather than imported because `cruise` imports `sim`,
 * which imports this module; `tests/hull-temperature.test.ts` holds them equal.
 */
export const SKIM_SHELL_R = 1.05;
/** How fast a hull heats at the shell, in tops per second. */
export const HULL_HEAT_RISE_PER_S = 0.185;
/** The cooling time constant: `dT/dt = rise · h(r) − T / τ`. */
export const HULL_TEMP_COOL_TAU_S = 15;
/** Above the top a hull loses `k · (T − 1)` of its integrity per second. */
export const HULL_HEAT_DAMAGE_PER_S = 0.2;
/**
 * Below this a cooling hull is at ambient.
 *
 * Relaxation never arrives — a hull at 0.004 of the top would wait minutes to
 * underflow, and the gauge shows while the hull is above ambient, so it would
 * sit on the glass reading 1% long after the pass. Half the gauge's print step,
 * which is `HULL_KILL_TOLERANCE`'s rule: a reading too small to print is the
 * reading it rounds to. It applies only outside the band, where nothing heats.
 */
export const HULL_TEMP_SNAP = 0.005;

/**
 * Starlight's heat on a hull at `rOverR`: inverse-square, re-based so it is 1
 * at the shell and inside it and 0 at the band edge and beyond (#930).
 */
export function starHeat(rOverR: number): number {
	const flux = (r: number) => 1 / (r * r);
	const h =
		(flux(rOverR) - flux(SKIM_BAND_R)) /
		(flux(SKIM_SHELL_R) - flux(SKIM_BAND_R));
	return Math.min(1, Math.max(0, h));
}

export type ShieldSide = "fore" | "aft";

export interface ShipCondition {
	fore: number;
	aft: number;
	hull: number;
	/** The flown hull's `integrity`. Carried so a condition needs no hull id. */
	hullMax: number;
	/** Each shield pool's capacity: the hull's `shieldPool` (#866). Carried
	 *  for `hullMax`'s reason. */
	shieldMax: number;
	energy: number;
	/** The energy bank's capacity and its regeneration per second: the fitted
	 *  power plant's and Extra Energy Units' (#867 D3, #925). */
	energyMax: number;
	energyRegenPerS: number;
	/** What the fitted shield boosters draw per second while a pool recharges
	 *  (#927). Carried as a number, as the regen is, so this module needs no
	 *  catalogue. */
	boosterDrawPerS: number;
	heat: number;
	heatLocked: boolean;
	/** Sim seconds since the last hit; gates the shield recharge. */
	sinceStruckS: number;
	/** Hull temperature (#931), in units of the top: ambient 0, the top 1.
	 *  Not laser `heat`, and not Legal heat. `stepHullTemperature` owns it. */
	hullTemp: number;
}

/** The part of `FittedCapacity` a condition reads: the bank and its regen
 *  (#925), and the defence (#927). */
export type ConditionCapacity = Pick<
	FittedCapacity,
	"bankE" | "regenPerS" | "integrity" | "shieldPool" | "boosterDrawPerS"
>;

/** A hull on its stock fit: its stock plant, its own integrity and pool, and
 *  no booster. This is what `fittedCapacity` returns for a stock loadout. */
export function stockCapacity(hull: HullId): ConditionCapacity {
	const { bankE, regenPerS } = stockPlant(hull);
	const { integrity, shieldPool } = HULL_SPECS[hull];
	return { bankE, regenPerS, integrity, shieldPool, boosterDrawPerS: 0 };
}

/**
 * A whole ship. `capacity` is the fitted ship's (`fittedCapacity` in
 * `loadout.ts`, #925, #927), passed as numbers because `module-catalog.ts`
 * imports this module and an import back closes a cycle. Without it the hull
 * flies its stock fit; an outfitted NPC passes its own fitted capacity.
 */
export function fullCondition(
	hull: HullId,
	capacity: ConditionCapacity = stockCapacity(hull),
): ShipCondition {
	const { integrity: hullMax, shieldPool: shieldMax } = capacity;
	return {
		fore: shieldMax,
		aft: shieldMax,
		hull: hullMax,
		hullMax,
		shieldMax,
		energy: capacity.bankE,
		energyMax: capacity.bankE,
		energyRegenPerS: capacity.regenPerS,
		boosterDrawPerS: capacity.boosterDrawPerS,
		heat: 0,
		heatLocked: false,
		// Clear of the delay, so a fresh ship recharges rather than spending its
		// first seconds recovering from a hit it never took.
		sinceStruckS: SHIELD_RECHARGE_DELAY_S,
		hullTemp: HULL_TEMP_AMBIENT,
	};
}

/**
 * The same ship after a refit at a dock (#925, #927). Added capacity arrives
 * charged, as a fitted plate arrives whole (#873): the bank, the hull and each
 * shield pool rise by what was added, so a full one stays full. Removed
 * capacity clamps each to its new maximum. Heat is no module's.
 */
export function refitCondition(
	c: ShipCondition,
	capacity: ConditionCapacity,
): ShipCondition {
	const refilled = (value: number, max: number, nextMax: number) =>
		Math.min(nextMax, value + Math.max(0, nextMax - max));
	return {
		...c,
		energy: refilled(c.energy, c.energyMax, capacity.bankE),
		energyMax: capacity.bankE,
		energyRegenPerS: capacity.regenPerS,
		hull: refilled(c.hull, c.hullMax, capacity.integrity),
		hullMax: capacity.integrity,
		fore: refilled(c.fore, c.shieldMax, capacity.shieldPool),
		aft: refilled(c.aft, c.shieldMax, capacity.shieldPool),
		shieldMax: capacity.shieldPool,
		boosterDrawPerS: capacity.boosterDrawPerS,
	};
}

/**
 * What a print is allowed to look at, and the narrowest type that says so.
 *
 * These are `Pick`s of `ShipCondition` rather than `ShipCondition` itself. The
 * reason is not tidiness: a formatter typed against the whole condition has to be
 * *handed* the whole condition, so every caller — and every test that wants one
 * printed figure — invents fields it never reads, and a field added to the
 * condition for some unrelated reason reaches into every place that only knows how
 * to print. A full `ShipCondition` is still assignable to these, so nothing that
 * holds a real one has to change.
 */
export type HullReading = Pick<ShipCondition, "hull" | "hullMax">;

/** A reading that shows both facings as well as the hull. */
export type ConditionPrint = Pick<
	ShipCondition,
	"fore" | "aft" | "shieldMax" | "hull" | "hullMax"
>;

export const isAlive = (c: HullReading): boolean => c.hull > 0;

/**
 * The hull as a share of its own capacity, in whole percent.
 *
 * **The share form of #367 D1, which is why it asks `isAlive` rather than doing
 * its own arithmetic.** Why the glass prints a share at all is
 * `hud-and-scanner.md` §5.4's, and this module is not a second copy of it: the
 * invariant that lives *here* is that a live hull never prints 0%.
 *
 * The principal's ruling carries D1 across with it: *"anything below 0.5% is the
 * same as 0.5 points in terms of how the game works"*. So the floor on a live
 * hull is one percent, exactly as it is one point, and `0%` means dead.
 *
 * **Where the floor sits moved, which is the whole of the difference — and it is
 * a difference in dependency, not in what a pilot is ever shown.** `printHull`
 * cannot print 0 for a live ship *because its writers, `applyDamage` and
 * `stepHullTemperature`, zero hull below `HULL_KILL_TOLERANCE`*: the guarantee lives in the writer,
 * not in the print, and the note above records what that costs — a condition
 * hand-built under the tolerance is a live ship printing `HULL 0`. The game does
 * not reach that state and nothing here claims it does. What the share changes is
 * that the floor stops being borrowed: it asks `isAlive` and floors at the
 * resolution it prints at, so it holds across a roster whose capacities run 85 to
 * 2635 without resting on a tolerance measured in points, which on a capital is a
 * 0.019% band the print has no digit to express.
 *
 * Rounding is to nearest at both ends, which is what `printHull` does and what
 * the ruling describes: a miner at 214.6 points reads 100%, whole as far as the
 * glass can tell. Only the 0 end carries a law.
 */
export const printHullPercent = (c: HullReading): number =>
	isAlive(c) ? Math.max(1, Math.round((c.hull / c.hullMax) * 100)) : 0;

/**
 * One shield pool as a share of the hull's own pool, in whole percent (#866).
 *
 * Each hull has its own pool since #866, from a raider's 107 to a
 * dreadnought's 3183, so a target's shields print as a share for the reason its
 * hull does (`printHullPercent`): one width across the roster. **0% means the
 * same as it did in points** — the pool rounds to 0 points — so the line is
 * refused at exactly the reading it was refused at before. A pool that still
 * prints a point floors at 1%, which is the hull's floor for the same reason.
 */
export const printShieldPercent = (points: number, max: number): number =>
	Math.round(points) === 0 ? 0 : Math.max(1, Math.round((points / max) * 100));

/**
 * Whether this hull is too broken for the bank to buy shields with.
 *
 * Read off `hullMax`, not off an absolute, so it is the same law for a courier's
 * 100 and a dreadnought's 2402.
 */
export const isCrippled = (c: ShipCondition): boolean =>
	c.hull < CRIPPLED_HULL_FRACTION * c.hullMax;

/**
 * What a head-on hit can reach: the fore shield and the hull.
 *
 * `docking.md` §2.1 bounds a failed entry by "a quarter of the combined pool",
 * written when there was one shield. An entry meets the fore pool, so the aft
 * pool is not part of what it can cost — and counting it would loosen the bound
 * by a whole shield.
 */
export const headOnPool = (c: ShipCondition): number => c.fore + c.hull;

/**
 * The pool a hit selects (§2): fore when the source is ahead of the beam line,
 * aft when it is behind. `toSource` points from the ship toward what hit it;
 * neither vector needs to be unit length.
 */
export function sideStruck(nose: Vec3, toSource: Vec3): ShieldSide {
	return dot(nose, toSource) >= 0 ? "fore" : "aft";
}

/**
 * Damage into one pool; what the pool cannot absorb goes to hull.
 *
 * One of two places hull is spent — `stepHullTemperature` is the other — and
 * both decide a ship is finished by `settledHull`: see `HULL_KILL_TOLERANCE`.
 */
export function applyDamage(
	c: ShipCondition,
	amount: number,
	side: ShieldSide,
): ShipCondition {
	const hit = Math.max(0, amount);
	const absorbed = Math.min(c[side], hit);
	return {
		...c,
		[side]: c[side] - absorbed,
		hull: settledHull(c.hull - (hit - absorbed)),
		sinceStruckS: hit > 0 ? 0 : c.sinceStruckS,
	};
}

/** A hull after a loss: under the kill tolerance it is gone. The one rule for
 *  both writers of hull, `applyDamage` and `stepHullTemperature`. */
const settledHull = (hull: number): number =>
	hull < HULL_KILL_TOLERANCE ? 0 : hull;

export interface ConditionStep {
	condition: ShipCondition;
	/** Whether the gun fired this step. */
	fired: boolean;
	/** Damage the gun delivered this step, for the caller to land on a target. */
	damage: number;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

/**
 * One step of sim time.
 *
 * Order: the shield recharge draws first — a fitted booster's draw, then the
 * points — then the gun fires from what is left, then an idle gun cools and
 * the bank regenerates. So a ship that holds
 * the trigger while recovering pays for both, which is §2's competition.
 *
 * A crippled ship is the exception to the first of those: its bank does not buy
 * shields at all (`CRIPPLED_HULL_FRACTION`). Its gun still fires, still spends
 * the bank and still cools — the gate is on recovery, not on the fight.
 */
export function stepCondition(
	c: ShipCondition,
	dt: number,
	trigger: boolean,
	laser: LaserRates = PULSE_LASER,
): ConditionStep {
	const step = Math.max(0, dt);
	const next = { ...c, sinceStruckS: c.sinceStruckS + step };

	if (c.sinceStruckS >= SHIELD_RECHARGE_DELAY_S && !isCrippled(c)) {
		const lower: ShieldSide = next.fore <= next.aft ? "fore" : "aft";
		// A fitted booster draws only while a pool recharges (#873), and first:
		// the recharge pays its per-point cost from what the draw leaves.
		if (next[lower] < c.shieldMax)
			next.energy -= Math.min(next.energy, c.boosterDrawPerS * step);
		const wanted = Math.min(
			SHIELD_RECHARGE_PER_S * step,
			c.shieldMax - next[lower],
		);
		const points = Math.min(
			wanted,
			next.energy / SHIELD_RECHARGE_ENERGY_PER_POINT,
		);
		next[lower] += points;
		next.energy -= points * SHIELD_RECHARGE_ENERGY_PER_POINT;
	}

	const cost = laser.energyPerS * step;
	// A gun at the ceiling is locked on the step it reaches it, not the step
	// after — the flag is only the hysteresis on the way back down.
	const locked = c.heatLocked || c.heat >= HEAT_LOCK;
	const fired = trigger && !locked && next.energy >= cost && cost > 0;
	let damage = 0;
	if (fired) {
		next.energy -= cost;
		next.heat = clamp(next.heat + laser.heatPerS * step, HEAT_LOCK);
		damage = laser.damagePerS * step;
	} else {
		next.energy = clamp(next.energy + c.energyRegenPerS * step, c.energyMax);
		next.heat = clamp(next.heat - HEAT_COOL_PER_S * step, HEAT_LOCK);
	}
	next.heatLocked =
		next.heat >= HEAT_LOCK || (locked && next.heat > HEAT_RELEASE);
	return { condition: next, fired, damage };
}

/**
 * One step of hull temperature (#931), at `rOverR`: the ship's distance from
 * the star's centre in units of the star's radius.
 *
 * **Distance only.** No regime, no loadout and no hull reach it, so a hull
 * heats alike in normal flight and in cruise (#871 D4), with a fuel scoop or
 * without, on a courier or a capital. It is apart from `stepCondition` because
 * the gun does not read the star and the star does not read the gun: laser heat
 * and hull temperature are two quantities (`CONTEXT.md`).
 *
 * The heat is held over the step and the relaxation is exact, which is the
 * instrument's own `heatStep`, so the table's figures are what the game flies.
 * The loss above the top is the trapezoid of the excess over the step, again
 * the instrument's. It is a share of the hull's own integrity and it takes
 * nothing from the shields; and it is not a hit, so it does not hold the
 * shields' recharge back (`sinceStruckS`).
 */
export function stepHullTemperature(
	c: ShipCondition,
	dt: number,
	rOverR: number,
): ShipCondition {
	if (!(dt > 0)) return c;
	const h = starHeat(rOverR);
	const settle = HULL_HEAT_RISE_PER_S * h * HULL_TEMP_COOL_TAU_S;
	const relaxed =
		settle + (c.hullTemp - settle) * Math.exp(-dt / HULL_TEMP_COOL_TAU_S);
	const hullTemp = Math.max(
		HULL_TEMP_AMBIENT,
		h === 0 && relaxed < HULL_TEMP_SNAP ? HULL_TEMP_AMBIENT : relaxed,
	);
	const excess = Math.max(0, (c.hullTemp + hullTemp) / 2 - HULL_TEMP_TOP);
	const lost = HULL_HEAT_DAMAGE_PER_S * excess * dt * c.hullMax;
	return {
		...c,
		hullTemp,
		hull: lost > 0 ? settledHull(c.hull - lost) : c.hull,
	};
}
