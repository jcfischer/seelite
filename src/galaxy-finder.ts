/**
 * The galaxy finder's arithmetic — #86's D5, D6 and D7 as pure functions.
 *
 * `galaxy-map.ts` draws this; nothing here knows about a DOM or a camera. The
 * split is the one `galaxy-route.ts` already makes against the same chart: what
 * a filter admits, how the two groups are ordered and when the panel is
 * narrowed are answers a headless test can enumerate, and #11's crowding figure
 * is the only part of the map that genuinely needs a browser.
 *
 * It imports no Three.js and must not: the finder is a projection of the same
 * records the chart draws, never a second copy of them.
 */

import {
	ECONOMY_NAMES,
	GOVERNMENT_NAMES,
	JUMP_RANGE_LY,
	type SystemRecord,
	distanceLy,
} from "./galaxy";
import { type JumpReach, projectJumps } from "./galaxy-route";

/**
 * What the player has narrowed the galaxy to.
 *
 * The same grammar the Navigation list uses (`navFilterMatches`,
 * `cockpit.ts`): a set of chips plus a substring query, with an empty chip set
 * meaning *every* economy rather than none. One console, one way to narrow a
 * list — which is what stops two lists under one console name reading as two
 * applications (#86 D5).
 *
 * `budgetJumps` is the third control and is this list's own: the local list has
 * no analogue because everything on it is in the system you are in.
 */
export interface FinderFilter {
	query: string;
	/** Economy indices into `ECONOMY_NAMES`. Empty means every economy. */
	economies: readonly number[];
	/** The jump bound on the primary list, at least 1. */
	budgetJumps: number;
}

/**
 * D6: one jump — the 7 LY shell the chart already lights.
 *
 * List and chart therefore agree on first open, and no unreachable system is
 * ever in the primary list.
 */
export const FINDER_DEFAULT_BUDGET = 1;

/**
 * The widest budget the control offers.
 *
 * Not a limit on the projection, which labels the whole pool: a budget past the
 * galaxy's diameter in jumps admits everything, so a larger number would be a
 * control position that cannot change what is on screen.
 */
export const FINDER_MAX_BUDGET = 9;

export const finderDefaultFilter = (): FinderFilter => ({
	query: "",
	economies: [],
	budgetJumps: FINDER_DEFAULT_BUDGET,
});

/**
 * D4: is any narrowing active?
 *
 * **This is what expands the panel**, and it deliberately reads all three
 * controls rather than the query alone. An expand rule keyed to the text field
 * would leave the chips and the budget dead until something was typed — the
 * defect `live-cockpit.ts` records having shipped once already, where a state
 * attribute swallowed every chip click without an error anywhere.
 */
export function finderIsNarrowed(filter: FinderFilter): boolean {
	return (
		filter.query.trim() !== "" ||
		filter.economies.length > 0 ||
		filter.budgetJumps !== FINDER_DEFAULT_BUDGET
	);
}

/** One row of the finder, as the panel prints it. */
export interface FinderRow {
	index: number;
	name: string;
	economy: string;
	government: string;
	displayTL: number;
	/** Fewest jumps from the ship's system, or `null` when there is no chain. */
	jumps: number | null;
	/** That chain's total length, light years, or `null` with `jumps`. */
	routeLy: number | null;
	/** Straight-line distance, which exists even where a route does not. */
	distanceLy: number;
	selected: boolean;
}

/**
 * D7's two groups.
 *
 * `beyondRange` is populated **only for a name query**, because that is the
 * failure D7 names: a lookup under the default one-jump budget would usually
 * return nothing, and an empty list reads as *no such system* rather than as
 * *filtered out*. A chip-only narrowing has no such failure — it is a browse,
 * and 250 dimmed rows under it would be the whole galaxy printed twice.
 */
export interface FinderResults {
	inBudget: FinderRow[];
	beyondRange: FinderRow[];
}

/** Does one system survive the name and economy narrowing? */
export function finderMatches(
	system: Pick<SystemRecord, "name" | "economy">,
	filter: FinderFilter,
): boolean {
	if (filter.economies.length > 0 && !filter.economies.includes(system.economy))
		return false;
	const query = filter.query.trim().toLowerCase();
	return query === "" || system.name.toLowerCase().includes(query);
}

const row = (
	system: SystemRecord,
	from: SystemRecord,
	reach: JumpReach | undefined,
	selectedIndex: number | null,
): FinderRow => ({
	index: system.index,
	name: system.name,
	economy: ECONOMY_NAMES[system.economy],
	government: GOVERNMENT_NAMES[system.government],
	displayTL: system.displayTL,
	jumps: reach?.jumps ?? null,
	routeLy: reach?.ly ?? null,
	distanceLy: distanceLy(from.pos, system.pos),
	selected: system.index === selectedIndex,
});

/**
 * D5's ordering: fewest jumps, then shortest.
 *
 * `planRoute`'s own objective rather than a second one invented for the list —
 * a list sorted on a different rule from the planner that fills it would rank a
 * chain above one the planner itself calls cheaper.
 *
 * Unreachable rows sort last on their straight-line distance, which is the only
 * thing that is true about them. Ties break on the name so the order is total:
 * two systems at equal cost would otherwise swap rows on a re-sort and the list
 * would flicker under the cursor.
 */
function byReach(a: FinderRow, b: FinderRow): number {
	if (a.jumps !== b.jumps) {
		if (a.jumps === null) return 1;
		if (b.jumps === null) return -1;
		return a.jumps - b.jumps;
	}
	if (a.routeLy !== null && b.routeLy !== null && a.routeLy !== b.routeLy)
		return a.routeLy - b.routeLy;
	if (a.jumps === null && a.distanceLy !== b.distanceLy)
		return a.distanceLy - b.distanceLy;
	return a.name.localeCompare(b.name);
}

/**
 * The finder's two lists for one galaxy.
 *
 * **One traversal, not 256 routes.** `projectJumps` labels the whole pool from
 * the ship's system in a single relaxation over the cached adjacency; calling
 * `planRoute` per system would run that same relaxation once per row to read
 * one number out of each.
 *
 * `systems` may hold more than one galaxy — `projectJumps` scopes itself to
 * `from.galaxy`, and this scopes the rows the same way. #6 makes the galaxy a
 * namespace, and a finder that searched all eight would imply a reachability
 * the 7 LY tank does not have.
 */
export function projectFinder(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	filter: FinderFilter,
	selectedIndex: number | null = null,
	maxJump = JUMP_RANGE_LY,
): FinderResults {
	const reach = projectJumps(systems, from, maxJump);
	const hasQuery = filter.query.trim() !== "";
	const inBudget: FinderRow[] = [];
	const beyondRange: FinderRow[] = [];

	for (const system of systems) {
		if (system.galaxy !== from.galaxy) continue;
		if (!finderMatches(system, filter)) continue;
		const here = reach.get(system.index);
		const built = row(system, from, here, selectedIndex);
		if (here !== undefined && here.jumps <= filter.budgetJumps)
			inBudget.push(built);
		else if (hasQuery) beyondRange.push(built);
	}

	inBudget.sort(byReach);
	beyondRange.sort(byReach);
	return { inBudget, beyondRange };
}
