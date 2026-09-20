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
	bindJobs,
	deliveryCandidates,
	jobMark,
} from "../src/jobs";
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
) => {
	const system = SYSTEMS[systemIndex];
	const station = generateContents(system).stations.find(
		(s) => s.id === stationId,
	);
	if (!station) throw new Error(`no station ${stationId}`);
	return {
		galaxyIndex: 0,
		system,
		station,
		destinations: deliveriesFrom(systemIndex, station.localCarrierId),
		deficits: options.deficits ?? {},
		gameTimeMin: options.gameTimeMin ?? 120,
		settled: options.settled ?? {},
	};
};

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

	test("a board does not reroll across a market epoch boundary", () => {
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

	test("D8's courier floor binds at any station with a destination", () => {
		let checked = 0;
		for (const record of SYSTEMS.slice(0, 40)) {
			for (const station of generateContents(record).stations) {
				if (station.type === "outpost") continue;
				if (deliveriesFrom(record.index, station.localCarrierId).length === 0)
					continue;
				const board = bindJobs(contextAt(record.index, station.id));
				expect(board.some((offer) => offer.family === "courier")).toBe(true);
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
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
