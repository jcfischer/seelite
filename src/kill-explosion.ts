/**
 * https://github.com/jcfischer/seelite/issues/1090
 *
 * What a kill shows a pilot: a flash, a fireball and an expanding
 * cloud of debris points, the classic Elite cloud with heat in it.
 *
 * Pure and stateless in time: every point of an explosion is a function of
 * the game clock, the kill's own record and the point's index, so a held clock
 * holds the frame. `kill-explosion-mesh.ts` draws what this returns.
 */
import { fnv1a, mix } from "./rng";
import { type Vec3, add, scale } from "./vec3";

/** One kill, as the moment it happened. Kilometres and seconds. */
export interface KillExplosion {
	key: string;
	at: number;
	pos: Vec3;
	vel: Vec3;
	reachKm: number;
}

/** Debris points in every explosion, whatever the hull. */
export const EXPLOSION_PARTICLES = 96;

/** Fireball points, drawn at the core under the debris. */
export const EXPLOSION_FIREBALL = 12;

/** The flash, the first thing drawn and the first gone, seconds. */
export const EXPLOSION_FLASH_S = 0.3;

/** The fighter whose kill sets the baseline scale, kilometres of reach. */
export const EXPLOSION_BASE_REACH_KM = 0.036;

/** How long an explosion lasts, seconds: longer for a bigger hull. */
export function explosionDurationS(reachKm: number): number {
	const k = Math.sqrt(Math.max(reachKm, 1e-6) / EXPLOSION_BASE_REACH_KM);
	return Math.min(6, 1.8 + 1.2 * k);
}

/** The debris cloud's radius at its end, kilometres. */
export function explosionCloudKm(reachKm: number): number {
	return 6 * reachKm;
}

/** Where the wreck's centre is at `t`: it keeps the velocity it died with. */
export function explosionCentre(e: KillExplosion, t: number): Vec3 {
	return add(e.pos, scale(e.vel, Math.max(0, t - e.at)));
}

/** Is the explosion drawn at `t`? Not before the kill, and not after its end. */
export function explosionLive(e: KillExplosion, t: number): boolean {
	return t >= e.at && t < e.at + explosionDurationS(e.reachKm);
}

/** One drawn point: its offset from the centre, size and linear colour. */
export interface ExplosionPoint {
	offset: [number, number, number];
	sizeKm: number;
	heat: [number, number, number];
}

const unit = (n: number): number => (n >>> 0) / 0x1_0000_0000;

/**
 * The heat ramp a point cools along, `v` from 0 (white) to 1 (dark red),
 * scaled by `k`.
 */
export function explosionHeat(v: number, k: number): [number, number, number] {
	const c = Math.max(0, Math.min(1, v));
	return [
		k * (1 - 0.35 * c),
		k * (1 - 0.55 * c) ** 1.6,
		k * (1 - c) ** 3 * 0.85,
	];
}

/** Total points one explosion draws: the flash, the fireball, the debris. */
export const EXPLOSION_POINTS = 1 + EXPLOSION_FIREBALL + EXPLOSION_PARTICLES;

/**
 * Every point of `e` at game time `t`, flash first, then the fireball, then
 * the debris. Empty when the explosion is not live.
 */
export function explosionPoints(e: KillExplosion, t: number): ExplosionPoint[] {
	if (!explosionLive(e, t)) return [];
	const age = t - e.at;
	const duration = explosionDurationS(e.reachKm);
	const life = age / duration;
	const cloud = explosionCloudKm(e.reachKm);
	const seed = fnv1a(e.key);
	const points: ExplosionPoint[] = [];
	const flash = Math.max(0, 1 - age / EXPLOSION_FLASH_S);
	points.push({
		offset: [0, 0, 0],
		sizeKm: e.reachKm * (2 + 6 * flash),
		heat: explosionHeat(0, 1.4 * flash ** 1.5),
	});
	const ball = Math.min(1, age / (0.35 * duration));
	for (let i = 0; i < EXPLOSION_FIREBALL; i++) {
		const h = mix(seed, 0x51 + i);
		const [x, y, z] = direction(h);
		const r = e.reachKm * 1.2 * ball * unit(mix(h, 3));
		points.push({
			offset: [x * r, y * r, z * r],
			sizeKm: e.reachKm * (1.2 + 2.4 * ball),
			heat: explosionHeat(0.2 + 0.8 * life, (1 - life) ** 1.4),
		});
	}
	const spread = 1 - (1 - life) ** 3;
	for (let i = 0; i < EXPLOSION_PARTICLES; i++) {
		const h = mix(seed, 0x1000 + i);
		const [x, y, z] = direction(h);
		const r = cloud * spread * (0.3 + 0.7 * unit(mix(h, 7)));
		points.push({
			offset: [x * r, y * r, z * r],
			sizeKm: e.reachKm * (0.35 + 0.25 * unit(mix(h, 11))),
			heat: explosionHeat(0.15 + 0.85 * life, (1 - life) ** 1.8),
		});
	}
	return points;
}

const direction = (h: number): [number, number, number] => {
	const z = 2 * unit(mix(h, 1)) - 1;
	const a = 2 * Math.PI * unit(mix(h, 2));
	const s = Math.sqrt(1 - z * z);
	return [s * Math.cos(a), s * Math.sin(a), z];
};
