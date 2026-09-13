/**
 * No source file holds a literal NUL byte. Write the `\0` escape instead.
 *
 * `save-store.ts` carried six of them as the record key separator, and the
 * runtime string was right. The bytes still broke three tools that read the
 * source rather than run it:
 * - Search tools treat the file as binary.
 * - The Read tool renders the byte as a space, so an edit that spans it cannot
 *   match. `assertSlot` refused a space for two rounds of #309 because its
 *   check was written from what the Read tool showed.
 * - The Soma policy guard passes a review prompt through an environment
 *   variable. That variable cannot hold a NUL, so every sage lens on the
 *   Claude substrate stopped before it read the diff (#309).
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { repoPath } from "./lib/source-scan";

/** Every text file the repo's tools read under these trees, not only the
 *  TypeScript ones: `src/` holds `.js` modules and `tests/` holds fixtures. */
const TEXT_EXTENSIONS = [".ts", ".mjs", ".js", ".json"];
const textFiles = (dir: string): string[] =>
	(readdirSync(repoPath(dir), { recursive: true }) as string[])
		.filter((f) => TEXT_EXTENSIONS.some((ext) => f.endsWith(ext)))
		.map((f) => `${dir}/${f}`);

test("no source file holds a literal NUL byte", () => {
	const files = ["src", "scripts", "tests"].flatMap(textFiles);
	expect(files.length).toBeGreaterThan(100);
	expect(files.filter((f) => f.endsWith(".json")).length).toBeGreaterThan(0);
	const withNul = files.filter((f) => readFileSync(repoPath(f)).includes(0));
	expect(withNul).toEqual([]);
});
