/**
 * Throwaway prototype for node #949: a rock as a solid in the sweep, in the
 * field's moving, rotating frame. Three-free. Not production code.
 *
 * Pose(t) = field centre(t) + R_field · rockLocal(t), axes = R_field · spin(t).
 * The field rides one orbit (#918 Q2: the refinery's `FrameMotion`); a rock
 * drifts on a closed circle in its cell and spins about a fixed axis (#948
 * D5). Every term is closed-form in `gameTime`, so the sweep reads both ends
 * of a step at `t` and `t + dt` and never a frame-start snapshot (#43).
 */
import type { Pose, Primitive, SolidMotion } from "../../src/collision";
import { positionOnOrbit, velocityOnOrbit, type Orbit } from "../../src/system";
import type { Vec3 } from "../../src/vec3";
import { rockLocal, rockLocalVel, type Rock } from "../asteroid-fields-948/field-proto";

const TAU = Math.PI * 2;
export type Quat = [number, number, number, number]; // x, y, z, w

export function rotate(q: Quat, v: Vec3): Vec3 {
	const [x, y, z, w] = q;
	const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
	return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}
export const axisAngle = (a: Vec3, angle: number): Quat => {
	const s = Math.sin(angle / 2);
	return [a.x * s, a.y * s, a.z * s, Math.cos(angle / 2)];
};
export const mul = (a: Quat, b: Quat): Quat => [
	a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
	a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
	a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
	a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

export interface FieldFrame {
	orbit: Orbit;
	/** Field orientation, inertial (#948 `FieldPlan.q`). */
	q: Quat;
	/** Where the orbit's centre is: a planet's position, or the star's origin. */
	host?: (t: number) => { pos: Vec3; vel: Vec3 };
}
export function fieldCentre(f: FieldFrame, t: number): { pos: Vec3; vel: Vec3 } {
	const p = positionOnOrbit(f.orbit, t), v = velocityOnOrbit(f.orbit, t);
	const h = f.host?.(t) ?? { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
	return { pos: { x: p.x + h.pos.x, y: p.y + h.pos.y, z: p.z + h.pos.z }, vel: { x: v.x + h.vel.x, y: v.y + h.vel.y, z: v.z + h.vel.z } };
}

/** The rock's spin at `t`, in the field frame. */
export const spinAt = (r: Rock, t: number): Quat => axisAngle(r.axis, r.phase0 + (TAU * t) / r.periodS);

/** The rock's pose and origin velocity at `t`. The spin's surface velocity is
 *  the sweep's to add (`collision.ts` `turnVelocity`), from the two poses. */
export function rockPose(f: FieldFrame, r: Rock, t: number): { pose: Pose; vel: Vec3 } {
	const c = fieldCentre(f, t);
	const l = rotate(f.q, rockLocal(r, t));
	const lv = rotate(f.q, rockLocalVel(r, t));
	const q = mul(f.q, spinAt(r, t));
	return {
		pose: {
			origin: { x: c.pos.x + l.x, y: c.pos.y + l.y, z: c.pos.z + l.z },
			x: rotate(q, { x: 1, y: 0, z: 0 }),
			y: rotate(q, { x: 0, y: 1, z: 0 }),
			z: rotate(q, { x: 0, y: 0, z: 1 }),
		},
		vel: { x: c.vel.x + lv.x, y: c.vel.y + lv.y, z: c.vel.z + lv.z },
	};
}

/** One step's motion: both ends from the clock, never a stored position. */
export function rockMotion(f: FieldFrame, r: Rock, primitives: readonly Primitive[], t: number, dt: number): SolidMotion {
	const a = rockPose(f, r, t), b = rockPose(f, r, t + dt);
	return { primitives, start: a.pose, end: b.pose, velStart: a.vel, velEnd: b.vel };
}

/** The surface velocity of a point on the rock: origin velocity plus ω × r. */
export function surfaceVelocity(f: FieldFrame, r: Rock, t: number, point: Vec3): Vec3 {
	const { pose, vel } = rockPose(f, r, t);
	const w = rotate(f.q, r.axis);
	const om = TAU / r.periodS;
	const d = { x: point.x - pose.origin.x, y: point.y - pose.origin.y, z: point.z - pose.origin.z };
	return { x: vel.x + om * (w.y * d.z - w.z * d.y), y: vel.y + om * (w.z * d.x - w.x * d.z), z: vel.z + om * (w.x * d.y - w.y * d.x) };
}

/**
 * Broadphase: a rock never leaves its cell (#948 D5), so the candidates for a
 * ship at field-local `p` are the rocks in the cells within `reachKm` of it.
 * Returns slots. `cellOf` maps a field-local point to a lattice index.
 */
export function candidates(rocks: readonly Rock[], cellKm: number, p: Vec3, reachKm: number): number[] {
	const out: number[] = [];
	// Every rock's anchor ± drift stays inside its cell's inner cube, so a cell
	// whose cube is farther than reach + half a cell diagonal cannot hold a hit.
	const lim = reachKm + (cellKm * Math.sqrt(3)) / 2;
	for (const r of rocks) {
		const c = { x: Math.round(r.anchor.x / cellKm) * cellKm, y: Math.round(r.anchor.y / cellKm) * cellKm, z: Math.round(r.anchor.z / cellKm) * cellKm };
		if (Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z) <= lim) out.push(r.slot);
	}
	return out;
}
