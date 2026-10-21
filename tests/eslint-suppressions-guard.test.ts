import { describe, expect, test } from "bun:test";
import { grownSuppressions } from "../scripts/eslint/suppressions-guard.mjs";

const base = {
	"src/a.ts": { "seelite/no-comments": { count: 3 } },
	"src/b.ts": { "seelite/no-comments": { count: 2 } },
};

describe("suppressions guard", () => {
	test("passes when the baseline shrinks", () => {
		expect(
			grownSuppressions(base, {
				"src/a.ts": { "seelite/no-comments": { count: 1 } },
			}),
		).toEqual([]);
	});

	test("passes a rename git reports, counts carried to the new path", () => {
		const head = {
			"src/a-moved.ts": base["src/a.ts"],
			"src/b.ts": base["src/b.ts"],
		};
		expect(
			grownSuppressions(base, head, {
				renames: new Map([["src/a.ts", "src/a-moved.ts"]]),
			}),
		).toEqual([]);
	});

	test("fails when --suppress-all adds violations in a new file", () => {
		const head = {
			...base,
			"src/c.ts": { "seelite/no-comments": { count: 4 } },
		};
		expect(grownSuppressions(base, head)).toEqual([
			"src/c.ts seelite/no-comments: 0 -> 4",
		]);
	});

	test("fails a new comment paid for by a removed one elsewhere", () => {
		const head = {
			"src/a.ts": { "seelite/no-comments": { count: 2 } },
			"src/b.ts": { "seelite/no-comments": { count: 3 } },
		};
		expect(grownSuppressions(base, head)).toEqual([
			"src/b.ts seelite/no-comments: 2 -> 3",
		]);
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
			grownSuppressions(base, head, {
				enabledOnBase: (rule: string) => rule !== "seelite/other",
			}),
		).toEqual([]);
	});

	test("a rule the base already suppresses counts as enabled whatever the config text says", () => {
		const head = {
			...base,
			"src/c.ts": { "seelite/no-comments": { count: 1 } },
		};
		expect(
			grownSuppressions(base, head, { enabledOnBase: () => false }),
		).toEqual(["src/c.ts seelite/no-comments: 0 -> 1"]);
	});
});
