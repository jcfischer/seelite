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
import { recordTrade } from "../src/deficits";
import { generateGalaxy } from "../src/galaxy";
import type { JobOffer } from "../src/jobs";
import {
	emptyRequests,
	entrustedTonnesAboard,
	type RequestsState,
	requestAction,
	settledAt,
	settlementMessage,
} from "../src/requests";
import { generateContents } from "../src/system";
import { firstOffer, firstProcurementOffer } from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;

const COURIER = firstOffer(SYSTEMS, "courier");

const { offers, offer: courier } = COURIER;

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

	test("handing over a consignment does not touch the pilot's own cargo", () => {
		// **#446's reproduction, pinned.** The principal bought 8 t of Food to
		// fulfil a consignment that was already aboard and reported a bug in
		// the finishing of the job. What this shows is narrower than an
		// explanation of that session: run through the shipped modules, the
		// requester's lot is consumed once, the pilot's Food is untouched and
		// the mark is a single write — so the double-charge the symptom
		// suggests is not in these paths. The session itself was never
		// replayed, and the wording is what this node changes. Pinned as a row
		// rather than a paragraph because a later refactor of the two cargo
		// paths would break it in silence.
		const state = accept().state;
		const mine = { [courier.goodName]: courier.tonnes };
		const delivered = requestAction(state, offers, "deliver", courier.id, {
			...context(),
			docked: at(courier.reportAt),
			cargo: mine,
		});
		expect(delivered.ok).toBe(true);
		// Nothing of the pilot's is asked for, so nothing is taken.
		expect(delivered.cargoDelta).toEqual({});
		// **And the mark is counted, not merely valued.** Asserting only the
		// figure on the report leaves a second −8 t write at deliver green,
		// which is the shape of the double-spend the node was reported as.
		expect(delivered.mark).toBeNull();
		expect(delivered.rewardCr).toBe(0);
		// And the requester's lot is gone exactly once.
		expect(entrustedTonnesAboard(delivered.state)).toBe(0);
		const reported = requestAction(
			delivered.state,
			offers,
			"report",
			courier.id,
			{ ...context(), docked: at(courier.reportAt), cargo: mine },
		);
		expect(reported.ok).toBe(true);
		expect(reported.cargoDelta).toEqual({});
		expect(reported.mark?.trade.units).toBe(-courier.tonnes);
		// **And the sentence calls the pilot's tonnage theirs.** This is the
		// case the node was reported from — the same good on both sides of the
		// ownership line — and the settlement has to keep them apart in words
		// as well as in arithmetic.
		expect(reported.message).toBe(
			`Reported · ${courier.tonnes} t ${courier.goodName} handed over, ${courier.rewardCr} Cr paid · ${courier.tonnes} t ${courier.goodName} still aboard, yours.`,
		);
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

describe("the offer's clock is the journal's clock", () => {
	// **Seconds, not minutes.** The binder works in game minutes because that
	// is the unit a deficit row is stamped in; the journal's clock is
	// `world.gameTime` in seconds, and the save validates every stamp against
	// it. When the two met in a field with no unit in its name, a fresh offer
	// read 59 minutes old on the console and the refusal below could never
	// fire, because a minute figure is under a second figure at every clock.
	const board = firstOffer(SYSTEMS, "courier", { gameTimeMin: 60 });

	test("an offer is stamped in seconds", () => {
		expect(board.offer.observedAt).toBe(60 * 60);
	});

	test("an action before the offer was posted is refused", () => {
		const early = requestAction(
			emptyRequests(),
			board.offers,
			"accept",
			board.offer.id,
			{
				now: board.offer.observedAt - 1,
				docked: at(board.offer.requester),
				cargo: {},
				holdRoomT: 40,
			},
		);
		expect(early.ok).toBe(false);
		expect(early.message).toContain("observation time");
		expect(
			requestAction(emptyRequests(), board.offers, "accept", board.offer.id, {
				now: board.offer.observedAt,
				docked: at(board.offer.requester),
				cargo: {},
				holdRoomT: 40,
			}).ok,
		).toBe(true);
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
	/**
	 * A deficit is what posts a procurement job (D8), and a fresh world has
	 * none — the previous version of this row read that as "skip", so neither
	 * branch of the family had a test. The deficit is made here, because it is
	 * a thing a pilot does: it is the mark of a hold bought off that shelf.
	 */
	// `postingStations` is `canPostJobs`, which is "not an outpost" — the same
	// filter this block used to spell out for itself.
	const { offers: shelf, offer: purchase } = firstProcurementOffer(
		SYSTEMS,
		"Food",
		0,
	);
	const atShelf = (
		over: Partial<Parameters<typeof requestAction>[4]> = {},
	) => ({
		now: 60,
		docked: at(purchase.requester),
		cargo: {} as Readonly<Record<string, number>>,
		holdRoomT: 20,
		...over,
	});

	test("it is the pilot's own cargo: no lot is issued, and none is owed", () => {
		expect(purchase.entrusted).toBe(false);
		const accepted = requestAction(
			emptyRequests(),
			shelf,
			"accept",
			purchase.id,
			atShelf(),
		);
		expect(accepted.ok).toBe(true);
		expect(entrustedTonnesAboard(accepted.state)).toBe(0);
	});

	test("delivery needs the goods aboard, and takes them", () => {
		const state = requestAction(
			emptyRequests(),
			shelf,
			"accept",
			purchase.id,
			atShelf(),
		).state;
		const empty = requestAction(
			state,
			shelf,
			"deliver",
			purchase.id,
			atShelf(),
		);
		expect(empty.ok).toBe(false);
		expect(empty.message).toContain(purchase.goodName);

		const laden = requestAction(
			state,
			shelf,
			"deliver",
			purchase.id,
			atShelf({ cargo: { [purchase.goodName]: purchase.tonnes } }),
		);
		expect(laden.ok).toBe(true);
		expect(laden.cargoDelta).toEqual({ [purchase.goodName]: -purchase.tonnes });
		expect(laden.state.byId[purchase.id].status).toBe("ready-to-report");
	});

	test("a procurement job reports where it was posted", () => {
		expect(purchase.reportAt.carrierKey).toBe(purchase.requester.carrierKey);
		expect(purchase.distanceLy).toBe(0);
	});
});

describe("§3 — a reaccept cannot restore a satisfied objective", () => {
	const delivered = () =>
		requestAction(accept().state, offers, "deliver", courier.id, {
			...context(),
			docked: at(courier.reportAt),
		}).state;

	test("cancelling a ready-to-report job and reaccepting it cannot pay twice", () => {
		const cancelled = requestAction(
			delivered(),
			offers,
			"cancel",
			courier.id,
			context(),
		).state;
		const again = requestAction(
			cancelled,
			offers,
			"accept",
			courier.id,
			context(),
		);
		expect(again.ok).toBe(true);
		// The objective has to be flown again: the evidence was the cargo, and
		// §3 re-evaluates cargo stages for the current issuance.
		expect(again.state.byId[courier.id].status).toBe("accepted");
		const paid = requestAction(again.state, offers, "report", courier.id, {
			...context(),
			docked: at(courier.reportAt),
		});
		expect(paid.ok).toBe(false);
		expect(paid.rewardCr).toBe(0);
		expect(paid.mark).toBeNull();
	});

	test("reaccepting with the consignment still aboard is refused, not doubled", () => {
		const cancelled = requestAction(
			accept().state,
			offers,
			"cancel",
			courier.id,
			context(),
		).state;
		const again = requestAction(
			cancelled,
			offers,
			"accept",
			courier.id,
			context(),
		);
		expect(again.ok).toBe(false);
		expect(entrustedTonnesAboard(again.state)).toBe(courier.tonnes);
		// Returning it first is the way through, and then one lot is issued.
		const returned = requestAction(
			cancelled,
			offers,
			"return-entrusted",
			courier.id,
			context(),
		).state;
		const reaccepted = requestAction(
			returned,
			offers,
			"accept",
			courier.id,
			context(),
		);
		expect(reaccepted.ok).toBe(true);
		expect(Object.values(reaccepted.state.entrustedByLotId).length).toBe(1);
		expect(entrustedTonnesAboard(reaccepted.state)).toBe(courier.tonnes);
	});
});

describe("a procurement job settles against the pilot's own hold", () => {
	// **The host's ordering, flown rather than assumed.** `settlementMessage`
	// reads the remainder off `ctx.cargo`, and the claim that the delivery's
	// delta has already landed by then was checked only on the entrusted arm,
	// where `cargoDelta` is empty and the ordering cannot fail. This runs the
	// procurement arm the way `main.ts` runs it: deliver, apply the delta,
	// report with the cargo that is left.
	const board = firstProcurementOffer(SYSTEMS);
	const here = {
		galaxyIndex: board.offer.requester.galaxyIndex,
		carrierKey: board.offer.requester.carrierKey,
	};
	const ctx = (cargo: Record<string, number>) => ({
		now: 120 * 60,
		docked: here,
		cargo,
		holdRoomT: 20,
	});

	const apply = (
		cargo: Record<string, number>,
		delta: Readonly<Record<string, number>>,
	) => {
		const next = { ...cargo };
		for (const [good, amount] of Object.entries(delta)) {
			const left = (next[good] ?? 0) + amount;
			if (left <= 0) delete next[good];
			else next[good] = left;
		}
		return next;
	};

	test("a short hold is refused by the model, not only by the button", () => {
		// **The disabled attribute is a courtesy; this is the rule.** #446
		// added a short-hold gate to the rendered control, and a rendered gate
		// is bypassable from a console or a synthesised click. Nothing pinned
		// that `requestAction` refuses the procurement arm short, so this does.
		const { offers: board3, offer } = board;
		const accepted = requestAction(
			emptyRequests(),
			board3,
			"accept",
			offer.id,
			ctx({}),
		);
		expect(accepted.ok).toBe(true);
		const short = requestAction(accepted.state, board3, "deliver", offer.id, {
			...ctx({ [offer.goodName]: offer.tonnes - 1 }),
		});
		expect(short.ok).toBe(false);
		expect(short.cargoDelta).toEqual({});
		// And the state is the one it was given, so nothing half-applied.
		expect(short.state).toBe(accepted.state);
	});

	test("the remainder is what is left after the delivery, not before it", () => {
		const { offers: board3, offer } = board;
		// Two tonnes more than the job needs, so the remainder is a figure and
		// not a zero — a zero would pass under either ordering.
		let cargo = { [offer.goodName]: offer.tonnes + 2 };
		const accepted = requestAction(
			emptyRequests(),
			board3,
			"accept",
			offer.id,
			ctx(cargo),
		);
		expect(accepted.ok).toBe(true);
		const delivered = requestAction(
			accepted.state,
			board3,
			"deliver",
			offer.id,
			ctx(cargo),
		);
		expect(delivered.ok).toBe(true);
		expect(delivered.cargoDelta).toEqual({ [offer.goodName]: -offer.tonnes });
		cargo = apply(cargo, delivered.cargoDelta);
		const reported = requestAction(
			delivered.state,
			board3,
			"report",
			offer.id,
			ctx(cargo),
		);
		expect(reported.ok).toBe(true);
		expect(reported.message).toBe(
			`Reported · ${offer.tonnes} t ${offer.goodName} delivered from your hold, ${offer.rewardCr} Cr paid · 2 t ${offer.goodName} still aboard, yours.`,
		);
	});
});

describe("the settlement says what moved", () => {
	test("a hand-over names the tonnes, the pay and what is left of the pilot's", () => {
		expect(
			settlementMessage({
				tonnes: 8,
				goodName: "Food",
				entrusted: true,
				rewardCr: 180,
				remainingT: 8,
			}),
		).toBe(
			"Reported · 8 t Food handed over, 180 Cr paid · 8 t Food still aboard, yours.",
		);
	});

	test("a procurement settlement says the goods were the pilot's", () => {
		expect(
			settlementMessage({
				tonnes: 5,
				goodName: "Textiles",
				entrusted: false,
				rewardCr: 90,
				remainingT: 0,
			}),
		).toBe(
			"Reported · 5 t Textiles delivered from your hold, 90 Cr paid · no Textiles left aboard.",
		);
	});

	test("after a hand-over an empty remainder is silence, not a claim", () => {
		// `no Food left aboard` after a hand-over reads as the pilot's Food
		// having gone — the ownership confusion this node removes, pointing the
		// other way. A pilot who carried none of the good is told about the job
		// and nothing else.
		expect(
			settlementMessage({
				tonnes: 8,
				goodName: "Food",
				entrusted: true,
				rewardCr: 180,
				remainingT: 0,
			}),
		).toBe("Reported · 8 t Food handed over, 180 Cr paid.");
	});

	test("after a procurement job an empty hold is worth saying", () => {
		// Here the goods really were the pilot's, so the hold going empty is a
		// fact about their own cargo and the sentence is not a claim about
		// someone else's.
		expect(
			settlementMessage({
				tonnes: 5,
				goodName: "Textiles",
				entrusted: false,
				rewardCr: 90,
				remainingT: 0,
			}),
		).toContain("no Textiles left aboard");
	});
});
