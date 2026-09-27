/**
 * The atomic boundary between a docked commander and a station market.
 *
 * Rendering supplies actions; `Game` owns applying an accepted result.  This
 * module only calculates a complete next state, so a refusal cannot leave
 * credits, cargo, or the station's deficit half-updated.
 *
 * **It is where §5.6's bid cut is charged.** The screen prints a quote and the
 * till spends one, and both call the same `marketQuote` — the defect this split
 * invites (#193's `0 Cr` Food row) is a screen formatting a figure the till
 * never agreed to, so the two go through one function rather than one rule each.
 */
import type { CarrierKey } from "./carrier-key";
import { type DeficitMap, readDeficit, recordTrade } from "./deficits";
import { HULL_SPECS, type HullId } from "./hull";
import {
	FUEL_CR_PER_LY,
	type Commodity,
	type MarketStation,
	type QuoteFn,
	type UniversalItem,
	commodity,
	listsCommodity,
	marketQuote,
	marketRow,
	shelfQuantity,
	stockResponse,
} from "./market";
import { stationEquipmentScreen } from "./station-console";

export interface CommanderState {
	credits: number;
	/** Quantities remain in the commodity's native unit. */
	cargo: Readonly<Record<string, number>>;
	ownedEquipment: readonly string[];
	/**
	 * The hyperspace tank, light years (#187).
	 *
	 * On the commander beside credits and cargo, because it is bought here and
	 * spent by the ship — the same shape as the drive charge being session
	 * state on the renderer. It is **not** the drive charge: §7 of
	 * `in-system-travel.md` gives cruise its own reserve — the hull's `chargeAu`
	 * — with free refills, and a jump does not touch it. Its capacity is the
	 * hull's `tankLy` (#554), which is also its jump range.
	 */
	fuelLy: number;
	/**
	 * The hull being flown, which is what decides the hold (#181).
	 *
	 * On the commander rather than looked up, for the reason every other input
	 * to this module is: a pure calculator that reached for a renderer's notion
	 * of "the player's ship" would be a second place the roster is read.
	 */
	hull: HullId;
}

export const STARTING_CREDITS = 100;
export const LARGE_CARGO_BAY_BONUS_T = 15;

/** **The hull is required, not defaulted.** Same rule as `FlightPerformance`
 *  and for the same reason: a caller that forgot to name one would silently get
 *  the courier's 20 t hold, and the two are indistinguishable in a diff. */
export const newCommander = (hull: HullId): CommanderState => ({
	credits: STARTING_CREDITS,
	cargo: {},
	ownedEquipment: [],
	// A full tank of the hull's own `tankLy` (#554), which is Elite's opening
	// position — the courier's full tank is 14 Cr.
	fuelLy: HULL_SPECS[hull].tankLy,
	hull,
});

export type StationAction =
	| { type: "buy-commodity"; commodity: string; quantity?: number }
	| { type: "sell-commodity"; commodity: string; quantity?: number }
	| { type: "buy-equipment"; equipment: string }
	/**
	 * Fill the hyperspace tank (#187).
	 *
	 * **No quantity.** §6.1 prices fuel per light year and the tank has one
	 * capacity, so the only decision is how much of the shortfall the
	 * commander can pay for — which is arithmetic, not a choice. A partial fill
	 * is what happens when the credits run out, and it is accepted rather than
	 * refused: a pilot with 3 Cr and an empty tank needs the 1.5 LY those buy
	 * more than they need a refusal.
	 */
	| { type: "buy-fuel" };

export interface StationCommerceInput {
	commander: CommanderState;
	deficits: DeficitMap;
	station: MarketStation;
	stationKey: CarrierKey;
	economy: number;
	gameTimeMin: number;
	displayTL: number;
	/**
	 * Tonnes of entrusted request cargo aboard (`missions-and-requests.md` §4).
	 *
	 * **Required rather than defaulted**, for `holdT`'s reason (#182): the lot
	 * lives in the request journal and never in `CommanderState.cargo`, so a
	 * caller that forgot it would sell a hold the ship does not have — and a
	 * zero is indistinguishable from an omission in a diff. §4 says in as many
	 * words that a display-only deduction is insufficient.
	 */
	entrustedT: number;
	action: StationAction;
}

/**
 * Every way the till says no, as a closed set (#443).
 *
 * They were bare strings on `StationCommerceResult.reason`, computed and then
 * dropped by the caller — `main.ts` did `if (!result.accepted) return;`, so a
 * refusal to sell reached the player as nothing happening. A union rather than
 * `string` is what lets `station-console.ts` own one sentence per member and
 * have the *type* insist the map is complete: a twelfth refusal added here
 * fails to compile there rather than shipping silently.
 *
 * `tests/station-console.test.ts` reads this module's own `rejected(` calls
 * back off the source. **Not because a stray literal could get past `tsc`** —
 * `rejected` takes a `CommerceRefusal`, so it could not, and that half of the
 * scan is redundant with the typechecker. What the scan adds is the *other*
 * direction: a member of the union that nothing here can produce is a sentence
 * nobody will ever read, and no type says so.
 */
export type CommerceRefusal =
	| "fuel-full"
	| "insufficient-credits"
	| "equipment-unavailable"
	| "equipment-owned"
	| "invalid-quantity"
	| "unknown-commodity"
	| "commodity-unavailable"
	| "commodity-sell-only"
	| "insufficient-shelf"
	| "cargo-full"
	| "cargo-missing";

/**
 * One transaction's outcome, **discriminated on `accepted`** (#443).
 *
 * It was `{ accepted: boolean; reason: CommerceRefusal | null }`, where nothing
 * tied the two fields together — so the caller that finally read the reason had
 * to invent a value for the null the type permitted, and the first version of
 * that fallback printed *"That is not a quantity."* over a full hold. A refusal
 * carries a reason and an acceptance carries none, which is what was true all
 * along and is now what the type says.
 */
export type StationCommerceResult =
	| {
			accepted: true;
			reason: null;
			commander: CommanderState;
			deficits: DeficitMap;
	  }
	| {
			accepted: false;
			reason: CommerceRefusal;
			commander: CommanderState;
			deficits: DeficitMap;
	  };

const rejected = (
	input: StationCommerceInput,
	reason: CommerceRefusal,
): StationCommerceResult => ({
	accepted: false as const,
	reason,
	commander: input.commander,
	deficits: input.deficits,
});

const quantityOf = (action: StationAction): number =>
	"quantity" in action ? (action.quantity ?? 1) : 1;

/** The hull's hold plus whatever the commander has bolted into it. **`STARTING_HOLD_T`
 *  is gone** (#181): it was a second copy of the courier's 20 t, and a constant
 *  named for the *start* of a game cannot answer for a hold that changes when a
 *  shipyard sells you a freighter. */
const holdCapacityT = (commander: CommanderState): number =>
	HULL_SPECS[commander.hull].holdT +
	(commander.ownedEquipment.includes("Large Cargo Bay")
		? LARGE_CARGO_BAY_BONUS_T
		: 0);

const heldTonnes = (cargo: Readonly<Record<string, number>>): number =>
	Object.entries(cargo).reduce((sum, [name, amount]) => {
		const good = commodity(name);
		return sum + (good.unit === "t" ? amount : 0);
	}, 0);

const withCargo = (
	commander: CommanderState,
	good: Commodity,
	delta: number,
): CommanderState => {
	const amount = (commander.cargo[good.name] ?? 0) + delta;
	const cargo = { ...commander.cargo };
	if (amount === 0) delete cargo[good.name];
	else cargo[good.name] = amount;
	return { ...commander, cargo };
};

/**
 * Take what fits of a scooped canister into the hold (#324 part d), or refuse
 * it when the hold has no room. Tonne goods only. A raider's canister is a
 * tonne; an ordinary carrier's holds a whole manifest line (civilian-combat H11),
 * so this takes whole tonnes up to the room left and returns how many.
 */
export function scoopCargo(
	commander: CommanderState,
	commodityName: string,
	tonnes: number,
	/** Entrusted tonnes aboard — see `StationCommerceInput.entrustedT`. */
	entrustedT: number,
): { accepted: boolean; tonnes: number; commander: CommanderState } {
	const good = commodity(commodityName);
	// What fits, in whole tonnes: a canister of a manifest line can hold more
	// than the hold has room for, and the rest stays in it (civilian-combat H11).
	const room = Math.floor(
		holdCapacityT(commander) - heldTonnes(commander.cargo) - entrustedT,
	);
	const took = good.unit === "t" ? Math.max(0, Math.min(tonnes, room)) : 0;
	if (took <= 0) return { accepted: false, tonnes: 0, commander };
	return {
		accepted: true,
		tonnes: took,
		commander: withCargo(commander, good, took),
	};
}

const availableEquipment = (
	input: StationCommerceInput,
): readonly UniversalItem[] =>
	stationEquipmentScreen({
		type: input.station.type,
		displayTL: input.displayTL,
	}).available.filter((item) => item.per === "unit");

/**
 * One transaction at one console, priced end to end. Returns either untouched
 * input references or one complete replacement.
 *
 * **`quote` is the second parameter and the game never passes it**, for the same
 * reason `marketRowAt` takes a `ByteClose` and §8.6's screen takes a `MarketRowFn`:
 * the law #7 ratified — no wedge, one price, both directions — was *ratified*, and
 * a rejected arm that cannot be flown is a claim rather than a measurement. The
 * control row in `tests/station-commerce.test.ts` flies this same sweep with
 * `NO_WEDGE` and must still net a profit, or the closure row above it reports the
 * shape of its own instrument.
 */
export function transactAtStation(
	input: StationCommerceInput,
	quote: QuoteFn = marketQuote,
): StationCommerceResult {
	const { action } = input;
	if (action.type === "buy-fuel") {
		// To the flown hull's tank, which is also its range (#185 D1, #554).
		const wanted =
			HULL_SPECS[input.commander.hull].tankLy - input.commander.fuelLy;
		const affordable = input.commander.credits / FUEL_CR_PER_LY;
		// **Neither figure is rounded, and the first version rounded both.** A
		// jump costs the distance flown, which is not a multiple of anything, so
		// flooring the shortfall to the tenth §6.1 *prices* in left a residue the
		// tank could never take back — and the next fill then asked for less than
		// 0.1 LY, got zero, and was refused as a money problem on a full purse.
		// The price is per light year; a fraction of one costs its fraction.
		const ly = Math.min(wanted, affordable);
		// Two refusals rather than one, because they send the player to
		// different places — and each is read off the quantity it is about
		// rather than off the minimum of the two.
		if (wanted <= 0) return rejected(input, "fuel-full");
		if (affordable <= 0) return rejected(input, "insufficient-credits");
		return {
			accepted: true,
			reason: null,
			commander: {
				...input.commander,
				credits: input.commander.credits - ly * FUEL_CR_PER_LY,
				fuelLy: input.commander.fuelLy + ly,
			},
			deficits: input.deficits,
		};
	}
	if (action.type === "buy-equipment") {
		const entry = availableEquipment(input).find(
			(item) => item.name === action.equipment,
		);
		if (!entry) return rejected(input, "equipment-unavailable");
		if (input.commander.ownedEquipment.includes(entry.name))
			return rejected(input, "equipment-owned");
		if (input.commander.credits < entry.priceCr)
			return rejected(input, "insufficient-credits");
		return {
			accepted: true,
			reason: null,
			commander: {
				...input.commander,
				credits: input.commander.credits - entry.priceCr,
				ownedEquipment: [...input.commander.ownedEquipment, entry.name],
			},
			deficits: input.deficits,
		};
	}

	const quantity = quantityOf(action);
	if (!Number.isInteger(quantity) || quantity <= 0)
		return rejected(input, "invalid-quantity");
	let good: Commodity;
	try {
		good = commodity(action.commodity);
	} catch {
		return rejected(input, "unknown-commodity");
	}
	if (!listsCommodity(good, input.station))
		return rejected(input, "commodity-unavailable");
	const base = marketRow(good, input.economy, input.station, input.gameTimeMin);
	const deficit = readDeficit(
		input.deficits,
		input.stationKey,
		good.name,
		input.gameTimeMin,
	);
	const holdT = holdCapacityT(input.commander);
	const midCr = stockResponse(base.priceCr, deficit, holdT);
	// **The two directions are two prices now**, and picking between them here —
	// rather than letting each branch read the figure it wants — is what keeps a
	// sale from being charged the ask by a caller that took the wrong field.
	const q = quote(midCr, input.displayTL);
	const priceCr = action.type === "buy-commodity" ? q.buyCr : q.sellCr;
	const shelf = shelfQuantity(base.quantity, deficit);
	if (action.type === "buy-commodity") {
		if (good.sellOnly) return rejected(input, "commodity-sell-only");
		if (shelf < quantity) return rejected(input, "insufficient-shelf");
		if (input.commander.credits < priceCr * quantity)
			return rejected(input, "insufficient-credits");
		if (
			good.unit === "t" &&
			heldTonnes(input.commander.cargo) + input.entrustedT + quantity >
				holdCapacityT(input.commander)
		)
			return rejected(input, "cargo-full");
		return {
			accepted: true,
			reason: null,
			commander: {
				...withCargo(input.commander, good, quantity),
				credits: input.commander.credits - priceCr * quantity,
			},
			deficits: recordTrade(input.deficits, input.stationKey, {
				goodName: good.name,
				units: quantity,
				gameTimeMin: input.gameTimeMin,
				holdT,
			}),
		};
	}
	if ((input.commander.cargo[good.name] ?? 0) < quantity)
		return rejected(input, "cargo-missing");
	return {
		accepted: true,
		reason: null,
		commander: {
			...withCargo(input.commander, good, -quantity),
			credits: input.commander.credits + priceCr * quantity,
		},
		deficits: recordTrade(input.deficits, input.stationKey, {
			goodName: good.name,
			units: -quantity,
			gameTimeMin: input.gameTimeMin,
			holdT,
		}),
	};
}

/**
 * Kept exported so UI and headless coverage share the actual capacity rule.
 *
 * `entrustedT` is required here too: a readout that showed only ordinary cargo
 * would tell a pilot they have room the till will refuse to sell them.
 */
export const commanderHold = (
	commander: CommanderState,
	entrustedT: number,
) => ({
	usedT: heldTonnes(commander.cargo) + entrustedT,
	capacityT: holdCapacityT(commander),
});
