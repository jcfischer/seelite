/**
 * The round trip at one console, flown through the shipped calculator.
 *
 * **Why this is a helper and not a row in one file.** Three places ask the same
 * question — `tests/station-commerce.test.ts` closes §12's weak joint 12, and
 * `scripts/measure-greedy-trader.ts` prints the figure the spec quotes — and a
 * second implementation of "sell a hold, buy it back" in the instrument is how
 * §10.3's "the rule lived only in the instrument" failure happens again one
 * layer down. The game's own `transactAtStation` is the only thing here that
 * decides a price, which is the point: §12.12's pump was verified through it and
 * not through arithmetic, because a harness that recomputes a price tests a
 * different object from the one the player trades against.
 *
 * **A refused leg throws.** A cycle that quietly fails its shelf check nets
 * zero, and zero is the figure this harness exists to detect. An instrument that
 * reports the closure it was asked for whether or not the trade happened is the
 * worst kind: its number gets transcribed into a spec.
 */
import type { CarrierKey } from "../../src/carrier-key";
import { carrierKey } from "../../src/carrier-key";
import type { DeficitMap } from "../../src/deficits";
import {
	type Commodity,
	COMMODITIES,
	PRICE_STEP_CR,
	type QuoteFn,
	type StationTypeKey,
	marketQuote,
	marketStationOf,
	marketRow,
	shelfQuantity,
} from "../../src/market";
import { DOCKABLE_HULL_IDS, type HullId, HULL_SPECS } from "../../src/hull";
import {
	type CommanderState,
	newCommander,
	transactAtStation,
} from "../../src/station-commerce";

/** One console, one station type, built once — the market's seed is a function
 *  of the carrier id, so a fresh one per row would be a different station. */
const STATION_SEED = 0x51a7_10;

const stationOf = (type: StationTypeKey) =>
	marketStationOf(
		{ type, localCarrierId: `pump-${type}`, blackMarket: true },
		STATION_SEED,
	);

/** What the shelf offers at an untouched market. One function, because the
 *  sweep that *builds* a row and the flight that *flies* it have to agree on
 *  how many units a buy leg can hold — two copies would drift into a sweep that
 *  visits rows its flights then refuse. */
export const shelfOf = (
	good: Commodity,
	type: StationTypeKey,
	economy: number,
	gameTimeMin: number,
): number =>
	shelfQuantity(
		marketRow(good, economy, stationOf(type), gameTimeMin).quantity,
		0,
	);

/**
 * #7's ratified law, kept runnable — the way `BELL_WRAP` keeps Bell's byte
 * close and `fixedReferenceResponse` keeps the rejected deficit divisor.
 *
 * **This is the control arm, and the pump row is only evidence with it.** A
 * sweep that reports "no cycle nets anything" proves nothing unless the same
 * sweep reports a profit on the build it replaced; #241's same-build control and
 * #25's "could the losing arm have been given what the winning arm had" are the
 * same discipline from two directions.
 */
export const NO_WEDGE: QuoteFn = (midCr) => ({ buyCr: midCr, sellCr: midCr });

/** The two orders a round trip can be arranged in. They are not equivalent:
 *  the mark caps at the same multiple of the hold either way, but the price the
 *  second leg is quoted at differs by that mark, so one order needs a deeper cut
 *  to close than the other and only measuring says which. */
export type CycleArm = "sell-first" | "buy-first";

export interface ConsoleCycle {
	good: Commodity;
	hull: HullId;
	economy: number;
	type: StationTypeKey;
	displayTL: number;
	arm: CycleArm;
	/** Game minutes at which both legs are quoted. Held fixed within a cycle,
	 *  because a fading mark is the arm that *helps* the pumper: the leg being
	 *  measured against is the one the player would rather not wait for. */
	gameTimeMin: number;
}

export interface CycleOutcome {
	/** Credits the commander ends with, less what it started with. Cargo is
	 *  back where it began by construction, so this is the cycle's profit. */
	netCr: number;
	/** Units on each leg, and the mid the first leg was quoted against — so a
	 *  printed net can be read as a yield rather than as a bare number. */
	units: number;
	midCr: number;
}

/**
 * Fly one cycle of `cycle`'s shape and return what it netted.
 *
 * **How many units, and why not always a full hold.** A tonne good is limited
 * by the hold; a sub-tonne good is limited by Bell's 63 units whatever the hull
 * (research §2.2), which is exactly the asymmetry that makes the metals the
 * binding row at a small hold. Buying is additionally limited by the shelf —
 * §1's pipeline refuses a buy the shelf cannot fill — so `buy-first` takes the
 * smaller of the two rather than throwing, and `sell-first` needs no shelf at
 * all, which is why it is the deeper pump of the two.
 */
export function flyConsoleCycle(
	cycle: ConsoleCycle,
	quote: QuoteFn = marketQuote,
): CycleOutcome {
	const { good, hull, economy, type, displayTL, arm, gameTimeMin } = cycle;
	const holdT = HULL_SPECS[hull].holdT;
	const station = stationOf(type);
	const stationKey: CarrierKey = carrierKey(0, `pump-${type}`);
	const limit = good.unit === "t" ? holdT : 63;
	const shelf = shelfOf(good, type, economy, gameTimeMin);
	const units = arm === "buy-first" ? Math.min(limit, shelf) : limit;
	if (units <= 0)
		throw new Error(
			`cycle for ${good.name} at a ${type} has nothing to trade: ${units}`,
		);

	// A hold bought elsewhere and carried in is the situation §12.12 measured,
	// and seeding it is the honest form: the cycle's profit is the two legs'
	// quotation, not the price of the cargo, which the player has already paid.
	// Enough capital that no leg is refused for want of it — a cash constraint
	// would be a different finding, reported elsewhere.
	let commander: CommanderState = {
		...newCommander(hull),
		credits: 1_000_000,
		cargo: arm === "sell-first" ? { [good.name]: units } : {},
	};
	let deficits: DeficitMap = {};
	const startCr = commander.credits;

	const side = (kind: "buy" | "sell"): void => {
		const out = transactAtStation(
			{
				commander,
				deficits,
				station,
				stationKey,
				economy,
				gameTimeMin,
				displayTL,
				action: {
					type: kind === "buy" ? "buy-commodity" : "sell-commodity",
					commodity: good.name,
					quantity: units,
				},
			},
			quote,
		);
		if (!out.accepted)
			throw new Error(
				`cycle leg refused (${out.reason}) — a refused leg nets zero ` +
					`and zero is what this harness is looking for: ${good.name} ` +
					`${units} ${arm} at ${type}/e${economy}/TL${displayTL}`,
			);
		commander = out.commander;
		deficits = out.deficits;
	};

	const first = arm === "sell-first" ? "sell" : "buy";
	const second = arm === "sell-first" ? "buy" : "sell";
	side(first);
	side(second);
	const midCr = marketRow(good, economy, station, gameTimeMin).priceCr;
	return {
		netCr: commander.credits - startCr,
		units,
		midCr,
	};
}

/** Every hull, good, station type and economy the game can put a commander in
 *  front of, in both orders. `displayTLs` defaults to the whole table. */
export function forEachConsoleCycle(
	visit: (cycle: ConsoleCycle) => void,
	opts: { displayTLs?: readonly number[]; economies?: readonly number[] } = {},
): void {
	const economies = opts.economies ?? ALL_EIGHT;
	const tls = opts.displayTLs ?? ALL_TL;
	for (const hull of DOCKABLE_HULL_IDS)
		for (const good of COMMODITIES) {
			if (good.sellOnly) continue;
			for (const type of TYPES)
				for (const economy of economies)
					for (const displayTL of tls)
						for (const arm of ["sell-first", "buy-first"] as const) {
							// A buy leg needs a shelf, and §1's pipeline refuses a buy
							// the shelf cannot fill — so the row does not exist, exactly as
							// `forEachLegalPair` skips a buy side with no stock. A *sale*
							// needs no shelf, which is why `sell-first` keeps every row and
							// is the deeper pump of the two orders.
							if (arm === "buy-first" && shelfOf(good, type, economy, 0) <= 0)
								continue;
							visit({
								good,
								hull,
								economy,
								type,
								displayTL,
								arm,
								gameTimeMin: 0,
							});
						}
		}
}

const TYPES: readonly StationTypeKey[] = ["trade", "refinery", "shipyard"];
const ALL_EIGHT: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7];
const ALL_TL: readonly number[] = Array.from({ length: 15 }, (_, i) => i + 1);

/**
 * What a cycle has to net to count as a profit.
 *
 * The credits are floats that have been through a hash and a `recordTrade`, and
 * a floored row's cycle — sell 0.4 Cr a tonne, buy it back at 0.4 Cr a tonne —
 * lands on 1e-11 rather than on zero. Calling that a profit would be reading a
 * rounding artefact as an economy, and calling it nothing is the honest call.
 */
export const CYCLE_EPSILON_CR = 1e-9;

export interface CycleSurvey {
	/** The most profitable cycle the sweep flew, and the row that produced it, so
	 *  a printed figure names its subject. */
	worst: WorstCycle;
	/** How many cycles the sweep actually flew. Asserted rather than assumed:
	 *  prose that quotes a corpus size needs the size to be a measurement, and a
	 *  sweep whose domain silently shrank reports a smaller worst-case rather than
	 *  an error. */
	rows: number;
	/** Cycles that net a credit. This is the figure §196's floor was written
	 *  against, and it is a count rather than a maximum because "smaller than
	 *  before" is the failure #196 named. */
	positiveRows: number;
	/** Cycles that net nothing at all. They are not a failure — but each one is a
	 *  place where the market's arithmetic cancelled instead of charging, so the
	 *  survey reports what they are rather than leaving them inside a zero. */
	zeroRows: number;
	/** Of those, the ones that are *not* a row §3's floor pins at one price step.
	 *  **Every one of them is a boundary rather than a bug**: the row where the cut
	 *  and the mark happen to cancel at that one tech level, with a profit on one
	 *  side of it and a loss on the other. `firstZeroOffTheFloor` carries the row so
	 *  a test can walk to the neighbouring tech levels and check that, rather than
	 *  leaving the count to be read as an unexplained zero. */
	zeroRowsOffTheFloor: number;
	/** The first zero off §3's floor, if any. */
	firstZeroOffTheFloor: WorstCycle | null;
	/** **True when every zero off §3's floor is a sub-tonne row.** A *tonnage* row
	 *  off the floor must be strictly negative: there the mark cannot reach the cut,
	 *  so a zero would mean the closure had stopped holding. */
	zeroRowsOffTheFloorAllSubTonnes: boolean;
	/** **The split that decides what the shipped floor actually closes.**
	 *  `tonnage` counts cycles in goods whose units *are* tonnes, where a trade
	 *  cannot move the deficit by more than the hold it was made in; `subTonnes`
	 *  counts the metals, where Bell's 63 units is a fraction of a tonne of cargo
	 *  and one purchase saturates a small hull. The floor is derived against the
	 *  first group and does not reach the second — a single `positiveRows` figure
	 *  would hide which law broke when either moved. */
	positiveByTonnage: { tonnage: number; subTonnes: number };
	/** The most profitable cycle among the sub-tonne rows: the residue #182's
	 *  weak joint 14 leaves behind, with the row that produces it. `null` when the
	 *  sweep's domain contains no metals, which is the only way this figure is
	 *  legitimately absent. */
	bestSubTonnes: WorstCycle | null;
}

export interface WorstCycle extends CycleOutcome {
	cycle: ConsoleCycle;
}

/**
 * Fly every cycle the game can put a commander in front of, and count what nets.
 *
 * **The whole domain, not a sample.** §12.12's pump was found by a hold sweep,
 * and a distribution is sized by its rarest binding bucket rather than by its
 * total (the map's #28): the binding row is a sub-tonne good in the *smallest*
 * hulls, a thin slice of the corpus and the only slice that decides the answer.
 */
export function surveyConsoleCycles(
	quote: QuoteFn = marketQuote,
	opts: { displayTLs?: readonly number[]; economies?: readonly number[] } = {},
): CycleSurvey {
	let rows = 0;
	let positiveRows = 0;
	let zeroRows = 0;
	let zeroRowsOffTheFloor = 0;
	let tonnage = 0;
	let subTonnes = 0;
	let worst: WorstCycle | null = null;
	let bestSubTonnes: WorstCycle | null = null;
	let firstZeroOffTheFloor: WorstCycle | null = null;
	let zeroOffTonnage = 0;
	forEachConsoleCycle((cycle) => {
		const out = flyConsoleCycle(cycle, quote);
		rows++;
		if (out.netCr > CYCLE_EPSILON_CR) {
			positiveRows++;
			if (cycle.good.unit === "t") tonnage++;
			else subTonnes++;
		} else if (out.netCr > -CYCLE_EPSILON_CR) {
			zeroRows++;
			if (out.midCr > PRICE_STEP_CR + CYCLE_EPSILON_CR) {
				zeroRowsOffTheFloor++;
				if (cycle.good.unit === "t") zeroOffTonnage++;
				else if (firstZeroOffTheFloor === null)
					firstZeroOffTheFloor = { ...out, cycle };
			}
		}
		if (worst === null || out.netCr > worst.netCr) worst = { ...out, cycle };
		if (
			cycle.good.unit !== "t" &&
			(bestSubTonnes === null || out.netCr > bestSubTonnes.netCr)
		)
			bestSubTonnes = { ...out, cycle };
	}, opts);
	if (worst === null) throw new Error("the cycle sweep flew nothing");
	return {
		worst,
		rows,
		positiveRows,
		zeroRows,
		zeroRowsOffTheFloor,
		positiveByTonnage: { tonnage, subTonnes },
		bestSubTonnes,
		firstZeroOffTheFloor,
		zeroRowsOffTheFloorAllSubTonnes: zeroOffTonnage === 0,
	};
}
