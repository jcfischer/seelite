/**
 * The one thing about the light rig's environment that no headless test can
 * reach: whether the baked sky lights the expected side of a hull in the
 * world frame.
 *
 * `tests/light-rig.test.ts` holds the sky model and says in its own header why
 * it stops there. The mapping from a texel to a direction is stated once, in
 * `light-rig.ts`, so any assertion restating it agrees with it by construction,
 * including a flipped one. A sky handed to the renderer back-to-front lights the
 * face turned *away* from its bright side: it looks wrong and measures
 * perfectly.
 *
 * ## What the star-free sky promises, and so what this measures
 *
 * Before node #433 the bake was a star lobe and a floor, rotated onto the star
 * each frame, and this probe compared a front-lit station with a backlit one:
 * the environment had to add more where the star was in front. **That premise
 * is gone, by the principal's decision of 2026-10-04**: the per-system bake is
 * haze, gas and the floor, with no star — star light comes from the direct sun
 * alone — so nothing in the environment favours the star side any more, and
 * on a star-free bake the front/back comparison read 0.17 against 0.44. What the
 * sky does promise (#100, carried by #433) is two things, and the probe
 * measures those:
 *
 * - **It reaches the scene.** The system's own sky, on minus off, adds light
 *   to the station from both framings.
 * - **Its bright side lights the expected face.** A haze the bake puts on
 *   one side of the sky lights the hull face turned toward that side.
 *
 * The second cannot be read off the system's own sky at the canonical seed:
 * seed 47's haze and gas, cosine-weighted the way a diffuse face gathers them,
 * light any two opposite faces edge-on to its star within 4% of each other
 * (printed each run as "at most N×"). So the probe bakes a sky of its own
 * through the game's own path (`Game.bakeSky`) — a full-strength haze and no
 * gas — once aimed at the up face and once at the down face, reads each face
 * under both at one station pose, and puts the system's sky back. Which face
 * is "up", and what the model predicts for it, is `pickFramings`'s to say.
 *
 * ## Why it is two differences and not a threshold
 *
 * Each face is read with the environment on and then off, at the same pose and
 * in the same evaluate, so on minus off is the environment and only the
 * environment. Then each face is compared **with itself** — haze toward it
 * against haze away — rather than with the other face, so the station's shape,
 * the sun's angle on that face and anything else the frame carries cancel. The
 * check requires both faces to agree, and the reach check requires both deltas
 * to be positive: a check whose every arm can read zero passes when the thing
 * it measures is missing.
 *
 * Built and watched go red before this was offered as verification, each a
 * one-line change on node #433's build:
 *
 * - the environment never assigned (`scene.environment = null` in
 *   `applyQuality`): Δ 0.00 on every arm, reach and orientation both red;
 * - the bake point-reflected (`radiance([-dx, -dy, -dz])` in
 *   `equirectEnvironment`): 0.72× and 0.71× toward over away, red;
 * - rows uploaded upside down (`(height - 1 - y)` as the row index): 0.75× and
 *   0.78×, red.
 *
 * On the correct build it reads about 1.4× on both faces. The model's 1.78×
 * scores one face normal and is printed beside it; the check is on the sign
 * on both faces, not on the size.
 *
 * ## What it does not catch, measured rather than assumed
 *
 * **The fill is not tested here.** A check that a backlit hull is still lit —
 * the fix #99 inherited and must not undo — was written against the old
 * framings and could not fail: it asserted `back.low > 1` against a measured
 * 38.28 on a mask that already admits only pixels three levels away from the
 * background, and as a ratio it moved 48.9% → 39.6% with `fill.intensity` at 0,
 * far too shallow to put a threshold in the middle of. The fill's own case is a
 * hull lit from behind, where the station eclipses the star and the mask stops
 * being the station, so the fill keeps the coverage it had before #99 — none,
 * beyond the frame a person looks at.
 *
 * **Full world-frame orientation is not tested here.** Both synthetic skies
 * are symmetric about the same axis, so a roll around that axis leaves them
 * unchanged. The checks establish which side lights each face and reject the
 * measured point reflection and row flip; they cannot detect that roll.
 * **Whether the system's own sky is the right sky is not tested here.** What
 * the haze and gas look like, and whether seed 47's evenness is what #100 wanted,
 * is the canonical view set's question and the principal's yes.
 *
 * ## Which rasteriser, said plainly
 *
 * This file used to say it ran through SwiftShader "like every probe here",
 * which stopped being true when #435 made the hardware lane the default, and it
 * said so for a fortnight. It runs on whichever lane the runner picked —
 * `npm run probe` is hardware, `npm run probe:cpu` is SwiftShader — and no
 * number below is the player's on either.
 *
 * Most of what is checked here does not care. Every environment claim is a
 * comparison between two renders on the *same* rasteriser, so what would break
 * it is a renderer that treats the environment differently between two frames,
 * not one that is slow. The painted-hull rows are the exception and the only
 * one: they read absolute display codes, so a lane could in principle decide
 * them. What the two lanes here actually read, and what follows from it for the
 * margins, is `lib/hull-luma.mjs`'s to state and is not repeated here.
 *
 * The half that needs the player's GPU is the picture, and that is the
 * canonical view set's job.
 */
// Its one press by name, `v` into the chase view, moved with the hull reader
// into `lib/hull-chase.mjs` (#723), which carries #381 D11's label now.

import { gameUrl } from "./lib/game-url.mjs";
import { measureHullChase, readHullSubject } from "./lib/hull-chase.mjs";
// The painted-hull band and floors are derived in `lib/hull-luma.mjs`, from readings recorded
// against a named subject. That module owns every figure and the reason for it;
// nothing about the calibration is restated in this file.
import {
	describeHullSubject,
	HULL_LUMA_BAND,
	HULL_LUMA_CALIBRATION,
	HULL_LUMA_FLOORS,
	isCalibratedHullSubject,
} from "./lib/hull-luma.mjs";
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
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

const SUBJECT = "station-trade";
/** Four silhouette radii keep the pooled Assembly's sparse structure above
 * the mask's sampling floor. This measures light on its plating; the canonical
 * cockpit-backlit view keeps its own framing. */
const RADII = 4;

/** Repeats of the hull measurement in one page, so the row can print the
 *  same-build noise beside the reading rather than one sample of it. */
const HULL_SAMPLES = 5;

/**
 * How much more light the model must put on the bright face than on the dim
 * one before the comparison below is about anything.
 *
 * The measured deltas are fractions of a display code, so a pair of framings
 * the sky barely tells apart would make the orientation check a coin toss that
 * reads green half the time on a flipped bake. Asserted rather than assumed,
 * like `probe-planet-surfaces.mjs`'s neutral-star premise, so a change to the
 * haze model that flattens it turns the premise red by name instead of leaving
 * the comparison to pass by luck.
 */
const PREMISE_RATIO = 1.25;

/** How far off each view axis the star is held, at least. The frame is 60°
 *  tall and about 85° wide, so 60° keeps it outside even the corners. */
const STAR_CLEARANCE_DEG = 60;

/**
 * The two framings, and the haze the orientation check bakes for them.
 *
 * The up face is the direction nearest world +Y that keeps the star at least
 * `STAR_CLEARANCE_DEG` off both view axes, so the star stays out of frame (the
 * 160° framing this probe once used put the star behind the station and
 * measured its bloom halo instead). Nearest +Y so that a bake mirrored through
 * its equator — rows uploaded the wrong way up — carries the haze over to the
 * other face too. Held exactly edge-on to the star, which was the first
 * choice, that face sat far enough off +Y at seed 47's station that the mirror
 * did not carry the haze across, and a bake uploaded upside down read 1.06×
 * and 1.14× and stayed green. The two faces then meet the sun at different
 * angles, which the comparison below does not mind: it never compares one
 * face with the other.
 *
 * The haze is aimed at that face at full strength with no gas: the system's
 * own sky is reported beside it, scored on the same pair and on the best pair
 * the circle offers, but not used, because seed 47's is too even to orient
 * anything (see the header).
 *
 * **From the model, not from the texture.** Each face is scored by
 * `skyRadiance` evaluated in world directions — cosine-weighted over a
 * Fibonacci sphere, which is what a diffuse face turned toward `d` gathers.
 * Reading the bake back instead would interpret each texel through the same
 * direction mapping `light-rig.ts` wrote it with, and a flipped mapping would
 * then predict the flipped picture and agree with it.
 */
const pickFramings = (page, bodyId) =>
	page.evaluate(
		async ([id, clearanceDeg]) => {
			const g = window.__seelite;
			const { skyRadiance } = await import("/src/light-rig.ts");
			const own = g.skyBake;
			if (!own) return null;
			const unit = (v) => {
				const n = Math.hypot(v[0], v[1], v[2]) || 1;
				return [v[0] / n, v[1] / n, v[2] / n];
			};
			const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
			const negate = (v) => v.map((c) => -c);
			const body = window.__bodyById(id);
			// Sim space is star-centred, so the station's star is its reversed position.
			const sun = unit([-body.pos.x, -body.pos.y, -body.pos.z]);
			// World +Y with its star component taken out, and the circle of faces
			// the star meets edge-on that it spans with `e2`.
			const edgeOn = unit([
				-sun[1] * sun[0],
				1 - sun[1] * sun[1],
				-sun[1] * sun[2],
			]);
			const e2 = [
				sun[1] * edgeOn[2] - sun[2] * edgeOn[1],
				sun[2] * edgeOn[0] - sun[0] * edgeOn[2],
				sun[0] * edgeOn[1] - sun[1] * edgeOn[0],
			];
			// Tilted from edge-on toward +Y by as much of the star's component as
			// the clearance allows: +Y itself when the star is far enough off it.
			const limit = Math.cos((clearanceDeg * Math.PI) / 180);
			const along = Math.max(-limit, Math.min(limit, sun[1]));
			const across = Math.sqrt(1 - along * along);
			const bright = unit(
				[0, 1, 2].map((c) => edgeOn[c] * across + sun[c] * along),
			);
			// A full-strength haze and no gas, aimed at one face and then the other.
			const hazeToward = (d) => ({
				haze: { coreBearing: d, strength: 1 },
				gas: null,
			});

			const N = 4096;
			const golden = Math.PI * (3 - Math.sqrt(5));
			const sphere = [];
			for (let i = 0; i < N; i++) {
				const y = 1 - (2 * (i + 0.5)) / N;
				const r = Math.sqrt(1 - y * y);
				sphere.push([Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]);
			}
			const scorer = (sky) => {
				const lumas = sphere.map((w) => {
					const [r, gg, b] = skyRadiance(w, sky);
					return 0.2126 * r + 0.7152 * gg + 0.0722 * b;
				});
				const irradiance = (d) => {
					let sum = 0;
					let weight = 0;
					for (let i = 0; i < N; i++) {
						const c = dot(d, sphere[i]);
						if (c <= 0) continue;
						sum += c * lumas[i];
						weight += c;
					}
					return sum / weight;
				};
				return (d) => irradiance(d) / irradiance(negate(d));
			};
			const ownRatio = scorer(own);
			let ownBest = 0;
			for (let k = 0; k < 72; k++) {
				const a = (k * Math.PI) / 36;
				const d = [0, 1, 2].map(
					(c) => edgeOn[c] * Math.cos(a) + e2[c] * Math.sin(a),
				);
				ownBest = Math.max(ownBest, ownRatio(d));
			}
			return {
				bright,
				dim: negate(bright),
				sunDot: dot(bright, sun),
				own,
				hazeUp: hazeToward(bright),
				hazeDown: hazeToward(negate(bright)),
				ratio: scorer(hazeToward(bright))(bright),
				ownRatio: ownRatio(bright),
				upDeg: (Math.acos(Math.min(1, bright[1])) * 180) / Math.PI,
				ownBest,
			};
		},
		[bodyId, STAR_CLEARANCE_DEG],
	);

/**
 * Mean luminance of the subject's own pixels under each of `skies`, and once
 * with the environment taken off the scenes, from one evaluate.
 *
 * **Off by unassigning `scene.environment`, not by `quality: low`.** This probe
 * used to difference `high` against `low` on the strength of "low drops the
 * environment and changes nothing else", which stopped being true when `low`
 * also began dropping the shadows. Measured on node #433's build with the
 * environment never assigned at all, high minus low still read Δ 0.38 and 0.16
 * on the two framings — green on a reach check whose subject was missing.
 * Unassigning the environment on the four layer scenes for one frame changes
 * exactly the term being measured.
 *
 * One evaluate for `probe-station-visuals.mjs`'s reason: between two the frame
 * loop runs, the station spins and its orbit carries it, and the drift is the
 * size of the effect. Everything below happens between renders with nothing
 * else moving — **including the rebakes**. A first version baked each sky in
 * its own evaluate, so the station had turned between the two readings it
 * compared. A sky is a synchronous bake and a PMREM pass, so it goes in here.
 *
 * `null` in `skies` is the sky already on screen. Any other entry is baked
 * through `Game.bakeSky`, and the sky that was on screen goes back before this
 * returns.
 *
 * The subject is isolated by what *changed*, never by thresholding: the
 * starfield puts lit pixels across the whole frame, and a threshold tuned to
 * one sun angle would not survive the other. Hiding the station's mesh gives an
 * exact mask of where it is.
 */
const measure = (page, bodyId, skies) =>
	page.evaluate(
		([id, skyList]) => {
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
			const onScreen = g.skyBake;
			const backdrop = g.backdropScene;
			const background = backdrop.background;
			// The sky's picture off for every frame: `high` turns it on with the
			// environment (node #433 draws the bake as the backdrop), and an
			// antialiased edge pixel blends the station with whatever sky is
			// behind it — the dim side of the sky in one framing and the bright
			// side in the other. What is compared here is the reflection, so the
			// picture is held out and high minus low stays the environment's
			// light on the hull and nothing else.
			const set = (q) => {
				g.settings.set("quality", q);
				backdrop.background = null;
			};

			// High *before* the bare frame, not after. The mask is "pixels that
			// moved when the station was hidden", so the bare frame and the frame
			// it is differenced against have to be the same configuration —
			// otherwise, on a page whose stored setting is `low`, the mask becomes
			// "pixels the environment changed" and quietly stops being the
			// station. The default is checked below, but a check that runs after
			// the measurement does not protect it.
			set("high");
			mesh.visible = false;
			const withoutSubject = frame();
			mesh.visible = wasVisible;

			const highs = [];
			for (const sky of skyList) {
				if (sky) {
					g.bakeSky(sky);
					set("high");
				}
				highs.push(frame());
			}
			if (skyList.some(Boolean)) g.bakeSky(onScreen);
			set("high");
			const layers = [g.farScene, g.approachScene, g.nearScene, g.cabinScene];
			const environments = layers.map((scene) => scene.environment);
			for (const scene of layers) scene.environment = null;
			const low = frame();
			layers.forEach((scene, k) => {
				scene.environment = environments[k];
			});
			g.settings.set("quality", quality);
			backdrop.background = background;

			// The mask: pixels the station occupies, taken from the frame it is
			// missing from rather than from a brightness cut.
			const luma = (d, i) =>
				0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
			let pixels = 0;
			const sums = highs.map(() => 0);
			let sumLow = 0;
			for (let i = 0; i < low.length; i += 4) {
				const bare = luma(withoutSubject, i);
				// A pixel is the subject's where hiding it changed the frame. Two
				// levels rather than any: the starfield's own points sit at 1–2 and
				// would otherwise join the mask wherever the station occludes one.
				if (Math.abs(luma(highs[0], i) - bare) < 3) continue;
				pixels++;
				for (let k = 0; k < highs.length; k++) sums[k] += luma(highs[k], i);
				sumLow += luma(low, i);
			}
			const low_ = pixels ? sumLow / pixels : 0;
			return {
				pixels,
				// On minus off under each sky: that sky's light on the hull.
				deltas: sums.map((s) => (pixels ? s / pixels : 0) - low_),
				high: pixels ? sums[0] / pixels : 0,
				low: low_,
				quality,
			};
		},
		[bodyId, skies],
	);

/** Stand `RADII` silhouettes off the subject along `dir`, co-moving, and
 *  look back at it — `__sunOffset`'s placement with the direction given. */
async function frameAndMeasure(page, dir, skies) {
	await page.evaluate(
		async ([id, radii, d]) => {
			const body = window.__bodyById(id);
			const range = window.__radiusOf(id) * radii;
			await window.__placeShipAt(
				{
					x: body.pos.x + d[0] * range,
					y: body.pos.y + d[1] * range,
					z: body.pos.z + d[2] * range,
				},
				window.__frameVelocityOf(id),
			);
			await window.__lookAt(body.pos);
		},
		[SUBJECT, RADII, dir],
	);
	return measure(page, SUBJECT, skies);
}

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t = tally();
t.watch(page);

await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: SEED }));
await bootedGame(page);
// Node #831: the absolute hull band measures the authored model after install.
await page.evaluate(() => window.__seelite.loadAuthoredHullsAfterBoot());
await page.evaluate((clock) => window.__startClockAt(clock), CLOCK);

const liveEmissives = await page.evaluate(() => {
	const game = window.__seelite;
	const materials = new Map();
	for (const scene of [
		game.backdropScene,
		game.farScene,
		game.approachScene,
		game.nearScene,
		game.cabinScene,
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

const framings = await pickFramings(page, SUBJECT);
const missing = { missing: true };
// Under each framing, in one evaluate: the system's own sky, for reach; then
// the probe's haze aimed at the up face and at the down face, for orientation.
// The system's sky is back on screen before the hull row, whose band is
// calibrated under it.
const skies = framings ? [null, framings.hazeUp, framings.hazeDown] : [];
const up = framings
	? await frameAndMeasure(page, framings.bright, skies)
	: missing;
const down = framings
	? await frameAndMeasure(page, framings.dim, skies)
	: missing;
const arms = [up, down];
const hull = await measureHullChase(page, HULL_SAMPLES);
const hullSubject = await readHullSubject(page);

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
	"the game baked a sky to predict the framings from",
	framings !== null,
	framings ? "Game.skyBake is set" : "Game.skyBake is null",
);

t.check(
	"the station is on screen in both framings",
	arms.every((arm) => !arm.missing && arm.pixels > 500),
	`up ${up.pixels ?? "no mesh"} px, down ${down.pixels ?? "no mesh"} px`,
);

// Everything below reads `up.deltas` and friends, and the summary lines at the
// end format them unconditionally — so a missing mesh would throw a TypeError
// over the tally's own report and take the `browser.close()` with it. Leaving
// through the tally means the run says which check failed.
if (arms.some((arm) => arm.missing)) {
	await browser.close();
	t.exit();
}

t.check(
	"the game ships with the environment on",
	up.quality === "high",
	`default quality is ${up.quality}`,
);

// Each face read twice at one station pose, under the same haze aimed at it
// and aimed away from it. Only the haze's direction differs between the two
// readings of a face, so whatever the station's shape does to one face and not
// the other cancels, and so does whatever else the frame carries.
const [ownUp, upLit, upAway] = up.deltas;
const [ownDown, downAway, downLit] = down.deltas;

// Both framings must mask the *same subject* before their means can be
// compared. A halo, a second body drifting into frame, or a subject half off
// the edge would each make one arm a measurement of something else — and the
// comparison would still produce a number, which is how the 160-degree version
// of this probe passed while measuring bloom.
t.check(
	"both framings mask the station and not something larger",
	Math.max(up.pixels, down.pixels) < 2 * Math.min(up.pixels, down.pixels),
	`up ${up.pixels} px against down ${down.pixels} px`,
);

t.check(
	"the system's own sky reaches the hull from both sides",
	ownUp > 0 && ownDown > 0,
	`Δ ${ownUp.toFixed(2)} and ${ownDown.toFixed(2)}`,
);

t.check(
	"the probe's haze tells the two faces apart — the comparison below is about something",
	framings.ratio >= PREMISE_RATIO &&
		Math.abs(framings.sunDot) <=
			Math.cos((STAR_CLEARANCE_DEG * Math.PI) / 180) + 1e-9,
	`the model puts ${framings.ratio.toFixed(2)}× the light on the bright face ` +
		`(premise ${PREMISE_RATIO}×); the star ${(
			(Math.acos(Math.abs(framings.sunDot)) * 180) / Math.PI
		).toFixed(
			0,
		)}° off both view axes, the up face ${framings.upDeg.toFixed(0)}° off +Y`,
);

t.check(
	"a haze baked toward a face lights it more than one baked away, from both sides — the bake is not flipped",
	upLit > upAway && downLit > downAway,
	`up face Δ ${upLit.toFixed(2)} haze toward against ${upAway.toFixed(2)} away; ` +
		`down face ${downLit.toFixed(2)} against ${downAway.toFixed(2)}`,
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
	// Before either band row is read: the calibration is a property of the
	// subject — the hull, and since node #812 its authored model — so a page
	// drawing a different one makes both rows meaningless rather than red. This
	// says so by name instead of leaving a later reader to bisect two numeric
	// failures back to the commit that changed the subject, which is what #294
	// had to do.
	const hullFinish = hull.finishes?.hull ?? "no finish reported";
	const stationFinish = hull.finishes?.station ?? "no finish reported";
	const onCalibratedSubject = isCalibratedHullSubject(hullSubject);
	t.check(
		"the hull on screen is the subject the band was calibrated against",
		onCalibratedSubject,
		`measured ${describeHullSubject(hullSubject)}, ` +
			`calibrated ${describeHullSubject(HULL_LUMA_CALIBRATION.subject)} at ${HULL_LUMA_CALIBRATION.ref}`,
	);
	// Both numeric rows are **gated on that**, rather than reported beside it.
	// They compare display codes against a floor derived for one named subject,
	// so on any other a pass is not evidence of anything — and a green row is
	// read as one. The readings are still printed below, where a figure is a note
	// rather than a check.
	if (onCalibratedSubject) {
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
	}
	console.log(
		`  hull-chase painted peak ${min.toFixed(2)}–${max.toFixed(2)} of 255 ` +
			`(same-build noise ${(max - min).toFixed(2)}, ${hull.pixels} px, at ${hull.peakAts.map((at) => `${at.x},${at.y}`).join(" / ")})`,
	);
	console.log(
		`  hull spread lower quartile ${lowerQuartileMin.toFixed(2)}–${Math.max(...hull.lowerQuartiles).toFixed(2)}, ` +
			`median ${medianMin.toFixed(2)}–${Math.max(...hull.medians).toFixed(2)} of 255`,
	);
	console.log(
		`  finish     hull ${hullFinish}, station ${stationFinish} ` +
			`(not part of the key: the presets reach only the authored courier's glows)`,
	);
	console.log(
		`  exposure   bloom strength ${hull.exposure.bloom.strength}  ` +
			`radius ${hull.exposure.bloom.radius}  threshold ${hull.exposure.bloom.threshold}`,
	);
}

console.log(
	`  probe haze  predicted ${framings.ratio.toFixed(2)}× toward over away from the sky model; ` +
		`measured ${(upLit / upAway).toFixed(2)}× on the up face, ${(downLit / downAway).toFixed(2)}× on the down face`,
);
console.log(
	`  own sky     Δ ${ownUp.toFixed(2)} up, ${ownDown.toFixed(2)} down (${up.pixels} / ${down.pixels} px); ` +
		`predicted ${framings.ownRatio.toFixed(2)}× on this pair, at most ` +
		`${framings.ownBest.toFixed(2)}× on any pair edge-on to the star — reported, not gated`,
);

await browser.close();
t.exit();
