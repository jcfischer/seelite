/**
 * No source file holds a literal NUL byte. Write the `\0` escape instead.
 *
 * `save-store.ts` carried six of them as the record key separator, and the
 * runtime string was right. The bytes still broke three tools that read the
 * source rather than run it:
 * - Search tools treat the file as binary.
 * - The Read tool renders the byte as a space, so an edit that spans it cannot
 *   match.
 * - The Soma policy guard passes a review prompt through an environment
 *   variable. That variable cannot hold a NUL, so every sage lens on the
 *   Claude substrate stopped before it read the diff (#309).
 */
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { repoPath, scriptFiles, srcFiles } from "./lib/source-scan";

const testFiles = (): string[] =>
	(readdirSync(repoPath("tests"), { recursive: true }) as string[])
		.filter((f) => f.endsWith(".ts"))
		.map((f) => `tests/${f}`);

test("no source file holds a literal NUL byte", () => {
	const files = [
		...srcFiles(),
		...scriptFiles([".mjs", ".ts"]),
		...testFiles(),
	];
	expect(files.length).toBeGreaterThan(100);
	const withNul = files.filter((f) => readFileSync(repoPath(f)).includes(0));
	expect(withNul).toEqual([]);
});
