/**
 * The opening's camera (#535): where each shot stands and what it looks at,
 * found from the geometry of the start system rather than staged per system
 * (#530 D5).
 *
 * Every rule is written against something that moves with the subject, never
 * an absolute kilometre pose: a camera beside a station has to move with it,
 * because the station is going ~30 km/s and a fixed camera is carried across
 * the frame (the map's #271 note). So a shot rides the ship, rides the
 * station's axis through the ship, or — the fly-past, the one fixed camera —
 * is carried by the frame velocity it was anchored in.
 *
 * Distances are in hull reaches where the subject is the hull, so a shot
 * frames the ship the same whatever it is drawn at. The figures are the
 * build's first answer and the strip's to tune.
 *
 * Imports only `vec3`, a leaf, so `tests/opening-camera.test.ts` runs under
 * bun.
 */
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	normalizeOr,
	scale,
	sub,
} from "./vec3";
import type { OpeningShot } from "./opening";

/** What a shot is framed from, read off the sim each frame. */
export interface ShotScene {
	ship: { pos: Vec3; nose: Vec3; up: Vec3 };
	/** The hull's display reach, km (`HULL_REACH_KM`). */
	reachKm: number;
	starPos: Vec3;
	/** The trade station: its centre, its aperture axis (outward), and the
	 *  aperture plane's distance from the centre, km. */
	station: { pos: Vec3; axis: Vec3; planeKm: number } | null;
	/** The velocity of the frame the ship's assist holds speed in, km/s. */
	frameVel: Vec3;
	gameTime: number;
}

/** A camera: where it stands, and which way it looks with which way up. */
export interface ShotCamera {
	pos: Vec3;
	forward: Vec3;
	up: Vec3;
}

/** What a shot keeps from its first frame. Only the fly-past keeps a place. */
export interface ShotAnchor {
	shot: OpeningShot;
	pos: Vec3;
	up: Vec3;
	frameVel: Vec3;
	atS: number;
}

/** The framing table, in hull reaches (R) or kilometres where named. */
export const SHOT_FRAMING = Object.freeze({
	/** Ahead of the resting ship and off to the sun side, looking back past it
	 *  at the rift opening behind it. */
	arrival: Object.freeze({ aheadR: 6, sideR: 3, upR: 1.2, lookBehindR: 2 }),
	/** A camera the ship passes: `passKm` down the nose from where the burn
	 *  starts — about three seconds of it — and `offKm` to the side. */
	flypast: Object.freeze({ passKm: 0.3, offKm: 0.06, upKm: 0.012 }),
	/** Behind the ship and to the sun side, looking where it is going. */
	cruise: Object.freeze({ behindR: 8, sideR: 2, upR: 1 }),
	/** Outboard of the ship on the station's axis and to the sun side,
	 *  looking at the aperture it is being brought into. */
	dock: Object.freeze({ outboardR: 8, sideR: 2.5, upR: 1 }),
});

const X: Vec3 = { x: 1, y: 0, z: 0 };

/** A unit vector across `axis`, toward the star where the star is not on the
 *  axis. The lit side of the subject faces the camera from here. */
export function sunSide(axis: Vec3, from: Vec3, starPos: Vec3, up: Vec3): Vec3 {
	const toStar = normalizeOr(sub(starPos, from), X);
	const across = sub(toStar, scale(axis, dot(toStar, axis)));
	return normalizeOr(across, normalizeOr(cross(axis, up), X));
}

/** Anchor a shot on its first frame. */
export function anchorShot(shot: OpeningShot, scene: ShotScene): ShotAnchor {
	const { ship } = scene;
	if (shot !== "flypast")
		return {
			shot,
			pos: ship.pos,
			up: ship.up,
			frameVel: scene.frameVel,
			atS: scene.gameTime,
		};
	const f = SHOT_FRAMING.flypast;
	const side = sunSide(ship.nose, ship.pos, scene.starPos, ship.up);
	return {
		shot,
		pos: add(
			ship.pos,
			add(
				scale(ship.nose, f.passKm),
				add(scale(side, f.offKm), scale(ship.up, f.upKm)),
			),
		),
		up: ship.up,
		frameVel: scene.frameVel,
		atS: scene.gameTime,
	};
}

const looking = (
	pos: Vec3,
	at: Vec3,
	up: Vec3,
	fallback: Vec3,
): ShotCamera => ({
	pos,
	forward: normalizeOr(sub(at, pos), fallback),
	up,
});

/** The camera for `anchor`'s shot, this frame. */
export function shotCamera(anchor: ShotAnchor, scene: ShotScene): ShotCamera {
	const { ship } = scene;
	const r = scene.reachKm;
	switch (anchor.shot) {
		case "arrival": {
			const f = SHOT_FRAMING.arrival;
			const side = sunSide(ship.nose, ship.pos, scene.starPos, ship.up);
			const pos = add(
				ship.pos,
				add(
					scale(ship.nose, f.aheadR * r),
					add(scale(side, f.sideR * r), scale(ship.up, f.upR * r)),
				),
			);
			const at = sub(ship.pos, scale(ship.nose, f.lookBehindR * r));
			return looking(pos, at, ship.up, scale(ship.nose, -1));
		}
		case "flypast": {
			const pos = add(
				anchor.pos,
				scale(anchor.frameVel, scene.gameTime - anchor.atS),
			);
			return looking(pos, ship.pos, anchor.up, ship.nose);
		}
		case "cruise": {
			const f = SHOT_FRAMING.cruise;
			const side = sunSide(ship.nose, ship.pos, scene.starPos, ship.up);
			const pos = add(
				ship.pos,
				add(
					scale(ship.nose, -f.behindR * r),
					add(scale(side, f.sideR * r), scale(ship.up, f.upR * r)),
				),
			);
			const at = scene.station?.pos ?? add(ship.pos, ship.nose);
			return looking(pos, at, ship.up, ship.nose);
		}
		case "dock": {
			const f = SHOT_FRAMING.dock;
			const station = scene.station;
			if (!station) return looking(ship.pos, ship.nose, ship.up, ship.nose);
			const axis = station.axis;
			const side = sunSide(axis, ship.pos, scene.starPos, ship.up);
			const over = normalizeOr(cross(side, axis), ship.up);
			const pos = add(
				ship.pos,
				add(
					scale(axis, f.outboardR * r),
					add(scale(side, f.sideR * r), scale(over, f.upR * r)),
				),
			);
			const aperture = add(station.pos, scale(axis, station.planeKm));
			return looking(pos, aperture, over, scale(axis, -1));
		}
	}
}

/** How far off the camera's line of sight `point` is, in degrees. */
export function offAxisDeg(camera: ShotCamera, point: Vec3): number {
	const to = sub(point, camera.pos);
	const d = length(to);
	if (d === 0) return 0;
	const c = Math.min(1, Math.max(-1, dot(to, camera.forward) / d));
	return (Math.acos(c) * 180) / Math.PI;
}
