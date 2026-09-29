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
	PRICE_DISPLAY_STEP_CR,
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
	marketQuote,
	marketRow,
	type QuoteFn,
	shelfQuantity,
	stockResponse,
} from "./market";
import type { DockPhase } from "./dock-session";
// **Type-only, and it has to stay that way.** `station-commerce.ts` imports
// `stationEquipmentScreen` from here, so a value import back would be a cycle;
// a type import is erased at build and cannot be one. `relief-bands.ts` and
// `pad-bindings.ts` stand the same way, and `tests/headless.test.ts` asserts it.
import type { CommerceRefusal } from "./station-commerce";
import { type GateRefusal, type Rungs, gateRefusal } from "./ladder";

// ---------------------------------------------------------------------------
// §8.1 / §8.4 — what is on the glass, and when
// ---------------------------------------------------------------------------

/** §8's tabs. M3: later station business takes a third, not a second wall. */
export type StationConsoleTab = "Market" | "Equipment" | "Requests";

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
 *
 * **The row carries two prices, because there are two.** §5.6's bid cut means a
 * station's buying price and selling price are different numbers, and #191 D3
 * ruled that the player reads both rather than one price with a hidden
 * commission. The mid `stockResponse` scales is not one of these fields: it is
 * not a price anyone is charged, and a row that carried it beside the two that
 * are would be a third figure for a renderer to reconcile.
 */
export interface ConsoleMarketRow {
	commodity: Commodity;
	/** `listsCommodity`. False rows are M5's **not traded here** block. */
	listed: boolean;
	/** What the commander pays one unit, after §5's stock response. Present iff
	 *  `listed`. §5.6's cut falls on the *bid* alone, so this is the market's own
	 *  figure and M6's arrow describes the column it sits on. */
	buyCr?: number;
	/** Units on the shelf after the deficit. Present iff `listed`. */
	quantity?: number;
	/**
	 * What this station pays the commander for one unit — the buy column less
	 * §5.6's cut. Present iff `listed`.
	 *
	 * **Both columns render through `priceLabel`**, which is #193's obligation
	 * rather than a style note: every base price is a multiple of `PRICE_STEP_CR`
	 * and a responded price is a multiple of nothing, so rounding either to whole
	 * credits prints a lie the till then charges the player against. That defect
	 * survived because every test read the number and none read the string.
	 */
	sellCr?: number;
	/**
	 * **M6:** the signed distance from what this station would otherwise quote
	 * this epoch, measured on the market's own figure — the number the buy column
	 * shows, since the ask is the mid by §5.6's ruling. Present iff the deficit
	 * is non-zero — an absent field is a row the player has never moved, which is
	 * what makes the arrow mean something.
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
	 * The system's tech level, which is what §5.6's cut is a function of.
	 *
	 * **Required and not defaulted**, the way `holdT` on this same input is: a
	 * screen that defaulted it would draw one grade of cut at every station in the
	 * galaxy, and the whole point of the table is that a frontier quote and a core
	 * quote differ. `StationCommerceInput.displayTL` is the same argument at the
	 * till, and the till is the half that has to agree with what this drew.
	 */
	displayTL: number;
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
	quote: QuoteFn = marketQuote,
): readonly ConsoleMarketRow[] {
	const { station, economy, gameTimeMin, deficitOf, holdT, displayTL } = input;
	return COMMODITIES.map((commodity): ConsoleMarketRow => {
		// §8.5.1: the test comes first. Asking for a price so the row can be
		// greyed out throws at every non-fence station in the galaxy.
		if (!listsCommodity(commodity, station))
			return { commodity, listed: false };
		const base = row(commodity, economy, station, gameTimeMin);
		const deficit = deficitOf(commodity.name);
		const midCr = stockResponse(base.priceCr, deficit, holdT);
		// **One call, two columns.** The till calls the same function with the same
		// two arguments, which is the only thing that keeps this screen from being
		// the #193 defect again: a quote the player reads and a figure the till
		// charges, drifting apart.
		const { buyCr, sellCr } = quote(midCr, displayTL);
		const quantity = shelfQuantity(base.quantity, deficit);
		if (deficit === 0)
			return { commodity, listed: true, buyCr, sellCr, quantity };
		return {
			commodity,
			listed: true,
			buyCr,
			sellCr,
			quantity,
			// Against *this* epoch's base, which is what `base` is: it was derived
			// from the station's identity and the clock a line ago rather than
			// remembered from the last visit. And measured on the column it is drawn
			// beside, not on the mid before the quote quantized it — an arrow whose
			// arithmetic starts from a figure the row does not print is a #193 drift
			// with an arrow on it.
			priceDeltaCr: buyCr - base.priceCr,
			quantityDelta: quantity - base.quantity,
		};
	});
}

/** What one market row prints, shared by redraw detection and the renderer. */
export function marketDisplayValues(row: ConsoleMarketRow) {
	return {
		name: row.commodity.name,
		unit: row.commodity.unit,
		listed: row.listed,
		buy: row.listed ? priceLabel(row.buyCr ?? 0) : null,
		sell: row.listed ? priceLabel(row.sellCr ?? 0) : null,
		shelf: row.listed ? `${row.quantity ?? 0} ${row.commodity.unit}` : null,
		priceDelta:
			row.priceDeltaCr === undefined ? null : signedDelta(row.priceDeltaCr, 1),
		quantityDelta:
			row.quantityDelta === undefined
				? null
				: signedDelta(row.quantityDelta, 0),
	};
}

/** A clock tick redraws only when a row's rendered values change. */
export function marketDisplayChanged(
	before: readonly ConsoleMarketRow[],
	after: readonly ConsoleMarketRow[],
): boolean {
	if (before.length !== after.length) return true;
	return before.some(
		(row, index) =>
			JSON.stringify(marketDisplayValues(row)) !==
			JSON.stringify(marketDisplayValues(after[index])),
	);
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
 * How many digits the glass can show, derived from the quote's own step.
 *
 * `PRICE_DISPLAY_STEP_CR` is the finest figure a quote can carry, and this is the
 * finest figure the screen can print. They were two owners of one fact — a `toFixed(1)`
 * here and a constant in `market.ts` — which is the #193 defect class waiting to be
 * reinstated by someone changing one of them: at a hundredth-credit quote the console
 * would print 3.5 while charging 3.51 again, and only a round-trip row would notice.
 */
const PRICE_LABEL_DIGITS = Math.round(-Math.log10(PRICE_DISPLAY_STEP_CR));

/**
 * A quoted price as the player reads it — either column of the market row.
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
 *
 * **The digits are `PRICE_LABEL_DIGITS`, derived from the quote's own step, so the
 * glass and the till cannot be set apart by a change to either.**
 */
export const priceLabel = (priceCr: number): string =>
	`${priceCr.toFixed(PRICE_LABEL_DIGITS)} Cr`;

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
	/**
	 * The ladder gate this row fails, or absent (#183 D6, #562 D7). A locked
	 * row still lists — it names its ladder and rung and draws no BUY, the
	 * #489 locked-row pattern — because a row that vanished below its rung
	 * would tell the pilot nothing about what to climb.
	 */
	locked?: GateRefusal;
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
	/**
	 * The pilot's three rungs. **Required**, for `holdT`'s reason: a caller that
	 * forgot them would sell every gated item, and the two are
	 * indistinguishable in a diff. `TOP_RUNGS` is the explicit open gate.
	 */
	rungs: Rungs;
}): ConsoleEquipmentScreen {
	const { type, displayTL, rungs } = input;
	const gated = (entry: ConsoleEquipmentEntry): ConsoleEquipmentEntry => {
		const locked = gateRefusal(entry.name, rungs);
		return locked ? { ...entry, locked } : entry;
	};
	// The gate itself, not `universalItemsAt(displayTL).length` — that built a
	// throwaway array on every render to read a number this computes.
	const reach = universalReach(displayTL);
	const available: ConsoleEquipmentEntry[] = [];
	const unavailable: ConsoleUnavailableEntry[] = [];

	UNIVERSAL_ITEMS.forEach((item, index) => {
		if (index < reach) available.push(gated(item));
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
		if (item.scope === type) available.push(gated(entry));
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

// ---------------------------------------------------------------------------
// §8 — what the till says when it says no (#443)
// ---------------------------------------------------------------------------

/**
 * The hold figures a refusal is allowed to quote.
 *
 * A plain shape rather than `HoldSummary`, and that is the import direction
 * rather than a preference: `hold.ts` reads `station-commerce.ts`, which reads
 * this module, so a value import of the projection would close a cycle. The
 * caller has the summary and passes the three numbers out of it.
 */
export interface RefusalHold {
	freeT: number;
	capacityT: number;
	entrustedT: number;
}

/**
 * Why the hold is the size it is, when there is a reason worth saying.
 *
 * #443's own case is the whole argument: 11 t sold into a 20 t hull reads as a
 * broken till until the sentence names the 8 t consignment sitting in it.
 */
/**
 * *", with 8 t entrusted to a job"*, or nothing at all.
 *
 * One helper because the refusal and the cockpit's hold line differ only in
 * their joiners, and the rule that a zero consignment is *omitted* rather than
 * printed had come to live in both.
 *
 * **It coerces its own figure.** Every caller interpolates the result into
 * markup, and this sum is over the deserialised request journal; `holdLine`
 * guards its other three figures and this one slipped past for a round.
 */
export const entrustedClause = (
	entrustedT: number,
	lead: string,
	tail = "",
): string =>
	entrustedT > 0 ? `${lead}${Number(entrustedT)} t entrusted${tail}` : "";

/**
 * One sentence per refusal, keyed by the union itself.
 *
 * **A `Record<CommerceRefusal, …>` and not a switch with a default**, which is
 * the check §8 owes: a refusal added to the till without a sentence here fails
 * to compile, where a `default:` arm would have shipped "the station refused"
 * for it and nobody would have noticed. `scopeReason` above makes the same
 * argument with a `never` and is the older half of it.
 *
 * The words are the console's, not the code's. `cargo-full` is the one that
 * carries figures, because it is the one a pilot cannot otherwise work out —
 * the hold is a hull's number, a bay's number and a job's lot, and only two of
 * those three are ever on a screen.
 *
 * **`freeT` may be negative and the sentence says so.** The till buys a tonne
 * per press, so the ordinary way to meet this refusal is at zero free — but
 * `HoldSummary.freeT` is deliberately unfloored, because an over-capacity hold
 * is exactly the state a pilot most needs told. A sentence reading *"No room —
 * -10 t free of 20"* is the projection showing through rather than a formatting
 * fault, and `tests/station-console.test.ts` pins it rather than leaving a
 * claim that it cannot happen.
 */
const REFUSAL_SENTENCES: Record<
	CommerceRefusal,
	(hold: RefusalHold) => string
> = {
	"cargo-full": (hold) =>
		`No room — ${hold.freeT} t free of ${hold.capacityT}${entrustedClause(hold.entrustedT, ", with ", " to a job")}.`,
	"cargo-missing": () => "None of that aboard.",
	"commodity-sell-only": () =>
		"Salvage — this station buys it, never sells it.",
	"commodity-unavailable": () => "Not traded here.",
	"equipment-owned": () => "Already fitted.",
	"equipment-locked": () => "Locked — the row names the rung it needs.",
	"equipment-unavailable": () => "This station does not fit that.",
	"fuel-full": () => "The tank is full.",
	"insufficient-credits": () => "Not enough credits.",
	"insufficient-shelf": () => "The shelf is short.",
	"invalid-quantity": () => "That is not a quantity.",
	"unknown-commodity": () => "No such good.",
};

/** What the glass says about a refusal the till computed and used to drop. */
export const refusalSentence = (
	reason: CommerceRefusal,
	hold: RefusalHold,
): string => REFUSAL_SENTENCES[reason](hold);

/** The union's members at run time, for the row that checks the map is whole. */
export const REFUSAL_REASONS = Object.keys(
	REFUSAL_SENTENCES,
) as readonly CommerceRefusal[];
