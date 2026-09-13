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
export const stripComments = (src: string) =>
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

/**
 * Every script under `scripts/` with one of `extensions`, as repo-relative
 * paths. `.mjs` by default, which is every probe.
 *
 * Recursive, and beside {@link srcFiles} for its reason: a flat read plus a
 * hardcoded `scripts/lib` is complete only until somebody adds a directory,
 * and it fails open in exactly the direction a new script arrives from. The
 * extensions are a parameter because `scripts/` holds TypeScript instruments
 * too, and a scan of what a script *does* has to read those (#306).
 */
export const scriptFiles = (extensions: string[] = [".mjs"]): string[] =>
	(readdirSync(repoPath("scripts"), { recursive: true }) as string[])
		.filter((f) => extensions.some((ext) => f.endsWith(ext)))
		.map((f) => `scripts/${f}`);

/**
 * Every call matched by `head`, with the text of each top-level argument.
 *
 * `head` is a global pattern ending at the call's open paren. **A balanced scan
 * from that paren, not `\(\[^)]*,`.** That pattern stops at the first `)`, so
 * `guardedOrigin(originOf(x), ["a.ts"])` reads as single-argument — and a nested
 * call is the shape a leftover argument is most likely to hide behind.
 *
 * A quoted span is text, not structure: without that, `guardedOrigin("a,b")`
 * reads as two arguments, and the escape check is what stops a backslash-escaped
 * quote closing the span early. A template's `${…}` is inside its quote, so a
 * comma there is text too. **A trailing comma is not an argument**: biome wraps
 * a long single-argument call and puts one before the closing paren.
 *
 * One walker for every scanner of call arguments (#306 review): the URL-builder
 * scan needed the first argument's text where `callsWithArgument` needs only a
 * count, and a second walker is the divergence the stripper above was merged to
 * end.
 */
export function callArguments(
	source: string,
	head: RegExp,
): { index: number; args: string[] }[] {
	const calls: { index: number; args: string[] }[] = [];
	for (const m of source.matchAll(head)) {
		const open = m.index + m[0].length - 1;
		const args: string[] = [];
		let depth = 0;
		let quote = "";
		let start = open + 1;
		for (let i = open; i < source.length; i++) {
			const c = source[i];
			if (quote) {
				if (c === "\\") i++;
				else if (c === quote) quote = "";
				continue;
			}
			if (c === '"' || c === "'" || c === "`") quote = c;
			else if ("([{".includes(c)) depth++;
			else if (")]}".includes(c)) {
				if (--depth === 0) {
					args.push(source.slice(start, i));
					break;
				}
			} else if (c === "," && depth === 1) {
				args.push(source.slice(start, i));
				start = i + 1;
			}
		}
		if (args.length > 0 && args[args.length - 1].trim() === "") args.pop();
		calls.push({ index: m.index, args });
	}
	return calls;
}

/**
 * Does `source` call any of `names` with more than one argument?
 *
 * JavaScript swallows an extra argument in silence, so a caller left with a
 * stale one is bit-identical at run time to a cleaned one: nothing but a scan of
 * the text can tell them apart. {@link callArguments} does the scanning.
 *
 * Here rather than inside the one test that wants it (#296 review): a depth
 * counter over source text is general machinery, and this file is where this
 * suite keeps that.
 */
export function callsWithArgument(source: string, names: string[]): boolean {
	const head = new RegExp(`\\b(?:${names.join("|")})\\s*\\(`, "g");
	return callArguments(source, head).some((call) => call.args.length > 1);
}
