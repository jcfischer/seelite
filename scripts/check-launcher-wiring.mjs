/**
 * Does every script that opens a browser actually get the launcher it calls?
 *
 * Asserting the positive, because absence is the wrong thing to measure: a file
 * where `chromium.launch(` became `launchChromium(` without gaining the import
 * passes any "nothing resolves Playwright itself" grep, passes `npm run build`
 * (which compiles `src/`, not `scripts/`), and dies at a `ReferenceError` the
 * first time it runs. So for every caller the name must be bound by an import
 * that resolves to this directory's `probe-guard.mjs`.
 *
 * The call-site floor is asserted rather than printed, because a scan that finds
 * no files otherwise reports "all N are fine" for N of zero — and this stands in
 * for actually running most of the scripts it covers, so a green run has to be
 * distinguishable from an empty one.
 *
 * Run by `npm run probe`, ahead of the suite — a check nothing invokes is a
 * one-time measurement, and this one is standing in for actually running most of
 * the scripts it covers.
 *
 * Static, and limited to that in two ways. It proves the name is bound, not that
 * a script's own logic holds — only running a probe proves that. And it reads the
 * files with regexes rather than a parser, so a string literal containing `//` or
 * `import {` would shift the result; that is an acceptable trade for a gate that
 * has to run before the suite, not a claim to be a lexer. #147 has the history.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { PLAYWRIGHT_ENV_VARS } from "./probe-guard.mjs";

const SELF = fileURLToPath(import.meta.url);
const DIR = dirname(SELF);
const GUARD = join(DIR, "probe-guard.mjs");

/**
 * Every script that could open a browser, `scripts/lib/` included.
 *
 * Recursive because a helper under `lib/` is a script like any other: one that
 * called the launcher without importing it would fail the same way, and a
 * top-level-only scan would report success over it.
 */
const scripts = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? scripts(join(dir, e.name))
			: e.name.endsWith(".mjs")
				? [join(dir, e.name)]
				: [],
	);

/**
 * The names an import of *this* `probe-guard.mjs` brings into scope.
 *
 * The specifier is resolved against the importing file and compared to the guard's
 * real path, rather than matched by suffix. A `lib/` helper reaching for
 * `./probe-guard.mjs` when it needs `../probe-guard.mjs` writes a string that
 * looks right and dies at `ERR_MODULE_NOT_FOUND`; suffix-matching calls that
 * bound, which would leave this check attesting to a spelling rather than to a
 * binding.
 */
const importedFromGuard = (src, from) => {
	const names = new Set();
	const re = /import\s*\{([^}]*)\}\s*from\s*["']([^"']*probe-guard\.mjs)["']/g;
	for (const [, list, spec] of src.matchAll(re)) {
		if (resolve(dirname(from), spec) !== GUARD) continue;
		for (const raw of list.split(",")) {
			const name = raw
				.trim()
				.split(/\s+as\s+/)
				.pop()
				?.trim();
			if (name) names.add(name);
		}
	}
	return names;
};

// The launcher owns the variable names; this check reads them from it rather
// than keeping a copy that has to be edited in step with the other.
const resolvesPlaywright = new RegExp(
	`${PLAYWRIGHT_ENV_VARS.join("|")}|import\\([^)]*["']playwright`,
);

/**
 * The floor, not the count — a probe retired on purpose should not fail this,
 * but a scan that has stopped seeing the tree must.
 *
 * One, because there is one probe. That is a weak floor and it is honest about
 * being one: at this size the check is really asserting "the scan found the
 * scripts directory at all". Raise it as probes land — seekolous, where this
 * comes from, sits at 40.
 */
const EXPECTED_CALLERS = 1;
const problems = [];
let callers = 0;

/**
 * One sanitiser, two settings.
 *
 * The import checks need comments gone. The call *counts* need string bodies
 * gone as well, because a count decides whether a page is guarded and a
 * mention of `watch(` in a string satisfies it — this file's own failure
 * messages contain one. Two nearly-identical strippers described one intent
 * and would have to be fixed twice.
 */
function strip(source, { strings = false } = {}) {
	let out = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^\s*\/\/.*$/gm, "");
	if (!strings) return out;
	// The `[^:]` guard keeps a `//` inside a URL from eating its line.
	out = out
		.replace(/([^:])\/\/.*$/gm, "$1")
		.replace(/`(?:[^`\\]|\\.)*`/g, "``")
		.replace(/"(?:[^"\\]|\\.)*"/g, '""')
		.replace(/'(?:[^'\\]|\\.)*'/g, "''");
	return out;
}

for (const path of scripts(DIR).sort()) {
	if (path === SELF || path === GUARD) continue;
	const name = relative(DIR, path);
	const src = readFileSync(path, "utf8");
	const code = strip(src);

	/**
	 * The same source with trailing comments and string bodies emptied.
	 *
	 * `code` above strips block comments and whole-line `//` comments, which is
	 * enough for the import checks that read it. It is not enough for counting
	 * calls: a trailing comment or a *string* mentioning `watch(` inflates the
	 * count, and the count is what decides whether a page is guarded. This
	 * file's own failure messages are the proof — they contain "use watch(),"
	 * and would match their own regex.
	 */
	const bare = strip(src, { strings: true });

	const calls = /\blaunchChromium\s*\(/.test(code);
	const bound = importedFromGuard(code, path).has("launchChromium");

	if (calls) callers++;
	if (calls && !bound)
		problems.push(
			`${name}: calls launchChromium but never imports it — ReferenceError at run time`,
		);
	if (!calls && bound)
		problems.push(
			`${name}: imports launchChromium but never calls it — dead import`,
		);
	if (resolvesPlaywright.test(code))
		problems.push(`${name}: still resolves Playwright itself`);

	/**
	 * Every page-opening *call site* has a watch call site beside it.
	 *
	 * The shader-error listener lives inside `tally()`'s `watch` and
	 * `watchShaders`, and for a while nine probes rolled their own
	 * `page.on("pageerror", ...)` and called neither — so a guard described as
	 * covering the suite covered four files, and nothing said otherwise. The
	 * comment in `probe-guard.mjs` named this file as the place to enforce it,
	 * which is only worth writing if it is done.
	 *
	 * **Read the claim narrowly, because the mechanism is narrow.** This counts
	 * occurrences in the source; it does not pair them, and it cannot see how
	 * many pages actually get opened. `probe-live-cockpit` creates its page
	 * inside a `for (const viewport of VIEWPORTS)` loop — one call site, N
	 * pages — and two `watch()` calls covering the same page would satisfy a
	 * file whose second page is unwatched. Neither is caught here.
	 *
	 * What it does catch is the case that actually happened: a probe that opens
	 * pages and calls no watch at all, or fewer watches than page-opening
	 * sites. Nine files were in that state and nothing said so.
	 *
	 * The exact version is structural rather than textual — a helper in
	 * `probe-guard.mjs` that opens and watches in one call, leaving
	 * `browser.newPage(` itself as the thing to refuse. That is a change across
	 * thirteen probes and belongs in its own node, not in this one.
	 */
	const reports = /\btally\s*\(\s*\)/.test(bare);
	const pages = (bare.match(/\.newPage\s*\(/g) ?? []).length;
	const watched = (bare.match(/\bwatch(Shaders)?\s*\(/g) ?? []).length;
	const ownPageError = /page\.on\(\s*\W*pageerror/.test(code);
	// Scoped to scripts that report: `shot-ships.mjs` opens a page to take a
	// screenshot and has no checks to fail, so a watch there would have
	// nothing to report into.
	if (reports && pages > watched)
		problems.push(
			`${name}: opens ${pages} page(s) but installs ${watched} watch(es) — ` +
				`an unwatched page reports neither page errors nor shader failures`,
		);
	// A probe may keep its own page-error reporting — `probe-planets` names
	// them at two milestones rather than one per event — but then it owes the
	// shader listener separately, which is what `watchShaders` is for.
	if (reports && ownPageError && !/\bwatchShaders\s*\(/.test(bare))
		problems.push(
			`${name}: installs its own pageerror handler without watchShaders() — ` +
				`use watch(), or take the shader listener on its own`,
		);
}

if (callers < EXPECTED_CALLERS)
	problems.push(
		`found ${callers} scripts calling the launcher, expected at least ${EXPECTED_CALLERS} — ` +
			`if scripts were retired on purpose, lower EXPECTED_CALLERS; if not, this scan ` +
			`is not seeing the files it is supposed to check`,
	);

for (const p of problems) console.log(`FAIL ${p}`);
console.log(
	problems.length
		? `\n${problems.length} problem(s) across ${callers} scripts calling launchChromium.`
		: `ok   ${callers} scripts call launchChromium, every one imports it from probe-guard.mjs, ` +
				`and none resolves Playwright itself`,
);
process.exit(problems.length ? 1 : 0);
