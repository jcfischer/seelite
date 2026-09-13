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
 * Moving one term is the part that needed a method on `Game`. The count is the
 * player's own settings row, and driving a measurement through the store would
 * notify every other listener and write the value to `localStorage` — a probe
 * should not leave a preference behind on the machine it measured.
 * `Game.setComposerSamples` takes an explicit count for that reason, and the
 * player's row is its default argument.
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
import { gameUrl } from "./lib/game-url.mjs";

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
 * The frame reader every measurement below shares, installed **on the page**.
 *
 * An `evaluate` body is serialised and cannot close over anything in this file,
 * so the first version of this probe wrote the same fifteen lines out three
 * times — and a change to the capture or to the luminance weights would then
 * have been a three-site edit with two chances to miss one.
 *
 * **Every readback is 1:1, and that is not an oversight.** Both statistics live
 * in single-pixel differences, and `drawImage` into a smaller canvas resamples —
 * which softens exactly the steps the edge check counts and averages away
 * exactly the alternation the dither check does. `probe-light-rig.mjs` reads at
 * 480x300 because it wants a *mean*, where the resample is free; here it would
 * erase the subject.
 *
 * Through `addInitScript` rather than a one-off `evaluate`, so it survives the
 * reload the boot check below performs.
 */
const CAPTURE = () => {
	const luma = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
	// One canvas and one context for the whole probe. A fresh canvas per capture
	// allocates a full-frame backing store every time — this probe takes a dozen
	// captures at 2880x1800, which is tens of megabytes of transient allocation
	// and a garbage collector running in the middle of the frames being timed.
	// Sized lazily, because the drawing buffer's size is not known until the game
	// has booted, and re-sized only if it changes.
	let scratch = null;
	let ctx = null;
	window.__outputStage = {
		luma,
		/** Render and read in the same task: a WebGL canvas without
		 *  `preserveDrawingBuffer` is cleared at the next composite. */
		frame() {
			const g = window.__seelite;
			const src = g.renderer.domElement;
			if (!scratch) {
				scratch = document.createElement("canvas");
				ctx = scratch.getContext("2d", { willReadFrequently: true });
			}
			if (scratch.width !== src.width || scratch.height !== src.height) {
				scratch.width = src.width;
				scratch.height = src.height;
			}
			g.render(0);
			ctx.drawImage(src, 0, 0);
			return ctx.getImageData(0, 0, scratch.width, scratch.height);
		},
	};
};

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: VIEWPORT });
const t = tally();
t.watch(page);

await installViewPlacement(page);
await installViewFraming(page);
await page.addInitScript(CAPTURE);
await page.goto(gameUrl(origin, { seed: SEED }));
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

// ── the player's row reaches both composer buffers ───────────────────────────
// **Both**, because `EffectComposer` swaps them: a count that reached one would
// antialias alternate frames and read as a flicker rather than as a missing
// term — and a probe reading only `renderTarget1` would call that green.
const gate = await page.evaluate(() => {
	const g = window.__seelite;
	const was = g.settings.value.antialias;
	/**
	 * What each buffer was **allocated** at, not what it was asked for.
	 *
	 * `renderTarget.samples` is the request. `renderbufferStorageMultisample`
	 * only guarantees the result is at least that, so a context advertising
	 * `[4]` renders a 2x request at 4x — and a probe reading the field back
	 * would confirm the number it just wrote. `gl.getParameter(SAMPLES)` on the
	 * bound framebuffer is the allocation.
	 */
	const read = (n) => {
		g.settings.set("antialias", n);
		return [g.composer.renderTarget1, g.composer.renderTarget2].map((rt) => {
			g.renderer.setRenderTarget(rt);
			const actual = gl.getParameter(gl.SAMPLES);
			g.renderer.setRenderTarget(null);
			return actual;
		});
	};
	// The counts the screen offers, asked of the store rather than restated —
	// a probe with its own copy of a constant goes falsely red when the module
	// moves it, and this one would have gone falsely *green*.
	const gl = g.renderer.getContext();
	const seen = g.settings.allowed("antialias").map((n) => [n, read(n), 0]);
	// What this context will multisample a *half-float* target at, which is not
	// what `MAX_SAMPLES` answers for — a float multisampled renderbuffer is
	// optional in WebGL2. A count above this leaves the framebuffer incomplete,
	// and an incomplete framebuffer is a black frame rather than an exception,
	// so the check below looks at pixels and not only at numbers.
	const counts = gl.getInternalformatParameter(
		gl.RENDERBUFFER,
		gl.RGBA16F,
		gl.SAMPLES,
	);
	const supported = counts?.length ? [...counts].sort((a, b) => a - b) : [];
	// The same rule `grantedSamples` applies, restated here on purpose: this is
	// the *prediction* the settings row shows the player, and the check below
	// compares it against what was actually allocated. Importing the module's
	// answer would make the two agree by construction.
	const predict = (n) =>
		n <= 0 ? 0 : (supported.find((c) => c >= n) ?? supported.at(-1) ?? 0);
	const granted = predict(Math.max(...g.settings.allowed("antialias")));
	g.settings.set("antialias", Math.max(...g.settings.allowed("antialias")));
	const { frame, luma } = window.__outputStage;
	const img = frame();
	let painted = 0;
	let sampled = 0;
	for (let i = 0; i < img.data.length; i += 4 * 97) {
		sampled++;
		if (luma(img.data, i) > 8) painted++;
	}
	g.settings.set("antialias", was);
	for (const row of seen) row[2] = predict(row[0]);
	return {
		seen,
		was,
		granted,
		supported,
		painted,
		sampled,
		max: gl.getParameter(gl.MAX_SAMPLES),
	};
});
t.check(
	"what the settings row predicts is what the GPU allocated, for every count offered",
	gate.seen.every(([, got, want]) => got[0] === want && got[1] === want),
	`${gate.seen.map(([n, got, want]) => `${n} → predicted ${want}, allocated [${got}]`).join("; ")} — RGBA16F supports [${gate.supported}], MAX_SAMPLES ${gate.max}`,
);
t.check(
	"and the frame is still drawn at the strongest count it granted",
	gate.granted === 0 || gate.painted > 0,
	`${gate.painted} of ${gate.sampled} sampled pixels are lit at ${gate.granted} samples`,
);
t.check(
	"the game ships unantialiased",
	gate.was === 0,
	`default antialias is ${gate.was}`,
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

/** The strongest count this context will actually grant, learned from the page
 *  above rather than restated here — a probe with its own copy of a constant
 *  goes falsely red when the module moves it, and one that assumed 4x would go
 *  falsely red on a machine that grants 2x. */
const STRONGEST = Math.min(
	gate.granted,
	Math.max(...gate.seen.map(([n]) => n)),
);

const aa = await page.evaluate(
	([limit, margin, strongest]) => {
		const g = window.__seelite;
		const { frame, luma } = window.__outputStage;
		/** Where two frames disagree about a pixel being lit, as a fraction of
		 *  the frame.
		 *
		 *  **Spatial, because a count is not.** Comparing only *how many* pixels
		 *  are lit passes a frame that lost a layer and gained an equal area
		 *  somewhere else, which is exactly the failure this is watching for —
		 *  three invalidates the multisampled colour attachment after every
		 *  `render`, so a later `clear = false` pass could in principle composite
		 *  over undefined content. Disagreement is per pixel and cannot be
		 *  cancelled out. Antialiasing itself moves only edge pixels, so a
		 *  correct pair disagrees on a fraction of a percent.
		 */
		const disagreement = (a, b) => {
			let n = 0;
			for (let i = 0; i < a.data.length; i += 4)
				if (luma(a.data, i) > 8 !== luma(b.data, i) > 8) n++;
			return n / (a.width * a.height);
		};

		/** Lit pixels, as a fraction. Antialiasing changes edges and must not
		 *  change *what is drawn* — so this is the same number at every count
		 *  unless a layer went missing. It is here because turning the depth
		 *  resolve off invalidates the multisampled framebuffer's depth after
		 *  every pass, which is a way to lose the far layer that only bites with
		 *  antialiasing on: the setting that is off by default and that no other
		 *  probe exercises. */
		const lit = (img) => {
			let n = 0;
			for (let i = 0; i < img.data.length; i += 4)
				if (luma(img.data, i) > 8) n++;
			return n / (img.width * img.height);
		};
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
		const gated = strongest;
		// A warm frame after each switch: `dispose()` drops the framebuffer and
		// the next bind re-creates it, so the first frame at a new count pays an
		// allocation that no later frame does. Counting it would still be
		// correct — this is not a timing — but the buffer's first frame after a
		// realloc is the one most likely to be a clear.
		g.setComposerSamples(gated);
		g.render(0);
		const first = frame();
		const on = intermediates(first);
		const onLit = lit(first);
		g.setComposerSamples(0);
		g.render(0);
		const plain = frame();
		const off = intermediates(plain);
		const offLit = lit(plain);
		const disagree = disagreement(first, plain);
		const pixels = first.width * first.height;
		// Back to the player's row, not to the count this arm used.
		g.setComposerSamples();
		return { on, off, onLit, offLit, disagree, gated, pixels };
	},
	[EDGE_STEP, EDGE_MARGIN, STRONGEST],
);

// **Skipped rather than failed where the context grants nothing.** With no
// multisampled half-float support the two arms are the same render, and a check
// requiring one to differ from the other would make the documented
// unsupported-hardware fallback a red probe. It is reported either way, so a
// machine that quietly stopped granting samples does not look like a machine
// that passed.
if (aa.gated === 0) {
	console.log(
		"  edges     skipped — this context grants no samples for a half-float target",
	);
} else {
	t.check(
		"multisampling puts partly-covered pixels along the frame's edges",
		aa.on > aa.off,
		`${aa.gated} samples ${aa.on} intermediates against 0 samples ${aa.off}, over ${aa.pixels} px`,
	);
}
t.check(
	"and it changes the edges without changing what is drawn",
	aa.disagree < 0.01,
	`${(aa.disagree * 100).toFixed(2)}% of pixels disagree about being lit between ${aa.gated} samples and 0 (${(aa.onLit * 100).toFixed(2)}% lit against ${(aa.offLit * 100).toFixed(2)}%)`,
);

// ── the vignette: the same lit frame, the dial moved and nothing else ───────
// **Before the planet framing, and that is the whole of why it is here.** The
// check is that a corner gets darker, and 15% of black is black: framed on a
// planet the corners are empty sky, and the check would pass on a vignette that
// was never applied. The station framing is in cockpit view, so the corners are
// the lit cabin.
const vignette = await page.evaluate(() => {
	const g = window.__seelite;
	const { frame, luma } = window.__outputStage;
	// The dial is forced in both arms rather than read from a cockpit frame and
	// a chase one: those two differ by the cabin filling a third of the frame,
	// so that comparison would be a comparison of two pictures.
	// **Through the settings row, not by assigning the uniform.** The frame loop
	// writes the dial from the view and the setting on every frame, so an
	// assignment made here is overwritten before `frame()` draws anything —
	// which is how the first version of this block read 1.000 against 1.000 with
	// the term working perfectly. The row is also the control the player has, so
	// driving it here means the arms differ by the thing that ships.
	const wasSetting = g.settings.value.vignette;
	const cockpitUniform = g.outputPass.vignette;
	g.settings.set("vignette", "off");
	const flat = frame();
	const settingOff = g.outputPass.vignette;
	g.settings.set("vignette", "on");
	const dark = frame();
	// The cap, asked for directly and read back before the next frame rewrites
	// the dial — no render in between, so nothing here depends on the loop.
	g.outputPass.setVignette(1);
	const forced = g.outputPass.vignette;
	g.settings.set("vignette", wasSetting);
	g.render(0);
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
		settingOff,
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
	"and the settings row turns it off in the cockpit too",
	vignette.settingOff === 0,
	`with the row off the dial reads ${vignette.settingOff}`,
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

// ── the backdrop survives three passes drawn after it ────────────────────────
// **The layer the blocker would take first.** three pushes `COLOR_ATTACHMENT0`
// into the invalidation list for the *read* framebuffer — the multisampled one —
// after every `render`, so the backdrop's pixels are formally undefined by the
// time the far pass composites over them with `clear = false`. Whether that
// bites is a driver question, and a driver question is measured rather than
// reasoned about.
//
// Deep sky is the framing that answers it: nothing but the backdrop draws, so if
// its colour were being discarded the frame would come back empty at a non-zero
// count and unchanged at zero.
await page.evaluate(() => window.__lookAt(window.__emptiestDirection()));
const backdrop = await page.evaluate(
	([strongest]) => {
		const g = window.__seelite;
		const { frame, luma } = window.__outputStage;
		const stars = (img) => {
			let n = 0;
			for (let i = 0; i < img.data.length; i += 4)
				if (luma(img.data, i) > 8) n++;
			return n;
		};
		g.setComposerSamples(0);
		g.render(0);
		const plain = stars(frame());
		g.setComposerSamples(strongest);
		g.render(0);
		const sampled = stars(frame());
		g.setComposerSamples();
		return { plain, sampled };
	},
	[STRONGEST],
);
t.check(
	"the backdrop is still there when the frame is multisampled",
	backdrop.plain > 200 &&
		backdrop.sampled > backdrop.plain * 0.5 &&
		backdrop.sampled < backdrop.plain * 2,
	`${backdrop.plain} lit pixels at 0 samples against ${backdrop.sampled} at ${STRONGEST}`,
);

// ── the dither: the same dark gradient, noise on and off ─────────────────────
await page.evaluate(
	([id, radii, deg]) => window.__sunOffset(id, radii, deg),
	[PLANET, PLANET_RADII, PLANET_SUN_DEG],
);

const dither = await page.evaluate(() => {
	const g = window.__seelite;
	const { frame, luma } = window.__outputStage;
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

// ── a stored choice survives a reload ────────────────────────────────────────
// The defect this names shipped and review caught it: the settings subscription
// fires on a *difference*, and `applied` starts at the loaded settings — so a
// player who turned the dither off and came back got it on again, silently,
// until they toggled it twice. Nothing in the probe suite could have seen that,
// because every check above runs in the session that set the value.
//
// A reload rather than a second page: `localStorage` is per origin, so the
// stored choice is what the next boot reads, and that is exactly the path that
// was broken.
const persisted = await page.evaluate(() => {
	window.__seelite.settings.set("dither", "off");
	return window.__seelite.settings.value.dither;
});
await page.goto(gameUrl(origin, { seed: SEED }));
await bootedGame(page);
const booted = await page.evaluate(() => {
	const g = window.__seelite;
	const stored = g.settings.value.dither;
	const applied = g.outputPass.material.uniforms.uDither.value;
	// Put it back before anything else reads it: the store is on this origin and
	// the next probe to boot here would inherit it.
	g.settings.set("dither", "on");
	return { stored, applied };
});
t.check(
	"a dither turned off before a reload is still off after it",
	persisted === "off" && booted.stored === "off" && booted.applied === 0,
	`stored ${booted.stored}, the shader is multiplying by ${booted.applied}`,
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
