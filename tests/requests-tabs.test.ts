/**
 * Node 690: Requests in two halves, Current and Past.
 *
 * The single list put every outcome a pilot had ever reached beside the work
 * still going, so managing three running jobs meant scrolling past forty
 * finished ones. The partition is a view over the journal, never a second
 * authority on a job's status: `isAcceptedRequest` decides, and a job moves
 * between tabs because its status moved and for no other reason.
 *
 * Rows on the pure builders, for `requests-view.test.ts`'s reason: a probe
 * that reads one rendered case is not a check on the branch. The browser half
 * — the tab following a pressed job, the gamepad and the keyboard reaching the
 * tabs — is `probe-requests.mjs`'s.
 */
import { describe, expect, test } from "bun:test";
import { generateGalaxy } from "../src/galaxy";
import type { CargoOffer } from "../src/jobs";
import {
	type AcceptedRequest,
	emptyRequests,
	type RequestStatus,
	type RequestsState,
	requestAction,
} from "../src/requests";
import {
	outstandingReturns,
	requestCue,
	requestSections,
	requestsBody,
	requestsTabOf,
	type RequestsTab,
	type RequestsView,
	tabOfRequest,
} from "../src/requests-view";
import { firstOffer } from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const { offers: BOARD, offer: COURIER } = firstOffer(SYSTEMS, "courier");

/** A distinct job on the same terms, so a journal can hold many. */
const job = (suffix: string): CargoOffer => ({
	...COURIER,
	id: `${COURIER.id}~${suffix}`,
	title: `${COURIER.title} ${suffix}`,
});

const row = (offer: CargoOffer, status: RequestStatus): AcceptedRequest => ({
	offerId: offer.id,
	terms: offer,
	acceptedAt: 0,
	lastAcceptedAt: 0,
	acceptanceOrdinal: 1,
	status,
	stageId: offer.stages[0],
	evidence: [],
	settledAt: status === "completed" ? 1 : null,
	outcomeReason: status === "failed" ? "The requester withdrew the job." : null,
});

const at = (ref: CargoOffer["requester"]) => ({
	galaxyIndex: ref.galaxyIndex,
	carrierKey: ref.carrierKey,
});

const view = (
	state: RequestsState,
	tab: RequestsTab,
	overrides: Partial<RequestsView> = {},
): RequestsView => ({
	state,
	offers: [],
	selectedId: null,
	message: "",
	revision: 1,
	now: COURIER.observedAt + 1,
	docked: at(COURIER.requester),
	hold: null,
	equipment: [],
	tab,
	...overrides,
});

/**
 * C1's journal: two jobs under way, one ready to report, one of every outcome
 * — plus the two overlaps the old list resolved by overwriting a map entry: a
 * cancelled job still posted at its requester, and a kept lead the pilot went
 * on to accept.
 */
const ONGOING_A = job("a");
const ONGOING_B = job("b");
const READY = job("ready");
const DONE = job("done");
const CANCELLED = job("cancelled");
const FAILED = job("failed");
const KEPT = job("kept");
const POSTED = job("posted");
const KEPT_THEN_TAKEN = job("kept-then-taken");

const MIXED: RequestsState = {
	byId: {
		[ONGOING_A.id]: row(ONGOING_A, "accepted"),
		[ONGOING_B.id]: row(ONGOING_B, "accepted"),
		[READY.id]: row(READY, "ready-to-report"),
		[DONE.id]: row(DONE, "completed"),
		[CANCELLED.id]: row(CANCELLED, "cancelled"),
		[FAILED.id]: row(FAILED, "failed"),
		[KEPT_THEN_TAKEN.id]: row(KEPT_THEN_TAKEN, "accepted"),
	},
	leadsById: { [KEPT.id]: KEPT, [KEPT_THEN_TAKEN.id]: KEPT_THEN_TAKEN },
	entrustedByLotId: {},
	trackedRequestId: ONGOING_B.id,
};
const MIXED_OFFERS = [POSTED, CANCELLED];

const ids = (list: readonly { id: string }[]) => list.map((o) => o.id).sort();
const rowIds = (html: string) =>
	[
		...html.matchAll(
			/data-live-request-action="details" data-live-request-id="([^"]+)"/g,
		),
	]
		.map((m) => m[1])
		.sort();

describe("C1: Current holds the work, Past holds the outcomes", () => {
	test("isAcceptedRequest is the whole rule", () => {
		const tabs = (
			[
				"accepted",
				"ready-to-report",
				"completed",
				"cancelled",
				"failed",
			] as const
		).map((s) => tabOfRequest(row(COURIER, s)));
		expect(tabs).toEqual(["current", "current", "past", "past", "past"]);
	});

	test("a mixed journal splits into four sections, each where it belongs", () => {
		const s = requestSections({ state: MIXED, offers: MIXED_OFFERS }, false);
		expect(ids(s.ongoing)).toEqual(
			ids([ONGOING_A, ONGOING_B, READY, KEPT_THEN_TAKEN]),
		);
		expect(ids(s.past)).toEqual(ids([DONE, CANCELLED, FAILED]));
		// A kept lead the pilot later accepted is a job, not a lead; a cancelled
		// job still on its requester's board is an outcome, not an offer.
		expect(ids(s.kept)).toEqual(ids([KEPT]));
		expect(ids(s.posted)).toEqual(ids([POSTED]));
	});

	for (const flight of [false, true])
		test(`the sections are disjoint and together are the old list (${flight ? "flight" : "docked"})`, () => {
			const s = requestSections({ state: MIXED, offers: MIXED_OFFERS }, flight);
			const all = [...s.ongoing, ...s.posted, ...s.kept, ...s.past].map(
				(o) => o.id,
			);
			expect(new Set(all).size).toBe(all.length);
			// The single list this replaced: the docked board's offers, every
			// journal row and every lead, one row per id; in flight, no offers.
			const old = new Set<string>([
				...(flight ? [] : MIXED_OFFERS.map((o) => o.id)),
				...Object.keys(MIXED.byId),
				...Object.keys(MIXED.leadsById),
			]);
			expect([...all].sort()).toEqual([...old].sort());
		});

	test("Current draws only work under way, beside the posted and kept sections", () => {
		const html = requestsBody(view(MIXED, "current", { offers: MIXED_OFFERS }));
		expect(rowIds(html)).toEqual(
			ids([ONGOING_A, ONGOING_B, READY, KEPT_THEN_TAKEN, POSTED, KEPT]),
		);
		for (const section of ["ongoing", "posted", "kept"])
			expect(html).toContain(`data-live-request-section="${section}"`);
		expect(html).not.toContain('data-live-request-section="past"');
	});

	test("Past draws only outcomes, each with its status", () => {
		const html = requestsBody(view(MIXED, "past", { offers: MIXED_OFFERS }));
		expect(rowIds(html)).toEqual(ids([DONE, CANCELLED, FAILED]));
		for (const label of ["done and paid", "cancelled", "failed"])
			expect(html).toContain(label);
		expect(html).not.toContain('data-live-request-section="ongoing"');
	});

	test("in flight Current is the journal and the kept leads, and no offers", () => {
		const html = requestsBody(
			view(MIXED, "current", { offers: MIXED_OFFERS, docked: null }),
			true,
		);
		expect(rowIds(html)).toEqual(
			ids([ONGOING_A, ONGOING_B, READY, KEPT_THEN_TAKEN, KEPT]),
		);
		expect(html).not.toContain('data-live-request-section="posted"');
	});

	test("a failed job reads how it ended", () => {
		const html = requestsBody(view(MIXED, "past", { selectedId: FAILED.id }));
		expect(html).toContain("The requester withdrew the job.");
	});
});

describe("the tabs themselves", () => {
	const tabAttr = (html: string, t: RequestsTab) =>
		html.match(
			new RegExp(
				`<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*data-live-request-id="${t}"`,
			),
		)?.[1];

	test("the selected tab says so, and the other does not", () => {
		for (const t of ["current", "past"] as const) {
			const html = requestsBody(view(MIXED, t));
			expect(tabAttr(html, t)).toBe("true");
			expect(tabAttr(html, t === "current" ? "past" : "current")).toBe("false");
			expect(html).toContain(`data-live-request-tab-panel="${t}"`);
		}
	});

	test("a tab is a request action, so every input reaches it, and not a console tab", () => {
		const html = requestsBody(view(MIXED, "current"));
		expect(html).toContain('role="tablist"');
		expect(html).toMatch(
			/role="tab"[^>]*data-live-request-action="tab" data-live-request-id="past"/,
		);
		// `.lc-tab` is what the shoulders step; a request tab is inside one.
		expect(html).not.toMatch(/class="lc-tab"/);
	});

	test("each tab counts its own half", () => {
		const html = requestsBody(view(MIXED, "current"));
		expect(html).toMatch(/Current <span class="lc-request-tab-count">4</);
		expect(html).toMatch(/Past <span class="lc-request-tab-count">3</);
	});

	test("the station's ids and the flight console's do not collide", () => {
		const docked = requestsBody(view(MIXED, "current"));
		const flight = requestsBody(view(MIXED, "current", { docked: null }), true);
		const idsOf = (html: string) =>
			[...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
		const both = [...idsOf(docked), ...idsOf(flight)];
		expect(new Set(both).size).toBe(both.length);
		expect(docked).toMatch(/aria-controls="console-requests-panel"/);
		expect(flight).toMatch(/aria-controls="flight-requests-panel"/);
	});
});

describe("C2: empty halves say so, and a hidden row has no details", () => {
	test("an empty Current says there is no work, and where to find some", () => {
		const docked = requestsBody(view(emptyRequests(), "current"));
		expect(docked).toContain('data-live-request-empty="ongoing"');
		expect(docked).toContain('data-live-request-empty="posted"');
		const flight = requestsBody(
			view(emptyRequests(), "current", { docked: null }),
			true,
		);
		expect(flight).toMatch(
			/data-live-request-empty="ongoing">No jobs in progress\. Take one on a station/,
		);
	});

	test("an empty Past says what will arrive there", () => {
		const html = requestsBody(view(emptyRequests(), "past"));
		expect(html).toMatch(
			/data-live-request-empty="past">No finished jobs yet\./,
		);
	});

	test("a selection on the other tab draws no actionable pane", () => {
		// Selected on Current, then the pilot looks at Past: the job is not on
		// the glass, so neither is its Cancel.
		const html = requestsBody(
			view(MIXED, "past", { selectedId: ONGOING_A.id }),
		);
		expect(html).not.toContain(`data-live-request-id="${ONGOING_A.id}"`);
		expect(html).not.toContain('data-live-request-action="cancel"');
		expect(html).toContain("<h3>Past jobs</h3>");
		// And the selection is still there when the pilot comes back.
		const back = requestsBody(
			view(MIXED, "current", { selectedId: ONGOING_A.id }),
		);
		expect(back).toContain(
			`data-live-request-action="cancel" data-live-request-id="${ONGOING_A.id}"`,
		);
	});

	test("an outcome selected on Current draws no pane for it", () => {
		const html = requestsBody(
			view(MIXED, "current", { selectedId: CANCELLED.id }),
		);
		expect(html).not.toContain(
			`data-live-request-action="accept" data-live-request-id="${CANCELLED.id}"`,
		);
		expect(html).toContain("<h3>Jobs</h3>");
	});

	test("an id on no row of this surface is on no tab", () => {
		expect(
			requestsTabOf({ state: MIXED, offers: [] }, POSTED.id, false),
		).toBeNull();
		expect(
			requestsTabOf({ state: MIXED, offers: MIXED_OFFERS }, POSTED.id, true),
		).toBeNull();
		expect(
			requestsTabOf({ state: MIXED, offers: MIXED_OFFERS }, POSTED.id, false),
		).toBe("current");
	});
});

describe("C2: the journal's own transitions move a job between tabs", () => {
	const ctx = (
		docked: CargoOffer["requester"],
		overrides: Partial<Parameters<typeof requestAction>[4]> = {},
	) => ({
		now: COURIER.observedAt + 60,
		docked: at(docked),
		cargo: {} as Readonly<Record<string, number>>,
		holdRoomT: 20,
		standing: "clean" as const,
		equipment: [] as readonly string[],
		...overrides,
	});
	const act = (
		state: RequestsState,
		action: string,
		where: CargoOffer["requester"],
	) => {
		const result = requestAction(state, BOARD, action, COURIER.id, ctx(where));
		expect(result.ok).toBe(true);
		return result.state;
	};
	const tabOf = (state: RequestsState, docked: boolean) =>
		requestsTabOf({ state, offers: BOARD }, COURIER.id, !docked);

	test("accept, cancel, return, accept again, deliver, report", () => {
		let state = emptyRequests();
		expect(tabOf(state, true)).toBe("current");
		state = act(state, "accept", COURIER.requester);
		expect(tabOf(state, true)).toBe("current");
		// Cancel moves it to history and leaves its consignment aboard.
		state = act(state, "cancel", COURIER.requester);
		expect(tabOf(state, true)).toBe("past");
		expect(tabOf(state, false)).toBe("past");
		const owed = outstandingReturns(state);
		expect(owed).toHaveLength(1);
		expect(owed[0].aboardT).toBe(COURIER.operand.tonnes);
		// **History does not hide what is owed.** Current names the goods, and
		// Past's pane carries both Return and Accept again's place.
		const current = requestsBody(
			view(state, "current", { offers: BOARD, selectedId: COURIER.id }),
		);
		expect(current).toContain(`data-live-request-owed="${COURIER.id}"`);
		const past = requestsBody(
			view(state, "past", { offers: BOARD, selectedId: COURIER.id }),
		);
		expect(past).toContain(
			`data-live-request-action="return-entrusted" data-live-request-id="${COURIER.id}"`,
		);
		state = act(state, "return-entrusted", COURIER.requester);
		expect(outstandingReturns(state)).toHaveLength(0);
		const returned = requestsBody(
			view(state, "past", { offers: BOARD, selectedId: COURIER.id }),
		);
		expect(returned).toContain(
			`data-live-request-action="accept" data-live-request-id="${COURIER.id}"`,
		);
		// Accept again brings it back to Current.
		state = act(state, "accept", COURIER.requester);
		expect(tabOf(state, true)).toBe("current");
		// Ready to report is still work: it stays until it is reported.
		state = act(state, "deliver", COURIER.reportAt);
		expect(state.byId[COURIER.id].status).toBe("ready-to-report");
		expect(tabOf(state, false)).toBe("current");
		state = act(state, "report", COURIER.reportAt);
		expect(tabOf(state, true)).toBe("past");
	});

	test("a refused press moves nothing", () => {
		const state = act(emptyRequests(), "accept", COURIER.requester);
		const refused = requestAction(
			state,
			BOARD,
			"report",
			COURIER.id,
			ctx(COURIER.requester),
		);
		expect(refused.ok).toBe(false);
		expect(tabOf(refused.state, true)).toBe("current");
	});
});

describe("C3: a tab is a way of looking, and looking changes nothing", () => {
	test("drawing either tab leaves the journal, the tracking and the cue alone", () => {
		const frozen = structuredClone(MIXED);
		const cues = (["current", "past"] as const).map((t) => {
			const v = view(MIXED, t, { docked: null, selectedId: DONE.id });
			requestsBody(v, true);
			requestsBody({ ...v, docked: at(COURIER.requester) });
			return requestCue(v);
		});
		expect(MIXED).toEqual(frozen);
		expect(MIXED.trackedRequestId).toBe(ONGOING_B.id);
		// Browsing Past does not untrack the job under way or change its cue.
		expect(cues[0]).toBe(cues[1]);
		expect(cues[0]).toContain(ONGOING_B.title);
	});

	test("the journal has no field for the tab, so a save cannot carry one", () => {
		expect(Object.keys(emptyRequests()).sort()).toEqual([
			"byId",
			"entrustedByLotId",
			"leadsById",
			"trackedRequestId",
		]);
	});
});
