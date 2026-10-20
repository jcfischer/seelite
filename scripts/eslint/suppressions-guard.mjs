import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SUPPRESSIONS = "eslint-suppressions.json";
const CONFIG_FILES = ["eslint.config.mjs", "scripts/eslint/seelite.mjs"];

/**
 * Every file and rule whose suppressed count grew from `base` to `head`, so a
 * comment removed in one file does not pay for a new one in another. A file
 * git sees as renamed keeps its base counts under its new path. A rule the base
 * config does not enable yet starts its baseline in the change that enables
 * it; a rule the base already suppresses counts as enabled whatever the config
 * text says.
 * @param {Record<string, Record<string, { count: number }>>} base
 * @param {Record<string, Record<string, { count: number }>>} head
 * @param {{ renames?: ReadonlyMap<string, string>, enabledOnBase?: (rule: string) => boolean }} [options]
 */
export function grownSuppressions(
	base,
	head,
	{ renames = new Map(), enabledOnBase = () => true } = {},
) {
	const before = new Map();
	const baseRules = new Set();
	for (const [file, rules] of Object.entries(base)) {
		const path = renames.get(file) ?? file;
		for (const [rule, { count }] of Object.entries(rules)) {
			baseRules.add(rule);
			const key = `${path}\0${rule}`;
			before.set(key, (before.get(key) ?? 0) + count);
		}
	}
	const grown = [];
	for (const [file, rules] of Object.entries(head)) {
		for (const [rule, { count }] of Object.entries(rules)) {
			if (!baseRules.has(rule) && !enabledOnBase(rule)) continue;
			const was = before.get(`${file}\0${rule}`) ?? 0;
			if (count > was) grown.push(`${file} ${rule}: ${was} -> ${count}`);
		}
	}
	return grown;
}

function git(args) {
	try {
		return execFileSync("git", args, {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return null;
	}
}

function renamesSince(baseRef) {
	const out = git(["diff", "--name-status", "-M", baseRef]) ?? "";
	const renames = new Map();
	for (const line of out.split("\n")) {
		const [status, from, to] = line.split("\t");
		if (status?.startsWith("R") && from && to) renames.set(from, to);
	}
	return renames;
}

function main() {
	const baseRef = process.env.LINT_BASE_REF ?? "origin/main";
	if (
		git(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`]) === null
	) {
		console.error(
			`suppressions guard: cannot read ${baseRef}. Fetch it first: git fetch origin main`,
		);
		process.exit(2);
	}
	const base = git(["show", `${baseRef}:${SUPPRESSIONS}`]);
	if (base === null) return;
	const baseConfig = CONFIG_FILES.map(
		(file) => git(["show", `${baseRef}:${file}`]) ?? "",
	).join("\n");
	const grown = grownSuppressions(
		JSON.parse(base),
		JSON.parse(readFileSync(SUPPRESSIONS, "utf8")),
		{
			renames: renamesSince(baseRef),
			enabledOnBase: (rule) => baseConfig.includes(JSON.stringify(rule)),
		},
	);
	if (grown.length > 0) {
		console.error(
			`${SUPPRESSIONS} suppresses more than ${baseRef} does:\n${grown.map((g) => `  ${g}`).join("\n")}\n` +
				"Fix the new violations instead of suppressing them. A renamed file keeps its counts, so a pure move passes.",
		);
		process.exit(1);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
