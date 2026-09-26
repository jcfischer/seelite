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
import { OPENING, type OpeningShot } from "./opening";

/** What a shot is framed from, read off the sim each frame. */
export interface ShotScene {
	ship: { pos: Vec3; nose: Vec3; up: Vec3 };
	/** The hull's display reach, km (`HULL_REACH_KM`). */
	reachKm: number;
	starPos: Vec3;
	/** The trade station: its centre, its aperture axis (outward), and the
	 *  aperture plane's distance from the centre, km. */
	station: { pos: Vec3; axis: Vec3; planeKm: number } | null;
	/** The body the station orbits, when it has one. */
	planet: { pos: Vec3 } | null;
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

/** What a shot keeps from its first frame. */
export interface ShotAnchor {
	shot: OpeningShot;
	/** Where the fly-past camera stands; the other shots ride their subject. */
	pos: Vec3;
	up: Vec3;
	/**
	 * The side the camera stands on, chosen once. Chosen per frame it swung:
	 * on seeds where a new game faces the star, the sun side across the nose
	 * was float noise, and a 1e-12 attitude wobble per step turned the camera
	 * round the ship between frames — the flicker and the second ship the
	 * principal saw on seeds 47 and 49.
	 */
	side: Vec3;
	frameVel: Vec3;
	atS: number;
	/** The fly-by's angle, chosen once on its first step so a shot never
	 *  jumps between the two mid-take. */
	reverse?: boolean;
	/** The fly-past taken over from the arrival: how far behind the ship the
	 *  arrival was looking, eased onto the ship over `handoverS`. */
	lookBehindKm?: number;
}

/** The framing table, in hull reaches (R) or kilometres where named. */
export const SHOT_FRAMING = Object.freeze({
	/**
	 * The prologue (the principal's seventh note): empty space where the ship
	 * will arrive, the rift forming out of nothing. Ahead of the arrival point
	 * and off to the sun side, looking at where the rift opens, pushing in
	 * from `fromR` to `toR` over the shot — the ship is not drawn.
	 */
	forming: Object.freeze({ fromR: 16, toR: 11, sideR: 5, upR: 2 }),
	/**
	 * Ahead of the resting ship and off to the sun side, looking back past it
	 * at the rift opening behind it — and orbiting it, `orbitDeg` about its
	 * up axis over the `orbitS` of the shot, eased at both ends (the
	 * principal's second flight). It swings from `orbitFromDeg` off the nose
	 * to 65°, so it stays on the lit side and the rift behind the ship never
	 * turns edge-on.
	 */
	arrival: Object.freeze({
		aheadR: 6,
		sideR: 3,
		upR: 1.2,
		lookBehindR: 2,
		orbitFromDeg: 5,
		orbitDeg: 60,
		orbitS: OPENING.arriveS,
	}),
	/**
	 * A camera the ship passes: `passKm` down the nose from where the burn
	 * starts — a second and a half of it — `offKm` to the side and `upKm`
	 * above, so the pass is seen three-quarters from above rather than flat
	 * side-on and never inside the hull: 0.1 km off the path, 2.8 reaches.
	 */
	flypast: Object.freeze({
		passKm: 0.15,
		offKm: 0.08,
		upKm: 0.06,
		/** How long the look takes to settle from the arrival's aim onto the
		 *  ship when the fly-past continues the arrival's take. */
		handoverS: 1,
	}),
	/**
	 * The planet fly-by. The station is a point until the leg's last seconds
	 * and its planet is the place, so the shot is built round the planet.
	 * When the two are within `pairDeg` of each other the camera stands
	 * behind the ship and looks between them; when they are not — a station
	 * arrives *past* its planet, 77° to 140° apart on seed 47 — it stands
	 * ahead of the ship and looks back at it, the planet behind it, which is
	 * the reverse angle. The look keeps the ship within `keepShipDeg`, and
	 * the camera swings `orbitDeg` round the ship over the take (the
	 * principal's third note).
	 */
	cruise: Object.freeze({
		behindR: 8,
		aheadR: 10,
		sideR: 2,
		upR: 1,
		pairDeg: 50,
		orbitDeg: 25,
		orbitS: OPENING.cruiseShot.simS,
	}),
	/**
	 * The station approach, its own scene after the drop-out (the principal's
	 * fifth note). Behind the ship on the line from the station through it, to
	 * the sun side, aiming between ship and station so both stay in frame
	 * whatever the nose does: behind the nose, the station left the viewport
	 * while the station's computer turned the ship to line up (the fourth
	 * note). A swing of `orbitDeg` over the take.
	 */
	approach: Object.freeze({
		behindR: 8,
		sideR: 2,
		upR: 1,
		orbitDeg: 20,
		orbitS: OPENING.approachShot.toS - OPENING.approachShot.fromS,
	}),
	/** Outboard of the ship on the station's axis and to the sun side,
	 *  looking at the aperture it is being brought into. */
	dock: Object.freeze({ outboardR: 8, sideR: 2.5, upR: 1 }),
	/** The most the look may lean off the ship toward what it is framed with.
	 *  A planet swinging past pulled the look 60–87° off the ship on seeds 48,
	 *  50 and 51, and the ship left the frame. */
	keepShipDeg: 20,
	/** The most ship or station may sit off the cruise shot's aim. The near
	 *  camera is 60° tall, so this keeps both inside the frame. */
	keepBothDeg: 22,
	/** Below this much of the star across the axis (about 11°), the sun side is
	 *  not a direction and the ship's own side is used. */
	minAcross: 0.2,
});

const X: Vec3 = { x: 1, y: 0, z: 0 };

/** `v` squared against `axis` and unit, or `fallback` when `v` lies along
 *  it — never the noise a near-zero remainder normalises into. */
function across(v: Vec3, axis: Vec3, fallback: Vec3): Vec3 {
	const rest = sub(v, scale(axis, dot(v, axis)));
	return length(rest) < SHOT_FRAMING.minAcross * length(v)
		? fallback
		: normalizeOr(rest, fallback);
}

/** The ship's own side: across `axis`, from its up. */
const ownSide = (axis: Vec3, up: Vec3): Vec3 =>
	normalizeOr(
		cross(axis, up),
		normalizeOr(cross(axis, X), { x: 0, y: 1, z: 0 }),
	);

/** A unit vector across `axis`, toward the star where the star is well off
 *  the axis, and the ship's own side where it is not. */
export function sunSide(axis: Vec3, from: Vec3, starPos: Vec3, up: Vec3): Vec3 {
	const toStar = normalizeOr(sub(starPos, from), X);
	return across(toStar, axis, ownSide(axis, up));
}

/** The axis a shot's side is taken across. */
const shotAxis = (shot: OpeningShot, scene: ShotScene): Vec3 => {
	if (shot === "dock" && scene.station) return scene.station.axis;
	// The approach shot is laid out on the line from the station through the
	// ship, so its side is taken across that line.
	if (shot === "approach" && scene.station)
		return normalizeOr(sub(scene.ship.pos, scene.station.pos), scene.ship.nose);
	return scene.ship.nose;
};

/** Anchor a shot on its first step. */
export function anchorShot(
	shot: OpeningShot,
	scene: ShotScene,
	/** The shot this one follows, when it continues its take rather than
	 *  cutting from it. */
	previous: ShotAnchor | null = null,
): ShotAnchor {
	const { ship } = scene;
	const axis = shotAxis(shot, scene);
	const side = sunSide(axis, ship.pos, scene.starPos, ship.up);
	const base = {
		shot,
		pos: ship.pos,
		up: ship.up,
		side,
		frameVel: scene.frameVel,
		atS: scene.gameTime,
	};
	if (shot === "cruise") {
		const planet = scene.planet?.pos;
		const station = scene.station?.pos;
		return {
			...base,
			reverse:
				!!planet &&
				!!station &&
				degreesApart(
					normalizeOr(sub(station, ship.pos), ship.nose),
					normalizeOr(sub(planet, ship.pos), ship.nose),
				) >= SHOT_FRAMING.cruise.pairDeg,
		};
	}
	if (shot !== "flypast") return base;
	// **One take with the arrival** (the principal's sixth note): the orbit
	// stops where it ended and that camera holds still in its frame while the
	// burn carries the ship past it — no cut. It ended 65° off the nose and
	// about six reaches off the ship's path, so the pass is three-quarters
	// and clear of the hull.
	if (previous?.shot === "arrival") {
		const last = shotCamera(previous, scene);
		return {
			...base,
			pos: last.pos,
			up: last.up,
			lookBehindKm: SHOT_FRAMING.arrival.lookBehindR * scene.reachKm,
		};
	}
	const f = SHOT_FRAMING.flypast;
	const up = across(ship.up, ship.nose, ownSide(side, ship.nose));
	return {
		...base,
		pos: add(
			ship.pos,
			add(
				scale(ship.nose, f.passKm),
				add(scale(side, f.offKm), scale(up, f.upKm)),
			),
		),
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

/** `want`, or as far toward it from `toShip` as keeps the ship in frame. */
function keepShip(toShip: Vec3, want: Vec3): Vec3 {
	const max = (SHOT_FRAMING.keepShipDeg * Math.PI) / 180;
	if (degreesApart(toShip, want) <= SHOT_FRAMING.keepShipDeg) return want;
	const lean = across(want, toShip, want);
	return normalizeOr(
		add(scale(toShip, Math.cos(max)), scale(lean, Math.sin(max))),
		toShip,
	);
}

/** A camera at `pos` looking toward `want` with the ship kept in frame. */
function framing(pos: Vec3, ship: Vec3, want: Vec3, up: Vec3): ShotCamera {
	const toShip = normalizeOr(sub(ship, pos), want);
	return { pos, forward: keepShip(toShip, normalizeOr(want, toShip)), up };
}

/** The camera for `anchor`'s shot, this frame. */
export function shotCamera(anchor: ShotAnchor, scene: ShotScene): ShotCamera {
	const { ship } = scene;
	const r = scene.reachKm;
	// The anchored side, squared against the axis as it is now: it turns with a
	// turning ship and never swings with the noise.
	const axis = shotAxis(anchor.shot, scene);
	const side = across(anchor.side, axis, ownSide(axis, ship.up));
	switch (anchor.shot) {
		case "forming": {
			const f = SHOT_FRAMING.forming;
			const push = eased((scene.gameTime - anchor.atS) / OPENING.formS);
			const ahead = (f.fromR + (f.toR - f.fromR) * push) * r;
			const pos = add(
				ship.pos,
				add(
					scale(ship.nose, ahead),
					add(scale(side, f.sideR * r), scale(ship.up, f.upR * r)),
				),
			);
			// Where the rift stands: behind the arrival point on the nose axis.
			const rift = sub(ship.pos, scale(ship.nose, r));
			return looking(pos, rift, ship.up, scale(ship.nose, -1));
		}
		case "arrival": {
			const f = SHOT_FRAMING.arrival;
			// The orbit's plane is across the ship's up; its second axis points to
			// the anchored side, so the sweep turns toward the lit flank.
			const across2 = normalizeOr(cross(ship.up, ship.nose), side);
			const e2 = dot(across2, side) < 0 ? scale(across2, -1) : across2;
			const u = eased((scene.gameTime - anchor.atS) / f.orbitS);
			const phi = ((f.orbitFromDeg + u * f.orbitDeg) * Math.PI) / 180;
			const rho = Math.hypot(f.aheadR, f.sideR) * r;
			const pos = add(
				ship.pos,
				add(
					add(
						scale(ship.nose, Math.cos(phi) * rho),
						scale(e2, Math.sin(phi) * rho),
					),
					scale(ship.up, f.upR * r),
				),
			);
			const at = sub(ship.pos, scale(ship.nose, f.lookBehindR * r));
			return looking(pos, at, ship.up, scale(ship.nose, -1));
		}
		case "flypast": {
			const since = scene.gameTime - anchor.atS;
			const pos = add(anchor.pos, scale(anchor.frameVel, since));
			// Continuing the arrival's take, the look starts on the arrival's aim
			// and settles onto the ship, so the handover does not snap.
			const behind =
				(anchor.lookBehindKm ?? 0) *
				(1 - eased(since / SHOT_FRAMING.flypast.handoverS));
			const at = sub(ship.pos, scale(ship.nose, behind));
			return looking(pos, at, anchor.up, ship.nose);
		}
		case "cruise": {
			const f = SHOT_FRAMING.cruise;
			const swing =
				(eased((scene.gameTime - anchor.atS) / f.orbitS) *
					f.orbitDeg *
					Math.PI) /
				180;
			const orbit = (at: Vec3) =>
				add(ship.pos, turnedAbout(sub(at, ship.pos), ship.up, swing));
			const station = scene.station?.pos ?? add(ship.pos, ship.nose);
			const planet = scene.planet?.pos;
			if (!anchor.reverse) {
				const from = add(
					ship.pos,
					add(
						scale(ship.nose, -f.behindR * r),
						add(scale(side, f.sideR * r), scale(ship.up, f.upR * r)),
					),
				);
				const pos = orbit(from);
				const toStation = normalizeOr(sub(station, pos), ship.nose);
				const want = planet
					? add(toStation, normalizeOr(sub(planet, pos), toStation))
					: toStation;
				return framing(pos, ship.pos, want, ship.up);
			}
			// The reverse angle: ahead of the ship, looking back past it at the
			// planet, the ship between the two.
			const ahead = orbit(
				add(
					ship.pos,
					add(
						scale(ship.nose, f.aheadR * r),
						add(scale(side, f.sideR * r), scale(ship.up, f.upR * r)),
					),
				),
			);
			const toShip = normalizeOr(sub(ship.pos, ahead), scale(ship.nose, -1));
			const back = planet ? normalizeOr(sub(planet, ahead), toShip) : toShip;
			return framing(ahead, ship.pos, add(toShip, back), ship.up);
		}
		case "approach": {
			const f = SHOT_FRAMING.approach;
			const swing =
				(eased((scene.gameTime - anchor.atS) / f.orbitS) *
					f.orbitDeg *
					Math.PI) /
				180;
			// `axis` runs from the station through the ship: behind the ship on
			// it is where both are ahead of the camera together.
			const lift = across(ship.up, axis, ownSide(axis, side));
			const pos = add(
				ship.pos,
				turnedAbout(
					add(
						scale(axis, f.behindR * r),
						add(scale(side, f.sideR * r), scale(lift, f.upR * r)),
					),
					ship.up,
					swing,
				),
			);
			const toShip = normalizeOr(sub(ship.pos, pos), ship.nose);
			const station = scene.station?.pos;
			if (!station) return { pos, forward: toShip, up: lift };
			const toStation = normalizeOr(sub(station, pos), toShip);
			return {
				pos,
				forward: normalizeOr(add(toShip, toStation), toShip),
				up: lift,
			};
		}
		case "dock": {
			const f = SHOT_FRAMING.dock;
			const station = scene.station;
			if (!station) return looking(ship.pos, ship.nose, ship.up, ship.nose);
			const over = normalizeOr(cross(side, station.axis), ship.up);
			const pos = add(
				ship.pos,
				add(
					scale(station.axis, f.outboardR * r),
					add(scale(side, f.sideR * r), scale(over, f.upR * r)),
				),
			);
			const aperture = add(station.pos, scale(station.axis, station.planeKm));
			return framing(pos, ship.pos, sub(aperture, pos), over);
		}
	}
}

/** Smoothstep on [0, 1], clamped: slow at both ends of a swing. */
const eased = (u: number): number => {
	const t = Math.min(1, Math.max(0, u));
	return t * t * (3 - 2 * t);
};

/** `v` turned by `rad` about the unit `axis` (Rodrigues). */
function turnedAbout(v: Vec3, axis: Vec3, rad: number): Vec3 {
	const c = Math.cos(rad);
	const s = Math.sin(rad);
	return add(
		add(scale(v, c), scale(cross(axis, v), s)),
		scale(axis, dot(axis, v) * (1 - c)),
	);
}

const degreesApart = (a: Vec3, b: Vec3) =>
	(Math.acos(
		Math.min(1, Math.max(-1, dot(normalizeOr(a, X), normalizeOr(b, X)))),
	) *
		180) /
	Math.PI;

/** How far off the camera's line of sight `point` is, in degrees. */
export function offAxisDeg(camera: ShotCamera, point: Vec3): number {
	const to = sub(point, camera.pos);
	const d = length(to);
	if (d === 0) return 0;
	const c = Math.min(1, Math.max(-1, dot(to, camera.forward) / d));
	return (Math.acos(c) * 180) / Math.PI;
}
