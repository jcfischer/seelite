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
 * state that comes out of `applyDamage`, which is every state the game itself
 * reaches. A script that hand-builds a condition at `hull: 0.01` — three of them
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
	"fore" | "aft" | "hull" | "hullMax"
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
 * cannot print 0 for a live ship *because `applyDamage` is the one writer and it
 * zeroes hull below `HULL_KILL_TOLERANCE`*: the guarantee lives in the writer,
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
 * The one place hull is spent, and so the one place that decides a ship is
 * finished — see `HULL_KILL_TOLERANCE`.
 */
export function applyDamage(
	c: ShipCondition,
	amount: number,
	side: ShieldSide,
): ShipCondition {
	const hit = Math.max(0, amount);
	const absorbed = Math.min(c[side], hit);
	const hull = c.hull - (hit - absorbed);
	return {
		...c,
		[side]: c[side] - absorbed,
		hull: hull < HULL_KILL_TOLERANCE ? 0 : hull,
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
 *
 * A crippled ship is the exception to the first of those: its bank does not buy
 * shields at all (`CRIPPLED_HULL_FRACTION`). Its gun still fires, still spends
 * the bank and still cools — the gate is on recovery, not on the fight.
 */
export function stepCondition(
	c: ShipCondition,
	dt: number,
	trigger: boolean,
): ConditionStep {
	const step = Math.max(0, dt);
	const next = { ...c, sinceStruckS: c.sinceStruckS + step };

	if (c.sinceStruckS >= SHIELD_RECHARGE_DELAY_S && !isCrippled(c)) {
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
