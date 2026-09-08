import { expect, test } from "bun:test";
import * as THREE from "three";
import { generateGalaxy } from "../src/galaxy";
import {
	RINGED_CLASSES,
	type SurfaceClass,
	appearanceFor,
	appearanceOf,
	classify,
} from "../src/planet-appearance";
import { CLASS_GLSL } from "../src/planet-classes.glsl";
import {
	BAKE_DESCRIPTORS,
	RING_FRAGMENT,
	RING_GLSL,
	RING_VERTEX,
	bakedFragmentFor,
	fragmentFor,
} from "../src/planet-shaders";
import { buildBodyVisual } from "../src/planet-surface";
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
		if (body.kind === "ship")
			throw new Error("Generated bodies contain a display ship");
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

test("the star class does not read the sun direction", () => {
	// The renderer hands every body a unit vector towards its star, and for the
	// star that vector is undefined — it is at zero distance from itself. The
	// fallback there (`main.ts`: `SUN_DIR.set(0, 0, 1)`) is safe *because* the
	// star class ignores `sunDir`, which until now only a comment said.
	//
	// Asked of the class body, not of the assembled shader: `sunDir` is declared
	// in the shared lighting block and consumed by the shared `shade()`, which
	// the star's `surface()` opts out of by writing `albedo = vec3(0.0)`. What
	// must stay true is that the star's own code does not read it.
	expect(CLASS_GLSL.star).not.toContain("sunDir");
	// And that the classes which *are* lit still go through the shared path, so
	// this is a fact about the star rather than about the whole set.
	expect(fragmentFor("star")).toContain("sunDir");
});

test("appearanceOf is the same answer appearanceFor gives by hand", () => {
	const contents = generateContents(SAMPLE[0]);
	const planet = contents.planets[0];
	const warmth = orbitWarmth(planet.aAu, contents.star.luminosity);
	expect(appearanceOf({ id: planet.id, kind: "planet" }, contents)).toEqual(
		appearanceFor("planet", planet.id, warmth, planet.isGasGiant),
	);
});

/**
 * **#210's two shadows, and the half of them a headless test can hold.**
 *
 * Neither shadow can be evaluated here: both are GLSL, and what they draw is
 * `scripts/probe-planet-surfaces.mjs`'s to measure. What a test owns is
 * everything around them — which programs the term is compiled into, which it
 * must stay out of, that the two directions read one band rather than two
 * copies of one, and that a body with no ring is told so rather than being
 * handed a ring's radii and left to find out.
 *
 * The scale half is a source assertion for the same reason and is the weakest
 * row here. It is worth having anyway: the defect it pins is that the eclipse
 * term compared a **world-unit** distance against `1.0` while every body in the
 * game is drawn at `radiusKm × layerFactor`, so the shadow was fully lit in
 * every shipped frame and had been since it was written. A term that quietly
 * loses its divisor goes back to that, and the probe that catches it needs a
 * browser.
 */
test("the eclipse on a ring is measured in body radii, not in world units", () => {
	// The vertex shader hands the fragment the world length of one body radius,
	// and the fragment divides by it. Both halves, because either alone is inert.
	expect(RING_VERTEX).toContain("vBodyR");
	expect(RING_FRAGMENT).toContain("varying float vBodyR;");
	expect(RING_FRAGMENT.replace(/\s+/g, " ")).toContain("/ vBodyR");
});

test("only the classes that can carry rings carry the ring's shadow", () => {
	// The term costs every fragment of every program it is compiled into, and
	// #248 measured planet fragments as the frame — so it is compiled per class
	// rather than branched on a uniform, which `RELIEF_PATHS` argues for at
	// length one screen up in the module it lives in.
	for (const surface of RINGED_CLASSES)
		expect([
			surface,
			fragmentFor(surface).includes("float ringShadow("),
		]).toEqual([surface, true]);
	const others = CLASSES.filter((s) => !RINGED_CLASSES.includes(s));
	expect(others.length).toBeGreaterThan(5);
	for (const surface of others)
		expect([surface, fragmentFor(surface).includes("ringShadow")]).toEqual([
			surface,
			false,
		]);
	// And no baked program carries it. A baked body is drawn from a cube, and a
	// cube cannot hold a shadow that moves with the sun.
	for (const surface of Object.keys(BAKE_DESCRIPTORS) as SurfaceClass[])
		expect([surface, bakedFragmentFor(surface).includes("ringShadow")]).toEqual(
			[surface, false],
		);
});

test("no class that can carry rings can also be baked", () => {
	// The anti-criterion. Both halves are read from the modules that own them,
	// so this goes red on the day a giant gains a bake descriptor — which would
	// take its ring shadow away with nothing else noticing, because the shadow
	// is in the procedural program and the baked one draws from a cube.
	const baked = new Set(Object.keys(BAKE_DESCRIPTORS));
	expect(RINGED_CLASSES.filter((s) => baked.has(s))).toEqual([]);
	// Guarded on both sides, so it cannot pass by either list being empty.
	expect(RINGED_CLASSES.length).toBe(2);
	expect(baked.size).toBeGreaterThan(0);
});

test("both directions of the shadow read one band, not two copies of one", () => {
	// What makes the band on the planet the *same* band the ring draws: one
	// function, called from the ring's own fragment and from the surface's. The
	// frequency literal is the tell — a second copy is what a hand-inlined
	// version would look like, and it would drift on the first retune.
	//
	// **A call site, not a mention.** The first version of this row asserted
	// `toContain("ringSample(")`, which the function's own *declaration*
	// satisfies — both consumers could be deleted and it would still pass. Both
	// halves are asserted instead: the declaration appears once, and there is at
	// least one further occurrence, which can only be a call.
	const occurrences = (haystack: string, needle: string) =>
		haystack.split(needle).length - 1;
	expect(occurrences(RING_GLSL, "void ringSample(")).toBe(1);
	expect(occurrences(RING_FRAGMENT, "void ringSample(")).toBe(1);
	expect(occurrences(RING_FRAGMENT, "ringSample(")).toBeGreaterThan(1);
	for (const surface of RINGED_CLASSES) {
		const source = fragmentFor(surface);
		expect([surface, occurrences(source, "void ringSample(")]).toEqual([
			surface,
			1,
		]);
		expect([surface, occurrences(source, "ringSample(") > 1]).toEqual([
			surface,
			true,
		]);
		// And the band itself is spelled once per program, not once per caller.
		expect([surface, occurrences(source, "t * 34.0")]).toEqual([surface, 1]);
	}
	expect(occurrences(RING_GLSL, "t * 34.0")).toBe(1);
});

/** A ringable class, built the way the generator builds one: `isGasGiant` and a
 *  warmth on the warm side of the giant split, so `classify` returns `jovian`
 *  rather than the test naming a class the generator might not agree with. */
const giantLook = (id: string) => {
	const look = appearanceFor("planet", id, 1.0, true);
	expect(look.surface).toBe("jovian");
	return look;
};

test("a body is told whether it has a ring, rather than inferring it from the radii", () => {
	// `innerR` and `outerR` are in the shared uniform block on **every** body,
	// ringed or not — they were there before #210 for the ring's own program to
	// read. So a surface shader that decided from them alone would lay a ring's
	// shadow across a giant that has none, and the two giants that do have one
	// are three in eight. The flag is what separates them, and it is set from
	// the same `hasRings` the ring mesh is built on.
	const ringed = giantLook("planet-6");
	ringed.hasRings = true;
	const bare = { ...ringed, hasRings: false };
	const sphere = new THREE.SphereGeometry(1, 8, 6);
	const withRing = buildBodyVisual(ringed, sphere);
	const withoutRing = buildBodyVisual(bare, sphere);
	expect(withRing.uniforms.ringPresent?.value).toBe(1);
	expect(withoutRing.uniforms.ringPresent?.value).toBe(0);
});

test("the ring normal handed to the surface is the ring's own world normal", () => {
	// The shadow marches from a surface point along `sunDir`, which is a **world**
	// direction, to the ring's plane — so the plane's normal has to be in the
	// same frame or the two are measured in different spaces and the band lands
	// somewhere arbitrary. Taken from the ring child's world matrix rather than
	// from the tilt constants, so a group that is ever rotated by whatever holds
	// it does not silently move the shadow off the ring.
	const look = giantLook("planet-6");
	look.hasRings = true;
	const visual = buildBodyVisual(look, new THREE.SphereGeometry(1, 8, 6));
	// A parent with a rotation of its own: the case the constants cannot answer.
	const parent = new THREE.Group();
	parent.rotation.set(0.4, -0.9, 0.25);
	parent.add(visual.group);
	parent.updateMatrixWorld(true);
	visual.setSunDirection(new THREE.Vector3(1, 0, 0), 0.005);

	const ring = visual.group.children.find(
		(child) => child.name === "decor" && child instanceof THREE.Mesh,
	);
	expect(ring).toBeDefined();
	const expected = new THREE.Vector3();
	(ring as THREE.Object3D).getWorldDirection(expected);
	const got = visual.uniforms.ringNormal?.value as THREE.Vector3;
	expect(got.length()).toBeCloseTo(1, 6);
	expect(Math.abs(got.dot(expected))).toBeCloseTo(1, 6);
});
