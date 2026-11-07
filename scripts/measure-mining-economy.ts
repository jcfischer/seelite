import { readFileSync } from "node:fs";
import {
	query,
	validateAnchor,
} from "../docs/prototypes/capability-outages-937.mjs";
import {
	money,
	massFromNative,
	quoteFromNumber,
	quoteMass,
	signedMoney,
	transferCost,
} from "../src/exact-amount";
import { generateGalaxy } from "../src/galaxy";
import {
	COMMODITIES,
	hasMarket,
	marketQuote,
	marketRow,
	marketStationOf,
	stockResponse,
} from "../src/market";
import {
	ORE_FAMILIES,
	ORE_GRADES,
	type OreFamily,
	type OreGrade,
} from "../src/rock-survey";
import { generateContents } from "../src/system";

const GRAMS_PER_TONNE = 1_000_000;

const PRODUCTS = {
	silicate: "Minerals",
	metallic: "Alloys",
	gold: "Gold",
	platinum: "Platinum",
	gem: "Gem-Stones",
} as const;
const YIELD_G = {
	silicate: [200000, 400000, 800000],
	metallic: [200000, 400000, 800000],
	gold: [500, 1000, 2000],
	platinum: [250, 500, 1000],
	gem: [5, 10, 20],
} as const;

function nonnegative(name: string, value: number): number {
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`mining economy: invalid ${name}`);
	return value;
}

function whole(name: string, value: number): number {
	if (!Number.isSafeInteger(nonnegative(name, value)))
		throw new Error(`mining economy: invalid whole ${name}`);
	return value;
}

/** Ratified design inputs from https://github.com/jcfischer/seelite/issues/917, not a balanced table. */
export function recipeFor(family: OreFamily, grade: OreGrade) {
	if (!ORE_FAMILIES.includes(family) || !ORE_GRADES.includes(grade))
		throw new Error("mining economy: unsupported recipe");
	const product = PRODUCTS[family];
	const good = COMMODITIES.find((g) => g.name === product)!;
	return {
		product,
		yieldGPerT: YIELD_G[family][ORE_GRADES.indexOf(grade)],
		nativeUnitG:
			good.unit === "t" ? GRAMS_PER_TONNE : good.unit === "kg" ? 1000 : 1,
		occupiesHold: good.unit === "t",
	};
}

export interface BatchCandidate {
	family: OreFamily;
	grade: OreGrade;
	inputT: number;
	purchaseCrPerT: number;
	rawBidCrPerT: number;
	feeCrPerT: number;
	productBidCrPerNativeUnit: number;
	freeHoldT: number;
	collectUnits: number;
}

/** Compare a supplied raw-sale quote with one exact refined collection; unsold custody is never cash. */
export function analyzeBatch(candidate: BatchCandidate) {
	const recipe = recipeFor(candidate.family, candidate.grade);
	const tonnes = whole("input tonnes", candidate.inputT);
	if (tonnes === 0) throw new Error("mining economy: empty batch");
	const inputG = whole("input grams", tonnes * GRAMS_PER_TONNE);
	const productG = whole("product grams", tonnes * recipe.yieldGPerT);
	const units = whole("collection units", candidate.collectUnits);
	const freeHoldT = nonnegative("free hold tonnes", candidate.freeHoldT);
	if (units > Math.floor(productG / recipe.nativeUnitG))
		throw new Error("mining economy: collection exceeds whole output");
	if (recipe.occupiesHold && units > Math.floor(freeHoldT))
		throw new Error("mining economy: collection exceeds capacity");
	const price = (name: string, value: number) =>
		quoteFromNumber(nonnegative(name, value));
	const inputMass = massFromNative(tonnes, GRAMS_PER_TONNE);
	const perTonne = (name: string, value: number) =>
		quoteMass(price(name, value), inputMass, GRAMS_PER_TONNE);
	const purchaseCost = perTonne("purchase quote", candidate.purchaseCrPerT);
	const fee = perTonne("fee quote", candidate.feeCrPerT);
	const committedCost = money.add(purchaseCost, fee);
	const rawProceeds = perTonne("raw bid", candidate.rawBidCrPerT);
	const collectedG = whole("collected grams", units * recipe.nativeUnitG);
	const productProceeds = quoteMass(
		price("product bid", candidate.productBidCrPerNativeUnit),
		massFromNative(units, recipe.nativeUnitG),
		recipe.nativeUnitG,
	);
	const basis = transferCost(
		committedCost,
		massFromNative(collectedG, 1),
		massFromNative(productG, 1),
	);
	return {
		product: recipe.product,
		inputG,
		productG,
		tailingsG: inputG - productG,
		collectableUnits: Math.floor(productG / recipe.nativeUnitG),
		collectedG,
		custodyG: productG - collectedG,
		purchaseCost,
		fee,
		committedCost,
		rawProceeds,
		productProceeds,
		rawCashDelta: signedMoney.fromTicks(rawProceeds - purchaseCost),
		refinedCashDelta: signedMoney.fromTicks(productProceeds - committedCost),
		carriedBasis: basis.moved,
		custodyBasis: basis.retained,
	};
}

export interface MarketFixture {
	seed: number;
	galaxy: number;
	system: number;
	stationId: string;
	gameTimeS: number;
	holdT: number;
	deficit: number;
}

/** Read the actual generated product bid at a stated clock and supplied current deficit. */
export function productBidAt(fixture: MarketFixture, product: string): number {
	whole("world seed", fixture.seed);
	if (
		fixture.seed > 0xffffffff ||
		!Number.isInteger(fixture.galaxy) ||
		fixture.galaxy < 0 ||
		fixture.galaxy > 7
	)
		throw new Error("mining economy: invalid galaxy identity");
	whole("system index", fixture.system);
	nonnegative("game time", fixture.gameTimeS);
	if (!Number.isFinite(fixture.deficit))
		throw new Error("mining economy: invalid deficit");
	if (!(nonnegative("hold tonnes", fixture.holdT) > 0))
		throw new Error("mining economy: empty hold");
	const record = generateGalaxy(fixture.seed, fixture.galaxy).systems[
		fixture.system
	];
	if (!record) throw new Error("mining economy: no system");
	const station = generateContents(record).stations.find(
		(s) => s.id === fixture.stationId,
	);
	const commodity = COMMODITIES.find((g) => g.name === product);
	if (!station || !commodity || !hasMarket(station))
		throw new Error("mining economy: unsupported station or product");
	const row = marketRow(
		commodity,
		record.economy,
		marketStationOf(station, record.seed),
		fixture.gameTimeS / 60,
	);
	return marketQuote(
		stockResponse(row.priceCr, fixture.deficit, fixture.holdT),
		record.displayTL,
	).sellCr;
}

/** Reuse the approved decision model; this is not production world-state recovery enumeration. */
export function advanceCandidateQueue({
	anchor,
	fromS,
	toS,
	workS,
}: {
	anchor: unknown;
	fromS: number;
	toS: number;
	workS: readonly number[];
}) {
	const checkedAnchor = validateAnchor(anchor);
	nonnegative("queue from time", fromS);
	nonnegative("queue to time", toS);
	if (toS < fromS || workS.length > 8)
		throw new Error("mining economy: invalid queue interval or job count");
	const remainingWorkS = workS.map((work) =>
		nonnegative("remaining work", work),
	);
	const serviceS = query(checkedAnchor, fromS, toS);
	let availableS = serviceS;
	for (let i = 0; i < remainingWorkS.length; i++) {
		const consumed = Math.min(availableS, remainingWorkS[i]);
		remainingWorkS[i] -= consumed;
		availableS -= consumed;
	}
	return {
		serviceS,
		consumedS: serviceS - availableS,
		discardedIdleS: availableS,
		remainingWorkS,
	};
}

/** Explicit readiness audit: missing policy produces no synthetic financial comparison. */
export function candidateInventory() {
	return {
		status: "incomplete" as const,
		contracts: {
			recipes: "#917 D1-D11",
			accounting: "#935 approved bounded contract; src/exact-amount.ts",
			outageSeconds: "#937 decision model; production is #1194",
			extraction:
				"src/rock-survey.ts, src/rock-extraction.ts, src/rock-drill.ts (provisional)",
		},
		refineryDemonstration: {
			feeCrPerT: 10,
			operationalSecondsPerT: 60,
			approvedBalance: false,
		},
		missingInputs: [
			"raw-ore price and generated-stock candidate model",
			"compatible fitted-loadout and extraction-duty-cycle scenario corpus",
			"search, positioning, fragment recovery and collection-trip scenario corpus",
		],
		remainingChecks: [
			"full equal-clock shipped-trading comparison",
			"field recovery and survey-lifetime sensitivity",
			"partial jobs, parallel refineries and committed-pool progression across a full trip",
			"raw buy/refine/sell stock and market-memory cycles",
			"active versus elapsed time and capital payback distributions",
		],
	};
}

if (import.meta.main) {
	const [mode = "--inventory", path] = process.argv.slice(2);
	let result: unknown;
	if (mode === "--inventory" && path === undefined) {
		result = candidateInventory();
	} else if (mode === "--batch" && path && process.argv.length === 4) {
		const input = JSON.parse(readFileSync(path, "utf8"));
		if (
			!input ||
			typeof input !== "object" ||
			Array.isArray(input) ||
			!["fixture", "candidate"].includes(input.kind) ||
			typeof input.provenance !== "string" ||
			input.provenance.trim().length === 0 ||
			!input.batch ||
			typeof input.batch !== "object" ||
			Array.isArray(input.batch)
		)
			throw new Error(
				"A batch requires kind fixture/candidate, explicit provenance and batch inputs",
			);
		const batch = { ...input.batch } as BatchCandidate;
		let productQuoteSource = "supplied per-native-unit quote";
		if (input.productMarket !== undefined) {
			if (batch.productBidCrPerNativeUnit !== undefined)
				throw new Error(
					"Supply either productMarket or productBidCrPerNativeUnit, not both",
				);
			batch.productBidCrPerNativeUnit = productBidAt(
				input.productMarket as MarketFixture,
				recipeFor(batch.family, batch.grade).product,
			);
			productQuoteSource =
				"shipped marketRow/stockResponse/marketQuote at supplied identity, game clock and deficit";
		}
		result = {
			status: "incomplete",
			kind: input.kind,
			provenance: input.provenance,
			inputs: batch,
			productMarket: input.productMarket,
			productQuoteSource,
			batch: analyzeBatch(batch),
			moneyEncoding:
				"canonical #940 money wire units, including signed cash differences; no display rounding",
			limitations: [
				"One batch is not a mined/refined route, a market-cycle simulation or a progression-pool result",
				"No active-minute return, elapsed-time comparison, payback or balance approval is inferred",
				...candidateInventory().remainingChecks,
			],
		};
	} else {
		throw new Error(
			"Usage: bun scripts/measure-mining-economy.ts [--inventory | --batch <explicit-input.json>]",
		);
	}
	console.log(
		JSON.stringify(
			result,
			(_key, value) =>
				typeof value === "bigint"
					? signedMoney.encode(signedMoney.fromTicks(value))
					: value,
			2,
		),
	);
}
