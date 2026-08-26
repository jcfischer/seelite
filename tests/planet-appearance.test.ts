import { expect, test } from "bun:test";
import { WARMTH, appearanceFor } from "../src/planet-appearance";

/** `a/a_hab` midway between two rungs, so a threshold nudge does not flip it. */
const between = (low: number, high: number) => (low + high) / 2;

test("the warmth ladder walks scorched to frozen without skipping a rung", () => {
	const classAt = (warmth: number) =>
		appearanceFor("planet", "planet-3", warmth).surface;

	expect(classAt(between(0, WARMTH.LAVA))).toBe("lava");
	expect(classAt(between(WARMTH.LAVA, WARMTH.VENUS))).toBe("venusian");
	expect(classAt(between(WARMTH.VENUS, WARMTH.TERRAN))).toBe("terran");
	expect(classAt(between(WARMTH.TERRAN, WARMTH.DESERT))).toBe("desert");
	// Past DESERT a *rocky* body is ice; the giant test below covers the other
	// branch, which the generator takes at exactly the same boundary.
	expect(
		appearanceFor("planet", "planet-3", 3, { isGasGiant: false }).surface,
	).toBe("ice");
});

test("the giant boundary is the generator's own isGasGiant line", () => {
	// `system.ts`: isGasGiant = aAu > 2 * habitableAu. Same number, so a body the
	// generator calls a giant can never be classified as a rocky world.
	expect(WARMTH.GIANT).toBe(2.0);
	expect(appearanceFor("planet", "planet-5", 3).surface).toBe("jovian");
	expect(appearanceFor("planet", "planet-6", 8).surface).toBe("iceGiant");
});

test("class comes from the orbit, decoration comes from the seed", () => {
	// Two ids at the same relative orbit are the same kind of world...
	const a = appearanceFor("planet", "planet-1", 1.0);
	const b = appearanceFor("planet", "planet-2", 1.0);
	expect(a.surface).toBe(b.surface);
	// ...with different weather.
	expect(a.seed).not.toBe(b.seed);

	// And the same id twice is byte-identical, because nothing here is random.
	expect(appearanceFor("planet", "planet-1", 1.0)).toEqual(a);
});

test("terran worlds keep an ocean, and it is never the whole planet", () => {
	for (let i = 0; i < 64; i++) {
		const world = appearanceFor("planet", `planet-${i}`, 1.0);
		expect(world.surface).toBe("terran");
		expect(world.oceanFraction).toBeGreaterThanOrEqual(0.55);
		expect(world.oceanFraction).toBeLessThanOrEqual(0.75);
	}
});

test("stars and moons opt out of the ladder", () => {
	expect(appearanceFor("star", "star", 0)).toMatchObject({
		surface: "star",
		atmosphere: 0,
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
		appearanceFor("planet", `planet-${i}`, 3),
	);
	const ringed = giants.filter((g) => g.hasRings).length;
	expect(ringed).toBeGreaterThan(0);
	expect(ringed).toBeLessThan(giants.length);
	// No rocky world may sprout one.
	expect(appearanceFor("planet", "planet-1", 1.0).hasRings).toBe(false);
});
