/**
 * What the economy actually pays, per minute, flown against the real generator.
 *
 *   bun run scripts/measure-greedy-trader.ts [hours] [seed]
 *
 * `economy-trade.md` §10.3 requires this before three of its numbers may be
 * believed:
 *
 * 1. **§8's 1.5–2.5 hours** to fit out. The spec states it as a target and says
 *    so — "about fifteen clean runs" is arithmetic over a canonical lane at zero
 *    fluctuation, not a measurement of the galaxy the generator makes.
 * 2. **§6's compounding in minutes.** `runsUntilHoldLimited` derives six *runs*
 *    from 100 Cr; the wall-clock figure needs a run length, which nothing
 *    committed had.
 * 3. **§5.5's "waiting never beats flying"**, which §12 weak joint 5 records as
 *    an assumption. `MARKET_PERIOD` 30 min and `DEFICIT_HALF_LIFE` 20 min were
 *    chosen against a 3–5 minute run so that parking for a re-roll is dominated
 *    by going somewhere else — and no committed code had a time dimension over
 *    the whole loop, so nothing could tell.
 *
 * **Re-run it whenever `MARKET_PERIOD_MIN`, `DEFICIT_HALF_LIFE_MIN` or
 * `PRICE_ELASTICITY` moves.** All three are in this loop, and §12.5 is explicit
 * that changing either of the first two re-opens the exploit with nothing else
 * to catch it.
 *
 * ## What the trader is
 *
 * A **greedy upper bound on a human**, not a model of one. It has no fear of
 * pirates, never misjudges a docking, and picks the option with the best
 * credits per minute every single time. It sees the prices at the nearest
 * `NEIGHBOUR_LIMIT` systems in range rather than at every system in range —
 * how often that bites is counted and printed, because "sees every price it
 * can reach" was written here first and was not true. So the Cr/min below is a ceiling: a player earns less. That is the
 * useful direction — a target of 1.5–2.5 h is falsified by a *ceiling* that
 * takes longer, and is merely unproven by one that is faster.
 *
 * ## Where the time comes from
 *
 * Not from a constant. Every in-system leg is `cruise.ts`'s `legSeconds`
 * against `placeBodies` at the current clock, so an arrival 0.2 AU out and one
 * 3 AU out cost what they cost (`galaxy-generation.md` §7.4). Hyperspace is the
 * one modelled number — §8's wind-up is "a few seconds" rather than a figure —
 * and the sensitivity to it is printed rather than assumed away.
 *
 * `legSeconds` is the estimate the HUD shows rather than a flown leg;
 * `tests/cruise.test.ts` is what holds the two together. Flying thousands of
 * legs through `advanceCruise` at `MAX_DT` would take longer than the sim it
 * measures, and `measure-cruise-pacing.ts` is where the flown comparison lives.
 */

import { DEFAULT_CRUISE, type Mass, legSeconds } from "../src/cruise";
import {
	GALAXY_COUNT,
	type SystemRecord,
	distanceLy,
	generateGalaxy,
	neighbours,
} from "../src/galaxy";
import {
	COMMODITIES,
	type Commodity,
	EQUIPMENT,
	type Equipment,
	FUEL_CR_PER_LY,
	FUEL_TANK_LY,
	HOLD_REFERENCE_T,
	MARKET_PERIOD_MIN,
	type MarketStation,
	type CarrierKey,
	carrierKey,
	fullKitCr,
	type DeficitMap,
	listsCommodity,
	marketPhaseMin,
	marketRow,
	marketStationOf,
	marketEpoch,
	readDeficit,
	recordTrade,
	shelfQuantity,
	stockResponse,
} from "../src/market";
import type { Station } from "../src/system";
import {
	type SystemContents,
	arrivalPoint,
	generateContents,
	placeBodies,
} from "../src/system";
import type { Vec3 } from "../src/vec3";

// ---------------------------------------------------------------------------
// The modelled numbers, all of them named
// ---------------------------------------------------------------------------

/** §8's wind-up, "a few seconds", plus the witchspace transition. The one time
 *  cost here that is a choice rather than a measurement — its share of the
 *  total is printed at the end so a reader can see how little it decides. */
const JUMP_SECONDS = 15;

/** Docking, the market screen, and launching again. Not specified anywhere:
 *  #9 sets docking *tolerances*, not a duration. Also reported for sensitivity,
 *  because it is paid on every single hop and is therefore the modelled number
 *  that matters. */
const DOCK_SECONDS = 45;

/** Starting credits and hold — §6, both v1 defaults the ship-roster node
 *  inherits. */
/** The radius `legSeconds` treats a station as reached at. A station is a
 *  kilometre across (`STATION_GEOMETRY`), and cruise drops at `dropRadiusKm`
 *  anyway, so this only has to be small against the leg — but it is a modelled
 *  number and every other one in this file is named. */
const STATION_TARGET_RADIUS_KM = 1;

const START_CR = 100;
const HOLD_T = HOLD_REFERENCE_T;
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
const WORKING_FLOAT_CR = 800;

/** Sub-tonne goods bypass the hold check (research §2.2), and §4.1 turns on
 *  their stacking: a run carries a full hold **and** all three. */
const SUB_TONNE = new Set(["Gold", "Platinum", "Gem-Stones"]);

/**
 * `station-types.md` §4.1's ten universal items, **in the order the count
 * gates them**. Fuel is slot 0 and is not in `EQUIPMENT` (§7 prices it per
 * light year, not per unit), so these nine occupy slots 1–9.
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
	const slot = 1 + UNIVERSAL_ORDER.indexOf(item.name);
	// Typed against `EQUIPMENT`'s own names, so a rename in `src/market.ts` is a
	// compile error here rather than this throw at run time. The throw stays for
	// the case the type cannot see: an item added to `EQUIPMENT` as universal
	// and not to this order.
	if (slot === 0) throw new Error(`${item.name} is not in the universal order`);
	return slot < Math.min(port.record.displayTL + 3, 10);
};

/** How far the trader looks for a jump target. The whole 256-system galaxy is
 *  in memory, so this bounds work rather than knowledge. */
const NEIGHBOUR_LIMIT = 8;

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

const massesOf = (contents: SystemContents, gameTimeS: number): Mass[] =>
	placeBodies(contents, gameTimeS)
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
			const found = placeBodies(contents, t).find((b) => b.id === station.id);
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
	priceCr: number;
	units: number;
}

/** One good at one port, with the station's remembered deficit applied to both
 *  halves — §5.2's coupling, price and quantity moving opposite. */
function quote(
	good: Commodity,
	port: Port,
	deficits: DeficitMap,
	gameTimeMin: number,
): Quote {
	const row = marketRow(good, port.record.economy, port.market, gameTimeMin);
	const deficit = readDeficit(deficits, port.key, good.name, gameTimeMin);
	const priced = stockResponse(row.priceCr, deficit);
	return { priceCr: priced, units: shelfQuantity(row.quantity, deficit) };
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
	deficits: DeficitMap,
	buyMin: number,
	sellMin: number,
	capitalCr: number,
	holdT: number,
): { profitCr: number; cargo: { good: Commodity; units: number }[] } {
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
			const here = quote(g, from, deficits, buyMin);
			const there = quote(g, to, deficits, sellMin);
			return { good: g, here, there, margin: there.priceCr - here.priceCr };
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
		const byCapital = Math.floor(spend / c.here.priceCr);
		const units = Math.min(byHold, byCapital);
		if (units <= 0) continue;
		spend -= units * c.here.priceCr;
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

interface Result {
	minutes: number;
	creditsCr: number;
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
	 * 19,125 Cr. *Buying* everything also needs the trader to stand at a
	 * refinery for the mining laser and a shipyard for the military one
	 * (`station-types.md` §4.1), and this trader does not route — it maximises
	 * credits per minute and docks wherever that leads. So a fit-out time from
	 * this sim would be a measurement of luck as much as of the economy, and the
	 * two figures are reported apart rather than one standing for the other.
	 */
	kitAffordableAtMinutes: number | null;
	/** How often `NEIGHBOUR_LIMIT` hid part of the jump range, over how many
	 *  decisions — the denominator the header's claim needs. */
	tally: { truncated: number; decisions: number };
	/** Every decision point where a wait was on the table, as
	 *  `bestWaitRate / bestFlyRate`. A maximum alone cannot tell one lucky
	 *  moment from a strategy. */
	waitRatios: number[];
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
	dockSeconds: number;
	/**
	 * Where the neighbour-limit disclosure accumulates.
	 *
	 * **Per run, with a denominator.** A module-level counter was the first
	 * version, and the dock sweep called `run()` five more times before the line
	 * printed — so the figure that exists to keep "how often that bites is
	 * counted" honest spanned nine runs and was reported beside four-run tables.
	 */
	tally: { truncated: number; decisions: number };
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
		st.deficits,
		min,
		min + seconds / 60,
		st.credits - fuelCr,
		st.holdT,
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
function jumpOptions(
	here: Port,
	systems: readonly SystemRecord[],
	contentsFor: (r: SystemRecord) => SystemContents,
	st: Stance,
): Hop[] {
	const out: Hop[] = [];
	const inRange = neighbours(systems, here.record);
	if (inRange.length > NEIGHBOUR_LIMIT) st.tally.truncated++;
	st.tally.decisions++;
	for (const record of inRange.slice(0, NEIGHBOUR_LIMIT)) {
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
const flyingOptions = (
	here: Port,
	systems: readonly SystemRecord[],
	contentsFor: (r: SystemRecord) => SystemContents,
	st: Stance,
): Hop[] => [
	...intraOptions(here, st),
	...jumpOptions(here, systems, contentsFor, st),
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
	systems: readonly SystemRecord[],
	contentsFor: (r: SystemRecord) => SystemContents,
	st: Stance,
): { hop: Hop; waitMin: number } | null {
	const min = st.t / 60;
	const phase = marketPhaseMin(here.market.seed);
	const nextEpochMin =
		(marketEpoch(phase, min) + 1) * MARKET_PERIOD_MIN - phase;
	const waitMin = Math.max(0, nextEpochMin - min);
	// The nudge lands inside the new epoch rather than exactly on its boundary,
	// where `marketEpoch`'s floor could still return the old one.
	const after = { ...st, t: (nextEpochMin + 1e-6) * 60 };

	let best: { hop: Hop; rate: number } | null = null;
	for (const hop of flyingOptions(here, systems, contentsFor, after)) {
		if (hop.profitCr <= 0) continue;
		const seconds = waitMin * 60 + hop.seconds;
		const rate = (hop.profitCr - hop.fuelCr) / (seconds / 60);
		if (!best || rate > best.rate)
			best = { hop: { ...hop, kind: "wait", seconds }, rate };
	}
	return best ? { hop: best.hop, waitMin } : null;
}

function run(
	worldSeed: number,
	galaxy: number,
	hours: number,
	dockSeconds: number = DOCK_SECONDS,
): Result {
	const systems = generateGalaxy(worldSeed, galaxy).systems;
	const contentsOf = new Map<number, SystemContents>();
	const contentsFor = (r: SystemRecord): SystemContents => {
		const hit = contentsOf.get(r.index);
		if (hit) return hit;
		const made = generateContents(r);
		contentsOf.set(r.index, made);
		return made;
	};

	const start = systems.find((r) => contentsFor(r).stations.length >= 2);
	if (!start) throw new Error("no multi-station system in this galaxy");

	let here = portsOf(start, contentsFor(start))[0];
	let credits = START_CR;
	let holdT = HOLD_T;
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
	const upgrades: {
		name: string;
		atMinutes: number;
		affordableAtMinutes: number;
	}[] = [];
	/** Still to buy, in §8's order. An item is skipped rather than blocking the
	 *  list when the station it is standing at does not sell it — the shipyard
	 *  exclusives wait for a shipyard. */
	const remaining = [...shopping];
	/** Per item, the first moment credits covered its price — wherever the
	 *  trader was standing. That is §6's compounding curve; *buying* also needs
	 *  a station that sells it and the working float on top. */
	const affordableAt = new Map<string, number>();
	const kitCr = fullKitCr();
	let spentCr = 0;
	let kitAffordableAt: number | null = null;

	let hops = 0;
	let waits = 0;
	let intra = 0;
	let jumps = 0;
	let waitMinutes = 0;
	let jumpMinutes = 0;
	let dockMinutes = 0;
	const waitRatios: number[] = [];
	const tally = { truncated: 0, decisions: 0 };

	while (t < limit) {
		const min = t / 60;
		const options: Hop[] = [];

		const stance = { t, credits, holdT, deficits, dockSeconds, tally };
		options.push(...flyingOptions(here, systems, contentsFor, stance));
		const wait = waitOption(here, systems, contentsFor, stance);
		if (wait) options.push(wait.hop);
		const waitMin = wait?.waitMin ?? 0;

		const rated = options
			.filter((o) => o.seconds > 0)
			.map((o) => ({ o, rate: (o.profitCr - o.fuelCr) / (o.seconds / 60) }))
			.sort((a, b) => b.rate - a.rate);
		const best = rated[0];
		if (!best || best.rate <= 0) break;

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
		for (const { good, units } of hop.cargo)
			deficits = recordTrade(deficits, here.key, good.name, units, t / 60);
		credits -= hop.fuelCr;
		if (hop.kind === "jump") jumpMinutes += JUMP_SECONDS / 60;
		dockMinutes += dockSeconds / 60;
		t += hop.seconds;
		const arriveMin = t / 60;
		for (const { good, units } of hop.cargo)
			deficits = recordTrade(
				deficits,
				hop.to.key,
				good.name,
				-units,
				arriveMin,
			);
		credits += hop.profitCr;
		here = hop.to;
		hops++;
		if (hop.kind === "jump") jumps++;
		else intra++;

		// Stamped for **every** item the credits now cover, not just the next one
		// on the list. Probing a single pointer meant that after buying item N,
		// item N+1's affordability went unchecked until the following hop — a
		// whole leg later — so every figure after the first was stretched by a
		// leg it did not take.
		const probeAffordable = () => {
			for (const item of remaining)
				if (credits >= item.priceCr && !affordableAt.has(item.name))
					affordableAt.set(item.name, t / 60);
		};

		probeAffordable();
		if (kitAffordableAt === null && credits + spentCr >= kitCr)
			kitAffordableAt = t / 60;
		// Buy whatever this station sells and the float allows, in §8's order.
		// **The scope check is not decoration**: an earlier version sorted the
		// whole list by price and bought a Military Laser at a trade station,
		// which hands over the exclusives §4.1 exists to make you travel for.
		for (;;) {
			const i = remaining.findIndex(
				(e) => sellsIt(e, here) && credits >= e.priceCr + WORKING_FLOAT_CR,
			);
			if (i === -1) break;
			const item = remaining[i];
			credits -= item.priceCr;
			spentCr += item.priceCr;
			if (item.name === "Large Cargo Bay") holdT += LARGE_BAY_T;
			upgrades.push({
				name: item.name,
				atMinutes: t / 60,
				affordableAtMinutes: affordableAt.get(item.name) ?? t / 60,
			});
			remaining.splice(i, 1);
			probeAffordable();
		}
		if (remaining.length === 0) break;
		// Once the capital milestone is passed there is nothing left for this
		// sim to measure: what remains is a routing problem it does not model.
		if (kitAffordableAt !== null) break;
	}

	return {
		minutes: t / 60,
		creditsCr: credits,
		hops,
		waits,
		intra,
		jumps,
		waitMinutes,
		jumpMinutes,
		dockMinutes,
		upgrades,
		kitAffordableAtMinutes: kitAffordableAt,
		tally,
		waitRatios,
	};
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** Every printed figure goes through this, for the reason
 *  `measure-market.ts` gives: an instrument that quietly reports garbage is
 *  worse than one that dies, because its numbers get transcribed into a spec. */
const finite = (label: string, v: number): number => {
	if (!Number.isFinite(v)) throw new Error(`${label} is not finite: ${v}`);
	return v;
};

const hours = Number(process.argv[2] ?? 4);
const worldSeed = Number(process.argv[3] ?? 0x5ee11e);
if (!Number.isFinite(hours) || hours <= 0) throw new Error("hours must be > 0");
// The same guard, for the reason `finite()` exists: a mistyped seed otherwise
// enters `generateGalaxy` as `NaN` and the run reports a galaxy nobody asked
// for.
if (!Number.isInteger(worldSeed))
	throw new Error(`seed must be an integer, got ${process.argv[3]}`);

console.log(
	`greedy trader — world 0x${worldSeed.toString(16)}, ${hours} h cap, ` +
		`${HOLD_T} t hold, ${START_CR} Cr start`,
);
console.log(
	`modelled: jump ${JUMP_SECONDS}s, dock+market ${DOCK_SECONDS}s. ` +
		"Everything else is `legSeconds` against the placed bodies.\n",
);

const GALAXIES = [0, 1, 2, 3].filter((g) => g < GALAXY_COUNT);
const results = GALAXIES.map((g) => ({ g, r: run(worldSeed, g, hours) }));

/** One derivation, two tables. Written out twice they drift on the next edit,
 *  and the two copies already spelled the kit total differently. */
const summarize = (r: Result): { rate: number; kit: number | null } => ({
	kit: r.kitAffordableAtMinutes,
	rate: finite(
		"Cr/min",
		// `START_CR` is capital the trader was handed, not money it made.
		// Small against the rates this prints, and a bias in exactly the
		// direction §8 is arguing about — so it is subtracted rather than
		// waved off. No figure is quoted here: a rate transcribed into a
		// comment goes stale on the next constant that moves.
		(r.creditsCr -
			START_CR +
			r.upgrades.reduce((sum, u) => sum + priceOf(u.name), 0)) /
			Math.max(r.minutes, 1e-9),
	),
});

console.log(
	"galaxy   minutes    Cr/min   hops   intra    jump   waits   kit affordable",
);
for (const { g, r } of results) {
	const { rate, kit } = summarize(r);
	console.log(
		`${String(g).padStart(6)}${finite("minutes", r.minutes).toFixed(1).padStart(10)}` +
			`${rate.toFixed(1).padStart(10)}${String(r.hops).padStart(7)}` +
			`${String(r.intra).padStart(8)}${String(r.jumps).padStart(8)}` +
			`${String(r.waits).padStart(8)}   ${kit === null ? "not in cap" : `${kit.toFixed(0)} min`}`,
	);
}

function priceOf(name: string): number {
	const found = EQUIPMENT.find((e) => e.name === name);
	if (!found) throw new Error(`no equipment named ${name}`);
	return found.priceCr;
}

console.log("\ntime to each upgrade, minutes (galaxy 0)");
console.log("  item                  affordable    bought");
for (const u of results[0].r.upgrades)
	console.log(
		`  ${u.name.padEnd(22)}${finite(u.name, u.affordableAtMinutes).toFixed(1).padStart(10)}` +
			`${finite(u.name, u.atMinutes).toFixed(1).padStart(10)}`,
	);
console.log(
	`  (\`bought\` trails \`affordable\` by the ${WORKING_FLOAT_CR} Cr working float, ` +
		"which is a property of this sim and not of the economy.)",
);
if (results[0].r.upgrades.length === 0) console.log("  none — nothing bought");
{
	// §6 quotes the first purchase's affordability, so it gets a range across
	// the four galaxies rather than galaxy 0's figure standing for all of them.
	const first = results
		.map(({ r }) => r.upgrades.find((u) => u.name === "Large Cargo Bay"))
		.filter((u): u is NonNullable<typeof u> => u !== undefined)
		.map((u) => u.affordableAtMinutes);
	if (first.length > 0)
		console.log(
			`  Large Cargo Bay affordable across ${first.length} galaxies: ` +
				`${finite("first", Math.min(...first)).toFixed(1)}–${finite("first", Math.max(...first)).toFixed(1)} min`,
		);
}

/** One derivation of the wait distribution, for the two places that report it.
 *  Two copies of the "won" predicate would have to move together the day it
 *  changes. */
const waitStats = (input: readonly number[]) => {
	const r = [...input].sort((a, b) => a - b);
	const at = (q: number) =>
		r.length === 0
			? 0
			: finite("ratio", r[Math.min(r.length - 1, Math.floor(q * r.length))]);
	return {
		n: r.length,
		median: at(0.5),
		p95: at(0.95),
		max: at(1),
		won: r.filter((x) => x > 1).length,
	};
};

console.log("\n§5.5 — waiting against flying");
const all = waitStats(results.flatMap(({ r }) => r.waitRatios));
const waited = results.reduce((sum, { r }) => sum + r.waits, 0);
const flew = results.reduce((sum, { r }) => sum + r.hops, 0);
if (all.n === 0) {
	console.log("  no decision point ever offered a profitable wait.");
} else {
	console.log(`  decision points where a wait was on the table: ${all.n}`);
	console.log(
		`  wait rate / best flight rate — median ${all.median.toFixed(3)}×, ` +
			`p95 ${all.p95.toFixed(3)}×, max ${all.max.toFixed(3)}×`,
	);
	console.log(
		`  points where waiting won: ${all.won} (${((100 * all.won) / all.n).toFixed(1)}%)`,
	);
	console.log(`  hops actually spent waiting: ${waited} of ${flew + waited}`);
	console.log(
		all.won === 0
			? "  waiting never beat flying — §5.5's intent holds at these constants."
			: "  **waiting beat flying somewhere** — §5.5's intent is not unconditional " +
					"at these constants. The share above is what it is worth.",
	);
}

// The dock cost is paid on every hop and is half the clock, so the milestone
// above is a claim about it as much as about the economy. Swept rather than
// conceded in prose: if 45 s is wrong by 2×, this is what moves.
//
// **Across all four galaxies, not galaxy 0.** A one-galaxy sweep was the first
// version, and galaxy 0 is the one that never produces a winning wait — so it
// reported a null result drawn from a population without the phenomenon, and
// then concluded the phenomenon was not an artefact of the constant. The wait
// distribution is swept with the milestone because a longer dock stop makes
// flying worse relative to waiting, which is exactly the direction §5.5 argues
// about.
console.log(
	`\ndock+market cost, swept over ${GALAXIES.length} galaxies — the modelled number that decides`,
);
console.log("  dock s   kit affordable      Cr/min   waits won    max×");
for (const dock of [15, 30, 45, 60, 90]) {
	const swept = GALAXIES.map((g) => run(worldSeed, g, hours, dock));
	const kits = swept
		.map((r) => summarize(r).kit)
		.filter((k): k is number => k !== null);
	const rates = swept.map((r) => summarize(r).rate);
	const stats = waitStats(swept.flatMap((r) => r.waitRatios));
	console.log(
		`${String(dock).padStart(8)}   ` +
			(kits.length === GALAXIES.length
				? `${finite("kit", Math.min(...kits)).toFixed(0)}–${finite("kit", Math.max(...kits)).toFixed(0)} min`
				: `${kits.length}/${GALAXIES.length} in cap`
			).padEnd(15) +
			`${finite("rate", Math.min(...rates)).toFixed(0)}–${finite("rate", Math.max(...rates)).toFixed(0)}`.padStart(
				10,
			) +
			`${stats.won}/${stats.n}`.padStart(12) +
			`${stats.max.toFixed(2)}×`.padStart(9),
	);
}

{
	// Over the four reported runs only — the dock sweep's five extra runs are
	// not in this figure, which is what made the first version of it wrong.
	const truncated = results.reduce((sum, { r }) => sum + r.tally.truncated, 0);
	const decisions = results.reduce((sum, { r }) => sum + r.tally.decisions, 0);
	console.log(
		`\nneighbour list truncated at ${NEIGHBOUR_LIMIT} on ${truncated} of ` +
			`${decisions} decisions (${((100 * truncated) / Math.max(decisions, 1)).toFixed(1)}%) ` +
			"— where it bit, the trader did not see the whole jump range.",
	);
}
const totalMin = results.reduce((sum, { r }) => sum + r.minutes, 0);
const modelled = results.reduce(
	(sum, { r }) => sum + r.jumpMinutes + r.dockMinutes,
	0,
);
console.log(
	`\nmodelled time as a share of the total: ${((100 * modelled) / Math.max(totalMin, 1e-9)).toFixed(1)}% ` +
		"— the rest is the generator's own geometry, estimated by `legSeconds`.",
);
