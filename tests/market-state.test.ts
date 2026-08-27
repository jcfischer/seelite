/**
 * §5 of `economy-trade.md`: the clock, and the memory of you.
 *
 * `market.test.ts` owns §2–§4 and §6–§7 — the arithmetic, swept over its whole
 * domain. This file owns the two properties node
 * [#25](https://github.com/jcfischer/seelite/issues/25) was told it owed
 * beyond the spec's own suite (§10.3): that the **base market is derivable**
 * from `(stationSeed, epoch)` and from nothing else, and that the **deficit map
 * survives a save round trip** with its lazy decay and its drop rule intact.
 *
 * They are separated from the arithmetic because they are the two claims that
 * are not about a formula. The first is about which stream a number comes out
 * of, and the second is about the one piece of world state seelite cannot
 * regenerate from a seed (§12 weak joint 6).
 */

import { describe, expect, test } from "bun:test";
import { DOMAIN } from "../src/domains";
import { generateGalaxy, systemSeedFor } from "../src/galaxy";
import {
	COMMODITIES,
	DEFICIT_DROP_UNITS,
	DEFICIT_HALF_LIFE_MIN,
	DEFICIT_MAX,
	type DeficitMap,
	MARKET_PERIOD_MIN,
	type MarketStation,
	carrierKey,
	commodity,
	marketEpoch,
	marketPhaseMin,
	marketRow,
	marketRowAt,
	marketSeedFor,
	parseDeficits,
	pruneDeficits,
	readDeficit,
	recordTrade,
	stationFluct,
} from "../src/market";
import { LOCAL_CARRIER_ID, type StationType } from "../src/station";
import { generateContents } from "../src/system";
import { codeOf } from "./lib/source-scan";

const WORLD = 0x5ee11e;

/**
 * The first eighty systems of galaxy 0, generated once for the whole file.
 *
 * Sized by the **stations** it yields, not by the system count: about three
 * systems in four hold two or three, so eighty systems is a **117-station**
 * corpus. A forty-system slice gave 61, which is thin for a rate asserted at
 * 95%.
 */
const SYSTEMS = generateGalaxy(WORLD, 0).systems.slice(0, 80);

const stationsOf = (index: number) => {
	const record = SYSTEMS[index];
	return { record, stations: generateContents(record).stations };
};

const marketStation = (
	systemSeed: number,
	type: StationType,
	localCarrierId: string,
): MarketStation => ({
	// `outpost` has no type offset (`TYPE_OFFSET` is §3's three), and
	// `system.ts` generates none — asserted below rather than assumed here.
	type: type as MarketStation["type"],
	seed: marketSeedFor(systemSeed, localCarrierId),
});

describe("§2 the persistence identity is a table, not a display key", () => {
	test("every station type has a carrier id, and they are distinct", () => {
		const ids = Object.values(LOCAL_CARRIER_ID);
		expect(ids.length).toBe(new Set(ids).size);
		for (const id of ids) expect(id.length).toBeGreaterThan(0);
	});

	test("every generated station carries the table's id for its type", () => {
		let seen = 0;
		for (const record of SYSTEMS)
			for (const station of generateContents(record).stations) {
				expect(station.localCarrierId).toBe(LOCAL_CARRIER_ID[station.type]);
				// The market's `TYPE_OFFSET` covers §3's three types only, so a
				// generated outpost would price at no offset at all. None exist
				// today; this is the assertion that says so out loud.
				expect(station.type).not.toBe("outpost");
				seen++;
			}
		expect(seen).toBeGreaterThan(100);
	});
});

describe("§5.1 the base market is f(stationSeed, epoch)", () => {
	test("the fluctuation byte is a byte, and every value is reachable", () => {
		// Re-calling `stationFluct` with the same arguments and expecting the same
		// answer was the first version of this, and it cannot go red for any
		// implementation of a pure function — the same unfalsifiability the
		// permutation test below was thrown out for. What can fail is the *range*
		// and its coverage: a hash that returned `x & 0x0f`, or one that skipped
		// the top of the byte, passes a fixity check and fails this.
		const seen = new Set<number>();
		for (const record of SYSTEMS)
			for (let epoch = 0; epoch < 64; epoch++) {
				const byte = stationFluct(
					marketSeedFor(record.seed, LOCAL_CARRIER_ID.trade),
					epoch,
				);
				expect(Number.isInteger(byte)).toBe(true);
				expect(byte).toBeGreaterThanOrEqual(0);
				expect(byte).toBeLessThanOrEqual(255);
				seen.add(byte);
			}
		// 5,120 draws over 256 values: seeing under 250 of them is a hash that
		// does not use the whole byte, which is what §2's fluctuation masks read.
		expect(seen.size).toBeGreaterThan(250);
	});

	test("every good is byte-identical across one whole epoch", () => {
		const { record, stations } = stationsOf(3);
		const station = marketStation(
			record.seed,
			stations[0].type,
			stations[0].localCarrierId,
		);
		const phase = marketPhaseMin(station.seed);
		// Two moments inside the same epoch, at its two ends.
		const start = MARKET_PERIOD_MIN * 4 - phase;
		const end = start + MARKET_PERIOD_MIN - 1e-6;
		expect(marketEpoch(phase, start)).toBe(marketEpoch(phase, end));
		for (const good of COMMODITIES) {
			const a = marketRow(good, record.economy, station, start);
			const b = marketRow(good, record.economy, station, end);
			expect(b.priceCr).toBe(a.priceCr);
			expect(b.quantity).toBe(a.quantity);
		}
	});

	test("the market re-rolls on the epoch boundary, for most stations", () => {
		let changed = 0;
		let total = 0;
		for (const record of SYSTEMS)
			for (const s of generateContents(record).stations) {
				const station = marketStation(record.seed, s.type, s.localCarrierId);
				const phase = marketPhaseMin(station.seed);
				const boundary = MARKET_PERIOD_MIN * 3 - phase;
				const before = stationFluct(
					station.seed,
					marketEpoch(phase, boundary - 1e-6),
				);
				const after = stationFluct(station.seed, marketEpoch(phase, boundary));
				total++;
				if (before !== after) changed++;
			}
		// A hash collision on a byte is a 1-in-256 event, not a bug; the claim
		// that has to hold is that the byte is re-drawn, not that it always moves.
		expect(total).toBeGreaterThan(100);
		expect(changed / total).toBeGreaterThan(0.95);
	});

	test("phase staggers the stations of one system", () => {
		let systemsWithTwo = 0;
		for (const record of SYSTEMS) {
			const stations = generateContents(record).stations;
			if (stations.length < 2) continue;
			systemsWithTwo++;
			const phases = stations.map((s) =>
				marketPhaseMin(marketSeedFor(record.seed, s.localCarrierId)),
			);
			for (const p of phases) {
				expect(p).toBeGreaterThanOrEqual(0);
				expect(p).toBeLessThan(MARKET_PERIOD_MIN);
			}
			expect(new Set(phases).size).toBe(phases.length);
		}
		expect(systemsWithTwo).toBeGreaterThan(30);
	});

	test("two stations in one system get unrelated markets", () => {
		let compared = 0;
		let identical = 0;
		for (const record of SYSTEMS) {
			const stations = generateContents(record).stations;
			if (stations.length < 2) continue;
			const seeds = stations.map((s) =>
				marketSeedFor(record.seed, s.localCarrierId),
			);
			expect(new Set(seeds).size).toBe(seeds.length);
			for (let epoch = 0; epoch < 4; epoch++) {
				compared++;
				if (stationFluct(seeds[0], epoch) === stationFluct(seeds[1], epoch))
					identical++;
			}
		}
		expect(compared).toBeGreaterThan(120);
		expect(identical / compared).toBeLessThan(0.05);
	});

	test("the same carrier id in two systems gets a different market", () => {
		const a = marketSeedFor(SYSTEMS[0].seed, LOCAL_CARRIER_ID.trade);
		const b = marketSeedFor(SYSTEMS[1].seed, LOCAL_CARRIER_ID.trade);
		expect(a).not.toBe(b);
	});
});

describe("§5.1 the market is independent of draw order elsewhere", () => {
	test("nothing in the generator draws from DOMAIN.MARKET", () => {
		// **This is what makes the market order-independent**, and it is a
		// structural fact rather than an arithmetic one, so it is asserted
		// structurally. A market drawn inside `generateStations` would be a
		// function of how many stations preceded it — the exact coupling
		// `station-types.md` §5.3 gave `STATION_FLAGS` its own tag to escape,
		// and one that no value-comparing test can see, because both builds
		// produce a plausible byte.
		//
		// A permutation test was written here first and could not fail: it keyed
		// both sides on `localCarrierId`, which is the very thing under test.
		//
		// **What this proves is bounded, and the bound is worth stating.** It is
		// a source scan, so it catches a direct reference and an indexed one and
		// nothing subtler — a tag destructured under another name, or a fourth
		// file, would pass. It is evidence that the generator does not reach for
		// the market stream, not a proof that it cannot.
		for (const file of ["src/system.ts", "src/galaxy.ts"]) {
			const code = codeOf(file);
			expect(code).not.toContain("DOMAIN.MARKET");
			expect(code).not.toContain('DOMAIN["MARKET"]');
			expect(code).not.toContain("MARKET:");
		}
		// And the module that does use it reaches it exactly once, to build the
		// per-station stream root.
		const market = codeOf("src/market.ts");
		expect(market.split("DOMAIN.MARKET").length - 1).toBe(1);
	});

	test("DOMAIN.MARKET is its own tag, and adding it moved no other stream", () => {
		// A renumbered tag changes every seed in the game; a *new* tag must be
		// larger than every existing one and equal to nothing else.
		const tags: number[] = Object.values(DOMAIN);
		expect(tags.length).toBe(new Set(tags).size);
		expect(DOMAIN.MARKET as number).toBe(Math.max(...tags));
	});

	test("the market seed is a function of the system seed alone", () => {
		// Not of the galaxy walk that produced it: deriving the same system's
		// seed from its coordinates gives the same market.
		const galaxy = generateGalaxy(WORLD, 2);
		const index = 17;
		const record = galaxy.systems[index];
		const direct = systemSeedFor(WORLD, 2, galaxy.attempt, index);
		expect(direct).toBe(record.seed);
		expect(marketSeedFor(direct, LOCAL_CARRIER_ID.refinery)).toBe(
			marketSeedFor(record.seed, LOCAL_CARRIER_ID.refinery),
		);
	});

	test("the row a game shows equals the row a sweep computes", () => {
		const { record, stations } = stationsOf(5);
		const s = stations[0];
		const station = marketStation(record.seed, s.type, s.localCarrierId);
		const t = 613.5;
		const epoch = marketEpoch(marketPhaseMin(station.seed), t);
		for (const good of COMMODITIES) {
			const played = marketRow(good, record.economy, station, t);
			const swept = marketRowAt(
				good,
				record.economy,
				stationFluct(station.seed, epoch),
				station.type,
			);
			expect(played).toEqual(swept);
		}
	});
});

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
		expect(Object.keys(map).length).toBeGreaterThan(50);

		const back = parseDeficits(JSON.parse(JSON.stringify(map)));
		expect(back).toEqual(map);
		const at = t + 5;
		for (const key of Object.keys(map))
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
