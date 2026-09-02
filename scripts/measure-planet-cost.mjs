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
 * ## Two readings a cell, and the pair is the noise
 *
 * Every cell is read twice and **the second reading is the cell**; the gap
 * between the pair is printed beside it. `one-sample-is-not-a-measurement` is
 * the rule and #59's 66.9 ms spread is what it cost last time: a single reading
 * of a frame cost is not a measurement of one. The first reading is discarded
 * rather than averaged in because it is the one most likely to still carry the
 * settle.
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
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const OUT = "view-set";

/**
 * The subject, by id.
 *
 * `planet-5` is `FIXTURE`'s largest planet and the body `planet-fill` frames.
 * Naming it rather than resolving `largest-planet` is what makes the table and
 * the picture claims about one thing: `tests/view-set.test.ts` pins the two
 * together, so a generator change that re-shapes the start system goes red
 * there instead of quietly re-pointing one of them.
 */
const SUBJECT = "planet-5";

/** The sun angle `planet-fill` is captured at, so the lit fraction of the frame
 *  is the same in the table as in the picture. */
const SUN_ANGLE_DEG = 60;

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
/** How long to keep waiting for that before reading anyway. A cell that never
 *  settles is reported through its own noise figure rather than by hanging the
 *  run — the pair is printed for exactly this reason. */
const SETTLE_TIMEOUT_MS = 8000;

/**
 * One fresh reading of the meter.
 *
 * **Fresh by elapsed time, not only by the text changing.** Waiting for the
 * string to differ is the obvious move and it is not sufficient: two
 * consecutive windows can render the same line, and at a clamped rate they
 * routinely do. So a change is *preferred* — it is the fastest correct signal —
 * and a full window and a half of wall clock is what makes the fallback sound.
 * Either way the value on screen is one the meter wrote after this call began.
 */
async function reading(page, previous) {
	const changed = page
		.waitForFunction(
			(was) =>
				document.querySelector("#seelite-fps")?.textContent !== was
					? document.querySelector("#seelite-fps")?.textContent
					: false,
			previous ?? null,
			{ timeout: 3000 },
		)
		.then(() => true)
		.catch(() => false);
	if (!(await changed)) await page.waitForTimeout(750);
	const text = await page.evaluate(
		() => document.querySelector("#seelite-fps")?.textContent ?? "",
	);
	return { text, read: parseFpsReadout(text) };
}

/**
 * Discard `SETTLE_WINDOWS` readings, then wait for the rate to hold still —
 * which is what says the recompile this switch triggered is behind us.
 *
 * Returns the session peak as it stands at the end of the settle, so the cell
 * can report the *rise* across its own readings rather than the running total.
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
		if (spread <= SETTLE_TOLERANCE) return { peak: next.read.peakMs, text };
		previous = next;
	}
	return { peak: previous.read.peakMs, text };
}

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
	const browser = await launchChromium({
		headless: false,
		// The two flags the whole measurement rests on. Without them the meter
		// counts composited frames at the panel's refresh and every cheap cell
		// reads the same; `vsyncRefusal` at the end of this function is what
		// notices if they stop working.
		args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
	});
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: pixelRatio,
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(`${origin}/?seed=${SEED}&fps`);
	await bootedGame(page);
	const renderer = await assertPlayersRenderer(page, "measure a planet's cost");
	await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);

	// Chase, so the cockpit interior is not drawn over the subject — #105's
	// cabin is a lit standard-material fitting and would be a term in every cell
	// of a table that is about a planet surface.
	for (let i = 0; i <= 8; i++) {
		if ((await page.evaluate(() => window.__seelite.view)) === "chase") break;
		await page.keyboard.press("v");
		await page
			.waitForFunction(() => window.__seelite.view === "chase", undefined, {
				timeout: 500,
			})
			.catch(() => {});
	}

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

	/** Place the camera, set the shader, settle, and read the pair. */
	const cell = async (surfaceClass, relief, radii) => {
		const label = `${surfaceClass} ${relief} at ${radii} radii, ratio ${pixelRatio}`;
		await page.evaluate(
			([id, r, deg]) => window.__sunOffset(id, r, deg),
			[SUBJECT, radii, SUN_ANGLE_DEG],
		);
		await page.evaluate(
			([klass, path]) => {
				for (const scene of [
					window.__seelite.nearScene,
					window.__seelite.approachScene,
					window.__seelite.farScene,
				])
					scene.traverse((o) => {
						o.userData?.setSurfaceClass?.(klass);
						o.userData?.setReliefPath?.(path);
					});
			},
			[surfaceClass, relief],
		);
		const settled = await settle(page);
		const first = await reading(page, settled.text);
		const second = await reading(page, first.text);
		return {
			pixelRatio,
			radii,
			surfaceClass,
			relief,
			// The second reading is the cell; the first is the noise half.
			ms: finite(label, second.read.ms),
			fps: finite(label, second.read.fps),
			noiseMs: finite(label, Math.abs(second.read.ms - first.read.ms)),
			worstMs: finite(label, second.read.worstMs),
			// The rise in the session peak across this cell. Zero means this cell
			// did not out-stall anything earlier in the run, which is not the same
			// as "did not stall".
			peakRiseMs: finite(label, Math.max(0, second.read.peakMs - settled.peak)),
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
	 * `one-sample-is-not-a-measurement` and #30's own record are the reason this
	 * is a control rather than an assumption. A reader comparing two columns can
	 * see what the machine moved by underneath them; without it the difference
	 * between a real cost and a warm laptop is not recoverable from the table.
	 */
	const controlBefore = await cell(...CONTROL);

	const rows = [];
	// Class outermost and radius innermost: a class or relief switch is a shader
	// recompile and a radius change is only a camera move, so this nest pays 16
	// recompiles a run instead of 96, and every settle after one is a settle the
	// cheap way.
	for (const surfaceClass of classes)
		for (const relief of RELIEF_PATHS)
			for (const radii of RADII)
				rows.push(await cell(surfaceClass, relief, radii));

	const controlAfter = await cell(...CONTROL);
	await browser.close();

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
	`  ms/frame off the ?fps readout — second of two readings; ±noise is the gap to the first`,
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
				return `${row.ms.toFixed(1)}±${row.noiseMs.toFixed(1)}`.padStart(14);
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
	// The drift control. Printed last because it qualifies everything above it:
	// a column-to-column difference smaller than this is not a difference.
	const drift = controlAfter.ms - controlBefore.ms;
	console.log(
		`    drift control (${CONTROL_LABEL}): ${controlBefore.ms.toFixed(1)} ms before, ` +
			`${controlAfter.ms.toFixed(1)} ms after — the machine moved ` +
			`${drift >= 0 ? "+" : ""}${drift.toFixed(1)} ms under this run`,
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
			})),
			rows,
		},
		null,
		2,
	)}\n`,
);
console.log(`  wrote ${path} — ${rows.length} cells`);
