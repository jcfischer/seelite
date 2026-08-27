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

import { ARRIVAL_SECONDS_MAX, ARRIVAL_SECONDS_MIN } from "./docking";
import {
	COMMODITIES,
	type Commodity,
	EQUIPMENT,
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

// The two are re-exported rather than re-declared: this module is where a
// screen reaches for them, and `docking.ts` and `market.ts` are where they are
// decided. Sage's round 1 found both sitting here, which put a docking constant
// and the corrected §7 catalogue in a screen.
export { ARRIVAL_SECONDS_MAX, ARRIVAL_SECONDS_MIN };
export { UNIVERSAL_GATE_CAP, UNIVERSAL_ITEMS, type UniversalItem };

// ---------------------------------------------------------------------------
// §8.1 / §8.4 — what is on the glass, and when
// ---------------------------------------------------------------------------

/** §8's tabs. M3: later station business takes a third, not a second wall. */
export type StationConsoleTab = "Market" | "Equipment";

/**
 * Where a dock is, as far as the console is concerned.
 *
 * `docking.md` §12 owns the motion and #77 builds it; this type is only the
 * part M4 and M10 are decisions about, which is what the canopy shows. The two
 * predicates below are the whole of those decisions, so the negatives §8.6's
 * obligations 11 and 12 exist to protect are laws rather than layout.
 */
export type DockPhase = "flying" | "arriving" | "docked";

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
	 * It can be `0` on a row §3's floor pins at `PRICE_STEP_CR`, because the
	 * floor applies to the responded price too. That is the floor showing, not a
	 * missing effect: the shelf delta beside it is still non-zero.
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
	const { station, economy, gameTimeMin, deficitOf } = input;
	return COMMODITIES.map((commodity): ConsoleMarketRow => {
		// §8.5.1: the test comes first. Asking for a price so the row can be
		// greyed out throws at every non-fence station in the galaxy.
		if (!listsCommodity(commodity, station))
			return { commodity, listed: false };
		const base = row(commodity, economy, station, gameTimeMin);
		const deficit = deficitOf(commodity.name);
		const priceCr = stockResponse(base.priceCr, deficit);
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

// ---------------------------------------------------------------------------
// §8.3 — the equipment tab
// ---------------------------------------------------------------------------

/** One catalogue line. `market.ts` owns the universal ten; a type exclusive is
 *  narrowed to the same shape here so both halves of the tab are one list. */
export type ConsoleEquipmentEntry = UniversalItem;

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
 * The lowest `displayTL` at which the item at `index` in `UNIVERSAL_ITEMS` is
 * on a shelf — the inverse of `min(displayTL + 3, 10)`.
 *
 * Exported because M8's reason string is this number, and a reason the player
 * can act on is the whole of what makes a short list read as the exploration
 * incentive rather than as an error state.
 */
export const requiredDisplayTL = (index: number): number =>
	Math.max(0, index - 2);

/** `station-types.md` §4.1's gate, over §7's order rather than over
 *  `EQUIPMENT`'s nine. */
export const universalItemsAt = (displayTL: number): readonly UniversalItem[] =>
	UNIVERSAL_ITEMS.slice(
		0,
		Math.min(Math.max(0, displayTL) + 3, UNIVERSAL_GATE_CAP),
	);

/**
 * **M8:** the full catalogue, with every unavailable item shown and its reason
 * stated.
 *
 * The universal items come first in §7's order, then the type exclusives. An
 * item is unavailable for exactly one of three reasons — the tech gate, or the
 * two type scopes — and each is named in the words §8.3 uses.
 */
export function stationEquipmentScreen(input: {
	type: StationTypeKey;
	displayTL: number;
}): ConsoleEquipmentScreen {
	const { type, displayTL } = input;
	const reach = universalItemsAt(displayTL).length;
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
		else
			unavailable.push({
				name: item.name,
				reason: `${item.scope === "refinery" ? "refineries" : "shipyards"} only`,
			});
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
