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

/** Every rung the ladder must reach. Order is the gallery's layout choice and
 *  not part of the claim, so this is compared as a set — reordering the gallery
 *  should not turn this probe red for a reason unrelated to what it tests. */
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

/**
 * Rec. 709 on the raw framebuffer bytes, taken from the page rather than
 * respelled here.
 *
 * The `sd` each patch reports is computed with the page's coefficients, so a
 * second copy on this side would make the deviation and these luminances two
 * different quantities as soon as either moved. Relative, so gamma does not
 * matter — every comparison below is a ratio between two patches.
 */
let luma = null;

/** Direction of a colour, independent of how brightly it is lit. Two classes
 *  may share a hue and differ in luminance, or the reverse, so distinctness is
 *  scored on both and passes on either. */
const chroma = (rgb) => {
	const sum = rgb[0] + rgb[1] + rgb[2] || 1;
	return rgb.map((c) => c / sum);
};

await guardedOrigin(ORIGIN);
/**
 * ANGLE, with SwiftShader allowed as its backend.
 *
 * A default headless launch is slow enough here that the frame-count wait below
 * times out. Naming the args in one constant matters for the budget figures
 * printed at the end: they are only meaningful next to the renderer that
 * produced them, and "SwiftShader" alone would be a guess about which backend
 * ANGLE actually chose on this machine.
 */
const LAUNCH_ARGS = ["--use-gl=angle", "--enable-unsafe-swiftshader"];
const browser = await launchChromium({ args: LAUNCH_ARGS });
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
// Coefficients fetched once, applied locally: every use below sits inside a
// loop, and a round trip per luminance would cost more than the duplication it
// removes.
const LUMA = await page.evaluate(
	() => window.__seelitePlanets.lumaCoefficients,
);
luma = ([r, g, b]) => LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
const depths = await page.evaluate(() => window.__seelitePlanets.atmosphere);
const missing = EXPECTED.filter((name) => !classes.includes(name));
const extra = classes.filter((name) => !EXPECTED.includes(name));
check(
	`every ladder rung reached the screen (${classes.join(", ")})`,
	missing.length === 0 &&
		extra.length === 0 &&
		classes.length === EXPECTED.length,
);
if (missing.length) console.error(`  missing: ${missing.join(", ")}`);
if (extra.length) console.error(`  unexpected: ${extra.join(", ")}`);

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
 * marginal. Past ~0.85 the atmosphere shell takes over and the measurement stops
 * being about the surface — and that bound has to hold for the patch's *corner*,
 * not its centre. Centre 0.78 radii out, half-width 0.06 on each axis, so the
 * far corner reaches 0.86. An earlier revision used a 0.10 half-width from 0.80
 * and reached 0.93, which put shell pixels inside a measurement whose own
 * comment excluded them.
 *
 * One `evaluate` for all of them: every `samplePatch` re-renders the whole
 * scene, so a round trip per body meant nine full renders of nine fragment
 * shaders on the software rasteriser this probe deliberately runs on.
 */
const patches = await page.evaluate(
	(count) =>
		Array.from({ length: count }, (_, i) => ({
			lit: window.__seelitePlanets.samplePatch(i, 0.7, 0.34, 0.06),
			dark: window.__seelitePlanets.samplePatch(i, -0.72, -0.35, 0.06),
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
		// How sharp a terminator *should* be is a property of the atmosphere, not
		// a constant. The shader carries light past the geometric terminator by
		// `(ndl + w)/(1 + w)`, so at the sampled bearing a body with w = 0.32 is
		// still faintly lit where an airless one is black — that is the model
		// working, not a defect, and a single bar either fails the giants or lets
		// an unlit moon through.
		//
		// Each bar still discriminates against what this prototype replaced: the
		// old renderer lit rocky worlds as `0.62 + 0.72*ndl`, which tops out at
		// 2.16x however hard the sun shines, and lit its gas giants not at all
		// (1.0x flat).
		// How sharp a terminator *should* be is a property of the atmosphere, so
		// the bar is keyed on optical depth rather than being one constant.
		//
		// It is keyed on `atmosphere` and not on `wrapAmount`, which was the first
		// attempt: wrap only softens the *surface* term, while the additive shell
		// is a separate contribution that brightens the unlit limb on its own. The
		// two disagree exactly where it matters — desert and ice sit at almost the
		// same wrap (0.096 vs 0.064) and measure 4.9x against 44.9x, because the
		// desert's dust haze is half again as thick and its ground is darker.
		//
		// Measured, so the boundaries clear every real value rather than grazing
		// one: airless 0.0, ice 0.2, desert 0.3, terran 0.8, giants 1.0. An
		// earlier revision split at 0.1 and put desert 4% from the line.
		//
		// Each bar still discriminates against what this prototype replaced: the
		// old renderer lit rocky worlds as `0.62 + 0.72*ndl`, which tops out at
		// 2.16x however hard the sun shines, and lit its gas giants not at all.
		//
		// `iceGiant` sits closest to its bar, and the reason is its rings: the
		// ring plane crosses the disc through the unlit sample, and a ring is lit
		// by the sun whatever the planet behind it is doing. The check still
		// discriminates — an unlit ice giant reads flat — but the number is about
		// planet-and-ring, and reading it as a surface figure would be wrong.
		const depth = depths[i];
		const bar = depth === 0 ? 6.0 : depth <= 0.35 ? 3.5 : 2.2;
		check(
			`${name}: has a terminator (lit ${lit.toFixed(1)} vs dark ${dark.toFixed(1)}, x${(dark > 0 ? lit / dark : Number.POSITIVE_INFINITY).toFixed(1)} against a x${bar} bar at optical depth ${depth.toFixed(2)})`,
			lit > dark * bar,
		);
	}
}

/**
 * Pairwise distinctness, on colour *and* structure.
 *
 * A pair passes on hue, on brightness, **or** on texture, and the axis it used
 * is printed — because all three are legitimate ways for two worlds to look
 * different, and demanding two of them would fail real pairs (a star and a
 * terran world separate on brightness and hue while sharing a deviation).
 *
 * Texture is the axis this probe was missing. On colour alone, two classes with
 * identical structure and one 1.8x brighter passed, and the header's claim about
 * "nine different pictures" rested on a measurement that could not see pattern
 * at all. The standard deviation of luminance inside each patch is what sees it:
 * `terran/jovian` separate at 8.5x on that axis while sitting 1.17x apart in
 * brightness.
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
if (terran < 0)
	console.error(
		"  skipped: ocean coverage, sea-level monotonicity, sea-level range",
	);

/** Ocean fraction at a given sea level, in one round trip. */
async function oceanFractionAt(seaLevel) {
	const grid = await page.evaluate(
		([index, cells, level]) => {
			if (level !== null) window.__seelitePlanets.setSeaLevel(index, level);
			// One render for the whole grid. `samplePatches` renders once and reads
			// every cell out of that frame; mapping `samplePatch` over the cells
			// instead meant ~37 full software-rasterised renders per sea level,
			// five sea levels over.
			return window.__seelitePlanets
				.samplePatches(index, cells, 0.05)
				.map((patch) => patch.rgb);
		},
		[terran, GRID, seaLevel],
	);
	return grid.filter(isOcean).length / grid.length;
}

if (terran >= 0) {
	const authored = await page.evaluate(
		(i) => window.__seelitePlanets.seaLevel[i],
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
	// The band `appearanceFor` actually issues (0.55–0.75) plus one step outside
	// it each way. Sweeping 0.35–0.80 measured a range no terran world can have,
	// and the figures then quoted in the docs described sea levels the classifier
	// cannot produce.
	for (const level of [0.45, 0.55, 0.65, 0.75, 0.85])
		ladder.push([level, await oceanFractionAt(level)]);
	console.log(
		`  sea level -> ocean: ${ladder.map(([l, f]) => `${l}=${(f * 100).toFixed(0)}%`).join("  ")}  (issued band 0.55-0.75)`,
	);
	// One grid cell of slack. The classification is a hard threshold on ~37
	// sampled patches, so a single boundary patch flipping between steps would
	// fail a shader that is behaving correctly — a strict compare here tests the
	// sampling noise, not the shader.
	const SLACK = 1 / GRID.length;
	for (let i = 1; i < ladder.length; i++) {
		check(
			`raising sea level ${ladder[i - 1][0]} -> ${ladder[i][0]} does not lower the ocean fraction`,
			ladder[i][1] >= ladder[i - 1][1] - SLACK,
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
 * The budget, measured per class rather than quoted.
 *
 * Two kinds of number, and only one of them is the shader cost. `meanFrameMs`
 * is a mean of `requestAnimationFrame` deltas, which cannot report faster than
 * the display's refresh interval — at 60 Hz it bottoms out near 16.7 ms however
 * cheap the shaders are, so on its own it measures the cadence.
 * `measureRenderMs` renders back to back outside that cadence and fences on
 * `readPixels`, so it is the work.
 *
 * Every row is produced here, in the committed harness, because a table pasted
 * into a PR from a throwaway script cannot be re-checked by the next reader.
 * Reported, not gated: this runs on whatever the developer has, and a threshold
 * would be a threshold on the machine rather than on the shader.
 */
const gallery = await page.evaluate(() => ({
	cadenceMs: window.__seelitePlanets.meanFrameMs(),
	renderMs: window.__seelitePlanets.measureRenderMs(),
	buffer: window.__seelitePlanets.bufferSize(),
}));
const [bw, bh] = gallery.buffer;
console.log(
	`  budget, ${bw}x${bh} — the renderer is whatever this browser gave us (see LAUNCH_ARGS):`,
);
console.log(
	`    gallery (${classes.length} bodies)  ${gallery.renderMs.toFixed(1)} ms/render   (rAF cadence ${gallery.cadenceMs.toFixed(1)} ms)`,
);

/**
 * Each class alone, full screen — where the per-class cost actually shows.
 *
 * Measured by navigating the **same** page rather than opening one per class.
 * A second page does not sit idle: it keeps its own rAF loop running, and on a
 * software rasteriser the two contend for the same cores. Measured that way the
 * per-class figures came out 26–42 ms against 2.6–17.7 ms one at a time — a
 * number about scheduling, not about shaders. This block runs last for the same
 * reason: nothing above it needs the gallery page afterwards.
 */
const perClass = [];
for (const name of classes) {
	await page.goto(`${ORIGIN}/?planet-prototype=${name}`, { waitUntil: "load" });
	await page.waitForFunction(
		() => window.__seelitePlanets && window.__seelitePlanets.frameCount() > 20,
		{ timeout: 30000 },
	);
	perClass.push([
		name,
		await page.evaluate(() => window.__seelitePlanets.measureRenderMs()),
	]);
}
for (const [name, ms] of [...perClass].sort((a, b) => b[1] - a[1]))
	console.log(`    ${name.padEnd(10)} ${ms.toFixed(1)} ms/render`);

const worst = perClass.reduce((a, b) => (b[1] > a[1] ? b : a));
console.log(`  worst class: ${worst[0]} at ${worst[1].toFixed(1)} ms/render`);

// Not a budget threshold — a sanity floor on the *instrument*. Nine full-screen
// fragment shaders cannot rasterise in under 50 microseconds on any hardware, so
// a figure below that means the fence is not fencing and the number is fiction.
// This is exactly how the first version of this measurement failed: `finish()`
// returned immediately and it reported 0.0 ms.
check(
	`render cost is a real measurement, not an un-fenced enqueue (${gallery.renderMs.toFixed(2)} ms)`,
	gallery.renderMs > 0.05 && gallery.renderMs < 5000,
);
check(
	`every class was measured (${perClass.length}/${classes.length})`,
	perClass.length === classes.length && perClass.every(([, ms]) => ms > 0.05),
);

await browser.close();
exit();
