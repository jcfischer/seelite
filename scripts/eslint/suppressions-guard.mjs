import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SUPPRESSIONS = "eslint-suppressions.json";

export function totalsByRule(suppressions) {
	const totals = new Map();
	for (const rules of Object.values(suppressions)) {
		for (const [rule, { count }] of Object.entries(rules))
			totals.set(rule, (totals.get(rule) ?? 0) + count);
	}
	return totals;
}

/**
 * The rules whose suppressed total grew from `base` to `head`. A rule the base
 * config does not enable yet starts its baseline in the change that enables it.
 * @param {Record<string, Record<string, { count: number }>>} base
 * @param {Record<string, Record<string, { count: number }>>} head
 * @param {(rule: string) => boolean} [enabledOnBase]
 */
export function grownRules(base, head, enabledOnBase = () => true) {
	const before = totalsByRule(base);
	return [...totalsByRule(head)]
		.filter(([rule, n]) => enabledOnBase(rule) && n > (before.get(rule) ?? 0))
		.map(([rule, n]) => `${rule}: ${before.get(rule) ?? 0} -> ${n}`);
}

function gitShow(ref) {
	try {
		return execFileSync("git", ["show", ref], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

function main() {
	const baseRef = process.env.LINT_BASE_REF ?? "origin/main";
	if (gitShow(`${baseRef}^{commit}`) === null) {
		console.error(
			`suppressions guard: cannot read ${baseRef}. Fetch it first: git fetch origin main`,
		);
		process.exit(2);
	}
	const base = gitShow(`${baseRef}:${SUPPRESSIONS}`);
	if (base === null) return;
	const baseConfig = gitShow(`${baseRef}:eslint.config.mjs`) ?? "";
	const grown = grownRules(
		JSON.parse(base),
		JSON.parse(readFileSync(SUPPRESSIONS, "utf8")),
		(rule) => baseConfig.includes(JSON.stringify(rule)),
	);
	if (grown.length > 0) {
		console.error(
			`${SUPPRESSIONS} suppresses more than ${baseRef} does:\n${grown.map((g) => `  ${g}`).join("\n")}\n` +
				"Fix the new violations instead of suppressing them. A moved file keeps its rule totals, so a rename passes.",
		);
		process.exit(1);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
