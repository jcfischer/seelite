/**
 * #200's three claims about the last pass, each measured as a **difference
 * between two renders of one frame on one build**.
 *
 * `tests/output-stage.test.ts` holds everything decidable from the source: the
 * markers are three.js's, the order is vignette-then-encode-then-dither, the
 * dials clamp. None of that says a single edge got smoother, because none of it
 * runs a rasteriser. This does.
 *
 * ## Why every check here is a paired render
 *
 * The obvious version of this probe thresholds one frame — *fewer than N hard
 * steps along a rail* — and it cannot work: the count depends on the framing,
 * the station's spin phase, the bloom, and the rasteriser, and a threshold in
 * the middle of that is a threshold tuned until the verdict came out. So each
 * check renders the same frame twice with exactly one term moved and asserts a
 * **direction**.
 *
 * Moving one term is the part that needed a method on `Game`. The samples are
 * gated on the quality key beside #99's environment and #101's seam map, and
 * measuring antialiasing across that key would measure all three — each of
 * which moves the edges being counted. `Game.setComposerSamples` takes an
 * explicit count for this reason, and the gate is its default argument.
 *
 * ## The two statistics
 *
 * **Intermediates.** A pixel whose value lies strictly between its two
 * horizontal neighbours, where those neighbours are `EDGE_STEP` levels or more
 * apart. That is what a multisample resolve *makes*: a partly-covered pixel
 * carrying a fraction of both sides. An aliased edge steps from one side to the
 * other with nothing in between, so the count rises with the sample count.
 *
 * **Counting hard steps instead does not work, and it was measured rather than
 * reasoned about.** The first version of this check counted adjacent pairs more
 * than 40 levels apart and asserted the count *fell*. It rose, 13,532 to
 * 14,486, and the check was right to fail: resolving a 0-to-200 edge into
 * 0-100-200 replaces one pair above the threshold with two. The statistic was
 * measuring the number of edges, and antialiasing adds a step to every one.
 *
 * **Alternations.** Along one scanline of a shallow gradient, the number of
 * places the value changes at all. A banded gradient is a few long plateaus and
 * so a handful of changes; a dithered one alternates between neighbouring codes
 * across the whole run. This is the statistic that would *not* work as an
 * absolute: a gradient steep enough to cross many codes on its own would score
 * highly undithered, which is why the check is dither-on against dither-off at
 * the same pixels.
 *
 * ## SwiftShader, said plainly
 *
 * Like every probe here (#98) this runs on the software rasteriser, so no count
 * below is the player's. It does not need to be. What would break these checks
 * is a rasteriser that ignored the sample count or the added noise, not a slow
 * one — and if SwiftShader silently refused the multisampled target, the hard-
 * step check is exactly what would go red. The half needing the player's GPU is
 * the picture, which is the canonical view set's job.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
/** The sheet's fixture, imported rather than restated (#174). */
import {
	FIXTURE,
	GAME_TIME_S as CLOCK,
	SEED,
	VIEWPORT,
} from "./lib/view-set.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** `cockpit-arrival`'s framing: the view the node names first, and the one with
 *  the canopy rails in it. */
const STATION = "station-trade";
const STATION_RADII = 5;

/** `planet-terminator`'s framing: the shallow dark gradient the dither is for.
 *  The body id comes from the fixture, not from the sheet's `largest-planet`
 *  alias — that alias is resolved by `capture-views.mjs` and means nothing to
 *  `__sunOffset`, which takes a body id and returned null for it. */
const PLANET = FIXTURE.planets[0].id;
const PLANET_RADII = 4;
const PLANET_SUN_DEG = 70;

/** Levels across a pixel's two neighbours that make it an edge rather than a
 *  gradient. Well above the dither's own ±0.5 so the two statistics cannot read
 *  each other. */
const EDGE_STEP = 40;
/** How far an intermediate must sit from both sides to count as one rather than
 *  as the rounding on a flat run. */
const EDGE_MARGIN = 4;

/**
 * **Every readback is 1:1, and that is not an oversight.**
 *
 * Both statistics live in single-pixel differences, and `drawImage` into a
 * smaller canvas resamples — which softens exactly the steps the first check
 * counts and averages away exactly the alternation the second one does.
 * `probe-light-rig.mjs` reads at 480x300 because it wants a *mean*, where the
 * resample is free; here it would erase the subject. The frame readers below
 * are written out in each `evaluate` rather than shared, because an `evaluate`
 * body is serialised to the page and cannot close over anything in this file.
 */

const origin = await guardedOrigin(ORIGIN, [
	"src/output-stage.ts",
	"src/main.ts",
]);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: VIEWPORT });
const t = tally();
t.watch(page);

await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
await page.evaluate((clock) => window.__startClockAt(clock), CLOCK);

// ── the splice ───────────────────────────────────────────────────────────────
// First, because a missed marker leaves a stock output shader that compiles,
// links and renders — and both statistics below would then be measuring a pass
// that carries neither the dither nor the vignette while reading green on the
// samples.
const splices = await page.evaluate(() => {
	const g = window.__seelite;
	const log = g.outputPass?.material?.userData?.outputSplices;
	return log ? Object.entries(log) : null;
});
t.check(
	"the output shader carries all three splices",
	splices !== null && splices.length === 3 && splices.every(([, hit]) => hit),
	splices === null
		? "no outputSplices on the pass — the pass is not the patched one"
		: splices.map(([k, hit]) => `${k}: ${hit ? "hit" : "MISSED"}`).join(", "),
);

// ── the samples the quality key asks for ─────────────────────────────────────
const gate = await page.evaluate(() => {
	const g = window.__seelite;
	const was = g.settings.value.quality;
	const read = (q) => {
		g.settings.set("quality", q);
		return [g.composer.renderTarget1.samples, g.composer.renderTarget2.samples];
	};
	const high = read("high");
	const low = read("low");
	g.settings.set("quality", was);
	const gl = g.renderer.getContext();
	return { high, low, was, max: gl.getParameter(gl.MAX_SAMPLES) };
});
t.check(
	"high multisamples both composer buffers and low multisamples neither",
	gate.high[0] > 1 &&
		gate.high[0] === gate.high[1] &&
		gate.low[0] === 0 &&
		gate.low[1] === 0,
	`high [${gate.high}], low [${gate.low}], rasteriser max ${gate.max}`,
);
t.check(
	"the game ships multisampled",
	gate.was === "high",
	`default quality is ${gate.was}`,
);

// ── antialiasing: the same frame, samples moved and nothing else ─────────────
await page.evaluate(
	([id, radii]) =>
		window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
			comoving: true,
		}),
	[STATION, STATION_RADII],
);
await page.evaluate(() => {
	window.__seelite.view = "cockpit";
});

const aa = await page.evaluate(
	([limit, margin]) => {
		const g = window.__seelite;
		const src = g.renderer.domElement;
		const scratch = document.createElement("canvas");
		scratch.width = src.width;
		scratch.height = src.height;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			g.render(0);
			ctx.drawImage(src, 0, 0);
			return ctx.getImageData(0, 0, scratch.width, scratch.height);
		};
		const luma = (d, i) =>
			0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
		const intermediates = (img) => {
			const { data, width, height } = img;
			let found = 0;
			for (let y = 0; y < height; y++) {
				const row = y * width * 4;
				for (let x = 1; x < width - 1; x++) {
					const i = row + x * 4;
					const left = luma(data, i - 4);
					const right = luma(data, i + 4);
					if (Math.abs(right - left) < limit) continue;
					const here = luma(data, i);
					const lo = Math.min(left, right);
					const hi = Math.max(left, right);
					if (here > lo + margin && here < hi - margin) found++;
				}
			}
			return found;
		};
		const gated = g.composer.renderTarget1.samples;
		// A warm frame after each switch: `dispose()` drops the framebuffer and
		// the next bind re-creates it, so the first frame at a new count pays an
		// allocation that no later frame does. Counting it would still be
		// correct — this is not a timing — but the buffer's first frame after a
		// realloc is the one most likely to be a clear.
		g.setComposerSamples(gated);
		g.render(0);
		const on = intermediates(frame());
		g.setComposerSamples(0);
		g.render(0);
		const off = intermediates(frame());
		g.setComposerSamples();
		return { on, off, gated, pixels: scratch.width * scratch.height };
	},
	[EDGE_STEP, EDGE_MARGIN],
);

t.check(
	"multisampling puts partly-covered pixels along the frame's edges",
	aa.on > aa.off,
	`${aa.gated} samples ${aa.on} intermediates against 0 samples ${aa.off}, over ${aa.pixels} px`,
);

// ── the vignette: the same lit frame, the dial moved and nothing else ───────
// **Before the planet framing, and that is the whole of why it is here.** The
// check is that a corner gets darker, and 15% of black is black: framed on a
// planet the corners are empty sky, and the check would pass on a vignette that
// was never applied. The station framing is in cockpit view, so the corners are
// the lit cabin.
const vignette = await page.evaluate(() => {
	const g = window.__seelite;
	const src = g.renderer.domElement;
	const scratch = document.createElement("canvas");
	scratch.width = src.width;
	scratch.height = src.height;
	const ctx = scratch.getContext("2d", { willReadFrequently: true });
	const frame = () => {
		g.render(0);
		ctx.drawImage(src, 0, 0);
		return ctx.getImageData(0, 0, scratch.width, scratch.height);
	};
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
	// The dial is forced in both arms rather than read from a cockpit frame and
	// a chase one: those two differ by the cabin filling a third of the frame,
	// so that comparison would be a comparison of two pictures.
	// **Through the override, not the setter.** The frame loop writes the dial
	// from the view on every frame, so an assignment made here is overwritten
	// before `frame()` draws anything — which is how the first version of this
	// block read 1.000 against 1.000 with the term working perfectly.
	const cockpitUniform = g.outputPass.material.uniforms.uVignette.value;
	g.outputPass.vignetteOverride = 0;
	const flat = frame();
	g.outputPass.vignetteOverride = 1;
	const dark = frame();
	const forced = g.outputPass.material.uniforms.uVignette.value;
	g.outputPass.vignetteOverride = null;
	g.view = "chase";
	g.render(0);
	const chaseUniform = g.outputPass.material.uniforms.uVignette.value;
	g.view = "cockpit";
	g.render(0);

	/**
	 * How much of each lit pixel survived, binned by how far out it is.
	 *
	 * **Not a patch at a corner**, which is what this measured first and why it
	 * read 0.00 → 0.00: the framing's extreme corners are empty sky, and 15% of
	 * black is black — a check that passes on a vignette that was never applied.
	 * Every pixel the frame actually lit is evidence, wherever it happens to be,
	 * so the statistic is the mean of `dark / flat` over lit pixels in an inner
	 * ring and an outer one. `flat > 8` is the lit cut: below that a ratio is
	 * dominated by the dither's own ±0.5 of a level.
	 */
	const rings = { inner: { sum: 0, n: 0 }, outer: { sum: 0, n: 0 } };
	const { width, height } = flat;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const f = luma(flat.data, i);
			if (f <= 8) continue;
			const dx = x / (width - 1) - 0.5;
			const dy = y / (height - 1) - 0.5;
			const r = Math.hypot(dx, dy) / 0.70710678;
			const ring = r < 0.3 ? rings.inner : r > 0.85 ? rings.outer : null;
			if (!ring) continue;
			ring.sum += luma(dark.data, i) / f;
			ring.n++;
		}
	return {
		chaseUniform,
		cockpitUniform,
		forced,
		inner: { kept: rings.inner.sum / rings.inner.n, px: rings.inner.n },
		outer: { kept: rings.outer.sum / rings.outer.n, px: rings.outer.n },
	};
});

t.check(
	"the vignette is on in the cockpit and off in chase",
	vignette.cockpitUniform > 0 && vignette.chaseUniform === 0,
	`cockpit ${vignette.cockpitUniform}, chase ${vignette.chaseUniform}`,
);
t.check(
	"both rings have lit pixels to measure",
	vignette.inner.px > 1000 && vignette.outer.px > 1000,
	`inner ${vignette.inner.px} px, outer ${vignette.outer.px} px`,
);
t.check(
	"it darkens the outer ring and leaves the middle of the frame alone",
	vignette.outer.kept < vignette.inner.kept &&
		vignette.inner.kept > 0.99 &&
		vignette.outer.kept < 0.95,
	`inner keeps ${vignette.inner.kept.toFixed(3)}, outer keeps ${vignette.outer.kept.toFixed(3)}, at ${vignette.forced}`,
);
t.check(
	"and it never exceeds the cap the node set",
	vignette.forced === vignette.cockpitUniform,
	`asked for 1, got ${vignette.forced}; the cockpit runs at ${vignette.cockpitUniform}`,
);

// ── the dither: the same dark gradient, noise on and off ─────────────────────
await page.evaluate(
	([id, radii, deg]) => window.__sunOffset(id, radii, deg),
	[PLANET, PLANET_RADII, PLANET_SUN_DEG],
);

const dither = await page.evaluate(() => {
	const g = window.__seelite;
	const src = g.renderer.domElement;
	const scratch = document.createElement("canvas");
	scratch.width = src.width;
	scratch.height = src.height;
	const ctx = scratch.getContext("2d", { willReadFrequently: true });
	const frame = () => {
		g.render(0);
		ctx.drawImage(src, 0, 0);
		return ctx.getImageData(0, 0, scratch.width, scratch.height);
	};
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
	/**
	 * Places along the frame's middle scanline where the value changes at all,
	 * counting only the shallow part of it.
	 *
	 * The steep part — a limb, a rail — changes at every pixel whatever the
	 * dither does, and including it would put the same large number in both arms
	 * and swamp the difference. Under three levels is the gradient; anything
	 * above it is an edge and is skipped by both arms alike.
	 */
	const alternations = (img) => {
		const { data, width, height } = img;
		const row = (height >> 1) * width * 4;
		let changes = 0;
		let shallow = 0;
		for (let x = 1; x < width; x++) {
			const i = row + x * 4;
			const d = Math.abs(luma(data, i) - luma(data, i - 4));
			if (d >= 3) continue;
			shallow++;
			if (d > 0) changes++;
		}
		return { changes, shallow };
	};
	g.outputPass.setDither(true);
	const on = alternations(frame());
	g.outputPass.setDither(false);
	const off = alternations(frame());
	g.outputPass.setDither(true);
	return { on, off };
});

t.check(
	"the dither breaks up the flat parts of a dark gradient",
	dither.on.changes > dither.off.changes,
	`dithered ${dither.on.changes} changes against banded ${dither.off.changes}, over ~${dither.off.shallow} shallow px`,
);

console.log(
	`  edges     ${aa.gated} samples ${aa.on} intermediates, 0 samples ${aa.off}`,
);
console.log(
	`  dither    ${dither.on.changes} changes dithered, ${dither.off.changes} banded`,
);
console.log(
	`  vignette  inner keeps ${vignette.inner.kept.toFixed(3)}, outer keeps ${vignette.outer.kept.toFixed(3)}`,
);

await browser.close();
t.exit();
