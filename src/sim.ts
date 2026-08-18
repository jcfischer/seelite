/**
 * The authoritative world: float64 kilometres, no Three.js, no DOM.
 *
 * ## Why this is its own module
 *
 * The scale research settled that the scene graph is *display only* — nothing
 * reads a position back out of an `Object3D`, because what the renderer holds
 * is a float32 camera-relative shadow of the real number. Keeping the real
 * numbers in a module that cannot import Three.js is how that stays true: an
 * accidental `mesh.getWorldPosition()` in the simulation would not compile
 * here, because there are no meshes.
 *
 * `tests/headless.test.ts` asserts the module loads with no DOM, which is the
 * cheap version of the same claim.
 *
 * ## What is a placeholder here, and what is not
 *
 * **Not** placeholders: the unit scheme, the float64 storage, the rule that
 * the ship's position is integrated here rather than in the renderer. Those
 * come from resolved research and hold whatever the game turns out to be.
 *
 * **Placeholders**, and loudly so:
 *
 * - `generateSystem` invents a star, two planets and a station from a seed.
 *   **The real generator now exists** — `galaxy.ts` and `system.ts`, built from
 *   `docs/specs/galaxy-generation.md` — and this is still what the renderer
 *   draws. The two are not the same shape: the real one produces 3–7 planets on
 *   a rescaled orbit ladder, 1–3 typed stations on moving orbits, and positions
 *   that are a function of a game clock this module does not yet have. Swapping
 *   it in is a renderer change, not a rename, and it has its own node under
 *   [#12](https://github.com/jcfischer/seelite/issues/12). Until then: nothing
 *   here is a proposal about how systems are generated, and nothing new should
 *   be built on this function.
 * - `stepShip` integrates Newtonian motion with a linear damping term. The
 *   flight model is also an open decision. The damping constant here was
 *   picked so a cube is steerable with a keyboard in a browser, which is not
 *   an argument for anything.
 *
 * Orientation deliberately does **not** live here. It is a quaternion the
 * renderer already owns a good type for, and inventing a second quaternion
 * class to keep this module Three-free would be paying a real cost for a
 * boundary that is not under threat — the precision problem is about
 * *positions*, and a unit quaternion has no magnitude to lose precision in.
 * When the flight-model node resolves and orientation starts having dynamics
 * (angular velocity, torque, damping), that is the moment to revisit.
 */

import { AU_KM } from "./units";
import { mix, seedFor, streamFor } from "./rng";

/** A float64 position or velocity in kilometres (or km/s). */
export interface Vec3 {
	x: number;
	y: number;
	z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 =>
	v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 =>
	v3(a.x * k, a.y * k, a.z * k);
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

/**
 * The two allocation-free primitives, which is why they are here rather than
 * spelled out at each call site.
 *
 * `galaxy.ts` and `system.ts` both need a dot product and a squared length in
 * loops that run per system pair and per body — `length(sub(a, b))` would be
 * the tidy spelling and allocates a `Vec3` every time, which is the wrong trade
 * inside an O(n²) scan. These compose into that spelling without the garbage.
 */
export const dot = (a: Vec3, b: Vec3): number =>
	a.x * b.x + a.y * b.y + a.z * b.z;

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

/** What a body is for rendering purposes. The far layer draws `star` and
 *  `planet`; the near layer draws `station`. */
export type BodyKind = "star" | "planet" | "station";

export interface Body {
	id: string;
	kind: BodyKind;
	/** Sim-space position, kilometres, float64. */
	pos: Vec3;
	/** Physical radius in kilometres — scaled with the position in the far
	 *  layer, so the two must not drift apart. */
	radiusKm: number;
	/** Base colour. Emissive for a star, diffuse for everything else. */
	color: number;
}

export interface Ship {
	/** Sim-space position, kilometres, float64. */
	pos: Vec3;
	/** Kilometres per second. */
	vel: Vec3;
}

export interface System {
	seed: number;
	bodies: Body[];
}

export interface World {
	/** The world seed. Every stream in `rng.ts` derives from this one number. */
	seed: number;
	system: System;
	ship: Ship;
}

/**
 * A star, two planets and a station, from a seed.
 *
 * A **stand-in** — see the module docstring. What it is worth keeping when the
 * real generator lands is the shape: bodies with float64 km positions and real
 * radii, drawn from `STREAMS.system` so that adding a draw to the market or the
 * backdrop never moves a planet.
 *
 * Per-body seeds go through `mix(systemSeed, index)` rather than being drawn in
 * sequence, so a body's parameters are a function of *which body it is* — the
 * third planet does not move because the second one gained a moon.
 */
export function generateSystem(worldSeed: number, systemId = 0): System {
	const systemSeed = mix(seedFor(worldSeed, "system"), systemId);
	const rand = streamFor(systemSeed, "system");

	const bodies: Body[] = [
		{
			id: "star",
			kind: "star",
			pos: v3(0, 0, 0),
			// Roughly solar. The far layer divides both this and the position by
			// FAR_SCALE, so the angular size on screen is the real one.
			radiusKm: 6.96e5 * (0.7 + rand() * 0.8),
			color: 0xfff0c8,
		},
	];

	for (let i = 0; i < 2; i++) {
		const r = streamFor(mix(systemSeed, i + 1), "system");
		// Orbits in the ecliptic plane, at 0.6–3.4 AU, at an arbitrary phase.
		const orbitAu = 0.6 + r() * 2.8;
		const phase = r() * Math.PI * 2;
		bodies.push({
			id: `planet-${i}`,
			kind: "planet",
			pos: v3(
				Math.cos(phase) * orbitAu * AU_KM,
				0,
				Math.sin(phase) * orbitAu * AU_KM,
			),
			radiusKm: 2400 + r() * 60000,
			color: [0xb08050, 0x6f93b8, 0x8fae7a, 0xc0a080][Math.floor(r() * 4)],
		});
	}

	// One station, at exactly 1 AU on the +X axis. It is the scaffold's only
	// near-layer object with a real size, which is what makes the 1:1 kilometre
	// scale judgeable by eye. Where stations actually sit — planetary orbit,
	// Lagrange point, anywhere — is the system-generation node's business.
	bodies.push({
		id: "station",
		kind: "station",
		pos: STATION_POS,
		radiusKm: 1.2,
		color: 0x9aa6b2,
	});

	return { seed: systemSeed, bodies };
}

/** The station, and so the ship, at 1 AU from the star — the distance at which
 *  the far layer's scaled sun subtends the angle a real one does. */
export const STATION_POS: Vec3 = { x: AU_KM, y: 0, z: 0 };

/** The ship starts 40 km off the station, pointed at it. Close enough to see it
 *  as an object rather than a dot; far enough that flying to it takes a moment,
 *  which is the only way to tell whether the flight code does anything. */
export const SHIP_START: Vec3 = { x: AU_KM, y: 0, z: 40 };

/** A world at rest, one system, ship parked off the station. */
export function makeWorld(seed: number): World {
	return {
		seed,
		system: generateSystem(seed),
		ship: { pos: { ...SHIP_START }, vel: v3(0, 0, 0) },
	};
}

/**
 * Linear damping, per second, applied to the ship's velocity.
 *
 * **Not a flight-model decision.** Elite's ships fly as if in atmosphere —
 * release the throttle and you slow down — and Newtonian-versus-arcade is one
 * of the load-bearing questions still open on the map. This constant exists so
 * a cube can be steered with a keyboard while that question is unanswered, and
 * the flight-model node is free to delete it.
 */
export const SHIP_DAMPING = 0.6;

/**
 * Advance the ship by `dt` seconds under an acceleration in km/s².
 *
 * Semi-implicit Euler — velocity first, then position from the *new* velocity.
 * It is one line different from the explicit form and noticeably better
 * behaved under a varying frame delta, which is what a browser gives you.
 *
 * `dt` is passed in rather than read from a clock, so a probe can step this
 * with a fixed delta and get the same answer twice. A simulation that reads
 * wall time inside itself is one that cannot be replayed, whatever its seed.
 */
export function stepShip(ship: Ship, accel: Vec3, dt: number): void {
	const damp = Math.max(0, 1 - SHIP_DAMPING * dt);
	ship.vel = scale(add(ship.vel, scale(accel, dt)), damp);
	ship.pos = add(ship.pos, scale(ship.vel, dt));
}
