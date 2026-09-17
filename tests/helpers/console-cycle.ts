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
	marketRow,
	shelfQuantity,
	marketQuote,
	marketStationOf,
	bidCutAtTl,
	bidCutLadder,
	quoteWithCut,
	stockResponse,
	type QuoteFn,
	type StationTypeKey,
	type Commodity,
	COMMODITIES,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	PRICE_STEP_CR,
	BID_CUT_FLOOR,
	BID_CUT_GRADE,
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

/**
 * The three consoles, built on first ask rather than per row.
 *
 * **The comment above always said "built once" and never did.** `marketStationOf` is a
 * seed hash and a record, and `flyConsoleCycle` asked for a station twice while
 * `forEachConsoleCycle` asked a third time for the shelf — so every survey rebuilt the
 * same three stations a couple of hundred thousand times. Memoized because the claim is
 * now true as written, and because a survey that closes and reopens a console on every
 * leg is one refactor away from being a survey of three different stations.
 */
const STATIONS = new Map<StationTypeKey, ReturnType<typeof marketStationOf>>();

const stationOf = (type: StationTypeKey) => {
	let station = STATIONS.get(type);
	if (station === undefined) {
		station = marketStationOf(
			{ type, localCarrierId: `pump-${type}`, blackMarket: true },
			STATION_SEED,
		);
		STATIONS.set(type, station);
	}
	return station;
};

/** What the shelf offers at an untouched market. One function, because the
 *  sweep that *builds* a row and the flight that *flies* it have to agree on
 *  how many units a buy leg can hold — two copies would drift into a sweep that
 *  visits rows its flights then refuse. */
const shelfCache = new Map<string, number>();

/**
 * The shelf the console would show, memoized by `(good, type, economy, epoch)`.
 *
 * **A call inside a `for (tl)` loop is the common case in the instruments** — the
 * direction ladder asks the same shelf at all fifteen tech levels and the answer does not
 * depend on the tech level, so a survey was re-running the ninety-minute epoch walk
 * behind `marketRow` fifteen times per row. The game path never loops here, so this
 * changes nothing about what a dock sees.
 */
export const shelfOf = (
	good: Commodity,
	type: StationTypeKey,
	economy: number,
	gameTimeMin: number,
): number => {
	// Keyed on the clock itself, not on an epoch: the shelf below reads `gameTimeMin`
	// through the deficit's history, and a coarser key would be a correctness question
	// this cache has no business asking. The loop this exists for repeats the exact value.
	const key = `${good.name}/${type}/${economy}/${gameTimeMin}`;
	const hit = shelfCache.get(key);
	if (hit !== undefined) return hit;
	const q = shelfQuantity(
		marketRow(good, economy, stationOf(type), gameTimeMin).quantity,
		0,
	);
	shelfCache.set(key, q);
	return q;
};

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
	/**
	 * What each leg was actually quoted at, and so what the till moved.
	 *
	 * The survey classifies its zeros against **these** rather than against the mid.
	 * A quote is quantized to a tenth of a credit and floored at one price step, so a
	 * row whose *mid* sits above §3's floor can still have both legs pinned at it —
	 * and calling that "a zero off the price floor" would be describing a row §3 has
	 * already swallowed as though it were an open question.
	 */
	sellCr: number;
	buyCr: number;
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
	// **The sign of the mark is the direction of the trade that left it.** A
	// purchase is a positive deficit and raises a price; a sale is negative and
	// lowers one — the asymmetry §5.2 is built on and the reason a *sale* first is
	// the deeper pump. Getting this backwards is not cosmetic: it reports the
	// buy-back as dearer than the untouched mid, and every zero this file
	// classifies then sits in the wrong bucket.
	const markAfterFirstLeg = first === "sell" ? -units : units;
	// **One priced row, read twice.** `marketRow` is pure and cheap, but calling it in
	// both places meant the mid the cycle reports and the mid its legs were quoted off
	// could in principle be two draws. One binding makes that unrepresentable.
	const midCr = marketRow(good, economy, station, gameTimeMin).priceCr;
	// **This is the one place in the helper that quotes rather than transacts, and it
	// has to stay that way**: the caller's `quote` may be an arm the till never ships
	// (`UNQUANTIZED_CUT`, whose whole job is to be the flight the till will not make),
	// and the leg figures are what the zero classifier compares *against* the till's
	// own net. So they come from the same `QuoteFn` the till would inject by default,
	// applied to the same response — not read back out of the credit delta, which
	// cannot answer a question about an arm that was never flown.
	const quoted = (kind: "buy" | "sell"): number =>
		quote(
			stockResponse(midCr, kind === first ? 0 : markAfterFirstLeg, holdT),
			displayTL,
		)[kind === "buy" ? "buyCr" : "sellCr"];
	side(first);
	side(second);
	return {
		netCr: commander.credits - startCr,
		units,
		midCr,
		sellCr: quoted("sell"),
		buyCr: quoted("buy"),
	};
}

/** Every hull, good, station type and economy the game can put a commander in
 *  front of, in both orders. `displayTLs` defaults to the whole table. */
export interface CycleOptions {
	displayTLs?: readonly number[];
	economies?: readonly number[];
	/**
	 * Skip the sub-tonne goods, which a caller that reads only `positiveByTonnage` does
	 * not need: the metals are 40% of the corpus and the whole reason the survey re-flies
	 * a row unquantized. `scripts/measure-greedy-trader.ts`'s bisection asks a tonnage
	 * question about forty-four times per report and was paying for all of it.
	 */
	tonnageOnly?: boolean;
	/**
	 * Skip the zero classification, which is the survey's most expensive step: it flies
	 * every netting-nothing cycle a second time with the quote step off. A caller that
	 * only reads the positive counters — the bisection's predicate — learns nothing from
	 * it, and the attribution is still made in full on the surveys that report it.
	 */
	classifyZeros?: boolean;
}

export function forEachConsoleCycle(
	visit: (cycle: ConsoleCycle) => void,
	opts: CycleOptions = {},
): void {
	const economies = opts.economies ?? ALL_EIGHT;
	const tls = opts.displayTLs ?? ALL_TL;
	for (const hull of DOCKABLE_HULL_IDS)
		for (const good of COMMODITIES) {
			if (good.sellOnly) continue;
			if (opts.tonnageOnly && good.unit !== "t") continue;
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
/** The domain the module imports, not a literal restatement of it. */
const ALL_TL: readonly number[] = Array.from(
	{ length: DISPLAY_TL_MAX - DISPLAY_TL_MIN + 1 },
	(_, i) => DISPLAY_TL_MIN + i,
);

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
	/** Of those, the ones that are *not* a row §3's floor pins at one price step,
	 *  **walked rather than counted**. A bare count of zeros says only that the
	 *  arithmetic cancelled and cannot say *why*, so every one of these is flown a
	 *  second time with the tenth-credit quote step taken off, and sorted by which law
	 *  closed it — see `ZeroWalk`. Claiming the second reading for rows off a sample is
	 *  what a previous revision of this survey did with one row and a count of 74, and
	 *  the true count was 3,472 with three mechanisms underneath it. */
	zeroOffFloor: ZeroWalk;
	/** One of those zeros, named, so a red run prints a row rather than a count. */
	firstZeroOffTheFloor: WorstCycle | null;
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
 * **Every zero off §3's price floor, sorted by what closed it.** Each one is flown a
 * second time with the tenth-credit quote step taken off, which is the only reading
 * that separates a zero the law leaves from a zero the display precision leaves. The
 * three fields below are that reading; an earlier version of this interface sorted by
 * whether the two legs printed the same figure and by whether the good was a tonne
 * good, and left 279 rows it could not explain.
 */
export interface ZeroWalk {
	count: number;
	/**
	 * Zeros the **law** leaves. Flown again with the quantization taken off, the same
	 * cycle still nets nothing: this is closure, not a rounding artefact. At the rim
	 * the cut equals the mark one full hold of tonnage moves a price, so a
	 * sell-and-buy-back nets exactly nothing; nearer the core a buy-first metal cycle
	 * can sit on the *other* mark, where a purchase lifts the price by the factor the
	 * cut then removes — `(1 + mark) × (1 − cut)` at 1 is a wash, and the shipped
	 * grade passes through that value within two tech levels of TL 15.
	 */
	lawCloses: number;
	/** Zeros where the unquantized cycle loses and the shipped one nets nothing. A
	 *  wash for the player rather than a leak; counted so a zero is attributed. */
	quantizedToZero: number;
	/**
	 * Zeros where the unquantized cycle **profits** and only the tenth-credit quote
	 * step stops it. The category that would matter: a pump the law does not close and
	 * the display precision does, which is the weakest reason a closure can have.
	 * `worstCr` sizes what it rescues, so the figure a retune makes large is a red run
	 * rather than a slow slide.
	 */
	rescuedByRounding: { count: number; worstCr: number; rows: string[] };
}

/** The shipped cut schedule with its quantization taken back off, which is what
 *  separates a cycle the law closes from a cycle the quote step rounds closed. */
export const UNQUANTIZED_CUT: QuoteFn = quoteWithCut(bidCutAtTl, {
	quantize: false,
});

/**
 * #191 D4's rejected arm, held here beside `NO_WEDGE` rather than as a dial on the
 * shipped law.
 *
 * **A mirror is an arm, not a flag.** `src/market.ts` states what ships, and the repo
 * keeps the rejected laws next to the tests that fly them — `BELL_WRAP` and
 * `fixedReferenceResponse` in `market-math.ts`, `NO_WEDGE` three lines above. Naming it
 * as an option also cannot be done honestly: `{ wideAtHighTl: true }` builds the arm
 * that is *narrow* at high TL, because mirroring the position is exactly what swaps the
 * ends. That inversion cost this node a review round in which the sweep printed one
 * arm under the other arm's name.
 *
 * **Reflected on the tech level rather than re-derived from the offset**, so the
 * position arithmetic still has one home and it is the law's.
 */
export const mirroredBidCut =
	(floor: number, grade: number) =>
	(displayTL: number): number =>
		bidCutLadder(floor, grade)(DISPLAY_TL_MAX + DISPLAY_TL_MIN - displayTL);

/**
 * The rejected direction **at the shipped dials**: the same floor and the same grade,
 * with the ends swapped, so a rim market pays 0.25 and a core one 0.10.
 *
 * **This is the arm #191 D4's own question needs and the sweep did not fly.** The
 * matched-mean rungs are built at floor 0 so their multiset of cuts can equal a flat
 * arm's, which leaves both of them charging nothing at the rim — where 50-93% of the
 * shipped arm's docks land. Comparing those two says nothing about what D4 asked,
 * because D4 asked what a commander who starts somewhere developed pays, and neither
 * arm has a developed market to pay it in. Flown against `marketQuote` at the same two
 * constants, the comparison is the one the decision was actually made on.
 */
export const MIRRORED_SHIPPED: QuoteFn = quoteWithCut(
	mirroredBidCut(BID_CUT_FLOOR, BID_CUT_GRADE),
);

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
	opts: CycleOptions = {},
): CycleSurvey {
	let rows = 0;
	let positiveRows = 0;
	let zeroRows = 0;
	let tonnage = 0;
	let subTonnes = 0;
	let worst: WorstCycle | null = null;
	let bestSubTonnes: WorstCycle | null = null;
	let firstZeroOffTheFloor: WorstCycle | null = null;
	const zeroWalk: ZeroWalk = {
		count: 0,
		lawCloses: 0,
		quantizedToZero: 0,
		rescuedByRounding: { count: 0, worstCr: 0, rows: [] },
	};
	/**
	 * What closed a cycle that netted nothing, sorted into the three things it can be.
	 *
	 * **Called for every zero, and it must not skip the row.** An earlier revision
	 * returned early when both legs stood at §3's price floor, which also skipped the
	 * `worst` and `bestSubTonnes` tracking in the caller — so on a build where nothing
	 * profits, "the most profitable cycle the sweep flew" could report a loss while a
	 * 0 Cr cycle sat in the same corpus. The floor check is a reason not to *classify*,
	 * not a reason not to *count*.
	 *
	 * **Off the price floor means off for both legs.** A quote is floored at one price
	 * step and quantized to a tenth, so a row whose mid stands above the floor can still
	 * have both legs pinned at it; classifying that as an open question would be
	 * describing a row §3 already swallowed.
	 *
	 * **Every zero is flown a second time**, and each one is asked the same question:
	 * would this cycle still net nothing with the tenth-credit quote step taken off? That
	 * is the only reading that separates a zero the law leaves from a zero the display
	 * precision leaves — and the second is a closure nobody should want, a pump stopped by
	 * the number of digits on the glass. An earlier revision classified these by whether
	 * the two legs printed the same figure and by whether the good was a tonne good, and
	 * it ended up with 279 rows it could not explain: Gold and Platinum buy-first cycles
	 * near the core, which wash because a purchase's mark and the cut cancel —
	 * `(1 + 0.315) × (1 − 0.239) ≈ 1` — a mark no leg comparison can see.
	 */
	// **Closes over the survey's own accumulators.** `zeroWalk` and
	// `firstZeroOffTheFloor` are already in this scope, so taking them as parameters —
	// and taking a setter callback whose only job was to assign one of them — was
	// ceremony around an assignment the function could make directly.
	const classifyZero = (cycle: ConsoleCycle, out: CycleOutcome) => {
		if (
			out.sellCr <= PRICE_STEP_CR + CYCLE_EPSILON_CR ||
			out.buyCr <= PRICE_STEP_CR + CYCLE_EPSILON_CR
		)
			return;
		zeroWalk.count++;
		if (firstZeroOffTheFloor === null) firstZeroOffTheFloor = { ...out, cycle };
		const raw = flyConsoleCycle(cycle, UNQUANTIZED_CUT).netCr;
		if (raw > CYCLE_EPSILON_CR) {
			zeroWalk.rescuedByRounding.count++;
			zeroWalk.rescuedByRounding.worstCr = Math.max(
				zeroWalk.rescuedByRounding.worstCr,
				raw,
			);
			zeroWalk.rescuedByRounding.rows.push(
				`${cycle.good.name} ${cycle.hull} e${cycle.economy} ` +
					`${cycle.type} TL${cycle.displayTL} ${cycle.arm}: ` +
					`unquantized +${raw.toFixed(4)} Cr against shipped ` +
					`${out.netCr.toFixed(4)}`,
			);
		} else if (raw < -CYCLE_EPSILON_CR) zeroWalk.quantizedToZero++;
		else zeroWalk.lawCloses++;
	};

	forEachConsoleCycle((cycle) => {
		const out = flyConsoleCycle(cycle, quote);
		rows++;
		if (out.netCr > CYCLE_EPSILON_CR) {
			positiveRows++;
			if (cycle.good.unit === "t") tonnage++;
			else subTonnes++;
		} else if (out.netCr > -CYCLE_EPSILON_CR) {
			zeroRows++;
			if (opts.classifyZeros !== false) classifyZero(cycle, out);
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
		zeroOffFloor: zeroWalk,
		firstZeroOffTheFloor,
		positiveByTonnage: { tonnage, subTonnes },
		bestSubTonnes,
	};
}
