/**
 * The SOP's worktree step (`scripts/worktree-new.mjs`), planned not run.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { plan } from "../scripts/worktree-new.mjs";

// A git stub: the common dir of a linked worktree points into the primary.
const git = () => "/repo/.git";
const at = { cwd: "/repo/.worktrees/other", git };

describe("a node's worktree", () => {
	test("goes under the primary checkout's .worktrees, from any worktree", () => {
		expect(plan(["892", "node/892-x"], at).path).toBe(
			"/repo/.worktrees/seelite-892",
		);
	});

	test("fetches, adds at a resolved SHA, then installs from the lockfile", () => {
		const p = plan(["892", "node/892-x"], at);
		expect(p.base).toBe("origin/main");
		expect(p.steps).toEqual([
			["git", ["-C", "/repo", "fetch", "-q", "origin"]],
			[
				"git",
				[
					"-C",
					"/repo",
					"worktree",
					"add",
					"--quiet",
					"-b",
					"node/892-x",
					"/repo/.worktrees/seelite-892",
					"<sha>",
				],
			],
			["npm", ["ci", "--silent"], "/repo/.worktrees/seelite-892"],
		]);
	});

	test("takes another base, and refuses a missing node or branch", () => {
		expect(plan(["7", "b", "--base", "origin/feat"], at).base).toBe(
			"origin/feat",
		);
		expect(() => plan(["b"], at)).toThrow("usage");
		expect(() => plan(["7"], at)).toThrow("usage");
		expect(() => plan(["7", "b", "--base"], at)).toThrow("usage");
	});

	test("--dry-run prints the plan and changes nothing", () => {
		const run = spawnSync(
			"node",
			["scripts/worktree-new.mjs", "999999", "x/never", "--dry-run"],
			{ encoding: "utf8" },
		);
		expect(run.status).toBe(0);
		expect(run.stdout).toContain("worktree add --quiet -b x/never");
		expect(run.stdout).toContain("seelite-999999 <sha>");
		expect(run.stdout).toContain("npm ci");
	});
});
