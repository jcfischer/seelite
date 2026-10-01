/**
 * Chase view's weapons and cues (#607): the arithmetic `main.ts` draws and
 * fires by, kept headless (`tests/chase-view.test.ts`).
 *
 * The principal's rulings:
 *
 * - **D1. The gun is bolted to the hull.** In chase it fires from the ship
 *   along its nose. The camera can orbit without turning it. In the cockpit
 *   it is the sightline through the reticle, as it always was.
 * - **D2. The ship-fixed cues are cockpit instruments.** The nose cross, the
 *   attitude line, the flight floor and the docking funnel are not drawn in
 *   chase. The world-anchored cues are, projected through the camera.
 * - **D3. The beam starts at the hull's muzzles** (`shipMuzzlesKm`), turned
 *   with the ship, and runs the weapon's range along the aim.
 *
 * No Three.js: rotations are `hud.ts`'s `Quat`.
 */
import {
	intoCameraFrame,
	type Marker,
	projectDirection,
	type Quat,
} from "./hud";
import { add, normalizeOr, scale, sub, type Vec3 } from "./vec3";

export type View = "cockpit" | "chase";

/** Where the gun fires from and which way (D1). */
export function weaponRay(
	view: View,
	ship: { readonly pos: Vec3; readonly nose: Vec3 },
	camera: { readonly pos: Vec3; readonly forward: Vec3 },
): { origin: Vec3; aim: Vec3 } {
	return view === "chase"
		? { origin: ship.pos, aim: ship.nose }
		: { origin: camera.pos, aim: camera.forward };
}

/** Whether the nose cross, attitude line, flight floor and docking funnel
 *  are drawn (D2). */
export const shipCuesShown = (view: View): boolean => view === "cockpit";

/** `v` turned by `q`: the inverse of `intoCameraFrame`. */
const rotate = (v: Vec3, q: Quat): Vec3 =>
	intoCameraFrame(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** The muzzles in the world (D3): the ship's position plus each muzzle, in
 *  the hull's frame, turned by the ship's orientation. */
export function muzzlesWorld(
	shipPos: Vec3,
	orientation: Quat,
	muzzlesKm: readonly Vec3[],
): Vec3[] {
	return muzzlesKm.map((m) => add(shipPos, rotate(m, orientation)));
}

/** One beam per muzzle, `rangeKm` long along `aim`. */
export function beamSegments(
	muzzles: readonly Vec3[],
	aim: Vec3,
	rangeKm: number,
): [Vec3, Vec3][] {
	// A zero aim has no direction: no beam length rather than a NaN one.
	const step = scale(normalizeOr(aim, { x: 0, y: 0, z: 0 }), rangeKm);
	return muzzles.map((m) => [m, add(m, step)]);
}

/** Closer than this to the camera plane, a point is cut back to it. */
const NEAR_KM = 1e-6;

/**
 * A world segment on the camera's screen, cut at the camera plane: a beam
 * that runs past the camera still draws the part in front of it. Null when
 * none of it is in front.
 */
export function projectSegment(
	a: Vec3,
	b: Vec3,
	camPos: Vec3,
	camRot: Quat,
	fovYRad: number,
	aspect: number,
): [Marker, Marker] | null {
	const ca = intoCameraFrame(sub(a, camPos), camRot);
	const cb = intoCameraFrame(sub(b, camPos), camRot);
	// Depth is -z in the camera's frame.
	const da = -ca.z;
	const db = -cb.z;
	if (da < NEAR_KM && db < NEAR_KM) return null;
	const cut = (p: Vec3, dp: number, q: Vec3, dq: number): Vec3 => {
		if (dp >= NEAR_KM) return p;
		const t = (NEAR_KM - dp) / (dq - dp);
		return add(p, scale(sub(q, p), t));
	};
	const pa = cut(ca, da, cb, db);
	const pb = cut(cb, db, ca, da);
	// Already in the camera's frame: project with no further rotation.
	const none: Quat = { x: 0, y: 0, z: 0, w: 1 };
	return [
		projectDirection(pa, none, fovYRad, aspect),
		projectDirection(pb, none, fovYRad, aspect),
	];
}
