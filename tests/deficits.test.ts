/**
 * `economy-trade.md` §5.5: the deficit map, in the module that now owns it.
 *
 * These tests were `market-state.test.ts`'s §5.5 half until node
 * [#67](https://github.com/jcfischer/seelite/issues/67) moved the map out of
 * the pricing module — `src/deficits.ts`'s header is where that move's history
 * is kept. They came with it unchanged in substance, because a refactor that
 * rewrites its own tests cannot show that behaviour survived, and the
 * three structural tests at the bottom are the only new claims: that
 * `market.ts` carries no save format any more, that it does not import the save
 * module back, and that the half-life, the cap and the drop rule are each
 * declared once under `src/`.
 *
 * `market-state.test.ts` keeps §5.1's derivability claim and §2's identity
 * table, which are about the base market rather than about the player's mark
 * on it.
 */

import { describe, expect, test } from "bun:test";
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
import {
	COMMODITIES,
	DEFICIT_HALF_LIFE_MIN,
	DEFICIT_MAX,
	HOLD_REFERENCE_T,
} from "../src/market";
import { LOCAL_CARRIER_ID } from "../src/station";
import { generateContents } from "../src/system";
import { codeOf, srcFiles } from "./lib/source-scan";

const WORLD = 0x5ee11e;

/** The same eighty-system slice `market-state.test.ts` uses, for the same
 *  reason: sized by the stations it yields rather than by the system count. */
const SYSTEMS = generateGalaxy(WORLD, 0).systems.slice(0, 80);

describe("§5.5 the deficit map is sparse, lazy, and round-trips", () => {
	const KEY = carrierKey(412, LOCAL_CARRIER_ID.trade);
	const FOOD = "Food";
	/** One trade at the baseline hull's hold, which is what every row here is
	 *  about. `holdT` was spelled out at sixteen call sites after #182 widened
	 *  the record, so the next field added to `TradeRecord` would have been a
	 *  fourteen-site edit. */
	const trade = (units: number, gameTimeMin: number, goodName = FOOD) => ({
		goodName,
		units,
		gameTimeMin,
		holdT: HOLD_REFERENCE_T,
	});

	test("an untouched station reads zero and costs nothing", () => {
		const map: DeficitMap = {};
		expect(readDeficit(map, KEY, FOOD, 0)).toBe(0);
		expect(Object.keys(map).length).toBe(0);
	});

	test("buying adds, selling subtracts", () => {
		const bought = recordTrade({}, KEY, trade(20, 100));
		expect(readDeficit(bought, KEY, FOOD, 100)).toBeCloseTo(20, 10);
		const sold = recordTrade({}, KEY, trade(-20, 100));
		expect(readDeficit(sold, KEY, FOOD, 100)).toBeCloseTo(-20, 10);
	});

	test("the mark halves over one half-life, on read and not on a tick", () => {
		const map = recordTrade({}, KEY, trade(40, 0));
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
		for (let i = 0; i < 20; i++) map = recordTrade(map, KEY, trade(63, 0));
		expect(readDeficit(map, KEY, FOOD, 0)).toBe(DEFICIT_MAX);
		for (let i = 0; i < 40; i++) map = recordTrade(map, KEY, trade(-63, 0));
		expect(readDeficit(map, KEY, FOOD, 0)).toBe(-DEFICIT_MAX);
	});

	test("a mark under one unit reads as nothing", () => {
		const map = recordTrade({}, KEY, trade(20, 0));
		// 20 → under 1 unit after log2(20) half-lives.
		const faded = DEFICIT_HALF_LIFE_MIN * (Math.log2(20) + 0.01);
		expect(Math.abs(readDeficit(map, KEY, FOOD, faded))).toBe(0);
	});

	test("a faded row is dropped, so the save does not grow forever", () => {
		let map = recordTrade({}, KEY, trade(20, 0));
		map = recordTrade(
			map,
			carrierKey(9, LOCAL_CARRIER_ID.refinery),
			trade(5, 0, "Furs"),
		);
		expect(Object.keys(map).length).toBe(2);
		const pruned = pruneDeficits(map, DEFICIT_HALF_LIFE_MIN * 8);
		expect(Object.keys(pruned).length).toBe(0);
	});

	test("a trade that cancels itself leaves no row at all", () => {
		let map = recordTrade({}, KEY, trade(20, 0));
		map = recordTrade(map, KEY, trade(-20, 0));
		expect(map[KEY]).toBeUndefined();
	});

	test("the same carrier id in two systems is two rows", () => {
		let map = recordTrade(
			{},
			carrierKey(1, LOCAL_CARRIER_ID.trade),
			trade(20, 0),
		);
		map = recordTrade(
			map,
			carrierKey(2, LOCAL_CARRIER_ID.trade),
			trade(-20, 0),
		);
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
					trade(
						i % 2 === 0 ? 20 : -13,
						t,
						COMMODITIES[i % COMMODITIES.length].name,
					),
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
		let map = recordTrade({}, KEY, trade(63, 0));
		map = recordTrade(map, KEY, trade(-40, 0, "Furs"));
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
		const map = recordTrade({}, KEY, trade(DEFICIT_DROP_UNITS / 2, 0));
		expect(map[KEY]).toBeUndefined();
	});
});

describe("#67 the split of the deficit map out of the pricing module", () => {
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
		// The direction is the result, not an accident of where things landed;
		// `market.ts`'s §6-§7 divider carries the argument for it, beside the
		// symbols that argument names.
		//
		// **One assertion, and the missing one is deliberate.** A first version
		// also required `deficits.ts` to import `market.ts`, which pins today's
		// answer rather than the boundary: moving §5.2's arithmetic to a leaf
		// both modules import would keep the pricing module clean and still go
		// red here. Where that arithmetic lives is the next test's business.
		expect(codeOf("src/market.ts")).not.toContain("./deficits");
	});

	test("the half-life, the cap and the drop rule are each declared once", () => {
		// A split's standing hazard is a second copy: `deficits.ts` needs the
		// half-life and the cap, and declaring them locally rather than importing
		// them would let the map decay on one figure while the price responds to
		// another.
		//
		// **It counts declarations, not files, and that is a fix.** A first
		// version asserted the file list — `toEqual(["src/market.ts"])` — which
		// measured *where* rather than *how many*. A function-scoped
		// `const DEFICIT_MAX = 63` added to `market.ts` is legal TypeScript and
		// was measured passing that form 15/0; it fails this one 14/1. Counting
		// matches is the claim the title makes.
		//
		// **Only the drop rule's location is pinned**, and the asymmetry is
		// deliberate. #67 settled that §5.5's drop rule belongs with the map;
		// where §5.2's arithmetic lives is today's answer and not a boundary, and
		// the test above refuses to pin it for exactly that reason — moving the
		// half-life and the cap to a leaf both modules import is a legitimate
		// later refactor, and two tests must not encode opposite rules for it.
		//
		// **It proves the name is declared once, not the figure.** A copy spelled
		// `const CAP = 63`, or a bare `63` inline, is invisible to it: the regex
		// matches a declaration of *this* name. That is the accident worth
		// catching — a split that re-declares the symbol it was meant to import —
		// and not a claim to have found every literal.
		//
		// Read once rather than per name: `codeOf` is uncached, and a filter per
		// name re-stripped every file in `src/` three times over. `srcFiles` is
		// recursive, so "under `src/`" stays true of a subdirectory.
		const SOURCES = srcFiles().map((f) => [f, codeOf(f)] as const);
		const declarations = (name: string) =>
			SOURCES.flatMap(([f, code]) =>
				(
					code.match(new RegExp(`(?:const|let|var)\\s+${name}\\b`, "g")) ?? []
				).map(() => f),
			);
		expect(declarations("DEFICIT_HALF_LIFE_MIN")).toHaveLength(1);
		expect(declarations("DEFICIT_MAX")).toHaveLength(1);
		expect(declarations("DEFICIT_DROP_UNITS")).toEqual(["src/deficits.ts"]);
	});
});
