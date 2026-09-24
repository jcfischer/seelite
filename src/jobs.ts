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
 * **What a job is *about* is a discriminated `operand`** (#440, built in #453),
 * not three flat fields. `goodName`, `tonnes` and `entrusted` were required of
 * every offer because both shipped families move cargo — and **Bounty and
 * Salvage do not**, so a third family would have had to change the persisted
 * shape and migrate every save in the same change that authored its content.
 * The shape moved first and alone, because the migration is the expensive part
 * and an in-flight shape is cheap to change late. **It paid off in #508**: the
 * Bounty family's target carrier is a second member of the union, and the save
 * stayed at version 5 because every v5 journal is still a valid one. A
 * salvage's wreck is not written yet.
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
	LONG_RANGE_SCANNER,
	marketRowAt,
	marketStationOf,
	stationCommodities,
} from "./market";
import { mix, seededRand } from "./rng";
import type { Station, SystemContents } from "./system";

export type JobFamily = "courier" | "procurement" | "bounty";

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
	/** How much the job moves. A quantity is authored; *which good* is not.
	 *  Zero for a family that moves no cargo. */
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
		// Revision 2: plain words, at the principal's request (#508 follow-up).
		revision: 2,
		title: "Consignment run",
		purpose:
			"A broker has sold a load of goods and has no ship to move it. The buyer is waiting.",
		danger:
			"A normal route, but raiders watch the approaches for loaded ships.",
		action: "Take the goods to the delivery station and report there.",
		consequence:
			"The buyer gets the goods, and the price there drops a little.",
		tonnes: 8,
		payment: { baseCr: 40, perTonneCr: 9, perLyCr: 14, basePriceFactor: 0 },
	}),
	job({
		family: "courier",
		rowId: "courier-priority",
		// #459 rewrote this row's purpose, danger and consequence. An accepted
		// offer pins the revision it was taken under, so terms a pilot was shown
		// get a new number even when only the words moved.
		// Revision 3: plain words again, at the principal's request.
		revision: 3,
		title: "Urgent delivery",
		purpose:
			"A regular order arrived short. The station pays extra to get the rest there quickly.",
		danger: "There is no escort, and raiders have heard about this shipment.",
		action: "Take the goods to the delivery station and report there.",
		consequence: "The order is complete, and the price there settles back.",
		tonnes: 12,
		payment: { baseCr: 65, perTonneCr: 11, perLyCr: 18, basePriceFactor: 0 },
	}),
	job({
		family: "procurement",
		rowId: "procurement-shortfall",
		// Revision 2: plain words, at the principal's request (#508 follow-up).
		revision: 2,
		title: "Supply order",
		purpose: "This station is running low and pays you to bring more.",
		danger:
			"You buy the goods with your own money. If you lose them, nobody pays you back.",
		action: "Buy the goods anywhere, bring them here and report.",
		consequence: "The station has stock again, and its price drops back.",
		tonnes: 10,
		payment: { baseCr: 25, perTonneCr: 0, perLyCr: 0, basePriceFactor: 1.35 },
	}),
	// **One row, for the one target kind that exists.** #509 adds the raider
	// outpost, and its row owes the binder a pairing between row and target
	// kind: `pickRow` draws among a family's rows, and relay prose on an
	// outpost is the invented fact this table exists to avoid.
	job({
		family: "bounty",
		rowId: "bounty-relay",
		// Revision 2: the principal read revision 1's words as machine-written.
		// An accepted offer keeps the words it was taken under.
		revision: 2,
		title: "Pirate relay bounty",
		purpose:
			"Someone has put a pirate relay on this approach. It reports passing ships to the raiders. Security wants it gone.",
		danger:
			"The relay has no weapons, but raiders use this approach, so expect company while you look for it.",
		action: "Destroy the relay, then come back here to collect.",
		consequence:
			"Raiders stop getting reports on this approach until they replace the relay.",
		tonnes: 0,
		// #508 D3: the principal's figure. The kill is undefended until #511
		// gives the relay a defender, which owes this figure a second look.
		payment: { baseCr: 400, perTonneCr: 0, perLyCr: 0, basePriceFactor: 0 },
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
	/**
	 * The system's Bounty target, **operational now**, or null (#495 D4).
	 *
	 * The caller derives it (`pirate-relay.ts`'s `bountyTargetOf`) because the
	 * condition is world state this module does not read, and a binder is a
	 * pure function of what it is handed. Required rather than optional, for
	 * `holdT`'s reason: a caller that forgot it would post no bounty anywhere
	 * and look exactly like a galaxy with no relays.
	 */
	bountyTarget: BountyTarget | null;
}

/**
 * Something a Bounty job may name (#495 D3): a carrier in the posting station's
 * own system — the binder never reads another system's state (#495 D4).
 */
export interface BountyTarget {
	carrierKey: CarrierKey;
	/** What the pilot calls it — the name the log and the cockpit use. */
	name: string;
	/** The station whose approach it stands on; the offer's region. */
	watchedStationName: string;
}

/** A station reference as the journal serializes it (request contract §1). */
export interface JobStationRef {
	galaxyIndex: number;
	carrierKey: CarrierKey;
}

/**
 * What a job is about, tagged by the family that owns the tag (#440).
 *
 * The union is the point rather than any member: a `switch` on `kind` with a
 * `never` default means that when Salvage's wreck arrives, as Bounty's target
 * did in #508, every **typed** reader fails to compile instead of quietly
 * reading a field that is not there.
 *
 * The qualifier matters. `scripts/probe-requests.mjs` reads
 * `offer.operand.goodName` and is not typechecked, so a non-cargo operand
 * reaches it as `undefined` rather than as a build error — the browser tier
 * inherits the question a family adds, and the compiler will not raise it.
 * #453's own round 1 went red there rather than at the compiler.
 */
export type JobOperand = CargoOperand | TargetOperand;

export interface CargoOperand {
	kind: "cargo";
	goodName: string;
	tonnes: number;
	/** True when the cargo is the requester's (request contract §4's entrusted
	 *  lot), false when the pilot buys it with their own credits. */
	entrusted: boolean;
}

/** A Bounty's target (#495 D3): a carrier key, and the name it was posted
 *  under. The name is pinned with the terms, as `reportName` is. */
export interface TargetOperand {
	kind: "target";
	carrierKey: CarrierKey;
	targetName: string;
}

/** An offer already known to carry cargo — what a courier or procurement
 *  binder returns, and what a reader that has checked may name. */
export type CargoOffer = JobOffer & { operand: CargoOperand };

export const isCargoOffer = (offer: JobOffer): offer is CargoOffer =>
	offer.operand.kind === "cargo";

/** The cargo a job moves, or null for a family that moves none. One question
 *  asked in one place, rather than a `kind` test at every hold consumer. */
export const cargoOf = (offer: { operand: JobOperand }): CargoOperand | null =>
	offer.operand.kind === "cargo" ? offer.operand : null;

/**
 * Which operand each family carries — the pairing, as a total record.
 *
 * **A `Record<JobFamily, …>` rather than a list of family names**, because a
 * list is what the validator had and a list does not fail on a family it has
 * never heard of. Add a member to `JobFamily` and this stops compiling until
 * it says what that family is *about*; `requests.ts` reads both the key set
 * and the value here, so neither the accepted families nor the family→kind
 * pairing is written down a second time.
 *
 * It does not make a *new cargo family* a compile error at the validator —
 * that is a value in this table, not a type — and the sentence above is the
 * whole of what the exhaustiveness buys. The `never` in `operandOk` covers
 * the **kind**; this covers the family.
 */
export const FAMILY_OPERAND_KIND: Readonly<
	Record<JobFamily, JobOperand["kind"]>
> = {
	courier: "cargo",
	procurement: "cargo",
	bounty: "target",
};

/**
 * What a Bounty offer requires before it can be accepted (#489's ruling,
 * built in #508).
 *
 * **The Long-Range Scanner, because it is what finds a relay** (#479): without
 * it the relay gives no cue, no contact and no target, so an unfitted pilot
 * who accepted would hold a job for something they cannot see.
 * `carrier-identity.md` F4 gates Bounty on the *Identity Scanner* instead, and
 * that is the gate for a target whose standing has to be read off its hull —
 * a Wanted carrier, which #495 left out of scope. A relay has no standing to
 * scan.
 */
export const BOUNTY_EQUIPMENT: readonly string[] = [LONG_RANGE_SCANNER];

/**
 * The equipment an offer requires, derived from its family rather than pinned
 * on the offer: `JobOffer` is persisted, and a new field there is a save
 * version. Acceptance is the only moment it is read (request contract §2).
 */
export const offerRequirements = (offer: {
	family: JobFamily;
}): readonly string[] => (offer.family === "bounty" ? BOUNTY_EQUIPMENT : []);

/** What an offer requires that this equipment list lacks — the one rule the
 *  locked row and the accept refusal both read, so they cannot drift. */
export const missingRequirements = (
	offer: { family: JobFamily },
	equipment: readonly string[],
): readonly string[] =>
	offerRequirements(offer).filter((item) => !equipment.includes(item));

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
	/** What this job is about — the one field a family may shape (#440). */
	operand: JobOperand;
	rewardCr: number;
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
 *
 * **It stays cargo-shaped, and that is #440's D3** rather than an omission: a
 * mark never reaches a save. A Bounty's mark (`ordinary-requests.md` §4) is
 * the target's `destroy` with the player's provenance, which the kill wrote
 * when it happened — so its report writes nothing and this returns null.
 */
export const jobMark = (offer: JobOffer): JobMark | null => {
	const cargo = cargoOf(offer);
	if (!cargo) return null;
	return {
		key: offer.reportAt.carrierKey,
		// Supplying a station is the sale sign (`economy-trade.md` §5.2).
		trade: { goodName: cargo.goodName, units: -cargo.tonnes },
	};
};

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

/**
 * Each family's sub-stream inside `DOMAIN.JOB_OFFERS`.
 *
 * **A total record, not a ternary.** The draw used to split on
 * `family === "courier" ? 1 : 2`, and a third family would have shared the
 * second's stream without a word from the compiler — the correlation
 * `CLAUDE.md`'s per-system RNG rule warns about. The two shipped values are
 * kept, so no courier or procurement board moves.
 */
const FAMILY_STREAM: Readonly<Record<JobFamily, number>> = {
	courier: 1,
	procurement: 2,
	bounty: 3,
};

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
			mix(FAMILY_STREAM[family], episode),
		),
	)();

/** The draw axes inside `DOMAIN.JOB_OFFERS`. */
const AXIS = { row: 0, destination: 1, good: 2 } as const;

/**
 * How many of the widest-spread goods a courier consignment is drawn from.
 *
 * Tunable, and both ends of it say something. At 1 the rule is the ranking
 * alone, which is another near-constant: the spread's own column is two goods
 * over most of a galaxy's boards, the way the cheapest rule's was Food. At or
 * above the pool's own size the draw is uniform and the ranking decides
 * nothing at all. **No figure is quoted here on purpose** —
 * `scripts/measure-courier-goods.ts` owns every one of them beside the run
 * that produces it, and a copy in this module is a claim about a seed that
 * goes stale when the pool, the ranking or the generator moves.
 * `tests/jobs.test.ts` holds both ends structurally: the width against the
 * pool it ranks, and every rank in that width actually drawn.
 */
export const COURIER_SPREAD_POOL = 3;

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
 * The good is drawn, per episode, from the `COURIER_SPREAD_POOL` tonne goods
 * with the **widest base-price spread between the two ends** — the
 * destination's price less the origin's — read off the fixed base price rather
 * than the epoch's, so terms do not drift across a 30-minute boundary while the
 * offer sits on the board. It must be listed at the delivery station too, or
 * the mark would land on a shelf that does not exist.
 *
 * The spread is a proxy, exactly as the cheapest rule it replaced was (#442):
 * whether the widest price gap is a freight desk's actual reason for moving
 * something is not a question a measurement can answer, and this rule is not
 * derived from one. What the measurement does say is narrower than it first
 * looks. **A gradient rule cannot vary**: a gradient belongs to the commodity
 * table and not to a station, so an export or a need test names one good for
 * the whole galaxy. That is not a claim about one-end rules in general — the
 * cheapest rule reads one end and does vary, just barely, over two goods.
 *
 * **The draw earns its place on a different axis from the ranking.** Ranked
 * alone, the spread already varies well across *space* — a pilot within one
 * jump sees about three goods under it against one and a half under the
 * cheapest rule. What it cannot do is vary at **one requester**: the ranking
 * is a function of the two stations, so a second consignment down the same leg
 * is the first one again, and one good takes 44.6% of a galaxy's boards. That
 * repetition at one desk is `ordinary-requests.md` D1's texture question and
 * #442's second one, and the per-episode draw is the only half of this rule
 * that answers it. `scripts/measure-courier-goods.ts` prints both tables.
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
	const ranked = listedAt(ctx.station, ctx.system)
		.filter(
			(c) =>
				listedThere.has(c.name) && !c.sellOnly && !c.illegal && c.unit === "t",
		)
		// Both ends priced once per commodity rather than twice per comparison:
		// this runs on every bind, which is every dock.
		.map((c) => ({
			c,
			spread:
				basePriceCr(c, destination.system, destination.station) -
				basePriceCr(c, ctx.system, ctx.station),
		}))
		.sort((a, b) => b.spread - a.spread || (a.c.name < b.c.name ? -1 : 1));
	if (ranked.length === 0) return null;
	// Defensive and uncovered: `tests/jobs.test.ts` asserts the pool is wider
	// than the constant on every board of the first 60 systems of one galaxy,
	// which is the only place it has been measured — the instrument's control
	// passes vacuously on a pool of three or fewer. A narrower pool is a
	// market change, not a state this rule produces.
	const width = Math.min(COURIER_SPREAD_POOL, ranked.length);
	const good =
		ranked[
			Math.min(
				width - 1,
				Math.floor(draw(ctx.station, "courier", episode, AXIS.good) * width),
			)
		].c;

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
		operand: {
			kind: "cargo",
			goodName: good.name,
			tonnes: row.tonnes,
			entrusted: true,
		},
		rewardCr: round(
			row.payment.baseCr +
				row.payment.perTonneCr * row.tonnes +
				row.payment.perLyCr * destination.distanceLy,
		),
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
		operand: {
			kind: "cargo",
			goodName: best.commodity.name,
			tonnes,
			// Nothing is entrusted: the pilot buys with their own credits and
			// carries the loss, which is the axis that makes this a different
			// decision from a courier run (`ordinary-requests.md` §1).
			entrusted: false,
		},
		rewardCr: round(
			row.payment.baseCr + base * row.payment.basePriceFactor * tonnes,
		),
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
 * D8's derivation for Bounty: a station posts one because its system's target
 * is **actually** operational (#495 D4, #508).
 *
 * Every lawful station in the system posts it, and each is claimed where it
 * was posted. The throttle is the target's own lifecycle — while the relay is
 * destroyed or repairing, `bountyTarget` is null and nothing posts — so there
 * is no cooldown here, which is `ordinary-requests.md` D9.
 *
 * **The raider outpost is refused here, not in `canPostJobs`.** That guard
 * exists for the outpost's missing price offset, which #490 D6 removes; this
 * one exists because a raider haven does not pay to kill raiders' equipment,
 * and the two must not be one predicate that retires together.
 */
export function bindBounty(ctx: BindContext): JobOffer | null {
	const target = ctx.bountyTarget;
	if (!target || ctx.station.type === "outpost") return null;
	const key = stationKeyOf(ctx.system.index, ctx.station);
	const episode = episodeOf(ctx, "bounty");
	const row = pickRow(ctx, "bounty", episode);
	return {
		id: offerId(ctx, "bounty", episode),
		family: "bounty",
		rowId: row.rowId,
		revision: row.revision,
		stages: ["destroy"],
		episode,
		requester: { galaxyIndex: ctx.galaxyIndex, carrierKey: key },
		requesterName: ctx.station.name,
		reportAt: { galaxyIndex: ctx.galaxyIndex, carrierKey: key },
		reportName: ctx.station.name,
		reportSystemName: ctx.system.name,
		distanceLy: 0,
		operand: {
			kind: "target",
			carrierKey: target.carrierKey,
			targetName: target.name,
		},
		rewardCr: round(row.payment.baseCr),
		title: row.title,
		purpose: row.purpose,
		danger: row.danger,
		action: row.action,
		consequence: row.consequence,
		// **The region, not the place** (request contract §2): the approach it
		// watches, which is `RELAY_REGION_KM`'s search sphere. Posting it
		// discovers nothing — only a flown identification writes the knowledge
		// row (#460's provenance-never-discovery constraint).
		region: `The approach to ${target.watchedStationName}, ${ctx.system.name}`,
		source: `Security office at ${ctx.station.name}`,
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
	return [bindCourier(ctx), bindProcurement(ctx), bindBounty(ctx)].filter(
		(offer): offer is JobOffer => offer !== null,
	);
}
