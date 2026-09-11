/**
 * `hud-and-scanner.md` §8 — the station console's two screens, as data.
 *
 * **Return values, not rendering.** §8.6 puts four of its twelve obligations in
 * the headless tier and each of them is written against this module rather than
 * against the glass, so the gallery and, later, the live cockpit both draw the
 * same rows without a second copy of the rules.
 *
 * The three traps §8.5 names are all here rather than at the call sites:
 *
 * 1. `marketRow` **throws** for a good the station does not sell, and M5 shows
 *    seventeen rows at every station. So the builder tests `listsCommodity`
 *    first and prices only where it holds — §8.6's obligation 3, which is a
 *    check on the *calls* and not on the absence of a throw.
 * 2. `stationCommodities` is the fourteen-row shape M5 reversed. It is not
 *    imported here; `COMMODITIES` is the row list.
 * 3. The tech gate counts **Fuel**, which `EQUIPMENT` does not hold, because
 *    fuel is priced by the light year. `UNIVERSAL_ITEMS` puts it back at the
 *    front, where `economy-trade.md` §7's table has it — a slice taken off
 *    `EQUIPMENT` alone hides Fuel at every tech level *and* sells one item a
 *    level early.
 *
 * No DOM and no Three.js: this is sim-side data for a screen.
 */

import {
	COMMODITIES,
	type Commodity,
	EQUIPMENT,
	type Equipment,
	type MarketRow,
	type MarketStation,
	type StationTypeKey,
	UNIVERSAL_GATE_CAP,
	UNIVERSAL_ITEMS,
	type UniversalItem,
	listsCommodity,
	marketRow,
	shelfQuantity,
	stockResponse,
} from "./market";
import type { DockPhase } from "./dock-session";

// ---------------------------------------------------------------------------
// §8.1 / §8.4 — what is on the glass, and when
// ---------------------------------------------------------------------------

/** §8's tabs. M3: later station business takes a third, not a second wall. */
export type StationConsoleTab = "Market" | "Equipment";

/**
 * Where a dock is, as far as the console is concerned.
 *
 * **Re-exported from `dock-session.ts` rather than declared here.** #70 wrote
 * this type when §12 was unbuilt and the console was the only thing that had an
 * opinion about a dock's phase; #77 built the state machine, which both runs the
 * phases and adds `"launching"` — a state §12.3's table is a claim about and a
 * canopy has no view on. Two spellings of one union is how the console and the
 * sim come to disagree about what a dock is, so there is one, and it lives with
 * the code that transitions it. The predicates below stay here: they are M4 and
 * M10, and those are decisions about the glass.
 */
export type { DockPhase };

/** **M4:** the console fills the canopy once #73's E3 arrival completes, and
 *  not during it. The throat is the arrival's payoff and the console is the
 *  stop's; they are sequential. */
export const stationConsoleVisible = (phase: DockPhase): boolean =>
	phase === "docked";

/**
 * **M10:** the persistent flight floor is hidden while docked.
 *
 * `arriving` is on the hidden side too, and that half is **derived** rather
 * than decided: §5 defines the floor as the minimum that keeps a hull-hidden
 * cockpit flyable, and `docking.md` §12.1's E2 makes the arrival scripted with
 * the controls not live. A floor over a ship nobody is flying is the dead
 * instrument M10 refuses.
 *
 * `launching` joins it on that side by the same derivation, and only that
 * derivation: §12.2 makes the launch traversal scripted too, with the flight
 * controls live "at that same instant, not before" — the instant the ship
 * clears the plane and the phase is `flying` again.
 */
export const flightFloorVisible = (phase: DockPhase): boolean =>
	phase === "flying";

// ---------------------------------------------------------------------------
// §8.2 — the market tab
// ---------------------------------------------------------------------------

/**
 * One row of the market tab — seventeen of these at every station.
 *
 * `listed` is `listsCommodity`, and the four numeric fields are present
 * **exactly** where it is true. §8.6's obligation 2 is that biconditional, and
 * it is written that way rather than as the constant fourteen so a station type
 * that later drops a legal good fails on the rule instead of on a count.
 */
export interface ConsoleMarketRow {
	commodity: Commodity;
	/** `listsCommodity`. False rows are M5's **not traded here** block. */
	listed: boolean;
	/** Credits per unit *after* §5's stock response. Present iff `listed`. */
	priceCr?: number;
	/** Units on the shelf after the deficit. Present iff `listed`. */
	quantity?: number;
	/**
	 * **M6:** the signed distance from what this station would otherwise quote
	 * this epoch. Present iff the deficit is non-zero — an absent field is a row
	 * the player has never moved, which is what makes the arrow mean something.
	 *
	 * **It can be `0`, and so can the shelf delta beside it.** §3's floor pins
	 * the cheapest rows at `PRICE_STEP_CR` and applies to the responded price
	 * too, so a moved row there shows no price movement; and `shelfQuantity`
	 * clamps at zero, so a shelf the player has already emptied shows no further
	 * movement either. Both are the mechanism showing rather than an effect
	 * going missing — which is why the field's presence is keyed on the
	 * *deficit* and not on the size of what it moved. An earlier version of this
	 * paragraph said the shelf delta is "still non-zero", which the clamp makes
	 * false.
	 */
	priceDeltaCr?: number;
	/** The same, in units on the shelf. Present iff the deficit is non-zero. */
	quantityDelta?: number;
}

/** What `stationMarketScreen` prices a row with. Injectable **only** so §8.6's
 *  obligation 3 can read the calls rather than infer them from an absent
 *  throw; the game never passes anything but the default. */
export type MarketRowFn = (
	commodity: Commodity,
	economy: number,
	station: MarketStation,
	gameTimeMin: number,
) => MarketRow;

export interface StationMarketScreenInput {
	station: MarketStation;
	/** The system's economy, 0…7. */
	economy: number;
	/** #6's clock, in game minutes. */
	gameTimeMin: number;
	/**
	 * §5.2's signed units for one good at this station, already decayed.
	 *
	 * A reader rather than the map itself, because the screen does not care how
	 * the mark is stored — and #67 is moving that storage out of `market.ts`.
	 * Binding one to a saved `DeficitMap` is the live cockpit's job; this node
	 * ships no such caller, so it declares no such helper.
	 */
	deficitOf: (goodName: string) => number;
	/**
	 * The flown hull's hold, tonnes — what §5.2's response saturates against
	 * (#182).
	 *
	 * On the input rather than looked up, for the reason `CommanderState.hull`
	 * is: a pure screen that reached for a renderer's notion of "the player's
	 * ship" would be a second place the roster is read. Required and not
	 * defaulted, so a caller that forgot cannot silently draw the courier's
	 * prices for a freighter.
	 */
	holdT: number;
}

/**
 * **M5:** all seventeen commodity rows, in table order, at every station.
 *
 * Iterates `COMMODITIES` and not `stationCommodities` — §8.5.2. The three
 * illegal goods appear everywhere; away from a fence they carry no price, which
 * is the **not traded here** block the tab renders them in.
 */
export function stationMarketScreen(
	input: StationMarketScreenInput,
	row: MarketRowFn = marketRow,
): readonly ConsoleMarketRow[] {
	const { station, economy, gameTimeMin, deficitOf, holdT } = input;
	return COMMODITIES.map((commodity): ConsoleMarketRow => {
		// §8.5.1: the test comes first. Asking for a price so the row can be
		// greyed out throws at every non-fence station in the galaxy.
		if (!listsCommodity(commodity, station))
			return { commodity, listed: false };
		const base = row(commodity, economy, station, gameTimeMin);
		const deficit = deficitOf(commodity.name);
		const priceCr = stockResponse(base.priceCr, deficit, holdT);
		const quantity = shelfQuantity(base.quantity, deficit);
		if (deficit === 0) return { commodity, listed: true, priceCr, quantity };
		return {
			commodity,
			listed: true,
			priceCr,
			quantity,
			// Against *this* epoch's base, which is what `base` is: it was derived
			// from the station's identity and the clock a line ago rather than
			// remembered from the last visit.
			priceDeltaCr: priceCr - base.priceCr,
			quantityDelta: quantity - base.quantity,
		};
	});
}

/**
 * **M6's arrow**, and the rule that a delta which rounds to zero gets none.
 *
 * Here rather than in whichever screen draws it, for the reason this module's
 * header gives: the gallery and, later, the live cockpit draw the same rows
 * without a second copy of the rules, and this *is* one of the rules — §3's
 * floor pins the cheapest rows at `PRICE_STEP_CR` and applies to the responded
 * price too, so a moved row there shows `0.0`, and an up arrow beside it would
 * report a rise the player did not cause. `shelfQuantity`'s clamp does the same
 * to an already-empty shelf.
 */
/**
 * A shelf price as the player reads it.
 *
 * **One decimal, and that is not a style choice.** `PRICE_STEP_CR` is 0.4 and a
 * base price is `closedPrice × PRICE_STEP_CR + offset × gradient ×
 * PRICE_STEP_CR`, so every base price is a *multiple of 0.4* and no whole
 * number represents one exactly. A responded price is not a multiple of
 * anything — `stockResponse` scales by `1 + elasticity × clamp(...)` — so it
 * needs the decimal for a second reason.
 *
 * It exists because `live-cockpit.ts` rendered this with `Math.round`, and the
 * principal found the result in playtest: a refinery listing Food at **`0 Cr`**
 * while `station-commerce.ts` charged the unrounded 0.4. The floor is reachable
 * at a whole station role rather than at an edge — it is enforced twice, by
 * `marketRowAt` and again by `stockResponse`, so nothing on any shelf is
 * cheaper, and a refinery is industrial where Food's gradient is positive.
 *
 * **Here rather than in the renderer** for the reason `signedDelta` below is:
 * this is one of §3's rules, both screens draw it, and the defect survived
 * because every test read `priceCr` and none read the string. A formatter in a
 * module that needs a DOM is a formatter no headless tier can hold.
 */
export const priceLabel = (priceCr: number): string =>
	`${priceCr.toFixed(1)} Cr`;

export const signedDelta = (value: number, digits: number): string => {
	const magnitude = Math.abs(value).toFixed(digits);
	if (Number(magnitude) !== 0) return `${value > 0 ? "↑" : "↓"}${magnitude}`;
	return `·${magnitude}`;
};

// ---------------------------------------------------------------------------
// §8.3 — the equipment tab
// ---------------------------------------------------------------------------

/**
 * One catalogue line, universal or type-exclusive.
 *
 * Its own shape rather than `= UniversalItem`, which is what it was: the alias
 * said *universal* about the refinery and shipyard rows that also flow through
 * it. `UniversalItem` is assignable to this, which is the direction the two
 * actually stand in.
 */
export interface ConsoleEquipmentEntry {
	name: string;
	priceCr: number;
	per: UniversalItem["per"];
}

/** An item the station does not sell, with M8's stated reason. */
export interface ConsoleUnavailableEntry {
	name: string;
	reason: string;
}

export interface ConsoleEquipmentScreen {
	available: readonly ConsoleEquipmentEntry[];
	/** M8's **unavailable here** block — the same absence rule as M5's. */
	unavailable: readonly ConsoleUnavailableEntry[];
	/** §8.3: a heading with nothing under it until #26 prices hulls. */
	hulls: readonly ConsoleEquipmentEntry[];
	/** Whether the hull heading is drawn at all — shipyards only. */
	hullsSection: boolean;
}

/**
 * `station-types.md` §4.1's gate is `min(displayTL + 3, 10)`, and this is the
 * `+ 3`.
 *
 * Named rather than written twice, because the gate and its inverse below both
 * carry it and a change to one that missed the other would shift the whole
 * catalogue by a tech level with no test naming the number.
 */
export const UNIVERSAL_TL_BONUS = 3;

/**
 * The lowest `displayTL` at which the item at `index` in `UNIVERSAL_ITEMS` is
 * on a shelf — the inverse of `min(displayTL + UNIVERSAL_TL_BONUS, 10)`.
 *
 * Exported because M8's reason string is this number, and a reason the player
 * can act on is the whole of what makes a short list read as the exploration
 * incentive rather than as an error state.
 */
export const requiredDisplayTL = (index: number): number =>
	Math.max(0, index - UNIVERSAL_TL_BONUS + 1);

/** `station-types.md` §4.1's gate, over §7's order rather than over
 *  `EQUIPMENT`'s nine. */
export const universalItemsAt = (displayTL: number): readonly UniversalItem[] =>
	UNIVERSAL_ITEMS.slice(0, universalReach(displayTL));

/** How many of `UNIVERSAL_ITEMS` a station at this tech level shelves. */
export const universalReach = (displayTL: number): number =>
	Math.min(Math.max(0, displayTL) + UNIVERSAL_TL_BONUS, UNIVERSAL_GATE_CAP);

/**
 * **M8:** the full catalogue, with every unavailable item shown and its reason
 * stated.
 *
 * The universal items come first in §7's order, then the type exclusives. An
 * item is unavailable for exactly one of three reasons — the tech gate, or the
 * two type scopes — and each is named in the words §8.3 uses.
 */
/**
 * M8's reason for a type exclusive, in §8.3's words.
 *
 * Exhaustive rather than `refinery ? … : "shipyards"`: a third scope added to
 * `EQUIPMENT` would have been labelled "shipyards only" and shipped, where this
 * fails to compile.
 */
const scopeReason = (
	scope: Exclude<Equipment["scope"], "universal">,
): string => {
	switch (scope) {
		case "refinery":
			return "refineries only";
		case "shipyard":
			return "shipyards only";
		default: {
			const unreachable: never = scope;
			throw new Error(`no reason string for scope ${unreachable}`);
		}
	}
};

export function stationEquipmentScreen(input: {
	type: StationTypeKey;
	displayTL: number;
}): ConsoleEquipmentScreen {
	const { type, displayTL } = input;
	// The gate itself, not `universalItemsAt(displayTL).length` — that built a
	// throwaway array on every render to read a number this computes.
	const reach = universalReach(displayTL);
	const available: ConsoleEquipmentEntry[] = [];
	const unavailable: ConsoleUnavailableEntry[] = [];

	UNIVERSAL_ITEMS.forEach((item, index) => {
		if (index < reach) available.push(item);
		else
			unavailable.push({
				name: item.name,
				reason: `requires TL ${requiredDisplayTL(index)}`,
			});
	});

	for (const item of EQUIPMENT) {
		if (item.scope === "universal") continue;
		const entry: ConsoleEquipmentEntry = {
			name: item.name,
			priceCr: item.priceCr,
			per: "unit",
		};
		if (item.scope === type) available.push(entry);
		else unavailable.push({ name: item.name, reason: scopeReason(item.scope) });
	}

	return {
		available,
		unavailable,
		// §8.3 and §8.7's joint 4: the heading is a state the gallery renders and
		// a player sees, and it stays empty until #26 prices hulls.
		hulls: [],
		hullsSection: type === "shipyard",
	};
}
