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
 * A floor catches the pass silently not running, and that is all this claims to
 * do. **The ceiling is a sanity bound and not an acne guard**, which took a red
 * build to establish rather than to confirm: a depth bias 200 texels positive
 * — the wrong sign, two hundred times over — left the bay reading at 6.015%,
 * inside the band, with every other row green. An earlier revision of this file
 * asserted that the ceiling watched the bias, on the strength of a sweep taken
 * in the `station-flank` framing whose readings were themselves the relighting
 * artefact sage found in round 2. It does not. What pins the bias is
 * `tests/occlusion.test.ts`, where its sign and its scale-freedom are
 * arithmetic; nothing in this repo watches a shadow for speckle, and the
 * canonical sheet is the only instrument that would see it.
 *
 * The band is around the bay reading — see the check itself for why the bay and
 * not the exterior. Five runs of this build put that reading at 6.06, 6.02,
 * 6.06, 6.13 and one outlier at **1.37**: the framing flies the docking
 * computer and occasionally stops a little short, so the floor is at 1 rather
 * than snug under six. That is still six times what a shadow that had stopped
 * being drawn would give, which is the 0.00-something the exterior row prints. The sign and the scale-freedom of the bias are pinned
 * exactly in `tests/occlusion.test.ts`, where they are arithmetic; this is the
 * arm that says the arithmetic reached the frame.
 */
const SHADOW_BAND_PCT = { min: 1, max: 15 };

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
	page.evaluate(
		([how, moved]) => {
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
					if (delta < -moved) darker++;
					else if (delta > moved) lighter++;
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
		},
		[mode, MOVED],
	);

const origin = await guardedOrigin(ORIGIN, [
	"src/occlusion.ts",
	"src/main.ts",
	"src/light-rig.ts",
]);
const browser = await launchChromium();
// **An explicit context, because one row below needs a second page that shares
// this one's `localStorage`.** `browser.newPage()` makes a throwaway context of
// its own and then refuses to open a second page in it, so the cold-boot check
// could not be written against a page created that way.
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const t = tally();
t.watch(page);
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
await page.evaluate((clock) => window.__startClockAt(clock), CLOCK);

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
	const keptAo = game.settings.value.ao;
	game.settings.set("quality", "high");
	const high = read();
	game.settings.set("quality", "low");
	const low = read();
	game.settings.set("quality", kept);
	game.settings.set("ao", "on");
	const aoOn = read();
	game.settings.set("ao", "off");
	const aoOff = read();
	game.settings.set("ao", keptAo);
	return { high, low, aoOn, aoOff, kept, keptAo };
});
/**
 * **Each row moves its own term and not the other's.**
 *
 * This asserted that `quality` moved both, which is what #201 shipped and what
 * the principal then overruled: the ambient occlusion is its own row. The
 * shadow stays on the lighting key, so both pairs are live and neither is
 * decoration — and this row is the check that caught the split when it was
 * still encoding the old ownership.
 */
t.check(
	"the occlusion row moves the occlusion pass, in both directions",
	gate.aoOn.ao === true && gate.aoOff.ao === false,
	`ao on ${gate.aoOn.ao}, ao off ${gate.aoOff.ao}`,
);
t.check(
	"and the lighting key still moves the shadow, in both directions",
	gate.high.castShadow && !gate.low.castShadow,
	`high ${gate.high.castShadow}, low ${gate.low.castShadow}`,
);

/**
 * **The lighting key's authority survives the idle path**, which review doubted
 * and which the immediate toggle above cannot speak to.
 *
 * `fitShadowCamera` sets `castShadow = false` and raises `shadowSunIdle` when a
 * frame has no near-layer subject, and restores it when one returns. Read on
 * its own that restore is unconditional, so the question is fair: can a player
 * on low lighting get the shadow back by flying somewhere empty and returning?
 *
 * No — the method's first guard returns before the restore is reached — but a
 * reading of the source is not what settles it. This raises the flag by hand at
 * low and renders with subjects present. What the same experiment at high then
 * showed is that the restore never runs at all; see below.
 *
 * **Both arms are forced into the same state**, `castShadow` false with the flag
 * raised, so the restore is the only thing that can turn it back on and the two
 * differ only by the lighting row. An earlier version reached `high` by moving
 * the quality row instead, which sets the field directly — that arm would have
 * passed with the restore deleted, and it was presented as the control.
 */
const idle = await page.evaluate(() => {
	const game = window.__seelite;
	const kept = game.settings.value.quality;
	const light = () => game.nearScene.getObjectByName("sun");
	/**
	 * Both arms enter in the **same** state — shadow down, idle raised, subjects
	 * present — so the only thing that differs is the lighting row.
	 *
	 * The first version of this set the high arm by moving the quality row,
	 * which turns `castShadow` on *directly* through `setOcclusion` before the
	 * flag is raised. Deleting the restore outright would have satisfied it. It
	 * was offered as the control that made the low arm mean something and it
	 * established nothing; review caught that. Forcing the field by hand is what
	 * makes the restore the only thing that can produce `true`.
	 */
	const enter = (quality) => {
		game.settings.set("quality", quality);
		game.render(0);
		const sun = light();
		sun.castShadow = false;
		game.shadowSunIdle = true;
		game.render(0);
		game.render(0);
		return !!light()?.castShadow;
	};
	const low = enter("low");
	const high = enter("high");
	game.settings.set("quality", kept);
	game.render(0);
	return { low, high };
});
/**
 * **Both arms read false, and the high one is a defect rather than a pass.**
 *
 * The safety property review asked about holds: a raised idle flag cannot give
 * the shadow back to a player on low lighting. That is what this asserts.
 *
 * It does not come back at **high** either, and that is not intended. The only
 * way into `shadowSunIdle` is the no-subject branch, which sets
 * `castShadow = false` on its way — and from then on `fitShadowCamera`'s first
 * guard returns before the restore is reached. So the restore is unreachable in
 * the one state it exists for, and a shadow lost to a subject-less frame stays
 * lost until the player moves the lighting row.
 *
 * Recorded here rather than fixed: it is #201's code and node #233 owns it,
 * alongside the ladder's finding that the pass fires at 12.8% and then exactly
 * 0.000% along one flight. The `high` figure is printed rather than asserted so
 * that a fix reddens nothing here and shows up as a changed number.
 */
/**
 * **An occlusion toggle does move the shadow, and this measures it.**
 *
 * `setOcclusion` re-reads both terms from their owners, so the `ao` row's
 * subscription rewrites `castShadow` from the *lighting* row on its way past.
 * In every ordinary state that is what keeps the two rows agreeing. In the idle
 * state it is the only way the shadow comes back at all, so at high lighting an
 * occlusion toggle resurrects it — unfitted.
 *
 * The PR claimed the rows could not disagree about the shadow. They can, and a
 * check that asserted only the `ao` half could not have said so. This is the
 * cross-row effect stated as a measurement, on #233's account.
 */
const resurrect = await page.evaluate(() => {
	const game = window.__seelite;
	const kept = {
		quality: game.settings.value.quality,
		ao: game.settings.value.ao,
	};
	const light = () => game.nearScene.getObjectByName("sun");
	game.settings.set("quality", "high");
	game.render(0);
	light().castShadow = false;
	game.shadowSunIdle = true;
	game.render(0);
	const beforeToggle = !!light()?.castShadow;
	game.settings.set("ao", game.settings.value.ao === "on" ? "off" : "on");
	game.render(0);
	const afterToggle = !!light()?.castShadow;
	game.settings.set("quality", kept.quality);
	game.settings.set("ao", kept.ao);
	game.render(0);
	return { beforeToggle, afterToggle };
});
t.check(
	"an occlusion toggle brings an idled shadow back at high lighting — the coupling #233 owns",
	resurrect.beforeToggle === false && resurrect.afterToggle === true,
	`castShadow ${resurrect.beforeToggle} before the toggle, ${resurrect.afterToggle} after`,
);

t.check(
	"a raised idle flag cannot give the shadow back to a player on low lighting",
	idle.low === false,
	`low ${idle.low}, high ${idle.high} (high is the defect #233 owns — the restore is unreachable); both entered with castShadow forced false`,
);
t.check(
	"the game ships with the occlusion on",
	gate.kept === "high" && gate.keptAo === "on",
	`default quality is ${gate.kept}, default occlusion is ${gate.keptAo}`,
);
t.check(
	"only the near layer's sun casts a shadow",
	!gate.high.far && !gate.high.approach,
	`far ${gate.high.far}, approach ${gate.high.approach}`,
);

// ---- the gate on a *cold boot*, which is where it was broken twice ----

/**
 * **A saved `low` must boot into `low`, and this is the check that says so.**
 *
 * The settings subscription fires on a *difference*, so nothing reruns the gate
 * on a page that simply loads with a stored preference — the shipped value has
 * to be applied at construction. #201 got that wrong twice, once per pass, and
 * for the same structural reason both times: `applyQuality` runs from
 * `buildEnvironment`, which is inside `buildLights`, and at that moment neither
 * the shadow-casting sun nor the composer's ambient-occlusion pass exists yet.
 * `setOcclusion` guarded both fields and returned, and each pass then defaulted
 * to on for the whole session.
 *
 * Neither half was visible to any other row here: every check above sets the
 * quality itself, which fires the subscription and repairs the state before it
 * measures. So this one opens a **second page in the same context** — same
 * `localStorage`, no assignment — and reads the two flags off a game nobody has
 * touched.
 */
const coldBootAt = async (settings) => {
	const writer = await context.newPage();
	// Watched like every other page here: an unwatched one reports neither a
	// page error nor a shader failure, and `check-launcher-wiring.mjs` refuses
	// the file over it — which is how these two were caught.
	t.watch(writer);
	await writer.goto(`${origin}/?seed=${SEED}`);
	await bootedGame(writer);
	const saved = await writer.evaluate((want) => {
		const store = window.__seelite.settings;
		for (const [key, value] of Object.entries(want)) store.set(key, value);
		return Object.fromEntries(
			Object.keys(want).map((key) => [key, store.value[key]]),
		);
	}, settings);
	await writer.close();
	const reader = await context.newPage();
	t.watch(reader);
	await reader.goto(`${origin}/?seed=${SEED}`);
	await bootedGame(reader);
	const read = await reader.evaluate(() => {
		const game = window.__seelite;
		return {
			quality: game.settings.value.quality,
			aoRow: game.settings.value.ao,
			castShadow: !!game.nearScene.getObjectByName("sun")?.castShadow,
			ao: game.gtaoPass?.enabled ?? null,
		};
	});
	await reader.close();
	return { saved, ...read };
};

/**
 * **Two boots, both crossed, and the crossing is what makes them two.**
 *
 * The rows have different owners since the principal's ruling, so what has to
 * be proved is no longer "the gate ran" but "each row moved its own term and
 * not the other's". A boot per row would need four to cover both directions of
 * both; two boots with the rows *disagreeing* cover all four, because each one
 * reads one row up and the other down.
 *
 * That matters beyond elegance. Each `coldBootAt` opens two pages and costs
 * about twenty-five seconds, and the main page is a **running game** the whole
 * time: a third arm pushed this probe from 95s to 145s, and somewhere in the
 * extra fifty the ship's docking computer took its clearance and docked itself,
 * so `__parkInBerth` below refused with "the session is docked". The arms are
 * cheap to add and the page they leave running is not.
 *
 * **The two arms are not equally strong, and saying they were was wrong.**
 * `GTAOPass` constructs `enabled: true` and `DirectionalLight` constructs
 * `castShadow: false`, so the low/on arm below expects exactly the two defaults
 * — it cannot tell a boot that read the saved rows from one that ignored them
 * and got lucky. The high/off arm expects the opposite of both, and it is that
 * arm alone which establishes the rows are read at all. The low/on arm still
 * earns its place: it is the one that would catch `ao` being dragged down by a
 * saved `low`, which is the coupling this PR removes.
 */
const coldLowOn = await coldBootAt({ quality: "low", ao: "on" });
t.check(
	"a saved low quality boots with no shadow, and does not take the occlusion with it",
	coldLowOn.quality === "low" &&
		coldLowOn.aoRow === "on" &&
		!coldLowOn.castShadow &&
		coldLowOn.ao === true,
	`booted ${coldLowOn.quality}/${coldLowOn.aoRow} with castShadow ${coldLowOn.castShadow} and ao ${coldLowOn.ao}`,
);

const coldHighOff = await coldBootAt({ quality: "high", ao: "off" });
t.check(
	"and a saved high quality boots with the shadow on, without turning the occlusion back on",
	coldHighOff.quality === "high" &&
		coldHighOff.aoRow === "off" &&
		coldHighOff.castShadow &&
		coldHighOff.ao === false,
	`booted ${coldHighOff.quality}/${coldHighOff.aoRow} with castShadow ${coldHighOff.castShadow} and ao ${coldHighOff.ao}`,
);

// ---- the exterior framing: the hull in front, the station beyond ----

await setView(page, "chase");
await page.evaluate(
	([id, radii, deg]) => window.__sunOffset(id, radii, deg),
	[STATION, 4, 40],
);
await setView(page, "chase");
await settleFrames(page);
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
console.log(
	`  shadow — exterior ${flank.shadow.darkerPct.toFixed(3)}% darker, deepest ${flank.shadow.deepest.toFixed(1)}/255`,
);

// ---- inside a bay, which is the frame the AO was asked for ----

await setView(page, OCCLUSION_FRAMINGS.berth.view);
await OCCLUSION_FRAMINGS.berth.place(page);
await setView(page, OCCLUSION_FRAMINGS.berth.view);
await settleFrames(page);
const bay = await compare(page, "normal");

t.check(
	"the ambient occlusion darkens the bay",
	bay.ao.darkerPct > AO_FLOOR_PCT,
	`${bay.ao.darkerPct.toFixed(2)}% of the frame darker, floor ${AO_FLOOR_PCT}%, deepest ${bay.ao.deepest.toFixed(1)}/255`,
);

// ---- the cabin, where the box is four orders of magnitude smaller ----

await setView(page, OCCLUSION_FRAMINGS.cockpit.view);
await OCCLUSION_FRAMINGS.cockpit.place(page);
await setView(page, OCCLUSION_FRAMINGS.cockpit.view);
await settleFrames(page);
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

// **Every framing, not the one that reads best.** This row said "the ambient
// occlusion only ever subtracts light" against a single berth framing, which is
// a universal claim checked in one place: it would pass while AO brightened
// pixels in a cockpit or on an exterior. Occlusion is subtractive by
// construction — the pass multiplies a value in [0, 1] over the frame — so
// there is no framing where a brighter pixel is anything but a bug, and the
// check now spends all three it has already taken.
t.check(
	"the ambient occlusion only ever subtracts light, in every framing",
	flank.ao.lighterPct === 0 &&
		bay.ao.lighterPct === 0 &&
		cabin.ao.lighterPct === 0,
	`exterior ${flank.ao.lighterPct.toFixed(3)}%, bay ${bay.ao.lighterPct.toFixed(3)}%, cabin ${cabin.ao.lighterPct.toFixed(3)}% lighter`,
);

console.log(
	`  shadow — bay ${bay.shadow.darkerPct.toFixed(3)}% darker, deepest ${bay.shadow.deepest.toFixed(1)}/255`,
);
/**
 * **The shadow is checked in the bay, and the exterior and cabin figures above
 * are printed rather than asserted. That is a finding, not a convenience.**
 *
 * The star is one of three terms lighting this game and much the smallest:
 * `LIGHT_RIG` puts the sun at 0.2 against a hemisphere at 6.85, so a surface
 * receives about 3% of its light along the direction that casts a shadow — and
 * a shadow can only ever subtract the light of the light that casts it. A
 * hemisphere cannot be shadowed at all. Measured on this build, same builds and
 * framings, shadow on against off:
 *
 * | framing | pixels darkened | deepest |
 * |---|---|---|
 * | `station-flank` | 0.003% | 3.2/255 |
 * | `cockpit-arrival` | 0.002% | 14.1/255 |
 * | `berth-free-look` | 6.2% | 11.6/255 |
 *
 * The bay is where it reads at all, and the reason is geometric: an enclosed
 * room is the one place a hull can put a large fraction of another surface out
 * of the star's line. A floor there is a real check on the whole path — the
 * box, the biases, the caster flags — where the same floor on either other
 * framing would be asserting a term the rig does not currently fund.
 *
 * **An earlier revision of this file checked `station-flank` at 0.467% and
 * passed**, with a ceiling calibrated against that figure. It was measuring a
 * bug: with the shadow off, `fitShadowCamera` left the sun's target at the last
 * fitted subject while `render` put the light's position back on a unit vector,
 * so the "off" arm was a **relit** frame rather than an unshadowed one. Sage
 * found it in round 2. The exterior number is 0.003% once the two arms differ
 * only by the shadow.
 */
t.check(
	"the shadow darkens the bay, and by a fraction of it",
	bay.shadow.darkerPct > SHADOW_BAND_PCT.min &&
		bay.shadow.darkerPct < SHADOW_BAND_PCT.max &&
		bay.shadow.lighterPct === 0,
	`${bay.shadow.darkerPct.toFixed(3)}% darker, ${bay.shadow.lighterPct.toFixed(3)}% lighter, deepest ${bay.shadow.deepest.toFixed(1)}/255`,
);
console.log(
	`  shadow — cabin ${cabin.shadow.darkerPct.toFixed(3)}% darker, deepest ${cabin.shadow.deepest.toFixed(1)}/255`,
);

const refused = await compare(page, "refused-only");
t.check(
	"with only the glass and the lamps on screen, the occlusion is a no-op",
	refused.ao.darkerPct === 0 && refused.ao.lighterPct === 0,
	`${refused.ao.darkerPct.toFixed(3)}% darker, ${refused.ao.lighterPct.toFixed(3)}% lighter`,
);

await browser.close();
t.exit();
