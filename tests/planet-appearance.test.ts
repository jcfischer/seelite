import { expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import { WARMTH, appearanceFor, classify } from "../src/planet-appearance";
import {
	GIANT_ORBIT_FACTOR,
	generateContents,
	orbitWarmth,
} from "../src/system";

/** `a/a_hab` midway between two rungs, so a threshold nudge does not flip it. */
const between = (low: number, high: number) => (low + high) / 2;

/** A rocky planet at a given orbit ratio. */
const rocky = (warmth: number, id = "planet-3") =>
	appearanceFor("planet", id, warmth, false);

test("the warmth ladder walks scorched to frozen without skipping a rung", () => {
	expect(rocky(between(0, WARMTH.LAVA)).surface).toBe("lava");
	expect(rocky(between(WARMTH.LAVA, WARMTH.VENUS)).surface).toBe("venusian");
	expect(rocky(between(WARMTH.VENUS, WARMTH.TERRAN)).surface).toBe("terran");
	expect(rocky(between(WARMTH.TERRAN, WARMTH.DESERT)).surface).toBe("desert");
	// Past DESERT a *rocky* body is ice. Which of the two families a body past
	// that line belongs to is `isGasGiant`'s call, not distance's.
	expect(rocky(3).surface).toBe("ice");
	expect(rocky(40).surface).toBe("ice");
});

test("the desert rung and the giant rung are one boundary, not two", () => {
	// Two names for one line. Split them and a band opens between the last
	// rocky rung and the first giant one, which nothing would classify.
	expect(WARMTH.DESERT).toBe(WARMTH.GIANT);
	// And the line is the generator's own, imported rather than restated — so
	// this is now a structural fact, not a number the test has to police. The
	// sweep below still checks that the rule built on it agrees per planet.
	expect(WARMTH.GIANT).toBe(GIANT_ORBIT_FACTOR);
});

test("a planet cannot be classified without saying which family it is in", () => {
	// The compiler enforces this — `appearanceFor("planet", id, warmth)` does not
	// type-check — so the runtime check here is that the flag actually decides,
	// rather than the orbit quietly overriding it.
	expect(appearanceFor("planet", "planet-5", 3, true).surface).toBe("jovian");
	expect(appearanceFor("planet", "planet-5", 3, false).surface).toBe("ice");
	expect(appearanceFor("planet", "planet-9", 8, true).surface).toBe("iceGiant");
	expect(appearanceFor("planet", "planet-9", 8, false).surface).toBe("ice");
});

/**
 * What the generator actually produces, run through the ladder.
 *
 * The family is now also decided by the independent formation-mass roll; an
 * outer orbit may be a rocky ice world. This sweep checks that
 * the ladder's thresholds sit where the generator's orbits actually fall. Every
 * rung could be internally consistent and still describe worlds that never get
 * generated — set `WARMTH.TERRAN` to 0.01 and no system in the galaxy would
 * ever contain a terran world, with nothing else going red.
 */
test("the ladder's rungs land where the generator's orbits actually fall", () => {
	const systems = Array.from({ length: 4 }, (_, g) =>
		generateGalaxy(20260826, g),
	)
		.flatMap((galaxy) => galaxy.systems)
		// Every tenth system: this sweep runs the full contents generator, and the
		// claim is about the distribution rather than any one system.
		.filter((_, i) => i % 10 === 0);

	const seen = new Map<string, number>();
	let planets = 0;
	for (const record of systems) {
		const contents = generateContents(record);
		for (const planet of contents.planets) {
			planets++;
			const warmth = orbitWarmth(planet.aAu, contents.star.luminosity);
			const surface = classify("planet", warmth, planet.isGasGiant);
			seen.set(surface, (seen.get(surface) ?? 0) + 1);

			// The branch structure *is* worth asserting: it is a property of
			// `classify`, not of the arithmetic. A giant must never be drawn as a
			// rocky world, whatever its orbit.
			const drawnAsGiant = surface === "jovian" || surface === "iceGiant";
			expect(drawnAsGiant).toBe(planet.isGasGiant);
		}
	}

	expect(planets).toBeGreaterThan(200);

	// All seven planet rungs are reachable from real generated orbits.
	for (const rung of [
		"lava",
		"venusian",
		"terran",
		"desert",
		"ice",
		"jovian",
		"iceGiant",
	])
		expect(seen.get(rung) ?? 0).toBeGreaterThan(0);
});

test("class comes from the orbit, decoration comes from the seed", () => {
	// Two ids at the same relative orbit are the same kind of world...
	const a = rocky(1.0, "planet-1");
	const b = rocky(1.0, "planet-2");
	expect(a.surface).toBe(b.surface);
	// ...with different weather.
	expect(a.seed).not.toBe(b.seed);
	expect(a.seaLevel).not.toBe(b.seaLevel);

	// And the same id twice is byte-identical, because nothing here is random.
	expect(rocky(1.0, "planet-1")).toEqual(a);
});

test("terran sea levels stay inside the band that leaves land and water", () => {
	// A *threshold*, not a fraction: only the browser runs the noise it cuts, so
	// what the band actually floods is measured in `probe-planets.mjs`.
	for (let i = 0; i < 64; i++) {
		const world = rocky(1.0, `planet-${i}`);
		expect(world.surface).toBe("terran");
		expect(world.seaLevel).toBeGreaterThanOrEqual(0.55);
		expect(world.seaLevel).toBeLessThanOrEqual(0.75);
		expect(world.cloudCover).toBeGreaterThan(0);
	}
});

test("a class with no shell leaves the shell fields alone", () => {
	// The interface says `atmosphereColor` is read only when `atmosphere` is
	// above 0. Airless bodies and stars must not carry a colour nothing draws.
	for (const look of [
		appearanceFor("star", "star"),
		appearanceFor("moon", "planet-5-moon-0", 3),
	]) {
		expect(look.atmosphere).toBe(0);
		expect(look.atmosphereColor).toBe(0);
		expect(look.seaLevel).toBe(0);
		expect(look.cloudCover).toBe(0);
		expect(look.hasRings).toBe(false);
	}
});

test("stars and moons opt out of the ladder", () => {
	expect(appearanceFor("star", "star")).toMatchObject({
		surface: "star",
		warmth: 0,
	});
	// A moon sits at its planet's distance from the star, so it is handed the
	// parent's warmth — but nothing at moon mass holds a shell.
	expect(appearanceFor("moon", "planet-5-moon-0", 3)).toMatchObject({
		surface: "airless",
		warmth: 3,
		atmosphere: 0,
	});
});

test("rings are a giant-only event, not a coin flip on every giant", () => {
	const giants = Array.from({ length: 200 }, (_, i) =>
		appearanceFor("planet", `planet-${i}`, 3, true),
	);
	const ringed = giants.filter((g) => g.hasRings).length;
	expect(ringed).toBeGreaterThan(0);
	expect(ringed).toBeLessThan(giants.length);
	// No rocky world may sprout one.
	expect(rocky(1.0).hasRings).toBe(false);
	expect(rocky(3).hasRings).toBe(false);
});
