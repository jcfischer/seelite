/**
 * Firing a pulse laser at a ship, one frame at a time.
 *
 * **One body, three former copies.** `tests/duel-hud.test.ts` walked a hull down
 * to the kill to ask what the glass printed on the way, and
 * `tests/ship-condition.test.ts` walked one to ask whether the kill arrived and
 * another to ask what a duel amounts to in points of hull. Same weapon, same
 * cadence, same funnel, written three times — so a change to any one of them (the
 * frame time, which shot is fired, whether a dead ship is stepped again) would
 * leave the others measuring a different fight with nothing going red. #367's D1
 * rows are the reason all three exist.
 *
 * **The cadence is the game's, not a round number.** 1/60 is a frame at the
 * default refresh, and the band #367 is about is five frames wide at the pulse's
 * rate — measure at another cadence and the band is a different number of steps.
 */
import {
	applyDamage,
	isAlive,
	PULSE_LASER,
	SHIELD_POOL,
	type ShipCondition,
} from "../../src/ship-condition";

export const PULSE_STEP_S = 1 / 60;

/** One frame of the pulse, which is what `applyDamage` is asked for per step. */
const PULSE_TICK = PULSE_LASER.damagePerS * PULSE_STEP_S;

/**
 * Every condition the shipped funnel hands on as a duel walks this hull down, in
 * order. The last is the kill.
 *
 * **The funnel is the one the game runs, and that bounds what a row can ask.**
 * #367's tolerance lives inside `applyDamage`, so a walk through it cannot
 * produce the state the defect was — a live ship under half a point. A row that
 * wants that state has to build it, and a row that claims to reach it by firing
 * is claiming something the funnel refuses.
 *
 * **The budget is the ship's, not a constant.** A thousand steps is more than a
 * courier needs and far less than a dreadnought's, and the first version of this
 * stopped with the ship alive and handed back a last state that was not a kill.
 * The row reading that went red on a tree with nothing wrong but the budget. A
 * walk that outlasts its own arithmetic now says so.
 */
export const walkDownToKill = (start: ShipCondition): ShipCondition[] => {
	const seen: ShipCondition[] = [];
	let c = start;
	const budget =
		Math.ceil((start.hullMax * 3 + SHIELD_POOL * 2) / PULSE_TICK) + 8;
	for (let i = 0; i < budget && isAlive(c); i++) {
		c = applyDamage(c, PULSE_TICK, "fore");
		seen.push(c);
	}
	if (seen.length === budget && isAlive(c))
		throw new Error(
			`the walk outlasted ${budget} steps at hull ${c.hull}; a walk that never ends is not a duel`,
		);
	return seen;
};
