/**
 * Node 411: the authored job rows and their binders (`ordinary-requests.md`
 * D1–D3, §2).
 *
 * A row is prose and a rule; a binder is the only thing that may name a
 * commodity, a carrier or a station. These rows check that boundary rather
 * than the text on either side of it — the text is the principal's to read on
 * a board, and a test that asserted its wording would go red on every edit.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	JUMP_RANGE_LY,
	type SystemRecord,
	generateGalaxy,
} from "../src/galaxy";
import {
	COURIER_SPREAD_POOL,
	JOB_ROWS,
	type JobDestination,
	type JobOffer,
	bindJobs as bindJobsWith,
	canPostJobs,
	deliveryCandidates,
	jobMark,
} from "../src/jobs";
// `JUMP_TANK_LY` is the jump tank's capacity (`hyperspace.ts`), in LY.
import { JUMP_TANK_LY } from "../src/hyperspace";
import {
	boardAt,
	boardContext,
	postingStations,
	stationKeyOf,
} from "./helpers/job-board";
import {
	type Commodity,
	MARKET_PERIOD_MIN,
	marketRowAt,
	marketStationOf,
	stationCommodities,
} from "../src/market";
import { recordTrade } from "../src/deficits";
import type { DeficitMap } from "../src/deficits";
import { type Station, generateContents } from "../src/system";

const WORLD = 0x5ee11e;
const GALAXY = generateGalaxy(WORLD, 0);
const SYSTEMS = GALAXY.systems;

/** The first system in this galaxy whose first station can price a market —
 *  `station-types.md` §3 still owes the outpost a price offset, so an outpost
 *  posts no market-derived work and is not what these rows are about. */
const priceable = (): { index: number; stationId: string } => {
	for (const record of SYSTEMS) {
		const station = generateContents(record).stations.find(
			(s) => s.type !== "outpost",
		);
		if (
			station &&
			deliveriesFrom(record.index, station.localCarrierId).length > 0
		)
			return { index: record.index, stationId: station.id };
	}
	throw new Error("no priceable station with a destination in this galaxy");
};

const deliveriesFrom = (systemIndex: number, localCarrierId: string) =>
	deliveryCandidates(
		SYSTEMS,
		SYSTEMS[systemIndex],
		generateContents,
		carrierKey(systemIndex, localCarrierId),
	);

/** The board, through the one helper every caller binds with. */
const bindJobs = (ctx: ReturnType<typeof contextAt>) =>
	boardAt(SYSTEMS, ctx.system, ctx.station, {
		deficits: ctx.deficits,
		gameTimeMin: ctx.gameTimeMin,
		settled: ctx.settled,
	});

interface ContextOptions {
	deficits?: DeficitMap;
	gameTimeMin?: number;
	settled?: Record<string, number>;
}

const stationOf = (systemIndex: number, stationId: string) => {
	const station = generateContents(SYSTEMS[systemIndex]).stations.find(
		(s) => s.id === stationId,
	);
	if (!station) throw new Error(`no station ${stationId}`);
	return station;
};

const contextAt = (
	systemIndex: number,
	stationId: string,
	options: ContextOptions = {},
) =>
	boardContext(
		SYSTEMS,
		SYSTEMS[systemIndex],
		stationOf(systemIndex, stationId),
		{
			deficits: options.deficits,
			gameTimeMin: options.gameTimeMin ?? 120,
			settled: options.settled,
		},
	);

const HERE = priceable();

describe("D3 — a row is authored prose, a binder supplies every operand", () => {
	test("no authored row names a commodity, a carrier or a station", () => {
		const forbidden = [
			"commodity",
			"goodName",
			"good",
			"carrierKey",
			"station",
			"stationId",
			"destination",
			"requester",
		];
		for (const row of JOB_ROWS)
			for (const key of forbidden) expect(row).not.toHaveProperty(key);
		expect(JOB_ROWS.length).toBeGreaterThan(0);
	});

	test("every family in the table has at least one row", () => {
		for (const family of ["courier", "procurement"] as const)
			expect(JOB_ROWS.some((row) => row.family === family)).toBe(true);
	});
});

describe("§2 — a binder is a pure function of station, world and clock", () => {
	test("the same station, world and clock bind the same board twice", () => {
		const first = bindJobs(contextAt(HERE.index, HERE.stationId));
		const second = bindJobs(contextAt(HERE.index, HERE.stationId));
		expect(second).toEqual(first);
		expect(first.length).toBeGreaterThan(0);
	});

	test("courier terms do not reroll across a market epoch boundary", () => {
		// Courier terms only, and the name says so: a procurement offer reads
		// the deficit, which decays on the clock — the row below measures that
		// deliberately rather than leaving it to a fixture with no deficits in
		// it, which is what made this row's earlier name overclaim.
		const before = bindJobs(
			contextAt(HERE.index, HERE.stationId, { gameTimeMin: 10 }),
		);
		const after = bindJobs(
			contextAt(HERE.index, HERE.stationId, {
				gameTimeMin: 10 + MARKET_PERIOD_MIN * 3,
			}),
		);
		const terms = (offers: JobOffer[]) =>
			offers.map((o) => ({
				id: o.id,
				goodName: o.goodName,
				tonnes: o.tonnes,
				rewardCr: o.rewardCr,
				reportAt: o.reportAt,
			}));
		expect(terms(after)).toEqual(terms(before));
	});

	test('the tank reaches a jump, so "one jump within it" can fail', () => {
		// The destination filter reads `JUMP_RANGE_LY`, so a check against that
		// same constant restates it. The principal's ruling was about the
		// **tank**, and this is the line where the two meet.
		expect(JUMP_RANGE_LY).toBeLessThanOrEqual(JUMP_TANK_LY);
	});

	test("a station with no reachable destination posts nothing, loudly", () => {
		// The decline path the floor's claim depends on: it exists, and after
		// this round it is the *only* one. The courier used to decline a second
		// way — a destination the market cannot price, drawn out of an
		// unfiltered candidate list — and this row is what holds the candidate
		// list to stations a job may name.
		const ctx = contextAt(HERE.index, HERE.stationId);
		expect(bindJobsWith({ ...ctx, destinations: [] })).toEqual([]);
		for (const destination of ctx.destinations)
			expect(canPostJobs(destination.station)).toBe(true);
	});

	test("D8's courier floor binds at any station with a destination", () => {
		// **Three galaxies, the first 60 systems of each, every posting station
		// in them.** A quarter of a galaxy rather than all of it, because this
		// runs on every `npm test`. And note what this row can
		// and cannot do: the decline the floor used to have needed a draw to
		// land on a station the market cannot price, and `system.ts` places
		// none — a red build with that decline put back stayed green over all
		// three seeds. So this row holds the floor over a wide sweep; the
		// unreachability of the old hole is `canPostJobs`'s own note.
		let checked = 0;
		for (const worldSeed of [WORLD, 0xc0ffee, 0x1d]) {
			const systems = generateGalaxy(worldSeed, 0).systems;
			for (const record of systems.slice(0, 60)) {
				for (const station of postingStations(record)) {
					const board = boardAt(systems, record, station);
					if (
						deliveryCandidates(
							systems,
							record,
							generateContents,
							stationKeyOf(record, station),
						).length === 0
					)
						continue;
					expect([
						`${worldSeed.toString(16)}:${record.index}:${station.id}`,
						board.some((offer) => offer.family === "courier"),
					]).toEqual([
						`${worldSeed.toString(16)}:${record.index}:${station.id}`,
						true,
					]);
					checked++;
				}
			}
		}
		expect(checked).toBeGreaterThan(100);
	});

	test("a binder may decline: no deficit, no procurement offer", () => {
		const board = bindJobs(contextAt(HERE.index, HERE.stationId));
		expect(board.some((offer) => offer.family === "procurement")).toBe(false);
	});

	test("a real deficit posts a procurement offer for that good", () => {
		const station = generateContents(SYSTEMS[HERE.index]).stations.find(
			(s) => s.id === HERE.stationId,
		);
		if (!station) throw new Error("no station");
		const key = carrierKey(HERE.index, station.localCarrierId);
		const deficits = recordTrade({}, key, {
			goodName: "Food",
			units: 20,
			gameTimeMin: 120,
			holdT: 20,
		});
		const board = bindJobs(
			contextAt(HERE.index, HERE.stationId, { deficits, gameTimeMin: 120 }),
		);
		const offer = board.find((o) => o.family === "procurement");
		expect(offer?.goodName).toBe("Food");
		expect(offer?.reportAt.carrierKey).toBe(key);
	});

	test("a destination is this system or one jump, never further", () => {
		const station = stationOf(HERE.index, HERE.stationId);
		const self = carrierKey(HERE.index, station.localCarrierId);
		const candidates = deliveriesFrom(HERE.index, station.localCarrierId);
		expect(candidates.length).toBeGreaterThan(0);
		for (const destination of candidates) {
			expect(destination.distanceLy).toBeLessThanOrEqual(JUMP_RANGE_LY);
			// A bare `Station.id` is system-local: `station-trade` names one
			// station in every system, so the poster is excluded by key.
			expect(
				carrierKey(
					destination.system.index,
					destination.station.localCarrierId,
				),
			).not.toBe(self);
		}
	});
});

describe("D8 — need is the throttle, so a procurement offer follows it", () => {
	test("the offer shrinks as the shelf refills, and goes when it has", () => {
		const station = stationOf(HERE.index, HERE.stationId);
		const key = carrierKey(HERE.index, station.localCarrierId);
		const deficits = recordTrade({}, key, {
			goodName: "Food",
			units: 20,
			gameTimeMin: 0,
			holdT: 20,
		});
		const at = (gameTimeMin: number) =>
			bindJobs(
				contextAt(HERE.index, HERE.stationId, { deficits, gameTimeMin }),
			).find((o) => o.family === "procurement");
		const fresh = at(0);
		const later = at(40);
		expect(fresh?.tonnes).toBeGreaterThan(0);
		expect(later === undefined || later.tonnes < (fresh?.tonnes ?? 0)).toBe(
			true,
		);
		// **This is the world changing, not the offer rerolling.** §1 forbids a
		// fixed offer being regenerated on docking or a clock epoch; D8 makes
		// the shortfall itself what posts the job, and an accepted one pins its
		// terms regardless.
		expect(at(0)).toEqual(fresh);
	});
});

describe("§1 — repeating work needs an episode, not a rerolled offer", () => {
	test("the next episode binds only once the last one settles", () => {
		const first = bindJobs(contextAt(HERE.index, HERE.stationId));
		const courier = first.find((o) => o.family === "courier");
		if (!courier) throw new Error("no courier offer");
		expect(courier.episode).toBe(1);

		const next = bindJobs(
			contextAt(HERE.index, HERE.stationId, {
				settled: { courier: 1 },
			}),
		);
		const second = next.find((o) => o.family === "courier");
		expect(second?.episode).toBe(2);
		expect(second?.id).not.toBe(courier.id);
	});
});

describe("D4 — every job leaves one mark, and only one", () => {
	test("a courier's mark moves the destination's deficit for its good", () => {
		const board = bindJobs(contextAt(HERE.index, HERE.stationId));
		const courier = board.find((o) => o.family === "courier");
		if (!courier) throw new Error("no courier offer");
		const mark = jobMark(courier);
		expect(mark.key).toBe(courier.reportAt.carrierKey);
		expect(mark.trade.goodName).toBe(courier.goodName);
		// Delivering supplies the destination, which is the sale sign (§5.2).
		expect(mark.trade.units).toBeLessThan(0);
		expect(Math.abs(mark.trade.units)).toBe(courier.tonnes);
	});

	test("the mark names no hull and no clock, so neither can be defaulted", () => {
		// #182: `recordTrade` requires the **flown** hull's hold, and a caller
		// that forgot one silently gets the courier's 20 t. This module never
		// sees a commander, so it must not be able to supply either number.
		const board = bindJobs(contextAt(HERE.index, HERE.stationId));
		const courier = board.find((o) => o.family === "courier");
		if (!courier) throw new Error("no courier offer");
		const mark = jobMark(courier);
		expect(Object.keys(mark.trade).sort()).toEqual(["goodName", "units"]);
		const applied = recordTrade({}, mark.key, {
			...mark.trade,
			gameTimeMin: 200,
			holdT: 20,
		});
		expect(applied[mark.key]?.goods[mark.trade.goodName]).toBeLessThan(0);
	});
});

describe("#455 — a consignment is drawn from the widest-spread goods", () => {
	/** The base price a station quotes with no fluctuation byte and no deficit
	 *  — the same figure `bindCourier` ranks on. */
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
	 * The pool and the ranking, rebuilt from `market.ts` rather than imported
	 * from `jobs.ts`: a check that asked the binder for its own order would
	 * pass on any order at all.
	 */
	const rankedPool = (
		system: SystemRecord,
		station: Station,
		destination: JobDestination,
	): Commodity[] => {
		const there = new Set(
			listedAt(destination.station, destination.system).map((c) => c.name),
		);
		return listedAt(station, system)
			.filter(
				(c) => there.has(c.name) && !c.sellOnly && !c.illegal && c.unit === "t",
			)
			.map((c) => ({
				c,
				spread:
					basePriceCr(c, destination.system, destination.station) -
					basePriceCr(c, system, station),
			}))
			.sort((a, b) => b.spread - a.spread || (a.c.name < b.c.name ? -1 : 1))
			.map((entry) => entry.c);
	};

	/** Every courier offer this galaxy's first 60 systems post, with the leg
	 *  the binder drew for it — so the ranking is measured over the same pair
	 *  of stations the offer was bound from. */
	const couriers = (settled: Record<string, number> = {}) => {
		const out: {
			offer: JobOffer;
			system: SystemRecord;
			station: Station;
			destination: JobDestination;
		}[] = [];
		for (const system of SYSTEMS.slice(0, 60))
			for (const station of postingStations(system)) {
				const offer = boardAt(SYSTEMS, system, station, {
					gameTimeMin: 120,
					settled,
				}).find((o) => o.family === "courier");
				if (!offer) continue;
				const destination = deliveryCandidates(
					SYSTEMS,
					system,
					generateContents,
					stationKeyOf(system, station),
				).find(
					(d) =>
						carrierKey(d.system.index, d.station.localCarrierId) ===
						offer.reportAt.carrierKey,
				);
				if (!destination) throw new Error(`no leg for ${offer.id}`);
				out.push({ offer, system, station, destination });
			}
		return out;
	};

	test("the good is in the pool, and in its top COURIER_SPREAD_POOL by spread", () => {
		const boards = couriers();
		expect(boards.length).toBeGreaterThan(50);
		for (const { offer, system, station, destination } of boards) {
			const ranked = rankedPool(system, station, destination);
			const top = ranked
				.slice(0, COURIER_SPREAD_POOL)
				.map((c) => c.name);
			expect([offer.id, top.includes(offer.goodName)]).toEqual([
				offer.id,
				true,
			]);
		}
	});

	test("the draw is deterministic for one station and one episode", () => {
		const first = couriers().map((b) => `${b.offer.id}:${b.offer.goodName}`);
		const again = couriers().map((b) => `${b.offer.id}:${b.offer.goodName}`);
		expect(again).toEqual(first);
	});

	test("two consecutive episodes on the same leg can differ", () => {
		// **The leg is held.** The destination has its own per-episode draw, so
		// a second consignment usually flies somewhere else and ranks a
		// different pool — which means a build with no good-draw at all still
		// shows a different cargo. Measured: `ranked[last]` with no draw passed
		// a version of this row that did not hold the leg. So only the boards
		// whose episode 2 goes to the same station as episode 1 count here.
		//
		// **Existence, not a rate.** A draw from three goods repeats a third of
		// the time, so a row asserting that *every* desk changes its cargo
		// would be red on a correct build.
		// Eight episodes rather than two, because the leg coincides on only a
		// few boards per episode pair and three samples settle nothing.
		const EPISODES = 8;
		const goodsPerLeg = new Map<string, Set<string>>();
		let legsSeen = 0;
		for (let episode = 1; episode <= EPISODES; episode += 1)
			for (const board of couriers({ courier: episode - 1 })) {
				expect(board.offer.episode).toBe(episode);
				const leg = `${board.offer.requester.carrierKey}->${board.offer.reportAt.carrierKey}`;
				const seen = goodsPerLeg.get(leg) ?? new Set<string>();
				if (seen.size === 0) legsSeen += 1;
				seen.add(board.offer.goodName);
				goodsPerLeg.set(leg, seen);
			}
		expect(legsSeen).toBeGreaterThan(100);
		const varying = [...goodsPerLeg.values()].filter(
			(goods) => goods.size > 1,
		).length;
		expect(varying).toBeGreaterThan(0);
	});

	test("the pool is wider than one, or the rule is the spread alone", () => {
		// The constant the node's claim rests on: at 1 the distribution
		// collapses back onto two goods, which is what the shipped rule did.
		expect(COURIER_SPREAD_POOL).toBeGreaterThan(1);
	});
});
