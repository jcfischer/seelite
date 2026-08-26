/**
 * #59's surface pass, measured in the **live game** — not in the gallery.
 *
 *   npm run dev                             # in one shell
 *   node scripts/probe-planet-surfaces.mjs  # in another
 *
 * `tests/planet-surfaces.test.ts` owns the arithmetic: which class each
 * generated body is, that the classes come off the generator's own numbers
 * rather than a second derivation, and the detail band including its
 * hysteresis. What is left for a browser is what none of that can see.
 *
 * 1. **The live path draws the classes, and they read as different worlds.**
 *    `?planet-prototype` proved the shaders look distinct in a gallery under
 *    one lighting setup. That is not the same claim as "the game draws them",
 *    and until this node it was false — the only consumer of the shader set was
 *    the prototype route, and every body in the game was one shared
 *    `MeshStandardMaterial`.
 *
 *    Measured as a **signature**, `probe-planets.mjs`'s method: patches across
 *    the lit face, at several viewing longitudes, rather than one mean colour.
 *    A mean collapses a cratered grey moon and a smooth grey moon to the same
 *    number, and a single view collapses two worlds that differ only on the
 *    face that happened to be turned away.
 *
 *    The pass condition is a **nearest-neighbour** one and not a threshold:
 *    each body's signature must be closer to its own second view than to any
 *    other body's. A floor on a distinctness metric is a number the art then
 *    has to clear, which is how a measurement turns into a design driver; a
 *    nearest-neighbour test asks only the question the check is named after.
 *
 * 2. **Each body is lit from its own star, not from the camera.** The
 *    directional lights that light the ship and the stations are aimed from the
 *    camera towards the star, which is right for them and wrong for a planet:
 *    at astronomical separations the camera-to-star and body-to-star directions
 *    disagree by tens of degrees, and the disagreement *is* the terminator.
 *    Read off `visualOfBody`, and checked against the sim positions rather than
 *    against a screenshot, because a wrong terminator on a body nobody is
 *    looking at is invisible and still wrong.
 *
 * 3. **The star survives the bloom pass.** #59 gave the star the prototype's
 *    photosphere — granulation, the real limb-darkening law, spots — over a
 *    bloom pass whose threshold was tuned when the star was a flat
 *    `MeshBasicMaterial`. The failure that combination produces is a disc
 *    clipped to featureless white, which is invisible in a thumbnail and
 *    obvious at approach. Measured as luma spread across the star's own pixels
 *    and the fraction of them that are clipped, so "the bloom is balanced" is a
 *    number rather than an opinion.
 *
 * 4. **A frame budget per render layer.** Taken with a `readPixels` fence and
 *    not a `requestAnimationFrame` mean, which cannot report below the display
 *    refresh — 16.7 ms on a 60 Hz panel whatever the shaders cost.
 *
 *    **These are software-rasteriser figures.** The runner has no GPU, so every
 *    number below is a floor of badness rather than a player's experience.
 *    Printed rather than asserted for exactly that reason: a budget threshold
 *    tuned on SwiftShader would be a threshold about SwiftShader.
 *
 *    This section is why there is no crater detail band. One was built: it
 *    dropped the airless class's fine octave once its craters were sub-pixel.
 *    Measured here on the moon alone in the frame, in five interleaved pairs
 *    per layer, the lever moved the frame by less than the instrument's own
 *    run-to-run spread at every layer — so it was withdrawn rather than shipped
 *    as a saving nothing could demonstrate. `planet-classes.glsl.ts` carries
 *    the figures next to the code they were about. What is left here is the
 *    budget itself, which is what the next attempt has to beat.
 */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/** Seed 1, for `probe-station.mjs`'s reason: it is the start system every other
 *  probe reasons about, so a surface finding here is about the same world. */
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=1`;

const VIEW = { width: 900, height: 900 };

/** How far from a body to stand when reading its surface, in **body radii**.
 *  Close enough that the whole disc is in frame and its features are many
 *  pixels across, which is what a surface signature is asking about. */
const READ_RADII = 3;

/**
 * Viewing longitudes, radians.
 *
 * Eight rather than one, because two worlds that differ only on the hemisphere
 * turned away from the camera are two worlds — and eight rather than four
 * because four was not enough to average a terran world's faces together. Its
 * ocean face and its continental face are legitimately far apart, and at four
 * views the split-half noise on *one* body (63.1) was wider than the gap
 * between the two closest classes (39.7). The measurement was reporting its own
 * sampling rather than the surfaces.
 */
const LONGITUDES = Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4);

/** The patch grid laid across the disc. Odd, so one patch is the sub-solar
 *  point rather than four straddling it. */
const GRID = 5;

const installHelpers = (page) =>
	page.addInitScript(() => {
		/**
		 * Stand `radii` body radii off `bodyId`, on the sunward side at
		 * `longitude`, looking at it.
		 *
		 * Sunward and not arbitrary: a body viewed from its night side is a
		 * silhouette, and every class's silhouette is the same circle. The
		 * longitude then rotates the viewpoint *around* the body-star axis, so
		 * each view is lit the same and shows a different face — which is the
		 * variable the signature wants, with lighting held still.
		 */
		window.__viewBody = (bodyId, radii, longitude) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const star = g.world.system.bodies.find((b) => b.kind === "star");
			// Body → star, the same direction the surface shader is given.
			let sx = star.pos.x - body.pos.x;
			let sy = star.pos.y - body.pos.y;
			let sz = star.pos.z - body.pos.z;
			const sd = Math.hypot(sx, sy, sz) || 1;
			sx /= sd;
			sy /= sd;
			sz /= sd;
			// Any two axes perpendicular to it. Which two does not matter — the
			// longitude sweeps the whole circle they span.
			const up = Math.abs(sy) < 0.9 ? [0, 1, 0] : [1, 0, 0];
			const cross = (a, b) => [
				a[1] * b[2] - a[2] * b[1],
				a[2] * b[0] - a[0] * b[2],
				a[0] * b[1] - a[1] * b[0],
			];
			const norm = (v) => {
				const n = Math.hypot(v[0], v[1], v[2]) || 1;
				return [v[0] / n, v[1] / n, v[2] / n];
			};
			const e1 = norm(cross([sx, sy, sz], up));
			const e2 = norm(cross([sx, sy, sz], e1));
			// 55° off the body-star axis: enough of a terminator that relief and
			// atmosphere read, not so much that half the disc is unlit.
			const tilt = (55 * Math.PI) / 180;
			const c = Math.cos(tilt);
			const s = Math.sin(tilt);
			const dir = [
				sx * c +
					(e1[0] * Math.cos(longitude) + e2[0] * Math.sin(longitude)) * s,
				sy * c +
					(e1[1] * Math.cos(longitude) + e2[1] * Math.sin(longitude)) * s,
				sz * c +
					(e1[2] * Math.cos(longitude) + e2[2] * Math.sin(longitude)) * s,
			];
			const range = body.radiusKm * radii;
			g.world.ship.pos = {
				x: body.pos.x + dir[0] * range,
				y: body.pos.y + dir[1] * range,
				z: body.pos.z + dir[2] * range,
			};
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			const from = new g.nearScene.position.constructor(0, 0, -1);
			const to = new g.nearScene.position.constructor(
				-dir[0],
				-dir[1],
				-dir[2],
			);
			g.orientation.setFromUnitVectors(from.normalize(), to.normalize());
		};

		/**
		 * The body's own pixels, by difference.
		 *
		 * Rendered as drawn, then again with the body hidden; what changed is the
		 * body. `probe-station.mjs`'s method, and it is here for the same reason:
		 * a starfield puts lit pixels everywhere and the star itself is often in
		 * frame, so any absolute threshold would be tuned to one moment of one
		 * orbit.
		 */
		window.__bodySignature = (bodyId, grid) => {
			const g = window.__seelite;
			const src = g.renderer.domElement;
			const W = 300;
			const H = 300;
			const scratch = document.createElement("canvas");
			scratch.width = W;
			scratch.height = H;
			const ctx = scratch.getContext("2d", { willReadFrequently: true });
			const frame = () => {
				// Render and read in the same task: a WebGL canvas without
				// `preserveDrawingBuffer` is cleared at the next composite.
				g.render(0);
				ctx.drawImage(src, 0, 0, W, H);
				return ctx.getImageData(0, 0, W, H).data;
			};
			const mesh =
				g.nearScene.getObjectByName(bodyId) ??
				g.approachScene.getObjectByName(bodyId) ??
				g.farScene.getObjectByName(bodyId);
			const shown = frame();
			mesh.visible = false;
			const hidden = frame();
			mesh.visible = true;

			// The changed pixels, and their bounding box — the disc, without
			// projecting anything.
			let x0 = W;
			let y0 = H;
			let x1 = -1;
			let y1 = -1;
			let changed = 0;
			for (let i = 0; i < shown.length; i += 4) {
				const d =
					Math.abs(shown[i] - hidden[i]) +
					Math.abs(shown[i + 1] - hidden[i + 1]) +
					Math.abs(shown[i + 2] - hidden[i + 2]);
				if (d <= 8) continue;
				changed++;
				const p = i / 4;
				const x = p % W;
				const y = (p / W) | 0;
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
			if (changed === 0) return { pixels: 0, patches: [] };

			// A patch mean per cell of the grid laid over that box. Cells with too
			// few of the body's pixels report null rather than a number diluted by
			// whatever was behind it.
			const patches = [];
			const cw = (x1 - x0 + 1) / grid;
			const ch = (y1 - y0 + 1) / grid;
			for (let gy = 0; gy < grid; gy++) {
				for (let gx = 0; gx < grid; gx++) {
					let r = 0;
					let gg = 0;
					let b = 0;
					let n = 0;
					const px0 = Math.floor(x0 + gx * cw);
					const px1 = Math.floor(x0 + (gx + 1) * cw);
					const py0 = Math.floor(y0 + gy * ch);
					const py1 = Math.floor(y0 + (gy + 1) * ch);
					for (let y = py0; y < py1; y++) {
						for (let x = px0; x < px1; x++) {
							const i = (y * W + x) * 4;
							const d =
								Math.abs(shown[i] - hidden[i]) +
								Math.abs(shown[i + 1] - hidden[i + 1]) +
								Math.abs(shown[i + 2] - hidden[i + 2]);
							if (d <= 8) continue;
							r += shown[i];
							gg += shown[i + 1];
							b += shown[i + 2];
							n++;
						}
					}
					patches.push(n < 8 ? null : [r / n, gg / n, b / n]);
				}
			}
			return { pixels: changed, patches };
		};

		/**
		 * Hide every drawn body but one.
		 *
		 * So a cost figure has an honest denominator. A frame with the moon in it
		 * also has two gas giants and a star with a bloom pass, and "the frame got
		 * 4% cheaper" says nothing about what fraction of the *moon* that is.
		 */
		window.__soloBody = (keepId) => {
			const g = window.__seelite;
			for (const body of g.world.system.bodies) {
				const mesh =
					g.nearScene.getObjectByName(body.id) ??
					g.approachScene.getObjectByName(body.id) ??
					g.farScene.getObjectByName(body.id);
				if (mesh) mesh.visible = body.id === keepId || keepId === null;
			}
		};
	});

// The guard's default pair. This probe's own subject — `planet-surface.ts` —
// declares no top-level numeric constants, and the question the guard asks is
// "is this the same tree?", not "is my subject current".
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: VIEW });
watch(page);
installHelpers(page);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await bootedGame(page);

/* 1. Every sphere in the live scene is drawn by a class. */
const drawn = await page.evaluate(() => {
	const g = window.__seelite;
	return g.world.system.bodies.map((b) => ({
		id: b.id,
		kind: b.kind,
		radiusKm: b.radiusKm,
		visual: g.visualOfBody(b.id) ?? null,
	}));
});

const spheres = drawn.filter((b) => b.kind !== "station");
const stations = drawn.filter((b) => b.kind === "station");
check(
	"every non-station body is drawn by a surface class",
	spheres.length > 0 && spheres.every((b) => b.visual?.surface),
	`${spheres.filter((b) => b.visual?.surface).length}/${spheres.length}`,
);
check(
	"a station is not",
	stations.every((b) => b.visual === null),
	`${stations.length} stations`,
);
console.log(
	`\n  drawn: ${spheres.map((b) => `${b.id}=${b.visual?.surface}`).join(", ")}\n`,
);

/* 2. Each body is lit from its own star. */
const lighting = await page.evaluate(() => {
	const g = window.__seelite;
	const star = g.world.system.bodies.find((b) => b.kind === "star");
	return g.world.system.bodies
		.filter((b) => b.kind === "planet" || b.kind === "moon")
		.map((b) => {
			const v = g.visualOfBody(b.id);
			const dx = star.pos.x - b.pos.x;
			const dy = star.pos.y - b.pos.y;
			const dz = star.pos.z - b.pos.z;
			const d = Math.hypot(dx, dy, dz) || 1;
			// The cosine between the direction the shader was given and the
			// direction to the star from *this body*. Anything but 1 is a body lit
			// from somewhere it is not.
			return {
				id: b.id,
				cos:
					(v.sunDir.x * dx) / d + (v.sunDir.y * dy) / d + (v.sunDir.z * dz) / d,
			};
		});
});
const worstCos = Math.min(...lighting.map((l) => l.cos));
check(
	"every body's shader is lit from its own star",
	worstCos > 0.99999,
	`worst cos = ${worstCos.toFixed(6)}`,
);

/* 3. The classes read as different worlds, in the game. */
/*
 * The star is left out, and that is not an omission.
 *
 * Every view here is constructed on the body-to-star axis, which for the star
 * is the zero vector — there is no sunward side of the thing the sunlight comes
 * from, and no terminator, because a star is not lit. It is checked above like
 * every other body: it is drawn, and it is drawn by the `star` class.
 */
const lit = spheres.filter((b) => b.kind !== "star");
const signatures = [];
for (const body of lit) {
	const views = [];
	for (const longitude of LONGITUDES) {
		await page.evaluate(
			([id, radii, lon]) => window.__viewBody(id, radii, lon),
			[body.id, READ_RADII, longitude],
		);
		const sig = await page.evaluate(
			([id, grid]) => window.__bodySignature(id, grid),
			[body.id, GRID],
		);
		views.push(sig);
	}
	signatures.push({ ...body, views });
}

/**
 * A **rotation-invariant** descriptor for a set of views.
 *
 * Mean colour, and the spread of luma across the disc — colour says what the
 * world is made of, spread says whether it has features. Averaged over the
 * views rather than taken from one, and that is the whole point: the first
 * version of this check compared one face against another and failed a correct
 * build, because a terran world's Pacific face and its continental face are
 * legitimately further apart than a terran world and a moon. Face-to-face
 * variation is a property of the world, not a confusion between worlds.
 *
 * Spread is weighted up because it is the axis that carries texture, which is
 * most of what separates two bodies of similar albedo; the weight is stated
 * here rather than hidden in the numbers.
 */
const SPREAD_WEIGHT = 3;
const describe = (views) => {
	let r = 0;
	let g = 0;
	let b = 0;
	let spread = 0;
	let n = 0;
	for (const view of views) {
		const filled = view.patches.filter(Boolean);
		if (filled.length === 0) continue;
		const luma = filled.map(
			(p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2],
		);
		const mean = luma.reduce((a, c) => a + c, 0) / luma.length;
		spread += Math.sqrt(
			luma.reduce((a, c) => a + (c - mean) ** 2, 0) / luma.length,
		);
		r += filled.reduce((a, p) => a + p[0], 0) / filled.length;
		g += filled.reduce((a, p) => a + p[1], 0) / filled.length;
		b += filled.reduce((a, p) => a + p[2], 0) / filled.length;
		n++;
	}
	if (n === 0) return null;
	return [r / n, g / n, b / n, (SPREAD_WEIGHT * spread) / n];
};

const distance = (a, b) =>
	Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0));

const usable = signatures.filter((s) => s.views.every((v) => v.pixels > 400));
check(
	"every body was measured with a disc worth measuring",
	usable.length === signatures.length,
	`${usable.length}/${signatures.length} lit bodies at ${READ_RADII} radii` +
		(usable.length === signatures.length
			? ""
			: `; missed ${signatures
					.filter((s) => !usable.includes(s))
					.map((s) => s.id)
					.join(", ")}`),
);

for (const body of usable) {
	body.all = describe(body.views);
	// Interleaved halves rather than adjacent ones: each half sees four faces
	// spread right around the body, so the two descriptors are of the same world
	// seen from everywhere and their distance is the measurement's own noise
	// floor rather than a difference between two hemispheres.
	body.halfA = describe(body.views.filter((_, i) => i % 2 === 0));
	body.halfB = describe(body.views.filter((_, i) => i % 2 === 1));
}

/*
 * The claim is about **classes**, not about bodies.
 *
 * Three moons of the same class should look alike — that is the classifier
 * working, not a failure. What must hold is that the gap between two classes is
 * wider than the gap within one, so a class is a thing you can see rather than
 * a label in a struct.
 */
let worstIntra = 0;
let worstIntraLabel = "";
for (const body of usable) {
	const self = distance(body.halfA, body.halfB);
	if (self > worstIntra) {
		worstIntra = self;
		worstIntraLabel = `${body.id} against itself`;
	}
}
for (const a of usable)
	for (const b of usable) {
		if (a.id >= b.id || a.visual.surface !== b.visual.surface) continue;
		const d = distance(a.all, b.all);
		if (d > worstIntra) {
			worstIntra = d;
			worstIntraLabel = `${a.id} vs ${b.id} (both ${a.visual.surface})`;
		}
	}

let bestInter = Number.POSITIVE_INFINITY;
let bestInterLabel = "";
for (const a of usable)
	for (const b of usable) {
		if (a.id >= b.id || a.visual.surface === b.visual.surface) continue;
		const d = distance(a.all, b.all);
		if (d < bestInter) {
			bestInter = d;
			bestInterLabel = `${a.visual.surface} vs ${b.visual.surface}`;
		}
	}

console.log("\n  surface signatures (mean R,G,B and weighted luma spread)");
for (const body of usable)
	console.log(
		`    ${body.id.padEnd(18)} ${body.visual.surface.padEnd(9)} ` +
			`${body.all.map((v) => v.toFixed(1).padStart(6)).join(" ")}`,
	);

check(
	"two classes are further apart than one class is from itself",
	bestInter > worstIntra,
	`closest pair of classes ${bestInter.toFixed(1)} (${bestInterLabel}) ` +
		`vs widest within a class ${worstIntra.toFixed(1)} (${worstIntraLabel})`,
);

/* 3b. The star survives the bloom. */
const starBody = spheres.find((b) => b.kind === "star");
const starLook = await page.evaluate(
	([id, grid]) => {
		// Any direction: the star is not lit, so there is no sunward side and no
		// terminator — every view of it is the same view.
		const g = window.__seelite;
		const b = g.world.system.bodies.find((x) => x.id === id);
		const d = [0.4, 0.25, 0.88];
		const n = Math.hypot(d[0], d[1], d[2]);
		const range = b.radiusKm * 4;
		g.world.ship.pos = {
			x: b.pos.x + (d[0] / n) * range,
			y: b.pos.y + (d[1] / n) * range,
			z: b.pos.z + (d[2] / n) * range,
		};
		g.world.ship.vel = { x: 0, y: 0, z: 0 };
		const V = g.nearScene.position.constructor;
		const to = new V(-d[0] / n, -d[1] / n, -d[2] / n);
		g.orientation.setFromUnitVectors(new V(0, 0, -1), to);
		const sig = window.__bodySignature(id, grid);
		return sig;
	},
	[starBody.id, GRID],
);
const starPatches = starLook.patches.filter(Boolean);
const starLuma = starPatches.map(
	(p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2],
);
const starMean = starLuma.reduce((a, c) => a + c, 0) / starLuma.length;
const starSpread = Math.sqrt(
	starLuma.reduce((a, c) => a + (c - starMean) ** 2, 0) / starLuma.length,
);
// Clipped, not merely bright: a photosphere is supposed to be the brightest
// thing on screen. What it must not be is *flat*.
const clipped = starPatches.filter((p) => Math.min(p[0], p[1], p[2]) > 250);
check(
	"the star's photosphere survives the bloom pass",
	starSpread > 2 && clipped.length < starPatches.length / 2,
	`luma ${starMean.toFixed(0)} ± ${starSpread.toFixed(1)} across ${starPatches.length} patches, ` +
		`${clipped.length} clipped to white`,
);

/* 4. The budget, per layer, and what the detail band is worth. */
const RANGES = [
	["near (a body filling the screen)", 3],
	["approach", 60],
	["far", 4000],
];
const airless =
	spheres.find((b) => b.visual?.surface === "airless") ?? spheres[0];

console.log("\n  frame budget — software rasteriser, a floor not a forecast");
console.log(
	`  the worst class, ${airless.id}, alone in the frame and in company`,
);
for (const [label, radii] of RANGES) {
	const row = await page.evaluate(
		([id, r]) => {
			window.__viewBody(id, r, 0);
			const g = window.__seelite;
			g.render(0);
			// Alone, so the body's own cost has an honest denominator: a frame that
			// also holds two gas giants and a bloomed star cannot say what fraction
			// of it any one body is.
			window.__soloBody(id);
			const alone = [];
			for (let i = 0; i < 5; i++) alone.push(g.measureRenderMs(8));
			window.__soloBody(null);
			g.render(0);
			const whole = [];
			for (let i = 0; i < 5; i++) whole.push(g.measureRenderMs(8));
			return { alone, whole };
		},
		[airless.id, radii],
	);
	// Median and span rather than a mean: five samples on a shared machine have
	// outliers, and the span is what any later claim about a saving has to beat.
	const median = (xs) =>
		[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
	const span = (xs) => Math.max(...xs) - Math.min(...xs);
	console.log(
		`    ${label.padEnd(34)} body ${median(row.alone).toFixed(1)} ms ` +
			`(±${span(row.alone).toFixed(1)}), whole system ${median(row.whole).toFixed(1)} ms ` +
			`(±${span(row.whole).toFixed(1)})`,
	);
}

await browser.close();
exit();
