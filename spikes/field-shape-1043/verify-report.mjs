import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const captures = resolve(
	process.argv[2] ?? "/tmp/seelite-field-shape-1043-organic",
);
const target = process.argv[3] ?? "HEAD";
const report = resolve("spikes/field-shape-1043/report.mjs");
const scratch = mkdtempSync("/tmp/field1043-report-verification-");
for (const kind of ["charted", "rare"])
	for (const aa of [0, 2])
		for (const prefix of ["cost", "nav-verified"]) {
			const directory = `${prefix}-${kind}-aa${aa}`;
			mkdirSync(join(scratch, directory), { recursive: true });
			copyFileSync(
				join(captures, directory, "manifest.json"),
				join(scratch, directory, "manifest.json"),
			);
		}
const run = () =>
	spawnSync(process.execPath, [report, scratch], { encoding: "utf8" });
const valid = run();
if (valid.status !== 0) throw Error(`real manifests failed: ${valid.stderr}`);
const cases = [
	{
		name: "dirty",
		directory: "nav-verified-charted-aa0",
		mutate: (m) => {
			m.dirty = true;
		},
		expected: "unclean or missing source provenance",
	},
	{
		name: "head",
		directory: "nav-verified-charted-aa2",
		mutate: (m) => {
			m.head = "0".repeat(40);
		},
		expected: "mismatched Navigation source head or hashes",
	},
	{
		name: "hash",
		directory: "nav-verified-rare-aa0",
		mutate: (m) => {
			m.sources["src/main.ts"] = "0".repeat(64);
		},
		expected: "mismatched Navigation source head or hashes",
	},
	{
		name: "missing-row",
		directory: "cost-charted-aa0",
		mutate: (m) => {
			m.timing.rows.pop();
		},
		expected: "expected 160 world timing rows, got 159",
	},
];
const guardResults = [];
for (const control of cases) {
	const path = join(scratch, control.directory, "manifest.json"),
		original = readFileSync(path, "utf8"),
		mutant = JSON.parse(original);
	control.mutate(mutant);
	writeFileSync(path, JSON.stringify(mutant));
	const result = run();
	writeFileSync(path, original);
	if (result.status === 0 || !result.stderr.includes(control.expected))
		throw Error(`${control.name} control failed: ${result.stderr}`);
	guardResults.push({
		name: control.name,
		exitCode: result.status,
		expectedError: control.expected,
		detected: true,
	});
}
const tree = (revision) =>
	execFileSync("git", ["ls-tree", "-rz", "--full-tree", revision], {
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	})
		.split("\0")
		.filter(Boolean)
		.map((entry) => {
			const tab = entry.indexOf("\t");
			return { path: entry.slice(tab + 1), identity: entry.slice(0, tab) };
		});
const production = (path) =>
	!path.startsWith("docs/") && !path.startsWith("spikes/");
const affected = (path) =>
	production(path) ||
	(path.startsWith("spikes/field-shape-1043/") &&
		path.endsWith(".ts") &&
		!path.endsWith("/anchor-measure.ts"));
const strictSpike = (path) =>
	production(path) ||
	(path.startsWith("spikes/field-shape-1043/") && path.endsWith(".ts"));
const physical = (path) =>
	["organic.ts", "profiles.ts", "anchor-query.ts"].some(
		(name) => path === `spikes/field-shape-1043/${name}`,
	);
const digest = (entries) =>
	createHash("sha256").update(JSON.stringify(entries)).digest("hex");
const targetHead = execFileSync("git", ["rev-parse", target], {
		encoding: "utf8",
	}).trim(),
	targetTree = tree(targetHead);
const comparisons = [];
for (const [label, from, filter] of [
	["tracked production build inputs", "b1e62e7a", production],
	["affected headless test inputs", "b1e62e7a", affected],
	["measured geometry and query modules", "4fcc3de6", physical],
	["strict spike TypeScript inputs", "ea7ecbce", strictSpike],
	[
		"tracked production build inputs after receipt commit",
		"cc292230",
		production,
	],
]) {
	const before = tree(from).filter((entry) => filter(entry.path)),
		after = targetTree.filter((entry) => filter(entry.path));
	const beforeDigest = digest(before),
		afterDigest = digest(after);
	if (beforeDigest !== afterDigest)
		throw Error(`${label} changed between ${from} and ${targetHead}`);
	comparisons.push({
		label,
		from: execFileSync("git", ["rev-parse", from], { encoding: "utf8" }).trim(),
		to: targetHead,
		files: before.length,
		beforeDigest,
		afterDigest,
		equal: true,
	});
}
const result = {
	targetHead,
	guardResults,
	comparisons,
	scratch,
	scope:
		"Git-tracked input identities including asset references; not an installed-dependency or operating-system snapshot. anchor-measure.ts is a separate CPU timing instrument, not an input to the affected headless suite or production build.",
};
writeFileSync(
	join(captures, "report-verification.json"),
	JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
