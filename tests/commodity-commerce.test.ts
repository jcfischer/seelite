import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { marketStationOf, type QuoteFn } from "../src/market";
import {
	newCommander,
	transactAtStation,
	hullOffer,
	type StationCommerceInput,
} from "../src/station-commerce";
import {
	migrateAccount,
	withAccount,
	displayAmount,
	emptyAccount,
	acquire,
	remove,
} from "../src/commodity-pools";
import { money, signedMoney, mass } from "../src/exact-amount";
import {
	emptyLadderRecord,
	rungsOf,
	threshold,
	ladderFromAccount,
} from "../src/ladder";
import { newCommanderRecord } from "../src/save-envelope";
import { commanderAfterDeath } from "../src/holdings";
const input = (
	accounting = migrateAccount(
		1000,
		100,
		{ Alloys: 2 },
		{ Alloys: { units: 2, cr: 40 } },
	),
): StationCommerceInput => ({
	commander: withAccount(newCommander("courier"), accounting),
	deficits: {},
	station: marketStationOf(
		{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
		1,
	),
	stationKey: carrierKey(0, "station-trade"),
	economy: 3,
	gameTimeMin: 0,
	displayTL: 8,
	entrustedT: 0,
	rungs: { combat: 8, trade: 8, exploration: 8 },
	hullReach: () => ({ ok: true, systems: 1 }),
	action: { type: "sell-commodity", commodity: "Alloys", quantity: 1 },
});
const quote: QuoteFn = () => ({ buyCr: 20, sellCr: 20 });

test("production till settles exact cash and commodity debt, including hull auto-sales", () => {
	const start = input();
	const first = transactAtStation(start, quote);
	expect(first.accepted).toBe(true);
	expect(first.commander.accounting!.cash).toBe(signedMoney.fromNumber(1020));
	expect(first.commander.accounting!.bankedTrade).toBe(money.fromNumber(100));
	const second = transactAtStation(
		{ ...start, commander: first.commander },
		quote,
	);
	expect(second.commander.accounting!.pools.Alloys.unrecoveredCost).toBe(
		money.fromNumber(0),
	);
	expect(second.commander.accounting!.bankedTrade).toBe(money.fromNumber(100));
	const hullInput = input(
		acquire(emptyAccount(10000000), "Alloys", 20, money.fromNumber(10)),
	);
	const hull = transactAtStation(
		{
			...hullInput,
			station: marketStationOf(
				{
					type: "shipyard",
					localCarrierId: "station-shipyard",
					blackMarket: false,
				},
				1,
			),
			displayTL: 16,
			action: { type: "buy-hull", hull: "interceptor" },
		},
		quote,
	);
	expect(hull.accepted).toBe(true);
	expect(hull.commander.accounting!.bankedTrade).toBeGreaterThan(
		money.fromNumber(0),
	);
	expect(hull.commander.accounting!.pools.Alloys.unrecoveredCost).toBe(
		money.fromNumber(0),
	);
});

test("a displayed balance cannot authorize spending one tick more than exact cash", () => {
	const price = money.fromNumber(20);
	const a = { ...emptyAccount(), cash: signedMoney.fromTicks(price - 1n) };
	const request = input(a);
	expect(request.commander.credits).toBe(20);
	const out = transactAtStation(
		{
			...request,
			action: { type: "buy-commodity", commodity: "Food", quantity: 1 },
		},
		quote,
	);
	expect(out.accepted).toBe(false);
	expect(out.reason).toBe("insufficient-credits");
	expect(out.commander).toBe(request.commander);
});

test("overflow refuses the entire till and a trade rung reads exact credit below a threshold", () => {
	const a = acquire(emptyAccount(), "Alloys", 1);
	const request = input({ ...a, cash: signedMoney.fromTicks(money.maxTicks) });
	const out = transactAtStation(request, quote);
	expect(out.accepted).toBe(false);
	expect(out.reason).toBe("accounting-overflow");
	expect(out.commander).toBe(request.commander);
	const below = {
		...emptyAccount(),
		bankedTrade: money.fromTicks(money.fromNumber(threshold("trade", 1)) - 1n),
	};
	expect(displayAmount(below.bankedTrade)).toBe(threshold("trade", 1));
	expect(rungsOf(ladderFromAccount(emptyLadderRecord(), below)).trade).toBe(0);
});

test("death removes cargo unknown-first and retains dying debt despite the launch restore", () => {
	const dock = newCommanderRecord("courier"),
		dying = newCommanderRecord("courier");
	dock.state = withAccount(dock.state, emptyAccount(100));
	dying.state = withAccount(
		dying.state,
		migrateAccount(100, 0, { Alloys: 2 }, { Alloys: { units: 1, cr: 40 } }),
	);
	const after = commanderAfterDeath(dock, dying, "destroyed");
	expect(after.state.cargo).toEqual({});
	expect(after.state.accounting!.pools.Alloys.totalMass).toBe(
		mass.fromTicks(0n),
	);
	expect(after.state.accounting!.pools.Alloys.unrecoveredCost).toBe(
		money.fromNumber(40),
	);
});

test("hull auto-sale funds the purchase through the exact account before affordability", () => {
	const before = input(acquire(emptyAccount(0), "Alloys", 20));
	const result = transactAtStation(
		{
			...before,
			station: marketStationOf(
				{
					type: "shipyard",
					localCarrierId: "station-shipyard",
					blackMarket: false,
				},
				1,
			),
			displayTL: 16,
			action: { type: "buy-hull", hull: "interceptor" },
		},
		() => ({ buyCr: 10000, sellCr: 10000 }),
	);
	expect(result.accepted).toBe(true);
	if (!result.accepted) return;
	const sold = result.sold!.reduce((n, lot) => n + lot.units, 0);
	expect(sold).toBeGreaterThan(0);
	expect(result.commander.cargo.Alloys ?? 0).toBe(20 - sold);
	expect(result.commander.accounting!.cash).toBe(
		signedMoney.fromNumber(
			sold * 10000 -
				hullOffer(
					{
						...before,
						station: marketStationOf(
							{
								type: "shipyard",
								localCarrierId: "station-shipyard",
								blackMarket: false,
							},
							1,
						),
						displayTL: 16,
					},
					"interceptor",
					() => ({ buyCr: 10000, sellCr: 10000 }),
				).netCr,
		),
	);
	expect(result.commander.accounting!.bankedTrade).toBe(
		money.fromNumber(sold * 10000),
	);
});
