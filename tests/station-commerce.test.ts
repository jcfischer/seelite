import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { type DeficitMap, readDeficit, recordTrade } from "../src/deficits";
import {
	DEFICIT_MAX,
	DISPLAY_TL_MIN,
	quantizeToDisplayStepCr,
	PRICE_ELASTICITY,
	PRICE_STEP_CR,
	bidCutAtTl,
	marketQuote,
	commodity,
	marketRow,
	marketStationOf,
	shelfQuantity,
	stockResponse,
	HOLD_REFERENCE_T,
} from "../src/market";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import { JUMP_TANK_LY } from "../src/hyperspace";
import {
	type CommanderState,
	STARTING_CREDITS,
	newCommander,
	transactAtStation,
} from "../src/station-commerce";
import { priceLabel, stationMarketScreen } from "../src/station-console";
import { newWorld, parseWorld, serializeWorld } from "../src/world-state";
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
	action: { type: "buy-commodity", commodity: "Food" } as const,
	...overrides,
});

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
			state = step(result.commander, result.deficits);
		}
		expect({ hull, bought, reason }).toEqual({
			hull,
			bought: shown,
			reason: "insufficient-shelf",
		});
	}
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
	expect(full.commander.fuelLy).toBe(JUMP_TANK_LY);
});

test("a full tank costs 14 Cr, which is §6.1's figure", () => {
	const empty = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 0 };
	const filled = transactAtStation(
		input({ commander: empty, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBe(JUMP_TANK_LY);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(14, 10);
});

test("a partial tank buys the shortfall and not a whole tank", () => {
	const half = { ...newCommander(PLAYER_BASELINE_HULL), fuelLy: 4 };
	const filled = transactAtStation(
		input({ commander: half, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBe(JUMP_TANK_LY);
	expect(STARTING_CREDITS - filled.commander.credits).toBeCloseTo(6, 10);
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
		expect(commander.fuelLy).toBeLessThanOrEqual(JUMP_TANK_LY);
	}
	expect(commander.fuelLy).toBe(JUMP_TANK_LY);
});

test("a fractional shortfall can be bought back, so the tank reaches 7.0 again", () => {
	// The defect this is written for: flooring the shortfall to §6.1's pricing
	// tenth left a residue no purchase could take, so a tank drained by a jump
	// of non-decimal distance — which is every jump — could never be refilled,
	// and the next attempt was refused as *insufficient credits* on a full purse.
	const afterAJump = {
		...newCommander(PLAYER_BASELINE_HULL),
		fuelLy: JUMP_TANK_LY - 2.34,
	};
	const filled = transactAtStation(
		input({ commander: afterAJump, action: { type: "buy-fuel" } }),
	);
	expect(filled.accepted).toBe(true);
	expect(filled.commander.fuelLy).toBeCloseTo(JUMP_TANK_LY, 12);
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
		expect(before.commander.credits - bought.commander.credits).toBeCloseTo(
			mid,
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
