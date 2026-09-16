/**
 * Firing a pulse laser at a ship, one frame at a time.
 *
 * **One body, three former copies.** `tests/duel-hud.test.ts` walked a hull down
 * to the kill to ask what the glass printed on the way, and
 * `tests/ship-condition.test.ts` walked one to ask whether the kill arrived and
 * another to ask what eighteen seconds of recharging under fire amounts to. Same
 * weapon, same cadence, same funnel, written three times — so a change to any one
 * of them (the frame time, which shot is fired, whether a dead ship is stepped
 * again) would leave the others measuring a different fight with nothing going
 * red. #367's D1 rows are the reason all three exist.
 *
 * **The cadence is the game's, not a round number.** 1/60 is a frame at the
 * default refresh, and the band #367 is about is five frames wide at the pulse's
 * rate — measure at another cadence and the band is a different number of steps.
 */
import {
	applyDamage,
	isAlive,
	SHIELD_POOL,
	type ShipCondition,
} from "../../src/ship-condition";
import { PULSE_LASER } from "../../src/ship-condition";

export const PULSE_STEP_S = 1 / 60;

/** One frame of the pulse, which is what `applyDamage` is asked for per step. */
const PULSE_TICK = PULSE_LASER.damagePerS * PULSE_STEP_S;

/**
 * Fire until `isOpen` calls the ship dead, and hand back every condition the
 * funnel produced, in order.
 *
 * **The law is a parameter, and that is the row's whole power.** #367's defect
 * was a ship the law let live and the glass called dead — a state the shipped law
 * never produces. Walking under the *old* one (`hull > 0`) manufactures it, so a
 * readout can be shown lying and the check that catches it can be seen red. The
 * default is the shipped law, which is what every row about the game itself uses.
 */
function fireUntil(
	start: ShipCondition,
	isOpen: (c: ShipCondition) => boolean,
): ShipCondition[] {
	const seen: ShipCondition[] = [];
	let c = start;
	// Enough frames to spend both pools and the hull at the pulse's tick, with a
	// margin for a ship that starts wounded. **A fixed budget is a wrong
	// answer**: a thousand steps is more than a courier needs and far less than a
	// dreadnought's, and the walk used to stop with the ship alive and hand back
	// a last state that was not a kill — the row reading it went red on a tree
	// with nothing wrong but the budget.
	const budget =
		Math.ceil((start.hullMax * 3 + SHIELD_POOL * 2) / PULSE_TICK) + 8;
	for (let i = 0; i < budget && isOpen(c); i++) {
		c = applyDamage(c, PULSE_TICK, "fore");
		seen.push(c);
	}
	if (seen.length === budget && isOpen(c))
		throw new Error(
			`the walk survived ${budget} steps at hull ${c.hull}; the walk is not a duel`,
		);
	return seen;
}

/** The shipped law's own predicate, spelled once so no caller re-derives it and
 *  the default cannot quietly become the old one. */
const aliveNow = (c: ShipCondition): boolean => isAlive(c);

/** Every condition the funnel hands on as a duel walks this hull down. Pass a
 *  predicate to walk under some other law. */
export const walkDownToKill = (
	start: ShipCondition,
	isOpen: (c: ShipCondition) => boolean = aliveNow,
): ShipCondition[] => fireUntil(start, isOpen);

/** The same walk under the law before #367: alive at any hull above nothing.
 *  This is the only way a test can put a live ship under half a point in front of
 *  the glass, which is the reading the playtest reported. */
export const walkDownUnderTheOldLaw = (start: ShipCondition): ShipCondition[] =>
	fireUntil(start, (c) => c.hull > 0);
