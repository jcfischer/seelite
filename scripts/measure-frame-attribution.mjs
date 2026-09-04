/**
 * Headed CPU-overhead evidence for the live frame-attribution sampler.
 *
 *   npm run dev
 *   node scripts/measure-frame-attribution.mjs
 *
 * This is an instrument, not a probe: it always reports and never invents a
 * machine-independent budget. It refuses software rendering, names the actual
 * ANGLE rasterizer, and alternates detached/attached blocks on one page so
 * scene, drawing buffer, browser, and thermal drift stay comparable.
 *
 * The measured duration is JavaScript submission time around one `Game.render`
 * per display frame. It is the sampler's CPU overhead, not GPU execution time.
 * GPU execution comes separately from the sampler's delayed timer queries;
 * requestAnimationFrame cadence is intentionally not presented as GPU cost.
 */
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const SEED = 47;
const VIEWPORT = { width: 1440, height: 900 };
const BLOCKS = 8;
const FRAMES_PER_BLOCK = 40;

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
};

const p95 = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
};

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
			if (attach) await game.enableFrameAttribution();
			else game.disableFrameAttribution();
			// Let the lifecycle change and query ring settle outside the samples.
			for (let i = 0; i < 8; i++)
				await new Promise((resolve) => requestAnimationFrame(resolve));
			const samples = [];
			for (let i = 0; i < frames; i++) {
				await new Promise((resolve) => requestAnimationFrame(resolve));
				const started = performance.now();
				game.render(0);
				samples.push(performance.now() - started);
			}
			return {
				samples,
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
		const blockMedian = median(result.samples);
		(enabled ? attached : detached).push(blockMedian);
		if (enabled) lastAttached = result.snapshot;
		buffer = result.buffer;
	}
}
await page.evaluate(() => window.__seelite.disableFrameAttribution());

const detachedMedian = median(detached);
const attachedMedian = median(attached);
const deltaMs = attachedMedian - detachedMedian;
const deltaPercent = (deltaMs / detachedMedian) * 100;

console.log(`renderer: ${renderer}`);
console.log(
	`buffer: ${buffer.width}x${buffer.height} at pixel ratio ${buffer.pixelRatio}`,
);
console.log(
	`detached CPU submission: ${detachedMedian.toFixed(3)} ms median block, ${p95(detached).toFixed(3)} ms p95 block`,
);
console.log(
	`attached CPU submission: ${attachedMedian.toFixed(3)} ms median block, ${p95(attached).toFixed(3)} ms p95 block`,
);
console.log(
	`attribution CPU overhead: ${deltaMs >= 0 ? "+" : ""}${deltaMs.toFixed(3)} ms (${deltaPercent >= 0 ? "+" : ""}${deltaPercent.toFixed(1)}%)`,
);
console.log(
	`delayed GPU state: ${lastAttached.gpu.status}, ${lastAttached.gpu.sampleCount} retained samples, ${lastAttached.gpu.medianMs?.toFixed(3) ?? "—"} ms median`,
);
console.log(
	"scope: CPU submission overhead only; requestAnimationFrame cadence is not GPU execution time",
);

await browser.close();
