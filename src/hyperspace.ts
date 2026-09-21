/**
 * The jump between systems: what it costs, what refuses it, and the wind-up
 * you are vulnerable inside (`galaxy-generation.md` §8, node #187).
 *
 * ## Why this is its own module
 *
 * The same split `cruise.ts` makes. Everything here is a **pure law with no
 * memory**: the destination is a record, the tank is a number, the wind-up is
 * a value stepped by a `dt` the caller owns. The *session* — which jump is
 * charging right now, how much fuel is left, what cancelled it — belongs to the
 * renderer, beside the drive charge and the cruise regime, and is the half a
 * save file will eventually carry.
 *
 * It imports no Three.js and no DOM, so `tests/hyperspace.test.ts` can replay a
 * wind-up at three frame rates and demand the same answer.
 *
 * ## The tank is `JUMP_RANGE_LY`, and that is a decision
 *
 * §8's table gives one figure for both: the range is 7.0 LY and a full tank is
 * 7.0 LY of fuel. `galaxy.ts` owns it as the **edge predicate for the
 * connectivity graph**, and that docstring records why it is deliberately not
 * derived from the flown hull's `tankLy` — a combat retune of one hull would
 * otherwise regenerate every system's edge set. So the tank is that constant
 * and not `HULL_SPECS[…].tankLy`, which is the same number today by a check in
 * `tests/hull.test.ts`. #185 is the node that makes the router and the spend
 * hull-aware together.
 *
 * **It is not the only name for it, and saying so was wrong** (sage round 2).
 * `market.ts` already exports `FUEL_TANK_LY = HULL_SPECS[PLAYER_BASELINE_HULL].tankLy`
 * and `scripts/lib/greedy-trader.ts` reasons about the tank with that, while
 * this module fills to a range-derived figure. The two are equal today only
 * because `tests/hull.test.ts` asserts the baseline hull's tank is the jump
 * range — and #185 is precisely the node that would make them differ, since it
 * asks whether reachability is a fact about the galaxy or about the ship.
 *
 * So they are two names for two questions that currently have one answer: what
 * a *jump* may cross (a galaxy fact, the connectivity graph's edge predicate)
 * and what a *hull* may carry (a roster fact). #185 is where they part.
 *
 * ## Range is the squared comparison, on purpose
 *
 * `galaxy.ts` says the squared form is the definition, because `√(d²) ≤ 7` and
 * `d² ≤ 49` can disagree for a pair within an ulp of the range. `neighbours`
 * and `isConnected` — which decide what the chart lights and what the router
 * plans — both use it, so a jump gate that rooted first could refuse a system
 * the chart drew inside the shell. One comparison, or the map lies.
 */
import {
	distanceLy,
	JUMP_RANGE_LY,
	type SystemRecord,
	squaredDistanceLy,
} from "./galaxy";

/**
 * §8's wind-up, seconds — **declared here and borrowed by cruise**, which is
 * the direction the specs state it in.
 *
 * `in-system-travel.md` §4: cruise's spool-up "deliberately reuses #6's
 * hyperspace wind-up rule rather than inventing a second escape mechanic: one
 * rule the player learns once, applied in two places". The value shipped inside
 * `main.ts` as cruise's `SPOOL_S` for want of a hyperspace to own it; it is
 * owned here now and `SPOOL_S` reads it, so the two windows cannot drift apart
 * into the second mechanic §4 refuses.
 *
 * Three seconds is #14's flown reading of "a few seconds" — the figure the
 * cruise prototype was judged at, not a new one invented for this node.
 *
 * The **fields** are not shared, only the value. See `JumpCharge`.
 */
export const JUMP_CHARGE_S = 3;

/**
 * The hyperspace tank, light years. See the module docstring for why this is
 * `JUMP_RANGE_LY` rather than the hull's `tankLy`.
 */
export const JUMP_TANK_LY = JUMP_RANGE_LY;

/** Why a jump was refused. Every arm is reachable — see `tests/hyperspace.test.ts`. */
export type JumpRefusal =
	/** The destination is where the ship already is. */
	| "same-system"
	/** A different galaxy. That is the Galactic Hyperdrive (§2), which is a
	 *  different act at a different price and is not built. */
	| "other-galaxy"
	/** Further than §8's 7.0 LY. */
	| "out-of-range"
	/** Inside the range, but the tank does not hold it. */
	| "insufficient-fuel";

/** What a jump will cost, once it is known to be possible. */
export interface JumpPlan {
	to: SystemRecord;
	/** True 3D distance, light years (§8). */
	distanceLy: number;
	/** What the tank is left holding afterwards. */
	fuelLeftLy: number;
}

export type JumpDecision =
	| { ok: true; plan: JumpPlan }
	| { ok: false; refusal: JumpRefusal };

/**
 * Can this ship jump there, and what does it cost?
 *
 * **The order of the refusals is part of the answer.** `same-system` outranks
 * everything because a zero-length jump is free and in range and would
 * otherwise be accepted; `out-of-range` outranks `insufficient-fuel` because a
 * system past the range is not made reachable by refuelling, and a HUD that
 * said "insufficient fuel" about one would send the player to buy fuel they
 * already have.
 *
 * Fuel is spent by **distance**, at 1 LY of tank per LY flown — §8's cost row
 * is 0.2 Cr per 0.1 LY, which is what that light year costs to *buy*
 * (`economy-trade.md` §6.1), not a second consumption rate.
 */
export function planJump(
	from: SystemRecord,
	to: SystemRecord,
	fuelLy: number,
): JumpDecision {
	if (from.galaxy !== to.galaxy) return { ok: false, refusal: "other-galaxy" };
	if (from.index === to.index) return { ok: false, refusal: "same-system" };
	if (squaredDistanceLy(from.pos, to.pos) > JUMP_RANGE_LY * JUMP_RANGE_LY)
		return { ok: false, refusal: "out-of-range" };
	// Rooted only here, for the ~8 systems that got this far — the same trade
	// `neighbours` makes, and the gate above has already been decided on the
	// squared form the chart and the router share.
	const ly = distanceLy(from.pos, to.pos);
	if (ly > fuelLy) return { ok: false, refusal: "insufficient-fuel" };
	return { ok: true, plan: { to, distanceLy: ly, fuelLeftLy: fuelLy - ly } };
}

/**
 * A wind-up in progress, or the idle state.
 *
 * **A field of its own rather than cruise's `spoolLeftS`, though the seconds
 * are the same seconds.** Sharing the countdown would make three couplings
 * silent: `dropOut` zeroes the spool and would cancel a jump nobody asked it
 * to; `engageCruise` refuses while the spool runs and would be refusing for the
 * wrong reason; and the floor strip prints `SPOOL` for cruise's window, which
 * is the wrong word for a commitment that ends in another star system. The
 * *rule* is shared — one wind-up length, `JUMP_CHARGE_S` — and the state is not.
 *
 * The destination rides along because the charge is a commitment to a
 * particular system: a jump that resolved its destination at the *end* of the
 * window would let the player re-aim during the seconds §8 makes them
 * vulnerable for, which is the opposite of what the window is for.
 */
export interface JumpCharge {
	/** The system index being charged for, or `null` when nothing is charging. */
	toIndex: number | null;
	/** Seconds left of `JUMP_CHARGE_S`. Zero exactly when idle. */
	leftS: number;
}

export const idleCharge = (): JumpCharge => ({ toIndex: null, leftS: 0 });

export const charging = (charge: JumpCharge): boolean =>
	charge.toIndex !== null;

/** Begin §8's wind-up towards a system index. */
export const beginCharge = (toIndex: number): JumpCharge => ({
	toIndex,
	leftS: JUMP_CHARGE_S,
});

/**
 * One frame of the wind-up.
 *
 * `fired` is the destination index on the step the countdown reaches zero, and
 * `null` on every other step — so a caller cannot mistake "charging" for
 * "arrived" by reading `leftS === 0`, which is also the idle state.
 *
 * The charge is returned **idle** on the firing step rather than left holding
 * its destination: the jump is the end of the window, and a charge that
 * survived it would fire again on the next frame.
 */
export function stepCharge(
	charge: JumpCharge,
	dt: number,
): { charge: JumpCharge; fired: number | null } {
	if (charge.toIndex === null) return { charge, fired: null };
	const leftS = charge.leftS - dt;
	if (leftS > 0) return { charge: { ...charge, leftS }, fired: null };
	return { charge: idleCharge(), fired: charge.toIndex };
}

/**
 * §8's interruption: **taking damage cancels the charge.**
 *
 * A function rather than an assignment at the call site, because the rule has
 * to be one thing for every later source of damage — #8's combat, a collision,
 * whatever interdiction turns out to be. The renderer routes its single damage
 * site through it (`Game.cancelJumpCharge`), so a second source inherits the
 * rule by calling the same method rather than by remembering it.
 *
 * Idempotent: cancelling an idle charge is the idle charge, so a damage event
 * with no jump running is not a special case a caller has to test for.
 */
export const cancelCharge = (): JumpCharge => idleCharge();
