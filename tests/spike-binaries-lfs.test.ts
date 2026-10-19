/**
 * Study binaries under `spikes/` are in Git LFS (principal, 2026-10-19).
 *
 * Review models, scenes and images are not production assets, and as plain
 * blobs every clone carries them for good: PR #1037 nearly put 371 MB of the
 * nine station studies into `main`. `.gitattributes` names the rule; these
 * rows hold the index to it, so a binary committed where the LFS filter did
 * not run (a clone without `filter.lfs.*`, a rule that missed a new type) is
 * red here rather than in every later clone.
 *
 * The exemptions are the study models a headless test reads: CI pulls no
 * spike objects, so an LFS pointer there would be read as the model. Each
 * exemption must be earned by a reader, and every reader's path must be
 * exempt, so the two lists cannot drift apart.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BINARY = /\.(blend|glb|png|jpg|webp|bin)$/;
const POINTER = "version https://git-lfs.github.com/spec/v1";

function git(args: string[], input?: string): string {
	const r = spawnSync("git", args, { encoding: "utf8", input });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
	return r.stdout;
}

/** Every tracked study binary, with what the index stores for it. */
function trackedSpikeBinaries(): { path: string; pointer: boolean }[] {
	const paths = git(["ls-files", "-z", "spikes"])
		.split("\0")
		.filter((p) => BINARY.test(p));
	// One `cat-file --batch` for all of them: the first line of each blob.
	const out = spawnSync("git", ["cat-file", "--batch"], {
		input: paths.map((p) => `:${p}`).join("\n") + "\n",
		maxBuffer: 2 ** 31,
	}).stdout as Buffer;
	const result: { path: string; pointer: boolean }[] = [];
	let at = 0;
	for (const path of paths) {
		const header = out.subarray(at, out.indexOf(10, at)).toString();
		const size = Number(header.split(" ")[2]);
		const start = out.indexOf(10, at) + 1;
		result.push({
			path,
			pointer: out
				.subarray(start, start + POINTER.length)
				.toString()
				.startsWith(POINTER),
		});
		at = start + size + 1;
	}
	return result;
}

/** The paths `.gitattributes` exempts from the spike rule. */
function exemptions(): string[] {
	return readFileSync(".gitattributes", "utf8")
		.split("\n")
		.filter((l) => l.startsWith("spikes/") && l.includes("!filter"))
		.map((l) => l.split(/\s+/)[0]);
}

/** Every tracked `spikes/…` binary a test or a script names as a literal (a
 *  made-up path in a test fixture names no file). */
function namedReaders(): Map<string, string[]> {
	const named = new Map<string, string[]>();
	const tracked = new Set(git(["ls-files", "-z", "spikes"]).split("\0"));
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((n) => {
			const p = join(dir, n);
			return statSync(p).isDirectory() ? walk(p) : [p];
		});
	for (const file of [...walk("tests"), ...walk("scripts")]) {
		if (
			!/\.(ts|mjs)$/.test(file) ||
			file.endsWith("spike-binaries-lfs.test.ts")
		)
			continue;
		const text = readFileSync(file, "utf8");
		for (const m of text.matchAll(/["'`](spikes\/[\w./-]+)["'`]/g))
			if (BINARY.test(m[1]) && tracked.has(m[1]))
				named.set(m[1], [...(named.get(m[1]) ?? []), file]);
	}
	// `tests/helpers/read-coriolis-glb.ts` builds its path from a prefix.
	for (const m of walk("tests")
		.map((f) => readFileSync(f, "utf8"))
		.join("\n")
		.matchAll(/readCoriolisGlb\(\s*"([\w.-]+\.glb)"/g))
		if (m[1] !== "coriolis-industrial-flight.glb")
			named.set(`spikes/coriolis/${m[1]}`, [
				"tests/helpers/read-coriolis-glb.ts",
			]);
	return named;
}

describe("study binaries under spikes/ are in Git LFS", () => {
	const tracked = trackedSpikeBinaries();
	const exempt = new Set(exemptions());

	test("every tracked study binary is an LFS pointer, unless exempt", () => {
		expect(tracked.length).toBeGreaterThan(0);
		const plain = tracked
			.filter(({ path, pointer }) => !pointer && !exempt.has(path))
			.map(({ path }) => path);
		expect(plain).toEqual([]);
	});

	test("an exempt binary is stored plain, so CI reads the model", () => {
		const pointed = tracked
			.filter(({ path, pointer }) => pointer && exempt.has(path))
			.map(({ path }) => path);
		expect(pointed).toEqual([]);
	});

	test("every exemption has a reader, and every reader's file is exempt", () => {
		const readers = namedReaders();
		expect([...exempt].filter((p) => !readers.has(p))).toEqual([]);
		expect([...readers.keys()].filter((p) => !exempt.has(p)).sort()).toEqual(
			[],
		);
	});
});
