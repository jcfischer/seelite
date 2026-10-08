/** Node #734: the losing station's entrusted recovery, through the live hold seam. */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import { DERELICT_SALVAGER_S, derelictSlots } from "../src/derelict-slots";
import {
	SALVAGE_OFFER_WINDOW_S,
	SALVAGE_PAY_FACTOR,
	bindSalvage,
	cargoOf,
	jobMark,
	salvageItemPrice,
	type SalvageTarget,
} from "../src/jobs";
import {
	salvageTargetsOf,
	salvageBoardKey,
	refreshSalvageRequests,
} from "../src/salvage-jobs";
import { recordTrade } from "../src/deficits";
import {
	emptyRequests,
	parseRequests,
	requestAction,
	type RequestContext,
} from "../src/requests";
import {
	applyHoldEvent,
	commanderAfterDeath,
	type Holdings,
} from "../src/holdings";
import { holdSummary } from "../src/hold";
import { emptyPending } from "../src/ladder";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { newCommander, transactAtStation } from "../src/station-commerce";
import { marketStationOf } from "../src/market";
import { holdBody } from "../src/hold-view";
import { generateContents } from "../src/system";
import { makeSystem } from "../src/sim";
import {
	effectiveDerelict,
	materializeDerelict,
	newWorld,
	scoopDerelict,
	advanceTo,
} from "../src/world-state";
import { requestsBody } from "../src/requests-view";
import { boardContext } from "./helpers/job-board";

const SEED = 0x5ee11e;
const systems = generateGalaxy(SEED, 0).systems;
const record = systems.find(
	(r) =>
		generateContents(r).stations.filter((s) => s.type !== "outpost").length > 1,
)!;
const system = makeSystem(record, 160);
const key = derelictSlots(record.index, record.government)[0].key;
const lostAt = 100;
const at = 160;
const world = materializeDerelict(newWorld(SEED), 0, key, at);
// A persisted loss fixture; assertions never depend on the randomly drawn manifest.
world.galaxies[0].derelicts[key] = {
	instanceOrdinal: 1,
	lostAt,
	containers: [
		{ kind: "good", id: "Food", tonnes: 4, left: 4 },
		{ kind: "good", id: "Computers", tonnes: 3, left: 3 },
		{ kind: "fitting", id: "Docking Computer", tonnes: 1, left: 1 },
	],
};
const targets = () => salvageTargetsOf(world, system, at);
const target = targets().find((t) => t.slotKey === key)!;
const station = system.contents.stations.find(
	(s) => carrierKey(record.index, s.localCarrierId) === target.homeStationKey,
)!;
const context = (t: SalvageTarget[] = targets(), time = at) => ({
	...boardContext(systems, record, station),
	gameTimeMin: time / 60,
	salvageTargets: t,
	holdT: 20,
});
const offer = () => bindSalvage(context())[0];
const ctx = (
	o = offer(),
	overrides: Partial<RequestContext> = {},
): RequestContext => ({
	now: at,
	docked: o.requester,
	cargo: {},
	holdRoomT: 20,
	holdCapacityT: 20,
	standing: "clean",
	equipment: [],
	...overrides,
});
const accept = () =>
	requestAction(emptyRequests(), [offer()], "accept", offer().id, ctx()).state;
const holdings = (): Holdings => ({
	commander: newCommander("courier"),
	requests: accept(),
	ladders: newCommanderRecord("courier").ladders,
	ladderPending: emptyPending(),
});
const scoop = (h = holdings(), w = world, index = 2) =>
	applyHoldEvent(h, w, {
		kind: "wreck-scoop",
		galaxyIndex: 0,
		key,
		instanceOrdinal: 1,
		containerIndex: index,
		at,
		container: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
		ship: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
	});

describe("home station Salvage offers", () => {
	test("only home lists one, prefers the fitting, and gives loss-age provenance without discovery", () => {
		for (const s of system.contents.stations) {
			const offers = bindSalvage({ ...context(), station: s });
			expect(
				offers.filter(
					(o) => o.operand.kind === "salvage" && o.operand.slotKey === key,
				).length,
			).toBe(s.id === station.id ? 1 : 0);
		}
		const o = offer();
		expect(o.operand).toMatchObject({
			kind: "salvage",
			slotKey: key,
			instanceOrdinal: 1,
			containerIndex: 2,
			item: {
				kind: "fitting",
				id: "Docking Computer",
				tonnes: 1,
				priceCr: 1000,
			},
		});
		expect(o.rewardCr).toBe(SALVAGE_PAY_FACTOR * 1000);
		expect(o.observedAt).toBe(lostAt);
		expect(o.source).toContain(station.name);
		expect(o.region).toContain("Near ");
		expect(world.galaxies[0].knowledge).toEqual({});
	});
	test("without a fitting selects the highest total value, and never substitutes another after its zero", () => {
		const t = { ...target, containers: target.containers.slice(0, 2) };
		expect(bindSalvage(context([t]))[0].operand).toMatchObject({
			containerIndex: 1,
			item: { id: "Computers", tonnes: 3 },
		});
		t.containers = t.containers.map((c, i) =>
			i === 1 ? { ...c, left: 0 } : c,
		);
		expect(bindSalvage(context([t]))).toEqual([]);
		expect(
			bindSalvage(
				context([
					{
						...target,
						containers: target.containers.map((c, i) =>
							i === 2 ? { ...c, left: 0 } : c,
						),
					},
				]),
			),
		).toEqual([]);
	});
	test("window excludes the exact 2 h boundary and a kept offer cannot bypass it", () => {
		expect(
			bindSalvage(context([target], lostAt + SALVAGE_OFFER_WINDOW_S - 1)),
		).toHaveLength(1);
		expect(
			bindSalvage(context([target], lostAt + SALVAGE_OFFER_WINDOW_S)),
		).toEqual([]);
		const kept = requestAction(
			emptyRequests(),
			[offer()],
			"retain",
			offer().id,
			ctx(),
		).state;
		expect(
			requestAction(
				kept,
				[],
				"accept",
				offer().id,
				ctx(offer(), { now: lostAt + SALVAGE_OFFER_WINDOW_S }),
			).ok,
		).toBe(false);
	});
	test("whole hold gate is separate from free room; no scanner gate and no issuance at accept", () => {
		const o = offer();
		expect(
			requestAction(
				emptyRequests(),
				[o],
				"accept",
				o.id,
				ctx(o, { holdCapacityT: 0 }),
			).message,
		).toContain("whole hold");
		const a = requestAction(
			emptyRequests(),
			[o],
			"accept",
			o.id,
			ctx(o, { holdRoomT: 0 }),
		);
		expect(a.ok).toBe(true);
		expect(a.state.entrustedByLotId).toEqual({});
	});
});

describe("entrusted recovery Operational condition", () => {
	test("Salvage is not a cargo operand or a market mark", () => {
		expect(cargoOf(offer())).toBeNull();
		expect(jobMark(offer())).toBeNull();
	});
	test("board facts stay stable across frames and change when stripped or the offer window closes", () => {
		const initial = salvageBoardKey(world, system, at);
		expect(initial).not.toBe("");
		expect(salvageBoardKey(world, system, at + 1)).toBe(initial);
		expect(
			salvageBoardKey(scoopDerelict(world, 0, key, 2, 1, at), system, at),
		).not.toBe(initial);
		expect(
			salvageBoardKey(world, system, lostAt + SALVAGE_OFFER_WINDOW_S),
		).not.toBe(initial);
	});
	test("a goods job scoops whole and cannot be sold; the accepted price stays pinned", () => {
		const w = structuredClone(world);
		w.galaxies[0].derelicts[key].containers.pop();
		const t = salvageTargetsOf(w, system, at);
		const o = bindSalvage(context(t))[0];
		// The board read precedes a market movement and an epoch change.
		w.galaxies[0].deficits = recordTrade({}, o.requester.carrierKey, {
			goodName: "Computers",
			units: 200,
			gameTimeMin: at / 60,
			holdT: 20,
		});
		const start = { ...holdings(), requests: emptyRequests() };
		const accepted = applyHoldEvent(start, w, {
			kind: "settlement",
			action: "accept",
			salvagePosting: { system: record, station },
			id: o.id,
			offer: o,
			docked: o.requester,
			standing: "clean",
			galaxyIndex: 0,
			at: at + 1900,
		});
		const op = accepted.holdings.requests.byId[o.id].terms.operand;
		if (op.kind !== "salvage") throw Error("not Salvage");
		expect(op.item.priceCr).toBe(
			salvageItemPrice(
				{
					...context(t),
					deficits: w.galaxies[0].deficits,
					gameTimeMin: (at + 1900) / 60,
				},
				op.item,
			),
		);
		expect(accepted.holdings.requests.byId[o.id].terms.rewardCr).not.toBe(
			o.rewardCr,
		);
		expect(accepted.signals.message).toContain(
			`Payment: ${SALVAGE_PAY_FACTOR * op.item.priceCr} Cr`,
		);
		// Two tonnes fit, but the three-tonne container cannot be split for a job.
		const cramped = {
			...accepted.holdings,
			commander: { ...start.commander, cargo: { Food: 18 } },
		};
		const event = {
			kind: "wreck-scoop" as const,
			galaxyIndex: 0,
			key,
			instanceOrdinal: 1,
			containerIndex: 1,
			at: at + 1900,
			container: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
			ship: { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } },
		};
		const refusal = applyHoldEvent(cramped, accepted.world, event);
		expect(refusal.holdings).toBe(cramped);
		expect(refusal.signals.wreckScoop?.refusal).toContain("2 t free; 3 t");
		const recovered = applyHoldEvent(accepted.holdings, accepted.world, event);
		expect(recovered.holdings.commander.cargo.Computers).toBeUndefined();
		expect(parseRequests(recovered.holdings.requests, at + 1900)).toEqual(
			recovered.holdings.requests,
		);
		const sale = transactAtStation({
			commander: recovered.holdings.commander,
			deficits: {},
			station: marketStationOf(station, record.seed),
			stationKey: o.requester.carrierKey,
			economy: record.economy,
			gameTimeMin: (at + 1900) / 60,
			displayTL: record.displayTL,
			entrustedT: 3,
			rungs: { combat: 0, trade: 0, exploration: 0 },
			hullReach: () => ({ ok: true, systems: 1 }),
			action: { type: "sell-commodity", commodity: "Computers" },
		});
		expect(sale.accepted).toBe(false);
		const delivered = requestAction(
			recovered.holdings.requests,
			[],
			"deliver",
			o.id,
			ctx(o, { now: lostAt + DERELICT_SALVAGER_S + 10 }),
		);
		expect(delivered.rewardCr).toBe(SALVAGE_PAY_FACTOR * op.item.priceCr);
		expect(delivered.mark).toBeNull();
	});
	test("stale board acceptance and a mismatched recovery cannot manufacture a lot", () => {
		const o = offer();
		const stripped = scoopDerelict(world, 0, key, 2, 1, at);
		const h = { ...holdings(), requests: emptyRequests() };
		const result = applyHoldEvent(h, stripped, {
			kind: "settlement",
			action: "accept",
			salvagePosting: { system: record, station },
			id: o.id,
			offer: o,
			docked: o.requester,
			standing: "clean",
			galaxyIndex: 0,
			at,
		});
		expect(result.holdings).toBe(h);
		expect(result.signals.message).toContain("no longer available");
		const w = structuredClone(world);
		w.galaxies[0].derelicts[key].containers[2].id = "Fuel Scoops";
		const no = scoop(holdings(), w);
		expect(no.holdings.requests.entrustedByLotId).toEqual({});
		expect(no.world).toBe(w);
	});
	test("whole scoop refuses atomically with both amounts; other containers remain owned", () => {
		const start = holdings();
		const h = {
			...start,
			commander: { ...start.commander, cargo: { Food: 20 } },
		};
		const no = scoop(h);
		expect(no.holdings).toBe(h);
		expect(no.world).toBe(world);
		expect(no.signals.wreckScoop?.refusal).toContain("0 t free");
		expect(no.signals.wreckScoop?.refusal).toContain("1 t");
		const other = scoop(holdings(), world, 0);
		expect(other.holdings.commander.cargo.Food).toBe(4);
		expect(other.holdings.requests.entrustedByLotId).toEqual({});
	});
	test("named fitting becomes requester cargo; Deliver pays once with no market mark or report", () => {
		const took = scoop();
		const o = offer();
		expect(took.holdings.commander.recoveredFittings).toBeUndefined();
		const projected = holdSummary(
			took.holdings.commander,
			took.holdings.requests,
		);
		expect(holdBody(projected, null)).toContain("the requester's");
		expect(
			holdSummary(took.holdings.commander, took.holdings.requests).lines,
		).toContainEqual(
			expect.objectContaining({
				goodName: "Docking Computer",
				owner: "requester",
				kind: "fitting",
				amount: 1,
			}),
		);
		expect(effectiveDerelict(took.world, 0, key, at)).toMatchObject({
			containers: expect.arrayContaining([
				expect.objectContaining({ id: "Docking Computer", left: 0 }),
			]),
		});
		const delivered = applyHoldEvent(took.holdings, took.world, {
			kind: "settlement",
			action: "deliver",
			id: o.id,
			offer: null,
			docked: o.requester,
			standing: "clean",
			galaxyIndex: 0,
			at: at + 1,
		});
		expect(
			delivered.holdings.commander.credits - took.holdings.commander.credits,
		).toBe(o.rewardCr);
		expect(delivered.holdings.requests.byId[o.id].status).toBe("completed");
		expect(delivered.holdings.requests.entrustedByLotId).toEqual({});
		expect(delivered.world.galaxies[0].deficits).toEqual({});
		for (const action of ["deliver", "report"])
			expect(
				requestAction(
					delivered.holdings.requests,
					[],
					action,
					o.id,
					ctx(o, { now: at + 2 }),
				).ok,
			).toBe(false);
	});
	test("accepted remains valid after window; salvagers fail only jobs with no item aboard", () => {
		const a = accept();
		expect(
			refreshSalvageRequests(a, world, lostAt + SALVAGE_OFFER_WINDOW_S + 1),
		).toBe(a);
		const failed = refreshSalvageRequests(
			a,
			world,
			lostAt + DERELICT_SALVAGER_S,
		);
		expect(failed.byId[offer().id]).toMatchObject({
			status: "failed",
			outcomeReason: expect.stringContaining("Wreck taken by salvagers"),
			settledAt: null,
		});
		const h = holdings();
		const tick = applyHoldEvent(h, world, {
			kind: "requests-clock",
			at: lostAt + DERELICT_SALVAGER_S,
		});
		expect(tick.holdings.requests.byId[offer().id].status).toBe("failed");
		expect(tick.world).toBe(world);
		expect(
			applyHoldEvent(tick.holdings, tick.world, {
				kind: "requests-clock",
				at: lostAt + DERELICT_SALVAGER_S + 1,
			}).holdings,
		).toBe(tick.holdings);
		const took = scoop();
		expect(
			refreshSalvageRequests(
				took.holdings.requests,
				took.world,
				lostAt + DERELICT_SALVAGER_S,
			),
		).toBe(took.holdings.requests);
	});
	test("death reads the dying journal even though launch had no recovered lot", () => {
		const dock = { ...newCommanderRecord("courier"), requests: accept() };
		const dying = { ...dock, requests: scoop().holdings.requests };
		const restored = commanderAfterDeath(dock, dying, "destroyed");
		expect(restored.requests.byId[offer().id]).toMatchObject({
			status: "failed",
			outcomeReason: expect.stringContaining("Lost"),
		});
		expect(restored.requests.entrustedByLotId).toEqual({});
		expect(restored.state.recoveredFittings).toBeUndefined();
	});
	test("death before recovery fails the job without claiming an item was lost", () => {
		const dock = { ...newCommanderRecord("courier"), requests: accept() };
		for (const cause of ["destroyed", "eject"] as const) {
			const restored = commanderAfterDeath(dock, dock, cause);
			expect(restored.requests.byId[offer().id]).toMatchObject({
				status: "failed",
				outcomeReason:
					"Recovery interrupted by your emergency return. Cancelled free; you owe nothing.",
			});
			expect(restored.requests.entrustedByLotId).toEqual({});
			expect(parseRequests(restored.requests, at)).toEqual(restored.requests);
		}
	});
	test("journal and current schema save round-trip fitting and good lots; reject malformed snapshots", () => {
		const took = scoop();
		expect(parseRequests(took.holdings.requests, at)).toEqual(
			took.holdings.requests,
		);
		const commander = {
			...newCommanderRecord("courier"),
			state: took.holdings.commander,
			requests: took.holdings.requests,
		};
		const saved = serializeSave({
			world: advanceTo(took.world, at),
			commander,
		});
		expect(parseSave(saved).commander.requests).toEqual(took.holdings.requests);
		expect(SAVE_SCHEMA_VERSION).toBe(11);
		const bad = structuredClone(took.holdings.requests);
		(bad.byId[offer().id].terms.operand as any).item.priceCr = -1;
		expect(() => parseRequests(bad, at)).toThrow("invalid Requests");
	});
	test("Requests shows named tonnes and unlocked recovery instructions", () => {
		const o = offer();
		const html = requestsBody({
			state: emptyRequests(),
			offers: [o],
			selectedId: o.id,
			message: "",
			revision: 0,
			now: at,
			docked: o.requester,
			hold: null,
			equipment: [],
			tab: "current",
		});
		expect(html).toContain("1 t of Docking Computer");
		expect(html).toContain('data-live-request-action="accept"');
		expect(html).toContain("60s old");
		expect(html).toContain("Deliver at");
	});
});
