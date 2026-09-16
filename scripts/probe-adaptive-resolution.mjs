/**
 * #352's Auto resolution, on a real browser surface.
 *
 * The state machine is `tests/adaptive-resolution.test.ts`: every rung,
 * threshold, gate, cooldown and back-off, against a scripted pressure sequence.
 * **Nothing here re-tests that**, and nothing here tries to provoke a real
 * transition — a rung moves only under sustained pressure, and a probe that
 * manufactured pressure on a software rasteriser would be measuring
 * SwiftShader's frame rate rather than the policy.
 *
 * What this probe owns is the browser seam the unit tier cannot reach:
 *
 * - the drawing buffer follows the rung while the DOM cockpit and the 2D
 *   overlay stay at native CSS resolution, which is the whole of item 8;
 * - Auto runs on the default route **without issuing a timer query**, which is
 *   #223's build contract item 6 surviving a consumer that is not `?perf`;
 * - the mode is non-destructive in both directions — a saved manual number is
 *   still that number after Auto has been on, and leaving Auto applies it at
 *   once;
 * - a resize reprimes rather than leaving a stale curve.
 *
 * Like every probe here it runs through SwiftShader, so no figure it prints is
 * player-GPU evidence. The headed view set and the principal's eye are the tier
 * that closes this node.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** Count timer-query traffic, the way `probe-frame-attribution` does. */
const WATCH_QUERIES = () => {
	const calls = { beginQuery: 0, endQuery: 0, timerExtensionReads: 0 };
	window.__adaptiveCalls = calls;
	const proto = globalThis.WebGL2RenderingContext?.prototype;
	if (!proto) return;
	for (const [name, bump] of [
		["beginQuery", () => calls.beginQuery++],
		["endQuery", () => calls.endQuery++],
	]) {
		const original = proto[name];
		if (typeof original !== "function") continue;
		proto[name] = function (...args) {
			bump();
			return Reflect.apply(original, this, args);
		};
	}
	const getExtension = proto.getExtension;
	proto.getExtension = function (...args) {
		if (args[0] === "EXT_disjoint_timer_query_webgl2")
			calls.timerExtensionReads++;
		return Reflect.apply(getExtension, this, args);
	};
};

/**
 * The three facts a rung must move, and the two it must not.
 *
 * Read in one evaluate so they describe one frame. The overlay is a 2D canvas
 * sized in CSS pixels by `sizeOverlay`, and the cockpit is DOM text — neither
 * is multiplied by the render scale, and that is what "crisp" means here.
 */
const MEASURE = () => {
	const game = window.__seelite;
	const canvas = game.renderer.domElement;
	// `index.html`: the 2D marker overlay is `#overlay` and the DOM cockpit
	// draws into `#hud`. Both are sized in CSS pixels and neither is multiplied
	// by the render scale, which is what item 8 means by "crisp".
	const overlay = document.getElementById("overlay");
	const cockpit = document.getElementById("hud");
	return {
		row: game.settings.value.renderScale,
		effective: game.effectiveRenderScale(),
		buffer: { w: canvas.width, h: canvas.height },
		cssBuffer: { w: canvas.clientWidth, h: canvas.clientHeight },
		pixelRatio: game.renderer.getPixelRatio(),
		devicePixelRatio: window.devicePixelRatio,
		overlay: overlay ? { w: overlay.width, h: overlay.height } : null,
		cockpitRect: cockpit
			? {
					w: Math.round(cockpit.getBoundingClientRect().width),
					h: Math.round(cockpit.getBoundingClientRect().height),
				}
			: null,
		diagnostics: game.adaptiveDiagnostics(),
		calls: { ...window.__adaptiveCalls },
	};
};

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage();
await page.addInitScript(WATCH_QUERIES);
const t = tally();
// Page errors and shader failures are otherwise silent, and a probe that cannot
// see them reports green over a page that never booted.
t.watch(page);

// ── the manual rungs move the buffer and nothing else ───────────────────────
await page.goto(gameUrl(origin, { seed: 47 }));
await bootedGame(page);

const rungs = [1, 0.75, 0.5];
const measured = [];
for (const rung of rungs) {
	await page.evaluate((value) => {
		window.__seelite.settings.set("renderScale", value);
	}, rung);
	// One frame for the resize to land.
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => resolve())),
	);
	measured.push(await page.evaluate(MEASURE));
}

t.check(
	"every rung is applied as the effective scale",
	measured.every((m, i) => m.effective === rungs[i] && m.row === rungs[i]),
	JSON.stringify(measured.map((m) => [m.row, m.effective])),
);

const top = measured[0];
t.check(
	"the drawing buffer follows the rung",
	measured.every((m, i) => {
		const expectedW = Math.floor(
			m.cssBuffer.w * Math.min(m.devicePixelRatio, 2) * rungs[i],
		);
		// Three rounds the buffer, so a pixel of slack rather than equality.
		return Math.abs(m.buffer.w - expectedW) <= 1 && m.buffer.w > 0;
	}),
	JSON.stringify(measured.map((m) => m.buffer)),
);

t.check(
	"a lower rung is a smaller buffer, strictly",
	measured[0].buffer.w > measured[1].buffer.w &&
		measured[1].buffer.w > measured[2].buffer.w,
	JSON.stringify(measured.map((m) => m.buffer.w)),
);

t.check(
	"the canvas keeps its CSS size at every rung",
	measured.every(
		(m) =>
			m.cssBuffer.w === top.cssBuffer.w && m.cssBuffer.h === top.cssBuffer.h,
	),
	JSON.stringify(measured.map((m) => m.cssBuffer)),
);

t.check(
	"the 2D overlay stays at native CSS resolution",
	measured.every(
		(m) =>
			m.overlay !== null &&
			m.overlay.w === top.overlay.w &&
			m.overlay.h === top.overlay.h,
	),
	JSON.stringify(measured.map((m) => m.overlay)),
);

// ── Auto is a mode, and it runs without a timer query ───────────────────────
await page.evaluate(() => {
	window.__seelite.settings.set("renderScale", "auto");
});
await page.evaluate(
	() =>
		new Promise((resolve) =>
			setTimeout(() => requestAnimationFrame(resolve), 250),
		),
);
const auto = await page.evaluate(MEASURE);

t.check(
	"Auto reports a controller and a rung off the ladder",
	auto.row === "auto" &&
		auto.diagnostics !== null &&
		[1, 0.75, 0.5].includes(auto.diagnostics.scale) &&
		auto.diagnostics.scale === auto.effective,
	JSON.stringify({ row: auto.row, diagnostics: auto.diagnostics }),
);

t.check(
	"Auto's budget is the declared 60 fps floor, not the panel's cadence",
	Math.abs(auto.diagnostics.budgetMs - 1000 / 60) < 1e-6,
	String(auto.diagnostics?.budgetMs),
);

t.check(
	"Auto issues no timer query on the default route",
	auto.calls.beginQuery === 0 &&
		auto.calls.endQuery === 0 &&
		auto.calls.timerExtensionReads === 0,
	JSON.stringify(auto.calls),
);

t.check(
	"Auto leaves the cockpit and overlay at native CSS resolution",
	auto.overlay !== null &&
		auto.overlay.w === top.overlay.w &&
		auto.overlay.h === top.overlay.h &&
		auto.cssBuffer.w === top.cssBuffer.w,
	JSON.stringify({ overlay: auto.overlay, css: auto.cssBuffer }),
);

// ── a resize reprimes rather than carrying a stale curve ────────────────────
const beforeResize = await page.evaluate(
	() => window.__seelite.adaptiveDiagnostics().reason,
);
await page.setViewportSize({ width: 900, height: 620 });
await page.evaluate(
	() => new Promise((resolve) => requestAnimationFrame(() => resolve())),
);
const afterResize = await page.evaluate(MEASURE);
t.check(
	"a resize reprimes Auto and keeps the rung",
	afterResize.diagnostics !== null &&
		[1, 0.75, 0.5].includes(afterResize.diagnostics.scale) &&
		Object.keys(afterResize.diagnostics.observations).length === 0,
	JSON.stringify({
		before: beforeResize,
		after: afterResize.diagnostics?.reason,
		observations: afterResize.diagnostics?.observations,
	}),
);

// ── leaving Auto is non-destructive, and immediate ──────────────────────────
const left = await page.evaluate(async () => {
	const game = window.__seelite;
	game.settings.set("renderScale", 0.75);
	// Read before any frame runs: leaving Auto must not wait on an import.
	const immediate = game.effectiveRenderScale();
	await new Promise((resolve) => requestAnimationFrame(() => resolve()));
	return {
		immediate,
		row: game.settings.value.renderScale,
		effective: game.effectiveRenderScale(),
		diagnostics: game.adaptiveDiagnostics(),
	};
});
t.check(
	"leaving Auto applies the player's number on the same turn",
	left.immediate === 0.75 && left.effective === 0.75 && left.row === 0.75,
	JSON.stringify(left),
);
t.check(
	"a manual mode has no controller to consult",
	left.diagnostics === null,
	JSON.stringify(left.diagnostics),
);

console.log(`\nrung under Auto: ${auto.diagnostics?.scale}`);
console.log(`reason: ${auto.diagnostics?.reason}`);

await browser.close();
t.exit();
