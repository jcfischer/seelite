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
 *    only because at 60 km the mask is a few dozen pixels and the control itself
 *    reads about 0.17: a check whose noise is three times its own ceiling is not
 *    a check.
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
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

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
 * ## The 5 km control flakes, and #118 made it flake more often
 *
 * Stated plainly because the comfortable version — "pre-existing, not ours" —
 * is only half true. The control below, trade measured twice against a
 * `1 − IoU ≤ 0.05` ceiling, straddles that ceiling. Four `probe:one station`
 * runs each:
 *
 * ```
 *   main, seed 1 (pre-#118)   3/4 green   worst reading 0.057
 *   seed 54 (this fixture)    2/4 green   readings 0.061, 0.074
 *   seed 59                   1/4 green   readings 0.064, 0.069, 0.085
 *   seeds 96, 115             0/4 green
 * ```
 *
 * So the flake predates #118 — but this fixture roughly **doubles** its rate and
 * pushes the readings past anything `main` produced. That is a real cost of the
 * reshape, not somebody else's problem, and 54 is simply the best of the seeds
 * that satisfy the fixture requirement at all: seed 1 no longer holds three
 * station types, and every seed that does is worse than 54 on this control.
 *
 * The ceiling is deliberately **not** widened to hide it. Loosening a margin so
 * that an unrelated change goes green is how a check stops discriminating, and
 * the readings point away from the margin being the fault: the control
 * re-measures a station that is *spinning*, so what it reports is rotation
 * between the two captures rather than measurement noise, which is why it is
 * load-sensitive and why it straddles rather than sits. Fixing that — freezing
 * the game clock across the pair — is the open node #84's call, and the
 * measurements above are posted there.
 */
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=54`;

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
 * still a gate: the three pairs came out at about 0.35 (trade/refinery), 0.61
 * (trade/shipyard) and 0.62 (refinery/shipyard), against a control of 0.02. The
 * closest pair was the two compact types, which is where the identity claim is
 * hardest, and 0.25 left that pair about 40% of headroom while sitting an order
 * of magnitude above the noise.
 */
const MIN_DIFFERENCE = 0.25;

/** What re-measuring one station back to back may differ by. Not zero: the
 *  clock advances between the two captures, so a boundary cell or two moves. */
const MAX_CONTROL_DIFFERENCE = 0.05;

/** Tolerance on the measured spin rate, relative. Loose because the station is
 *  also moving along its orbit between the two samples, and because the frame
 *  loop decides when the samples land rather than the probe. */
const SPIN_TOLERANCE = 0.06;

/**
 * One layer-agnostic mesh lookup and one "settle two frames" for every evaluate
 * in this file.
 *
 * Installed as an init script rather than repeated three times: the rule "a
 * body is drawn in whichever layer its distance puts it in" is the renderer's,
 * and a probe that states it three times has three places to get it wrong. The
 * same pattern `probe-guard.mjs` uses for `__recoverCamSim`.
 */
const installMeshLookup = (page) =>
	page.addInitScript(() => {
		window.__meshOfBody = (id) =>
			window.__seelite.nearScene.getObjectByName(id) ??
			window.__seelite.farScene.getObjectByName(id) ??
			null;
		/**
		 * Place the ship and let the renderer catch up.
		 *
		 * **Two** frames, not one: the first may already be in flight when the
		 * position is written, so it can compose from a mix of the old and new
		 * ship positions. The second is unambiguously after the write. Written
		 * once because two copies drift the day that count changes.
		 */
		window.__placeShipAt = async (pos) => {
			const g = window.__seelite;
			g.world.ship.pos = pos;
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			await new Promise((r) => requestAnimationFrame(() => r()));
			await new Promise((r) => requestAnimationFrame(() => r()));
		};
	});

await guardedOrigin(ORIGIN);
const browser = await launchChromium();

const { check, watch, exit } = tally();

const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installMeshLookup(page);
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
 * Put the camera on a station's aperture axis at `RANGE_KM` and look back down
 * it, so the aperture faces the viewer.
 *
 * The ship is placed rather than flown, for `probe-handoff.mjs`'s reason: the
 * distances involved take hours under thrust, and the renderer cannot tell a
 * placed ship from a flown one.
 *
 * Returns nothing: every caller's next act reads the page itself, and a payload
 * none of them used read as one they were meant to.
 */
async function viewAlongAxis(id, rangeKm) {
	return page.evaluate(
		async ([bodyId, range]) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const pose = g.poseOfStation(bodyId);
			await window.__placeShipAt({
				x: body.pos.x + pose.axis.x * range,
				y: body.pos.y + pose.axis.y * range,
				z: body.pos.z + pose.axis.z * range,
			});
			// A camera looks down its own −Z, so aiming at the station means
			// mapping −Z onto −axis. `Vector3` is not reachable from the page, so
			// the two vectors are borrowed from an object that already holds some.
			const from = g.nearScene.position.clone().set(0, 0, -1);
			const to = g.nearScene.position
				.clone()
				.set(-pose.axis.x, -pose.axis.y, -pose.axis.z);
			g.orientation.setFromUnitVectors(from, to);
		},
		[id, rangeKm],
	);
}

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
 * absorbs it least. The control read 0.062 against its own 0.05 ceiling with
 * nothing unstable.
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
			const luma = () => {
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
			 * twice — then read 0.051 against its own 0.05 ceiling while nothing
			 * was unstable. Pinning makes every capture in this file comparable to
			 * every other, which is what a shape comparison needs.
			 */
			const savedClock = g.world.gameTime;
			g.world.gameTime = 0;
			const withIt = luma();
			mesh.visible = false;
			const without = luma();
			mesh.visible = true;
			g.world.gameTime = savedClock;
			g.render(0);

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
							for (let x = box.minX + x0; x < Math.min(box.minX + x1, W); x++) {
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
			return { shape, again: shapeOf(withItAgain, withoutAgain) };
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
		await viewAlongAxis(station.id, rangeKm);
		// The trade station is captured *twice from one evaluate*, and the second
		// copy is the control. Two evaluates cannot measure this metric's noise:
		// real frames run in the gap and carry the station along its orbit, which
		// is a genuine change of apparent size rather than instability — and a
		// squared hull's mask, being mostly long straight edges, is where the
		// crop-and-resample absorbs it least.
		const captured = await silhouette(station.id, station.type === "trade");
		const shape = captured.again ? captured.shape : captured;
		if (captured.again) control = captured.again;
		check(
			`${rangeKm} km — ${station.type}: the station is drawn and has a silhouette`,
			!shape.missing && !shape.empty && shape.pixels > 20,
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
		// Gated only where the shape comparison is. At the far range the mask is a
		// few dozen pixels and the control reads about 0.17 — measured, printed,
		// and the reason the far-range pairwise figures above are reported rather
		// than asserted: a metric whose noise is half its signal is not evidence,
		// and the honest far-range claim is the extent one below.
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
			};
		},
		[station.id],
	);
	console.log(
		`  ${station.type}: hull #${(painted.hull ?? 0).toString(16)}, ` +
			`body #${painted.body.toString(16)}`,
	);
	check(
		`${station.type}'s hull is painted its own type's colour`,
		painted.hull === painted.body,
		`hull #${(painted.hull ?? 0).toString(16)} against body #${painted.body.toString(16)}`,
	);
}

/**
 * The slot's screen-space orientation, radians.
 *
 * The aperture group's local +X is the slot's long axis — the thing check 4's
 * roll is matched to — so this projects that axis through the near camera and
 * reports its angle on screen. Pixels rather than NDC, so the viewport's aspect
 * ratio does not shear the angle.
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
async function angleRateRadS(id, waitMs) {
	await viewAlongAxis(id, RANGE_KM);
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
	const sample = await angleRateRadS(station.id, 1500);
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
	const sample = await angleRateRadS(spinner.id, 1500);
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
	const sample = await angleRateRadS(pad.id, 1200);
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
					hasFrame: !!mesh?.getObjectByName("frame"),
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
