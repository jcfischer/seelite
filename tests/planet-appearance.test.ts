import { expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import {
	GIANT_ORBIT_FACTOR,
	WARMTH,
	appearanceFor,
	classify,
} from "../src/planet-appearance";
import { MAX_ORBIT_AU, MIN_ORBIT_AU, generateContents } from "../src/system";

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
 * The parity claim, checked against real generated systems.
 *
 * The point of this ladder is that it needs no new simulation state, and that
 * rests entirely on `WARMTH.GIANT` being the *same line* `system.ts` draws with
 * `aAu > 2 * habitableAu`. Asserting `WARMTH.GIANT === 2` would be a literal
 * checked against itself: it stays green while the generator's factor moves and
 * the stated parity goes false. So generate systems and compare.
 */
test("the giant rung agrees with the generator on every planet it makes", () => {
	const systems = Array.from({ length: 4 }, (_, g) =>
		generateGalaxy(20260826, g),
	)
		.flatMap((galaxy) => galaxy.systems)
		// Every tenth system: this sweep runs the full contents generator, and the
		// claim is a per-planet invariant rather than a distribution.
		.filter((_, i) => i % 10 === 0);

	let planets = 0;
	let giants = 0;
	for (const record of systems) {
		const contents = generateContents(record);
		// The generator's own habitable distance, spelled the same way (§6.1).
		const habitableAu = Math.min(
			MAX_ORBIT_AU,
			Math.max(MIN_ORBIT_AU, Math.sqrt(contents.star.luminosity)),
		);
		for (const planet of contents.planets) {
			planets++;
			if (planet.isGasGiant) giants++;
			const warmth = planet.aAu / habitableAu;
			// The line itself: the ladder's threshold and the generator's rule
			// classify every generated planet the same way.
			expect(warmth > WARMTH.GIANT).toBe(planet.isGasGiant);

			const surface = classify("planet", warmth, planet.isGasGiant);
			const drawnAsGiant = surface === "jovian" || surface === "iceGiant";
			expect(drawnAsGiant).toBe(planet.isGasGiant);
		}
	}
	// A sweep that classified nothing would pass every assertion above.
	expect(planets).toBeGreaterThan(200);
	expect(giants).toBeGreaterThan(0);
	expect(giants).toBeLessThan(planets);
});

test("class comes from the orbit, decoration comes from the seed", () => {
	// Two ids at the same relative orbit are the same kind of world...
	const a = rocky(1.0, "planet-1");
	const b = rocky(1.0, "planet-2");
	expect(a.surface).toBe(b.surface);
	// ...with different weather.
	expect(a.seed).not.toBe(b.seed);
	expect(a.oceanFraction).not.toBe(b.oceanFraction);

	// And the same id twice is byte-identical, because nothing here is random.
	expect(rocky(1.0, "planet-1")).toEqual(a);
});

test("terran worlds keep an ocean, and it is never the whole planet", () => {
	for (let i = 0; i < 64; i++) {
		const world = rocky(1.0, `planet-${i}`);
		expect(world.surface).toBe("terran");
		expect(world.oceanFraction).toBeGreaterThanOrEqual(0.55);
		expect(world.oceanFraction).toBeLessThanOrEqual(0.75);
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
