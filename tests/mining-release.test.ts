/**
 * Node #1197: the mining release.
 *
 * 1. Every shipped mining figure is the value node #923 ratified.
 * 2. A mined tonne refined and sold reconciles credits, trading rating and cost
 *    basis through #935's accounting.
 * 3. A save from before the release loads and plays on with nothing lost.
 * 4. No `?mining` gate or stale `MINING_ON` remains anywhere in the source.
 *
 * https://github.com/jcfischer/seelite/issues/1197
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { carrierKey } from "../src/carrier-key";
import {
	accountOf,
	displayAmount,
	emptyAccount,
	withAccount,
} from "../src/commodity-pools";
import { RECOVERY_T_PER_H, SURVEY_LIFETIME_H } from "../src/deposit-state";
import { money } from "../src/exact-amount";
import { systemAt } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { emptyLadderRecord, ladderAfterMarket, TOP_RUNGS } from "../src/ladder";
import { recordTrade } from "../src/deficits";
import { marketStationOf } from "../src/market";
import { makeModule, moduleRow } from "../src/loadout";
import { oreShare } from "../src/rock-extraction";
import { DRILL } from "../src/rock-drill";
import { SURVEY } from "../src/rock-survey";
import {
	RAW_ELASTICITY_SCALE,
	RAW_STOCK_MAX_T,
	RAW_STOCK_MIN_T,
	RAW_VALUE_SHARE,
} from "../src/ore-goods";
import {
	REFINERY_FEE_PERCENT,
	REFINERY_SECONDS_PER_TONNE,
	settleRefineryQueue,
} from "../src/refinery";
import {
	collectRefineryEnvelope,
	refineryQuoteAt,
	submitRefineryEnvelope,
} from "../src/refinery-pricing";
import {
	type ConsoleInput,
	newCommander,
	scoopCargo,
	transactAtStation,
} from "../src/station-commerce";
import { generateContents } from "../src/system";
import { newWorld, withRefineryQueue } from "../src/world-state";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { pairLegacyWorldFixture } from "./legacy-world-fixture";
import { fnv1a } from "../src/rng";

const SEED = 47;
const GALAXY = 0;
const ORE = "Silicate ore STD";
const PRODUCT = "Minerals";

const refineryHere = () => {
	for (let index = 0; index < 256; index++) {
		const station = generateContents(
			systemAt(SEED, GALAXY, index),
		).stations.find((s) => s.type === "refinery");
		if (station)
			return {
				index,
				key: carrierKey(index, station.localCarrierId),
				station,
			};
	}
	throw new Error("the seed has no refinery");
};

describe("the ratified table is what ships (#923)", () => {
	test("recovery, survey lifetime, the fee and throughput", () => {
		expect(RECOVERY_T_PER_H).toBe(10);
		expect(SURVEY_LIFETIME_H).toBe(24);
		expect(REFINERY_FEE_PERCENT).toBe(35n);
		expect(REFINERY_SECONDS_PER_TONNE).toBe(1);
		expect(RAW_VALUE_SHARE).toBe(0.35);
		expect(RAW_ELASTICITY_SCALE).toBe(0.5);
		expect(RAW_STOCK_MIN_T).toBe(8);
		expect(RAW_STOCK_MAX_T).toBe(63);
	});

	test("the drill, the Mining Laser's cut and the Longwall's skips", () => {
		expect(DRILL.rateTPerS).toBe(37.5);
		expect(DRILL.energyPerS).toBe(6);
		expect(DRILL.heatPerS).toBe(2.5);
		expect(oreShare("E")).toBe(0.5);
		expect(oreShare("D")).toBe(0.4);
		expect(oreShare("A")).toBe(0.75);
		const laser = makeModule("mining-laser", 1, "E");
		expect(moduleRow(laser).output.extractionTPerS).toBe(0.1);
		expect(HULL_SPECS.miner.oreHoldT).toBe(3000);
		expect(SURVEY.dwellS).toBe(4);
	});
});

describe("a mined, refined and sold tonne reconciles (#935)", () => {
	const minedCommander = (tonnes: number) => {
		const base = {
			...newCommander("courier"),
			accounting: emptyAccount(10_000),
		};
		const scooped = scoopCargo(base, ORE, tonnes, 0);
		if (!scooped.accepted) throw new Error("the ore does not fit");
		return scooped.commander;
	};

	const run = () => {
		const { key } = refineryHere();
		const at = 0;
		const world = newWorld(SEED);
		const commander = {
			...newCommanderRecord("courier"),
			state: minedCommander(10),
		};
		const mined = accountOf(commander.state);
		expect(displayAmount(mined.basis[ORE]?.cost ?? money.fromNumber(0))).toBe(
			0,
		);
		const quote = refineryQuoteAt({ world, commander }, GALAXY, key, ORE, 10);
		if (!quote.ok) throw new Error(quote.sentence);
		const submitted = submitRefineryEnvelope(
			{ world, commander },
			GALAXY,
			quote.quote,
		);
		if (!submitted.ok) throw new Error(submitted.sentence);
		const paid = submitted.envelope.commander.state;
		const queue = submitted.envelope.world.galaxies[GALAXY].refineries[key];
		const settled = withRefineryQueue(
			submitted.envelope.world,
			GALAXY,
			key,
			settleRefineryQueue(queue, 1e6, at + 1e6),
		);
		const collected = collectRefineryEnvelope(
			{ world: settled, commander: submitted.envelope.commander },
			GALAXY,
			key,
			PRODUCT,
		);
		if (!collected.ok) throw new Error(collected.sentence);
		const held = collected.envelope.commander.state;
		const { station } = refineryHere();
		const before: ConsoleInput & {
			action: { type: "sell-commodity"; commodity: string; quantity: number };
		} = {
			commander: held,
			station: marketStationOf(station, SEED),
			stationKey: key,
			deficits: recordTrade(settled.galaxies[GALAXY].deficits, key, {
				goodName: PRODUCT,
				units: 40,
				gameTimeMin: 0,
				holdT: 40,
			}),
			economy: systemAt(SEED, GALAXY, refineryHere().index).economy,
			gameTimeMin: 0,
			displayTL: 12,
			entrustedT: 0,
			rungs: TOP_RUNGS,
			hullReach: () => ({ ok: true as const, systems: 1 }),
			action: {
				type: "sell-commodity",
				commodity: PRODUCT,
				quantity: held.cargo[PRODUCT] ?? 0,
			},
		};
		const sold = transactAtStation(before);
		if (!sold.accepted) throw new Error(sold.reason as string);
		const ladder = ladderAfterMarket(
			emptyLadderRecord(),
			before.action,
			held,
			sold.commander,
		);
		return {
			quote: quote.quote,
			mined,
			paid,
			held,
			sold,
			ladder,
			after: sold.commander.cargo,
		};
	};

	test("the fee leaves the wallet and the ore leaves the hold for the queue", () => {
		const { quote, mined, paid, held } = run();
		expect(
			displayAmount(accountOf(paid).cash) - displayAmount(mined.cash),
		).toBeCloseTo(-displayAmount(money.parse(quote.fee)), 6);
		expect(paid.cargo[ORE]).toBeUndefined();
		expect(held.cargo[PRODUCT]).toBeGreaterThan(0);
		expect(money.parse(quote.fee) > money.fromNumber(0)).toBe(true);
	});

	test("credits, cost basis and trading rating follow #935's recovery rule", () => {
		const { quote, paid, held, sold, ladder } = run();
		const proceeds = sold.commander.credits - held.credits;
		expect(proceeds).toBeGreaterThan(0);
		const fee = displayAmount(money.parse(quote.fee));
		const recovered = Math.min(fee, proceeds);
		const account = accountOf(sold.commander);
		expect(displayAmount(account.basis[PRODUCT].cost)).toBe(0);
		expect(displayAmount(account.pools[PRODUCT].unrecoveredCost)).toBeCloseTo(
			fee - recovered,
			6,
		);
		expect(displayAmount(account.bankedTrade)).toBeCloseTo(
			proceeds - recovered,
			6,
		);
		expect(ladder.banked.trade).toBeCloseTo(proceeds - recovered, 6);
		expect(
			displayAmount(accountOf(paid).pools[PRODUCT].unrecoveredCost),
		).toBeCloseTo(fee, 6);
	});
});

describe("a save from before the release plays on", () => {
	test("loads with nothing lost and no ore, jobs or discovery", () => {
		const raw = serializeSave({
			world: newWorld(SEED),
			commander: {
				...newCommanderRecord("courier"),
				state: { ...newCommander("courier"), cargo: { Food: 3 } },
			},
		});
		const legacy = {
			...raw,
			saveSchemaVersion: 20,
			world: { ...(raw.world as Record<string, unknown>) },
		} as any;
		pairLegacyWorldFixture(legacy);
		const { integrity: _integrity, ...body } = legacy;
		const loaded = parseSave({
			...body,
			integrity: fnv1a(JSON.stringify(body)),
		});
		expect(loaded.commander.state.cargo).toEqual({ Food: 3 });
		expect(loaded.commander.state.credits).toBe(
			newCommander("courier").credits,
		);
		expect(loaded.commander.requests.byId).toEqual({});
		for (const galaxy of loaded.world.galaxies)
			expect(Object.keys(galaxy.refineries)).toEqual([]);
		expect(
			loaded.world.galaxies.some(
				(galaxy) => (galaxy.fieldDiscoveries ?? []).length > 0,
			),
		).toBe(false);
	});
});

describe("the flag is gone from the source", () => {
	const srcDir = new URL("../src/", import.meta.url);
	const files = readdirSync(srcDir, { recursive: true })
		.map((entry) => String(entry))
		.filter((entry) => entry.endsWith(".ts"))
		.map((entry) => new URL(entry, srcDir));

	test("the scan covers every source file", () => {
		expect(files.length).toBeGreaterThan(100);
		expect(files.some((file) => file.pathname.endsWith("/main.ts"))).toBe(true);
	});

	test("no MINING_ON and no ?mining read remains", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(source).not.toContain("MINING_ON");
			expect(source).not.toContain('get("mining")');
			expect(source).not.toContain("rock-pick");
			expect(source).not.toContain("survey-interrupt");
		}
	});
});
