/**
 * The galaxy map's routing layer — node #11.
 *
 * Property-based for the same reason `galaxy.test.ts` is: there is no oracle
 * for a route through a generated cluster. What can be asserted is that every
 * hop is legal, that the objective is the one the spec names, and that the
 * planner agrees with a brute-force search on small hand-built graphs where
 * the right answer *is* enumerable.
 *
 * The hand-built graphs matter more than they look. A route planner over the
 * real generator is a test that passes on almost any plausible implementation:
 * with ~8 systems in range at every step, a greedy nearest-first walk reaches
 * the destination too, and reports a plausible number of jumps. The synthetic
 * graphs below are built so that greedy and optimal *disagree* — which is the
 * only shape in which this suite could fail on a build that got the objective
 * wrong.
 */

import { describe, expect, test } from "bun:test";
import {
	FUEL_COST_PER_LY,
	JUMP_RANGE_LY,
	type SystemRecord,
	distanceLy,
	generateGalaxy,
	jumpCost,
	neighbours,
	startSystem,
} from "../src/galaxy";
import { FUEL_CR_PER_LY, FUEL_TANK_LY } from "../src/market";
import {
	COURSE_SCHEMA_VERSION,
	type Course,
	courseProgress,
	parseCourse,
	planRoute,
	reachable,
	serialiseCourse,
	setCourse,
} from "../src/galaxy-route";

/**
 * A bare system record at a position, for the synthetic graphs.
 *
 * Every field the planner does not read is filled with a value that would be
 * obviously wrong if it leaked into an assertion — the planner must route on
 * `pos`, `galaxy` and `index` alone, and nothing here should make a
 * government or a tech level able to influence a chain.
 */
const at = (index: number, x: number, y = 0, z = 0): SystemRecord => ({
	galaxy: 0,
	index,
	attempt: 0,
	seed: 0,
	pos: { x, y, z },
	radiusLy: Math.sqrt(x * x + y * y + z * z),
	t: 0,
	name: `S${index}`,
	government: -1,
	economy: -1,
	tech: -1,
	displayTL: -1,
	population: -1,
	productivity: -1,
	description: "synthetic",
});

/** Brute force: every simple path from `from` to `to`, ranked as §4 ranks
 *  them. Exponential, so it is only ever run on the small graphs below. */
function bestByEnumeration(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	to: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): { jumps: number; totalLy: number } | null {
	let best: { jumps: number; totalLy: number } | null = null;
	const walk = (at: SystemRecord, seen: Set<number>, ly: number) => {
		if (at.index === to.index) {
			const here = { jumps: seen.size - 1, totalLy: ly };
			if (
				best === null ||
				here.jumps < best.jumps ||
				(here.jumps === best.jumps && here.totalLy < best.totalLy - 1e-9)
			) {
				best = here;
			}
			return;
		}
		for (const next of systems) {
			if (seen.has(next.index)) continue;
			const d = distanceLy(at.pos, next.pos);
			if (d > maxJump) continue;
			seen.add(next.index);
			walk(next, seen, ly + d);
			seen.delete(next.index);
		}
	};
	walk(from, new Set([from.index]), 0);
	return best;
}

describe("§4 fuel price — one figure, two modules", () => {
	/**
	 * `economy-trade.md` §6.1 fixed this in the specs and the map records the
	 * correction as a constraint, but the check it names is a repo-wide grep
	 * over `0.2 Cr` — and prose is what a grep sees. `src/galaxy.ts` kept
	 * `0.2` as a *per-LY* figure, which is Elite's per-0.1-LY number with the
	 * tenth dropped: exactly the transcription error the correction was
	 * about, surviving in the one place a grep for the corrected string could
	 * not look.
	 *
	 * Nothing referenced `jumpCost` before this file, so the wrong number was
	 * never priced into anything — the route panel is the first consumer, and
	 * it would have quoted a 22 LY crossing at 2.7 Cr.
	 */
	test("a full tank costs 14 Cr, in both modules that name a fuel price", () => {
		// **The absolute figures first, then the agreement.** Equality alone
		// proves only that the two constants match, so an edit moving both in
		// the same direction passes it — and `jumpCost(FUEL_TANK_LY) === 14`
		// leans on `FUEL_TANK_LY` being 7, which nothing here asserted. Elite's
		// PRXS table is 0.2 Cr per 0.1 LY over a 7 LY tank, and each of those
		// three numbers is now pinned on its own.
		expect(FUEL_TANK_LY).toBe(7);
		expect(FUEL_COST_PER_LY).toBe(0.2 / 0.1);
		expect(FUEL_CR_PER_LY).toBe(0.2 / 0.1);
		expect(jumpCost(FUEL_TANK_LY)).toBeCloseTo(14, 10);
		expect(FUEL_COST_PER_LY).toBe(FUEL_CR_PER_LY);
	});

	test("a route's credit total is its distance at that price", () => {
		const systems = [at(0, 0), at(1, 5), at(2, 10)];
		const route = planRoute(systems, systems[0], systems[2]);
		expect(route).not.toBeNull();
		if (route === null) return;
		expect(route.totalCr).toBeCloseTo(route.totalLy * FUEL_CR_PER_LY, 10);
		expect(route.totalCr).toBeCloseTo(20, 10);
	});
});

describe("§3 reachability — the 7 LY shell", () => {
	test("`reachable` is `neighbours`, and both read the true 3D distance", () => {
		const galaxy = generateGalaxy(0xa11ce, 0);
		const from = startSystem(galaxy);
		const lit = reachable(galaxy.systems, from);
		expect(lit).toEqual(neighbours(galaxy.systems, from));
		for (const s of lit) {
			expect(distanceLy(from.pos, s.pos)).toBeLessThanOrEqual(JUMP_RANGE_LY);
		}
	});

	test("a system just outside the shell is not lit, one just inside is", () => {
		const from = at(0, 0);
		const inside = at(1, JUMP_RANGE_LY - 0.001);
		const outside = at(2, JUMP_RANGE_LY + 0.001);
		const lit = reachable([from, inside, outside], from);
		expect(lit.map((s) => s.index)).toEqual([1]);
	});

	test("the shell is a ball, not a plane — depth counts", () => {
		const from = at(0, 0, 0, 0);
		// 5 LY out in x and 5 in z is 7.07 LY away: outside the shell, and
		// inside it if either axis is dropped.
		const diagonal = at(1, 5, 0, 5);
		expect(reachable([from, diagonal], from)).toEqual([]);
	});
});

describe("§4 route planning — fewest jumps, then shortest", () => {
	test("a system routes to itself in no jumps at all", () => {
		const systems = [at(0, 0), at(1, 5)];
		const route = planRoute(systems, systems[0], systems[0]);
		expect(route).not.toBeNull();
		if (route === null) return;
		expect(route.jumps).toBe(0);
		expect(route.hops).toEqual([]);
		expect(route.totalLy).toBe(0);
		expect(route.totalCr).toBe(0);
	});

	test("a neighbour is one hop, priced at its true distance", () => {
		const systems = [at(0, 0), at(1, 6)];
		const route = planRoute(systems, systems[0], systems[1]);
		expect(route).not.toBeNull();
		if (route === null) return;
		expect(route.jumps).toBe(1);
		expect(route.hops.map((h) => h.system.index)).toEqual([1]);
		expect(route.totalLy).toBeCloseTo(6, 10);
	});

	/**
	 * The greedy trap. System 1 is the origin's **nearest** neighbour at 6.08 LY
	 * and it is a dead end — 8.41 LY on to system 2 and 13.87 to the
	 * destination, both past the 7 LY range. So a nearest-first walk strands
	 * itself, while the two-jump answer takes the *longer* first step to system
	 * 2 at 6.90 LY and reaches the destination 6.60 LY on.
	 *
	 * (The distances are stated because they were once wrong here: the comment
	 * called system 1 "a 1 LY-ish detour" that "forces a three-jump chain",
	 * and it is neither.)
	 */
	test("fewest jumps beats nearest-first, which is the whole point", () => {
		const systems = [
			at(0, 0),
			at(1, 1, 6), // 6.08 LY away — nearest, and a dead end
			at(2, 6.9), // 6.90 LY — the longer first step, and the only way on
			at(3, 13.5), // reachable from 2 only, 6.60 LY further
		];
		const route = planRoute(systems, systems[0], systems[3]);
		expect(route).not.toBeNull();
		if (route === null) return;
		expect(route.jumps).toBe(2);
		expect(route.hops.map((h) => h.system.index)).toEqual([2, 3]);
	});

	/**
	 * **Two legal two-jump chains**, so §4's tie-break decides which one comes
	 * back. The planner must not settle for whichever its search reaches first.
	 *
	 * The first version of this fixture put system 1 at `(3, 6)`, whose second
	 * leg to the destination is **10.82 LY** — past the jump range, so the
	 * "alternative" was not a chain at all and `[2, 3]` was the only two-jump
	 * route. It passed on exactly the build it claimed to exclude. Both legs of
	 * both chains are now inside the range, and `totalLy` is asserted so
	 * returning the longer one fails on the number as well as the path.
	 *
	 * **What it does and does not discriminate**, measured by breaking the
	 * planner two ways. It fails on a build with no distance ordering at all.
	 * It *passes* on one that drops the tie-break from the relaxation but keeps
	 * it in the selection order, because settling the shorter arm first
	 * repairs the answer by accident. The brute-force comparison below catches
	 * that half-removed case; this fixture is the readable statement of the
	 * rule, not the whole net.
	 */
	test("equal jump counts break on total distance", () => {
		const systems = [
			at(0, 0),
			at(1, 6, 3.5), // via here: 6.95 + 6.95 = 13.90 LY — legal, and longer
			at(2, 6, 0), // via here: 6.00 + 6.00 = 12.00 LY — legal, and shorter
			at(3, 12, 0),
		];
		const route = planRoute(systems, systems[0], systems[3]);
		expect(route).not.toBeNull();
		if (route === null) return;
		expect(route.jumps).toBe(2);
		expect(route.hops.map((h) => h.system.index)).toEqual([2, 3]);
		expect(route.totalLy).toBeCloseTo(12, 6);
	});

	test("a longer chain is taken when the short one is not jumpable", () => {
		// 0 to 3 is 20 LY: no two-jump chain exists at a 7 LY range.
		const systems = [at(0, 0), at(1, 6.5), at(2, 13), at(3, 19.5)];
		const route = planRoute(systems, systems[0], systems[3]);
		expect(route).not.toBeNull();
		if (route === null) return;
		expect(route.jumps).toBe(3);
	});

	test("an unreachable destination is null, not an empty route", () => {
		const systems = [at(0, 0), at(1, 100)];
		expect(planRoute(systems, systems[0], systems[1])).toBeNull();
	});

	test("the planner agrees with brute force on graphs small enough to enumerate", () => {
		// Deterministic pseudo-random clouds — a fixed LCG, so a failure is
		// reproducible and no test in this file draws from a shared stream.
		let state = 0x5eed1e >>> 0;
		const rand = () => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 0x1_0000_0000;
		};
		// Twelve systems in a 14 LY cube against a 7 LY range: wide enough that
		// the pair is usually several hops apart and the greedy and optimal
		// chains can differ, dense enough that most clouds connect at all. The
		// sizing was measured, not guessed — 9 systems in a 26 LY cube connected
		// 4 trials in 40 and 9 in an 18 LY cube connected 15 in 60, both of
		// which the floor below caught. This shape connects 42 of 60.
		let compared = 0;
		for (let trial = 0; trial < 60; trial++) {
			const systems: SystemRecord[] = [];
			for (let i = 0; i < 12; i++) {
				systems.push(
					at(i, (rand() - 0.5) * 14, (rand() - 0.5) * 14, (rand() - 0.5) * 14),
				);
			}
			const last = systems[systems.length - 1];
			const route = planRoute(systems, systems[0], last);
			const truth = bestByEnumeration(systems, systems[0], last);
			if (truth === null) {
				expect(route).toBeNull();
				continue;
			}
			compared++;
			expect(route).not.toBeNull();
			if (route === null) continue;
			expect(route.jumps).toBe(truth.jumps);
			expect(route.totalLy).toBeCloseTo(truth.totalLy, 6);
		}
		// A run in which every cloud was disconnected would pass every
		// assertion above while comparing nothing.
		expect(compared).toBeGreaterThanOrEqual(30);
	});

	test("every hop of a real route is inside the jump range", () => {
		const galaxy = generateGalaxy(0xbeef, 0);
		const from = startSystem(galaxy);
		for (const to of galaxy.systems) {
			const route = planRoute(galaxy.systems, from, to);
			expect(route).not.toBeNull();
			if (route === null) continue;
			let at = from;
			for (const hop of route.hops) {
				const d = distanceLy(at.pos, hop.system.pos);
				expect(d).toBeLessThanOrEqual(JUMP_RANGE_LY + 1e-9);
				expect(hop.ly).toBeCloseTo(d, 9);
				expect(hop.costCr).toBeCloseTo(d * FUEL_CR_PER_LY, 9);
				at = hop.system;
			}
			expect(at.index).toBe(to.index);
		}
	});

	/**
	 * §5 of `galaxy-generation.md` guarantees a connected jump graph by
	 * resampling the whole layout, so *every* pair routes. A planner that
	 * returned null for a reachable pair would be a worse failure than a
	 * suboptimal chain: the map would tell the player a system is
	 * unreachable when the generator promised it is not.
	 */
	test("a connected layout means no pair is ever unroutable", () => {
		const galaxy = generateGalaxy(0xc0ffee, 3);
		const from = galaxy.systems[100];
		for (const to of galaxy.systems) {
			expect(planRoute(galaxy.systems, from, to)).not.toBeNull();
		}
	});

	test("planning is deterministic — the same pair gives the same chain", () => {
		const galaxy = generateGalaxy(0x1234, 1);
		const a = galaxy.systems[7];
		const b = galaxy.systems[201];
		const first = planRoute(galaxy.systems, a, b);
		const second = planRoute(galaxy.systems, a, b);
		expect(first).not.toBeNull();
		expect(JSON.stringify(first)).toBe(JSON.stringify(second));
	});

	/** D6: the map draws the current galaxy and nothing else, so a chain
	 *  across the namespace is not a long route — it is not a route. */
	test("a cross-galaxy pair does not route", () => {
		const here = at(0, 0);
		const there = { ...at(1, 1), galaxy: 4 };
		expect(planRoute([here, there], here, there)).toBeNull();
		expect(reachable([here, there], here)).toEqual([]);
	});
});

describe("array position and `SystemRecord.index`", () => {
	/**
	 * They agree, and that is a fact worth pinning rather than assuming.
	 *
	 * `generateGalaxy` builds the array in index order, so `systems[i].index ===
	 * i` — but `planRoute` deliberately keeps the two apart, and a `Course`
	 * loaded from a save carries a `destinationIndex` validated against the
	 * *range* and not against a slot. Anything that reads one as the other is
	 * relying on this test, so the reliance should be visible here.
	 */
	test("`generateGalaxy` returns systems in index order", () => {
		for (const g of [0, 3, 7]) {
			const galaxy = generateGalaxy(0x9e1d, g);
			galaxy.systems.forEach((s, position) => {
				expect(s.index).toBe(position);
				expect(s.galaxy).toBe(g);
			});
		}
	});
});

describe("§8 course — a destination, not a stored chain", () => {
	const galaxy = generateGalaxy(0xfeed, 0);
	const from = startSystem(galaxy);
	const far = [...galaxy.systems].sort(
		(a, b) => distanceLy(from.pos, b.pos) - distanceLy(from.pos, a.pos),
	)[0];

	test("setting a course keeps the destination, and the chain is derived", () => {
		const course = setCourse(galaxy.systems, from, far);
		expect(course).not.toBeNull();
		if (course === null) return;
		expect(course.destinationIndex).toBe(far.index);
		expect(course.galaxy).toBe(0);
		// The chain is not a field of the course.
		expect(Object.keys(course).sort()).toEqual([
			"destinationIndex",
			"galaxy",
			"version",
		]);
	});

	test("a course cannot be set to an unroutable destination", () => {
		const here = at(0, 0);
		const marooned = at(1, 100);
		expect(setCourse([here, marooned], here, marooned)).toBeNull();
	});

	/**
	 * The reason the chain is derived rather than saved.
	 * `persistent-world-state.md` §8 says map presentation is a projection and
	 * is never persisted for being derivable — and a saved chain has a second
	 * failure the spec does not have to argue about: it goes stale the moment
	 * the player jumps somewhere that is not on it.
	 */
	test("progress re-derives from where the ship actually is, not from the plan", () => {
		const course = setCourse(galaxy.systems, from, far);
		expect(course).not.toBeNull();
		if (course === null) return;

		const planned = courseProgress(galaxy.systems, course, from);
		expect(planned).not.toBeNull();
		if (planned === null) return;
		expect(planned.remaining).toBe(planned.route.jumps);

		// Jump somewhere off the plan entirely, then ask again.
		const offPlan = galaxy.systems.find(
			(s) =>
				distanceLy(from.pos, s.pos) <= JUMP_RANGE_LY &&
				!planned.route.hops.some((h) => h.system.index === s.index),
		);
		expect(offPlan).toBeDefined();
		if (offPlan === undefined) return;

		const after = courseProgress(galaxy.systems, course, offPlan);
		expect(after).not.toBeNull();
		if (after === null) return;
		expect(after.route.hops.at(-1)?.system.index).toBe(far.index);
		expect(after.nextHop?.system.index).toBe(after.route.hops[0].system.index);
	});

	test("arriving at the destination completes the course", () => {
		const course = setCourse(galaxy.systems, from, far);
		expect(course).not.toBeNull();
		if (course === null) return;
		const done = courseProgress(galaxy.systems, course, far);
		expect(done).not.toBeNull();
		if (done === null) return;
		expect(done.arrived).toBe(true);
		expect(done.remaining).toBe(0);
		expect(done.nextHop).toBeNull();
	});
});

describe("§8.2 course persistence — a typed, validated envelope", () => {
	test("a course round-trips through its serialised form", () => {
		const course: Course = {
			version: COURSE_SCHEMA_VERSION,
			galaxy: 3,
			destinationIndex: 178,
		};
		// Composed directly. The pair once did not round-trip — `parseCourse`
		// rejected the string `serialiseCourse` produced — so the caller had to
		// interpose a `JSON.parse` that nothing in the contract mentioned.
		expect(parseCourse(serialiseCourse(course), 3)).toEqual(course);
		expect(parseCourse(JSON.parse(serialiseCourse(course)), 3)).toEqual(course);
	});

	test("an unreadable JSON string throws rather than reading as absent", () => {
		expect(() => parseCourse("{ not json", 0)).toThrow(/unreadable/i);
		expect(() => parseCourse('"a string"', 0)).toThrow();
	});

	/**
	 * The string branch decodes **once**. Recursing was the first shape of it,
	 * and it let a doubly-encoded save through as healthy — the exact
	 * reinterpretation §7 forbids, introduced by the fix for the round-2
	 * finding that the pair did not round-trip.
	 */
	test("a doubly-encoded course throws instead of decoding twice", () => {
		const once = serialiseCourse({
			version: COURSE_SCHEMA_VERSION,
			galaxy: 0,
			destinationIndex: 3,
		});
		expect(() => parseCourse(JSON.stringify(once), 0)).toThrow();
		expect(() => parseCourse("null", 0)).toThrow(/absent/i);
		expect(() => parseCourse('"null"', 0)).toThrow();
	});

	test("no course at all is a valid state, not a parse failure", () => {
		expect(parseCourse(null, 0)).toBeNull();
		expect(parseCourse(undefined, 0)).toBeNull();
	});

	/**
	 * §7: "Any serialized embedded galaxy index must match its containing
	 * envelope or fail loudly." A course filed under galaxy 3 that claims
	 * galaxy 5 is a corrupted save, and the spec forbids reading it as an
	 * untouched healthy value.
	 */
	test("a galaxy index disagreeing with its envelope throws", () => {
		const wrong = {
			version: COURSE_SCHEMA_VERSION,
			galaxy: 5,
			destinationIndex: 1,
		};
		expect(() => parseCourse(wrong, 3)).toThrow(/galaxy/i);
	});

	test("a malformed course throws rather than parsing to a plausible one", () => {
		const cases: unknown[] = [
			{ version: COURSE_SCHEMA_VERSION, galaxy: 0 },
			{ version: COURSE_SCHEMA_VERSION, galaxy: 0, destinationIndex: 256 },
			{ version: COURSE_SCHEMA_VERSION, galaxy: 0, destinationIndex: -1 },
			{ version: COURSE_SCHEMA_VERSION, galaxy: 0, destinationIndex: 1.5 },
			{ version: COURSE_SCHEMA_VERSION, galaxy: 0, destinationIndex: "7" },
			{ version: COURSE_SCHEMA_VERSION, galaxy: 8, destinationIndex: 1 },
			{ galaxy: 0, destinationIndex: 1 },
			{ version: COURSE_SCHEMA_VERSION + 1, galaxy: 0, destinationIndex: 1 },
			42,
			"course",
			[],
		];
		for (const bad of cases) {
			expect(() => parseCourse(bad, 0)).toThrow();
		}
	});
});
