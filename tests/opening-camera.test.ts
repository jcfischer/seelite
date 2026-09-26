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
