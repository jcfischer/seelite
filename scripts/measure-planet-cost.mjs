/**
 * What a planet costs a frame, **on the renderer the player has** — swept over
 * class, apparent size, relief path and pixel ratio.
 *
 *   npm run dev                          # in one shell
 *   node scripts/measure-planet-cost.mjs # in another
 *
 * ## Why this exists
 *
 * #59 withdrew a planet-cost finding because the spread between two runs of the
 * same build was 66.9 ms — `planet-classes.glsl.ts` still carries the comment,
 * and it says a GPU run could overturn the conclusion. It did. Nothing in the
 * tree could reprint that table: `probe-planet-surfaces.mjs` and
 * `probe-planets.mjs` both print per-class milliseconds, and both render through
 * SwiftShader, which #98 measured at 16.8 fps against a headed 371 for the same
 * scene on the same machine. A cost read off a probe is a relative signal and
 * never the player's.
 *
 * So this is headed, and it refuses a software rasteriser through
 * `lib/players-renderer.mjs` — the same refusal `capture-views.mjs` and
 * `measure-light-cost.mjs` make, for the same reason and out of the same file.
 * Headed is a *request*: a machine with no display is a real thing, and it gets
 * a full boot before the refusal rather than a guess.
 *
 * ## Not a probe, and not a gate
 *
 * It asserts no threshold and there is deliberately none to assert — #98 settled
 * that this game has no frame-time floor, since the target is Apple Silicon and
 * the expensive part is behind a quality key. What is wanted is **a table to put
 * in a receipt**. The `measure-` prefix keeps it out of `probe-all`, like every
 * other instrument here.
 *
 * It does refuse three things, because #7's rule is that an instrument must fail
 * loudly rather than print garbage that gets transcribed into a spec: a reading
 * it cannot parse, a run that turns out to have been clamped by the display, and
 * a column standing inside the body it is meant to be looking at. All three live
 * in `lib/planet-cost.mjs`, where a test can watch them fire.
 *
 * ## What the number is
 *
 * The `?fps` readout, which is what #206's gate names — so this drives the
 * shipped instrument rather than timing its own frames beside it. That readout
 * counts `requestAnimationFrame` callbacks over a 500 ms window, which means it
 * measures **the page's frame service**: what the compositor actually delivered,
 * vsync and all. `--disable-gpu-vsync --disable-frame-rate-limit` is what lifts
 * the refresh clamp off it, and `vsyncRefusal` checks at the end of every run
 * that they did — a flag silently ignored gives a complete, plausible table in
 * which every cheap column reads the same.
 *
 * That is a different quantity from `measure-light-cost.mjs`'s, which times a
 * block of back-to-back `render` calls and reads a pixel to drain. Both are
 * right for their own question. Beside a rate the player would see, this one is
 * the honest shape; for pricing one *term* against another inside a frame, that
 * one is, because it is not carrying the compositor.
 *
 * ## Three readings a cell, a median, and a range
 *
 * Every cell is read `READINGS` times; the **median** is the cell and the full
 * range is printed beside it. `one-sample-is-not-a-measurement` is the rule and
 * #59's 66.9 ms spread is what it cost last time: one reading of a frame cost
 * is not a measurement of one.
 *
 * **Two were not enough either** (sage, PR #214). A pair yields a single
 * absolute difference, and printing that as `±noise` labels one gap as an
 * uncertainty the table then asks a reader to rely on. Three is the least that
 * gives a figure to report *and* something to qualify it with. It is still
 * small: the honest reading of a wide range here is "re-run this cell", not
 * "the middle one is right".
 *
 * A cell whose rate never held still before the settle timed out is marked `?`
 * in the table, carries `settled: false` into the JSON, and is named in the
 * run's tail. Such a cell is a reading and not a measurement, and before that
 * mark existed it was indistinguishable from one.
 *
 * **Compile hitches are not frame cost.** A class or a relief path is a
 * `#define` compiled into the program (`planet-surface.ts` — the closure exists
 * because the panel should not have to know that), so every switch is a shader
 * recompile, and a cell read across one prices the compile rather than the
 * shader. The cell discards two windows and then waits for two consecutive
 * *rates* to agree within `SETTLE_TOLERANCE` before it reads anything.
 *
 * **Not the session peak, which was tried and does not work.** That constant
 * carries the measurement that settled it. The peak is still reported, but as
 * the *rise* across the cell rather than as its value: `fps-meter.ts` never
 * resets it, so the running total after the first big hitch is a fact about
 * the run's history and not about this row. The rise says "this cell stalled",
 * and it can still read zero for a cell that stalled less than an earlier one
 * — a real limit of the figure, stated rather than left for a reader to find.
 *
 * ## What it writes
 *
 * A table to stdout, and the same rows as JSON under `view-set/` — gitignored,
 * like the captures, because a before/after here is two runs at two refs and
 * never a baseline committed to the repo.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	RADII,
	farColumnVerdict,
	finite,
	flagExcursions,
	parseFpsReadout,
	radiiRefusal,
	vsyncRefusal,
} from "./lib/planet-cost.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { GAME_TIME_S, SEED, VIEWPORT, VIEWS } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const OUT = "view-set";

/**
 * The subject and the light, **read off the canonical view rather than copied**.
 *
 * The first version declared `planet-5` and 60 degrees here while claiming in
 * the same breath that the table and the picture could not drift apart — two
 * homes for one fact, which is exactly what CLAUDE.md's read-from-the-owner
 * rule is about, and sage said so on PR #214. `planet-fill` owns the framing;
 * this reads it. Re-frame that view and the sweep follows, including onto a
 * different body.
 *
 * The `radii` is deliberately *not* taken from here — the sweep prices a whole
 * ladder and the view is one rung of it. `RADII` must contain that rung, and
 * `tests/planet-cost.test.ts` is what holds the two together.
 */
const PRICED_VIEW = "planet-fill";
const priced = VIEWS.find((v) => v.name === PRICED_VIEW);
if (!priced)
	throw new Error(
		`the view set no longer declares "${PRICED_VIEW}" — this sweep prices that ` +
			`frame and has nothing to point at without it`,
	);
const SUBJECT = priced.shot.body;
const SUN_ANGLE_DEG = priced.shot.sunAngleDeg;
if (!RADII.includes(priced.shot.radii))
	throw new Error(
		`"${PRICED_VIEW}" is framed at ${priced.shot.radii} radii and the sweep has ` +
			`no such column (${RADII.join(", ")}) — the table would not price the ` +
			`frame the sheet shows`,
	);

/**
 * The two drawing-buffer scales, as two runs.
 *
 * `measure-light-cost.mjs` argues the case for 2: the fill-rate-bound terms are
 * paid per fragment, and at the default 1 the buffer is a quarter of a retina
 * one. A planet surface is *entirely* a fill-rate term, so the ratio between
 * these two runs is close to the whole story of what it costs — which is why
 * both are swept here rather than one being picked.
 */
const PIXEL_RATIOS = [1, 2];

/**
 * `--decompose`: price the ladder instead of the class table.
 *
 * #242 measured a planet at 95.4% of an open-space frame and #248 asks what is
 * inside that. The default sweep cannot answer it — class, relief path,
 * apparent size and pixel ratio are four axes and none of them *subtracts* a
 * term, so a 36 ms cell says nothing about whether the 36 is slope, class body
 * or the two shells drawn around the disc.
 *
 * A separate mode rather than a fifth axis, for the reason the default nest is
 * ordered the way it is: crossing the ladder with eight classes and two relief
 * paths would be over a thousand headed cells, and seven of the arms already
 * pin the relief path themselves. The two tables answer different questions and
 * neither is a slice of the other.
 */
const DECOMPOSE = process.argv.includes("--decompose");

/**
 * Narrow the sweep to named classes or radii.
 *
 * The full table is eight classes by three relief paths by eight radii by two
 * pixel ratios, three readings a cell — the right shape for pricing the surface
 * and far too long to run twice on one afternoon. A question about **one** term
 * wants two columns and its control, on both builds, on the same machine.
 *
 * A filter and not a second script: the table's refusals — an unparsable
 * reading, a run the display clamped, a column standing inside the body — are
 * what make a figure quotable, and a cut-down copy beside this one would have
 * none of them. Naming a class or a radius the sweep does not have is a throw
 * rather than a quiet empty table, for the reason every instrument here fails
 * loudly.
 *
 *   node scripts/measure-planet-cost.mjs --classes terran,jovian --radii 2
 */
const listArg = (name) => {
	const argv = process.argv.slice(2);
	const eq = argv.find((a) => a.startsWith(`--${name}=`));
	const value = eq
		? eq.slice(name.length + 3)
		: argv[argv.indexOf(`--${name}`) + 1];
	if (!eq && !argv.includes(`--${name}`)) return null;
	if (!value || value.startsWith("-"))
		throw new Error(`--${name} requires a comma-separated value`);
	return value.split(",").map((v) => v.trim());
};
const ONLY_CLASSES = listArg("classes");
const ONLY_RADII = listArg("radii")?.map(Number);
const narrow = (all, wanted, what) => {
	if (!wanted) return all;
	const missing = wanted.filter((w) => !all.includes(w));
	if (missing.length)
		throw new Error(
			`--${what} names ${missing.join(", ")}, which the sweep does not have ` +
				`(${all.join(", ")})`,
		);
	return all.filter((a) => wanted.includes(a));
};

/** Guard against a wrong-checkout dev server. `planet-shaders.ts` and
 *  `planet-classes.glsl.ts` are the modules this sweep is really about and
 *  neither can be used: both declare no top-level numeric constants, and
 *  `probe-guard` throws rather than lie about a file it cannot compare.
 *  `planet-surface.ts` is the nearest module that can be — it is what builds
 *  the mesh and installs the two switches this drives. */
const FINGERPRINT = ["src/main.ts", "src/planet-surface.ts"];

/**
 * The cell the drift control reads, twice.
 *
 * The widest column, so the control itself is cheap and adds nothing to the
 * thermal load it exists to detect — and `terran` because it is the first class
 * in the sweep either way. Module level rather than inside the run, so the
 * printed table can name the same cell the run measured.
 */
/** The radii this run actually sweeps — the whole ladder unless `--radii`
 *  narrowed it. Everything that iterates a table column reads this rather than
 *  `RADII`, or a narrowed run prints headers for cells it never measured and
 *  the formatter throws on the first `undefined`. */
const SWEPT_RADII = narrow([...RADII], ONLY_RADII, "radii");

const CONTROL = ["terran", "four-tap", RADII[0]];
const CONTROL_LABEL = `${CONTROL[0]}/${CONTROL[1]} at ${CONTROL[2]}r`;

/**
 * Windows to discard outright after a switch. The readout updates every 500 ms,
 * so this is a floor of ~3 s a cell before anything is believed.
 *
 * **It was 2, and 2 is not enough after a camera move.** #248's ladder walks
 * from 1.02 radii back out to 200 between arms, and at ratio 2 four of the
 * seven 200r cells came back at 16.6, 15.3, 43.5 and 36.0 ms against 2.6 for
 * the arms either side of them — every one settled, unmarked, and repeatable to
 * within a millisecond across two runs. They are not misreads: the samples are
 * fresh, `worst` rises with them, and the third sample of two of those cells is
 * already recovering (6.3 and 3.0). The page really is that slow for a few
 * seconds after the jump, and 1 s of discard reads the tail of it.
 *
 * The cost is about three minutes on a full sweep, which is the right trade
 * against a column that reads seventeen times its own value.
 */
const SETTLE_WINDOWS = 6;
/**
 * How close two consecutive readings must be for the cell to count as settled.
 *
 * **The settle signal is the rate holding still, not the session peak.** The
 * peak was tried first and it does not work, which the first full run showed
 * rather than argued: `fps-meter.ts` never resets it, so after one early
 * recompile hitch sets it high, no later recompile moves it and "wait for the
 * peak to stop moving" returns immediately for every remaining cell. The table
 * that came out had cells reading 66.7±37.1 and 16.8±11.1 beside neighbours at
 * a steady 57 — a settle bleeding into the reading, wearing the shape of a
 * measurement. Two consecutive rates within 8% is a signal that actually
 * changes when the thing it is watching changes.
 */
const SETTLE_TOLERANCE = 0.08;
/**
 * How long to keep waiting for that before reading anyway.
 *
 * **A cell that times out is still read, and is then marked.** Hanging the run
 * on one stubborn cell would lose the other 223; silently returning the value
 * would sell an unsettled reading downstream as a measurement, which is what
 * sage blocked the first version of this file for on PR #214. So `settled`
 * rides every row into the JSON, the table prints such a cell with a `?`, and
 * the run's tail names them.
 */
const SETTLE_TIMEOUT_MS = 8000;

/**
 * Readings taken per cell, after the settle.
 *
 * **Three rather than two, because two do not establish anything** (sage, PR
 * #214). A pair gives one absolute difference, and calling that "the noise"
 * labels a single gap as an uncertainty the table then asks a reader to rely
 * on. Three gives a median to report and a range to qualify it with, which is
 * the least that can honestly be called a spread — and it is what
 * `one-sample-is-not-a-measurement` asks for. It is still small: the honest
 * reading of a wide range here is "re-run this cell", not "the middle one is
 * right".
 */
const READINGS = 3;

/**
 * One fresh reading of the meter.
 *
 * **A changed line is the only proof of freshness, and the timeout is not
 * one.** An earlier version of this comment claimed that once `READ_WAIT_MS`
 * had passed the figure on screen must have been written after the call began.
 * That is false and sage said so on PR #214: the meter holds its last healthy
 * line when the page stops painting, and its own stall watch reports one to
 * two periods late — two to four seconds — so an 800 ms wait can read a stale
 * healthy line and nothing about it looks stale.
 *
 * So the reading carries `fresh`, which is true only when the text actually
 * moved. A cell that collected any unfresh sample is marked `!` in the table
 * and named in the run's tail, exactly like an unsettled one. Two consecutive
 * windows *can* legitimately render the same line, so an unfresh read is a
 * doubt rather than a fault — which is why it is marked and not thrown on.
 *
 * **The timeout is the fallback, not a stage before one.** The first version
 * waited up to 3 s for a change and *then* slept 750 ms more, so every repeated
 * line cost 3.75 s — several times a cell, across every cell. Sage caught it on
 * PR #214. One wait does both jobs.
 */
const READ_WAIT_MS = 800;

async function reading(page, previous) {
	// `polling` is not a detail. Playwright's default re-evaluates the predicate
	// on every animation frame — of the very rAF stream this is measuring — so a
	// DOM query would run in the hot path of every wait, in every settle, in
	// every sample (sage, PR #214). 100 ms is five checks per meter window, which
	// is plenty to catch a change and nothing the frame loop notices.
	const fresh = await page
		.waitForFunction(
			(was) => document.querySelector("#seelite-fps")?.textContent !== was,
			previous ?? null,
			{ timeout: READ_WAIT_MS, polling: 100 },
		)
		.then(() => true)
		.catch(() => false);
	const text = await page.evaluate(
		() => document.querySelector("#seelite-fps")?.textContent ?? "",
	);
	return { text, fresh, read: parseFpsReadout(text) };
}

/**
 * Discard `SETTLE_WINDOWS` readings, then wait for the rate to hold still —
 * which is what says the recompile this switch triggered is behind us.
 *
 * Returns the session peak as it stands at the end of the settle, so the cell
 * can report the *rise* across its own readings rather than the running total —
 * and `settled`, which says whether the rate ever held still or the timeout
 * ran out first. The caller carries that onto the row; a cell that never
 * settled is not a measurement and must not read like one.
 */
async function settle(page) {
	let text = null;
	for (let i = 0; i < SETTLE_WINDOWS; i++)
		text = (await reading(page, text)).text;
	const until = Date.now() + SETTLE_TIMEOUT_MS;
	let previous = await reading(page, text);
	text = previous.text;
	while (Date.now() < until) {
		const next = await reading(page, text);
		text = next.text;
		const spread =
			Math.abs(next.read.ms - previous.read.ms) /
			Math.max(next.read.ms, previous.read.ms);
		if (spread <= SETTLE_TOLERANCE)
			return { peak: next.read.peakMs, text, settled: true };
		previous = next;
	}
	return { peak: previous.read.peakMs, text, settled: false };
}

/** The middle of an odd-length sample, which is what a cell reports. */
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

// Before a browser is launched, because this one is a fault in the declaration
// rather than in the run: nothing about it needs a GPU to find, and finding it
// four minutes in would waste four minutes.
const buried = radiiRefusal(RADII);
if (buried) throw new Error(buried);

const origin = await guardedOrigin(ORIGIN, FINGERPRINT);

/**
 * One run at one pixel ratio: every class at every apparent size on both relief
 * paths. Returns the rows, and closes its own browser — a run is a whole
 * browser rather than a page, because `deviceScaleFactor` is fixed at context
 * creation and the two runs must not share a warmed shader cache.
 */
async function run(pixelRatio) {
	// Everything after the launch is wrapped, because every refusal in this file
	// throws: an unreadable meter line, a software renderer, a view cycle that
	// never reached chase. Before this, any of them left a headed Chromium alive
	// and the node process with it (sage, PR #214).
	/** @type {any[]} */
	let rows = [];
	/** @type {{name: string, prices: string}[]} */
	let armPrices = [];
	/** @type {string[]} */
	let reliefPaths = [];
	let renderer = "";
	let controlBefore;
	let controlAfter;
	const browser = await launchChromium({
		headless: false,
		// The two flags the whole measurement rests on. Without them the meter
		// counts composited frames at the panel's refresh and every cheap cell
		// reads the same; `vsyncRefusal` at the end of this function is what
		// notices if they stop working.
		args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
	});
	try {
		const page = await browser.newPage({
			viewport: VIEWPORT,
			deviceScaleFactor: pixelRatio,
		});
		await installViewPlacement(page);
		await installViewFraming(page);
		await page.goto(`${origin}/?seed=${SEED}&fps`);
		await bootedGame(page);
		renderer = await assertPlayersRenderer(page, "measure a planet's cost");
		await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);

		// Chase, so the cockpit interior is not drawn over the subject — #105's
		// cabin is a lit standard-material fitting and would be a term in every cell
		// of a table that is about a planet surface.
		//
		// **And it throws if it does not get there.** Each press swallows its own
		// timeout, so before this the loop could run out and the sweep would carry on
		// measuring the cockpit in all 112 cells while every comment said otherwise
		// (sage, PR #214). A view the game does not have is a fault in the script,
		// not something to report in a footnote.
		for (let i = 0; i <= 8; i++) {
			if ((await page.evaluate(() => window.__seelite.view)) === "chase") break;
			await page.keyboard.press("v");
			await page
				.waitForFunction(() => window.__seelite.view === "chase", undefined, {
					timeout: 500,
				})
				.catch(() => {});
		}
		const view = await page.evaluate(() => window.__seelite.view);
		if (view !== "chase")
			throw new Error(
				`the view cycle never reached "chase" — it stopped at "${view}", so ` +
					`every cell would be measured through the cockpit instead of at the ` +
					`planet`,
			);

		/**
		 * The class list, imported off the served page rather than copied.
		 *
		 * `PERF_CLASSES` lives in `src/perf-panel.ts` and this is a `.mjs` script
		 * that node runs directly, so a static import would need a TypeScript
		 * loader. The dev server already transforms that module for the browser —
		 * so the page imports it, and the list this sweeps is the list the game
		 * has. CLAUDE.md's rule for probes is the same one: read a constant off the
		 * page instead of restating it, or a module change makes the instrument
		 * quietly wrong instead of loudly red.
		 */
		const classes = await page.evaluate(async () => {
			const mod = await import("/src/perf-panel.ts");
			return [...mod.PERF_CLASSES];
		});

		/**
		 * The relief paths, off the served page for the same reason the classes
		 * are — and this copy had already gone stale once.
		 *
		 * `lib/planet-cost.mjs` carried a restated pair with a comment arguing the
		 * copy was cheap because "a third path would be a missing column in an
		 * instrument rather than anything the game renders differently". #207 made
		 * `none` a compiled program the shipped band selects, and the list was
		 * wrong for exactly one commit (sage, PR #254). `planet-shaders.ts` owns
		 * the roster now and `ReliefPath` is derived from it, so there is one
		 * place a fourth path can be added.
		 */
		const paths = await page.evaluate(async () => {
			const mod = await import("/src/planet-shaders.ts");
			return [...mod.RELIEF_PATHS];
		});
		reliefPaths = paths;

		/**
		 * Settle, take `READINGS` samples, and return the row — everything a cell
		 * does *after* the page is in the state being priced.
		 *
		 * Extracted because there are two kinds of cell now. The class sweep sets a
		 * class and a relief path; #248's ablation ladder sets an arm. What follows
		 * either — the settle, the three readings, the median, the spread and the
		 * four doubt fields — is the same measurement and must stay one copy of it,
		 * or a guard added to one kind of cell would quietly not apply to the other.
		 */
		const sampleHere = async (label, meta) => {
			const settled = await settle(page);
			const samples = [];
			let text = settled.text;
			for (let i = 0; i < READINGS; i++) {
				const next = await reading(page, text);
				text = next.text;
				samples.push({ ...next.read, fresh: next.fresh });
			}
			const ms = samples.map((r) => finite(label, r.ms));
			const last = samples[samples.length - 1];
			const stale = samples.filter((r) => !r.fresh).length;
			return {
				pixelRatio,
				...meta,
				// The median of `READINGS`, and the full range beside it. One reading is
				// not a measurement and two are not a spread; three is the least that
				// gives a figure to report and something to qualify it with.
				ms: median(ms),
				spreadMs: finite(label, Math.max(...ms) - Math.min(...ms)),
				samplesMs: ms,
				// Whether the rate ever held still. A cell that timed out is printed
				// with a `?` and listed in the run's tail: it is a reading, not a
				// measurement, and the difference must survive into the JSON.
				settled: settled.settled,
				// How many of this cell's samples were read without the meter's line
				// having moved. Non-zero is a doubt, not a fault — see `reading`.
				staleSamples: stale,
				fps: finite(label, last.fps),
				worstMs: finite(label, last.worstMs),
				// The rise in the session peak across this cell. Zero means this cell
				// did not out-stall anything earlier in the run, which is not the same
				// as "did not stall".
				peakRiseMs: finite(label, Math.max(0, last.peakMs - settled.peak)),
			};
		};

		/**
		 * Put the camera at `radii` of the subject, framed as `planet-fill` is —
		 * **and put the world back to the clock the run started at.**
		 *
		 * The re-pin is not tidiness. `__startClockAt` normalises the start and
		 * then lets the clock run (`lib/view-placement.mjs`), sim time is never
		 * compressed (#10), and body positions are `f(systemSeed, gameTime)` (#6) —
		 * so over a five-minute headed run the system keeps orbiting underneath the
		 * sweep. At the close columns the subject is the frame and that does not
		 * matter; at 200 and 30 radii the subject is a few pixels and *whatever
		 * else has drifted into view* is the whole reading.
		 *
		 * It is not a hypothesis. The first decomposition run, without this,
		 * returned `no-clouds` at 43.9 ms and 44.6 ms in the 200r and 30r columns
		 * against 2.5 ms for `full` at the same two — a seventeenfold difference
		 * for turning a cloud shell off on a planet that is a dot. Every one of
		 * those cells settled and none was marked, because the rate was genuinely
		 * steady: the frame really did cost that, at a world time no other column
		 * shared.
		 *
		 * The endpoint drift control cannot catch it, and this is exactly the case
		 * its own doc names: `full at 200r` read 2.5 ms before *and* after, because
		 * whatever crossed the frame had crossed back out by the end.
		 *
		 * The class sweep inherits the fix, and had the same defect — its far
		 * columns have been reading a moving world since #206.
		 */
		const place = async (radii) => {
			await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
			await page.evaluate(
				([id, r, deg]) => window.__sunOffset(id, r, deg),
				[SUBJECT, radii, SUN_ANGLE_DEG],
			);
			await settleBakes();
		};

		/**
		 * Drive frames until no cube bake is still filling (#208).
		 *
		 * **A placement is a layer handoff**, and a handoff re-bakes at the new
		 * layer's face size — so every `place` refills the queue and the frames
		 * that empty it draw an extra full-screen quad each. Sampling through that
		 * would put twelve bake faces inside a cost cell and attribute them to
		 * whatever arm the cell is labelled with.
		 *
		 * Bounded, and the timeout **throws** rather than giving up quietly: one
		 * face is drawn per frame, so a queue still filling after a minute is a
		 * scheduler defect and not a slow machine — and an instrument that measured
		 * around it would print a plausible table for a page in a state nothing
		 * describes (#7).
		 */
		const settleBakes = async () => {
			// **Waited on, never driven.** Calling `render` in a loop from here does
			// empty the queue, and it also blocks the page's own `requestAnimationFrame`
			// — which is what `src/fps-meter.ts` measures, so the readout this sweep
			// parses comes back empty and every cell throws. The game's loop is
			// already running; this only has to stop before it.
			await page.waitForFunction(
				() => window.__seelite.bakeQueue.length === 0,
				undefined,
				{ timeout: 60_000 },
			);
		};

		/** Place the camera, set the shader, settle, and take `READINGS` samples. */
		const cell = async (surfaceClass, relief, radii) => {
			const label = `${surfaceClass} ${relief} at ${radii} radii, ratio ${pixelRatio}`;
			await place(radii);
			// Through `perf-panel.ts`'s own setter, not a copy of its traversal.
			// The scene set and the setter contract live there; this had its own
			// version until sage pointed out the second home (PR #214).
			await page.evaluate(
				async ([klass, path]) => {
					const { setSurfaceAndRelief } = await import("/src/perf-panel.ts");
					setSurfaceAndRelief(
						[
							window.__seelite.nearScene,
							window.__seelite.approachScene,
							window.__seelite.farScene,
						],
						klass,
						path,
					);
				},
				[surfaceClass, relief],
			);
			return sampleHere(label, { radii, surfaceClass, relief });
		};

		/**
		 * One arm of #248's ablation ladder, at one apparent size.
		 *
		 * **The class is deliberately not forced here.** The two shell arms turn off
		 * meshes the *body* carries — `planet-surface.ts` builds a cloud deck only
		 * where `cloudCover > 0` — and forcing a class swaps the surface fragment
		 * without rebuilding them. So a decomposition run prices the subject the
		 * view set actually frames, which is the frame #242's 36.758 ms is about,
		 * rather than a class painted onto someone else's shells.
		 */
		const armCell = async (arm, radii) => {
			const label = `${arm} at ${radii} radii, ratio ${pixelRatio}`;
			await place(radii);
			await page.evaluate(async (name) => {
				const { setAblation } = await import("/src/perf-panel.ts");
				setAblation(
					[
						window.__seelite.nearScene,
						window.__seelite.approachScene,
						window.__seelite.farScene,
					],
					name,
				);
			}, arm);
			/**
			 * **The arm landed, checked rather than assumed** (#208).
			 *
			 * `setAblation`'s `baked` arm is the one lever in the ladder that can be
			 * *refused*: a body with no complete cube, or a class that cannot bake
			 * at all, keeps the procedural program. Without this the run prints the
			 * procedural cost in the `baked` column, three digits and no marker —
			 * which is the shape of every measurement defect this instrument has
			 * had. A refusal here names the subject and the path it is actually on.
			 */
			const drawnWith = await page.evaluate(
				(id) =>
					window.__seelite.bodyVisuals.get(id)?.surfacePath() ?? "no such body",
				SUBJECT,
			);
			const wanted = await page.evaluate(async (name) => {
				const mod = await import("/src/perf-panel.ts");
				return mod.armByName(name).surface;
			}, arm);
			if (drawnWith !== wanted) {
				throw new Error(
					`${label}: the ladder asked for "${wanted}" and ${SUBJECT} is drawn ` +
						`with "${drawnWith}". A baked arm is refused where the body has ` +
						"no complete cube or the class reads the clock in surface().",
				);
			}
			return sampleHere(label, { radii, arm });
		};

		/**
		 * **The drift control, and why a sweep this long needs one.**
		 *
		 * A run is ~200 headed cells over several minutes with the GPU pinned, so
		 * the machine at the end is not the machine at the start — and every sweep
		 * order pools that drift somewhere. Ordering by radius put the expensive
		 * columns last; ordering by class puts the last class last. There is no nest
		 * that has no end, so instead of hiding the drift the run **measures** it:
		 * one fixed cell, read before the sweep and again after it.
		 *
		 * **What two endpoints can and cannot say.** They give the *net* movement
		 * across the run and nothing else: they cannot locate when it happened, and
		 * a machine that sagged in the middle and recovered reads as no drift at all
		 * (sage, PR #214). So this bounds the claim rather than establishing it — a
		 * large endpoint difference says the table is untrustworthy, and a small one
		 * says only that the run began and ended in the same state. Read it as a
		 * refutation instrument, not as a correction to apply to a column.
		 */
		/**
		 * The ladder, imported off the served page rather than restated here, for
		 * the same reason `PERF_CLASSES` is: an arm added to `perf-panel.ts` must
		 * appear in this table or not exist, and a second copy is how those two
		 * facts come apart.
		 */
		const arms = DECOMPOSE
			? await page.evaluate(async () => {
					const mod = await import("/src/perf-panel.ts");
					return mod.ABLATION_ARMS.map((a) => ({
						name: a.name,
						prices: a.prices,
					}));
				})
			: [];

		// The control is the ladder's own denominator in decompose mode, because
		// `CONTROL` forces a class and this mode deliberately does not force one.
		// Same cell at both ends either way: that is what makes it a control.
		const control = DECOMPOSE
			? () => armCell("full", RADII[0])
			: () => cell(...CONTROL);

		controlBefore = await control();

		rows = [];
		if (DECOMPOSE) {
			// Arm outermost, radius innermost: an arm change recompiles (relief and
			// the ablate level are both a `#define` or a uniform every material
			// carries) and a radius change is only a camera move.
			for (const arm of arms)
				for (const radii of RADII) rows.push(await armCell(arm.name, radii));
		} else {
			// Class outermost and radius innermost: a class or relief switch is a shader
			// recompile and a radius change is only a camera move, so this nest pays 16
			// recompiles a run instead of 96, and every settle after one is a settle the
			// cheap way.
			for (const surfaceClass of narrow(classes, ONLY_CLASSES, "classes"))
				for (const relief of paths)
					for (const radii of SWEPT_RADII)
						rows.push(await cell(surfaceClass, relief, radii));
		}

		controlAfter = await control();
		armPrices = arms;
	} finally {
		await browser.close();
	}

	const refusal = vsyncRefusal(rows.map((r) => r.ms));
	if (refusal) throw new Error(`ratio ${pixelRatio}: ${refusal}`);
	return {
		renderer,
		rows,
		controlBefore,
		controlAfter,
		armPrices,
		reliefPaths,
	};
}

const runs = [];
for (const ratio of PIXEL_RATIOS) runs.push(await run(ratio));

const rows = runs.flatMap((r) => r.rows);

/**
 * One verdict per run, computed before anything is printed or written, so the
 * console line and the JSON cannot disagree about whether a run is quotable.
 * Keyed by pixel ratio because each ratio is its own browser and its own run.
 */
const verdicts = Object.fromEntries(
	runs.map((r, i) => [PIXEL_RATIOS[i], farColumnVerdict(r.rows, RADII[0])]),
);
/**
 * The flag rides **every row of an affected run**, not only the run summary and
 * not only the column the excursion was detected in.
 *
 * The first version wrote it onto `radii >= RADII[0]`, which is the widest
 * column and nothing else — so the 30r cell of the same run, 44.6 ms beside a
 * 2.6 ms neighbour in #248's first run, came out carrying no doubt (sage,
 * PR #250, round 3). The invariant is read at one radius: it establishes that
 * the run had an excursion and says nothing about when, so there is no radius
 * at which a cutoff stops being arbitrary. A consumer that pulls one cell out
 * of `rows` gets the run's doubt with the cell and decides on evidence.
 *
 * In `lib/` and tested, because the three lines this replaced were three lines
 * that looked obviously right.
 */
flagExcursions(rows, verdicts);
const renderer = runs[0].renderer;

console.log(`  renderer: ${renderer}`);
console.log(
	DECOMPOSE
		? `  mode: decomposition — #248's ablation ladder on the subject as the view set frames it, its own class and its own shells`
		: `  mode: class sweep — every class on both relief paths`,
);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height}, ${SUBJECT} at ${SUN_ANGLE_DEG}° from the star, seed ${SEED}`,
);
console.log(
	`  ms/frame off the ?fps readout — median of ${READINGS} readings, ±the full range across them`,
);
console.log(
	`  a cell marked ? never settled: its rate was still moving when the settle timed out, so it is a reading and not a measurement`,
);
console.log(
	`  a cell marked ! took a sample the meter had not refreshed — possibly a repeated line, possibly a stale one held over a stall`,
);
console.log("");

for (const {
	pixelRatio,
	rows: runRows,
	controlBefore,
	controlAfter,
} of runs.map((r, i) => ({ pixelRatio: PIXEL_RATIOS[i], ...r }))) {
	console.log(`  pixel ratio ${pixelRatio}`);
	const label = (row) =>
		`${row.ms.toFixed(1)}±${row.spreadMs.toFixed(1)}${row.settled ? "" : "?"}${
			row.staleSamples ? "!" : ""
		}`.padStart(14);
	if (DECOMPOSE) {
		const arms = [...new Set(runRows.map((r) => r.arm))];
		const at = (arm, radii) =>
			runRows.find((r) => r.arm === arm && r.radii === radii);
		console.log(
			`      ${"arm".padEnd(14)}${RADII.map((r) => `${r}r`.padStart(14)).join("")}`,
		);
		for (const arm of arms)
			console.log(
				`      ${arm.padEnd(14)}${RADII.map((r) => label(at(arm, r))).join("")}`,
			);
		/**
		 * The deltas, printed rather than left for a reader to subtract.
		 *
		 * **A delta smaller than the drift control below is not a delta**, and the
		 * same goes for one inside a cell's own spread. Both are printed beside it
		 * for that reason; this table is what a term costs *at this framing on this
		 * machine*, and #98's rule that a probe's millisecond is nobody's applies to
		 * a headed one taken on a different GPU just as hard.
		 */
		console.log("");
		console.log(
			`      full minus each arm — what that arm's own \`prices\` line says it costs, ms. Read the arm's line for what is in it: \`flat\` carries the slope as well, so it is not the class body alone (that is flat minus no-relief). A figure inside the drift control below is not a difference.`,
		);
		console.log(
			`      ${"term".padEnd(14)}${RADII.map((r) => `${r}r`.padStart(14)).join("")}`,
		);
		for (const arm of arms) {
			if (arm === "full") continue;
			const cells = RADII.map((radii) => {
				const full = at("full", radii);
				const other = at(arm, radii);
				const d = full.ms - other.ms;
				const share = full.ms > 0 ? (100 * d) / full.ms : 0;
				return `${d >= 0 ? "+" : ""}${d.toFixed(1)} (${share.toFixed(0)}%)`.padStart(
					14,
				);
			});
			console.log(`      ${arm.padEnd(14)}${cells.join("")}`);
		}
	} else {
		const classes = [...new Set(runRows.map((r) => r.surfaceClass))];
		for (const relief of runs[0].reliefPaths) {
			console.log(`    relief: ${relief}`);
			console.log(
				`      ${"class".padEnd(10)}${SWEPT_RADII.map((r) => `${r}r`.padStart(14)).join("")}`,
			);
			for (const surfaceClass of classes) {
				const cells = SWEPT_RADII.map((radii) =>
					label(
						runRows.find(
							(r) =>
								r.surfaceClass === surfaceClass &&
								r.relief === relief &&
								r.radii === radii,
						),
					),
				);
				console.log(`      ${surfaceClass.padEnd(10)}${cells.join("")}`);
			}
		}
	}
	// Beside the table rather than in it: a stall is a property of a cell that
	// the cell's own frame time deliberately excludes, so it reads as a list of
	// exceptions and not as a column of zeroes.
	/** How a cell is named in the lists below — by arm, or by class and path. */
	const cellName = (r) =>
		DECOMPOSE
			? `${r.arm}@${r.radii}r`
			: `${r.surfaceClass}/${r.relief}@${r.radii}r`;

	/**
	 * **The widest column is the run's own control, and it must not move.**
	 *
	 * The verdict itself lives in `lib/planet-cost.mjs` beside the other
	 * refusals, so a test can watch it fire — and so the same object can be
	 * printed here *and* written into the JSON. A qualification that exists only
	 * on the console is one every later reader of the file is missing (sage,
	 * PR #250).
	 */
	const far = verdicts[pixelRatio];
	console.log(
		`    widest column (${far.radii}r, where the subject is a few pixels and nothing should differ): ` +
			`${far.cells} cells, floor ${far.floorMs.toFixed(1)} ms` +
			(!far.excursion
				? ` — every cell inside ${far.factor}x it, which is what this column should look like`
				: ` — ${far.outliers.length} over ${far.factor}x it: ${far.outliers
						.map((r) => `${cellName(r)} ${r.ms.toFixed(1)}ms`)
						.join(
							", ",
						)}. THIS RUN HAD AN EXCURSION. Where is not established — detection is at one radius — so every row of it carries runExcursion in the JSON, and the far columns are the ones to drop first.`),
	);

	const stalls = runRows.filter((r) => r.peakRiseMs > 0);
	console.log(
		stalls.length
			? `    stalls (session peak rose during the cell): ${stalls
					.map((r) => `${cellName(r)} +${r.peakRiseMs.toFixed(0)}ms`)
					.join(", ")}`
			: "    stalls: none out-stalled an earlier cell in this run",
	);
	// The blocker sage raised on PR #214: before this, a cell that timed out came
	// back the same shape as one that settled, and was sold downstream as a
	// measurement. Named here and flagged in the table and the JSON.
	const unsettled = runRows.filter((r) => !r.settled);
	console.log(
		unsettled.length
			? `    unsettled (?): ${unsettled.length} of ${runRows.length} cells never held a steady rate — ${unsettled
					.map(cellName)
					.join(", ")}`
			: `    unsettled: none — every one of the ${runRows.length} cells held a steady rate before it was read`,
	);
	// The other doubt, kept separate because it has a different cause: an
	// unsettled cell was moving, a stale one may not have been re-read at all.
	const stale = runRows.filter((r) => r.staleSamples > 0);
	console.log(
		stale.length
			? `    stale reads (!): ${stale.length} of ${runRows.length} cells — ${stale
					.map(cellName)
					.join(", ")}`
			: `    stale reads: none — every sample was taken on a line the meter had just written`,
	);
	// The drift control. Printed last because it qualifies everything above it:
	// a column-to-column difference smaller than this is not a difference.
	const drift = controlAfter.ms - controlBefore.ms;
	// Settled *and* freshly read, at both ends. Checking only `settled` left a
	// control that had taken an unrefreshed sample qualifying the whole table
	// (sage, PR #214, round 3) — the same doubt every other cell is marked for,
	// dropped on the one cell whose job is to qualify the others.
	const controlsHeld =
		controlBefore.settled &&
		controlAfter.settled &&
		!controlBefore.staleSamples &&
		!controlAfter.staleSamples;
	console.log(
		`    drift control (${DECOMPOSE ? `full at ${RADII[0]}r` : CONTROL_LABEL}): ${controlBefore.ms.toFixed(1)} ms before, ` +
			`${controlAfter.ms.toFixed(1)} ms after — the machine moved ` +
			`${drift >= 0 ? "+" : ""}${drift.toFixed(1)} ms end to end` +
			(controlsHeld
				? ""
				: " — BUT a control never settled or was read stale, so even this bound is unreliable"),
	);
	// Said every run, because the temptation is to read the endpoint figure as a
	// warrant for the table and it is not one.
	console.log(
		`      net movement only: two endpoints cannot locate a mid-run sag that recovered, so a small figure here says the run began and ended alike and nothing about the columns between`,
	);
	console.log("");
}

await mkdir(OUT, { recursive: true });
// A separate file, because the two modes answer different questions and a diff
// of two runs must not silently compare a ladder against a class table.
const path = join(
	OUT,
	DECOMPOSE ? "planet-decomposition.json" : "planet-cost.json",
);
await writeFile(
	path,
	`${JSON.stringify(
		{
			measuredAt: new Date().toISOString(),
			renderer,
			viewport: VIEWPORT,
			seed: SEED,
			subject: SUBJECT,
			sunAngleDeg: SUN_ANGLE_DEG,
			mode: DECOMPOSE ? "decomposition" : "class-sweep",
			// The widest column's verdict, per run. `excursion: true`
			// means that run had one the endpoint drift control cannot see. It
			// is here and as `runExcursion` on every row of that run, because a
			// consumer that
			// pulls one cell out of `rows` would otherwise get a row marked
			// settled, fresh and endpoint-controlled with nothing saying the run
			// it came from is in doubt (sage, PR #250).
			farColumns: PIXEL_RATIOS.map((ratio) => ({
				pixelRatio: ratio,
				...verdicts[ratio],
				outliers: verdicts[ratio].outliers.map((r) => ({
					arm: r.arm ?? null,
					surfaceClass: r.surfaceClass ?? null,
					relief: r.relief ?? null,
					radii: r.radii,
					ms: r.ms,
				})),
			})),
			// What each arm's subtraction prices, carried out of `perf-panel.ts` so a
			// reader of the JSON does not have to open the module to know what a
			// column means. Empty in the class-sweep mode, which has no ladder.
			arms: runs[0].armPrices,
			// Per run, because each pixel ratio is its own browser and its own
			// thermal history. A diff of two JSONs that ignored these would be
			// comparing two machines as much as two builds.
			driftControl: runs.map((r, i) => ({
				pixelRatio: PIXEL_RATIOS[i],
				cell: DECOMPOSE ? `full at ${RADII[0]}r` : CONTROL_LABEL,
				beforeMs: r.controlBefore.ms,
				afterMs: r.controlAfter.ms,
				// Both ends, because a control that did not settle cannot qualify
				// anything (sage, PR #214). Dropping these while the console said
				// "the machine moved" was the drift figure claiming a confidence
				// its own cells did not have.
				beforeSettled: r.controlBefore.settled,
				afterSettled: r.controlAfter.settled,
				beforeStaleSamples: r.controlBefore.staleSamples,
				afterStaleSamples: r.controlAfter.staleSamples,
			})),
			rows,
		},
		null,
		2,
	)}\n`,
);
console.log(`  wrote ${path} — ${rows.length} cells`);
