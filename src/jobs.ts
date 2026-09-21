/**
 * Ordinary work: the authored job rows and the binders that fill them
 * (`ordinary-requests.md` D1–D3, §1–§4, node #411).
 *
 * **A row is prose and a payment rule; a binder is the only thing that may
 * name a commodity, a carrier or a station.** D1 chose authored templates with
 * live operands, and D3 chose a typed row table with one binder per family,
 * in the idiom `market.ts`'s `commodity(…)` and `hull.ts`'s `HULL_SPECS`
 * already use. Adding a job is adding a row; adding a family is adding a
 * binder. The moment a binder writes text the ternary wall that
 * `fixtureOffers` reached at two jobs comes back.
 *
 * **A binder is a pure function of the posting station, the world and the
 * clock.** It reads no commander state — not the jump tank, not the hold, not
 * the credits — because the request contract §1 forbids a fixed offer being
 * regenerated on docking, and a board that changed when the pilot topped the
 * tank up would be exactly that. The offer prints what it costs to reach; the
 * pilot decides.
 *
 * **`JobOffer` is persisted verbatim in the request journal**
 * (`requests.ts`'s `RequestOffer`), so changing its fields is a
 * `SAVE_SCHEMA_VERSION` decision rather than a content edit. Adding a *row* or
 * a *binder* is not.
 *
 * And note what the shipped shape assumes: `goodName`, `tonnes` and
 * `entrusted` are required, because both families move cargo. **Bounty and
 * Salvage do not**, so the family that brings them will split these onto a
 * per-family payload and bump the schema again. That split is deliberately not
 * made here: a bounty's operand is a target carrier and a salvage's is a
 * wreck, neither of which exists yet, and a payload shaped for operands nobody
 * has written is a guess this module would then have to keep.
 *
 * It imports no Three.js and must not: a board is arithmetic, and
 * `tests/headless.test.ts` is where that stays true.
 */

import { type CarrierKey, carrierKey } from "./carrier-key";
import { type DeficitMap, readDeficit } from "./deficits";
import { DOMAIN } from "./domains";
import { JUMP_RANGE_LY, type SystemRecord, distanceLy } from "./galaxy";
import { reachable } from "./galaxy-route";
import {
	type Commodity,
	marketRowAt,
	marketStationOf,
	stationCommodities,
} from "./market";
import { mix, seededRand } from "./rng";
import type { Station, SystemContents } from "./system";

export type JobFamily = "courier" | "procurement";

/**
 * What a job pays, as a rule rather than a figure.
 *
 * A row may carry this because it is authored tuning; it may not carry the
 * tonnage's commodity or the distance's destination, which are the binder's.
 */
export interface PaymentRule {
	baseCr: number;
	perTonneCr: number;
	perLyCr: number;
	/**
	 * Procurement only: what the station adds per tonne on top of the good's
	 * **base** price — the price with no fluctuation byte and no deficit
	 * response. Pricing the premium off the live price would let a pilot raise
	 * their own fee by buying the shelf out first.
	 */
	basePriceFactor: number;
}

/** One authored job. No operand appears here; see the module header. */
export interface JobRow {
	family: JobFamily;
	/** Stable authored identity, and the first half of an offer's key. Named
	 *  `rowId` because `CONTEXT.md` reserves the other word for a berth. */
	rowId: string;
	/** Bumped when the row's terms change; an offer pins the one it was
	 *  accepted under (`missions-and-requests.md` §1). */
	revision: number;
	title: string;
	purpose: string;
	danger: string;
	action: string;
	consequence: string;
	/** How much the job moves. A quantity is authored; *which good* is not. */
	tonnes: number;
	payment: PaymentRule;
}

const job = (row: JobRow): JobRow => row;

/**
 * The shipped catalogue.
 *
 * Courier rows outnumber procurement rows because D8 makes courier the floor:
 * a board is never empty, so the floor is what a pilot sees most and needs the
 * most variety.
 */
export const JOB_ROWS: readonly JobRow[] = [
	job({
		family: "courier",
		rowId: "courier-consignment",
		revision: 1,
		title: "Consignment run",
		purpose:
			"A broker has goods sold and no hull free to move them. The buyer is waiting.",
		danger:
			"An ordinary lane. Raiders work the approaches, and a loaded hull is what they look for.",
		action: "Carry the consignment and report at the delivery station.",
		consequence: "The buyer's shelf is supplied, and their price eases.",
		tonnes: 8,
		payment: { baseCr: 40, perTonneCr: 9, perLyCr: 14, basePriceFactor: 0 },
	}),
	job({
		family: "courier",
		rowId: "courier-priority",
		revision: 1,
		title: "Priority consignment",
		purpose:
			"A standing order was short-shipped. The station will pay for the hull that closes the gap.",
		danger:
			"No escort, and the cargo is known to be moving. Fly it like it matters.",
		action: "Carry the consignment and report at the delivery station.",
		consequence: "The gap in the order closes, and the price with it.",
		tonnes: 12,
		payment: { baseCr: 65, perTonneCr: 11, perLyCr: 18, basePriceFactor: 0 },
	}),
	job({
		family: "procurement",
		rowId: "procurement-shortfall",
		revision: 1,
		title: "Shortfall purchase",
		purpose:
			"The shelf here is thin and the station is buying, at its own expense and yours.",
		danger:
			"Your credits and your hold. Nothing is entrusted, and nothing is refunded.",
		action: "Source the goods anywhere and report here with them aboard.",
		consequence: "The shortfall is covered and this market settles.",
		tonnes: 10,
		payment: { baseCr: 25, perTonneCr: 0, perLyCr: 0, basePriceFactor: 1.35 },
	}),
];

/** A station a job may send the pilot to, and what reaching it costs in LY. */
export interface JobDestination {
	system: SystemRecord;
	station: Station;
	/** 0 within the posting system; never more than `JUMP_RANGE_LY`. */
	distanceLy: number;
}

/**
 * Every station a job may name as a delivery point: this system's other
 * stations, and the stations of every system one jump away.
 *
 * The ruling is the principal's (#411, 2026-09-20): one jump, within the jump
 * tank's capacity. `JUMP_RANGE_LY` is a jump's reach and `reachable` already
 * reads it; `tests/jobs.test.ts` holds it at or under `JUMP_TANK_LY`, which is
 * what makes "within the tank" a claim that can fail rather than a restatement
 * of the constant the filter uses. **`CommanderState.fuelLy` is not read here
 * and must not be** — see the module header. #185 is open on the per-hull
 * tank; when it closes, this is the function that owes it a second look.
 */
/**
 * The key a caller passes when no station is posting yet — a neighbourhood
 * cached per system and filtered per station (`main.ts`).
 */
export const NO_EXCLUDED_STATION = "" as CarrierKey;

export function deliveryCandidates(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	contentsOf: (record: SystemRecord) => SystemContents,
	/**
	 * The posting station's key. **Not its `id`**: `Station.id` is
	 * system-local, so `station-trade` names one station in every system in the
	 * galaxy (`system.ts`), and excluding by it would drop a neighbour's trade
	 * station while keeping the poster's own. `NO_EXCLUDED_STATION` excludes
	 * nothing, for a caller that caches one neighbourhood per system.
	 */
	excludeKey: CarrierKey,
): JobDestination[] {
	// **Only stations a job may name.** The filter is here rather than in the
	// binder because a binder that draws one candidate and then declines it is
	// a floor with a hole in it: D8 says a board is never empty, and a draw
	// landing on a station the market cannot price used to post nothing at all.
	const out: JobDestination[] = [];
	for (const station of contentsOf(from).stations)
		if (
			canPostJobs(station) &&
			carrierKey(from.index, station.localCarrierId) !== excludeKey
		)
			out.push({ system: from, station, distanceLy: 0 });
	for (const record of reachable(systems, from, JUMP_RANGE_LY))
		for (const station of contentsOf(record).stations)
			if (canPostJobs(station))
				out.push({
					system: record,
					station,
					distanceLy: distanceLy(from.pos, record.pos),
				});
	return out.sort(
		(a, b) =>
			a.distanceLy - b.distanceLy ||
			a.system.index - b.system.index ||
			(a.station.id < b.station.id ? -1 : 1),
	);
}

/** Everything a binder is allowed to read. */
export interface BindContext {
	galaxyIndex: number;
	system: SystemRecord;
	/** The posting station. */
	station: Station;
	destinations: readonly JobDestination[];
	deficits: DeficitMap;
	/**
	 * The clock in game **minutes**, which is the unit `economy-trade.md`
	 * §5.5's deficit rows are stamped in.
	 *
	 * An offer's own `observedAt` is in **seconds**, because the journal's
	 * clock is `world.gameTime` and the save validates every stamp against it
	 * — `observedAtOf` below is the one conversion, and it exists because the
	 * two units met in a field with no unit in its name.
	 */
	gameTimeMin: number;
	/**
	 * Settled jobs of each family at this requester, from the saved journal.
	 * Episode `n + 1` exists only once episode `n` has been reported, which is
	 * how repeatable work repeats without rerolling one offer
	 * (`missions-and-requests.md` §1).
	 */
	settled: Readonly<Record<string, number>>;
}

/** A station reference as the journal serializes it (request contract §1). */
export interface JobStationRef {
	galaxyIndex: number;
	carrierKey: CarrierKey;
}

/** A bound, offerable job: one row with every operand filled. */
export interface JobOffer {
	id: string;
	family: JobFamily;
	rowId: string;
	revision: number;
	/**
	 * The authored objectives, pinned at bind time.
	 *
	 * On the offer rather than derived from the family at load: a journal
	 * validated against a freshly derived list would refuse a legitimate save
	 * the day a family's stages change, which is the failure this module's
	 * header argues against everywhere else.
	 */
	stages: readonly string[];
	/** 1 for the first, `settled + 1` thereafter. */
	episode: number;
	requester: JobStationRef;
	requesterName: string;
	/** Where the pilot reports. A courier reports at its destination (#411's
	 *  P4); a procurement job reports where it was posted. */
	reportAt: JobStationRef;
	reportName: string;
	reportSystemName: string;
	distanceLy: number;
	goodName: string;
	tonnes: number;
	rewardCr: number;
	/** True when the cargo is the requester's (request contract §4's entrusted
	 *  lot), false when the pilot buys it with their own credits. */
	entrusted: boolean;
	title: string;
	purpose: string;
	danger: string;
	action: string;
	consequence: string;
	region: string;
	source: string;
	/** Game **seconds** — the journal's clock (`world.gameTime`), not the
	 *  minutes a deficit row is stamped in. */
	observedAt: number;
}

/** The binder's minute clock as the journal's second clock. */
const observedAtOf = (ctx: BindContext): number =>
	Math.round(ctx.gameTimeMin * 60);

/** §4's mark, less the two numbers only the caller knows. */
export interface JobMark {
	key: CarrierKey;
	trade: { goodName: string; units: number };
}

/**
 * What reporting a job writes into the world: the destination's stock deficit
 * moves, through the same write a trade uses.
 *
 * `holdT` and the clock stay the caller's, because `recordTrade` requires the
 * **flown** hull's hold (#182) and this module never sees a commander.
 */
export const jobMark = (offer: JobOffer): JobMark => ({
	key: offer.reportAt.carrierKey,
	// Supplying a station is the sale sign (`economy-trade.md` §5.2).
	trade: { goodName: offer.goodName, units: -offer.tonnes },
});

/**
 * A station can post or receive market-derived work only if the market can
 * price it — `station-types.md` §3 still owes the outpost a price offset.
 *
 * **Nothing in a generated galaxy fails this today**, and that is measured
 * rather than assumed: `system.ts` places no outposts at all (the spec says so
 * in as many words at §7.1's ranking). So this is the guard that holds when one
 * is placed, not a filter doing work now — a red build that put the old
 * per-draw decline back stayed green for exactly that reason.
 */
export const canPostJobs = (station: Station): boolean =>
	station.type !== "outpost";

const stationKeyOf = (systemIndex: number, station: Station): CarrierKey =>
	carrierKey(systemIndex, station.localCarrierId);

/** Base price with no fluctuation byte and no deficit response — the fixed
 *  half of `economy-trade.md` §3, which is what a binder may read. */
const basePriceCr = (
	commodity: Commodity,
	system: SystemRecord,
	station: Station,
): number =>
	marketRowAt(
		commodity,
		system.economy,
		0,
		marketStationOf(station, system.seed).type,
	).priceCr;

const listedAt = (station: Station, system: SystemRecord): Commodity[] => [
	...stationCommodities(marketStationOf(station, system.seed)),
];

/** The episode draw. Its own domain tag, so a board moves no station, berth or
 *  market — and split by the episode, so consecutive episodes of one family do
 *  not repeat one row. */
const draw = (
	station: Station,
	family: JobFamily,
	episode: number,
	/** Which operand this draw decides. Its own axis rather than an offset on
	 *  the episode's, because two sub-streams sharing one namespace is the
	 *  collision `DOMAIN` exists to prevent: shifting the episode by a constant
	 *  makes one axis's draw at episode n the other's at episode n + k. */
	axis: number,
): number =>
	seededRand(
		mix(
			mix(
				mix(station.berthSeed ^ station.assemblySeed, DOMAIN.JOB_OFFERS),
				axis,
			),
			mix(family === "courier" ? 1 : 2, episode),
		),
	)();

/** The draw axes inside `DOMAIN.JOB_OFFERS`. */
const AXIS = { row: 0, destination: 1 } as const;

const episodeOf = (ctx: BindContext, family: JobFamily): number =>
	(ctx.settled[family] ?? 0) + 1;

const offerId = (
	ctx: BindContext,
	family: JobFamily,
	episode: number,
): string =>
	`request-v1/${ctx.galaxyIndex}/${ctx.system.index}/${encodeURIComponent(
		ctx.station.localCarrierId,
	)}/${family}-${episode}`;

const rowsFor = (family: JobFamily): JobRow[] =>
	JOB_ROWS.filter((row) => row.family === family);

const pickRow = (ctx: BindContext, family: JobFamily, episode: number) => {
	const rows = rowsFor(family);
	return rows[
		Math.min(
			rows.length - 1,
			Math.floor(draw(ctx.station, family, episode, AXIS.row) * rows.length),
		)
	];
};

const round = (cr: number): number => Math.round(cr);

/**
 * D8's floor: a consignment to a reachable station, always available.
 *
 * The good is the **cheapest tonne good both stations list**, read off the
 * fixed base price rather than the epoch's, so terms do not drift across a
 * 30-minute boundary while the offer sits on the board. It must be listed at
 * the delivery station too, or the mark would land on a shelf that does not
 * exist.
 *
 * Cheapest is a proxy for *what this economy has to spare*, and it is not the
 * same thing: an economy's true exports are its negative-gradient goods
 * (`economy-trade.md` §2), and a richer rule would read the gradient rather
 * than the price. It is deliberately left as the simple one until a family
 * needs better, and the word "export" is not used for it, because on most
 * boards it picks Food.
 */
export function bindCourier(ctx: BindContext): JobOffer | null {
	if (ctx.destinations.length === 0) return null;
	const episode = episodeOf(ctx, "courier");
	const row = pickRow(ctx, "courier", episode);
	const index = Math.floor(
		draw(ctx.station, "courier", episode, AXIS.destination) *
			ctx.destinations.length,
	);
	const destination =
		ctx.destinations[Math.min(index, ctx.destinations.length - 1)];

	const listedThere = new Set(
		listedAt(destination.station, destination.system).map((c) => c.name),
	);
	// **Tonnes of a legal good, or none of the arithmetic downstream holds.**
	// `entrustedTonnesAboard`, the hold's room and the mark all count tonnes,
	// and contraband is the one scoped class (`economy-trade.md` §4) — a
	// consignment of it would be a job the law model never agreed to.
	const priced = listedAt(ctx.station, ctx.system)
		.filter(
			(c) =>
				listedThere.has(c.name) && !c.sellOnly && !c.illegal && c.unit === "t",
		)
		// Priced once per commodity rather than twice per comparison: this runs
		// on every bind, which is every dock.
		.map((c) => ({ c, priceCr: basePriceCr(c, ctx.system, ctx.station) }))
		.sort((a, b) => a.priceCr - b.priceCr || (a.c.name < b.c.name ? -1 : 1));
	const good = priced[0]?.c;
	if (!good) return null;

	return {
		id: offerId(ctx, "courier", episode),
		family: "courier",
		rowId: row.rowId,
		revision: row.revision,
		stages: ["deliver"],
		episode,
		requester: {
			galaxyIndex: ctx.galaxyIndex,
			carrierKey: stationKeyOf(ctx.system.index, ctx.station),
		},
		requesterName: ctx.station.name,
		reportAt: {
			galaxyIndex: ctx.galaxyIndex,
			carrierKey: stationKeyOf(destination.system.index, destination.station),
		},
		reportName: destination.station.name,
		reportSystemName: destination.system.name,
		distanceLy: destination.distanceLy,
		goodName: good.name,
		tonnes: row.tonnes,
		rewardCr: round(
			row.payment.baseCr +
				row.payment.perTonneCr * row.tonnes +
				row.payment.perLyCr * destination.distanceLy,
		),
		entrusted: true,
		title: row.title,
		purpose: row.purpose,
		danger: row.danger,
		action: row.action,
		consequence: row.consequence,
		region: `${destination.station.name}, ${destination.system.name}`,
		source: `Freight desk at ${ctx.station.name}`,
		observedAt: observedAtOf(ctx),
	};
}

/** §5.5's deficit is in units and a row is dropped under one; a shortfall
 *  worth posting is larger than a rounding error. */
export const PROCUREMENT_MIN_DEFICIT_T = 4;

/**
 * D8's derivation: a station posts a purchase because its shelf is **actually**
 * thin — the good with the largest positive deficit it has.
 *
 * **This one is a function of the deficit, which decays** — the courier's
 * terms are bound off the fixed base price so they do not drift across a
 * market epoch, while a procurement job's good and tonnage follow
 * `economy-trade.md` §5.5's half-life. That is D8's need-as-throttle rather
 * than a reroll: the shelf filling up is the world changing, and §1's rule is
 * about an offer regenerating on a *docking* or a clock epoch. An accepted job
 * pins its terms and is unaffected either way.
 *
 * **What a docked pilot sees is not that decay, and the difference is
 * deliberate.** `main.ts` binds a board once per visit and re-binds it on the
 * console revision a till or a request action bumps, never on the clock — an
 * offer that shrank while the pilot read it would be the board rewriting
 * itself under them. So the decay reaches the board at the next visit, or at
 * the next trade; the binder is a pure function of the deficit it is handed,
 * and `tests/jobs.test.ts` measures it at that level because that is the level
 * it is true at.
 *
 * Nothing is entrusted: the pilot buys with their own credits and carries the
 * loss, which is the axis that makes this a different decision from a courier
 * run (`ordinary-requests.md` §1).
 */
export function bindProcurement(ctx: BindContext): JobOffer | null {
	if (!canPostJobs(ctx.station)) return null;
	const key = stationKeyOf(ctx.system.index, ctx.station);
	const episode = episodeOf(ctx, "procurement");
	const row = pickRow(ctx, "procurement", episode);

	let best: { commodity: Commodity; units: number } | null = null;
	for (const commodity of listedAt(ctx.station, ctx.system)) {
		if (commodity.illegal || commodity.unit !== "t") continue;
		const units = readDeficit(
			ctx.deficits,
			key,
			commodity.name,
			ctx.gameTimeMin,
		);
		if (units < PROCUREMENT_MIN_DEFICIT_T) continue;
		if (!best || units > best.units) best = { commodity, units };
	}
	if (!best) return null;

	const tonnes = Math.min(row.tonnes, Math.floor(best.units));
	const base = basePriceCr(best.commodity, ctx.system, ctx.station);
	return {
		id: offerId(ctx, "procurement", episode),
		family: "procurement",
		rowId: row.rowId,
		revision: row.revision,
		stages: ["deliver"],
		episode,
		requester: { galaxyIndex: ctx.galaxyIndex, carrierKey: key },
		requesterName: ctx.station.name,
		reportAt: { galaxyIndex: ctx.galaxyIndex, carrierKey: key },
		reportName: ctx.station.name,
		reportSystemName: ctx.system.name,
		distanceLy: 0,
		goodName: best.commodity.name,
		tonnes,
		rewardCr: round(
			row.payment.baseCr + base * row.payment.basePriceFactor * tonnes,
		),
		entrusted: false,
		title: row.title,
		purpose: row.purpose,
		danger: row.danger,
		action: row.action,
		consequence: row.consequence,
		region: `${ctx.station.name}, ${ctx.system.name}`,
		source: `Purchasing office at ${ctx.station.name}`,
		observedAt: observedAtOf(ctx),
	};
}

/**
 * The board: every family binder that found its world fact, at this station.
 *
 * §3: the offer count is not a configured number. It is however many binders
 * bound, plus D8's floor.
 */
export function bindJobs(ctx: BindContext): JobOffer[] {
	if (!canPostJobs(ctx.station)) return [];
	return [bindCourier(ctx), bindProcurement(ctx)].filter(
		(offer): offer is JobOffer => offer !== null,
	);
}
