/**
 * The one thing about #99's light rig that no headless test can reach: whether
 * the baked environment is **oriented** the way `three` samples it.
 *
 * `tests/light-rig.test.ts` holds the radiance model — it is a lobe toward the
 * star and a floor everywhere — and says in its own header why it stops there.
 * The mapping from a texel to a direction is stated once, in `light-rig.ts`, so
 * any assertion restating it agrees with it by construction, including a
 * flipped one. A cube handed to the renderer back-to-front puts the reflection
 * on the side *away* from the star: it looks wrong and measures perfectly.
 *
 * ## What is measured, and why it is a difference
 *
 * The same station, framed twice — once front-lit (the star nearly behind the
 * camera) and once backlit (the star beyond the subject) — and each framing
 * rendered twice, with the quality setting `high` and then `low`. Low drops the
 * environment and changes nothing else, so **high minus low is the environment
 * and only the environment**: the sun, the hemisphere, the fill, the clock, the
 * camera and the station's own spin phase are identical across the pair.
 *
 * That is the point of differencing rather than thresholding. An absolute
 * brightness would be measuring the sun's angle as much as the environment, and
 * the sun's angle is exactly what the two framings vary.
 *
 * Both halves are then compared against each other, which is the orientation
 * check: the environment must add **more** where the star is in front of the
 * subject than where it is behind it. That inequality is
 *
 * - true on a correct bake,
 * - **reversed** on a bake sampled back-to-front,
 * - and **zero on both sides** if the environment never reached the scene at
 *   all — which is why the first check requires the front-lit delta to be
 *   positive before the comparison is made. A check whose every arm can read
 *   zero is a check that passes when the thing it measures is missing.
 *
 * Both of those were built and watched go red before this was offered as
 * verification: `scene.environment = null` reads Δ 0.00 on both arms and fails
 * two checks, and negating the star direction in the rotation reads front
 * Δ 9.37 against back Δ 23.54 and fails the comparison.
 *
 * ## What it does not catch, measured rather than assumed
 *
 * **The fill is not tested here, and cannot be at these framings.** A check
 * that a backlit hull is still lit — the fix #99 inherited and must not undo —
 * was written, and it could not fail: it asserted `back.low > 1` against a
 * measured 38.28, on a mask that already admits only pixels three levels away
 * from the background. Rebuilding it as a ratio did not rescue it either. With
 * `fill.intensity` driven to 0, the backlit arm reads 28.16 against 38.28 and
 * the ratio to the front-lit arm moves 48.9% → 39.6% — a real difference in the
 * right direction, and far too shallow to put a threshold in the middle of
 * without tuning the threshold until the verdict came out.
 *
 * The reason is the framing rather than the check. The fill's own case is a
 * hull lit from *behind*, near 180°, and that is precisely the angle where the
 * station eclipses the star and the mask stops being the station (below). So
 * the two requirements are in direct conflict at this subject, and the fill
 * keeps the coverage it had before #99 — which is none, beyond the frame a
 * person looks at.
 *
 * **A small mis-rotation walks past it, and something else catches that now.**
 * Inverting the rotation — a plausible typo, and the third defect built for
 * this — moved the pair from 21.30/12.31 to 19.84/9.22 and stayed green,
 * because the inverse lands the lobe 2θ from the star and θ is small for the
 * direction seed 47 puts it in. The inequality here is between a front-lit and
 * a backlit hull, so it discriminates *which hemisphere* the lobe is in and
 * nothing finer; a check claiming more would be claiming it about a difference
 * of two means over two thousand pixels.
 *
 * What closed that gap was moving the rotation out of `main.ts` and into
 * `envRotation`, where `tests/light-rig.test.ts` sweeps its round trip over 200
 * directions and the inverse fails at every one but the two poles. So the two
 * tiers divide the question: the headless test says the rotation is the
 * rotation it claims to be, and this says the bake reached the scene pointing
 * the right way. Neither implies the other — a correct rotation applied to an
 * environment that was never assigned is green upstairs.
 *
 * ## SwiftShader, said plainly
 *
 * This runs through the software rasteriser like every probe here (#98), so no
 * number below is the player's. It does not need to be: every claim is a
 * comparison between two renders on the same rasteriser, so what would break it
 * is a renderer that treats the environment differently between two frames, not
 * one that is slow. The half that needs the player's GPU is the picture, and
 * that is the canonical view set's job.
 */
import {
	guardedOrigin,
	bootedGame,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { GAME_TIME_S as CLOCK, SEED } from "./lib/view-set.mjs";
import { installViewPlacement } from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/**
 * The canonical view set's fixture, **imported rather than restated** (#174).
 *
 * This line held its own `47` and `0` beside a sentence describing the fixture,
 * and the description was already false. A copied constant is how a probe and
 * the sheet drift into measuring two worlds while a comment says they do not.
 * `view-set.mjs`'s `SEED` and `FIXTURE` docstrings own what the fixture is and
 * is not; a test measures it.
 */
const SUBJECT = "station-trade";
/** Eight silhouette radii: the framing `cockpit-backlit` uses, where the
 *  station is about a third of the frame and its plating is resolvable. */
const RADII = 8;

/**
 * Front-lit and backlit, and neither is at an extreme.
 *
 * `sunAngleDeg` is measured at the subject, so 0 puts the star behind the
 * camera and 180 puts it directly behind the station. **160 was tried first and
 * is wrong**: at that angle the station eclipses the star, so hiding the mesh
 * reveals the disc and its bloom halo, and the mask — which is "pixels that
 * changed when the station was hidden" — grew from ~2,100 px to ~39,500. The
 * backlit mean was then mostly halo, and the comparison against the front-lit
 * delta was a comparison between two different subjects. It still read green.
 *
 * At 110 the star sits about 70 degrees off the view axis, outside a 60-degree
 * field, so both framings mask the station and nothing else. The mask-parity
 * check below is what keeps it that way, rather than a comment that hopes so.
 */
const FRONT_DEG = 20;
const BACK_DEG = 110;

/**
 * Mean luminance of the subject's own pixels, with the environment and without,
 * from one evaluate.
 *
 * One evaluate for `probe-station-visuals.mjs`'s reason: between two the frame
 * loop runs, the station spins and its orbit carries it, and the drift is the
 * size of the effect. Everything below happens between two renders with nothing
 * else moving.
 *
 * The subject is isolated by what *changed*, never by thresholding: the
 * starfield puts lit pixels across the whole frame, and a threshold tuned to
 * one sun angle would not survive the other. Hiding the station's mesh gives an
 * exact mask of where it is.
 */
const measure = (page, bodyId) =>
	page.evaluate((id) => {
		const g = window.__seelite;
		const W = 480;
		const H = 300;
		const src = g.renderer.domElement;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			// Render and read in the same task: a WebGL canvas without
			// `preserveDrawingBuffer` is cleared at the next composite.
			g.render(0);
			ctx.drawImage(src, 0, 0, W, H);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const mesh = window.__meshOfBody(id);
		if (!mesh) return { missing: true };

		const wasVisible = mesh.visible;
		const quality = g.settings.value.quality;

		// High *before* the bare frame, not after. The mask is "pixels that moved
		// when the station was hidden", so the bare frame and the frame it is
		// differenced against have to be the same configuration — otherwise, on a
		// page whose stored setting is `low`, the mask becomes "pixels the
		// environment changed" and quietly stops being the station. The default
		// is checked below, but a check that runs after the measurement does not
		// protect it.
		g.settings.set("quality", "high");

		mesh.visible = false;
		const withoutSubject = frame();
		mesh.visible = wasVisible;

		const high = frame();
		g.settings.set("quality", "low");
		const low = frame();
		g.settings.set("quality", quality);

		// The mask: pixels the station occupies, taken from the frame it is
		// missing from rather than from a brightness cut.
		const luma = (d, i) =>
			0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
		let pixels = 0;
		let sumHigh = 0;
		let sumLow = 0;
		for (let i = 0; i < high.length; i += 4) {
			const bare = luma(withoutSubject, i);
			const here = luma(high, i);
			// A pixel is the subject's where hiding it changed the frame. Two
			// levels rather than any: the starfield's own points sit at 1–2 and
			// would otherwise join the mask wherever the station occludes one.
			if (Math.abs(here - bare) < 3) continue;
			pixels++;
			sumHigh += here;
			sumLow += luma(low, i);
		}
		return {
			pixels,
			high: pixels ? sumHigh / pixels : 0,
			low: pixels ? sumLow / pixels : 0,
			quality,
		};
	}, bodyId);

async function frameAndMeasure(page, sunAngleDeg) {
	await page.evaluate(
		([id, radii, deg]) => window.__sunOffset(id, radii, deg),
		[SUBJECT, RADII, sunAngleDeg],
	);
	return measure(page, SUBJECT);
}

const origin = await guardedOrigin(ORIGIN, [
	"src/units.ts",
	"src/light-rig.ts",
]);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t = tally();
t.watch(page);

await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
await page.evaluate((clock) => window.__startClockAt(clock), CLOCK);

const front = await frameAndMeasure(page, FRONT_DEG);
const back = await frameAndMeasure(page, BACK_DEG);

t.check(
	"the station is on screen in both framings",
	!front.missing && !back.missing && front.pixels > 500 && back.pixels > 500,
	`front ${front.pixels ?? "no mesh"} px, back ${back.pixels ?? "no mesh"} px`,
);

// Everything below reads `front.high` and friends, and the summary lines at the
// end format them unconditionally — so a missing mesh would throw a TypeError
// over the tally's own report and take the `browser.close()` with it. Leaving
// through the tally means the run says which check failed.
if (front.missing || back.missing) {
	await browser.close();
	t.exit();
}

t.check(
	"the game ships with the environment on",
	front.quality === "high",
	`default quality is ${front.quality}`,
);

const frontDelta = front.high - front.low;
const backDelta = back.high - back.low;

// Both framings must mask the *same subject* before their means can be
// compared. A halo, a second body drifting into frame, or a subject half off
// the edge would each make one arm a measurement of something else — and the
// comparison would still produce a number, which is how the 160-degree version
// of this probe passed while measuring bloom.
t.check(
	"both framings mask the station and not something larger",
	Math.max(front.pixels, back.pixels) < 2 * Math.min(front.pixels, back.pixels),
	`front ${front.pixels} px against back ${back.pixels} px`,
);

t.check(
	"the environment adds light to a front-lit hull",
	frontDelta > 0,
	`high ${front.high.toFixed(2)} vs low ${front.low.toFixed(2)} (Δ ${frontDelta.toFixed(2)})`,
);

t.check(
	"and it adds more there than on a backlit one — the bake is not flipped",
	frontDelta > backDelta,
	`front Δ ${frontDelta.toFixed(2)} against back Δ ${backDelta.toFixed(2)}`,
);

console.log(
	`  front-lit  high ${front.high.toFixed(2)}  low ${front.low.toFixed(2)}  Δ ${frontDelta.toFixed(2)}  (${front.pixels} px)`,
);
console.log(
	`  backlit    high ${back.high.toFixed(2)}  low ${back.low.toFixed(2)}  Δ ${backDelta.toFixed(2)}  (${back.pixels} px)`,
);

await browser.close();
t.exit();
