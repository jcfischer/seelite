/**
 * The chase camera's orbit (node #691): where the outside view stands and
 * which way it looks, kept headless (`tests/chase-orbit.test.ts`).
 *
 * **One rotation turns the whole rig.** The camera's offset from the hull and
 * its orientation are both the ship's orientation times `orbitRotation`, which
 * is a turn about the ship's up axis (`yawRad`) and then about the turned
 * horizontal (`elevationRad`). So the hull sits at the same place in every
 * frame the orbit can compose — directly astern, ahead, either beam, overhead
 * and underneath — and `main.ts`'s `cameraPos` and `cameraRotation` cannot
 * disagree about it, because both read this module rather than a copy each.
 * At zero elevation it is exactly the yaw-only orbit #607 shipped, which is
 * what keeps a yaw-only postcard link's framing (`postcard.ts`).
 *
 * **The gesture.** In Photo mode the locked pointer orbits the camera and never
 * reaches the ship: its delta is taken before anything that steers, fires or
 * cancels an autopilot reads it (`pointerOwner`). The sense is the cockpit's
 * own grammar — the view goes where the pointer goes, and pulling the pointer
 * back tilts the view up, as it brings the nose up in the cockpit. So a push to
 * the right swings the camera to port and looks to starboard, and a pull back
 * lowers the camera beneath the hull and looks up at it. `1` and `3` still
 * swing it held, `2` recentres the whole pose astern, and a panel, the Galaxy
 * Map or the pause menu takes the pointer back exactly as it does from the
 * ship (`contextFliesShip`, `pointerLockMove`).
 *
 * **The sensitivity** is `ORBIT_RAD_PER_PX`: a full circle in about 1,600
 * pixels of travel. Each frame's turn is spike-guarded by `ORBIT_MAX_STEP_RAD`,
 * because a pointer lock taken or a window re-focused can deliver hundreds of
 * pixels in one event.
 *
 * **The poles.** Elevation is clamped to ±π/2, where the sightline runs along
 * the ship's up axis — looking straight down from overhead, straight up from
 * beneath. The camera is not over the hull's centre there: the whole rig is
 * turned, so the astern offset's 140 m back becomes 140 m above (or below)
 * and its 40 m up becomes 40 m forward (aft from beneath), and the hull sits
 * off-centre in the frame exactly where it sits astern. Clamped rather than
 * accumulated, so a pointer pushed past the pole and brought back moves the
 * camera on the first pixel back. The rig is a rotation, not a look-at, so
 * the pole has no singular up vector: there a horizontal push turns the view
 * about its own sightline, which is a continuous motion with no flip and no
 * NaN. Yaw wraps through ±π, so the sweep round the hull is unbroken.
 *
 * Photo mode holds the simulation while the wheel scales the rig's distance.
 * Outside it, pointer deltas steer the ship in either view and cannot manipulate
 * the camera. No Three.js: rotations are `hud.ts`'s `Quat`.
 */
import { intoCameraFrame, type Quat } from "./hud";
import type { View } from "./chase-view";
import type { Vec3 } from "./vec3";

/**
 * The chase camera's offset from the ship, in kilometres: behind and above.
 *
 * 140 m back and 40 m up, set by looking at it. At 60 m the 30-metre hull filled
 * the lower half of the frame and the station 40 km ahead was a speck above it —
 * a view that shows the placeholder and hides the thing the placeholder is meant
 * to let you judge. These two numbers are the scaffold's only tuned-by-eye
 * constants, and the flight-model node owns them from here.
 */
export const CHASE_BACK_KM = 0.14;
export const CHASE_UP_KM = 0.04;

/** The orbit pose. Zero, zero is directly astern; positive elevation stands
 *  the camera above the ship and positive yaw swings it to starboard. */
export interface ChaseOrbit {
	readonly yawRad: number;
	readonly elevationRad: number;
	/** Distance multiplier; omitted on older compositions means the normal rig. */
	readonly zoomScale?: number;
}

/** The normal astern composition `2` recentres to. */
export const ORBIT_ASTERN: ChaseOrbit = { yawRad: 0, elevationRad: 0 };

/** Directly overhead or directly beneath, and no further. */
export const ELEVATION_LIMIT_RAD = Math.PI / 2;

/** Radians of orbit one pixel of pointer travel turns. */
export const ORBIT_RAD_PER_PX = 0.004;

/** The most one frame's pointer delta may turn either angle, radians. */
export const ORBIT_MAX_STEP_RAD = 0.5;

export const ORBIT_ZOOM_MIN = 0.25;
export const ORBIT_ZOOM_MAX = 8;
export const clampZoom = (scale: number): number =>
	Number.isFinite(scale)
		? Math.max(ORBIT_ZOOM_MIN, Math.min(ORBIT_ZOOM_MAX, scale))
		: 1;

/** Scroll up moves closer. Bound a single wheel event as well as the distance. */
export function zoomOrbit(orbit: ChaseOrbit, deltaPx: number): ChaseOrbit {
	if (!Number.isFinite(deltaPx) || deltaPx === 0) return orbit;
	return {
		...orbit,
		zoomScale: clampZoom(
			(orbit.zoomScale ?? 1) *
				Math.exp(Math.max(-500, Math.min(500, deltaPx)) * 0.002),
		),
	};
}

/** Who a locked pointer's delta belongs to: the camera in Photo mode, the
 *  ship otherwise. Never both — a delta the orbit took is not also a turn. */
export type PointerOwner = "orbit" | "steer";
export const pointerOwner = (view: View, photoMode = false): PointerOwner =>
	view === "chase" && photoMode ? "orbit" : "steer";

const clamp = (v: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, v));

/** Fold an angle into [-π, π). One already there is returned untouched, so
 *  a frame that turns nothing does not move the pose by a rounding error. */
export function wrapYaw(rad: number): number {
	if (rad >= -Math.PI && rad < Math.PI) return rad;
	const turn = Math.PI * 2;
	return ((((rad + Math.PI) % turn) + turn) % turn) - Math.PI;
}

/** Elevation held inside the poles; a non-finite one is the astern level. */
export const clampElevation = (rad: number): number =>
	Number.isFinite(rad)
		? clamp(rad, -ELEVATION_LIMIT_RAD, ELEVATION_LIMIT_RAD)
		: 0;

/**
 * The orbit after one frame's pointer delta, in pixels. A push right (`dx` > 0)
 * swings the camera to port; a pull back (`dy` > 0) lowers it. A non-finite
 * delta moves nothing.
 */
export function orbitByPointer(
	orbit: ChaseOrbit,
	dxPx: number,
	dyPx: number,
): ChaseOrbit {
	const step = (px: number) =>
		Number.isFinite(px)
			? clamp(px * ORBIT_RAD_PER_PX, -ORBIT_MAX_STEP_RAD, ORBIT_MAX_STEP_RAD)
			: 0;
	return {
		...orbit,
		yawRad: wrapYaw(orbit.yawRad - step(dxPx)),
		elevationRad: clampElevation(orbit.elevationRad - step(dyPx)),
	};
}

/**
 * The rig's rotation in the ship's frame: `R_y(yaw) · R_x(−elevation)`. The
 * camera's orientation is the ship's times this, and so is its offset.
 */
export function orbitRotation(orbit: ChaseOrbit): Quat {
	const hy = orbit.yawRad / 2;
	const hx = -orbit.elevationRad / 2;
	const cy = Math.cos(hy);
	const sy = Math.sin(hy);
	const cx = Math.cos(hx);
	const sx = Math.sin(hx);
	return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
}

/** `v` turned by `q`: the inverse of `intoCameraFrame`. */
export const rotate = (v: Vec3, q: Quat): Vec3 =>
	intoCameraFrame(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });

/** Where the camera stands relative to the hull, in the ship's own frame, km. */
export function orbitOffsetKm(orbit: ChaseOrbit): Vec3 {
	const zoom = clampZoom(orbit.zoomScale ?? 1);
	return rotate(
		{ x: 0, y: CHASE_UP_KM * zoom, z: CHASE_BACK_KM * zoom },
		orbitRotation(orbit),
	);
}
