/**
 * What #99's baked environment costs a frame, **on the renderer the player has**.
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
 * ## How the two arms are kept comparable
 *
 * One page, one camera, one clock start, and the quality setting toggled **in
 * place** between blocks. Nothing is reloaded: a reload puts the ship somewhere
 * else and the two arms would then differ by their position as much as by the
 * term, which is `perf-panel.ts`'s whole argument for live switches. The blocks
 * alternate (high, low, high, low, …) so a thermal drift or a background task
 * lands on both arms rather than on whichever ran second, and the reported
 * figure is the **median** block, so one interrupted block does not carry it.
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
import { installViewFraming } from "./lib/view-placement.mjs";
import { installViewPlacement } from "./probe-guard.mjs";
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";

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

/** Milliseconds per frame for one block at one quality. */
const block = (page, quality) =>
	page.evaluate(
		([q, frames]) => {
			const g = window.__seelite;
			g.settings.set("quality", q);
			// One warm frame after the switch: changing `scene.environment` changes
			// every standard material's program key, so the first frame at a new
			// setting pays a shader recompile that no later frame pays. Timing it
			// would price the switch rather than the term.
			g.render(0);
			const gl = g.renderer.getContext();
			const sync = new Uint8Array(4);
			const started = performance.now();
			for (let i = 0; i < frames; i++) g.render(0);
			// Drain: `readPixels` blocks until everything queued has been drawn.
			// `gl.finish` does not reliably do so through ANGLE, which is why the
			// pixel read is here rather than a `finish` call.
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			return (performance.now() - started) / frames;
		},
		[quality, FRAMES],
	);

const median = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const mid = s.length >> 1;
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// The guard's *return* is what gets navigated, not the raw `ORIGIN` — the
// probes do it that way, and measuring a target the guard did not resolve is a
// silent way to measure a different server.
const origin = await guardedOrigin(ORIGIN, ["src/main.ts", "src/light-rig.ts"]);
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
await page.goto(`${origin}/?seed=${SEED}`);
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

const high = [];
const low = [];
for (let i = 0; i < BLOCKS; i++) {
	high.push(await block(page, "high"));
	low.push(await block(page, "low"));
}

const h = median(high);
const l = median(low);
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
console.log(`  spread — high ${high.map((x) => x.toFixed(2)).join(" ")}`);
console.log(`  spread — low  ${low.map((x) => x.toFixed(2)).join(" ")}`);
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
let slower = 0;
for (const h of high) for (const l of low) if (h > l) slower++;
const pairs = high.length * low.length;
console.log(
	`  separation              ${slower}/${pairs} pairings have the environment-on block slower (${((slower / pairs) * 100).toFixed(0)}%)`,
);

await browser.close();
