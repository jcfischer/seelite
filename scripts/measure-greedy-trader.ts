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
 * A **greedy upper bound on a human**, not a model of one. It sees every price
 * at every station it can reach, has no fear of pirates, never misjudges a
 * docking, and picks the option with the best credits per minute every single
 * time. So the Cr/min below is a ceiling: a player earns less. That is the
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
	FUEL_CR_PER_LY,
	HOLD_REFERENCE_T,
	MARKET_PERIOD_MIN,
	type MarketStation,
	carrierKey,
	type DeficitMap,
	marketPhaseMin,
	marketRow,
	marketSeedFor,
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
let DOCK_SECONDS = 45;

/** Starting credits and hold — §6, both v1 defaults the ship-roster node
 *  inherits. */
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
	key: string;
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
		market: {
			type: station.type as MarketStation["type"],
			seed: marketSeedOf(record, station),
		},
		key: carrierKey(record.index, station.localCarrierId),
		posAt: (t: number) => {
			const found = placeBodies(contents, t).find((b) => b.id === station.id);
			if (!found) throw new Error(`station ${station.id} vanished`);
			return found.pos;
		},
	}));
}

const marketSeedOf = (record: SystemRecord, station: Station): number =>
	marketSeedFor(record.seed, station.localCarrierId);

/** §4: illegal goods trade only at a fence, and that is both directions. */
const tradable = (good: Commodity, port: Port): boolean =>
	!good.illegal || port.station.blackMarket;

interface Quote {
	buyCr: number;
	sellCr: number;
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
	return {
		buyCr: priced,
		sellCr: priced,
		units: shelfQuantity(row.quantity, deficit),
	};
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

/** What a hold-and-stack basket earns on one leg, given capital. */
function basket(
	from: Port,
	to: Port,
	deficits: DeficitMap,
	gameTimeMin: number,
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
			const here = quote(g, from, deficits, gameTimeMin);
			const there = quote(g, to, deficits, gameTimeMin);
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
function intraSeconds(from: Port, to: Port, gameTimeS: number): number {
	const target = { pos: to.posAt(gameTimeS), radiusKm: 1 };
	return (
		legSeconds(
			from.posAt(gameTimeS),
			target,
			massesOf(to.contents, gameTimeS),
			DEFAULT_CRUISE,
		) + DOCK_SECONDS
	);
}

/** Seconds for a jump: wind-up, then the arrival-point-to-station leg §7.4
 *  makes a function of the inbound bearing. */
function jumpSeconds(from: Port, to: Port, gameTimeS: number): number {
	const entry = arrivalPoint(
		to.record,
		to.contents,
		from.record.pos,
		gameTimeS + JUMP_SECONDS,
	);
	const target = { pos: to.posAt(gameTimeS + JUMP_SECONDS), radiusKm: 1 };
	return (
		JUMP_SECONDS +
		legSeconds(
			entry,
			target,
			massesOf(to.contents, gameTimeS + JUMP_SECONDS),
			DEFAULT_CRUISE,
		) +
		DOCK_SECONDS
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
	upgrades: { name: string; atMinutes: number }[];
	/** Every decision point where a wait was on the table, as
	 *  `bestWaitRate / bestFlyRate`. A maximum alone cannot tell one lucky
	 *  moment from a strategy. */
	waitRatios: number[];
}

function run(worldSeed: number, galaxy: number, hours: number): Result {
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
	const upgrades: { name: string; atMinutes: number }[] = [];
	let bought = 0;

	let hops = 0;
	let waits = 0;
	let intra = 0;
	let jumps = 0;
	let waitMinutes = 0;
	let jumpMinutes = 0;
	let dockMinutes = 0;
	const waitRatios: number[] = [];

	while (t < limit) {
		const min = t / 60;
		const options: Hop[] = [];

		// (a) another station in this system.
		for (const to of portsOf(here.record, here.contents)) {
			if (to.station.id === here.station.id) continue;
			const seconds = intraSeconds(here, to, t);
			const b = basket(here, to, deficits, min, credits, holdT);
			options.push({
				kind: "intra",
				to,
				seconds,
				fuelCr: 0,
				profitCr: b.profitCr,
				cargo: b.cargo,
			});
		}

		// (b) a station in a system one jump away.
		for (const record of neighbours(systems, here.record).slice(
			0,
			NEIGHBOUR_LIMIT,
		)) {
			const ly = distanceLy(here.record.pos, record.pos);
			const fuelCr = ly * FUEL_CR_PER_LY;
			if (fuelCr > credits) continue;
			for (const to of portsOf(record, contentsFor(record))) {
				const seconds = jumpSeconds(here, to, t);
				const b = basket(here, to, deficits, min, credits - fuelCr, holdT);
				options.push({
					kind: "jump",
					to,
					seconds,
					fuelCr,
					profitCr: b.profitCr,
					cargo: b.cargo,
				});
			}
		}

		// (c) §5.5's rival strategy: park here until this market re-rolls, then
		//     take the best hop the new epoch offers. Costed honestly — the wait
		//     itself earns nothing, and the deficit fades while you sit.
		const phase = marketPhaseMin(here.market.seed);
		const nextEpochMin =
			(marketEpoch(phase, min) + 1) * MARKET_PERIOD_MIN - phase;
		const waitMin = Math.max(0, nextEpochMin - min);
		{
			let bestAfter = 0;
			let bestSeconds = 1;
			for (const to of portsOf(here.record, here.contents)) {
				if (to.station.id === here.station.id) continue;
				const b = basket(
					here,
					to,
					deficits,
					nextEpochMin + 1e-6,
					credits,
					holdT,
				);
				const seconds = intraSeconds(here, to, t + waitMin * 60);
				if (b.profitCr / (waitMin * 60 + seconds) > bestAfter / bestSeconds) {
					bestAfter = b.profitCr;
					bestSeconds = waitMin * 60 + seconds;
				}
			}
			if (bestAfter > 0)
				options.push({
					kind: "wait",
					to: here,
					seconds: bestSeconds,
					fuelCr: 0,
					profitCr: bestAfter,
					cargo: [],
				});
		}

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
		dockMinutes += DOCK_SECONDS / 60;
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

		while (
			bought < shopping.length &&
			credits >= shopping[bought].priceCr + WORKING_FLOAT_CR
		) {
			credits -= shopping[bought].priceCr;
			if (shopping[bought].name === "Large Cargo Bay") holdT += LARGE_BAY_T;
			upgrades.push({ name: shopping[bought].name, atMinutes: t / 60 });
			bought++;
		}
		if (bought === shopping.length) break;
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

console.log(
	"galaxy   minutes    Cr/min   hops   intra    jump   waits   fitted out",
);
for (const { g, r } of results) {
	const rate = finite(
		"Cr/min",
		(r.creditsCr + r.upgrades.reduce((s, u) => s + priceOf(u.name), 0)) /
			Math.max(r.minutes, 1e-9),
	);
	const done = r.upgrades.length === EQUIPMENT.length - 1;
	console.log(
		`${String(g).padStart(6)}${finite("minutes", r.minutes).toFixed(1).padStart(10)}` +
			`${rate.toFixed(1).padStart(10)}${String(r.hops).padStart(7)}` +
			`${String(r.intra).padStart(8)}${String(r.jumps).padStart(8)}` +
			`${String(r.waits).padStart(8)}   ${done ? `${r.minutes.toFixed(0)} min` : "not in cap"}`,
	);
}

function priceOf(name: string): number {
	const found = EQUIPMENT.find((e) => e.name === name);
	if (!found) throw new Error(`no equipment named ${name}`);
	return found.priceCr;
}

console.log("\ntime to each upgrade, minutes (galaxy 0)");
for (const u of results[0].r.upgrades)
	console.log(
		`  ${u.name.padEnd(22)}${finite(u.name, u.atMinutes).toFixed(1).padStart(8)}`,
	);
if (results[0].r.upgrades.length === 0) console.log("  none — nothing bought");

console.log("\n§5.5 — waiting against flying");
const ratios = results.flatMap(({ r }) => r.waitRatios).sort((a, b) => a - b);
const waited = results.reduce((s, { r }) => s + r.waits, 0);
const flew = results.reduce((s, { r }) => s + r.hops, 0);
if (ratios.length === 0) {
	console.log("  no decision point ever offered a profitable wait.");
} else {
	const at = (q: number) =>
		finite(
			"ratio",
			ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))],
		);
	const won = ratios.filter((r) => r > 1).length;
	console.log(
		`  decision points where a wait was on the table: ${ratios.length}`,
	);
	console.log(
		`  wait rate / best flight rate — median ${at(0.5).toFixed(3)}×, ` +
			`p95 ${at(0.95).toFixed(3)}×, max ${at(1).toFixed(3)}×`,
	);
	console.log(
		`  points where waiting won: ${won} (${((100 * won) / ratios.length).toFixed(1)}%)`,
	);
	console.log(`  hops actually spent waiting: ${waited} of ${flew + waited}`);
	console.log(
		won === 0
			? "  waiting never beat flying — §5.5's intent holds at these constants."
			: "  **waiting beat flying somewhere** — §5.5's intent is not unconditional " +
					"at these constants. The share above is what it is worth.",
	);
}

// The dock cost is paid on every hop and is half the clock, so the fit-out
// figure above is a claim about it as much as about the economy. Swept rather
// than conceded in prose: if 45 s is wrong by 2×, this is what moves.
console.log(
	"\ndock+market cost, swept (galaxy 0) — the modelled number that decides",
);
console.log("  dock s   minutes   Cr/min   fitted out");
const dockDefault = DOCK_SECONDS;
for (const dock of [15, 30, 45, 60, 90]) {
	DOCK_SECONDS = dock;
	const r = run(worldSeed, 0, hours);
	const kit = r.upgrades.reduce((sum, u) => sum + priceOf(u.name), 0);
	const done = r.upgrades.length === EQUIPMENT.length - 1;
	console.log(
		`${String(dock).padStart(8)}${finite("minutes", r.minutes).toFixed(1).padStart(10)}` +
			`${finite("rate", (r.creditsCr + kit) / Math.max(r.minutes, 1e-9))
				.toFixed(1)
				.padStart(9)}` +
			`   ${done ? `${r.minutes.toFixed(0)} min` : "not in cap"}`,
	);
}
DOCK_SECONDS = dockDefault;

const totalMin = results.reduce((s, { r }) => s + r.minutes, 0);
const modelled = results.reduce(
	(s, { r }) => s + r.jumpMinutes + r.dockMinutes,
	0,
);
console.log(
	`\nmodelled time as a share of the total: ${((100 * modelled) / Math.max(totalMin, 1e-9)).toFixed(1)}% ` +
		"— the rest is flown geometry.",
);
