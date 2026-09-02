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
/**
 * The canonical view set's fixture, **imported rather than restated** (#174).
 *
 * This file held its own `47` and `0` beside a sentence describing the fixture,
 * and the description was already false. A copied constant is how a probe and
 * the sheet drift into measuring two worlds while a comment says they do not.
 * `view-set.mjs`'s `SEED` and `FIXTURE` docstrings own what the fixture is and
 * is not; a test measures it.
 */
import { GAME_TIME_S as CLOCK, SEED } from "./lib/view-set.mjs";
import { installViewPlacement } from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

const SUBJECT = "station-trade";
/** Eight silhouette radii: the framing `cockpit-backlit` uses, where the
 *  station is about a third of the frame and its plating is resolvable. */
const RADII = 8;

/** Display-space luma after ACES and composition, on the 0–255 canvas readback.
 * A band rather than a floor: a white hull and an under-lit hull are both
 * exposure failures, and the same-build spread printed below qualifies it. */
const HULL_LUMA_BAND = { min: 150, max: 200 };
/** Floors for the distribution beneath the peak. These are deliberately well
 * below the calibrated 73.59 / 103.99 readings: they reject the failure the
 * principal caught — one compliant highlight on an otherwise dark hull —
 * without turning the probe into an exact-image comparison. */
const HULL_LUMA_FLOORS = { lowerQuartile: 55, median: 85 };
const HULL_SAMPLES = 5;

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

/**
 * The `hull-chase` frame's painted hull peak, with canopy, exhaust and point
 * lights hidden for the measurement. The camera and lighting remain that framing's,
 * but the other scene objects are hidden against the renderer's black clear:
 * otherwise an antialiased edge blended with the bright planet behind it can
 * become the "brightest hull pixel" while barely containing any hull at all.
 * The mask still comes from subtraction: render without the ship's meshes,
 * then with only its non-emissive meshes.
 */
async function measureHullChase(page) {
	const bodyId = await page.evaluate(() => {
		const planets = window.__seelite.world.system.bodies.filter(
			(body) => body.kind === "planet",
		);
		planets.sort((a, b) => b.radiusKm - a.radiusKm || (a.id < b.id ? -1 : 1));
		return planets[0].id;
	});
	await page.evaluate(
		([id, radii, deg]) => window.__sunOffset(id, radii, deg),
		[bodyId, 6, 150],
	);
	if ((await page.evaluate(() => window.__seelite.view)) !== "chase") {
		await page.keyboard.press("v");
		await page.waitForFunction(() => window.__seelite.view === "chase");
	}

	return page.evaluate(
		([sampleCount, framedBodyId]) => {
			const game = window.__seelite;
			const ship = game.shipMesh;
			if (!ship) return { missing: true };
			const bloomEnabled = game.bloom.enabled;
			// A lamp can overlap the hull in screen space. Disable its convolution
			// while reading paint so the reported pixel is post-tone-map hull light,
			// not a neighbouring navigation-light halo.
			game.bloom.enabled = false;
			const navLights = ship.getObjectByName("nav-lights");
			const navLightsVisible = navLights?.visible ?? false;
			const canvas = game.renderer.domElement;
			const scratch = document.createElement("canvas");
			scratch.width = canvas.width;
			scratch.height = canvas.height;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			const meshes = [];
			ship.traverse((object) => {
				if (
					!object.isMesh &&
					!object.isPoints &&
					!object.isLine &&
					!object.isSprite
				)
					return;
				const materials = Array.isArray(object.material)
					? object.material
					: [object.material];
				meshes.push({
					object,
					visible: object.visible,
					painted:
						object.isMesh &&
						materials.every(
							(material) =>
								material.isMeshStandardMaterial &&
								((material.emissive?.getHex?.() ?? 0) === 0 ||
									(material.emissiveIntensity ?? 0) === 0),
						),
				});
			});
			const hidden = [];
			for (const scene of [
				game.backdropScene,
				game.farScene,
				game.approachScene,
				game.nearScene,
			])
				for (const object of scene.children) {
					if (object === ship || object.isLight) continue;
					hidden.push({ object, visible: object.visible });
					object.visible = false;
				}
			const frame = () => {
				game.render(0);
				ctx.drawImage(canvas, 0, 0);
				return ctx.getImageData(0, 0, scratch.width, scratch.height).data;
			};
			const luma = (data, i) =>
				0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
			const summarizeDifference = (hull, withoutShip) => {
				let peak = 0;
				let peakAt = 0;
				const values = [];
				for (let i = 0; i < hull.length; i += 4) {
					const here = luma(hull, i);
					if (Math.abs(here - luma(withoutShip, i)) < 3) continue;
					if (here > peak) {
						peak = here;
						peakAt = i / 4;
					}
					values.push(here);
				}
				values.sort((a, b) => a - b);
				return {
					peak,
					peakAt: {
						x: peakAt % scratch.width,
						y: Math.floor(peakAt / scratch.width),
					},
					lowerQuartile: values[Math.floor(values.length * 0.25)] ?? 0,
					median: values[Math.floor(values.length * 0.5)] ?? 0,
					pixels: values.length,
				};
			};
			const peaks = [];
			const peakAts = [];
			const medians = [];
			const lowerQuartiles = [];
			let pixels = 0;
			for (const mesh of meshes) mesh.object.visible = false;
			const withoutShip = frame();
			for (const mesh of meshes)
				mesh.object.visible = mesh.visible && mesh.painted;
			// Points are not paint. Keep this explicit even though the drawable
			// ledger above includes them: the peak pixel sits exactly where this
			// point sprite overlaps the fuselage, so a future Three.js type change
			// must not silently put the lamp back into the hull sample.
			if (navLights) navLights.visible = false;
			for (let sample = 0; sample < sampleCount; sample++) {
				const hull = frame();
				const summary = summarizeDifference(hull, withoutShip);
				peaks.push(summary.peak);
				peakAts.push(summary.peakAt);
				lowerQuartiles.push(summary.lowerQuartile);
				medians.push(summary.median);
				pixels = Math.max(pixels, summary.pixels);
			}
			for (const mesh of meshes) mesh.object.visible = mesh.visible;
			if (navLights) navLights.visible = navLightsVisible;
			for (const entry of hidden) entry.object.visible = entry.visible;
			game.bloom.enabled = bloomEnabled;
			game.render(0);
			return {
				missing: false,
				bodyId: framedBodyId,
				pixels,
				peaks,
				peakAts,
				lowerQuartiles,
				medians,
				exposure: game.exposure,
			};
		},
		[HULL_SAMPLES, bodyId],
	);
}

const origin = await guardedOrigin(ORIGIN, [
	"src/light-rig.ts",
	"src/main.ts",
	"src/ship-mesh.ts",
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

const liveEmissives = await page.evaluate(() => {
	const game = window.__seelite;
	const materials = new Map();
	for (const scene of [
		game.backdropScene,
		game.farScene,
		game.approachScene,
		game.nearScene,
	])
		scene.traverse((object) => {
			if (!("material" in object)) return;
			const authored = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of authored) {
				if (!("emissiveIntensity" in material)) continue;
				materials.set(material.uuid, {
					name: material.name || object.name || material.type,
					intensity: material.emissiveIntensity,
				});
			}
		});
	return {
		ceiling: game.exposure.emissiveCeiling,
		materials: [...materials.values()],
	};
});

const front = await frameAndMeasure(page, FRONT_DEG);
const back = await frameAndMeasure(page, BACK_DEG);
const hull = await measureHullChase(page);

const livePeak = Math.max(...liveEmissives.materials.map((m) => m.intensity));
t.check(
	"every live scene emissive intensity stays inside the shared ceiling",
	liveEmissives.materials.length > 0 &&
		liveEmissives.materials.every(
			(material) =>
				Number.isFinite(material.intensity) &&
				material.intensity >= 0 &&
				material.intensity <= liveEmissives.ceiling,
		),
	`${liveEmissives.materials.length} materials, peak ${livePeak.toFixed(2)} against ${liveEmissives.ceiling.toFixed(2)}`,
);

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

t.check(
	"the painted player hull is on screen in hull-chase",
	!hull.missing && hull.pixels > 500,
	`${hull.pixels ?? "no hull"} px against ${hull.bodyId ?? "no body"}`,
);
if (!hull.missing) {
	const min = Math.min(...hull.peaks);
	const max = Math.max(...hull.peaks);
	const lowerQuartileMin = Math.min(...hull.lowerQuartiles);
	const medianMin = Math.min(...hull.medians);
	t.check(
		"the brightest painted hull pixel stays inside the post-tone-map band",
		min >= HULL_LUMA_BAND.min && max <= HULL_LUMA_BAND.max,
		`${min.toFixed(2)}–${max.toFixed(2)} of 255, band ${HULL_LUMA_BAND.min}–${HULL_LUMA_BAND.max}`,
	);
	t.check(
		"the painted hull distribution is not under-lit beneath that highlight",
		lowerQuartileMin >= HULL_LUMA_FLOORS.lowerQuartile &&
			medianMin >= HULL_LUMA_FLOORS.median,
		`lower quartile ${lowerQuartileMin.toFixed(2)} ≥ ${HULL_LUMA_FLOORS.lowerQuartile}, ` +
			`median ${medianMin.toFixed(2)} ≥ ${HULL_LUMA_FLOORS.median}`,
	);
	console.log(
		`  hull-chase painted peak ${min.toFixed(2)}–${max.toFixed(2)} of 255 ` +
			`(same-build noise ${(max - min).toFixed(2)}, ${hull.pixels} px, at ${hull.peakAts.map((at) => `${at.x},${at.y}`).join(" / ")})`,
	);
	console.log(
		`  hull spread lower quartile ${lowerQuartileMin.toFixed(2)}–${Math.max(...hull.lowerQuartiles).toFixed(2)}, ` +
			`median ${medianMin.toFixed(2)}–${Math.max(...hull.medians).toFixed(2)} of 255`,
	);
	console.log(
		`  exposure   bloom strength ${hull.exposure.bloom.strength}  ` +
			`radius ${hull.exposure.bloom.radius}  threshold ${hull.exposure.bloom.threshold}`,
	);
}

console.log(
	`  front-lit  high ${front.high.toFixed(2)}  low ${front.low.toFixed(2)}  Δ ${frontDelta.toFixed(2)}  (${front.pixels} px)`,
);
console.log(
	`  backlit    high ${back.high.toFixed(2)}  low ${back.low.toFixed(2)}  Δ ${backDelta.toFixed(2)}  (${back.pixels} px)`,
);

await browser.close();
t.exit();
