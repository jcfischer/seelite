/**
 * The player's legal heat (`civilian-combat.md` H4): what an offence
 * costs, how it decays, and which standing it reads as.
 */
import { describe, expect, test } from "bun:test";
import {
	HEAT_CAP,
	HEAT_HALF_LIFE_S,
	OFFENCE_HEAT,
	WANTED_HEAT,
	FUGITIVE_HEAT,
	heatAt,
	legalStandingAt,
	legalStandingOf,
	offenceHeat,
	withOffence,
} from "../src/legal";
import { newWorld } from "../src/world-state";

const MIN = 60;

/** Minutes until a heat decays below a threshold, from the law itself. */
const minutesAbove = (heat: number, threshold: number) => {
	let t = 0;
	while (heatAt({ heat, updatedAt: 0 }, t) >= threshold) t += 1;
	return t / MIN;
};

describe("the scale", () => {
	test("is H4's: kill 40, strike 15, Wanted at 10, Fugitive at 60, cap 100", () => {
		expect(OFFENCE_HEAT).toEqual({ destroyed: 40, struck: 15 });
		expect(WANTED_HEAT).toBe(10);
		expect(FUGITIVE_HEAT).toBe(60);
		expect(HEAT_CAP).toBe(100);
		expect(HEAT_HALF_LIFE_S).toBe(30 * MIN);
	});

	test("reads standing at the thresholds", () => {
		expect(legalStandingOf(0)).toBe("clean");
		expect(legalStandingOf(9.999)).toBe("clean");
		expect(legalStandingOf(10)).toBe("wanted");
		expect(legalStandingOf(59.999)).toBe("wanted");
		expect(legalStandingOf(60)).toBe("fugitive");
	});
});

describe("an offence is judged on the target's true standing (F7)", () => {
	test("a Clean target costs heat, a Wanted or Fugitive one does not", () => {
		expect(offenceHeat("clean", "destroyed")).toBe(40);
		expect(offenceHeat("clean", "struck")).toBe(15);
		for (const standing of ["wanted", "fugitive"] as const) {
			expect(offenceHeat(standing, "destroyed")).toBe(0);
			expect(offenceHeat(standing, "struck")).toBe(0);
		}
	});
});

describe("decay", () => {
	test("halves every thirty minutes of game clock", () => {
		const status = { heat: 80, updatedAt: 1000 };
		expect(heatAt(status, 1000)).toBe(80);
		expect(heatAt(status, 1000 + HEAT_HALF_LIFE_S)).toBeCloseTo(40, 9);
		expect(heatAt(status, 1000 + 2 * HEAT_HALF_LIFE_S)).toBeCloseTo(20, 9);
	});

	test("never runs backwards before its stamp", () => {
		expect(heatAt({ heat: 40, updatedAt: 500 }, 100)).toBe(40);
	});

	test("steps back through the states", () => {
		const status = { heat: 80, updatedAt: 0 };
		expect(legalStandingAt(status, 0)).toBe("fugitive");
		expect(legalStandingAt(status, 20 * MIN)).toBe("wanted");
		expect(legalStandingAt(status, 100 * MIN)).toBe("clean");
	});
});

describe("what a pilot meets (H4's durations, derived rather than restated)", () => {
	test("one Clean kill is about an hour Wanted", () => {
		expect(minutesAbove(40, WANTED_HEAT)).toBeCloseTo(60, 0);
	});

	test("two in quick succession are briefly Fugitive and Clean after ninety minutes", () => {
		expect(minutesAbove(80, FUGITIVE_HEAT)).toBeGreaterThan(12);
		expect(minutesAbove(80, FUGITIVE_HEAT)).toBeLessThan(13);
		expect(minutesAbove(80, WANTED_HEAT)).toBeCloseTo(90, 0);
	});

	test("a strike alone is about seventeen minutes Wanted", () => {
		expect(minutesAbove(15, WANTED_HEAT)).toBeGreaterThan(17);
		expect(minutesAbove(15, WANTED_HEAT)).toBeLessThan(18);
	});
});

describe("the write", () => {
	test("adds the offence to the decayed heat and stamps it now", () => {
		let world = newWorld(7);
		world = withOffence(world, 0, 40, 0);
		expect(world.galaxies[0].legalStatus).toMatchObject({
			heat: 40,
			updatedAt: 0,
		});
		world = withOffence(world, 0, 40, HEAT_HALF_LIFE_S);
		expect(world.galaxies[0].legalStatus.heat).toBeCloseTo(60, 9);
		expect(world.galaxies[0].legalStatus.updatedAt).toBe(HEAT_HALF_LIFE_S);
	});

	test("is capped", () => {
		let world = newWorld(7);
		for (let i = 0; i < 5; i++) world = withOffence(world, 0, 40, 0);
		expect(world.galaxies[0].legalStatus.heat).toBe(HEAT_CAP);
	});

	test("a lawful kill writes nothing", () => {
		const world = newWorld(7);
		expect(withOffence(world, 0, 0, 100)).toBe(world);
	});

	test("lands in the galaxy it happened in", () => {
		const world = withOffence(newWorld(7), 3, 40, 0);
		expect(world.galaxies[3].legalStatus.heat).toBe(40);
		expect(world.galaxies[0].legalStatus.heat).toBe(0);
	});
});
