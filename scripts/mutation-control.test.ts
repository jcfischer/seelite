import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
	copyFileSync,
	symlinkSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("real CLI reports a weak assertion's survivor, kills it with boundary assertions, and leaves source bytes alone", () => {
	const root = mkdtempSync(join(tmpdir(), "seelite-mutation-control-"));
	const run = (args: string[], expected = 0, base = "HEAD^") => {
		const result = spawnSync(args[0], args.slice(1), {
			cwd: root,
			encoding: "utf8",
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "Mutation control",
				GIT_AUTHOR_EMAIL: "mutation-control@example.invalid",
				GIT_COMMITTER_NAME: "Mutation control",
				GIT_COMMITTER_EMAIL: "mutation-control@example.invalid",
				MUTATION_BASE_REF: base,
				MUTATION_HEAD_REF: "HEAD",
			},
		});
		expect(
			result.status,
			`${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
		).toBe(expected);
		return result;
	};
	const git = (...args: string[]) =>
		run(["git", "-c", "core.hooksPath=/dev/null", ...args]);
	const write = (path: string, text: string) =>
		writeFileSync(join(root, path), text);
	try {
		for (const dir of ["src", "tests", "scripts"]) mkdirSync(join(root, dir));
		symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
		copyFileSync(
			"scripts/mutation-changed.ts",
			join(root, "scripts/mutation-changed.ts"),
		);
		write(".gitignore", "node_modules\nreports/\n.stryker-tmp/\n");
		write(
			"package.json",
			JSON.stringify({
				type: "module",
				scripts: { "test:mutation:changed": "bun scripts/mutation-changed.ts" },
			}),
		);
		write(
			"src/positive.ts",
			"export const untouched = 42;\nexport function positive(value: number) { return value >= 1; }\n",
		);
		write(
			"tests/positive.test.ts",
			'import { expect, test } from "bun:test";\nimport { positive } from "../src/positive";\ntest("positive", () => expect(typeof positive(1)).toBe("boolean"));\n',
		);
		git("init", "--quiet");
		git("add", ".");
		git("commit", "--quiet", "-m", "Control base");
		const source =
			"export const untouched = 42;\nexport function positive(value: number) { return value > 0; }\n";
		write("src/positive.ts", source);
		git("add", ".");
		git("commit", "--quiet", "-m", "Control changed predicate");
		const weak = run(["npm", "run", "test:mutation:changed"], 1);
		expect(weak.stderr).toContain(
			"src/positive.ts:2 EqualityOperator -> value >= 0",
		);
		const reportDir = join(root, "reports/mutation/changed");
		const summary = JSON.parse(
			readFileSync(join(reportDir, "summary.json"), "utf8"),
		);
		expect(summary.checked[0].survivors.length).toBeGreaterThan(0);
		const report = JSON.parse(
			readFileSync(join(reportDir, "src_positive_ts.json"), "utf8"),
		);
		expect(
			report.files["src/positive.ts"].mutants.every(
				(m: { location: { start: { line: number } } }) =>
					m.location.start.line === 2,
			),
		).toBe(true);
		expect(readFileSync(join(root, "src/positive.ts"), "utf8")).toBe(source);
		write(
			"tests/positive.test.ts",
			'import { expect, test } from "bun:test";\nimport { positive } from "../src/positive";\ntest("positive", () => { expect(positive(1)).toBe(true); expect(positive(0)).toBe(false); expect(positive(-1)).toBe(false); });\n',
		);
		git("add", ".");
		git("commit", "--quiet", "-m", "Control boundary assertions");
		run(["npm", "run", "test:mutation:changed"], 0, "HEAD~2");
		const killed = JSON.parse(
			readFileSync(join(reportDir, "summary.json"), "utf8"),
		);
		console.log(
			JSON.stringify({
				control: {
					weak: {
						mutants: summary.checked[0].mutants,
						survivors: summary.checked[0].survivors.length,
						wallSeconds: summary.wallSeconds,
						survivingMutants: summary.checked[0].survivors,
					},
					strong: {
						mutants: killed.checked[0].mutants,
						survivors: killed.checked[0].survivors.length,
						wallSeconds: killed.wallSeconds,
					},
				},
			}),
		);
		expect(killed.checked[0].mutants).toBeGreaterThan(0);
		expect(killed.checked[0].survivors).toEqual([]);
		expect(readFileSync(join(root, "src/positive.ts"), "utf8")).toBe(source);
		expect(git("status", "--porcelain").stdout.trim()).toBe("");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 180_000);
