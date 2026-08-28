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
 * The same **grammar** the Navigation list uses (`navFilterMatches`,
 * `cockpit.ts`): a set of chips plus a substring query, with an empty chip set
 * meaning *every* economy rather than none. One console, one way to narrow a
 * list — which is what stops two lists under one console name reading as two
 * applications (#86 D5).
 *
 * **It is a second predicate, not a second grammar, and that is deliberate.**
 * `navFilterMatches` chips on a `kind` string and queries a body's `id`; this
 * chips on an economy *index* and queries a system's `name`. A shared helper
 * over both would take the chip key and the queried field as parameters and
 * would be four lines of indirection standing in for four lines of predicate —
 * so what is shared is the rule as written down here and in
 * `galaxy-map.md` §5.2, and the thing that would actually catch a drift is a
 * test asserting the same three properties of each. `galaxy-finder.test.ts`
 * has them for this one.
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
 * The widest budget the control offers — and it has to clear the galaxy's own
 * jump diameter, which was **measured** rather than assumed.
 *
 * It was 9, justified by the claim that a budget past the diameter admits
 * everything. Nobody had measured the diameter. Over five world seeds, eight
 * galaxies each, from **every** system as origin, the worst shortest-chain is
 * **15 jumps** (14 at the shipped seed) — so at 9 a real pair sat permanently
 * in the dimmed "beyond range" group with no control position that could
 * promote it, which is *filtered-out reads as absent*, the failure D7 exists to
 * prevent.
 *
 * 16 clears the measured worst by one. `galaxy-finder.test.ts` re-measures the
 * shipped seed's eight galaxies from every origin and goes red if the ceiling
 * stops covering it, because the diameter is a property of the generator and
 * the generator changes.
 */
export const FINDER_MAX_BUDGET = 16;

export const finderDefaultFilter = (): FinderFilter => ({
	query: "",
	economies: [],
	budgetJumps: FINDER_DEFAULT_BUDGET,
});

/**
 * D6's session-scoped budget, held with the filter it belongs to.
 *
 * **Module scope rather than mount scope, because the mount is the thing that
 * does not survive.** `Game.setChartHost` disposes the chart every time the
 * player leaves the Galaxy Map tab, so a budget held in the panel's closure
 * would be back at 1 on the next look — which is not what "for the session"
 * means. It was built that way first.
 *
 * It is deliberately **not saved**: `persistent-world-state.md` §8 forbids
 * persisting a derivable projection, and a filter setting is presentation. A
 * reload starts at the default.
 */
let sessionBudgetJumps: number = FINDER_DEFAULT_BUDGET;

/** The filter a freshly mounted panel opens with: the default, carrying
 *  whatever budget the session last settled on. The query and the chips do not
 *  travel — D6 widens the budget alone. */
export const finderSessionFilter = (): FinderFilter => ({
	...finderDefaultFilter(),
	budgetJumps: sessionBudgetJumps,
});

/**
 * Clamp a filter's budget, remember it for the session, and hand it back.
 *
 * **The clamp refuses a non-finite value rather than passing it through.**
 * `Math.max`/`Math.min` return `NaN` for a `NaN` input, and a `NaN` budget
 * makes `finderIsNarrowed` permanently true, leaves both step buttons enabled
 * and inert (`NaN ± 1`), and drops every row out of budget — a panel wedged
 * open with nothing in it and no control that closes it.
 */
export function rememberFinderBudget(filter: FinderFilter): FinderFilter {
	const asked = Math.round(filter.budgetJumps);
	const budgetJumps = Number.isFinite(asked)
		? Math.max(1, Math.min(FINDER_MAX_BUDGET, asked))
		: FINDER_DEFAULT_BUDGET;
	sessionBudgetJumps = budgetJumps;
	return { ...filter, budgetJumps };
}

/** Put the session budget back to the default. For tests, which would
 *  otherwise inherit whatever an earlier one settled. */
export function resetFinderSession(): void {
	sessionBudgetJumps = FINDER_DEFAULT_BUDGET;
}

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

/**
 * **No `selected` field.** Which row is selected is the chart's fact, not the
 * projection's, and a copy here is one that goes stale the moment a render
 * skips the projection — which is exactly what the panel does when only the
 * selection moved. The panel paints from the chart's own answer.
 */
const row = (
	system: SystemRecord,
	from: SystemRecord,
	reach: JumpReach | undefined,
): FinderRow => ({
	index: system.index,
	name: system.name,
	economy: ECONOMY_NAMES[system.economy],
	government: GOVERNMENT_NAMES[system.government],
	displayTL: system.displayTL,
	jumps: reach?.jumps ?? null,
	routeLy: reach?.ly ?? null,
	distanceLy: distanceLy(from.pos, system.pos),
});

/**
 * D5's ordering: fewest jumps, then shortest.
 *
 * `planRoute`'s own objective rather than a second one invented for the list —
 * a list sorted on a different rule from the planner that fills it would rank a
 * chain above one the planner itself calls cheaper.
 *
 * Unreachable rows sort last on their straight-line distance, which is the only
 * thing that is true about them. The last tie breaks on the **index**, not the
 * name: names repeat inside a galaxy — seed `0x5ee11e` galaxy 7 carries
 * `ONTIAR` twice — so a name comparator returns 0 for a real pair and the
 * order's totality would rest on two floats never being equal. The index is the
 * one key that cannot tie, and a total order is what stops the list reshuffling
 * under the cursor on a re-sort.
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
	return a.name.localeCompare(b.name) || a.index - b.index;
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
	maxJump = JUMP_RANGE_LY,
): FinderResults {
	const projection = projectJumps(systems, from, maxJump);
	const hasQuery = filter.query.trim() !== "";
	const inBudget: FinderRow[] = [];
	const beyondRange: FinderRow[] = [];

	for (const system of systems) {
		if (system.galaxy !== from.galaxy) continue;
		if (!finderMatches(system, filter)) continue;
		const here = projection.reach(system);
		// **Built inside the branch that keeps it.** Constructed before the
		// test, a chip-only narrowing at the default budget allocated a row and
		// took a square root for every matching out-of-budget system and then
		// dropped it — up to 250 of them on one chip click.
		if (here !== undefined && here.jumps <= filter.budgetJumps)
			inBudget.push(row(system, from, here));
		else if (hasQuery) beyondRange.push(row(system, from, here));
	}

	inBudget.sort(byReach);
	beyondRange.sort(byReach);
	return { inBudget, beyondRange };
}
