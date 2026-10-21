import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, join, posix, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

export interface LineRange {
	start: number;
	end: number;
}
export interface Mutant {
	status: string;
	mutatorName: string;
	replacement?: string;
	location: { start: { line: number } };
}
export interface MutationReport {
	files: Record<string, { mutants: Mutant[] }>;
}
interface Module {
	imports: string[];
	browser: boolean;
}
type ModuleIndex = Map<string, Module>;

const SOURCE = /^src\/.*\.ts$/;
const TEST = /\.test\.ts$/;
const SHADER = /(?:shader|\.glsl)(?:[./-]|$)/i;
const BROWSER =
	/^(?:window|document|navigator|localStorage|sessionStorage|indexedDB|fetch|requestAnimationFrame|cancelAnimationFrame|Image|Worker|Audio|AudioContext|OfflineAudioContext|AudioWorkletProcessor|HTMLElement|Element|HTML\w*Element|Canvas\w*|OffscreenCanvas|WebGL\w*|GPU\w*|BaseAudioContext|Audio\w*Node)$/;
const MAX_TEST_FILES = 8;

function onlyLostComment(removed: string, kept: string): boolean {
	const code = kept.trimEnd();
	return (
		code.trim() !== "" &&
		removed.startsWith(code) &&
		/^(?:\/\/.*|\/\*(?:(?!\*\/).)*\*\/)$/.test(
			removed.slice(code.length).trim(),
		) &&
		['"', "'", "`"].every((q) => code.split(q).length % 2 === 1)
	);
}

/** Added head ranges in a zero-context diff; deletions and comment-only removals have no mutants. */
export function changedRanges(diff: string): Map<string, LineRange[]> {
	const result = new Map<string, LineRange[]>();
	let file: string | undefined;
	let hunk:
		| {
				file: string;
				start: number;
				count: number;
				removed: string[];
				added: string[];
		  }
		| undefined;
	const flush = () => {
		if (!hunk) return;
		const ranges = result.get(hunk.file) ?? [];
		let unpaired = 0;
		for (let i = 0; i < hunk.count; i++) {
			const added = hunk.added[i];
			const match =
				added === undefined
					? -1
					: hunk.removed.findIndex(
							(line, k) => k >= unpaired && onlyLostComment(line, added),
						);
			if (match >= 0) {
				unpaired = match + 1;
				continue;
			}
			const line = hunk.start + i;
			const last = ranges.at(-1);
			if (last?.end === line - 1) last.end = line;
			else ranges.push({ start: line, end: line });
		}
		if (ranges.length) result.set(hunk.file, ranges);
		hunk = undefined;
	};
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			flush();
			file = line.startsWith("+++ b/") ? line.slice(6) : undefined;
			continue;
		}
		const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
		if (header) {
			flush();
			if (file)
				hunk = {
					file,
					start: Number(header[1]),
					count: header[2] === undefined ? 1 : Number(header[2]),
					removed: [],
					added: [],
				};
		} else if (hunk && line.startsWith("-")) hunk.removed.push(line.slice(1));
		else if (hunk && line.startsWith("+")) hunk.added.push(line.slice(1));
	}
	flush();
	return result;
}

function resolveImport(
	file: string,
	spec: string,
	files: Map<string, string>,
): string {
	if (!spec.startsWith(".")) return spec;
	const stem = posix.normalize(posix.join(posix.dirname(file), spec));
	return (
		[stem, `${stem}.ts`, `${stem}/index.ts`, stem.replace(/\.js$/, ".ts")].find(
			(p) => files.has(p),
		) ?? stem
	);
}

/** Runtime import edges only: declarations, re-exports, literal dynamic imports and require. */
export function moduleIndex(files: Map<string, string>): ModuleIndex {
	const result: ModuleIndex = new Map();
	for (const [file, text] of files) {
		const imports = new Set<string>();
		let browser = SHADER.test(file);
		const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		if (
			(ast as ts.SourceFile & { parseDiagnostics: readonly unknown[] })
				.parseDiagnostics.length
		)
			browser = true;
		const add = (spec: ts.Expression | undefined) => {
			if (spec && ts.isStringLiteralLike(spec))
				imports.add(resolveImport(file, spec.text, files));
			else browser = true;
		};
		const visit = (node: ts.Node) => {
			if (ts.isImportDeclaration(node)) {
				const clause = node.importClause;
				const bindings = clause?.namedBindings;
				if (
					clause?.isTypeOnly ||
					(!clause?.name &&
						bindings &&
						ts.isNamedImports(bindings) &&
						bindings.elements.length > 0 &&
						bindings.elements.every((e) => e.isTypeOnly))
				)
					return;
				add(node.moduleSpecifier);
				return;
			}
			if (ts.isExportDeclaration(node)) {
				if (node.isTypeOnly) return;
				if (
					node.exportClause &&
					ts.isNamedExports(node.exportClause) &&
					node.exportClause.elements.length > 0 &&
					node.exportClause.elements.every((e) => e.isTypeOnly)
				)
					return;
				if (node.moduleSpecifier) add(node.moduleSpecifier);
				return;
			}
			if (
				ts.isCallExpression(node) &&
				(node.expression.kind === ts.SyntaxKind.ImportKeyword ||
					(ts.isIdentifier(node.expression) &&
						node.expression.text === "require"))
			)
				add(node.arguments[0]);
			if (ts.isIdentifier(node) && BROWSER.test(node.text)) browser = true;
			ts.forEachChild(node, visit);
		};
		visit(ast);
		result.set(file, { imports: [...imports], browser });
	}
	return result;
}

/** Reaching tests, preferring same-stem files; otherwise nearest importers, at most eight within three edges. */
export function testsFor(
	source: string,
	index: ModuleIndex,
	maxDepth = 3,
): string[] {
	const seen = new Set([source]);
	let frontier = [source];
	const found: { file: string; depth: number }[] = [];
	for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
		const next: string[] = [];
		for (const [file, module] of index) {
			if (seen.has(file) || !module.imports.some((p) => frontier.includes(p)))
				continue;
			seen.add(file);
			if (TEST.test(file)) found.push({ file, depth });
			else next.push(file);
		}
		frontier = next;
	}
	const stem = basename(source, ".ts");
	const colocated = found.filter(({ file }) => {
		const name = basename(file);
		return name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`);
	});
	const nearest = found.filter(({ depth }) => depth === found[0]?.depth);
	return (colocated.length ? colocated : nearest)
		.map(({ file }) => file)
		.sort((a, b) => a.length - b.length || a.localeCompare(b))
		.slice(0, MAX_TEST_FILES);
}

/** Include tested src TypeScript with a headless runtime closure. Exclude shaders, DOM/canvas/audio/browser API references, external runtime packages (including Three), unresolved imports and their importers, even when geometry tests reach them. Type-only package imports are harmless. */
export function mutableReason(file: string, index: ModuleIndex): string | null {
	if (!SOURCE.test(file) || /(?:\.d|\.test)\.ts$/.test(file))
		return "outside headless src TypeScript";
	const seen = new Set<string>();
	const visit = (path: string): boolean => {
		if (seen.has(path)) return true;
		seen.add(path);
		const module = index.get(path);
		return !!module && !module.browser && module.imports.every(visit);
	};
	if (!visit(file))
		return "rendering, shader, browser API or unresolved runtime dependency";
	return testsFor(file, index).length
		? null
		: "no reaching Bun test within three import edges";
}

/** A location-bearing line for every surviving mutant; timeouts and runner failures are separate outcomes. */
export function survivors(report: MutationReport): string[] {
	return Object.entries(report.files).flatMap(([file, { mutants }]) =>
		mutants
			.filter((m) => m.status === "Survived")
			.map(
				(m) =>
					`${file}:${m.location.start.line} ${m.mutatorName}${m.replacement ? ` -> ${m.replacement}` : ""}`,
			),
	);
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Stryker command runner has no Bun coverage integration: selected tests run once per mutant. */
export function strykerConfig(
	file: string,
	ranges: LineRange[],
	tests: string[],
	reportStem: string,
) {
	return {
		testRunner: "command",
		commandRunner: {
			command: `bun test --timeout=60000 ${tests.map(shellQuote).join(" ")}`,
		},
		coverageAnalysis: "off",
		mutate: ranges.map(({ start, end }) => `${file}:${start}-${end}`),
		reporters: ["clear-text", "json", "html"],
		jsonReporter: { fileName: `${reportStem}.json` },
		htmlReporter: { fileName: `${reportStem}.html` },
		concurrency: 1,
		thresholds: { high: 100, low: 100, break: null },
		timeoutMS: 60000,
		timeoutFactor: 1.5,
		ignorePatterns: [
			"reports",
			".git",
			".worktrees",
			"public",
			"spikes",
			"dist",
		],
		tempDirName: ".stryker-tmp",
		cleanTempDir: "always",
	};
}

function git(args: string[]): string {
	const run = spawnSync("git", args, { encoding: "utf8" });
	if (run.status !== 0)
		throw new Error(`git ${args[0]} failed: ${run.stderr || run.error}`);
	return run.stdout;
}

async function main(): Promise<number> {
	const started = performance.now();
	const base = process.env.MUTATION_BASE_REF ?? "origin/main";
	const head = process.env.MUTATION_HEAD_REF ?? "HEAD";
	const baseSha = git(["rev-parse", "--verify", `${base}^{commit}`]).trim();
	const headSha = git(["rev-parse", "--verify", `${head}^{commit}`]).trim();
	if (
		git(["rev-parse", "HEAD"]).trim() !== headSha ||
		git(["status", "--porcelain", "--untracked-files=normal"]).trim()
	)
		throw new Error(
			"mutation-changed needs a clean checkout at MUTATION_HEAD_REF; commit changes first or use a disposable snapshot",
		);
	const mergeBase = git(["merge-base", baseSha, headSha]).trim();
	const diff = git([
		"diff",
		"--unified=0",
		"--no-color",
		"--no-ext-diff",
		"--no-renames",
		"--diff-filter=AM",
		mergeBase,
		headSha,
		"--",
		"src",
	]);
	const outDir = "reports/mutation/changed";
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	const paths = git(["ls-files", "-z", "--", "src", "tests"])
		.split("\0")
		.filter((p) => p.endsWith(".ts"));
	const index = moduleIndex(
		new Map(paths.map((p) => [p, readFileSync(p, "utf8")])),
	);
	const checked = [];
	const skipped = [];
	const failures: string[] = [];
	for (const [file, ranges] of changedRanges(diff)) {
		const reason = mutableReason(file, index);
		if (reason) {
			skipped.push({ file, reason });
			console.log(`Skip ${file}: ${reason}`);
			continue;
		}
		const tests = testsFor(file, index);
		const reportStem = join(outDir, file.replace(/[^a-zA-Z0-9_-]/g, "_"));
		const configPath = `${reportStem}.config.json`;
		writeFileSync(
			configPath,
			JSON.stringify(strykerConfig(file, ranges, tests, reportStem), null, 2),
		);
		const fileStarted = performance.now();
		console.log(
			`Mutate ${file}:${ranges.map((r) => `${r.start}-${r.end}`).join(",")} against ${tests.join(", ")}`,
		);
		const run = spawnSync(
			"node",
			[
				resolve("node_modules/@stryker-mutator/core/bin/stryker.js"),
				"run",
				configPath,
			],
			{ stdio: "inherit" },
		);
		if (run.status !== 0 || !existsSync(`${reportStem}.json`)) {
			failures.push(
				`${file}: Stryker failed (exit ${run.status}, ${run.error ?? "see dry-run output"})`,
			);
			continue;
		}
		const report = JSON.parse(
			readFileSync(`${reportStem}.json`, "utf8"),
		) as MutationReport;
		const left = survivors(report);
		const mutants = Object.values(report.files).flatMap((f) => f.mutants);
		const errors = mutants.filter((m) =>
			["RuntimeError", "Pending"].includes(m.status),
		);
		if (errors.length)
			failures.push(`${file}: ${errors.length} incomplete/error mutants`);
		failures.push(...left);
		checked.push({
			file,
			ranges,
			tests,
			mutants: mutants.length,
			survivors: left,
			statuses: mutants.reduce<Record<string, number>>((counts, m) => {
				counts[m.status] = (counts[m.status] ?? 0) + 1;
				return counts;
			}, {}),
			wallSeconds: (performance.now() - fileStarted) / 1000,
			html: `${reportStem}.html`,
		});
	}
	const summary = {
		base: baseSha,
		head: headSha,
		mergeBase,
		checked,
		skipped,
		failures,
		wallSeconds: (performance.now() - started) / 1000,
	};
	writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
	writeFileSync(
		join(outDir, "index.html"),
		`<!doctype html><meta charset="utf-8"><title>Changed-line mutation reports</title><h1>Changed-line mutation reports</h1><p>${checked.length} file(s) checked; ${failures.length} survivor/error outcome(s).</p><ul>${checked.map((r) => `<li><a href="${basename(r.html)}">${r.file}</a>: ${r.mutants} mutants, ${r.survivors.length} survivors</li>`).join("")}</ul><p>See summary.json for skipped files, revisions and timings.</p>`,
	);
	console.log(
		`mutation-changed: ${checked.length} file(s), ${checked.reduce((n, r) => n + r.mutants, 0)} mutants, ${checked.reduce((n, r) => n + r.survivors.length, 0)} survivors; ${summary.wallSeconds.toFixed(2)} s. Reports: ${outDir}/index.html`,
	);
	if (failures.length)
		console.error(
			failures.join("\n") +
				"\nAdd assertions, or annotate a verified equivalent with // Stryker disable next-line <Mutator>: <why>.",
		);
	return failures.length ? 1 : 0;
}

if (import.meta.main) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			console.error(
				`mutation-changed: ${error.message}. Fetch origin/main before running.`,
			);
			process.exitCode = 2;
		});
}
