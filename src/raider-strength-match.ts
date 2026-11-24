import { MERGE_BREAK_KM } from "./combat-enemy";
import { combatFit } from "./duel";
import { HULL_SPECS } from "./hull";
import { RAIDER_HULL_ID } from "./raider-slots";
import {
	type FittedModule,
	type Loadout,
	fittedCapacity,
	makeModule,
	moduleFits,
	stockLoadout,
} from "./loadout";
import { type FittedShip, strength } from "./kill-credit";
import { MISSILE, missileAmmo } from "./missiles";
import { npcLoadout } from "./npc-loadout";
import {
	applyDamage,
	fullCondition,
	isAlive,
	stepCondition,
} from "./ship-condition";

export const RAIDER_STRENGTH_CEILING = 1.5;
export const SURVIVAL_MIN_S = 20;
export const STARTER_SURVIVAL_MAX_S = 45;
export const SURVIVAL_STEP_S = 1 / 60;
export const SURVIVAL_HORIZON_S = 600;
export const FIRST_MISSILE_LAUNCH_S = 8;
export const MISSILE_RELAUNCH_S = 8;
export const EARLIEST_MISSILE_FLIGHT_S = MERGE_BREAK_KM / MISSILE.speedKms;

const LASERS = new Set(["pulse-laser", "beam-laser", "military-laser"]);
const isLaser = (m: FittedModule) => LASERS.has(m.module);

export const stockCourierShip = (): FittedShip => ({
	hull: "courier",
	loadout: stockLoadout("courier"),
});

export const snapshotFit = (ship: FittedShip): FittedShip => ({
	hull: ship.hull,
	loadout: Object.fromEntries(
		Object.entries(ship.loadout).map(([key, m]) => [key, { ...m }]),
	),
});

export const matchingStrength = (pilot: FittedShip): number =>
	Math.max(strength(pilot), strength(stockCourierShip()));

export const strengthCeiling = (pilot: FittedShip): number =>
	RAIDER_STRENGTH_CEILING * matchingStrength(pilot);

const effectiveHp = (ship: FittedShip): number => {
	const c = fittedCapacity(ship.hull, ship.loadout);
	return c.shieldPool + c.integrity;
};

/** The pilot is no tougher than the stock courier, so the starter window's
 *  upper limit applies as well as its floor. */
export const isStarterPilot = (pilot: FittedShip): boolean => {
	const stock = stockCourierShip();
	return (
		strength(pilot) <= strength(stock) &&
		effectiveHp(pilot) <= effectiveHp(stock)
	);
};

export const hasRack = (loadout: Loadout): boolean =>
	Object.values(loadout).some((m) => m.module === "missile-rack");

/**
 * Seconds until `target` is destroyed by `raider`'s fit under uninterrupted
 * fore hits, a fresh target and no evasion, at 60 Hz. The raider's gun spends
 * its own bank and heat through `stepCondition`; its racks launch at the duel's
 * cadence (first at `FIRST_MISSILE_LAUNCH_S`, one in flight, one every
 * `MISSILE_RELAUNCH_S`) and land after the earliest legal flight. Infinity past
 * the horizon.
 */
export function survivalSeconds(raider: Loadout, target: FittedShip): number {
	const rates = combatFit(RAIDER_HULL_ID, raider).laserRates;
	let gun = fullCondition(
		RAIDER_HULL_ID,
		fittedCapacity(RAIDER_HULL_ID, raider),
	);
	let victim = fullCondition(
		target.hull,
		fittedCapacity(target.hull, target.loadout),
	);
	let ammo = missileAmmo(raider);
	const landings: number[] = [];
	let nextLaunch = FIRST_MISSILE_LAUNCH_S;
	const steps = Math.round(SURVIVAL_HORIZON_S / SURVIVAL_STEP_S);
	for (let i = 1; i <= steps; i++) {
		const t = i * SURVIVAL_STEP_S;
		victim = stepCondition(victim, SURVIVAL_STEP_S, false).condition;
		const shot = stepCondition(gun, SURVIVAL_STEP_S, true, rates);
		gun = shot.condition;
		if (shot.fired) victim = applyDamage(victim, shot.damage, "fore");
		if (ammo > 0 && t >= nextLaunch && landings.every((l) => l <= t)) {
			ammo -= 1;
			landings.push(t + EARLIEST_MISSILE_FLIGHT_S);
			nextLaunch = t + MISSILE_RELAUNCH_S;
		}
		while (landings.length && landings[0] <= t) {
			landings.shift();
			victim = applyDamage(victim, MISSILE.damage, "fore");
		}
		if (!isAlive(victim)) return t;
	}
	return Number.POSITIVE_INFINITY;
}

export interface FitVerdict {
	ok: boolean;
	reason: "ok" | "strength" | "rack" | "short" | "long";
	strength: number;
	ceiling: number;
	survivalS: number;
}

export function judgeFit(raider: Loadout, pilot: FittedShip): FitVerdict {
	const ceiling = strengthCeiling(pilot);
	const s = strength({ hull: RAIDER_HULL_ID, loadout: raider });
	const verdict = (
		reason: FitVerdict["reason"],
		survivalS: number,
	): FitVerdict => ({
		ok: reason === "ok",
		reason,
		strength: s,
		ceiling,
		survivalS,
	});
	if (s > ceiling) return verdict("strength", Number.NaN);
	const starter = isStarterPilot(pilot);
	if (starter && hasRack(raider)) return verdict("rack", Number.NaN);
	const survivalS = survivalSeconds(raider, pilot);
	if (survivalS < SURVIVAL_MIN_S) return verdict("short", survivalS);
	if (starter && survivalS > STARTER_SURVIVAL_MAX_S)
		return verdict("long", survivalS);
	return verdict("ok", survivalS);
}

const FLOOR_PROBE = makeModule("pulse-laser", 1);

const HARDPOINTS = HULL_SPECS[RAIDER_HULL_ID].slots.filter(
	(s) => s.kind === "hardpoint",
);

const without = (
	loadout: Loadout,
	drop: (key: string, m: FittedModule) => boolean,
): Loadout =>
	Object.fromEntries(Object.entries(loadout).filter(([k, m]) => !drop(k, m)));

const gradeOf = (loadout: Loadout): FittedModule["grade"] => {
	const lasers = HARDPOINTS.map((s) => loadout[s.key]).filter(
		(m): m is FittedModule => !!m && isLaser(m),
	);
	return lasers[lasers.length - 1]?.grade ?? "E";
};

/**
 * The chain a raider fit is lightened along, strongest first and ending at the
 * floor: one small pulse laser on the stock plant. Racks go first, then every
 * laser but the last hardpoint's, then the floor itself, a small pulse laser
 * of the grade the fit carried.
 */
export function lighteningChain(original: Loadout): Loadout[] {
	const chain: Loadout[] = [original];
	let fit = original;
	if (hasRack(fit)) {
		fit = without(fit, (_, m) => m.module === "missile-rack");
		chain.push(fit);
	}
	const lasers = HARDPOINTS.filter((s) => fit[s.key] && isLaser(fit[s.key]));
	if (lasers.length > 1) {
		const last = lasers[lasers.length - 1].key;
		fit = without(
			fit,
			(k, m) => isLaser(m) && k !== last && HARDPOINTS.some((s) => s.key === k),
		);
		chain.push(fit);
	}
	const floorSlot = HARDPOINTS.find((s) => moduleFits(FLOOR_PROBE, s))!;
	chain.push({
		plant: makeModule("power-plant", HULL_SPECS[RAIDER_HULL_ID].plantSize),
		[floorSlot.key]: makeModule("pulse-laser", 1, gradeOf(original)),
	});
	return chain;
}

export interface RaiderFitSelection {
	loadout: Loadout;
	kept: boolean;
	step: number;
	verdict: FitVerdict;
}

/**
 * The raider's fit for one interdiction: the seeded original when eligible,
 * else the first eligible link of its lightening chain, else the floor.
 */
export function selectRaiderFit(
	seed: number,
	pilot: FittedShip,
): RaiderFitSelection {
	const snapshot = snapshotFit(pilot);
	const chain = lighteningChain(npcLoadout(RAIDER_HULL_ID, seed));
	let last: RaiderFitSelection | undefined;
	for (let step = 0; step < chain.length; step++) {
		const verdict = judgeFit(chain[step], snapshot);
		last = { loadout: chain[step], kept: step === 0, step, verdict };
		if (verdict.ok) return last;
	}
	return last!;
}
