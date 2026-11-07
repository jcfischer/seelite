import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { money, signedMoney } from "../src/exact-amount";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import {
	analyzeBatch,
	advanceCandidateQueue,
	candidateInventory,
	productBidAt,
	recipeFor,
} from "../scripts/measure-mining-economy";

const batch = {
	family: "platinum" as const,
	grade: "poor" as const,
	inputT: 4,
	purchaseCrPerT: 10,
	rawBidCrPerT: 15,
	feeCrPerT: 2,
	productBidCrPerNativeUnit: 100,
	freeHoldT: 0,
	collectUnits: 1,
};

test("approved recipes conserve input mass and preserve native units", () => {
	const approved = [
		["silicate", [200000, 400000, 800000]],
		["metallic", [200000, 400000, 800000]],
		["gold", [500, 1000, 2000]],
		["platinum", [250, 500, 1000]],
		["gem", [5, 10, 20]],
	] as const;
	for (const [family, grams] of approved)
		for (const [index, grade] of (
			["poor", "standard", "rich"] as const
		).entries()) {
			const recipe = recipeFor(family, grade);
			expect(recipe.yieldGPerT).toBe(grams[index]);
			const r = analyzeBatch({
				...batch,
				family,
				grade,
				freeHoldT: 100,
				collectUnits: 0,
			});
			expect(r.productG + r.tailingsG).toBe(4_000_000);
			expect(r.productG).toBe(4 * grams[index]);
		}
	expect(recipeFor("platinum", "poor")).toMatchObject({
		yieldGPerT: 250,
		nativeUnitG: 1000,
	});
	expect(recipeFor("gem", "rich")).toMatchObject({
		yieldGPerT: 20,
		nativeUnitG: 1,
	});
});

test("raw versus refined cash uses exact costs without counting uncollected custody as cash", () => {
	const r = analyzeBatch(batch);
	expect(r.rawCashDelta).toBe(signedMoney.fromNumber(20));
	expect(r.refinedCashDelta).toBe(signedMoney.fromNumber(52));
	expect(r.collectedG).toBe(1000);
	expect(r.custodyG).toBe(0);
	expect(r.carriedBasis).toBe(money.fromNumber(48));
	expect(r.custodyBasis).toBe(money.fromNumber(0));
	const partial = analyzeBatch({ ...batch, inputT: 3, collectUnits: 0 });
	expect(partial.refinedCashDelta).toBe(signedMoney.fromNumber(-36));
	expect(partial.custodyG).toBe(750);
	expect(partial.custodyBasis).toBe(money.fromNumber(36));
});

test("collection never rounds fractions up and tonne products need real hold space", () => {
	expect(() => analyzeBatch({ ...batch, inputT: 1 })).toThrow("collection");
	expect(() =>
		analyzeBatch({ ...batch, family: "silicate", grade: "rich", freeHoldT: 0 }),
	).toThrow("capacity");
	const partial = analyzeBatch({
		...batch,
		family: "silicate",
		grade: "rich",
		freeHoldT: 1,
	});
	expect(partial.collectedG).toBe(1_000_000);
	expect(partial.custodyG).toBe(2_200_000);
	expect(partial.carriedBasis + partial.custodyBasis).toBe(
		money.fromNumber(48),
	);
});

test("partitioned input preserves exact material and committed costs", () => {
	const all = analyzeBatch({ ...batch, inputT: 8, collectUnits: 2 });
	const halves = [analyzeBatch(batch), analyzeBatch(batch)];
	expect(halves.reduce((s, r) => s + r.productG, 0)).toBe(all.productG);
	expect(halves.reduce((s, r) => s + r.committedCost, 0n)).toBe(
		all.committedCost,
	);
	expect(halves.reduce((s, r) => s + r.refinedCashDelta, 0n)).toBe(
		all.refinedCashDelta,
	);
});

test("queue uses approved outage service seconds and never banks idle service", () => {
	const anchor = {
		seed: 0,
		government: 0,
		active: 0,
		total: 0,
		at: 0,
		cycle: 0,
		phase: "down",
		left: 900,
		repaired: false,
	};
	const r = advanceCandidateQueue({
		anchor,
		fromS: 0,
		toS: 1200,
		workS: [200, 200],
	});
	expect(r.serviceS).toBe(300);
	expect(r.remainingWorkS).toEqual([0, 100]);
	const first = advanceCandidateQueue({
		anchor,
		fromS: 0,
		toS: 1000,
		workS: [200, 200],
	});
	const later = advanceCandidateQueue({
		anchor,
		fromS: 1000,
		toS: 1200,
		workS: first.remainingWorkS,
	});
	expect(later.remainingWorkS).toEqual(r.remainingWorkS);
	const submittedLater = advanceCandidateQueue({
		anchor,
		fromS: 1100,
		toS: 1200,
		workS: [200],
	});
	expect(submittedLater.remainingWorkS).toEqual([100]);
	expect(
		advanceCandidateQueue({ anchor, fromS: 0, toS: 1200, workS: [] })
			.remainingWorkS,
	).toEqual([]);
});

test("malformed units, identity, prices and unsafe quantities refuse before reporting", () => {
	for (const patch of [
		{ inputT: 1.5 },
		{ inputT: Number.MAX_SAFE_INTEGER },
		{ purchaseCrPerT: NaN },
		{ rawBidCrPerT: Infinity },
		{ feeCrPerT: -1 },
		{ collectUnits: 1.1 },
		{ freeHoldT: -1 },
		{ family: "water" },
		{ grade: "pure" },
	])
		expect(() =>
			analyzeBatch({ ...batch, ...patch } as typeof batch),
		).toThrow();
	expect(() =>
		advanceCandidateQueue({ anchor: {}, fromS: 0, toS: 1, workS: [1] }),
	).toThrow();
	expect(() =>
		advanceCandidateQueue({
			anchor: {
				seed: 0,
				government: 0,
				active: 0,
				total: 0,
				at: 0,
				cycle: 0,
				phase: "down",
				left: 900,
				repaired: false,
			},
			fromS: 0,
			toS: 1,
			workS: [NaN],
		}),
	).toThrow();
	expect(() =>
		productBidAt(
			{
				seed: NaN,
				galaxy: 0,
				system: 0,
				stationId: "missing",
				gameTimeS: 0,
				holdT: 20,
				deficit: 0,
			},
			"Gold",
		),
	).toThrow();
});

test("input audit distinguishes available contracts from absent raw price and stock candidates", () => {
	const inventory = candidateInventory();
	expect(inventory.status).toBe("incomplete");
	expect(inventory.missingInputs).toContain(
		"raw-ore price and generated-stock candidate model",
	);
	expect(inventory.refineryDemonstration).toEqual({
		feeCrPerT: 10,
		operationalSecondsPerT: 60,
		approvedBalance: false,
	});
});

test("generated product bids keep current market venue gates and stock-memory sensitivity", () => {
	const records = generateGalaxy(47, 0).systems;
	const record = records.find((r) =>
		generateContents(r).stations.some((s) => s.type === "trade"),
	)!;
	const station = generateContents(record).stations.find(
		(s) => s.type === "trade",
	)!;
	const fixture = {
		seed: 47,
		galaxy: 0,
		system: record.index,
		stationId: station.id,
		gameTimeS: 0,
		holdT: 20,
		deficit: 0,
	};
	const bid = productBidAt(fixture, "Gold");
	expect(bid).toBeGreaterThan(0);
	expect(productBidAt({ ...fixture, deficit: 40 }, "Gold")).toBeGreaterThan(
		bid,
	);
	const outpostRecord = records.find((r) =>
		generateContents(r).stations.some((s) => s.type === "outpost"),
	)!;
	expect(outpostRecord).toBeDefined();
	const outpost = generateContents(outpostRecord).stations.find(
		(s) => s.type === "outpost",
	)!;
	expect(() =>
		productBidAt(
			{ ...fixture, system: outpostRecord.index, stationId: outpost.id },
			"Gold",
		),
	).toThrow("unsupported station");
});

test("the CLI labels fixture output incomplete and refuses an unprovenanced candidate", () => {
	const dir = mkdtempSync(join(tmpdir(), "mining922-test-"));
	const path = join(dir, "candidate.json");
	try {
		const invoke = () =>
			spawnSync(
				process.execPath,
				["scripts/measure-mining-economy.ts", "--batch", path],
				{ encoding: "utf8" },
			);
		writeFileSync(
			path,
			JSON.stringify({
				kind: "fixture",
				provenance: "test numbers only",
				batch,
			}),
		);
		const good = invoke();
		expect(good.status).toBe(0);
		const report = JSON.parse(good.stdout);
		expect(report.status).toBe("incomplete");
		expect(report.kind).toBe("fixture");
		expect(signedMoney.parse(report.batch.refinedCashDelta)).toBe(
			signedMoney.fromNumber(52),
		);
		expect(report.limitations.length).toBeGreaterThan(0);
		writeFileSync(path, JSON.stringify({ kind: "candidate", batch }));
		const bad = invoke();
		expect(bad.status).not.toBe(0);
		expect(bad.stdout).toBe("");
		expect(bad.stderr).toContain("explicit provenance");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
