import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { type DeficitMap, readDeficit } from "../src/deficits";
import {
	DEFICIT_MAX,
	PRICE_ELASTICITY,
	PRICE_STEP_CR,
	bidCutAtTl,
	marketQuote,
	commodity,
	marketRow,
	marketStationOf,
	shelfQuantity,
	stockResponse,
} from "../src/market";
import { HULL_SPECS, type HullId, PLAYER_BASELINE_HULL } from "../src/hull";
import { JUMP_TANK_LY } from "../src/hyperspace";
import {
	type CommanderState,
	STARTING_CREDITS,
	newCommander,
	transactAtStation,
} from "../src/station-commerce";
import { newWorld, parseWorld, serializeWorld } from "../src/world-state";
import {
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
		expect(marketQuote(mid, 8).buyCr).toBe(mid);
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
		expect(paid.commander.credits).toBe(
			Math.max(PRICE_STEP_CR, mid * (1 - bidCutAtTl(8))),
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
		const s = surveyConsoleCycles();
		// 9 dockable hulls × 16 goods the table sells × 3 priced station types × 8
		// economies × 15 tech levels × both orders, less the buy legs whose shelf is
		// empty and so are not transactions that exist. Pinned, because a sweep
		// whose domain silently shrank still reports a clean zero for this row.
		expect(s.rows).toBe(98_685);
		expect(s.positiveByTonnage.tonnage).toBe(0);
		// And the tonnage rows do not merely fail to profit — off §3's price floor
		// none of them lands on zero either. A zero there would mean the cut had
		// stopped exceeding the mark somewhere, rather than the mark being unable to
		// reach the cut.
		expect(s.zeroRowsOffTheFloorAllSubTonnes).toBe(true);
	});

	test("the metals cycle survives the floor, by 1,017.70 Cr, and is named", () => {
		// **The other end of the ladder, which #196 asked to be reported rather than
		// quietly left out of the headline.** §5.2's memory counts *units*, so 63
		// units of Platinum is 0.2 t of cargo and one purchase saturates a hull of
		// 20 t or less — the swing is the far end of `stockResponse`'s range, which is
		// more than any cut the trade loop survives. This is #182's weak joint 14, and
		// it is asserted as a *present fact with a figure*, not as a paragraph:
		// a node that re-anchors the sub-tonne mark turns this row red and reads the
		// number it just changed.
		const s = surveyConsoleCycles();
		// 11,784 of 98,685 rows — 11.9% — and every positive row in the corpus is a
		// sub-tonne one, which is what the row above is for.
		expect(s.positiveByTonnage.subTonnes).toBe(11_784);
		expect(s.positiveByTonnage.subTonnes).toBe(s.positiveRows);
		const binding = s.bestSubTonnes;
		if (binding === null) throw new Error("the sweep flew no metals row");
		// Transcribed off a run, like every pinned figure here: the binding row is
		// the scarcest metal in the smallest hull at the cheapest market, sell-first,
		// and 63 units at 78.80 Cr is 4,964 Cr of working capital, so the yield is a
		// fifth of it per cycle. Read as a rate it is the finding: a click at one
		// console out-earns a haul.
		expect(binding.netCr).toBeCloseTo(1_017.7, 1);
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
		// one-price law the same corpus is almost entirely profitable and the binding
		// row nets half again as much. The cut took a third of the pump and left the
		// pump.
		const control = surveyConsoleCycles(NO_WEDGE);
		expect(control.positiveRows).toBeGreaterThan(90_000);
		expect(control.worst.netCr).toBeCloseTo(1_563.79, 1);
	});

	test("a zero off the price floor is where the cut and the mark cancel", () => {
		// **The count is not a bug, and a test that called it one would have been
		// wrong.** 74 rows net exactly nothing on neither leg's floor. They are the
		// crossing: at one tech level lower the same cycle profits, at one higher it
		// loses. Walking to both neighbours is what distinguishes a boundary from an
		// unexplained zero, and only the walk says so — the count alone cannot tell
		// the two apart, which is why this row exists beside the count.
		const s = surveyConsoleCycles();
		expect(s.zeroRowsOffTheFloor).toBe(74);
		const zero = s.firstZeroOffTheFloor;
		if (zero === null) throw new Error("the sweep found no zero off the floor");
		const { good, hull, economy, type, arm, gameTimeMin } = zero.cycle;
		const tl = zero.cycle.displayTL;
		const at = (displayTL: number): number =>
			flyConsoleCycle(
				{ good, hull, economy, type, displayTL, arm, gameTimeMin },
				marketQuote,
			).netCr;
		expect(at(tl - 1)).toBeGreaterThan(0);
		expect(at(tl + 1)).toBeLessThan(0);
	});

	test("the same sweep with the wedge off nets plenty — the control", () => {
		// The row above is only evidence if this one is not also zero. #25's
		// question inverted: *could the losing arm have been given what the winning
		// arm had* — both arms get the same sweep, the same generated cases and the
		// same calculator, and differ in the one law.
		const control = surveyConsoleCycles(NO_WEDGE);
		expect(control.rows).toBe(98_685);
		expect(control.positiveRows).toBeGreaterThan(20_000);
		// The shape is worth naming: the binding row is a sub-tonne good in a small
		// hull, which is #182's weak joint 14 arriving from the other side.
		expect(control.worst.netCr).toBeGreaterThan(1_000);
		expect(control.worst.cycle.good.unit).not.toBe("t");
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
		// `cut − PRICE_ELASTICITY`, which at TL 8 is 8% of it rather than the 10% the
		// cycle used to print. A transcribed balance would go stale on any retune of
		// the fluct byte; this goes red if either term stops holding.
		const midT = marketRow(commodity("Food"), 3, STATION, 0).priceCr * 20;
		expect(100_000 - commander.credits).toBeCloseTo(
			6 * midT * (bidCutAtTl(8) - PRICE_ELASTICITY),
			9,
		);
	});
});
