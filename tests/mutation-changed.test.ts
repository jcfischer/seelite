import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseWorkflow, commandOf } from "./lib/workflow-scan";
import {
	changedRanges,
	moduleIndex,
	mutableReason,
	testsFor,
	survivors,
	strykerConfig,
	mutationConcurrency,
} from "../scripts/mutation-changed";

describe("changed-line mutation selection", () => {
	test("field-collision selects its fast same-stem file instead of the flight timing rows", () => {
		const paths = [
			"src/field-collision.ts",
			"tests/field-flight-collision.test.ts",
			"tests/field-collision.test.ts",
		];
		const index = moduleIndex(
			new Map(paths.map((path) => [path, readFileSync(path, "utf8")])),
		);
		expect(testsFor("src/field-collision.ts", index)).toEqual([
			"tests/field-collision.test.ts",
		]);
	});

	test("CI runs mutation only on PRs, remains advisory and uploads reports even on survivors", () => {
		const workflow = parseWorkflow(".github/workflows/ci.yml");
		const job = workflow.jobs.find((job) => job.name === "mutation-changed");
		expect(job?.condition).toBe("${{ github.event_name == 'pull_request' }}");
		expect(job?.continueOnError).toBe("true");
		expect(job?.needs ?? []).toEqual([]);
		const steps = workflow.steps.filter(
			(step) => step.job === "mutation-changed",
		);
		expect(steps.map(commandOf)).toContain("npm run test:mutation:changed");
		expect(steps.map(commandOf)).toContain("npm run test:mutation:control");
		expect(
			steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"))
				?.condition,
		).toBe("always()");
	});
	test("uses head line ranges, including additions, but no deleted lines", () => {
		const diff = [
			"+++ b/src/a.ts",
			"@@ -3,2 +3,3 @@",
			"-old",
			"+one",
			"+two",
			"+three",
			"@@ -10 +11 @@",
			"-old",
			"+new",
			"@@ -20,2 +20,0 @@",
			"-gone",
			"-gone too",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-gone",
			"+++ b/src/new.ts",
			"@@ -0,0 +1 @@",
			"+new",
		].join("\n");
		expect([...changedRanges(diff)]).toEqual([
			[
				"src/a.ts",
				[
					{ start: 3, end: 5 },
					{ start: 11, end: 11 },
				],
			],
			["src/new.ts", [{ start: 1, end: 1 }]],
		]);
	});

	test("a trailing comment burn-down does not mutate untouched code", () => {
		expect([
			...changedRanges(
				"+++ b/src/a.ts\n@@ -1 +1 @@\n-const x = 1; // old\n+const x = 1;",
			),
		]).toEqual([]);
		expect([
			...changedRanges(
				'+++ b/src/a.ts\n@@ -1 +1 @@\n-const x = "// old";\n+const x = "// new";',
			),
		]).toHaveLength(1);
	});

	test("selects reaching colocated tests first; never trusts a matching filename alone", () => {
		const index = moduleIndex(
			new Map([
				["src/a.ts", "export const a = 1;"],
				["src/barrel.ts", 'export { a } from "./a";'],
				["tests/a.test.ts", 'import { a } from "../src/a";'],
				["tests/a-extra.test.ts", 'import { a } from "../src/barrel";'],
				["tests/a-unrelated.test.ts", "const a = 1;"],
				["tests/other.test.ts", 'import "../src/a";'],
			]),
		);
		expect(testsFor("src/a.ts", index)).toEqual([
			"tests/a.test.ts",
			"tests/a-extra.test.ts",
		]);
	});

	test("follows runtime imports, exports and dynamic imports, caps at eight, stops at depth three", () => {
		const files = new Map([
			["src/a.ts", "export const a = 1;"],
			["src/b.ts", 'export * from "./a.js";'],
			["src/c.ts", 'const a = import("./b");'],
			["src/d.ts", 'import "./c";'],
			["tests/deep.test.ts", 'import "../src/d";'],
			["tests/types.test.ts", 'import type { a } from "../src/a";'],
			["tests/comment.test.ts", '// import "../src/a";'],
		]);
		for (let i = 0; i < 10; i++)
			files.set(`tests/test-${i}.test.ts`, 'import "../src/c";');
		expect(testsFor("src/a.ts", moduleIndex(files))).toEqual(
			Array.from({ length: 8 }, (_, i) => `tests/test-${i}.test.ts`),
		);
		expect(testsFor("src/a.ts", moduleIndex(files), 2)).toEqual([]);
	});

	test("includes tested pure src modules and excludes render, shader, DOM and browser dependencies", () => {
		const files = new Map([
			["src/market.ts", "export const price = 1;"],
			[
				"src/types-only.ts",
				'import type { Mesh } from "three"; export const price = 1;',
			],
			[
				"src/mesh.ts",
				'import { Mesh } from "three"; export const m = new Mesh();',
			],
			["src/wrapper.ts", 'export * from "./mesh";'],
			["src/dom.ts", 'export const el = document.createElement("div");'],
			[
				"src/canvas.ts",
				"export function draw(ctx: CanvasRenderingContext2D) { ctx.stroke(); }",
			],
			["src/star.glsl.ts", 'export const shader = "void main() {}";'],
			["src/effect-shaders.ts", 'export const shader = "void main() {}";'],
			["src/untested.ts", "export const price = 1;"],
			[
				"tests/pure.test.ts",
				'import "../src/market"; import "../src/types-only";',
			],
			[
				"tests/geometry.test.ts",
				'import "../src/wrapper"; import "../src/dom"; import "../src/canvas"; import "../src/star.glsl"; import "../src/effect-shaders";',
			],
		]);
		const index = moduleIndex(files);
		for (const file of ["src/market.ts", "src/types-only.ts"])
			expect(mutableReason(file, index)).toBeNull();
		for (const file of [
			"src/mesh.ts",
			"src/wrapper.ts",
			"src/dom.ts",
			"src/canvas.ts",
			"src/star.glsl.ts",
			"src/effect-shaders.ts",
			"src/untested.ts",
			"tests/pure.test.ts",
		])
			expect(mutableReason(file, index), file).not.toBeNull();
	});

	test("reports every survivor with location and replacement", () => {
		expect(
			survivors({
				files: {
					"src/a.ts": {
						mutants: [
							{
								status: "Killed",
								mutatorName: "BooleanLiteral",
								location: { start: { line: 1 } },
							},
							{
								status: "Survived",
								mutatorName: "EqualityOperator",
								replacement: "x < 1",
								location: { start: { line: 4 } },
							},
							{
								status: "Survived",
								mutatorName: "BlockStatement",
								replacement: "{}",
								location: { start: { line: 9 } },
							},
						],
					},
				},
			}),
		).toEqual([
			"src/a.ts:4 EqualityOperator -> x < 1",
			"src/a.ts:9 BlockStatement -> {}",
		]);
	});

	test("type-only named imports and exports do not create runtime edges, but mixed and default imports do", () => {
		const index = moduleIndex(
			new Map([
				["src/a.ts", "export const a = 1;"],
				["tests/types.test.ts", 'import { type a } from "../src/a";'],
				["src/types.ts", 'export { type a } from "./a";'],
				["tests/mixed.test.ts", 'import { type T, a } from "../src/a";'],
				["tests/default.test.ts", 'import a, { type T } from "../src/a";'],
				["src/mixed.ts", 'export { type T, a } from "./a";'],
				["src/empty.ts", 'export {} from "./a";'],
				["src/empty-import.ts", 'import {} from "./a";'],
			]),
		);
		for (const file of ["tests/types.test.ts", "src/types.ts"])
			expect(index.get(file)?.imports).toEqual([]);
		for (const file of [
			"tests/mixed.test.ts",
			"tests/default.test.ts",
			"src/mixed.ts",
			"src/empty.ts",
			"src/empty-import.ts",
		])
			expect(index.get(file)?.imports).toEqual(["src/a.ts"]);
	});

	test("mutation worker count defaults to one and accepts only positive safe integers", () => {
		expect(mutationConcurrency(undefined)).toBe(1);
		for (const value of ["1", "2", "3"])
			expect(mutationConcurrency(value)).toBe(Number(value));
		for (const value of [
			"",
			"0",
			"-1",
			"1.5",
			"NaN",
			"Infinity",
			"many",
			"9007199254740992",
		])
			expect(() => mutationConcurrency(value)).toThrow("MUTATION_CONCURRENCY");
		expect(
			strykerConfig(
				"src/a.ts",
				[{ start: 1, end: 1 }],
				["tests/a.test.ts"],
				"reports/a",
				2,
			).concurrency,
		).toBe(2);
	});

	test("config uses only changed ranges and selected tests, no worktree mutation or coverage", () => {
		const config = strykerConfig(
			"src/a.ts",
			[{ start: 4, end: 6 }],
			["tests/a.test.ts"],
			"reports/mutation/changed/a",
		);
		expect(config.mutate).toEqual(["src/a.ts:4-6"]);
		expect(config.testRunner).toBe("command");
		expect(config.commandRunner.command).toBe(
			"bun test --timeout=60000 'tests/a.test.ts'",
		);
		expect(config.coverageAnalysis).toBe("off");
		expect(config.concurrency).toBe(1);
		expect(config.reporters).toContain("html");
		expect(config.reporters).toContain("json");
		expect(config.cleanTempDir).toBe("always");
		expect(config.thresholds.break).toBeNull();
	});
});
