/**
 * Node #363: the sun's shadow measured through #241's gate.
 *
 *   npm run dev                                # in one shell
 *   node scripts/measure-shadow-enclosure.mjs  # headed
 *
 * **Run it headed, not through a probe.** Every figure is a picture claim and
 * the map's own constraint is that a SwiftShader frame is not the player's.
 *
 * The deliverable is a table #231 can decide from, not a verdict. It answers
 * three-way: **absent** (shadow has nothing to remove), **small** (shadow
 * exists but weak), or **switched off** (gate blocks it).
 *
 * ## Four arms per rung
 *
 * | arm | `setOcclusion` | sun | what it shows |
 * |---|---|---|---|
 * | shipped | `()` — gate live | shipped 0.2 | what the player sees |
 * | gate-blind | `(true, false)` — pinned on | shipped 0.2 | shadow with gate bypassed |
 * | scaled sun | `(true, false)` — pinned on | 10× (2.0) | geometry present at funded intensity? |
 * | control | `()` — repeat of shipped | shipped 0.2 | same-build drift baseline |
 *
 * Reading: shipped=0 + gate-blind>0 → **switched off**. shipped=0 +
 * gate-blind=0 + scaled>0 → **absent at shipped intensity, geometrically
 * present**. shipped=0 + gate-blind=0 + scaled=0 → **truly absent**.
 * shipped>0 → **small** (gate open, shadow reads).
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
 * - It does not move light between the sun and the hemisphere — that is #231's
 *   decision, not this instrument's.
 * - It gates on no figure it prints; the `measure-` prefix keeps it out of
 *   `probe-all`.
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

/**
 * The sun's shipped intensity. Read off the page at boot rather than restated
 * here — a value import into a `measure-` script is a constant that goes
 * stale when the source moves.
 */
let SHIPPED_SUN_INTENSITY = 0.2; // overwritten from the page

/** Scale factor for the "amplified sun" arm. 10× is chosen so that a
 *  shadow casting 0.003% of the frame (the exterior's measured figure on
 *  `probe-occlusion.mjs`'s build) would read ~0.03%: enough to count,
 *  small enough that the scene is not saturated. */
const SUN_SCALE = 10;

/** A pixel has moved when it moves by more than this, on the 0–255 readback.
 *  Two rather than one: the composite is half-float through an eight-bit
 *  canvas, and the last code is not stable between two renders of one frame.
 *  Same threshold as `probe-occlusion.mjs`. */
const MOVED = 2;

/**
 * One A/B of shadow-on against shadow-off in a single evaluate, returning
 * the two statistics: coverage (pixels past MOVED) and deepest single-pixel
 * darkening.
 *
 * `sunIntensity` is the sun's intensity for the "on" frame — the shipped
 * value for the normal arms, SUN_SCALE × shipped for the amplified arm.
 * It is restored before the function returns.
 *
 * `pin`: if true, calls `setOcclusion(true, false)` to bypass the gate
 * (shadow on, ao off). If false, calls `setOcclusion()` to let the gate
 * decide.
 *
 * `mode`: `"world-only"` hides the ship and cabin children so the
 * measurement is of the station alone.
 */
const measure = (page, { pin, sunIntensity, mode }) =>
	page.evaluate(
		([doPin, intensity, how, moved]) => {
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

			// Baseline: shadow off.
			game.setOcclusion(false, false);
			const baseline = frame();

			// Set sun intensity for the "on" arm.
			const sun = game.nearScene.getObjectByName("sun");
			const savedIntensity = sun ? sun.intensity : 0;
			if (sun) sun.intensity = intensity;

			// Shadow arm.
			if (doPin) game.setOcclusion(true, false);
			else game.setOcclusion();
			const shadowFrame = frame();

			// Restore.
			if (sun) sun.intensity = savedIntensity;
			for (const [object, was] of hidden) object.visible = was;
			game.setOcclusion();
			game.outputPass.setDither(dither === "on");

			// Compare.
			const luma = (d, i) =>
				0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
			let darker = 0;
			let deepest = 0;
			let pixels = 0;
			for (let i = 0; i < baseline.length; i += 4) {
				pixels++;
				const delta = luma(shadowFrame, i) - luma(baseline, i);
				if (delta < -moved) darker++;
				if (-delta > deepest) deepest = -delta;
			}
			return {
				darkerPct: (100 * darker) / pixels,
				deepest,
				texelKm: game.shadowTexelKm,
				castShadow: !!sun?.castShadow,
			};
		},
		[pin, sunIntensity, mode, MOVED],
	);

// ---- boot ----

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
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

// Read the shipped sun intensity and antialias setting off the page.
const { sunIntensity, antialias, quality } = await page.evaluate(() => {
	const g = window.__seelite;
	const sun = g.nearScene.getObjectByName("sun");
	return {
		sunIntensity: sun ? sun.intensity : 0,
		antialias: g.settings.value.antialias,
		quality: g.settings.value.quality,
	};
});
SHIPPED_SUN_INTENSITY = sunIntensity;
const scaledIntensity = SHIPPED_SUN_INTENSITY * SUN_SCALE;

// ---- header ----

console.log(`\n  measure-shadow-enclosure — node #363`);
console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}, clock ${GAME_TIME_S} s`,
);
console.log(
	`  quality: ${quality}, antialias: ${antialias}, sun intensity: ${SHIPPED_SUN_INTENSITY}`,
);
console.log(
	`  arms: shipped (gate live), gate-blind (pinned on), scaled sun (${SUN_SCALE}× = ${scaledIntensity}), control (gate live repeat)`,
);
console.log(`  threshold: ${MOVED}/255, mode: world-only (ship/cabin hidden)`);

// ---- approach ladder in chase view ----

console.log(`\n  approach ladder — ${STATION}, chase view, world-only`);
console.log(
	`  ${"radii".padStart(6)}  ${"gate".padEnd(5)}  ${"encl rad".padEnd(9)}  ` +
		`${"shipped %".padEnd(10)} ${"deepest".padEnd(8)}  ` +
		`${"gate-blind %".padEnd(13)} ${"deepest".padEnd(8)}  ` +
		`${"scaled %".padEnd(10)} ${"deepest".padEnd(8)}  ` +
		`${"control %".padEnd(10)} ${"deepest".padEnd(8)}`,
);

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

	// Four arms.
	const shipped = await measure(page, {
		pin: false,
		sunIntensity: SHIPPED_SUN_INTENSITY,
		mode: "world-only",
	});
	const gateBlind = await measure(page, {
		pin: true,
		sunIntensity: SHIPPED_SUN_INTENSITY,
		mode: "world-only",
	});
	const scaled = await measure(page, {
		pin: true,
		sunIntensity: scaledIntensity,
		mode: "world-only",
	});
	const control = await measure(page, {
		pin: false,
		sunIntensity: SHIPPED_SUN_INTENSITY,
		mode: "world-only",
	});

	const fmt = (r) =>
		`${r.darkerPct.toFixed(3).padStart(9)}%  ${(r.deepest.toFixed(1) + "/255").padEnd(8)}`;

	console.log(
		`  ${String(rung).padStart(6)}  ${(state.open ? "open" : "shut").padEnd(5)}  ${state.enclosureRad.toFixed(4).padStart(9)}  ` +
			`${fmt(shipped)}  ${fmt(gateBlind)}  ${fmt(scaled)}  ${fmt(control)}`,
	);
}

// ---- inside the bay ----

console.log(`\n  bay — ${STATION}, berth-free-look, world-only`);

await setView(page, OCCLUSION_FRAMINGS.berth.view);
await OCCLUSION_FRAMINGS.berth.place(page);
await setView(page, OCCLUSION_FRAMINGS.berth.view);
await settleFrames(page, 5);

const bayState = await page.evaluate(() => window.__seelite.occlusionState);

const bayShipped = await measure(page, {
	pin: false,
	sunIntensity: SHIPPED_SUN_INTENSITY,
	mode: "world-only",
});
const bayGateBlind = await measure(page, {
	pin: true,
	sunIntensity: SHIPPED_SUN_INTENSITY,
	mode: "world-only",
});
const bayScaled = await measure(page, {
	pin: true,
	sunIntensity: scaledIntensity,
	mode: "world-only",
});
const bayControl = await measure(page, {
	pin: false,
	sunIntensity: SHIPPED_SUN_INTENSITY,
	mode: "world-only",
});

const fmtBay = (label, r) =>
	`  ${label.padEnd(14)} ${r.darkerPct.toFixed(3)}% darker, deepest ${r.deepest.toFixed(1)}/255`;

console.log(
	`  gate: ${bayState.open ? "open" : "shut"}, enclosure: ${bayState.enclosureRad.toFixed(4)} rad`,
);
console.log(fmtBay("shipped", bayShipped));
console.log(fmtBay("gate-blind", bayGateBlind));
console.log(fmtBay("scaled sun", bayScaled));
console.log(fmtBay("control", bayControl));
if (bayShipped.texelKm > 0)
	console.log(
		`  texel: ${(bayShipped.texelKm * 1000).toFixed(2)} m (shipped), ${(bayGateBlind.texelKm * 1000).toFixed(2)} m (gate-blind)`,
	);

// ---- summary for #231 ----

console.log(`\n  reading guide for node #231`);
console.log(
	`  - "shipped" is what the player sees: gate live, sun at ${SHIPPED_SUN_INTENSITY}.`,
);
console.log(
	`  - "gate-blind" bypasses the gate: if shipped=0 but gate-blind>0,`,
);
console.log(`    the shadow exists and is switched off by the gate.`);
console.log(
	`  - "scaled sun" amplifies the sun ${SUN_SCALE}×: if gate-blind=0 but scaled>0,`,
);
console.log(
	`    the geometry is present but the 0.2 sun cannot fund a visible shadow.`,
);
console.log(`  - "control" is a same-build repeat of "shipped" for drift.`);
console.log(
	`  - both statistics: coverage (% of pixels past ${MOVED}/255) AND deepest`,
);
console.log(
	`    single-pixel change. Neither alone answers anything; only both at`,
);
console.log(`    zero is nothing happening.`);

await browser.close();
