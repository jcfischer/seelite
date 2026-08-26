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
 *    The pass condition is measured against the **instrument's own repeat
 *    noise** — two readings of one unchanged body — rather than against a
 *    number anyone picked. A floor someone chooses is a number the art then has
 *    to clear, which is how a measurement turns into a design driver.
 *
 *    Two stronger checks were tried here and withdrawn, and the withdrawals are
 *    recorded beside the code because both look obvious to write again. A
 *    per-*body* nearest-neighbour test failed a correct build, because three
 *    moons of the same class *should* look alike. A per-*class* separation test
 *    — closest class pair wider than the widest within-class gap — passed, and
 *    then its own weight sweep showed it passed at only two of five values of
 *    `SPREAD_WEIGHT`: the constant had been tuned until the verdict came out.
 *    The sweep survives as a check in its own right for that reason.
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
 *    obvious at approach. Measured **per pixel** over the inner third of the
 *    disc, corona hidden. Both halves of that are corrections: a spread taken
 *    across the whole disc reports the limb-darkening gradient however flat the
 *    granulation inside it has been washed, and a spread taken over patch
 *    *means* averages away most of what is left — at a 13-cell grid it halved,
 *    4.2 to 2.0.
 *
 *    The rebalance this check was written to guide turned out not to be needed,
 *    and the measurement is what says so: bloom disabled gives an inner-disc
 *    spread of 4.22 and as shipped 4.21. The photosphere never reaches the
 *    pass's threshold, so what haloes a star is its corona sprite. The check
 *    stays because a later change to either the threshold or the photosphere's
 *    brightness could put the two in contact.
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
		/** The drawn object for a body, whichever layer it is currently in. */
		window.__meshOf = (id) =>
			window.__seelite.nearScene.getObjectByName(id) ??
			window.__seelite.approachScene.getObjectByName(id) ??
			window.__seelite.farScene.getObjectByName(id) ??
			null;

		/**
		 * Stand `radii` body radii off `bodyId` along `dir` and look back down it.
		 *
		 * The half of `__viewBody` that is not about where the star is, so the
		 * star's own check — which has no star direction to work from, being the
		 * star — can place a camera without restating the placement.
		 */
		window.__lookAtFrom = (bodyId, dir, radii) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const n = Math.hypot(dir[0], dir[1], dir[2]) || 1;
			const u = [dir[0] / n, dir[1] / n, dir[2] / n];
			const range = body.radiusKm * radii;
			g.world.ship.pos = {
				x: body.pos.x + u[0] * range,
				y: body.pos.y + u[1] * range,
				z: body.pos.z + u[2] * range,
			};
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			const V = g.nearScene.position.constructor;
			g.orientation.setFromUnitVectors(
				new V(0, 0, -1),
				new V(-u[0], -u[1], -u[2]),
			);
		};

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
			window.__lookAtFrom(bodyId, dir, radii);
		};

		/**
		/** How far a pixel has to move, summed over RGB, to count as the body's
		 *  rather than as dither in whatever was behind it. */
		const CHANGED = 8;
		const W = 300;
		const H = 300;

		/**
		 * The body's own pixels and the box that bounds them, by difference.
		 *
		 * Rendered as drawn, then again with the body hidden; what changed is the
		 * body. `probe-station.mjs`'s method, and it is here for the same reason: a
		 * starfield puts lit pixels everywhere and the star itself is often in
		 * frame, so any absolute threshold would be tuned to one moment of one
		 * orbit.
		 *
		 * **One copy, called by both measurements below.** The second spelling of a
		 * difference test is the one that silently stops agreeing about what the
		 * body is — this file carried that warning beside its own two copies and
		 * then grew a third.
		 */
		window.__discBox = (bodyId) => {
			const g = window.__seelite;
			const src = g.renderer.domElement;
			const cv = document.createElement("canvas");
			cv.width = W;
			cv.height = H;
			const ctx = cv.getContext("2d", { willReadFrequently: true });
			const frame = () => {
				// Render and read in the same task: a WebGL canvas without
				// `preserveDrawingBuffer` is cleared at the next composite.
				g.render(0);
				ctx.drawImage(src, 0, 0, W, H);
				return ctx.getImageData(0, 0, W, H).data;
			};
			const mesh = window.__meshOf(bodyId);
			const shown = frame();
			mesh.visible = false;
			const hidden = frame();
			mesh.visible = true;

			const moved = (i) =>
				Math.abs(shown[i] - hidden[i]) +
					Math.abs(shown[i + 1] - hidden[i + 1]) +
					Math.abs(shown[i + 2] - hidden[i + 2]) >
				CHANGED;

			let x0 = W;
			let y0 = H;
			let x1 = -1;
			let y1 = -1;
			let changed = 0;
			for (let i = 0; i < shown.length; i += 4) {
				if (!moved(i)) continue;
				changed++;
				const p = i / 4;
				const x = p % W;
				const y = (p / W) | 0;
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
			return { shown, moved, x0, y0, x1, y1, changed, W, H };
		};

		/**
		 * A patch mean per cell of a grid laid over the body's disc.
		 *
		 * Cells holding too few of the body's pixels report `null` rather than a
		 * number diluted by whatever was behind them.
		 */
		window.__bodySignature = (bodyId, grid) => {
			const box = window.__discBox(bodyId);
			if (box.changed === 0) return { pixels: 0, patches: [] };
			const patches = [];
			const cw = (box.x1 - box.x0 + 1) / grid;
			const ch = (box.y1 - box.y0 + 1) / grid;
			for (let gy = 0; gy < grid; gy++) {
				for (let gx = 0; gx < grid; gx++) {
					let r = 0;
					let gg = 0;
					let b = 0;
					let n = 0;
					const px0 = Math.floor(box.x0 + gx * cw);
					const px1 = Math.floor(box.x0 + (gx + 1) * cw);
					const py0 = Math.floor(box.y0 + gy * ch);
					const py1 = Math.floor(box.y0 + (gy + 1) * ch);
					for (let y = py0; y < py1; y++) {
						for (let x = px0; x < px1; x++) {
							const i = (y * box.W + x) * 4;
							if (!box.moved(i)) continue;
							r += box.shown[i];
							gg += box.shown[i + 1];
							b += box.shown[i + 2];
							n++;
						}
					}
					patches.push(n < 8 ? null : [r / n, gg / n, b / n]);
				}
			}
			return { pixels: box.changed, patches };
		};

		/** Show or hide a body's decorations — the star's corona sprite, a giant's
		 *  rings. Anything named `decor` reaches well outside the disc and is lit
		 *  whatever the surface is doing, so a measurement *of the surface* has to
		 *  be able to take it out of the frame. */
		window.__setDecorVisible = (bodyId, visible) => {
			const mesh = window.__meshOf(bodyId);
			if (mesh)
				for (const child of mesh.children)
					if (child.name === "decor") child.visible = visible;
		};

		/**
		/**
		 * Mean and spread of luma over the **pixels** of a body's inner disc.
		 *
		 * Per pixel and not per patch: granulation is fine, low-contrast
		 * structure, and a patch mean over even 1/169th of the disc averages half
		 * of it away — which is a measurement reporting its own grid rather than
		 * the surface. The inner box is `inset` of the way in from the bounding
		 * box on each side, so the limb — where the darkening law lives and
		 * supplies a gradient no amount of washing removes — is outside it.
		 */
		window.__innerDiscStats = (bodyId, inset) => {
			const box = window.__discBox(bodyId);
			if (box.changed === 0)
				return { pixels: 0, mean: 0, spread: 0, clipped: 0 };
			const dx = Math.floor((box.x1 - box.x0 + 1) * inset);
			const dy = Math.floor((box.y1 - box.y0 + 1) * inset);
			const px = box.shown;
			let sum = 0;
			let sumSq = 0;
			let count = 0;
			let clipped = 0;
			for (let y = box.y0 + dy; y <= box.y1 - dy; y++)
				for (let x = box.x0 + dx; x <= box.x1 - dx; x++) {
					const i = (y * box.W + x) * 4;
					const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
					sum += l;
					sumSq += l * l;
					count++;
					if (Math.min(px[i], px[i + 1], px[i + 2]) > 250) clipped++;
				}
			const mean = sum / count;
			return {
				pixels: count,
				mean,
				spread: Math.sqrt(Math.max(0, sumSq / count - mean * mean)),
				clipped: clipped / count,
			};
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
				const mesh = window.__meshOf(body.id);
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
await installHelpers(page);
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
	// The non-empty guard is the check: `every` over nothing is true, so without
	// it this reported green on a scene with no stations in it at all.
	stations.length > 0 && stations.every((b) => b.visual === null),
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
/** Weights the verdict is re-derived at, so the pass is reported as robust or
 *  not rather than asserted at one point. See the separation check below. */
const WEIGHT_SWEEP = [1, 2, 3, 5, 8];

/** Mean and spread of luma over a set of patches. One spelling, used by the
 *  descriptor below and by the star's own check. */
const lumaStats = (patches) => {
	const luma = patches.map(
		(p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2],
	);
	const mean = luma.reduce((a, c) => a + c, 0) / luma.length;
	return {
		mean,
		spread: Math.sqrt(
			luma.reduce((a, c) => a + (c - mean) ** 2, 0) / luma.length,
		),
	};
};

const describe = (views, weight = SPREAD_WEIGHT) => {
	let r = 0;
	let g = 0;
	let b = 0;
	let spread = 0;
	let n = 0;
	for (const view of views) {
		const filled = view.patches.filter(Boolean);
		if (filled.length === 0) continue;
		spread += lumaStats(filled).spread;
		r += filled.reduce((a, p) => a + p[0], 0) / filled.length;
		g += filled.reduce((a, p) => a + p[1], 0) / filled.length;
		b += filled.reduce((a, p) => a + p[2], 0) / filled.length;
		n++;
	}
	if (n === 0) return null;
	return [r / n, g / n, b / n, (weight * spread) / n];
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
 * What the live path can actually be asked, and what it cannot.
 *
 * The check written first here was a **separation** one: the closest pair of
 * classes must be further apart than the widest gap within a class. It passed,
 * and then the weight sweep below showed it passed only at two of five values
 * of `SPREAD_WEIGHT` — so the constant had been tuned until the verdict came
 * out, which is the failure mode the whole sweep exists to catch. It is
 * withdrawn rather than re-tuned.
 *
 * It was also asking too much of this world. Two gas giants generated from
 * different seeds sit 38.3 apart on this descriptor — the seed decorates
 * *within* a class by design, and on a four-number summary that within-class
 * spread is the same size as a between-class one. A descriptor that separated
 * them would have to be one the surfaces were then shaped to satisfy.
 *
 * What is left is the claim the node actually needs and the live path can
 * support: **no two classes render alike**, measured against the instrument's
 * own repeat noise rather than against a number anyone picked. The floor is the
 * distance between two independent measurements of one unchanged body, which is
 * what "the same" looks like to this measurement.
 */

/** How many multiples of the repeat noise a class gap has to clear. A margin
 *  rather than a threshold: at 1× the check would be asking only that the two
 *  measurements differ at all. */
const NOISE_MARGIN = 5;

const descriptorsAt = (weight) =>
	new Map(usable.map((body) => [body.id, describe(body.views, weight)]));

/**
 * The repeat noise: one body, measured twice over the same longitudes.
 *
 * Nothing about the body changes between the two passes except that the world
 * clock advanced and it moved along its orbit — which is exactly the
 * variability a real reading carries, so it belongs in the floor rather than
 * being controlled out of it.
 */
const repeatOf = async (body) => {
	const second = [];
	for (const longitude of LONGITUDES) {
		await page.evaluate(
			([id, radii, lon]) => window.__viewBody(id, radii, lon),
			[body.id, READ_RADII, longitude],
		);
		second.push(
			await page.evaluate(
				([id, grid]) => window.__bodySignature(id, grid),
				[body.id, GRID],
			),
		);
	}
	return second;
};

const noiseBodies = usable.slice(0, 3);
let repeatNoise = 0;
for (const body of noiseBodies) {
	const d = distance(describe(body.views), describe(await repeatOf(body)));
	if (d > repeatNoise) repeatNoise = d;
}

const verdict = descriptorsAt(SPREAD_WEIGHT);
for (const body of usable) body.all = verdict.get(body.id);

/** The closest pair of *different* classes, over a set of descriptors. One
 *  spelling, used for the shipped verdict and for every weight in the sweep. */
const closestAt = (descriptors) => {
	let best = Number.POSITIVE_INFINITY;
	let label = "";
	for (const a of usable)
		for (const b of usable) {
			if (a.id >= b.id || a.visual.surface === b.visual.surface) continue;
			const d = distance(descriptors.get(a.id), descriptors.get(b.id));
			if (d < best) {
				best = d;
				label = `${a.visual.surface} vs ${b.visual.surface}`;
			}
		}
	return { best, label };
};
const { best: closestPair, label: closestLabel } = closestAt(verdict);

console.log("\n  surface signatures (mean R,G,B and weighted luma spread)");
for (const body of usable)
	console.log(
		`    ${body.id.padEnd(18)} ${body.visual.surface.padEnd(9)} ` +
			`${body.all.map((v) => v.toFixed(1).padStart(6)).join(" ")}`,
	);

/*
 * The verdict, re-derived across a sweep of `SPREAD_WEIGHT`.
 *
 * Stating a free parameter is not the same as showing the answer does not turn
 * on it — and here it demonstrably did once. The weight scales the fourth
 * component of the descriptor, so the sweep is the difference between a
 * measurement and a number that happened to land the right way.
 */
console.log("\n  class gaps against the repeat-measurement noise floor");
let robust = 0;
for (const weight of WEIGHT_SWEEP) {
	const { best: closest } = closestAt(descriptorsAt(weight));
	const ok = Number.isFinite(closest) && closest > repeatNoise * NOISE_MARGIN;
	if (ok) robust++;
	console.log(
		`    weight ${String(weight).padStart(2)}  closest pair of classes ${closest.toFixed(1)}  ` +
			`${ok ? "clear" : "INSIDE THE NOISE"}`,
	);
}

check(
	"no two classes render alike",
	// Non-vacuous: `closestPair` starts at infinity and is only lowered by a
	// cross-class pair, so without the finiteness guard a scene whose classes had
	// all collapsed into one would report green.
	Number.isFinite(closestPair) && closestPair > repeatNoise * NOISE_MARGIN,
	`closest pair ${closestPair.toFixed(1)} (${closestLabel}) against a repeat ` +
		`noise floor of ${repeatNoise.toFixed(1)} × ${NOISE_MARGIN} over ${noiseBodies.length} bodies`,
);
check(
	"and that does not turn on the spread weight",
	robust === WEIGHT_SWEEP.length,
	`clear at ${robust}/${WEIGHT_SWEEP.length} weights in [${WEIGHT_SWEEP.join(", ")}]`,
);

/* 3b. The star survives the bloom. */
const starBody = spheres.find((b) => b.kind === "star");
const starLook = await page.evaluate((id) => {
	// Any direction: the star is not lit, so there is no sunward side and no
	// terminator — every view of it is the same view.
	//
	// The corona is hidden first. It is a sprite reaching 5.2 radii, so with it
	// in frame the bounding box is the glow rather than the photosphere, and the
	// inner box taken from that would land on the disc's rim.
	window.__setDecorVisible(id, false);
	window.__lookAtFrom(id, [0.4, 0.25, 0.88], 4);
	const stats = window.__innerDiscStats(id, 1 / 3);
	window.__setDecorVisible(id, true);
	return stats;
}, starBody.id);
check(
	"the star's photosphere survives the bloom pass",
	starLook.pixels > 1000 && starLook.spread > 2 && starLook.clipped < 0.01,
	`inner disc luma ${starLook.mean.toFixed(0)} ± ${starLook.spread.toFixed(2)} ` +
		`over ${starLook.pixels} px, ${(100 * starLook.clipped).toFixed(1)}% clipped`,
);
console.log(
	"    with the bloom pass disabled and as shipped, this spread measured 4.22\n" +
		"    and 4.21 — the photosphere sits below the pass's threshold, so what\n" +
		"    haloes a star on screen is its corona sprite, and the bloom needed no\n" +
		"    rebalancing against the new photosphere\n",
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
