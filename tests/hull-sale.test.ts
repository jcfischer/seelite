/**
 * #583 — the shipyard's hull sale, built from #556's ten rulings.
 *
 * The row and the till read one function (`hullOffer`), so the refusal a row
 * prints is the refusal a press gets, and the net price it prints is the one
 * charged — #193's lesson, where a screen formatted a figure the till never
 * agreed to.
 */
import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { readDeficit } from "../src/deficits";
import {
	HULL_SPECS,
	type HullId,
	PLAYER_BASELINE_HULL,
	PURCHASABLE_HULL_IDS,
} from "../src/hull";
import type { HullReach } from "../src/hull-reach";
import {
	TOP_RUNGS,
	type LadderRecord,
	type Rungs,
	emptyLadderRecord,
	ladderAfterHullSale,
	ladderAfterMarket,
} from "../src/ladder";
import {
	EQUIPMENT,
	commodity,
	marketQuote,
	marketRow,
	marketStationOf,
	stockResponse,
} from "../src/market";
import {
	type CommanderState,
	HULL_TRADE_IN_FRACTION,
	MOUNTED_EQUIPMENT,
	UNMOUNTED_EQUIPMENT,
	type StationCommerceInput,
	hullOffer,
	newCommander,
	shipyardScreen,
	transactAtStation,
} from "../src/station-commerce";

const SHIPYARD = marketStationOf(
	{ type: "shipyard", localCarrierId: "station-shipyard", blackMarket: false },
	0x5_417_d,
);
const FENCE_YARD = marketStationOf(
	{ type: "shipyard", localCarrierId: "station-shipyard", blackMarket: true },
	0x5_417_d,
);
const TRADE = marketStationOf(
	{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
	0x5_417_d,
);
const KEY = carrierKey(0, "station-shipyard");
const REACHES: (hull: HullId) => HullReach = () => ({ ok: true, systems: 5 });

const rich = (over: Partial<CommanderState> = {}): CommanderState => ({
	...newCommander(PLAYER_BASELINE_HULL),
	credits: 100_000,
	...over,
});

const input = (
	over: Partial<StationCommerceInput> = {},
): StationCommerceInput => ({
	commander: rich(),
	deficits: {},
	station: SHIPYARD,
	stationKey: KEY,
	economy: 3,
	gameTimeMin: 0,
	displayTL: 10,
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: REACHES,
	action: { type: "buy-hull", hull: "freighter" },
	...over,
});

const list = (hull: HullId): number => HULL_SPECS[hull].priceCr ?? 0;
const NO_RUNGS: Rungs = { combat: 0, trade: 0, exploration: 0 };

describe("#556 D5 — the trade-in", () => {
	test("courier → freighter nets 36,900 Cr, the receipt's own figure", () => {
		const offer = hullOffer(input(), "freighter");
		expect(offer.tradeInCr).toBe(31_500);
		expect(offer.netCr).toBe(36_900);
		expect(offer.accepted).toBe(true);
		expect(offer.commander.credits).toBe(100_000 - 36_900);
		expect(offer.commander.hull).toBe("freighter");
	});

	test("courier → interceptor pays the pilot 11,500 Cr", () => {
		const offer = hullOffer(
			input({ commander: rich({ credits: 0 }) }),
			"interceptor",
		);
		expect(offer.netCr).toBe(-11_500);
		expect(offer.accepted).toBe(true);
		expect(offer.commander.credits).toBe(11_500);
	});

	test("the fraction is 90%, and no swap-and-back earns", () => {
		expect(HULL_TRADE_IN_FRACTION).toBe(0.9);
		for (const a of PURCHASABLE_HULL_IDS)
			for (const b of PURCHASABLE_HULL_IDS) {
				if (a === b) continue;
				const start = rich({ hull: a, fuelLy: 0 });
				const there = hullOffer(input({ commander: start }), b);
				expect(there.accepted, `${a}→${b}`).toBe(true);
				const back = hullOffer(input({ commander: there.commander }), a);
				expect(back.accepted, `${b}→${a}`).toBe(true);
				// Each leg loses a tenth of the hull it leaves.
				expect(back.commander.credits).toBeCloseTo(
					start.credits - 0.1 * list(a) - 0.1 * list(b),
					6,
				);
			}
	});
});

describe("#556 — what a purchase does to the rest of the commander", () => {
	test("the hyperspace tank clamps to the new hull's and is never topped up", () => {
		const full = hullOffer(input(), "interceptor");
		expect(full.commander.fuelLy).toBe(HULL_SPECS.interceptor.tankLy);
		const low = hullOffer(
			input({ commander: rich({ fuelLy: 2 }) }),
			"explorer",
		);
		expect(low.commander.fuelLy).toBe(2);
	});

	test("fittings transfer to the new hull (D4)", () => {
		const fitted = rich({ ownedEquipment: ["Docking Computer", "Escape Pod"] });
		const offer = hullOffer(input({ commander: fitted }), "freighter");
		expect(offer.commander.ownedEquipment).toEqual(fitted.ownedEquipment);
	});

	test("the flown hull is refused, not re-sold", () => {
		const offer = hullOffer(input(), PLAYER_BASELINE_HULL);
		expect(offer.accepted).toBe(false);
		expect(offer.reason).toBe("hull-owned");
	});

	test("only a shipyard sells a hull (D8)", () => {
		const offer = hullOffer(input({ station: TRADE }), "freighter");
		expect(offer.reason).toBe("hull-unavailable");
	});
});

describe("#556 D4 — which fittings take a mount", () => {
	test("the list is a test, not a comment", () => {
		expect([...MOUNTED_EQUIPMENT].sort() as string[]).toEqual(
			[
				"Extra Beam Laser",
				"Extra Pulse Laser",
				"Military Laser",
				"Mining Laser",
			].sort(),
		);
	});

	test("every fitting is classified, one way or the other", () => {
		const classified = new Set<string>([
			...MOUNTED_EQUIPMENT,
			...UNMOUNTED_EQUIPMENT,
		]);
		for (const item of EQUIPMENT)
			expect(classified.has(item.name), item.name).toBe(true);
		expect(classified.size).toBe(EQUIPMENT.length);
	});

	test("weapons over the new hull's hardpoints refuse the sale", () => {
		const two = rich({
			hull: "interceptor",
			ownedEquipment: ["Extra Pulse Laser", "Military Laser"],
		});
		expect(HULL_SPECS.freighter.hardpoints).toBe(1);
		expect(hullOffer(input({ commander: two }), "freighter").reason).toBe(
			"hull-mounts",
		);
		// Unmounted fittings never count.
		const kit = rich({
			ownedEquipment: ["Extra Pulse Laser", "Missile", "E.C.M. System"],
		});
		expect(hullOffer(input({ commander: kit }), "freighter").accepted).toBe(
			true,
		);
	});
});

describe("#556 D6 — cargo over the new hold", () => {
	const bidOf = (name: string, holdT: number) => {
		const good = commodity(name);
		const base = marketRow(good, 3, SHIPYARD, 0);
		const mid = stockResponse(
			base.priceCr,
			readDeficit({}, KEY, name, 0),
			holdT,
		);
		return marketQuote(mid, 10).sellCr;
	};

	test("the overflow is sold through the till, cheapest bid first", () => {
		const cheap =
			bidOf("Food", 20) < bidOf("Computers", 20) ? "Food" : "Computers";
		const dear = cheap === "Food" ? "Computers" : "Food";
		const commander = rich({ cargo: { Food: 10, Computers: 10 } });
		const offer = hullOffer(input({ commander }), "interceptor");
		expect(offer.accepted).toBe(true);
		// 20 t aboard, 8 t hold: 12 t go, the whole cheap lot and 2 t of the other.
		expect(offer.sold).toEqual([
			{ good: cheap, units: 10, proceedsCr: expect.any(Number) },
			{ good: dear, units: 2, proceedsCr: expect.any(Number) },
		]);
		expect(offer.commander.cargo).toEqual({ [dear]: 8 });
		// Priced at the old hull's hold, as a manual sale at that moment is.
		const manual = transactAtStation(
			input({
				commander,
				action: { type: "sell-commodity", commodity: cheap, quantity: 10 },
			}),
		);
		expect(offer.sold[0].proceedsCr).toBe(
			manual.commander.credits - commander.credits,
		);
		// The deficit records it.
		expect(readDeficit(offer.deficits, KEY, cheap, 0)).not.toBe(0);
		expect(offer.saleCr).toBe(
			offer.sold[0].proceedsCr + offer.sold[1].proceedsCr,
		);
	});

	test("kilogram and gram goods take no hold and are never sold", () => {
		const commander = rich({ cargo: { Gold: 50, Food: 20 } });
		const offer = hullOffer(input({ commander }), "interceptor");
		expect(offer.commander.cargo.Gold).toBe(50);
		expect(offer.commander.cargo.Food).toBe(8);
	});

	test("the Large Cargo Bay's 15 t count in the new hold", () => {
		const commander = rich({
			cargo: { Food: 30 },
			ownedEquipment: ["Large Cargo Bay"],
		});
		const offer = hullOffer(input({ commander }), "interceptor");
		expect(offer.commander.cargo.Food).toBe(8 + 15);
	});

	test("the entrusted lot is never sold, and over the hold it refuses", () => {
		const offer = hullOffer(input({ entrustedT: 9 }), "interceptor");
		expect(offer.reason).toBe("hull-hold");
		const fits = hullOffer(
			input({ entrustedT: 8, commander: rich({ cargo: { Food: 4 } }) }),
			"interceptor",
		);
		expect(fits.accepted).toBe(true);
		expect(fits.commander.cargo).toEqual({});
	});

	test("contraband is never auto-sold; legal cargo goes first", () => {
		const commander = rich({ cargo: { Narcotics: 6, Food: 10 } });
		const offer = hullOffer(input({ commander }), "interceptor");
		expect(offer.accepted).toBe(true);
		expect(offer.commander.cargo).toEqual({ Narcotics: 6, Food: 2 });
		// …and refuses when the contraband and the entrusted lot overflow.
		const over = hullOffer(input({ commander, entrustedT: 3 }), "interceptor");
		expect(over.reason).toBe("hull-hold");
		// Kept even where a bid exists: the rule is about the goods, not the
		// station. No shipyard has a black market today (#13), so this station
		// is constructed rather than generated.
		const fenced = hullOffer(
			input({ commander, station: FENCE_YARD, entrustedT: 3 }),
			"interceptor",
		);
		expect(fenced.reason).toBe("hull-hold");
	});

	test("the sale's proceeds count toward the price (D9's credits step)", () => {
		// **The purse is built from the offer's own figures, so a build that
		// dropped the proceeds from the check fails here.** With today's roster
		// a smaller hold always pays the pilot (0.9 of the flown hull's list
		// exceeds every smaller hull's), so proceeds can only decide a sale on a
		// purse already short of it — which is what the negative credits are.
		const cargo = { Computers: 20 };
		const probe = hullOffer(
			input({ commander: rich({ cargo }) }),
			"interceptor",
		);
		expect(probe.saleCr).toBeGreaterThan(0);
		const at = (credits: number) =>
			hullOffer(input({ commander: rich({ credits, cargo }) }), "interceptor");
		// Short by less than the proceeds: the sale closes the gap.
		const covered = at(probe.netCr - probe.saleCr / 2);
		expect(covered.accepted).toBe(true);
		// Short by more than the proceeds: refused on credits.
		expect(at(probe.netCr - probe.saleCr - 1).reason).toBe(
			"insufficient-credits",
		);
		// And a plain shortfall with nothing to sell is refused.
		const dear = hullOffer(
			input({ commander: rich({ credits: 36_899 }) }),
			"freighter",
		);
		expect(dear.reason).toBe("insufficient-credits");
	});
});

describe("#556 D9 — one reason per row, first match wins", () => {
	const worst = input({
		rungs: NO_RUNGS,
		hullReach: () => ({ ok: false, refusal: "no-reach" }),
		entrustedT: 70,
		commander: rich({
			credits: 0,
			ownedEquipment: ["Extra Pulse Laser", "Military Laser"],
		}),
	});
	test("lock → reach → mounts → hold → credits", () => {
		const ladder: [Partial<StationCommerceInput>, string][] = [
			[{}, "hull-locked"],
			[{ rungs: TOP_RUNGS }, "no-reach"],
			[{ rungs: TOP_RUNGS, hullReach: REACHES }, "hull-mounts"],
			[
				{
					rungs: TOP_RUNGS,
					hullReach: REACHES,
					commander: rich({ credits: 0 }),
				},
				"hull-hold",
			],
			[
				{
					rungs: TOP_RUNGS,
					hullReach: REACHES,
					commander: rich({ credits: 0 }),
					entrustedT: 0,
				},
				"insufficient-credits",
			],
		];
		for (const [over, reason] of ladder)
			expect(hullOffer({ ...worst, ...over }, "freighter").reason).toBe(
				reason as never,
			);
	});

	test("a locked row names its ladder and rung", () => {
		const offer = hullOffer(input({ rungs: NO_RUNGS }), "freighter");
		expect(offer.locked).toMatchObject({ ladder: "trade", rung: 5 });
	});

	test("an open row carries its reach from here", () => {
		const offer = hullOffer(
			input({ hullReach: () => ({ ok: true, systems: 14 }) }),
			"explorer",
		);
		expect(offer.reach).toEqual({ ok: true, systems: 14 });
	});
});

describe("#583 — the row and the till are one function", () => {
	test("a press gets exactly what the row printed", () => {
		for (const hull of PURCHASABLE_HULL_IDS) {
			const i = input({
				commander: rich({ cargo: { Food: 20 }, credits: 30_000 }),
				action: { type: "buy-hull", hull },
			});
			const offer = hullOffer(i, hull);
			const till = transactAtStation(i);
			expect(till.accepted, hull).toBe(offer.accepted);
			expect(till.reason, hull).toBe(offer.reason);
			expect(till.commander, hull).toEqual(offer.commander);
			expect(till.deficits, hull).toEqual(offer.deficits);
		}
	});

	test("a refusal leaves every input untouched", () => {
		const i = input({ entrustedT: 70 });
		const till = transactAtStation(i);
		expect(till.accepted).toBe(false);
		expect(till.commander).toBe(i.commander);
		expect(till.deficits).toBe(i.deficits);
	});

	test("the screen lists every purchasable hull, at shipyards only", () => {
		expect(shipyardScreen(input()).map((row) => row.hull)).toEqual([
			...PURCHASABLE_HULL_IDS,
		]);
		expect(shipyardScreen(input({ station: TRADE }))).toEqual([]);
	});
});

describe("#556 D6 — the auto-sale banks trade margin as a manual sale does", () => {
	test("the same lots, sold by hand, bank the same credit", () => {
		const commander = rich({ cargo: { Food: 10, Computers: 10 } });
		// A basis below any bid, so both lots bank a margin.
		const record: LadderRecord = {
			...emptyLadderRecord(),
			basis: {
				Food: { units: 10, cr: 10 },
				Computers: { units: 10, cr: 10 },
			},
		};
		const i = input({
			commander,
			action: { type: "buy-hull", hull: "interceptor" },
		});
		const till = transactAtStation(i);
		expect(till.accepted).toBe(true);
		const sold = till.accepted ? (till.sold ?? []) : [];
		expect(sold.length).toBe(2);
		const auto = ladderAfterHullSale(record, commander.cargo, sold);
		// The control: the same lots through the manual path, one press each.
		let manual = record;
		let state = { commander, deficits: i.deficits };
		for (const lot of sold) {
			const action = {
				type: "sell-commodity",
				commodity: lot.good,
				quantity: lot.units,
			} as const;
			const out = transactAtStation({ ...i, ...state, action });
			manual = ladderAfterMarket(
				manual,
				action,
				state.commander,
				out.commander,
			);
			state = { commander: out.commander, deficits: out.deficits };
		}
		expect(auto.banked.trade).toBeGreaterThan(0);
		expect(auto.banked.trade).toBeCloseTo(manual.banked.trade, 9);
		expect(auto.basis).toEqual(manual.basis);
	});
});
