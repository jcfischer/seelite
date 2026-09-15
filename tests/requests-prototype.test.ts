import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	emptyRequests,
	fixtureOffers,
	requestAction,
	parseRequests,
	nextAction,
} from "../src/requests-prototype";

const offers = fixtureOffers(0, carrierKey(0, "station-trade"), "QUERIOR", 10);
const context = {
	now: 20,
	docked: { galaxyIndex: 0, carrierKey: carrierKey(0, "station-trade") },
	armed: true,
};
const act = (
	state: ReturnType<typeof emptyRequests>,
	action: string,
	id = offers[0].id,
	ctx: Parameters<typeof requestAction>[4] = context,
) => requestAction(state, offers, action, id, ctx);

describe("bounded Requests UI experiment", () => {
	test("acceptance snapshots terms independent of later offer mutation", () => {
		const available = structuredClone(offers);
		const accepted = requestAction(
			emptyRequests(),
			available,
			"accept",
			available[0].id,
			context,
		).state;
		available[0].rewardCr = 999;
		available[0].stages.splice(0, 1);
		expect(accepted.byId[available[0].id].terms.rewardCr).toBe(250);
		expect(accepted.byId[available[0].id].terms.stages).toEqual([
			"search",
			"identify",
			"disable",
		]);
	});
	test("reading is independent of commitment; two accepts never change tracking", () => {
		let s = emptyRequests();
		expect(Object.keys(s.byId)).toHaveLength(0);
		s = act(s, "retain").state;
		expect(Object.keys(s.byId)).toHaveLength(0);
		s = act(s, "accept").state;
		expect(s.trackedRequestId).toBeNull();
		s = act(s, "track").state;
		const first = s.trackedRequestId;
		s = act(s, "accept", offers[1].id).state;
		expect(Object.keys(s.byId)).toHaveLength(2);
		expect(s.trackedRequestId).toBe(first);
		expect(act(s, "accept").ok).toBe(false);
	});
	test("atomic requirement refusal and region-only search cue", () => {
		const s = emptyRequests();
		const refused = act(s, "accept", offers[0].id, {
			...context,
			armed: false,
		});
		expect(refused.ok).toBe(false);
		expect(refused.state).toBe(s);
		const accepted = act(s, "accept").state;
		expect(nextAction(accepted.byId[offers[0].id])).toContain("Search");
		expect(JSON.stringify(accepted)).not.toMatch(
			/coordinates|position|targetId/,
		);
	});
	test("ordered fixture evidence advances untracked work and wrong station cannot pay", () => {
		let s = act(emptyRequests(), "accept").state;
		expect(act(s, "fixture-disable").ok).toBe(false);
		s = act(s, "fixture-search").state;
		s = act(s, "fixture-identify").state;
		s = act(s, "fixture-disable").state;
		expect(s.byId[offers[0].id].status).toBe("ready-to-report");
		expect(
			act(s, "report", offers[0].id, { ...context, docked: null }).ok,
		).toBe(false);
		expect(
			act(s, "report", offers[0].id, {
				...context,
				docked: { galaxyIndex: 1, carrierKey: context.docked.carrierKey },
			}).ok,
		).toBe(false);
		const paid = act(s, "report");
		expect(paid.rewardCr).toBe(250);
		expect(act(paid.state, "report").rewardCr).toBe(0);
		expect(act(paid.state, "accept").ok).toBe(false);
	});
	test("cancel/reaccept retains pinned terms and earned evidence without switching cue", () => {
		let s = act(emptyRequests(), "accept").state;
		s = act(s, "fixture-search").state;
		s = act(s, "track").state;
		s = act(s, "cancel").state;
		expect(s.trackedRequestId).toBeNull();
		expect(act(s, "fixture-identify").ok).toBe(false);
		s = act(s, "accept").state;
		expect(s.byId[offers[0].id].acceptanceOrdinal).toBe(2);
		expect(s.byId[offers[0].id].evidence).toHaveLength(1);
		expect(s.byId[offers[0].id].terms.rewardCr).toBe(250);
	});
	test("observed unavailable target has report information/cancel path and earned success survives", () => {
		let s = act(emptyRequests(), "accept").state;
		s = act(s, "fixture-unavailable").state;
		expect(nextAction(s.byId[offers[0].id])).toContain("unavailable");
		expect(act(s, "report-unavailable").state.byId[offers[0].id].status).toBe(
			"failed",
		);
		expect(act(s, "cancel").ok).toBe(true);
		let ready = act(emptyRequests(), "accept").state;
		for (const stage of ["search", "identify", "disable"])
			ready = act(ready, `fixture-${stage}`).state;
		ready = act(ready, "fixture-unavailable").state;
		expect(ready.byId[offers[0].id].status).toBe("ready-to-report");
	});
	test("load validates stage status tracking identities time and bounded evidence", () => {
		let s = act(emptyRequests(), "accept").state;
		s = act(s, "track").state;
		expect(parseRequests(JSON.parse(JSON.stringify(s)), 20)).toEqual(s);
		const broken = structuredClone(s);
		broken.byId[offers[0].id].status = "completed";
		expect(() => parseRequests(broken, 20)).toThrow();
		expect(() =>
			parseRequests({ ...s, trackedRequestId: "missing" }, 20),
		).toThrow();
		expect(() => parseRequests(s, 5)).toThrow();
	});
});
