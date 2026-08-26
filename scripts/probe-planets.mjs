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
 * Sample the lit and unlit sides of each disc.
 *
 * The sun sits up and to the right of the camera, so the lit patch is offset
 * that way and the unlit one opposite, along the sun's own screen bearing. Two
 * Three quarters of a radius out, which is not a round number by accident. With
 * the sun 51 degrees off the view axis the terminator crosses the disc at about
 * 0.62 of its radius, so a sample any nearer the centre lands *on* the
 * terminator and reads half-lit for every class \u2014 measured, and it is what an
 * earlier revision of this probe was doing when it reported gas giants as
 * marginal. Past 0.85 the atmosphere shell takes over and the measurement stops
 * being about the surface.
 */
const patches = [];
for (let i = 0; i < classes.length; i++) {
	patches.push(
		await page.evaluate(
			(index) => ({
				lit: window.__seelitePlanets.samplePatch(index, 0.72, 0.35, 0.1),
				dark: window.__seelitePlanets.samplePatch(index, -0.74, -0.36, 0.1),
			}),
			i,
		),
	);
}

for (let i = 0; i < classes.length; i++) {
	const name = classes[i];
	const lit = luma(patches[i].lit);
	const dark = luma(patches[i].dark);
	check(`${name}: the lit side is not black`, lit > 8);
	if (SELF_LIT.has(name)) {
		// These two are *allowed* to glow in shadow — that is their identity — so
		// the assertion inverts: they must still be visible where nothing else is.
		check(`${name}: emits on its own unlit side`, dark > 4);
	} else {
		check(
			// 3x separates a lit sphere from a flat one. The bar matters: the
			// prototype this replaced lit its rocky worlds as `0.62 + 0.72*ndl`,
			// which tops out at 2.16x however hard the sun shines, and lit its gas
			// giants not at all.
			`${name}: has a terminator (lit ${lit.toFixed(1)} vs dark ${dark.toFixed(1)}, x${(lit / Math.max(1, dark)).toFixed(1)})`,
			lit > dark * 3.0,
		);
	}
}

// Pairwise distinctness. A pair passes on a chromaticity gap *or* a luminance
// ratio: two classes may legitimately share a hue and separate on brightness.
const MIN_CHROMA = 0.035;
const MIN_LUMA_RATIO = 1.8;
let closest = { gap: Number.POSITIVE_INFINITY, pair: "" };
for (let i = 0; i < classes.length; i++) {
	for (let j = i + 1; j < classes.length; j++) {
		const a = chroma(patches[i].lit);
		const b = chroma(patches[j].lit);
		const gap = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
		const la = luma(patches[i].lit);
		const lb = luma(patches[j].lit);
		const ratio = Math.max(la, lb) / Math.max(1, Math.min(la, lb));
		const distinct = gap >= MIN_CHROMA || ratio >= MIN_LUMA_RATIO;
		if (gap < closest.gap)
			closest = { gap, pair: `${classes[i]}/${classes[j]}` };
		check(
			`${classes[i]} and ${classes[j]} are distinguishable (chroma ${gap.toFixed(3)}, luma x${ratio.toFixed(2)})`,
			distinct,
		);
	}
}
console.log(
	`  closest pair by chromaticity: ${closest.pair} at ${closest.gap.toFixed(3)}`,
);

/**
 * The terran world has both ocean and land.
 *
 * The failure this guards is specific and was real: a sea level tuned against
 * an un-normalised fBm sat in the tail of its distribution, so `land` was
 * ~0 everywhere and the "rocky world" rendered as a featureless ocean. Sampling
 * a grid across the lit hemisphere and counting blue-dominant patches catches
 * exactly that, and its mirror image — an ocean world with no ocean.
 */
const terran = classes.indexOf("terran");
check("the gallery includes a terran world", terran >= 0);
if (terran >= 0) {
	const grid = [];
	for (let gx = -3; gx <= 3; gx++) {
		for (let gy = -3; gy <= 3; gy++) {
			const u = gx * 0.19 + 0.12;
			const v = gy * 0.19;
			if (Math.hypot(u, v) > 0.68) continue;
			grid.push(
				await page.evaluate(
					([index, uu, vv]) =>
						window.__seelitePlanets.samplePatch(index, uu, vv, 0.05),
					[terran, u, v],
				),
			);
		}
	}
	// Ocean is the only thing on a terran disc that is blue-dominant *and* dark.
	const ocean = grid.filter(([r, g, b]) => b > r * 1.15 && b > g).length;
	const fraction = ocean / grid.length;
	console.log(
		`  terran: ${ocean}/${grid.length} sampled patches read as ocean (${(fraction * 100).toFixed(0)}%)`,
	);
	check(
		`terran has continents (ocean ${(fraction * 100).toFixed(0)}% < 92%)`,
		fraction < 0.92,
	);
	check(
		`terran has an ocean (ocean ${(fraction * 100).toFixed(0)}% > 15%)`,
		fraction > 0.15,
	);
}

// The budget. Reported, not gated: this runs on whatever GPU the developer has,
// and on a headless runner it is a software rasteriser, so a threshold here
// would be a threshold on the machine rather than on the shader.
const frameMs = await page.evaluate(() =>
	window.__seelitePlanets.meanFrameMs(),
);
console.log(
	`  budget: ${frameMs.toFixed(1)} ms/frame for ${classes.length} bodies at 900x900`,
);
check("the gallery is still rendering at the end of the run", frameMs > 0);

await browser.close();
exit();
