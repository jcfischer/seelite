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
import { fittedCapacity, moduleRow, type Loadout } from "./loadout";
import { PULSE_LASER } from "./ship-condition";
import { ARMED_TRAFFIC_HULLS } from "./traffic-engagement";

/** AI skill, S's third factor. 1 for every ship today (#562 D3): S is derived
 *  from stats, and a learned skill is #563's fog. */
const AI_SKILL = 1;
/** The most a kill pays, reached when the own fit has no combat DPS:
 *  a matched kill pays 2·S/(S+S) = 1. */
const CREDIT_K = 2;

/**
 * The ship the pilot flies, as far as strength reads it.
 *
 * **The fitted ship, not the hull** (#562 D3): a weapon upgrade raises S_own.
 * Every fitted combat laser counts, regardless of the armed fire group.
 * Mining lasers and carried fittings add no combat strength (#870).
 */
export interface FittedShip {
	hull: HullId;
	loadout: Loadout;
}

export const fittedDps = (ship: FittedShip): number =>
	HULL_SPECS[ship.hull].slots.reduce((dps, slot) => {
		const m = ship.loadout[slot.key];
		return (
			dps +
			(slot.kind === "hardpoint" &&
			m &&
			(m.module === "pulse-laser" ||
				m.module === "beam-laser" ||
				m.module === "military-laser")
				? moduleRow(m).output.damagePerS
				: 0)
		);
	}, 0);

/** Whether a hull fires when it is a target: Traffic's armed hulls and the
 *  raider. Every other hull never fires (`traffic-engagement.ts`, H3). */
export const isArmedTarget = (hull: HullId): boolean =>
	ARMED_TRAFFIC_HULLS.has(hull) || hull === "raider";

/**
 * S = effective HP × DPS × AI skill (#562 D3). Effective HP is one shield pool
 * plus integrity. A fit without combat lasers has zero strength.
 */
const strengthOf = (effectiveHp: number, dps: number): number =>
	effectiveHp * dps * AI_SKILL;

/** The pilot's S reads the fitted defence (#927, extending #867 D17 from
 *  lasers to defence): a plate or a booster raises it as a laser does. */
export const strength = (ship: FittedShip): number => {
	const { shieldPool, integrity } = fittedCapacity(ship.hull, ship.loadout);
	return strengthOf(shieldPool + integrity, fittedDps(ship));
};

/** A target's S: zero when it never fires (#562 D4). */
export const targetStrength = (hull: HullId): number =>
	isArmedTarget(hull)
		? strengthOf(
				HULL_SPECS[hull].shieldPool + HULL_SPECS[hull].integrity,
				PULSE_LASER.damagePerS,
			)
		: 0;

/**
 * What one kill pays: 2·S_target / (S_own + S_target) (#562 D3). The curve is
 * its own clamp — a matched kill pays 1, at most 2, and a much weaker target
 * pays close to 0. An unarmed target pays exactly 0 (#562 D4); it still pays
 * in cargo, bounty and heat, which are not this ladder's.
 */
export const killCredit = (own: FittedShip, target: HullId): number => {
	const st = targetStrength(target);
	if (st === 0) return 0;
	return (CREDIT_K * st) / (strength(own) + st);
};
