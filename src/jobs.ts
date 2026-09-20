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
 * clock.** It reads no commander state — not the tank, not the hold, not the
 * credits — because the request contract §1 forbids a fixed offer being
 * regenerated on docking, and a board that changed when the pilot bought fuel
 * would be exactly that. The offer prints what it costs to reach; the pilot
 * decides.
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
	/** Stable authored identity, and the first half of an offer's slot. */
	slot: string;
	/** Bumped when the row's terms change; an accepted request pins the one it
	 *  was accepted under (`missions-and-requests.md` §1). */
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
		slot: "courier-consignment",
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
		slot: "courier-priority",
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
		slot: "procurement-shortfall",
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
 * The ruling is the principal's (#411, 2026-09-20): one jump, within the
 * tank's capacity. `JUMP_RANGE_LY` is that capacity and `reachable` already
 * reads it. **`CommanderState.fuelLy` is not read here and must not be** — see
 * the module header. #185 is open on per-hull fuel; when it closes, this is
 * the function that owes it a second look.
 */
export function deliveryCandidates(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	contentsOf: (record: SystemRecord) => SystemContents,
	/**
	 * The posting station's key. **Not its `id`**: `Station.id` is
	 * system-local, so `station-trade` names one station in every system in the
	 * galaxy (`system.ts`), and excluding by it would drop a neighbour's trade
	 * station while keeping the poster's own.
	 */
	excludeKey: CarrierKey,
): JobDestination[] {
	const out: JobDestination[] = [];
	for (const station of contentsOf(from).stations)
		if (carrierKey(from.index, station.localCarrierId) !== excludeKey)
			out.push({ system: from, station, distanceLy: 0 });
	for (const record of reachable(systems, from, JUMP_RANGE_LY))
		for (const station of contentsOf(record).stations)
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
	rowSlot: string;
	revision: number;
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
	observedAt: number;
}

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

/** A station can post market-derived work only if the market can price it —
 *  `station-types.md` §3 still owes the outpost a price offset. */
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
const draw = (station: Station, family: JobFamily, episode: number): number =>
	seededRand(
		mix(
			mix(station.berthSeed ^ station.assemblySeed, DOMAIN.JOB_OFFERS),
			mix(family === "courier" ? 1 : 2, episode),
		),
	)();

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
			Math.floor(draw(ctx.station, family, episode) * rows.length),
		)
	];
};

const round = (cr: number): number => Math.round(cr);

/**
 * D8's floor: a consignment to a reachable station, always available.
 *
 * The good is an **export** of the posting system — the cheapest thing its
 * economy lists — read off the fixed base price rather than the epoch's, so
 * terms do not drift across a 30-minute boundary while the offer sits on the
 * board. It must be a good the delivery station lists too, or the mark would
 * land on a shelf that does not exist.
 */
export function bindCourier(ctx: BindContext): JobOffer | null {
	if (ctx.destinations.length === 0) return null;
	const episode = episodeOf(ctx, "courier");
	const row = pickRow(ctx, "courier", episode);
	const index = Math.floor(
		draw(ctx.station, "courier", episode + 1000) * ctx.destinations.length,
	);
	const destination =
		ctx.destinations[Math.min(index, ctx.destinations.length - 1)];
	if (!canPostJobs(destination.station)) return null;

	const listedThere = new Set(
		listedAt(destination.station, destination.system).map((c) => c.name),
	);
	const good = listedAt(ctx.station, ctx.system)
		.filter((c) => listedThere.has(c.name) && !c.sellOnly)
		.sort(
			(a, b) =>
				basePriceCr(a, ctx.system, ctx.station) -
					basePriceCr(b, ctx.system, ctx.station) || (a.name < b.name ? -1 : 1),
		)[0];
	if (!good) return null;

	return {
		id: offerId(ctx, "courier", episode),
		family: "courier",
		rowSlot: row.slot,
		revision: row.revision,
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
		observedAt: ctx.gameTimeMin,
	};
}

/** §5.5's deficit is in units and a row is dropped under one; a shortfall
 *  worth posting is larger than a rounding error. */
export const PROCUREMENT_MIN_DEFICIT_T = 4;

/**
 * D8's derivation: a station posts a purchase because its shelf is **actually**
 * thin — the good with the largest positive deficit it has.
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
		rowSlot: row.slot,
		revision: row.revision,
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
		observedAt: ctx.gameTimeMin,
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
