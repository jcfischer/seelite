/**
 * Fail a change whose Git LFS objects never reached GitHub (2026-10-19).
 *
 * A push uploads LFS objects only through the `pre-push` hook, and a push
 * that skips hooks (`git push --no-verify`, which ranger's supervisor uses)
 * sends the pointers without them. Nothing then warns: the branch, the PR and
 * the merge look whole, and every later clone gets a pointer where the file
 * should be. So CI asks GitHub's LFS batch API, for every pointer the change
 * adds or modifies, whether the object is there — without downloading it.
 *
 *   node scripts/check-lfs-objects.mjs <base> <head>
 *
 * Needs `GITHUB_TOKEN` and `GITHUB_REPOSITORY` (CI sets both). A missing base
 * commit is fetched at depth 1. Exit 0 when every object is present, 1 when
 * any is missing (each path named, with the command that fixes it).
 */
import { spawnSync } from "node:child_process";

/** The first line of every LFS pointer file. */
export const POINTER_HEADER = "version https://git-lfs.github.com/spec/v1";
/** A pointer is ~130 bytes; a blob far larger than this is the file itself. */
const POINTER_MAX_BYTES = 1024;

function git(args) {
	const r = spawnSync("git", args, { encoding: "utf8", maxBuffer: 2 ** 28 });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout;
}

/** An LFS pointer's object, or null for any other blob. */
export function parsePointer(text) {
	if (!text.startsWith(`${POINTER_HEADER}\n`)) return null;
	const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
	const size = /^size (\d+)$/m.exec(text)?.[1];
	return oid && size ? { oid, size: Number(size) } : null;
}

/** Run one `git cat-file` batch over `specs`, one spec a line. */
function catFile(mode, specs) {
	const r = spawnSync("git", ["cat-file", mode], {
		input: `${specs.join("\n")}\n`,
		maxBuffer: 2 ** 28,
	});
	if (r.status !== 0) throw new Error(`git cat-file ${mode}: ${r.stderr}`);
	return r.stdout;
}

/**
 * The LFS pointers among the files `head` adds or modifies against `base`.
 * `--no-renames`, so a pointer moved to a new path is a new path here rather
 * than a rename the filter drops. Two git calls in all: the sizes, then the
 * contents of the blobs small enough to be pointers.
 */
export function changedPointers(base, head) {
	const paths = git([
		"diff",
		"--name-only",
		"--no-renames",
		"--diff-filter=AM",
		"-z",
		base,
		head,
	])
		.split("\0")
		.filter(Boolean);
	if (!paths.length) return [];
	const sizes = catFile(
		"--batch-check=%(objectsize)",
		paths.map((p) => `${head}:${p}`),
	)
		.toString()
		.trim()
		.split("\n")
		.map(Number);
	const small = paths.filter((_, i) => sizes[i] <= POINTER_MAX_BYTES);
	if (!small.length) return [];
	const out = [];
	const blobs = catFile(
		"--batch",
		small.map((p) => `${head}:${p}`),
	);
	let at = 0;
	for (const path of small) {
		const eol = blobs.indexOf(10, at);
		const size = Number(blobs.subarray(at, eol).toString().split(" ")[2]);
		const object = parsePointer(
			blobs.subarray(eol + 1, eol + 1 + size).toString(),
		);
		if (object) out.push({ path, ...object });
		at = eol + 1 + size + 1;
	}
	return out;
}

/**
 * The pointers whose objects the server does not hold. `batch` posts one
 * batch request and returns the parsed response, so a test can stand in for
 * the server.
 */
export async function missingObjects(pointers, batch) {
	if (!pointers.length) return [];
	const unique = [
		...new Map(
			pointers.map((p) => [p.oid, { oid: p.oid, size: p.size }]),
		).values(),
	];
	const missing = new Set();
	for (let i = 0; i < unique.length; i += 100) {
		const response = await batch({
			operation: "download",
			transfers: ["basic"],
			objects: unique.slice(i, i + 100),
		});
		for (const o of response.objects ?? [])
			if (o.error || !o.actions?.download) missing.add(o.oid);
		// An object the server leaves out of its answer is not known to be there.
		const answered = new Set((response.objects ?? []).map((o) => o.oid));
		for (const o of unique.slice(i, i + 100))
			if (!answered.has(o.oid)) missing.add(o.oid);
	}
	return pointers.filter((p) => missing.has(p.oid));
}

/** GitHub's LFS batch endpoint, authenticated with the run's token. */
function githubBatch(repository, token) {
	return async (body) => {
		const res = await fetch(
			`https://github.com/${repository}.git/info/lfs/objects/batch`,
			{
				method: "POST",
				headers: {
					Accept: "application/vnd.git-lfs+json",
					"Content-Type": "application/vnd.git-lfs+json",
					Authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
				},
				body: JSON.stringify(body),
			},
		);
		if (!res.ok)
			throw new Error(
				`LFS batch request: HTTP ${res.status} ${await res.text()}`,
			);
		return res.json();
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [base, head] = process.argv.slice(2);
	const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repository } = process.env;
	if (!base || !head || !token || !repository) {
		console.error(
			"usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/name node scripts/check-lfs-objects.mjs <base> <head>",
		);
		process.exit(2);
	}
	if (spawnSync("git", ["cat-file", "-e", `${base}^{commit}`]).status !== 0)
		git(["fetch", "--depth=1", "origin", base]);
	const pointers = changedPointers(base, head);
	const missing = await missingObjects(
		pointers,
		githubBatch(repository, token),
	);
	if (missing.length) {
		console.error(
			`${missing.length} of ${pointers.length} LFS objects this change adds are not on GitHub:`,
		);
		for (const m of missing)
			console.error(`  ${m.path}  (${m.oid.slice(0, 12)}, ${m.size} bytes)`);
		console.error(
			"Upload them from the clone that made the commit: git lfs push origin <branch>",
		);
		process.exit(1);
	}
	console.log(
		`ok   ${pointers.length} LFS objects this change adds are on GitHub`,
	);
}
