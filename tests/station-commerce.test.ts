import { describe, expect, test } from "bun:test";
import { TOP_RUNGS } from "../src/ladder";
import { type CarrierKey, carrierKey } from "../src/carrier-key";
import { type DeficitMap, readDeficit, recordTrade } from "../src/deficits";
import {
	COMMODITIES,
	DEFICIT_MAX,
	DISPLAY_TL_MAX,
	DISPLAY_TL_MIN,
	quantizeToDisplayStepCr,
	PRICE_ELASTICITY,
	PRICE_STEP_CR,
	bidCutAtTl,
	marketQuote,
	quoteWithCut,
	DEFICIT_SATURATION_RUNS,
	commodity,
	marketRow,
	marketStationOf,
	shelfQuantity,
	stockResponse,
	HOLD_REFERENCE_T,
} from "../src/market";
import {
	DOCKABLE_HULL_IDS,
	HULL_SPECS,
	type HullId,
	PLAYER_BASELINE_HULL,
} from "../src/hull";
import {
	type CommanderState,
	STARTING_CREDITS,
	commanderHold,
	newCommander,
	scoopCargo,
	transactAtStation,
} from "../src/station-commerce";
import { priceLabel, stationMarketScreen } from "../src/station-console";
import { newWorld, parseWorld, serializeWorld } from "../src/world-state";
import { MAX_DT } from "../src/units";
// **§5's eight economies, imported from the helper that already owns them.** This file
// used to declare its own copy; a copy of a domain list is how a widening of the table
// turns a sweep into a smaller claim that still prints a clean number.
import { ALL_ECONOMIES } from "./helpers/market-math";
import {
	type CycleSurvey,
	NO_WEDGE,
	flyConsoleCycle,
	surveyConsoleCycles,
} from "./helpers/console-cycle";

const STATION = marketStationOf(
	{ type: "trade", localCarrierId: "station-trade", blackMarket: false },
	0x51a7_10,
);
const KEY = carrierKey(0, "station-trade");

/**
 * The flat floor §5.6 records as closing the pump — `PRICE_ELASTICITY ×
 * DEFICIT_SATURATION_RUNS`, derived from the two constants that own it rather than typed,
 * because a rung pinned by a literal is a rung nobody can move.
 */
/**
 * The closing rung as a quote, built once. Constructing it inside 188,325 legs measured
 * the factory rather than the law.
 */
const CLOSING_FLOOR = quoteWithCut(
	() => PRICE_ELASTICITY * DEFICIT_SATURATION_RUNS,
);

/** One seed for every console in the residue rows, so they measure one station. */
const PRIOR_MARK_SEED = 0x51a7_10;
/** The three priced berth types §5.6's closure claim covers. */
type BerthType = "trade" | "refinery" | "shipyard";

/** The baseline hull's tank. Every fuel row below flies the courier; the
 *  per-hull row after them is what fails on a build that fills to one figure. */
const COURIER_TANK_LY = HULL_SPECS[PLAYER_BASELINE_HULL].tankLy;

const input = (
	overrides: Partial<Parameters<typeof transactAtStation>[0]> = {},
) => ({
	commander: newCommander(PLAYER_BASELINE_HULL),
	deficits: {},
	station: STATION,
	stationKey: KEY,
	economy: 3,
	gameTimeMin: 0,
	displayTL: 8,
	entrustedT: 0,
	rungs: TOP_RUNGS,
	hullReach: () => ({ ok: true, systems: 1 }) as const,
	action: { type: "buy-commodity", commodity: "Food" } as const,
	...overrides,
});

/** What one leg of a cycle carries forward: what the till returned, not what it refused. */
interface CycleState {
	commander: Parameters<typeof transactAtStation>[0]["commander"];
	deficits: DeficitMap;
}

/**
 * One priced leg of a cycle, flown as the till would fly it.
 *
 * **Written once because every cycle in this file is the same call with a different
 * action.** Copies are how a leg hands the next leg the *original* deficits rather than the
 * ones the last leg returned — the mistake that made the first draft of the residue rows
 * measure nothing. A refusal comes back as `{ accepted: false, reason }` rather than `null`
 * because the chained-cycle row reports *why* a leg could not be booked; a runner that
 * threw the reason away would only move the duplication somewhere else.
 */
type LegResult =
	| { accepted: true; state: CycleState }
	| { accepted: false; reason: string | null };

const leg = (
	state: CycleState,
	overrides: Partial<Parameters<typeof transactAtStation>[0]>,
	quote?: Parameters<typeof transactAtStation>[1],
): LegResult => {
	const out = transactAtStation(
		input({
			commander: state.commander,
			deficits: state.deficits,
			...overrides,
		}),
		quote,
	);
	return out.accepted
		? {
				accepted: true,
				state: { commander: out.commander, deficits: out.deficits },
			}
		: { accepted: false, reason: out.reason };
};

test("a commodity buy atomically moves credits, cargo, and this station's deficit", () => {
	const before = input();
	const bought = transactAtStation(before);
	expect(bought.accepted).toBe(true);
	expect(bought.commander.credits).toBeLessThan(before.commander.credits);
	expect(bought.commander.cargo.Food).toBe(1);
	expect(readDeficit(bought.deficits, KEY, "Food", 0)).toBe(1);

	const sold = transactAtStation(
		input({
			commander: bought.commander,
			deficits: bought.deficits,
			action: { type: "sell-commodity", commodity: "Food" },
		}),
	);
	expect(sold.accepted).toBe(true);
	expect(sold.commander.cargo.Food).toBeUndefined();
	expect(readDeficit(sold.deficits, KEY, "Food", 0)).toBe(0);
});

test("rejected actions are atomic no-ops", () => {
	const before = input({
		commander: { ...newCommander(PLAYER_BASELINE_HULL), credits: 0 },
	});
	const result = transactAtStation(before);
	expect(result).toMatchObject({
		accepted: false,
		reason: "insufficient-credits",
	});
	expect(result.commander).toBe(before.commander);
	expect(result.deficits).toBe(before.deficits);
});

test("tonne cargo observes the hold while sub-tonne goods bypass it", () => {
	const full = {
		...newCommander(PLAYER_BASELINE_HULL),
		credits: 100_000,
		// The hull's hold, read off the roster: `STARTING_HOLD_T` was a second
		// copy of the courier's 20 t and is gone (#181).
		cargo: { Food: HULL_SPECS[PLAYER_BASELINE_HULL].holdT },
	};
	expect(transactAtStation(input({ commander: full }))).toMatchObject({
		accepted: false,
		reason: "cargo-full",
	});
	expect(
		transactAtStation(
			input({
				commander: full,
				action: { type: "buy-commodity", commodity: "Gold" },
			}),
		).accepted,
	).toBe(true);
});

test("the till stops selling when the shelf it showed is empty, on every hull (#316)", () => {
	// #316, §5.2: Gold skips the hold check, so the shelf is its only limit.
	const gold = commodity("Gold");
	const shown = shelfQuantity(marketRow(gold, 3, STATION, 0).quantity, 0);
	expect(shown).toBeGreaterThan(0);
	const buy = { type: "buy-commodity", commodity: "Gold" } as const;
	const step = (
		commander: ReturnType<typeof newCommander>,
		deficits: DeficitMap = {},
	) => input({ commander, deficits, action: buy });
	for (const hull of Object.keys(HULL_SPECS) as HullId[]) {
		let state = step({ ...newCommander(hull), credits: 1e9 });
		let bought = 0;
		let reason: string | null = null;
		for (let i = 0; i <= DEFICIT_MAX + 1; i++) {
			const result = transactAtStation(state);
			if (!result.accepted) {
				reason = result.reason;
				break;
			}
			bought++;
			state = {
				...step(result.commander, result.deficits),
				gameTimeMin: (bought * MAX_DT) / 60,
			};
		}
		expect({ hull, bought, reason }).toEqual({
			hull,
			bought: shown,
			reason: "insufficient-shelf",
		});
	}
});

describe("node #777 unit trades across frame ticks", () => {
	const goodName = "Gold";
	const baseShelf = marketRow(commodity(goodName), 3, STATION, 0).quantity;
	const frameMin = MAX_DT / 60;
	const shownShelf = (
		state: CycleState,
		gameTimeMin: number,
		name = goodName,
	) =>
		stationMarketScreen({
			economy: 3,
			station: STATION,
			deficitOf: (name) => readDeficit(state.deficits, KEY, name, gameTimeMin),
			gameTimeMin,
			holdT: HULL_SPECS[state.commander.hull].holdT,
			cargo: state.commander.cargo,
			displayTL: 8,
		}).find((row) => row.commodity.name === name)!.quantity;

	test("advancing-time one-unit buys empty the shown shelf on every hull", () => {
		expect(baseShelf).toBeGreaterThan(0);
		for (const hull of Object.keys(HULL_SPECS) as HullId[]) {
			let state: CycleState = {
				commander: { ...newCommander(hull), credits: 1e9 },
				deficits: {},
			};
			for (let n = 1; n <= baseShelf; n++) {
				const out = transactAtStation(
					input({
						...state,
						gameTimeMin: n * frameMin,
						action: { type: "buy-commodity", commodity: goodName, quantity: 1 },
					}),
				);
				expect(out.accepted).toBe(true);
				state = out;
				expect(shownShelf(state, (n + 1) * frameMin)).toBe(baseShelf - n);
			}
			const refused = transactAtStation(
				input({
					...state,
					gameTimeMin: (baseShelf + 1) * frameMin,
					action: { type: "buy-commodity", commodity: goodName, quantity: 1 },
				}),
			);
			expect(refused).toMatchObject({
				accepted: false,
				reason: "insufficient-shelf",
			});
			expect(refused.commander).toBe(state.commander);
			expect(refused.deficits).toBe(state.deficits);
		}
	});

	test("advancing-time one-unit sells raise the shown shelf and it stays capped", () => {
		// Food has room above its base shelf; Gold starts at the cap.
		const sellGood = "Food";
		const sellBase = marketRow(commodity(sellGood), 3, STATION, 0).quantity;
		const room = DEFICIT_MAX - sellBase;
		expect(room).toBeGreaterThan(0);
		let state: CycleState = {
			commander: {
				...newCommander("freighter"),
				cargo: { [sellGood]: room + 1 },
			},
			deficits: {},
		};
		for (let n = 1; n <= room + 1; n++) {
			const out = transactAtStation(
				input({
					...state,
					gameTimeMin: n * frameMin,
					action: { type: "sell-commodity", commodity: sellGood, quantity: 1 },
				}),
			);
			expect(out.accepted).toBe(true);
			state = out;
			expect(shownShelf(state, (n + 1) * frameMin, sellGood)).toBe(
				Math.min(sellBase + n, DEFICIT_MAX),
			);
		}
	});
});

test("available equipment is charged once, then becomes owned and unavailable", () => {
	const before = input({
		commander: { ...newCommander(PLAYER_BASELINE_HULL), credits: 1_000 },
		action: { type: "buy-equipment", equipment: "Large Cargo Bay" },
	});
	const bought = transactAtStation(before);
	expect(bought).toMatchObject({ accepted: true });
	expect(bought.commander.credits).toBe(600);
	expect(bought.commander.ownedEquipment).toContain("Large Cargo Bay");
	const again = transactAtStation(
		input({
			commander: bought.commander,
			action: { type: "buy-equipment", equipment: "Large Cargo Bay" },
		}),
	);
	expect(again).toMatchObject({ accepted: false, reason: "equipment-owned" });
});

test("a transaction deficit survives the existing world-state serialization boundary", () => {
	const bought = transactAtStation(input());
	if (!bought.accepted) throw new Error("fixture buy was rejected");
	const world = newWorld(0x51a7_10);
	world.galaxies[0] = { ...world.galaxies[0], deficits: bought.deficits };
	const restored = parseWorld(serializeWorld(world));
	expect(readDeficit(restored.galaxies[0].deficits, KEY, "Food", 0)).toBe(1);
});

/**
 * §6.1's fuel, which had a price, a row on the equipment screen and no way to
 * buy it — the screen said "FUEL SYSTEM PENDING" where its action belongs
 * (#187).
 */
test("a full tank is refused as full, not as unaffordable", () => {
	const full = transactAtStation(input({ action: { type: "buy-fuel" } }));
	expect(full.accepted).toBe(false);
	expect(full.reason).toBe("fuel-full");
	// And nothing moved.
	expect(full.commander.credits).toBe(STARTING_CREDITS);
	expect(full.commander.fuelLy).toBe(COURIER_TANK_LY);
});

test("a full tank costs 14 Cr, which is §6.1's figure", () => {
	const empty = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 0 };
	const filled = transactAtStation(
		input({ commander: empty, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBe(COURIER_TANK_LY);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(14, 10);
});

test("a partial tank buys the shortfall and not a whole tank", () => {
	const half = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 4 };
	const filled = transactAtStation(
		input({ commander: half, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBe(COURIER_TANK_LY);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(6, 10);
});

test("the tank fills to the flown hull's tankLy, not the courier's (#554)", () => {
	for (const id of ["interceptor", "explorer"] as const) {
		const dry = { ...newCommander(id), fuelLy: 0, credits: 10_000 };
		const filled = transactAtStation(
			input({ commander: dry, action: { type: "buy-fuel" } }),
		);
		expect([id, filled.commander.fuelLy]).toEqual([id, HULL_SPECS[id].tankLy]);
	}
});

test("short of credits buys what they cover rather than refusing", () => {
	// The anti-stranding half: a pilot with three credits and a dry tank needs
	// the 1.5 LY those buy more than they need a refusal.
	const broke = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: 0,
		credits: 3,
	};
	const filled = transactAtStation(
		input({ commander: broke, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBeCloseTo(1.5, 10);
	expect(filled.commander.credits).toBeCloseTo(0, 10);
});

test("no credits at all is refused as credits, not as a full tank", () => {
	const skint = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: 0,
		credits: 0,
	};
	const refused = transactAtStation(
		input({ commander: skint, action: { type: "buy-fuel" } }),
	);
	expect(refused.accepted).toBe(false);
	expect(refused.reason).toBe("insufficient-credits");
});

test("the tank never overfills, however many times it is topped up", () => {
	let commander = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 6.5 };
	for (let i = 0; i < 5; i++) {
		const next = transactAtStation(
			input({ commander, action: { type: "buy-fuel" } }),
		);
		commander = next.commander;
		expect(commander.fuelLy).toBeLessThanOrEqual(COURIER_TANK_LY);
	}
	expect(commander.fuelLy).toBe(COURIER_TANK_LY);
});

test("a fractional shortfall can be bought back, so the tank reaches 7.0 again", () => {
	// The defect this is written for: flooring the shortfall to §6.1's pricing
	// tenth left a residue no purchase could take, so a tank drained by a jump
	// of non-decimal distance — which is every jump — could never be refilled,
	// and the next attempt was refused as *insufficient credits* on a full purse.
	const afterAJump = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: COURIER_TANK_LY - 2.34,
	};
	const filled = transactAtStation(
		input({ commander: afterAJump, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBeCloseTo(COURIER_TANK_LY, 12);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(4.68, 12);

	// And a second press is refused as full rather than as money.
	const again = transactAtStation(
		input({ commander: filled.commander, action: { type: "buy-fuel" } }),
	);
	expect(again.accepted).toBe(false);
	expect(again.reason).toBe("fuel-full");
});

describe("§5.6 the bid cut, charged by the till", () => {
	// **One sweep per arm, shared by the rows that read it.** Each call flies 98,685
	// cycles through `transactAtStation` and re-flies every zero off the floor, and
	// five rows here wanted the same two figures; the suite is gated, so that was
	// ~0.6 s of arithmetic repeated inside one run for no new information. Memoized
	// rather than computed at collection time so a filtered run of one row pays for
	// one row.
	let shippedCache: CycleSurvey | null = null;
	const shipped = (): CycleSurvey =>
		shippedCache ?? (shippedCache = surveyConsoleCycles());
	let controlCache: CycleSurvey | null = null;
	const control = (): CycleSurvey =>
		controlCache ?? (controlCache = surveyConsoleCycles(NO_WEDGE));

	/** The mid the till is working from, derived the way the till derives it. */
	const midOf = (name: string): number => {
		const base = marketRow(commodity(name), 3, STATION, 0);
		return stockResponse(
			base.priceCr,
			0,
			HULL_SPECS[PLAYER_BASELINE_HULL].holdT,
		);
	};

	test("a purchase charges the market price, unchanged", () => {
		// **The ask side is where #7's law still stands.** #191 D1 reads "a station
		// buys lower than it sells", and cutting one column rather than both is also
		// the cheapest closure measured — so `buyCr === midCr` is a ruling, and a
		// change to it is a change to the ruling rather than to a tuning figure.
		const mid = midOf("Food");
		// Exact, and asserted on the quote rather than on the till's credit
		// arithmetic: 100 Cr less 5.6 is 94.4, and the subtraction of those two
		// floats is 5.599999999999994. A pin on the difference would be a pin on
		// IEEE-754 rather than on the ruling.
		// Quoted, which turns out to be *tidier* than the mid: `marketRow`'s base is a
		// multiple of `PRICE_STEP_CR` by §3, but once `stockResponse` has multiplied it
		// the product is 5.6000000000000005, and the quote is 5.6. That is the same
		// rule doing the work it does for the SELL column — the till cannot charge a
		// figure with more digits than the glass shows — so the ask side is now exact
		// where it used to be exact only after a subtraction nobody should trust.
		expect(marketQuote(mid, 8).buyCr).toBe(quantizeToDisplayStepCr(mid));
		expect((marketQuote(mid, 8).buyCr * 10) % 1).toBe(0);
		const before = input();
		const bought = transactAtStation(before);
		expect(bought.accepted).toBe(true);
		// **Against the quote, not the mid.** The till charges `q.buyCr`, so comparing
		// the charge to `mid` measures the quantization as though it were the price: it
		// passes here only because this mid happens to round to itself, and a good whose
		// mid carried a hundredths digit would fail for the wrong reason.
		expect(before.commander.credits - bought.commander.credits).toBeCloseTo(
			marketQuote(mid, 8).buyCr,
			12,
		);
	});

	test("a sale pays the bid, which is the mid less the cut at that tech level", () => {
		const mid = midOf("Food");
		const paid = transactAtStation(
			input({
				commander: {
					...newCommander(PLAYER_BASELINE_HULL),
					credits: 0,
					cargo: { Food: 1 },
				},
				action: { type: "sell-commodity", commodity: "Food" },
			}),
		);
		expect(paid.accepted).toBe(true);
		// Quoted, not multiplied: the till pays what the glass shows, so the
		// expected figure is the quote of that product rather than the product.
		expect(paid.commander.credits).toBe(
			quantizeToDisplayStepCr(
				Math.max(PRICE_STEP_CR, mid * (1 - bidCutAtTl(8))),
			),
		);
	});

	test("a deeper tech level pays the seller less, at the same console", () => {
		// The direction #191 D4 settled by measurement is asserted at the till as
		// well as at the screen, because the till is what a commander feels.
		const sellAt = (tl: number): number =>
			transactAtStation(
				input({
					displayTL: tl,
					commander: {
						...newCommander(PLAYER_BASELINE_HULL),
						credits: 0,
						cargo: { Food: 1 },
					},
					action: { type: "sell-commodity", commodity: "Food" },
				}),
			).commander.credits;
		expect(sellAt(15)).toBeLessThan(sellAt(1));
	});

	test("no round trip in tonnage goods nets a credit, at any hull", () => {
		// **§12's weak joint 12, closed for the goods whose units are tonnes.**
		// Every dockable hull, every good the table can sell, all three priced
		// station types, all eight economies, both orders, across the whole tech
		// table — flown through the shipped calculator, with a refused leg throwing
		// rather than netting a quiet zero.
		//
		// **The count is the assertion, not the maximum.** #196's own words: *closed
		// has to mean measured-at-zero rather than smaller-than-before*, and a
		// maximum of "only 3 Cr a cycle instead of 400" is exactly the reading that
		// let a pump live this long. `tonnage` is how many of those cycles still
		// print money.
		const s = shipped();
		// 9 dockable hulls × 16 goods the table sells × 3 priced station types × 8
		// economies × 15 tech levels × both orders, less the buy legs whose shelf is
		// empty and so are not transactions that exist. Pinned, because a sweep
		// whose domain silently shrank still reports a clean zero for this row.
		expect(s.rows).toBe(98_685);
		expect(s.positiveByTonnage.tonnage).toBe(0);
	});

	test("a market already sold into: 6,327 of 188,325 cycles clear over every dockable hull, by ≤90.00 Cr", () => {
		// **The closure the constant claims is about a market the trader has not already
		// moved**, and a review round found the sentence wider than the survey. Chained
		// cycles hand the mark straight back and stay shut (the row below). A *dump* does
		// not: sell two holds in without buying them back, and the console is 40 units short
		// of a price; a hold sold into that depression is quoted off it, while the buy-back
		// is the same depression with no cut on it. So the cycle clears.
		//
		// **Pinned as three figures, not a mood**: how many rows clear, out of how many
		// flown, and the worst one named with its station type, economy, tech level and how
		// deep the dump was. A claim like "the residue is small" that is not pinned is how
		// a leak gets described away — this node has been told that three rounds running
		// about other people's numbers, and this one is its own.
		//
		// **The floor that closes it is already priced and declined.** A flat 0.315 — the
		// rung §5.6 records as closing the pump and costing the trade loop — gives 0 positive
		// over this same domain (measured; §10.3 carries the comparison). So the dial's cost
		// of closing this door is known, which is what makes the residue a decision rather
		// than a surprise.
		// The console under test, at one seed, built by the same helper both residue rows
		// use — a per-test rebuild is where the two rows could quietly disagree about which
		// station they measured.
		const consoleAt = (type: BerthType) => {
			const station = marketStationOf(
				{ type, localCarrierId: `p-${type}`, blackMarket: true },
				PRIOR_MARK_SEED,
			);
			return { station, key: carrierKey(0, `p-${type}`) };
		};
		/**
		 * Throw `prior` holds into one console without buying them back, then fly one
		 * sell-then-buy cycle, and report what it netted. `null` is a leg that cannot be
		 * booked, not a cycle that netted nothing.
		 */
		const priorMarked = (
			conso: { station: ReturnType<typeof marketStationOf>; key: CarrierKey },
			good: (typeof COMMODITIES)[number],
			economy: number,
			tl: number,
			prior: number,
			qty: number,
			hull: HullId,
			// The quote is a parameter because the row's second arm is a *different law*
			// over the same domain. A control that is asserted rather than flown is the
			// thing this node's last two review rounds kept catching.
			quote: (
				midCr: number,
				displayTL: number,
			) => {
				buyCr: number;
				sellCr: number;
			} = marketQuote,
		): number | null => {
			const { station, key } = conso;
			const at = (
				action: "buy-commodity" | "sell-commodity",
				quantity: number,
			) => ({
				station,
				stationKey: key,
				economy,
				displayTL: tl,
				action: { type: action, commodity: good.name, quantity },
			});
			// Cargo is injected rather than bought: the *prior* legs are a dump, and a
			// trader who bought them first would be measuring the cycle instead.
			let state: CycleState = {
				commander: {
					...newCommander(hull),
					credits: 50_000_000,
					cargo: {},
				},
				deficits: {},
			};
			for (let i = 0; i < prior; i++) {
				const out = leg(
					state,
					{
						commander: { ...state.commander, cargo: { [good.name]: qty } },
						...at("sell-commodity", qty),
					},
					quote,
				);
				if (!out.accepted) return null;
				state = {
					commander: { ...out.state.commander, cargo: {} },
					deficits: out.state.deficits,
				};
			}
			// **The shelf is read as the till reads it** — base quantity plus the deficit
			// the dump just made. Reading the base alone asks the last leg to buy units the
			// console no longer has, which returns `rejected` and shrinks the row's own
			// count without saying so.
			const buyQty = Math.min(
				qty,
				shelfQuantity(
					marketRow(good, economy, station, 0).quantity,
					readDeficit(state.deficits, key, good.name, 0),
				),
			);
			if (buyQty <= 0) return null;
			const start = state.commander.credits;
			// Cargo is injected here too, exactly as the dump legs do it. A leg that
			// carries no cargo is *refused*, and a row that refuses every leg reports a
			// clean zero — which is how this helper's first refactor draft passed by
			// measuring nothing. `flown` is pinned below against exactly that.
			const sold = leg(
				state,
				{
					commander: { ...state.commander, cargo: { [good.name]: buyQty } },
					...at("sell-commodity", buyQty),
				},
				quote,
			);
			if (!sold.accepted) return null;
			const back = leg(sold.state, at("buy-commodity", buyQty), quote);
			if (!back.accepted) return null;
			return back.state.commander.credits - start;
		};
		// **The hull is part of the domain, and an earlier draft of this row left it
		// out.** §182 made the deficit mark scale with the *flown* hold, so a 60 t hauler
		// throws three times the tonnes at the same console for the same relative
		// depression: the residue is not one hull's 40 Cr, it is whatever the biggest
		// berth admits. Every dockable hull is flown here for that reason.
		let flown = 0;
		let cleared = 0;
		let worstCr = 0;
		let worstRow = "";
		// **The same walk, with the closing rung's quote.** The claim "the floor that
		// closes this door is already priced" is a measurement, and the only way it means
		// anything is if the arm that prices it is flown over the same domain rather than
		// asserted beside it.
		let flownAtClosingFloor = 0;
		let clearedAtClosingFloor = 0;
		// The three consoles are built once each, outside every loop. `consoleAt` is a
		// pure derivation from a constant seed, so rebuilding it 188,325 times measured
		// nothing and made the row's own cost look like the station generator's.
		const consoles = {
			trade: consoleAt("trade"),
			refinery: consoleAt("refinery"),
			shipyard: consoleAt("shipyard"),
		};
		for (const hull of DOCKABLE_HULL_IDS) {
			const holdT = HULL_SPECS[hull].holdT;
			for (const type of ["trade", "refinery", "shipyard"] as const) {
				const conso = consoles[type];
				const { station } = conso;
				for (const good of COMMODITIES) {
					if (good.unit !== "t") continue;
					for (const economy of ALL_ECONOMIES) {
						const qty = Math.min(
							holdT,
							shelfQuantity(marketRow(good, economy, station, 0).quantity, 0),
						);
						if (qty <= 0) continue;
						for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++)
							for (const prior of [0, 1, 2, 3, 5]) {
								const net = priorMarked(
									conso,
									good,
									economy,
									tl,
									prior,
									qty,
									hull,
								);
								if (net !== null) {
									flown++;
									if (net > 0.0001) {
										cleared++;
										if (net > worstCr) {
											worstCr = net;
											worstRow = `${good.name} ${type} e${economy} TL${tl} after ${prior} @ ${holdT}t`;
										}
									}
								}
								const closing = priorMarked(
									conso,
									good,
									economy,
									tl,
									prior,
									qty,
									hull,
									CLOSING_FLOOR,
								);
								if (closing === null) continue;
								flownAtClosingFloor++;
								if (closing > 0.0001) clearedAtClosingFloor++;
							}
					}
				}
			}
		}
		expect({ flown, cleared, worstRow, worstCr: worstCr.toFixed(2) }).toEqual({
			flown: 188_325,
			cleared: 6_327,
			worstRow: "Luxuries shipyard e0 TL1 after 2 @ 60t",
			worstCr: "90.00",
		});
		// **And the rung that closes it does close it, over the same legs.**
		// This is the price of the residue, measured rather than quoted: 0 cycles clear
		// once the floor is `CLOSING_CUT` flat — which is the rung §5.6 declines because
		// it also cancels the trade loop.
		expect({
			flownAtClosingFloor,
			clearedAtClosingFloor,
		}).toEqual({
			flownAtClosingFloor: 188_325,
			clearedAtClosingFloor: 0,
		});
	});

	test("four chained cycles on ONE deficit map: tonnage stays shut, units do not", () => {
		// **The corpus seeds a fresh map per cycle** and says so — every realized dock is
		// its own epoch, so a survey asks each console once and measures at zero. A review
		// round asked the question that leaves open: does a *chain* — sell into a market,
		// buy back, sell into the mark you just made — reopen the pump once the station
		// already carries it? Four cycles deep, one shared map, every station type, good,
		// economy and tech level a shelf admits.
		//
		// **It does not reopen the one the law claims.** Over **4,410 tonnage chains**
		// (§12.12's population: goods whose units *are* tonnes, a full hold per leg) not one
		// nets a credit. The claim in `market.ts` is scoped to those goods, and it survives
		// chaining.
		//
		// **And the answer for the units is that they were never shut**, which this row now
		// states instead of hiding behind a `positive: []` it could not earn. A sub-tonne
		// good is quoted up to 63 units while the deficit normalizes by the flown hull's
		// hold, so one sell-leg moves that market by more than a hold-equivalent and the
		// rebound pays for the cut and then some: **720 of 1,080 unit chains are positive,
		// the worst +4,410.00 Cr over four cycles (Platinum, shipyard, economy 0, TL 1)**.
		// It is not a chain effect — a single cycle at an untouched market is positive too,
		// and §10.3's residue section already owns that population. Pinning the count here
		// is what keeps the residue from being read as closed by a row that quietly skipped
		// the goods it could not close.
		//
		// Three mechanics keep the row honest. **Cargo is booked, not conjured**: one load
		// carried in, sold and bought back, so the chain ends where it began (injecting a
		// fresh load per cycle — an earlier draft — discards the previous purchase and
		// biases every net negative). **Both legs carry an explicit `quantity`**: omitting it
		// sells one unit, which is not the round trip §5.6 closes. **The shelf is read as
		// the till reads it**, `readDeficit` then `shelfQuantity`; capping a buy-back at the
		// untouched epoch shelf refused 2,280 of 2,520 legs, and skipping refusals would
		// have manufactured closure out of a bug in this row.
		const liveShelf = (
			good: (typeof COMMODITIES)[number],
			economy: number,
			station: ReturnType<typeof marketStationOf>,
			stationKey: ReturnType<typeof carrierKey>,
			deficits: DeficitMap,
		): number =>
			shelfQuantity(
				marketRow(good, economy, station, 0).quantity,
				readDeficit(deficits, stationKey, good.name, 0),
			);
		const CHAIN = 4;
		let tonnageFlown = 0;
		let unitFlown = 0;
		const refusals: string[] = [];
		const tonnagePositive: string[] = [];
		let unitPositive = 0;
		let worstUnit = "";
		let worstUnitCr = 0;
		for (const type of ["trade", "refinery", "shipyard"] as const) {
			const station = marketStationOf(
				{ type, localCarrierId: `chain-${type}`, blackMarket: true },
				0x51a7_10,
			);
			const key = carrierKey(0, `chain-${type}`);
			for (const good of COMMODITIES) {
				for (const economy of ALL_ECONOMIES) {
					const openShelf = liveShelf(good, economy, station, key, {});
					if (openShelf <= 0) continue;
					for (let tl = DISPLAY_TL_MIN; tl <= DISPLAY_TL_MAX; tl++) {
						const qty = Math.min(
							good.unit === "t" ? HOLD_REFERENCE_T : 63,
							openShelf,
						);
						if (qty <= 0) continue;
						let commander = {
							...newCommander(PLAYER_BASELINE_HULL),
							credits: 10_000_000,
							cargo: { [good.name]: qty },
						};
						let deficits: DeficitMap = {};
						let totalCr = 0;
						let complete = true;
						for (let c = 0; c < CHAIN && complete; c++) {
							const start = commander.credits;
							// **Explicit quantity on both legs.** Without one a sale takes a
							// single unit, and "sell a hold, buy a hold" becomes "sell one,
							// buy a hold back" — a different trade whose net would look
							// closed for the wrong reason.
							const at = (action: "buy-commodity" | "sell-commodity") => ({
								station,
								stationKey: key,
								economy,
								displayTL: tl,
								action: {
									type: action,
									commodity: good.name,
									quantity: qty,
								},
							});
							const sold = leg({ commander, deficits }, at("sell-commodity"));
							if (!sold.accepted) {
								refusals.push(
									`${good.name} ${type} e${economy} TL${tl} sell: ${sold.reason}`,
								);
								complete = false;
								break;
							}
							const back = leg(sold.state, at("buy-commodity"));
							if (!back.accepted) {
								refusals.push(
									`${good.name} ${type} e${economy} TL${tl} buy: ${back.reason}`,
								);
								complete = false;
								break;
							}
							totalCr += back.state.commander.credits - start;
							commander = back.state.commander;
							deficits = back.state.deficits;
						}
						if (!complete) continue;
						// Cargo in equals cargo out, or the net is not a round trip.
						expect(commander.cargo[good.name]).toBe(qty);
						const label = `${good.name} ${type} e${economy} TL${tl}`;
						if (good.unit === "t") {
							tonnageFlown++;
							if (totalCr > 0.0001)
								tonnagePositive.push(
									`${label}: +${totalCr.toFixed(2)} Cr over ${CHAIN} chained cycles`,
								);
						} else {
							unitFlown++;
							if (totalCr > 0.0001) {
								unitPositive++;
								if (totalCr > worstUnitCr) {
									worstUnitCr = totalCr;
									worstUnit = label;
								}
							}
						}
					}
				}
			}
		}
		expect({ tonnageFlown, refusals, tonnagePositive }).toEqual({
			// Pinned, so a shrink in coverage is a red run and an empty `positive` cannot
			// be the empty result of flying nothing.
			tonnageFlown: 4_410,
			refusals: [],
			tonnagePositive: [],
		});
		// **The residue is a figure, not a shrug.** Pinned because it is a claim in §10.3,
		// and a claim that moves silently is how a leak gets called a residue.
		expect({
			unitFlown,
			unitPositive,
			worstUnit,
			worstUnitCr: worstUnitCr.toFixed(2),
		}).toEqual({
			unitFlown: 1_080,
			unitPositive: 720,
			worstUnit: "Platinum shipyard e0 TL1",
			worstUnitCr: "4410.00",
		});
	});

	test("the metals cycle survives the floor, by 1,064.70 Cr, and is named", () => {
		// **The other end of the ladder, which #196 asked to be reported rather than
		// quietly left out of the headline.** §5.2's memory counts *units*, so 63 units
		// of Platinum is 0.2 t of cargo and one purchase saturates a hull of 20 t or
		// less — the swing is the far end of `stockResponse`'s range, more than any cut
		// the trade loop survives. This is #182's weak joint 14, asserted as a *present
		// fact with a figure*: a node that re-anchors the sub-tonne mark turns this row
		// red and reads the number it just changed.
		const s = shipped();
		// 12,073 of 98,685 rows — 12.2% — and every positive row in the corpus is a
		// sub-tonne one, which is what the row above is for.
		expect(s.positiveByTonnage.subTonnes).toBe(12_073);
		expect(s.positiveByTonnage.subTonnes).toBe(s.positiveRows);
		const binding = s.bestSubTonnes;
		if (binding === null) throw new Error("the sweep flew no metals row");
		// Transcribed off a run, like every pinned figure here. The binding row is the
		// scarcest metal in the smallest hull at the cheapest market, sell-first, and 63
		// units at 78.80 Cr is 4,964 Cr of working capital — so the yield is a fifth of
		// it per cycle. Read as a rate that is the finding: a click at one console
		// out-earns a haul.
		expect(binding.netCr).toBeCloseTo(1_064.7, 1);
		expect([
			binding.cycle.good.name,
			binding.cycle.hull,
			binding.cycle.economy,
			binding.cycle.type,
			binding.cycle.displayTL,
			binding.cycle.arm,
			binding.units,
		]).toEqual(["Platinum", "courier", 0, "shipyard", 1, "sell-first", 63]);
		expect(binding.midCr).toBeCloseTo(78.8, 2);
		// The control, without which the figure above is unfalsifiable: on #7's
		// one-price law the same corpus is almost entirely profitable and the binding row
		// nets half again as much. The cut took a third of the pump and left the pump.
		const controlSurvey = control();
		expect(controlSurvey.positiveRows).toBeGreaterThan(90_000);
		expect(controlSurvey.worst.netCr).toBeCloseTo(1_563.79, 1);
	});

	test("every zero off the price floor is attributed, not counted", () => {
		// **What the zeros are, rather than how many, and each one asked the same
		// question: would it still net nothing with the tenth-credit quote step taken
		// off?** A previous revision of this row found 74 zeros, asserted they were
		// boundaries, and walked one of the 74 to prove it. Walking all of them changed
		// the story twice over: the count is 3,472 rather than 74, and the reason is not
		// one mechanism but three.
		//
		// The categories are in `ZeroWalk`. What matters here is the third one. Two
		// hundred and eighty-one of these cycles **would profit** — by up to 5.54 Cr —
		// if the quote were not a whole number of tenths, which means the display law
		// #193's rule led to is closing cycles §5.6's cut does not. Small against the
		// 1,064.70 Cr the row above reports, and stated rather than folded into the
		// closure count, because a closure whose weakest rung is the number of digits on
		// the glass should be known to have one.
		const s = shipped();
		const walk = s.zeroOffFloor;
		expect(walk.count).toBe(3_472);
		expect(walk.lawCloses).toBe(2_799);
		expect(walk.quantizedToZero).toBe(392);
		expect(walk.rescuedByRounding.count).toBe(281);
		expect(walk.rescuedByRounding.worstCr).toBeCloseTo(5.544, 2);
		// The three figures are the whole count. A category that leaves a remainder is a
		// category list that is about to be read as complete while it is not.
		expect(
			walk.lawCloses + walk.quantizedToZero + walk.rescuedByRounding.count,
		).toBe(walk.count);
		// And the rim wash is the biggest single piece of it, which is what the floor is
		// *for*: at TL 1 the cut equals the mark a full hold leaves, so a hold sold and
		// bought back there nets nothing at all. One tech level in, the same cycle loses
		// — the cut has moved off the mark and the mark has not.
		const zero = s.firstZeroOffTheFloor;
		if (zero === null) throw new Error("the sweep found no zero off the floor");
		expect(zero.cycle.displayTL).toBe(DISPLAY_TL_MIN);
		// Spread rather than rebuilt field by field: a row that names every field of a
		// cycle by hand keeps a stale one when the record grows, and reads as if the
		// one tech level in were a different cycle.
		expect(
			flyConsoleCycle(
				{ ...zero.cycle, displayTL: DISPLAY_TL_MIN + 1 },
				marketQuote,
			).netCr,
		).toBeLessThan(0);
	});

	test("a quote is the figure the console prints, to the last digit shown", () => {
		// **The rule §5.6 had to add once #193's own logic was followed to the end.**
		// `priceLabel` renders a tenth of a credit, and while the till charged the
		// unquoted figure behind it, a commander reading 3.5 Cr was being paid 3.51 — a
		// screen figure the till would not honour, which is precisely the defect class
		// that made a Food row print `0 Cr`. So the quote is quantized, and this row
		// holds the two sides of the pair against each other rather than trusting the
		// comment that says they agree: the row's printed SELL column, read back as a
		// number, is what one unit actually cost the station.
		const good = commodity("Food");
		const station = marketStationOf(
			{ type: "trade", localCarrierId: "label-and-till", blackMarket: true },
			0x51a7_10,
		);
		const stationKey = carrierKey(0, "label-and-till");
		for (const displayTL of [1, 7, 15]) {
			const row = stationMarketScreen({
				economy: 3,
				station,
				deficitOf: () => 12,
				gameTimeMin: 0,
				holdT: HOLD_REFERENCE_T,
				cargo: {},
				displayTL,
			}).find((r) => r.commodity.name === "Food");
			if (row?.sellCr === undefined)
				throw new Error("the console dropped the Food row");
			// The label is the quote, not a rounding of it: a tenth is the smallest
			// figure the glass can show, so a quote carrying a hundredth would print
			// a number the till then contradicts.
			expect(Number(priceLabel(row.sellCr).replace(" Cr", ""))).toBe(
				row.sellCr,
			);
			const commander: CommanderState = {
				...newCommander(PLAYER_BASELINE_HULL),
				credits: 1_000,
				cargo: { Food: 5 },
			};
			// The 12 units the screen priced the row off, written through the same
			// funnel the console's own trades go through, so the row cannot price a
			// deficit the till then reads differently.
			const deficits = recordTrade({}, stationKey, {
				goodName: "Food",
				units: 12,
				gameTimeMin: 0,
				holdT: HOLD_REFERENCE_T,
			});
			expect(readDeficit(deficits, stationKey, "Food", 0)).toBe(12);
			const out = transactAtStation({
				commander,
				deficits,
				entrustedT: 0,
				rungs: TOP_RUNGS,
				hullReach: () => ({ ok: true, systems: 1 }) as const,
				station,
				stationKey,
				economy: 3,
				gameTimeMin: 0,
				displayTL,
				action: { type: "sell-commodity", commodity: "Food", quantity: 5 },
			});
			if (!out.accepted) throw new Error(`sale refused: ${out.reason}`);
			expect(out.commander.credits - 1_000).toBeCloseTo(row.sellCr * 5, 9);
		}
	});

	test("the same sweep with the wedge off nets plenty — the control", () => {
		// The row above is only evidence if this one is not also zero. #25's
		// question inverted: *could the losing arm have been given what the winning
		// arm had* — both arms get the same sweep, the same generated cases and the
		// same calculator, and differ in the one law.
		const controlSurvey = control();
		expect(controlSurvey.rows).toBe(98_685);
		expect(controlSurvey.positiveRows).toBeGreaterThan(20_000);
		// The shape is worth naming: the binding row is a sub-tonne good in a small
		// hull, which is #182's weak joint 14 arriving from the other side.
		expect(controlSurvey.worst.netCr).toBeGreaterThan(1_000);
		expect(controlSurvey.worst.cycle.good.unit).not.toBe("t");
	});

	test("§12.12's six cycles take credits away rather than printing them", () => {
		// The exact shape the weak joint recorded: one commander, one console, the
		// same good cycled, and the cargo unchanged at the end. It turned 100,000 Cr
		// into 100,024 on `main`. Six is not a bound, it is the row's name — the
		// sweep above is the bound, and this is the same defect in the form the
		// spec describes it in.
		let commander: CommanderState = {
			...newCommander(PLAYER_BASELINE_HULL),
			credits: 100_000,
			cargo: { Food: 20 },
		};
		let deficits: DeficitMap = {};
		for (let i = 0; i < 6; i++) {
			for (const type of ["sell-commodity", "buy-commodity"] as const) {
				const out = transactAtStation({
					commander,
					deficits,
					entrustedT: 0,
					rungs: TOP_RUNGS,
					hullReach: () => ({ ok: true, systems: 1 }) as const,
					station: STATION,
					stationKey: KEY,
					economy: 3,
					gameTimeMin: 0,
					displayTL: 8,
					action: { type, commodity: "Food" as const, quantity: 20 },
				});
				expect(out.accepted).toBe(true);
				commander = out.commander;
				deficits = out.deficits;
			}
		}
		// Back where it started, one hold of Food, and poorer for the six trips.
		// That is the whole finding: the cycle is not merely smaller than #12.12
		// measured, it is a *loss*, so repeating it is not a grind toward a fortune.
		expect(commander.cargo.Food).toBe(20);
		expect(commander.credits).toBeLessThan(100_000);
		// **And the loss is the law, pinned as a formula rather than as a number
		// someone transcribed.** A sale leaves the mark of one full hold —
		// `PRICE_ELASTICITY`, because a trade cannot move the deficit by more than the
		// hold it was made in — and pays the mid less the cut; the buy-back is quoted
		// against that mark. So one cycle costs the row's value times
		// `cut − PRICE_ELASTICITY`, which at TL 8 is 7.5% of it rather than the 10% the
		// cycle used to print. A transcribed balance would go stale on any retune of
		// the fluct byte; this goes red if either term stops holding.
		// **Read through the quote, because the quote is what the till charges.**
		// The two unit prices a cycle meets are the market's own figure after the
		// sale's mark, and the mid less the cut — which is the formula above — and
		// each of them reaches the commander through the tenth-credit step. Asking
		// `marketQuote` for the pair keeps this a derivation from the law rather than
		// a transcription of a run, and is the only way the row can notice the step.
		const mid = marketRow(commodity("Food"), 3, STATION, 0).priceCr;
		// Sold into an empty room at the mid, bought back against the mark the sale
		// left: the order matters, and a quote of the *marked* mid on both sides is the
		// buy-first cycle, which closes by a different arithmetic.
		const proceeds = quantizeToDisplayStepCr(mid * (1 - bidCutAtTl(8)));
		const cost = quantizeToDisplayStepCr(mid * (1 - PRICE_ELASTICITY));
		expect(100_000 - commander.credits).toBeCloseTo(
			6 * 20 * (cost - proceeds),
			9,
		);
	});
});

/**
 * §4 of `missions-and-requests.md`: entrusted cargo occupies the hold beside
 * ordinary cargo and is excluded from sale. It is **not** merged into
 * `CommanderState.cargo`, so every capacity consumer has to be told about it —
 * "a display-only hold deduction is insufficient" is the contract's wording,
 * and the parameter is required for `holdT`'s reason (#182): a caller that
 * forgot would silently sell a hold it does not have.
 */
describe("entrusted tonnes are hold, not cargo", () => {
	test("the hold readout counts entrusted tonnes it cannot see in cargo", () => {
		const commander = newCommander(PLAYER_BASELINE_HULL);
		const empty = commanderHold(commander, 0);
		const laden = commanderHold(commander, 8);
		expect(laden.capacityT).toBe(empty.capacityT);
		expect(laden.usedT).toBe(empty.usedT + 8);
		expect(commander.cargo).toEqual({});
	});

	test("a buy is refused when entrusted cargo has filled the hold", () => {
		const commander = newCommander(PLAYER_BASELINE_HULL);
		const capacity = commanderHold(commander, 0).capacityT;
		expect(
			transactAtStation(input({ commander, entrustedT: capacity })),
		).toMatchObject({ accepted: false });
		expect(
			transactAtStation(input({ commander, entrustedT: 0 })).accepted,
		).toBe(true);
	});

	test("a scoop takes only the room entrusted cargo leaves", () => {
		const commander = newCommander(PLAYER_BASELINE_HULL);
		const capacity = commanderHold(commander, 0).capacityT;
		const took = scoopCargo(commander, "Food", capacity, capacity - 3);
		expect(took.tonnes).toBe(3);
		expect(scoopCargo(commander, "Food", 1, capacity).accepted).toBe(false);
	});
});
