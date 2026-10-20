import { describe, expect, test } from "bun:test";
import { grownRules } from "../scripts/eslint/suppressions-guard.mjs";

const base = {
	"src/a.ts": { "seelite/no-comments": { count: 3 } },
	"src/b.ts": { "seelite/no-comments": { count: 2 } },
};

describe("suppressions guard", () => {
	test("passes when the baseline shrinks", () => {
		expect(
			grownRules(base, { "src/a.ts": { "seelite/no-comments": { count: 1 } } }),
		).toEqual([]);
	});

	test("passes a rename that moves counts to a new path", () => {
		const head = {
			"src/a-moved.ts": base["src/a.ts"],
			"src/b.ts": base["src/b.ts"],
		};
		expect(grownRules(base, head)).toEqual([]);
	});

	test("fails when --suppress-all adds violations", () => {
		const head = {
			...base,
			"src/c.ts": { "seelite/no-comments": { count: 4 } },
		};
		expect(grownRules(base, head)).toEqual(["seelite/no-comments: 5 -> 9"]);
	});

	test("fails on a rule the base never suppressed", () => {
		const head = {
			...base,
			"src/b.ts": {
				"seelite/no-comments": { count: 2 },
				"seelite/other": { count: 1 },
			},
		};
		expect(grownRules(base, head)).toEqual(["seelite/other: 0 -> 1"]);
	});

	test("passes the first baseline of a rule the base config does not enable", () => {
		const head = {
			...base,
			"src/b.ts": {
				"seelite/no-comments": { count: 2 },
				"seelite/other": { count: 2 },
			},
		};
		expect(
			grownRules(base, head, (rule: string) => rule !== "seelite/other"),
		).toEqual([]);
	});
});
