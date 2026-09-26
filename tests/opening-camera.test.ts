/**
 * #535: the opening's framing rules (#530 D5) against a made-up scene. What
 * is checked is what a rule can get wrong without a picture: the subject in
 * front of the camera, the camera outside the hull, and a camera that moves
 * with what it films. How it *looks* is the strip's.
 */
import { describe, expect, test } from "bun:test";
import {
	SHOT_FRAMING,
	type ShotScene,
	anchorShot,
	offAxisDeg,
	shotCamera,
	sunSide,
} from "../src/opening-camera";
import { OPENING_SHOTS } from "../src/opening";
import { type Vec3, add, dot, length, scale, sub, v3 } from "../src/vec3";

const R = 0.036;

/** A ship 60 km out along +x from a station whose aperture faces it, the star
 *  far off to one side, and the station on a 30 km/s orbit. */
function scene(over: Partial<ShotScene> = {}): ShotScene {
	return {
		ship: { pos: v3(1060, 0, 0), nose: v3(-1, 0, 0), up: v3(0, 1, 0) },
		reachKm: R,
		starPos: v3(0, 0, -1.5e8),
		station: { pos: v3(1000, 0, 0), axis: v3(1, 0, 0), planeKm: 0.44 },
		planet: null,
		frameVel: v3(0, 0, 30),
		gameTime: 100,
		...over,
	};
}

const moved = (s: ShotScene, by: Vec3): ShotScene => ({
	...s,
	ship: { ...s.ship, pos: add(s.ship.pos, by) },
	station: s.station ? { ...s.station, pos: add(s.station.pos, by) } : null,
});

const near = (a: Vec3, b: Vec3) => expect(length(sub(a, b))).toBeLessThan(1e-9);

describe("every shot", () => {
	for (const shot of OPENING_SHOTS.guided)
		test(`${shot}: the ship is in front of the camera and the camera is outside it`, () => {
			const s = scene();
			const cam = shotCamera(anchorShot(shot, s), s);
			expect(length(sub(cam.pos, s.ship.pos))).toBeGreaterThan(2 * R);
			expect(offAxisDeg(cam, s.ship.pos)).toBeLessThan(30);
			expect(Math.abs(length(cam.forward) - 1)).toBeLessThan(1e-9);
			expect(Math.abs(dot(cam.forward, cam.up))).toBeLessThan(0.9);
		});
});

describe("a camera moves with what it films", () => {
	for (const shot of ["arrival", "cruise", "dock"] as const)
		test(`${shot} rides its subject`, () => {
			const s = scene();
			const anchor = anchorShot(shot, s);
			const by = v3(0, 0, 30);
			near(
				shotCamera(anchor, moved(s, by)).pos,
				add(shotCamera(anchor, s).pos, by),
			);
		});

	test("the fly-past stands still in the frame it was anchored in", () => {
		const s = scene();
		const anchor = anchorShot("flypast", s);
		const later = { ...moved(s, v3(0, 0, 60)), gameTime: s.gameTime + 2 };
		near(
			shotCamera(anchor, later).pos,
			add(shotCamera(anchor, s).pos, scale(s.frameVel, 2)),
		);
	});
});

describe("each shot's rule", () => {
	test("the fly-past stands down the nose, where the ship will pass it", () => {
		const s = scene();
		const cam = shotCamera(anchorShot("flypast", s), s);
		const along = dot(sub(cam.pos, s.ship.pos), s.ship.nose);
		expect(along).toBeCloseTo(SHOT_FRAMING.flypast.passKm, 9);
	});

	test("the dock shot looks at the aperture, with the ship in frame", () => {
		const s = scene({
			ship: { pos: v3(1001.2, 0, 0), nose: v3(-1, 0, 0), up: v3(0, 1, 0) },
		});
		const cam = shotCamera(anchorShot("dock", s), s);
		const aperture = add(s.station!.pos, scale(s.station!.axis, 0.44));
		expect(offAxisDeg(cam, aperture)).toBeLessThan(1e-6);
		expect(offAxisDeg(cam, s.ship.pos)).toBeLessThan(25);
		// Outboard of the ship: the ship is between the camera and the station.
		expect(dot(sub(cam.pos, s.ship.pos), s.station!.axis)).toBeGreaterThan(0);
	});

	test("the cruise shot frames the station and its planet together when both fit", () => {
		const s = scene({ planet: { pos: v3(1000, 40, 0) } });
		const cam = shotCamera(anchorShot("cruise", s), s);
		// The look leans from the station toward the planet, as far as keeping
		// the ship in frame allows.
		const alone = scene();
		const stationOnly = shotCamera(anchorShot("cruise", alone), alone);
		expect(offAxisDeg(cam, s.planet!.pos)).toBeLessThan(
			offAxisDeg(stationOnly, s.planet!.pos),
		);
		expect(offAxisDeg(cam, s.ship.pos)).toBeLessThanOrEqual(
			SHOT_FRAMING.keepShipDeg + 1e-6,
		);
		// A planet behind the ship: the reverse angle, ahead of the ship looking
		// back at it, with the planet behind it in the same frame.
		const behind = scene({ planet: { pos: v3(1200, 20, 0) } });
		const reverse = shotCamera(anchorShot("cruise", behind), behind);
		expect(
			dot(sub(reverse.pos, behind.ship.pos), behind.ship.nose),
		).toBeGreaterThan(0);
		expect(offAxisDeg(reverse, behind.ship.pos)).toBeLessThan(30);
		expect(offAxisDeg(reverse, behind.planet!.pos)).toBeLessThan(30);
	});

	test("the cruise shot looks at the station it is flying to", () => {
		const s = scene();
		const cam = shotCamera(anchorShot("cruise", s), s);
		expect(offAxisDeg(cam, s.station!.pos)).toBeLessThan(1e-6);
	});

	test("the camera stands on the sun side, so it sees the lit flank", () => {
		const s = scene();
		for (const shot of ["arrival", "cruise"] as const) {
			const cam = shotCamera(anchorShot(shot, s), s);
			const toStar = sub(s.starPos, s.ship.pos);
			expect(dot(sub(cam.pos, s.ship.pos), toStar)).toBeGreaterThan(0);
		}
	});

	test("a star on the axis still gives a side", () => {
		const side = sunSide(v3(1, 0, 0), v3(0, 0, 0), v3(1e8, 0, 0), v3(0, 1, 0));
		expect(length(side)).toBeCloseTo(1, 9);
		expect(Math.abs(dot(side, v3(1, 0, 0)))).toBeLessThan(1e-9);
	});
});

describe("a shot keeps its angle", () => {
	test("the cruise angle is chosen on the shot's first step, not per frame", () => {
		const start = scene({ planet: { pos: v3(1000, 40, 0) } });
		const anchor = anchorShot("cruise", start);
		expect(anchor.reverse).toBe(false);
		// Later in the take the planet has swung behind the ship. Chosen per
		// frame this would cut to the reverse angle mid-shot.
		const later = { ...start, planet: { pos: v3(1200, 20, 0) } };
		const cam = shotCamera(anchor, later);
		expect(dot(sub(cam.pos, later.ship.pos), later.ship.nose)).toBeLessThan(0);
		expect(anchorShot("cruise", later).reverse).toBe(true);
	});
});

describe("the principal's flight on seeds 47–51 (#535)", () => {
	// A new game boots with the star straight down the nose on some seeds
	// (48 measured star·nose = 1.0). The "sun side" across the nose was then
	// float noise scaled to unit length, and a 1e-12 attitude wobble per step
	// turned it round the axis: the camera jumped between framings each frame.
	test("a star on the nose gives a side that does not move with the noise", () => {
		const nose = v3(
			-0.4630937496796608,
			-0.3597517463542386,
			-0.8100141109898688,
		);
		const up = v3(
			-0.17855327333830617,
			0.9330480593169227,
			-0.31231402079493736,
		);
		const at = (k: number) => scale(nose, -1.4e8 + k);
		const sides = [0, 1e-7, 3e-7].map((k) => sunSide(nose, at(k), v3(), up));
		for (const s of sides) {
			expect(Math.abs(dot(s, nose))).toBeLessThan(1e-9);
			expect(length(sub(s, sides[0]))).toBeLessThan(1e-6);
		}
	});

	test("a shot's side is fixed on its first step, so a wobble cannot swing it", () => {
		const s = scene({
			starPos: add(v3(1060, 0, 0), scale(v3(-1, 0, 0), 1.5e8)),
		});
		for (const shot of ["arrival", "cruise", "dock"] as const) {
			const anchor = anchorShot(shot, s);
			const wobble = {
				...s,
				starPos: add(s.starPos, v3(0, 1e-3, 1e-3)),
			};
			near(shotCamera(anchor, wobble).pos, shotCamera(anchor, s).pos);
		}
	});

	test("the fly-past never comes within two reaches of the ship on its path", () => {
		const s = scene();
		const anchor = anchorShot("flypast", s);
		let closest = Number.POSITIVE_INFINITY;
		for (let t = 0; t <= 5; t += 0.01) {
			const pos = add(s.ship.pos, scale(s.ship.nose, 0.1 * t));
			closest = Math.min(
				closest,
				length(
					sub(shotCamera(anchor, { ...s, ship: { ...s.ship, pos } }).pos, pos),
				),
			);
		}
		expect(closest).toBeGreaterThan(2 * R);
	});

	test("at the pass the fly-past sees the ship from above, not flat side-on", () => {
		const s = scene();
		const anchor = anchorShot("flypast", s);
		const cam = shotCamera(anchor, s);
		const rel = sub(cam.pos, s.ship.pos);
		const above =
			dot(rel, s.ship.up) /
			length(sub(rel, scale(s.ship.nose, dot(rel, s.ship.nose))));
		expect(above).toBeGreaterThan(Math.sin((20 * Math.PI) / 180));
	});

	test("the cruise shot keeps the ship in frame however far the planet swings", () => {
		for (const planet of [
			v3(1000, 40, 0),
			v3(1060, 300, 0),
			v3(1200, 20, 0),
			v3(900, -500, 200),
		]) {
			const s = scene({ planet: { pos: planet } });
			const anchor = anchorShot("cruise", s);
			for (const later of [planet, v3(1060, 0, 500), v3(1300, -40, 0)]) {
				const cam = shotCamera(anchor, { ...s, planet: { pos: later } });
				expect(offAxisDeg(cam, s.ship.pos)).toBeLessThan(
					SHOT_FRAMING.keepShipDeg + 1e-6,
				);
			}
		}
	});
});

describe("the arrival orbits the ship (the principal's second flight)", () => {
	const at = (s: ShotScene, t: number) => ({ ...s, gameTime: s.gameTime + t });
	test("the camera swings about sixty degrees round the ship over the shot, at one distance", () => {
		const s = scene();
		const anchor = anchorShot("arrival", s);
		const start = shotCamera(anchor, s);
		const end = shotCamera(anchor, at(s, SHOT_FRAMING.arrival.orbitS));
		const flat = (c: { pos: Vec3 }) => {
			const rel = sub(c.pos, s.ship.pos);
			return sub(rel, scale(s.ship.up, dot(rel, s.ship.up)));
		};
		const [a, b] = [flat(start), flat(end)];
		const swept =
			(Math.acos(dot(a, b) / (length(a) * length(b))) * 180) / Math.PI;
		expect(swept).toBeCloseTo(SHOT_FRAMING.arrival.orbitDeg, 3);
		expect(length(sub(end.pos, s.ship.pos))).toBeCloseTo(
			length(sub(start.pos, s.ship.pos)),
			9,
		);
	});
	test("it eases: slow at both ends, the ship in frame throughout", () => {
		const s = scene();
		const anchor = anchorShot("arrival", s);
		const T = SHOT_FRAMING.arrival.orbitS;
		const step = (t: number) =>
			length(
				sub(
					shotCamera(anchor, at(s, t + 0.1)).pos,
					shotCamera(anchor, at(s, t)).pos,
				),
			);
		expect(step(0)).toBeLessThan(step(T / 2 - 0.05) / 3);
		expect(step(T - 0.1)).toBeLessThan(step(T / 2 - 0.05) / 3);
		for (let t = 0; t <= T; t += 0.5)
			expect(offAxisDeg(shotCamera(anchor, at(s, t)), s.ship.pos)).toBeLessThan(
				25,
			);
	});
});

describe("the cruise shot orbits a little too (the principal's third note)", () => {
	const at = (s: ShotScene, t: number) => ({ ...s, gameTime: s.gameTime + t });
	for (const planet of [v3(1000, 40, 0), v3(1200, 20, 0)])
		test(`the camera swings round the ship over the take, at one distance (planet ${planet.x})`, () => {
			const s = scene({ planet: { pos: planet } });
			const anchor = anchorShot("cruise", s);
			const T = SHOT_FRAMING.cruise.orbitS;
			const rel = (t: number) => {
				const r = sub(shotCamera(anchor, at(s, t)).pos, s.ship.pos);
				return sub(r, scale(s.ship.up, dot(r, s.ship.up)));
			};
			const [a, b] = [rel(0), rel(T)];
			const swept =
				(Math.acos(dot(a, b) / (length(a) * length(b))) * 180) / Math.PI;
			expect(swept).toBeCloseTo(SHOT_FRAMING.cruise.orbitDeg, 3);
			expect(length(b)).toBeCloseTo(length(a), 9);
			for (let t = 0; t <= T; t += 1)
				expect(
					offAxisDeg(shotCamera(anchor, at(s, t)), s.ship.pos),
				).toBeLessThanOrEqual(SHOT_FRAMING.keepShipDeg + 1e-6);
		});
});
