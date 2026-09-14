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
import { HULL_SPECS, type HullId } from "./hull";
import { type Vec3, dot } from "./vec3";

/** Each shield pool's capacity. #48's tuned figure. */
export const SHIELD_POOL = 106;
/** The shared energy bank's capacity. */
export const ENERGY_BANK = 100;
/** Laser heat at which the gun locks. */
export const HEAT_LOCK = 100;
/** Heat a locked gun must cool to before it fires again. */
export const HEAT_RELEASE = HEAT_LOCK * 0.5;

/** §2's starter weapon. Rates per second of sim time. */
export const PULSE_LASER = {
	damagePerS: 6,
	energyPerS: 1,
	heatPerS: 1.5,
} as const;

/** Bank regeneration and gun cooling, both only while the gun is not firing. */
export const ENERGY_REGEN_PER_S = 12;
export const HEAT_COOL_PER_S = 16;

export const SHIELD_RECHARGE_PER_S = 6;
/**
 * How long a struck ship's shields stay down. #48 found it necessary: with
 * recharge equal to the pulse's damage rate, intermittent fire never landed.
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

export type ShieldSide = "fore" | "aft";

export interface ShipCondition {
	fore: number;
	aft: number;
	hull: number;
	/** The flown hull's `integrity`. Carried so a condition needs no hull id. */
	hullMax: number;
	energy: number;
	heat: number;
	heatLocked: boolean;
	/** Sim seconds since the last hit; gates the shield recharge. */
	sinceStruckS: number;
}

export function fullCondition(hull: HullId): ShipCondition {
	const hullMax = HULL_SPECS[hull].integrity;
	return {
		fore: SHIELD_POOL,
		aft: SHIELD_POOL,
		hull: hullMax,
		hullMax,
		energy: ENERGY_BANK,
		heat: 0,
		heatLocked: false,
		// Clear of the delay, so a fresh ship recharges rather than spending its
		// first seconds recovering from a hit it never took.
		sinceStruckS: SHIELD_RECHARGE_DELAY_S,
	};
}

export const isAlive = (c: ShipCondition): boolean => c.hull > 0;

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

/** Damage into one pool; what the pool cannot absorb goes to hull. */
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
		hull: Math.max(0, c.hull - (hit - absorbed)),
		sinceStruckS: hit > 0 ? 0 : c.sinceStruckS,
	};
}

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
 * Order: the shield recharge draws first, then the gun fires from what is
 * left, then an idle gun cools and the bank regenerates. So a ship that holds
 * the trigger while recovering pays for both, which is §2's competition.
 */
export function stepCondition(
	c: ShipCondition,
	dt: number,
	trigger: boolean,
): ConditionStep {
	const step = Math.max(0, dt);
	const next = { ...c, sinceStruckS: c.sinceStruckS + step };

	if (c.sinceStruckS >= SHIELD_RECHARGE_DELAY_S) {
		const lower: ShieldSide = next.fore <= next.aft ? "fore" : "aft";
		const wanted = Math.min(
			SHIELD_RECHARGE_PER_S * step,
			SHIELD_POOL - next[lower],
		);
		const points = Math.min(
			wanted,
			next.energy / SHIELD_RECHARGE_ENERGY_PER_POINT,
		);
		next[lower] += points;
		next.energy -= points * SHIELD_RECHARGE_ENERGY_PER_POINT;
	}

	const cost = PULSE_LASER.energyPerS * step;
	// A gun at the ceiling is locked on the step it reaches it, not the step
	// after — the flag is only the hysteresis on the way back down.
	const locked = c.heatLocked || c.heat >= HEAT_LOCK;
	const fired = trigger && !locked && next.energy >= cost && cost > 0;
	let damage = 0;
	if (fired) {
		next.energy -= cost;
		next.heat = clamp(next.heat + PULSE_LASER.heatPerS * step, HEAT_LOCK);
		damage = PULSE_LASER.damagePerS * step;
	} else {
		next.energy = clamp(next.energy + ENERGY_REGEN_PER_S * step, ENERGY_BANK);
		next.heat = clamp(next.heat - HEAT_COOL_PER_S * step, HEAT_LOCK);
	}
	next.heatLocked =
		next.heat >= HEAT_LOCK || (locked && next.heat > HEAT_RELEASE);
	return { condition: next, fired, damage };
}
