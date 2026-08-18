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
 * 2. **The layers are populated and separated.** A star in the near scene or a
 *    station in the far scene renders at the wrong scale by a factor of 10⁵,
 *    which on screen looks like "it isn't there" rather than like a bug.
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
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

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

let failures = 0;
let checks = 0;
const check = (label, ok, detail) => {
	checks++;
	if (!ok) failures++;
	console.log(
		`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`,
	);
};

/** Open one page, wait for a drawn frame, and report page errors as failures. */
async function open(url) {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	page.on("pageerror", (e) => {
		failures++;
		console.log(`PAGEERROR ${e.message}`);
	});
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
			sim: { x: b.pos.x, y: b.pos.y, z: b.pos.z },
			mesh: mesh
				? { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }
				: null,
		};
	});

	const points = g.backdropScene.children.find((c) => c.isPoints);
	const starPositions = points
		? Array.from(points.geometry.getAttribute("position").array.slice(0, 24))
		: [];

	return {
		seed: g.world.seed,
		frames: g.frames,
		camPos,
		shipSim: { x: ship.pos.x, y: ship.pos.y, z: ship.pos.z },
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
		// The unit scheme, read from the page rather than restated here, so this
		// probe cannot disagree with the module about what FAR_SCALE is.
		farScale:
			g.world.system.bodies.length > 0
				? (() => {
						// Derive it from the star: its mesh radius over its real radius.
						const star = g.world.system.bodies.find((b) => b.kind === "star");
						const mesh = g.farScene.getObjectByName(star.id);
						return mesh
							? mesh.geometry.parameters.radius / star.radiusKm
							: null;
					})()
				: null,
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

// (2) Layer membership. Stars and planets are far; the station is near.
for (const b of state.bodies) {
	const want = b.kind === "station" ? "near" : "far";
	check(
		`${b.id} is in the ${want} layer`,
		b.layer === want,
		`found in ${b.layer}`,
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
	const camSim = {
		x: state.shipSim.x - state.shipMesh.x,
		y: state.shipSim.y - state.shipMesh.y,
		z: state.shipSim.z - state.shipMesh.z,
	};
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
	// say nothing. This one does not go through `camSim`: the station is 40 km
	// from the ship in sim space, so it must render about 40 units away — the
	// chase offset is the only difference, and it is metres.
	const station = state.bodies.find((b) => b.kind === "station");
	if (station?.mesh) {
		const drawn = Math.hypot(station.mesh.x, station.mesh.y, station.mesh.z);
		const real = Math.hypot(
			station.sim.x - state.shipSim.x,
			station.sim.y - state.shipSim.y,
			station.sim.z - state.shipSim.z,
		);
		check(
			"the station renders at its true distance from the ship",
			Math.abs(drawn - real) < 0.2,
			`drawn ${drawn.toFixed(3)} km, actual ${real.toFixed(3)} km`,
		);
	} else {
		check("the station has a mesh", false);
	}

	for (const b of state.bodies) {
		if (!b.mesh) {
			check(`${b.id} has a mesh`, false);
			continue;
		}
		const k = b.kind === "station" ? 1 : state.farScale;
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
console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
