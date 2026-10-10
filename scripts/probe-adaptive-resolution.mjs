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
 *   #223's build contract item 6 surviving a consumer that is not the perf
 *   panel;
 * - the mode is non-destructive in both directions — a saved manual number is
 *   still that number after Auto has been on, and leaving Auto applies it at
 *   once;
 * - a resize reprimes rather than leaving a stale curve.
 *
 * The default lane runs on the player GPU; `npm run probe:cpu` retains the
 * SwiftShader portability path. Neither one turns this browser seam into the
 * policy proof, which remains the headless state-machine suite.
 */
import {
	bootedGame,
	interiorModelsSettled,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** Count timer-query traffic, the way `probe-frame-attribution` does. */
const WATCH_QUERIES = () => {
	const calls = {
		beginQuery: 0,
		endQuery: 0,
		timerExtensionReads: 0,
		rendererReads: 0,
	};
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
	// `gl.RENDERER` (0x1f01) is read by a full attribution snapshot and by
	// nothing else once the page is running, so its count is a clean signal of
	// whether the controller is building one per frame.
	const getParameter = proto.getParameter;
	proto.getParameter = function (...args) {
		if (args[0] === 0x1f01) calls.rendererReads++;
		return Reflect.apply(getParameter, this, args);
	};
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
await interiorModelsSettled(page);

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
//
// **Back to 100% first, so Auto starts at the top.** A controller starts from
// the rung last applied, and the manual loop above ends at 50% — so in the
// first version Auto *began* on the bottom rung, and the row that was meant to
// show it stepping down read `scale < 1` as true before the controller had done
// anything. Sage found that neither steering row could go red on a build whose
// controller never moved.
await page.evaluate(() => {
	window.__seelite.settings.set("renderScale", 1);
});
await page.evaluate(
	() => new Promise((resolve) => requestAnimationFrame(() => resolve())),
);
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

// ── the signal reaches the controller, and the controller acts on it ────────
//
// **The check the rest of this probe cannot make.** Every row above passes on a
// build where `markFrame` is never called: the ladder is still the ladder, the
// budget is still 60 fps, and a controller with an empty cadence ring reports a
// perfectly good rung — the one it started on, for ever. The first version of
// this probe waited 250 ms, collected one frame, read "no frame period" and
// called that green.
//
// It is written as an implication rather than an assertion about the rung,
// because the second half is a fact about this machine and the first is not. On
// SwiftShader at 1280x720 the frame runs far over budget and Auto walks down
// the ladder; on a rasteriser that held 60 fps it would sit at the top and
// still be working. What must be true either way is that a period arrives.
const steered = await page.evaluate(async () => {
	const game = window.__seelite;
	/**
	 * **A trace, not an instant.** Both versions of these rows before this one
	 * read the controller once, at the end of the window, and that instant is
	 * as likely as any other to fall just after a rung change — which reprimes
	 * the ring and reads `no frame period` for a moment. Running the I2 red
	 * build turned both rows red for exactly that reason, with nothing wrong in
	 * the controller. So every sample is kept and the rows ask what happened
	 * across the window.
	 */
	const trace = [];
	const until = performance.now() + 6_000;
	while (performance.now() < until) {
		const d = game.adaptiveDiagnostics();
		if (d) trace.push({ scale: d.scale, periodMs: d.periodMedianMs });
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	const rungs = [];
	for (const { scale } of trace)
		if (rungs[rungs.length - 1] !== scale) rungs.push(scale);
	return {
		trace,
		rungs,
		mode: game.attributionSnapshot()?.mode ?? null,
		budgetMs: game.adaptiveDiagnostics()?.budgetMs ?? null,
		downshiftTriggerMs: game.adaptiveDiagnostics()?.downshiftTriggerMs ?? null,
	};
});
const periods = steered.trace
	.map((sample) => sample.periodMs)
	.filter((ms) => typeof ms === "number" && ms > 0);
// Over budget *at the top rung*, which is the only state a descent is owed by.
const overBudgetAtTop = steered.trace.some(
	(sample) =>
		sample.scale === 1 &&
		typeof sample.periodMs === "number" &&
		typeof steered.downshiftTriggerMs === "number" &&
		sample.periodMs > steered.downshiftTriggerMs,
);

t.check(
	"the frame period reaches the controller",
	steered.mode === "cadence" && periods.length > 0,
	JSON.stringify({
		mode: steered.mode,
		samples: steered.trace.length,
		periods: periods.length,
	}),
);

t.check(
	"a period over budget has moved the rung down",
	// **No escape clause, and the last two versions each had one.** The first
	// accepted `scale < 1`, true from the start because Auto began on the
	// bottom rung. The second accepted a reason beginning "over budget" — which
	// is *always* the reason of a controller stuck over budget, so the build
	// whose controller never stepped stayed green. Sage found the first; the
	// red build found the second.
	//
	// None is needed. Over budget at the top rung, a step is owed within
	// `MIN_SAMPLES + DOWNSHIFT_FRAMES` frames, and a six-second window holds
	// several times that on this rasteriser. On one fast enough never to be
	// over budget at the top, nothing is owed and the row holds vacuously —
	// which is the implication, stated once rather than smuggled in as an "or".
	steered.rungs[0] === 1 &&
		(!overBudgetAtTop || steered.rungs.some((rung) => rung < 1)),
	JSON.stringify({
		rungs: steered.rungs,
		overBudgetAtTop,
		triggerMs: steered.downshiftTriggerMs,
	}),
);

// ── the controller reads the cadence, not a whole snapshot ──────────────────
//
// R1 of sage's second round. `stepAdaptiveResolution` built the full attribution
// snapshot every frame to read three cadence fields, which on the default route
// meant a `gl.getParameter(RENDERER)` and tens of allocations per frame — with
// the collection pauses landing in the frame period being timed. Counted over a
// window with Auto running, the read should all but vanish.
const rendererReads = await page.evaluate(async () => {
	const before = window.__adaptiveCalls.rendererReads;
	let frames = 0;
	const until = performance.now() + 2_000;
	while (performance.now() < until) {
		await new Promise((resolve) => requestAnimationFrame(() => resolve()));
		frames++;
	}
	return { reads: window.__adaptiveCalls.rendererReads - before, frames };
});
t.check(
	"Auto does not build an attribution snapshot every frame",
	// Fewer reads than a quarter of the frames. Zero is expected; the slack is
	// for any other reader, and a snapshot per frame reads once per frame.
	rendererReads.frames > 4 && rendererReads.reads < rendererReads.frames / 4,
	JSON.stringify(rendererReads),
);

// **No row asserts a curve point here, and one used to.** It passed through
// `|| atCap`, which is true on this machine for a reason unrelated to the
// controller working: SwiftShader never runs a cheap frame, so each rung Auto
// reaches is the cheapest this session has seen, the refresh estimate is that
// rung's own median, and every rung reads as capped and records nothing. A row
// that can only pass on its escape clause is not a check. Recording is covered
// headless, where the refresh interval can be established first.

// ── a display move reprimes, where no event says it happened ────────────────
//
// I1 of sage's first round. Moving the window between the principal's two
// displays fires no `resize` and no pixel-ratio media query, because both
// report a ratio of 2.00; the refresh floor the first panel set then outlives
// the move. `stepAdaptiveResolution` compares the screen's geometry instead.
//
// **The move is stubbed**, because Playwright emulates a 1280x720 screen and
// cannot put a window on another display. So this row proves the wiring — a
// changed geometry primes — and not that a real browser changes it on a real
// move, which is the principal's to confirm.
//
// A prime is read off `refreshFloorMs`. It goes back to `null` and stays there
// until `MIN_SAMPLES` frames have arrived, which is seconds on this rasteriser,
// so a reading two frames later can only be `null` if a prime happened.
const beforeMove = await page.evaluate(
	() => window.__seelite.adaptiveDiagnostics()?.refreshFloorMs ?? null,
);
const afterMove = await page.evaluate(async () => {
	Object.defineProperty(window.screen, "availLeft", {
		configurable: true,
		get: () => 1728,
	});
	for (let i = 0; i < 2; i++)
		await new Promise((resolve) => requestAnimationFrame(() => resolve()));
	return window.__seelite.adaptiveDiagnostics()?.refreshFloorMs ?? null;
});
t.check(
	"moving to another display forgets the refresh interval",
	typeof beforeMove === "number" && afterMove === null,
	JSON.stringify({ beforeMove, afterMove }),
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

// ── the perf panel over a running Auto gets the diagnostic it asked for ─────
//
// I2 of sage's first round. A saved Auto row starts a cadence sampler at boot,
// before the perf panel mounts, and `enableFrameAttribution` used to hand that sampler
// back to a caller asking for `full` — no GPU timer, no counters, and a panel
// that looked like the instrument was broken. Asked for here the way the panel
// asks, over a live cadence sampler.
//
// **Asked for through `enableFrameAttribution` and never through the route.**
// The route mounts the panel, whose window key listener would see this probe's
// keystrokes, and `check-launcher-wiring.mjs` refuses it in any probe that has
// not argued its way onto its owner list. What the panel does to the sampler is
// one call, and the call is what is under test.
//
// Last before leaving Auto on purpose: a full sampler issues timer queries, and
// the row above that asserts Auto issues none has to have run already.
const upgraded = await page.evaluate(async () => {
	const game = window.__seelite;
	const before = game.attributionSnapshot()?.mode ?? null;
	const extensionReadsBefore = window.__adaptiveCalls.timerExtensionReads;
	await game.enableFrameAttribution("full");
	const after = game.attributionSnapshot()?.mode ?? null;
	const extensionReadsAfter = window.__adaptiveCalls.timerExtensionReads;
	// And Auto still has its signal once the new ring has filled.
	const until = performance.now() + 5_000;
	let period = null;
	while (performance.now() < until) {
		period = game.adaptiveDiagnostics()?.periodMedianMs ?? null;
		if (typeof period === "number") break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return {
		before,
		after,
		extensionReadsBefore,
		extensionReadsAfter,
		period,
	};
});
t.check(
	"a full request replaces a running cadence sampler",
	upgraded.before === "cadence" &&
		upgraded.after === "full" &&
		upgraded.extensionReadsAfter > upgraded.extensionReadsBefore,
	JSON.stringify(upgraded),
);
t.check(
	"and Auto keeps steering off the full sampler",
	typeof upgraded.period === "number" && upgraded.period > 0,
	JSON.stringify(upgraded),
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

// ── a full request made while a cadence enable is still in flight ──────────
//
// R2 of sage's second round: the replacement above only covered a sampler that
// had already landed. A saved Auto row's boot-time enable can still be waiting on
// its import when the perf panel asks, and `enableFrameAttribution` returned that
// pending promise to the `full` caller.
//
// Made deterministic here rather than left to import timing: both calls are
// issued in one turn, so the second one always sees the first still pending.
// Last in the probe because it leaves a full sampler running.
const raced = await page.evaluate(async () => {
	const game = window.__seelite;
	game.disableFrameAttribution();
	const cadence = game.enableFrameAttribution("cadence");
	const full = game.enableFrameAttribution("full");
	await cadence;
	await full;
	return { mode: game.attributionSnapshot()?.mode ?? null };
});
t.check(
	"a full request issued while a cadence enable is pending still gets full",
	raced.mode === "full",
	JSON.stringify(raced),
);

console.log(`\nrung under Auto: ${auto.diagnostics?.scale}`);
console.log(`reason: ${auto.diagnostics?.reason}`);

await browser.close();
t.exit();
