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
import { carrierKey } from "./carrier-key";
import { generateContents } from "./system";
import type { StationType } from "./station";
import {
	type FacilityAnnotation,
	type FinderKnowledge,
	fenceKnowledge,
} from "./knowledge-labels";
import type {
	GalaxyEnvelope,
	KnowledgeRow,
	ObservedRecovery,
	OperationalCondition,
} from "./world-state";

export const FACILITY_CHIPS = ["REFINERY", "SHIPYARD", "KNOWN FENCE"] as const;
export type FacilityChip = (typeof FACILITY_CHIPS)[number];

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
 * `navFilterMatches` chips on a `kind` string and queries a body's visible
 * name and kind words; this chips on an economy *index* and queries a system's
 * `name`. A shared helper
 * over both would take the chip key and the queried field as parameters and
 * would be four lines of indirection standing in for four lines of predicate —
 * so what is shared is the rule as written down here and in
 * `galaxy-map.md` §5.2, and the thing that would actually catch a drift is a
 * test asserting the same three properties of each. `galaxy-finder.test.ts`
 * has them for this one.
 *
 * `budgetJumps` is this list's own and the local list has no analogue, because
 * everything on it is in the system you are in. `facilities` (#275) is the
 * fourth control, and its knowledge dimension has no analogue there either.
 */
export interface FinderFilter {
	query: string;
	/** Economy indices into `ECONOMY_NAMES`. Empty means every economy. */
	economies: readonly number[];
	/** §5.2.1's facility chips, intersecting. Empty means no facility
	 *  narrowing, and the row carries no annotation. */
	facilities: readonly FacilityChip[];
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
	facilities: [],
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
 * **This is what expands the panel**, and it deliberately reads all four
 * controls rather than the query alone. An expand rule keyed to the text field
 * would leave the chips and the budget dead until something was typed — the
 * defect `live-cockpit.ts` records having shipped once already, where a state
 * attribute swallowed every chip click without an error anywhere.
 */
export function finderIsNarrowed(filter: FinderFilter): boolean {
	return (
		filter.query.trim() !== "" ||
		filter.economies.length > 0 ||
		filter.facilities.length > 0 ||
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
	/** §5.2.1's per-role annotation, one entry per active facility chip and
	 *  empty when none is. */
	matchedFacilities: FacilityAnnotation[];
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
	uncheckedFence: number;
}

/**
 * Does one system survive the name and economy narrowing?
 *
 * `normalised` is the trimmed, lower-cased query. It is a parameter because
 * `projectFinder` calls this 256 times per keystroke and normalising inside
 * allocated two throwaway strings per system for a value that is the same on
 * every one of them. Optional so the predicate can still be called on its own —
 * which is what the tests do — and derived from the filter when it is absent.
 */
export function finderMatches(
	system: Pick<SystemRecord, "name" | "economy">,
	filter: FinderFilter,
	normalised = filter.query.trim().toLowerCase(),
): boolean {
	if (filter.economies.length > 0 && !filter.economies.includes(system.economy))
		return false;
	return normalised === "" || system.name.toLowerCase().includes(normalised);
}

/**
 * What one system offers each facility chip, annotated.
 *
 * **Called only when a facility chip is active.** It reads the system's whole
 * station roster, which means generating the system — and with no chip on, that
 * is 256 system generations per keystroke to answer a question nobody asked.
 * §5.2.1 says the row is unchanged with no chip active, so the caller skips it.
 *
 * A system has at most one station per role (`system.ts`), so a role's
 * annotation is unambiguous and §5.2.1's "never collapses mixed carrier
 * conditions" has no case to answer here: each chip annotates its own carrier.
 */
function facilitiesOf(system: SystemRecord, knowledge: FinderKnowledge) {
	const present = new Map<FacilityChip, FacilityAnnotation>();
	let uncheckedFence = false;
	for (const station of generateContents(system).stations) {
		const known: KnowledgeRow | undefined =
			knowledge[carrierKey(system.index, station.localCarrierId)];
		const annotate = (facility: FacilityChip): FacilityAnnotation => ({
			facility,
			role: station.type,
			name: station.name,
			condition: known?.observedCondition ?? null,
			observedAt: known?.observedAt ?? null,
			source: known?.source ?? null,
			...(known?.observedRecovery
				? { observedRecovery: known.observedRecovery }
				: {}),
		});
		if (station.type === "refinery") {
			present.set("REFINERY", annotate("REFINERY"));
			// §5.2.1's three values, from `fenceKnowledge` rather than from a
			// second copy of the rule: a marker plus a generated true is a
			// match, a marker plus a generated false is a *known* non-match —
			// neither a row nor an unchecked refinery — and no marker at all is
			// unchecked.
			const fence = fenceKnowledge(station.blackMarket, known);
			if (fence === "unchecked") uncheckedFence = true;
			else if (fence === "known-fence")
				present.set("KNOWN FENCE", annotate("KNOWN FENCE"));
		}
		if (station.type === "shipyard")
			present.set("SHIPYARD", annotate("SHIPYARD"));
	}
	return { present, uncheckedFence };
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
	matchedFacilities: FacilityAnnotation[],
): FinderRow => ({
	index: system.index,
	name: system.name,
	economy: ECONOMY_NAMES[system.economy],
	government: GOVERNMENT_NAMES[system.government],
	displayTL: system.displayTL,
	jumps: reach?.jumps ?? null,
	routeLy: reach?.ly ?? null,
	distanceLy: distanceLy(from.pos, system.pos),
	matchedFacilities,
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
 * `projectFinder`'s two optional inputs.
 *
 * **An object rather than two more positionals.** `knowledge` arrived behind
 * the optional `maxJump`, so every real caller had to write
 * `projectFinder(systems, here, filter, undefined, knowledge)` — a placeholder
 * the panel carried and fourteen tests repeated, and the shape that keeps
 * growing a fifth and a sixth positional.
 */
export interface ProjectFinderOptions {
	maxJump?: number;
	knowledge?: FinderKnowledge;
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
	{ maxJump = JUMP_RANGE_LY, knowledge = {} }: ProjectFinderOptions = {},
): FinderResults {
	const projection = projectJumps(systems, from, maxJump);
	const normalised = filter.query.trim().toLowerCase();
	const hasQuery = normalised !== "";
	const inBudget: FinderRow[] = [];
	const beyondRange: FinderRow[] = [];
	let uncheckedFence = 0;

	for (const system of systems) {
		if (system.galaxy !== from.galaxy) continue;
		if (!finderMatches(system, filter, normalised)) continue;
		const here = projection.reach(system);
		const inBudgetHere = here !== undefined && here.jumps <= filter.budgetJumps;
		// **Nothing below can produce anything for this system.** Out of budget
		// with no query yields no row in either group, and the unchecked count
		// is gated on the budget too — so without this the default one-jump
		// browse generated ~250 systems' contents per chip toggle and dropped
		// every one. It is the same waste the comment further down names.
		if (!inBudgetHere && !hasQuery) continue;
		let matched: FacilityAnnotation[] = [];
		// **The roster is read only when a chip asks for it.** Generating a
		// system to answer a question no chip posed cost the whole galaxy's
		// contents on every keystroke, and §5.2.1 leaves the unannotated row
		// exactly as §5.2 had it.
		if (filter.facilities.length > 0) {
			const facilities = facilitiesOf(system, knowledge);
			const missing = filter.facilities.filter(
				(facility) => !facilities.present.has(facility),
			);
			if (missing.length > 0) {
				// §5.2.1's count: systems "inside the current name, economy,
				// and jump narrowing" whose fence is unchecked. Scoped to the
				// budget because the first pass counted every unchecked
				// refinery in the galaxy, so the one-jump budget the finder
				// opens on reported a number no narrowing could move. Scoped to
				// *only* the fence missing because checking a fence in a system
				// that fails another chip could never make it a match.
				if (
					inBudgetHere &&
					missing.length === 1 &&
					missing[0] === "KNOWN FENCE" &&
					facilities.uncheckedFence
				)
					uncheckedFence++;
				continue;
			}
			// Built once, and never discarded: the `continue` at the top of the
			// loop has already dropped every system that yields no row. It was
			// a lazy closure before that guard existed, against a chip-only
			// narrowing at the default budget that allocated a row and took a
			// square root for every matching out-of-budget system before
			// dropping it.
			matched = filter.facilities.map(
				(facility) => facilities.present.get(facility) as FacilityAnnotation,
			);
		}
		// **One dispatch, not one per branch.** Which group a row joins is one
		// rule; written twice, a later change to it lands in one arm.
		if (inBudgetHere) inBudget.push(row(system, from, here, matched));
		else beyondRange.push(row(system, from, here, matched));
	}

	inBudget.sort(byReach);
	beyondRange.sort(byReach);
	return { inBudget, beyondRange, uncheckedFence };
}
