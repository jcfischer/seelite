/**
 * The atomic boundary between a docked commander and a station market.
 *
 * Rendering supplies actions; `Game` owns applying an accepted result.  This
 * module only calculates a complete next state, so a refusal cannot leave
 * credits, cargo, or the station's deficit half-updated.
 */
import type { CarrierKey } from "./carrier-key";
import { HULL_SPECS, PLAYER_BASELINE_HULL, type HullId } from "./hull";
import {
	type Commodity,
	type DeficitMap,
	type MarketStation,
	type UniversalItem,
	commodity,
	listsCommodity,
	marketRow,
	readDeficit,
	recordTrade,
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

export const newCommander = (
	hull: HullId = PLAYER_BASELINE_HULL,
): CommanderState => ({
	credits: STARTING_CREDITS,
	cargo: {},
	ownedEquipment: [],
	hull,
});

export type StationAction =
	| { type: "buy-commodity"; commodity: string; quantity?: number }
	| { type: "sell-commodity"; commodity: string; quantity?: number }
	| { type: "buy-equipment"; equipment: string };

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
	const priceCr = stockResponse(base.priceCr, deficit);
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
			deficits: recordTrade(
				input.deficits,
				input.stationKey,
				good.name,
				quantity,
				input.gameTimeMin,
			),
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
		deficits: recordTrade(
			input.deficits,
			input.stationKey,
			good.name,
			-quantity,
			input.gameTimeMin,
		),
	};
}

/** Kept exported so UI and headless coverage share the actual capacity rule. */
export const commanderHold = (commander: CommanderState) => ({
	usedT: heldTonnes(commander.cargo),
	capacityT: holdCapacityT(commander),
});
