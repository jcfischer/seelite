/**
 * The pulse laser's gimbal (#324, the principal's rulings after the first
 * playtest of the duel).
 *
 * **Why.** A raider flying by the same rules still out-handles the courier, and
 * the ruling keeps hits on its true hull, a sphere of 32 m radius, which is
 * 1.8° across at 2 km. A
 * fixed forward gun on a ship that turns at 0.9 rad/s cannot hold a jinking
 * hull in that. So the beam turns toward the **selected target** while the
 * target is within **±6°** of the boresight. It slews at a finite
 * **1.5 rad/s**, so a hard jink still breaks the aim for a moment, and it never
 * leaves the cone. Outside the cone, or with no target, it returns to the
 * boresight.
 *
 * Headless and a leaf apart from `vec3`: `Game` steps it and aims the shot, the
 * ON TARGET cue and the tracer along what it returns.
 */
import { type Vec3, add, dot, normalizeOr, scale } from "./vec3";

/** The half-angle the beam may turn from the boresight. */
export const GIMBAL_CONE_RAD = (6 * Math.PI) / 180;
/** How fast the beam turns, rad/s. */
export const GIMBAL_SLEW_RAD_S = 1.5;

/** The angle between two unit vectors. */
export const angleBetween = (a: Vec3, b: Vec3): number =>
	Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

/** Unit `from` turned toward unit `to` by at most `maxRad`, along the arc. */
export function slewToward(from: Vec3, to: Vec3, maxRad: number): Vec3 {
	const angle = angleBetween(from, to);
	if (angle <= maxRad) return to;
	const sinAngle = Math.sin(angle);
	// Antiparallel has no unique arc; the gimbal's cone never asks for one.
	if (sinAngle < 1e-9) return to;
	const t = maxRad / angle;
	const a = Math.sin((1 - t) * angle) / sinAngle;
	const b = Math.sin(t * angle) / sinAngle;
	return normalizeOr(add(scale(from, a), scale(to, b)), to);
}

/** `dir` kept within `cone` of `bore`. */
export function clampToCone(dir: Vec3, bore: Vec3, cone: number): Vec3 {
	return angleBetween(dir, bore) <= cone ? dir : slewToward(bore, dir, cone);
}

/**
 * One step of the gimballed beam.
 *
 * `aim` is where the beam pointed last step, `bore` the gun's fixed forward
 * direction now, and `targetDir` the unit direction to the selected target, or
 * `null` with none. The result never leaves the cone. A ship that turns hard
 * drags the beam with it, rather than letting it point where the gun cannot.
 */
export function stepGimbal(
	aim: Vec3,
	bore: Vec3,
	targetDir: Vec3 | null,
	dt: number,
): Vec3 {
	const tracking =
		targetDir !== null && angleBetween(bore, targetDir) <= GIMBAL_CONE_RAD;
	const desired = tracking ? targetDir : bore;
	const held = clampToCone(aim, bore, GIMBAL_CONE_RAD);
	return clampToCone(
		slewToward(held, desired, GIMBAL_SLEW_RAD_S * Math.max(0, dt)),
		bore,
		GIMBAL_CONE_RAD,
	);
}
