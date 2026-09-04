/**
 * Headed attached/detached CPU evidence for the live frame-attribution sampler.
 *
 *   npm run dev
 *   node scripts/measure-frame-attribution.mjs
 *
 * This is an instrument, not a probe: it always reports and never invents a
 * machine-independent budget. It refuses software rendering, names the actual
 * ANGLE rasterizer, and alternates detached/attached blocks on one page so
 * scene, drawing buffer, browser, and thermal drift stay comparable.
 *
 * The measured duration wraps the `Game.render` already called by the live
 * loop. The between-block delta is an observed association, not an isolated
 * sampler cost: it also contains ordinary render variation between blocks.
 * Composer GPU time comes separately from the sampler's delayed timer queries;
 * requestAnimationFrame cadence is intentionally not presented as GPU cost.
 */
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { rollingStatistics } from "../src/frame-statistics.js";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const SEED = 47;
const VIEWPORT = { width: 1440, height: 900 };
const BLOCKS = 8;
const FRAMES_PER_BLOCK = 40;

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/frame-attribution.ts",
]);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({ viewport: VIEWPORT });
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure frame attribution");

const measureBlock = (enabled) =>
	page.evaluate(
		async ({ enabled: attach, frames }) => {
			const game = window.__seelite;
			if (!window.__frameAttributionMeasure) {
				const state = { capture: false, samples: [] };
				const render = game.render.bind(game);
				game.render = (...args) => {
					const started = performance.now();
					try {
						return render(...args);
					} finally {
						if (state.capture) state.samples.push(performance.now() - started);
					}
				};
				window.__frameAttributionMeasure = state;
			}
			const state = window.__frameAttributionMeasure;
			if (attach) await game.enableFrameAttribution();
			else game.disableFrameAttribution();
			// Let the enable/disable change and query ring settle outside the samples.
			for (let i = 0; i < 8; i++)
				await new Promise((resolve) => requestAnimationFrame(resolve));
			state.samples = [];
			state.capture = true;
			await new Promise((resolve) => {
				const waitForSamples = () =>
					state.samples.length >= frames
						? resolve()
						: requestAnimationFrame(waitForSamples);
				requestAnimationFrame(waitForSamples);
			});
			state.capture = false;
			return {
				samples: state.samples.slice(0, frames),
				snapshot: game.attributionSnapshot(),
				buffer: {
					width: game.renderer.domElement.width,
					height: game.renderer.domElement.height,
					pixelRatio: game.renderer.getPixelRatio(),
				},
			};
		},
		{ enabled, frames: FRAMES_PER_BLOCK },
	);

const detached = [];
const attached = [];
let lastAttached = null;
let buffer = null;
for (let block = 0; block < BLOCKS; block++) {
	// Reverse every other pair so neither arm always lands first.
	for (const enabled of block % 2 === 0 ? [false, true] : [true, false]) {
		const result = await measureBlock(enabled);
		const blockMedian = rollingStatistics(result.samples).medianMs;
		if (blockMedian === null)
			throw new Error("render block produced no samples");
		(enabled ? attached : detached).push(blockMedian);
		if (enabled) lastAttached = result.snapshot;
		buffer = result.buffer;
	}
}
await page.evaluate(() => window.__seelite.disableFrameAttribution());

const detachedStats = rollingStatistics(detached);
const attachedStats = rollingStatistics(attached);
if (
	detachedStats.medianMs === null ||
	detachedStats.p95Ms === null ||
	attachedStats.medianMs === null ||
	attachedStats.p95Ms === null
)
	throw new Error("attached/detached blocks produced no samples");
const detachedMedian = detachedStats.medianMs;
const attachedMedian = attachedStats.medianMs;
const deltaMs = attachedMedian - detachedMedian;
const deltaPercent = (deltaMs / detachedMedian) * 100;

console.log(`renderer: ${renderer}`);
console.log(
	`buffer: ${buffer.width}x${buffer.height} at pixel ratio ${buffer.pixelRatio}`,
);
console.log(
	`detached CPU submission: ${detachedMedian.toFixed(3)} ms median block, ${detachedStats.p95Ms.toFixed(3)} ms p95 block`,
);
console.log(
	`attached CPU submission: ${attachedMedian.toFixed(3)} ms median block, ${attachedStats.p95Ms.toFixed(3)} ms p95 block`,
);
console.log(
	`observed attached-minus-detached delta: ${deltaMs >= 0 ? "+" : ""}${deltaMs.toFixed(3)} ms (${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}%)`,
);
console.log(
	`delayed composer GPU state: ${lastAttached.gpu.status}, ${lastAttached.gpu.sampleCount} retained samples, ${lastAttached.gpu.medianMs?.toFixed(3) ?? "—"} ms median`,
);
console.log(
	"scope: whole-render CPU submission A/B plus composer-only GPU time; requestAnimationFrame cadence is not GPU execution time",
);

await browser.close();
