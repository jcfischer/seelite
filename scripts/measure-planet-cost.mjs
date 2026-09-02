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
	RELIEF_PATHS,
	finite,
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
const CONTROL = ["terran", "four-tap", RADII[0]];
const CONTROL_LABEL = `${CONTROL[0]}/${CONTROL[1]} at ${CONTROL[2]}r`;

/** Windows to discard outright after a switch. The readout updates every
 *  500 ms, so this is a floor of ~1 s a cell before anything is believed. */
const SETTLE_WINDOWS = 2;
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

		/** Place the camera, set the shader, settle, and take `READINGS` samples. */
		const cell = async (surfaceClass, relief, radii) => {
			const label = `${surfaceClass} ${relief} at ${radii} radii, ratio ${pixelRatio}`;
			await page.evaluate(
				([id, r, deg]) => window.__sunOffset(id, r, deg),
				[SUBJECT, radii, SUN_ANGLE_DEG],
			);
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
				radii,
				surfaceClass,
				relief,
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
		controlBefore = await cell(...CONTROL);

		rows = [];
		// Class outermost and radius innermost: a class or relief switch is a shader
		// recompile and a radius change is only a camera move, so this nest pays 16
		// recompiles a run instead of 96, and every settle after one is a settle the
		// cheap way.
		for (const surfaceClass of classes)
			for (const relief of RELIEF_PATHS)
				for (const radii of RADII)
					rows.push(await cell(surfaceClass, relief, radii));

		controlAfter = await cell(...CONTROL);
	} finally {
		await browser.close();
	}

	const refusal = vsyncRefusal(rows.map((r) => r.ms));
	if (refusal) throw new Error(`ratio ${pixelRatio}: ${refusal}`);
	return { renderer, rows, controlBefore, controlAfter };
}

const runs = [];
for (const ratio of PIXEL_RATIOS) runs.push(await run(ratio));

const rows = runs.flatMap((r) => r.rows);
const renderer = runs[0].renderer;

console.log(`  renderer: ${renderer}`);
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
	const classes = [...new Set(runRows.map((r) => r.surfaceClass))];
	for (const relief of RELIEF_PATHS) {
		console.log(`    relief: ${relief}`);
		console.log(
			`      ${"class".padEnd(10)}${RADII.map((r) => `${r}r`.padStart(14)).join("")}`,
		);
		for (const surfaceClass of classes) {
			const cells = RADII.map((radii) => {
				const row = runRows.find(
					(r) =>
						r.surfaceClass === surfaceClass &&
						r.relief === relief &&
						r.radii === radii,
				);
				return `${row.ms.toFixed(1)}±${row.spreadMs.toFixed(1)}${
					row.settled ? "" : "?"
				}${row.staleSamples ? "!" : ""}`.padStart(14);
			});
			console.log(`      ${surfaceClass.padEnd(10)}${cells.join("")}`);
		}
	}
	// Beside the table rather than in it: a stall is a property of a cell that
	// the cell's own frame time deliberately excludes, so it reads as a list of
	// exceptions and not as a column of zeroes.
	const stalls = runRows.filter((r) => r.peakRiseMs > 0);
	console.log(
		stalls.length
			? `    stalls (session peak rose during the cell): ${stalls
					.map(
						(r) =>
							`${r.surfaceClass}/${r.relief}@${r.radii}r +${r.peakRiseMs.toFixed(0)}ms`,
					)
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
					.map((r) => `${r.surfaceClass}/${r.relief}@${r.radii}r`)
					.join(", ")}`
			: `    unsettled: none — every one of the ${runRows.length} cells held a steady rate before it was read`,
	);
	// The other doubt, kept separate because it has a different cause: an
	// unsettled cell was moving, a stale one may not have been re-read at all.
	const stale = runRows.filter((r) => r.staleSamples > 0);
	console.log(
		stale.length
			? `    stale reads (!): ${stale.length} of ${runRows.length} cells — ${stale
					.map((r) => `${r.surfaceClass}/${r.relief}@${r.radii}r`)
					.join(", ")}`
			: `    stale reads: none — every sample was taken on a line the meter had just written`,
	);
	// The drift control. Printed last because it qualifies everything above it:
	// a column-to-column difference smaller than this is not a difference.
	const drift = controlAfter.ms - controlBefore.ms;
	const controlsHeld = controlBefore.settled && controlAfter.settled;
	console.log(
		`    drift control (${CONTROL_LABEL}): ${controlBefore.ms.toFixed(1)} ms before, ` +
			`${controlAfter.ms.toFixed(1)} ms after — the machine moved ` +
			`${drift >= 0 ? "+" : ""}${drift.toFixed(1)} ms end to end` +
			(controlsHeld
				? ""
				: " — BUT one of the two controls never settled, so even this bound is unreliable"),
	);
	// Said every run, because the temptation is to read the endpoint figure as a
	// warrant for the table and it is not one.
	console.log(
		`      net movement only: two endpoints cannot locate a mid-run sag that recovered, so a small figure here says the run began and ended alike and nothing about the columns between`,
	);
	console.log("");
}

await mkdir(OUT, { recursive: true });
const path = join(OUT, "planet-cost.json");
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
			// Per run, because each pixel ratio is its own browser and its own
			// thermal history. A diff of two JSONs that ignored these would be
			// comparing two machines as much as two builds.
			driftControl: runs.map((r, i) => ({
				pixelRatio: PIXEL_RATIOS[i],
				cell: CONTROL_LABEL,
				beforeMs: r.controlBefore.ms,
				afterMs: r.controlAfter.ms,
				// Both ends, because a control that did not settle cannot qualify
				// anything (sage, PR #214). Dropping these while the console said
				// "the machine moved" was the drift figure claiming a confidence
				// its own cells did not have.
				beforeSettled: r.controlBefore.settled,
				afterSettled: r.controlAfter.settled,
			})),
			rows,
		},
		null,
		2,
	)}\n`,
);
console.log(`  wrote ${path} — ${rows.length} cells`);
