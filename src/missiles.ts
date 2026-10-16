/** Missile and E.C.M. rules for both sides of a fight (node #874).
 * Flight state is transient; ammunition lives only on the saved fitted rack. */
import { HULL_SPECS } from "./hull";
import { type Loadout, makeModule, moduleRow, stockLoadout } from "./loadout";
import { gradeOutputScale } from "./module-catalog";
import { mix } from "./rng";
import { DOMAIN } from "./domains";
import {
	type Vec3,
	add,
	sub,
	scale,
	dot,
	length,
	lengthSq,
	normalizeOr,
	cross,
	frameAcross,
	rotateAbout,
	clamp,
} from "./vec3";

/** Initial combat tuning: a light ship loses its facing and hull to one hit;
 * a larger hull survives. Seekers have finite turn authority and lifetime. */
export const MISSILE = {
	lockS: 1.5,
	coneRad: (12 * Math.PI) / 180,
	rangeKm: 12,
	speedKms: 6,
	turnRadPerS: 0.8,
	seekerConeRad: (80 * Math.PI) / 180,
	lifetimeS: 12,
	damage: 240,
} as const;
/** One pulse consumes one second of the catalogue's active draw. The cost
 * is reserved at the press, so a low bank cannot buy a free partial pulse. */
export const ECM_PULSE_S = 1;
export const ECM_BASE_COOLDOWN_S = 8;
export interface MissileLock {
	targetId: string | null;
	seconds: number;
}
export interface MissileTarget {
	id: string;
	pos: Vec3;
	vel: Vec3;
	radiusKm: number;
}
export interface Missile {
	targetId: string;
	pos: Vec3;
	nose: Vec3;
	leftS: number;
}
export function acquireMissileLock(
	lock: MissileLock | null,
	targetId: string | null,
	visibleInCone: boolean,
	dt: number,
): MissileLock {
	return {
		targetId,
		seconds:
			targetId && visibleInCone
				? Math.min(
						MISSILE.lockS,
						(lock?.targetId === targetId ? lock.seconds : 0) + Math.max(0, dt),
					)
				: 0,
	};
}
export const missileAmmo = (loadout: Loadout): number =>
	Object.values(loadout).reduce(
		(n, m) => n + (m.module === "missile-rack" ? (m.ammo ?? 0) : 0),
		0,
	);
export function launchMissile(
	loadout: Loadout,
	lock: MissileLock | null,
	target: MissileTarget,
	pos: Vec3,
	nose: Vec3,
): { loadout: Loadout; missile: Missile } | null {
	if (lock?.targetId !== target.id || lock.seconds < MISSILE.lockS) return null;
	const rack = Object.entries(loadout)
		.sort(([a], [b]) => a.localeCompare(b))
		.find(([, m]) => m.module === "missile-rack" && (m.ammo ?? 0) > 0);
	if (!rack) return null;
	const [slot, m] = rack;
	return {
		loadout: { ...loadout, [slot]: { ...m, ammo: m.ammo! - 1 } },
		missile: {
			targetId: target.id,
			pos: { ...pos },
			nose: normalizeOr(nose, { x: 0, y: 0, z: -1 }),
			leftS: MISSILE.lifetimeS,
		},
	};
}
/** The lock caller supplies visibility (including solids) as well as the
 * cone. This shared geometric half does not know a world or a renderer. */
export function missileInCone(
	origin: Vec3,
	nose: Vec3,
	target: MissileTarget,
): boolean {
	const offset = sub(target.pos, origin),
		km = length(offset);
	return (
		km > 0 &&
		km <= MISSILE.rangeKm &&
		dot(normalizeOr(nose, nose), scale(offset, 1 / km)) >=
			Math.cos(MISSILE.coneRad)
	);
}
/** Seeker moves in the fight's translating frame. Sweeping relative to the
 * target across the step prevents a small hull being skipped between ticks. */
export function stepMissile(
	m: Missile,
	target: MissileTarget | null,
	frameVelocity: Vec3,
	dt: number,
): { missile: Missile | null; hit: boolean } {
	if (!target || target.id !== m.targetId || m.leftS <= 0 || !(dt > 0))
		return { missile: dt > 0 ? null : m, hit: false };
	const offset = sub(target.pos, m.pos),
		gap = length(offset);
	if (gap <= target.radiusKm) return { missile: null, hit: true };
	const wanted = normalizeOr(offset, m.nose);
	const angle = Math.acos(clamp(dot(m.nose, wanted), -1, 1));
	if (angle > MISSILE.seekerConeRad) return { missile: null, hit: false };
	const nose =
		angle === 0
			? m.nose
			: rotateAbout(
					m.nose,
					normalizeOr(cross(m.nose, wanted), frameAcross(m.nose)),
					Math.min(angle, MISSILE.turnRadPerS * dt),
				);
	const stepS = Math.min(dt, m.leftS);
	const velocity = add(frameVelocity, scale(nose, MISSILE.speedKms));
	const relativeStep = scale(sub(velocity, target.vel), stepS);
	const t =
		lengthSq(relativeStep) > 0
			? clamp(dot(offset, relativeStep) / lengthSq(relativeStep), 0, 1)
			: 0;
	if (length(sub(offset, scale(relativeStep, t))) <= target.radiusKm)
		return { missile: null, hit: true };
	return {
		missile:
			m.leftS <= dt
				? null
				: {
						...m,
						nose,
						pos: add(m.pos, scale(velocity, stepS)),
						leftS: m.leftS - dt,
					},
		hit: false,
	};
}
export function fittedEcm(loadout: Loadout) {
	// Independent modules do not multiply the radius or bypass a pulse cooldown.
	const modules = Object.entries(loadout)
		.filter(([, m]) => m.module === "ecm")
		.sort(
			([ka, a], [kb, b]) =>
				moduleRow(b).output.radiusKm - moduleRow(a).output.radiusKm ||
				ka.localeCompare(kb),
		);
	const module = modules[0]?.[1];
	return module
		? {
				radiusKm: moduleRow(module).output.radiusKm,
				cooldownS: ECM_BASE_COOLDOWN_S / gradeOutputScale(module.grade),
				drawPerS: moduleRow(module).drawPerS,
			}
		: { radiusKm: 0, cooldownS: 0, drawPerS: 0 };
}
export function pulseEcm(
	loadout: Loadout,
	energy: number,
	readyAt: number,
	now: number,
	defenderId: string,
	pos: Vec3,
	missiles: readonly Missile[],
) {
	const ecm = fittedEcm(loadout),
		cost = ecm.drawPerS * ECM_PULSE_S;
	if (!ecm.radiusKm || now < readyAt || energy < cost)
		return { fired: false, energy, readyAt, missiles };
	return {
		fired: true,
		energy: energy - cost,
		readyAt: now + ecm.cooldownS,
		missiles: missiles.filter(
			(m) =>
				m.targetId !== defenderId || length(sub(m.pos, pos)) > ecm.radiusKm,
		),
	};
}
/** The missile-bearing part of D16: a stable draw on its own tag, preserving
 * the stock gun. Broader NPC grades and salvage remain their own work. */
export function seededRaiderLoadout(seed: number): Loadout {
	const stock = stockLoadout("raider");
	if (mix(seed, DOMAIN.RAIDER_MISSILE_FIT) / 0x1_0000_0000 >= 0.35)
		return stock;
	const slot = HULL_SPECS.raider.slots.find(
		(s) => s.kind === "hardpoint" && !stock[s.key],
	);
	return slot
		? { ...stock, [slot.key]: makeModule("missile-rack", slot.size) }
		: stock;
}
