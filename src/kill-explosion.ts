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

/** Total points one explosion draws: the flash, the fireball, the debris. */
export const EXPLOSION_POINTS = 1 + EXPLOSION_FIREBALL + EXPLOSION_PARTICLES;

/**
 * Every point of `e` at game time `t`, flash first, then the fireball, then
 * the debris. Empty when the explosion is not live.
 */
export function explosionPoints(e: KillExplosion, t: number): ExplosionPoint[] {
	const out: ExplosionBuffers = {
		position: new Float32Array(EXPLOSION_POINTS * 3),
		sizeKm: new Float32Array(EXPLOSION_POINTS),
		heat: new Float32Array(EXPLOSION_POINTS * 3),
	};
	if (!writeExplosionPoints(e, t, out)) return [];
	const triple = (a: Float32Array, i: number): [number, number, number] => [
		a[3 * i],
		a[3 * i + 1],
		a[3 * i + 2],
	];
	return Array.from({ length: EXPLOSION_POINTS }, (_, i) => ({
		offset: triple(out.position, i),
		sizeKm: out.sizeKm[i],
		heat: triple(out.heat, i),
	}));
}

/** The arrays one explosion's points are written into: three floats a point
 *  for position and heat, one for size. */
export interface ExplosionBuffers {
	position: Float32Array;
	sizeKm: Float32Array;
	heat: Float32Array;
}

/**
 * `explosionPoints` written straight into `out`, with no object per point:
 * the renderer's path. Returns false, writing nothing, when the explosion is
 * not live.
 */
export function writeExplosionPoints(
	e: KillExplosion,
	t: number,
	out: ExplosionBuffers,
): boolean {
	if (!explosionLive(e, t)) return false;
	const age = t - e.at;
	const duration = explosionDurationS(e.reachKm);
	const life = age / duration;
	const cloud = explosionCloudKm(e.reachKm);
	const seed = fnv1a(e.key);
	const flash = Math.max(0, 1 - age / EXPLOSION_FLASH_S);
	out.sizeKm[0] = e.reachKm * (2 + 6 * flash);
	writeHeat(out.heat, 0, 0, 1.4 * flash ** 1.5);
	const ball = Math.min(1, age / (0.35 * duration));
	// Stryker disable next-line EqualityOperator: one point past the fireball is the first debris point, which the debris loop writes over
	for (let n = 1; n <= EXPLOSION_FIREBALL; n++) {
		const h = mix(seed, n);
		writeDirection(
			out.position,
			n,
			h,
			e.reachKm * 1.2 * ball * unit(mix(h, 3)),
		);
		out.sizeKm[n] = e.reachKm * (1.2 + 2.4 * ball);
		writeHeat(out.heat, n, 0.2 + 0.8 * life, (1 - life) ** 1.4);
	}
	const spread = 1 - (1 - life) ** 3;
	// Stryker disable next-line EqualityOperator: a write one past the last point lands outside the typed array and is dropped
	for (let n = 1 + EXPLOSION_FIREBALL; n < EXPLOSION_POINTS; n++) {
		const h = mix(seed, n);
		writeDirection(
			out.position,
			n,
			h,
			cloud * spread * (0.3 + 0.7 * unit(mix(h, 7))),
		);
		out.sizeKm[n] = e.reachKm * (0.35 + 0.25 * unit(mix(h, 11)));
		writeHeat(out.heat, n, 0.15 + 0.85 * life, (1 - life) ** 1.8);
	}
	return true;
}

const writeDirection = (
	position: Float32Array,
	n: number,
	h: number,
	r: number,
) => {
	const z = 2 * unit(mix(h, 1)) - 1;
	// Stryker disable next-line ArithmeticOperator: dividing by the draw still gives an angle, and any angle is a direction; the tests hold the spread
	const a = 2 * Math.PI * unit(mix(h, 2));
	const s = Math.sqrt(1 - z * z);
	position[3 * n] = r * s * Math.cos(a);
	position[3 * n + 1] = r * s * Math.sin(a);
	position[3 * n + 2] = r * z;
};

const writeHeat = (heat: Float32Array, n: number, v: number, k: number) => {
	const c = Math.max(0, Math.min(1, v));
	heat[3 * n] = k * (1 - 0.35 * c);
	heat[3 * n + 1] = k * (1 - 0.55 * c) ** 1.6;
	heat[3 * n + 2] = k * (1 - c) ** 3 * 0.85;
};
