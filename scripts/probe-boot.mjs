/**
 * Boot probe — the scaffold's load-bearing claims, checked in a real browser.
 *
 *   npm run dev                      # in one shell
 *   node scripts/probe-boot.mjs      # in another
 *
 * Set PLAYWRIGHT_DIR if bare `playwright` doesn't resolve, and PROBE_URL if
 * vite picked a port other than 5173.
 *
 * ## What it checks, and why each one is here
 *
 * Not "does it look right" — a screenshot does that, and badly. These are the
 * four properties the architecture rests on, each of which fails silently:
 *
 * 1. **The page boots without throwing.** A `pageerror` is a failure, not a log
 *    line. Everything below reads numbers off a live game, and a game whose
 *    loop died still answers most of those questions with plausible values.
 * 2. **The layers are populated and separated.** A body in the wrong scene
 *    renders at the wrong scale by a factor of 10⁵, which on screen looks like
 *    "it isn't there" rather than like a bug. The rule is distance, not kind —
 *    within `HANDOFF_KM` of the camera a body is near, beyond it far — and the
 *    threshold is read off the page rather than restated here. The crossing
 *    itself is `probe-handoff.mjs`; this checks the standing assignment.
 * 3. **Camera-relative placement holds.** Each mesh's rendered position must
 *    equal `simPos - cameraPos`, scaled by its layer's factor. This is the one
 *    invariant the whole scale design rests on, and the way it breaks — a
 *    position read back from the scene graph and fed forward — leaves the first
 *    frame looking perfect.
 * 4. **The seed reaches the backdrop.** Two loads of the same seed must produce
 *    identical star positions, and two different seeds must not. Both halves
 *    are needed: a generator that ignored its seed entirely would pass the
 *    first check by itself.
 *
 * The camera is asserted to sit at the origin, which is the precondition the
 * other three are only meaningful under.
 */
import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl, workbenchUrl } from "./lib/game-url.mjs";

/** Where the game is served. `PROBE_ORIGIN` replaces only the host, so this
 *  probe keeps the seed it chose; `PROBE_URL` replaces the whole thing. The
 *  runner (probe-all.mjs) sets the origin for exactly that reason — a runner
 *  that set the URL would silently hand every probe a different world. */
const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 42;

/** The second seed, for the half of the determinism check that has to differ.
 *  Any value but 42; nothing about this one is special. */
const OTHER_SEED = 20260818;

/** Tolerance on the camera-relative check, in the units each layer draws in.
 *  Not zero: the scene graph holds float32 and the expectation is computed in
 *  float64, so the two agree to about seven significant figures and no
 *  further. A real violation is off by orders of magnitude, not by 1e-6. */
const RELATIVE_EPS = 1e-3;

await guardedOrigin(ORIGIN);
const browser = await launchChromium();

const { check, watch, exit } = tally();

/**
 * Open one page, wait for a drawn frame, and report page errors as failures.
 *
 * Takes the parameters rather than a URL, so the URL is built here by
 * `gameUrl` (#306): a helper that took a string would let a caller hand it a
 * hand-built one that the scan in `tests/game-url.test.ts` cannot see. The
 * `PROBE_URL` override applies unless a caller passes `null` — its parameters
 * win and these fill in what it lacks, so `combat` still reaches a URL the
 * override replaced.
 */
async function open(params = { seed: SEED }, override = process.env.PROBE_URL) {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await installCamSim(page);
	await page.goto(
		gameUrl(ORIGIN, params, { override: override ?? undefined }),
		{
			waitUntil: "load",
		},
	);
	await bootedGame(page);
	return page;
}

const page = await open();

// #306: every script boots through `gameUrl`, and this is the row that shows
// its `?boot=direct` reached the page. Once the Commander overlay lands, a page
// that read anything else would stop at the overlay and every probe after
// this one would time out on a boot wait instead of naming the cause.
const boot = await page.evaluate(() => window.__seelite.boot);
check("a probe page boots direct", boot === "direct", `boot mode ${boot}`);

const state = await page.evaluate(() => {
	const g = window.__seelite;
	// Read the camera and the meshes in the *same* evaluate as the sim
	// positions. Splitting them across two calls would compare a mesh placed on
	// one frame against a camera from the next, and the difference between those
	// is exactly the quantity under test.
	const cam = g.nearCamera;
	const camPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };

	const layerOf = (name) => {
		for (const [layer, scene] of [
			["backdrop", g.backdropScene],
			["far", g.farScene],
			["near", g.nearScene],
		]) {
			if (scene.getObjectByName(name)) return layer;
		}
		return null;
	};

	// The renderer's own idea of where the camera is in sim space, recomputed
	// here from the ship rather than read from a field — `cameraPos` is private,
	// and a probe reaching past that would be asserting on an accessor it
	// invented. The offsets are the same two constants the game uses.
	const ship = g.world.ship;

	const bodies = g.world.system.bodies.map((b) => {
		const mesh =
			g.farScene.getObjectByName(b.id) ?? g.nearScene.getObjectByName(b.id);
		return {
			id: b.id,
			kind: b.kind,
			layer: layerOf(b.id),
			radiusKm: b.radiusKm,
			sim: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
			mesh: mesh
				? { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
				: null,
			// The mesh is a unit sphere sized by `scale`, so this is its drawn
			// radius in whatever units its layer draws in.
			meshRadius: mesh ? mesh.scale.x : null,
		};
	});

	const points = g.backdropScene.children.find((c) => c.isPoints);
	const starPositions = points
		? Array.from(points.geometry.getAttribute("position").array.slice(0, 24))
		: [];

	return {
		seed: g.world.seed,
		frames: g.frames,
		gameTime: g.world.gameTime,
		systemName: g.world.system.record.name,
		// The unit scheme, read from the page rather than restated here, so this
		// probe cannot disagree with the module about what its numbers are.
		units: { ...g.units },
		camPos,
		shipSim: { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z },
		view: g.view,
		camSim: window.__recoverCamSim(),
		shipMesh: (() => {
			const m = g.nearScene.getObjectByName("ship");
			return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null;
		})(),
		bodies,
		starCount: points ? points.geometry.getAttribute("position").count : 0,
		starPositions,
		canvasSize: {
			w: g.renderer.domElement.width,
			h: g.renderer.domElement.height,
		},
	};
});

check(
	"the seed in the URL is the seed the world used",
	state.seed === 42,
	`seed=${state.seed}`,
);
check("frames are being drawn", state.frames > 0, `${state.frames} frames`);
check(
	"the canvas has a size",
	state.canvasSize.w > 0 && state.canvasSize.h > 0,
	`${state.canvasSize.w}x${state.canvasSize.h}`,
);

// (0) The precondition. Every camera-relative expectation below is only
// meaningful if the camera really is pinned to the origin.
const camLen = Math.hypot(state.camPos.x, state.camPos.y, state.camPos.z);
check("the camera sits at the origin", camLen === 0, `|camera| = ${camLen}`);

// (1b) The world is the generated one, not a stand-in.
//
// Cheap, and it is the claim this probe would otherwise be silent about: every
// geometric check below would pass just as well against two planets at fixed
// positions. A named system with a full complement of bodies is what says the
// renderer is drawing `galaxy.ts`'s output.
check(
	"the world is a named system from the generator",
	/^[A-Z]{2,8}$/.test(state.systemName ?? ""),
	`system ${JSON.stringify(state.systemName)}`,
);
const stations = state.bodies.filter((b) => b.kind === "station");
check(
	"the system has between one and three stations",
	stations.length >= 1 && stations.length <= 3,
	`${stations.length}: ${stations.map((s) => s.id).join(", ")}`,
);
// Named for what it asserts. An earlier version was labelled "planets on a
// ladder, not a fixed pair" over a `>= 1` predicate that the deleted
// placeholder's two planets would have satisfied, and reported the total body
// count rather than the planet count it had just measured — so neither the name
// nor the output disclosed the gap.
//
// Both bounds are real, and the floor needed checking rather than assuming: the
// ladder runs 3–7 rungs and drops any outside the 0.3–6 AU envelope, but the
// ladder is *rescaled* so that one rung lands exactly on `habitableAu`, which is
// itself clamped into that envelope (system.ts §6.2). That rung therefore always
// survives, so a generated system has at least one planet — which is also why
// the unconditional trade station always has something to orbit.
const planets = state.bodies.filter((b) => b.kind === "planet");
check(
	"the planet count is inside the generator's envelope",
	planets.length >= 1 && planets.length <= 7,
	`${planets.length} planet(s): ${planets.map((p) => p.id).join(", ")}`,
);

// (2) Layer membership, by distance rather than by kind.
//
// The threshold comes off the page, so this cannot drift from `units.ts`. At
// the arrival point everything is far — §7.4 puts the ship at least 0.25 AU
// from every body, which is four orders of magnitude past the handoff — and
// asserting the *rule* rather than that expected outcome is what makes this
// check keep working once something can approach.
const band = state.units.HANDOFF_KM * state.units.HANDOFF_HYSTERESIS;

/** The factor the body's layer draws at. One definition, used by the scale check
 *  and by the camera-relative placement check below. */
const scaleOf = (b) => (b.layer === "near" ? 1 : state.units.FAR_SCALE);

/** How far a body is from the ship, in kilometres of sim space. */
const rangeOf = (b) =>
	Math.hypot(
		b.sim.x - state.shipSim.x,
		b.sim.y - state.shipSim.y,
		b.sim.z - state.shipSim.z,
	);

/**
 * Which layer the body is drawn in, against the rule.
 *
 * Returns false when the body sits inside the hysteresis band, where the answer
 * depends on which way it arrived — history a single-frame probe does not have.
 * Asserting the bare threshold there would fail a correctly-behaving renderer
 * the moment something could approach, which is the opposite of the point.
 * `probe-handoff.mjs` walks the band in both directions, where it knows the
 * history because it created it.
 */
function checkLayer(b, d) {
	if (d > state.units.HANDOFF_KM && d <= band) {
		// A `console.log`, not a passing `check`. A hardcoded pass inflates the
		// count and reads as coverage — the same thing this probe's sibling had a
		// check removed for.
		console.log(
			`  skip  ${b.id} sits in the hysteresis band at ${d.toExponential(2)} km`,
		);
		return false;
	}
	const want = d <= state.units.HANDOFF_KM ? "near" : "far";
	check(
		`${b.id} is in the ${want} layer at ${d.toExponential(2)} km`,
		b.layer === want,
		`found in ${b.layer}`,
	);
	return true;
}

/**
 * The body is drawn at its layer's scale, in both position and radius.
 *
 * The bound on the position is what `FAR_SCALE` exists to buy, checked in the
 * browser at the distances that can actually violate it.
 *
 * Against `F32_JITTER_UNITS`, read off the page — **not** a bound derived from
 * the generator's envelope. An earlier version restated
 * `(2·MAX_ORBIT_AU + ARRIVAL_CLEARANCE_AU) · AU_KM · FAR_SCALE` as literals,
 * which put a second copy of the unit scheme in a file whose whole contract is
 * to read it off the page: widening `MAX_ORBIT_AU` would have reddened this
 * probe against a correct renderer, and shrinking `FAR_SCALE` would have made it
 * pass vacuously.
 *
 * The ceiling here is a property of the coordinate space rather than of the
 * content, so it survives both. The tighter content-derived bound is asserted in
 * `sim.test.ts`, which can import the generator's constants instead of copying
 * them.
 */
function checkScale(b) {
	if (b.layer === "far") {
		const drawn = Math.hypot(b.mesh.x, b.mesh.y, b.mesh.z);
		const ceiling = state.units.F32_JITTER_UNITS;
		check(
			`${b.id}'s far-layer coordinate fits in float32`,
			drawn < ceiling,
			`|p| = ${drawn.toExponential(2)} units, ceiling ${ceiling.toExponential(1)}`,
		);
	}
	// Position and radius must be scaled by the *same* factor, or the body's
	// angular size is wrong — which is the property the whole scaled-space trick
	// buys and the one a handoff can silently break.
	const k = scaleOf(b);
	check(
		`${b.id} is sized for the layer it is in`,
		b.meshRadius !== null &&
			Math.abs(b.meshRadius - b.radiusKm * k) < 1e-6 * b.radiusKm * k,
		`drawn radius ${b.meshRadius}, expected ${b.radiusKm * k}`,
	);
}

/**
 * Bodies with a mesh, checked once.
 *
 * Both loops below need this and both used to open with the same guard, so a
 * body with no mesh produced two FAIL lines and inflated the denominator in the
 * summary — one defect reported as two.
 */
const drawn = state.bodies.filter((b) => {
	if (b.mesh) return true;
	check(`${b.id} has a mesh`, false);
	return false;
});

for (const b of drawn) {
	// `checkScale` reads the layer the body is *observed* in and needs no arrival
	// history, so the band ambiguity does not reach it — it only affects which
	// layer is correct, not which one was drawn. Tying the two together meant a
	// body in the band lost its scale assertion for no reason.
	checkLayer(b, rangeOf(b));
	checkScale(b);
}

check(
	"the backdrop holds the star points and nothing else",
	state.starCount > 0,
	`${state.starCount} points`,
);

// (2b) The frame is not blank.
//
// Every check around this one reads the scene graph, and a scene graph can be
// perfectly correct in front of a black screen — a composer misordered, a pass
// clearing what the one before it drew, a shader that failed to compile. This
// is the only check here that looks at pixels, and it deliberately asserts
// almost nothing about them: that some are lit, and that they are not all the
// same. Anything tighter would be a screenshot test, which breaks on every
// deliberate visual change and teaches people to re-baseline without looking.
const frame = await page.evaluate(() => {
	const W = 160;
	const H = 110;
	// Render synchronously and read the buffer in the same task. A WebGL canvas
	// without `preserveDrawingBuffer` is cleared at the next composite, so this
	// only works if the draw and the read are not separated by a frame.
	window.__seelite.composer.render();
	const src = document.querySelector("body > canvas");
	const c = document.createElement("canvas");
	c.width = W;
	c.height = H;
	const ctx = c.getContext("2d");
	ctx.drawImage(src, 0, 0, W, H);
	const d = ctx.getImageData(0, 0, W, H).data;
	let lit = 0;
	let min = 255;
	let max = 0;
	for (let i = 0; i < W * H; i++) {
		const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
		if (lum > 6) lit++;
		min = Math.min(min, lum);
		max = Math.max(max, lum);
	}
	return { lit, total: W * H, min, max };
});
check(
	"the frame has lit pixels",
	frame.lit > 0,
	`${frame.lit}/${frame.total} above the noise floor`,
);
check(
	"the frame is not a flat fill",
	frame.max - frame.min > 20,
	`luminance ${frame.min.toFixed(1)}..${frame.max.toFixed(1)}`,
);

// (3) Camera-relative placement. The camera is at the origin in *render* space
// but not in sim space, so its sim position has to be recovered — and the only
// honest way to do that from outside is from a mesh whose sim position is
// known. The ship is that mesh: `shipMesh = shipSim - camSim`, so
// `camSim = shipSim - shipMesh`, and every other body must then agree.
if (state.shipMesh) {
	// The shared recovery, read in the same evaluate as the meshes it is checked
	// against — see `installCamSim` in probe-guard.mjs.
	const camSim = state.camSim;
	// A sanity bound on the recovery itself: both cameras sit metres to tens of
	// metres from the hull — cockpit a few metres ahead of it (#5 made cockpit the
	// default under #21), chase a hundred-odd behind — so a recovered offset of
	// kilometres means the ship mesh is not being placed camera-relatively at all.
	// The bound spans both rather than naming one, because which view is default
	// is a design decision and this check is about the arithmetic.
	const offset = Math.hypot(
		state.shipSim.x - camSim.x,
		state.shipSim.y - camSim.y,
		state.shipSim.z - camSim.z,
	);
	check(
		"the ship is drawn a camera's-length from the origin",
		offset > 0.001 && offset < 0.5,
		`${offset.toFixed(4)} km in ${state.view} view`,
	);

	// An absolute anchor, because everything above is relative to a camera
	// recovered from one of the meshes it then checks. If every mesh were placed
	// against the same wrong origin, those checks would agree with each other and
	// say nothing.
	//
	// The star is that anchor and it needs no `camSim` at all: system frames are
	// star-centred (§7.4), so its sim position is exactly the origin, and its
	// drawn distance must therefore be the ship's own distance from the star
	// times `FAR_SCALE`. The chase camera is the only difference and it is
	// metres against an AU. The scaffold used the station for this, which worked
	// only because a placeholder had pinned it 40 km away.
	const star = state.bodies.find((b) => b.kind === "star");
	if (star?.mesh) {
		const drawn = Math.hypot(star.mesh.x, star.mesh.y, star.mesh.z);
		const real =
			Math.hypot(state.shipSim.x, state.shipSim.y, state.shipSim.z) *
			state.units.FAR_SCALE;
		check(
			"the star renders at the ship's true distance from it",
			Math.abs(drawn - real) < 1e-3 * real,
			`drawn ${drawn.toFixed(3)}, expected ${real.toFixed(3)} far-units`,
		);
		check(
			"the ship is an astronomical distance out, not a placeholder's 40 km",
			real / state.units.FAR_SCALE > 0.5 * state.units.AU_KM,
			`${(real / state.units.FAR_SCALE / state.units.AU_KM).toFixed(3)} AU`,
		);
	} else {
		check("the star has a mesh", false);
	}

	for (const b of drawn) {
		const k = scaleOf(b);
		const want = {
			x: (b.sim.x - camSim.x) * k,
			y: (b.sim.y - camSim.y) * k,
			z: (b.sim.z - camSim.z) * k,
		};
		const err = Math.hypot(
			b.mesh.x - want.x,
			b.mesh.y - want.y,
			b.mesh.z - want.z,
		);
		// Relative, not absolute: a far-layer coordinate is ~1500 units and
		// float32 resolves it to ~1e-4, so a fixed epsilon would either fail on
		// the far layer or wave through a real error on the near one.
		const magnitude = Math.max(1, Math.hypot(want.x, want.y, want.z));
		check(
			`${b.id} is placed camera-relative`,
			err / magnitude < RELATIVE_EPS,
			`error ${err.toExponential(2)} on |p| = ${magnitude.toExponential(2)}`,
		);
	}
} else {
	check("the ship has a mesh", false);
}

// (3b) The clock runs, and the bodies read it.
//
// Body positions are `f(systemSeed, gameTime)` (§7.3), so a renderer that
// stepped only the ship would show a system frozen mid-orbit — which looks
// exactly like a correct one in a screenshot, and is the state the scaffold was
// actually in. Both halves are needed: a clock that advances while nothing moves
// is the same bug one field further along.
const ticked = await page.evaluate(async () => {
	const g = window.__seelite;
	const sample = () => ({
		t: g.world.gameTime,
		bodies: g.world.system.bodies.map((b) => ({ ...b.pos })),
	});
	const before = sample();
	// Poll rather than sleep a flat 600 ms on every run. The wait is now however
	// long the clock actually needs to move, with 600 ms as the timeout — so a
	// frozen clock still fails, and a healthy one costs a few frames.
	const deadline = Date.now() + 600;
	while (g.world.gameTime - before.t <= 0.1 && Date.now() < deadline) {
		await new Promise((r) => requestAnimationFrame(() => r()));
	}
	const after = sample();
	const moved = after.bodies
		.map((p, i) =>
			Math.hypot(
				p.x - before.bodies[i].x,
				p.y - before.bodies[i].y,
				p.z - before.bodies[i].z,
			),
		)
		.filter((d) => d > 0).length;
	return {
		dt: after.t - before.t,
		moved,
		total: after.bodies.length,
		waitedMs: Math.round(600 - Math.max(0, deadline - Date.now())),
	};
});
check(
	"the game clock advances with the frame loop",
	ticked.dt > 0.1,
	`+${ticked.dt.toFixed(3)} s of sim time in ${ticked.waitedMs} ms of wall time`,
);
check(
	"the bodies move with the clock",
	// Every body but the star, which is pinned to the origin by §7.4.
	ticked.moved === ticked.total - 1,
	`${ticked.moved} of ${ticked.total} moved`,
);

// (4) The seed reaches the backdrop — both halves.
const reload = await open();
const again = await reload.evaluate(() => {
	const points = window.__seelite.backdropScene.children.find(
		(c) => c.isPoints,
	);
	return Array.from(
		points.geometry.getAttribute("position").array.slice(0, 24),
	);
});
check(
	"the same seed draws the same stars",
	again.length === state.starPositions.length &&
		again.every((v, i) => v === state.starPositions[i]),
	`${again.length} values compared`,
);
// Closed as soon as its one reading is taken. Each of these is a *running
// game*: a WebGL context, a render loop, a simulation. Left open they stack up
// for the rest of the file, and the boot budget for the pages after them is
// the fixed 20 s in `bootedGame`. This file opens four; leaving three live is
// what made the last of them time out.
await reload.close();

// `null`: the other seed is the point, so the override must not replace it.
const other = await open({ seed: OTHER_SEED }, null);
const otherStars = await other.evaluate(() => {
	const points = window.__seelite.backdropScene.children.find(
		(c) => c.isPoints,
	);
	return Array.from(
		points.geometry.getAttribute("position").array.slice(0, 24),
	);
});
check(
	"a different seed draws different stars",
	otherStars.some((v, i) => v !== state.starPositions[i]),
	"the first 8 star positions are not all identical",
);
await other.close();

/**
 * Both sides of the `?fps` gate. `fps-meter.ts` carries why it is gated at all.
 *
 * A gate is only a gate if something checks that the default game does not
 * carry it — and the page below has been open for the whole of this file, so if
 * the meter were ungated it would have been on screen in every check that
 * precedes this one.
 */
check(
	"the default game carries no frame-rate readout",
	!(await page.evaluate(() =>
		Boolean(document.querySelector("[data-fps-meter]")),
	)),
);

/**
 * Both sides of the `?fps` gate, in one function because it is one subject and
 * because everything below opens a page of its own — the boot page the rest of
 * this file asserts on is not touched here.
 */
async function fpsGate() {
	/**
	 * The other side of the gate, which is the half that could actually go wrong.
	 *
	 * Which page carries which side, since "both sides" is loose: the default is
	 * asserted on the boot page the rest of this file uses, and again on the page
	 * that comes back from the workbench; the positive is asserted on that same
	 * page after a `goto` to `&fps`. One page, three states, rather than one page
	 * per claim.
	 * The workbench mounts a meter *unconditionally*, and the only reason one does
	 * not survive the return to flight is that `[data-model-close]` navigates.
	 * Rewrite it as an in-place teardown and the readout is on the flight floor
	 * with no `?fps` anywhere — so it is checked here rather than reasoned about.
	 *
	 * Every wait below is bounded generously and swallows its own expiry: what is
	 * asserted is the end state, so a loaded machine costs seconds and a real
	 * failure arrives as a named check going red. Both halves of that were learned
	 * the hard way — a 6 s bound cost a suite run, and an uncaught wait crashed
	 * this block where a red check belonged.
	 */
	// Not through `open`: the workbench builds no simulation behind itself, so
	// `bootedGame` has nothing to wait for and would time out.
	const bench = await browser.newPage({
		viewport: { width: 900, height: 620 },
	});
	watch(bench);
	await bench.goto(
		workbenchUrl(ORIGIN, { seed: SEED, "model-viewer": "station" }),
		{ waitUntil: "load" },
	);
	const mounted = await bench
		.waitForSelector("#model-viewer canvas", { timeout: 20000 })
		.catch(() => null);
	check("the workbench opens", Boolean(mounted));
	const readout = await bench
		.waitForSelector("[data-fps-meter]", { timeout: 20000 })
		.catch(() => null);
	check("the workbench mounts a readout without `?fps`", Boolean(readout));
	await Promise.all([
		bench
			.waitForFunction(
				() => !new URLSearchParams(window.location.search).has("model-viewer"),
				null,
				{ timeout: 20000 },
			)
			.catch(() => {}),
		bench.click("[data-model-close]").catch(() => {}),
	]);
	check(
		"returning to flight from the workbench leaves no readout behind",
		await bench.evaluate(
			() =>
				!new URLSearchParams(window.location.search).has("model-viewer") &&
				!document.querySelector("[data-fps-meter]"),
		),
		await bench.evaluate(() => window.location.search || "(no query)"),
	);
	/**
	 * A fresh page, not the workbench one navigated a third time.
	 *
	 * Reusing it saved a boot, was taken as a suggestion in review, and has now
	 * been measured costing more than it saved: with
	 * `?model-viewer=station` -> flight -> `&fps` on one page, `bootedGame`
	 * timed out at 20 s in two consecutive suite runs while eleven other probes
	 * passed, and this file took 116 s. A workbench page holds its own
	 * Three.js renderer and GL context, and a game booting behind that history
	 * is not the measurement `?fps` is meant to give — the rest of this file
	 * asserts on a game booted into a clean page, which is what this now is.
	 *
	 * The saved boot was an argument; the flake is a number.
	 */
	await bench.close();
	/**
	 * The gate as an A/B on one page, which is the only form of it that means
	 * anything.
	 *
	 * The absence check at the top of this file passes identically whether the
	 * gate works or `mountFpsMeter` is never called at all — it asserts absence
	 * where absence was never in question, and its justification ("the page has
	 * been open for the whole of this file") argues for the wrong thing. Here
	 * one page is loaded without the flag and then with it, so the only
	 * difference between the two readings is the flag.
	 */
	const metered = await open();
	check(
		"the same page carries no readout before the flag",
		!(await metered.evaluate(() =>
			Boolean(document.querySelector("[data-fps-meter]")),
		)),
	);
	await metered.goto(
		gameUrl(
			ORIGIN,
			{ seed: SEED, fps: true },
			{ override: process.env.PROBE_URL },
		),
		{ waitUntil: "load" },
	);
	await bootedGame(metered);
	// Wait for a *rate*, not for the element. The meter mounts showing "- fps",
	// so waiting on text containing "fps" is satisfied the instant it appears and
	// gates on nothing: whether the read below saw a measured figure or the
	// placeholder would come down to boot latency, on a wait written to take
	// exactly that out. A digit is what the placeholder does not have.
	const rated = await metered
		.waitForFunction(
			() =>
				/\d/.test(
					document.querySelector("[data-fps-meter]")?.textContent ?? "",
				),
			null,
			{ timeout: 20000 },
		)
		.then(() => true)
		.catch(() => false);
	// The page is asked what it is before it is asked what it reads. Every wait in
	// this block swallows its expiry, which is what keeps a failure a named check
	// rather than a crash — and it also means the read below runs whether or not
	// the wait succeeded. Pairing the reading with the query it was taken on
	// removes the one way that could mislead: a verdict formed on a page that is
	// not the one under test.
	const reading = await metered.evaluate(() => ({
		query: window.location.search,
		text:
			document.querySelector("[data-fps-meter]")?.textContent ?? "(no meter)",
	}));
	const rate = Number.parseFloat(reading.text);
	// Named for what it asserts. It reads a finite positive rate and a worst
	// frame, which catches a meter that never started, reports the placeholder, or
	// lost half its format. It does *not* check the number is right: a meter
	// miscounting frames, or reporting a constant, is green here — and the cost
	// figures this branch quotes rest on that accuracy, measured by eye in a real
	// browser rather than by anything in this file.
	check(
		"`?fps` mounts a readout that reports a finite rate and a worst frame",
		// `rated` is the wait's own verdict, asserted rather than assumed.
		// Swallowing an expiry is what keeps a failure a named check instead of
		// a crash; it also means the read above runs either way, so without this
		// the check could pass on whatever text happened to be on the page.
		rated &&
			reading.query.includes("fps") &&
			Number.isFinite(rate) &&
			rate > 0 &&
			reading.text.includes("worst"),
		`${reading.query} → ${reading.text}`,
	);
	await metered.close();
}
await fpsGate();

/**
 * The settings screen takes the keyboard, and gives back the keys already
 * held.
 *
 * Two claims that were comments until this check existed. The dialog swallows
 * keys in the capture phase so the flight controls do not also act on them,
 * and it clears the game's held-key set as it opens — `keydown` interception
 * does nothing about a throttle key that went down before the dialog did, and
 * a ship accelerating behind a screen the player is reading is the failure
 * that motivates both.
 */
async function settingsGate() {
	const page = await open();
	// Hold throttle, then open the screen while it is still down.
	await page.keyboard.down("Shift");
	await page.waitForFunction(() => window.__seelite.heldKeyCount > 0, null, {
		timeout: 5000,
	});
	await page.keyboard.press("z");
	const opened = await page.waitForSelector("[data-settings-panel]", {
		timeout: 5000,
	});
	check("`z` opens the settings screen", Boolean(opened));
	check(
		"opening it releases the keys the player was holding",
		(await page.evaluate(() => window.__seelite.heldKeyCount)) === 0,
	);

	/*
	 * A flight key pressed while it is open must not reach the game — and the
	 * assertion has to be about *state the key changes*.
	 *
	 * The first version pressed `v` and asserted `heldKeyCount === 0`. `v` is a
	 * one-shot in the key handler's switch, never held, so the count stays 0
	 * whether the dialog intercepted it or not: green by construction, proving
	 * nothing. What `v` does do is toggle the view, so that is what is watched.
	 */
	const viewBefore = await page.evaluate(() => window.__seelite.view);
	await page.keyboard.press("v");
	const viewAfter = await page.evaluate(() => window.__seelite.view);
	check(
		"a flight key pressed over the screen does not reach the game",
		viewAfter === viewBefore && Boolean(await page.$("[data-settings-panel]")),
		`view ${viewBefore} -> ${viewAfter}`,
	);

	/*
	 * Every row is reachable on a short window.
	 *
	 * This page is 900x620, which is where the defect lived: a flex container
	 * centring a box taller than itself pushes the box's top *above* the scroll
	 * origin, and there is no scroll position that brings it back. #200 added
	 * three rows and took the dialog past this height, so the first row and the
	 * hint were both off the screen with no way to reach either.
	 *
	 * Asserted on the box's own rectangle rather than on a height: what matters
	 * is that nothing sits above the scrollable origin and that scrolling to the
	 * end reveals the last row. A height threshold would need retuning every
	 * time a setting is added, which is the change that broke it.
	 */
	const reach = await page.evaluate(() => {
		const root = document.getElementById("seelite-settings");
		const box = root.querySelector(".box");
		root.scrollTop = 0;
		const top = box.getBoundingClientRect().top;
		root.scrollTop = root.scrollHeight;
		const bottom = box.getBoundingClientRect().bottom;
		return {
			top,
			bottom,
			viewport: root.clientHeight,
			overflows: root.scrollHeight > root.clientHeight,
		};
	});
	check(
		"scrolled to the top, no part of the settings box is above the window",
		reach.top >= 0,
		`box top ${reach.top.toFixed(1)} px, ${reach.overflows ? "taller" : "shorter"} than the ${reach.viewport} px window`,
	);
	check(
		"and scrolled to the end, its last row is on screen",
		reach.bottom <= reach.viewport + 1,
		`box bottom ${reach.bottom.toFixed(1)} px against a ${reach.viewport} px window`,
	);

	await page.keyboard.up("Shift");
	await page.keyboard.press("Escape");
	check("`Escape` closes it", !(await page.$("[data-settings-panel]")));

	// And the same key reaches the game once the screen is gone, which is what
	// makes the check above a statement about the dialog rather than about `v`
	// never working in the first place.
	await page.keyboard.press("v");
	check(
		"the same key works again once the screen is closed",
		(await page.evaluate(() => window.__seelite.view)) !== viewBefore,
	);
	await page.close();
}
await settingsGate();

/**
 * #61: normal flight carries no combat prototype.
 *
 * The behavioural half of the acceptance line. `tests/combat-rig-boundary.test.ts`
 * proves the *source* no longer threads the prototype through `Game`; this
 * proves the running game allocates none of it, which a source scan cannot see
 * — a rig that allocated under a renamed identifier would pass the scan and
 * fail here.
 *
 * The control matters more than usual, because every row below is an absence.
 * A default boot asserting "no target mesh" reads identical to a boot that
 * failed to build a scene at all, so the same page is asked for something that
 * must be there, and a `?combat=1` page is asked for the objects whose absence
 * is being claimed. Without that second page this gate would pass on a build
 * where the rig had simply been deleted.
 */
async function combatRigAbsentInNormalFlight() {
	const page = await open();
	const plain = await page.evaluate(() => ({
		// Coerced in the page, not returned. On the regression this row exists to
		// catch, `combatRig` is a live rig holding Three.js meshes with parent
		// cycles, and handing that to `evaluate` serialises a scene graph instead
		// of failing a check.
		rigAbsent: window.__seelite.combatRig === null,
		target: Boolean(
			window.__seelite.nearScene.getObjectByName("combat-prototype-target"),
		),
		laser: Boolean(
			window.__seelite.nearScene.getObjectByName("combat-prototype-laser"),
		),
		// The control: the near layer is populated, so the two absences above are
		// about the prototype rather than about an empty scene.
		nearChildren: window.__seelite.nearScene.children.length,
		// **No way to stop the world.**
		//
		// `private` is erased at runtime and the game object is published whole,
		// so a prototype-only capability parked on it is reachable from a
		// production page. One was, twice: first as an own field
		// (`probeLoopControl.freeze()`), then --- after a fix that only moved it
		// --- as a prototype method (`loopControl().freeze()`).
		//
		// **What this row covers, and what it does not.** It walks the whole
		// prototype chain and fails on any member that *is* a loop control (an
		// object exposing `freeze`), and on the four names that have ever
		// carried this capability on `Game`. It does **not** detect an
		// arbitrary new void method that calls `cancelAnimationFrame` itself ---
		// the shape `probeFreezeLoop` had before this branch removed it. Two
		// things were tried and rejected for that: calling every zero-arity
		// member to see what it returns invokes `animate()` and arms a second
		// rAF chain on the page being measured, and pinning the whole
		// `__seelite` surface is ~76 members and belongs to a declared
		// read-model rather than to this node.
		//
		// So this is a real check with a named hole, rather than a broad one
		// that would read as complete and is not.
		//
		// **Both halves are proven to fail, and separately.** The name list and
		// the shape test are different mechanisms, and a scar that trips the
		// first `continue`s before the second ever runs — so the earlier scars
		// (`probeLoopControl`, `loopControl()`, `probeFreezeLoop`) exercised
		// only the names. The shape half was then run red on its own against a
		// control under a name this list has never held, and caught it:
		//
		//     FAIL ... freeze-capable properties on __seelite: [cadenceHarness]
		freezers: (() => {
			const game = window.__seelite;
			const EVER_CARRIED_IT = [
				"probeLoopControl",
				"loopControl",
				"probeFreezeLoop",
				"probeResumeLoop",
			];
			const found = [];
			for (
				let o = game;
				o && o !== Object.prototype;
				o = Object.getPrototypeOf(o)
			)
				for (const n of Object.getOwnPropertyNames(o)) {
					if (n === "constructor" || found.includes(n)) continue;
					if (EVER_CARRIED_IT.includes(n)) {
						found.push(n);
						continue;
					}
					// No member is *called*. Accessors on the chain do run —
					// `Game` has three (`dockedAt`, `dockPhase`,
					// `dockTraversalSeconds`), all pure dock readouts — which is
					// what the `catch` below concedes. An earlier version of this
					// walk called every zero-arity function to see what it
					// returned, and that reached `animate()` and armed a second
					// rAF chain on the page being measured.
					let v;
					try {
						v = game[n];
					} catch {
						continue;
					}
					if (v && typeof v === "object" && typeof v.freeze === "function")
						found.push(n);
				}
			return found;
		})(),
	}));
	check(
		"a default boot builds no prototype rig",
		plain.rigAbsent,
		`combatRig absent: ${plain.rigAbsent}`,
	);
	check(
		"a default boot exposes no way to freeze the frame loop",
		plain.freezers.length === 0,
		`freeze-capable properties on __seelite: [${plain.freezers.join(", ")}]`,
	);
	check(
		"a default boot allocates no prototype scene objects",
		!plain.target && !plain.laser && plain.nearChildren > 0,
		`target ${plain.target}, laser ${plain.laser}, near children ${plain.nearChildren}`,
	);
	await page.close();

	// The other arm: the same lookups find the objects when the rig is asked
	// for, so the rows above are a statement about the gate and not about the
	// names having gone away.
	// Built rather than concatenated. `PROBE_URL` replaces the whole URL, so
	// neither `?combat=1` nor `&combat=1` is safe against it — the first version
	// of this line used `?` on a URL already carrying `?seed=42`, the flag never
	// parsed, and the control row below failed for a reason it did not name.
	// `gameUrl` adds the flag to whichever URL the override left.
	const combatPage = await open({ seed: SEED, combat: 1 });
	const enabled = await combatPage.evaluate(() => ({
		rig: window.__seelite.combatRig !== null,
		target: Boolean(
			window.__seelite.nearScene.getObjectByName("combat-prototype-target"),
		),
		laser: Boolean(
			window.__seelite.nearScene.getObjectByName("combat-prototype-laser"),
		),
	}));
	check(
		"`?combat=1` builds the rig and its scene objects",
		enabled.rig && enabled.target && enabled.laser,
		`rig ${enabled.rig}, target ${enabled.target}, laser ${enabled.laser}`,
	);
	await combatPage.close();
}
await combatRigAbsentInNormalFlight();

await browser.close();
exit();
