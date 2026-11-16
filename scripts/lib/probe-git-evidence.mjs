import { execFileSync } from "node:child_process";

const git = (cwd, args, options = {}) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		...options,
	});

/** Read source objects in one batch, without checking out or running either ref. */
export function readSourceSnapshot(ref, cwd) {
	const files = git(cwd, [
		"ls-tree",
		"-rz",
		"--name-only",
		ref,
		"--",
		"src",
		"scripts",
		"spikes",
	])
		.split("\0")
		.filter((p) => /\.(ts|js|mjs|css|json)$/.test(p));
	const data = git(cwd, ["cat-file", "--batch"], {
		encoding: null,
		input: files.map((file) => `${ref}:${file}\n`).join(""),
	});
	const sources = new Map();
	let offset = 0;
	for (const file of files) {
		const lineEnd = data.indexOf(10, offset);
		const header = data.subarray(offset, lineEnd).toString();
		const size = Number(header.split(" ")[2]);
		if (!Number.isSafeInteger(size))
			throw new Error(`Unreadable source object: ${file}`);
		offset = lineEnd + 1;
		sources.set(file, data.subarray(offset, offset + size).toString());
		offset += size + 1;
	}
	return sources;
}

export function readImpactEvidence(base, head, cwd) {
	const resolve = (ref) =>
		git(cwd, [
			"rev-parse",
			"--verify",
			"--end-of-options",
			`${ref}^{commit}`,
		]).trim();
	const headOid = resolve(head);
	const baseOid = git(cwd, ["merge-base", resolve(base), headOid]).trim();
	return {
		...readGitEvidence(baseOid, headOid, cwd),
		baseOid,
		headOid,
		impact: {
			before: readSourceSnapshot(baseOid, cwd),
			after: readSourceSnapshot(headOid, cwd),
		},
	};
}

/** A selected gate must run the exact reviewed tree, including its probe code. */
export function assertRunnableHead(headOid, cwd) {
	if (git(cwd, ["rev-parse", "HEAD"]).trim() !== headOid)
		throw new Error(
			"Selected head is not the checked-out HEAD; refusing to probe a different tree.",
		);
	const dirty = git(cwd, ["status", "--porcelain", "--untracked-files=all"]);
	if (dirty.trim())
		throw new Error(
			"Commit or isolate working-tree changes before running the PR gate; selection describes committed HEAD.",
		);
}

/**
 * Read every path affected by a PR range. Rename detection is disabled so both
 * the removed runtime path and its destination remain visible to the selector.
 *
 * @param {string} base
 * @param {string} head
 * @param {string} cwd
 */
export function readGitEvidence(base, head, cwd) {
	const range = `${base}...${head}`;
	return {
		changedFiles: execFileSync(
			"git",
			["diff", "--name-only", "--no-renames", range],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean),
	};
}
