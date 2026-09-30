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
	jumpRefusalText,
} from "../src/cockpit";
import { JUMP_RANGE_LY, generateGalaxy } from "../src/galaxy";
import { projectJumps } from "../src/galaxy-route";
import { SYSTEM_NAME_MAX_CHARS, SYSTEM_NAME_MIN_CHARS } from "../src/names";

const WORLD_SEED = 0x5ee11e;

/**
 * The seeds the diameter is measured over.
 *
 * **A seed, not the generator.** `seedFromQuery` gives a player one of 2^32
 * worlds, and a sweep of one of them cannot say what the generator does — §5.2
 * called a single-seed figure a property of "the real generator" for a round.
 * Four is not 2^32 either; what it buys is a *spread* rather than a point, and
 * the spread is what the bound is judged against.
 */
const SEEDS = [0x5ee11e, 1, 2, 0xdeadbeef] as const;

/** The band those seeds put the longest route in. Measured, not guessed —
 *  the wider sweep behind it is in the test below. */
const DIAMETER_BAND = { min: 13, max: 14 } as const;

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
	/** §5.2 / #117 D2 — the argument is there; this is the assertion. */
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
	 * #117 D3. An unreachable destination is its own state since #554 (below);
	 * this is the other refusal, a next hop the tank cannot pay for. The row carries the *tone* and not the
	 * sentence: `planJump` owns the codes, `jumpRefusalText` owns the words and
	 * §3's prompt prints them. One quantity spelled two ways is how the glass
	 * comes to say two things about one fact.
	 */
	test("an unaffordable next hop is red, and says nothing extra", () => {
		const refused = courseCue(underway({ affordable: false }));
		expect(refused?.tone).toBe("refused");
		expect(refused?.value).toBe(courseCue(underway())?.value);
	});
});

describe("a course with no route for this hull says so (#554)", () => {
	/**
	 * #185 D4. Connectivity is guaranteed at the courier's reach only, so a
	 * short-tank hull can hold a course it has no chain for — one loaded from a
	 * save, or set in another hull. Returning `null` there drew no row at all,
	 * which is the silent failure D4 names.
	 */
	test("the row stands, red, naming the destination", () => {
		expect(courseCue({ kind: "no-route", destination: "LAVEIAN" })).toEqual({
			label: COURSE_CUE_LABEL,
			value: "LAVEIAN no route",
			tone: "refused",
		});
	});

	test("an out-of-range refusal names whose range", () => {
		expect(jumpRefusalText("out-of-range", "LAVEIAN")).toBe(
			"LAVEIAN is out of this hull's range",
		);
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
			{ kind: "no-route", destination: name },
			underway({ nextHop: name, remaining: 1 }),
			underway({ nextHop: name, remaining: 9, affordable: false }),
			underway({ nextHop: name, remaining: 99 }),
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
			courseCue({ kind: "no-route", destination: name })?.value,
			courseCue(underway({ nextHop: name, remaining: 99 }))?.value,
		];
		expect(produced).toContain(widest);
	});
});

describe("the bound's assumptions hold over the sampled seeds", () => {
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
	 * **Every origin, through the projection rather than a route each.**
	 *
	 * This was a 1-in-17 stride over origins running `planRoute` per
	 * destination — 32,768 single-source searches to answer a question one
	 * search per origin answers, and sage measured it at 11.8 s on a loaded
	 * machine against bun's 5 s default. `projectJumps` is that one search.
	 *
	 * **The stride also hid the answer, and its stated reason was false.** "A
	 * long route is long for its destination's sake, not its origin's" is wrong
	 * for an undirected shortest-path graph: the diameter needs *both*
	 * endpoints in the sampled set. The strided sweep reported 13 and the
	 * number reached §5.2's prose as a measurement; the diameter at that seed
	 * is 14.
	 *
	 * **And a seed is not the generator.** Four seeds put it at 13–14 against a
	 * bound of 99, so what the row reserves has an order of magnitude of
	 * headroom — which is the claim worth making, and it is a claim about a
	 * spread rather than about one world.
	 */
	test("the longest route over the sampled seeds fits the two digits the row prints", () => {
		let low = Number.POSITIVE_INFINITY;
		let high = 0;
		for (const seed of SEEDS) {
			let most = 0;
			for (let galaxy = 0; galaxy < 8; galaxy++) {
				const { systems } = generateGalaxy(seed, galaxy);
				for (const from of systems) {
					const projection = projectJumps(systems, from, JUMP_RANGE_LY);
					for (const to of systems) {
						const reach = projection.reach(to);
						if (reach !== undefined && reach.jumps > most) most = reach.jumps;
					}
				}
			}
			low = Math.min(low, most);
			high = Math.max(high, most);
		}
		// **A band, because §5.2 transcribes it.** `toBeLessThanOrEqual(99)` was
		// the whole assertion for a round, which cannot tell 14 from 98 — and a
		// figure quoted in prose needs an exact assertion behind it, which is
		// `economy-trade.md` §1's rule and the reason two figures were invented
		// in #25. A generator retune that moves this should read the spec.
		expect(low).toBe(DIAMETER_BAND.min);
		expect(high).toBe(DIAMETER_BAND.max);
		// And the headroom the row's two digits actually have.
		expect(high).toBeLessThan(100);
	});
});
