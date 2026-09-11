/**
 * The course cue — node #117.
 *
 * `galaxy-map.md` §8.3 states the obligation and picks no home for it: "the
 * next hop and the jumps remaining belong on the flight floor or the
 * Navigation console — a course the player cannot see from the cockpit is a
 * course they will forget they set." #117 picked the flight floor, as a row of
 * its own above §5.1's mode/throttle/assist/charge strip rather than a fifth
 * cell in it.
 *
 * What the row *says* is arithmetic on a projection and belongs here; where it
 * lands on the glass is `probe-live-cockpit.mjs`'s.
 */

import { describe, expect, test } from "bun:test";
import {
	COURSE_CUE_LABEL,
	type CourseCue,
	courseCue,
	courseCueWidest,
} from "../src/cockpit";
import { generateGalaxy } from "../src/galaxy";
import { planRoute } from "../src/galaxy-route";
import { SYSTEM_NAME_MAX_CHARS, SYSTEM_NAME_MIN_CHARS } from "../src/names";

const WORLD_SEED = 0x5ee11e;

const underway = (
	over: Partial<Extract<CourseCue, { kind: "underway" }>> = {},
) =>
	({
		kind: "underway",
		nextHop: "LAVEIAN",
		remaining: 3,
		affordable: true,
		...over,
	}) satisfies CourseCue;

describe("absence is the absent state, not a dormant one", () => {
	/**
	 * #117 D2. §5 calls the floor "the minimum that keeps a hull-hidden cockpit
	 * flyable"; a permanent field reading `NO COURSE` is not that. The reflow
	 * objection that makes a dormant slot attractive on the strip does not
	 * apply to a row of its own — absence there moves nothing.
	 */
	test("no course draws no row", () => {
		expect(courseCue(null)).toBeNull();
	});
});

describe("underway, the row is §8.3's two facts", () => {
	test("the next hop and the jumps remaining", () => {
		expect(courseCue(underway())).toEqual({
			label: COURSE_CUE_LABEL,
			value: "LAVEIAN 3 jumps",
			tone: "passive",
		});
	});

	/** A row that reads "1 jumps" on the last leg of every course is the one
	 *  reading a player sees most often on a short hop. */
	test("the last leg is singular", () => {
		expect(courseCue(underway({ remaining: 1 }))?.value).toBe("LAVEIAN 1 jump");
	});

	/**
	 * #117 D3. The generator cannot produce an unreachable destination — §5 of
	 * `galaxy-generation.md` guarantees same-galaxy connectivity and §8.2 makes
	 * a course envelope-matched to its galaxy — so the reachable refusal is a
	 * next hop the tank cannot pay for. The row carries the *tone* and not the
	 * sentence: `planJump` owns those words and the cruise prompt prints them,
	 * and one quantity spelled two ways is how the glass comes to say two
	 * things about one fact.
	 */
	test("an unaffordable next hop is red, and says nothing extra", () => {
		const refused = courseCue(underway({ affordable: false }));
		expect(refused?.tone).toBe("refused");
		expect(refused?.value).toBe(courseCue(underway())?.value);
	});
});

describe("arriving does not clear the course", () => {
	/**
	 * #117 D4, ratified as shipped rather than changed: `handle.course`
	 * survives the last jump, `courseProgress` reports `arrived: true`, and
	 * `chargeJump` prints "course complete — set another on the galaxy chart".
	 * A course is player intent under `persistent-world-state.md` §7, and
	 * intent is not cancelled by being satisfied.
	 */
	test("the row stands, reading the destination", () => {
		expect(courseCue({ kind: "arrived", destination: "LAVEIAN" })).toEqual({
			label: COURSE_CUE_LABEL,
			value: "LAVEIAN arrived",
			tone: "confirmed",
		});
	});
});

describe("the row is laid out against its widest possible reading", () => {
	/**
	 * The same rule `flightFloorWidest` exists for, and for the same reason:
	 * #92's fit was taken on a full tank, where the regeneration suffix is
	 * absent, and clipped both ends of the run drawn a second later. The font
	 * is monospace, so a character count is a width.
	 */
	test("no reachable reading is wider than the bound", () => {
		const widest = courseCueWidest();
		const name = "M".repeat(SYSTEM_NAME_MAX_CHARS);
		const readings: CourseCue[] = [
			{ kind: "arrived", destination: name },
			{ kind: "underway", nextHop: name, remaining: 1, affordable: true },
			{ kind: "underway", nextHop: name, remaining: 9, affordable: false },
			{ kind: "underway", nextHop: name, remaining: 99, affordable: true },
		];
		for (const reading of readings) {
			const row = courseCue(reading);
			if (row === null) throw new Error("a course reading drew no row");
			expect(row.value.length).toBeLessThanOrEqual(widest.length);
		}
	});

	/** A bound loose enough to hold anything is not a bound. It must be a
	 *  reading the formatter actually produces. */
	test("the bound is itself a reading", () => {
		const widest = courseCueWidest();
		const name = "M".repeat(SYSTEM_NAME_MAX_CHARS);
		const produced = [
			courseCue({ kind: "arrived", destination: name })?.value,
			courseCue({
				kind: "underway",
				nextHop: name,
				remaining: 99,
				affordable: true,
			})?.value,
		];
		expect(produced).toContain(widest);
	});
});

describe("the bound's assumptions hold against the real generator", () => {
	/**
	 * The two inputs the bound is built from are facts about the galaxy, not
	 * about the formatter, so they are swept rather than asserted in prose. A
	 * bound stated beside a generator that can exceed it is the clipped strip
	 * #92 shipped, one module over.
	 */
	test("every system name is inside the declared band", () => {
		let longest = "";
		let shortest = null;
		for (let galaxy = 0; galaxy < 8; galaxy++)
			for (const system of generateGalaxy(WORLD_SEED, galaxy).systems) {
				if (system.name.length > longest.length) longest = system.name;
				if (shortest === null || system.name.length < shortest.length)
					shortest = system.name;
			}
		expect(longest.length).toBeLessThanOrEqual(SYSTEM_NAME_MAX_CHARS);
		// And the ceiling is reached, so it is a measurement rather than a
		// number chosen to be safe.
		expect(longest.length).toBe(SYSTEM_NAME_MAX_CHARS);
		// The floor is §9.6's other half. It is the guard loop's own
		// post-condition, and the reason the row can assume a name at all — an
		// empty one would centre a run of nothing beside a jump count.
		expect(shortest?.length).toBeGreaterThanOrEqual(SYSTEM_NAME_MIN_CHARS);
	});

	/**
	 * Every origin against every destination is 65,536 Dijkstra runs per
	 * galaxy; the stride samples origins and keeps every destination, which is
	 * what makes the *longest* chain reachable — a long route is long for its
	 * destination's sake, not its origin's.
	 */
	test("no route is more jumps than the bound prints", () => {
		let most = 0;
		for (let galaxy = 0; galaxy < 8; galaxy++) {
			const { systems } = generateGalaxy(WORLD_SEED, galaxy);
			for (let i = 0; i < systems.length; i += 17)
				for (const to of systems) {
					const route = planRoute(systems, systems[i], to);
					if (route && route.jumps > most) most = route.jumps;
				}
		}
		// 13 when this was written. The bound is the two-digit ceiling, so what
		// this asserts is that the generator has not grown a three-digit chain
		// under the formatter.
		expect(most).toBeGreaterThan(0);
		expect(most).toBeLessThanOrEqual(99);
	});
});
