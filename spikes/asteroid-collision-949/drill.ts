/**
 * Throwaway prototype for node #949: Longwall B's cutter as a contact test
 * against a rock's surface, apart from the hull box. Three-free. Not
 * production code.
 *
 * Geometry, in the ship frame of `collision.ts` `shipPose` (x starboard,
 * y dorsal, z along the nose), kilometres:
 * - The stowed rotor, measured off the installed model under bun
 *   (`cutter-explore.ts`): x ±5.50 m, y −8.91…+2.09 m, its face on the hull
 *   box's bow plane (42.2 m ahead of the origin).
 * - The feed travel, from #803's study kinematics (`MINING`: 48 − 1.4 − 36 =
 *   10.6 m). Production draws the cutter stowed and never articulates it
 *   (#815 D5), so this figure is the study's, not a measured production pose.
 *
 * Contact is a predicate, not an attachment (#872 D4; #920 owns the
 * interaction): the cutter is in contact while its tooth ring is within the
 * tooth reach of the surface, it faces the surface within the alignment
 * limit, and the surface moves past it slower than the speed limit. All three
 * limits are #920's to set; the values here are placeholders and are exported
 * so a calibration can read them.
 */
import type { Pose } from "../../src/collision";
import type { Vec3 } from "../../src/vec3";
import { normalAt, radialDistance, type Heightfield, type V3 } from "./heightfield";

export const CUTTER = {
	radiusKm: 0.0055,
	/** Rotor centre below the ship's axis. */
	downKm: 0.0034,
	/** The bow plane: half the miner's hull box length. */
	bowKm: 0.0422,
	feedTravelKm: 0.0106,
	/** #803 `MINING.toothReach`: how far the teeth bite past the cutter face. */
	toothReachKm: 0.0014,
} as const;

/** Placeholders, #920's to calibrate. */
export const DRILL_WINDOW = {
	maxAlignDeg: 20,
	maxSlipKms: 0.002,
} as const;

/** The deployed cutter face's centre and axis, world frame. */
export function cutterFace(ship: Pose, extension = 1): { centre: Vec3; axis: Vec3 } {
	const ahead = CUTTER.bowKm + CUTTER.feedTravelKm * extension;
	const centre = {
		x: ship.origin.x + ship.z.x * ahead - ship.y.x * CUTTER.downKm,
		y: ship.origin.y + ship.z.y * ahead - ship.y.y * CUTTER.downKm,
		z: ship.origin.z + ship.z.z * ahead - ship.y.z * CUTTER.downKm,
	};
	return { centre, axis: ship.z };
}

/** A rock seen by the drill: its pose, scale and surface. */
export interface RockSurface {
	pose: Pose;
	radiusKm: number;
	/** Unit-space surface, normalised so its reach is ≤ 1. */
	field: Heightfield;
	/** World velocity of a world point on the rock's surface. */
	surfaceVel: (p: Vec3) => Vec3;
}

const toLocal = (r: RockSurface, p: Vec3): V3 => {
	const d = { x: p.x - r.pose.origin.x, y: p.y - r.pose.origin.y, z: p.z - r.pose.origin.z };
	const s = 1 / r.radiusKm;
	return [
		(d.x * r.pose.x.x + d.y * r.pose.x.y + d.z * r.pose.x.z) * s,
		(d.x * r.pose.y.x + d.y * r.pose.y.y + d.z * r.pose.y.z) * s,
		(d.x * r.pose.z.x + d.y * r.pose.z.y + d.z * r.pose.z.z) * s,
	];
};
const toWorldDir = (r: RockSurface, n: V3): Vec3 => ({
	x: r.pose.x.x * n[0] + r.pose.y.x * n[1] + r.pose.z.x * n[2],
	y: r.pose.x.y * n[0] + r.pose.y.y * n[1] + r.pose.z.y * n[2],
	z: r.pose.x.z * n[0] + r.pose.y.z * n[1] + r.pose.z.z * n[2],
});

/** Signed radial gap from a world point to the rock surface, km (positive outside). */
export function surfaceGapKm(r: RockSurface, p: Vec3): number {
	return radialDistance(r.field, toLocal(r, p)) * r.radiusKm;
}

export type DrillState =
	| { kind: "clear"; gapKm: number }
	| { kind: "contact"; biteKm: number; alignDeg: number; slipKms: number }
	| { kind: "misaligned" | "slipping" | "overdriven"; biteKm: number; alignDeg: number; slipKms: number };

/**
 * The cutter against one rock. The tooth ring is sampled (centre plus 12 rim
 * points); the bite is the deepest sample's penetration. A bite past the
 * tooth reach is `overdriven`: the face itself is in the rock, which the
 * solid-cutter option (O-B) would have stopped as an impact and the predicate
 * option (O-A) only reports.
 */
export function drillState(ship: Pose, shipVel: Vec3, rock: RockSurface, extension = 1): DrillState {
	const { centre, axis } = cutterFace(ship, extension);
	const pts: Vec3[] = [centre];
	for (let k = 0; k < 12; k++) {
		const a = (k / 12) * Math.PI * 2;
		const c = Math.cos(a) * CUTTER.radiusKm, s = Math.sin(a) * CUTTER.radiusKm;
		pts.push({ x: centre.x + ship.x.x * c + ship.y.x * s, y: centre.y + ship.x.y * c + ship.y.y * s, z: centre.z + ship.x.z * c + ship.y.z * s });
	}
	let deepest = Infinity, at = centre;
	for (const p of pts) {
		const g = surfaceGapKm(rock, p);
		if (g < deepest) { deepest = g; at = p; }
	}
	if (deepest > 0) return { kind: "clear", gapKm: deepest };
	const biteKm = -deepest;
	const local = toLocal(rock, at);
	const l = Math.hypot(...local);
	const n = toWorldDir(rock, normalAt(rock.field, [local[0] / l, local[1] / l, local[2] / l]));
	const cos = -(axis.x * n.x + axis.y * n.y + axis.z * n.z);
	const alignDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
	const sv = rock.surfaceVel(at);
	const slipKms = Math.hypot(shipVel.x - sv.x, shipVel.y - sv.y, shipVel.z - sv.z);
	const m = { biteKm, alignDeg, slipKms };
	if (biteKm > CUTTER.toothReachKm) return { kind: "overdriven", ...m };
	if (alignDeg > DRILL_WINDOW.maxAlignDeg) return { kind: "misaligned", ...m };
	if (slipKms > DRILL_WINDOW.maxSlipKms) return { kind: "slipping", ...m };
	return { kind: "contact", ...m };
}

/** First hit of a ray on the rock surface, km along the ray, or null. Marches
 *  the radial gap and bisects the crossing; the step is a fraction of the
 *  rock's radius so a thin feature is not stepped over. */
export function rayHitKm(rock: RockSurface, from: Vec3, dir: Vec3, maxKm: number): number | null {
	const step = rock.radiusKm / 200;
	let prev = surfaceGapKm(rock, from);
	if (prev <= 0) return 0;
	for (let s = step; s <= maxKm; s += step) {
		const p = { x: from.x + dir.x * s, y: from.y + dir.y * s, z: from.z + dir.z * s };
		const g = surfaceGapKm(rock, p);
		if (g <= 0) {
			let lo = s - step, hi = s;
			for (let k = 0; k < 30; k++) {
				const mid = (lo + hi) / 2;
				const q = { x: from.x + dir.x * mid, y: from.y + dir.y * mid, z: from.z + dir.z * mid };
				if (surfaceGapKm(rock, q) <= 0) hi = mid;
				else lo = mid;
			}
			return hi;
		}
		prev = g;
	}
	return prev > 0 ? null : 0;
}
