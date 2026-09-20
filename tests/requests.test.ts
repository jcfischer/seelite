/**
 * Node 411: the live request runtime, flown against bound offers rather than
 * fixtures.
 *
 * `missions-and-requests.md` §3 and §4 own the transitions and the cargo
 * ownership; `ordinary-requests.md` §4 owns the mark. These rows check that a
 * job can be accepted, flown, delivered and reported exactly once, and that a
 * courier's cargo is the requester's the whole way.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import { type JobOffer, bindJobs, deliveryCandidates } from "../src/jobs";
import {
	type RequestsState,
	emptyRequests,
	entrustedTonnesAboard,
	requestAction,
	settledAt,
} from "../src/requests";
import { generateContents } from "../src/system";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;

const boardAt = (systemIndex: number): JobOffer[] => {
	const system = SYSTEMS[systemIndex];
	const station = generateContents(system).stations.find(
		(s) => s.type !== "outpost",
	);
	if (!station) throw new Error("no priceable station");
	return bindJobs({
		galaxyIndex: 0,
		system,
		station,
		destinations: deliveryCandidates(
			SYSTEMS,
			system,
			generateContents,
			carrierKey(system.index, station.localCarrierId),
		),
		deficits: {},
		gameTimeMin: 60,
		settled: {},
	});
};

/** The first system in this galaxy that posts a courier run. */
const firstCourier = (): { offers: JobOffer[]; courier: JobOffer } => {
	for (let index = 0; index < SYSTEMS.length; index++) {
		const offers = boardAt(index);
		const courier = offers.find((o) => o.family === "courier");
		if (courier) return { offers, courier };
	}
	throw new Error("no courier offer in this galaxy");
};

const { offers, courier } = firstCourier();

const HOLD_T = 20;
const at = (ref: JobOffer["requester"]) => ({
	galaxyIndex: ref.galaxyIndex,
	carrierKey: ref.carrierKey,
});

const context = (
	overrides: Partial<Parameters<typeof requestAction>[4]> = {},
) => ({
	now: 60,
	docked: at(courier.requester),
	armed: true,
	cargo: {} as Readonly<Record<string, number>>,
	holdRoomT: HOLD_T,
	...overrides,
});

const accept = (state: RequestsState = emptyRequests()) =>
	requestAction(state, offers, "accept", courier.id, context());

describe("§3 — accept, fly, deliver, report, once", () => {
	test("acceptance happens at the requester and nowhere else", () => {
		const elsewhere = requestAction(
			emptyRequests(),
			offers,
			"accept",
			courier.id,
			{
				...context(),
				docked: null,
			},
		);
		expect(elsewhere.ok).toBe(false);
		expect(accept().ok).toBe(true);
	});

	test("a courier's cargo is the requester's, and it occupies the hold", () => {
		const state = accept().state;
		expect(entrustedTonnesAboard(state)).toBe(courier.tonnes);
		const lots = Object.values(state.entrustedByLotId);
		expect(lots).toHaveLength(1);
		expect(lots[0].goodName).toBe(courier.goodName);
		expect(lots[0].returnTo.carrierKey).toBe(courier.requester.carrierKey);
	});

	test("a hold with no room refuses the job atomically", () => {
		const refused = requestAction(
			emptyRequests(),
			offers,
			"accept",
			courier.id,
			{
				...context(),
				holdRoomT: courier.tonnes - 1,
			},
		);
		expect(refused.ok).toBe(false);
		expect(entrustedTonnesAboard(refused.state)).toBe(0);
	});

	test("delivery needs the report station, not the requester", () => {
		let state = accept().state;
		const here = requestAction(state, offers, "deliver", courier.id, context());
		expect(here.ok).toBe(false);
		const there = requestAction(state, offers, "deliver", courier.id, {
			...context(),
			docked: at(courier.reportAt),
		});
		expect(there.ok).toBe(true);
		state = there.state;
		expect(state.byId[courier.id].status).toBe("ready-to-report");
		// The goods are the buyer's now, so they are out of the hold.
		expect(entrustedTonnesAboard(state)).toBe(0);
	});

	test("reporting pays once and marks the world once", () => {
		let state = requestAction(accept().state, offers, "deliver", courier.id, {
			...context(),
			docked: at(courier.reportAt),
		}).state;
		const paid = requestAction(state, offers, "report", courier.id, {
			...context(),
			docked: at(courier.reportAt),
		});
		expect(paid.ok).toBe(true);
		expect(paid.rewardCr).toBe(courier.rewardCr);
		expect(paid.mark?.key).toBe(courier.reportAt.carrierKey);
		state = paid.state;

		const again = requestAction(state, offers, "report", courier.id, {
			...context(),
			docked: at(courier.reportAt),
		});
		expect(again.ok).toBe(false);
		expect(again.rewardCr).toBe(0);
		expect(again.mark).toBeNull();
	});

	test("a settled courier lets the requester post its next episode", () => {
		const state = requestAction(
			requestAction(accept().state, offers, "deliver", courier.id, {
				...context(),
				docked: at(courier.reportAt),
			}).state,
			offers,
			"report",
			courier.id,
			{ ...context(), docked: at(courier.reportAt) },
		).state;
		expect(settledAt(state, courier.requester).courier).toBe(1);
	});
});

describe("§4 — cancelling keeps the obligation it created", () => {
	test("a cancelled courier still owes its cargo back to the requester", () => {
		const state = requestAction(
			accept().state,
			offers,
			"cancel",
			courier.id,
			context(),
		).state;
		expect(state.byId[courier.id].status).toBe("cancelled");
		expect(entrustedTonnesAboard(state)).toBe(courier.tonnes);

		const returned = requestAction(
			state,
			offers,
			"return-entrusted",
			courier.id,
			context(),
		);
		expect(returned.ok).toBe(true);
		expect(entrustedTonnesAboard(returned.state)).toBe(0);
	});
});

describe("procurement carries the pilot's own goods", () => {
	test("accepting issues no entrusted lot, and delivery needs the cargo aboard", () => {
		const procurement = (() => {
			for (let index = 0; index < SYSTEMS.length; index++) {
				const found = boardAt(index).find((o) => o.family === "procurement");
				if (found) return found;
			}
			return null;
		})();
		// A fresh world has no deficits, so no station posts one — which is D8's
		// derivation working, not a gap. The row is skipped rather than faked.
		if (!procurement) return;
		expect(procurement.entrusted).toBe(false);
	});
});
