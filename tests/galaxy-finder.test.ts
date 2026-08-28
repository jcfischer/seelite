/**
 * The galaxy finder's arithmetic — node #115, against #86's D4–D7.
 *
 * Everything here is reachable without a DOM, which is the point of the split:
 * what a filter admits, how the two groups are ordered and when the panel
 * counts as narrowed are enumerable facts, and the one thing that genuinely
 * needs a browser — whether the expanded cell is still too crowded to pick
 * from — is `probe-navigation-console.mjs`'s.
 */

import { describe, expect, test } from "bun:test";
import {
	FINDER_DEFAULT_BUDGET,
	type FinderFilter,
	finderDefaultFilter,
	finderIsNarrowed,
	finderMatches,
	projectFinder,
} from "../src/galaxy-finder";
import {
	ECONOMY_NAMES,
	JUMP_RANGE_LY,
	type SystemRecord,
	generateGalaxy,
	startSystem,
} from "../src/galaxy";
import { planRoute, projectJumps } from "../src/galaxy-route";

const WORLD_SEED = 0x5ee11e;
const galaxy = generateGalaxy(WORLD_SEED, 0);
const here = startSystem(galaxy);

const filter = (over: Partial<FinderFilter> = {}): FinderFilter => ({
	...finderDefaultFilter(),
	...over,
});

describe("the jump projection", () => {
	/**
	 * **Obligation 2 of the node: the projection agrees with `planRoute`.**
	 *
	 * The two share `relaxFrom`, so this is not a check that two separately
	 * written Dijkstras agree — and saying so is the honest form of it. What it
	 * still discriminates is everything the two do *differently*: `planRoute`
	 * stops the relaxation the moment it settles its goal and then derives its
	 * count by rebuilding the hop chain through `prev`, while the projection
	 * runs to exhaustion and reads the label directly. An early stop that
	 * settled a goal one relaxation too soon, or a chain reconstruction that
	 * dropped a hop, shows up here and nowhere else.
	 *
	 * The sample spans 1 jump to unreachable, as the node asks: every system in
	 * the galaxy, which is both.
	 */
	test("every system's label equals planRoute's jump count", () => {
		const reach = projectJumps(galaxy.systems, here);
		let oneJump = 0;
		let unreachable = 0;
		let far = 0;
		let compared = 0;
		for (const system of galaxy.systems) {
			const route = planRoute(galaxy.systems, here, system);
			const label = reach.reach(system);
			if (route === null) {
				expect(label).toBeUndefined();
				unreachable++;
				compared++;
				continue;
			}
			expect(label).toBeDefined();
			expect(label?.jumps).toBe(route.jumps);
			expect(label?.ly).toBeCloseTo(route.totalLy, 6);
			compared++;
			if (route.jumps === 1) oneJump++;
			if (route.jumps >= 3) far++;
		}
		// The span the node asks for, asserted rather than assumed: a sample
		// that happened to hold only one-jump systems would pass the loop above
		// while checking a tenth of the claim. Floors on the two ends and on the
		// count that was actually compared — a third line summing the three
		// buckets was here and could not fail, since three disjoint subsets of
		// the loop's own input are always at most its length.
		expect(oneJump).toBeGreaterThan(4);
		expect(far).toBeGreaterThan(50);
		expect(compared).toBe(galaxy.systems.length);
		// §5 of `galaxy-generation.md` guarantees a connected layout, so the
		// unreachable end of the span is the hand-built graph in the next test
		// rather than this one. Pinned so a generator that started producing
		// isolated systems shows up here instead of quietly widening the sample.
		expect(unreachable).toBe(0);
	});

	/** A galaxy §5 guarantees connected has no unreachable system — so the
	 *  `null` branch above needs a graph where it can happen, or it is a branch
	 *  no test has ever entered. */
	test("an isolated system is absent from the projection, not labelled", () => {
		const island: SystemRecord = {
			...galaxy.systems[0],
			index: 900,
			pos: { x: 400, y: 0, z: 0 },
		};
		const reach = projectJumps([...galaxy.systems, island], here);
		expect(reach.reach(island)).toBeUndefined();
		expect(reach.reach(here)?.jumps).toBe(0);
	});

	/**
	 * **A within-galaxy index is not a key, which is why the lookup takes a
	 * record.** Every galaxy numbers 0…255, so a bare index cannot say which
	 * galaxy it means; `reach(system)` reads the record's own `galaxy` and
	 * refuses a foreign one. Both halves are checked here — the foreign system
	 * is refused, *and* its presence in the pool changes nothing about the rows
	 * that are not foreign.
	 */
	test("a second galaxy in the pool is refused and changes nothing", () => {
		const other = generateGalaxy(WORLD_SEED, 1);
		const alone = projectJumps(galaxy.systems, here);
		const mixed = projectJumps([...galaxy.systems, ...other.systems], here);
		expect(mixed.size).toBe(alone.size);
		for (const system of galaxy.systems)
			expect(mixed.reach(system)?.jumps).toBe(alone.reach(system)?.jumps);
		// The collision the record-shaped lookup exists to refuse: galaxy 1's
		// system 3 shares an index with a galaxy 0 system that *is* labelled.
		const twin = other.systems.find((s) => s.index === here.index) as
			| SystemRecord
			| undefined;
		expect(twin).toBeDefined();
		expect(mixed.reach(twin as SystemRecord)).toBeUndefined();
		expect(mixed.reach(here)?.jumps).toBe(0);
	});

	test("the finder drops rows from another galaxy", () => {
		const other = generateGalaxy(WORLD_SEED, 1);
		const target = other.systems[3];
		const results = projectFinder(
			[...galaxy.systems, ...other.systems],
			here,
			filter({ query: target.name, budgetJumps: 9 }),
		);
		const rows = [...results.inBudget, ...results.beyondRange];
		for (const r of rows) {
			const record = [...galaxy.systems, ...other.systems].find(
				(s) => s.index === r.index && s.name === r.name,
			) as SystemRecord;
			expect(record.galaxy).toBe(here.galaxy);
		}
	});
});

describe("D4 — what counts as narrowed", () => {
	test("nothing is narrowed by default", () => {
		expect(finderIsNarrowed(finderDefaultFilter())).toBe(false);
	});

	/**
	 * All three controls, because the node's obligation 4 is exactly that a
	 * rule keyed to the text field alone passes a build whose chips are dead.
	 */
	test("a query, a chip, or a widened budget each narrows on its own", () => {
		expect(finderIsNarrowed(filter({ query: "la" }))).toBe(true);
		expect(finderIsNarrowed(filter({ economies: [0] }))).toBe(true);
		expect(
			finderIsNarrowed(filter({ budgetJumps: FINDER_DEFAULT_BUDGET + 1 })),
		).toBe(true);
	});

	test("whitespace is not a query", () => {
		expect(finderIsNarrowed(filter({ query: "   " }))).toBe(false);
	});
});

describe("D5 — what the filter admits and how it sorts", () => {
	test("the name match is a case-insensitive substring", () => {
		const target = galaxy.systems[7];
		const mid = target.name.slice(1, 3).toUpperCase();
		expect(finderMatches(target, filter({ query: mid }))).toBe(true);
		expect(finderMatches(target, filter({ query: `${target.name}z` }))).toBe(
			false,
		);
	});

	test("an empty chip set means every economy, not none", () => {
		for (let economy = 0; economy < ECONOMY_NAMES.length; economy++)
			expect(finderMatches({ name: "x", economy }, filter())).toBe(true);
	});

	test("chips admit exactly the economies they name", () => {
		const chips = filter({ economies: [0, 5] });
		expect(finderMatches({ name: "x", economy: 0 }, chips)).toBe(true);
		expect(finderMatches({ name: "x", economy: 5 }, chips)).toBe(true);
		expect(finderMatches({ name: "x", economy: 1 }, chips)).toBe(false);
	});

	test("chips and query are conjunctive", () => {
		const target = galaxy.systems.find((s) => s.economy === 0) as SystemRecord;
		expect(
			finderMatches(target, filter({ query: target.name, economies: [0] })),
		).toBe(true);
		expect(
			finderMatches(
				target,
				filter({ query: target.name, economies: [(target.economy + 1) % 8] }),
			),
		).toBe(false);
	});

	/** The ordering is `planRoute`'s objective, not a second one: fewest jumps,
	 *  then shortest chain. A list sorted on distance alone would rank a chain
	 *  above one the planner itself calls cheaper. */
	test("rows come back fewest jumps then shortest", () => {
		const { inBudget } = projectFinder(
			galaxy.systems,
			here,
			filter({ budgetJumps: 4 }),
		);
		expect(inBudget.length).toBeGreaterThan(10);
		for (let i = 1; i < inBudget.length; i++) {
			const a = inBudget[i - 1];
			const b = inBudget[i];
			expect(a.jumps).not.toBeNull();
			expect(b.jumps).not.toBeNull();
			expect((a.jumps as number) <= (b.jumps as number)).toBe(true);
			if (a.jumps === b.jumps)
				expect((a.routeLy as number) <= (b.routeLy as number) + 1e-9).toBe(
					true,
				);
		}
	});

	test("the ordering is total, so a re-sort cannot reshuffle equals", () => {
		const once = projectFinder(
			galaxy.systems,
			here,
			filter({ budgetJumps: 3 }),
		);
		const again = projectFinder(
			[...galaxy.systems].reverse(),
			here,
			filter({ budgetJumps: 3 }),
		);
		expect(again.inBudget.map((r) => r.index)).toEqual(
			once.inBudget.map((r) => r.index),
		);
	});

	test("a row carries government and tech level, which are read not filtered", () => {
		const { inBudget } = projectFinder(galaxy.systems, here, filter());
		const first = inBudget[0];
		const record = galaxy.systems.find(
			(s) => s.index === first.index,
		) as SystemRecord;
		expect(first.government.length).toBeGreaterThan(0);
		expect(first.displayTL).toBe(record.displayTL);
		// Population and description are record-card only (D5), so they are
		// deliberately absent from the row.
		expect(Object.keys(first)).not.toContain("population");
		expect(Object.keys(first)).not.toContain("description");
	});
});

describe("D6 — the budget bounds the primary list", () => {
	test("the default admits exactly the systems inside the 7 LY shell, plus here", () => {
		const { inBudget } = projectFinder(galaxy.systems, here, filter());
		const reach = projectJumps(galaxy.systems, here);
		const expected = galaxy.systems.filter(
			(s) => (reach.reach(s)?.jumps ?? 99) <= FINDER_DEFAULT_BUDGET,
		);
		expect(inBudget.map((r) => r.index).sort((a, b) => a - b)).toEqual(
			expected.map((s) => s.index).sort((a, b) => a - b),
		);
		// The chart's own lit shell is one jump, so list and chart agree on
		// first open — the one-instrument property D1 was chosen for.
		for (const r of inBudget) expect(r.jumps).toBeLessThanOrEqual(1);
		expect(inBudget.some((r) => r.index === here.index)).toBe(true);
	});

	test("widening the budget only ever adds rows", () => {
		const narrow = projectFinder(galaxy.systems, here, filter()).inBudget;
		const wide = projectFinder(
			galaxy.systems,
			here,
			filter({ budgetJumps: 3 }),
		).inBudget;
		expect(wide.length).toBeGreaterThan(narrow.length);
		const held = new Set(wide.map((r) => r.index));
		for (const r of narrow) expect(held.has(r.index)).toBe(true);
	});

	test("no unreachable system is ever in the primary list", () => {
		const island: SystemRecord = {
			...galaxy.systems[0],
			index: 901,
			name: "Isola",
			pos: { x: 400, y: 0, z: 0 },
		};
		const { inBudget } = projectFinder(
			[...galaxy.systems, island],
			here,
			filter({ budgetJumps: 9 }),
		);
		expect(inBudget.some((r) => r.index === island.index)).toBe(false);
	});
});

describe("D7 — a name lookup never returns a blank list", () => {
	/** The node's obligation 3, first branch: matches all in budget, so the
	 *  beyond-range group must be *absent*, not merely short. */
	test("a query whose matches are all in budget shows no beyond-range group", () => {
		const inShell = projectFinder(galaxy.systems, here, filter()).inBudget;
		const target = inShell.find((r) => r.index !== here.index) as {
			name: string;
		};
		const results = projectFinder(
			galaxy.systems,
			here,
			filter({ query: target.name }),
		);
		expect(results.inBudget.length).toBeGreaterThan(0);
		expect(results.beyondRange).toEqual([]);
	});

	/** The second branch: matches all out of budget, so the group is populated
	 *  *and* the primary list is empty. Together the two say the split tracks
	 *  the budget rather than being a constant. */
	test("a query whose matches are all out of budget shows the group and an empty primary list", () => {
		const reach = projectJumps(galaxy.systems, here);
		const far = galaxy.systems.find(
			(s) => (reach.reach(s)?.jumps ?? 0) >= 3,
		) as SystemRecord;
		const results = projectFinder(
			galaxy.systems,
			here,
			filter({ query: far.name }),
		);
		expect(results.inBudget).toEqual([]);
		expect(results.beyondRange.some((r) => r.index === far.index)).toBe(true);
		// "each with its jump count" — a dimmed row with no number would not
		// teach that the budget control is what hid it.
		for (const r of results.beyondRange)
			expect(r.jumps === null || r.jumps > FINDER_DEFAULT_BUDGET).toBe(true);
	});

	test("widening the budget moves a row from beyond-range into the list", () => {
		const reach = projectJumps(galaxy.systems, here);
		const far = galaxy.systems.find(
			(s) => (reach.reach(s)?.jumps ?? 0) === 3,
		) as SystemRecord;
		const before = projectFinder(
			galaxy.systems,
			here,
			filter({ query: far.name }),
		);
		const after = projectFinder(
			galaxy.systems,
			here,
			filter({ query: far.name, budgetJumps: 3 }),
		);
		expect(before.beyondRange.some((r) => r.index === far.index)).toBe(true);
		expect(after.inBudget.some((r) => r.index === far.index)).toBe(true);
		expect(after.beyondRange.some((r) => r.index === far.index)).toBe(false);
	});

	/**
	 * A chip-only narrowing is a browse, not a lookup. Without this the group
	 * would print most of the galaxy dimmed under a single chip click, which is
	 * the failure D7 exists to avoid wearing the costume of the fix for it.
	 */
	test("a chip-only narrowing populates no beyond-range group", () => {
		const results = projectFinder(
			galaxy.systems,
			here,
			filter({ economies: [0, 1] }),
		);
		expect(results.beyondRange).toEqual([]);
	});

	test("an unreachable name match still appears, with no jump count", () => {
		const island: SystemRecord = {
			...galaxy.systems[0],
			index: 902,
			name: "Zzisola",
			pos: { x: 400, y: 0, z: 0 },
		};
		const results = projectFinder(
			[...galaxy.systems, island],
			here,
			filter({ query: "Zzisola" }),
		);
		const found = results.beyondRange.find((r) => r.index === island.index);
		expect(found?.jumps).toBeNull();
		expect(found?.distanceLy).toBeGreaterThan(JUMP_RANGE_LY);
	});
});

describe("selection", () => {
	test("exactly the selected index reads selected", () => {
		const { inBudget } = projectFinder(
			galaxy.systems,
			here,
			filter({ budgetJumps: 2 }),
			here.index,
		);
		expect(inBudget.filter((r) => r.selected).map((r) => r.index)).toEqual([
			here.index,
		]);
	});
});
