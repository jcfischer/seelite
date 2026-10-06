/**
 * Node #363: the sun's shadow measured through #241's gate. Node #723: arms
 * that differ by one thing each, and the sun-up / hemisphere-down rig #231
 * asks about.
 *
 *   npm run dev                                # in one shell
 *   node scripts/measure-shadow-enclosure.mjs  # headed
 *
 * **Run it headed, not through a probe.** Every figure is a picture claim and
 * the map's own constraint is that a SwiftShader frame is not the player's.
 *
 * The deliverable is a table #231 can decide from, not a verdict. It measures
 * candidate rebalances and chooses none.
 *
 * ## The arms
 *
 * `lib/shadow-enclosure.mjs` defines them and `tests/shadow-enclosure.test.ts`
 * holds what each one differs by; the table there is not repeated here. Every
 * arm is differenced against a no-shadow, no-AO frame drawn **at that arm's
 * own lights**, in all four layer scenes. #363's scaled-sun arm drew its
 * baseline before it raised the sun, so it compared two rigs and read the bay
 * the same as gate-blind; the page now reads every layer's sun and hemisphere
 * back at both draws and after the restore, and the run stops on any
 * difference.
 *
 * ## The same exposure
 *
 * Before the ladder, each rebalance sun gets a hemisphere value from
 * `EXPOSURE_RULE`: the hemisphere is lowered until the `hull-chase` painted
 * hull's median equals this run's shipped median. The hull is read by
 * `lib/hull-chase.mjs`, the reader #199's band is calibrated with, over the
 * pixels the shipped rig shows: that reader's own mask drops dark facets as a
 * rig gets darker, which moves the median the wrong way (see its docblock).
 *
 * ## Two statistics per row
 *
 * Neither alone answers anything. Coverage answers "how much of the frame
 * moved past visibility" and nothing else. The deepest single-pixel change
 * catches a one-pixel shadow a coverage floor rounds to 0.000%. Only *both*
 * at zero is nothing happening.
 *
 * ## What this does NOT do
 *
 * - It does not restate the cost table from `occlusion.ts` or
 *   `scripts/measure-occlusion-cost.mjs`.
 * - It does not choose a rig. #231 decides.
 * - It gates on no figure it prints; the `measure-` prefix keeps it out of
 *   `probe-all`. A readback that breaks the lights-held rule stops the run.
 */
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import {
	installViewFraming,
	OCCLUSION_FRAMINGS,
	setView,
	settleFrames,
} from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { measureHullChase } from "./lib/hull-chase.mjs";
import { HULL_LUMA_BAND, HULL_LUMA_FLOORS } from "./lib/hull-luma.mjs";
import {
	bisectHemisphere,
	enclosureArms,
	EXPOSURE_RULE,
	LAYER_SCENES,
	lightsHeldProblems,
	REBALANCE_SUNS,
	resolveOcclusion,
	SUN_SCALE,
} from "./lib/shadow-enclosure.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** The station the ladder is flown at — the trade station, whose bay is
 *  where the shadow reads and whose approach is the exterior ladder. */
const STATION = "station-trade";

/**
 * Rungs down the approach axis, in station silhouette radii. Coarse to fine,
 * ending inside a bay. The same ladder `probe-occlusion.mjs` flies, because
 * a reading that quotes a pixel darkening beside a gate state is only
 * coherent if the camera was in the same place for both, and a reader
 * comparing the two tables against each other needs the same rungs.
 */
const LADDER_RUNGS = [20, 12, 8, 5, 3, 2, 1.5];

/** A pixel has moved when it moves by more than this, on the 0–255 readback.
 *  Two rather than one: the composite is half-float through an eight-bit
 *  canvas, and the last code is not stable between two renders of one frame.
 *  Same threshold as `probe-occlusion.mjs`. */
const MOVED = 2;

/** Every layer's `"sun"` and `"hemisphere"`, read off the page. */
const readLights = (page) =>
	page.evaluate((scenes) => {
		const game = window.__seelite;
		const named = (scene, name) =>
			scene.children.find((object) => object.isLight && object.name === name);
		return scenes.map((scene) => ({
			scene,
			sun: named(game[scene], "sun")?.intensity,
			hemisphere: named(game[scene], "hemisphere")?.intensity,
		}));
	}, LAYER_SCENES);

/** Set every layer's `"sun"` and `"hemisphere"` to one pair of intensities. */
const writeLights = (page, lights) =>
	page.evaluate(
		([scenes, wanted]) => {
			const game = window.__seelite;
			for (const scene of scenes)
				for (const object of game[scene].children)
					if (object.isLight && object.name in wanted)
						object.intensity = wanted[object.name];
		},
		[LAYER_SCENES, lights],
	);

/** Stop the run when a readback breaks the lights-held rule. */
const refuseUnless = (label, problems) => {
	if (problems.length > 0)
		throw new Error(
			`measure-shadow-enclosure: ${label} was not drawn under the lights it names:\n  ${problems.join("\n  ")}`,
		);
};

/**
 * One arm: a baseline frame (no shadow, no AO) and the arm's frame, both
 * drawn at the arm's lights in every layer, returning coverage (pixels past
 * MOVED), the deepest single-pixel darkening, the baseline's mean luma, what
 * the arm's frame actually drew, and the light readbacks.
 *
 * `occlusion` is `"gate"` for a bare `setOcclusion()` or `{ shadows, ao }`
 * to pin both halves past the gate. `mode: "world-only"` hides the ship and
 * cabin children so the measurement is of the world alone.
 */
const measure = (page, { occlusion, lights, mode }) =>
	page.evaluate(
		([occ, wanted, scenes, how, moved]) => {
			const game = window.__seelite;

			const W = 480;
			const H = 300;
			const scratch = document.createElement("canvas");
			scratch.width = W;
			scratch.height = H;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			const src = game.renderer.domElement;
			const frame = () => {
				game.render(0);
				ctx.drawImage(src, 0, 0, W, H);
				return ctx.getImageData(0, 0, W, H).data;
			};

			const named = (scene, name) =>
				scene.children.find((object) => object.isLight && object.name === name);
			const pairs = scenes.map((scene) => ({
				scene,
				sun: named(game[scene], "sun"),
				hemisphere: named(game[scene], "hemisphere"),
			}));
			const read = () =>
				pairs.map(({ scene, sun, hemisphere }) => ({
					scene,
					sun: sun?.intensity,
					hemisphere: hemisphere?.intensity,
				}));
			const saved = read();

			// The arm's lights first, so the baseline is drawn under them too.
			for (const { sun, hemisphere } of pairs) {
				if (sun) sun.intensity = wanted.sun;
				if (hemisphere) hemisphere.intensity = wanted.hemisphere;
			}

			// Turn off dither for measurement.
			const dither = game.settings.value.dither;
			game.outputPass.setDither(false);

			// Hide ship/cabin in world-only mode.
			const hidden = [];
			if (how === "world-only")
				for (const root of [game.shipMesh, game.cockpit.mesh]) {
					if (!root) continue;
					for (const child of root.children) {
						hidden.push([child, child.visible]);
						child.visible = false;
					}
				}

			// Baseline: no shadow, no AO, at the arm's lights.
			game.setOcclusion(false, false);
			const atBaseline = read();
			const baseline = frame();

			// The arm.
			if (occ === "gate") game.setOcclusion();
			else game.setOcclusion(occ.shadows, occ.ao);
			const atArm = read();
			const armFrame = frame();
			const drawn = {
				shadow: !!game.shadowSun?.castShadow,
				ao: !!game.gtaoPass?.enabled,
			};

			// Restore.
			for (let i = 0; i < pairs.length; i++) {
				if (pairs[i].sun) pairs[i].sun.intensity = saved[i].sun;
				if (pairs[i].hemisphere)
					pairs[i].hemisphere.intensity = saved[i].hemisphere;
			}
			const restored = read();
			for (const [object, was] of hidden) object.visible = was;
			game.setOcclusion();
			game.outputPass.setDither(dither === "on");

			// Compare.
			const luma = (d, i) =>
				0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
			let darker = 0;
			let deepest = 0;
			let pixels = 0;
			let baseSum = 0;
			for (let i = 0; i < baseline.length; i += 4) {
				pixels++;
				const base = luma(baseline, i);
				baseSum += base;
				const delta = luma(armFrame, i) - base;
				if (delta < -moved) darker++;
				if (-delta > deepest) deepest = -delta;
			}
			return {
				darkerPct: (100 * darker) / pixels,
				deepest,
				baseLuma: baseSum / pixels,
				drawn,
				texelKm: game.shadowTexelKm,
				readback: { atBaseline, atArm, restored },
			};
		},
		[occlusion, lights, LAYER_SCENES, mode, MOVED],
	);

/**
 * Every arm at the current framing, `shipped` first because `gate-blind`
 * takes the AO `shipped` drew. Each row's readback is checked before it is
 * returned.
 */
async function measureArms(page, arms, shippedLights, label) {
	const rows = [];
	let aoShipped = null;
	for (const arm of arms) {
		if (arm.name !== "shipped" && aoShipped === null)
			throw new Error("measure-shadow-enclosure: shipped must be drawn first");
		const occlusion = resolveOcclusion(arm.occlusion, aoShipped);
		const result = await measure(page, {
			occlusion,
			lights: arm.lights,
			mode: "world-only",
		});
		refuseUnless(
			`${label}, ${arm.name}`,
			lightsHeldProblems({
				wanted: arm.lights,
				...result.readback,
				shipped: shippedLights,
			}),
		);
		if (arm.name === "shipped") aoShipped = result.drawn.ao;
		rows.push({ arm, result });
	}
	return rows;
}

const pct = (r) => `${r.darkerPct.toFixed(3).padStart(7)}%`;
const deep = (r) => `${r.deepest.toFixed(1).padStart(5)}/255`;
const onOff = (b) => (b ? "on" : "off");

function printRows(rows) {
	console.log(
		`    ${"arm".padEnd(15)} ${"sun".padStart(5)} ${"hemi".padStart(6)}  ` +
			`${"shadow".padEnd(6)} ${"AO".padEnd(3)}  ${"darker".padStart(8)}  ${"deepest".padStart(9)}  base luma`,
	);
	for (const { arm, result } of rows)
		console.log(
			`    ${arm.name.padEnd(15)} ${arm.lights.sun.toFixed(2).padStart(5)} ${arm.lights.hemisphere.toFixed(3).padStart(6)}  ` +
				`${onOff(result.drawn.shadow).padEnd(6)} ${onOff(result.drawn.ao).padEnd(3)}  ` +
				`${pct(result)}  ${deep(result)}  ${result.baseLuma.toFixed(2)}`,
		);
}

/**
 * The painted hull's reading in `hull-chase` under one pair of lights in
 * every layer, with the readback checked on both sides.
 */
async function hullUnder(page, lights, shippedLights, options = {}) {
	await writeLights(page, lights);
	const atHull = await readLights(page);
	const hull = await measureHullChase(page, 1, options);
	await writeLights(page, shippedLights);
	const restored = await readLights(page);
	refuseUnless(
		`hull-chase at sun ${lights.sun}, hemisphere ${lights.hemisphere}`,
		lightsHeldProblems({
			wanted: lights,
			atBaseline: atHull,
			atArm: atHull,
			restored,
			shipped: shippedLights,
		}),
	);
	if (hull.missing)
		throw new Error("measure-shadow-enclosure: no player hull in hull-chase");
	return {
		median: hull.medians[0],
		peak: hull.peaks[0],
		lowerQuartile: hull.lowerQuartiles[0],
		pixels: hull.pixels,
		mask: hull.mask,
	};
}

// ---- boot ----

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED }));
	await bootedGame(page);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
	await page.evaluate(() => window.__rememberBootPosition());

	// The shipped rig, read off the page rather than restated.
	const rig = await page.evaluate(() => {
		const g = window.__seelite;
		const named = (name) =>
			g.nearScene.children.find((o) => o.isLight && o.name === name);
		return {
			sun: named("sun")?.intensity,
			hemisphere: named("hemisphere")?.intensity,
			fill: named("fill")?.intensity,
			environment: g.nearScene.environmentIntensity,
			antialias: g.settings.value.antialias,
			quality: g.settings.value.quality,
			ao: g.settings.value.ao,
		};
	});
	const shipped = { sun: rig.sun, hemisphere: rig.hemisphere };
	refuseUnless(
		"the shipped rig",
		lightsHeldProblems({
			wanted: shipped,
			atBaseline: await readLights(page),
			atArm: await readLights(page),
			restored: await readLights(page),
			shipped,
		}),
	);

	// ---- header ----

	console.log(`\n  measure-shadow-enclosure — nodes #363, #723`);
	console.log(`  renderer: ${renderer} (headed, hardware lane)`);
	console.log(
		`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}, clock ${GAME_TIME_S} s`,
	);
	console.log(
		`  quality: ${rig.quality}, antialias: ${rig.antialias}, AO row: ${rig.ao}`,
	);
	console.log(
		`  shipped rig: sun ${rig.sun}, hemisphere ${rig.hemisphere}; held: fill ${rig.fill}, environment ${rig.environment}`,
	);
	console.log(`  lights set and read back in: ${LAYER_SCENES.join(", ")}`);
	console.log(
		`  threshold: ${MOVED}/255, mode: world-only (ship/cabin hidden)`,
	);
	console.log(
		`  every arm is differenced against a no-shadow, no-AO frame at its own lights`,
	);

	// ---- the same exposure ----

	console.log(`\n  the same exposure — ${EXPOSURE_RULE.describe}`);
	const target = await hullUnder(page, shipped, shipped, { keepMask: true });
	const { mask } = target;
	console.log(
		`  shipped: median ${target.median.toFixed(2)}, peak ${target.peak.toFixed(2)}, ` +
			`lower quartile ${target.lowerQuartile.toFixed(2)} over ${target.pixels} px`,
	);
	console.log(
		`  context: probe-light-rig's band, at device scale 1 — peak ${HULL_LUMA_BAND.min}–${HULL_LUMA_BAND.max}, ` +
			`median ≥ ${HULL_LUMA_FLOORS.median}, lower quartile ≥ ${HULL_LUMA_FLOORS.lowerQuartile}`,
	);
	console.log(
		`    ${"sun".padStart(5)} ${"hemi".padStart(6)}  ${"median".padStart(7)} ${"peak".padStart(7)} ${"LQ".padStart(7)}  held`,
	);
	const rebalances = [];
	for (const sun of REBALANCE_SUNS) {
		const found = await bisectHemisphere(
			async (hemisphere) =>
				(await hullUnder(page, { sun, hemisphere }, shipped, { mask })).median,
			{
				target: target.median,
				lo: 0,
				hi: shipped.hemisphere,
				tolerance: EXPOSURE_RULE.toleranceCodes,
			},
		);
		// Round to three places so the printed value is the value drawn, and
		// read the hull once more at it.
		const hemisphere = Math.round(found.hemisphere * 1000) / 1000;
		const at = await hullUnder(page, { sun, hemisphere }, shipped, { mask });
		const held =
			Math.abs(at.median - target.median) <= EXPOSURE_RULE.toleranceCodes;
		rebalances.push({ sun, hemisphere });
		console.log(
			`    ${sun.toFixed(2).padStart(5)} ${hemisphere.toFixed(3).padStart(6)}  ` +
				`${at.median.toFixed(2).padStart(7)} ${at.peak.toFixed(2).padStart(7)} ${at.lowerQuartile.toFixed(2).padStart(7)}  ` +
				`${held ? "yes" : `no (${found.reason ?? "rounding"})`}, ${found.steps} reads`,
		);
	}
	await page.evaluate(() => window.__returnToBootPosition());

	const arms = enclosureArms({ shipped, rebalances });
	console.log(`\n  arms: ${arms.map((a) => a.name).join(", ")}`);

	// ---- approach ladder in chase view ----

	console.log(`\n  approach ladder — ${STATION}, chase view, world-only`);

	await setView(page, "chase");

	for (const rung of LADDER_RUNGS) {
		await page.evaluate(
			([id, radii]) =>
				window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
					comoving: true,
				}),
			[STATION, rung],
		);
		await setView(page, "chase");
		// Settle enough frames for the gate's openFrames (2) to have been
		// satisfied if it was going to be.
		await settleFrames(page, 5);

		// Read gate state BEFORE any pixel comparison — the comparison pins
		// past the gate and would mask it.
		const state = await page.evaluate(() => window.__seelite.occlusionState);
		console.log(
			`\n  ${rung} radii — gate ${state.open ? "open" : "shut"}, enclosure ${state.enclosureRad.toFixed(4)} rad`,
		);
		printRows(await measureArms(page, arms, shipped, `${rung} radii`));
	}

	// ---- inside the bay ----

	console.log(`\n  bay — ${STATION}, berth-free-look, world-only`);

	await setView(page, OCCLUSION_FRAMINGS.berth.view);
	await OCCLUSION_FRAMINGS.berth.place(page);
	await setView(page, OCCLUSION_FRAMINGS.berth.view);
	await settleFrames(page, 5);

	const bayState = await page.evaluate(() => window.__seelite.occlusionState);
	console.log(
		`  gate: ${bayState.open ? "open" : "shut"}, enclosure: ${bayState.enclosureRad.toFixed(4)} rad`,
	);
	const bayRows = await measureArms(page, arms, shipped, "bay");
	printRows(bayRows);
	const texel = bayRows.find((row) => row.arm.name === "shadow only")?.result
		.texelKm;
	if (texel > 0) console.log(`  texel: ${(texel * 1000).toFixed(2)} m`);

	const final = await readLights(page);
	refuseUnless(
		"the end of the run",
		lightsHeldProblems({
			wanted: shipped,
			atBaseline: final,
			atArm: final,
			restored: final,
			shipped,
		}),
	);

	// ---- reading guide for #231 ----

	console.log(`\n  reading guide for node #231`);
	for (const line of [
		`"shipped" is what the player sees: gate live, shadow by the quality row, AO by the player's row.`,
		`"gate-blind" pins the shadow on and draws the AO that "shipped" drew at that rung, so the`,
		`  two differ by the gate alone. gate-blind > shipped: the gate switches off a shadow that exists.`,
		`  Where the gate is open the two should read alike; if they do not, an arm is not what it claims.`,
		`"shadow only" and "AO only" are each term alone at the shipped rig, gate bypassed.`,
		`"scaled sun" vs "shadow only": the same shadow with the sun alone raised ${SUN_SCALE}x.`,
		`  It only adds light, so it says whether the geometry is there, not what a rig looks like.`,
		`"rebalance s" vs "shadow only": the shadow under a rig with the sun at s and the hemisphere`,
		`  lowered to hold the hull's exposure (above). This is the move #231 is about.`,
		`"control" repeats "shipped" for same-build drift.`,
		`"base luma" is the baseline frame's mean display luma: the hull rule holds the hull,`,
		`  not the station, so a rebalance that moves this column changes the station's exposure.`,
		`both statistics: coverage (% of pixels past ${MOVED}/255) AND deepest single-pixel change.`,
		`  Neither alone answers anything; only both at zero is nothing happening.`,
	])
		console.log(`  - ${line}`);
} finally {
	await browser.close();
}
