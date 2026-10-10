/**
 * #564: the three ladders' core — credit, banking on dock, the basis a sale's
 * margin is read against, and the gate catalogue #562 D7 ruled.
 *
 * Every figure here is read off `src/ladder.ts` rather than restated, except
 * where the row *is* the ruling: #562's table and its three tops are the
 * principal's answers, so a drift in the module is meant to go red here.
 */
import { describe, expect, test } from "bun:test";
import type { CarrierKey } from "../src/carrier-key";
import { PURCHASABLE_HULL_IDS } from "../src/hull";
import {
	CAPSTONE_RUNG,
	GATES,
	LADDER_TOP,
	LADDERS,
	type Ladder,
	type LadderRecord,
	RUNG_NAMES,
	TOP_RUNG,
	bankOnDock,
	bankTrade,
	withCapstone,
	basisAfterBuy,
	basisAfterScoop,
	emptyLadderRecord,
	emptyPending,
	gateOf,
	gateRefusal,
	ladderAfterDeath,
	ladderAfterMarket,
	ladderAfterSettlement,
	parseLadders,
	pendingArrival,
	pendingKill,
	reconcileBasis,
	rungOf,
	rungsOf,
	saleMargin,
	serializeLadders,
	threshold,
} from "../src/ladder";
import { killCredit, strength } from "../src/kill-credit";
import { EQUIPMENT } from "../src/market";

const key = (s: string) => s as CarrierKey;

describe("thresholds (#562 D1, D8)", () => {
	test("the tops are #562's measured figures", () => {
		expect(LADDER_TOP).toEqual({
			combat: 141.5,
			trade: 438_276,
			exploration: 1_055,
		});
	});

	test("rung n is the top over 2^(8 - n), rung 0 is free", () => {
		for (const ladder of LADDERS) {
			expect(threshold(ladder, 0)).toBe(0);
			expect(threshold(ladder, TOP_RUNG)).toBe(LADDER_TOP[ladder]);
			for (let n = 1; n < TOP_RUNG; n++)
				expect(threshold(ladder, n) * 2).toBeCloseTo(
					threshold(ladder, n + 1),
					9,
				);
		}
		// #562 D8's table, rung 1 and 4, as printed there.
		expect(Math.round(threshold("trade", 1))).toBe(3_424);
		expect(threshold("combat", 4)).toBeCloseTo(8.84, 2);
		expect(Math.round(threshold("exploration", 4))).toBe(66);
	});

	test("the rung is the highest threshold reached, and never past the top", () => {
		expect(rungOf("trade", 0)).toBe(0);
		expect(rungOf("trade", threshold("trade", 1) - 0.01)).toBe(0);
		expect(rungOf("trade", threshold("trade", 1))).toBe(1);
		expect(rungOf("combat", 1e9)).toBe(TOP_RUNG);
		expect(CAPSTONE_RUNG).toBe(TOP_RUNG);
	});
});

describe("combat credit (#562 D3, D4)", () => {
	test("a matched kill pays 1 and no kill pays 2", () => {
		expect(killCredit({ hull: "raider" }, "raider")).toBeCloseTo(1, 12);
		expect(killCredit({ hull: "courier" }, "raider")).toBeLessThan(2);
	});

	test("the courier kills a raider for 0.954, #562's figure on #866's pools", () => {
		// #562 measured 0.952 against one 106-point pool for every hull. #866 gave
		// the raider its own 107 (the principal accepted the shift on #866).
		expect(killCredit({ hull: "courier" }, "raider")).toBeCloseTo(0.954, 3);
	});

	test("an unarmed target pays nothing, an armed Clean hull pays", () => {
		for (const unarmed of ["freighter", "miner", "courier", "tug"] as const)
			expect(killCredit({ hull: "courier" }, unarmed)).toBe(0);
		expect(killCredit({ hull: "courier" }, "patrol")).toBeGreaterThan(0);
		expect(killCredit({ hull: "courier" }, "interceptor")).toBeGreaterThan(0);
	});

	test("the fitted ship is always armed: S_own is never 0", () => {
		expect(strength({ hull: "freighter" })).toBeGreaterThan(0);
	});
});

describe("the gate catalogue (#562 D7)", () => {
	test("is #562 D7's table, item by item", () => {
		const table: Record<string, [Ladder, number]> = {
			"Extra Pulse Laser": ["combat", 1],
			Missile: ["combat", 1],
			"E.C.M. System": ["combat", 2],
			interceptor: ["combat", 3],
			"Extra Beam Laser": ["combat", 3],
			"Extra Energy Unit": ["combat", 4],
			"Energy Bomb": ["combat", 5],
			patrol: ["combat", 6],
			"Military Laser": ["combat", 6],
			raider: ["combat", 7],
			"Large Cargo Bay": ["trade", 1],
			prospector: ["trade", 2],
			"Mining Laser": ["trade", 2],
			tug: ["trade", 3],
			miner: ["trade", 4],
			freighter: ["trade", 5],
			"Fuel Scoops": ["exploration", 1],
			explorer: ["exploration", 3],
			"Galactic Hyperdrive": ["exploration", 5],
		};
		expect(
			Object.fromEntries(
				Object.entries(GATES).map(([k, g]) => [k, [g.ladder, g.rung]]),
			),
		).toEqual(table);
	});

	test("every item for sale is either gated or one of the five at rung 0", () => {
		const rungZero = [
			"courier",
			"Docking Computer",
			"Long-Range Scanner",
			"Identity Scanner",
			"Escape Pod",
		];
		for (const name of [
			...EQUIPMENT.map((e) => e.name),
			...PURCHASABLE_HULL_IDS,
		])
			expect(gateOf(name) !== null || rungZero.includes(name)).toBe(true);
		for (const name of rungZero) expect(gateOf(name)).toBeNull();
	});

	test("a gate refuses below its rung and names the ladder and rung", () => {
		const low = rungsOf(emptyLadderRecord());
		expect(gateRefusal("Military Laser", low)).toEqual({
			ladder: "combat",
			rung: 6,
			name: RUNG_NAMES.combat[6],
		});
		expect(gateRefusal("Docking Computer", low)).toBeNull();
		const high = { ...low, combat: 6 };
		expect(gateRefusal("Military Laser", high)).toBeNull();
	});

	test("every ladder has nine rung names, none repeated", () => {
		const all = LADDERS.flatMap((l) => RUNG_NAMES[l]);
		for (const l of LADDERS) expect(RUNG_NAMES[l]).toHaveLength(TOP_RUNG + 1);
		expect(new Set(all).size).toBe(all.length);
	});
});

describe("banking on dock (#183 D7)", () => {
	test("a kill is pending until the dock banks it", () => {
		const record = emptyLadderRecord();
		const pending = pendingKill(emptyPending(), 0.5);
		expect(record.banked.combat).toBe(0);
		const docked = bankOnDock(record, pending, {
			galaxyIndex: 0,
			station: key("3:station-trade"),
			gameTime: 100,
		});
		expect(docked.banked.combat).toBe(0.5);
	});

	test("a first arrival is pending, and enters the set only when banked", () => {
		const pending = pendingArrival(emptyLadderRecord(), emptyPending(), 0, 7);
		expect(pending.systems).toEqual([{ galaxyIndex: 0, systemIndex: 7 }]);
		const banked = bankOnDock(emptyLadderRecord(), pending, {
			galaxyIndex: 0,
			station: key("7:station-trade"),
			gameTime: 100,
		});
		expect(banked.visited[0]?.systems).toEqual([7]);
		// The system and the station are two kinds.
		expect(banked.banked.exploration).toBe(2);
	});

	test("a system already in the set, or already pending, is not a kind", () => {
		const record: LadderRecord = {
			...emptyLadderRecord(),
			visited: { 0: { systems: [7], stations: [] } },
		};
		expect(pendingArrival(record, emptyPending(), 0, 7).systems).toEqual([]);
		const once = pendingArrival(record, emptyPending(), 0, 8);
		expect(pendingArrival(record, once, 0, 8).systems).toHaveLength(1);
		// The same index in another galaxy is another place.
		expect(pendingArrival(record, emptyPending(), 1, 7).systems).toHaveLength(
			1,
		);
	});

	test("a second dock at the same station earns nothing", () => {
		const at = {
			galaxyIndex: 0,
			station: key("3:station-trade"),
			gameTime: 1,
		};
		const once = bankOnDock(emptyLadderRecord(), emptyPending(), at);
		const twice = bankOnDock(once, emptyPending(), at);
		expect(once.banked.exploration).toBe(1);
		expect(twice.banked.exploration).toBe(1);
	});

	test("the saved form carries no pending credit", () => {
		const record = emptyLadderRecord();
		const text = JSON.stringify(serializeLadders(record));
		expect(text).not.toContain("pending");
	});

	test("the capstone is recorded on the dock that reaches all three tops, once", () => {
		const nearTop: LadderRecord = {
			...emptyLadderRecord(),
			banked: {
				combat: LADDER_TOP.combat - 0.1,
				trade: LADDER_TOP.trade,
				exploration: LADDER_TOP.exploration,
			},
		};
		const at = { galaxyIndex: 0, station: key("1:station-trade"), gameTime: 5 };
		const without = bankOnDock(
			{
				...nearTop,
				visited: { 0: { systems: [], stations: [key("1:station-trade")] } },
			},
			emptyPending(),
			at,
		);
		expect(without.capstoneAt).toBeNull();
		const reached = bankOnDock(nearTop, pendingKill(emptyPending(), 0.2), at);
		expect(reached.capstoneAt).toBe(5);
		const later = bankOnDock(reached, emptyPending(), { ...at, gameTime: 9 });
		expect(later.capstoneAt).toBe(5);
	});
});

describe("the basis a sale's margin is read against (#183 D3)", () => {
	test("a sale's margin is its proceeds less what the units cost", () => {
		const basis = basisAfterBuy({}, "Food", 10, 50);
		const sale = saleMargin(basis, { Food: 10 }, "Food", 4, 32);
		expect(sale.marginCr).toBeCloseTo(12, 9);
		expect(sale.basis.Food).toEqual({ units: 6, cr: 30 });
	});

	test("a loss does not subtract", () => {
		const basis = basisAfterBuy({}, "Food", 10, 50);
		expect(saleMargin(basis, { Food: 10 }, "Food", 10, 20).marginCr).toBe(0);
	});

	test("units with no basis pay no margin, and are sold first", () => {
		// A v6 hold (the principal's ruling on #564): 5 t aboard, none bought
		// under a known basis.
		const basis = basisAfterBuy({}, "Food", 5, 25);
		const sale = saleMargin(basis, { Food: 10 }, "Food", 5, 40);
		expect(sale.marginCr).toBe(0);
		expect(sale.basis.Food).toEqual({ units: 5, cr: 25 });
	});

	test("a scooped unit has a basis of zero, so its sale is all margin", () => {
		const basis = basisAfterScoop({}, "Gold", 2);
		expect(saleMargin(basis, { Gold: 2 }, "Gold", 2, 90).marginCr).toBe(90);
	});
});

describe("a hold that lost goods some other way", () => {
	test("goods gone off the till shrink the basis at its own average cost", () => {
		// A job hand-over today; the parser refuses a basis covering more than
		// is aboard, so the write reconciles first.
		const basis = {
			Narcotics: { units: 10, cr: 200 },
			Food: { units: 2, cr: 8 },
		};
		expect(reconcileBasis(basis, { Food: 2 })).toEqual({
			Food: { units: 2, cr: 8 },
		});
		expect(reconcileBasis(basis, { Narcotics: 4, Food: 2 }).Narcotics).toEqual({
			units: 4,
			cr: 80,
		});
	});
});

describe("the saved record (#183 D9)", () => {
	test("round-trips", () => {
		const record: LadderRecord = {
			banked: { combat: 1.25, trade: 3000, exploration: 4 },
			visited: {
				0: { systems: [3, 9], stations: [key("3:station-trade")] },
				2: { systems: [1], stations: [] },
			},
			basis: { Food: { units: 4, cr: 22 } },
			playedS: 1234.5,
			capstoneAt: null,
		};
		expect(parseLadders(serializeLadders(record))).toEqual(record);
	});

	test("refuses a galaxy out of range, a bad key, and a basis past zero", () => {
		const good = serializeLadders(emptyLadderRecord()) as Record<
			string,
			unknown
		>;
		expect(() =>
			parseLadders({ ...good, visited: { 8: { systems: [], stations: [] } } }),
		).toThrow();
		expect(() =>
			parseLadders({
				...good,
				visited: { 0: { systems: [], stations: ["trade"] } },
			}),
		).toThrow();
		expect(() =>
			parseLadders({ ...good, basis: { Food: { units: -1, cr: 0 } } }),
		).toThrow();
		expect(() =>
			parseLadders({ ...good, banked: { combat: 0, trade: 0 } }),
		).toThrow();
	});
});

describe("a market transaction's effect on the ladder (#183 D3)", () => {
	const before = { credits: 1000, cargo: { Food: 4 } };
	test("a buy records its basis and banks nothing", () => {
		const after = { credits: 900, cargo: { Food: 14 } };
		const next = ladderAfterMarket(
			emptyLadderRecord(),
			{ type: "buy-commodity", commodity: "Food" },
			before,
			after,
		);
		expect(next.basis.Food).toEqual({ units: 10, cr: 100 });
		expect(next.banked.trade).toBe(0);
	});

	test("a sale banks its margin at once, and the v6 units go first", () => {
		const bought = ladderAfterMarket(
			emptyLadderRecord(),
			{ type: "buy-commodity", commodity: "Food" },
			before,
			{ credits: 900, cargo: { Food: 14 } },
		);
		// 4 t with no basis, then 2 of the 10 bought at 10 Cr each.
		const sold = ladderAfterMarket(
			bought,
			{ type: "sell-commodity", commodity: "Food" },
			{ credits: 900, cargo: { Food: 14 } },
			{ credits: 990, cargo: { Food: 8 } },
		);
		expect(sold.banked.trade).toBeCloseTo(2 * 15 - 2 * 10, 9);
		expect(sold.basis.Food).toEqual({ units: 8, cr: 80 });
	});

	test("a sale after an unreconciled loss prices against the goods still aboard", () => {
		// 10 bought at 10 Cr, 6 gone off the till with the line left stale, 4
		// sold at 15. The margin is the same either way (the average holds); what the
		// reconcile changes is the line left behind, which without it would still
		// price 6 units that are gone against the next goods of that name.
		const record: LadderRecord = {
			...emptyLadderRecord(),
			basis: { Food: { units: 10, cr: 100 } },
		};
		const sold = ladderAfterMarket(
			record,
			{ type: "sell-commodity", commodity: "Food" },
			{ credits: 0, cargo: { Food: 4 } },
			{ credits: 60, cargo: {} },
		);
		expect(sold.banked.trade).toBeCloseTo(60 - 40, 9);
		expect(sold.basis.Food).toBeUndefined();
	});

	test("anything else leaves the record as it was", () => {
		const record = emptyLadderRecord();
		expect(
			ladderAfterMarket(record, { type: "buy-fuel" }, before, {
				...before,
				credits: 990,
			}),
		).toBe(record);
	});
});

describe("a job settlement (#183 D3)", () => {
	test("banks its pay and drops the basis of goods it took", () => {
		const record: LadderRecord = {
			...emptyLadderRecord(),
			basis: { Food: { units: 10, cr: 100 } },
		};
		const next = ladderAfterSettlement(record, 250, { Food: 4 });
		expect(next.banked.trade).toBe(250);
		expect(next.basis.Food).toEqual({ units: 4, cr: 40 });
	});
});

describe("the capstone on a docked sale (#183 D8)", () => {
	test("a sale that completes the tops records it at that sale's time", () => {
		const nearTop: LadderRecord = {
			...emptyLadderRecord(),
			banked: {
				combat: LADDER_TOP.combat,
				trade: LADDER_TOP.trade - 1,
				exploration: LADDER_TOP.exploration,
			},
		};
		expect(withCapstone(nearTop, 10).capstoneAt).toBeNull();
		const sold = withCapstone(bankTrade(nearTop, 5), 42);
		expect(sold.capstoneAt).toBe(42);
		expect(withCapstone(sold, 99).capstoneAt).toBe(42);
	});
});

describe("#654 — the ladder record a death restores", () => {
	test("the last dock's record, with the play log flown up to the death (#581)", () => {
		const dock: LadderRecord = {
			...emptyLadderRecord(),
			banked: { combat: 3, trade: 5, exploration: 7 },
			playedS: 1200,
		};
		const dying: LadderRecord = {
			...emptyLadderRecord(),
			banked: { combat: 9, trade: 9, exploration: 9 },
			playedS: 1800,
		};
		const after = ladderAfterDeath(dock, dying);
		expect(after).toEqual({ ...dock, playedS: 1800 });
	});
});
