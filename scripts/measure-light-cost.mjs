/**
 * What the frame's switchable terms cost, **on the renderer the player has**:
 * #99's baked environment, and #200's multisampled composer and its dither.
 *
 *   npm run dev                       # in one shell
 *   node scripts/measure-light-cost.mjs
 *
 * #98 corrected the thing that makes this script necessary: every browser
 * script in this repo except the view capture renders through SwiftShader, and
 * the same scene measures 16.8 fps headless against 371 fps headed on an M1
 * Pro. A cost read off a probe is a relative signal and never the player's, so
 * a node pricing a renderer change either measures it headed or says plainly
 * that the number is software. This measures it headed, and refuses a software
 * rasteriser through `lib/players-renderer.mjs`, which `capture-views.mjs` also
 * uses — one home for the list of rasteriser names rather than two.
 *
 * ## Not a probe, and not a gate
 *
 * It asserts nothing and always exits 0. #98 settled that there is no
 * frame-time floor in this game — the target is Apple Silicon and the expensive
 * part is behind a quality key — so what is wanted here is a *figure to put in
 * the receipt*, not a threshold that would fail on somebody else's laptop. The
 * `measure-` prefix keeps it out of `probe-all`, like every other instrument in
 * this directory.
 *
 * ## Two experiments, because one key now moves two terms
 *
 * #200 added a second frame-cost term to the renderer, and it is the larger of
 * the two by a factor of five. A reading that let either drift would attribute
 * the total to whichever the header happened to name — so each experiment moves
 * **one** term and pins the other:
 *
 * - the **environment** arm toggles `quality` with the samples pinned at zero
 *   (`Game.setComposerSamples` takes an explicit count for this reason);
 * - the **samples** arm holds `quality` at `high` and moves the count alone.
 *
 * Pinned at *zero* and not at the strongest count, because zero is what the
 * game ships (`settings.ts`, the `antialias` row) — the environment's cost is
 * wanted on the frame a player actually draws, and a multisampled target
 * changes what every fragment write costs by a factor of five.
 *
 * ## How the arms are kept comparable
 *
 * One page, one camera, one clock start, and the setting toggled **in place**
 * between blocks. Nothing is reloaded: a reload puts the ship somewhere else and
 * the two arms would then differ by their position as much as by the term, which
 * is `perf-panel.ts`'s whole argument for live switches. The blocks alternate
 * (high, low, high, low, …) so a thermal drift or a background task lands on
 * both arms rather than on whichever ran second, and the reported figure is the
 * **median** block, so one interrupted block does not carry it.
 *
 * A samples switch reallocates two full-frame buffers, which the environment
 * switch does not — so that arm's warm frame is doing more work than the other's
 * and is excluded from the timing for the same reason.
 *
 * ## What the number is, stated rather than implied
 *
 * Each block times `K` back-to-back `render` calls and then reads one pixel,
 * which blocks until the pipeline has drained. So it is **throughput per frame
 * under saturation**, not the latency of a single frame, and the one sync is
 * amortised across the block rather than paid per frame. That is the right
 * shape for the question — "what does this term add to a frame" — and the wrong
 * shape for "what will the player's frame time be", which also carries vsync,
 * the compositor and everything else on the machine. `requestAnimationFrame`
 * cannot answer the first question at all: it is capped at the display's
 * refresh, so both arms would read 60 and the term would price at zero.
 *
 * **Read the difference; the absolute rate is not evidence of anything here.**
 * At the default `deviceScaleFactor` of 1 this reported 1,290 fps, which is
 * nothing's frame rate — the buffer was a quarter of a retina one. At 2 it
 * lands in the 330–390 fps band across runs, beside #98's 371 for the same
 * scene on the same machine. That is a **coincidence of magnitude and not a
 * corroboration**, which is worth saying because the first version of this
 * header claimed the latter: #98's figure does not record the drawing-buffer
 * size it was taken at, and this script's own scale-1 reading shows how much
 * that one unknown is worth. Two numbers agreeing while one of the variables
 * that produced them is unrecorded is not agreement.
 *
 * What is left, and what this script is for, is the difference between its two
 * arms — measured on one buffer, one camera and one clock.
 */
import { guardedOrigin, bootedGame, launchChromium } from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { installViewPlacement } from "./probe-guard.mjs";
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** The same fixture the view set uses, so a cost and a picture are claims about
 *  one build in one place (`view-set.mjs` has the argument for the seed). */
const SUBJECT = "station-trade";
const RADII = 3;

/** Frames per block, and blocks per arm. 120 is long enough that the single
 *  end-of-block sync is under a percent of the block, and short enough that a
 *  block is a few hundred milliseconds rather than a hang. */
const FRAMES = 120;
/** Blocks per arm. Twelve rather than six because six put the arms' spreads on
 *  top of each other: the low arm's worst block landed above the high arm's
 *  median, so the difference of two medians was reported with no way to see
 *  that. The dispersion is printed for the same reason. */
const BLOCKS = 12;

/**
 * Milliseconds per frame for one block at one quality, sample count and dither.
 *
 * The dither is set through `outputPass` rather than through the settings store
 * on purpose: the store writes `localStorage` and notifies every listener, and
 * an instrument should not leave a preference behind on the machine it measured.
 */
const block = (page, quality, samples, dither = true) =>
	page.evaluate(
		([q, frames, n, d]) => {
			const g = window.__seelite;
			const gl0 = g.renderer.getContext();
			g.settings.set("quality", q);
			// The order does not matter since #200 moved the count off the quality
			// key — `applyQuality` is lighting only again. It is written this way
			// round because the count is the term this line is here to pin, and a
			// reader should not have to check whether something above moved it.
			g.setComposerSamples(n);
			g.outputPass.setDither(d);
			// **What was allocated, not what was asked for.** A request lands on
			// the smallest supported count at or above it, so on a context that
			// grants only 4x a 2x block renders at 4x — and a table labelled by
			// the request would publish that as a 2x measurement. Read off the
			// bound framebuffer rather than off the request or the target's own
			// field, which are both the ask.
			g.renderer.setRenderTarget(g.composer.renderTarget1);
			const applied = gl0.getParameter(gl0.SAMPLES);
			g.renderer.setRenderTarget(null);
			// One warm frame after the switch: changing `scene.environment` changes
			// every standard material's program key, so the first frame at a new
			// setting pays a shader recompile that no later frame pays, and a
			// changed sample count pays a reallocation of both composer buffers.
			// Timing either would price the switch rather than the term.
			g.render(0);
			const sync = new Uint8Array(4);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			// Drain: `readPixels` blocks until everything queued has been drawn.
			// `gl.finish` does not reliably do so through ANGLE, which is why the
			// pixel read is here rather than a `finish` call.
			gl0.readPixels(0, 0, 1, 1, gl0.RGBA, gl0.UNSIGNED_BYTE, sync);
			return { ms: (performance.now() - started) / frames, applied };
		},
		[quality, FRAMES, samples, dither],
	);

/** A block returns `{ ms, applied }`; most of the statistics below want only
 *  the timings. */
const ms = (xs) => xs.map((r) => r.ms);

// The guard's *return* is what gets navigated, not the raw `ORIGIN` — the
// probes do it that way, and measuring a target the guard did not resolve is a
// silent way to measure a different server.
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
// `deviceScaleFactor: 2` and not the default 1: the drawing buffer is what the
// fill-rate-bound terms are paid over, and the machine this targets has a
// retina panel. At the default the buffer is a quarter of the player's and the
// environment's share of a frame is measured over four times too few
// fragments. `capture-views.mjs` deliberately does *not* do this — its output is
// an image at a declared 1440x900 — which is why the two scripts differ here.
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: SEED }));
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure");
await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
await page.evaluate(
	([id, radii]) =>
		window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
			comoving: true,
		}),
	[SUBJECT, RADII],
);

/**
 * The counts the settings screen offers, **asked of the store**.
 *
 * This was a sweep over a list written here, and the list was wrong: it carried
 * `8` and `16`, `SettingsStore.set` did not validate, and the instrument
 * reported a frame cost for a 16x target no player can ask for. `set` refuses
 * an unlisted value now, and this asks rather than guesses.
 */
const SAMPLES = await page.evaluate(() => [
	...window.__seelite.settings.allowed("antialias"),
]);

const high = [];
const low = [];
/** One list of blocks per count the screen offers, filled round-robin so a
 *  thermal drift lands on every arm rather than on whichever ran last. Every
 *  count rather than the strongest against zero: the choice in front of the
 *  player is three-way, and a table with a hole in the middle is one they would
 *  have to guess across. */
const bySamples = new Map([[0, []]]);
/** The dither arm, at the shipped sample count. Here because the player-facing
 *  note in `settings.ts` said it "costs nothing measurable" and nothing had
 *  measured it — the probe counts *pixels*, which is a different question. */
const dithered = [];
const undithered = [];
/**
 * **Every arm in a round runs in a shuffled order**, from a printed seed.
 *
 * `lib/measurement.mjs` owns the shuffler and the argument for it — the short
 * version is that a fixed arm order confounds a within-round thermal drift with
 * the arm perfectly, and once reported this script's dither term at 144/144
 * separation where shuffling makes it a coin toss.
 */
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20260902);
const shuffled = seededShuffler(ORDER_SEED);

/** Every arm as a thunk, so a round is a shuffle of one list. */
const arms = [
	() => block(page, "high", 0).then((r) => high.push(r)),
	() => block(page, "low", 0).then((r) => low.push(r)),
	...SAMPLES.map((n) => () => block(page, "high", n).then((r) => record(n, r))),
	() => block(page, "high", 0, true).then((r) => dithered.push(r)),
	() => block(page, "high", 0, false).then((r) => undithered.push(r)),
];

/** File a samples block under the count it was **applied** at. A context that
 *  rounds a request up puts two requests in one bucket, which is the honest
 *  place for them — the row then reports what was measured. */
const record = (requested, result) => {
	const at = result.applied;
	if (!bySamples.has(at)) bySamples.set(at, []);
	bySamples.get(at).push(result);
	if (at !== requested) rounded.set(requested, at);
};
/** Requests the driver did not honour exactly, so the report can say so rather
 *  than leave a reader wondering where a row went. */
const rounded = new Map();

for (let i = 0; i < BLOCKS; i++) for (const arm of shuffled(arms)) await arm();

const h = median(ms(high));
const l = median(ms(low));
const medians = new Map([...bySamples].map(([n, xs]) => [n, median(ms(xs))]));
const base = medians.get(0);
/** The counts blocks were actually allocated at, ascending — the rows below and
 *  every spread and separation line read this rather than the request list. */
const appliedCounts = [...medians.keys()].sort((a, b) => a - b);
const dOn = median(ms(dithered));
const dOff = median(ms(undithered));
console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height}, ${SUBJECT} at ${RADII} radii`,
);
console.log(`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, medians:`);
console.log(
	`  high (environment on)   ${h.toFixed(3)} ms/frame  ${(1000 / h).toFixed(0)} fps`,
);
console.log(
	`  low  (environment off)  ${l.toFixed(3)} ms/frame  ${(1000 / l).toFixed(0)} fps`,
);
console.log(
	`  the environment costs   ${(h - l).toFixed(3)} ms/frame  (${(((h - l) / l) * 100).toFixed(1)}%)`,
);
console.log("  both arms above unantialiased; quality high below:");
console.log(`  arm order shuffled, seed ${ORDER_SEED}`);
// **Rows are the counts that were *allocated*, not the ones requested.** A
// context that rounds a request up puts two requests in one bucket, so a loop
// over `SAMPLES` would look up a count with no bucket behind it and throw on
// `undefined.toFixed` — which is what this did until review ran it against the
// case its own comment described. The rounding is printed rather than silently
// merged, so a reader can see why a row is missing.
for (const [requested, at] of rounded)
	console.log(
		`  note: a request for ${requested} samples was allocated at ${at}`,
	);
for (const n of appliedCounts) {
	const t = medians.get(n);
	const times =
		n === 0 ? "" : `  ${(t / base).toFixed(1)}x the unsampled frame`;
	console.log(
		`  ${String(n).padStart(2)} samples             ${t.toFixed(3)} ms/frame  ${String(Math.round(1000 / t)).padStart(3)} fps${times}`,
	);
}
console.log(
	`  spread — high ${ms(high)
		.map((x) => x.toFixed(2))
		.join(" ")}`,
);
console.log(
	`  spread — low  ${ms(low)
		.map((x) => x.toFixed(2))
		.join(" ")}`,
);
// A difference of two medians the size of the blocks' own spread says nothing
// on its own, and the spreads here overlap. This is the statistic that does not
// need the reader to eyeball two rows.
//
// **Pairwise, not "how many clear the worst".** That was written first and is
// the mistake `#30` already recorded once: a statistic dominated by a single
// block. One slow block in the low arm — the machine doing something else for
// 300 ms — dropped it from 10/12 to 4/12 between two runs of the same build,
// while the medians barely moved. Counting every (high, low) pairing instead
// is the Mann-Whitney count: it assumes nothing about either distribution's
// shape, and one outlier can move it by at most a twelfth.
console.log(
	`  dither on               ${dOn.toFixed(3)} ms/frame  ${Math.round(1000 / dOn)} fps`,
);
console.log(
	`  dither off              ${dOff.toFixed(3)} ms/frame  ${Math.round(1000 / dOff)} fps`,
);
console.log(
	`  the dither costs        ${(dOn - dOff).toFixed(3)} ms/frame  (${(((dOn - dOff) / dOff) * 100).toFixed(1)}%)`,
);
console.log(
	`  separation — env        ${separation(ms(high), ms(low))} of pairings have the environment-on block slower`,
);
console.log(
	`  separation — dither     ${separation(ms(dithered), ms(undithered))} of pairings have the dithered block slower`,
);
for (const n of appliedCounts.filter((n) => n > 0)) {
	console.log(
		`  spread — ${String(n).padStart(2)} samples     ${ms(bySamples.get(n))
			.map((x) => x.toFixed(2))
			.join(" ")}`,
	);
	console.log(
		`  separation — ${String(n).padStart(2)} samples ${separation(ms(bySamples.get(n)), ms(bySamples.get(0)))} of pairings have the multisampled block slower`,
	);
}
console.log(
	`  spread —  0 samples     ${ms(bySamples.get(0))
		.map((x) => x.toFixed(2))
		.join(" ")}`,
);

await browser.close();
