import { capabilityIdentity, capabilitySlots } from "../src/capability-slots";
import { raiderSlots } from "../src/raider-slots";
import { carrierKey, systemIndexOfKey } from "../src/carrier-key";
import {
	initialCapabilityTime,
	queryCapabilityTime,
} from "../src/capability-time";
import { expect, test } from "bun:test";
import {
	candidateDefaults,
	comparison,
	grid,
	type Candidate,
	candidateDebit,
	serviceQueue,
	makeMiningFit,
	rawQuote,
} from "../scripts/lib/mining-comparison";
import { recordTrade } from "../src/deficits";
import { debitAt } from "../src/deposit-state";
import { money, signedMoney } from "../src/exact-amount";
import { worldFor, portsOf, run } from "../scripts/lib/greedy-trader";

test("candidate recovery retains whole-tonne clock semantics and refuses invalid clocks", () => {
	for (const t of [0, 3599, 3600, 7200, 36000])
		expect(candidateDebit(8, 0, t, 1)).toBe(debitAt(8, 0, t));
	expect(candidateDebit(8, 0, 3600, 4)).toBe(4);
	expect(() => candidateDebit(8, 10, 9, 1)).toThrow();
	expect(() => candidateDebit(8, 0, 9, NaN)).toThrow();
});

test("FIFO service excludes outages, discards idle time and supports parallel refineries", () => {
	const context = { seed: 47, government: 0, active: 0, total: 0 };
	const jobs = [
		{ workS: 100, submittedAt: 0 },
		{ workS: 100, submittedAt: 1000 },
	];
	const q = serviceQueue(context, jobs, 2000);
	expect(q[0].completedAt).toBeGreaterThanOrEqual(100);
	expect(q[1].completedAt).toBeGreaterThanOrEqual(1100);
	expect(serviceQueue(context, [jobs[0]], 2000)[0]).toEqual(q[0]);
	expect(
		serviceQueue(context, [{ workS: 3000, submittedAt: 0 }], 10)[0].workLeftS,
	).toBeGreaterThanOrEqual(2990);
	expect(() =>
		serviceQueue(context, [{ workS: Infinity, submittedAt: 0 }], 10),
	).toThrow();
});

test("fits use actual slots and catalogue prices rather than inventing a large courier hardpoint", () => {
	expect(makeMiningFit("courier", 1, "E").capacity.holdT).toBeGreaterThan(0);
	expect(() => makeMiningFit("courier", 3, "A")).toThrow();
	expect(makeMiningFit("miner", 3, "A").investmentCr).toBeGreaterThan(
		makeMiningFit("miner", 1, "E").investmentCr,
	);
});

test("fitted trader range is enforced and omitted option preserves historical baseline", () => {
	const world = worldFor(47, 0);
	expect(run(world, 0.01, { tankLy: 7 })).toEqual(run(world, 0.01));
	let jumps = 0;
	run(world, 0.1, {
		tankLy: 0.00001,
		onHop: (hop) => {
			if (hop.kind === "jump") jumps++;
		},
	});
	expect(jumps).toBe(0);
	expect(() => run(world, 0.01, { tankLy: NaN })).toThrow();
});

test("candidate raw market supplies generated native-tonne stock and records memory response", () => {
	const w = worldFor(47, 0);
	const record = w.systems.find(
		(r) => portsOf(r, w.contentsFor(r)).length > 1,
	)!;
	const p = portsOf(record, w.contentsFor(record))[0];
	const a = rawQuote(p, "gold", "rich", 0, {}, 20, candidateDefaults());
	const b = rawQuote(
		p,
		"gold",
		"rich",
		0,
		{ [p.key]: { goods: { "ore:gold:rich": -20 }, updatedAt: 0 } },
		20,
		candidateDefaults(),
	);
	expect(a.stockT).toBeGreaterThanOrEqual(0);
	expect(Number.isInteger(a.stockT)).toBe(true);
	expect(a.sellCr).toBeGreaterThan(b.sellCr);
	expect(a.buyCr).toBeGreaterThanOrEqual(a.sellCr);
});

test("comparison reports exact conservation, equal clocks, finite returns and adverse candidates", () => {
	const c = {
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 1,
		hours: 0.08,
		loadouts: [
			{ hull: "miner" as const, size: 1 as const, grade: "E" as const },
		],
	};
	const a = comparison(c);
	const b = comparison(c);
	expect(a).toEqual(b);
	expect(a.approvedBalance).toBe(false);
	expect(a.rows.length).toBeGreaterThan(0);
	for (const row of a.rows) {
		expect(row.elapsedS).toBe(row.trade.elapsedS);
		expect(row.activeS + row.passiveS).toBeCloseTo(row.elapsedS, 6);
		expect(row.inputG).toBe(row.soldRawG + row.refineryInputG + row.heldRawG);
		expect(row.productG).toBe(row.soldProductG + row.custodyG + row.inProcessG);
		expect(signedMoney.parse(row.cashDelta)).toBe(
			signedMoney.fromTicks(money.parse(row.proceeds) - money.parse(row.paid)),
		);
		expect(Number.isFinite(row.crPerActiveMinute)).toBe(true);
		expect(row.productionBalanceChanged).toBe(false);
	}
	expect(() => comparison({ ...c, hours: NaN })).toThrow();
	expect(() => comparison({ ...c, feeCrPerT: -1 })).toThrow();
	expect(() => comparison({ ...c, seeds: [-1] })).toThrow();
	expect(() =>
		comparison({ ...c, loadouts: [{ hull: "courier", size: 3, grade: "E" }] }),
	).toThrow();
	const costly = comparison({ ...c, feeCrPerT: 100000, hours: 0.2 });
	expect(
		costly.rows.some((r) => r.refusedFee > 0 || r.targetFailures.length > 0),
	).toBe(true);
});

test("full trips actually settle cash and preserve all raw and output mass with active refinery work", () => {
	const report = comparison({
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 1,
		hours: 1,
		loadouts: [{ hull: "miner", size: 1, grade: "E" }],
		drillTPerS: 37.5,
		rockLimit: 10,
		recoveryTPerH: 0,
	});
	expect(report.rows.some((r) => r.soldRawG > 0)).toBe(true);
	expect(report.rows.some((r) => r.soldProductG > 0)).toBe(true);
	expect(report.rows.some((r) => r.pendingJobs > 0)).toBe(true);
	for (const r of report.rows) {
		expect(r.heldRawG).toBeLessThanOrEqual(3_000_000_000);
		expect(r.inputG).toBe(r.soldRawG + r.refineryInputG + r.heldRawG);
		expect(r.productG).toBe(r.soldProductG + r.custodyG + r.inProcessG);
	}
});

test("expired readings and a recovering exhausted field are exercised without a hidden earnings cap", () => {
	const report = comparison({
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 1,
		hours: 0.5,
		surveyLifetimeH: 1 / 3600,
		rockLimit: 1,
		goodMinimumGrade: "poor",
		recoveryTPerH: 3600,
		drillTPerS: 20,
		positioningFloorS: 0.1,
		loadouts: [{ hull: "courier", size: 1, grade: "A" }],
	});
	expect(report.rows.some((r) => r.resurveys > 0)).toBe(true);
	expect(report.rows.some((r) => r.remined > 0)).toBe(true);
	expect(report.rows.some((r) => r.targetFailures.length > 0)).toBe(true);
});

test("all fifteen buy recipes are visible and refinery history conserves committed basis and its eight slots", () => {
	const report = comparison({
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 1,
		hours: 0.5,
		loadouts: [{ hull: "miner", size: 1, grade: "E" }],
	});
	expect(
		new Set(
			report.rows
				.filter((r) => r.path === "buy-refine")
				.map((r) => `${r.buyOre!.family}/${r.buyOre!.grade}`),
		).size,
	).toBe(15);
	expect(report.rows.some((r) => r.parallelRefineries === 2)).toBe(true);
	for (const r of report.rows) {
		expect(r.maxOutstandingSlots).toBeLessThanOrEqual(8);
		expect(
			money.add(money.parse(r.retainedBasis), money.parse(r.soldBasis)),
		).toBe(money.subtract(money.parse(r.paid), money.parse(r.fuelPaid)));
		expect(r.averageBasisCr).toBeLessThanOrEqual(r.peakBasisCr);
		for (const j of r.jobRecords) {
			expect(j.collectedG).toBeLessThanOrEqual(j.productG);
			if (j.doneAt !== null) {
				expect(j.doneAt).toBeGreaterThanOrEqual(j.submittedAt);
				expect(j.doneAt).toBeLessThanOrEqual(r.elapsedS);
			}
		}
	}
});

test("exhaustion is visible at zero recovery, with nonzero unsold custody and no finite-output masking", () => {
	const report = comparison({
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 1,
		hours: 0.5,
		rockLimit: 10,
		recoveryTPerH: 0,
		loadouts: [{ hull: "courier", size: 1, grade: "A" }],
	});
	expect(report.rows.some((r) => r.exhaustions > 0)).toBe(true);
	expect(report.rows.some((r) => r.passiveS > 0)).toBe(true);
	expect(() =>
		comparison({ ...candidateDefaults(), surprise: 4 } as never),
	).toThrow();
});

test("cheap ore and fast service expose profitable buy/refine cycles without a profit clamp", () => {
	const report = comparison({
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 1,
		hours: 0.5,
		rawValueShare: 0.001,
		feeCrPerT: 0,
		serviceSPerT: 0.1,
		loadouts: [{ hull: "courier", size: 1, grade: "E" }],
	});
	const positive = report.rows.filter(
		(r) => r.path === "buy-refine" && signedMoney.parse(r.cashDelta) > 0n,
	);
	expect(positive.length).toBeGreaterThan(0);
	expect(
		positive.every((r) =>
			r.targetFailures.includes("profitable-buy-refine-sell-cycle"),
		),
	).toBe(true);
});

test("CLI compares explicit candidates, labels exact revision, and refuses unsupported inputs without JSON output", () => {
	const { spawnSync } = require("node:child_process");
	const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
	const { tmpdir } = require("node:os");
	const { join } = require("node:path");
	const dir = mkdtempSync(join(tmpdir(), "mining-comparison-"));
	const path = join(dir, "input.json");
	try {
		const c = {
			...candidateDefaults(),
			seeds: [47],
			galaxies: [0],
			systemsPerWorld: 1,
			hours: 0.01,
			loadouts: [{ hull: "courier", size: 1, grade: "E" }],
		};
		writeFileSync(path, JSON.stringify(c));
		const result = spawnSync(
			process.execPath,
			["scripts/measure-mining-economy.ts", "--compare", path],
			{ encoding: "utf8" },
		);
		expect(result.status).toBe(0);
		const report = JSON.parse(result.stdout);
		expect(report.approvedBalance).toBe(false);
		expect(report.instrumentRevision).toMatch(/^[0-9a-f]{40}$/);
		expect(report.inputs).toEqual(c);
		expect(report.rows.length).toBeGreaterThan(0);
		writeFileSync(path, JSON.stringify({ ...c, rawValueShare: -1 }));
		const bad = spawnSync(
			process.execPath,
			["scripts/measure-mining-economy.ts", "--compare", path],
			{ encoding: "utf8" },
		);
		expect(bad.status).not.toBe(0);
		expect(bad.stdout).toBe("");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a known initial outage contributes zero service and independent queues each receive their own uptime", () => {
	let seed = 0;
	let context = { seed, government: 0, active: 1, total: 1 };
	while (initialCapabilityTime(context, 0).phase !== "down" && seed < 1000)
		context = { ...context, seed: ++seed };
	const anchor = initialCapabilityTime(context, 0);
	expect(anchor.phase).toBe("down");
	const outageEnd = anchor.endsAt;
	if (outageEnd === undefined)
		throw new Error("fixture must start in a real outage");
	const during = outageEnd / 2;
	expect(
		serviceQueue(context, [{ workS: 50, submittedAt: 0 }], during)[0].workLeftS,
	).toBe(50);
	const end = outageEnd + 100;
	expect(queryCapabilityTime(context, anchor, 0, end)).toBeCloseTo(100, 6);
	const serial = serviceQueue(
		context,
		[
			{ workS: 50, submittedAt: 0 },
			{ workS: 50, submittedAt: 0 },
		],
		end,
	);
	const independent = serviceQueue(
		context,
		[{ workS: 50, submittedAt: 0 }],
		end,
	);
	expect(serial[0].completedAt).toBeCloseTo(outageEnd + 50, 5);
	expect(serial[1].completedAt).toBeCloseTo(outageEnd + 100, 5);
	expect(independent[0].completedAt).toBe(serial[0].completedAt);
	expect(independent[0].completedAt).toBeLessThan(serial[1].completedAt!);
});

test("committed default candidate equals its public generator", () => {
	const { readFileSync } = require("node:fs");
	expect(
		JSON.parse(readFileSync("docs/candidates/mining-economy-v1.json", "utf8")),
	).toEqual(candidateDefaults());
});

test("measured scenario jobs agree with an independent cumulative-service FIFO oracle at each real refinery", () => {
	const c = {
		...candidateDefaults(),
		seeds: [47],
		galaxies: [0],
		systemsPerWorld: 4,
		hours: 1,
		drillTPerS: 37.5,
		rockLimit: 10,
		recoveryTPerH: 0,
		loadouts: [
			{ hull: "miner" as const, size: 1 as const, grade: "E" as const },
		],
	};
	const report = comparison(c);
	const world = worldFor(47, 0);
	let compared = 0;
	for (const row of report.rows.filter(
		(r) => r.path === "refine" || r.path === "refine-parallel",
	)) {
		for (const key of new Set(row.jobRecords.map((j) => j.refineryKey))) {
			const record = world.systems[systemIndexOfKey(key)];
			const station = world
				.contentsFor(record)
				.stations.find(
					(s) => carrierKey(record.index, s.localCarrierId) === key,
				)!;
			const slot = capabilitySlots(record.index, station).find(
				(s) => s.service === "exclusive",
			)!;
			const identity = capabilityIdentity(47, 0, slot.key);
			const total = raiderSlots(record.index, record.government).length;
			const jobs = row.jobRecords.filter((j) => j.refineryKey === key);
			const expected = serviceQueue(
				{
					seed: identity.seed,
					government: record.government,
					active: total,
					total,
				},
				jobs.map((j) => ({
					workS: j.inputT * c.serviceSPerT,
					submittedAt: j.submittedAt,
				})),
				row.elapsedS,
			);
			for (let i = 0; i < jobs.length; i++) {
				expect(jobs[i].workLeftS).toBeCloseTo(expected[i].workLeftS, 5);
				if (expected[i].completedAt !== null)
					expect(jobs[i].doneAt).toBeCloseTo(expected[i].completedAt!, 5);
				else expect(jobs[i].doneAt).toBe(null);
				compared++;
			}
		}
	}
	expect(compared).toBeGreaterThan(0);
});

const rulingCandidate = (patch: Partial<Candidate> = {}): Candidate => ({
	...candidateDefaults(),
	id: "ruled-pilot-test",
	seeds: [47],
	galaxies: [0],
	systemsPerWorld: 1,
	loadouts: [{ hull: "miner", size: 3, grade: "A" }],
	drillTPerS: 37.5,
	returnLoadT: 1000,
	visitLargestShare: 0.25,
	fieldLayout: "organic",
	onePass: true,
	...patch,
});
const chartedRow = (c: Candidate, path: string) => {
	const row = comparison(c).rows.find(
		(r) => r.path === path && r.profile === "charted",
	);
	if (!row) throw new Error(`no charted ${path} row`);
	return row;
};

test("one pass sells everything it mined instead of holding ore to the horizon", () => {
	const row = chartedRow(rulingCandidate(), "raw");
	expect(row.inputG).toBeGreaterThan(0);
	expect(row.soldRawG).toBe(row.inputG);
	expect(row.heldRawG).toBe(0);
	expect(row.trips).toBeGreaterThan(0);
});

test("the pilot returns at the declared load, not at the full skips", () => {
	const row = chartedRow(rulingCandidate({ returnLoadT: 100 }), "raw");
	expect(row.trips).toBeGreaterThan(
		chartedRow(rulingCandidate({ returnLoadT: 3000 }), "raw").trips,
	);
});

test("a candidate without the ruled fields keeps the wait-for-full pilot", () => {
	const {
		returnLoadT: _load,
		visitLargestShare: _share,
		fieldLayout: _layout,
		onePass: _pass,
		...historical
	} = rulingCandidate();
	const row = chartedRow(historical, "raw");
	expect(row.trips).toBe(0);
	expect(row.soldRawG).toBe(0);
});

test("the largest share limits surveys and the organic layout supplies more rocks", () => {
	const all = rulingCandidate({ visitLargestShare: 1, hours: 8 });
	const quarter = rulingCandidate({ visitLargestShare: 0.25, hours: 8 });
	const baseline = rulingCandidate({
		visitLargestShare: 1,
		hours: 8,
		fieldLayout: "baseline",
	});
	const allSurveys = chartedRow(all, "raw").surveys;
	expect(chartedRow(quarter, "raw").surveys).toBe(Math.ceil(allSurveys * 0.25));
	expect(allSurveys).toBeGreaterThan(chartedRow(baseline, "raw").surveys);
});

test("a docked pilot collects and sells a fast refinery's whole output through the general hold", () => {
	const row = chartedRow(
		rulingCandidate({ serviceSPerT: 0.1, collectS: 5 }),
		"refine",
	);
	expect(row.pendingJobs).toBe(0);
	expect(row.heldRawG).toBe(0);
	expect(row.refineryInputG).toBe(row.inputG);
	expect(row.partialCollections).toBeGreaterThan(0);
	expect(row.productG - row.soldProductG - row.custodyG).toBe(0);
	expect(row.custodyG).toBeLessThan(5_000_000);
	expect(signedMoney.parse(row.cashDelta)).toBeGreaterThan(0n);
});

test("a slow refinery leaves output pending and unpriced at the horizon", () => {
	const row = chartedRow(
		rulingCandidate({ serviceSPerT: 30, collectS: 5 }),
		"refine",
	);
	expect(row.pendingJobs).toBeGreaterThan(0);
	expect(row.inProcessG).toBeGreaterThan(0);
});

test("raw elasticity scales only the ore's mark response", () => {
	const world = worldFor(47, 0);
	const port = world.systems
		.flatMap((r) => portsOf(r, world.contentsFor(r)))
		.find((p) => p.station.type === "refinery")!;
	const marked = recordTrade({}, port.key, {
		goodName: "ore:silicate:standard",
		units: -3000,
		gameTimeMin: 0,
		holdT: 40,
	});
	const quote = (rawElasticityScale?: number, deficits = marked) =>
		rawQuote(port, "silicate", "standard", 0, deficits, 40, {
			...candidateDefaults(),
			rawElasticityScale,
		}).sellCr;
	expect(quote(1)).toBe(quote());
	expect(quote(0)).toBe(quote(undefined, {}));
	expect(quote(0)).toBeGreaterThan(quote(1));
	expect(quote(0.5)).toBeGreaterThan(quote(1));
	expect(quote(0.5)).toBeLessThan(quote(0));
	expect(() =>
		comparison(rulingCandidate({ rawElasticityScale: -1 })),
	).toThrow();
});

test("the ruled fields refuse values outside their range", () => {
	for (const patch of [
		{ returnLoadT: 0 },
		{ visitLargestShare: 0 },
		{ visitLargestShare: 1.5 },
		{ collectS: -1 },
		{ fieldLayout: "lattice" as "organic" },
	])
		expect(() => comparison(rulingCandidate(patch))).toThrow();
});

test("a grid names every variant's inputs and keeps failed targets visible", () => {
	const report = grid({
		candidate: rulingCandidate(),
		axes: { serviceSPerT: [0.1, 30], rawValueShare: [0.25, 0.55] },
	});
	expect(report.approvedBalance).toBe(false);
	expect(report.variants).toHaveLength(4);
	const first = report.variants[0];
	expect(first.inputs).toEqual({ serviceSPerT: 0.1, rawValueShare: 0.25 });
	expect(first.summaries["miner/3/A/charted/raw"].tradeRatio.n).toBeGreaterThan(
		0,
	);
	expect(
		report.variants.some((v) =>
			Object.values(v.summaries).some((s) => s.failedSamples > 0),
		),
	).toBe(true);
	expect(() =>
		grid({ candidate: rulingCandidate(), axes: { nonsense: [1] } }),
	).toThrow();
	expect(() =>
		grid({ candidate: rulingCandidate(), axes: { serviceSPerT: [] } }),
	).toThrow();
});

test("a proportional fee follows the product's value and a zero share charges nothing", () => {
	const fast = { serviceSPerT: 1, feeCrPerT: 0, collectS: 5 };
	const fees = (feeShareOfProduct: number) =>
		chartedRow(rulingCandidate({ ...fast, feeShareOfProduct }), "refine");
	const none = fees(0);
	const quarter = fees(0.25);
	const half = fees(0.5);
	expect(money.parse(none.fees)).toBe(0n);
	expect(money.parse(quarter.fees)).toBeGreaterThan(0n);
	expect(money.parse(half.fees)).toBeGreaterThan(money.parse(quarter.fees));
	expect(signedMoney.parse(quarter.cashDelta)).toBeLessThan(
		signedMoney.parse(none.cashDelta),
	);
	expect(() =>
		comparison(rulingCandidate({ feeShareOfProduct: 1.5 })),
	).toThrow();
	expect(() =>
		comparison(rulingCandidate({ feeShareOfProduct: -0.1 })),
	).toThrow();
});

test("a proportional fee charges dearer ore more per tonne than cheap ore", () => {
	const row = (buyFamily: "silicate" | "gem") =>
		comparison(
			rulingCandidate({
				serviceSPerT: 1,
				feeCrPerT: 0,
				feeShareOfProduct: 0.25,
				hours: 0.2,
			}),
		).rows.find(
			(r) =>
				r.path === "buy-refine" &&
				r.buyOre?.family === buyFamily &&
				r.buyOre?.grade === "standard",
		)!;
	const perTonne = (r: ReturnType<typeof row>) =>
		Number(money.parse(r.fees)) / (r.refineryInputG / 1_000_000);
	expect(perTonne(row("gem"))).toBeGreaterThan(perTonne(row("silicate")));
});
