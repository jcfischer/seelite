/**
 * Station identity — node #28's spatial tier: `station-types.md` §7 and §9.2,
 * `docking.md` §4 and §9.2.2.
 *
 *   npm run dev                       # in one shell
 *   node scripts/probe-station.mjs    # in another
 *
 * Three things measured here, none of which a headless test can reach — and
 * **the first of them is reported rather than gated.**
 *
 * 1. **How far apart the three silhouettes read, by outline alone.** §7 rests
 *    station identity on the shape a player sees before colour and before any
 *    detail resolves, so the measurement is a *desaturated* one: every frame is
 *    reduced to luminance before anything is compared, and the three
 *    `STATION_COLORS` cannot contribute. Colour differences are the easy way for
 *    this to look healthy while the outlines are identical, which is exactly the
 *    failure §7 is a decision about.
 *
 *    It stopped being an assertion on 2026-08-26, by the principal's decision
 *    while #56's forms were being ranked. The reason is worth keeping, because
 *    the number is still printed and someone will want to re-arm it: a floor on
 *    this metric turns out to be a *design driver*. In one afternoon it produced
 *    a third radiator wing, a pair of forward booms on a gantry and a squared
 *    hull section — none of them chosen for the role, all of them chosen to move
 *    a figure. Forms are ranked on how they look, and a gate that quietly
 *    reshapes them competes with the person doing the ranking.
 *
 *    So the figures are measured and printed at both ranges and asserted at
 *    neither. What is still gated is that each station **is drawn and has a
 *    silhouette at all** — at both ranges — and, **at the near range only**,
 *    that re-measuring one reproduces it. That control is about whether the
 *    measurement works rather than about what it finds, and it is near-range
 *    only because at 60 km the mask is a few dozen pixels and the control is of
 *    the same order as the thing it would be separating. **The figure moved
 *    under #290** — parked it read 0.028, co-moving it reads 0.200-0.300 over
 *    three runs — so the number is not restated here: the run prints it, and
 *    what it means is that at 60 km this metric is near the end of its
 *    usefulness. Why it moved is #120's.
 *
 * 2. **The slot tracks the spin.** Its screen-space orientation advances at the
 *    station's own `spinRpm`, and it is measured twice over:
 *
 *    - at the two spins this world **generated** — 0.91 rpm and 2.95 rpm — which
 *      is the renderer tracking values nothing here chose;
 *    - and at §4's actual **ends**, 0.6 and 3.0 rpm, written onto a station the
 *      way the ship is placed rather than flown. The generated pair does not
 *      reach them: 0.91 sits 13% into [0.6, 3.0], so calling it "both ends" —
 *      which an earlier version of this header did — skipped the slow end
 *      entirely, and the slow end is where the smallest rotation is measured
 *      against the tolerance.
 *
 *    The ends are read off the page (`spinRange`), never restated here.
 *
 * 3. **The assembly obeys the distance rule**, drydock frame and all: near
 *    within `HANDOFF_KM`, far beyond it, read off the page.
 *
 * ## How the silhouette is isolated
 *
 * Not by thresholding the frame — a starfield puts lit pixels everywhere and
 * the station is lit by a sun whose direction depends on where in its orbit it
 * is. Instead each station is measured **twice**, once drawn and once with its
 * mesh hidden, and the silhouette is the set of pixels that changed. That makes
 * the mask exact rather than tuned, and it costs one extra render.
 *
 * The masks are then cropped to their own bounding boxes and resampled to a
 * fixed grid before being compared, so the comparison is of *shape* and not of
 * apparent size: two stations at slightly different ranges, or with different
 * core radii (0.6 km against the refinery's 0.4), would otherwise "differ" for
 * a reason that has nothing to do with their outlines.
 *
 * ## The viewpoint
 *
 * Each station is viewed **along its own aperture axis**, from the same range,
 * because that is the view a docking approach actually has and because it is the
 * one viewpoint defined for all three types. The axis comes off the page
 * (`poseOfStation`) rather than being re-derived here: a probe with its own copy
 * of the rule asserts its own copy.
 */
import {
	bootedGame,
	checkFraming,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/**
 * The fixture requirement is **one system holding all three station types**,
 * each framable and fully lit at docking range — not this particular number.
 *
 * It was `?seed=1` until #118 reshaped the galaxy, after which that system holds
 * only a trade post and a refinery. The re-pick is reproducible rather than a
 * hunt, and the type scan alone is **not** the criterion: of the 40 seeds under
 * 400 whose start system holds three types, most fail
 * `probe-station-visuals.mjs` — the trade post frames small enough that its
 * window grid contributes no measurable pixels. Scan
 * `makeWorld(seed).system.contents.stations` for three distinct types, then run
 * both station probes over the candidates. 54, 59, 96 and 115 pass the visuals
 * probe; 54 is the most reliable across both.
 *
 * Seed 54's system, INEDTE, spins its Coriolis stations at 1.09 and 2.64 rpm —
 * §4's range sampled near both ends without the probe writing a spin itself,
 * which is the second thing this fixture is for. (Seed 1's were 0.91 and 2.95.)
 *
 * #790 correction: the historical noise readings below came from a control
 * that restored the game clock before its second capture. They cannot be
 * attributed solely to rasterisation. Both pairs now retain the pinned clock,
 * and a separate assertion reads their actual timestamps. Thresholds are unchanged.
 *
 * ## Historical 5 km control and its ceiling
 *
 * Trade measured twice against a `1 − IoU ≤ 0.05` ceiling landed red often — on
 * `main` before #118 as well as here, and on every fixture tried. This section
 * used to say the ceiling was deliberately not widened, on the ground that
 * loosening a margin so an unrelated change goes green is how a check stops
 * discriminating. That reasoning is sound and it was being applied to the wrong
 * quantity: the readings were never near what the control exists to separate.
 *
 * Measured over seven runs, the control sits at 0.046–0.064 while the *closest*
 * pair of different stations reads 0.398 — a factor of six. A ceiling at 0.05
 * was not discriminating finely, it was sitting inside its own noise, and it
 * fired on any change that resampled a hull's outline differently. #128 was
 * one: it moved every station's drawn roll by tens of degrees, which is a
 * different picture of the same shape.
 *
 * So the ceiling is 0.12 (see `MAX_CONTROL_DIFFERENCE`), bracketed above the
 * noise and below `MIN_DIFFERENCE`, on the principal's call. The per-seed run
 * table belongs to node #84 ("is probe-station's margin too tight?") and the
 * finer-grid alternative to #120, where they are posted.
 */
const URL = gameUrl(ORIGIN, { seed: 54 }, { override: process.env.PROBE_URL });

/** Where the camera stands, kilometres from the station centre. Far enough that
 *  the shipyard's 1.5 km frame is inside the frame, close enough that the
 *  refinery's 0.4 km drum is hundreds of pixels across. */
const RANGE_KM = 5;

/**
 * The second range, kilometres — where detail has resolved away.
 *
 * 60 km puts a 0.6 km station at about a hundredth of a radian: the window
 * grid, the aperture lights and the frame's struts are all gone, and what is
 * left is an outline of a few hundred pixels. That is the state §7's "before any
 * detail resolves" is about, and a probe that only measured 5 km answered the
 * colour half of the standard and assumed the rest.
 */
const FAR_RANGE_KM = 60;

/** The mask is resampled to this grid before shapes are compared. */
const GRID = 24;

/**
 * The reference figure for how far two silhouettes read apart, as `1 − IoU` on
 * the resampled masks.
 *
 * **Not asserted any more** — see the header. It is kept because the printed
 * comparison means nothing without a scale to read it against, and because this
 * is the number to restore if the gate is ever re-armed.
 *
 * It is only meaningful against the metric's own noise, so the run measures that
 * too, by capturing one station twice (the control below). Measured while it was
 * still a gate, from a **parked** framing: the three pairs came out at about
 * 0.35 (trade/refinery), 0.61 (trade/shipyard) and 0.62 (refinery/shipyard),
 * against a control of 0.02. The closest pair was the two compact types, which
 * is where the identity claim is hardest, and 0.25 left that pair about 40% of
 * headroom while sitting an order of magnitude above the noise.
 *
 * **#290 moved the closest pair and the headroom with it.** Framed co-moving,
 * trade/refinery reads 0.271 rather than 0.35 — 8% above this floor, not 40%.
 * So the figure to restore is not this one: re-arming the gate means
 * re-measuring the spread first, and 0.25 is now close enough to the closest
 * pair that it would be asserting a margin it does not have. What the control
 * itself now reads is `MAX_CONTROL_DIFFERENCE`'s to state, below.
 */
const MIN_DIFFERENCE = 0.25;

/**
 * What re-measuring one station back to back may differ by.
 *
 * Not zero: the clock advances between the two captures, so a boundary cell or
 * two moves on the 24 × 24 grid.
 *
 * **Bracketed, and the two sides are not equally well measured.** Seven
 * consecutive runs at 5 km, **parked**, put the control at 0.046, 0.047, 0.051,
 * 0.053, 0.058, 0.060 and 0.064 — seven samples, and 0.12 sat **1.9×** above
 * the worst of them.
 *
 * **#290 spent most of that headroom, and the figure above is no longer this
 * branch's.** Framed co-moving the same control reads 0.088, 0.088, 0.088 —
 * three samples, not seven — so 0.12 sits **1.35×** above it rather than 1.9×.
 * Still a threshold, and a far steadier one: the parked series was a fresh draw
 * of the drift each run and this one is not. But anyone sizing or re-arming this
 * gate should read 1.35× and three samples, not 1.9× and seven.
 *
 * The upper side is weaker and should be read as such. `MIN_DIFFERENCE` above
 * is this file's own reference for how far two *different* stations must read
 * apart — **0.25**, chosen when the comparison was still a gate — and 0.12 is
 * 2.1× below it. Observed pairs read higher than that (0.398 for the closest
 * pair in one run), but a single unreplicated reading is not the number to
 * divide by, and quoting it would flatter the relaxation this branch wants.
 * Against the declared floor the headroom is 2.1×, not 3.3×.
 *
 * A ceiling with headroom on both sides is a threshold; one sitting inside its
 * own noise, as 0.05 was, is a coin toss.
 *
 * **Raised from 0.05 on the principal's call** (2026-08-29): *"You can relax
 * that requirement a lot. It doesn't matter for gameplay that much."* It is
 * worth being plain about what that trades away, because the file's own header
 * used to argue the other way. This control asks whether the **measurement**
 * works — whether a mask is reproducible at all — and not what it finds; the
 * shape comparison it protects has not been asserted since #56 withdrew it.
 * What a tighter ceiling would buy is early warning of the metric drifting, and
 * what it cost was a red run on changes that had nothing to do with it: #128
 * moved every station's drawn roll by tens of degrees, which resamples a hull's
 * outline differently and moved this figure from about 0.04 to about 0.055
 * without anything becoming less repeatable.
 *
 * `#120` is where the alternative lives — a finer grid, which would cut the
 * quantisation this is measuring rather than tolerate it.
 */
const MAX_CONTROL_DIFFERENCE = 0.12;

/** Tolerance on the measured spin rate, relative. Loose because the station is
 *  also moving along its orbit between the two samples, and because the frame
 *  loop decides when the samples land rather than the probe. */
const SPIN_TOLERANCE = 0.06;

// `checkFraming` is imported rather than written here, and the two tolerances
// it gates on live behind it in `probe-guard.mjs`, which owns them and states
// why. Nothing in this file names them, which is the point. What is local to this probe is
// only that it gates at all, which is #272: its framings landed several degrees
// off the aperture axis at `RANGE_KM` and nothing here could say so. The angles
// are in `FRAMING_TOLERANCE`'s docstring rather than here, because a figure in
// two files is the drift this import exists to end.

await guardedOrigin(ORIGIN);
const browser = await launchChromium();

const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
// `__meshOfBody`, `__placeShipAt` and `__viewAlongAxis`, from the one module
// that owns them. The private copies this replaced are #272's subject; the
// deleted `__meshOfBody` was byte-identical to probe-guard's, and the deleted
// `__placeShipAt` differed by exactly the argument that mattered.
await installViewPlacement(page);
await page.goto(URL, { waitUntil: "load" });
await bootedGame(page);

const setup = await page.evaluate(() => {
	const g = window.__seelite;
	return {
		system: g.world.system.record.name,
		handoffKm: g.units.HANDOFF_KM,
		hysteresis: g.units.HANDOFF_HYSTERESIS,
		stations: g.world.system.contents.stations.map((s) => ({
			id: s.id,
			type: s.type,
			spinRpm: s.spinRpm,
			blackMarket: s.blackMarket,
		})),
	};
});

console.log(
	`\n${setup.system}: ${setup.stations
		.map((s) => `${s.type} (${s.spinRpm.toFixed(2)} rpm)`)
		.join(", ")}\n`,
);

const allThree = new Set(setup.stations.map((s) => s.type)).size === 3;
check(
	"the system holds all three station types",
	allThree,
	setup.stations.map((s) => s.type).join(", "),
);
if (!allThree) {
	await browser.close();
	exit();
}

/**
 * Put the camera on a station's aperture axis at `rangeKm` and look back down
 * it, so the aperture faces the viewer.
 *
 * The ship is placed rather than flown, for `probe-handoff.mjs`'s reason: the
 * distances involved take hours under thrust, and the renderer cannot tell a
 * placed ship from a flown one.
 *
 * **This probe used to own a copy of the placement and of the helper under it,
 * and that is what #272 was.** `installMeshLookup` installed a private
 * `__placeShipAt` taking **one** argument, and this file never called
 * `installViewPlacement` at all — so probe-guard's two-argument version was
 * never in the page. **Nothing was shadowed**, and an earlier draft of this
 * docstring said it was: there is no init-script resolution-order hazard here,
 * only a probe carrying a private copy of a helper it never installed the
 * shared one of. That is why the co-moving default #271 gave `__viewAlongAxis`
 * never reached this file, and why #271's audit of that helper's callers could
 * not see a call site that does not call it.
 *
 * Worse for whoever came next: handing the private copy a velocity was a
 * **silent no-op**, JavaScript discarding the extra argument, and the run came
 * back bit-identical, which reads exactly like a measured null result.
 *
 * Returns the placement's own reading of what it achieved. A placement is a
 * request and the frame loop is free to carry the subject off it, so this is a
 * reading rather than a constant — `__viewAlongAxis`'s docstring carries why it
 * takes two numbers and not one.
 */
async function viewAlongAxis(id, rangeKm) {
	return page.evaluate(
		([bodyId, range]) => window.__viewAlongAxis(bodyId, range),
		[id, rangeKm],
	);
}

/** This probe's `check` bound into the shared gate, so the two call sites read
 *  as one line each. */
const framedWhereItAsked = (label, framing) =>
	checkFraming(check, label, framing);

/**
 * The station's silhouette as a `GRID × GRID` occupancy mask.
 *
 * Two synchronous renders, one with the mesh hidden, differenced in luminance —
 * see the header. Both happen inside one evaluate so no frame can land between
 * them and move the station.
 */
/**
 * Capture one station's silhouette — twice, from a single evaluate, when
 * `repeat` is set.
 *
 * The control needs the *same* station measured twice with nothing at all
 * changed between the two, and two separate evaluates cannot give that: real
 * frames run in the gap, and the sim advances the station along its orbit. That
 * is a genuine change of apparent size, which the crop-and-resample only mostly
 * absorbs — and #56's squared Coriolis, whose mask has long straight edges,
 * absorbs it least. The control read 0.062 against the 0.05 ceiling of the day
 * with nothing unstable — the reading that eventually moved the ceiling rather
 * than the code.
 */
async function silhouette(id, repeat = false) {
	return page.evaluate(
		([bodyId, grid, twice]) => {
			const g = window.__seelite;
			const W = 600;
			const H = 420;
			const src = g.renderer.domElement;
			const scratch = document.createElement("canvas");
			scratch.width = W;
			scratch.height = H;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });

			/** Luminance only: §7's claim is about outline, so colour must not be
			 *  able to carry a pass. */
			const measuredClocks = [];
			const luma = () => {
				measuredClocks.push(g.world.gameTime);
				// Render and read in the same task — a WebGL canvas without
				// `preserveDrawingBuffer` is cleared at the next composite.
				g.render(0);
				ctx.drawImage(src, 0, 0, W, H);
				const d = ctx.getImageData(0, 0, W, H).data;
				const out = new Float32Array(W * H);
				for (let i = 0; i < W * H; i++)
					out[i] =
						0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
				return out;
			};

			const mesh = window.__meshOfBody(bodyId);
			if (!mesh) return { missing: true };
			/**
			 * **Pin the clock across this capture's renders.**
			 *
			 * A station's silhouette is a function of its spin phase whenever the
			 * station is not round about its own axis, and #56's forms are not:
			 * a squared Coriolis turning through 18° between two captures is a
			 * genuinely different outline. The control — one station measured
			 * twice — then read 0.051 against the 0.05 ceiling of the day while
			 * nothing was unstable. Pinning makes every capture in this file comparable to
			 * every other, which is what a shape comparison needs.
			 */
			const savedClock = g.world.gameTime;
			g.world.gameTime = 0;
			try {
				const withIt = luma();
				mesh.visible = false;
				const without = luma();
				mesh.visible = true;

				/**
				 * The changed pixels, and the box around them.
				 *
				 * Anything that moved by more than a nudge between the two frames is
				 * the station: the threshold is on a difference of two renders of the
				 * same scene, so it is not a lighting guess.
				 */
				const maskAndBox = (a, b) => {
					const mask = new Uint8Array(W * H);
					let count = 0;
					let minX = W;
					let maxX = -1;
					let minY = H;
					let maxY = -1;
					for (let i = 0; i < W * H; i++) {
						if (Math.abs(a[i] - b[i]) <= 6) continue;
						mask[i] = 1;
						count++;
						const x = i % W;
						const y = (i / W) | 0;
						if (x < minX) minX = x;
						if (x > maxX) maxX = x;
						if (y < minY) minY = y;
						if (y > maxY) maxY = y;
					}
					return {
						mask,
						count,
						minX,
						minY,
						w: maxX - minX + 1,
						h: maxY - minY + 1,
					};
				};

				/**
				 * Crop to the box and resample, so shapes are compared and apparent
				 * sizes are not.
				 *
				 * Its own function because the index arithmetic here already produced
				 * one silent bug: both cell edges are computed **relative to the box**
				 * and offset once. The first version added `minX` to a value that had
				 * already carried it, sampled a strip well off the station, and scored
				 * every pair at zero — which is also what an empty mask scores, so it
				 * read as a claim about shape rather than as a defect.
				 */
				const resample = (box, grid) => {
					const edge = (i, span) => Math.floor((i * span) / grid);
					const cells = [];
					for (let gy = 0; gy < grid; gy++) {
						for (let gx = 0; gx < grid; gx++) {
							const x0 = edge(gx, box.w);
							const x1 = Math.max(x0 + 1, edge(gx + 1, box.w));
							const y0 = edge(gy, box.h);
							const y1 = Math.max(y0 + 1, edge(gy + 1, box.h));
							let hits = 0;
							let seen = 0;
							for (let y = box.minY + y0; y < Math.min(box.minY + y1, H); y++)
								for (
									let x = box.minX + x0;
									x < Math.min(box.minX + x1, W);
									x++
								) {
									seen++;
									hits += box.mask[y * W + x];
								}
							cells.push(seen > 0 && hits / seen > 0.5 ? 1 : 0);
						}
					}
					return cells;
				};

				const shapeOf = (a, b) => {
					const box = maskAndBox(a, b);
					if (box.count === 0) return { empty: true, W, H };
					return {
						cells: resample(box, grid),
						pixels: box.count,
						box: { w: box.w, h: box.h },
						coverage: box.count / (box.w * box.h),
					};
				};
				const shape = shapeOf(withIt, without);
				if (!twice) return shape;
				// **A second pair of renders, not a second call on the same buffers.**
				//
				// The control is supposed to measure what this metric does when
				// nothing has changed — rasteriser, read-back, threshold and
				// resampling, all of it. Differencing the *same two frames* twice
				// measures a pure function against itself and is identically zero, so
				// the gate could not fail. It was written that way while fixing the
				// opposite problem — two evaluates let real frames run between the
				// captures, which moved the station along its orbit — and the fix
				// overshot into a check that asserts nothing.
				//
				// Rendering again inside one evaluate is the honest middle: the clock
				// is still pinned and no frame lands between, so nothing about the
				// scene changes, but every stage that could be unstable runs twice.
				const withItAgain = luma();
				mesh.visible = false;
				const withoutAgain = luma();
				mesh.visible = true;
				return {
					shape,
					again: shapeOf(withItAgain, withoutAgain),
					measuredClocks,
				};
			} finally {
				mesh.visible = true;
				g.world.gameTime = savedClock;
				g.render(0);
			}
		},
		[id, GRID, repeat],
	);
}

/** Intersection over union on the resampled masks. 1 is identical. */
const iou = (a, b) => {
	let inter = 0;
	let union = 0;
	for (let i = 0; i < a.length; i++) {
		if (a[i] && b[i]) inter++;
		if (a[i] || b[i]) union++;
	}
	return union === 0 ? 1 : inter / union;
};

/**
 * Whether a station is drawn from an approved model rather than a procedural
 * form (node #818: the shipyards). An authored yard keeps its approved shape
 * and paint, so the checks below that a procedural form was built to pass —
 * the 60 km floor and width, the type colour — report it and do not gate it
 * (the principal's ruling, 2026-10-13). Measured across the three forms at
 * 60 km (seeds 54, 3, 2, 19, 9, 11): 10-42 px, and aspect 0.56-1.50 against
 * the trade station's 0.75-1.20 — the Foundry and the Slipway are taller than
 * wide down the axis, so "wider" is not a cue they carry.
 */
const isAuthored = (id) =>
	page.evaluate(
		(bodyId) => !!window.__meshOfBody(bodyId)?.getObjectByName("shipyard-drum"),
		id,
	);

/**
 * Capture all three silhouettes at one range and compare them pairwise.
 *
 * Run at two ranges, because §7's standard has two halves and desaturation only
 * answers one: identity must hold *before colour* and *before detail resolves*.
 * A single close range answers the first and quietly assumes the second.
 */
async function silhouettesAt(rangeKm, floor, gate) {
	// `gate.pairs` asserts the pairwise outline comparison; `gate.control`
	// asserts that re-measuring one station reproduces it. Two flags because
	// they answer different questions and only one of them was relaxed: the
	// control is about whether the *measurement* works at all, which is worth
	// gating even where its subject is not.
	const shapes = new Map();
	/** The control capture, kept beside the map rather than inside it: a type-keyed
	 *  map holding one entry that is not a type makes every consumer filter it
	 *  back out. */
	let control = null;
	for (const station of setup.stations) {
		// Gated on the placement, not on its downstream symptom. #263 read a
		// refinery at 0 lit aperture pixels and that looks like a defect in the
		// form; it was a framing that landed somewhere else, and only a check on
		// the framing itself says so.
		framedWhereItAsked(
			`${rangeKm} km — ${station.type}`,
			await viewAlongAxis(station.id, rangeKm),
		);
		// The trade station is captured *twice from one evaluate*, and the second
		// copy is the control. Two evaluates cannot measure this metric's noise:
		// real frames run in the gap and carry the station along its orbit, which
		// is a genuine change of apparent size rather than instability — and a
		// squared hull's mask, being mostly long straight edges, is where the
		// crop-and-resample absorbs it least.
		const captured = await silhouette(station.id, station.type === "trade");
		const shape = captured.again ? captured.shape : captured;
		if (captured.again) {
			control = captured.again;
			check(
				rangeKm + " km — both control captures use the same pinned clock",
				captured.measuredClocks.length === 4 &&
					captured.measuredClocks.every((t) => t === 0),
				JSON.stringify(captured.measuredClocks),
			);
		}
		const authored = await isAuthored(station.id);
		check(
			`${rangeKm} km — ${station.type}: the station is drawn and has a silhouette`,
			!shape.missing && !shape.empty && (authored || shape.pixels > 20),
			shape.missing
				? "no mesh"
				: shape.empty
					? "no pixels changed"
					: `${shape.pixels} px, box ${shape.box.w}×${shape.box.h}, ` +
						`fill ${(100 * shape.coverage).toFixed(0)}%`,
		);
		if (shape.cells) shapes.set(station.type, shape);
	}

	const types = [...shapes.keys()];
	console.log(
		`\nsilhouettes at ${rangeKm} km, desaturated, ${GRID}×${GRID} after crop:`,
	);
	for (let i = 0; i < types.length; i++) {
		for (let j = i + 1; j < types.length; j++) {
			const difference =
				1 - iou(shapes.get(types[i]).cells, shapes.get(types[j]).cells);
			console.log(
				`  ${types[i]} vs ${types[j]}: 1 − IoU = ${difference.toFixed(3)}`,
			);
			if (gate.pairs)
				check(
					`${rangeKm} km — ${types[i]} and ${types[j]} differ by outline alone`,
					difference > floor,
					`1 − IoU = ${difference.toFixed(3)} (floor ${floor})`,
				);
		}
	}

	const first = shapes.get("trade");
	if (!first?.cells || !control?.cells) {
		// Reported rather than thrown: an empty second capture would otherwise
		// dereference `undefined` inside `iou` and kill the run before a single
		// FAIL line was printed.
		if (gate.control)
			check(
				`${rangeKm} km — re-measuring one station reproduces its silhouette`,
				false,
				"no second silhouette to compare",
			);
	} else {
		const drift = 1 - iou(first.cells, control.cells);
		console.log(
			`  control (trade measured twice): 1 − IoU = ${drift.toFixed(3)}`,
		);
		// Gated only where the shape comparison is, and the far control is the
		// reason the far-range pairwise figures above are reported rather than
		// asserted: a metric whose noise is of the same order as its signal is
		// not evidence, and the honest far-range claim is the extent one below.
		// The figure and the arm it moved under are in the module docstring; it
		// is printed on the line above, and this file has already carried one
		// copy of it into staleness.
		//
		// #790 found that the old "identical scene" claim was false: the clock
		// was restored before the second pair. Those historic far-range readings
		// do not isolate rasteriser noise. The capture now pins all four renders
		// and reports their timestamps, without relaxing the existing gates.
		if (gate.control)
			check(
				`${rangeKm} km — re-measuring one station reproduces its silhouette`,
				drift < MAX_CONTROL_DIFFERENCE,
				`1 − IoU = ${drift.toFixed(3)} (ceiling ${MAX_CONTROL_DIFFERENCE})`,
			);
	}
	return shapes;
}

const near = await silhouettesAt(RANGE_KM, MIN_DIFFERENCE, {
	pairs: false,
	control: true,
});
const far = await silhouettesAt(FAR_RANGE_KM, MIN_DIFFERENCE, {
	pairs: false,
	control: false,
});

/**
 * The half desaturation does not answer: **does it survive range?**
 *
 * At `FAR_RANGE_KM` the shape comparison above is reported and not gated, and
 * deliberately so — the mask is a couple of hundred pixels and the crop-and-
 * resample throws away the cue that actually survives out there, which is
 * **extent**. So the far-range claim is made on the thing a player has at that
 * distance: the shipyard's outboard frame makes it visibly wider than a Coriolis
 * station that is otherwise its twin, and the refinery is squatter than either.
 * That is the procedural yard's cue; an authored yard does not carry it
 * (`isAuthored` above), so for one the width is printed and not gated.
 */
console.log(`\nextent at ${FAR_RANGE_KM} km (the cue that survives range):`);
for (const type of ["trade", "shipyard", "refinery"]) {
	const shape = far.get(type);
	console.log(
		shape
			? `  ${type}: box ${shape.box.w}×${shape.box.h} px, ${shape.pixels} px lit`
			: `  ${type}: not captured`,
	);
}
// Guarded, for the reason the control block gives: a station missing at 60 km
// is never stored, and dereferencing it here would kill the run with a
// TypeError on exactly the run that most needed its checks reported.
const aspect = (t) => {
	const shape = far.get(t);
	return shape ? shape.box.w / shape.box.h : null;
};
const wide = aspect("shipyard");
const narrow = aspect("trade");
const yardAuthored = await isAuthored(
	setup.stations.find((s) => s.type === "shipyard")?.id,
);
if (yardAuthored)
	console.log(
		`  the shipyard is authored: its width is reported, not gated (aspect ${wide?.toFixed(2)} against ${narrow?.toFixed(2)})`,
	);
else
	check(
		`at ${FAR_RANGE_KM} km the shipyard is visibly wider than the trade station`,
		wide !== null && narrow !== null && wide > narrow * 1.5,
		wide === null || narrow === null
			? "a station was not captured at range"
			: `aspect ${wide.toFixed(2)} against ${narrow.toFixed(2)}`,
	);

/**
 * §7's secondary cue, which the renderer must actually apply.
 *
 * The hull is painted `STATION_COLORS[type]`, reached as `body.color`. The
 * headless tier asserts the mesh takes the colour it is given; only the page
 * can say the renderer gives it the right one — and the first version of this
 * build gave it none, so a trade station and a shipyard rendered identically.
 */
console.log("\nper-type colour (§7's secondary cue):");
for (const station of setup.stations) {
	const painted = await page.evaluate(
		([id]) => {
			const g = window.__seelite;
			const mesh = window.__meshOfBody(id);
			const core = mesh?.getObjectByName("core");
			const body = g.world.system.bodies.find((b) => b.id === id);
			return {
				hull: core ? core.material.color.getHex() : null,
				body: body.color,
				authored: !!mesh?.getObjectByName("shipyard-drum"),
			};
		},
		[station.id],
	);
	console.log(
		`  ${station.type}: hull #${(painted.hull ?? 0).toString(16)}, ` +
			`body #${painted.body.toString(16)}`,
	);
	if (painted.authored) {
		console.log(
			`  ${station.type} is authored: its approved paint is not tinted`,
		);
		continue;
	}
	check(
		`${station.type}'s hull is painted its own type's colour`,
		painted.hull === painted.body,
		`hull #${(painted.hull ?? 0).toString(16)} against body #${painted.body.toString(16)}`,
	);
}

/**
 * The slot's screen-space orientation, radians.
 *
 * The aperture group's local +X is the slot's long axis — the side a ship's
 * beam lies along at check 4's zero (#157) — so this projects that axis through
 * the near camera and reports its angle on screen. Pixels rather than NDC, so
 * the viewport's aspect ratio does not shear the angle.
 */
async function slotAngle(id) {
	return page.evaluate(
		([bodyId]) => {
			const g = window.__seelite;
			const mesh = window.__meshOfBody(bodyId);
			const aperture = mesh?.getObjectByName("aperture");
			if (!aperture) return { missing: true };
			g.render(0);
			const origin = aperture.getWorldPosition(g.nearScene.position.clone());
			const tip = aperture.localToWorld(
				g.nearScene.position.clone().set(1, 0, 0),
			);
			const camera = g.nearCamera;
			const a = origin.clone().project(camera);
			const b = tip.clone().project(camera);
			const el = g.renderer.domElement;
			return {
				angle: Math.atan2((b.y - a.y) * el.height, (b.x - a.x) * el.width),
				gameTime: g.world.gameTime,
			};
		},
		[id],
	);
}

/** Signed angular difference, wrapped into (−π, π]. */
const wrap = (d) => {
	const TAU = Math.PI * 2;
	let x = d % TAU;
	if (x > Math.PI) x -= TAU;
	if (x <= -Math.PI) x += TAU;
	return x;
};

/**
 * View a station along its axis, sample the slot's screen angle twice, and
 * report the **signed** rate.
 *
 * One helper for both the spinning and the fixed case: the sequence is the same
 * and only the assertion differs, and a change to how the delta is taken should
 * land in one place.
 */
async function angleRateRadS(id, waitMs, label) {
	// The second placement site, and it gates like the first. Sage found this
	// one ungated: it frames at `RANGE_KM`, which is exactly where #272's red
	// case lived, and a bad landing here falls through to `no aperture in the
	// mesh` — #263's misdiagnosis, a framing failure wearing a form defect's
	// name. So the gate is not redundant here: it is what would catch a landing
	// that carried the aperture off camera.
	//
	// #290's helper swap changed this block's arm: it used to hold the ship at
	// rest across `waitMs`, which at ~30 km/s is some 45 km of relative carry
	// from a 5 km framing, and now it moves with the station. **The rates are
	// unmoved, measured on both** — parked against co-moving, on an expected
	// 0.1141 / 0.2765 / 0.0628 / 0.3142 rad/s: trade 0.1140 against 0.1141,
	// shipyard 0.2765 against 0.2765, slow end 0.0627 against 0.0628, fast end
	// 0.3142 against 0.3142, and the pad 0.0000 rad on both.
	//
	// *Why* they survive 45 km of carry is **not established**. It is not that
	// the angle is camera-independent — `slotAngle` projects through
	// `nearCamera` and is screen-space by construction — and an earlier draft of
	// this comment claimed exactly that.
	framedWhereItAsked(`spin — ${label}`, await viewAlongAxis(id, RANGE_KM));
	const first = await slotAngle(id);
	if (first.missing) return { missing: true };
	await page.waitForTimeout(waitMs);
	const second = await slotAngle(id);
	const dt = second.gameTime - first.gameTime;
	return { rate: wrap(second.angle - first.angle) / dt, dt };
}

console.log("\nspin tracking:");
for (const station of setup.stations) {
	if (station.spinRpm === 0) continue;
	// Long enough to measure, short enough that the fastest station turns well
	// under half a revolution — past π the wrap makes the direction ambiguous.
	const sample = await angleRateRadS(station.id, 1500, `${station.type}`);
	if (sample.missing) {
		check(
			`${station.type}: the slot is drawn`,
			false,
			"no aperture in the mesh",
		);
		continue;
	}

	/**
	 * **Signed**, and that is the point of the sign rather than pedantry.
	 *
	 * `spinner.rotation.z = -pose.phaseRad` would measure identically under an
	 * absolute value and pass, and nothing headless covers the renderer applying
	 * the phase — so a slot rotating the wrong way would reach the player, with
	 * check 4's roll match (`docking.md` §4.2) matched against it.
	 *
	 * The expected sign is `+`: the camera is placed on the aperture axis
	 * looking back down it, so the station's local +Z points at the viewer, and
	 * a positive rotation about a viewer-facing axis reads counter-clockwise —
	 * increasing `atan2` in the y-up frame the angle is measured in.
	 */
	const expected = (2 * Math.PI * station.spinRpm) / 60;
	console.log(
		`  ${station.type} at ${station.spinRpm.toFixed(2)} rpm: ` +
			`${sample.rate.toFixed(4)} rad/s measured, +${expected.toFixed(4)} expected ` +
			`over ${sample.dt.toFixed(2)} s of game time`,
	);
	check(
		`${station.type}'s slot turns at its own ${station.spinRpm.toFixed(2)} rpm, the right way`,
		Math.abs(sample.rate - expected) / expected < SPIN_TOLERANCE,
		`${((100 * (sample.rate - expected)) / expected).toFixed(1)}% off`,
	);
}

/**
 * §4's actual ends, 0.6 and 3.0 rpm, driven onto a station.
 *
 * The generated pair above is the renderer tracking values the probe did not
 * choose, which is the stronger claim — but it does not reach either end, and
 * the slow end is where the rotation measured in a fixed interval is smallest
 * against `SPIN_TOLERANCE`. So the spin is written the way the ship is placed:
 * a state the game could have generated, set directly.
 *
 * The two values come off the page (`spinRange`), so a retune of §4's range
 * moves this probe with it rather than against it. The station's own spin is
 * restored afterwards — a probe that left the world altered would make every
 * check after it read a world nobody generated.
 */
const ends = await page.evaluate(() => {
	const g = window.__seelite;
	return [g.spinRange.minRpm, g.spinRange.maxRpm];
});
const spinner = setup.stations.find((s) => s.spinRpm > 0);
for (const rpm of ends) {
	await page.evaluate(
		([id, value]) => {
			const g = window.__seelite;
			const station = g.world.system.contents.stations.find((s) => s.id === id);
			station.spinRpm = value;
		},
		[spinner.id, rpm],
	);
	const sample = await angleRateRadS(
		spinner.id,
		1500,
		`${spinner.type} at ${rpm.toFixed(2)} rpm`,
	);
	const expected = (2 * Math.PI * rpm) / 60;
	console.log(
		`  ${spinner.type} driven to ${rpm.toFixed(2)} rpm (§4's ` +
			`${rpm === ends[0] ? "slow" : "fast"} end): ${sample.rate.toFixed(4)} rad/s ` +
			`measured, +${expected.toFixed(4)} expected`,
	);
	check(
		`the slot tracks §4's ${rpm === ends[0] ? "slow" : "fast"} end, ${rpm.toFixed(2)} rpm`,
		!sample.missing &&
			Math.abs(sample.rate - expected) / expected < SPIN_TOLERANCE,
		sample.missing
			? "no aperture in the mesh"
			: `${((100 * (sample.rate - expected)) / expected).toFixed(1)}% off`,
	);
}
await page.evaluate(
	([id, value]) => {
		const g = window.__seelite;
		g.world.system.contents.stations.find((s) => s.id === id).spinRpm = value;
	},
	[spinner.id, spinner.spinRpm],
);

const pad = setup.stations.find((s) => s.spinRpm === 0);
if (pad) {
	const sample = await angleRateRadS(pad.id, 1200, `${pad.type} pad`);
	// The refinery's pad does not rotate at all (§4), which is what removes the
	// roll match from its docking interaction. A pad that crept would make that
	// a different game without failing any headless test.
	check(
		"the refinery's pad does not turn",
		!sample.missing && Math.abs(sample.rate * sample.dt) < 0.02,
		sample.missing
			? "no aperture in the mesh"
			: `${Math.abs(sample.rate * sample.dt).toFixed(4)} rad over ` +
					`${sample.dt.toFixed(2)} s`,
	);
}

/**
 * The layer rule, for the whole assembly.
 *
 * `probe-handoff.mjs` owns the handoff's arithmetic — that the two scale factors
 * agree — and does it on a station. What it cannot see is that a station is no
 * longer one mesh: it is a group with an aperture and, for the shipyard, a
 * 1.5 km frame. So this asserts the *assembly* moves as one, which is the thing
 * a reparent-by-mesh implementation would get wrong.
 */
console.log("\nlayering:");
const shipyard = setup.stations.find((s) => s.type === "shipyard");
if (shipyard) {
	for (const [multiple, want] of [
		[0.4, "near"],
		[1.4, "far"],
		[0.4, "near"],
	]) {
		const state = await page.evaluate(
			async ([id, distanceKm]) => {
				const g = window.__seelite;
				const body = g.world.system.bodies.find((b) => b.id === id);
				const n = Math.hypot(body.pos.x, body.pos.y, body.pos.z);
				await window.__placeShipAt({
					x: body.pos.x * (1 + distanceKm / n),
					y: body.pos.y * (1 + distanceKm / n),
					z: body.pos.z * (1 + distanceKm / n),
				});
				const near = g.nearScene.getObjectByName(id);
				const far = g.farScene.getObjectByName(id);
				const mesh = near ?? far;
				return {
					layer: near ? "near" : far ? "far" : "none",
					hasAperture: !!mesh?.getObjectByName("aperture"),
					// An authored yard's frame is its yard group (node #818).
					hasFrame: !!(
						mesh?.getObjectByName("frame") ??
						mesh?.getObjectByName("shipyard-yard")
					),
				};
			},
			[shipyard.id, setup.handoffKm * multiple],
		);
		check(
			`at ${multiple}× handoff the shipyard is drawn ${want}`,
			state.layer === want,
			`drawn ${state.layer}`,
		);
		check(
			`at ${multiple}× handoff the assembly moved whole`,
			state.hasAperture && state.hasFrame,
			`aperture ${state.hasAperture}, frame ${state.hasFrame}`,
		);
	}
}

await browser.close();
exit();
