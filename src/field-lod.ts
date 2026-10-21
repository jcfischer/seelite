/**
 * Which rocks a field draws, where and at what level (node #968).
 *
 * The headless half of the field renderer: Three-free, so the placement and the
 * level choice are arithmetic a bun test can bind. The scheme is #950's D3/D4:
 * a level is picked from a rock's projected radius in physical pixels, stepping
 * up only past the band's edge × (1 + `HYSTERESIS`).
 *
 * Positions are in the **field frame** (kilometres, axes of `plan.rotation`):
 * `fieldCameraLocal` carries the camera there once a frame and every rock is
 * measured against it, so the f64 star-centric position never reaches float32.
 */
import {
	type FieldPlan,
	type Quat,
	type Rock,
	fieldCentre,
	rockLocal,
	rotateByQuat,
} from "./asteroid-field";
import type { Vec3 } from "./vec3";

/** Authored archetypes (#953: K = 16); a rock's shape is `shapeSeed % K`. */
export const ROCK_ARCHETYPES = 16;
export const rockArchetype = (rock: Pick<Rock, "shapeSeed">): number =>
	rock.shapeSeed % ROCK_ARCHETYPES;

export type QualitySide = "high" | "low";
/** 0–2 are mesh levels (icosahedron-style 980/320/80 → authored LODs); 3 is a point. */
export type FieldLevel = 0 | 1 | 2 | 3;
export const POINT_LEVEL = 3;

/**
 * Projected radius, physical pixels, above which a rock is drawn at level 0, 1
 * and 2; below the last it is a point (#950 D3).
 */
export const LEVEL_PX: Readonly<
	Record<QualitySide, readonly [number, number, number]>
> = {
	high: [40, 10, 1.5],
	low: [80, 20, 3],
};
/** A rock steps to a nearer level only past the edge × (1 + this). */
export const HYSTERESIS = 0.15;

/**
 * The level for a rock whose projected radius is `px`, given the level it was
 * drawn at last frame. Stepping down uses the bare edge; stepping up the edge
 * widened by `HYSTERESIS`, so a rock on a boundary holds its level.
 */
export function levelFor(
	px: number,
	previous: number,
	quality: QualitySide,
): FieldLevel {
	const edges = LEVEL_PX[quality];
	for (let l = 0; l < 3; l++) {
		const edge = edges[l] * (previous > l ? 1 + HYSTERESIS : 1);
		if (px > edge) return l as FieldLevel;
	}
	return POINT_LEVEL;
}

/** Projected radius, in physical pixels, of a sphere seen from `distanceKm`. */
export const projectedRadiusPx = (
	radiusKm: number,
	distanceKm: number,
	pxPerRadian: number,
): number => (radiusKm / Math.max(1e-6, distanceKm)) * pxPerRadian;

/** Physical pixels per radian of the drawing buffer at a vertical field of view. */
export const pxPerRadianFor = (
	bufferHeightPx: number,
	fovDegrees: number,
): number => bufferHeightPx / 2 / Math.tan(((fovDegrees / 2) * Math.PI) / 180);

const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

/**
 * The camera in the field frame: `R⁻¹ (camera − centre(t))`, with `camera` the
 * star-centric position the game places everything against.
 */
export function fieldCameraLocal(
	plan: FieldPlan,
	gameTime: number,
	camera: Vec3,
): Vec3 {
	const c = fieldCentre(plan, gameTime);
	return rotateByQuat(conjugate(plan.rotation), {
		x: camera.x - c.x,
		y: camera.y - c.y,
		z: camera.z - c.z,
	});
}

/** Where the field's origin is relative to the camera, star-centric axes, km. */
export function fieldOffsetFromCamera(
	plan: FieldPlan,
	gameTime: number,
	camera: Vec3,
): Vec3 {
	const c = fieldCentre(plan, gameTime);
	return { x: c.x - camera.x, y: c.y - camera.y, z: c.z - camera.z };
}

/**
 * One frame's rows: every rock's field-frame position (`pos`, 3 per rock),
 * its level, and the number of points. Writes into caller-owned buffers so a
 * 210-rock field allocates nothing per frame; `levels` holds last frame's
 * levels on entry (the hysteresis state) and this frame's on exit.
 *
 * Rocks whose level is `POINT_LEVEL` are packed first into `points`
 * (3 floats each); the return value is how many.
 */
export function selectFieldLevels(
	rocks: readonly Rock[],
	gameTime: number,
	cameraLocal: Vec3,
	pxPerRadian: number,
	quality: QualitySide,
	levels: Int8Array,
	pos: Float32Array,
	points: Float32Array,
	meshesAllowed = true,
): number {
	let np = 0;
	for (let i = 0; i < rocks.length; i++) {
		const rock = rocks[i];
		const p = rockLocal(rock, gameTime);
		const dx = p.x - cameraLocal.x;
		const dy = p.y - cameraLocal.y;
		const dz = p.z - cameraLocal.z;
		const px = projectedRadiusPx(
			rock.radiusKm,
			Math.hypot(dx, dy, dz),
			pxPerRadian,
		);
		const level = meshesAllowed
			? levelFor(px, levels[i], quality)
			: POINT_LEVEL;
		levels[i] = level;
		pos[i * 3] = p.x;
		pos[i * 3 + 1] = p.y;
		pos[i * 3 + 2] = p.z;
		if (level === POINT_LEVEL) {
			points[np * 3] = p.x;
			points[np * 3 + 1] = p.y;
			points[np * 3 + 2] = p.z;
			np++;
		}
	}
	return np;
}

/** A rock's spin as a quaternion in the field frame: its axis, its angle now. */
export function spinQuat(
	rock: Rock,
	angle: number,
	out: { x: number; y: number; z: number; w: number } = {
		x: 0,
		y: 0,
		z: 0,
		w: 1,
	},
): Quat {
	const s = Math.sin(angle / 2);
	out.x = rock.spinAxis.x * s;
	out.y = rock.spinAxis.y * s;
	out.z = rock.spinAxis.z * s;
	out.w = Math.cos(angle / 2);
	return out;
}
