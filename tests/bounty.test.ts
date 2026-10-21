/**
 * Node 508: the Bounty family, with the pirate relay as its first target.
 *
 * #495 ruled that clearing raider infrastructure pays through a Bounty job and
 * nothing else: every lawful station in the system posts it while the target is
 * operational, it is claimed where it was posted, and only a Clean pilot may
 * accept or report it. #508's own ruling (2026-09-24) adds three things these
 * rows hold: the kill is recorded as **evidence when it happens** rather than
 * read off the world at report (`missions-and-requests.md` §3 and §7), the
 * offer is gated on the Long-Range Scanner and lists **locked** without it
 * (#489's ruling, absorbed here), and Bounty needed no save version of its
 * own: the save was 5 then and is 6 since #408's first-day choice.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import {
	BOUNTY_EQUIPMENT,
	type BindContext,
	type JobOffer,
	bindBounty,
	bindJobs,
	offerRequirements,
} from "../src/jobs";
import { LONG_RANGE_SCANNER } from "../src/market";
import {
	RELAY_NAME,
	RELAY_REPAIR_S,
	RELAY_WRECK_S,
	bountyTargetOf,
	relayActive,
	relayDestruction,
} from "../src/pirate-relay";
import { relayPlan, relaySlot } from "../src/relay-slot";
import { type RequestsView, requestsBody } from "../src/requests-view";
import {
	SAVE_SCHEMA_VERSION,
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import {
	type RequestContext,
	type RequestsState,
	emptyRequests,
	nextAction,
	parseRequests,
	recordKill,
	requestAction,
	settledAt,
} from "../src/requests";
import { generateContents } from "../src/system";
import { applyTransition, newWorld } from "../src/world-state";
import {
	boardContext,
	firstOffer,
	postingStations,
	stationKeyOf,
} from "./helpers/job-board";

const WORLD = 0x5ee11e;
const SYSTEMS = generateGalaxy(WORLD, 0).systems;

/** The first system whose relay rolled active and which has two lawful
 *  stations, so "every station posts it" is a claim about more than one. */
const HOME = (() => {
	for (const record of SYSTEMS) {
		if (!relayActive(record)) continue;
		const stations = postingStations(record);
		if (stations.length >= 2) return { record, stations };
	}
	throw new Error("no active-relay system with two posting stations");
})();

const env0 = newWorld(WORLD).galaxies[0];
const TARGET = bountyTargetOf(
	HOME.record,
	generateContents(HOME.record),
	env0,
	0,
);

const bountyAt = (
	stationIndex: number,
	overrides: Partial<BindContext> = {},
): JobOffer | null =>
	bindBounty({
		...boardContext(SYSTEMS, HOME.record, HOME.stations[stationIndex], {
			bountyTarget: TARGET,
		}),
		...overrides,
	});

const OFFER = bountyAt(0) as JobOffer;
const OFFERS = [OFFER];
const KEY = relaySlot(HOME.record.index).key;
/** The relay as a kill names it: the galaxy with the key (sage round 2). */
const REF = { galaxyIndex: 0, carrierKey: KEY };

const ctx = (overrides: Partial<RequestContext> = {}): RequestContext => ({
	now: 60,
	docked: OFFER.requester,
	cargo: {},
	holdRoomT: 20,
	standing: "clean",
	equipment: [LONG_RANGE_SCANNER],
	...overrides,
});

const act = (
	state: RequestsState,
	action: string,
	overrides: Partial<RequestContext> = {},
) => requestAction(state, OFFERS, action, OFFER.id, ctx(overrides));

const accepted = (): RequestsState => {
	const result = act(emptyRequests(), "accept");
	if (!result.ok) throw new Error(result.message);
	return result.state;
};

describe("the target", () => {
	test("is the system's relay while it is active and operational", () => {
		expect(TARGET).not.toBeNull();
		expect(TARGET?.carrierKey).toBe(KEY);
		expect(TARGET?.name).toBe(RELAY_NAME);
		const plan = relayPlan(generateContents(HOME.record), HOME.record.seed);
		const watched = generateContents(HOME.record).stations.find(
			(s) => s.id === plan?.watchedStationId,
		);
		expect(TARGET?.watchedStationName).toBe(watched?.name as string);
	});

	test("is absent in a system whose relay rolled inactive", () => {
		const quiet = SYSTEMS.find(
			(r) => !relayActive(r) && generateContents(r).stations.length > 0,
		);
		if (!quiet) throw new Error("no inactive-relay system with a station");
		// An absent row reads operational, so the roll is what has to refuse.
		expect(bountyTargetOf(quiet, generateContents(quiet), env0, 0)).toBeNull();
	});

	test("is absent while destroyed and repairing, and back once replaced", () => {
		const plan = relayPlan(generateContents(HOME.record), HOME.record.seed);
		const world = applyTransition(
			newWorld(WORLD),
			0,
			KEY,
			relayDestruction(HOME.record.index, 0, plan?.watchedStationId as string),
		);
		const env = world.galaxies[0];
		const contents = generateContents(HOME.record);
		expect(bountyTargetOf(HOME.record, contents, env, 1)).toBeNull();
		expect(
			bountyTargetOf(HOME.record, contents, env, RELAY_WRECK_S + 1),
		).toBeNull();
		expect(
			bountyTargetOf(
				HOME.record,
				contents,
				env,
				RELAY_WRECK_S + RELAY_REPAIR_S,
			),
		).not.toBeNull();
	});
});

describe("the binder (ordinary-requests.md D8, #495 D4)", () => {
	test("every lawful station in the system posts one, naming the relay", () => {
		for (let i = 0; i < HOME.stations.length; i++) {
			const offer = bountyAt(i);
			expect(offer).not.toBeNull();
			expect(offer?.operand).toEqual({
				kind: "target",
				carrierKey: KEY,
				targetName: RELAY_NAME,
			});
		}
	});

	test("it is claimed where it was posted, and pays the row's flat figure", () => {
		expect(OFFER.family).toBe("bounty");
		expect(OFFER.reportAt).toEqual(OFFER.requester);
		expect(OFFER.requester.carrierKey).toBe(
			stationKeyOf(HOME.record, HOME.stations[0]),
		);
		expect(OFFER.distanceLy).toBe(0);
		expect(OFFER.stages).toEqual(["destroy"]);
		// #508 D3: the principal's figure, until #511's defender re-tunes it.
		expect(OFFER.rewardCr).toBe(400);
	});

	test("the region is the watched approach, and names no position", () => {
		expect(OFFER.region).toContain(TARGET?.watchedStationName as string);
		expect(OFFER.region).toContain(HOME.record.name);
	});

	test("posts nothing without an operational target", () => {
		expect(bountyAt(0, { bountyTarget: null })).toBeNull();
	});

	test("a raider outpost never posts it, and the exclusion is the binder's", () => {
		const outpost = { ...HOME.stations[0], type: "outpost" as const };
		// `bindJobs` refuses an outpost for its price offset (`canPostJobs`),
		// which would hide the binder's own rule; so the binder is asked alone.
		expect(bountyAt(0, { station: outpost })).toBeNull();
	});

	test("is a pure function: the same station, world and clock bind it twice", () => {
		expect(bountyAt(0)).toEqual(bountyAt(0));
	});

	test("joins the board beside the other families", () => {
		const board = bindJobs(
			boardContext(SYSTEMS, HOME.record, HOME.stations[0], {
				bountyTarget: TARGET,
			}),
		);
		expect(board.some((o) => o.family === "bounty")).toBe(true);
		expect(board.some((o) => o.family === "courier")).toBe(true);
	});

	test("a settled episode posts the next one under a new identity", () => {
		const next = bountyAt(0, { settled: { bounty: 1 } });
		expect(next?.episode).toBe(2);
		expect(next?.id).not.toBe(OFFER.id);
	});
});

describe("the equipment gate (#489's ruling)", () => {
	test("the offer names the Long-Range Scanner as its requirement", () => {
		expect(BOUNTY_EQUIPMENT).toEqual([LONG_RANGE_SCANNER]);
		expect(offerRequirements(OFFER)).toEqual([LONG_RANGE_SCANNER]);
	});

	test("cargo families require nothing", () => {
		const board = bindJobs(
			boardContext(SYSTEMS, HOME.record, HOME.stations[0]),
		);
		for (const offer of board) expect(offerRequirements(offer)).toEqual([]);
	});

	test("accept refuses an unfitted pilot and names the module", () => {
		const result = act(emptyRequests(), "accept", { equipment: [] });
		expect(result.ok).toBe(false);
		expect(result.message).toContain(LONG_RANGE_SCANNER);
	});
});

describe("Clean only (#495 D2)", () => {
	test("a Wanted pilot is refused at accept, with a reason", () => {
		for (const standing of ["wanted", "fugitive"] as const) {
			const result = act(emptyRequests(), "accept", { standing });
			expect(result.ok).toBe(false);
			expect(result.message).toMatch(/Clean/);
			expect(result.state).toEqual(emptyRequests());
		}
	});

	test("a Clean, fitted pilot accepts, and nothing is loaded", () => {
		const result = act(emptyRequests(), "accept");
		expect(result.ok).toBe(true);
		expect(result.state.entrustedByLotId).toEqual({});
		expect(result.state.byId[OFFER.id].status).toBe("accepted");
	});

	test("a pilot who turned Wanted after the kill is refused at report", () => {
		const ready = recordKill(accepted(), REF, 100);
		const result = act(ready, "report", { now: 120, standing: "wanted" });
		expect(result.ok).toBe(false);
		expect(result.message).toMatch(/Clean/);
		expect(result.rewardCr).toBe(0);
	});
});

describe("the kill is evidence recorded when it happens (#508 D1)", () => {
	test("report before the kill is refused", () => {
		const result = act(accepted(), "report", { now: 90 });
		expect(result.ok).toBe(false);
		expect(result.rewardCr).toBe(0);
	});

	test("there is nothing to deliver", () => {
		expect(act(accepted(), "deliver", { now: 90 }).ok).toBe(false);
	});

	test("the relay's kill moves the request to ready-to-report", () => {
		const ready = recordKill(accepted(), REF, 100);
		const request = ready.byId[OFFER.id];
		expect(request.status).toBe("ready-to-report");
		expect(request.evidence).toEqual([
			{ stageId: "destroy", occurredAt: 100, source: "kill" },
		]);
	});

	test("another carrier's kill moves nothing", () => {
		const state = accepted();
		expect(
			recordKill(
				state,
				{
					galaxyIndex: 0,
					carrierKey: carrierKey(HOME.record.index, "raider-00"),
				},
				100,
			),
		).toBe(state);
	});

	test("a kill made before the job was accepted pays nothing (H8)", () => {
		// The kill lands first, then the pilot accepts: there was no accepted
		// request to record it, and reporting has nothing to settle.
		const before = recordKill(emptyRequests(), REF, 30);
		const state = act(before, "accept", { now: 60 }).state;
		expect(state.byId[OFFER.id].status).toBe("accepted");
		expect(act(state, "report", { now: 90 }).ok).toBe(false);
	});

	test("an accepted request ignores a kill stamped before its acceptance", () => {
		// The row above reaches H8 through ordering: no request existed to
		// hear the kill. This one reaches the guard itself.
		const state = accepted();
		expect(recordKill(state, REF, 30)).toBe(state);
	});

	test("one kill readies every accepted Bounty naming it, one per station (§3)", () => {
		// The request contract: one act may satisfy several distinct requests,
		// and rewards are per contract. With a Bounty accepted at each of the
		// system's lawful stations, one relay kill is worth each of them — the
		// figure #511's re-tune is read against.
		const second = bountyAt(1) as JobOffer;
		const both = [OFFER, second];
		let state = emptyRequests();
		for (const offer of both)
			state = requestAction(state, both, "accept", offer.id, {
				...ctx(),
				docked: offer.requester,
			}).state;
		const ready = recordKill(state, REF, 100);
		expect(both.map((o) => ready.byId[o.id]?.status)).toEqual([
			"ready-to-report",
			"ready-to-report",
		]);
		let paid = 0;
		let settled = ready;
		for (const offer of both) {
			const result = requestAction(settled, both, "report", offer.id, {
				...ctx({ now: 120 }),
				docked: offer.reportAt,
			});
			paid += result.rewardCr;
			settled = result.state;
		}
		expect(paid).toBe(2 * OFFER.rewardCr);
	});

	test("a kill at the same system index in another galaxy moves nothing", () => {
		// Sage round 2: the key holds no galaxy, so the reference has to.
		const state = accepted();
		expect(recordKill(state, { galaxyIndex: 1, carrierKey: KEY }, 100)).toBe(
			state,
		);
	});

	test("a cancelled request does not listen", () => {
		const cancelled = act(accepted(), "cancel", { now: 70 }).state;
		expect(recordKill(cancelled, REF, 100)).toBe(cancelled);
	});

	test("a cancelled Bounty is reaccepted off its pinned terms, with the relay down", () => {
		// Sage round 1 read reaccept as needing the offer on the live board,
		// which posts nothing while the relay is destroyed. It does not: the
		// journal row carries its own terms (`requestAction` resolves
		// `existing?.terms` first), and the board draws the row from the
		// journal. So this passes an **empty** board.
		const ready = recordKill(accepted(), REF, 100);
		const cancelled = act(ready, "cancel", { now: 110 }).state;
		const back = requestAction(
			cancelled,
			[],
			"accept",
			OFFER.id,
			ctx({ now: 120 }),
		);
		expect(back.ok).toBe(true);
		expect(back.state.byId[OFFER.id].status).toBe("ready-to-report");
	});

	test("evidence earned while accepted survives a cancel and reaccept (§3)", () => {
		const ready = recordKill(accepted(), REF, 100);
		const cancelled = act(ready, "cancel", { now: 110 }).state;
		const back = act(cancelled, "accept", { now: 120 });
		expect(back.ok).toBe(true);
		expect(back.state.byId[OFFER.id].status).toBe("ready-to-report");
	});

	test("a Clean report at the posting station pays once, and writes no mark", () => {
		const ready = recordKill(accepted(), REF, 100);
		const paid = act(ready, "report", { now: 120 });
		expect(paid.ok).toBe(true);
		expect(paid.rewardCr).toBe(400);
		// The mark is the relay's `destroy`, which the kill already wrote.
		expect(paid.mark).toBeNull();
		expect(paid.message).toContain(RELAY_NAME);
		const again = act(paid.state, "report", { now: 130 });
		expect(again.ok).toBe(false);
		expect(again.rewardCr).toBe(0);
	});

	test("report is at the posting station and nowhere else", () => {
		const ready = recordKill(accepted(), REF, 100);
		const elsewhere = act(ready, "report", {
			now: 120,
			docked: {
				galaxyIndex: 0,
				carrierKey: stationKeyOf(HOME.record, HOME.stations[1]),
			},
		});
		expect(elsewhere.ok).toBe(false);
	});

	test("a settled bounty is counted for the next episode", () => {
		const paid = act(recordKill(accepted(), REF, 100), "report", { now: 120 });
		expect(settledAt(paid.state, OFFER.requester).bounty).toBe(1);
	});
});

describe("the journal (#508 D4: no save version bump)", () => {
	const settled = () =>
		act(recordKill(accepted(), REF, 100), "report", { now: 120 }).state;

	/** Cancelled while ready, then reaccepted: the kill predates the new
	 *  acceptance, which no other path writes (sage round 1). */
	const reaccepted = () =>
		act(
			act(recordKill(accepted(), REF, 100), "cancel", { now: 110 }).state,
			"accept",
			{
				now: 120,
			},
		).state;

	test("a bounty journal round-trips at every status", () => {
		for (const state of [
			accepted(),
			recordKill(accepted(), REF, 100),
			settled(),
			reaccepted(),
		]) {
			const raw = JSON.parse(JSON.stringify(state));
			expect(parseRequests(raw, 200)).toEqual(state);
		}
	});

	test("a bounty's evidence must come from a kill", () => {
		const raw = JSON.parse(JSON.stringify(recordKill(accepted(), REF, 100)));
		raw.byId[OFFER.id].evidence[0].source = "delivery";
		expect(() => parseRequests(raw, 200)).toThrow();
	});

	test("a cargo job's evidence may not come from a kill", () => {
		const { offers, offer } = firstOffer(SYSTEMS, "courier");
		const run = (state: RequestsState, action: string, now: number) =>
			requestAction(state, offers, action, offer.id, {
				...ctx({ now }),
				docked: action === "accept" ? offer.requester : offer.reportAt,
			}).state;
		const delivered = run(run(emptyRequests(), "accept", 60), "deliver", 90);
		const raw = JSON.parse(JSON.stringify(delivered));
		// The control: the delivered journal loads as written.
		expect(parseRequests(raw, 200)).toEqual(delivered);
		raw.byId[offer.id].evidence[0].source = "kill";
		expect(() => parseRequests(raw, 200)).toThrow();
	});

	test("the target is in the requester's own system", () => {
		const raw = JSON.parse(JSON.stringify(accepted()));
		raw.byId[OFFER.id].terms.operand.carrierKey = carrierKey(
			HOME.record.index + 1,
			"relay-00",
		);
		expect(() => parseRequests(raw, 200)).toThrow();
	});
});

describe("the whole save (#508 D4)", () => {
	test("carries a bounty through a ready-to-report save", () => {
		expect(SAVE_SCHEMA_VERSION).toBe(16);
		const world = newWorld(WORLD);
		world.gameTime = 200;
		const commander = newCommanderRecord("courier");
		commander.requests = recordKill(accepted(), REF, 100);
		const saved = serializeSave({ world, commander });
		expect((saved as { saveSchemaVersion: number }).saveSchemaVersion).toBe(16);
		expect(parseSave(saved)).toEqual({ world, commander });
	});
});

describe("the board (#489's locked row)", () => {
	const view = (
		equipment: readonly string[],
		state: RequestsState = emptyRequests(),
	): RequestsView => ({
		state,
		offers: OFFERS,
		selectedId: OFFER.id,
		message: "",
		revision: 1,
		now: OFFER.observedAt + 1,
		docked: OFFER.requester,
		hold: null,
		equipment,
		tab: "current",
	});

	test("unfitted, the row lists locked, names the module, and draws no Accept", () => {
		const html = requestsBody(view([]));
		expect(html).toContain(`locked: needs ${LONG_RANGE_SCANNER}`);
		expect(html).toContain("data-live-request-locked");
		expect(html).toContain(`${LONG_RANGE_SCANNER}, not fitted`);
		expect(html).not.toContain('data-live-request-action="accept"');
		// Keeping it for later stays open: browsing is never gated (§2).
		expect(html).toContain('data-live-request-action="retain"');
	});

	test("fitted, the same row unlocks and Accept is drawn", () => {
		const html = requestsBody(view([LONG_RANGE_SCANNER]));
		expect(html).not.toContain("data-live-request-locked");
		expect(html).toContain(`${LONG_RANGE_SCANNER}, fitted`);
		expect(html).toContain('data-live-request-action="accept"');
	});

	test("the row says what the job is about, and the details say no cargo", () => {
		const html = requestsBody(view([LONG_RANGE_SCANNER]));
		expect(html).toContain(`bounty: ${RELAY_NAME}`);
		expect(html).toContain("<dt>Cargo</dt><dd>None</dd>");
	});

	test("an accepted bounty draws no Deliver, and its next action names the target", () => {
		const html = requestsBody(view([LONG_RANGE_SCANNER], accepted()));
		expect(html).not.toContain('data-live-request-action="deliver"');
		const request = accepted().byId[OFFER.id];
		// The whole sentence: the region is a label, and spliced into prose it
		// read "in The approach to" on the first capture the principal saw.
		expect(nextAction(request)).toBe(
			`Destroy the ${RELAY_NAME}. Search area: ${OFFER.region}. Collect at ${OFFER.reportName}.`,
		);
	});

	test("a ready bounty draws Report at the posting station", () => {
		const html = requestsBody(
			view([LONG_RANGE_SCANNER], recordKill(accepted(), REF, 100)),
		);
		expect(html).toContain('data-live-request-action="report"');
	});
});
