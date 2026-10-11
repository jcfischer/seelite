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
 * Scripts allowed to open a page without a `tally()`.
 *
 * This is the *only* thing an entry buys. It does not switch off the watch
 * rules — those are gated on having a tally, which an exempt file does not
 * have, so they never fire there anyway.
 *
 * One entry, with its reason beside it. `if (reports)` did this job implicitly
 * and covered every future file that forgets a tally along with the one that
 * means it.
 */
const EXEMPT = new Map([
	[
		"lib/opening-probe.mjs",
		"Shared fixture receives the caller tally check/watch; every page is watched and both opening entrypoints own tally and exit.",
	],
	[
		"measure-open-space-repro.mjs",
		"node #249's headed instrument, run unchanged against older checkouts to tell a build from an instrument: it prints pair-off, pair-on and gate-live medians with a separation count for a receipt and gates on nothing — #98 settled that there is no frame-time floor; a software rasteriser or a wrong-tree server throws out of the run",
	],
	[
		"measure-cabin-pass-cost.mjs",
		"#651's headed cabin-pass instrument, two builds against each other on two servers; a sibling of #201's and exempt for the same reason — #98 settled that there is no frame-time floor in this game, so it prints build-against-build deltas and a separation count for a receipt and gates on nothing. It refuses a software rasteriser, a base server that declares no tree or the same commit, and a non-finite block, each by throwing out of the run",
	],
	[
		"capture-sounds.mjs",
		"#552's sound capture, the audio twin of `npm run views`: it renders every cue to WAV at a labelled ref for the principal's ear and asserts nothing; a page error throws out of the run rather than into a tally",
	],
	[
		"shot-ships.mjs",
		"takes screenshots; has no checks for a watch to report into",
	],
	[
		"measure-boot-cost.mjs",
		"#202's headed boot-frame instrument, before and after on two trees: it prints one figure off the ?fps meter for a receipt and asserts nothing; a software rasteriser throws out of the run",
	],
	[
		"measure-fixture-cost.mjs",
		"#202's headed frame-cost instrument for a station finish: it prints a table off the workbench's fps meter for a receipt and asserts nothing; a software rasteriser throws out of the run",
	],
	[
		"shot-finishes.mjs",
		"#202/#203's headed finish sheet; it takes screenshots for the principal to judge and asserts nothing — its refusals, a software rasteriser and a finish the workbench did not select, throw out of the run rather than counting a failed check",
	],
	[
		"measure-gpu-timer-calibration.mjs",
		"#246's headed calibration for EXT_disjoint_timer_query_webgl2: it prints the span, gain and floor arms so a later ANGLE can be re-qualified, and asserts nothing — the pass/fail judgement is the refusal shipped in src/frame-attribution.ts, and a table that also gated would be the check deriving itself from its own subject",
	],
	[
		"measure-mouth-flicker.mjs",
		"#269's attribution instrument for the station-mouth flicker: it prints the temporal-median area, the ray hits against the depth quantum and the hide-and-diff arms so a later fight can be named, and asserts nothing — the pass/fail judgement is probe-station-mouth.mjs, and a table that also gated would be the check deriving itself from its own subject",
	],
	[
		"measure-light-cost.mjs",
		"#99's headed frame-cost instrument; it asserts nothing by design — #98 settled that there is no frame-time floor to gate on — so there are no checks for a watch to report into",
	],
	[
		"measure-audio.mjs",
		"#541's WebAudio instrument; it prints offline render stats, voice and convolver cost, playbackStats under load and scheduling error under a stall for a receipt, and asserts nothing — it serves its own page, so there is no game for a watch to report on",
	],
	[
		"measure-boot-time.mjs",
		"#142's headed boot instrument; it prints a timing and asserts nothing, so there are no checks for a watch to report into — it refuses a software renderer rather than gating on a figure",
	],
	[
		"measure-adaptive-resolution.mjs",
		"#352's headed resolution table; like #99's and #206's it gates on nothing — the output is a table for a receipt, not a threshold, because the figures are a property of the machine it is run on. Its refusals — a software rasteriser, and a cadence ring still empty after the settle — throw out of the run rather than counting a failed check",
	],
	[
		"measure-planet-cost.mjs",
		"#206's headed planet-cost sweep; like #99's it gates on nothing — the output is a table for a receipt, not a threshold — so there are no checks for a watch to report into. Its refusals — an unreadable meter line, a flat run, a column inside the body — throw out of the run rather than counting a failed check",
	],
	[
		"measure-sky-clearance.mjs",
		"#487's headed clearance sweep; a sibling of #206's and #201's, exempt for the same reason — it prints the angle the emptiest heading actually leaves between the frame's half-diagonal and the nearest body's limb over eleven worlds, and gates on nothing, because the judgement is the one row `probe-sky.mjs` holds and a table that also gated would be the check deriving itself from its own subject. What it refuses — a software rasteriser — throws out of the run, and a page that booted a world other than the seed it was asked for is printed with a `!` rather than quietly averaged into the table",
	],
	[
		"measure-frame-attribution.mjs",
		"#223's headed sampler-overhead instrument; it reports paired CPU submission timings on a proven player renderer without imposing a machine-independent performance threshold",
	],
	[
		"measure-occlusion-cost.mjs",
		"#201's headed occlusion-cost instrument; a sibling of #99's and exempt for the same reason — #98 settled that there is no frame-time floor in this game, so it prints four arms and a separation count for a receipt and gates on nothing. What it does refuse is a software rasteriser, which throws out of the run rather than counting a failed check",
	],
	[
		"measure-courier-hull-cost.mjs",
		"node #812's headed instrument pricing the authored courier against the procedural Kestrel on one page; like #201's it prints medians and a separation count for a receipt and gates on nothing — #98 settled that there is no frame-time floor — and a software rasteriser or a page whose courier is not the authored model throws out of the run",
	],
	[
		"measure-courier-level-pop.mjs",
		"node #812's headed instrument reading what the courier's reduced level changes on screen where the detail band first draws it; it prints a footprint, a control and a moved count per heading for the receipt's Q7 and gates on nothing — the principal judges the switch — and a software rasteriser, a page whose courier is not the authored model, a hull with no footprint or a control that moved throws out of the run",
	],
	[
		"measure-cruise-guard-cost.mjs",
		"#229's headed simulation-step CPU instrument; it proves once-per-body preparation and reports timings without imposing a machine-independent threshold",
	],
	[
		"measure-bay-frame-cost.mjs",
		"#242's headed bay-frame instrument; a sibling of #99's and #201's and exempt for the same reason — it prints per-subject arms, a mask fraction and a separation count for a receipt and gates on nothing, because #98 settled that there is no frame-time floor in this game. It refuses a software rasteriser, which throws out of the run rather than counting a failed check. Missing since #244, where it landed with no entry: CI does not run the probes (#14), so `npm run probe` has been red on `main` since that merge",
	],
	[
		"measure-canister-drift.mjs",
		"#324's canister-drift instrument; it prints two tables of ranges and speeds against a frozen twin for a receipt and asserts nothing, so there are no checks for a watch to report into. It reads simulation state through one `page.evaluate` rather than pixels, so a shader failure cannot change what it prints; a boot that never completes, or an evaluate that throws, fails the run rather than counting a failed check",
	],
	[
		"measure-lane-windows.mjs",
		"the lane's window instrument; it prints whether each surviving window mode's real launch carries `--headless`, anything that would place a window, and which binary answered, so the claim that the lane opens no window can be checked against the browser rather than against this repo's source. It asserts nothing — which binary a channel resolves to is a property of the pinned Playwright — and the gate that does exist is `assertBrowserRenderer` on every hardware launch; a refusal, or a lane that is not the hardware one, throws out of the run rather than counting a failed check",
	],
	[
		"measure-shadow-enclosure.mjs",
		"node #363's headed shadow-enclosure instrument; a sibling of #201's occlusion-cost instrument and exempt for the same reason — it prints a ladder of arms (#723) for a receipt that #231 decides from, and gates on nothing. It refuses a software rasteriser, and a light readback that breaks its lights-held rule; both throw out of the run rather than counting a failed check",
	],
	[
		"capture-views.mjs",
		"captures #104's view set; the gate is a human looking at the sheet, so it has no checks either — it does listen for shader and page errors, and a fault removes the run and the sheet rather than reporting one",
	],
]);

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
	 * No probe opens a page with `?perf`.
	 *
	 * The perf panel binds a plain `window` keydown listener at mount, so a
	 * probe that mounted it would have its own keystrokes toggling diagnostics —
	 * bloom off, a shell hidden, the surface flattened — under checks that
	 * measure what is drawn. `perf-panel.ts` said the isolation "rests entirely
	 * on the probe URL omitting ?perf, which nothing enforces". This is the
	 * branch's own answer to that sentence, which it already applied to key
	 * collisions: a comment cannot hold it, a check can.
	 */
	// Against `code`, which keeps string bodies, and not `bare`, which empties
	// them — a URL *is* a string, so the version of this that read `bare` was
	// checking source with the thing it looks for already removed. It passed a
	// probe with `?perf` in it, which is how that was found.
	// One probe owns the diagnostic itself. It never sends keys and checks that
	// no readPixels fence is introduced, so mounting the panel is its subject
	// rather than accidental contamination of some other rendering assertion.
	// Keeping the exception exact preserves the suite-wide refusal for every
	// other probe.
	// `probe-pad-instrument.mjs` joins the exception on the same terms (#283):
	// the panel is its subject rather than a contaminant, and it sends no keys
	// at all — every input it makes is a pad button, which that key listener
	// cannot see. The list stays a list of names so the suite-wide refusal holds
	// for every probe that has not argued its way onto it.
	// `probe-pointer-lock.mjs` joins it on a different footing (#402): it *does*
	// send a key with the panel mounted — `3`, to turn the head under the
	// overlay — and `3` is not one of the panel's keys (`PERF_KEYS` and
	// `RESTORE_KEY`, held against the flight bindings by
	// `tests/perf-panel-keys.test.ts`). The instrument over a console is that
	// row's subject: `padContext()` answers `instrument` only while the panel is
	// focused (`main.ts`), so dropping the flag would delete the row rather than
	// isolate it. The exception is per file, not per page: the probe's other pages
	// carry no `perf` and this cannot tell them apart, so a key added to *this*
	// page is what to check against that test's list.
	const PERF_OWNERS = new Set([
		"probe-frame-attribution.mjs",
		"probe-pad-instrument.mjs",
		"probe-pointer-lock.mjs",
	]);
	// Both spellings (#306). A probe's URL is `gameUrl(origin, { perf: 1 })`
	// now, which has no `?perf` in it — so the query form alone would pass every
	// probe that asks for the panel through the builder, which is all of them.
	// Two limits, in opposite directions. It is **broader** than a URL: any
	// `perf:` object key in a non-owner script is refused, whether or not it
	// reaches `gameUrl` — none does today, and a script that needs one can join
	// PERF_OWNERS with a reason. And it is **blind** to a flag that arrives
	// through a variable or a spread, which no text scan can follow.
	if (
		!PERF_OWNERS.has(name) &&
		/[?&]perf\b|(?:^|[{,\s])["']?perf["']?\s*:/m.test(code)
	)
		problems.push(
			`${name}: opens a page with ?perf — that mounts the diagnostic panel, ` +
				`whose key listener would then see this probe's keystrokes`,
		);

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
	 * **Proximity, not a count.** Counting `newPage` sites against watch calls
	 * was the first version and enforced nothing where it was most needed: a
	 * probe that opens its page inside a `for (const viewport of VIEWPORTS)`
	 * loop has one call site, so one watch anywhere in the file — including
	 * outside the loop, watching only the first page — scored 1 > 1 and passed.
	 * The rule now asks that each `newPage` be followed by a watch within a few
	 * lines, which is where one has to be to cover the page just opened.
	 *
	 * Still textual, and it says so: a watch that follows within the window but
	 * refers to some other page satisfies it. The exact version is structural —
	 * a helper in `probe-guard.mjs` that opens and watches in one call, leaving
	 * `browser.newPage(` itself as the thing to refuse — which is a change
	 * across thirteen probes and its own node.
	 */
	const reports = /\btally\s*\(\s*\)/.test(bare);
	const pages = (bare.match(/\.newPage\s*\(/g) ?? []).length;
	const ownPageError = /page\.on\(\s*\W*pageerror/.test(code);

	/**
	 * A script that opens pages and does not report is **named**, not skipped.
	 *
	 * The rule below needs a `tally()` to report into, so it was written as
	 * `if (reports)` — which makes the guard fail open for exactly the file it
	 * cannot see: a new probe that opens pages without a tally is unwatched and
	 * this says nothing about it. The exemption is a list with a reason
	 * attached, so joining it is a decision somebody makes rather than a side
	 * effect of how a file happens to be written.
	 */
	if (pages && !reports && !EXEMPT.has(name))
		problems.push(
			`${name}: opens ${pages} page(s) and calls no tally() — it can neither ` +
				`watch them nor report what a watch would find; add it to EXEMPT ` +
				`with a reason if that is deliberate`,
		);

	// Not gated on EXEMPT. That list buys one thing — permission to open pages
	// without a tally — and an entry on it was silently switching off the
	// proximity rule and the `watchShaders` rule as well, which are about
	// something else. They are gated on `reports`, which an exempt file does not
	// have, so they simply do not fire there; nothing needs to exempt them.
	const WITHIN = 8;
	if (reports)
		for (const opened of bare.matchAll(/\.newPage\s*\(/g)) {
			const after = bare
				.slice(opened.index ?? 0)
				.split("\n")
				.slice(0, WITHIN)
				.join("\n");
			if (!/\bwatch(Shaders)?\s*\(/.test(after))
				problems.push(
					`${name}: a page is opened with no watch within ${WITHIN} lines — ` +
						`an unwatched page reports neither page errors nor shader failures`,
				);
		}
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
