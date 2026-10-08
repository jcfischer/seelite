/**
 * #626: the law that applies a pilot's act to their **Holdings**, at the
 * module's interface.
 *
 * `requestAction`, `transactAtStation` and `scoopCargo` were already pure and
 * already tested (`requests`, `station-commerce`, `ladder`). What had no test
 * was the step after them: crediting the job's pay, folding the cargo delta,
 * moving the purchase basis with the cargo, writing the world's mark with the
 * flown hull's hold. `Game` did that by hand at three sites, and only a
 * browser probe reached any of them. These rows are that step.
 */
import { describe, expect, test } from "bun:test";
import { type CarrierKey, carrierKey } from "../src/carrier-key";
import { readDeficit, recordTrade } from "../src/deficits";
import { generateGalaxy } from "../src/galaxy";
import {
	type AdoptEffects,
	type Holdings,
	type HoldEvent,
	type HoldOutcome,
	adoptEffects,
	applyHoldEvent,
	commanderAfterDeath,
	holdOf,
} from "../src/holdings";
import { newCommanderRecord } from "../src/save-envelope";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import {
	LADDER_TOP,
	TOP_RUNGS,
	emptyLadderRecord,
	emptyPending,
	ladderAfterHullSale,
	ladderAfterPlay,
	ladderAfterMarket,
} from "../src/ladder";
import { type JobOffer, bindBounty } from "../src/jobs";
import { killCredit } from "../src/kill-credit";
import {
	DEFICIT_MAX,
	LONG_RANGE_SCANNER,
	marketStationOf,
} from "../src/market";
import {
	bountyTargetOf,
	relayActive,
	relayDestruction,
} from "../src/pirate-relay";
import {
	PLAYER_KILL,
	raiderDestruction,
	raiderReplacementActor,
} from "../src/raider-wreck";
import { RAIDER_HULL_ID } from "../src/raider-slots";
import { relaySlot } from "../src/relay-slot";
import { tenderKill } from "../src/relay-tender";
import { trafficKillTransitions } from "../src/traffic-engagement";
import {
	type RequestOffer,
	emptyRequests,
	entrustedTonnesAboard,
} from "../src/requests";
import {
	type CommanderState,
	type StationAction,
	type StationCommerceInput,
	newCommander,
	scoopCargo,
	transactAtStation,
} from "../src/station-commerce";
import { generateContents } from "../src/system";
import {
	type TransitionEvent,
	type WorldState,
	advanceTo,
	applyTransition,
	newWorld,
	setDeficits,
	visit,
} from "../src/world-state";
import {
	boardContext,
	firstOffer,
	firstProcurementOffer,
	postingStations,
} from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const { offers: shelf, offer: purchase } = firstProcurementOffer(
	SYSTEMS,
	"Food",
	0,
);
const { offers: courierBoard, offer: courier } = firstOffer(SYSTEMS, "courier");
const GOOD = purchase.operand.goodName;
const TONNES = purchase.operand.tonnes;
const GALAXY = purchase.reportAt.galaxyIndex;
/** Seconds, as the world clock is. A minute boundary, so a row that stamps a
 *  deficit in seconds instead of minutes reads sixty times too large. */
const AT = 600;

const holdings = (
	over: Partial<CommanderState> = {},
	rest: Partial<Holdings> = {},
): Holdings => ({
	commander: { ...newCommander(PLAYER_BASELINE_HULL), ...over },
	requests: emptyRequests(),
	ladders: emptyLadderRecord(),
	ladderPending: emptyPending(),
	...rest,
});

const station = (where: { galaxyIndex: number; carrierKey: string }) => ({
	galaxyIndex: where.galaxyIndex,
	carrierKey: where.carrierKey as never,
});

/** A press on the Requests board, as `Game` hands it over: the acted-on
 *  offer if the board shows it, the station the ship is docked at. */
const press = (
	action: string,
	offer: RequestOffer,
	board: readonly RequestOffer[],
	docked = station(offer.requester),
	at = AT,
): HoldEvent => ({
	kind: "settlement",
	action,
	id: offer.id,
	offer: board.find((o) => o.id === offer.id) ?? null,
	docked,
	standing: "clean",
	galaxyIndex: GALAXY,
	at,
});

/**
 * The invariant every hold event owes: the trade ladder's purchase basis
 * never holds more units of a good than the hold does. Not equality — units
 * with no basis (a v6 migration, a hold nobody bought) are legal and are sold
 * first at no margin.
 */
const expectBasisWithinCargo = (h: Holdings) => {
	for (const [good, line] of Object.entries(h.ladders.basis))
		expect(line.units).toBeLessThanOrEqual(h.commander.cargo[good] ?? 0);
};

/** Accept, deliver, report — every step through the module. */
const flyProcurement = (start: Holdings, world: WorldState) => {
	const steps: ReturnType<typeof applyHoldEvent>[] = [];
	let h = start;
	let w = world;
	for (const action of ["accept", "deliver", "report"]) {
		const out = applyHoldEvent(h, w, press(action, purchase, shelf));
		steps.push(out);
		h = out.holdings;
		w = out.world;
	}
	return steps;
};

describe("a Request settlement", () => {
	test("a report pays, the delivered goods take their basis, and the basis never outruns the cargo", () => {
		// The v6 case: two units aboard with no basis, beside the ones bought.
		const start = holdings(
			{ cargo: { [GOOD]: TONNES + 2 } },
			{
				ladders: {
					...emptyLadderRecord(),
					basis: { [GOOD]: { units: TONNES, cr: TONNES * 10 } },
				},
			},
		);
		const steps = flyProcurement(start, newWorld(1));
		for (const step of steps) {
			expect(step.signals.message).not.toBeNull();
			expectBasisWithinCargo(step.holdings);
		}
		const [accepted, delivered, reported] = steps;
		expect(accepted.holdings).not.toBe(start);
		// Deliver takes the job's tonnes out of the hold; the two that stay
		// keep the line's average cost.
		expect(delivered.holdings.commander.cargo[GOOD]).toBe(2);
		expect(delivered.holdings.ladders.basis[GOOD]).toEqual({
			units: 2,
			cr: 20,
		});
		const pay = purchase.rewardCr;
		expect(pay).toBeGreaterThan(0);
		expect(reported.holdings.commander.credits).toBe(
			start.commander.credits + pay,
		);
		expect(reported.holdings.ladders.banked.trade).toBe(pay);
	});

	test("the report's mark is written with the flown hull's hold, stamped in minutes", () => {
		// A row already at the courier's cap, so the hold is the only thing
		// that decides how far the mark moves it. On the courier the cap is
		// `DEFICIT_MAX` and the mark is clamped away; on the freighter it is not.
		const key = purchase.reportAt.carrierKey;
		const atCap = setDeficits(
			newWorld(1),
			GALAXY,
			recordTrade({}, key, {
				goodName: GOOD,
				units: -DEFICIT_MAX,
				gameTimeMin: AT / 60,
				holdT: HULL_SPECS[PLAYER_BASELINE_HULL].holdT,
			}),
			0,
		);
		const markOn = (hull: HullId) => {
			const start = holdings({
				hull,
				cargo: { [GOOD]: TONNES },
				credits: 0,
			});
			const out = flyProcurement(start, atCap).at(-1);
			if (!out) throw new Error("no report");
			return out.world.galaxies[GALAXY].deficits;
		};
		const freighter = markOn("freighter");
		const baseline = markOn(PLAYER_BASELINE_HULL);
		const freighterHoldT = HULL_SPECS.freighter.holdT;
		expect(freighterHoldT).not.toBe(HULL_SPECS[PLAYER_BASELINE_HULL].holdT);
		// The expectation is `recordTrade`'s, with the freighter's hold.
		expect(freighter).toEqual(
			recordTrade(atCap.galaxies[GALAXY].deficits, key, {
				goodName: GOOD,
				units: -TONNES,
				gameTimeMin: AT / 60,
				holdT: freighterHoldT,
			}),
		);
		// The control: the same report on the baseline hull clamps at the cap,
		// so a module that forgot the flown hull is a red row and not a lucky one.
		expect(readDeficit(baseline, key, GOOD, AT / 60)).toBe(-DEFICIT_MAX);
		expect(readDeficit(freighter, key, GOOD, AT / 60)).toBe(
			-DEFICIT_MAX - TONNES,
		);
		expect(freighter[key]?.updatedAt).toBe(AT / 60);
	});

	test("a job is judged against the flown hold less what is already aboard", () => {
		const capacity = holdOf(holdings()).capacityT;
		const tonnes = courier.operand.tonnes;
		const full = holdings({ cargo: { Food: capacity - tonnes + 1 } });
		const room = holdings({ cargo: { Food: capacity - tonnes } });
		const accept = (h: Holdings) =>
			applyHoldEvent(h, newWorld(1), press("accept", courier, courierBoard));
		expect(accept(full).holdings).toBe(full);
		const taken = accept(room).holdings;
		expect(entrustedTonnesAboard(taken.requests)).toBe(tonnes);
		expect(holdOf(taken).usedT).toBe(capacity);
	});

	test("a refusal hands back the same holdings and world, with its reason", () => {
		const start = holdings();
		const world = newWorld(1);
		const out = applyHoldEvent(
			start,
			world,
			press("accept", purchase, shelf, null as never),
		);
		expect(out.holdings).toBe(start);
		expect(out.world).toBe(world);
		expect(out.signals.message).toMatch(/Dock at the station/);
		expect(out.signals.hullChanged).toBeNull();
	});

	test("any accepted press checks the capstone, a zero-pay one included", () => {
		const atTops = holdings(
			{},
			{
				ladders: {
					...emptyLadderRecord(),
					banked: { ...LADDER_TOP },
				},
			},
		);
		const out = applyHoldEvent(
			atTops,
			newWorld(1),
			press("retain", purchase, shelf),
		);
		expect(out.holdings).not.toBe(atTops);
		expect(out.holdings.ladders.capstoneAt).toBe(AT);
	});
});

const TRADE = marketStationOf(
	{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
	0x51a7_10,
);
const SHIPYARD = marketStationOf(
	{ type: "shipyard", localCarrierId: "station-shipyard", blackMarket: false },
	0x5_417_d,
);

/** The till's own input, as `Game.consoleInput` builds it. */
const till = (
	h: Holdings,
	action: StationAction,
	over: Partial<StationCommerceInput> = {},
): StationCommerceInput => ({
	commander: h.commander,
	deficits: {},
	station: TRADE,
	stationKey: carrierKey(GALAXY, "station-trade"),
	economy: 3,
	gameTimeMin: AT / 60,
	displayTL: 10,
	entrustedT: entrustedTonnesAboard(h.requests),
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 5 }),
	action,
	...over,
});

const sale = (
	h: Holdings,
	world: WorldState,
	action: StationAction,
	over: Partial<StationCommerceInput> = {},
) => {
	const result = transactAtStation(till(h, action, over));
	if (!result.accepted) throw new Error(`till refused: ${result.reason}`);
	return {
		result,
		out: applyHoldEvent(h, world, {
			kind: "market",
			action,
			result,
			galaxyIndex: GALAXY,
			at: AT,
		}),
	};
};

describe("a market trade", () => {
	test("a buy takes the till's commander and records the price paid as basis", () => {
		const start = holdings({ credits: 1000 });
		const action = {
			type: "buy-commodity",
			commodity: "Food",
			quantity: 3,
		} as const;
		const world = newWorld(1);
		const { result, out } = sale(start, world, action);
		expect(out.holdings.commander).toBe(result.commander);
		expect(out.holdings.ladders.basis.Food).toEqual({
			units: 3,
			cr: start.commander.credits - result.commander.credits,
		});
		expect(out.world.galaxies[GALAXY].deficits).toBe(result.deficits);
		expect(out.signals).toEqual({
			hullChanged: null,
			message: null,
			readied: false,
		});
		expectBasisWithinCargo(out.holdings);
	});

	test("a sale banks its margin against the hold as it stood before it", () => {
		const start = holdings(
			{ cargo: { Food: 5 } },
			{
				ladders: {
					...emptyLadderRecord(),
					basis: { Food: { units: 5, cr: 5 } },
				},
			},
		);
		const action = {
			type: "sell-commodity",
			commodity: "Food",
			quantity: 5,
		} as const;
		const { result, out } = sale(start, newWorld(1), action);
		expect(out.holdings.ladders).toEqual(
			ladderAfterMarket(
				start.ladders,
				action,
				start.commander,
				result.commander,
			),
		);
		expect(out.holdings.ladders.banked.trade).toBeGreaterThan(0);
		expectBasisWithinCargo(out.holdings);
	});

	test("a hull purchase banks its auto-sale and says the hull changed", () => {
		const start = holdings(
			{ credits: 100_000, cargo: { Food: 10 } },
			{
				ladders: {
					...emptyLadderRecord(),
					basis: { Food: { units: 10, cr: 10 } },
				},
			},
		);
		const action = { type: "buy-hull", hull: "interceptor" } as const;
		const { result, out } = sale(start, newWorld(1), action, {
			station: SHIPYARD,
			stationKey: carrierKey(GALAXY, "station-shipyard"),
		});
		expect(out.signals.hullChanged).toBe("interceptor");
		expect(out.holdings.commander.hull).toBe("interceptor");
		expect(out.holdings.ladders).toEqual(
			ladderAfterHullSale(
				start.ladders,
				start.commander.cargo,
				result.sold ?? [],
			),
		);
		expect(out.holdings.ladders.banked.trade).toBeGreaterThan(0);
		expectBasisWithinCargo(out.holdings);
	});

	test("a sale that completes the tops stamps the capstone at the sale", () => {
		const start = holdings(
			{ cargo: { Food: 5 } },
			{
				// A zero-cost basis, so the sale has a margin: units with no
				// basis are sold first and bank nothing.
				ladders: {
					...emptyLadderRecord(),
					banked: { ...LADDER_TOP, trade: LADDER_TOP.trade - 1 },
					basis: { Food: { units: 5, cr: 0 } },
				},
			},
		);
		const { out } = sale(start, newWorld(1), {
			type: "sell-commodity",
			commodity: "Food",
			quantity: 5,
		});
		expect(out.holdings.ladders.capstoneAt).toBe(AT);
	});
});

describe("a canister scoop", () => {
	const scoop = (h: Holdings, world: WorldState, tonnes: number) =>
		applyHoldEvent(h, world, { kind: "scoop", commodity: "Food", tonnes });

	test("what fits goes aboard at no cost, and the world is not touched", () => {
		const start = holdings(
			{ cargo: { Food: 2 } },
			{
				ladders: {
					...emptyLadderRecord(),
					basis: { Food: { units: 2, cr: 30 } },
				},
			},
		);
		const world = newWorld(1);
		const out = scoop(start, world, 3);
		expect(out.world).toBe(world);
		expect(out.holdings.commander.cargo.Food).toBe(5);
		expect(out.holdings.ladders.basis.Food).toEqual({ units: 5, cr: 30 });
		expect(out.signals).toEqual({
			hullChanged: null,
			message: null,
			readied: false,
		});
		expectBasisWithinCargo(out.holdings);
	});

	test("a hold with entrusted cargo aboard has less room for a canister", () => {
		const accepted = applyHoldEvent(
			holdings(),
			newWorld(1),
			press("accept", courier, courierBoard),
		).holdings;
		const { capacityT, usedT } = holdOf(accepted);
		const out = scoop(accepted, newWorld(1), capacityT);
		expect(out.holdings.commander.cargo.Food).toBe(capacityT - usedT);
	});

	/**
	 * `Game`'s scoop callback returns what went aboard as the hold's gain in
	 * that good. That equals `scoopCargo`'s own quantity: whole tonnes up to
	 * the hold room; ordinary canisters refuse kg/g goods.
	 */
	test("what the hold gains is what scoopCargo took", () => {
		const capacity = holdOf(holdings()).capacityT;
		const cases: [Holdings, string, number][] = [
			[holdings(), "Food", 3],
			[holdings({ cargo: { Food: capacity - 2 } }), "Food", 5],
			[holdings(), "Gold", 1],
			[holdings({ cargo: { Food: capacity } }), "Food", 1],
			[holdings({ cargo: { Food: capacity } }), "Gold", 1],
			[holdings(), "Gem-Stones", 1],
			[holdings(), "Platinum", 1],
		];
		for (const [start, commodity, tonnes] of cases) {
			const out = applyHoldEvent(start, newWorld(1), {
				kind: "scoop",
				commodity,
				tonnes,
			});
			const gained =
				(out.holdings.commander.cargo[commodity] ?? 0) -
				(start.commander.cargo[commodity] ?? 0);
			const took = scoopCargo(
				start.commander,
				commodity,
				tonnes,
				entrustedTonnesAboard(start.requests),
			);
			expect(gained).toBe(took.tonnes);
			expect(out.holdings === start).toBe(!took.accepted);
		}
		// Full and partial tonne takes; kg/g goods and a full hold refuse.
		expect(
			cases.map(([h, c, t]) => scoopCargo(h.commander, c, t, 0).tonnes),
		).toEqual([3, 2, 0, 0, 0, 0, 0]);
	});

	test("a full hold leaves the canister in space and the holdings as they were", () => {
		const capacity = holdOf(holdings()).capacityT;
		const full = holdings({ cargo: { Food: capacity } });
		expect(scoop(full, newWorld(1), 1).holdings).toBe(full);
	});
});

/*
 * #627: the other three events — every carrier transition, a jump arrival and
 * a dock. Before this node `Game` credited a kill's bounty in
 * `applyCarrierTransition` and its combat ladder in `creditKill`, called by
 * hand at four sites that nothing checked, and applied an arrival's Hyperspace tank,
 * visit and pending kind and a dock's bank by hand.
 */

/** An active relay with a Bounty posted on it, accepted by a fitted pilot:
 *  the fixture `tests/bounty.test.ts` builds, through the module. */
const RELAY_HOME = (() => {
	for (const record of SYSTEMS) {
		if (!relayActive(record)) continue;
		const stations = postingStations(record);
		if (stations.length > 0) return { record, station: stations[0] };
	}
	throw new Error("no active-relay system with a posting station");
})();
const RELAY_KEY = relaySlot(RELAY_HOME.record.index).key;
const BOUNTY = bindBounty(
	boardContext(SYSTEMS, RELAY_HOME.record, RELAY_HOME.station, {
		bountyTarget: bountyTargetOf(
			RELAY_HOME.record,
			generateContents(RELAY_HOME.record),
			newWorld(0x5ee11e).galaxies[0],
			0,
		),
	}),
) as JobOffer;
const FITTED = { ownedEquipment: [LONG_RANGE_SCANNER] };
const KILL_AT = 100;

const bountyPress = (
	action: string,
	at: number,
	standing: "clean" | "wanted" = "clean",
): HoldEvent => ({
	kind: "settlement",
	action,
	id: BOUNTY.id,
	offer: BOUNTY,
	docked: station(BOUNTY.requester),
	standing,
	galaxyIndex: 0,
	at,
});

/** A fitted pilot with the relay's Bounty accepted at `at` 60. */
const withBounty = (): Holdings => {
	const out = applyHoldEvent(
		holdings(FITTED),
		newWorld(0x5ee11e),
		bountyPress("accept", 60),
	);
	expect(out.holdings.requests.byId[BOUNTY.id]?.status).toBe("accepted");
	return out.holdings;
};

/** The one carrier event shape, in galaxy 0. */
const carrierEvent = (
	key: CarrierKey,
	transition: TransitionEvent,
	hull: HullId | null,
): HoldEvent => ({ kind: "carrier", galaxyIndex: 0, key, transition, hull });

const killRelay = (
	h: Holdings,
	world: WorldState = newWorld(0x5ee11e),
	hull: HullId | null,
) =>
	applyHoldEvent(
		h,
		world,
		carrierEvent(
			RELAY_KEY,
			relayDestruction(RELAY_HOME.record.index, KILL_AT, RELAY_HOME.station.id),
			hull,
		),
	);

const RAIDER_KEY = carrierKey(RELAY_HOME.record.index, "raider-00");
const killRaider = (h: Holdings, world: WorldState = newWorld(0x5ee11e)) =>
	applyHoldEvent(
		h,
		world,
		carrierEvent(
			RAIDER_KEY,
			raiderDestruction(RELAY_HOME.record.index, KILL_AT),
			RAIDER_HULL_ID,
		),
	);

describe("a carrier transition", () => {
	test("a player's destroy writes the world through the module's writer", () => {
		const world = newWorld(0x5ee11e);
		const out = killRaider(holdings(), world);
		expect(out.world).toEqual(
			applyTransition(
				world,
				0,
				RAIDER_KEY,
				raiderDestruction(RELAY_HOME.record.index, KILL_AT),
			),
		);
	});

	test("a player's destroy credits the combat ladder with the kill's price, pending until a dock", () => {
		const start = holdings();
		const out = killRaider(start);
		expect(out.holdings.ladderPending.combat).toBe(
			killCredit(
				{
					hull: start.commander.hull,
					equipment: start.commander.ownedEquipment,
				},
				RAIDER_HULL_ID,
			),
		);
		expect(out.holdings.ladderPending.combat).toBeGreaterThan(0);
		// Pending, not banked: a kill pays at the next dock (#562 D3).
		expect(out.holdings.ladders).toBe(start.ladders);
	});

	test("a player's destroy readies the Bounty naming it, in the same event", () => {
		const out = killRelay(withBounty(), newWorld(0x5ee11e), null);
		const request = out.holdings.requests.byId[BOUNTY.id];
		expect(request.status).toBe("ready-to-report");
		expect(request.evidence).toEqual([
			{ stageId: "destroy", occurredAt: KILL_AT, source: "kill" },
		]);
		expect(out.signals.readied).toBe(true);
	});

	test("a target with no hull row pays the bounty and nothing on the ladder", () => {
		const start = withBounty();
		const out = killRelay(start, newWorld(0x5ee11e), null);
		expect(out.holdings.requests).not.toBe(start.requests);
		expect(out.holdings.ladderPending).toBe(start.ladderPending);
	});

	test("both credits land in one event: bounty and ladder from one destroy", () => {
		const start = withBounty();
		// The relay is not a hull row, so price this destroy as a raider's to
		// see both halves move together.
		const out = killRelay(start, newWorld(0x5ee11e), RAIDER_HULL_ID);
		expect(out.holdings.requests.byId[BOUNTY.id].status).toBe(
			"ready-to-report",
		);
		expect(out.holdings.ladderPending.combat).toBeGreaterThan(0);
	});

	test("a destroy without the player's provenance credits neither", () => {
		const start = withBounty();
		const world = newWorld(0x5ee11e);
		const transition = {
			...relayDestruction(
				RELAY_HOME.record.index,
				KILL_AT,
				RELAY_HOME.station.id,
			),
			cause: raiderReplacementActor(RELAY_HOME.record.index),
		};
		const out = applyHoldEvent(
			start,
			world,
			carrierEvent(RELAY_KEY, transition, RAIDER_HULL_ID),
		);
		expect(out.holdings).toBe(start);
		expect(out.world).toEqual(applyTransition(world, 0, RELAY_KEY, transition));
		expect(out.signals.readied).toBe(false);
	});

	test("a player's transition that is not a destroy is only the world write", () => {
		// The strike that diverts a carrier home: the player's provenance, and
		// still no kill.
		const start = withBounty();
		const world = newWorld(0x5ee11e);
		const out = applyHoldEvent(
			start,
			world,
			carrierEvent(
				RAIDER_KEY,
				{ kind: "disable", occurredAt: KILL_AT, cause: PLAYER_KILL },
				RAIDER_HULL_ID,
			),
		);
		expect(out.holdings).toBe(start);
		expect(out.world).not.toBe(world);
		expect(out.signals.readied).toBe(false);
	});

	test("readied fires only when a request becomes ready", () => {
		// No Bounty accepted: the kill moves the ladder and readies nothing.
		expect(killRaider(holdings()).signals.readied).toBe(false);
		// Already ready: the next kill moves the ladder and readies nothing new.
		const once = killRelay(withBounty(), newWorld(0x5ee11e), null);
		expect(once.signals.readied).toBe(true);
		const twice = killRaider(once.holdings, once.world);
		expect(twice.holdings.ladderPending).not.toBe(once.holdings.ladderPending);
		expect(twice.signals.readied).toBe(false);
	});

	/**
	 * The ladder credit used to be paid once per site, after the site's loop;
	 * it is paid per player's destroy now. So each kill's transitions must
	 * hold exactly one, or a loop would price one kill twice (sage #629).
	 */
	test("every kill a site applies holds exactly one player's destroy", () => {
		const system = RELAY_HOME.record.index;
		const station = RELAY_HOME.station.id;
		const kills: [string, TransitionEvent[]][] = [
			...(["operational", "disabled", "repairing"] as const).map(
				(from): [string, TransitionEvent[]] => [
					`traffic from ${from}`,
					trafficKillTransitions(
						system,
						{ homeStationId: station },
						from,
						KILL_AT,
					),
				],
			),
			["raider", [raiderDestruction(system, KILL_AT)]],
			["relay", [relayDestruction(system, KILL_AT, station)]],
			["tender", tenderKill(system, KILL_AT, station).map((t) => t.event)],
		];
		for (const [name, events] of kills) {
			const destroys = events.filter(
				(e) => e.kind === "destroy" && e.cause.actorId === PLAYER_KILL.actorId,
			);
			expect([name, destroys.length]).toEqual([name, 1]);
		}
	});

	test("a carrier event that names no hull does not compile", () => {
		// `hull` is required: a kill site that forgot it would pay nothing on
		// the ladder and read exactly like an unarmed kill.
		// @ts-expect-error — no `hull`.
		const event: HoldEvent = {
			kind: "carrier",
			galaxyIndex: 0,
			key: RAIDER_KEY,
			transition: raiderDestruction(RELAY_HOME.record.index, KILL_AT),
		};
		expect(event.kind).toBe("carrier");
	});
});

const SYSTEM = 7;
/** A jump arrival in galaxy 0. */
const arrivalEvent = (systemIndex = SYSTEM, fuelLy = 2.5): HoldEvent => ({
	kind: "arrival",
	galaxyIndex: 0,
	systemIndex,
	fuelLy,
});

describe("a jump arrival", () => {
	test("the first arrival marks the visit, leaves the plan's Hyperspace tank and is one pending kind", () => {
		const start = holdings();
		const world = newWorld(1);
		const out = applyHoldEvent(start, world, arrivalEvent());
		expect(out.world).toEqual(visit(world, 0, SYSTEM));
		expect(out.world.galaxies[0].visited).toContain(SYSTEM);
		expect(out.holdings.commander.fuelLy).toBe(2.5);
		expect(out.holdings.ladderPending.systems).toEqual([
			{ galaxyIndex: 0, systemIndex: SYSTEM },
		]);
	});

	test("a second arrival is no second kind", () => {
		const event = arrivalEvent();
		const once = applyHoldEvent(holdings(), newWorld(1), event);
		const twice = applyHoldEvent(once.holdings, once.world, event);
		expect(twice.holdings.ladderPending).toBe(once.holdings.ladderPending);
		// `visit` re-stamps the envelope and changes nothing in it.
		expect(twice.world).toEqual(once.world);
	});
});

describe("a dock", () => {
	const YARD = carrierKey(3, "station-00");
	const dock = (at = AT): HoldEvent => ({
		kind: "dock",
		galaxyIndex: 0,
		station: YARD,
		at,
	});

	test("banks the pending kill credit and clears what was pending", () => {
		const killed = killRaider(holdings());
		const credit = killed.holdings.ladderPending.combat;
		const out = applyHoldEvent(killed.holdings, killed.world, dock());
		expect(out.holdings.ladders.banked.combat).toBe(credit);
		expect(out.holdings.ladderPending).toEqual(emptyPending());
		// A dock writes no world.
		expect(out.world).toBe(killed.world);
	});

	test("a station's first dock is one exploration kind, and its second none", () => {
		const once = applyHoldEvent(holdings(), newWorld(1), dock());
		expect(once.holdings.ladders.banked.exploration).toBe(1);
		const twice = applyHoldEvent(once.holdings, once.world, dock());
		expect(twice.holdings.ladders.banked.exploration).toBe(1);
	});

	test("a pending arrival banks at the dock as a kind of its own", () => {
		const arrived = applyHoldEvent(holdings(), newWorld(1), arrivalEvent());
		const out = applyHoldEvent(arrived.holdings, arrived.world, dock());
		// The system and the station: two kinds.
		expect(out.holdings.ladders.banked.exploration).toBe(2);
		expect(out.holdings.ladderPending).toEqual(emptyPending());
	});
});

/*
 * #627 D8: the exact figures the browser probes used to carry. Each probe row
 * keeps a coarse fact that shows the event reached the module in a running
 * game; the figure is held here.
 */
describe("the figures the probes used to pin", () => {
	test("Report pays the Bounty's pinned figure once, and a second report changes nothing", () => {
		const ready = killRelay(withBounty(), newWorld(0x5ee11e), null);
		const before = ready.holdings.commander.credits;
		const paid = applyHoldEvent(
			ready.holdings,
			ready.world,
			bountyPress("report", 120),
		);
		expect(paid.holdings.commander.credits - before).toBe(BOUNTY.rewardCr);
		const again = applyHoldEvent(
			paid.holdings,
			paid.world,
			bountyPress("report", 130),
		);
		expect(again.holdings).toBe(paid.holdings);
		expect(again.world).toBe(paid.world);
	});

	test("a Wanted pilot's Accept is refused and nothing is taken", () => {
		const start = holdings(FITTED);
		const world = newWorld(0x5ee11e);
		const out = applyHoldEvent(
			start,
			world,
			bountyPress("accept", 60, "wanted"),
		);
		expect(out.holdings).toBe(start);
		expect(out.world).toBe(world);
		expect(out.signals.message).toMatch(/Clean/);
	});

	test("an entrusted consignment goes aboard at its tonnes, costs hold and is not the pilot's cargo", () => {
		const start = holdings();
		const out = applyHoldEvent(
			start,
			newWorld(1),
			press("accept", courier, courierBoard),
		);
		const lots = Object.values(out.holdings.requests.entrustedByLotId);
		expect(lots.length).toBe(1);
		expect(lots[0].aboardT).toBe(courier.operand.tonnes);
		expect(out.holdings.commander.cargo).toEqual(start.commander.cargo);
		expect(holdOf(out.holdings).usedT - holdOf(start).usedT).toBe(
			courier.operand.tonnes,
		);
	});
});

/*
 * #631: what `Game` does with an outcome — the save, the two revisions and
 * the repaint — derived at one adopt point from what changed, instead of
 * paired by hand after each of the six sites. Every row is built from a real
 * `applyHoldEvent` outcome, and each expected set is transcribed from the
 * pairs that site wrote by hand before #631 (`e2ba4d1`) — a transcription, so
 * it is as good as the reading, and the PR lists the sites it was read from.
 * Two cases the old code could reach that are not rows: a settlement with no
 * sentence (`RequestResult.message` is a `string`, so there is none) and a
 * carrier transition that moves no world (`applyTransition` throws or returns
 * a fresh world, so there is none).
 */
describe("the adopt point (#631)", () => {
	const effectsOf = (before: Holdings, world: WorldState, out: HoldOutcome) =>
		adoptEffects(out.kind, { holdings: before, world }, out);
	/** The effects that fire, by name, so a red row says which. */
	const firing = (effects: AdoptEffects) =>
		Object.entries(effects)
			.filter(([, on]) => on)
			.map(([name]) => name)
			.sort();

	test("each event's effects are what its site applied by hand before", () => {
		const world = newWorld(0x5ee11e);
		const start = holdings({ credits: 1000 });
		const accepted = applyHoldEvent(
			start,
			world,
			press("retain", purchase, shelf),
		);
		const refused = applyHoldEvent(
			start,
			world,
			press("accept", purchase, shelf, null as never),
		);
		const { out: bought } = sale(start, world, {
			type: "buy-commodity",
			commodity: "Food",
			quantity: 3,
		});
		const scooped = applyHoldEvent(start, world, {
			kind: "scoop",
			commodity: "Food",
			tonnes: 2,
		});
		const full = holdings({ cargo: { Food: holdOf(holdings()).capacityT } });
		const spilled = applyHoldEvent(full, world, {
			kind: "scoop",
			commodity: "Food",
			tonnes: 2,
		});
		const arrived = applyHoldEvent(start, world, arrivalEvent());
		const docked = applyHoldEvent(start, world, {
			kind: "dock",
			galaxyIndex: 0,
			station: carrierKey(3, "station-00"),
			at: AT,
		});
		const hunter = withBounty();
		const killed = killRelay(hunter, world, RAIDER_HULL_ID);
		const struck = applyHoldEvent(
			start,
			world,
			carrierEvent(
				RAIDER_KEY,
				{ kind: "disable", occurredAt: KILL_AT, cause: PLAYER_KILL },
				RAIDER_HULL_ID,
			),
		);
		const rows: Record<string, string[]> = {
			// Saved, bumped both counters, repainted (`actOnRequest`'s accepted arm).
			"accepted settlement": firing(effectsOf(start, world, accepted)),
			// Every press repaints its sentence; a refusal saves nothing.
			"refused settlement": firing(effectsOf(start, world, refused)),
			// Saved, bumped the console, repainted (`transactStation`).
			"accepted market": firing(effectsOf(start, world, bought)),
			// Saved, and nothing drawn: the scoop is in flight.
			"accepted scoop": firing(effectsOf(start, world, scooped)),
			"refused scoop": firing(effectsOf(full, world, spilled)),
			// `performJump` and the dock flush after these; the adopt saves.
			arrival: firing(effectsOf(start, world, arrived)),
			dock: firing(effectsOf(start, world, docked)),
			// The board heard the kill; the console is not up in flight.
			"player's kill": firing(effectsOf(hunter, world, killed)),
			// Only the world moved, and a world write saves.
			"player's strike": firing(effectsOf(start, world, struck)),
		};
		expect(rows).toEqual({
			"accepted settlement": [
				"consoleRevision",
				"redraw",
				"requestRevision",
				"save",
			],
			"refused settlement": ["redraw", "requestRevision"],
			"accepted market": ["consoleRevision", "redraw", "save"],
			"accepted scoop": ["save"],
			"refused scoop": [],
			arrival: ["save"],
			dock: ["save"],
			"player's kill": ["requestRevision", "save"],
			"player's strike": ["save"],
		});
		// And the signals the adopt point applies for every cause: only a press
		// on the board carries a sentence, only a kill readies a request (a hull
		// purchase is the one `hullChanged`, held in "a market trade" above), so
		// widening where `adopt` reads them cannot sound a new cue or print a
		// new sentence.
		const signalled = (out: HoldOutcome) =>
			Object.entries(out.signals)
				.filter(([, value]) => value !== null && value !== false)
				.map(([name]) => name);
		expect({
			"accepted settlement": signalled(accepted),
			"refused settlement": signalled(refused),
			"accepted market": signalled(bought),
			"accepted scoop": signalled(scooped),
			"refused scoop": signalled(spilled),
			arrival: signalled(arrived),
			dock: signalled(docked),
			"player's kill": signalled(killed),
			"player's strike": signalled(struck),
		}).toEqual({
			"accepted settlement": ["message"],
			"refused settlement": ["message"],
			"accepted market": [],
			"accepted scoop": [],
			"refused scoop": [],
			arrival: [],
			dock: [],
			"player's kill": ["readied"],
			"player's strike": [],
		});
	});

	test("an accepted event saves once: the same outcome adopted again changes nothing", () => {
		const world = newWorld(1);
		const start = holdings();
		const out = applyHoldEvent(start, world, arrivalEvent());
		expect(effectsOf(start, world, out).save).toBe(true);
		// Adopted, the outcome is the state; a second adoption of it moves no
		// reference, so nothing marks the save dirty twice for one event.
		expect(firing(adoptEffects(out.kind, out, out))).toEqual([]);
	});

	test("a refused event does not save", () => {
		const world = newWorld(1);
		const start = holdings();
		const full = holdings({ cargo: { Food: holdOf(holdings()).capacityT } });
		// Read against the holdings the event was **given**, so a refusal that
		// handed back fresh objects would save here and go red.
		for (const [before, out] of [
			[
				start,
				applyHoldEvent(
					start,
					world,
					press("accept", purchase, shelf, null as never),
				),
			],
			[
				full,
				applyHoldEvent(full, world, {
					kind: "scoop",
					commodity: "Food",
					tonnes: 1,
				}),
			],
		] as const) {
			expect(effectsOf(before, world, out).save).toBe(false);
			expect(effectsOf(before, world, out).consoleRevision).toBe(false);
		}
	});

	test("a paused frame moves no reference, so it has nothing to save", () => {
		const record = emptyLadderRecord();
		// The clock held: no play, and the very record back.
		expect(ladderAfterPlay(record, 0)).toBe(record);
		const h = holdings({}, { ladders: ladderAfterPlay(record, 0) });
		const world = newWorld(1);
		expect(
			firing(
				adoptEffects("world", { holdings: h, world }, { holdings: h, world }),
			),
		).toEqual([]);
	});

	test("a running frame's play log is a new record, and a record read before it is untouched", () => {
		const record = emptyLadderRecord();
		const played = ladderAfterPlay(record, 0.25);
		expect(played).not.toBe(record);
		expect(played.playedS).toBe(0.25);
		// The leak #631 names: an outcome's `before` must not move under it.
		expect(record.playedS).toBe(0);
		expect(ladderAfterPlay(played, 0.5).playedS).toBe(0.75);
	});

	test("a world write outside Holdings saves exactly when it changes the world", () => {
		const h = holdings();
		const world = newWorld(1);
		const written = visit(world, 0, SYSTEM);
		expect(
			firing(
				adoptEffects(
					"world",
					{ holdings: h, world },
					{ holdings: h, world: written },
				),
			),
		).toEqual(["save"]);
		// A writer that hands back the world it was given — `settleIncident` on
		// empty lists, `chargeOffence` on a lawful act nobody heard — is no write.
		expect(
			firing(
				adoptEffects("world", { holdings: h, world }, { holdings: h, world }),
			),
		).toEqual([]);
	});

	test("a save's advanced world is a new reference, so a save read must not be adopted", () => {
		// Why `saveEnvelope` reads and does not write: the store calls it on
		// every write, `markDirty` reschedules the debounce, and adopting this
		// world would mark the save dirty on every save — a write that arms
		// the next one.
		const h = holdings();
		const world = newWorld(1);
		expect(
			adoptEffects(
				"world",
				{ holdings: h, world },
				{ holdings: h, world: advanceTo(world, 60) },
			).save,
		).toBe(true);
	});
});

describe("#654 — the commander record a death restores", () => {
	test("the last dock's record, with the play log flown up to the death", () => {
		const dock = newCommanderRecord("courier");
		const docked = {
			...dock,
			state: { ...dock.state, credits: 100 },
			ladders: { ...dock.ladders, playedS: 1200 },
		};
		const dying = {
			...docked,
			state: { ...docked.state, credits: 555 },
			ladders: {
				...docked.ladders,
				banked: { combat: 9, trade: 9, exploration: 9 },
				playedS: 1800,
			},
		};
		// An eject with an empty hold and no pod costs nothing more, so this
		// row isolates #654's half; what a death costs is
		// `tests/death-cost.test.ts`'s (#660, node #704).
		expect(commanderAfterDeath(docked, dying, "eject")).toEqual({
			...docked,
			ladders: { ...docked.ladders, playedS: 1800 },
		});
	});
});
