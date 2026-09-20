/**
 * Node 443: the one hold projection the trade screen, the delivery's words and
 * the Hold page all read.
 *
 * The finding that opened the node was arithmetic nobody could see: a courier
 * with a 20 t hull, an 8 t consignment and 1 t of Radioactives aboard was sold
 * 11 t of Food and told nothing. Every figure was right. These rows pin the
 * projection that makes them sayable, and the first of them is the one that
 * matters most — **the capacity is not re-derived here.** A screen that counted
 * the hold itself is a second authority, and the till is the one that refuses.
 */
import { describe, expect, test } from "bun:test";
import { holdSummary } from "../src/hold";
import { LARGE_CARGO_BAY_BONUS_T, newCommander } from "../src/station-commerce";
import { generateGalaxy } from "../src/galaxy";
import type { JobOffer } from "../src/jobs";
import {
	type RequestsState,
	emptyRequests,
	entrustedTonnesAboard,
	requestAction,
} from "../src/requests";
import { firstOffer } from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const { offers, offer: courier } = firstOffer(SYSTEMS, "courier");

const COURIER_HOLD_T = 20;

const at = (ref: JobOffer["requester"]) => ({
	galaxyIndex: ref.galaxyIndex,
	carrierKey: ref.carrierKey,
});

/** A journal holding the courier's consignment, through the shipped verb. */
const withConsignment = (): RequestsState => {
	const result = requestAction(emptyRequests(), offers, "accept", courier.id, {
		now: 60,
		docked: at(courier.requester),
		cargo: {},
		holdRoomT: COURIER_HOLD_T,
	});
	expect(result.ok).toBe(true);
	return result.state;
};

const pilot = (cargo: Record<string, number>) => ({
	...newCommander("courier"),
	cargo,
});

describe("the capacity is the till's, not the screen's", () => {
	test("an empty hold reports the hull's own figure and nothing else", () => {
		const summary = holdSummary(pilot({}), emptyRequests());
		expect(summary.capacityT).toBe(COURIER_HOLD_T);
		expect(summary.usedT).toBe(0);
		expect(summary.freeT).toBe(COURIER_HOLD_T);
		expect(summary.entrustedT).toBe(0);
		expect(summary.lines).toEqual([]);
	});

	test("a Large Cargo Bay counts, because `commanderHold` counts it", () => {
		const commander = {
			...pilot({}),
			ownedEquipment: ["Large Cargo Bay"],
		};
		expect(holdSummary(commander, emptyRequests()).capacityT).toBe(
			COURIER_HOLD_T + LARGE_CARGO_BAY_BONUS_T,
		);
	});

	test("the reported arithmetic is the one that refused the sale", () => {
		// #443's own case: 20 t hull, an 8 t consignment, 1 t of Radioactives.
		// The till sold 11 t of Food and said nothing; this is the sentence it
		// could not say.
		const requests = withConsignment();
		const summary = holdSummary(pilot({ Radioactives: 1 }), requests);
		expect(summary.entrustedT).toBe(courier.tonnes);
		expect(summary.usedT).toBe(courier.tonnes + 1);
		expect(summary.freeT).toBe(COURIER_HOLD_T - courier.tonnes - 1);
	});

	test("entrusted tonnes are the journal's projection, not a second sum", () => {
		const requests = withConsignment();
		expect(holdSummary(pilot({}), requests).entrustedT).toBe(
			entrustedTonnesAboard(requests),
		);
	});

	test("a non-tonne good takes no room and keeps its own unit", () => {
		// Gold is kilogrammes and skips the hold check at the till (#7's
		// per-good finding), so a line for it must not move `usedT`.
		const summary = holdSummary(pilot({ Gold: 40 }), emptyRequests());
		expect(summary.usedT).toBe(0);
		const gold = summary.lines.find((line) => line.goodName === "Gold");
		expect(gold?.unit).toBe("kg");
		expect(gold?.amount).toBe(40);
	});

	test("free tonnage is not floored at zero", () => {
		// A floor would print `0 t free` over a hold that is past its capacity,
		// which is the one state a pilot most needs to be told about — and the
		// repo has been bitten by a metric that could not separate "clear" from
		// "inside the surface" (#30's penetration figure).
		const overfull = { ...pilot({ Food: 30 }), hull: "courier" as const };
		expect(holdSummary(overfull, emptyRequests()).freeT).toBe(-10);
	});
});

describe("ownership is the thing the screen could not say", () => {
	test("the pilot's goods and the requester's are separate lines", () => {
		const requests = withConsignment();
		const summary = holdSummary(pilot({ [courier.goodName]: 3 }), requests);
		const mine = summary.lines.filter((line) => line.owner === "pilot");
		const theirs = summary.lines.filter((line) => line.owner === "requester");
		expect(mine).toHaveLength(1);
		expect(theirs).toHaveLength(1);
		expect(mine[0].amount).toBe(3);
		expect(theirs[0].amount).toBe(courier.tonnes);
		// The same good, and the two are not merged: one can be sold and one
		// cannot, which is the whole of #411 §4.
		expect(mine[0].goodName).toBe(theirs[0].goodName);
	});

	test("a requester line names its job and where the goods must return", () => {
		const requests = withConsignment();
		const line = holdSummary(pilot({}), requests).lines.find(
			(entry) => entry.owner === "requester",
		);
		expect(line?.offerId).toBe(courier.id);
		expect(line?.jobTitle).toBe(courier.title);
		expect(line?.returnTo?.carrierKey).toBe(courier.requester.carrierKey);
	});

	test("a lot whose request is missing is a journal fault, and it throws", () => {
		// Drawing a nameless line would put a hold on the glass that no journal
		// backs. The lot map and `byId` are written by one verb; a lot without
		// its request means one of the two was restored without the other.
		const requests = withConsignment();
		const orphaned: RequestsState = { ...requests, byId: {} };
		expect(() => holdSummary(pilot({}), orphaned)).toThrow(/443|request/i);
	});

	test("lines sort pilot-first and then by good, so a render is stable", () => {
		const requests = withConsignment();
		const summary = holdSummary(
			pilot({ Textiles: 2, Alloys: 1, Food: 1 }),
			requests,
		);
		expect(
			summary.lines.map((line) => `${line.owner}:${line.goodName}`),
		).toEqual([
			"pilot:Alloys",
			"pilot:Food",
			"pilot:Textiles",
			`requester:${courier.goodName}`,
		]);
	});

	test("a good the commander holds none of draws no line", () => {
		const summary = holdSummary(pilot({ Food: 0 }), emptyRequests());
		expect(summary.lines).toEqual([]);
	});
});
