import {
	type Loadout,
	type FittedModule,
	parseModule,
	fitted,
	stockLoadout,
	moduleRow,
	legacyModule,
	moduleFits,
	carriedModule,
	fittingValue,
	LEGACY_MODULES,
	transferLoadout,
} from "./loadout";
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
import { HULL_SPECS, type HullId, PURCHASABLE_HULL_IDS } from "./hull";
import type { HullReach } from "./hull-reach";
import {
	FUEL_CR_PER_LY,
	type Commodity,
	type MarketStation,
	type QuoteFn,
	type UniversalItem,
	EQUIPMENT,
	commodity,
	listsCommodity,
	marketQuote,
	marketRow,
	shelfQuantity,
	stockResponse,
} from "./market";
import { type GateRefusal, type Rungs, gateRefusal } from "./ladder";
import {
	type ConsoleEquipmentEntry,
	stationEquipmentScreen,
} from "./station-console";

export interface RecoveredFitting extends Partial<FittedModule> {
	id: string;
	tonnes: number;
}
const recoveredModule = (
	item: RecoveredFitting,
	hull: HullId,
): FittedModule => {
	if (!item.module) return legacyModule(hull, item.id);
	const { id, tonnes, ...module } = item;
	return parseModule(module);
};
export const recoveredTonnes = (commander: CommanderState): number =>
	(commander.recoveredFittings ?? []).reduce(
		(sum, item) => sum + item.tonnes,
		0,
	);

export interface CommanderState {
	credits: number;
	/** Quantities remain in the commodity's native unit. */
	cargo: Readonly<Record<string, number>>;
	loadout: Loadout;
	/** Unfitted salvage items; omitted when empty to preserve older save integrity. */
	recoveredFittings?: readonly RecoveredFitting[];
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
const slotFor = (c: CommanderState, m: FittedModule) =>
	HULL_SPECS[c.hull].slots.find((s) => !c.loadout[s.key] && moduleFits(m, s)) ??
	HULL_SPECS[c.hull].slots.find(
		(s) =>
			s.key === "h1" &&
			c.loadout.h1?.module === "pulse-laser" &&
			["beam-laser", "military-laser", "mining-laser"].includes(m.module) &&
			moduleFits(m, s),
	);
const fitOne = (c: CommanderState, m: FittedModule): CommanderState => {
	const slot = slotFor(c, m);
	if (!slot) throw Error("No compatible free slot");
	const old = c.loadout[slot.key];
	return {
		...c,
		loadout: { ...c.loadout, [slot.key]: m },
		...(old
			? {
					recoveredFittings: [
						...(c.recoveredFittings ?? []),
						carriedModule(old),
					],
				}
			: {}),
	};
};
export const LARGE_CARGO_BAY_BONUS_T = 15;

/** **The hull is required, not defaulted.** Same rule as `FlightPerformance`
 *  and for the same reason: a caller that forgot to name one would silently get
 *  the courier's 20 t hold, and the two are indistinguishable in a diff. */
export const newCommander = (hull: HullId): CommanderState => ({
	credits: STARTING_CREDITS,
	cargo: {},
	loadout: stockLoadout(hull),
	// A full tank of the hull's own `tankLy` (#554), which is Elite's opening
	// position — the courier's full tank is 14 Cr.
	fuelLy: HULL_SPECS[hull].tankLy,
	hull,
});

export type StationAction =
	| { type: "buy-commodity"; commodity: string; quantity?: number }
	| { type: "sell-commodity"; commodity: string; quantity?: number }
	| { type: "buy-equipment"; equipment: string }
	| { type: "fit-recovered"; index: number }
	| { type: "sell-recovered"; index: number }
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
	| { type: "buy-fuel" }
	/**
	 * Buy a hull at a shipyard, trading in the flown one (#556, #583).
	 *
	 * `hullOffer` prices it, and the row the Shipyard tab prints is that same
	 * offer — so the refusal on a row is the refusal a press gets.
	 */
	| { type: "buy-hull"; hull: HullId };

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
	/**
	 * The pilot's three rungs, which the equipment gate reads (#183 D6).
	 * Required for `entrustedT`'s reason; `TOP_RUNGS` is the open gate.
	 */
	rungs: Rungs;
	/**
	 * How far each hull reaches from this system (#185 D3) — `hullReachFrom`
	 * bound to the galaxy and the system the ship is docked in.
	 *
	 * A function rather than the galaxy, so this module stays off the galaxy's
	 * import graph. **Required**, because a caller that forgot it would sell a
	 * hull that can never leave, and no default can know the galaxy.
	 */
	hullReach: (hull: HullId) => HullReach;
	action: StationAction;
}

/** Everything the till reads but the action — what a screen prices rows on. */
export type ConsoleInput = Omit<StationCommerceInput, "action">;

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
	| "equipment-locked"
	| "invalid-quantity"
	| "unknown-commodity"
	| "commodity-unavailable"
	| "commodity-sell-only"
	| "insufficient-shelf"
	| "cargo-full"
	| "cargo-missing"
	| "hull-unavailable"
	| "hull-owned"
	| "hull-locked"
	| "no-reach"
	| "hull-mounts"
	| "hull-hold";

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
			/** A hull purchase's auto-sale (#556 D6), for the ladder to bank;
			 *  absent on every other action. */
			sold?: readonly SoldLot[];
	  }
	| {
			accepted: false;
			reason: CommerceRefusal;
			commander: CommanderState;
			deficits: DeficitMap;
	  };

const rejected = (
	input: Pick<StationCommerceInput, "commander" | "deficits">,
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
	Object.values(commander.loadout).reduce(
		(n, m) => n + (m.module === "cargo-rack" ? moduleRow(m).output.cargoT : 0),
		0,
	);

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
	if (good.unit !== "t") return { accepted: false, tonnes: 0, commander };
	// What fits, in whole tonnes: a canister of a manifest line can hold more
	// than the hold has room for, and the rest stays in it (civilian-combat H11).
	const hold = commanderHold(commander, entrustedT);
	const room = Math.floor(hold.capacityT - hold.usedT);
	const took = Math.max(0, Math.min(tonnes, room));
	if (took <= 0) return { accepted: false, tonnes: 0, commander };
	return {
		accepted: true,
		tonnes: took,
		commander: withCargo(commander, good, took),
	};
}

/** Wreck cargo retains its native quantity. Kg/g goods spend no tonne space;
 * ordinary canisters still use the tonne-only `scoopCargo` rule. */
export function recoverWreckCargo(
	commander: CommanderState,
	commodityName: string,
	amount: number,
	entrustedT: number,
): { accepted: boolean; tonnes: number; commander: CommanderState } {
	const good = commodity(commodityName);
	if (good.unit === "t")
		return scoopCargo(commander, commodityName, amount, entrustedT);
	const took = Math.max(0, amount);
	if (took <= 0) return { accepted: false, tonnes: 0, commander };
	return {
		accepted: true,
		tonnes: took,
		commander: withCargo(commander, good, took),
	};
}

const availableEquipment = (
	input: StationCommerceInput,
): readonly ConsoleEquipmentEntry[] =>
	stationEquipmentScreen({
		type: input.station.type,
		hull: input.commander.hull,
		displayTL: input.displayTL,
		rungs: input.rungs,
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
	if (action.type === "buy-hull") {
		const offer = hullOffer(input, action.hull, quote);
		return offer.accepted
			? {
					accepted: true,
					reason: null,
					commander: offer.commander,
					deficits: offer.deficits,
					sold: offer.sold,
				}
			: rejected(input, offer.reason);
	}
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
	if (action.type === "fit-recovered" || action.type === "sell-recovered") {
		const item = Number.isInteger(action.index)
			? input.commander.recoveredFittings?.[action.index]
			: undefined;
		const entry = item && EQUIPMENT.find((e) => e.name === item.id);
		if (!item || (!entry && !item.module))
			return rejected(input, "equipment-unavailable");
		if (action.type === "fit-recovered") {
			if (!item.module && !LEGACY_MODULES[item.id])
				return rejected(input, "equipment-unavailable");
			if (fitted(input.commander.loadout, item.id))
				return rejected(input, "equipment-owned");
			if (gateRefusal(item.id, input.rungs))
				return rejected(input, "equipment-locked");
			if (
				!slotFor(input.commander, recoveredModule(item, input.commander.hull))
			)
				return rejected(input, "hull-mounts");
		}
		const kept = input.commander.recoveredFittings!.filter(
			(_, i) => i !== action.index,
		);
		const commander = { ...input.commander };
		if (kept.length) commander.recoveredFittings = kept;
		else delete commander.recoveredFittings;
		const next =
			action.type === "fit-recovered"
				? fitOne(commander, recoveredModule(item, commander.hull))
				: {
						...commander,
						credits: commander.credits + fittingValue(item) * 0.9,
					};
		if (
			action.type === "fit-recovered" &&
			commanderHold(next, input.entrustedT).usedT >
				commanderHold(next, input.entrustedT).capacityT
		)
			return rejected(input, "hull-hold");
		return {
			accepted: true,
			reason: null,
			commander: next,
			deficits: input.deficits,
		};
	}
	if (action.type === "buy-equipment") {
		const entry = availableEquipment(input).find(
			(item) => item.name === action.equipment,
		);
		if (!entry || !LEGACY_MODULES[entry.name])
			return rejected(input, "equipment-unavailable");
		// Owned before locked: a gate blocks only new purchases (#183 D9), so an
		// item a v6 commander already fitted is "already fitted", not locked.
		if (fitted(input.commander.loadout, entry.name))
			return rejected(input, "equipment-owned");
		if (entry.locked) return rejected(input, "equipment-locked");
		const module = legacyModule(input.commander.hull, entry.name);
		if (!slotFor(input.commander, module))
			return rejected(input, "hull-mounts");
		const next = fitOne(input.commander, module);
		if (
			commanderHold(next, input.entrustedT).usedT >
			commanderHold(next, input.entrustedT).capacityT
		)
			return rejected(input, "hull-hold");
		if (input.commander.credits < entry.priceCr)
			return rejected(input, "insufficient-credits");
		return {
			accepted: true,
			reason: null,
			commander: {
				...next,
				credits: input.commander.credits - entry.priceCr,
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
	const { base, deficit, holdT, q } = priceAt(input, good, quote);
	// **The two directions are two prices now**, and picking between them here —
	// rather than letting each branch read the figure it wants — is what keeps a
	// sale from being charged the ask by a caller that took the wrong field.
	const priceCr = action.type === "buy-commodity" ? q.buyCr : q.sellCr;
	const shelf = shelfQuantity(base.quantity, deficit);
	if (action.type === "buy-commodity") {
		if (good.sellOnly) return rejected(input, "commodity-sell-only");
		if (shelf < quantity) return rejected(input, "insufficient-shelf");
		if (input.commander.credits < priceCr * quantity)
			return rejected(input, "insufficient-credits");
		if (
			good.unit === "t" &&
			commanderHold(input.commander, input.entrustedT).usedT + quantity >
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
	usedT: heldTonnes(commander.cargo) + recoveredTonnes(commander) + entrustedT,
	capacityT: holdCapacityT(commander),
});

/** Tonnes in one unit of each `CommodityUnit`. */
const TONNES_PER_UNIT = { t: 1, kg: 1e-3, g: 1e-6 } as const;

/**
 * What the ship weighs as flown, tonnes (#865): the hull, its fit and its hold.
 *
 * Outfitting's D4 turns this into handling through #181's law
 * (`flightPerformance`'s third argument). Three things about it:
 *
 * - **The hull is named, not read off the commander.** A hull bought where
 *   no berth fits waits for launch (#556 D10), so the commander owns one hull
 *   and flies another, and the cargo is aboard the one being flown.
 * - **Cargo weighs what it is, which is not what it occupies.** A kilogram
 *   good takes no hold (`heldTonnes`, Elite's rule) but its mass is real, so
 *   this sums by unit rather than reusing `commanderHold`'s `usedT`.
 *   Recovered fittings and entrusted lots are tonnes on both sides.
 * - The fitted mass reads the shared catalogue row for each slot. Carried
 *   fittings occupy and weigh 1 t; the fitted module has its catalogue mass.
 */
export const flownMassT = (
	hull: HullId,
	commander: CommanderState,
	entrustedT: number,
): number => {
	if (!(entrustedT >= 0))
		throw new RangeError(`entrusted tonnes ${entrustedT} is not a mass`);
	const cargoT = Object.entries(commander.cargo).reduce(
		(sum, [name, amount]) =>
			sum + amount * TONNES_PER_UNIT[commodity(name).unit],
		0,
	);
	const fittedT = Object.values(commander.loadout).reduce(
		(n, m) => n + moduleRow(m).massT,
		0,
	);
	return (
		HULL_SPECS[hull].massT +
		fittedT +
		cargoT +
		recoveredTonnes(commander) +
		entrustedT
	);
};

// ---------------------------------------------------------------------------
// The shipyard's hull sale (#556, #583)
// ---------------------------------------------------------------------------

/** #556 D5: the flown hull is taken at nine tenths of its list price, so a
 *  swap and back loses a tenth of each hull and no loop earns. */
export const HULL_TRADE_IN_FRACTION = 0.9;

/** One lot the offer sells to make the cargo fit the new hold (#556 D6). */
export interface SoldLot {
	good: string;
	units: number;
	proceedsCr: number;
}

/**
 * One hull, priced for one commander at one shipyard: the row and the till.
 *
 * On a refusal `commander` and `deficits` are the inputs untouched, as every
 * refusal of the till leaves them; the price fields are still filled where
 * they could be computed, so a refused row can still print its figures.
 */
export type HullOffer = StationCommerceResult & {
	hull: HullId;
	/** The new hull's list price. */
	listCr: number;
	/** What the flown hull fetches, `HULL_TRADE_IN_FRACTION` of its list. */
	tradeInCr: number;
	/** `listCr − tradeInCr`; negative when the shipyard pays the pilot. */
	netCr: number;
	/** How far the hull reaches from here, or `null` when not yet read. */
	reach: HullReach | null;
	/** The ladder gate the row fails, on a `hull-locked` refusal. */
	locked?: GateRefusal;
	/** The lots D6 sells, cheapest bid first, and what they fetch. */
	sold: readonly SoldLot[];
	saleCr: number;
};

/**
 * #556 in one function: the trade-in (D5), the slot transfer (#876), the cargo
 * over the new hold sold through this till (D6), and the refusal order D9
 * rules — lock, reach, fit, credits, first match wins.
 *
 * **D9's damaged-exclusive-slot step is not here**: station damage is unbuilt
 * (`station-damage.md` §4), so there is no condition to read, and a refusal
 * nothing could produce would be a sentence nobody reads.
 *
 * D6's order, by the principal's rulings on #583: legal tonne goods are sold
 * **cheapest bid first**, in whole tonnes, at the flown hull's `holdT` — the
 * price a manual sale at that moment gets. Contraband is always kept (no
 * shipyard has a black market today, `STATION_FENCE_ELIGIBLE`, but the rule
 * does not lean on that), and so is the entrusted lot; if those alone overflow
 * the new hold, the sale is refused.
 */
export function hullOffer(
	input: ConsoleInput,
	hull: HullId,
	quote: QuoteFn = marketQuote,
): HullOffer {
	const { commander } = input;
	const listCr = HULL_SPECS[hull].priceCr ?? 0;
	const tradeInCr = Math.round(
		(HULL_SPECS[commander.hull].priceCr ?? 0) * HULL_TRADE_IN_FRACTION,
	);
	const base = {
		hull,
		listCr,
		tradeInCr,
		netCr: listCr - tradeInCr,
		reach: null as HullReach | null,
		sold: [] as readonly SoldLot[],
		saleCr: 0,
	};
	const priced = HULL_SPECS[hull].priceCr !== null;
	if (
		input.station.type !== "shipyard" ||
		!priced ||
		!(PURCHASABLE_HULL_IDS as readonly HullId[]).includes(hull)
	)
		return { ...rejected(input, "hull-unavailable"), ...base };
	if (hull === commander.hull)
		return { ...rejected(input, "hull-owned"), ...base };
	const locked = gateRefusal(hull, input.rungs);
	if (locked) return { ...rejected(input, "hull-locked"), ...base, locked };
	const reach = input.hullReach(hull);
	if (!reach.ok) return { ...rejected(input, "no-reach"), ...base, reach };
	const reached = { ...base, reach };
	const moved = transferLoadout(commander.loadout, hull);
	const transferred: CommanderState = {
		...commander,
		loadout: moved.loadout,
		recoveredFittings: [
			...(commander.recoveredFittings ?? []),
			...moved.overflow,
		],
	};
	const capacityT = holdCapacityT({ ...transferred, hull });
	let overflowT = Math.ceil(
		commanderHold(transferred, input.entrustedT).usedT - capacityT,
	);
	const sellable = Object.entries(commander.cargo)
		.map(([name, units]) => ({ good: commodity(name), units }))
		// Contraband is never auto-sold (the principal's ruling): legal goods go
		// first, and only if what stays aboard overflows is the sale refused.
		// Every legal good is listed everywhere (`listsCommodity`), so a legal
		// lot always has a bid here.
		.filter(
			({ good, units }) => good.unit === "t" && units > 0 && !good.illegal,
		)
		.map((lot) => ({
			...lot,
			bidCr: priceAt(input, lot.good, quote).q.sellCr,
		}))
		.sort((a, b) => a.bidCr - b.bidCr);
	const sellableT = sellable.reduce((sum, lot) => sum + lot.units, 0);
	if (overflowT > sellableT)
		return { ...rejected(input, "hull-hold"), ...reached };

	let state = { commander, deficits: input.deficits };
	const lots: SoldLot[] = [];
	for (const lot of sellable) {
		if (overflowT <= 0) break;
		const units = Math.min(lot.units, overflowT);
		const out = transactAtStation(
			{
				...input,
				commander: state.commander,
				deficits: state.deficits,
				action: {
					type: "sell-commodity",
					commodity: lot.good.name,
					quantity: units,
				},
			},
			quote,
		);
		// A listed good the commander holds sells; a refusal here is a defect in
		// this function, not a state the pilot can reach.
		if (!out.accepted)
			throw new Error(`auto-sale of ${lot.good.name} refused: ${out.reason}`);
		lots.push({
			good: lot.good.name,
			units,
			proceedsCr: out.commander.credits - state.commander.credits,
		});
		state = { commander: out.commander, deficits: out.deficits };
		overflowT -= units;
	}
	const saleCr = lots.reduce((sum, lot) => sum + lot.proceedsCr, 0);
	const offer = { ...reached, sold: lots, saleCr };
	if (commander.credits + saleCr < offer.netCr)
		return { ...rejected(input, "insufficient-credits"), ...offer };
	return {
		accepted: true,
		reason: null,
		commander: {
			...state.commander,
			loadout: moved.loadout,
			recoveredFittings: transferred.recoveredFittings,
			hull,
			credits: state.commander.credits - offer.netCr,
			// As #554's load clamp does: the tank is the hull's, never topped up.
			fuelLy: Math.min(state.commander.fuelLy, HULL_SPECS[hull].tankLy),
		},
		deficits: state.deficits,
		...offer,
	};
}

/**
 * One good at this console now: its market row, the deficit, the flown hold
 * and both quoted prices. **The one derivation** the till charges from and the
 * hull sale's auto-sale sorts by, so the order lots are sold in cannot drift
 * from the price they are sold at.
 */
const priceAt = (input: ConsoleInput, good: Commodity, quote: QuoteFn) => {
	const base = marketRow(good, input.economy, input.station, input.gameTimeMin);
	const deficit = readDeficit(
		input.deficits,
		input.stationKey,
		good.name,
		input.gameTimeMin,
	);
	const holdT = holdCapacityT(input.commander);
	const q = quote(stockResponse(base.priceCr, deficit, holdT), input.displayTL);
	return { base, deficit, holdT, q };
};

/**
 * The Shipyard tab (#556 D1, D8): one offer per purchasable hull, in roster
 * order, at shipyards only — the tab is absent elsewhere, so a non-shipyard
 * gets no rows rather than seven refusals.
 */
export const shipyardScreen = (input: ConsoleInput): readonly HullOffer[] =>
	input.station.type === "shipyard"
		? PURCHASABLE_HULL_IDS.map((hull) => hullOffer(input, hull))
		: [];
