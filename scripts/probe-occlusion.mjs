/**
 * #201's two occlusion passes, in a browser: the sun's shadow map on the near
 * layer and the screen-space ambient occlusion in front of the bloom.
 *
 *   npm run dev
 *   npm run probe:one occlusion
 *
 * ## What a probe can and cannot settle here
 *
 * It cannot settle whether the frame looks better; #98 settled that that is a
 * person's job and the canonical sheet is where they do it. What it can settle
 * is every way this change can be **silently absent or silently wrong**, and
 * there turned out to be four, three of which were live defects found by
 * measuring rather than by looking:
 *
 * 1. **The box was 405 km wide.** "The station when it is in the near layer"
 *    is a set: the near layer reaches `HANDOFF_KM` and the fixture's start
 *    system has two stations. Unioning both put the shadow texel at 455 m —
 *    the pass ran, cost a frame and drew nothing resolvable. `shadowBox`
 *    admits by apparent size now, and the texel rows below are what would have
 *    caught it.
 * 2. **The ambient occlusion landed on the sky.** `GTAOPass` renders its own
 *    normal-and-depth buffer with `MeshNormalMaterial`, which writes depth for
 *    materials that do not — and the canopy glass is one, so it covered the
 *    forward view in the AO buffer. The `only the glass and the lamps` row
 *    below is that defect made into a check.
 * 3. **A walk that matches nothing renders a perfect frame.** If the material
 *    rule stopped matching, every `castShadow` would be `false`, no shadow
 *    would be drawn, and nothing else would change. The counts are read off
 *    the page.
 * 4. **A shadow that lightens is a shadow that is inside out.** A wrong-signed
 *    bias moves pixels; it moves them the wrong way.
 *
 * Every reading is a **same-build A/B through `setOcclusion`**, which is why
 * this can be a probe at all: the two arms differ by one pass and by nothing
 * else — no reload, no camera move, no clock difference. The dither is turned
 * off for the duration, because it adds a per-pixel ±0.5/255 to every frame and
 * is most of what a naive pixel comparison would find.
 *
 * **The frame cost is not here.** This runs under SwiftShader like every other
 * probe (#98), so a millisecond read off it is nobody's. `measure-occlusion-cost.mjs`
 * prices the two passes headed.
 */
import { GAME_TIME_S as CLOCK, SEED } from "./lib/view-set.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/**
 * The two framings, and each is here for a different failure.
 *
 * `station-flank` is the one where the box has two things in it — the hull in
 * front and the station beyond — so it is where a subject-admission mistake
 * shows as a texel blowing up. `berth-free-look` is inside a bay, which is the
 * frame #201 was opened over for the ambient occlusion: flat boxes with nothing
 * darkening a corner.
 */
const STATION = "station-trade";

/** Ceilings on the shadow texel, in kilometres, per framing.
 *
 *  Not tuning: each is the size below which the framing's own features are
 *  bigger than a texel. A station's aperture and booms are hundreds of metres,
 *  so ten metres resolves them; the cabin's fittings are metres, so a tenth of
 *  one does. The figures a passing run actually reports are far under both —
 *  1.8 m and 70 mm — and the gap is deliberate, because what these reject is
 *  the 455 m regression and not a retune. */
const TEXEL_CEILING_KM = { exterior: 0.01, cockpit: 0.001 };

/**
 * How much of the `station-flank` frame the shadow may darken — a **band**, and
 * the reason it is one is the more interesting half.
 *
 * A floor catches the pass silently not running. What a floor cannot catch is
 * the failure a shadow map actually has, which is **acne**: a depth bias too
 * small, or of the wrong sign, makes a lit surface shadow itself in a speckle,
 * and that moves *more* pixels rather than fewer. Measured on this build, same
 * framing, by flipping `shadowFit`'s bias: the correct rig darkens 0.467% of
 * the frame across three runs with no digit moving, a bias 40 texels positive
 * gives 0.847%, and 200 texels gives 2.223%.
 *
 * So the ceiling is what watches the bias, and **it is honest about its reach**:
 * at 1.5% it rejects the 200-texel error and does not reject the 40-texel one.
 * The sign and the scale-freedom of the bias are pinned exactly in
 * `tests/occlusion.test.ts`, where they are arithmetic; this is the arm that
 * says the arithmetic reached the frame.
 */
const SHADOW_BAND_PCT = { min: 0.15, max: 1.5 };

/** How much of the near subject the ambient occlusion has to reach before it
 *  counts as present. A bay is a room of corners; measured on a passing run it
 *  darkens 13.8% of the whole frame there, so a floor of 2% rejects a pass that
 *  has silently stopped running without pinning the look. */
const AO_FLOOR_PCT = 2;

/** A pixel has moved when it moves by more than this, on the 0–255 readback.
 *  Two rather than one: the composite is half-float through an eight-bit
 *  canvas, and the last code is not stable between two renders of one frame. */
const MOVED = 2;

/**
 * One A/B of the two passes, in one evaluate.
 *
 * One evaluate for `probe-station-visuals.mjs`'s reason: between two, the frame
 * loop runs, the station spins and its orbit carries it — and the drift is the
 * size of the effect being measured. Everything below happens between renders
 * with nothing else moving.
 */
const compare = (page, mode) =>
	page.evaluate((how) => {
		const game = window.__seelite;
		const W = 480;
		const H = 300;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const src = game.renderer.domElement;
		const frame = () => {
			// Render and read in the same task: a WebGL canvas without
			// `preserveDrawingBuffer` is cleared at the next composite.
			game.render(0);
			ctx.drawImage(src, 0, 0, W, H);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const dither = game.settings.value.dither;
		// Through the pass rather than the store: an instrument should not leave
		// a preference behind on the machine it measured.
		game.outputPass.setDither(false);

		// **Only the surfaces the rule refused.** Hiding every participant leaves
		// the canopy, the lamps, the nameplates and the star field — none of
		// which may contribute a single occluded pixel. This is the arm that
		// fails when a transparent mesh writes depth into the AO buffer.
		const hidden = [];
		if (how === "refused-only")
			game.nearScene.traverse((object) => {
				if (object.isMesh && object.castShadow) {
					hidden.push([object, object.visible]);
					object.visible = false;
				}
			});

		game.setOcclusion(false, false);
		const none = frame();
		game.setOcclusion(true, false);
		const shadowOnly = frame();
		game.setOcclusion(false, true);
		const aoOnly = frame();

		for (const [object, was] of hidden) object.visible = was;
		game.setOcclusion();
		game.outputPass.setDither(dither === "on");

		const luma = (d, i) =>
			0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
		const against = (later) => {
			let darker = 0;
			let lighter = 0;
			let deepest = 0;
			let pixels = 0;
			for (let i = 0; i < none.length; i += 4) {
				pixels++;
				const delta = luma(later, i) - luma(none, i);
				if (delta < -2) darker++;
				else if (delta > 2) lighter++;
				if (-delta > deepest) deepest = -delta;
			}
			return {
				darkerPct: (100 * darker) / pixels,
				lighterPct: (100 * lighter) / pixels,
				deepest,
			};
		};
		return {
			shadow: against(shadowOnly),
			ao: against(aoOnly),
			texelKm: game.shadowTexelKm,
			mapTexels: game.nearScene.getObjectByName("sun")?.shadow.mapSize.x,
		};
	}, mode);

const origin = await guardedOrigin(ORIGIN, [
	"src/occlusion.ts",
	"src/main.ts",
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

/** Cycle to a view through the key the player has, so the transition and the
 *  head-look reset run the way they run in the game. */
const setView = async (want) => {
	for (let i = 0; i < 8; i++) {
		if ((await page.evaluate(() => window.__seelite.view)) === want) return;
		await page.keyboard.press("v");
	}
	throw new Error(`could not reach the ${want} view`);
};
const settle = () =>
	page.evaluate(
		() =>
			new Promise((done) => {
				let n = 3;
				const tick = () => (n-- ? requestAnimationFrame(tick) : done());
				requestAnimationFrame(tick);
			}),
	);

// ---- what the walk marked, before any pixel is looked at ----

const marked = await page.evaluate(() => window.__seelite.markedOcclusion);
t.check(
	"every built subtree has surfaces that cast and receive",
	marked.length > 0 && marked.every(([, m]) => m.participating > 0),
	marked.map(([name, m]) => `${name} ${m.participating}`).join(", "),
);
t.check(
	"the rule refuses something on the cabin and on every station",
	marked
		.filter(([name]) => name === "cockpit" || name.startsWith("station-"))
		.every(([, m]) => m.excluded > 0),
	marked.map(([name, m]) => `${name} ${m.excluded}`).join(", "),
);

// ---- the quality gate, read off the page rather than off the record ----

const gate = await page.evaluate(async () => {
	const game = window.__seelite;
	const kept = game.settings.value.quality;
	const read = () => ({
		castShadow: !!game.nearScene.getObjectByName("sun")?.castShadow,
		ao: game.gtaoPass?.enabled ?? null,
		far: !!game.farScene.getObjectByName("sun")?.castShadow,
		approach: !!game.approachScene.getObjectByName("sun")?.castShadow,
	});
	game.settings.set("quality", "high");
	const high = read();
	game.settings.set("quality", "low");
	const low = read();
	game.settings.set("quality", kept);
	return { high, low, kept };
});
t.check(
	"high turns both passes on and low turns both off",
	gate.high.castShadow && gate.high.ao && !gate.low.castShadow && !gate.low.ao,
	`high ${gate.high.castShadow}/${gate.high.ao}, low ${gate.low.castShadow}/${gate.low.ao}`,
);
t.check(
	"the game ships with the occlusion on",
	gate.kept === "high",
	`default quality is ${gate.kept}`,
);
t.check(
	"only the near layer's sun casts a shadow",
	!gate.high.far && !gate.high.approach,
	`far ${gate.high.far}, approach ${gate.high.approach}`,
);

// ---- the exterior framing: the hull in front, the station beyond ----

await setView("chase");
await page.evaluate(
	([id, radii, deg]) => window.__sunOffset(id, radii, deg),
	[STATION, 4, 40],
);
await setView("chase");
await settle();
const flank = await compare(page, "normal");

t.check(
	"the shadow map is 2048 texels",
	flank.mapTexels === 2048,
	`${flank.mapTexels}`,
);
t.check(
	"the box is cut to its subject and not to the near layer",
	flank.texelKm > 0 && flank.texelKm < TEXEL_CEILING_KM.exterior,
	`${(flank.texelKm * 1000).toFixed(2)} m per texel, ceiling ${TEXEL_CEILING_KM.exterior * 1000} m`,
);
t.check(
	"the shadow darkens the exterior, and by a fraction of it",
	flank.shadow.darkerPct > SHADOW_BAND_PCT.min &&
		flank.shadow.darkerPct < SHADOW_BAND_PCT.max,
	`${flank.shadow.darkerPct.toFixed(3)}% darker, ${flank.shadow.lighterPct.toFixed(3)}% lighter, deepest ${flank.shadow.deepest.toFixed(1)}/255`,
);

// ---- inside a bay, which is the frame the AO was asked for ----

await setView("chase");
await page.evaluate(
	([id, berth, opts]) => window.__parkInBerth(id, berth, opts),
	[
		STATION,
		"overhead-near",
		{ stopAtArrivalFraction: 1, headLook: { yaw: -0.75, pitch: -0.2 } },
	],
);
await setView("chase");
await settle();
const bay = await compare(page, "normal");

t.check(
	"the ambient occlusion darkens the bay",
	bay.ao.darkerPct > AO_FLOOR_PCT,
	`${bay.ao.darkerPct.toFixed(2)}% of the frame darker, floor ${AO_FLOOR_PCT}%, deepest ${bay.ao.deepest.toFixed(1)}/255`,
);
t.check(
	"the ambient occlusion only ever subtracts light",
	bay.ao.lighterPct === 0,
	`${bay.ao.lighterPct.toFixed(3)}% lighter`,
);

// ---- the cabin, where the box is four orders of magnitude smaller ----

await setView("cockpit");
await page.evaluate(
	([id, radii]) =>
		window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
			comoving: true,
		}),
	[STATION, 5],
);
await setView("cockpit");
await settle();
const cabin = await compare(page, "normal");

t.check(
	"the cabin gets a box of its own rather than the station's",
	cabin.texelKm > 0 && cabin.texelKm < TEXEL_CEILING_KM.cockpit,
	`${(cabin.texelKm * 1000).toFixed(3)} m per texel, ceiling ${TEXEL_CEILING_KM.cockpit * 1000} m`,
);
t.check(
	"the ambient occlusion reaches the cabin",
	cabin.ao.darkerPct > AO_FLOOR_PCT,
	`${cabin.ao.darkerPct.toFixed(2)}% darker, deepest ${cabin.ao.deepest.toFixed(1)}/255`,
);

// ---- the regression that shipped for a round ----

const refused = await compare(page, "refused-only");
t.check(
	"with only the glass and the lamps on screen, the occlusion is a no-op",
	refused.ao.darkerPct === 0 && refused.ao.lighterPct === 0,
	`${refused.ao.darkerPct.toFixed(3)}% darker, ${refused.ao.lighterPct.toFixed(3)}% lighter`,
);

await browser.close();
t.exit();
