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
 * interior is 2.12 ms of 40.29. Renaming the file would lose the thread from
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
 * timer query reports 119 ms at the bay and 146 ms (p95 227) at the open-space
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
 * #242's candidate 2 on its own: 1.10 ms of a 40 ms bay frame.
 *
 * ## It sweeps the drawing buffer, because #242 says to
 *
 * "A statement of whether the cost is fill-rate bound, because that decides
 * whether #225 reaches the bay at all. Sweeping the drawing buffer is the test,
 * not an assertion about slabs." `renderScale` is a shipped player setting with
 * three allowed values, so the sweep is the dial the player has and not a
 * fixture. Milliseconds linear in the pixel count at the bay and not at
 * deep-sky is fill-rate bound; flat is not, and resolution is then not the
 * lever.
 *
 * **The fixed cost is the fitted intercept, not the residual**, and the first
 * version of this got that wrong. Under `T(p) = F + k·p` the gap between a
 * measured row and the pure-fill prediction is `F·(1 − p)` rather than `F`, so
 * reading it as the floor understates it by 25% at quarter resolution. The
 * conclusion did not change, which is precisely why the wrong number would have
 * travelled — it was already quoted in a PR body and a `CLAUDE.md` bullet
 * before sage caught it. A least-squares fit over every rung replaces it, with
 * the worst residual printed so a rung that disagrees with the model is visible
 * rather than absorbed.
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
 * is 86.6% of the bay's frame.
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
	flightFraming,
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

/**
 * `--mask-sweep`: the coverage question on its own, over roles and framings.
 *
 * #247 asks whether #242's 4.6% is a property of bays or of *that* bay, and
 * what the fraction is in the framings a player is actually in. That is a
 * different measurement from the rest of this file and it wants a different
 * run. The mask is **deterministic** — two flat colours, a pixel disagrees or
 * it does not — so it needs none of the interleaving, shuffling, blocking or
 * separation counting the timing arms are built out of, and paying for twelve
 * blocks an arm to compute a pixel count that cannot vary would put a sweep
 * over eight framings out of reach.
 *
 * The full run is unchanged and still measures the mask at each of its own four
 * framings; this adds the roles and the ranges it cannot reach, including the
 * one that needs another seed.
 */
const MASK_SWEEP = process.argv.includes("--mask-sweep");

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
	/**
	 * **What the near layer's own drawing costs — one term of a prepass, and not
	 * a bound on one.**
	 *
	 * The tempting claim is that this bounds a depth-only prepass, because such a
	 * pass draws the same geometry with no fragment shading. **It does not**, and
	 * sage blocked the first version of this comment for making it (PR #251).
	 * Subtracting an arm measures work *removed* from passes that already exist.
	 * A prepass is work *added*: its own draw submission, a depth target to bind
	 * and clear, and a depth read in the approach pass for every fragment it
	 * rejects. None of those three is anywhere in this subtraction, so a figure
	 * from it is silent about the two ends that make a prepass a pass.
	 *
	 * What it is good for is the one term it does cover: the geometry and
	 * rasterisation cost of putting the near layer through a pass at all, which
	 * is the part a reader would otherwise guess at. Read it as "this much
	 * geometry, this often", and price the rest by building it — which is the
	 * decision #247 exists to make.
	 *
	 * The usual near-scene caveat applies on top: hiding these also drops the
	 * shadow and ambient-occlusion work they induce and exposes what stood behind
	 * them, so even this term is a net figure.
	 */
	{
		name: "no near layer",
		hide: "near-layer",
		what: "every station and the player together — the ceiling on a depth-only prepass over that layer",
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
/**
 * The one browser-side definition of "what does an arm name", installed once.
 *
 * **Extracted after review.** The timing arms and the coverage mask both need
 * to name the same subjects, and both had their own copy of two non-obvious
 * rules: that a body must be looked for across all three scenes because its
 * layer is its distance (#15), and that the two player roots must be hidden by
 * their *children* because `render` rewrites the roots' `visible` from the view
 * on every frame. Two copies of a rule like that is the two-authoritative-homes
 * problem this repo has in writing — and the failure would be silent, because a
 * mask that named a different set from the arms would still print a percentage.
 *
 * It returns the objects and hides nothing: restoring visibility stays with the
 * caller, which is the half that has to be exception-safe around a render.
 */
const installSubjects = (page) =>
	page.addInitScript(() => {
		window.__baySubjects = (how) => {
			const g = window.__seelite;
			const scenes = [g.farScene, g.approachScene, g.nearScene];
			const inEveryScene = (name) =>
				scenes.map((s) => s.getObjectByName(name)).filter(Boolean);
			const bodiesOfKind = (kinds) =>
				g.world.system.bodies
					.filter((b) => kinds.includes(b.kind))
					.flatMap((b) => inEveryScene(b.id));

			if (how === "player") {
				// Children, not the roots: `render` writes `shipMesh.visible` and
				// `cockpit.mesh.visible` from the view every frame, so a flag set on
				// a root is gone before the frame it was meant to change.
				const out = [];
				for (const root of [g.shipMesh, g.cockpit?.mesh])
					if (root) out.push(...root.children);
				return out;
			}
			if (how === "near-layer")
				return [
					...window.__baySubjects("stations"),
					...window.__baySubjects("player"),
				];
			if (how === "massive") return bodiesOfKind(["star", "planet", "moon"]);
			if (how === "stations") return bodiesOfKind(["station"]);
			if (how?.startsWith("body:")) return inEveryScene(how.slice(5));
			if (how === "station-interior" || how === "greebles") {
				const out = [];
				for (const s of scenes)
					s.traverse((o) => {
						if (o.name === how) out.push(o);
					});
				return out;
			}
			return [];
		};
	});

const timed = (page, arm, frames) =>
	page.evaluate(
		([how, n]) => {
			const g = window.__seelite;
			const gl = g.renderer.getContext();
			const hidden = [];
			for (const object of window.__baySubjects(how)) {
				hidden.push([object, object.visible]);
				object.visible = false;
			}

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
		// **`null` in, `null` out.** `attributionSnapshot()` returns null when the
		// sampler did not come up, and the first version spread it —
		// `{ ...null, framePeriodMs }` is a perfectly truthy object with no `gpu`
		// on it, so the caller's guard against a missing sampler became
		// unreachable *and* the failure it guarded moved from a printed line to a
		// throw one property later, at `s.gpu.status`. Sage read it as dead code,
		// which it was; the repair is the contract rather than the guard.
		if (!s) return null;
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
 * wants near-layer depth carried into the approach pass. A disc mostly visible
 * through the mouth wants the surface shader cheaper, which is #207, #217 and
 * #224's ground.
 *
 * **That is not #219, and an earlier version of this said it was.** #219 is
 * about the multisampled *colour* target the four `RenderPass`es share and
 * three's invalidation of it — resolving the ladder once. It can be satisfied
 * in full while every layer keeps its own depth clear, so it does not address
 * the cost measured here. The two are separate changes to the same ladder, and
 * whoever takes one should know the other is there; saying one *is* the other
 * would have let a reader believe this was already owned.
 *
 * **It does not compare two shaded frames, and the first version did.** That
 * version counted pixels where hiding the planet changed the post-processed
 * image by more than 24/255, which is not a coverage measure and was caught in
 * review: it silently drops every planet pixel whose shaded colour resembles
 * whatever is behind it — the whole dark limb against deep space — and it
 * counts bloom, which spreads a bright disc's light *outside* its own geometry.
 * The denominator was the one it damaged most, and the denominator is what the
 * percentage is made of.
 *
 * What replaces it cannot be fooled by either, because it never looks at what
 * the planet looks like. The body's materials are swapped for a flat unlit
 * colour, the frame is drawn twice with two different flat colours, and a pixel
 * belongs to the disc exactly when those two frames disagree. A shaded pixel
 * that matched its background still differs between red and green; a
 * background pixel is identical in both however bright it is. **Bloom is
 * switched off** for the same reason it was a problem — it is a spatial spread,
 * so it would smear the red/green disagreement past the geometry — and the
 * vignette and dither may stay, because neither can make red equal green.
 *
 * The surface *and* its shells are overridden together: an atmosphere shell is
 * drawn and costs fill, so it is part of the disc this is measuring.
 *
 * Subjects come from `__baySubjects`, the same selector the timing arms use, so
 * "the near layer" means one thing in both. A mask that named a different set
 * from the arms would still print a percentage.
 */
const apertureFraction = (page, subjectId) =>
	page.evaluate(async (planetId) => {
		const g = window.__seelite;
		const gl = g.renderer.getContext();
		const w = g.renderer.domElement.width;
		const h = g.renderer.domElement.height;

		const planet = window.__baySubjects(`body:${planetId}`);
		if (planet.length === 0) return { visible: 0, whole: 0, pixels: w * h };

		// **The flat material is built from a constructor already in the scene,
		// not from the THREE namespace, because the page does not expose one.**
		// The alternative was a handle on `Game` for a single diagnostic caller,
		// which is the production-state-for-one-consumer that `main.ts` refuses
		// by name where the vignette wanted the same thing.
		//
		// A *standard* material driven by `emissive` rather than a basic one:
		// emissive is unlit and constant, so it is flat under any light rig, and
		// station plating is standard (`CLAUDE.md`) so an instance is always
		// there to take the constructor from. Throwing rather than falling back
		// to a threshold — a coverage mask that quietly degrades into the
		// brightness comparison this replaced is worse than one that stops.
		let Standard = null;
		for (const scene of [g.nearScene, g.approachScene, g.farScene]) {
			scene.traverse((o) => {
				if (Standard) return;
				const m = Array.isArray(o.material) ? o.material[0] : o.material;
				if (m?.isMeshStandardMaterial) Standard = m.constructor;
			});
			if (Standard) break;
		}
		if (!Standard)
			throw new Error(
				"apertureFraction: no MeshStandardMaterial in any scene to take a " +
					"constructor from — the coverage mask cannot be built flat",
			);

		// Kept as pairs rather than a Map because a mesh may legitimately carry a
		// material *array*, and restoring the wrong shape is a silently repainted
		// planet that survives the rest of the run.
		const painted = [];
		for (const root of planet)
			root.traverse((o) => {
				if (o.isMesh) painted.push([o, o.material]);
			});
		const flat = new Standard();
		flat.color.setHex(0x000000);
		flat.roughness = 1;
		flat.metalness = 0;
		flat.transparent = false;
		flat.depthWrite = true;
		flat.emissiveIntensity = 1;
		for (const [mesh] of painted) mesh.material = flat;

		const bloom = g.bloom;
		const bloomWas = bloom?.enabled ?? null;
		if (bloom) bloom.enabled = false;

		const shot = (hex) => {
			flat.emissive.setHex(hex);
			g.render(0);
			const buf = new Uint8Array(w * h * 4);
			gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
			return buf;
		};
		// A pixel is the disc exactly when the two flat colours disagree there.
		// No threshold: red against green is a whole channel apart, and every
		// other pixel is bit-identical because nothing else in the frame changed.
		const covered = (a, b) => {
			let n = 0;
			for (let i = 0; i < a.length; i += 4)
				if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2])
					n++;
			return n;
		};

		// 1. As the player sees it, with everything in front of the planet drawn.
		const visible = covered(shot(0xff0000), shot(0x00ff00));

		// 2. The whole disc, with the near layer gone. `stations` and `player`
		//    together are what stands between this camera and the sky.
		const hidden = [];
		for (const how of ["stations", "player"])
			for (const object of window.__baySubjects(how)) {
				hidden.push([object, object.visible]);
				object.visible = false;
			}
		const whole = covered(shot(0xff0000), shot(0x00ff00));

		for (const [object, was] of hidden) object.visible = was;
		for (const [mesh, material] of painted) mesh.material = material;
		flat.dispose();
		if (bloom && bloomWas !== null) bloom.enabled = bloomWas;
		g.render(0);
		return { visible, whole, pixels: w * h };
	}, subjectId);

const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/frame-attribution.ts",
	"src/station-interior-mesh.ts",
]);
const browser = await launchChromium({ headless: false });

/**
 * A booted page on one seed, framed and clocked like every other run here.
 *
 * A function rather than a top-level page because #247's sweep needs two seeds:
 * seed 47 generates a trade station and a shipyard and nothing else
 * (`view-set.mjs`), so a **refinery** — the pad role, and the row that decides
 * whether #242's fraction is about bays at all — is unreachable without seed 2.
 * Re-pinning `SEED` was declined for the reason `view-set.mjs` gives: every
 * other framing here is measured against 47.
 *
 * `deviceScaleFactor: 2` because #242's table was taken there and the machine
 * this targets has a retina panel: at the default the buffer is a quarter of
 * the player's, which is the whole of any fill-rate term.
 */
async function openPage(seed) {
	const p = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
	await installViewPlacement(p);
	await installViewFraming(p);
	await installSubjects(p);
	await p.goto(`${origin}/?seed=${seed}`);
	await bootedGame(p);
	const r = await assertPlayersRenderer(p, "decompose a bay frame");
	await p.evaluate((t) => window.__startClockAt(t), GAME_TIME_S);
	await p.evaluate(() => window.__rememberBootPosition());
	return { page: p, renderer: r };
}

const { page, renderer } = await openPage(SEED);

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

/**
 * #247's sweep: the coverage question over station roles and player framings.
 *
 * Grouped by seed, because the pad role is on another one. Ordering inside a
 * group is load-bearing for the same reason `FRAMINGS` says it is — a berth
 * framing leaves the ship docked, so anything that re-places from open space
 * has to come before one.
 */
const MASK_FRAMINGS = [
	// Seed 47, in the order that keeps the ship out of a dock until it must be.
	{
		name: "open-flight far, cockpit (30 radii)",
		seed: SEED,
		role: "—",
		...flightFraming("planet-4", 30, "cockpit"),
	},
	{
		name: "open-flight mid, cockpit (8 radii)",
		seed: SEED,
		role: "—",
		...flightFraming("planet-4", 8, "cockpit"),
	},
	{
		name: "open-flight close, cockpit (2 radii)",
		seed: SEED,
		role: "—",
		...flightFraming("planet-4", 2, "cockpit"),
	},
	{
		name: "open-flight close, chase (2 radii)",
		seed: SEED,
		role: "—",
		...flightFraming("planet-4", 2, "chase"),
	},
	{
		name: "station-approach, cockpit",
		seed: SEED,
		role: "trade (slot)",
		...OCCLUSION_FRAMINGS.cockpit,
	},
	{
		name: "trade bay, chase",
		seed: SEED,
		role: "trade (slot)",
		...OCCLUSION_FRAMINGS.berth,
	},
	{
		name: "shipyard bay, chase",
		seed: SEED,
		role: "shipyard (slot)",
		...OCCLUSION_FRAMINGS.shipyardBerth,
	},
	// Seed 2, the only one of these with a refinery.
	{
		name: "refinery deck, chase",
		seed: 2,
		role: "refinery (pad)",
		...OCCLUSION_FRAMINGS.refineryCradle,
	},
];

const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20260905);
const shuffled = seededShuffler(ORDER_SEED);
const SCALES = [1, 0.75, 0.5];

/**
 * #247's sweep, and then out — it shares this file's page, mask and subject
 * selector and none of its timing machinery.
 *
 * **The subject is chosen by measurement, not declared.** The full run names
 * `planet-4` because #242 framed it; a sweep across two seeds and eight
 * framings cannot, and a hard-coded id would silently return a zero mask on any
 * row where that body is behind the camera — which reads exactly like a body
 * that is fully occluded. So each framing masks the three widest bodies in its
 * own inventory and takes the one with the largest `whole`: `whole` is the disc
 * with the near layer hidden, so a body out of frame scores zero and a body in
 * frame scores its own coverage. The chosen id is printed on every row.
 */
if (MASK_SWEEP) {
	console.log(`  renderer: ${renderer}`);
	console.log(
		`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2`,
	);
	console.log(
		"  pixels only — the mask is two flat colours and a disagreement, so it is\n" +
			"  deterministic and carries no blocks, no shuffle and no separation count",
	);

	/**
	 * The planet's own cost per frame-full of its pixels, from #248's ladder.
	 *
	 * Used to turn a coverage fraction into a millisecond estimate, and it is an
	 * **estimate rather than a measurement** every time it appears: #248 read it
	 * on `planet-5` at 1.02 radii with the four-tap path at device scale 2, and a
	 * different class, a different relief path or a different seed moves it. What
	 * makes it transferable at all is that the term is fill-rate bound — #248
	 * measured 3.6x between the two pixel ratios for 4x the pixels — so it scales
	 * with covered pixels and not with distance.
	 *
	 * Named here rather than inlined at the print, because a figure carried in
	 * from another node is exactly the kind that gets quoted without its basis.
	 */
	const PLANET_MS_PER_FRAME_OF_PIXELS = 41.0 / 0.94;

	const groups = new Map();
	for (const f of MASK_FRAMINGS) {
		if (!groups.has(f.seed)) groups.set(f.seed, []);
		groups.get(f.seed).push(f);
	}

	const rows = [];
	for (const [seed, framings] of groups) {
		const sweepPage = seed === SEED ? page : (await openPage(seed)).page;
		for (const framing of framings) {
			await setView(sweepPage, framing.view);
			await framing.place(sweepPage);
			await setView(sweepPage, framing.view);
			await settleFrames(sweepPage);

			const inventory = await bodies(sweepPage);
			const widest = inventory
				.slice()
				.sort((a, b) => b.angularRadiusDeg - a.angularRadiusDeg);

			/**
			 * Mask **every** massive body and keep whichever covers most.
			 *
			 * Sorted widest-first only so the printed subject is the interesting
			 * one when several are in frame; the loop does not stop early. An
			 * earlier version masked the three widest, which is a different
			 * measurement wearing the same label: angular size is not direction,
			 * so three bodies behind the camera and a fourth in front of it would
			 * print `none` — "no massive body in the frustum at all" — over a body
			 * nothing had looked at (sage, PR #251, round 2). A row that says there
			 * is no prepass opportunity has to have checked.
			 *
			 * The cost is one mask per body rather than three: two renders and two
			 * `readPixels` each. Seconds on a system's dozen bodies, against a
			 * claim the row cannot otherwise make.
			 */
			const measure = async () => {
				let best = null;
				for (const body of widest) {
					const m = await apertureFraction(sweepPage, body.id);
					if (!best || m.whole > best.mask.whole)
						best = { subject: body, mask: m };
				}
				if (!best) throw new Error(`${framing.name}: no massive body to mask`);
				return { ...best, checked: widest.length };
			};

			rows.push({ ...framing, seed, ...(await measure()) });

			/**
			 * **There is no aimed row, because the game has no such camera.**
			 *
			 * Two framings here come back with nothing in the frustum, and the
			 * obvious answer — turn to face the widest body — is not available to a
			 * player and so is not available to an instrument. `HeadLook` is
			 * `"forward" | "left" | "right"` (`cockpit.ts`): three discrete yaws,
			 * no pitch. In **chase** `cameraRotation` reads `chaseYaw` and ignores
			 * head-look entirely. And a docked or arriving session restores the
			 * docking attitude every tick (§12.6 obligation 9), so setting the
			 * ship's orientation is undone before the next frame.
			 *
			 * The question an aimed row would have answered — does a pad role's
			 * open deck occlude its host the way a bay does — is settled by
			 * `measure-station-host-angle.ts` instead: a refinery has no host
			 * planet by construction, a belt orbit and `parentId: null`, in all
			 * 6,250 of them in that census. That is a claim about hosts and not
			 * about sightlines; what the row below adds is that on this seed in
			 * this framing every body in the system was masked and none covered a
			 * pixel.
			 */
		}
		if (sweepPage !== page) await sweepPage.close();
	}

	console.log(
		`\n  ${"framing".padEnd(40)}${"role".padEnd(17)}${"subject/checked".padEnd(16)}` +
			`${"shows".padStart(8)}${"of frame".padStart(10)}${"hidden".padStart(9)}${"est. saving".padStart(13)}`,
	);
	for (const r of rows) {
		const { visible, whole, pixels } = r.mask;
		// The fraction of the *frame* the near layer stands in front of, which is
		// what a prepass would stop shading. Not `1 − visible/whole`, which is a
		// fraction of the disc and says nothing about how big the disc is.
		const hiddenOfFrame = (whole - visible) / pixels;
		const savingMs = hiddenOfFrame * PLANET_MS_PER_FRAME_OF_PIXELS;
		// A body outside the frustum reads `whole: 0`, which is not the same as a
		// body wholly hidden — and printing 0.0% for both would say the near layer
		// occluded something that was never there.
		const out = whole === 0;
		console.log(
			`  ${r.name.padEnd(40)}${r.role.padEnd(17)}${`${r.subject.id}/${r.checked}`.padEnd(16)}` +
				`${(out ? "none" : `${((visible / whole) * 100).toFixed(1)}%`).padStart(8)}` +
				`${(out ? "—" : `${((whole / pixels) * 100).toFixed(1)}%`).padStart(10)}` +
				`${(out ? "—" : `${(hiddenOfFrame * 100).toFixed(1)}%`).padStart(9)}` +
				`${(out ? "—" : `${savingMs.toFixed(1)} ms`).padStart(13)}`,
		);
	}
	console.log(
		"\n  none       — every massive body in the system masked and none covered a pixel: nothing for a\n" +
			"               prepass to reject here, which is a different thing from a body wholly hidden and\n" +
			"               must not print as 0.0%. The count after the subject says how many were tried\n" +
			"  shows      — how much of that body's disc the player sees, the fraction #242 quotes\n" +
			"  of frame   — how much of the frame the whole disc would be, which is what a fraction is a fraction of\n" +
			"  hidden     — of frame, the part the near layer stands in front of: what a prepass would stop shading\n" +
			"  est. saving— hidden x a planet's cost per frame-full of pixels, 43.6 ms, read off #248's ladder on\n" +
			"               planet-5 at 1.02 radii four-tap and device scale 2. An ESTIMATE and not a measurement:\n" +
			"               another class or relief path moves the per-pixel figure. This is the saving side only:\n" +
			"               what a prepass would COST is not measured anywhere here, and `no near layer` in a full\n" +
			"               run gives one term of it and not a bound (see that arm's own note).",
	);
	await browser.close();
	process.exit(0);
}

console.log(`  renderer: ${renderer}`);
console.log(
	`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, seed ${SEED}`,
);
console.log(
	`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`,
);
// **The settings row is printed, not assumed**, because the absolute
// milliseconds are only comparable with another table if that table's settings
// are known. #242's table says "aa 0, occl off" and this run's `sky-only` reads
// less than half of it; without this line there is no way to tell a settings
// difference from a mystery.
//
// **What it prints is the defaults, not the principal's saved configuration**,
// and an earlier version of this comment claimed the latter — sage caught it.
// `browser.newPage()` opens an isolated context with no persistent profile and
// no `storageState`, so `loadSettings` finds empty storage and falls back to
// every row's `fallback`. That is the right thing for an instrument, because a
// figure is then a property of the build rather than of whoever last moved a
// slider — but it means this line establishes *reproducibility*, not what the
// player has. Reading it as the machine's stored settings would be reading a
// constant as a measurement.
//
// **An earlier version of this comment said the optional terms "cancel", and
// that is false for the near-scene arms.** Sage's HonestOracle lens caught it.
// The shadow map redraws every caster and the ambient occlusion redraws the
// near scene into a normal buffer, so hiding a station or its interior removes
// work from those passes as well as from the main one, and the arm's delta
// contains that induced saving. Leaving the settings unchanged across arms is
// not the same as the terms cancelling.
//
// **A near-scene arm's delta is therefore a net figure and not a bound**, and
// the round after the one that found the induced saving found that too: an
// earlier version of this comment called it an over-estimate of that subject's
// own fill, which only counts the work that *goes away*. Removing opaque
// near-layer geometry also exposes whatever stood behind it, and that work is
// added rather than removed. Neither term is measured here, so `no stations` at
// 2.91 ms and `no interior` at 2.12 are what removing that subject does to the
// frame — which is the honest reading of a subject arm, and enough for the only
// claim made from them, that both are small beside the planet's 34.9.
//
// The planet arm carries neither term: a body in the *approach* layer is
// neither a shadow caster nor an ambient-occlusion subject in the near scene,
// and nothing is behind it to expose. That is the whole reason its fragments
// are never rejected, so the correction and the finding have one cause. Pinning
// the passes off would remove the induced saving and would price a build the
// principal does not play.
const settings = await page.evaluate(() => ({
	...window.__seelite.settings.value,
}));
console.log(
	`  settings this run used (defaults — the context has no stored profile): ${JSON.stringify(settings)}`,
);
console.log(
	"  every optional term is left where the build puts it. A near-scene arm " +
		"(stations, interior, player) therefore also drops that subject's shadow " +
		"and AO work and exposes what stood behind it, so its delta is a net " +
		"figure rather than that subject's own fill; the body arms are in the " +
		"approach layer, where neither pass reaches and nothing is behind.",
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
		// A dash with no reason beside it reads as a missing sampler rather than
		// as a refused one, and the two mean opposite things (#246).
		if (gpu.reason) console.log(`  GPU refused: ${gpu.reason}`);
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
	const mask = await apertureFraction(page, "planet-4");
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
	const rows = SCALES.map((scale) => {
		const shape = sweepShape.get(scale);
		return {
			scale,
			shape,
			ms: median(sweep.get(scale)),
			p: (shape.w * shape.h) / fullPx,
		};
	});
	for (const row of rows)
		console.log(
			`    scale ${row.scale.toFixed(2)}  ${row.shape.w}x${row.shape.h} ` +
				`(${row.p.toFixed(3)}x pixels)   ${row.ms.toFixed(3)} ms   ` +
				`pure-fill would be ${(full * row.p).toFixed(3)}`,
		);

	// **The fixed cost is the model's intercept, and the residual is not it.**
	// Under `T(p) = F + k·p` the difference between a measured row and the
	// pure-fill prediction is `F·(1 − p)`, not `F` — so reading the residual as
	// the floor understates it by a factor of `1 − p`, which at quarter
	// resolution is 25%. The first version of this printed that residual and
	// called it "the frame's floor"; sage caught it, and on the bay's own rows
	// it read 0.695 ms where the model gives 0.927. The fill-rate conclusion
	// survives either way, which is exactly why the wrong number would have
	// travelled: it changed no verdict and would have been quoted as a fact.
	//
	// Fitted across every row rather than solved from two, so a third rung that
	// disagrees shows up in the residuals instead of being invisible.
	const n = rows.length;
	const sp = rows.reduce((a, r) => a + r.p, 0);
	const st = rows.reduce((a, r) => a + r.ms, 0);
	const spp = rows.reduce((a, r) => a + r.p * r.p, 0);
	const spt = rows.reduce((a, r) => a + r.p * r.ms, 0);
	const slope = (n * spt - sp * st) / (n * spp - sp * sp);
	const floor = (st - slope * sp) / n;
	const worst = Math.max(
		...rows.map((r) => Math.abs(r.ms - (floor + slope * r.p))),
	);
	console.log(
		`    least-squares fit over ${n} rungs: floor ${floor.toFixed(3)} ms + ` +
			`${slope.toFixed(3)} ms of fill at full resolution ` +
			`(${((slope / (floor + slope)) * 100).toFixed(1)}% of the frame scales ` +
			`with pixels; worst residual ${worst.toFixed(3)} ms)`,
	);
}

await browser.close();
