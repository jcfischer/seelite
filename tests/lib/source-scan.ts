/**
 * Reading this repository's own source, for the tests that check the text
 * rather than the behaviour.
 *
 * Three files do that — `headless.test.ts` reads import lists,
 * `field-names.test.ts` bans a retired field name, and `source-scan.test.ts`
 * beside this one guards the stripper — and the first two had grown a comment
 * stripper each. They had already
 * diverged: one deleted `//` to end of line unconditionally, which eats the rest
 * of any line carrying `http://`, and the other did not. A stripper that differs
 * between two scanners of the same tree is two answers to "what is code here".
 *
 * Not in `scripts/lib/`, which is node-side probe plumbing the page never
 * imports — its consumers are `probe-*.mjs` and `tests/probe-args.test.ts`.
 * This is test-only and reads the checkout, which is a third thing again.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A path relative to the repository root, as this file can see it. */
export const repoPath = (rel: string) =>
	fileURLToPath(new URL(`../../${rel}`, import.meta.url));

/**
 * The file with its comments removed and **its line numbering intact**.
 *
 * Both halves matter, and the second was a defect review found: deleting a block
 * comment deletes its newlines too, so everything below it shifts up and a
 * `file:line` computed from the result points somewhere else. In a file as
 * heavily commented as `settlements.ts` that is hundreds of lines of drift — in
 * the one output such a test ever produces, aimed at code that has nothing to do
 * with the finding. Block comments are therefore blanked character by character
 * rather than removed, which preserves every newline.
 *
 * No line counts are quoted here on purpose. They were, for a round, and they
 * were already wrong when review measured them: the figures came from one commit
 * and the file moves every time anybody edits it. `tests/source-scan.test.ts`
 * asserts the property instead, which is the thing that has to stay true.
 *
 * **One pass, not two, and that is a fix rather than a tidy-up.** Blanking block
 * comments first and line comments second meant a line comment carrying an
 * unpaired `/*` — as in a line comment mentioning the old block form — opened a
 * block that the first pass then closed at the next `*` + `/` anywhere below,
 * blanking every line of real code in between. The ban read green over all of
 * it, with line numbers intact so nothing else noticed.
 * A single alternation scans left to right, so whichever comment *starts* first
 * claims the text and a `/*` inside a line comment is just characters.
 *
 * The `(?<!:)` refuses a `//` preceded by a colon, which is a URL and not a
 * comment: probes carry `http://localhost:5173` on lines that also carry code,
 * and stripping there deletes the rest of the line. For a ban that is a false
 * *negative*, which is the wrong direction to be wrong in; for an import scan it
 * is a missed dependency, which is the same.
 *
 * What it still does not do: understand strings. A block-comment opener inside a
 * *string literal* will confuse it, as it will any regex-based stripper, and the
 * failure is the blanking one above — silent, and in the unsafe direction.
 *
 * **It was live in this helper's own test file**, which is how close to hand it
 * is: the opener sat in a test *name*, in a file that passes itself to `codeOf`,
 * harmless only because no block comment closed below it. That name is worded
 * around it now, and the reason is recorded there — but nothing stops the next
 * string literal. Fixing it properly means a tokenizer, which is more machinery
 * than three scanners are worth, so it is a limit written down rather than one
 * closed.
 */
const stripComments = (src: string) =>
	src.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\n]*/g, (m) =>
		m.replace(/[^\n]/g, " "),
	);

/** A source file with its comments blanked — {@link stripComments} applied to
 *  {@link repoPath}. */
export const codeOf = (rel: string) =>
	stripComments(readFileSync(repoPath(rel), "utf8"));

/**
 * Every TypeScript module under `src/`, as repo-relative paths.
 *
 * **Recursive**, which is the half a hand-rolled scan keeps getting wrong. The
 * flat `readdirSync(repoPath("src"))` this replaced was complete only because
 * `src/` is flat, and would have stayed silently complete on the day it stopped
 * being — a check that fails open in exactly the direction a new module arrives
 * from.
 *
 * It answers "which modules are under `src/`" for the scanners that ask, in the
 * spirit of the stripper above. It is not the only directory walk in the suite:
 * `nav-list.test.ts` and `crater-profile.test.ts` each keep their own, because
 * they want `Dirent`s and raw bytes rather than a path list.
 */
export const srcFiles = (): string[] =>
	(readdirSync(repoPath("src"), { recursive: true }) as string[])
		.filter((f) => f.endsWith(".ts"))
		.map((f) => `src/${f}`);
