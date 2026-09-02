/**
 * The atomic boundary between a docked commander and a station market.
 *
 * Rendering supplies actions; `Game` owns applying an accepted result.  This
 * module only calculates a complete next state, so a refusal cannot leave
 * credits, cargo, or the station's deficit half-updated.
 */
import type { CarrierKey } from "./carrier-key";
import { type DeficitMap, readDeficit, recordTrade } from "./deficits";
import { HULL_SPECS, type HullId } from "./hull";
import { JUMP_TANK_LY } from "./hyperspace";
import {
	FUEL_CR_PER_LY,
	type Commodity,
	type MarketStation,
	type UniversalItem,
	commodity,
	listsCommodity,
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
	 * `in-system-travel.md` gives cruise its own 12 AU reserve with free
	 * refills, and a jump does not touch it.
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
	// A full tank, which is Elite's own opening position and the only one a
	// hundred credits can afford to be given (a full tank is 14 Cr).
	fuelLy: JUMP_TANK_LY,
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
	action: StationAction;
}

export interface StationCommerceResult {
	accepted: boolean;
	reason: string | null;
	commander: CommanderState;
	deficits: DeficitMap;
}

const rejected = (
	input: StationCommerceInput,
	reason: string,
): StationCommerceResult => ({
	accepted: false,
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

const availableEquipment = (
	input: StationCommerceInput,
): readonly UniversalItem[] =>
	stationEquipmentScreen({
		type: input.station.type,
		displayTL: input.displayTL,
	}).available.filter((item) => item.per === "unit");

/** Returns either untouched input references or one complete replacement. */
export function transactAtStation(
	input: StationCommerceInput,
): StationCommerceResult {
	const { action } = input;
	if (action.type === "buy-fuel") {
		const wanted = JUMP_TANK_LY - input.commander.fuelLy;
		// Rounded to the tenth of a light year §6.1 prices in, so the tank never
		// holds a fraction of a unit nobody could have bought and the charge is
		// always a whole number of 0.2 Cr steps.
		const affordable =
			Math.floor((input.commander.credits / FUEL_CR_PER_LY) * 10) / 10;
		const ly = Math.min(Math.floor(wanted * 10) / 10, affordable);
		// Two refusals rather than one, because they send the player to
		// different places: a full tank is not a money problem.
		if (wanted <= 0) return rejected(input, "fuel-full");
		if (ly <= 0) return rejected(input, "insufficient-credits");
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
	const priceCr = stockResponse(base.priceCr, deficit, holdT);
	const shelf = shelfQuantity(base.quantity, deficit);
	if (action.type === "buy-commodity") {
		if (good.sellOnly) return rejected(input, "commodity-sell-only");
		if (shelf < quantity) return rejected(input, "insufficient-shelf");
		if (input.commander.credits < priceCr * quantity)
			return rejected(input, "insufficient-credits");
		if (
			good.unit === "t" &&
			heldTonnes(input.commander.cargo) + quantity >
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

/** Kept exported so UI and headless coverage share the actual capacity rule. */
export const commanderHold = (commander: CommanderState) => ({
	usedT: heldTonnes(commander.cargo),
	capacityT: holdCapacityT(commander),
});
