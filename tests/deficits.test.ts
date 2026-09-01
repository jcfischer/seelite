/**
 * `economy-trade.md` §5.5: the deficit map, in the module that now owns it.
 *
 * These tests were `market-state.test.ts`'s §5.5 half until node
 * [#67](https://github.com/jcfischer/seelite/issues/67) moved the map out of
 * the pricing module. They moved with it unchanged in substance — a refactor
 * that rewrites its own tests cannot show that behaviour survived — and the
 * two structural tests at the bottom are the only new claims: that `market.ts`
 * carries no save format any more, and that the split did not close a cycle.
 *
 * `market-state.test.ts` keeps §5.1's derivability claim and §2's identity
 * table, which are about the base market rather than about the player's mark
 * on it.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { type CarrierKey, carrierKey } from "../src/carrier-key";
import {
	DEFICIT_DROP_UNITS,
	type DeficitMap,
	parseDeficits,
	pruneDeficits,
	readDeficit,
	recordTrade,
} from "../src/deficits";
import { generateGalaxy } from "../src/galaxy";
import { COMMODITIES, DEFICIT_HALF_LIFE_MIN, DEFICIT_MAX } from "../src/market";
import { LOCAL_CARRIER_ID } from "../src/station";
import { generateContents } from "../src/system";
import { codeOf, repoPath } from "./lib/source-scan";

const WORLD = 0x5ee11e;

/** The same eighty-system slice `market-state.test.ts` uses, for the same
 *  reason: sized by the stations it yields rather than by the system count. */
const SYSTEMS = generateGalaxy(WORLD, 0).systems.slice(0, 80);

describe("§5.5 the deficit map is sparse, lazy, and round-trips", () => {
	const KEY = carrierKey(412, LOCAL_CARRIER_ID.trade);
	const FOOD = "Food";

	test("an untouched station reads zero and costs nothing", () => {
		const map: DeficitMap = {};
		expect(readDeficit(map, KEY, FOOD, 0)).toBe(0);
		expect(Object.keys(map).length).toBe(0);
	});

	test("buying adds, selling subtracts", () => {
		const bought = recordTrade({}, KEY, FOOD, 20, 100);
		expect(readDeficit(bought, KEY, FOOD, 100)).toBeCloseTo(20, 10);
		const sold = recordTrade({}, KEY, FOOD, -20, 100);
		expect(readDeficit(sold, KEY, FOOD, 100)).toBeCloseTo(-20, 10);
	});

	test("the mark halves over one half-life, on read and not on a tick", () => {
		const map = recordTrade({}, KEY, FOOD, 40, 0);
		expect(readDeficit(map, KEY, FOOD, DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(
			20,
			10,
		);
		expect(readDeficit(map, KEY, FOOD, 2 * DEFICIT_HALF_LIFE_MIN)).toBeCloseTo(
			10,
			10,
		);
		// Nothing was written by reading it — the stored row still says 40.
		expect(map[KEY].goods[FOOD]).toBeCloseTo(40, 10);
	});

	test("it saturates at the cap rather than running away", () => {
		let map: DeficitMap = {};
		for (let i = 0; i < 20; i++) map = recordTrade(map, KEY, FOOD, 63, 0);
		expect(readDeficit(map, KEY, FOOD, 0)).toBe(DEFICIT_MAX);
		for (let i = 0; i < 40; i++) map = recordTrade(map, KEY, FOOD, -63, 0);
		expect(readDeficit(map, KEY, FOOD, 0)).toBe(-DEFICIT_MAX);
	});

	test("a mark under one unit reads as nothing", () => {
		const map = recordTrade({}, KEY, FOOD, 20, 0);
		// 20 → under 1 unit after log2(20) half-lives.
		const faded = DEFICIT_HALF_LIFE_MIN * (Math.log2(20) + 0.01);
		expect(Math.abs(readDeficit(map, KEY, FOOD, faded))).toBe(0);
	});

	test("a faded row is dropped, so the save does not grow forever", () => {
		let map = recordTrade({}, KEY, FOOD, 20, 0);
		map = recordTrade(
			map,
			carrierKey(9, LOCAL_CARRIER_ID.refinery),
			"Furs",
			5,
			0,
		);
		expect(Object.keys(map).length).toBe(2);
		const pruned = pruneDeficits(map, DEFICIT_HALF_LIFE_MIN * 8);
		expect(Object.keys(pruned).length).toBe(0);
	});

	test("a trade that cancels itself leaves no row at all", () => {
		let map = recordTrade({}, KEY, FOOD, 20, 0);
		map = recordTrade(map, KEY, FOOD, -20, 0);
		expect(map[KEY]).toBeUndefined();
	});

	test("the same carrier id in two systems is two rows", () => {
		let map = recordTrade(
			{},
			carrierKey(1, LOCAL_CARRIER_ID.trade),
			FOOD,
			20,
			0,
		);
		map = recordTrade(map, carrierKey(2, LOCAL_CARRIER_ID.trade), FOOD, -20, 0);
		expect(Object.keys(map).length).toBe(2);
		expect(
			readDeficit(map, carrierKey(1, LOCAL_CARRIER_ID.trade), FOOD, 0),
		).toBeCloseTo(20, 10);
		expect(
			readDeficit(map, carrierKey(2, LOCAL_CARRIER_ID.trade), FOOD, 0),
		).toBeCloseTo(-20, 10);
	});

	test("a full map survives JSON and reads back identically", () => {
		let map: DeficitMap = {};
		let t = 0;
		for (const [i, record] of SYSTEMS.slice(0, 40).entries())
			for (const s of generateContents(record).stations) {
				t += 7;
				map = recordTrade(
					map,
					carrierKey(i, s.localCarrierId),
					COMMODITIES[i % COMMODITIES.length].name,
					i % 2 === 0 ? 20 : -13,
					t,
				);
			}
		// **Pinned, not bounded.** `economy-trade.md` §10.3 quotes this corpus as
		// a 61-row map. A `>` threshold would leave a generator change that thins
		// the corpus green and the spec silently wrong; an equality is what makes
		// the prose checkable.
		expect(Object.keys(map).length).toBe(61);

		const back = parseDeficits(JSON.parse(JSON.stringify(map)));
		expect(back).toEqual(map);
		const at = t + 5;
		for (const key of Object.keys(map) as CarrierKey[])
			for (const good of Object.keys(map[key].goods))
				expect(readDeficit(back, key, good, at)).toBe(
					readDeficit(map, key, good, at),
				);
	});

	test("a pruned map round-trips to the same readings as the original", () => {
		let map = recordTrade({}, KEY, FOOD, 63, 0);
		map = recordTrade(map, KEY, "Furs", -40, 0);
		const at = DEFICIT_HALF_LIFE_MIN * 2;
		const pruned = parseDeficits(
			JSON.parse(JSON.stringify(pruneDeficits(map, at))),
		);
		for (const good of [FOOD, "Furs"])
			expect(readDeficit(pruned, KEY, good, at)).toBeCloseTo(
				readDeficit(map, KEY, good, at),
				10,
			);
	});

	test("a malformed save fails loudly rather than reading as untouched", () => {
		expect(() => parseDeficits(null)).toThrow();
		expect(() => parseDeficits([])).toThrow();
		expect(() => parseDeficits({ [KEY]: 3 })).toThrow();
		expect(() => parseDeficits({ [KEY]: { goods: {} } })).toThrow();
		expect(() =>
			parseDeficits({ [KEY]: { goods: {}, updatedAt: "soon" } }),
		).toThrow();
		expect(() =>
			parseDeficits({ [KEY]: { goods: { Food: "lots" }, updatedAt: 0 } }),
		).toThrow();
		expect(() =>
			parseDeficits({ [KEY]: { goods: { Food: Number.NaN }, updatedAt: 0 } }),
		).toThrow();
	});

	test("the drop rule is one unit, and it is the same one everywhere", () => {
		expect(DEFICIT_DROP_UNITS).toBe(1);
		const map = recordTrade({}, KEY, FOOD, DEFICIT_DROP_UNITS / 2, 0);
		expect(map[KEY]).toBeUndefined();
	});
});

describe("#67 the split the deficit map out of the pricing module", () => {
	test("the pricing module names no part of the save format", () => {
		// The whole of the node. `market.ts` said in a comment that §5.5 was
		// save-format concern lodged in a pricing module; this is that comment
		// turned into something that can go red. It is a source scan and not an
		// import check because a re-export would satisfy an import check while
		// leaving the pricing module the place these names are read from — the
		// two-import-paths-to-one-identity failure `carrier-key.ts` was extracted
		// to end.
		const market = codeOf("src/market.ts");
		for (const name of [
			"DeficitMap",
			"DeficitRow",
			"DEFICIT_DROP_UNITS",
			"readDeficit",
			"recordTrade",
			"pruneDeficits",
			"parseDeficits",
		])
			expect(market, name).not.toContain(name);
	});

	test("the pricing module does not import the save module back", () => {
		// The direction is the result, not an accident of where things landed.
		// §5.2's decay and its cap are read by `stockResponse`, `shelfQuantity`
		// and `MIN_STOCK_RESPONSE_FACTOR` — three price-response call sites that
		// never touch a `DeficitMap` — so they stayed, and `deficits.ts` imports
		// them. Reversing that would make the pricing module depend on the save
		// format again, and because `DEFICIT_MAX` is `QUANTITY_CAP`, it would
		// close a cycle rather than move a dependency.
		expect(codeOf("src/market.ts")).not.toContain("./deficits");
		expect(codeOf("src/deficits.ts")).toContain('from "./market"');
	});

	test("the half-life, the cap and the drop rule are each declared once", () => {
		// A split's standing hazard is a second copy: `deficits.ts` needs the
		// half-life and the cap, and declaring them locally rather than importing
		// them would let the map decay on one figure while the price responds to
		// another. Scanned over `src/` rather than over the two files, so a third
		// module that grows its own copy is caught too.
		const declaredIn = (name: string) =>
			readdirSync(repoPath("src"))
				.filter((f) => f.endsWith(".ts"))
				.filter((f) =>
					new RegExp(`(?:const|let|var)\\s+${name}\\b`).test(
						codeOf(`src/${f}`),
					),
				);
		expect(declaredIn("DEFICIT_HALF_LIFE_MIN")).toEqual(["market.ts"]);
		expect(declaredIn("DEFICIT_MAX")).toEqual(["market.ts"]);
		expect(declaredIn("DEFICIT_DROP_UNITS")).toEqual(["deficits.ts"]);
	});
});
