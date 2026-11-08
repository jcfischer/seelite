import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { signedMoney } from "../src/exact-amount";
import {
	analyzeBatch,
	candidateInventory,
	productBidAt,
	recipeFor,
	type BatchCandidate,
	type MarketFixture,
} from "./lib/mining-batch";
export * from "./lib/mining-batch";
import {
	candidateDefaults,
	comparison,
	sensitivity,
} from "./lib/mining-comparison";
if (import.meta.main) {
	const [mode = "--inventory", path] = process.argv.slice(2);
	let result: unknown;
	if (
		(mode === "--compare" || mode === "--sweep") &&
		process.argv.length <= 4
	) {
		const candidate = path
			? JSON.parse(readFileSync(path, "utf8"))
			: candidateDefaults();
		const report =
			mode === "--compare" ? comparison(candidate) : sensitivity(candidate);
		result = {
			instrumentRevision: execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: import.meta.dir,
				encoding: "utf8",
			}).trim(),
			workingTree: execFileSync(
				"git",
				[
					"status",
					"--porcelain",
					"--",
					"scripts/measure-mining-economy.ts",
					"scripts/lib/mining-batch.ts",
					"scripts/lib/mining-comparison.ts",
					"scripts/lib/greedy-trader.ts",
				],
				{ cwd: `${import.meta.dir}/..`, encoding: "utf8" },
			).trim()
				? "modified"
				: "clean",
			...report,
		};
	} else if (mode === "--candidate" && path === undefined) {
		result = candidateDefaults();
	} else if (mode === "--inventory" && path === undefined) {
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
			"Usage: bun scripts/measure-mining-economy.ts [--inventory | --candidate | --batch <explicit-input.json> | --compare [candidate.json] | --sweep [candidate.json]]",
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
