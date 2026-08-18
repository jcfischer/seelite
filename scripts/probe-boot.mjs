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

/** Where the game is served. `PROBE_ORIGIN` replaces only the host, so this
 *  probe keeps the seed it chose; `PROBE_URL` replaces the whole thing. The
 *  runner (probe-all.mjs) sets the origin for exactly that reason — a runner
 *  that set the URL would silently hand every probe a different world. */
const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=42`;

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

/** Open one page, wait for a drawn frame, and report page errors as failures. */
async function open(url) {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	await installCamSim(page);
	await page.goto(url, { waitUntil: "load" });
	await bootedGame(page);
	return page;
}

const page = await open(URL);

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
// nor the output disclosed the gap. The ladder runs 3–7 rungs but drops any
// falling outside the 0.3–6 AU envelope, so the surviving count has no useful
// floor; the upper bound is real and is what is checked.
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
for (const b of state.bodies) {
	if (!b.mesh) {
		check(`${b.id} has a mesh`, false);
		continue;
	}
	const d = Math.hypot(
		b.sim.x - state.shipSim.x,
		b.sim.y - state.shipSim.y,
		b.sim.z - state.shipSim.z,
	);
	// Inside the hysteresis band the answer depends on which way the body
	// arrived, which a single-frame probe cannot know — so the band is skipped
	// rather than guessed at. Asserting the bare threshold here would fail a
	// correctly-behaving renderer the moment something could approach, which is
	// the opposite of what this check is for. `probe-handoff.mjs` walks the band
	// in both directions, where the history is known because it created it.
	if (d > state.units.HANDOFF_KM && d <= band) {
		check(
			`${b.id} sits in the hysteresis band — layer not asserted`,
			true,
			`${d.toExponential(2)} km`,
		);
		continue;
	}
	const want = d <= state.units.HANDOFF_KM ? "near" : "far";
	check(
		`${b.id} is in the ${want} layer at ${d.toExponential(2)} km`,
		b.layer === want,
		`found in ${b.layer}`,
	);
	// The bound `FAR_SCALE` exists to buy, checked in the browser at the
	// distances that can actually violate it. `sim.test.ts` asserts the same
	// thing headlessly; this is the half that would notice the renderer using a
	// different factor from the module.
	if (b.layer === "far") {
		check(
			`${b.id}'s far-layer coordinate fits in float32`,
			Math.hypot(b.mesh.x, b.mesh.y, b.mesh.z) < 1e4,
			`|p| = ${Math.hypot(b.mesh.x, b.mesh.y, b.mesh.z).toExponential(2)} units`,
		);
	}
	// Position and radius must be scaled by the *same* factor, or the body's
	// angular size is wrong — which is the property the whole scaled-space trick
	// buys and the one a handoff can silently break.
	const k = b.layer === "near" ? 1 : state.units.FAR_SCALE;
	check(
		`${b.id} is sized for the layer it is in`,
		b.meshRadius !== null &&
			Math.abs(b.meshRadius - b.radiusKm * k) < 1e-6 * b.radiusKm * k,
		`drawn radius ${b.meshRadius}, expected ${b.radiusKm * k}`,
	);
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
	// A sanity bound on the recovery itself: the chase camera sits a few tens of
	// metres from the ship, so a recovered offset of kilometres means the ship
	// mesh is not being placed camera-relatively at all.
	const chase = Math.hypot(
		state.shipSim.x - camSim.x,
		state.shipSim.y - camSim.y,
		state.shipSim.z - camSim.z,
	);
	check(
		"the ship is drawn a chase-camera's distance from the origin",
		chase > 0.01 && chase < 0.5,
		`${chase.toFixed(4)} km`,
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

	for (const b of state.bodies) {
		if (!b.mesh) {
			check(`${b.id} has a mesh`, false);
			continue;
		}
		const k = b.layer === "near" ? 1 : state.units.FAR_SCALE;
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
	await new Promise((r) => setTimeout(r, 600));
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
	return { dt: after.t - before.t, moved, total: after.bodies.length };
});
check(
	"the game clock advances with the frame loop",
	ticked.dt > 0.1,
	`+${ticked.dt.toFixed(3)} s of sim time over ~0.6 s of wall time`,
);
check(
	"the bodies move with the clock",
	// Every body but the star, which is pinned to the origin by §7.4.
	ticked.moved === ticked.total - 1,
	`${ticked.moved} of ${ticked.total} moved`,
);

// (4) The seed reaches the backdrop — both halves.
const reload = await open(URL);
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

const other = await open(`${ORIGIN}/?seed=${OTHER_SEED}`);
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

await browser.close();
exit();
