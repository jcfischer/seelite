/**
 * The query-gated frame-attribution diagnostic, on a real browser surface.
 *
 * Unit tests own timer-query scheduling and every explicit state. This probe
 * owns the browser seam: default and ?fps routes stay detached, ?perf exposes
 * the labels and render-shape facts, and live sampling never calls readPixels.
 * Like every probe in this repo it runs through SwiftShader, so its GPU number
 * is not player-performance evidence; the separate headed instrument records
 * overhead on the named ANGLE Metal renderer.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/**
 * Count the calls that distinguish an asynchronous query from a hidden fence.
 * Installed before every navigation so the counters survive route reloads.
 */
const WATCH_WEBGL = () => {
	const calls = {
		beginQuery: 0,
		endQuery: 0,
		availableReads: 0,
		resultReads: 0,
		readPixels: 0,
		timerExtensionReads: 0,
	};
	window.__frameAttributionCalls = calls;
	const proto = globalThis.WebGL2RenderingContext?.prototype;
	if (!proto) return;
	const wrap = (name, count) => {
		const original = proto[name];
		if (typeof original !== "function") return;
		proto[name] = function (...args) {
			count.call(this, args);
			return Reflect.apply(original, this, args);
		};
	};
	wrap("beginQuery", () => calls.beginQuery++);
	wrap("endQuery", () => calls.endQuery++);
	wrap("readPixels", () => calls.readPixels++);
	wrap("getExtension", (args) => {
		if (args[0] === "EXT_disjoint_timer_query_webgl2")
			calls.timerExtensionReads++;
	});
	wrap("getQueryParameter", function (args) {
		if (args[1] === this.QUERY_RESULT_AVAILABLE) calls.availableReads++;
		if (args[1] === this.QUERY_RESULT) calls.resultReads++;
	});
};

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/frame-attribution.ts",
]);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
const t = tally();
t.watch(page);
await page.addInitScript(WATCH_WEBGL);

// ── default route: no UI, sampler, or query traffic ──────────────────────────
await page.goto(`${origin}/?seed=47`);
await bootedGame(page);
const defaultRoute = await page.evaluate(() => ({
	panel: Boolean(document.getElementById("seelite-perf")),
	snapshot: window.__seelite.attributionSnapshot(),
	calls: { ...window.__frameAttributionCalls },
}));
t.check(
	"the default route mounts no attribution UI or sampler",
	!defaultRoute.panel && defaultRoute.snapshot === null,
	`panel ${defaultRoute.panel}, snapshot ${JSON.stringify(defaultRoute.snapshot)}`,
);
t.check(
	"the default route issues no timer query",
	defaultRoute.calls.beginQuery === 0 &&
		defaultRoute.calls.endQuery === 0 &&
		defaultRoute.calls.resultReads === 0,
	JSON.stringify(defaultRoute.calls),
);

// ── ?fps stays a cadence meter, not an attribution alias ────────────────────
await page.goto(`${origin}/?seed=47&fps=1`);
await bootedGame(page);
const fpsRoute = await page.evaluate(() => ({
	fps: Boolean(document.querySelector("[data-fps-meter]")),
	panel: Boolean(document.getElementById("seelite-perf")),
	snapshot: window.__seelite.attributionSnapshot(),
	calls: { ...window.__frameAttributionCalls },
}));
t.check(
	"?fps remains separate from frame attribution",
	fpsRoute.fps && !fpsRoute.panel && fpsRoute.snapshot === null,
	`fps ${fpsRoute.fps}, panel ${fpsRoute.panel}, snapshot ${JSON.stringify(fpsRoute.snapshot)}`,
);
t.check(
	"?fps issues no timer query",
	fpsRoute.calls.beginQuery === 0 &&
		fpsRoute.calls.endQuery === 0 &&
		fpsRoute.calls.resultReads === 0,
	JSON.stringify(fpsRoute.calls),
);

// ── ?perf owns the sampler and reports the rendered frame ──────────────────
await page.goto(`${origin}/?seed=47&perf=1`);
await bootedGame(page);
await page.waitForSelector("#seelite-perf[data-attribution-enabled='true']");
await page.waitForFunction(
	() =>
		["supported", "unavailable"].includes(
			document.getElementById("seelite-perf")?.dataset.gpuStatus ?? "",
		),
	null,
	{ timeout: 15_000 },
);

// Reset only the fence counter after boot. Three may perform unrelated setup
// work before the sampler mounts; the live frames below are the diagnostic's.
await page.evaluate(() => {
	window.__frameAttributionCalls.readPixels = 0;
});
await page.evaluate(
	() =>
		new Promise((resolve) => {
			let left = 8;
			const frame = () =>
				--left <= 0 ? resolve() : requestAnimationFrame(frame);
			requestAnimationFrame(frame);
		}),
);

const perf = await page.evaluate(() => {
	const panel = document.getElementById("seelite-perf");
	return {
		text: panel?.textContent ?? "",
		dataset: { ...panel?.dataset },
		snapshot: window.__seelite.attributionSnapshot(),
		calls: { ...window.__frameAttributionCalls },
	};
});

const labels = [
	"FRAME ATTRIBUTION",
	"CPU simulation/update",
	"CPU render submission",
	"GPU status",
	"GPU execution",
	"draw calls / triangles",
	"programs / geometries",
	"drawing buffer",
	"pixel ratio / render scale",
	"composer passes",
	"renderer",
	"rasterizer",
];
t.check(
	"?perf exposes every attribution label",
	labels.every((label) => perf.text.includes(label)),
	labels.filter((label) => !perf.text.includes(label)).join(", ") ||
		"all present",
);

const snapshot = perf.snapshot;
const timingIsExplicit = snapshot.gpu.supported
	? snapshot.gpu.status === "supported" &&
		snapshot.gpu.sampleCount > 0 &&
		snapshot.gpu.medianMs !== null &&
		snapshot.gpu.p95Ms !== null
	: snapshot.gpu.status === "unavailable" &&
		snapshot.gpu.medianMs === null &&
		snapshot.gpu.p95Ms === null;
t.check(
	"GPU timing is either supported evidence or explicitly unavailable",
	timingIsExplicit,
	JSON.stringify(snapshot.gpu),
);
t.check(
	"named CPU intervals carry samples",
	snapshot.cpu["simulation/update"].sampleCount > 0 &&
		snapshot.cpu["render submission/composer"].sampleCount > 0,
	JSON.stringify(snapshot.cpu),
);
t.check(
	"the snapshot carries drawing-buffer and render-shape facts",
	snapshot.renderer.drawingBufferWidth > 0 &&
		snapshot.renderer.drawingBufferHeight > 0 &&
		snapshot.renderer.effectivePixelRatio > 0 &&
		snapshot.renderer.renderScale > 0 &&
		snapshot.renderer.composerPassCount > 0 &&
		snapshot.renderer.calls > 0 &&
		snapshot.renderer.triangles > 0 &&
		snapshot.renderer.programs > 0 &&
		snapshot.renderer.geometries > 0 &&
		snapshot.renderer.textures > 0,
	JSON.stringify(snapshot.renderer),
);
t.check(
	"the live sampler never calls readPixels",
	perf.calls.readPixels === 0,
	JSON.stringify(perf.calls),
);
t.check(
	"supported timing reads results only after availability polling",
	!snapshot.gpu.supported ||
		(perf.calls.beginQuery > 0 &&
			perf.calls.endQuery > 0 &&
			perf.calls.availableReads >= perf.calls.resultReads &&
			perf.calls.resultReads > 0),
	JSON.stringify(perf.calls),
);

console.log(
	`\nrenderer: ${snapshot.renderer.rasterizer ?? snapshot.renderer.api ?? "unavailable"}`,
);
console.log(`gpu: ${JSON.stringify(snapshot.gpu)}`);

await browser.close();
t.exit();
