/**
 * #626: the law that applies a pilot's act to their **Holdings**, at the
 * module's interface.
 *
 * `requestAction`, `transactAtStation` and `scoopCargo` were already pure and
 * already tested (`requests`, `station-commerce`, `ladder`). What had no test
 * was the step after them: crediting the reward, folding the cargo delta,
 * moving the purchase basis with the cargo, writing the world's mark with the
 * flown hull's hold. `Game` did that by hand at three sites, and only a
 * browser probe reached any of them. These rows are that step.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { readDeficit, recordTrade } from "../src/deficits";
import { generateGalaxy } from "../src/galaxy";
import {
	type Holdings,
	type HoldEvent,
	applyHoldEvent,
	holdOf,
} from "../src/holdings";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import {
	LADDER_TOP,
	TOP_RUNGS,
	emptyLadderRecord,
	emptyPending,
	ladderAfterHullSale,
	ladderAfterMarket,
} from "../src/ladder";
import { DEFICIT_MAX, marketStationOf } from "../src/market";
import { emptyRequests, entrustedTonnesAboard } from "../src/requests";
import {
	type CommanderState,
	type StationAction,
	type StationCommerceInput,
	newCommander,
	transactAtStation,
} from "../src/station-commerce";
import { type WorldState, newWorld, setDeficits } from "../src/world-state";
import { firstOffer, firstProcurementOffer } from "./helpers/job-board";

const SYSTEMS = generateGalaxy(0x5ee11e, 0).systems;
const { offers: shelf, offer: purchase } = firstProcurementOffer(
	SYSTEMS,
	"Food",
	0,
);
const { offers: courierBoard, offer: courier } = firstOffer(
	SYSTEMS,
	"courier",
);
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
	offer: typeof purchase,
	board: readonly (typeof purchase)[] | readonly unknown[],
	docked = station(offer.requester),
	at = AT,
): HoldEvent => ({
	kind: "settlement",
	action,
	id: offer.id,
	offer:
		(board as readonly (typeof purchase)[]).find((o) => o.id === offer.id) ??
		null,
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
		const reward = purchase.rewardCr;
		expect(reward).toBeGreaterThan(0);
		expect(reported.holdings.commander.credits).toBe(
			start.commander.credits + reward,
		);
		expect(reported.holdings.ladders.banked.trade).toBe(reward);
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

	test("the hold room the board reads counts the entrusted tonnes", () => {
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
		expect(out.signals).toEqual({ hullChanged: null, message: null });
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
				ladders: {
					...emptyLadderRecord(),
					banked: { ...LADDER_TOP, trade: LADDER_TOP.trade - 1 },
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
		expect(out.signals).toEqual({ hullChanged: null, message: null });
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

	test("a full hold leaves the canister in space and the holdings as they were", () => {
		const capacity = holdOf(holdings()).capacityT;
		const full = holdings({ cargo: { Food: capacity } });
		expect(scoop(full, newWorld(1), 1).holdings).toBe(full);
	});
});
