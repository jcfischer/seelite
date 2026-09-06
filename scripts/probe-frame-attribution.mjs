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
		queryEvents: [],
	};
	window.__frameAttributionCalls = calls;
	const proto = globalThis.WebGL2RenderingContext?.prototype;
	if (!proto) return;
	const queryIds = new WeakMap();
	let nextQueryId = 1;
	const queryId = (query) => {
		if (!queryIds.has(query)) queryIds.set(query, nextQueryId++);
		return queryIds.get(query);
	};
	const wrap = (name, before, after = () => {}) => {
		const original = proto[name];
		if (typeof original !== "function") return;
		proto[name] = function (...args) {
			before.call(this, args);
			const result = Reflect.apply(original, this, args);
			after.call(this, args, result);
			return result;
		};
	};
	wrap("beginQuery", (args) => {
		calls.beginQuery++;
		calls.queryEvents.push({ kind: "begin", id: queryId(args[1]) });
	});
	wrap("endQuery", () => calls.endQuery++);
	wrap("readPixels", () => calls.readPixels++);
	wrap("getExtension", (args) => {
		if (args[0] === "EXT_disjoint_timer_query_webgl2")
			calls.timerExtensionReads++;
	});
	wrap(
		"getQueryParameter",
		() => {},
		function (args, result) {
			const id = queryId(args[0]);
			if (args[1] === this.QUERY_RESULT_AVAILABLE) {
				calls.availableReads++;
				calls.queryEvents.push({
					kind: "available",
					id,
					ready: Boolean(result),
				});
			}
			if (args[1] === this.QUERY_RESULT) {
				calls.resultReads++;
				calls.queryEvents.push({ kind: "result", id });
			}
		},
	);
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

const concurrentEnable = await page.evaluate(async () => {
	const game = window.__seelite;
	const before = game.renderer.info.autoReset;
	const canceled = game.enableFrameAttribution();
	game.disableFrameAttribution();
	const canceledResult = await canceled;
	const canceledStayedDetached = game.attributionSnapshot() === null;
	const [first, second] = await Promise.all([
		game.enableFrameAttribution(),
		game.enableFrameAttribution(),
	]);
	const during = game.renderer.info.autoReset;
	game.disableFrameAttribution();
	return {
		canceledResult,
		canceledStayedDetached,
		sameSampler: first === second,
		before,
		during,
		after: game.renderer.info.autoReset,
		snapshotAfter: game.attributionSnapshot(),
	};
});
t.check(
	"concurrent enables share one sampler and disable restores renderer counters",
	concurrentEnable.canceledResult === null &&
		concurrentEnable.canceledStayedDetached &&
		concurrentEnable.sameSampler &&
		!concurrentEnable.during &&
		concurrentEnable.after === concurrentEnable.before &&
		concurrentEnable.snapshotAfter === null,
	JSON.stringify(concurrentEnable),
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
	"CPU simulation/step",
	"CPU render submission",
	"GPU status",
	"GPU composer execution",
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
const readyQueries = new Set();
const resultOrderIsValid = perf.calls.queryEvents.every((event) => {
	if (event.kind === "begin") readyQueries.delete(event.id);
	if (event.kind === "available" && event.ready) readyQueries.add(event.id);
	if (event.kind !== "result") return true;
	if (!readyQueries.has(event.id)) return false;
	readyQueries.delete(event.id);
	return true;
});
/**
 * Three outcomes rather than two, because #246 added a third shape: a backend
 * whose extension is present, whose queries resolve, and whose numbers are not
 * to be believed. A refusal owes a reason and **no figure** — a refused median
 * that is still printed is one that gets transcribed into a receipt.
 */
const REFUSED = new Set(["untrusted", "implausible"]);
const timingIsExplicit = !snapshot.gpu.supported
	? snapshot.gpu.status === "unavailable" &&
		snapshot.gpu.medianMs === null &&
		snapshot.gpu.p95Ms === null
	: REFUSED.has(snapshot.gpu.status)
		? snapshot.gpu.medianMs === null &&
			snapshot.gpu.p95Ms === null &&
			typeof snapshot.gpu.reason === "string" &&
			snapshot.gpu.reason.length > 0
		: snapshot.gpu.status === "supported" &&
			snapshot.gpu.sampleCount > 0 &&
			snapshot.gpu.medianMs !== null &&
			snapshot.gpu.p95Ms !== null &&
			snapshot.gpu.reason === null;
t.check(
	"GPU timing is supported evidence, an explicit refusal with a reason, or unavailable",
	timingIsExplicit,
	JSON.stringify(snapshot.gpu),
);
t.check(
	"named CPU intervals carry samples",
	snapshot.cpu["simulation/step"].sampleCount > 0 &&
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
			resultOrderIsValid &&
			perf.calls.resultReads > 0),
	JSON.stringify(perf.calls),
);

console.log(
	`\nrenderer: ${snapshot.renderer.rasterizer ?? snapshot.renderer.api ?? "unavailable"}`,
);
console.log(`gpu: ${JSON.stringify(snapshot.gpu)}`);

await browser.close();
t.exit();
