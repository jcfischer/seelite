/**
 * What a station bay's frame is actually made of — node #242.
 *
 *   npm run dev                              # in one shell
 *   node scripts/measure-bay-frame-cost.mjs  # in another
 *
 * #242 printed a ratio and attributed none of it: 38.861 ms in
 * `berth-free-look` against 3.740 in `deep-sky`, with every optional term off,
 * and neither of this game's two levers reaching it. This instrument
 * decomposes that number. It is a **diagnosis**, not a gate: it asserts no
 * threshold, prints a table for a receipt, and changes nothing about the bay.
 *
 * **The name is a leftover and is kept on purpose.** What it measured is that
 * the bay is not the subject: the same framing in open space, with no station
 * within a thousand kilometres, costs the same, and the whole of §13.1's
 * interior is 2.0 ms of 40.3. Renaming the file would lose the thread from
 * #242's title to the answer, which is that the question named the wrong room.
 *
 * ## The design is `measure-occlusion-cost.mjs`'s, deliberately
 *
 * Headed and refusing a software rasteriser (#98 — the same scene runs 16.8 fps
 * headless and 371 headed on an M1 Pro); one page, one camera, one clock, the
 * term toggled **in place** between blocks; blocks interleaved and shuffled
 * from a printed seed, because a fixed arm order confounds thermal drift with
 * the arm perfectly and once turned a coin toss into a reported 144/144; the
 * median block reported; a Mann-Whitney pairing count beside every delta. Every
 * one of those was paid for by a wrong answer, and the arguments are written
 * out in that file rather than repeated here.
 *
 * Three things it adds, because #242's question is different from #201's.
 *
 * ## It reads three clocks, and one of them is wrong
 *
 * Every figure #242 and #222 quote is `performance.now()` around `render()`
 * with a `readPixels` drain, which **serialises** CPU submission and GPU
 * execution into one number. #223's `src/frame-attribution.ts` separates them
 * through `EXT_disjoint_timer_query_webgl2`, so section A reads it — and #242's
 * "the instrument that would decompose it does not exist" looked half wrong in
 * our favour, because the sampler existed and only the comparison did not.
 *
 * **It was not half wrong, and this is a finding rather than a caveat.** The
 * timer query reports 118 ms at the bay and 145 ms (p95 185) at the open-space
 * planet, with `status: "supported"`. Two independent wall-clock readings
 * disagree with it by three to four times and agree with each other to within a
 * few percent: the arms below, and the live rAF period column, which is the
 * cadence the player actually gets. So the GPU medians are printed and **not
 * used**, and the decomposition rests on the arms alone. A diagnostic that
 * reports a number it cannot have, under a status that says it is fine, is the
 * class `CLAUDE.md` already carries several of; naming it is this node's, fixing
 * it is not.
 *
 * The CPU submission column survives that, and it is the one that disposes of
 * #242's candidate 2 on its own: 2.45 ms of a 40 ms bay frame.
 *
 * ## It sweeps the drawing buffer, because #242 says to
 *
 * "A statement of whether the cost is fill-rate bound, because that decides
 * whether #225 reaches the bay at all. Sweeping the drawing buffer is the test,
 * not an assertion about slabs." `renderScale` is a shipped player setting with
 * three allowed values, so the sweep is the dial the player has and not a
 * fixture. Milliseconds linear in the pixel count at the bay and not at
 * deep-sky is fill-rate bound; flat is not, and resolution is then not the
 * lever. Measured: linear to a floor of 0.6–0.7 ms out of 40, so 98% of the
 * bay frame scales with pixels and #225 reaches it.
 *
 * ## The subject arms, and the one #242 does not list
 *
 * `berth-free-look` is the **chase** camera behind a ship parked nose-out, so
 * it looks down the bay and through the aperture. A station orbits its planet
 * at 400–2,000 km (`system.ts`), so what is framed through that hole is a
 * planet subtending most of the sky — drawn by `planet-surface.ts`'s
 * `ShaderMaterial` in the far or approach **layer**, which is its own render
 * pass with its own depth buffer. So the station hull in front of it rejects
 * none of its fragments: an occluded planet is shaded in full and then
 * composited away. That candidate is absent from #242's five and it is the one
 * `main.ts:878` already asserts without measuring ("this game is fill-rate
 * bound — a planet filling the view costs its surface shader per pixel"). It
 * is 86.6% of the bay's frame, and 92.7% of what it draws there is never seen.
 *
 * **An angular radius is not a frustum test, and the run says so twice.**
 * `cockpit-arrival` frames the *same* planet at the *same* 41.8° half-angle and
 * hiding it saves nothing — because it is behind the camera, which is why that
 * arm's draw-call count does not move either. The inventory column prints
 * coverage because coverage is what a cost is proportional to *once a body is
 * in frame*; whether it is in frame is what the `calls` column says. Reading
 * the first without the second is how "same size, different cost" becomes a
 * mystery instead of a cull.
 *
 * Arms are by **subject class**, hidden wherever the distance rule has put them
 * (#15), never by scene: a body's layer is its distance, so an arm keyed on a
 * scene would name a different set of objects at each framing.
 *
 * **`visible` on the two player roots cannot be used**, and `probe-occlusion.mjs`
 * paid a wrong answer to learn it: `Game.render` rewrites `shipMesh.visible`
 * and `cockpit.mesh.visible` from the view on every frame, so a flag set here
 * is gone before the frame it was meant to change. Their *children* are
 * nothing `render` touches. Body meshes are not rewritten — `grep -nE
 * '\.visible\s*=' src/main.ts` returns five lines and none of them is a body —
 * so those are set directly, and the instrument verifies the hide landed by
 * reading `renderer.calls` back per arm rather than trusting it.
 */
import { GAME_TIME_S, SEED, VIEWPORT } from "./lib/view-set.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
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

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";

/** `measure-occlusion-cost.mjs`'s figures: long enough that the end-of-block
 *  sync is under a percent of the block, and enough blocks that one bad one
 *  cannot carry a median. */
const FRAMES = 120;
const BLOCKS = 12;
/** Fewer for the resolution sweep: it is answering whether a curve is linear
 *  over a 4:1 range, not separating a sub-millisecond term. */
const SWEEP_BLOCKS = 5;

/**
 * Every arm, as an in-page hide. Each returns the list it hid so the caller
 * restores exactly what it changed and nothing else.
 *
 * `null` is the control. It is an arm rather than an absence so that the
 * control runs *inside* the shuffle beside every other arm, on the same
 * schedule and the same thermal drift — a control taken once before the loop
 * is a control taken on a cold machine.
 */
const ARMS = [
	{ name: "control", hide: null },
	{
		name: "no bodies",
		hide: "massive",
		what: "every star, planet and moon, in whichever layer its distance put it",
	},
	{
		name: "no stations",
		hide: "stations",
		what: "every station body mesh — hull, aperture, greebles and interior together",
	},
	{
		name: "no interior",
		hide: "station-interior",
		what: "§13.1's bay: its slabs, berths and fittings, leaving the hull",
	},
	{
		name: "no greebles",
		hide: "greebles",
		what: "the station's surface fixtures",
	},
	{
		name: "no player",
		hide: "player",
		what: "the hull in chase and the cabin in cockpit — the subject at a fixed range",
	},
];

/**
 * Time one block at one arm, and report what was actually drawn.
 *
 * The wall-clock `ms` is the same serialised CPU+GPU figure #242 quotes, kept
 * so the rows are comparable with its table. `calls` and `triangles` are read
 * back **per arm** because they are the check that the hide reached the
 * renderer: an arm whose draw-call count equals the control's hid nothing, and
 * a hide that silently no-ops reads exactly like a term that costs nothing.
 */
const timed = (page, arm, frames) =>
	page.evaluate(
		([how, n]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			const hidden = [];
			const conceal = (object) => {
				hidden.push([object, object.visible]);
				object.visible = false;
			};
			if (how === "player")
				// Children, not the roots: `render` rewrites both roots' `visible`
				// from the view every frame.
				for (const root of [g.shipMesh, g.cockpit?.mesh]) {
					if (!root) continue;
					for (const child of root.children) conceal(child);
				}
			if (how === "massive" || how === "stations") {
				const want =
					how === "stations" ? ["station"] : ["star", "planet", "moon"];
				for (const body of g.world.system.bodies) {
					if (!want.includes(body.kind)) continue;
					for (const scene of [g.farScene, g.approachScene, g.nearScene]) {
						const mesh = scene.getObjectByName(body.id);
						if (mesh) conceal(mesh);
					}
				}
			}
			if (how?.startsWith("body:")) {
				const id = how.slice(5);
				for (const scene of [g.farScene, g.approachScene, g.nearScene]) {
					const mesh = scene.getObjectByName(id);
					if (mesh) conceal(mesh);
				}
			}
			if (how === "station-interior" || how === "greebles")
				for (const scene of [g.farScene, g.approachScene, g.nearScene])
					scene.traverse((object) => {
						if (object.name === how) conceal(object);
					});

			const sync = new Uint8Array(4);
			// **`renderer.info` is reset by every `render`, so it must be read from
			// a frame drawn with the counter pinned.** The first version read it
			// after the timed block and every arm reported one call and one
			// triangle — the value left by the composer's last full-screen pass.
			// A dead check reads exactly like a passing one, which is the whole
			// reason the count is here.
			const wasAuto = g.renderer.info.autoReset;
			g.renderer.info.autoReset = false;
			g.renderer.info.reset();
			g.render(0);
			const info = g.renderer.info.render;
			const drawn = { calls: info.calls, triangles: info.triangles };
			g.renderer.info.autoReset = wasAuto;
			// Drain the warm frame before the clock starts. `render` only queues;
			// the trailing `readPixels` blocks until everything outstanding has
			// been drawn, so without this the warm frame's GPU work lands inside
			// the timed interval — which is proportional to the arm's own cost,
			// so equal warm-up counts do not cancel it (#241).
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const started = performance.now();
			for (let i = 0; i < n; i++) g.render(0);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
			const ms = (performance.now() - started) / n;

			for (const [object, was] of hidden) object.visible = was;
			return { ms, hid: hidden.length, ...drawn };
		},
		[arm.hide, frames],
	);

/**
 * One CPU/GPU split at the current framing, from the live sampler.
 *
 * The sampler is enabled and disabled around the reading rather than left on:
 * `enableFrameAttribution` flips `renderer.info.autoReset` off, which the
 * timed blocks above read back per arm, and a diagnostic that changes the
 * counters it is being compared against is the co-ownership `main.ts` refuses
 * elsewhere.
 *
 * It is sampled over frames driven here rather than over whatever the live loop
 * happened to do, so the two framings' splits are taken over the same count.
 * Timer queries resolve a frame or two late by construction — the sampler reads
 * only what `QUERY_RESULT_AVAILABLE` says is ready — so the warm frames are not
 * optional and the reported `sampleCount` says how many landed.
 */
const split = async (page, frames) => {
	return page.evaluate(async (n) => {
		const g = window.__seelite;
		await g.enableFrameAttribution();
		// **The live loop's own wall-clock cadence, beside the GPU figure.** The
		// arms below drive `g.render(0)` in a tight loop, which is not the loop
		// the player is in: a rAF frame also steps the sim, rasterises the
		// consoles and the scanner, and waits on the compositor. Without this
		// column a GPU median that disagrees with the arms' wall clock has no
		// third number to say which of the two it belongs to, and the first run
		// of this instrument produced exactly that — 118 ms against 40.
		const marks = [];
		let last = null;
		for (let i = 0; i < n; i++)
			await new Promise((r) =>
				requestAnimationFrame((t) => {
					if (last !== null) marks.push(t - last);
					last = t;
					r();
				}),
			);
		const s = g.attributionSnapshot();
		g.disableFrameAttribution();
		const sorted = marks.sort((a, b) => a - b);
		return { ...s, framePeriodMs: sorted[sorted.length >> 1] ?? null };
	}, frames);
};

/**
 * What is in front of the camera, and how much sky each thing covers.
 *
 * The arms below say *which subject* costs the frame; this says **why that is
 * the subject** — a body's cost is its covered pixels, so the number that
 * explains a row is the angular radius and not the distance. Reported for every
 * massive body at every framing rather than for the one that wins, because a
 * body that covers nothing and still costs is a different finding from one that
 * fills the sky, and only the pair of columns tells them apart.
 *
 * `layer` comes from which scene actually holds the mesh rather than from the
 * distance rule restated here (#15): a second copy of `massiveLayerFor` is a
 * copy that drifts, and what the frame cost depends on is where the object is,
 * not where a rule says it should be.
 */
const bodies = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		const cam = g.world.ship.pos;
		const scenes = {
			far: g.farScene,
			approach: g.approachScene,
			near: g.nearScene,
		};
		return g.world.system.bodies
			.filter((b) => b.kind !== "station" && b.kind !== "ship")
			.map((b) => {
				const d = Math.hypot(b.pos.x - cam.x, b.pos.y - cam.y, b.pos.z - cam.z);
				const layer =
					Object.entries(scenes).find(([, s]) =>
						s.getObjectByName(b.id),
					)?.[0] ?? null;
				return {
					id: b.id,
					kind: b.kind,
					layer,
					distanceKm: d,
					radiusKm: b.radiusKm,
					// Half-angle subtended, in degrees. A camera's vertical field of
					// view is 60°, so anything past 30 here fills the frame.
					angularRadiusDeg:
						(Math.asin(Math.min(1, b.radiusKm / d)) * 180) / Math.PI,
				};
			})
			.sort((a, b) => b.angularRadiusDeg - a.angularRadiusDeg);
	});

/**
 * How much of the planet the station's own structure stands in front of.
 *
 * **The frame cost does not depend on this and the fix does**, which is why it
 * is measured separately from every arm above. The planet is drawn in the
 * approach layer's own pass with its own depth buffer, so the near-layer hull
 * rejects none of its fragments however much of the disc it covers: the arms
 * price the planet in full either way. What this number decides is *which*
 * existing node absorbs the cost. A disc the bay's wall hides almost all of
 * wants near-layer depth carried into the approach pass — #219's restructure,
 * reached from a different direction. A disc mostly visible through the mouth
 * wants the surface shader cheaper, which is #207, #217 and #224's ground.
 *
 * Two frames, one camera, nothing timed: the near scene shown, then hidden, and
 * the planet-only pixels counted in each. **Hidden by its children and not by
 * the roots**, for `probe-occlusion.mjs`'s reason — `render` rewrites the two
 * player roots' `visible` from the view every frame — and the station bodies by
 * their meshes, which `render` does not touch.
 *
 * The mask is "a pixel that changes when the planet alone is hidden", taken
 * against a same-frame control rather than against a colour threshold: a
 * threshold has to name a brightness, and a planet's terminator crosses every
 * brightness there is.
 */
const apertureFraction = (page) =>
	page.evaluate(async (planetId) => {
		const g = window.__seelite;
		const gl = g.renderer.getContext();
		const w = g.renderer.domElement.width;
		const h = g.renderer.domElement.height;
		const shot = () => {
			g.render(0);
			const buf = new Uint8Array(w * h * 4);
			gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
			return buf;
		};
		const hidden = [];
		const conceal = (o) => {
			hidden.push([o, o.visible]);
			o.visible = false;
		};
		const planet = [g.farScene, g.approachScene, g.nearScene]
			.map((s) => s.getObjectByName(planetId))
			.filter(Boolean);

		// 1. Everything, and everything but the planet: the difference is the
		//    disc as the player sees it, occlusion included.
		const withAll = shot();
		for (const m of planet) conceal(m);
		const withoutPlanet = shot();
		for (const [o, was] of hidden) o.visible = was;
		hidden.length = 0;

		// 2. The same pair with every near-layer subject gone: the difference is
		//    the whole disc, nothing standing in front of it.
		for (const body of g.world.system.bodies)
			if (body.kind === "station")
				for (const s of [g.farScene, g.approachScene, g.nearScene]) {
					const m = s.getObjectByName(body.id);
					if (m) conceal(m);
				}
		for (const root of [g.shipMesh, g.cockpit?.mesh])
			if (root) for (const child of root.children) conceal(child);
		const bareAll = shot();
		for (const m of planet) conceal(m);
		const bareWithout = shot();
		for (const [o, was] of hidden) o.visible = was;
		g.render(0);

		const differing = (a, b) => {
			let n = 0;
			// 24/255 is `probe-occlusion.mjs`'s threshold, kept so a reader who
			// knows one number knows both. A dither of ±0.5/255 is far below it.
			for (let i = 0; i < a.length; i += 4)
				if (
					Math.abs(a[i] - b[i]) > 24 ||
					Math.abs(a[i + 1] - b[i + 1]) > 24 ||
					Math.abs(a[i + 2] - b[i + 2]) > 24
				)
					n++;
			return n;
		};
		const visible = differing(withAll, withoutPlanet);
		const whole = differing(bareAll, bareWithout);
		return { visible, whole, pixels: w * h };
	}, "planet-4");

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/frame-attribution.ts",
	"src/station-interior-mesh.ts",
]);
const browser = await launchChromium({ headless: false });
// `deviceScaleFactor: 2` because #242's table was taken there and the machine
// this targets has a retina panel: at the default the buffer is a quarter of
// the player's, which is the whole of any fill-rate term.
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(`${origin}/?seed=${SEED}`);
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "decompose a bay frame");
await page.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
await page.evaluate(() => window.__rememberBootPosition());

// **`deepSky` first, and the ordering is load-bearing**: its placement returns
// the ship to where it booted, which is only knowable before anything has moved
// it. The berth framing leaves the ship docked, so a framing after it would
// re-place from inside a station.
const FRAMINGS = [
	{ name: "sky-only", ...OCCLUSION_FRAMINGS.deepSky },
	{ name: "cockpit-arrival", ...OCCLUSION_FRAMINGS.cockpit },
	{ name: "berth-free-look", ...OCCLUSION_FRAMINGS.berth },
	/**
	 * **The control that decides whether this node is about a bay at all.**
	 *
	 * Not on the canonical view set and not meant to be: it is not a frame
	 * anybody is asked to judge, it is the arm that separates two explanations
	 * of the same number. If the bay's cost is the bay — its slabs, its berths,
	 * its enclosure — then standing in open space at the same range from the
	 * same planet is cheap. If it is the planet, this framing costs the same
	 * 40 ms with no station within a thousand kilometres, and every sentence
	 * about five `DoubleSide` slabs is answering a question nothing asked.
	 *
	 * 1.5 radii is read off the bay's own inventory row rather than chosen:
	 * `berth-free-look` sits 6,729 km from a 4,487 km planet, and a control at
	 * a different range would be comparing two coverages as well as two rooms.
	 * 60° of sun angle so the terminator is in frame — a fully-lit disc and a
	 * silhouette shade different numbers of pixels through the same shader.
	 */
	{
		name: "planet-fill (open space, no station)",
		view: "cockpit",
		/**
		 * **Last, and it leaves the dock itself.** Every other framing here is
		 * order-independent; this one is not, twice over. Run before the berth
		 * it would leave the ship somewhere `__parkInBerth` overshoots from —
		 * measured: it reached `docked` where the framing asked for `arriving`,
		 * and the run died three framings in. Run after it without launching,
		 * `__placeShipAt` is undone on the next tick, because a docked session
		 * re-places the ship every frame (§12.6 obligation 9) — the same trap
		 * `view-placement.mjs` documents at the top of `__parkInBerth`.
		 */
		place: (page) =>
			page.evaluate(async () => {
				const g = window.__seelite;
				const dt = 1 / 60;
				for (let i = 0; i < 60 * 60 && g.dockPhase !== "flying"; i++) {
					if (g.dockPhase === "docked") g.launch();
					g.skipDockTraversal();
					g.step(dt);
				}
				if (g.dockPhase !== "flying")
					throw new Error(
						`planet-fill: could not leave the dock (${g.dockPhase})`,
					);
				await window.__sunOffset("planet-4", 1.5, 60);
			}),
	},
];

const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20260905);
const shuffled = seededShuffler(ORDER_SEED);
const SCALES = [1, 0.75, 0.5];

console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}`,
);
console.log(
	`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`,
);
// **The settings row is printed, not assumed.** The arms are subjects rather
// than terms, so every optional term is inside all of them equally and cancels
// — but the *absolute* milliseconds are only comparable with another table if
// that table's settings are known, and this instrument reads whatever the
// machine has stored rather than a default it could name here. #242's table
// says "aa 0, occl off" and this run's `sky-only` reads less than half of it;
// without this line there is no way to tell a settings difference from a
// mystery.
const settings = await page.evaluate(() => ({
	...window.__seelite.settings.value,
}));
console.log(
	`  settings as stored on this machine: ${JSON.stringify(settings)}`,
);
console.log(
	"  every optional term is left where the build puts it; the arms are subjects, not terms, so it cancels within a framing.",
);

for (const framing of FRAMINGS) {
	await setView(page, framing.view);
	await framing.place(page);
	await setView(page, framing.view);
	await settleFrames(page);

	console.log(`\n\n  ${framing.name} (${framing.view})`);

	// ## A — the split, before anything is toggled
	const s = await split(page, 180);
	if (!s)
		console.log("  attribution: the sampler did not come up on this page");
	else {
		const gpu = s.gpu;
		const sub = s.cpu["render submission/composer"];
		const step = s.cpu["simulation/step"];
		console.log(
			`  GPU ${gpu.status}: median ${gpu.medianMs?.toFixed(3) ?? "—"} ms, ` +
				`p95 ${gpu.p95Ms?.toFixed(3) ?? "—"}, n ${gpu.sampleCount}`,
		);
		console.log(
			`  CPU submission: median ${sub.medianMs?.toFixed(3) ?? "—"} ms, ` +
				`n ${sub.sampleCount}   |   sim step: ${step.medianMs?.toFixed(3) ?? "—"} ms`,
		);
		console.log(
			`  live rAF period: median ${s.framePeriodMs?.toFixed(3) ?? "—"} ms ` +
				`(${s.framePeriodMs ? (1000 / s.framePeriodMs).toFixed(1) : "—"} fps) ` +
				"— the loop the player is in, vsync included",
		);
		const r = s.renderer;
		console.log(
			`  drawing buffer ${r.drawingBufferWidth}x${r.drawingBufferHeight} ` +
				`(ratio ${r.effectivePixelRatio}, renderScale ${r.renderScale}), ` +
				`${r.calls} calls, ${r.triangles} triangles, ` +
				`${r.programs} programs, ${r.composerPassCount} passes`,
		);
	}

	// ## A2 — what is actually in frame, which is what makes an arm legible
	const inventory = await bodies(page);
	console.log("\n  massive bodies, by how much sky they cover");
	for (const b of inventory)
		console.log(
			`    ${b.id.padEnd(22)} ${b.kind.padEnd(7)} ${String(b.layer).padEnd(9)} ` +
				`r ${b.radiusKm.toFixed(0)} km at ${b.distanceKm.toFixed(0)} km ` +
				`= ${b.angularRadiusDeg.toFixed(2)}° half-angle`,
		);

	// ## A3 — how much of the disc the near layer stands in front of.
	//
	// Pixels, not milliseconds, and it does not join the timed blocks: it is the
	// number that says which existing node the cost belongs to, not part of the
	// decomposition. Run at every framing so the bay's figure has the open-space
	// one beside it — a fraction with nothing to compare it against is a number
	// a reader has to take on trust.
	const mask = await apertureFraction(page);
	console.log(
		`\n  planet-4 pixels: ${mask.visible} visible, ${mask.whole} with the near layer gone ` +
			`(${mask.whole ? ((mask.visible / mask.whole) * 100).toFixed(1) : "—"}% of the disc shows), ` +
			`frame ${mask.pixels}`,
	);

	// ## B — the subject arms, plus one per massive body.
	//
	// The per-body arms are built here rather than declared with the rest
	// because which bodies exist is a property of the seed, and a hard-coded
	// list would go quietly empty on any other one.
	const framingArms = [
		...ARMS,
		...inventory.map((b) => ({
			name: `no ${b.id}`,
			hide: `body:${b.id}`,
			what: `one body, ${b.angularRadiusDeg.toFixed(2)}° half-angle`,
		})),
	];
	const arms = new Map(framingArms.map((a) => [a.name, []]));
	const drawn = new Map();
	const thunks = framingArms.map((arm) => async () => {
		const r = await timed(page, arm, FRAMES);
		arms.get(arm.name).push(r.ms);
		drawn.set(arm.name, r);
	});
	for (let i = 0; i < BLOCKS; i++) for (const t of shuffled(thunks)) await t();

	const base = median(arms.get("control"));
	console.log(`\n  subject arms — whole-frame ms, control ${base.toFixed(3)}`);
	for (const arm of framingArms) {
		const xs = arms.get(arm.name);
		const m = median(xs);
		const d = drawn.get(arm.name);
		if (arm.name === "control") {
			console.log(
				`    ${arm.name.padEnd(26)} ${m.toFixed(3)} ms` +
					`   ${d.calls} calls, ${d.triangles} triangles`,
			);
			continue;
		}
		// A negative delta is the arm being *cheaper* than the control, which is
		// what hiding a subject should do; the sign is kept rather than
		// abs()-ed so an arm that costs more than it saves is visible as one.
		const saved = base - m;
		console.log(
			`    ${arm.name.padEnd(26)} ${m.toFixed(3)} ms   ` +
				`saves ${saved >= 0 ? "+" : ""}${saved.toFixed(3)} ` +
				`(${((saved / base) * 100).toFixed(1)}%)   ` +
				`sep ${separation(arms.get("control"), xs)}   ` +
				`hid ${d.hid} objects, ${d.calls} calls, ${d.triangles} triangles`,
		);
		// The check that the arm is an arm. Equal counts mean the hide reached
		// nothing, and a no-op hide reads exactly like a term that costs nothing.
		if (d.hid === 0)
			console.log(`      ↳ hid nothing here — this row is not evidence`);
	}

	// ## C — the drawing-buffer sweep, which is #242's fill-rate test
	const sweep = new Map(SCALES.map((s) => [s, []]));
	const sweepShape = new Map();
	const sweepThunks = SCALES.map((scale) => async () => {
		await page.evaluate((v) => {
			window.__seelite.settings.set("renderScale", v);
		}, scale);
		await settleFrames(page, 6);
		const r = await timed(page, { hide: null }, FRAMES);
		sweep.get(scale).push(r.ms);
		sweepShape.set(
			scale,
			await page.evaluate(() => {
				const c = window.__seelite.renderer.domElement;
				return { w: c.width, h: c.height };
			}),
		);
	});
	for (let i = 0; i < SWEEP_BLOCKS; i++)
		for (const t of shuffled(sweepThunks)) await t();
	await page.evaluate(() => {
		window.__seelite.settings.set("renderScale", 1);
	});
	await settleFrames(page, 6);

	console.log("\n  resolution sweep — ms against pixel count");
	const full = median(sweep.get(1));
	const fullShape = sweepShape.get(1);
	const fullPx = fullShape.w * fullShape.h;
	for (const scale of SCALES) {
		const m = median(sweep.get(scale));
		const shape = sweepShape.get(scale);
		const px = shape.w * shape.h;
		// **Perfectly fill-rate bound predicts ms scaling with the pixel count.**
		// A frame with a fixed per-object cost does not move at all. The residual
		// at the smallest scale is therefore the frame's floor, and it is the
		// number that says whether #225 reaches this framing.
		const predicted = full * (px / fullPx);
		console.log(
			`    scale ${scale.toFixed(2)}  ${shape.w}x${shape.h} ` +
				`(${(px / fullPx).toFixed(3)}x pixels)   ${m.toFixed(3)} ms   ` +
				`pure-fill would be ${predicted.toFixed(3)}   ` +
				`floor ${(m - predicted).toFixed(3)} ms`,
		);
	}
}

await browser.close();
