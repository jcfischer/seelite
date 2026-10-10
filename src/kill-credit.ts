/**
 * What one kill pays on the combat ladder (#562 D3, D4).
 *
 * Its own module rather than `ladder.ts`'s, because it reads the roster, the
 * shield model and Traffic's armed set, and the gate catalogue beside it is read
 * by the station console — a value import of combat into commerce for the sake
 * of one table. `scripts/measure-ladder-rates.ts` imports these, so the
 * instrument that measured the thresholds and the game price a kill with one
 * formula.
 *
 * No DOM and no Three.js.
 */

import { HULL_SPECS, type HullId } from "./hull";
import { PULSE_LASER } from "./ship-condition";
import { ARMED_TRAFFIC_HULLS } from "./traffic-engagement";

/** AI skill, S's third factor. 1 for every ship today (#562 D3): S is derived
 *  from stats, and a learned skill is #563's fog. */
const AI_SKILL = 1;
/** The most a kill pays, reached only against an infinitely stronger target:
 *  a matched kill pays 2·S/(S+S) = 1. */
const CREDIT_K = 2;

/**
 * The ship the pilot flies, as far as strength reads it.
 *
 * **The fitted ship, not the hull** (#562 D3): a weapon upgrade raises S_own.
 * Today every weapon item is inert — hardpoints have no behaviour and the
 * pilot fires one pulse laser whatever is fitted — so `equipment` changes
 * nothing yet. It is on the input so the node that gives a laser behaviour
 * changes `fittedDps` and not every caller.
 */
export interface FittedShip {
	hull: HullId;
	equipment?: readonly string[];
}

const fittedDps = (_ship: FittedShip): number => PULSE_LASER.damagePerS;

/** Whether a hull fires when it is a target: Traffic's armed hulls and the
 *  raider. Every other hull never fires (`traffic-engagement.ts`, H3). */
export const isArmedTarget = (hull: HullId): boolean =>
	ARMED_TRAFFIC_HULLS.has(hull) || hull === "raider";

/**
 * S = effective HP × DPS × AI skill (#562 D3). Effective HP is one side of the
 * hull's own `shieldPool` (#866) plus its integrity. The pilot's own ship is
 * always armed.
 */
const hullStrength = (hull: HullId, dps: number): number =>
	(HULL_SPECS[hull].shieldPool + HULL_SPECS[hull].integrity) * dps * AI_SKILL;

export const strength = (ship: FittedShip): number =>
	hullStrength(ship.hull, fittedDps(ship));

/** A target's S: zero when it never fires (#562 D4). */
export const targetStrength = (hull: HullId): number =>
	isArmedTarget(hull) ? hullStrength(hull, PULSE_LASER.damagePerS) : 0;

/**
 * What one kill pays: 2·S_target / (S_own + S_target) (#562 D3). The curve is
 * its own clamp — a matched kill pays 1, none pays 2, and a much weaker target
 * pays close to 0. An unarmed target pays exactly 0 (#562 D4); it still pays
 * in cargo, bounty and heat, which are not this ladder's.
 */
export const killCredit = (own: FittedShip, target: HullId): number => {
	const st = targetStrength(target);
	if (st === 0) return 0;
	return (CREDIT_K * st) / (strength(own) + st);
};
