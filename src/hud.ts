/**
 * Where a direction lands on screen — the arithmetic behind every marker the
 * HUD draws, with no DOM and no Three.js in it.
 *
 * ## Why this is a module and not four lines in the renderer
 *
 * The map's constraint makes the HUD load-bearing rather than decorative:
 * cockpit is the default view, so the hull — which used to be the attitude
 * readout — is not on screen, and #5 chose a flight model in which the nose and
 * the velocity genuinely disagree. A velocity-vector marker and an attitude
 * reference are therefore what makes the chosen model flyable in the chosen
 * view, and something that load-bearing should be checkable without a browser.
 *
 * ## Directions, not positions
 *
 * Everything here takes a **direction** and not a point, and that is what makes
 * one projection serve all three render layers. A body drawn in the far layer
 * sits at `FAR_SCALE` × its real position; the near layer draws at 1:1. The
 * angle it subtends from the camera is identical either way — that is the whole
 * reason the layering works — so a marker placed by direction lands on the body
 * in both, and never has to ask which layer drew it.
 *
 * It also sidesteps precision: a station 1 AU away is a 10⁸ km number, and
 * normalising in float64 before anything else touches it is exactly the
 * operation that discards the magnitude the renderer cannot hold.
 */

import { type Vec3, dot, length, scale, sub } from "./vec3";

/** A quaternion, structurally — the renderer's `THREE.Quaternion` satisfies it,
 *  which is how this module stays free of Three.js while being handed one. */
export interface Quat {
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface Marker {
	/** Normalised device coordinates: −1…1 left to right, −1…1 bottom to top.
	 *  Meaningless when `behind` is set, which is why it is flagged rather than
	 *  clamped here. */
	ndcX: number;
	ndcY: number;
	/** The direction points behind the camera. A marker for it belongs at the
	 *  edge of the screen, not on it — see `edgeOf`. */
	behind: boolean;
	/** Inside the viewport, and in front. */
	onScreen: boolean;
}

/**
 * Rotate a world-space vector into the camera's frame.
 *
 * The *conjugate* rotation: the camera's quaternion takes camera space to
 * world space, and this needs the inverse. For a unit quaternion the inverse is
 * the conjugate, which is why this is a sign flip rather than a division.
 */
export function intoCameraFrame(v: Vec3, q: Quat): Vec3 {
	// v' = q⁻¹ v q, expanded — the standard form, with the vector part negated
	// because the rotation is the inverse one.
	const x = -q.x;
	const y = -q.y;
	const z = -q.z;
	const w = q.w;
	const ix = w * v.x + y * v.z - z * v.y;
	const iy = w * v.y + z * v.x - x * v.z;
	const iz = w * v.z + x * v.y - y * v.x;
	const iw = -x * v.x - y * v.y - z * v.z;
	return {
		x: ix * w + iw * -x + iy * -z - iz * -y,
		y: iy * w + iw * -y + iz * -x - ix * -z,
		z: iz * w + iw * -z + ix * -y - iy * -x,
	};
}

/**
 * Project a world-space direction onto the screen.
 *
 * `dir` need not be normalised — only its direction is read. −Z is forward,
 * Three.js's own convention for anything that is looked along, so a direction
 * with a positive camera-space `z` is behind the viewer.
 */
export function projectDirection(
	dir: Vec3,
	orientation: Quat,
	fovYRad: number,
	aspect: number,
): Marker {
	const c = intoCameraFrame(dir, orientation);
	const depth = -c.z;
	const f = 1 / Math.tan(fovYRad / 2);
	// A direction exactly on the camera plane has no projection at all; treating
	// it as "behind" puts its marker on the edge, which is where a target at 90°
	// belongs.
	if (depth <= 1e-12) {
		return { ndcX: 0, ndcY: 0, behind: true, onScreen: false };
	}
	const ndcX = (c.x * f) / aspect / depth;
	const ndcY = (c.y * f) / depth;
	return {
		ndcX,
		ndcY,
		behind: false,
		onScreen: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
	};
}

/**
 * Where an off-screen marker's arrow goes, and which way it points.
 *
 * The direction is squashed to the screen plane and pushed out to a box inset
 * by `margin`, so an indicator for something behind the ship sits on the edge
 * you would turn towards. A target directly astern has no preferred side — the
 * projection is degenerate there — and gets the bottom of the screen, which is
 * a choice rather than an answer, and a stable one: it does not flicker between
 * sides as the ship yaws through the singularity.
 */
export function edgeOf(
	dir: Vec3,
	orientation: Quat,
	margin: number,
): { ndcX: number; ndcY: number; angleRad: number } {
	const c = intoCameraFrame(dir, orientation);
	let x = c.x;
	let y = c.y;
	const flat = Math.hypot(x, y);
	if (flat < 1e-9) {
		x = 0;
		y = -1;
	} else {
		x /= flat;
		y /= flat;
	}
	// Scale onto the edge of the inset box rather than onto a circle: a circle
	// leaves the corners of a wide viewport empty and bunches every marker into
	// a band.
	const limit = 1 - margin;
	const k = limit / Math.max(Math.abs(x), Math.abs(y));
	return { ndcX: x * k, ndcY: y * k, angleRad: Math.atan2(y, x) };
}

/**
 * The ship's attitude reference: how far the horizon is rolled, in radians.
 *
 * "Up" is the system's own reference plane — bodies orbit near it (`system.ts`
 * tilts each orbit by a small inclination), so its normal is the one direction
 * in an empty starfield that means anything. The angle returned is where that
 * normal lands on screen, which is what a horizon line has to be rotated by.
 *
 * `null` when the ship is pointed along the normal itself, where roll is not
 * defined and a line drawn at any angle would be a lie that spins.
 */
export function horizonRoll(
	orientation: Quat,
	planeNormal: Vec3,
): number | null {
	const c = intoCameraFrame(planeNormal, orientation);
	const flat = Math.hypot(c.x, c.y);
	if (flat < 1e-6) return null;
	// The screen-space "up" is the projection of the normal; the horizon is
	// perpendicular to it.
	return Math.atan2(c.x, c.y);
}

/**
 * The prograde direction — where the ship is actually going — or `null` below
 * `minKms`, where the velocity is noise and its marker would jitter around the
 * screen.
 *
 * The reason the marker exists at all is the map's HUD constraint: #5 chose a
 * model where the nose and the velocity disagree, and with the hull hidden in
 * cockpit view there is otherwise nothing on screen that says which way the
 * ship is moving.
 */
export function prograde(velocity: Vec3, minKms: number): Vec3 | null {
	const speed = length(velocity);
	return speed < minKms ? null : scale(velocity, 1 / speed);
}

/** The direction from the camera to a point in sim space, normalised in
 *  float64 — see the module docstring on why the magnitude is discarded here
 *  rather than downstream. */
export function directionTo(from: Vec3, to: Vec3): Vec3 | null {
	const d = sub(to, from);
	const len = length(d);
	return len === 0 ? null : scale(d, 1 / len);
}

/** How far off the nose a direction is, in radians — what decides whether a
 *  target reticle is "ahead" and whether the off-screen arrow is needed. */
export function angleOffNose(dir: Vec3, nose: Vec3): number {
	return Math.acos(Math.min(1, Math.max(-1, dot(dir, nose))));
}
