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
	FINDER_MAX_BUDGET,
	type FinderFilter,
	finderDefaultFilter,
	finderIsNarrowed,
	finderMatches,
	finderSessionFilter,
	facilityAnnotationLabel,
	type FacilityAnnotation,
	type FinderKnowledge,
	projectFinder,
	rememberFinderBudget,
	resetFinderSession,
} from "../src/galaxy-finder";
import {
	ECONOMY_NAMES,
	GALAXY_COUNT,
	JUMP_RANGE_LY,
	type SystemRecord,
	generateGalaxy,
	startSystem,
} from "../src/galaxy";
import { carrierKey } from "../src/carrier-key";
import { planRoute, projectJumps } from "../src/galaxy-route";
import { generateContents } from "../src/system";
import type { StationType } from "../src/station";
import type { Station } from "../src/system";
import type { OperationalCondition } from "../src/world-state";

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
	 * The sample spans 1 jump to the far end of the galaxy. It does **not**
	 * reach the unreachable case — §5 of `galaxy-generation.md` guarantees a
	 * connected layout, so `unreachable` is pinned at 0 below and the
	 * `route === null` branch here never runs. That half of the agreement is
	 * the next test's, over a pool with hand-built islands in it, because a
	 * branch no run enters is a branch nothing checks.
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

	/**
	 * **The unreachable half of the agreement, which the sweep above cannot
	 * reach.**
	 *
	 * §5 of `galaxy-generation.md` guarantees a connected layout, so that sweep
	 * asserts `unreachable === 0` — which means its `route === null` branch has
	 * never executed and the claim "spans one jump to unreachable" was true of
	 * the *intent* and not of the run. Here the pool is the real galaxy plus
	 * three hand-built islands, so both sides are asked about a pair with no
	 * chain and both are required to say so.
	 */
	test("planRoute and the projection agree on unreachable pairs too", () => {
		const islands: SystemRecord[] = [910, 911, 912].map((index, i) => ({
			...galaxy.systems[i],
			index,
			name: `Isle${index}`,
			// Far enough apart that they are not even neighbours of each other:
			// three islands in one component would test one unreachable pair
			// three times rather than three of them.
			pos: { x: 400 + i * 100, y: 0, z: 0 },
		}));
		const pool = [...galaxy.systems, ...islands];
		const reach = projectJumps(pool, here);
		let checked = 0;
		for (const island of islands) {
			expect(planRoute(pool, here, island)).toBeNull();
			expect(reach.reach(island)).toBeUndefined();
			checked++;
		}
		expect(checked).toBe(islands.length);
		// And the reachable half is unchanged by their presence, so this is a
		// test about the unreachable case rather than about a broken pool.
		expect(reach.reach(here)?.jumps).toBe(0);
		expect(reach.size).toBe(projectJumps(galaxy.systems, here).size);
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

	/**
	 * **Both halves, because either alone is a loop that may never run.** The
	 * first version asserted the galaxy of every returned row — and at this seed
	 * the galaxy-1 name it queried matches nothing here, so the body never
	 * executed and the test stated its claim by an empty iteration. So: a name
	 * that exists *only* in the other galaxy returns nothing at all, and a name
	 * that exists in **both** returns only this galaxy's.
	 */
	test("the finder drops rows from another galaxy", () => {
		const other = generateGalaxy(WORLD_SEED, 1);
		const pool = [...galaxy.systems, ...other.systems];
		const mine = new Set(galaxy.systems.map((s) => s.name));

		const foreignOnly = other.systems.find(
			(s) => !mine.has(s.name),
		) as SystemRecord;
		const absent = projectFinder(
			pool,
			here,
			filter({ query: foreignOnly.name, budgetJumps: 9 }),
		);
		expect(absent.inBudget).toEqual([]);
		expect(absent.beyondRange).toEqual([]);

		// The collision is built rather than found: no name is shared between
		// galaxies 0 and 1 at this seed, so a search for one would be the empty
		// loop again. A twin carrying a galaxy-0 name *and* its index is the
		// hardest case the galaxy guard has to answer, and it is exactly what a
		// map keyed on the bare index would return.
		const mine0 = galaxy.systems[11];
		const twin: SystemRecord = {
			...other.systems[3],
			index: mine0.index,
			name: mine0.name,
		};
		expect(twin.galaxy).not.toBe(here.galaxy);
		const found = projectFinder(
			[...galaxy.systems, twin],
			here,
			filter({ query: mine0.name, budgetJumps: 9 }),
		);
		const rows = [...found.inBudget, ...found.beyondRange];
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.filter((r) => r.index === mine0.index).length).toBe(1);
		for (const r of rows) {
			const record = galaxy.systems.find(
				(s) => s.index === r.index,
			) as SystemRecord;
			expect(record).toBeDefined();
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
				filter({
					query: target.name,
					economies: [(target.economy + 1) % ECONOMY_NAMES.length],
				}),
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

describe("the budget ceiling covers the galaxy", () => {
	/**
	 * **The ceiling is a claim about the generator, so it is measured against
	 * it.**
	 *
	 * `FINDER_MAX_BUDGET` was 9, on the reasoning that a budget past the
	 * galaxy's jump diameter admits everything — and nobody had measured the
	 * diameter. It is 15 over five world seeds and 14 at the shipped one, so at
	 * 9 a real pair sat permanently in the dimmed group with no control position
	 * that could promote it: *filtered-out reads as absent*, which is the whole
	 * failure D7 exists to prevent.
	 *
	 * Every origin in every galaxy of the shipped seed, because the worst pair
	 * is not the start system's and a sample would be a different claim. ~360 ms.
	 */
	test("no reachable pair needs more jumps than the control can ask for", () => {
		let worst = 0;
		let worstAt = "";
		for (let index = 0; index < GALAXY_COUNT; index++) {
			const gx = generateGalaxy(WORLD_SEED, index);
			for (const from of gx.systems) {
				const reach = projectJumps(gx.systems, from);
				for (const to of gx.systems) {
					const jumps = reach.reach(to)?.jumps;
					if (jumps !== undefined && jumps > worst) {
						worst = jumps;
						worstAt = `g${index} ${from.name}→${to.name}`;
					}
				}
			}
		}
		// Printed into the failure by being in the message: a bare
		// `toBeLessThanOrEqual` would say the ceiling was breached and not by
		// how much or where.
		expect({ worst, worstAt, ceiling: FINDER_MAX_BUDGET }).toMatchObject({
			worst: expect.any(Number),
		});
		expect(worst).toBeLessThanOrEqual(FINDER_MAX_BUDGET);
		// And the ceiling is not absurdly above it either — a ceiling of 500
		// would pass the line above while making the control useless.
		expect(FINDER_MAX_BUDGET).toBeLessThanOrEqual(worst + 4);
	});

	test("the widest budget admits every reachable system", () => {
		const { inBudget, beyondRange } = projectFinder(
			galaxy.systems,
			here,
			filter({ query: "", budgetJumps: FINDER_MAX_BUDGET }),
		);
		const reach = projectJumps(galaxy.systems, here);
		const reachable = galaxy.systems.filter(
			(s) => reach.reach(s) !== undefined,
		);
		expect(inBudget.length).toBe(reachable.length);
		expect(beyondRange).toEqual([]);
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

describe("D6 — the session budget", () => {
	/**
	 * The session value is module state, so a test that widened it would leak
	 * into whatever ran next. Reset around, and asserted both ways: the budget
	 * travels and the query does not.
	 */
	test("a remembered budget travels to a fresh filter; the query does not", () => {
		resetFinderSession();
		try {
			expect(finderSessionFilter().budgetJumps).toBe(FINDER_DEFAULT_BUDGET);
			rememberFinderBudget(filter({ query: "lave", budgetJumps: 4 }));
			const fresh = finderSessionFilter();
			expect(fresh.budgetJumps).toBe(4);
			expect(fresh.query).toBe("");
			expect(fresh.economies).toEqual([]);
		} finally {
			resetFinderSession();
		}
	});

	test("a non-finite budget falls back to the default rather than passing through", () => {
		resetFinderSession();
		try {
			expect(
				rememberFinderBudget(filter({ budgetJumps: Number.NaN })).budgetJumps,
			).toBe(FINDER_DEFAULT_BUDGET);
			// And it does not leave the session holding one either, which is what
			// would wedge the next panel open with no control that closes it.
			expect(finderSessionFilter().budgetJumps).toBe(FINDER_DEFAULT_BUDGET);
			expect(
				rememberFinderBudget(filter({ budgetJumps: 99 })).budgetJumps,
			).toBe(FINDER_MAX_BUDGET);
			expect(rememberFinderBudget(filter({ budgetJumps: 0 })).budgetJumps).toBe(
				1,
			);
		} finally {
			resetFinderSession();
		}
	});
});

describe("§9.4 facilities knowledge", () => {
	/** The first system in this galaxy carrying `role`, which every check here
	 *  needs and none of them may assume exists. */
	const withRole = (role: StationType): SystemRecord => {
		const found = galaxy.systems.find(
			(system) =>
				system.galaxy === here.galaxy &&
				generateContents(system).stations.some(
					(station) => station.type === role,
				),
		);
		if (!found) throw new Error(`the fixture galaxy has no ${role}`);
		return found;
	};

	const stationOf = (system: SystemRecord, role: StationType): Station => {
		const station = generateContents(system).stations.find(
			(candidate) => candidate.type === role,
		);
		if (!station) throw new Error(`${system.name} has no ${role}`);
		return station;
	};

	/** A system whose generated refinery flag is `flag` — the two halves of
	 *  §5.2.1's three-valued fence, which differ only in that flag. */
	const fenceSystem = (flag: boolean) => {
		const system = galaxy.systems.find((candidate) => {
			if (candidate.galaxy !== here.galaxy) return false;
			const refinery = generateContents(candidate).stations.find(
				(station) => station.type === "refinery",
			);
			return refinery !== undefined && refinery.blackMarket === flag;
		});
		if (!system)
			throw new Error(`the fixture galaxy has no refinery flagged ${flag}`);
		return { system, refinery: stationOf(system, "refinery") };
	};

	/** A knowledge overlay with one carrier docked at, so its private fact is
	 *  checked. */
	const checked = (
		system: SystemRecord,
		station: Station,
		condition: OperationalCondition,
		observedAt: number,
	): FinderKnowledge => ({
		[carrierKey(system.index, station.localCarrierId)]: {
			observedInstanceOrdinal: 0,
			observedCondition: condition,
			observedAt,
			source: "docking",
			knownPrivateFacts: {
				blackMarket: { learnedAt: observedAt, source: "docking" },
			},
		},
	});

	test("public refinery and shipyard roles project with no knowledge overlay", () => {
		const refinery = galaxy.systems.find((system) =>
			generateContents(system).stations.some(
				(station) => station.type === "refinery",
			),
		) as SystemRecord;
		const shipyard = galaxy.systems.find((system) =>
			generateContents(system).stations.some(
				(station) => station.type === "shipyard",
			),
		) as SystemRecord;
		const refineries = projectFinder(
			galaxy.systems,
			here,
			filter({
				facilities: ["REFINERY"],
				budgetJumps: FINDER_MAX_BUDGET,
			}),
		);
		const shipyards = projectFinder(
			galaxy.systems,
			here,
			filter({
				facilities: ["SHIPYARD"],
				budgetJumps: FINDER_MAX_BUDGET,
			}),
		);
		expect(refineries.inBudget.map((row) => row.index)).toContain(
			refinery.index,
		);
		expect(shipyards.inBudget.map((row) => row.index)).toContain(
			shipyard.index,
		);
	});

	test("known fences match only a checked generated true fact and count unchecked refineries", () => {
		const system = galaxy.systems.find((candidate) => {
			const refinery = generateContents(candidate).stations.find(
				(station) => station.type === "refinery",
			);
			return refinery?.blackMarket === true;
		}) as SystemRecord;
		const refinery = generateContents(system).stations.find(
			(station) => station.type === "refinery",
		);
		if (!refinery) throw new Error("fixture needs a refinery");
		const result = projectFinder(
			galaxy.systems,
			here,
			filter({
				facilities: ["KNOWN FENCE"],
				budgetJumps: FINDER_MAX_BUDGET,
			}),
			undefined,
			{
				[carrierKey(system.index, refinery.localCarrierId)]: {
					observedInstanceOrdinal: 0,
					observedCondition: "operational",
					observedAt: 9,
					source: "docking",
					knownPrivateFacts: {
						blackMarket: { learnedAt: 9, source: "docking" },
					},
				},
			},
		);
		expect(result.inBudget.map((row) => row.index)).toContain(system.index);
		expect(result.uncheckedFence).toBeGreaterThan(0);
	});

	/**
	 * **§5.2.1's annotation is a fact about the carrier, not an echo of the
	 * chip.** The first implementation set `matchedFacilities` to
	 * `[...filter.facilities]`, so every row printed back exactly what was
	 * asked for and no build could fail the check — the tautology
	 * `a-check-derived-from-its-subject` names. A row annotates the *station*
	 * it matched on: its role, its last-known condition, and when that was
	 * seen.
	 */
	test("a matched role carries its own condition and observation, never the filter's chips", () => {
		const system = withRole("shipyard");
		const shipyard = stationOf(system, "shipyard");
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["SHIPYARD"], budgetJumps: FINDER_MAX_BUDGET }),
			undefined,
			{
				[carrierKey(system.index, shipyard.localCarrierId)]: {
					observedInstanceOrdinal: 0,
					observedCondition: "disabled",
					observedAt: 1000,
					source: "system-relay",
				},
			},
		);
		const row = seen.inBudget.find(
			(candidate) => candidate.index === system.index,
		);
		expect(row?.matchedFacilities).toEqual([
			{
				facility: "SHIPYARD",
				role: "shipyard",
				name: shipyard.name,
				condition: "disabled",
				observedAt: 1000,
				source: "system-relay",
			},
		]);

		// The same system with no knowledge row at all still matches — the
		// structure is public — and reads as never observed.
		const blind = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["SHIPYARD"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		expect(
			blind.inBudget.find((candidate) => candidate.index === system.index)
				?.matchedFacilities,
		).toEqual([
			{
				facility: "SHIPYARD",
				role: "shipyard",
				name: shipyard.name,
				condition: null,
				observedAt: null,
				source: null,
			},
		]);
	});

	/**
	 * §5.2.1: "there is no availability filter". A destroyed shipyard is still
	 * a shipyard, and the condition is an annotation that never removes the
	 * row.
	 */
	test("a destroyed or repairing role still matches, and says so", () => {
		const system = withRole("shipyard");
		const shipyard = stationOf(system, "shipyard");
		for (const condition of ["disabled", "destroyed", "repairing"] as const) {
			const seen = projectFinder(
				galaxy.systems,
				here,
				filter({ facilities: ["SHIPYARD"], budgetJumps: FINDER_MAX_BUDGET }),
				undefined,
				{
					[carrierKey(system.index, shipyard.localCarrierId)]: {
						observedInstanceOrdinal: 0,
						observedCondition: condition,
						observedAt: 5,
						source: "docking",
					},
				},
			);
			const row = seen.inBudget.find(
				(candidate) => candidate.index === system.index,
			);
			expect(row?.matchedFacilities[0].condition).toBe(condition);
		}
	});

	/**
	 * §5.2.1: an observed recovery is remembered intelligence. The projection
	 * carries the remembered schedule so the card can print it as unconfirmed;
	 * it never promotes it to a completion, which is what
	 * `facilityAnnotationLabel` pins below.
	 */
	test("a repairing role carries its remembered schedule, and elapsed time never completes it", () => {
		const system = withRole("shipyard");
		const shipyard = stationOf(system, "shipyard");
		const recovery = {
			processId: "p1",
			kind: "repair" as const,
			consequenceArea: "docking",
			startedAt: 10,
			completesAt: 100,
		};
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["SHIPYARD"], budgetJumps: FINDER_MAX_BUDGET }),
			undefined,
			{
				[carrierKey(system.index, shipyard.localCarrierId)]: {
					observedInstanceOrdinal: 0,
					observedCondition: "repairing",
					observedAt: 10,
					source: "docking",
					observedRecovery: recovery,
				},
			},
		);
		const annotation = seen.inBudget.find(
			(candidate) => candidate.index === system.index,
		)?.matchedFacilities[0];
		expect(annotation?.observedRecovery).toEqual(recovery);
		// Long past `completesAt`, and still repairing.
		expect(
			facilityAnnotationLabel(annotation as FacilityAnnotation, 10_000),
		).toBe("REPAIRING · SEEN 2H AGO");
	});

	/**
	 * §5.2.1's two worked examples, plus the never-observed case. Age is
	 * relative and coarse; the exact time belongs to the record card.
	 */
	test("the compact annotation is condition plus relative age", () => {
		const at = (condition: OperationalCondition, observedAt: number) =>
			({
				facility: "SHIPYARD",
				role: "shipyard",
				name: "X",
				condition,
				observedAt,
				source: "system-relay",
			}) satisfies FacilityAnnotation;
		expect(facilityAnnotationLabel(at("operational", 0), 2 * 3600)).toBe(
			"OPERATIONAL · SEEN 2H AGO",
		);
		expect(facilityAnnotationLabel(at("destroyed", 0), 3 * 86_400)).toBe(
			"DESTROYED · SEEN 3D AGO",
		);
		expect(facilityAnnotationLabel(at("operational", 0), 120)).toBe(
			"OPERATIONAL · SEEN 2M AGO",
		);
		expect(facilityAnnotationLabel(at("operational", 0), 5)).toBe(
			"OPERATIONAL · SEEN JUST NOW",
		);
		expect(
			facilityAnnotationLabel(
				{
					facility: "REFINERY",
					role: "refinery",
					name: "X",
					condition: null,
					observedAt: null,
					source: null,
				},
				9_999,
			),
		).toBe("STATUS UNKNOWN");
	});

	/**
	 * §5.2.1: knowledge never expires. A row seen a thousand days ago is still
	 * a row, with a bigger number on it.
	 */
	test("age never removes a row or reclassifies its condition", () => {
		const system = withRole("shipyard");
		const shipyard = stationOf(system, "shipyard");
		const knowledge = {
			[carrierKey(system.index, shipyard.localCarrierId)]: {
				observedInstanceOrdinal: 0,
				observedCondition: "operational" as const,
				observedAt: 0,
				source: "system-relay",
			},
		};
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["SHIPYARD"], budgetJumps: FINDER_MAX_BUDGET }),
			undefined,
			knowledge,
		);
		const row = seen.inBudget.find(
			(candidate) => candidate.index === system.index,
		);
		expect(row?.matchedFacilities[0].condition).toBe("operational");
		expect(
			facilityAnnotationLabel(
				row?.matchedFacilities[0] as FacilityAnnotation,
				1000 * 86_400,
			),
		).toBe("OPERATIONAL · SEEN 1000D AGO");
	});

	/**
	 * §5.2.1: "`KNOWN FENCE` uses its refinery's last-known condition." The
	 * fence is not a carrier of its own, so its annotation is the refinery's.
	 */
	test("a known fence annotates with its refinery's condition", () => {
		const { system, refinery } = fenceSystem(true);
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
			undefined,
			checked(system, refinery, "disabled", 40),
		);
		const row = seen.inBudget.find(
			(candidate) => candidate.index === system.index,
		);
		expect(row?.matchedFacilities).toEqual([
			{
				facility: "KNOWN FENCE",
				role: "refinery",
				name: refinery.name,
				condition: "disabled",
				observedAt: 40,
				source: "docking",
			},
		]);
	});

	/**
	 * §5.2.1's three values. A checked *false* flag is a known non-match — it
	 * is neither a row nor an unchecked refinery, and the diff that shipped
	 * had no case for it at all.
	 */
	test("a checked false fence is a known non-match, not an unchecked one", () => {
		const { system, refinery } = fenceSystem(false);
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
			undefined,
			checked(system, refinery, "operational", 3),
		);
		expect(seen.inBudget.map((row) => row.index)).not.toContain(system.index);

		// The same system with no marker is unchecked instead — the difference
		// between the two is the marker and nothing else.
		const blind = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		expect(blind.uncheckedFence).toBeGreaterThan(seen.uncheckedFence);
	});

	/**
	 * §5.2.1: the count is "systems inside the current name, economy, and jump
	 * narrowing". The first implementation counted every unchecked refinery in
	 * the galaxy however far away, so the one-jump budget the finder opens on
	 * reported a number that no narrowing could move.
	 */
	test("the unchecked count respects the jump budget", () => {
		const near = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: 1 }),
		);
		const far = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		expect(near.uncheckedFence).toBeLessThan(far.uncheckedFence);
		// And it is bounded by what the budget can reach at all.
		const reachable = projectJumps(galaxy.systems, here, JUMP_RANGE_LY);
		const withinOne = galaxy.systems.filter((system) => {
			const reach = reachable.reach(system);
			return (
				system.galaxy === here.galaxy && reach !== undefined && reach.jumps <= 1
			);
		});
		expect(near.uncheckedFence).toBeLessThanOrEqual(withinOne.length);
	});

	/**
	 * §5.2.1: the count sits inside the *other* narrowing too. A name query
	 * that admits one system cannot report the galaxy's unchecked refineries.
	 */
	test("the unchecked count respects the name and economy narrowing", () => {
		const wide = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		const narrowed = projectFinder(
			galaxy.systems,
			here,
			filter({
				facilities: ["KNOWN FENCE"],
				budgetJumps: FINDER_MAX_BUDGET,
				query: galaxy.systems[0].name,
			}),
		);
		expect(narrowed.uncheckedFence).toBeLessThan(wide.uncheckedFence);
	});

	/**
	 * §5.2.1: "A system with no refinery is neither a match nor unchecked."
	 */
	test("a system with no refinery is never counted unchecked", () => {
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		const refineryCount = galaxy.systems.filter(
			(system) =>
				system.galaxy === here.galaxy &&
				generateContents(system).stations.some(
					(station) => station.type === "refinery",
				),
		).length;
		expect(seen.uncheckedFence).toBeLessThanOrEqual(refineryCount);
	});

	/**
	 * Checking a fence in a system that fails a *different* active chip could
	 * never turn it into a match, so it is not a refinery the player has any
	 * reason to go and check.
	 */
	test("a system failing another active chip is not counted unchecked", () => {
		const fenceOnly = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["KNOWN FENCE"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		const withShipyard = projectFinder(
			galaxy.systems,
			here,
			filter({
				facilities: ["KNOWN FENCE", "SHIPYARD"],
				budgetJumps: FINDER_MAX_BUDGET,
			}),
		);
		expect(withShipyard.uncheckedFence).toBeLessThan(fenceOnly.uncheckedFence);
	});

	/**
	 * §9.4 item 2: facility chips intersect at system level.
	 */
	test("REFINERY and SHIPYARD together mean both, and each row annotates both", () => {
		const budget = filter({
			facilities: ["REFINERY", "SHIPYARD"],
			budgetJumps: FINDER_MAX_BUDGET,
		});
		const both = projectFinder(galaxy.systems, here, budget);
		const refineries = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["REFINERY"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		const shipyards = projectFinder(
			galaxy.systems,
			here,
			filter({ facilities: ["SHIPYARD"], budgetJumps: FINDER_MAX_BUDGET }),
		);
		const indices = new Set(both.inBudget.map((row) => row.index));
		expect(indices.size).toBeGreaterThan(0);
		expect(indices.size).toBeLessThan(refineries.inBudget.length);
		expect(indices.size).toBeLessThan(shipyards.inBudget.length);
		for (const row of both.inBudget) {
			expect(row.matchedFacilities.map((a) => a.facility).sort()).toEqual([
				"REFINERY",
				"SHIPYARD",
			]);
			const contents = generateContents(
				galaxy.systems.find((s) => s.index === row.index) as SystemRecord,
			);
			expect(
				contents.stations.some((station) => station.type === "refinery"),
			).toBe(true);
			expect(
				contents.stations.some((station) => station.type === "shipyard"),
			).toBe(true);
		}
	});

	/**
	 * §5.2.1: "With no facility chip active, §5.2's existing compact row is
	 * unchanged."
	 *
	 * **This pins the row and not the cost.** `projectFinder` also skips the
	 * station roster entirely with no chip active, which is worth far more —
	 * it is 256 system generations per keystroke — and removing that guard was
	 * flown here and left every assertion below green, because an unread
	 * roster and a read one produce the same empty annotation list. The saving
	 * is `facilitiesOf`'s doc comment to state and a reader's to keep; nothing
	 * in this tier can see it.
	 */
	test("no facility chip means no annotation", () => {
		const seen = projectFinder(
			galaxy.systems,
			here,
			filter({ budgetJumps: FINDER_MAX_BUDGET }),
		);
		expect(seen.inBudget.length).toBeGreaterThan(0);
		for (const row of seen.inBudget) expect(row.matchedFacilities).toEqual([]);
		expect(seen.uncheckedFence).toBe(0);
	});

	/** §9.4 item 2: any facility chip expands the finder, under §5.2's rule. */
	test("a facility chip alone counts as narrowing", () => {
		expect(finderIsNarrowed(filter({ facilities: ["REFINERY"] }))).toBe(true);
		expect(finderIsNarrowed(filter())).toBe(false);
	});
});

describe("selection", () => {
	/**
	 * **A row carries no selected flag, and that is the assertion.**
	 *
	 * It carried one, and the panel rewrote it on every repaint — two owners of
	 * one fact, where the projection's copy went stale the moment a render
	 * skipped the projection, which is exactly what happens when only the
	 * selection moved. Which row is selected is the chart's answer; the panel
	 * paints from it. This pins the shape so the field cannot come back without
	 * someone deciding to bring it back.
	 */
	test("a row carries no selection state", () => {
		const { inBudget } = projectFinder(
			galaxy.systems,
			here,
			filter({ budgetJumps: 2 }),
		);
		expect(inBudget.length).toBeGreaterThan(0);
		expect(Object.keys(inBudget[0])).not.toContain("selected");
	});
});
