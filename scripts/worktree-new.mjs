/**
 * The delivery SOP's step 3 as one command: a node's worktree, ready to test.
 *
 *   node scripts/worktree-new.mjs <node> <branch> [--base <ref>] [--dry-run]
 *
 * Three sessions in one weekend started a node in a fresh worktree, ran a test
 * and read `Cannot find module 'meshoptimizer/simplifier'`: a new worktree
 * has no `node_modules`, and a symlink to the primary checkout's shares its
 * stale install and its `.vite` cache. So this installs from the lockfile.
 *
 * It resolves the base to a SHA after fetching, because `worktree add HEAD`
 * resolves in the directory git runs in — a stale primary checkout handed one
 * session a "fresh" tree of an old commit. And it puts the tree under the
 * primary checkout's `.worktrees/` wherever it is run from.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The commands this would run, in order, without running any of them. */
export function plan(argv, { cwd = process.cwd(), git = gitIn(cwd) } = {}) {
	const args = [...argv];
	const dryRun = args.includes("--dry-run");
	const at = args.indexOf("--base");
	const base = at >= 0 ? args[at + 1] : "origin/main";
	if (at >= 0) args.splice(at, 2);
	const [node, branch] = args.filter((a) => a !== "--dry-run");
	if (!/^\d+$/.test(node ?? "") || !branch || base === undefined)
		throw new Error(
			"usage: node scripts/worktree-new.mjs <node> <branch> [--base <ref>] [--dry-run]",
		);
	const primary = dirname(resolve(cwd, git(["rev-parse", "--git-common-dir"])));
	const path = join(primary, ".worktrees", `seelite-${node}`);
	return {
		dryRun,
		path,
		base,
		steps: [
			["git", ["-C", primary, "fetch", "-q", "origin"]],
			[
				"git",
				[
					"-C",
					primary,
					"worktree",
					"add",
					"--quiet",
					"-b",
					branch,
					path,
					"<sha>",
				],
			],
			["npm", ["ci", "--silent"], path],
		],
	};
}

const gitIn = (cwd) => (args) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	let p;
	try {
		p = plan(process.argv.slice(2));
	} catch (e) {
		console.error(e.message);
		process.exit(2);
	}
	if (existsSync(p.path)) {
		console.error(`refusing: ${p.path} already exists`);
		process.exit(1);
	}
	const [fetch, add, install] = p.steps;
	if (p.dryRun) {
		for (const [cmd, args, cwd] of p.steps)
			console.log(`${cwd ? `(cd ${cwd}) ` : ""}${cmd} ${args.join(" ")}`);
		process.exit(0);
	}
	execFileSync(fetch[0], fetch[1], { stdio: "inherit" });
	const primary = fetch[1][1];
	const sha = gitIn(primary)(["rev-parse", "--verify", `${p.base}^{commit}`]);
	const addArgs = add[1].map((a) => (a === "<sha>" ? sha : a));
	execFileSync(add[0], addArgs, { stdio: "inherit" });
	execFileSync(install[0], install[1], { cwd: install[2], stdio: "inherit" });
	console.log(`ok   ${p.path} at ${sha.slice(0, 8)} (${p.base}), installed`);
}
