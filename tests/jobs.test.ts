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
import { JUMP_RANGE_LY, generateGalaxy } from "../src/galaxy";
import {
	JOB_ROWS,
	type JobOffer,
	bindJobs as bindJobsWith,
	canPostJobs,
	deliveryCandidates,
	jobMark,
} from "../src/jobs";
// `JUMP_TANK_LY` is the jump tank's capacity (`hyperspace.ts`).
import { JUMP_TANK_LY } from "../src/hyperspace";
import {
	boardAt,
	boardContext,
	postingStations,
	stationKeyOf,
} from "./helpers/job-board";
import { MARKET_PERIOD_MIN } from "../src/market";
import { recordTrade } from "../src/deficits";
import type { DeficitMap } from "../src/deficits";
import { generateContents } from "../src/system";

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
		// **Three galaxies, every posting station.** And note what this row can
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
