import { describe, expect, test } from "bun:test";
import { Linter } from "eslint";
import { seeliteLint } from "../scripts/eslint/seelite.mjs";

const linter = new Linter({ configType: "flat" });

function flagged(code: string, file = "x.ts"): number[] {
	return linter
		.verify(code, [{ files: ["**/*.ts", "**/*.mjs"], ...seeliteLint }], file)
		.filter((m) => m.ruleId === "seelite/no-comments")
		.map((m) => m.line);
}

describe("seelite/no-comments", () => {
	test("flags narration, banners, corpses and doc comments on private code", () => {
		const code = [
			"// the principal said never call this twice",
			"const a = 1; // bump",
			"/* ---- helpers ---- */",
			"// const old = legacy();",
			"/** Adds one. */",
			"function inc(n: number) { return n + a; }",
			"inc(1);",
		].join("\n");
		expect(flagged(code)).toEqual([1, 2, 3, 4, 5]);
	});

	test("keeps doc comments on exports, URLs, references, tool directives and a license header", () => {
		const code = [
			"// SPDX-License-Identifier: MIT",
			'/// <reference types="vite/client" />',
			"/** Parses a run id. */",
			"export function parse(id: string) { return id; }",
			"/** The default lane. */",
			'export const LANE = "headless";',
			"// bun drops the flag here: https://github.com/oven-sh/bun/issues/1",
			"// biome-ignore lint/suspicious/noExplicitAny: the vendor type is wrong",
			"const grid: any = [1, 0];",
			"const m = import(/* @vite-ignore */ String(grid));",
			"parse(String(m));",
		].join("\n");
		expect(flagged(code)).toEqual([]);
	});

	test("ignores comment markers inside strings, templates and regexes", () => {
		const code = [
			'const s = "// not a comment";',
			"const t = `/* nope */ ${s}`;",
			"const r = /\\/\\/x/;",
			"void [t, r];",
		].join("\n");
		expect(flagged(code)).toEqual([]);
	});

	test("flags type-check suppressions, which name the fix", () => {
		const code =
			"// @ts-ignore\nconst a: number = 1;\n// @ts-expect-error wrong on purpose\nconst b: number = 2;\nvoid [a, b];\n";
		expect(flagged(code)).toEqual([1, 3]);
	});

	test("lints plain JavaScript scripts too", () => {
		expect(flagged("// run it\nconsole.log(1);\n", "x.mjs")).toEqual([1]);
	});

	test("ignores a shebang", () => {
		expect(flagged("#!/usr/bin/env node\nconsole.log(1);\n", "x.mjs")).toEqual(
			[],
		);
	});
});
