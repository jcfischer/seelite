import { expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import {
	type SurfaceClass,
	appearanceFor,
	appearanceOf,
	classify,
} from "../src/planet-appearance";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import { fragmentFor } from "../src/planet-shaders";
import { makeSystem } from "../src/sim";
import { generateContents, orbitWarmth } from "../src/system";

const GALAXY = generateGalaxy(20260826, 0);

/**
 * Systems with something of everything in them.
 *
 * Every tenth record rather than all of them: `generateContents` is the
 * expensive half, and every claim below is about the mapping rather than about
 * any one system.
 */
const SAMPLE = GALAXY.systems.filter((_, i) => i % 10 === 0);

test("every generated body is classified from the generator's own numbers", () => {
	let planets = 0;
	let moons = 0;
	for (const record of SAMPLE) {
		const contents = generateContents(record);

		const star = appearanceOf({ id: contents.star.id, kind: "star" }, contents);
		expect(star?.surface).toBe("star");

		for (const planet of contents.planets) {
			planets++;
			const look = appearanceOf({ id: planet.id, kind: "planet" }, contents);
			// The point of the accessor: the class comes from `aAu` and the star's
			// luminosity as the generator recorded them, not from a second
			// derivation that could drift.
			const warmth = orbitWarmth(planet.aAu, contents.star.luminosity);
			expect(look?.surface).toBe(classify("planet", warmth, planet.isGasGiant));
			expect(look?.warmth).toBeCloseTo(warmth, 12);

			for (const moon of planet.moons) {
				moons++;
				const lunar = appearanceOf({ id: moon.id, kind: "moon" }, contents);
				expect(lunar?.surface).toBe("airless");
				// A moon is at its planet's distance from the star, so it reads the
				// parent's warmth and not a warmth of its own. Getting this wrong is
				// invisible in a screenshot and wrong in the albedo.
				expect(lunar?.warmth).toBeCloseTo(warmth, 12);
			}
		}
	}
	expect(planets).toBeGreaterThan(50);
	expect(moons).toBeGreaterThan(10);
});

test("a station has no surface class, because it is not a sphere", () => {
	const contents = generateContents(SAMPLE[0]);
	// `for` over an empty list asserts nothing. The same hole the browser probe
	// guards against, and it is worth closing here too — a generator change that
	// stopped emitting stations would otherwise leave this reporting green about
	// a case it never saw.
	expect(contents.stations.length).toBeGreaterThan(0);
	for (const station of contents.stations)
		expect(
			appearanceOf({ id: station.id, kind: "station" }, contents),
		).toBeUndefined();
});

test("a body that is not in the contents throws rather than defaulting", () => {
	const contents = generateContents(SAMPLE[0]);
	// The same stance `colorFor` takes: a placed body missing from the contents
	// is the two halves of the generator disagreeing, not a display question.
	expect(() =>
		appearanceOf({ id: "planet-not-here", kind: "planet" }, contents),
	).toThrow();
	expect(() =>
		appearanceOf({ id: "planet-1-moon-9", kind: "moon" }, contents),
	).toThrow();
});

test("the renderer's bodies carry the appearance the generator implies", () => {
	const record = SAMPLE[0];
	const system = makeSystem(record, 0);
	const contents = generateContents(record);
	let drawn = 0;
	for (const body of system.bodies) {
		if (body.kind === "station") {
			expect(body.appearance).toBeUndefined();
			continue;
		}
		drawn++;
		expect(body.appearance).toEqual(
			appearanceOf({ id: body.id, kind: body.kind }, contents),
		);
	}
	expect(drawn).toBeGreaterThan(1);
});

const CLASSES: SurfaceClass[] = [
	"star",
	"lava",
	"venusian",
	"terran",
	"desert",
	"ice",
	"airless",
	"jovian",
	"iceGiant",
];

test("every class assembles its own fragment shader", () => {
	const shaders = CLASSES.map((surface) => fragmentFor(surface));
	// Nine distinct programs, not one program with nine names.
	expect(new Set(shaders).size).toBe(CLASSES.length);
	for (const source of shaders) {
		// The contract every class body fills in, and the shared main that calls
		// it. A class whose `surface()` failed to paste would compile and draw a
		// flat grey sphere with nothing red.
		expect(source).toContain("void surface(");
		expect(source).toContain("surface(p, albedo, N, emissive");
	}
});

test("only the airless class pays for craters", () => {
	// The cost finding this node's detail band exists for. If another class
	// grows a crater field, the band was measured against a body that no longer
	// represents the worst case.
	//
	// Asked of the class bodies, not of the assembled shaders: `craters()` is
	// *defined* in the shared noise block, so every assembled shader contains
	// the string. What the band's worst case depends on is who calls it.
	const withCraters = CLASSES.filter((surface) =>
		CLASS_GLSL[surface].includes("craters("),
	);
	expect(withCraters).toEqual(["airless"]);
});

test("appearanceOf is the same answer appearanceFor gives by hand", () => {
	const contents = generateContents(SAMPLE[0]);
	const planet = contents.planets[0];
	const warmth = orbitWarmth(planet.aAu, contents.star.luminosity);
	expect(appearanceOf({ id: planet.id, kind: "planet" }, contents)).toEqual(
		appearanceFor("planet", planet.id, warmth, planet.isGasGiant),
	);
});
