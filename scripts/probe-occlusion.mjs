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
import { gameUrl } from "./lib/game-url.mjs";

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
 * being drawn would give, which is the 0.00-something the exterior row prints.
 *
 * **Those readings were #199's rig.** #231's rig B (sun 1.0, hemisphere
 * 3.425) reads the bay at 74.3% here, and `measure-shadow-enclosure.mjs` read
 * 74.4–74.5% at sun 1.0 and 2.0 alike: the figure is saturated, because the
 * shadow covers every bay pixel the sun reaches. So the ceiling moved from 15
 * to 90. It stays a sanity bound: a shadow over the whole frame, sky
 * included, is past it. The floor is unchanged. The sign and the scale-freedom of the bias are pinned
 * exactly in `tests/occlusion.test.ts`, where they are arithmetic; this is the
 * arm that says the arithmetic reached the frame.
 */
const SHADOW_BAND_PCT = { min: 1, max: 90 };

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
			// **The world without the ship**, for #241's ladder. There is always a
			// subject at a fixed distance from the camera — the cabin in cockpit
			// view, the player hull in chase — so the pair's whole-frame reading
			// never falls to zero however far the station is, and what it reports
			// is the near subject rather than the station.
			//
			// **The two roots' own `visible` cannot be used, and the first version
			// of this did.** `Game.render` writes `shipMesh.visible = view ===
			// "chase"` and `cockpit.mesh.visible = view === "cockpit"` on every
			// frame, and `frame()` below renders — so a flag set here was restored
			// before the pixels it was meant to change were read, and the ladder
			// reported hull occlusion as station evidence at twenty times its real
			// size. Their *children* are nothing `render` touches. #233 needed the
			// same column for the same reason.
			if (how === "world-only")
				for (const root of [game.shipMesh, game.cockpit.mesh]) {
					if (!root) continue;
					for (const child of root.children) {
						hidden.push([child, child.visible]);
						child.visible = false;
					}
				}
			// Both scenes: the cabin has its own since #651.
			if (how === "refused-only")
				for (const scene of [game.nearScene, game.cabinScene])
					scene.traverse((object) => {
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

const origin = await guardedOrigin(ORIGIN);
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
await page.goto(gameUrl(origin, { seed: SEED }));
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
	// **What each row asks for, not what is drawn — #241.** This page sits at
	// the arrival point, where the gate is shut, so the two drawn flags are
	// `false` on every arm below and a row that moved nothing would read
	// identically to one that moved both. What is being asked here is whether
	// each row reaches its own term; whether the gate then lets it draw is the
	// boot rows and the ladder further down. The `far`/`approach` suns have no
	// gate in front of them and are read off the scene.
	const read = () => ({
		castShadow: game.occlusionState.wanted.shadows,
		ao: game.occlusionState.wanted.ao,
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
	const light = () => game.shadowSun;
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
 * state it is a way the shadow comes back, so at high lighting an occlusion
 * toggle brings it back.
 *
 * **Not "unfitted", which an earlier version of this claimed.** With subjects
 * present the next render runs `fitShadowCamera`, which fits the projection and
 * clears the flag before the composer draws — and this measures `castShadow`
 * and nothing else, so it could not have evidenced a claim about the rendered
 * shadow either way.
 *
 * The PR claimed the rows could not disagree about the shadow. They can, and a
 * check that asserted only the `ao` half could not have said so. So this is
 * *printed* rather than asserted: the behaviour is #233's to change, and a row
 * demanding it stay would be a check against its own fix.
 */
const resurrect = await page.evaluate(() => {
	const game = window.__seelite;
	const kept = {
		quality: game.settings.value.quality,
		ao: game.settings.value.ao,
	};
	const light = () => game.shadowSun;
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
// **Printed, not asserted, and the difference matters.** Requiring
// `beforeToggle === false && afterToggle === true` would make #233's defect the
// passing condition: the day the restore works, `beforeToggle` is true and this
// row goes red for the fix. A check that a deferred bug must still be present is
// a check against repairing it.
console.log(
	`  coupling  castShadow ${resurrect.beforeToggle} before an occlusion toggle at high, ${resurrect.afterToggle} after`,
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
	await writer.goto(gameUrl(origin, { seed: SEED }));
	await bootedGame(writer);
	await writer.evaluate((want) => {
		const store = window.__seelite.settings;
		for (const [key, value] of Object.entries(want)) store.set(key, value);
	}, settings);
	await writer.close();
	const reader = await context.newPage();
	t.watch(reader);
	await reader.goto(gameUrl(origin, { seed: SEED }));
	await bootedGame(reader);
	const read = await reader.evaluate(() => {
		const game = window.__seelite;
		return {
			quality: game.settings.value.quality,
			aoRow: game.settings.value.ao,
			// **What each row asked for, and what is actually drawn — #241 made
			// those two different things.** A boot happens at the arrival point,
			// where the gate is shut, so both drawn flags are `false` whatever
			// the rows say. Asserting the drawn flags alone would make a saved
			// `high` and a saved `low` indistinguishable here and retire the arm
			// that caught #201's boot bug twice; asserting the rows alone would
			// pass on a build that had lost the gate. Both, and they are checked
			// separately.
			wanted: game.occlusionState.wanted,
			gateOpen: game.occlusionState.open,
			castShadow: !!game.shadowSun?.castShadow,
			ao: game.gtaoPass?.enabled ?? null,
		};
	});
	await reader.close();
	return read;
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
	"a saved low quality boots asking for no shadow, and does not take the occlusion with it",
	coldLowOn.quality === "low" &&
		coldLowOn.aoRow === "on" &&
		!coldLowOn.wanted.shadows &&
		coldLowOn.wanted.ao === true,
	`booted ${coldLowOn.quality}/${coldLowOn.aoRow} asking for shadow ${coldLowOn.wanted.shadows} and ao ${coldLowOn.wanted.ao}`,
);

const coldHighOff = await coldBootAt({ quality: "high", ao: "off" });
t.check(
	"and a saved high quality boots asking for the shadow, without turning the occlusion back on",
	coldHighOff.quality === "high" &&
		coldHighOff.aoRow === "off" &&
		coldHighOff.wanted.shadows &&
		coldHighOff.wanted.ao === false,
	`booted ${coldHighOff.quality}/${coldHighOff.aoRow} asking for shadow ${coldHighOff.wanted.shadows} and ao ${coldHighOff.wanted.ao}`,
);

/**
 * **And neither boot draws anything, because a boot is in open space — #241.**
 *
 * The two arms above establish that each row is read and moves its own term.
 * This is the other half: the arrival point is where the principal measured 40
 * fps, so a `high` boot must *ask* for the shadow and still draw neither pass
 * until something is close enough to be worth them.
 *
 * It reads the two flags rather than the gate's own boolean. Asserting
 * `gateOpen === false` alone would pass on a build whose `applyOcclusion` had
 * dropped the gate from its conjunction — the gate would read shut and both
 * passes would draw. Built red exactly that way.
 */
t.check(
	"and neither boot draws either pass, because a boot is in open space",
	coldHighOff.gateOpen === false &&
		coldHighOff.castShadow === false &&
		coldHighOff.ao === false &&
		coldLowOn.gateOpen === false &&
		coldLowOn.castShadow === false &&
		coldLowOn.ao === false,
	`high/off gate ${coldHighOff.gateOpen} drawing ${coldHighOff.castShadow}/${coldHighOff.ao}; low/on gate ${coldLowOn.gateOpen} drawing ${coldLowOn.castShadow}/${coldLowOn.ao}`,
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

// ---- #241's approach ladder: where the pair starts to be worth its cost ----

/**
 * **What the two passes buy along the approach, printed for the principal.**
 *
 * `OCCLUSION.gate.openRad` decides when they start drawing, and this ladder is
 * what that number is judged against — but it does not *derive* it, and an
 * earlier revision of this comment said it did. `occlusion.ts` carries why:
 * there is no onset on this curve to read a threshold off. So the rungs are
 * flown, what the pair darkens is measured at each on the same threshold-free
 * arithmetic every other row here uses, and the rows below check the curve's
 * shape rather than a floor.
 *
 * The rungs are in station silhouette radii down the aperture axis, which is
 * `cockpit-arrival`'s own axis: it is captured at five of them.
 *
 * **Flown in chase and not in cockpit, and that is the whole reason this
 * measurement was rebuilt.** The first version flew it in cockpit view and
 * reported the pair darkening 4.6% of the frame at *twenty* radii, falling
 * monotonically to nothing — which is not a station at all. It is the cabin:
 * the ambient occlusion darkens 22.5% of a `cockpit-arrival` frame, and a
 * ladder that includes it measures the one subject that is in every frame at
 * the same distance. #233 reached the same wall and answered it the same way,
 * with a world-only column. Chase has no cabin, so what moves across these
 * rungs is the station.
 */
const LADDER_RUNGS = [20, 12, 8, 5, 3, 2, 1.5];

await setView(page, "chase");
const ladder = [];
for (const rung of LADDER_RUNGS) {
	await page.evaluate(
		([id, radii]) =>
			window.__viewAlongAxis(id, window.__radiusOf(id) * radii, {
				comoving: true,
			}),
		[STATION, rung],
	);
	await setView(page, "chase");
	await settleFrames(page);
	// The gate is advanced by the frame loop, and `settleFrames` has just run
	// enough of them for `openFrames` to have been satisfied if it was going to
	// be. Read before `compare`, which pins both passes and would report the pin
	// rather than the gate.
	const state = await page.evaluate(() => window.__seelite.occlusionState);
	const seen = await compare(page, "world-only");
	ladder.push({
		rung,
		open: state.open,
		enclosureRad: state.enclosureRad,
		pairPct: seen.shadow.darkerPct + seen.ao.darkerPct,
	});
}
for (const r of ladder)
	console.log(
		`  ladder — ${String(r.rung).padStart(4)} radii  enclosure ${r.enclosureRad.toFixed(3)} rad  gate ${r.open ? "open" : "shut"}  pair ${r.pairPct.toFixed(3)}% darker`,
	);

/**
 * **There is no cliff on this ladder, and the checks below are shaped by that
 * rather than around it.**
 *
 * It rises smoothly with enclosure and never falls to nothing, because at
 * twenty radii the station is still a small disc and the pass still darkens it.
 * **The seven readings are not repeated here** — `OCCLUSION.gate` in
 * `occlusion.ts` owns them beside the thresholds they are judged against, and
 * this comment carried a stale copy for a round after the world-only mode was
 * fixed, which is the third-copy drift `CLAUDE.md` warns about.
 *
 * So "where does the pair start to read" has no answer a probe can pick, and an
 * earlier draft of this section picked one anyway — a 0.1% floor that every
 * rung cleared, and then a floor that would have had to be set between 2.07 and
 * 5.21 to make the current thresholds come out right. That is the failure
 * `CLAUDE.md` records as a constant tuned until the verdict came out.
 *
 * What is checkable without choosing the trade is the *shape*: the contribution
 * rises with enclosure, the gate follows it in one direction only, and it opens
 * while the station is still outside its own silhouette — which is what makes
 * `berth-arrival` a frame with the passes already on rather than one they pop
 * on during. **Where exactly to put the threshold on that curve is the
 * principal's, on the canonical sheet, and this ladder is what it is read
 * from.**
 */
t.check(
	"what the pair darkens rises as the station closes",
	ladder[ladder.length - 1].pairPct > ladder[0].pairPct * 3,
	ladder.map((r) => `${r.rung}:${r.pairPct.toFixed(2)}%`).join(" "),
);
t.check(
	"the gate never re-closes as the station closes",
	ladder.every((r, i) => i === 0 || !ladder[i - 1].open || r.open),
	ladder.map((r) => `${r.rung}:${r.open ? "open" : "shut"}`).join(" "),
);
t.check(
	"the gate is shut at the far end of the ladder and open at the near end",
	!ladder[0].open && !ladder[1].open && ladder[ladder.length - 1].open,
	`${ladder[0].rung} radii ${ladder[0].open ? "open" : "shut"}, ${ladder[1].rung} ${ladder[1].open ? "open" : "shut"}, ${ladder[ladder.length - 1].rung} ${ladder[ladder.length - 1].open ? "open" : "shut"}`,
);
const opensAt = ladder.find((r) => r.open);
t.check(
	"the gate opens while the station is still outside its own silhouette",
	opensAt !== undefined && opensAt.enclosureRad < Math.PI / 2,
	opensAt
		? `opens at ${opensAt.rung} radii, enclosure ${opensAt.enclosureRad.toFixed(3)} rad against ${(Math.PI / 2).toFixed(3)} inside`
		: "the gate never opened on the ladder",
);

// ---- inside a bay, which is the frame the AO was asked for ----

await setView(page, OCCLUSION_FRAMINGS.berth.view);
await OCCLUSION_FRAMINGS.berth.place(page);
await setView(page, OCCLUSION_FRAMINGS.berth.view);
await settleFrames(page);
const bayGate = await page.evaluate(() => {
	const game = window.__seelite;
	return {
		...game.occlusionState,
		drawnShadow: !!game.shadowSun?.castShadow,
		drawnAo: game.gtaoPass?.enabled ?? null,
	};
});
t.check(
	"the gate is open inside a bay, which is where the pair earns its cost",
	bayGate.open && bayGate.drawnShadow && bayGate.drawnAo,
	`gate ${bayGate.open ? "open" : "shut"}, enclosure ${bayGate.enclosureRad.toFixed(3)} rad, drawing shadow ${bayGate.drawnShadow} and ao ${bayGate.drawnAo}`,
);

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
 * Until #231 the star was one of three terms lighting this game and much the
 * smallest: `LIGHT_RIG` put the sun at 0.2 against a hemisphere at 6.85, so a
 * surface received about 3% of its light along the direction that casts a
 * shadow — and a shadow can only ever subtract the light of the light that
 * casts it. A hemisphere cannot be shadowed at all. Measured then, on that rig,
 * shadow on against off:
 *
 * | framing | pixels darkened | deepest |
 * |---|---|---|
 * | `station-flank` | 0.003% | 3.2/255 |
 * | `cockpit-arrival` | 0.002% | 14.1/255 |
 * | `berth-free-look` | 6.2% | 11.6/255 |
 *
 * #231 moved light into the sun (rig B, 1.0 against 3.425), which made the
 * exterior shadow larger. `scripts/measure-shadow-enclosure.mjs` measures it
 * on its ladder, and the figures this probe prints show it on this build. The
 * exterior rows stay printed, not asserted, for the reason below.
 *
 * The bay is where it reads most, and the reason is geometric: an enclosed
 * room is the one place a hull can put a large fraction of another surface out
 * of the star's line. A floor there is a real check on the whole path — the
 * box, the biases, the caster flags — where the same floor on either other
 * framing would have asserted a term #199's rig did not fund. Whether B's
 * exterior figures earn a floor of their own is not decided here.
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
