import { describe, expect, test } from "bun:test";
import { Linter } from "eslint";
import { seeliteLint } from "../scripts/eslint/seelite.mjs";

const linter = new Linter({ configType: "flat" });

function stacked(code: string, file = "x.ts"): number[] {
	return linter
		.verify(code, [{ files: ["**/*.ts", "**/*.mjs"], ...seeliteLint }], file)
		.filter((m) => m.ruleId === "seelite/no-stacked-docs")
		.map((m) => m.line);
}

describe("seelite/no-stacked-docs", () => {
	test("flags a doc left above a declaration inserted under it", () => {
		const code = [
			"export const a = 1;",
			"/** The rotation that takes `from` onto `want`. */",
			"/** The roll about the nose. */",
			"const bankAbout = () => 0;",
			"export function attitudeError() { return bankAbout(); }",
		].join("\n");
		expect(stacked(code)).toEqual([2]);
	});

	test("flags each doc in a stack of three but the last", () => {
		const code =
			"export const a = 1;\n/** a */\n/** b */\n/** c */\nexport const x = 1;";
		expect(stacked(code)).toEqual([2, 3]);
	});

	test("keeps a module header, typedefs and a tag-only type block", () => {
		const code = [
			"/** Module header. */",
			"/** Parses a run id. */",
			"export function parse(id: string) { return id; }",
			"/** @typedef {{ x: number }} Point */",
			"/** The levers. */",
			"/** @type {Readonly<Record<number, string>>} */",
			"export const LEVERS = {};",
		].join("\n");
		expect(stacked(code, "x.mjs")).toEqual([]);
	});

	test("flags a stale doc above a tag-only @param block", () => {
		const code = [
			"export const a = 1;",
			"/** Stale. */",
			"/** @param {number} x Input. */",
			"export function f(x: number) { return x; }",
		].join("\n");
		expect(stacked(code)).toEqual([2]);
	});

	test("ignores a line comment between two declarations", () => {
		expect(
			stacked("/** a */\nexport const x = 1;\n/** b */\nexport const y = 2;"),
		).toEqual([]);
	});
});
