/**
 * §5 of `economy-trade.md`: the clock, and the memory of you.
 *
 * `market.test.ts` owns §2–§4 and §6–§7 — the arithmetic, swept over its whole
 * domain. This file owns the first of the two properties node
 * [#25](https://github.com/jcfischer/seelite/issues/25) was told it owed
 * beyond the spec's own suite (§10.3): that the **base market is derivable**
 * from `(stationSeed, epoch)` and from nothing else. It is separated from the
 * arithmetic because it is not a claim about a formula — it is a claim about
 * which stream a number comes out of.
 *
 * **The second property left with its subject** — `tests/deficits.test.ts`
 * owns the deficit map's save round trip since #67. §2's identity table stayed
 * here, because it is about which key a *generated* station carries rather than
 * about what a save does with it.
 */

import { describe, expect, test } from "bun:test";
import { DOMAIN } from "../src/domains";
import { generateGalaxy, systemSeedFor } from "../src/galaxy";
import {
	COMMODITIES,
	commodity,
	MARKET_PERIOD_MIN,
	type MarketStation,
	marketEpoch,
	marketPhaseMin,
	marketRow,
	marketRowAt,
	marketSeedFor,
	marketStationOf,
	stationCommodities,
	stationFluct,
} from "../src/market";
import { LOCAL_CARRIER_ID } from "../src/station";
import { type Station, generateContents } from "../src/system";
import { codeOf, srcFiles } from "./lib/source-scan";

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

/** Through the shipped narrowing helper, not a hand-built struct: a test that
 *  constructs its own `MarketStation` is testing a different object from the
 *  one the game uses. */
const marketStation = (systemSeed: number, station: Station): MarketStation =>
	marketStationOf(station, systemSeed);

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
		// **Pinned, not bounded.** `economy-trade.md` §10.3 quotes this corpus as
		// 117 stations, and two figures were already invented in this node by
		// reading a `>` threshold as though it were a measurement. A threshold
		// leaves a generator change that drops the corpus to 105 green and the
		// spec silently wrong; an equality is what makes the prose checkable.
		expect(seen).toBe(117);
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
		const station = marketStation(record.seed, stations[0]);
		const phase = station.phaseMin;
		// Two moments inside the same epoch, at its two ends.
		const start = MARKET_PERIOD_MIN * 4 - phase;
		const end = start + MARKET_PERIOD_MIN - 1e-6;
		expect(marketEpoch(phase, start)).toBe(marketEpoch(phase, end));
		for (const good of stationCommodities(station)) {
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
				const station = marketStation(record.seed, s);
				const phase = station.phaseMin;
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
		// **Globbed, not listed.** A hard-coded trio was the first version and
		// then the second, each time missing a file that was concretely part of
		// generation; a `src/system-bodies.ts` added tomorrow would inherit no
		// guard at all. Every module except the market's own is scanned, so a
		// new one is covered by default rather than by somebody remembering.
		// Two files are excluded and both are the subject rather than a
		// generator: `market.ts` is the one module that *should* draw from the
		// tag, and `domains.ts` is where the tag is declared.
		// Through `srcFiles`, which is recursive. The flat scan it replaced would
		// have gone silently incomplete the day `src/` grew a subdirectory —
		// which is the direction a new module always arrives from.
		const scanned = srcFiles().filter(
			(f) => f !== "src/market.ts" && f !== "src/domains.ts",
		);
		expect(scanned.length).toBeGreaterThan(15);
		for (const file of scanned) {
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

	test("domain tags are pinned, and appended tags move no existing stream", () => {
		// **The tag values are pinned**, and the title is why. Distinctness plus
		// "MARKET is the largest" was the first version of this, and renumbering
		// `POS` from 1 to 11 alongside a larger `MARKET` passes both — so the
		// test could not go red on the thing it is named for. Every existing
		// seed's output is a function of these integers: renumbering one moves
		// every position, name and station in the game, silently.
		expect(DOMAIN).toEqual({
			POS: 1,
			NAME: 2,
			POLITY: 3,
			BODIES: 4,
			STATIONS: 5,
			DESC: 6,
			ARRIVAL: 7,
			STATION_FLAGS: 8,
			STATION_SPIN: 9,
			MARKET: 10,
			STATION_NAME: 11,
			STATION_BERTHS: 12,
			STATION_ASSEMBLY: 13,
		});
		// And a *new* tag is safe only when it is larger than every existing one,
		// which is the operation this table was designed for.
		const tags: number[] = Object.values(DOMAIN);
		expect(tags.length).toBe(new Set(tags).size);
		expect(DOMAIN.STATION_ASSEMBLY as number).toBe(Math.max(...tags));
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
		const station = marketStation(record.seed, s);
		const t = 613.5;
		const epoch = marketEpoch(station.phaseMin, t);
		for (const good of stationCommodities(station)) {
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

describe("§4 illegal goods are scoped to a fence, in the shipped module", () => {
	const ILLEGAL = ["Slaves", "Narcotics", "Firearms"];

	test("the scoped set is exactly three, and disjoint from the sub-tonne set", () => {
		const illegal = COMMODITIES.filter((c) => c.illegal).map((c) => c.name);
		expect(illegal.sort()).toEqual([...ILLEGAL].sort());
	});

	test("a fence lists the whole table; every other station lists 14 of 17", () => {
		let fences = 0;
		let plain = 0;
		for (const record of SYSTEMS)
			for (const s of generateContents(record).stations) {
				const station = marketStation(record.seed, s);
				const listed = stationCommodities(station).map((c) => c.name);
				if (s.blackMarket) {
					fences++;
					expect(listed.length).toBe(COMMODITIES.length);
				} else {
					plain++;
					expect(listed.length).toBe(COMMODITIES.length - 3);
					for (const name of ILLEGAL) expect(listed).not.toContain(name);
				}
			}
		// Both arms have to be exercised or half the rule is untested — fences
		// are rare (`station-types.md` §5.2 keys them on government).
		expect(fences).toBeGreaterThan(0);
		expect(plain).toBeGreaterThan(0);
	});

	test("pricing contraband at a non-fence throws rather than quoting a shelf", () => {
		const { record, stations } = stationsOf(3);
		const plain = stations.find((s) => !s.blackMarket);
		if (!plain) throw new Error("fixture has no non-fence station");
		const station = marketStation(record.seed, plain);
		for (const name of ILLEGAL)
			expect(() =>
				marketRow(commodity(name), record.economy, station, 100),
			).toThrow(/does not list/);
		// A legal good at the same station is unaffected — the guard is the
		// scope, not a blanket refusal.
		expect(() =>
			marketRow(commodity("Food"), record.economy, station, 100),
		).not.toThrow();
	});

	test("a fence prices all three", () => {
		const fence = SYSTEMS.flatMap((record) =>
			generateContents(record)
				.stations.filter((s) => s.blackMarket)
				.map((s) => ({ record, s })),
		)[0];
		if (!fence) throw new Error("corpus has no fence");
		const station = marketStation(fence.record.seed, fence.s);
		for (const name of ILLEGAL) {
			const row = marketRow(
				commodity(name),
				fence.record.economy,
				station,
				100,
			);
			expect(row.priceCr).toBeGreaterThan(0);
		}
	});
});
