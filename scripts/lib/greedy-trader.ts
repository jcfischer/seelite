/**
 * The greedy trader itself: the engine two instruments fly.
 *
 * `scripts/measure-greedy-trader.ts` reports `economy-trade.md` §5.5 and §8
 * from it; `scripts/measure-hull-pricing.ts` reports #182's hold curve. **One
 * engine and not two**, and that is the whole reason this file exists rather
 * than a second copy of the loop.
 *
 * #25's measured tail went 1.326x -> 1.785x -> 4.679x as three riggings came
 * out of the comparison, and all three were one shape: the clock, the option
 * set or the price table differed between the two arms being compared. #182
 * sweeps the hold, which is a comparison of arms by construction — so the way
 * to answer *could the losing side have been given what the winning side had*
 * is to make it impossible for the two arms to be built differently. A hold
 * sweep that reimplemented the loop would be exactly the fault #25 shipped
 * three times, and the module docstring on the report file is where the rest
 * of that argument lives.
 *
 * Nothing here prints. Every figure a caller reports goes through `finite`,
 * per `measure-market.ts`'s rule: an instrument that quietly reports garbage
 * is worse than one that dies, because its numbers get transcribed into a
 * spec.
 *
 * ## What the trader is
 *
 * A **greedy upper bound on a human**, not a model of one. It has no fear of
 * pirates, never misjudges a docking, and picks the option with the best
 * credits per minute every single time. It sees the prices at the nearest
 * `NEIGHBOUR_LIMIT` systems in range rather than at every system in range —
 * how often that bites is counted and returned, because "sees every price it
 * can reach" was written here first and was not true. So a Cr/min from this
 * engine is a ceiling: a player earns less. That is the useful direction — a
 * target of 1.5-2.5 h is falsified by a *ceiling* that takes longer, and is
 * merely unproven by one that is faster.
 *
 * ## Where the time comes from
 *
 * Not from a constant. Every in-system leg is `cruise.ts`'s `legSeconds`
 * against `placeBodies` at the current clock, so an arrival 0.2 AU out and one
 * 3 AU out cost what they cost (`galaxy-generation.md` §7.4). Hyperspace is the
 * one modelled number — §8's wind-up is "a few seconds" rather than a figure —
 * and the sensitivity to it is printed by the callers rather than assumed away.
 *
 * `legSeconds` is the estimate the HUD shows rather than a flown leg;
 * `tests/cruise.test.ts` is what holds the two together. Flying thousands of
 * legs through `advanceCruise` at `MAX_DT` would take longer than the sim it
 * measures, and `measure-cruise-pacing.ts` is where the flown comparison lives.
 */

import { type CarrierKey, carrierKey } from "../../src/carrier-key";
import { DEFAULT_CRUISE, legSeconds, type Mass } from "../../src/cruise";
import { type DeficitMap, readDeficit, recordTrade } from "../../src/deficits";
import {
	distanceLy,
	GALAXY_COUNT,
	generateGalaxy,
	neighbours,
	type SystemRecord,
} from "../../src/galaxy";
import {
	COMMODITIES,
	type Commodity,
	EQUIPMENT,
	type Equipment,
	FUEL_CR_PER_LY,
	FUEL_TANK_LY,
	fullKitCr,
	HOLD_REFERENCE_T,
	listsCommodity,
	MARKET_PERIOD_MIN,
	type MarketStation,
	marketEpoch,
	marketQuote,
	marketRow,
	marketStationOf,
	type QuoteFn,
	shelfQuantity,
	stockResponse,
} from "../../src/market";
import type { Station } from "../../src/system";
import {
	arrivalPoint,
	generateContents,
	type PlacedBody,
	placeBodies,
	type SystemContents,
} from "../../src/system";
import type { Vec3 } from "../../src/vec3";

// ---------------------------------------------------------------------------
// The modelled numbers, all of them named
// ---------------------------------------------------------------------------

/** §8's wind-up, "a few seconds", plus the witchspace transition. The one time
 *  cost here that is a choice rather than a measurement — its share of the
 *  total is printed at the end so a reader can see how little it decides. */
export const JUMP_SECONDS = 15;

/** Docking, the market screen, and launching again. Not specified anywhere:
 *  #9 sets docking *tolerances*, not a duration. Also reported for sensitivity,
 *  because it is paid on every single hop and is therefore the modelled number
 *  that matters. */
export const DOCK_SECONDS = 45;

/** The radius `legSeconds` treats a station as reached at. A station is a
 *  kilometre across (`STATION_GEOMETRY`), and cruise drops at `dropRadiusKm`
 *  anyway, so this only has to be small against the leg — but it is a modelled
 *  number and every other one in this file is named. */
const STATION_TARGET_RADIUS_KM = 1;

/** How far past an epoch boundary a wait actually goes. `marketEpoch` floors,
 *  so stopping exactly on the boundary can still read the old epoch — the wait
 *  has to cross it, not touch it. A millisecond of game time. */
const EPOCH_NUDGE_MIN = 1e-6;

/** Starting credits — §6's v1 default, which the ship-roster node inherited.
 *  The default *hold* is not restated here: it is `HOLD_REFERENCE_T`, which
 *  since #181 is the baseline hull's own row, and a second exported spelling of
 *  one figure is what `state-gallery.ts` was corrected for in this same node. */
export const START_CR = 100;
/** §6: the Large Cargo Bay is +15 t. It is §8's first purchase precisely
 *  because it lifts every later run, so a sim that bought it and kept trading
 *  20 t would understate everything after minute ~7. */
const LARGE_BAY_T = 15;

/**
 * What the trader keeps back rather than spending on the next upgrade.
 *
 * Not realism dressing — without it the sim **stops**. Buying down to nearly
 * zero credits leaves nothing to buy cargo with, every option rates at zero
 * profit, and the run ends mid-cap looking like a dead galaxy. One run in four
 * ended that way before this existed.
 */
export const WORKING_FLOAT_CR = 800;

/** Sub-tonne goods bypass the hold check (research §2.2), and §4.1 turns on
 *  their stacking: a run carries a full hold **and** all three. */
const SUB_TONNE = new Set(["Gold", "Platinum", "Gem-Stones"]);

/**
 * `station-types.md` §4.1's ten universal items, **in the order the count
 * gates them**. Fuel is first and is not in `EQUIPMENT` (§7 prices it per
 * light year, not per unit), so these nine occupy ranks 1-9.
 *
 * The gate is `min(displayTL + 3, 10)` items *shown*, not a per-item tech
 * level — which is why it saturates at `displayTL = 7` and why §4.2 rejected
 * a per-type shift on it.
 */
type EquipmentName = (typeof EQUIPMENT)[number]["name"];

const UNIVERSAL_ORDER: EquipmentName[] = [
	"Missile",
	"Large Cargo Bay",
	"Extra Pulse Laser",
	"E.C.M. System",
	"Extra Beam Laser",
	"Escape Pod",
	"Energy Bomb",
	"Docking Computer",
	"Galactic Hyperdrive",
];

/**
 * Whether this station sells this item at all (`station-types.md` §4).
 *
 * **An earlier version of this sim ignored the question entirely**, sorted the
 * whole list by price and bought a Military Laser wherever the trader happened
 * to be docked. The fit-out figure §8 rests on was therefore a trader buying
 * shipyard-only kit at a trade station — the exclusives §4.1 exists to make you
 * travel for, handed over for free.
 */
const sellsIt = (item: Equipment, port: Port): boolean => {
	if (item.scope !== "universal") return port.station.type === item.scope;
	const rank = 1 + UNIVERSAL_ORDER.indexOf(item.name);
	// Typed against `EQUIPMENT`'s own names, so a rename in `src/market.ts` is a
	// compile error here rather than this throw at run time. The throw stays for
	// the case the type cannot see: an item added to `EQUIPMENT` as universal
	// and not to this order.
	if (rank === 0) throw new Error(`${item.name} is not in the universal order`);
	return rank < Math.min(port.record.displayTL + 3, 10);
};

/** How far the trader looks for a jump target. The whole 256-system galaxy is
 *  in memory, so this bounds work rather than knowledge. */
export const DEFAULT_NEIGHBOUR_LIMIT = 8;

// ---------------------------------------------------------------------------
// The world, as the trader sees it
// ---------------------------------------------------------------------------

interface Port {
	record: SystemRecord;
	contents: SystemContents;
	station: Station;
	market: MarketStation;
	key: CarrierKey;
	/** Position at the moment it is asked for — a station orbits, so this is a
	 *  function of the clock, never a stored constant (#6). */
	posAt(gameTimeS: number): Vec3;
}

/**
 * `placeBodies` for one `(system, clock)`, memoised.
 *
 * Bodies move (#6), so a placement is only reusable at the same clock value —
 * but within one enumeration it is asked for repeatedly: `posAt` places a whole
 * system to find one station, `massesOf` places it again for the mass list, and
 * `jumpSeconds` wants both at the arrival clock, for every station of every one
 * of eight neighbour systems.
 *
 * Cleared between runs rather than growing for the life of the process, because
 * every run replays the clock from zero.
 */
let placementCache = new WeakMap<SystemContents, Map<number, PlacedBody[]>>();
const clearPlacements = () => {
	placementCache = new WeakMap();
};
const placedAt = (
	contents: SystemContents,
	gameTimeS: number,
): PlacedBody[] => {
	// **Keyed on the contents object, not on an id.** The first version keyed on
	// `contents.star.id`, which is not unique across systems — every system's
	// star is `star` — so one system's placements were served for another's and
	// the run died with "station station-refinery vanished". A `WeakMap` on the
	// object is exact by construction and needs no id to be unique.
	let perClock = placementCache.get(contents);
	if (!perClock) {
		perClock = new Map();
		placementCache.set(contents, perClock);
	}
	// Bodies move (#6), so a placement is reusable only at the same clock.
	// Rounded to the millisecond, far finer than any body moves in a step.
	const key = Math.round(gameTimeS * 1000);
	const hit = perClock.get(key);
	if (hit) return hit;
	const made = placeBodies(contents, gameTimeS);
	perClock.set(key, made);
	return made;
};

const massesOf = (contents: SystemContents, gameTimeS: number): Mass[] =>
	placedAt(contents, gameTimeS)
		.filter((b) => b.kind !== "station")
		.map((b) => ({ id: b.id, pos: b.pos, radiusKm: b.radiusKm }));

function portsOf(record: SystemRecord, contents: SystemContents): Port[] {
	return contents.stations.map((station) => ({
		record,
		contents,
		station,
		market: marketStationOf(station, record.seed),
		key: carrierKey(record.index, station.localCarrierId),
		posAt: (t: number) => {
			const found = placedAt(contents, t).find((b) => b.id === station.id);
			if (!found) throw new Error(`station ${station.id} vanished`);
			return found.pos;
		},
	}));
}

/** §4's scope, from `src/market.ts` — the instrument does not carry its own
 *  copy of a rule the game enforces. It used to, which is how the rule came to
 *  exist only here. */
const tradable = (good: Commodity, port: Port): boolean =>
	listsCommodity(good, port.market);

/**
 * One good at one port.
 *
 * **One price, not a spread.** Elite quotes a single figure per good and you
 * trade against it in both directions; nothing in §2–§5 introduces a bid/ask
 * gap. Two identical fields would have read as a spread that does not exist.
 */
interface Quote {
	/** What the trader pays for one unit here. */
	buyCr: number;
	/** What this port pays for one unit. */
	sellCr: number;
	units: number;
}

/**
 * One good at one port, with the station's remembered deficit applied to both
 * halves — §5.2's coupling, price and quantity moving opposite — and §5.6's
 * spread applied to what is left.
 *
 * **There were two prices here once, and they were the same number.** Elite
 * quotes one figure per good and you trade against it both ways; #196 closed
 * §12's round-trip pump by splitting it, and the split arrives through the
 * game's own `marketQuote` rather than a local arithmetic, for the reason §4's
 * scope note gives: a rule that lives in the instrument and not in the game
 * measures an economy the game does not have.
 */
function quote(
	good: Commodity,
	port: Port,
	deficits: DeficitMap,
	gameTimeMin: number,
	holdT: number,
	q: QuoteFn,
): Quote {
	const row = marketRow(good, port.record.economy, port.market, gameTimeMin);
	const deficit = readDeficit(deficits, port.key, good.name, gameTimeMin);
	const mid = stockResponse(row.priceCr, deficit, holdT);
	const { buyCr, sellCr } = q(mid, port.record.displayTL);
	return { buyCr, sellCr, units: shelfQuantity(row.quantity, deficit) };
}

// ---------------------------------------------------------------------------
// One hop: buy here, fly there, sell
// ---------------------------------------------------------------------------

interface Hop {
	kind: "intra" | "jump" | "wait";
	to: Port;
	seconds: number;
	fuelCr: number;
	profitCr: number;
	cargo: { good: Commodity; units: number }[];
}

/**
 * What a hold-and-stack basket earns on one leg, given capital.
 *
 * **A run is priced at the shelf price, once**, and both of these are the
 * spec's model rather than a simplification of it:
 *
 * - **The sale is not limited by the destination's shelf.** §10.1 states it
 *   directly — `minBuy` is restricted to rows that carry stock, `maxSell` is
 *   not, "because selling needs no shelf". A station's quantity is what it has
 *   to sell you, not a bin with room in it.
 * - **No slippage inside one transaction.** §5.2's deficit is what the market
 *   remembers *between* visits: it is written after the trade and moves the
 *   price you see next time. `runsToExhaustion` — the spec's own committed
 *   measurement, pinned by the suite — does exactly this, taking
 *   `profitCr += margin * holdT` at one price and applying the deficit only
 *   between runs. Pricing the marginal unit here would make this instrument
 *   measure a different economy from the one §5.4 was ratified on.
 *
 * **The two ends are quoted at two clocks**, and an earlier version quoted both
 * at departure. That was not a rounding error: a leg runs into the tens of
 * minutes against a 30-minute `MARKET_PERIOD`, so a flight was booked at prices
 * from before it was flown while the wait option — which is priced at the epoch
 * it waits for by construction — got the future it was asking about. The
 * comparison the whole §5.5 question turns on was then stale flights against
 * correctly-timed waits, and the "1 of 122" it produced was an artefact of that
 * asymmetry.
 */
function basket(
	from: Port,
	to: Port,
	st: Stance,
	buyMin: number,
	sellMin: number,
): { profitCr: number; cargo: { good: Commodity; units: number }[] } {
	// **The stance rather than four of its fields.** `hopTo` was unpacking
	// `deficits`, `credits - fuelCr` and `holdT` out of a struct that already
	// holds all three, and #182 made it five; a caller with a `Stance` in hand
	// should not have to know which of its fields a basket reads.
	const { deficits, credits: capitalCr, holdT, quote: q } = st;
	const cargo: { good: Commodity; units: number }[] = [];
	let spend = capitalCr;
	let profit = 0;
	let holdLeft = holdT;

	// §4.1's discipline: a run is a *basket*, not the best single good. Sub-tonne
	// goods are taken first because they cost no hold — pricing the best single
	// commodity is what inverted #7's contraband finding.
	const candidates = COMMODITIES.filter(
		(g) => !g.sellOnly && tradable(g, from) && tradable(g, to),
	)
		.map((g) => {
			const here = quote(g, from, deficits, buyMin, holdT, q);
			const there = quote(g, to, deficits, sellMin, holdT, q);
			// **The margin crosses the spread**, and that is the wedge's whole
			// effect on a haul: buy at the origin's ask, sell at the destination's
			// bid. Nothing here "adds a fee" — the two ends are simply two prices.
			return { good: g, here, there, margin: there.sellCr - here.buyCr };
		})
		.filter((c) => c.margin > 0 && c.here.units > 0)
		.sort((a, b) => {
			const subA = SUB_TONNE.has(a.good.name) ? 1 : 0;
			const subB = SUB_TONNE.has(b.good.name) ? 1 : 0;
			if (subA !== subB) return subB - subA;
			return b.margin - a.margin;
		});

	for (const c of candidates) {
		const sub = SUB_TONNE.has(c.good.name);
		const byHold = sub ? c.here.units : Math.min(holdLeft, c.here.units);
		const byCapital = Math.floor(spend / c.here.buyCr);
		const units = Math.min(byHold, byCapital);
		if (units <= 0) continue;
		spend -= units * c.here.buyCr;
		profit += units * c.margin;
		if (!sub) holdLeft -= units;
		cargo.push({ good: c.good, units });
	}
	return { profitCr: profit, cargo };
}

/** Seconds from one port to another inside one system, at the current clock. */
function intraSeconds(
	from: Port,
	to: Port,
	gameTimeS: number,
	dockSeconds: number,
): number {
	const target = {
		pos: to.posAt(gameTimeS),
		radiusKm: STATION_TARGET_RADIUS_KM,
	};
	return (
		legSeconds(
			from.posAt(gameTimeS),
			target,
			massesOf(to.contents, gameTimeS),
			DEFAULT_CRUISE,
		) + dockSeconds
	);
}

/** Seconds for a jump: wind-up, then the arrival-point-to-station leg §7.4
 *  makes a function of the inbound bearing. */
function jumpSeconds(
	from: Port,
	to: Port,
	gameTimeS: number,
	dockSeconds: number,
): number {
	const entry = arrivalPoint(
		to.record,
		to.contents,
		from.record.pos,
		gameTimeS + JUMP_SECONDS,
	);
	const target = {
		pos: to.posAt(gameTimeS + JUMP_SECONDS),
		radiusKm: STATION_TARGET_RADIUS_KM,
	};
	return (
		JUMP_SECONDS +
		legSeconds(
			entry,
			target,
			massesOf(to.contents, gameTimeS + JUMP_SECONDS),
			DEFAULT_CRUISE,
		) +
		dockSeconds
	);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface Result {
	minutes: number;
	creditsCr: number;
	/**
	 * What the trader *earned* over the window: credits in hand, plus everything
	 * spent on equipment, less the capital it was handed.
	 *
	 * **Derived once, here, rather than in each report.** It was a lambda in the
	 * report file, and #182's second report would have been a second copy of the
	 * same three terms — `START_CR` is capital the trader was given rather than
	 * money it made, and dropping that subtraction biases a rate in exactly the
	 * direction §8 argues about.
	 */
	earnedCr: number;
	/** The hold the run flew, tonnes, **as it ended** — the Large Cargo Bay's
	 *  +15 t included if one was bought. `RunOptions.holdT` is where it started;
	 *  a sweep reports both so a reader can see the bay in the curve. */
	holdT: number;
	startHoldT: number;
	hops: number;
	waits: number;
	intra: number;
	jumps: number;
	waitMinutes: number;
	jumpMinutes: number;
	dockMinutes: number;
	/** `atMinutes` is when it was *bought* — behind `WORKING_FLOAT_CR`.
	 *  `affordableAtMinutes` is when the credits first covered the price alone,
	 *  which is the compounding curve §6 is about and is the only one of the two
	 *  that means anything outside this sim. */
	upgrades: {
		name: string;
		atMinutes: number;
		affordableAtMinutes: number;
	}[];
	/**
	 * When the trader's **capital** first covered the whole kit —
	 * `fullKitCr()`, spent or in hand.
	 *
	 * **This, and not the purchase list, is what §8 is about.** "About fifteen
	 * clean runs" is a claim about the pump: how long the economy takes to yield
	 * `fullKitCr()` — not a number restated here, which is one that went stale
	 * the week the scanner module's row landed. *Buying* everything also needs the trader to stand at a
	 * refinery for the mining laser and a shipyard for the military one
	 * (`station-types.md` §4.1), and this trader does not route — it maximises
	 * credits per minute and docks wherever that leads. So a fit-out time from
	 * this sim would be a measurement of luck as much as of the economy, and the
	 * two figures are reported apart rather than one standing for the other.
	 */
	kitAffordableAtMinutes: number | null;
	/** The limit this run flew, so a report prints the one it swept at. */
	neighbourLimit: number;
	/** How often the neighbour limit hid part of the jump range, over how many
	 *  neighbour lookups — the denominator the header's claim needs. Lookups
	 *  rather than decisions: `jumpOptions` runs twice per decision point. */
	tally: { truncated: number; enumerations: number };
	/** Every decision point where a wait was on the table, as
	 *  `bestWaitRate / bestFlyRate`. A maximum alone cannot tell one lucky
	 *  moment from a strategy. */
	waitRatios: number[];
	/**
	 * Tonnes of **hold-occupying** cargo actually lifted, and over how many
	 * laden hops — #182's ceiling.
	 *
	 * A rate curve cannot say where a hold stops being worth having, because
	 * rate keeps creeping up on galaxy-to-galaxy noise. What the load says is
	 * physical: a hold the economy cannot fill rides empty, and the tonnage
	 * lifted per run plateaus at whatever the shelves in front of the trader
	 * hold. Sub-tonne goods are excluded, because they bypass the hold check
	 * (research §2.2) and so are not evidence about hold capacity at all.
	 */
	tonnesLifted: number;
	ladenHops: number;
	/**
	 * Where the trader actually docked, by system tech level and by galactic
	 * radius — one entry per hop's arrival, so the arrays are `hops` long.
	 *
	 * **#191 D4 asked for the route mix, and §10.3 disqualifies the hop ratio as
	 * its answer.** `intra : jump` is 27 : 118 because `jumpOptions` enumerates
	 * eight systems and `intraOptions` enumerates the one or two other stations in
	 * this one — it reports the option pools, not the economy. A spread that moves
	 * trade toward the frontier or away from it shows in *which* systems got the
	 * docks, so that is what gets counted: tech level because §5.6's cut is a
	 * function of it, and galactic radius because that is the geography the
	 * destination's third verb is about.
	 */
	dockTl: number[];
	dockRadius: number[];
	/**
	 * True when the session ended because no option paid rather than because the
	 * clock ran out. An economy where a trader *stops* is a different finding from
	 * one where it is merely slow, and the difference is invisible in `hops`.
	 */
	stalled: boolean;
}

/**
 * What the trader knows when it decides: the clock, the wallet, the hold, and
 * the market's memory of it.
 *
 * The three option builders below take this rather than closing over `run`'s
 * locals, so each is a function of its arguments and can be read on its own.
 */
interface Stance {
	t: number;
	credits: number;
	holdT: number;
	deficits: DeficitMap;
	/**
	 * The law that turns one market's mid into the two prices it quotes.
	 *
	 * Carried on the stance rather than read from a module-level default, because
	 * this interface is the trader's whole knowledge at a decision point and a
	 * sweep that varies the spread has to vary it *here* to vary it everywhere.
	 * `basket`, `intraOptions` and `jumpOptions` all price through it, so no arm
	 * can be given the wedge on one leg and not another — which is #25's fault
	 * three, arrived at from the quoting side.
	 */
	quote: QuoteFn;
	dockSeconds: number;
	/** How far this stance looks for a jump target. */
	neighbourLimit: number;
	/**
	 * Where the neighbour-limit disclosure accumulates.
	 *
	 * **Per run, with a denominator.** A module-level counter was the first
	 * version, and the dock sweep called `run()` five more times before the line
	 * printed — so the figure that exists to keep "how often that bites is
	 * counted" honest spanned nine runs and was reported beside four-run tables.
	 */
	tally: { truncated: number; enumerations: number };
}

/**
 * One hop, priced.
 *
 * Both builders below ended in this same block — compute the basket, push an
 * identically-keyed `Hop` — differing only in `kind`, `fuelCr` and which
 * seconds function ran. A change to how an option is priced had to land twice.
 */
function hopTo(
	here: Port,
	to: Port,
	st: Stance,
	kind: Hop["kind"],
	fuelCr: number,
	seconds: number,
): Hop {
	const min = st.t / 60;
	const b = basket(
		here,
		to,
		{ ...st, credits: st.credits - fuelCr },
		min,
		min + seconds / 60,
	);
	return { kind, to, seconds, fuelCr, profitCr: b.profitCr, cargo: b.cargo };
}

/** (a) Another station in this system — §5.4's intra-system pair. */
function intraOptions(here: Port, st: Stance): Hop[] {
	const out: Hop[] = [];
	for (const to of portsOf(here.record, here.contents)) {
		if (to.station.id === here.station.id) continue;
		out.push(
			hopTo(
				here,
				to,
				st,
				"intra",
				0,
				intraSeconds(here, to, st.t, st.dockSeconds),
			),
		);
	}
	return out;
}

/** (b) A station in a system one jump away. */
function jumpOptions(here: Port, world: World, st: Stance): Hop[] {
	const { systems, contentsFor } = world;
	const out: Hop[] = [];
	const inRange = neighbours(systems, here.record);
	// Counted per **enumeration**, not per decision: `jumpOptions` runs twice
	// for each decision point — once from `flyingOptions` and once inside
	// `waitOption` — so a denominator called "decisions" was double what a
	// reader would count. The rate is unaffected; the absolute figure was not.
	if (inRange.length > st.neighbourLimit) st.tally.truncated++;
	st.tally.enumerations++;
	for (const record of inRange.slice(0, st.neighbourLimit)) {
		const ly = distanceLy(here.record.pos, record.pos);
		// `neighbours` already bounds this at `JUMP_RANGE_LY`, which is
		// `FUEL_TANK_LY` — so there is no separate range check to make, and this
		// asserts the identity rather than assuming it. The tank is not *tracked*
		// because fuel is sold at every station (§7) and the trader docks on every
		// hop: a full refill is always one purchase away, so paying is refuelling.
		if (ly > FUEL_TANK_LY)
			throw new Error(
				`neighbour at ${ly} LY is past the ${FUEL_TANK_LY} LY tank`,
			);
		const fuelCr = ly * FUEL_CR_PER_LY;
		if (fuelCr > st.credits) continue;
		for (const to of portsOf(record, contentsFor(record)))
			out.push(
				hopTo(
					here,
					to,
					st,
					"jump",
					fuelCr,
					jumpSeconds(here, to, st.t, st.dockSeconds),
				),
			);
	}
	return out;
}

/** Everything the trader could do *right now* if it launched: §5.4's
 *  intra-system pairs and its interstellar ones, at one stance. */
const flyingOptions = (here: Port, world: World, st: Stance): Hop[] => [
	...intraOptions(here, st),
	...jumpOptions(here, world, st),
];

/**
 * (c) §5.5's rival strategy: park here until this market re-rolls, then take
 * the best hop the new epoch offers.
 *
 * Costed honestly, and that took two corrections.
 *
 * 1. **Both ends of the trade are quoted at the clock they happen on.** The
 *    first version quoted every flight at departure while pricing the wait at
 *    the epoch it waited for, so the comparison was stale flights against
 *    correctly-timed waits.
 * 2. **The wait gets the same menu the flight does.** The second version built
 *    its post-wait candidates from this system's other stations only, so the
 *    waiting strategy was denied the interstellar hop the trader takes three
 *    times in four — and in a single-station system it offered nothing at all,
 *    so those decision points went unrecorded rather than counting against
 *    waiting. What this measures has to be the *best* thing waiting can buy, or
 *    the number is a lower bound on waiting wearing the label of a measurement
 *    of it.
 *
 * The wait earns nothing while it lasts and the deficit fades while you sit;
 * both are in the rate below, because the wait minutes are in its denominator.
 * The fading needs no code here — the deficit map is shared and `readDeficit`
 * decays from `updatedAt` against whatever clock it is handed, which is the
 * post-wait one.
 */
function waitOption(
	here: Port,
	world: World,
	st: Stance,
): { hop: Hop; waitMin: number } | null {
	const min = st.t / 60;
	const phase = here.market.phaseMin;
	const nextEpochMin =
		(marketEpoch(phase, min) + 1) * MARKET_PERIOD_MIN - phase;
	// **The nudge is part of the wait, not part of the pricing.** It lands
	// inside the new epoch rather than exactly on its boundary, where
	// `marketEpoch`'s floor can still return the old one — and an earlier
	// version applied it when *quoting* the post-wait menu while advancing the
	// clock only to the boundary when the wait was *taken*. Where the boundary
	// rounds low, the trader then re-quoted at the old epoch: it was charged for
	// a wait and handed back the market it had been sitting in. A fourth
	// asymmetry of the species §10.3 lists three of, and the fix is that one
	// number is used for both.
	const waitMin = Math.max(0, nextEpochMin + EPOCH_NUDGE_MIN - min);
	const after = { ...st, t: st.t + waitMin * 60 };

	let best: { hop: Hop; rate: number } | null = null;
	for (const hop of flyingOptions(here, world, after)) {
		if (hop.profitCr <= 0) continue;
		const seconds = waitMin * 60 + hop.seconds;
		const rate = (hop.profitCr - hop.fuelCr) / (seconds / 60);
		if (!best || rate > best.rate)
			best = { hop: { ...hop, kind: "wait", seconds }, rate };
	}
	return best ? { hop: best.hop, waitMin } : null;
}

/**
 * One galaxy's systems and their contents, generated once.
 *
 * **Shared across the dock sweep**, which re-enters `run` five times per galaxy
 * for data that does not depend on the dock cost — twenty galaxy generations,
 * each up to `MAX_LAYOUT_ATTEMPTS` layout attempts, plus a cold contents cache
 * every time.
 */
export interface World {
	systems: readonly SystemRecord[];
	contentsFor: (r: SystemRecord) => SystemContents;
}

/**
 * The four galaxies every report here sweeps.
 *
 * **Four and not one**, and it is a shared constant rather than a literal in
 * each report because a draft of §10.3 swept galaxy 0 alone — the one galaxy
 * that never produces a winning wait — and drew a null result from a population
 * without the phenomenon.
 */
export const GALAXY_LIST: readonly number[] = [0, 1, 2, 3].filter(
	(g) => g < GALAXY_COUNT,
);

export function worldFor(worldSeed: number, galaxy: number): World {
	const systems = generateGalaxy(worldSeed, galaxy).systems;
	const contentsOf = new Map<number, SystemContents>();
	return {
		systems,
		contentsFor: (r: SystemRecord): SystemContents => {
			const hit = contentsOf.get(r.index);
			if (hit) return hit;
			const made = generateContents(r);
			contentsOf.set(r.index, made);
			return made;
		},
	};
}

/**
 * The trader's books: everything the shopping pass reads and writes.
 *
 * A struct rather than a fistful of `run` locals, because the purchase pass is
 * a self-contained concern that a reader otherwise has to scroll back through
 * the flying loop to follow.
 */
interface Ledger {
	credits: number;
	holdT: number;
	spentCr: number;
	kitAffordableAt: number | null;
	readonly kitCr: number;
	/** Still to buy, in §8's order. An item is skipped rather than blocking the
	 *  list when this station does not sell it — the shipyard exclusives wait
	 *  for a shipyard. */
	readonly remaining: Equipment[];
	/** Per item, the first moment credits covered its price — wherever the
	 *  trader was standing. That is §6's compounding curve; *buying* also needs
	 *  a station that sells it and the working float on top. */
	readonly affordableAt: Map<string, number>;
	readonly upgrades: {
		name: string;
		atMinutes: number;
		affordableAtMinutes: number;
	}[];
}

/**
 * One dock's worth of shopping: stamp affordability, then buy what this station
 * sells and the float allows, in §8's order.
 *
 * **The scope check is not decoration.** An earlier version sorted the whole
 * list by price and bought a Military Laser at a trade station, handing over
 * the exclusives `station-types.md` §4.1 exists to make you travel for.
 *
 * Affordability is stamped for **every** item the credits now cover, not just
 * the next one on the list. Probing a single pointer meant that after buying
 * item N, item N+1 went unchecked until the following hop — a whole leg later —
 * so every figure after the first was stretched by a leg it did not take.
 */
function shop(port: Port, led: Ledger, tMin: number, buys: boolean): void {
	const probe = () => {
		for (const item of led.remaining)
			if (led.credits >= item.priceCr && !led.affordableAt.has(item.name))
				led.affordableAt.set(item.name, tMin);
	};

	probe();
	if (led.kitAffordableAt === null && led.credits + led.spentCr >= led.kitCr)
		led.kitAffordableAt = tMin;

	// **The stamp is above the gate, not inside it.** `RunOptions.shop` turns
	// off *buying*, not the milestone: the capital §8 measures is what the
	// economy yielded, and a curve arm that flew the whole window without a
	// shopping list still has one. Gating the stamp would have made the hold
	// curve's milestone column silently empty.
	if (!buys) return;

	for (;;) {
		const i = led.remaining.findIndex(
			(e) => sellsIt(e, port) && led.credits >= e.priceCr + WORKING_FLOAT_CR,
		);
		if (i === -1) break;
		const item = led.remaining[i];
		led.credits -= item.priceCr;
		led.spentCr += item.priceCr;
		if (item.name === "Large Cargo Bay") led.holdT += LARGE_BAY_T;
		led.upgrades.push({
			name: item.name,
			atMinutes: tMin,
			affordableAtMinutes: led.affordableAt.get(item.name) ?? tMin,
		});
		led.remaining.splice(i, 1);
		probe();
	}
}

/**
 * What varies between two runs, and therefore what a comparison of two runs is
 * a comparison *of*.
 *
 * **Everything not in here is identical across every arm by construction**,
 * which is the answer #25's four wrong answers demanded: the galaxy, the
 * generator, the starting port, the clock model, the neighbour limit, the price
 * table and the option builders are all reached through the same code with the
 * same inputs. A sweep can only differ in the fields named below, so *could the
 * losing side have been given what the winning side had* has a mechanical
 * answer rather than an argued one.
 */
/**
 * Where a run drops the trader. **One union, exported**, because the instrument names
 * these in its arm rows and a copy of the union in two files is how a fourth rule gets
 * added in one place and silently not the other.
 *
 * - `first` — the first multi-station system the generator lists. The arbitrary start.
 * - `developed` — the system with the highest displayed tech level in the galaxy.
 * - `rim` — the lowest, which in this generator is also the most galactic-edge.
 */
export type StartPolicy = "first" | "developed" | "rim";

export interface RunOptions {
	/** The dock-and-market stop, seconds. §10.3's swept modelled number. */
	dockSeconds?: number;
	/**
	 * The hull's cargo hold, tonnes — #182's swept variable.
	 *
	 * The Large Cargo Bay's +15 t is added on top for every arm alike when the
	 * trader buys one, because that is the game's own rule and suspending it for
	 * a sweep would be a different economy. It lifts a small hold by a *larger
	 * share* than a big one, so it flattens the low end of the measured curve;
	 * that is a property of the game rather than of the instrument, and the
	 * report says so.
	 */
	holdT?: number;
	/**
	 * Whether the run stops when the capital first covers `fullKitCr()`.
	 *
	 * **Default true, and off is what a rate comparison needs.** The milestone is
	 * reached at a different clock in every arm, so a run that stops there flies
	 * a different length of game time, over a different stretch of the galaxy, at
	 * different epochs — the price table then differs between the arms, which is
	 * fault three of #25's three. With it off every arm flies the same window and
	 * the rate is a rate over one clock.
	 */
	stopAtKit?: boolean;
	/**
	 * Whether the trader buys equipment at all.
	 *
	 * **Off is what a hold curve needs, and it removes a confound rather than
	 * adding one.** With shopping on, the Large Cargo Bay's +15 t lands on every
	 * arm — but it is a 75% boost to a 20 t hold and a 25% boost to a 60 t one,
	 * so the swept variable stops being the hold and becomes the hold plus a
	 * hold-dependent increment. And the list runs out: `remaining.length === 0` ends
	 * the run, sooner at a large hold than at a small one, so the arms would fly
	 * different windows of the clock and therefore different price tables — #25's
	 * fault three, arrived at from a new direction.
	 *
	 * With it off, `holdT` is constant for the whole window and no arm ends
	 * because its shopping list ran out. **One terminal state is left and it is
	 * not this option's**: a stance with no profitable hop at all breaks the
	 * loop, so an arm *can* end short of the window and shrink its own `minutes`
	 * denominator. `Result.minutes` is what a caller checks for that, and
	 * `measure-hull-pricing.ts` reports how many arms it happened to. §8's
	 * milestone still needs shopping on, which is why this is an option and not
	 * a deletion.
	 */
	shop?: boolean;
	/**
	 * Whether the market remembers this trader at all — §5.2's deficit, on or
	 * off.
	 *
	 * **Off is what prices a hold, and it is not a convenience.** #182's sweep
	 * found the deficit response, not the commodity gradients, dominating the
	 * greedy trader's earnings: strengthen the response and the rate goes *up*.
	 * The cause is a round trip through one station. A sale is priced at the
	 * pre-trade mark and the buy-back at the post-trade one, with no slippage
	 * inside a transaction (§10.1, ratified by #7), so selling a hold and buying
	 * it straight back nets `PRICE_ELASTICITY` of the cargo's value — 4 Cr a
	 * cycle on 20 t of 2.00 Cr Food, repeatable — and the trader takes it without
	 * being told to, because the station it just sold into is the cheapest place
	 * in the galaxy to buy that good.
	 *
	 * It is a defect of the shipped rules and not of this sim: the same sequence
	 * through `transactAtStation` does it, on `main` as here. #182 does not fix
	 * it — pricing the marginal unit reverses #7's ruling and moves every figure
	 * §5.4 was ratified on — but a curve measured through it would be pricing the
	 * pump rather than the hold, and under the hold-scaled response the pump's
	 * strength is itself a function of the hold.
	 *
	 * So the price curve is measured against a market with no memory, where the
	 * hold is the only thing that varies, and the memory arm is reported beside
	 * it as the difference the pump is visible in.
	 */
	remembers?: boolean;
	/**
	 * A ceiling on the credits one hop may deploy as cargo, or `undefined` for
	 * the trader's whole wallet.
	 *
	 * **The arm that tests whether the sweep's remaining bias is small.** With no
	 * cap and no shopping the wallet compounds without limit, so a large hold is
	 * never capital-limited late in a window while a player always is — a bias
	 * that flatters exactly the arm #182's exponent is about. #25's tell is that
	 * every correction moves the answer the same way, and two of this sweep's did
	 * (both steepened the curve), so the next correction in that direction is
	 * measured rather than asserted away.
	 */
	capitalCapCr?: number;
	/**
	 * The credits the trader opens with, or `START_CR` for §6's 100.
	 *
	 * **The price curve needs a trader who could afford a hull.** From 100 Cr the
	 * first several minutes of any window earn almost nothing — §6's
	 * capital-limited opening — and that dead time is amortised over the window,
	 * so a rate taken from `earnedCr / minutes` climbs with `hours` and a price
	 * derived from it would move with an instrument parameter that means nothing
	 * in the game. Opening at a hull buyer's own capital removes the transient
	 * instead of averaging over it.
	 */
	startCr?: number;
	/**
	 * How far the trader looks for a jump target.
	 *
	 * **In here rather than in a module-level `let`, which is what it was.** This
	 * interface's own contract is that it is the complete list of what a sweep
	 * may vary and that everything outside it is identical across every arm by
	 * construction; a mutable global a caller could change between arms made that
	 * a claim about discipline rather than about the type, and two instruments
	 * now share this engine.
	 */
	neighbourLimit?: number;
	/**
	 * The law that turns a market's mid into its two quoted prices — §5.6, and
	 * **the field a spread sweep sweeps**.
	 *
	 * An arm is a function rather than a number, so a comparison cannot quietly
	 * differ in *how* the spread is applied: both arms quote through the same call
	 * in the same `quote()` on the same leg, and the only thing that can differ is
	 * what that function returns. `NO_WEDGE` in `tests/helpers/console-cycle.ts`
	 * is the pre-#196 law and is what the control arm of any of these rows uses.
	 */
	quote?: QuoteFn;
	/**
	 * Which multi-station system the trader is dropped at.
	 *
	 * **Default `"first"`, which is the historic behaviour** — the first system the
	 * generator happens to list with two or more stations. That default is what let a
	 * review round say "#191 D4's concern about starting somewhere developed is never
	 * flown": every arm of the direction sweep began at the same arbitrary system,
	 * whatever its tech level, so the pair answered a question about a dropped
	 * somewhere-random commander.
	 *
	 * `"developed"` starts at the **highest-tech** multi-station system in the galaxy and
	 * `"rim"` at the lowest. Two consequences worth stating before anyone uses them: the
	 * arms are still identical to each other in every respect (same start, same clock,
	 * same trader), and the start is itself a **confound to be measured, not a control to
	 * be assumed** — which is why the report flies the same arm from several starts and
	 * prints the spread, rather than treating one start as the answer.
	 */
	startPolicy?: StartPolicy;
}

export function run(
	world: World,
	hours: number,
	opts: RunOptions = {},
): Result {
	const dockSeconds = opts.dockSeconds ?? DOCK_SECONDS;
	const startHoldT = opts.holdT ?? HOLD_REFERENCE_T;
	const stopAtKit = opts.stopAtKit ?? true;
	const buysEquipment = opts.shop ?? true;
	const remembers = opts.remembers ?? true;
	const neighbourLimit = opts.neighbourLimit ?? DEFAULT_NEIGHBOUR_LIMIT;
	const quoteLaw = opts.quote ?? marketQuote;
	const startPolicy = opts.startPolicy ?? "first";
	const capitalCapCr = opts.capitalCapCr ?? Number.POSITIVE_INFINITY;
	// The cache is keyed on a clock value, and every run replays the clock from
	// zero — so it is cleared per run rather than kept, or run N would read run
	// N−1's placements at the same instant.
	clearPlacements();
	const berthable = world.systems.filter(
		(r) => world.contentsFor(r).stations.length >= 2,
	);
	if (berthable.length === 0)
		throw new Error("no multi-station system in this galaxy");
	const byTl = [...berthable].sort((a, b) => b.displayTL - a.displayTL);
	const start =
		startPolicy === "developed"
			? byTl[0]
			: startPolicy === "rim"
				? byTl[byTl.length - 1]
				: berthable[0];
	if (!start) throw new Error("no multi-station system in this galaxy");

	let here = portsOf(start, world.contentsFor(start))[0];

	let deficits: DeficitMap = {};
	let t = 0; // game seconds
	const limit = hours * 3600;

	// §8's order: the Large Cargo Bay is the first purchase, then the rest
	// cheapest first — the pump's own sequence, not the price table's.
	const shopping = [...EQUIPMENT]
		.filter((e) => e.name !== "Missile")
		.sort((a, b) =>
			a.name === "Large Cargo Bay"
				? -1
				: b.name === "Large Cargo Bay"
					? 1
					: a.priceCr - b.priceCr,
		);
	const led: Ledger = {
		credits: opts.startCr ?? START_CR,
		holdT: startHoldT,
		spentCr: 0,
		kitAffordableAt: null,
		kitCr: fullKitCr(),
		remaining: [...shopping],
		affordableAt: new Map<string, number>(),
		upgrades: [],
	};

	let hops = 0;
	let waits = 0;
	let intra = 0;
	let jumps = 0;
	let waitMinutes = 0;
	let tonnesLifted = 0;
	let ladenHops = 0;
	let jumpMinutes = 0;
	let dockMinutes = 0;
	const dockTl: number[] = [];
	const dockRadius: number[] = [];
	let stalled = false;
	const waitRatios: number[] = [];
	const tally = { truncated: 0, enumerations: 0 };

	while (t < limit) {
		const options: Hop[] = [];

		const stance = {
			t,
			credits: Math.min(led.credits, capitalCapCr),
			holdT: led.holdT,
			deficits,
			quote: quoteLaw,
			dockSeconds,
			neighbourLimit,
			tally,
		};
		options.push(...flyingOptions(here, world, stance));
		const wait = waitOption(here, world, stance);
		if (wait) options.push(wait.hop);
		const waitMin = wait?.waitMin ?? 0;

		const rated = options
			.filter((o) => o.seconds > 0)
			.map((o) => ({ o, rate: (o.profitCr - o.fuelCr) / (o.seconds / 60) }))
			.sort((a, b) => b.rate - a.rate);
		const best = rated[0];
		if (!best || best.rate <= 0) {
			// The loop ended because nothing paid, not because the clock ran out.
			// Reported rather than left inside a small `hops`, because a route mix
			// drawn from a halted run is a claim about a halt, and #28's rule is that
			// the binding bucket gets named rather than averaged.
			stalled = true;
			break;
		}

		// §5.5's question, answered by comparison rather than by assertion: how
		// much better is the best *waiting* option than the best *flying* one?
		const bestFly = rated.find((r) => r.o.kind !== "wait");
		const bestWait = rated.find((r) => r.o.kind === "wait");
		if (bestFly && bestWait && bestFly.rate > 0)
			waitRatios.push(bestWait.rate / bestFly.rate);

		const hop = best.o;
		if (hop.kind === "wait") {
			waits++;
			waitMinutes += waitMin;
			t += waitMin * 60;
			continue;
		}

		// Buy, fly, sell. The deficit is written at both ends — the whole point
		// of §5.2 is that the market remembers which of them you did.
		// One writer for both ends of the trade. The pair differed only in key,
		// sign and clock, and this diff widened both copies twice — `remembers`
		// and the hold — so a third change would have been three edits.
		const mark = (key: CarrierKey, sign: 1 | -1, tMin: number) => {
			if (!remembers) return;
			for (const { good, units } of hop.cargo)
				deficits = recordTrade(deficits, key, {
					goodName: good.name,
					units: sign * units,
					gameTimeMin: tMin,
					holdT: led.holdT,
				});
		};

		mark(here.key, 1, t / 60);
		led.credits -= hop.fuelCr;
		if (hop.kind === "jump") jumpMinutes += JUMP_SECONDS / 60;
		dockMinutes += dockSeconds / 60;
		t += hop.seconds;
		const arriveMin = t / 60;
		mark(hop.to.key, -1, arriveMin);
		led.credits += hop.profitCr;
		const tonnes = hop.cargo.reduce(
			(sum, c) => sum + (c.good.unit === "t" ? c.units : 0),
			0,
		);
		if (tonnes > 0) {
			tonnesLifted += tonnes;
			ladenHops++;
		}
		here = hop.to;
		dockTl.push(here.record.displayTL);
		dockRadius.push(here.record.t);
		hops++;
		if (hop.kind === "jump") jumps++;
		else intra++;

		shop(here, led, t / 60, buysEquipment);

		if (buysEquipment && led.remaining.length === 0) break;
		// Once the capital milestone is passed there is nothing left for §8 to
		// measure: what remains is a routing problem this sim does not model. A
		// rate comparison turns it off, for the reason `RunOptions.stopAtKit`
		// gives.
		if (stopAtKit && led.kitAffordableAt !== null) break;
	}

	return {
		minutes: t / 60,
		creditsCr: led.credits,
		earnedCr: led.credits - (opts.startCr ?? START_CR) + led.spentCr,
		holdT: led.holdT,
		startHoldT,
		hops,
		waits,
		intra,
		jumps,
		waitMinutes,
		jumpMinutes,
		dockMinutes,
		upgrades: led.upgrades,
		kitAffordableAtMinutes: led.kitAffordableAt,
		tally,
		waitRatios,
		tonnesLifted,
		ladenHops,
		dockTl,
		dockRadius,
		stalled,
		neighbourLimit,
	};
}

/** Every printed figure goes through this, for the reason
 *  `measure-market.ts` gives: an instrument that quietly reports garbage is
 *  worse than one that dies, because its numbers get transcribed into a spec. */
export const finite = (label: string, v: number): number => {
	if (!Number.isFinite(v)) throw new Error(`${label} is not finite: ${v}`);
	return v;
};
