/**
 * Node 54's browser tier: prove the planet classes are *distinct*, and *lit*.
 *
 * A unit test can check that `appearanceFor` returns nine different strings. It
 * cannot check that nine different strings produce nine different pictures, and
 * that is the only claim the node actually makes. So this probe reads pixels off
 * the gallery and asserts three things the previous prototype failed:
 *
 * - every body has a terminator, so it reads as a sphere rather than a sticker;
 * - every class differs in colour from every other, so the ladder is visible;
 * - the terran world has both ocean and land, which the old sea-level threshold
 *   silently did not (it sat in the tail of the noise distribution and drowned
 *   every continent).
 */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGE_URL = process.env.PROBE_URL ?? ORIGIN + "/?planet-prototype";

/** The ladder, in the order the gallery lays it out. */
const EXPECTED = [
	"lava",
	"venusian",
	"terran",
	"desert",
	"ice",
	"jovian",
	"iceGiant",
	"airless",
	"star",
];

/** Emissive classes are bright on their own night side, and should be. */
const SELF_LIT = new Set(["star", "lava"]);

/** Rec. 709 on the raw framebuffer bytes. Relative, so the gamma does not
 *  matter — every comparison here is a ratio between two patches. */
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Direction of a colour, independent of how brightly it is lit. Two classes
 *  may share a hue and differ in luminance, or the reverse, so distinctness is
 *  scored on both and passes on either. */
const chroma = (rgb) => {
	const sum = rgb[0] + rgb[1] + rgb[2] || 1;
	return rgb.map((c) => c / sum);
};

await guardedOrigin(ORIGIN);
// SwiftShader by default here rasterises nine full-screen fragment shaders in
// software, which is slow enough that the frame-count wait below times out on a
// default launch. ANGLE gives it the same path the shot scripts use.
const browser = await launchChromium({
	args: ["--use-gl=angle", "--enable-unsafe-swiftshader"],
});
const { check, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const failures = [];
page.on("pageerror", (error) => failures.push(String(error)));
await page.goto(PAGE_URL, { waitUntil: "load" });
await page.waitForSelector("#planet-prototype canvas");
await page.waitForFunction(() => window.__seelitePlanets !== undefined, {
	timeout: 20000,
});
// Let the animated classes settle, and give the frame-time mean a population.
// The bar is low on purpose: this measures a software rasteriser on whatever
// machine is running it, and a high bar would be a bar on the machine.
await page.waitForFunction(() => window.__seelitePlanets.frameCount() > 30, {
	timeout: 25000,
});
await page.evaluate(() => window.__seelitePlanets.setView(0, 0));

check("no page error while the gallery rendered", failures.length === 0);
if (failures.length) console.error(failures.join("\n"));

const classes = await page.evaluate(() => window.__seelitePlanets.classes);
check(
	`every ladder rung reached the screen (${classes.join(", ")})`,
	EXPECTED.length === classes.length &&
		EXPECTED.every((name, i) => classes[i] === name),
);

/**
 * Sample the lit and unlit sides of every disc, in one round trip.
 *
 * The sun sits up and to the right of the camera, so the lit patch is offset
 * that way and the unlit one opposite, along the sun's own screen bearing.
 * Three quarters of a radius out, which is not a round number by accident. With
 * the sun 51 degrees off the view axis the terminator crosses the disc at about
 * 0.62 of its radius, so a sample any nearer the centre lands *on* the
 * terminator and reads half-lit for every class — measured, and it is what an
 * earlier revision of this probe was doing when it reported gas giants as
 * marginal. Past 0.85 the atmosphere shell takes over and the measurement stops
 * being about the surface.
 *
 * One `evaluate` for all of them: `samplePatch` re-renders the whole scene, and
 * a round trip per body meant nine full renders of nine fragment shaders on the
 * software rasteriser this probe deliberately runs on.
 */
const patches = await page.evaluate(
	(count) =>
		Array.from({ length: count }, (_, i) => ({
			lit: window.__seelitePlanets.samplePatch(i, 0.72, 0.35, 0.1),
			dark: window.__seelitePlanets.samplePatch(i, -0.74, -0.36, 0.1),
		})),
	classes.length,
);

for (let i = 0; i < classes.length; i++) {
	const name = classes[i];
	const lit = luma(patches[i].lit.rgb);
	const dark = luma(patches[i].dark.rgb);
	check(`${name}: the lit side is not black`, lit > 8);
	if (SELF_LIT.has(name)) {
		// These two are *allowed* to glow in shadow — that is their identity — so
		// the assertion inverts. The bar is relative to the brightest night side
		// among the classes that do **not** emit, because an absolute floor near
		// black passes on rounding and proves nothing.
		const passiveDark = Math.max(
			...classes.map((n, j) =>
				SELF_LIT.has(n) ? 0 : luma(patches[j].dark.rgb),
			),
		);
		check(
			`${name}: emits on its own unlit side (${dark.toFixed(1)} vs brightest passive night side ${passiveDark.toFixed(1)})`,
			dark > passiveDark,
		);
	} else {
		// 3x separates a lit sphere from a flat one. The bar matters: the
		// prototype this replaced lit its rocky worlds as `0.62 + 0.72*ndl`,
		// which tops out at 2.16x however hard the sun shines, and lit its gas
		// giants not at all.
		check(
			`${name}: has a terminator (lit ${lit.toFixed(1)} vs dark ${dark.toFixed(1)}, x${(lit / Math.max(1, dark)).toFixed(1)})`,
			lit > dark * 3.0,
		);
	}
}

/**
 * Pairwise distinctness, on colour *and* structure.
 *
 * Mean patch colour alone is too weak a claim to carry "nine different
 * pictures": two classes with identical structure and one 1.8x brighter would
 * pass every pair. So each patch also reports the standard deviation of its
 * luminance, and a pair separates on hue, on brightness, **or** on texture — a
 * banded giant against a smooth haze differs in the third even when the first
 * two are close.
 */
const MIN_CHROMA = 0.035;
const MIN_LUMA_RATIO = 1.8;
const MIN_SD_RATIO = 1.6;
let closest = { score: Number.POSITIVE_INFINITY, pair: "", how: "" };
for (let i = 0; i < classes.length; i++) {
	for (let j = i + 1; j < classes.length; j++) {
		const a = chroma(patches[i].lit.rgb);
		const b = chroma(patches[j].lit.rgb);
		const gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
		const la = luma(patches[i].lit.rgb);
		const lb = luma(patches[j].lit.rgb);
		const ratio = Math.max(la, lb) / Math.max(1, Math.min(la, lb));
		const sa = patches[i].lit.sd;
		const sb = patches[j].lit.sd;
		const sdRatio = Math.max(sa, sb) / Math.max(0.5, Math.min(sa, sb));

		const how = [
			gap >= MIN_CHROMA ? "hue" : null,
			ratio >= MIN_LUMA_RATIO ? "brightness" : null,
			sdRatio >= MIN_SD_RATIO ? "texture" : null,
		].filter(Boolean);
		// Normalised headroom on the best of the three, so "closest pair" means
		// the pair with the least margin rather than the least hue gap.
		const score = Math.max(
			gap / MIN_CHROMA,
			ratio / MIN_LUMA_RATIO,
			sdRatio / MIN_SD_RATIO,
		);
		if (score < closest.score)
			closest = {
				score,
				pair: `${classes[i]}/${classes[j]}`,
				how: how.join("+"),
			};
		check(
			`${classes[i]} and ${classes[j]} are distinguishable by ${how.join("+") || "nothing"} (hue ${gap.toFixed(3)}, luma x${ratio.toFixed(2)}, sd x${sdRatio.toFixed(2)})`,
			how.length > 0,
		);
	}
}
console.log(
	`  narrowest margin: ${closest.pair} at ${closest.score.toFixed(2)}x the bar, on ${closest.how}`,
);

/**
 * The terran world has both ocean and land, and sea level is what decides how
 * much of each.
 *
 * The failure this guards is specific and was real: a sea level tuned against
 * an un-normalised fBm sat in the tail of its distribution, so `land` was ~0
 * everywhere and the "rocky world" rendered as a featureless ocean.
 *
 * Ocean is blue-dominant **and dark** — the second half matters, because the
 * polar caps and the blue atmosphere shell are also blue-dominant, and a
 * detector without the luminance term counts ice as sea and would stay green
 * on a world that had frozen over instead of drowned.
 */
const OCEAN_MAX_LUMA = 60;
const isOcean = ([r, g, b]) =>
	b > r * 1.15 && b > g && luma([r, g, b]) < OCEAN_MAX_LUMA;

/** A disc-filling grid, offset towards the lit side so shadow is not counted. */
const GRID = [];
for (let gx = -3; gx <= 3; gx++)
	for (let gy = -3; gy <= 3; gy++) {
		const u = gx * 0.19 + 0.12;
		const v = gy * 0.19;
		if (Math.hypot(u, v) <= 0.68) GRID.push([u, v]);
	}

const terran = classes.indexOf("terran");
check("the gallery includes a terran world", terran >= 0);

/** Ocean fraction at a given sea level, in one round trip. */
async function oceanFractionAt(seaLevel) {
	const grid = await page.evaluate(
		([index, cells, level]) => {
			if (level !== null) window.__seelitePlanets.setSeaLevel(index, level);
			return cells.map(
				([u, v]) => window.__seelitePlanets.samplePatch(index, u, v, 0.05).rgb,
			);
		},
		[terran, GRID, seaLevel],
	);
	return grid.filter(isOcean).length / grid.length;
}

if (terran >= 0) {
	const authored = await page.evaluate(
		(i) => window.__seelitePlanets.oceanFraction[i],
		terran,
	);
	const fraction = await oceanFractionAt(null);
	console.log(
		`  terran: sea level ${authored.toFixed(2)} -> ${(fraction * 100).toFixed(0)}% of sampled patches read as ocean`,
	);
	check(
		`terran has continents (ocean ${(fraction * 100).toFixed(0)}% < 92%)`,
		fraction < 0.92,
	);
	check(
		`terran has an ocean (ocean ${(fraction * 100).toFixed(0)}% > 15%)`,
		fraction > 0.15,
	);

	/**
	 * Sea level controls ocean fraction, monotonically.
	 *
	 * This is the claim `planet-shaders.ts` actually needs and the strongest one
	 * it can make. The `stretch()` rescale widens the usable band of a bell-shaped
	 * fBm so a threshold near the middle is a real control rather than an off
	 * switch — it does *not* turn the mapping into a CDF, so "sea level 0.6 means
	 * 60% ocean" would be false. Monotonic response is true, and testable.
	 */
	const ladder = [];
	for (const level of [0.35, 0.5, 0.65, 0.8])
		ladder.push([level, await oceanFractionAt(level)]);
	console.log(
		`  sea level -> ocean: ${ladder.map(([l, f]) => `${l}=${(f * 100).toFixed(0)}%`).join("  ")}`,
	);
	for (let i = 1; i < ladder.length; i++) {
		check(
			`raising sea level ${ladder[i - 1][0]} -> ${ladder[i][0]} does not lower the ocean fraction`,
			ladder[i][1] >= ladder[i - 1][1],
		);
	}
	// A control that never moves is not a control. Across the full sweep the
	// fraction has to actually travel.
	check(
		`sea level spans a real range (${(ladder[0][1] * 100).toFixed(0)}% -> ${(ladder[ladder.length - 1][1] * 100).toFixed(0)}%)`,
		ladder[ladder.length - 1][1] - ladder[0][1] > 0.25,
	);
	// Put it back, so the budget below measures the shipped world.
	await page.evaluate(
		([i, level]) => window.__seelitePlanets.setSeaLevel(i, level),
		[terran, authored],
	);
}

/**
 * The budget.
 *
 * Two numbers, because they measure different things and only one of them is
 * the shader cost. `meanFrameMs` is a mean of `requestAnimationFrame` deltas,
 * which cannot report faster than the display's refresh interval — at 60 Hz it
 * bottoms out near 16.7 ms however cheap the shaders are, so on its own it is a
 * measure of the cadence. `measureRenderMs` renders back to back outside that
 * cadence and blocks on `finish()`, so it is the work.
 *
 * Reported, not gated: this runs on whatever the developer has, and on a
 * headless runner it is a software rasteriser, so a threshold here would be a
 * threshold on the machine rather than on the shader.
 */
const budget = await page.evaluate(() => ({
	cadenceMs: window.__seelitePlanets.meanFrameMs(),
	renderMs: window.__seelitePlanets.measureRenderMs(),
	buffer: window.__seelitePlanets.bufferSize(),
}));
console.log(
	`  budget: ${budget.renderMs.toFixed(1)} ms/render for ${classes.length} bodies at ${budget.buffer[0]}x${budget.buffer[1]} (rAF cadence ${budget.cadenceMs.toFixed(1)} ms)`,
);
// Not a budget threshold — a sanity floor on the *instrument*. Nine full-screen
// fragment shaders cannot rasterise in under 50 microseconds on any hardware, so
// a figure below that means the fence is not fencing and the number is fiction.
// This is exactly how the first version of this measurement failed: `finish()`
// returned immediately and it reported 0.0 ms.
check(
	`render cost is a real measurement, not an un-fenced enqueue (${budget.renderMs.toFixed(2)} ms)`,
	budget.renderMs > 0.05 && budget.renderMs < 5000,
);

await browser.close();
exit();
