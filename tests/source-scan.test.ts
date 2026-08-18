/**
 * `tests/lib/source-scan.ts` — the comment stripper the source-reading tests
 * go through.
 *
 * **Its own file, beside the helper, and that placement is the point.** In
 * seekolous these assertions started out inside one of the scanners that use
 * the stripper — so the day that scanner's subject became history, every other
 * scanner depending on the same stripper would have been left guarding nothing.
 *
 * What is under test is one property with two halves: comments stop counting as
 * code, and **no line moves**. The second was a live defect — block comments were
 * deleted outright, newlines included, so a `file:line` computed from the result
 * pointed hundreds of lines away in the one output such a test ever produces.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { codeOf, repoPath } from "./lib/source-scan";

/** The most heavily commented file in the project, which is where drift
 *  accumulates and so where the property is worth measuring. */
const SUBJECT = "src/main.ts";
const rawLines = () => readFileSync(repoPath(SUBJECT), "utf8").split("\n");

test("stripping comments moves no line", () => {
	// Asserted as a property rather than as figures. Figures were what the first
	// fix shipped, in a docstring, and they were stale by the time review measured
	// them — `settlements.ts` moves on every edit, and a line count quoted in
	// prose cannot not rot.
	expect(codeOf(SUBJECT).split("\n").length).toBe(rawLines().length);
});

test("a symbol keeps its line number through the strip", () => {
	// The line count alone would pass a stripper that deleted one line and added
	// another. This pins an actual position, below several long block comments.
	const raw = rawLines();
	const stripped = codeOf(SUBJECT).split("\n");
	const lineOf = (lines: string[], needle: string) =>
		lines.findIndex((l) => l.includes(needle));
	// A structural symbol, not a tuning constant. This file exists to outlive any
	// one of the scanners that use the stripper, so pinning something a
	// forthcoming decision node will rename would redden the shared stripper's
	// test over a change it guards nothing about.
	const needle = "class Game {";
	// Asserted present, so a rename cannot turn this into two `-1`s agreeing with
	// each other — the vacuous pass this kind of check falls into.
	expect(lineOf(raw, needle)).toBeGreaterThan(0);
	expect(lineOf(stripped, needle)).toBe(lineOf(raw, needle));
});

test("comments stop counting as code", () => {
	const stripped = codeOf(SUBJECT);
	// Two forms, since the stripper handles them separately. Both of these appear
	// in the subject file's prose and neither should survive.
	expect(stripped).not.toContain("threshold rebasing");
	expect(stripped).not.toContain("stale cached world positions");
});

// A line comment carrying an unpaired /* — half of the fixture below.
const AFTER_AN_UNPAIRED_BLOCK_OPENER = "marker-1f3a";
/** The other half: a real block comment, whose closer is what a two-pass
 *  stripper would pair with the opener above — blanking the marker between
 *  them. Without something closing below it, the greedy block pattern finds no
 *  match and the bug does not bite, which is how the first version of this
 *  fixture managed to pass under both strippers. */

// The name below deliberately avoids spelling the block-comment opener. This
// file passes itself to `codeOf`, and an opener in a *string literal* is the one
// case the stripper still cannot see — so writing it here would plant the very
// hazard `source-scan.ts`'s docstring records, in the file guarding against it.
test("a block-comment opener inside a line comment opens nothing", () => {
	// The hole this replaced, and it failed in the dangerous direction. With
	// block comments blanked in a first pass and line comments in a second, the
	// comment above opened a block that the first pass closed at the next
	// `*` + `/` anywhere below — blanking every line of real code in between,
	// with line numbers intact so nothing else noticed and the ban reading green
	// over all of it.
	//
	// The fixture is this file, read through the same `codeOf` the scanners call,
	// so this tests the reader rather than a copy of its regex.
	const self = codeOf("tests/source-scan.test.ts");
	expect(self).toContain(AFTER_AN_UNPAIRED_BLOCK_OPENER);
	// No paired "and the comment itself is gone" assertion here: a literal
	// naming the fixture's words would put those words in *code* position on this
	// line, so the file would contain them however well the stripper worked. That
	// version of this test failed for that reason and not for the one it claimed.
	// Comment removal is `comments stop counting as code` above.
});

test("a `//` inside a URL is not a comment", () => {
	// The half that matters for a *ban*: the naive strip deletes the rest of any
	// line carrying a URL, so code sharing that line disappears and the scan reads
	// green over it. A false negative, which is the wrong direction for a check
	// whose job is to refuse.
	//
	// **Asserted on what the strip would eat**, which took two attempts. Pinning
	// the probe's origin literal reddened this whenever that probe changed its
	// port. Asserting `process.argv[2]` fixed the brittleness and broke the test:
	// that text sits *before* the `//`, so it survives the unguarded stripper too
	// — measured, both variants keep it. What the strip actually removes is
	// everything after `http:`, so the line's tail is the assertion.
	const probe = codeOf("scripts/probe-boot.mjs");
	const line = probe.split("\n").find((l) => l.includes("process.argv[2]"));
	expect(line).toBeDefined();
	// The statement is not truncated mid-literal: it still closes and terminates.
	// Under the naive strip this line ends at `"http:`.
	expect(line?.trimEnd().endsWith('";')).toBe(true);
});
