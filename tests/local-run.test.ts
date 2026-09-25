/**
 * #408 D2: the Local run, a courier row that binds only inside the posting
 * system.
 *
 * It is ordinary work: every station with an in-system neighbour posts it,
 * whoever is docked, and no binder reads the commander. It is its **own slot**
 * beside D8's floor courier — its own draw stream, offer identity and episode
 * count — so taking or settling one never moves the other.
 */

import { describe, expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import { isCargoOffer, JOB_ROWS, type JobOffer, slotOfRow } from "../src/jobs";
import { emptyRequests, type RequestsState, settledAt } from "../src/requests";
import { boardAt, postingStations, stationKeyOf } from "./helpers/job-board";

const WORLD = 0x5ee11e;
const SYSTEMS = generateGalaxy(WORLD, 0).systems;

const LOCAL_ROW = JOB_ROWS.find((row) => row.slot === "courier-local");

/** The first system with at least `n` posting stations, and exactly `n` when
 *  `exact` — a lone station has no in-system neighbour to send a run to. */
const systemWith = (n: number, exact: boolean) => {
	const record = SYSTEMS.find((r) => {
		const count = postingStations(r).length;
		return exact ? count === n : count >= n;
	});
	if (!record) throw new Error(`no system with ${n} posting stations`);
	return { record, stations: postingStations(record) };
};

const localOf = (board: JobOffer[]) =>
	board.filter((offer) => offer.rowId === LOCAL_ROW?.rowId);
const floorOf = (board: JobOffer[]) =>
	board.filter(
		(offer) => offer.family === "courier" && offer.rowId !== LOCAL_ROW?.rowId,
	);

describe("#408 D2 — the Local run", () => {
	test("is one authored courier row in its own slot", () => {
		expect(LOCAL_ROW?.family).toBe("courier");
		expect(JOB_ROWS.filter((row) => row.slot === "courier-local")).toHaveLength(
			1,
		);
		// Every other row keeps its family as its slot, so no shipped board moves.
		for (const row of JOB_ROWS)
			if (row !== LOCAL_ROW) expect(row.slot).toBe(row.family);
	});

	test("binds only to a station in the posting system", () => {
		const { record, stations } = systemWith(2, false);
		for (const station of stations) {
			const local = localOf(boardAt(SYSTEMS, record, station));
			expect(local).toHaveLength(1);
			const [offer] = local;
			expect(offer.distanceLy).toBe(0);
			expect(offer.reportSystemName).toBe(record.name);
			expect(offer.reportAt.carrierKey).not.toBe(stationKeyOf(record, station));
			if (!isCargoOffer(offer)) throw new Error("a local run carries cargo");
			expect(offer.operand.entrusted).toBe(true);
			expect(offer.rewardCr).toBe(
				(LOCAL_ROW?.payment.baseCr ?? 0) +
					(LOCAL_ROW?.payment.perTonneCr ?? 0) * (LOCAL_ROW?.tonnes ?? 0),
			);
		}
	});

	test("declines at a station with no in-system neighbour", () => {
		const { record, stations } = systemWith(1, true);
		const board = boardAt(SYSTEMS, record, stations[0]);
		expect(localOf(board)).toEqual([]);
		// The floor still binds there, one jump out.
		expect(floorOf(board)).toHaveLength(1);
	});

	test("binds the same offer twice", () => {
		const { record, stations } = systemWith(2, false);
		expect(localOf(boardAt(SYSTEMS, record, stations[0]))).toEqual(
			localOf(boardAt(SYSTEMS, record, stations[0])),
		);
	});

	test("and the floor courier are separate slots in both directions", () => {
		const { record, stations } = systemWith(2, false);
		const station = stations[0];
		const base = boardAt(SYSTEMS, record, station);
		const afterLocal = boardAt(SYSTEMS, record, station, {
			settled: { "courier-local": 3 },
		});
		const afterFloor = boardAt(SYSTEMS, record, station, {
			settled: { courier: 3 },
		});
		expect(floorOf(afterLocal)).toEqual(floorOf(base));
		expect(localOf(afterFloor)).toEqual(localOf(base));
		expect(localOf(afterLocal)[0].episode).toBe(4);
		expect(localOf(base)[0].id).toEndWith("/courier-local-1");
		expect(floorOf(base)[0].id).toEndWith("/courier-1");
	});

	test("a settled local run counts in its own slot", () => {
		const { record, stations } = systemWith(2, false);
		const station = stations[0];
		const [offer] = localOf(boardAt(SYSTEMS, record, station));
		const state: RequestsState = {
			...emptyRequests(),
			byId: {
				[offer.id]: {
					status: "completed",
					terms: offer,
				} as unknown as RequestsState["byId"][string],
			},
		};
		const settled = settledAt(state, offer.requester);
		expect(settled["courier-local"]).toBe(1);
		expect(settled.courier).toBe(0);
	});

	test("a row id nothing knows falls back to its family's slot", () => {
		expect(slotOfRow("retired-row", "courier")).toBe("courier");
		expect(slotOfRow(LOCAL_ROW?.rowId ?? "", "courier")).toBe("courier-local");
	});
});
