/**
 * #59's surface pass, measured in the **live game** — not in the gallery.
 *
 *   npm run dev                             # in one shell
 *   node scripts/probe-planet-surfaces.mjs  # in another
 *
 * `tests/planet-surfaces.test.ts` owns the arithmetic: which class each
 * generated body is, that the classes come off the generator's own numbers
 * rather than a second derivation, and the shader assembly. What is left for a
 * browser is what none of that can see.
 *
 * 1. **The live path draws the classes.** `?planet-prototype` proved the
 *    shaders look distinct in a gallery. That is not the same claim as "the
 *    game draws them", and until this node it was false — the only consumer of
 *    the shader set was the prototype route.
 *
 * 2. **Each body is lit from its own star**, measured on its **night side**.
 *    The scene's directional lights aim from the camera, which is right for the
 *    ship and wrong for a planet: at astronomical separations the two
 *    directions disagree by tens of degrees, and the disagreement is the
 *    terminator. A body lit from its star is nearly black from anti-sunward;
 *    one lit from the camera is not.
 *
 * 3. **The star's photosphere survives the bloom pass**, measured per pixel on
 *    the inner third of the disc with the corona hidden, and with the pass
 *    disabled and enabled in the same pinned box. A second page covers the
 *    neutral-tinted star that `PHOTOSPHERE_LUMA` exists for.
 *
 * 4. **The class is what decides the pixels** — one body drawn as each class in
 *    turn, seed and light and camera held still. The cross-body comparison in
 *    check 1 cannot make this claim: the seed decorates *within* a class, and
 *    two gas giants differ about as much as a giant and a moon.
 *
 * 5. **A frame budget per render layer**, on the airless class, which is the
 *    expensive one. Taken with a `readPixels` fence and not a
 *    `requestAnimationFrame` mean, which cannot report below the display
 *    refresh. **Software-rasteriser figures** — the runner has no GPU — so they
 *    are printed rather than asserted against a threshold that would be a
 *    threshold about SwiftShader.
 *
 * Two habits run through the checks, both of them corrections. Every free
 * constant is **swept or reported as a measured ratio**, never declared: a
 * check whose verdict turns on a number nobody derived is a check about that
 * number, and one here was withdrawn for exactly that. And every floor is the
 * **instrument's own repeat noise** rather than a value someone picked, because
 * a picked floor is a number the art then has to clear.
 *
 * `planet-classes.glsl.ts` records what was measured and withdrawn on the cost
 * side, next to the code it concerns. It is not repeated here.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { bandMetrics } from "./lib/band-tones.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
/**
 * Seed 6, chosen for **class coverage** rather than for being the world other
 * probes reason about.
 *
 * The other probes use seed 1, and this one did too until its own class-scope
 * reporting made the cost visible: seed 1's start system draws three lit
 * classes, so five of the reachable ones could never fail a check here.
 *
 * Seed 6's start system draws six — airless, desert, iceGiant, jovian, terran
 * and venusian. Scanned rather than picked: the first two hundred seeds were
 * run through `makeWorld`, which is the path the game itself takes, and counted
 * by class; six was the most any start system drew, and no start system in that
 * range drew seven. That is a statement about two hundred seeds, not about the
 * seed space — the class *set* the shaders must cover is
 * `tests/planet-appearance.test.ts`'s to assert, and check 3c below draws every
 * one of them regardless of what any seed generates.
 *
 * That scan is not kept, because its answer is this constant — but the
 * *shipped* run prints the classes it actually found, so a claim here that
 * stops being true is contradicted by the probe's own output rather than
 * standing. It already happened once: an earlier revision named six classes for
 * a seed that drew four, because the scan behind it read `galaxy.systems[0]`
 * rather than the start system `makeWorld` picks.
 */
const URL = gameUrl(ORIGIN, { seed: 6 }, { override: process.env.PROBE_URL });

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
		/** Unit vector, and the cross product. One spelling each: the same
		 *  normalisation was written out three times in this file. */
		const norm = (v) => {
			const n = Math.hypot(v[0], v[1], v[2]) || 1;
			return [v[0] / n, v[1] / n, v[2] / n];
		};
		const cross = (a, b) => [
			a[1] * b[2] - a[2] * b[1],
			a[2] * b[0] - a[0] * b[2],
			a[0] * b[1] - a[1] * b[0],
		];

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
			const u = norm(dir);
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

		/**
		 * Stand `radii` body radii off `bodyId` on its **night** side, looking
		 * back at it.
		 *
		 * The falsifying view for "each body is lit from its own star". A shader
		 * that ignored `sunDir` — or one lit from the camera, which is what the
		 * scene's own directional lights do — draws this disc as bright as the
		 * day side. One lit from the star draws almost nothing.
		 */
		window.__viewNightSide = (bodyId, radii) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const star = g.world.system.bodies.find((b) => b.kind === "star");
			// Directly away from the star, so the whole visible hemisphere is the
			// one the star cannot see.
			window.__lookAtFrom(
				bodyId,
				[
					body.pos.x - star.pos.x,
					body.pos.y - star.pos.y,
					body.pos.z - star.pos.z,
				],
				radii,
			);
		};

		/**
		 * Stand `radii` body radii off `bodyId` on the **star's** side, looking
		 * back at it: the whole visible face lit, flat on.
		 *
		 * `__viewBody` below is 55° off that axis on purpose — a terminator is
		 * what makes relief and atmosphere read, and that is what a signature
		 * wants. It is the wrong frame for reading *banding*: with the camera and
		 * the star 55° apart, the latitudes that are both face-on and lit are a
		 * narrow lune, and #209's band profile came back with 26 of 120 bands and
		 * 271 samples in it. Here the two cones very nearly coincide, so a single
		 * cosine gate keeps most of the latitude range.
		 */
		window.__viewBodyLit = (bodyId, radii) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === bodyId);
			const star = g.world.system.bodies.find((b) => b.kind === "star");
			window.__lookAtFrom(
				bodyId,
				[
					star.pos.x - body.pos.x,
					star.pos.y - body.pos.y,
					star.pos.z - body.pos.z,
				],
				radii,
			);
		};

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
			// Decorations off for the capture, and this is the only place it is
			// spelled — every measurement in this file goes through here, so
			// hiding them in the callers instead left whichever caller was added
			// last measuring a ring or a corona. Both mistakes happened: the class
			// signatures were once taken with a ringed giant's 4.8-radius ring
			// plane in the box, and the star's with its corona sprite in it.
			window.__setDecorVisible(bodyId, false);
			// The sky's picture off for the capture too, so the body is differenced
			// against the black clear and the starfield, as it was before node
			// #433 drew the baked sky behind it. Against a lit sky the mask stops
			// being the body: wherever the night side or the limb comes within
			// `CHANGED` of the sky behind it, a pixel's membership turns on the
			// few codes the surface moves while the frame loop runs between two
			// reads, and a cell that limb crosses can hold about the 8 pixels a
			// patch needs. Measured on #433's build: one cell dropped out between
			// two reads of one class (24 filled patches, then 23), and the
			// same-class repeat read 5.6 on iceGiant and 10.0 on jovian, against
			// under 0.3 for both with the picture off. The sky is not what this
			// file measures, so it leaves the frame rather than the gate moving.
			const sky = window.__seelite.backdropScene;
			const background = sky.background;
			sky.background = null;
			const frame = window.__framePixels;
			const mesh = window.__meshOf(bodyId);
			const shown = frame();
			mesh.visible = false;
			const hidden = frame();
			mesh.visible = true;
			sky.background = background;

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
			window.__setDecorVisible(bodyId, true);
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

		/**
		 * Every lit, face-on sample of a body's surface as a `(sinLat, luma)`
		 * pair, plus the mean per latitude band.
		 *
		 * **Samples and not band means, and that distinction cost two revisions
		 * of this check.** The question #209 asks is how many *tones* a banded
		 * surface has, and every averaging step manufactures the answer. A screen
		 * row was the first spelling: `__lookAtFrom` leaves the roll wherever it
		 * falls, so a row cuts diagonally across bands and averages a belt and a
		 * zone into an intermediate that is not on the planet. Binning by true
		 * latitude fixed the axis and kept the fault — `turb` in `JOVIAN` warps
		 * the boundary by up to 0.08 in latitude at frequency 5.5, nearly half a
		 * band, so at most latitudes some longitudes are belt and some are zone,
		 * and the bin mean is the same manufactured tone. It moved 40 points
		 * between two reads 30s apart, because `zonal` slides a third of the
		 * visible cap through in that time and changes which longitudes straddle.
		 *
		 * So the samples come back individually. The band means come back too,
		 * because averaging is right for exactly one job — estimating the smooth
		 * planet-scale trend that is subtracted off — and wrong for the tones.
		 *
		 * **Latitude and not screen space.** A lattice in object space, binned by
		 * `asin(y)`, projected out to the pixel it lands on. It survives any
		 * camera roll and any obliquity, which the ringed giants have: their ring
		 * plane is the equator.
		 *
		 * **The limb and the terminator are excluded by geometry, not by an
		 * inset.** `limbDarken` and `wrappedDiffuse` in `planet-shaders.ts` put
		 * monotone ramps on the outer and the dark pixels of *every* class, and a
		 * tone histogram including them would report the shared lighting law as
		 * this class's banding. A box inset cannot remove them: the terminator is
		 * a curve across the disc, not a border of it. `minNdotV` and `minNdotL`
		 * are read off the same normals the shader is given.
		 */
		window.__latitudeBands = (bodyId, opts) => {
			const g = window.__seelite;
			const mesh = window.__meshOf(bodyId);
			if (!mesh) return { bins: [], samples: [] };
			const V3 = g.nearScene.position.constructor;

			// The camera that draws the layer this body is currently in. A body's
			// layer is its distance (`CLAUDE.md`), so it is looked up rather than
			// assumed — projecting with the wrong one puts every sample off frame
			// and reports an empty profile, which reads exactly like a body that
			// is not there.
			let root = mesh;
			while (root.parent) root = root.parent;
			const camera =
				root === g.nearScene
					? g.nearCamera
					: root === g.approachScene
						? g.approachCamera
						: g.farCamera;

			// The star direction the surface program itself is given, rather than a
			// second derivation of it. A body's shells and its surface are separate
			// materials; the one carrying `sunDir` is the one being measured.
			let sunDir = null;
			mesh.traverse((o) => {
				if (!sunDir && o.material?.uniforms?.sunDir)
					sunDir = o.material.uniforms.sunDir.value;
			});
			if (!sunDir) return { bins: [], samples: [] };

			const box = window.__discBox(bodyId);
			if (box.changed === 0) return { bins: [], samples: [] };

			const centre = mesh.localToWorld(new V3(0, 0, 0));
			const camPos = camera.getWorldPosition(new V3());
			const bins = Array.from({ length: opts.bins }, () => ({ sum: 0, n: 0 }));
			const samples = [];

			// Equal steps in sin(latitude) — equal-area bands, so a polar bin is
			// not a handful of pixels standing beside an equatorial one that has
			// thousands.
			for (let i = 0; i < opts.bins; i++) {
				const sinLat = -1 + ((i + 0.5) * 2) / opts.bins;
				const cosLat = Math.sqrt(Math.max(1 - sinLat * sinLat, 0));
				for (let j = 0; j < opts.longitudes; j++) {
					const lon = (j * 2 * Math.PI) / opts.longitudes;
					const local = new V3(
						Math.cos(lon) * cosLat,
						sinLat,
						Math.sin(lon) * cosLat,
					);
					const world = mesh.localToWorld(local.clone());
					const N = world.clone().sub(centre).normalize();
					const view = camPos.clone().sub(world).normalize();
					if (N.dot(view) < opts.minNdotV) continue;
					if (N.dot(sunDir) < opts.minNdotL) continue;
					const ndc = world.clone().project(camera);
					const x = Math.round(((ndc.x + 1) / 2) * box.W);
					const y = Math.round(((1 - ndc.y) / 2) * box.H);
					if (x < 0 || y < 0 || x >= box.W || y >= box.H) continue;
					const k = (y * box.W + x) * 4;
					// Still gated on the difference mask: a sample that projects to a
					// pixel the body did not paint is one the near clip or another
					// body took, and its luma belongs to whatever is there instead.
					if (!box.moved(k)) continue;
					// Rec. 709 luma. Belt and zone share a hue by design, so the
					// banding is carried in brightness and a per-channel profile
					// would be three noisier copies of this one.
					const luma =
						0.2126 * box.shown[k] +
						0.7152 * box.shown[k + 1] +
						0.0722 * box.shown[k + 2];
					bins[i].sum += luma;
					bins[i].n++;
					samples.push([i, luma]);
				}
			}
			return {
				samples,
				// A bin holding a handful of samples is the lit crescent running
				// out, not a band, and its mean swings with which few it caught.
				bins: bins.map((b) => (b.n >= opts.minSamples ? b.sum / b.n : null)),
			};
		};

		/**
		 * Render one frame and hand back its pixels, at the probe's own logical
		 * size rather than the canvas backing store's.
		 *
		 * **Render and read in the same task**: a WebGL canvas without
		 * `preserveDrawingBuffer` is cleared at the next composite.
		 *
		 * One copy, because there were two. `__discBox` had this sequence inline
		 * and #210's ring reading grew a second — and the second one read
		 * `domElement.width`, which on a display with a device pixel ratio above 1
		 * is not `W`. Its mask came out in device pixels while the centre it was
		 * compared against was in logical ones: 89,973 ring pixels and 0 opposed
		 * pairs, silently.
		 */
		// One scratch surface for the process, not one per read. Every caller here
		// takes two or three frames back to back, and a `W x H` backing store and
		// its 2D context per frame is real allocation for a buffer whose contents
		// `getImageData` copies out anyway.
		let scratch;
		let scratchCtx;
		window.__framePixels = () => {
			const g = window.__seelite;
			if (!scratch) {
				scratch = document.createElement("canvas");
				scratch.width = W;
				scratch.height = H;
				scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
			}
			g.render(0);
			scratchCtx.drawImage(g.renderer.domElement, 0, 0, W, H);
			return scratchCtx.getImageData(0, 0, W, H).data;
		};

		/**
		 * Set the bloom pass's strength, returning what it was.
		 *
		 * So the star check *measures* the bloom's effect rather than quoting a
		 * figure from a run nobody can repeat — the mistake this probe already
		 * had to correct once, where the crater band's numbers outlived the lever
		 * that produced them.
		 */
		window.__setBloomStrength = (strength) => {
			const pass = window.__seelite.composer.passes.find((p) =>
				p.constructor.name.includes("Bloom"),
			);
			if (!pass) return null;
			const was = pass.strength;
			pass.strength = strength;
			return was;
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
		 * Mean and spread of luma over the **pixels** of a body's inner disc.
		 *
		 * Per pixel and not per patch: granulation is fine, low-contrast
		 * structure, and a patch mean over even 1/169th of the disc averages half
		 * of it away — which is a measurement reporting its own grid rather than
		 * the surface. The inner box is `inset` of the way in from the bounding
		 * box on each side, so the limb — where the darkening law lives and
		 * supplies a gradient no amount of washing removes — is outside it.
		 *
		 * `given` overrides the bounding box. A star is a light source with a
		 * frame-wide bloom halo, so hiding it changes pixels everywhere and the
		 * difference box becomes the whole capture — which made a bloom-on and a
		 * bloom-off reading measure two different regions and compare them as if
		 * they were the same one. The caller pins the box instead.
		 */
		window.__innerDiscStats = (bodyId, inset, given) => {
			const box = given
				? { ...window.__discBox(bodyId), ...given }
				: window.__discBox(bodyId);
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
		 * A star's photosphere, read with and without the bloom pass.
		 *
		 * One spelling, called from both star pages. The sequence has four steps
		 * that all have to agree — where the camera stands, how far in the inner
		 * box is taken, that the box is **pinned with the pass off**, and that the
		 * pass is restored — and a second copy is four chances for one of them to
		 * drift.
		 *
		 * The pin is the part that is easy to get wrong: a star's bloom halo
		 * reaches the whole frame, so a box derived by hiding the star is the disc
		 * with the pass off and the entire capture with it on, and the two
		 * readings would then be of different regions compared as one.
		 */
		window.__photosphereStats = (starId, radii, inset) => {
			window.__lookAtFrom(starId, [0.4, 0.25, 0.88], radii);
			const was = window.__setBloomStrength(0);
			const box = window.__discBox(starId);
			const pinned = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 };
			const without = window.__innerDiscStats(starId, inset, pinned);
			if (was !== null) window.__setBloomStrength(was);
			const shipped = window.__innerDiscStats(starId, inset, pinned);
			return { without, shipped, hadPass: was !== null };
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

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: VIEW });
watch(page);
await installHelpers(page);
// #207's band check needs the camera at a chosen apparent size, which is what
// these two supply. Init scripts, so they go on before the navigation.
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(URL, { waitUntil: "domcontentloaded" });
await bootedGame(page);

/**
 * Wait until every cube bake has landed (#208).
 *
 * **Waited on, never driven.** Calling `render` in a loop from here does empty
 * the queue and it also blocks the page's own `requestAnimationFrame`, which
 * every timing readout in this repo is measured from. The game's loop is
 * already running; this only has to stop before it.
 *
 * Every baked assertion below is timing-dependent without it: one face is drawn
 * per frame and a system holds a dozen bakeable bodies, so `pathAt`'s two
 * frames are not remotely enough and the first read would find every body
 * procedural — a green run for the wrong reason.
 */
const settleBakes = () =>
	page.waitForFunction(
		() => window.__seelite.bakeQueue.length === 0,
		undefined,
		{
			timeout: 60_000,
		},
	);

/**
 * **There is no check here that the bake programs were pre-warmed, and the
 * reason is worth more than a check would be** (sage, PR #256, rounds 1 and 2).
 *
 * The claim is that `prewarmReliefPrograms` compiles them before the first
 * `stepBakes` does, so no shader links inside the frame that follows a jump.
 * Two attempts to gate it both measured a shader that had already been drawn
 * with: the first read its baseline after a rebake, and the second after
 * `bootedGame` — which requires frames to have run, and `Game` calls `animate`
 * before `window.__seelite` exists at all. By the time a probe can read
 * `renderer.info.programs`, the first cube faces are drawn and their programs
 * compiled either way.
 *
 * So it is not observable from here, and a third attempt would be a third
 * unfailable check. What *is* observable is the band warm-up below, whose
 * programs are compiled by later use rather than at boot — and it caught the
 * colour-space defect in #254 that this warm-up is written against.
 */
await settleBakes();

/* 2. #207's bands: the program a planet is drawn with follows its apparent size.
 *
 * Read off `userData.reliefPath`, which is what the frame loop writes, rather
 * than off the band function — a check against `reliefPathFor` would be the
 * selector agreeing with itself and would pass with the frame loop unwired.
 *
 * The camera is moved and a frame is taken between readings, because the
 * selection happens in `render` and nowhere else.
 */
{
	/**
	 * **First, before any other section moves the camera**, and that ordering is
	 * the whole of the program-count check below. Placed at the end, it read 44
	 * against 44 with the pre-warm deleted — because the three band checks above
	 * it had already compiled every variant by using them. A check that cannot
	 * fail is worse than none, and this one was verified by deleting the warm-up
	 * and watching it go red.
	 *
	 * It fetches its own subject rather than borrowing section 3's list, which is
	 * the price of running first.
	 */
	const subject = (
		await page.evaluate(() =>
			window.__seelite.world.system.bodies
				.filter((b) => b.kind !== "station" && b.kind !== "star")
				.map((b) => ({ id: b.id, radiusKm: b.radiusKm })),
		)
	).sort((a, b) => b.radiusKm - a.radiusKm)[0];
	// `id` defaults to section 2's subject — the widest sphere — and #208's own
	// checks pass the widest *bakeable* one, which in most systems is a different
	// body. One helper, because the placement, the bake settle and the two frames
	// are the same procedure whichever body is being framed.
	const pathAt = async (radii, id = subject.id) => {
		await page.evaluate(
			([body, r]) => window.__sunOffset(body, r, 60),
			[id, radii],
		);
		// A placement is a layer handoff and a handoff re-bakes (#208), so the
		// queue has to be empty before the path is read or the answer is "still
		// procedural, ask again".
		await settleBakes();
		// Two frames: one for the placement to land, one for the selector to run
		// against it. The hysteresis makes a single frame's reading depend on
		// where the camera was before, which is the thing being relied on.
		await page.evaluate(() => {
			window.__seelite.render(0);
			window.__seelite.render(0);
		});
		return page.evaluate((id) => {
			let found = null;
			for (const scene of [
				window.__seelite.nearScene,
				window.__seelite.approachScene,
				window.__seelite.farScene,
			])
				scene.getObjectByName(id)?.traverse((o) => {
					// **What is drawn, not what is compiled.** A baked body keeps the
					// relief path its procedural material carries, so reading
					// `reliefPath` alone reports `four-tap` for a body being drawn
					// from a cube — and every assertion below would be about a
					// program that is not running.
					if (o.userData?.reliefPath)
						found = o.userData.baked ? "baked" : o.userData.reliefPath;
				});
			return found;
		}, id);
	};

	const programsAtBoot = await page.evaluate(
		() => window.__seelite.renderer.info.programs?.length ?? -1,
	);

	/**
	 * **#207's bands, with #208's cube off the menu.**
	 *
	 * Not a pin: `setBakeAllowed(false)` leaves the apparent-size selector
	 * running and only removes one of the programs it may choose. A pin would
	 * switch off the thing being tested along with the thing being excluded.
	 *
	 * Without it these three reads are all `baked` — 30 and 5 radii are deep
	 * inside #208's band and 1.2 is outside it — so #207's own bands would go
	 * entirely unchecked from this round on, with the section still green.
	 */
	await page.evaluate(() => window.__seelite.setBakeAllowed(false));
	/** Put one class on one body without pinning its relief-path selector. */
	const wearClass = async (id, klass) => {
		await page.evaluate(
			([bodyId, surface]) => {
				const g = window.__seelite;
				for (const scene of [g.nearScene, g.approachScene, g.farScene])
					scene
						.getObjectByName(bodyId)
						?.traverse((o) => o.userData?.setSurfaceClass?.(surface));
			},
			[id, klass],
		);
	};
	const readClass = async (id) =>
		page.evaluate((bodyId) => {
			for (const scene of [
				window.__seelite.nearScene,
				window.__seelite.approachScene,
				window.__seelite.farScene,
			]) {
				let found = null;
				scene.getObjectByName(bodyId)?.traverse((o) => {
					if (o.userData?.surfaceClass) found = o.userData.surfaceClass;
				});
				if (found) return found;
			}
			return null;
		}, id);

	const far = await pathAt(30);
	check(
		"a planet 30 radii away is drawn with no relief at all",
		far === "none",
		`${subject.id} at 30 radii: ${far}`,
	);
	const mid = await pathAt(5);
	check(
		"at five radii it is on the screen-space path",
		mid === "screen-space",
		`${subject.id} at 5 radii: ${mid}`,
	);
	const subjectClass = await page.evaluate(
		(id) => window.__seelite.bodyVisuals.get(id)?.surface ?? null,
		subject.id,
	);
	// Kept independent of the running module: this is the accepted #224 matrix,
	// so a wrong policy table in the application makes this probe red.
	const expectedPaths = {
		terran: "screen-space",
		desert: "screen-space",
		ice: "screen-space",
		lava: "screen-space",
		venusian: "screen-space",
		airless: "four-tap",
		jovian: "screen-space",
		iceGiant: "screen-space",
	};
	if (subjectClass === null)
		throw new Error(`no surface class for ${subject.id}`);
	for (const [klass, wanted] of Object.entries(expectedPaths)) {
		await wearClass(subject.id, klass);
		const near = await pathAt(1.2);
		const worn = await readClass(subject.id);
		check(
			`${subject.id} changes to ${klass} before its relief path is read`,
			worn === klass,
			`${subject.id} asked for ${klass}, wore ${worn}`,
		);
		check(
			`a filling ${klass} planet activates its compiled ${wanted} relief path`,
			near === wanted,
			`${subject.id} as ${klass} at 1.2 radii: ${near}`,
		);
	}
	await wearClass(subject.id, subjectClass);
	// The pin, which every instrument in this repo depends on: an external write
	// must survive the frame loop. Without it `measure-planet-cost.mjs` would
	// print the selector's choice under whatever arm it thought it had set.
	await page.evaluate(() => window.__seelite.setSurfacePin("none"));
	await page.evaluate(() => {
		window.__seelite.render(0);
		window.__seelite.render(0);
	});
	const pinned = await pathAt(1.2);
	check(
		"a pinned path survives the frame loop at a size that would change it",
		pinned === "none",
		`pinned to none, framed at 1.2 radii: ${pinned}`,
	);
	await page.evaluate(() => window.__seelite.setSurfacePin(null));
	const released = await pathAt(1.2);
	check(
		"and un-pinning hands the body back to the bands",
		released === expectedPaths[subjectClass],
		`un-pinned as ${subjectClass} at 1.2 radii: ${released}`,
	);

	/**
	 * **The pre-warm did its job**, which is the half of it a comment cannot
	 * claim (sage, PR #254).
	 *
	 * A program compiled with no render target bound is keyed to a different
	 * colour space than one compiled into the composer's target, so a warm-up in
	 * the wrong place compiles variants the game never uses and leaves the real
	 * ones to compile on the first crossing — with nothing to show for it. What
	 * says otherwise is `renderer.info.programs`: if the count does not move
	 * across a full walk of the three bands, every program the walk needed was
	 * already there.
	 *
	 * The baseline is read at boot, before this section moves the camera at all.
	 * Reading it later is what made the first version of this check unfailable.
	 */
	const programsBefore = programsAtBoot;
	await pathAt(30);
	await pathAt(5);
	await pathAt(1.02);
	await pathAt(30);
	const programsAfter = await page.evaluate(
		() => window.__seelite.renderer.info.programs?.length ?? -1,
	);
	check(
		"walking every band compiles no new program — the pre-warm reached the variants the game uses",
		programsBefore > 0 && programsAfter === programsBefore,
		`${programsBefore} programs before the walk, ${programsAfter} after`,
	);

	/* #208's band, over #207's, and the cube it selects.
	 *
	 * Run inside the same section because it needs the same subject and the same
	 * "first, before anything else moves the camera" ordering — and because the
	 * lever it restores is the one the reads above switched off.
	 */
	await page.evaluate(() => window.__seelite.setBakeAllowed(true));
	/**
	 * The widest body that *can* bake, which is usually not the widest body.
	 *
	 * Section 2's subject is the largest sphere in the system and in this seed
	 * that is a jovian — a class with no cube by design. Reusing it made every
	 * check below vacuous and the section reported the vacancy as a failure,
	 * which is right but useless. A separate subject, chosen by the property the
	 * checks are about, and a **refusal** if the system has none: every system
	 * generates moons and a moon is always `airless`, so an empty answer here is
	 * a defect in the roster rather than an unlucky seed.
	 */
	const baker = await page.evaluate(() => {
		const g = window.__seelite;
		let best = null;
		let bestRadius = 0;
		for (const body of g.world.system.bodies) {
			if (!g.bodyVisuals.get(body.id)?.canBake()) continue;
			if (body.radiusKm <= bestRadius) continue;
			best = body.id;
			bestRadius = body.radiusKm;
		}
		return best;
	});
	check(
		"this system generates at least one body whose class bakes",
		baker !== null,
		`widest bakeable body: ${baker ?? "none — every body is a giant, a star or a venusian deck"}`,
	);
	if (baker !== null) {
		const bakerClass = await page.evaluate(
			(id) => window.__seelite.bodyVisuals.get(id)?.surface ?? null,
			baker,
		);
		if (bakerClass === null)
			throw new Error(`no surface class for bake subject ${baker}`);
		if (!(bakerClass in expectedPaths))
			throw new Error(
				`unexpected surface class for bake subject ${baker}: ${bakerClass}`,
			);
		const bakedFar = await pathAt(30, baker);
		check(
			"a planet 30 radii away is drawn from its cube, not from noise",
			bakedFar === "baked",
			`${baker} at 30 radii: ${bakedFar}`,
		);
		const bakedMid = await pathAt(5, baker);
		check(
			"and at five radii, where a 256 face is still under a pixel per texel",
			bakedMid === "baked",
			`${baker} at 5 radii: ${bakedMid}`,
		);
		/**
		 * **Two radii is the rung the whole node is worth**, so it is asserted
		 * rather than left to the arithmetic.
		 *
		 * The decomposition reads the procedural frame at 24.8 ms at two radii and
		 * the baked one at 5.3, device scale 2. Asserted at two and a **half**
		 * because that is inside the band and two is not: a 512 face is 1.14
		 * screen pixels per texel at two radii and crosses the tolerance at about
		 * 2.18, so a check written at the rung the ladder prints would be sitting
		 * on the threshold — green or red on the third decimal of the viewport.
		 *
		 * It is reachable at all only because the face size follows apparent size:
		 * a 256 cube gives up at about 3.69 radii. A regression that put the size
		 * back on the render layer would leave every other check here green.
		 */
		const bakedTwo = await pathAt(2.5, baker);
		check(
			"at two and a half radii, on the larger cube, it is still baked",
			bakedTwo === "baked",
			`${baker} at 2.5 radii: ${bakedTwo}, face ${await page.evaluate(
				(id) => window.__seelite.bodyVisuals.get(id).bakedFacePx(),
				baker,
			)} px`,
		);
		const bakedNear = await pathAt(1.2, baker);
		check(
			"filling the frame it is procedural again — no face size serves that rung",
			bakedNear === expectedPaths[bakerClass],
			// The finding the node's resolution question has as its answer. A 512
			// face is 11.8 screen pixels per texel at 1.02 radii and it would take
			// faces around 6,000 px to reach parity, so the band refuses rather
			// than drawing a soft planet. `tests/relief-bands.test.ts` has the
			// arithmetic; this is that arithmetic reaching the frame loop.
			`${baker} at 1.2 radii: ${bakedNear}`,
		);

		/**
		 * **The cube agrees with the program that made it**, which is the check
		 * the node asks for and the only one that can see a wrong face basis.
		 *
		 * Measured on the existing lit-face signature — patch means over a grid
		 * laid on the disc — with the bake allowed and then refused, at one rung
		 * inside the band. A flipped or rotated face would move a patch by far
		 * more than the band below; a whole-disc mean would not see it at all,
		 * which is why this is per patch.
		 *
		 * The band is **stated rather than tuned**, and the separation is measured
		 * both ways. With both arms pinned the two programs read 2.1% of the disc
		 * mean apart at four radii and 1.2% at two and a half; against a
		 * deliberately corrupted bake — a randomised `seedOffset` in the pinned
		 * bake uniforms — the same comparisons read 47.6% and 31.8%. 12% sits an
		 * order of magnitude from either side.
		 */
		const AGREEMENT = 0.12;
		/**
		 * **The shells come off and the clock is re-pinned**, or this measures the
		 * weather.
		 *
		 * A terran world's cloud deck drifts with the clock and the two arms are
		 * captured seconds apart, so the first version of this read 98.9% of the
		 * disc mean on surfaces that agree to about one per cent by pixel count —
		 * a measurement defect that looks exactly like a broken face basis.
		 * Hiding the shells removes the drift; re-pinning the clock removes the
		 * orbital motion that walks the terminator across the disc.
		 */
		const CLOCK_S = 4000;
		const setShells = async (on) =>
			page.evaluate(async (visible) => {
				const mod = await import("/src/perf-panel.ts");
				mod.setShells(
					[
						window.__seelite.nearScene,
						window.__seelite.approachScene,
						window.__seelite.farScene,
					],
					{ atmosphere: visible, clouds: visible },
				);
			}, on);
		await setShells(false);
		/**
		 * **Both arms are pinned**, and the procedural one to `four-tap` by name.
		 *
		 * The check is about the two *programs*, not about the selector, so
		 * leaving the control to the band makes it whatever the band picks — which
		 * at four radii is `screen-space`, a third program with its own coarser
		 * slope. That is what this measured for a round: 19.3% at four radii and
		 * 1.0% at two and a half, which reads as "the cube is worse further away"
		 * and is really "the control changed underneath it". `four-tap` is the
		 * reference look both the bake and this comparison are about.
		 */
		/**
		 * Place once, then capture both arms back to back.
		 *
		 * **Placing per arm was the shape and lava is why it is not** (sage,
		 * PR #256, round 4). Four of the five baked classes are static, so hiding
		 * the shells held everything that moves; lava's glow is a per-frame term
		 * by design — the cube holds the static crack network and the draw program
		 * recomputes the blackbody ramp — so wall-clock time between the two
		 * captures is a real difference in the thing being compared, amplified by
		 * two powers and then by the bloom pass on a disc whose mean luma is 51.
		 * With a placement and a bake settle between the arms it read 93.4% of the
		 * disc mean.
		 *
		 * `__startClockAt` has to come *before* the placement — it advances the
		 * world along its orbits, so pinning it afterwards moves the body out of
		 * the frame the camera was just aimed at, and the signature comes back
		 * with no comparable patches at all. So the clock is pinned once, the
		 * camera aimed once, and the only thing between the two captures is a
		 * material swap and two frames.
		 */
		const compareAt = async (radii) => {
			await page.evaluate((t) => window.__startClockAt(t), CLOCK_S);
			await page.evaluate(
				([id, r]) => window.__sunOffset(id, r, 60),
				[baker, radii],
			);
			await settleBakes();
			const capture = async (allowed) => {
				await page.evaluate(
					(pin) => window.__seelite.setSurfacePin(pin),
					allowed ? "baked" : "four-tap",
				);
				await page.evaluate(() => {
					window.__seelite.render(0);
					window.__seelite.render(0);
				});
				// Read back rather than assumed: a pin is refused on a body with no
				// complete cube, and a refused arm would print as agreement.
				const drawnWith = await page.evaluate(
					(id) => window.__seelite.bodyVisuals.get(id).surfacePath(),
					baker,
				);
				const wanted = allowed ? "baked" : "four-tap";
				if (drawnWith !== wanted)
					throw new Error(
						`the agreement check asked for "${wanted}" at ${radii} radii and ` +
							`${baker} is drawn with "${drawnWith}"`,
					);
				return page.evaluate(
					([id, grid]) => window.__bodySignature(id, grid),
					[baker, 6],
				);
			};
			return [await capture(true), await capture(false)];
		};
		/**
		 * **Four radii and two and a half, and deliberately not eight.**
		 *
		 * At eight radii the disc is about a hundred pixels across, so a sixth of
		 * it per cell is a seventeen-pixel patch and the ones at the rim are
		 * mostly limb — the means are dominated by the terminator, where a small
		 * normal difference is a large luma one. Measured on a deliberately
		 * corrupted bake, the check read 22.9% there against 20.5% for a correct
		 * one: it cannot separate them. At the two rungs below the same corruption
		 * reads 47.6% and 31.8% against 2.1% and 1.2%. The rungs are chosen from
		 * that measurement rather than from where the interesting sizes are.
		 */
		/**
		 * **Every class that bakes, not just the one this seed happened to grow.**
		 *
		 * The first version measured `baker` alone, so the figures were one class
		 * wide (sage, PR #256, round 4) — and the two classes with a compiled-in
		 * specular exponent and the one with a per-frame term through an 8-bit
		 * `aux` channel are precisely the ones whose draw program differs from the
		 * others. Lava's `aux` is the only channel in either cube that is neither
		 * a colour nor a normal, and terran's 230-power water highlight is the
		 * sharpest thing on any of these surfaces.
		 *
		 * The class is put on the body rather than a body found for each: no seed
		 * grows all five, and the panel's own class cycle is the mechanism that
		 * makes any body wear any class.
		 */
		const bakeableClasses = await page.evaluate(async () => {
			const mod = await import("/src/planet-shaders.ts");
			return [...mod.BAKEABLE_CLASSES];
		});
		check(
			"every class with a bake descriptor is covered by the comparison below",
			bakeableClasses.length > 0,
			// Derived from the roster rather than counted against a literal: the
			// set has changed once already in this node's life, when lava came out
			// of it on this very comparison.
			`${bakeableClasses.length} classes — ${bakeableClasses.join(", ")}`,
		);
		for (const surface of bakeableClasses)
			for (const radii of [4, 2.5]) {
				await wearClass(baker, surface);
				// The cube belongs to the class it was baked from, so a class swap needs
				// a re-bake before there is anything to compare against.
				await page.evaluate(
					([id, px]) => window.__seelite.rebake(id, px),
					[baker, radii > 3 ? 256 : 512],
				);
				const [withBake, without] = await compareAt(radii);
				const pairs = withBake.patches
					.map((a, i) => [a, without.patches[i]])
					.filter(([a, b]) => a && b);
				const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
				// **Against the disc's own mean, not the patch's.** A patch on the
				// terminator sits at a luma of two or three, so a difference of one
				// code is fifty per cent of it and the check reports a rounding error
				// as a broken face basis. The disc mean is the scale a difference is
				// visible against, which is what the band is trying to be about.
				const discMean =
					pairs.reduce((sum, [a, b]) => sum + (luma(a) + luma(b)) / 2, 0) /
					Math.max(pairs.length, 1);
				const offsets = pairs
					.map(([a, b]) => Math.abs(luma(a) - luma(b)))
					.sort((x, y) => x - y);
				const worst = offsets[offsets.length - 1];
				const median = offsets[Math.floor(offsets.length / 2)];
				const ratio = worst / Math.max(discMean, 1);
				const medianRatio = median / Math.max(discMean, 1);
				check(
					`${surface} agrees with its own cube on the lit face at ${radii} radii`,
					pairs.length >= 8 && ratio <= AGREEMENT,
					`${pairs.length} comparable patches, disc mean luma ${discMean.toFixed(1)},` +
						` median off by ${(medianRatio * 100).toFixed(1)}%,` +
						` worst patch off by ${worst.toFixed(1)} = ${(ratio * 100).toFixed(1)}%` +
						` against a ${(AGREEMENT * 100).toFixed(0)}% band` +
						`\n           ${pairs.map(([a, b]) => `${luma(a).toFixed(0)}/${luma(b).toFixed(0)}`).join(" ")}`,
				);
			}
		await setShells(true);
		// The class cycle above is an external write like any other; hand the body
		// back the class the generator gave it before section 3 reads one.
		await wearClass(baker, bakerClass);
		await page.evaluate(() => window.__seelite.setSurfacePin(null));

		/**
		 * **Bake twice, and the texels are identical** — the node's step 5.
		 *
		 * Read off the cube rather than off the frame, because a frame comparison
		 * would fold in the camera, the clock and the shells and could not tell a
		 * non-deterministic bake from a moved ship.
		 *
		 * Note what this **cannot** see, which is the reason
		 * `tests/planet-bake.test.ts` scans the class source for the clock as well:
		 * the bake pins `time` to 0, so a class whose animation has been frozen
		 * into a texture bakes identically every time and passes this perfectly.
		 * The planet simply stops moving.
		 */
		await pathAt(8, baker);
		// The last class-cycle cube belongs to the final class in that loop,
		// at 512px. Start both determinism arms with the restored bakerClass at
		// 256px; otherwise this compares different classes or resolutions.
		await page.evaluate((id) => window.__seelite.rebake(id, 256), baker);
		await settleBakes();
		const face = async () =>
			page.evaluate((id) => {
				const g = window.__seelite;
				let targets = null;
				for (const scene of [g.nearScene, g.approachScene, g.farScene])
					scene.getObjectByName(id)?.traverse((o) => {
						// The drawable pair is first. The queue is settled before this
						// runs, so there is never a second one — reading `[0]` rather
						// than asserting a length of one because a body mid-handoff is
						// a legitimate state and not this check's subject.
						targets = o.userData?.bakeCubes?.()[0] ?? targets;
					});
				if (!targets) return null;
				const out = {};
				for (const key of ["albedo", "normal"]) {
					const rt = targets[key];
					const buf = new Uint8Array(rt.width * rt.height * 4);
					// Face 3 rather than face 0: −Y is the one whose basis carries a
					// sign on two axes at once, so a transcription error that left the
					// positive faces right shows here.
					g.renderer.readRenderTargetPixels(
						rt,
						0,
						0,
						rt.width,
						rt.height,
						buf,
						3,
					);
					out[key] = Array.from(buf);
				}
				return out;
			}, baker);
		const first = await face();
		// **Through the game, not through the handle.** `startBake` allocates the
		// cubes and `Game.rebake` is what also puts the body on the schedule that
		// draws into them — and this check reported determinism for two rounds
		// while doing the first alone: the queue was already empty, no face was
		// ever stepped, and the second read was the *first* cube compared against
		// itself. A tautology that cannot fail is worse than no check.
		const holding = () =>
			page.evaluate((id) => {
				const g = window.__seelite;
				let n = 0;
				for (const scene of [g.nearScene, g.approachScene, g.farScene])
					scene.getObjectByName(id)?.traverse((o) => {
						n = o.userData?.bakeCubes?.().length ?? n;
					});
				return n;
			}, baker);
		await page.evaluate((id) => window.__seelite.rebake(id, 256), baker);
		const inFlight = await holding();
		await settleBakes();
		const afterPromote = await holding();
		check(
			"asking for a second bake actually starts one",
			inFlight === 2 && afterPromote === 1,
			// The guard on the check below. Two pairs while the new one fills, one
			// after it is promoted and the old is freed — so a second bake that
			// never happened, or one that leaked the pair it replaced, is named
			// here rather than passing as a clean diff.
			`${inFlight} cube pairs held while filling, ${afterPromote} after`,
		);
		const second = await face();
		const differing =
			first && second
				? ["albedo", "normal"].reduce(
						(n, k) => n + first[k].filter((v, i) => v !== second[k][i]).length,
						0,
					)
				: -1;
		check(
			"baking the same body twice writes the same texels",
			differing === 0,
			`${differing} of ${first ? first.albedo.length * 2 : 0} channel bytes differ across two bakes`,
		);
	}
}

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

/* 2. Each body is lit from its own star, measured on the pixels. */

/*
 * The renderer *writes* a per-body sun direction, and an earlier version of
 * this check read that uniform back and compared it to the same body→star
 * formula `main.ts` had just used. That confirmed an assignment, not a render:
 * `worst cos = 1.000000` for every body was the circularity showing, and a
 * shader that ignored `sunDir` entirely and drew every disc full would have
 * passed it green.
 *
 * What falsifies the claim is the **night side**. A body lit from its own star
 * is nearly black from directly anti-sunward; one lit from the camera, which is
 * what the scene's own directional lights do, or one ignoring the direction
 * altogether, is as bright from there as from anywhere.
 */
const lighting = [];
for (const body of spheres) {
	if (body.kind === "star") continue;
	await page.evaluate(
		([id, radii]) => window.__viewBody(id, radii, 0),
		[body.id, READ_RADII],
	);
	const day = await page.evaluate(
		([id, inset]) => window.__innerDiscStats(id, inset),
		[body.id, 1 / 3],
	);
	await page.evaluate(
		([id, radii]) => window.__viewNightSide(id, radii),
		[body.id, READ_RADII],
	);
	const night = await page.evaluate(
		([id, inset]) => window.__innerDiscStats(id, inset),
		[body.id, 1 / 3],
	);
	lighting.push({
		id: body.id,
		surface: body.visual.surface,
		day: day.mean,
		night: night.mean,
	});
}

console.log("\n  disc brightness, sunward face against night face");
for (const row of lighting)
	console.log(
		`    ${row.id.padEnd(18)} ${row.surface.padEnd(9)} ` +
			`day ${row.day.toFixed(0).padStart(4)}   night ${row.night.toFixed(0).padStart(4)}   ` +
			`ratio ${(row.night / Math.max(1, row.day)).toFixed(3)}`,
	);

const worstRatio = Math.max(
	...lighting.map((l) => l.night / Math.max(1, l.day)),
);
check(
	"every body's night side is dark, so it is lit from its star and not the camera",
	// A quarter is generous against a shader that ignores the direction, which
	// would land at 1.0, and slack enough for the classes that legitimately glow
	// in the dark — lava's emission and a thick atmosphere's wrapped light both
	// put real brightness past the terminator.
	lighting.length > 0 && worstRatio < 0.25,
	`worst night/day ratio ${worstRatio.toFixed(3)} over ${lighting.length} bodies`,
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
/** One body, measured once at each viewing longitude. The initial pass and the
 *  repeat pass are the same sweep, so the floor is measured by the instrument
 *  it is a floor for. */
const sweepViews = async (body) => {
	const views = [];
	for (const longitude of LONGITUDES) {
		await page.evaluate(
			([id, radii, lon]) => window.__viewBody(id, radii, lon),
			[body.id, READ_RADII, longitude],
		);
		views.push(
			await page.evaluate(
				([id, grid]) => window.__bodySignature(id, grid),
				[body.id, GRID],
			),
		);
	}
	return views;
};

const signatures = [];
for (const body of lit)
	signatures.push({ ...body, views: await sweepViews(body) });

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

/**
 * How many multiples of the repeat noise a class gap has to clear.
 *
 * At 1× the check would ask only that two classes differ at all, which is a
 * weaker claim than "render alike" implies.
 *
 * 5 is a floor on a *measured ratio*, not a tuning dial, and the difference is
 * what the sweep below prints: the gap sits at 6 to 11 times the noise across
 * every weight, so where in that range the bar is put does not decide anything.
 * An earlier revision swept this constant too, over [2, 5, 10, 20] — but those
 * were four numbers nobody derived, and reporting ✓/✗ against them said less
 * than printing the ratio does. What is worth sweeping is `SPREAD_WEIGHT`,
 * which changes the descriptor; this only changes where the line is drawn under
 * it.
 */
const NOISE_MARGIN = 5;

const descriptorsAt = (weight) =>
	new Map(usable.map((body) => [body.id, describe(body.views, weight)]));

/**
 * The repeat noise: one body, measured twice over the same longitudes.
 *
 * **This is render-repeat noise, not the spread of a real reading**, and the
 * difference is worth naming rather than claiming the stronger thing. The body
 * does move along its orbit between the passes, but `__viewBody` re-derives the
 * camera from its current position and its current body-star axis, so the
 * motion is largely normalised out and what is left is the rasteriser plus
 * whatever the clock changed in a cloud deck.
 *
 * That makes it a *floor*, in the honest direction: it is the smallest
 * difference this instrument can call a difference, so a gap that clears it by
 * the margin below has cleared something real. It is not an estimate of how far
 * two readings of the same class would sit apart across systems, and nothing
 * here claims it is.
 */
const repeatOf = (body) => sweepViews(body);

// Every measured body, not a sample of them. The floor is a *maximum* over the
// bodies it is taken from, so leaving some out can only understate it — and an
// understated floor inflates the ratio in the passing direction. A drifting
// cloud deck outside a three-body sample was exactly the case that would have
// been missed.
const noiseBodies = usable;
// The second reading is taken once and kept, so the floor can be re-derived at
// any weight from the same pixels. Re-measuring per weight would fold the
// browser's own variation into the sweep and confound the two.
for (const body of noiseBodies) body.repeat = await repeatOf(body);

/**
 * The floor, **at the weight being asked about**.
 *
 * The weight scales the descriptor's fourth component on *both* sides of the
 * comparison, so a sweep that raised the weight for the gap and left the floor
 * at `SPREAD_WEIGHT` would inflate the gap against a fixed bar — a sweep biased
 * towards passing, which is the exact failure the sweep was added to catch, and
 * which it shipped with for a round.
 */
/**
 * The worst distance between a subject's descriptor and a second reading of it.
 *
 * Both floors in this file are this reduction, and both were got wrong once the
 * same way — by taking it over too few subjects, which understates a maximum
 * and so inflates a ratio towards passing. `noiseAt` below is the same
 * reduction over readings already taken, because the cross-body floor has to be
 * re-derived at each swept weight from the same pixels; this is the form for a
 * floor measured once.
 */
const worstRepeatDistance = async (subjects, remeasure) => {
	let worst = 0;
	for (const subject of subjects) {
		const d = distance(subject.descriptor, await remeasure(subject));
		if (d > worst) worst = d;
	}
	return worst;
};

const noiseAt = (weight) => {
	let worst = 0;
	for (const body of noiseBodies) {
		const d = distance(
			describe(body.views, weight),
			describe(body.repeat, weight),
		);
		if (d > worst) worst = d;
	}
	return worst;
};
const repeatNoise = noiseAt(SPREAD_WEIGHT);

const verdict = descriptorsAt(SPREAD_WEIGHT);
for (const body of usable) body.all = verdict.get(body.id);

/** The closest pair of *different* classes, over a set of descriptors. One
 *  spelling, used for the shipped verdict and for every weight in the sweep. */
const closestPairIn = (entries) => {
	let best = Number.POSITIVE_INFINITY;
	let label = "";
	for (let i = 0; i < entries.length; i++)
		for (let j = i + 1; j < entries.length; j++) {
			if (entries[i].key === entries[j].key) continue;
			const d = distance(entries[i].descriptor, entries[j].descriptor);
			if (d < best) {
				best = d;
				label = `${entries[i].key} vs ${entries[j].key}`;
			}
		}
	return { best, label };
};
/** The cross-body form: one entry per body, keyed by its class, so two bodies
 *  of one class are skipped as a same-key pair. */
const closestAt = (descriptors) =>
	closestPairIn(
		usable.map((b) => ({
			key: b.visual.surface,
			descriptor: descriptors.get(b.id),
		})),
	);
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
	// The floor moves with the weight, because the weight scales the
	// descriptor's fourth component on *both* sides of the comparison. A fixed
	// floor inflated the gap against a fixed bar and reported a clean sweep that
	// was biased towards passing — the exact failure the sweep exists to catch,
	// shipped inside the sweep itself for one round.
	const floor = noiseAt(weight);
	const ratio = closest / Math.max(1e-9, floor);
	const ok = Number.isFinite(ratio) && ratio >= NOISE_MARGIN;
	if (ok) robust++;
	console.log(
		`    weight ${String(weight).padStart(2)}  closest pair ${closest.toFixed(1).padStart(5)}  ` +
			`floor ${floor.toFixed(2).padStart(5)}  ratio ${ratio.toFixed(1).padStart(5)}×  ` +
			`${ok ? "clear" : "BELOW THE MARGIN"}`,
	);
}

check(
	`no two of the ${new Set(usable.map((b) => b.visual.surface)).size} classes ` +
		"this system generates render alike",
	// Non-vacuous: `closestPair` starts at infinity and is only lowered by a
	// cross-class pair, so without the finiteness guard a scene whose classes had
	// all collapsed into one would report green.
	Number.isFinite(closestPair) && closestPair > repeatNoise * NOISE_MARGIN,
	`${[...new Set(usable.map((b) => b.visual.surface))].sort().join(", ")}; ` +
		`closest pair ${closestPair.toFixed(1)} (${closestLabel}) against a repeat ` +
		`noise floor of ${repeatNoise.toFixed(1)} × ${NOISE_MARGIN}, ` +
		`taken over all ${noiseBodies.length} of them`,
);
check(
	"and that does not turn on the spread weight",
	robust === WEIGHT_SWEEP.length,
	`gap stays at least ${NOISE_MARGIN}× the floor at ` +
		`${robust}/${WEIGHT_SWEEP.length} weights in [${WEIGHT_SWEEP.join(", ")}]`,
);

/* 3b. The star survives the bloom. */
const starBody = spheres.find((b) => b.kind === "star");
// Any direction: the star is not lit, so there is no sunward side and no
// terminator — every view of it is the same view.
const starLook = await page.evaluate(
	(id) => window.__photosphereStats(id, 4, 1 / 3),
	starBody.id,
);
check(
	"the star's photosphere has structure and is not clipped to white",
	starLook.without.pixels > 1000 &&
		starLook.without.spread > 2 &&
		// Both captures. The spread is the shader's own and belongs to the
		// bloom-off one; clipping is about what a player sees, so asserting it
		// only on a capture nobody ships would be measuring the wrong frame.
		starLook.without.clipped < 0.01 &&
		starLook.shipped.clipped < 0.01,
	`inner disc luma ${starLook.without.mean.toFixed(0)} ± ` +
		`${starLook.without.spread.toFixed(2)} over ${starLook.without.pixels} px ` +
		"with the bloom pass at zero strength, so the spread is the shader's own; " +
		`clipped ${(100 * starLook.without.clipped).toFixed(1)}% there and ` +
		`${(100 * starLook.shipped.clipped).toFixed(1)}% as shipped`,
);
check(
	"and the bloom pass does not cost it that structure",
	// A **direction**, not a tuned distance: the pass may add contrast, it may
	// not take contrast away. That is what caught the real defect here — a hot
	// star whose photosphere clipped flat, where the pass then washed what was
	// left from 2.77 down to 0.90 and the disc read as a lamp. The 10% is
	// measurement tolerance, not a margin anyone is choosing; on the build this
	// caught, the ratio was 0.33.
	starLook.hadPass && starLook.shipped.spread >= starLook.without.spread * 0.9,
	`spread ${starLook.without.spread.toFixed(2)} without the pass against ` +
		`${starLook.shipped.spread.toFixed(2)} as shipped, in the same pinned box ` +
		`— ratio ${(starLook.shipped.spread / starLook.without.spread).toFixed(2)}`,
);

/* 3b-ii. The neutral-tinted star, which is the case the exposure exists for. */

/*
 * `?seed=6`'s star is not the star that motivated `PHOTOSPHERE_LUMA`.
 *
 * A **saturated** tint clips one channel and keeps the others, so its
 * granulation survives whatever the exposure. A **neutral** tint clips all
 * three together, and that is the disc that read as a flat white lamp.
 *
 * `?seed=8`'s star is `0xf8f7ff`, the tint that motivated the constant.
 * Measured in its own page, because a check whose motivating case is never
 * exercised is a constant nothing defends — the figures in
 * `planet-surface.ts` describe a build this tree cannot reproduce, so this is
 * what stands in for them.
 *
 * **It was `?seed=15` until #118.** The reshape moved every system, and that
 * seed's star is now `0xffb26b` — a span of 0.580, thoroughly saturated, so
 * the check went red for having lost its subject rather than for a regression.
 * A seed picked for a generated property is a fixture that a regeneration
 * silently invalidates; re-find it by scanning `makeWorld`, never by guessing.
 */
const NEUTRAL_URL = gameUrl(
	ORIGIN,
	{ seed: 8 },
	{ override: process.env.PROBE_NEUTRAL_URL },
);
const neutralPage = await browser.newPage({ viewport: VIEW });
watch(neutralPage);
await installHelpers(neutralPage);
await neutralPage.goto(NEUTRAL_URL, { waitUntil: "domcontentloaded" });
await bootedGame(neutralPage);
const neutral = await neutralPage.evaluate(() => {
	const g = window.__seelite;
	const star = g.world.system.bodies.find((b) => b.kind === "star");
	const stats = window.__photosphereStats(star.id, 4, 1 / 3);
	return {
		...stats.without,
		colour: star.color.toString(16),
		colourInt: star.color,
	};
});
/**
 * How far apart a tint's channels may be and still count as neutral.
 *
 * The check below is only *about* anything if this star is one: a saturated
 * tint clips one channel and keeps the others whatever the exposure, so a
 * generator change that made this seed's star orange would turn this into a
 * second copy of the seed-6 check and still report green under a heading that
 * says "neutral-tinted". Asserted rather than printed, so the day that happens
 * it goes red and names the colour.
 *
 * `0xf8f7ff` spans 0.031 in sRGB; `0xffb26b`, the warm end of the ladder,
 * spans 0.58.
 */
const NEUTRAL_SPAN = 0.1;
const neutralChannels = [
	((neutral.colourInt >> 16) & 0xff) / 255,
	((neutral.colourInt >> 8) & 0xff) / 255,
	(neutral.colourInt & 0xff) / 255,
];
const neutralSpan = Math.max(...neutralChannels) - Math.min(...neutralChannels);
check(
	"a neutral-tinted star keeps its granulation too",
	neutralSpan < NEUTRAL_SPAN &&
		neutral.pixels > 1000 &&
		neutral.spread > 2 &&
		neutral.clipped < 0.01,
	`0x${neutral.colour} spans ${neutralSpan.toFixed(3)} across its channels ` +
		`(neutral under ${NEUTRAL_SPAN}): inner disc luma ${neutral.mean.toFixed(0)} ± ` +
		`${neutral.spread.toFixed(2)}, ${(100 * neutral.clipped).toFixed(1)}% clipped`,
);

/* 3c. The class is what decides the pixels. */

/*
 * The check the cross-body comparison above **cannot** make.
 *
 * Two different bodies differ for two reasons at once — their class and their
 * seed — and on this descriptor the second is as large as the first: two gas
 * giants from different seeds sit about as far apart as a giant and a moon. So
 * a build that threw the nine class shaders away and drew every body with one
 * seed-parameterised shader would produce a scene exactly as varied as this
 * one, and pass everything above green. That is not a threshold that needs
 * raising; it is the wrong comparison.
 *
 * Drawing **one body** under each class in turn holds the seed, the lighting,
 * the camera, the geometry and the range still, and leaves the class as the
 * only thing that changed. `redrawBodyAs` is display-only and puts the
 * generated class back afterwards.
 */
const CLASSES = [
	"lava",
	"venusian",
	"terran",
	"desert",
	"ice",
	"airless",
	"jovian",
	"iceGiant",
];
const subject = spheres.find((b) => b.kind === "planet") ?? lit[0];
await page.evaluate(
	([id, radii]) => window.__viewBody(id, radii, 0),
	[subject.id, READ_RADII],
);

const forced = [];
for (const surface of CLASSES) {
	const ok = await page.evaluate(
		([id, klass]) => window.__seelite.redrawBodyAs(id, klass),
		[subject.id, surface],
	);
	if (!ok) continue;
	const sig = await page.evaluate(
		([id, grid]) => window.__bodySignature(id, grid),
		[subject.id, GRID],
	);
	forced.push({ surface, descriptor: describe([sig]) });
}
// A second reading of **every** class, for this comparison's own floor. Not of
// one: `setTime` drives cloud drift, so terran, venusian and the giants move
// between readings and lava does not — a floor taken from lava alone would be
// the quietest class standing in for the noisiest, and this file already argues
// that a floor short of the compared set can only understate itself and inflate
// the ratio in the passing direction. The cross-body floor above is a different
// measurement over a different sweep and would be the wrong bar here.
const forcedFloor = await worstRepeatDistance(forced, async (row) => {
	await page.evaluate(
		([id, klass]) => window.__seelite.redrawBodyAs(id, klass),
		[subject.id, row.surface],
	);
	return describe([
		await page.evaluate(
			([id, grid]) => window.__bodySignature(id, grid),
			[subject.id, GRID],
		),
	]);
});
await page.evaluate(
	(id) => window.__seelite.redrawBodyAs(id, null),
	subject.id,
);

const { best: forcedClosest, label: forcedLabel } = closestPairIn(
	forced.map((row) => ({ key: row.surface, descriptor: row.descriptor })),
);

console.log(
	`\n  ${subject.id} drawn as each class in turn — seed, light and camera held still`,
);
for (const row of forced)
	console.log(
		`    ${row.surface.padEnd(9)} ${row.descriptor.map((v) => v.toFixed(1).padStart(6)).join(" ")}`,
	);

check(
	`all ${forced.length} classes draw the same body differently`,
	forced.length === CLASSES.length &&
		Number.isFinite(forcedClosest) &&
		forcedClosest > forcedFloor * NOISE_MARGIN,
	`closest pair ${forcedClosest.toFixed(1)} (${forcedLabel}) against a same-class ` +
		`repeat of ${forcedFloor.toFixed(1)} × ${NOISE_MARGIN}, worst over all ` +
		`${forced.length} classes`,
);

/* 3b. The jovian's bands: two tones, or many.
 *
 * #209. `gallery-jovian` showed two-tone bands with hard edges. The signature
 * above cannot see that and is not meant to — it is a mean over a fifth of the
 * disc a cell, and two tones and fifty give the same patch mean whenever the
 * bands are narrower than a cell. `__latitudeBands` carries why a screen row
 * and then a latitude *mean* both failed at it too.
 *
 * **Detrended, because two of the three things in this surface are not bands.**
 * `JOVIAN` brightens its equator and darkens a polar hood
 * (`planet-classes.glsl.ts`), and both are smooth over the whole latitude
 * range: they would fill the middle of any tone histogram on their own. The
 * trend is estimated from the band means — the one job averaging is right for —
 * by `quadraticTrend`, and subtracted from each sample at its own latitude.
 * What is left is the band structure the complaint is about. **The method's
 * history and its limits live in `lib/band-tones.mjs` and are not restated
 * here**; this comment said "smoothed wide" for a round after the moving
 * average was replaced by a fit, which is the drift a second copy buys.
 *
 * **Sarle's bimodality coefficient**, defined and tested in
 * `lib/band-tones.mjs` — 1.0 is two-point, 5/9 uniform, 1/3 normal, and the
 * threshold is the statistic's rather than this repo's. Not restated further
 * here. It is scale-free by construction, which the two metrics it replaced
 * were not — both normalised the residual by its own extremes, which is a
 * control taken from inside the arm.
 *
 * **The control is a repeat, not a second surface.** Three seconds of world
 * time: `zonal` advects at 0.020, so the surface has barely moved and what the
 * two reads differ by is the instrument. Thirty seconds was tried and is a
 * different stretch of the planet — it moved the earlier metric by 40 points
 * and told us nothing about repeatability. A reading of exactly zero is **not**
 * treated as a broken clock — that is what this said for a round, and the
 * observation does not support it: a tone distribution can be invariant under a
 * longitude advection while the clock works, because the bands slide and the
 * histogram of them does not. Only the upper end is asserted; see the check.
 */
// Close enough that a band is many samples rather than a few. The signature
// sweep above stands at READ_RADII for a different question, and is restored.
const BAND_RADII = 2;
const BAND_BINS = 240;
const BAND_LONGITUDES = 192;
const BAND_MIN_SAMPLES = 8;
// Well inside the limb and the terminator, where the shared lighting laws own
// the gradient rather than the class. Read against `__viewBodyLit`, where the
// view and star cones very nearly coincide, so one gate does most of both jobs.
const BAND_MIN_NDOTV = 0.45;
const BAND_MIN_NDOTL = 0.45;
// Below this the reading is the lit crescent running out rather than a surface.
const BAND_MIN_RESIDUAL_SAMPLES = 400;
// Seconds of world time between the two control reads.
const BAND_CONTROL_DT = 3;
// Sarle's, for a uniform distribution. Stated by the statistic, not by this
// repo: at or above it the tones are as clustered as two-point, below it they
// are at least as spread as uniform.
const BIMODALITY_CEILING = 5 / 9;
// A repeat that moves the coefficient by more than this is an instrument whose
// noise is comparable to what it reports, and the reading below is not a fact
// about the build.
const BIMODALITY_NOISE_CEILING = 0.05;

await page.evaluate(
	([id, radii]) => window.__viewBodyLit(id, radii),
	[subject.id, BAND_RADII],
);
const jovianProfile = async () => {
	await page.evaluate(
		([id, klass]) => window.__seelite.redrawBodyAs(id, klass),
		[subject.id, "jovian"],
	);
	const raw = await page.evaluate(
		([id, opts]) => window.__latitudeBands(id, opts),
		[
			subject.id,
			{
				bins: BAND_BINS,
				longitudes: BAND_LONGITUDES,
				minSamples: BAND_MIN_SAMPLES,
				minNdotV: BAND_MIN_NDOTV,
				minNdotL: BAND_MIN_NDOTL,
			},
		],
	);
	return bandMetrics(raw, { minSamples: BAND_MIN_RESIDUAL_SAMPLES });
};

const jovianA = await jovianProfile();
await page.evaluate((dt) => {
	window.__seelite.world.gameTime += dt;
}, BAND_CONTROL_DT);
const jovianB = await jovianProfile();
await page.evaluate(
	(id) => window.__seelite.redrawBodyAs(id, null),
	subject.id,
);
await page.evaluate(
	([id, radii]) => window.__viewBody(id, radii, 0),
	[subject.id, READ_RADII],
);

check(
	"the forced jovian lands enough of its surface to read tones off",
	Boolean(jovianA?.b) && Boolean(jovianB?.b),
	jovianA
		? `${jovianA.samples} detrended samples over ${jovianA.covered} of ` +
				`${BAND_BINS} latitude bands`
		: `too little of the disc was lit and face-on at ${BAND_RADII} radii`,
);

if (jovianA?.b && jovianB?.b) {
	const noise = Math.abs(jovianA.b - jovianB.b);
	console.log(
		`\n  ${subject.id} drawn as jovian at ${BAND_RADII} radii — ` +
			`${jovianA.samples} samples over ${jovianA.covered} latitude bands, detrended`,
	);
	console.log(
		`    bimodality ${jovianA.b.toFixed(3)} / ${jovianB.b.toFixed(3)}` +
			`   residual sd ${jovianA.sd.toFixed(2)} / ${jovianB.sd.toFixed(2)}`,
	);

	/*
	 * **This is a repeatability bound, and it is not a clock check.**
	 *
	 * It read as one for a round: the zero branch said "the clock is not reaching
	 * the surface program", which the observation does not support. What is
	 * measured is one aggregate coefficient before and after a longitude
	 * advection, and a tone distribution can be invariant under that while the
	 * clock works perfectly — the bands slide and the histogram of them does not
	 * move. So a zero here is a fact about the statistic and not a diagnosis of
	 * the renderer, and it is no longer a failure.
	 *
	 * What the check is for is the upper end: a coefficient that swings by more
	 * than the ceiling between two reads of the same build is one whose noise is
	 * comparable to anything it might report, and no number taken from it means
	 * much. That end is the assertion.
	 */
	check(
		"two reads of the same build agree",
		noise <= BIMODALITY_NOISE_CEILING,
		`${BAND_CONTROL_DT}s of world time moved the coefficient by ` +
			`${noise.toFixed(3)}, against a ceiling of ${BIMODALITY_NOISE_CEILING}` +
			(noise === 0
				? " — an exact repeat, which is what a translation-invariant tone " +
					"distribution gives and is not evidence about the clock"
				: ""),
	);

	/*
	 * **Reported, not gated, and the reason is that it measures the wrong
	 * thing.**
	 *
	 * This was a check against 5/9, the uniform value, on the reasoning that a
	 * two-tone surface approaches 1.0 and a graded one falls away from it. Two
	 * measurements killed the gate. Under the *corrected* detrend the shipped
	 * build of #209 reads 0.541 and the build it replaced reads **0.261** — so
	 * the threshold passes the surface the principal called two-tone and nearly
	 * fails the one that replaced it. Sarle's is `(skew² + 1) / kurtosis`, and a
	 * dominant tone with a thin tail of dark bands is *skewed* rather than
	 * bimodal, which is exactly what the shipped surface is and what lifts its
	 * coefficient.
	 *
	 * So the statistic answers a real question about a distribution and not the
	 * question the node asked, and a gate on it would fail the wrong builds. It
	 * is left printing, because the reading is repeatable to 0.004 and a later
	 * node arguing about band tones should have the number in front of it — but
	 * whether these bands read as two tones is settled on the contact sheet by a
	 * person, which is what `CLAUDE.md`'s third tier is for.
	 *
	 * `BIMODALITY_CEILING` stays as the printed reference point rather than as a
	 * pass condition. `tests/band-tones.test.ts` still gates the *statistic* —
	 * that it rejects constructed two-tone input and reproduces 5/9 on uniform —
	 * which is a claim about the instrument and is checkable.
	 */
	console.log(
		`    reference: uniform is ${BIMODALITY_CEILING.toFixed(3)}, two-point 1.0, ` +
			"normal 0.333 — reported, not gated; see the comment above",
	);
}

/* Node #213: actual linear albedo and normal outputs, held against the parent
 * shader with identical geometry, seed and face-on sampling. Bands below are
 * derived from the seeded corpus; they do not include lighting or tone mapping.
 */
const airlessAlbedo = await page.evaluate(async () => {
	const { airlessAlbedoReadings } = await import(
		"/scripts/lib/airless-albedo.mjs"
	);
	return airlessAlbedoReadings(window.__seelite);
});
for (const row of airlessAlbedo) {
	check(
		`airless seed ${row.seed} has greater albedo variance than the parent`,
		Number.isFinite(row.ratio) && row.ratio >= 1.5 && row.ratio <= 3.5,
		`${row.samples} lit-face samples: ${row.beforeVariance.toFixed(6)} → ${row.afterVariance.toFixed(6)}, ratio ${row.ratio.toFixed(2)} (band 1.5–3.5)`,
	);
	check(
		`airless seed ${row.seed} has dark flat basin floors beside crater relief`,
		// Seed 0's control is already almost level (tilt 0.003), so an absolute
		// roughness floor of 0.01 failed on its location, not on the flattening.
		// Require the rendered floor to lose 98% of its own control's slope and
		// require that control to be nonzero; a shader with no relief fails both.
		row.floorRatio < 0.65 &&
			row.floorTilt < row.craterTilt * 0.02 &&
			row.craterTilt > 0.0001,
		`floor/highland albedo ${row.floorRatio.toFixed(3)}, normal tilt ${row.floorTilt.toFixed(5)} / ${row.craterTilt.toFixed(3)}`,
	);
	check(
		`airless seed ${row.seed} rays brighten albedo without changing relief`,
		row.rayPixels > 40 && row.rayNormalDelta < 0.00001,
		`${row.rayPixels} bright ejecta samples; normal delta ${row.rayNormalDelta}`,
	);
}
const [seedA, seedB] = airlessAlbedo;
const basinShift = Math.min(
	...seedA.basins.map((a) =>
		Math.min(
			...seedB.basins.map((b) =>
				Math.hypot(...a.slice(0, 3).map((v, i) => v - b[i])),
			),
		),
	),
);
check(
	"two airless seeds put their measured basin floors in different directions",
	basinShift > 0.1 && seedA.floorRatio < 0.65 && seedB.floorRatio < 0.65,
	`seeds ${seedA.seed}/${seedB.seed}: closest centre chord ${basinShift.toFixed(3)}, both floor readings dark and flat`,
);

/* 4. The budget, per layer, on the class that costs the most. */
const RANGES = [
	["near (a body filling the screen)", 3],
	["approach", 60],
	["far", 4000],
];

// The airless class is the expensive one (`planet-classes.glsl.ts`: 135 cell
// tests per fragment per impact octave), so a budget taken anywhere else is a
// budget about some other question. Checked rather than assumed: an earlier
// revision fell back to whatever body came first and reported the *star* under
// a heading that said "the worst class".
const airless = spheres.find((b) => b.visual?.surface === "airless");
check(
	"the budget is taken on the class that costs the most",
	Boolean(airless),
	airless
		? `${airless.id} is airless, the crater-bearing class`
		: `${URL} draws no airless body — the figures below would be about some ` +
				"other class and are not worth reading",
);

if (airless) {
	console.log("\n  frame budget — software rasteriser, a floor not a forecast");
	console.log(`  ${airless.id} (airless), alone in the frame and in company`);
	for (const [label, radii] of RANGES) {
		const row = await page.evaluate(
			([id, r]) => {
				window.__viewBody(id, r, 0);
				const g = window.__seelite;
				g.render(0);
				// Alone, so the body's own cost has an honest denominator: a frame
				// that also holds gas giants and a bloomed star cannot say what
				// fraction of it any one body is.
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
		// Median and span rather than a mean: five samples on a shared machine
		// have outliers, and the span is what any later claim about a saving has
		// to beat.
		const median = (xs) =>
			[...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
		const span = (xs) => Math.max(...xs) - Math.min(...xs);
		console.log(
			`    ${label.padEnd(34)} body ${median(row.alone).toFixed(1)} ms ` +
				`(±${span(row.alone).toFixed(1)}), whole system ${median(row.whole).toFixed(1)} ms ` +
				`(±${span(row.whole).toFixed(1)})`,
		);
	}
}

/* #210. A ringed body's two shadows, each with its own control.
 *
 * **On its own page and its own seed.** The seed this probe runs on generates a
 * ringed ice giant, and it is the wrong one for half of #210: its sun stands
 * 63.6° above the ring plane, where the ring's shadow misses the sphere
 * entirely. Seed 5's giant is at 27.8°, which is the same reason
 * `scripts/lib/view-set.mjs` frames its `ringed-giant` view there.
 *
 * **Neither check drives `sunDir`, and that is deliberate.** The frame loop
 * writes it per body inside `render` (`main.ts`), so a probe that assigned it
 * and then rendered would measure its own assignment being overwritten — the
 * trap `main.ts` already records for the vignette dial. Each check is built on
 * a control the loop does not touch.
 */
{
	const RING_URL = gameUrl(
		ORIGIN,
		{ seed: 5 },
		{ override: process.env.PROBE_RING_URL },
	);
	const RING_BODY = process.env.PROBE_RING_BODY ?? "planet-6";
	const ringPage = await browser.newPage({ viewport: VIEW });
	watch(ringPage);
	await installHelpers(ringPage);
	await installViewPlacement(ringPage);
	await installViewFraming(ringPage);
	await ringPage.goto(RING_URL, { waitUntil: "domcontentloaded" });
	await bootedGame(ringPage);
	await ringPage.waitForFunction(
		() => window.__seelite.bakeQueue.length === 0,
		undefined,
		{ timeout: 60_000 },
	);
	await ringPage.evaluate(([id]) => window.__sunOffset(id, 6, 90), [RING_BODY]);

	/**
	 * **The planet's shadow on its ring has no check here, and four were built.**
	 *
	 * Not an omission to close later. Every one of them passed on a build where
	 * the term is provably dead — `main` before this node, where the eclipse
	 * compared a world-unit distance against the literal `1.0` while a body is
	 * drawn at `radiusKm × layerFactor` — and two of them passed *harder* there
	 * than on the fixed build, which is the shape of a measurement reporting
	 * something other than its subject. They are recorded because the next
	 * attempt should not be the fifth of these.
	 *
	 * 1. **Point symmetry of the ring.** A ring's material is a function of its
	 *    radius alone, so the drawn ring looks like it must be symmetric about
	 *    the body's centre and the eclipse the one term that breaks it. An
	 *    inclined annulus in *perspective* does not project to a conic centred on
	 *    the body's image. Dead build 92.8% of opposed pairs past 0.6x, fixed
	 *    build 62.4%.
	 * 2. **The same, with pairs straddling the disc excluded** — the ring's near
	 *    half is drawn over a planet that is lit on one side. 92.8% to 90.8%.
	 * 3. **The same again, with the bloom off** — the ring is semi-transparent
	 *    and the halo reaches through it. 90.8%, unmoved.
	 * 4. **The fraction of ring pixels under half the ring's own 90th
	 *    percentile.** Dead build 55.5%, fixed build 20.3% — inverted, because
	 *    removing the shadow *raises* the percentile the population is measured
	 *    against.
	 *
	 * A fifth arm was designed and blocked: set the body's `radiusKm` to 0.6 km,
	 * where the old world-unit threshold falls inside the ring's annulus, and
	 * assert the two arms agree — a direct test of the invariant the fix
	 * establishes, on state `render` reads fresh rather than rewrites. At that
	 * radius the body draws nothing at all and the mask comes back empty, which
	 * is its own question and not this node's.
	 *
	 * What does hold this direction is the canonical view set: `ringed-giant`
	 * moved 5.07% of its pixels past 24/255 between the two builds, against
	 * 0.00% on a same-build control run of the same view — the only row in the
	 * sheet whose change the control does not reproduce. Plus
	 * `tests/planet-surfaces.test.ts`, which holds that the divisor is in the
	 * source. Neither is a pixel check of the shadow, and saying so is better
	 * than a green row that means nothing.
	 */

	/**
	 * The ring's shadow on the planet, against the one control the frame loop
	 * does not overwrite: the ring's **own radii**.
	 *
	 * `innerR` and `outerR` are set once at build and read by the shadow's
	 * plane-annulus test. Pushing them out past anything a sun ray can reach
	 * removes the shadow and changes nothing else — same camera, same sun, same
	 * surface program — so the difference between the two frames is the term and
	 * only the term. The ring itself is hidden throughout, so its own pixels are
	 * not in the comparison, and the radii are put back afterwards.
	 *
	 * On a build with no ring shadow the two frames are **identical**, which is
	 * why this reads a count rather than a ratio: there is no threshold to argue
	 * about, and 0 is what `main` returns.
	 */
	const band = await ringPage.evaluate((id) => {
		const g = window.__seelite;
		const visual = g.bodyVisuals.get(id);
		if (!visual) return null;
		const u = visual.uniforms;
		const frame = window.__framePixels;
		window.__setDecorVisible(id, false);
		const withRing = frame();
		const inner = u.innerR.value;
		const outer = u.outerR.value;
		u.innerR.value = 50;
		u.outerR.value = 60;
		const withoutRing = frame();
		u.innerR.value = inner;
		u.outerR.value = outer;
		window.__setDecorVisible(id, true);

		const luma = (px, i) =>
			0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
		let darkened = 0;
		let brightened = 0;
		let deepest = 0;
		for (let i = 0; i < withRing.length; i += 4) {
			const d = luma(withoutRing, i) - luma(withRing, i);
			if (d > 4) darkened++;
			else if (d < -4) brightened++;
			if (d > deepest) deepest = d;
		}
		return { darkened, brightened, deepest };
	}, RING_BODY);

	check(
		"the ringed body has a visual to read the ring's radii off",
		band !== null,
		band === null ? `no bodyVisual for ${RING_BODY}` : "found",
	);
	if (band) {
		console.log(
			`    ring shadow on the disc: ${band.darkened} px darkened, ` +
				`${band.brightened} brightened, deepest ${band.deepest.toFixed(0)}/255`,
		);
		check(
			// **The floor is a guard, not the claim.** What discriminates is that a
			// build without the term draws the two frames *identically* and this
			// reads exactly 0 — there is no threshold to argue about. 500 sits far
			// above what antialiasing on a moved edge could produce and far below
			// the 2,862 px a shipped run measures at this framing, so a band that
			// shrank by four fifths would still pass and a band that vanished
			// could not.
			"the ring lays a band across the planet",
			band.darkened > 500,
			`${band.darkened} px darken when the ring's radii are within reach ` +
				`(${band.brightened} brighten, which is antialiasing and should be near 0)`,
		);
		// The term may only ever remove light. A band that brightens the disc is
		// a sign error, and it would read as "a change" to the row above.
		check(
			"the ring's shadow only ever darkens",
			band.brightened < band.darkened / 20,
			`${band.brightened} brightened against ${band.darkened} darkened`,
		);
	}
	await ringPage.close();
}

/* #211. The selected surface has a half-size target, while its full-size
 * geometry writes the depth and edge. Compare the equatorial limb with the
 * same frame drawn at full resolution, keeping the clock and placement fixed. */
{
	// Earlier surface/class probes deliberately hide and replace live objects.
	// Use a fresh game so this row measures the shipped scene.
	const halfPage = await browser.newPage({ viewport: VIEW });
	watch(halfPage, "half-resolution");
	await installHelpers(halfPage);
	await installViewPlacement(halfPage);
	await installViewFraming(halfPage);
	await halfPage.goto(URL, { waitUntil: "domcontentloaded" });
	await bootedGame(halfPage);
	const subject = await halfPage.evaluate(
		() =>
			window.__seelite.world.system.bodies.find(
				(body) =>
					window.__seelite.bodyVisuals.get(body.id)?.surface === "terran",
			)?.id,
	);
	check(
		"the half-resolution limb fixture has a terran body",
		Boolean(subject),
		String(subject),
	);
	if (subject) {
		const result = await halfPage.evaluate(async (id) => {
			const game = window.__seelite;
			game.settings.set("quality", "high");
			await window.__sunOffset(id, 2.5, 60);
			const fullSize = [
				game.renderer.domElement.width,
				game.renderer.domElement.height,
			];
			// Read at the full drawing-buffer size. The shared __framePixels helper
			// downsamples to 300 px, below the 450 px half target, and would hide a
			// one-pixel stair-step at the actual limb.
			const scratch = document.createElement("canvas");
			scratch.width = fullSize[0];
			scratch.height = fullSize[1];
			const context = scratch.getContext("2d", { willReadFrequently: true });
			const frame = () => {
				game.render(0);
				context.drawImage(game.renderer.domElement, 0, 0);
				return Uint8ClampedArray.from(
					context.getImageData(0, 0, scratch.width, scratch.height).data,
				);
			};
			game.setPlanetHalfResAllowed(false);
			const full = frame();
			const fullTarget = game.planetHalfResState();
			game.setPlanetHalfResAllowed(true);
			const half = frame();
			const halfTarget = game.planetHalfResState();
			const group = game.meshes.get(id);
			group.visible = false;
			const background = frame();
			group.visible = true;
			const w = fullSize[0];
			const cx = Math.floor(w / 2);
			const cy = Math.floor(fullSize[1] / 2);
			const body = game.world.system.byId.get(id);
			const ship = game.world.ship.pos;
			const distance = Math.hypot(
				body.pos.x - ship.x,
				body.pos.y - ship.y,
				body.pos.z - ship.z,
			);
			const focal = cy / Math.tan((game.approachCamera.fov * Math.PI) / 360);
			const radius =
				(focal * body.radiusKm) /
				Math.sqrt(distance * distance - body.radiusKm * body.radiusKm);
			const contrast = (x, y) => {
				const i = (y * w + x) * 4;
				return (
					Math.abs(full[i] - background[i]) +
					Math.abs(full[i + 1] - background[i + 1]) +
					Math.abs(full[i + 2] - background[i + 2])
				);
			};
			let changedInterior = 0;
			for (let yy = cy - 210; yy < cy - 30; yy++) {
				for (let xx = cx - 120; xx < cx + 120; xx++) {
					const i = (yy * w + xx) * 4;
					const difference = Math.max(
						Math.abs(full[i] - half[i]),
						Math.abs(full[i + 1] - half[i + 1]),
						Math.abs(full[i + 2] - half[i + 2]),
					);
					if (difference > 2) changedInterior++;
				}
			}
			let fullStep = 0;
			let halfStep = 0;
			let extraStep = 0;
			const rows = [];
			for (const fraction of [-0.7, -0.4, -0.2, 0, 0.2]) {
				const y = Math.round(cy + fraction * radius);
				const expectedEdge = Math.round(
					cx - Math.sqrt(radius * radius - (y - cy) * (y - cy)),
				);
				let edge = -1;
				// Walk out from the planet interior; isolated background stars
				// cannot masquerade as the first visible atmosphere pixel.
				for (let x = cx; x >= 3; x--) {
					if (
						contrast(x, y) < 10 &&
						contrast(x - 1, y) < 10 &&
						contrast(x - 2, y) < 10
					) {
						edge = x + 1;
						break;
					}
				}
				rows.push({ y, expectedEdge, edge, centerContrast: contrast(cx, y) });
				if (edge < 8) continue;
				// Cover the atmosphere's first visible edge through the solid
				// sphere's limb, then compare the same channel at the same pixel.
				for (let x = edge - 8; x <= edge + 80; x++) {
					const a = (y * w + x) * 4;
					const b = a + 4;
					for (let channel = 0; channel < 3; channel++) {
						const f = Math.abs(full[a + channel] - full[b + channel]);
						const h = Math.abs(half[a + channel] - half[b + channel]);
						fullStep = Math.max(fullStep, f);
						halfStep = Math.max(halfStep, h);
						extraStep = Math.max(extraStep, h - f);
					}
				}
			}
			return {
				fullTarget,
				halfTarget,
				fullSize,
				changedInterior,
				centerContrast: contrast(cx, cy),
				rows,
				fullStep,
				halfStep,
				extraStep,
			};
		}, subject);
		check(
			"the selected planet surface target is half the drawing buffer",
			!result.fullTarget.engaged &&
				result.halfTarget.engaged &&
				result.halfTarget.targetWidth === Math.ceil(result.fullSize[0] / 2) &&
				result.halfTarget.targetHeight === Math.ceil(result.fullSize[1] / 2),
			JSON.stringify({ full: result.fullTarget, half: result.halfTarget }),
		);
		check(
			"the half-resolution arm changes visible planet surface pixels",
			result.changedInterior > 100,
			`${result.changedInterior} changed interior pixels`,
		);
		check(
			"the full-size limb adds no step above 32 display codes per channel",
			result.centerContrast > 100 &&
				result.rows.length === 5 &&
				result.rows.every((row) => row.edge > 8 && row.centerContrast > 30) &&
				result.extraStep <= 32,
			`center contrast ${result.centerContrast}, rows ${JSON.stringify(result.rows)}, full ${result.fullStep}, half ${result.halfStep}, extra ${result.extraStep} (max channel code)`,
		);
		const lowAtSmallDisc = await halfPage.evaluate(async (id) => {
			const game = window.__seelite;
			await window.__sunOffset(id, 3.5, 60);
			game.settings.set("quality", "high");
			game.render(0);
			const high = game.planetHalfResState();
			game.settings.set("quality", "low");
			game.render(0);
			const low = game.planetHalfResState();
			return { high, low };
		}, subject);
		check(
			"Low uses the half target for a small approach-layer disc",
			!lowAtSmallDisc.high.engaged && lowAtSmallDisc.low.engaged,
			JSON.stringify(lowAtSmallDisc),
		);
	}
	await halfPage.close();
}

/* 7. Cloud shadow on the ground (node #212).
 *
 * With clouds forced to a single blob at a known direction, the surface pixel
 * under it is darker than the same pixel with clouds off by a banded ratio;
 * the shells are hidden identically in both arms, so the measured difference
 * comes from the ground shadow, not from changing the cloud shell's opacity.
 *
 * Both four-tap and baked programs are measured. Every baked arm requests a
 * new cube after changing cloudCover, waits for it, and reads the drawn path
 * back. A procedural fallback cannot stand in for a broken bake.
 *
 * Hide the shells while reading the ground, so changing cloudCover cannot
 * change these pixels by removing the translucent deck itself. The test blob
 * is supplied by cloudTestDir; the camera and clock stay fixed between arms.
 */
{
	const shadowPage = await browser.newPage({ viewport: VIEW });
	watch(shadowPage);
	await installHelpers(shadowPage);
	await installViewPlacement(shadowPage);
	await installViewFraming(shadowPage);
	await shadowPage.goto(URL, { waitUntil: "domcontentloaded" });
	await bootedGame(shadowPage);

	const subject = await shadowPage.evaluate(async () => {
		const g = window.__seelite;
		// Find a terran body.
		const terran = g.world.system.bodies.find(
			(b) => g.bodyVisuals.get(b.id)?.surface === "terran",
		);
		if (!terran) return null;

		const vis = g.bodyVisuals.get(terran.id);
		const uniforms = vis.uniforms;
		const saved = {
			id: terran.id,
			cover: uniforms.cloudCover.value,
			testDir: uniforms.cloudTestDir.value.toArray(),
			held: g.clockHeld,
			shells: [],
		};
		for (const scene of [g.nearScene, g.approachScene, g.farScene])
			scene.traverse((o) => {
				if (o.userData?.shell)
					saved.shells.push({ uuid: o.uuid, visible: o.visible });
			});
		const mod = await import("/src/perf-panel.ts");
		mod.setShells([g.nearScene, g.approachScene, g.farScene], {
			atmosphere: false,
			clouds: false,
		});
		await window.__startClockAt(4000);
		// Hold simulation, while leaving rAF/render running to finish the cubes.
		g.clockHeld = true;

		// Place camera on the sun side, looking at the lit surface.
		await window.__sunOffset(terran.id, 3, 55);
		g.render(0);
		g.render(0);

		// The fixture lives in the rotating weather frame, rather than world space.
		const angle = (uniforms.time.value * 0.003) % (Math.PI * 2);
		const dir = uniforms.cloudSunDir.value.clone();
		dir.applyAxisAngle({ x: 0, y: 1, z: 0 }, angle);
		uniforms.cloudTestDir.value.copy(dir);
		return saved;
	});

	if (!subject) {
		check(
			"seed 6 has a terran body for the cloud shadow test",
			false,
			"no terran body or missing uniforms — the cloud shadow contract is unverified",
		);
	} else {
		try {
			// Production field, without the forced-blob hook. Draw the real surface
			// programs into a float target and read the shell's coverage at the same
			// pixels. An orthographic sunward camera makes its rays exactly the sun
			// rays, so shell altitude/parallax must agree with the projected shadow.
			await shadowPage.evaluate((id) => {
				const g = window.__seelite;
				const u = g.bodyVisuals.get(id).uniforms;
				u.cloudTestDir.value.set(0, 0, 0);
				u.cloudCover.value = 0.7;
				g.rebake(id, 512);
			}, subject.id);
			await shadowPage.waitForFunction(
				() => window.__seelite.bakeQueue.length === 0,
				undefined,
				{ timeout: 60_000 },
			);
			for (const [label, path, coverageReady] of [
				["four-tap before bake", "four-tap", 0],
				["four-tap with coverage cube", "four-tap", 1],
				["baked", "baked", 1],
			]) {
				await shadowPage.evaluate(
					(path) => window.__seelite.setSurfacePin(path),
					path,
				);
				const rows = await shadowPage.evaluate(
					async ({ id, coverageReady }) => {
						const THREE = await import(
							"/node_modules/three/build/three.module.js"
						);
						const g = window.__seelite;
						const vis = g.bodyVisuals.get(id);
						const shell = vis.group.children.find(
							(o) => o.userData.shell === "cloud",
						);
						const scene = new THREE.Scene();
						const group = new THREE.Group();
						group.rotation.copy(vis.group.rotation);
						scene.add(group);
						const u = {
							...vis.surfaceMesh.material.uniforms,
							cloudTestDir: { value: new THREE.Vector3() },
							cloudCover: { value: 0.7 },
							cloudCoherent: { value: 1 },
							cloudCoverageReady: { value: coverageReady },
							time: { value: 0 },
							sunDir: { value: new THREE.Vector3() },
							cloudSunDir: { value: new THREE.Vector3() },
						};
						const groundMaterial = vis.surfaceMesh.material.clone();
						groundMaterial.uniforms = u;
						const ground = new THREE.Mesh(
							vis.surfaceMesh.geometry,
							groundMaterial,
						);
						const cloudMaterial = shell.material.clone();
						cloudMaterial.uniforms = u;
						// Keep the production field and motion. Only replace the final
						// lighting/opacity output, so coverage can be read linearly.
						const outputIndex =
							cloudMaterial.fragmentShader.lastIndexOf("  gl_FragColor =");
						if (outputIndex < 0)
							throw new Error("cloud readout splice missed gl_FragColor");
						cloudMaterial.fragmentShader =
							cloudMaterial.fragmentShader.slice(0, outputIndex) +
							"  gl_FragColor = vec4(vec3(mask), 1.0);\n}\n";
						cloudMaterial.transparent = false;
						const cloud = new THREE.Mesh(shell.geometry, cloudMaterial);
						group.add(ground, cloud);
						const camera = new THREE.OrthographicCamera(
							-1.1,
							1.1,
							1.1,
							-1.1,
							0.1,
							10,
						);
						const px = 128;
						const target = new THREE.WebGLRenderTarget(px, px, {
							type: THREE.FloatType,
						});
						const renderer = g.renderer;
						const oldTarget = renderer.getRenderTarget();
						const oldClear = renderer.getClearColor(new THREE.Color());
						const oldAlpha = renderer.getClearAlpha();
						const oldAutoClear = renderer.autoClear;
						const read = () => {
							renderer.setRenderTarget(target);
							renderer.render(scene, camera);
							const pixels = new Float32Array(px * px * 4);
							renderer.readRenderTargetPixels(target, 0, 0, px, px, pixels);
							return pixels;
						};
						const rows = [];
						let previousCoverage;
						try {
							renderer.autoClear = true;
							renderer.setClearColor(0, 1);
							for (const [seconds, light] of [
								[0, [0.6, 0.3, 0.8]],
								[4000, [0.6, 0.3, 0.8]],
								[8000, [-0.5, 0.4, 0.8]],
							]) {
								u.time.value = seconds;
								u.sunDir.value.fromArray(light).normalize();
								u.cloudSunDir.value
									.copy(u.sunDir.value)
									.applyQuaternion(
										group.getWorldQuaternion(new THREE.Quaternion()).invert(),
									);
								camera.position.copy(u.sunDir.value).multiplyScalar(3);
								camera.lookAt(0, 0, 0);
								ground.visible = true;
								cloud.visible = false;
								const on = read();
								u.cloudCover.value = 0;
								const off = read();
								u.cloudCover.value = 0.7;
								ground.visible = false;
								cloud.visible = true;
								const coverage = read();
								let frozen;
								if (seconds === 4000) {
									// Inject the round-3 defect: shadow fixed at t=0 while
									// the real shell keeps moving. The oracle must reject it.
									const source = groundMaterial.fragmentShader;
									const broken = source.replace(
										"normalize(p + cloudSunDir * distance), time",
										"normalize(p + cloudSunDir * distance), 0.0",
									);
									if (broken === source)
										throw new Error(
											"cloud drift defect injection missed its target",
										);
									groundMaterial.fragmentShader = broken;
									groundMaterial.needsUpdate = true;
									ground.visible = true;
									cloud.visible = false;
									frozen = read();
									groundMaterial.fragmentShader = source;
									groundMaterial.needsUpdate = true;
								}
								let weatherChange = 0;
								if (previousCoverage)
									for (let i = 0; i < coverage.length; i += 4)
										weatherChange += Math.abs(
											coverage[i] - previousCoverage[i],
										);
								previousCoverage = coverage;
								let n = 0,
									sx = 0,
									sy = 0,
									sxx = 0,
									syy = 0,
									sxy = 0,
									maxShadow = 0,
									maxCloud = 0;
								let sf = 0,
									sff = 0,
									sxf = 0;
								for (let y = 0; y < px; y++)
									for (let x = 0; x < px; x++) {
										if (
											Math.hypot(
												((x + 0.5 - px / 2) * 2.2) / px,
												((y + 0.5 - px / 2) * 2.2) / px,
											) > 0.65
										)
											continue;
										const i = (y * px + x) * 4;
										const luma = (a) =>
											0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
										if (luma(off) < 0.005) continue;
										const a = coverage[i];
										const b = 1 - luma(on) / luma(off);
										n++;
										sx += a;
										sy += b;
										sxx += a * a;
										syy += b * b;
										sxy += a * b;
										maxShadow = Math.max(maxShadow, b);
										maxCloud = Math.max(maxCloud, a);
										if (frozen) {
											const f = 1 - luma(frozen) / luma(off);
											sf += f;
											sff += f * f;
											sxf += a * f;
										}
									}
								const correlation =
									(n * sxy - sx * sy) /
									Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
								rows.push({
									seconds,
									light,
									n,
									correlation,
									maxShadow,
									maxCloud,
									weatherChange: weatherChange / (px * px),
									frozenCorrelation: frozen
										? (n * sxf - sx * sf) /
											Math.sqrt((n * sxx - sx * sx) * (n * sff - sf * sf))
										: null,
									path: vis.surfacePath(),
								});
							}
						} finally {
							renderer.setRenderTarget(oldTarget);
							renderer.setClearColor(oldClear, oldAlpha);
							renderer.autoClear = oldAutoClear;
							target.dispose();
							groundMaterial.dispose();
							cloudMaterial.dispose();
						}
						return rows;
					},
					{ id: subject.id, coverageReady },
				);
				for (const row of rows)
					check(
						`${label}: production cloud coverage overlaps its ground shadow at t=${row.seconds}`,
						row.path === path &&
							row.n > 1000 &&
							row.correlation > 0.9 &&
							row.maxShadow > 0.03 &&
							row.maxCloud > 0.1,
						JSON.stringify(row),
					);
				check(
					`${label}: production weather moves between t=0 and t=4000`,
					rows[1].weatherChange > 0.01,
					JSON.stringify(rows[1]),
				);
				check(
					`${label}: overlap oracle rejects a shadow frozen at t=0`,
					Number.isFinite(rows[1].frozenCorrelation) &&
						rows[1].frozenCorrelation < 0.7,
					JSON.stringify(rows[1]),
				);
			}
			// Restore the deterministic blob before its banded on/off arms.
			await shadowPage.evaluate(({ id }) => {
				const u = window.__seelite.bodyVisuals.get(id).uniforms;
				const angle = (u.time.value * 0.003) % (Math.PI * 2);
				u.cloudTestDir.value
					.copy(u.cloudSunDir.value)
					.applyAxisAngle({ x: 0, y: 1, z: 0 }, angle);
			}, subject);
			for (const path of ["four-tap", "baked"]) {
				const capture = async (cover) => {
					await shadowPage.evaluate(
						({ id, cover, path }) => {
							const g = window.__seelite;
							g.bodyVisuals.get(id).uniforms.cloudCover.value = cover;
							g.setSurfacePin(path);
							// Both programs reuse ready coverage; the fixture changed.
							g.rebake(id, 512);
						},
						{ id: subject.id, cover, path },
					);
					await shadowPage.waitForFunction(
						() => window.__seelite.bakeQueue.length === 0,
						undefined,
						{ timeout: 60_000 },
					);
					return shadowPage.evaluate((id) => {
						const g = window.__seelite;
						g.render(0);
						g.render(0);
						return {
							...window.__innerDiscStats(id, 0.25),
							path: g.bodyVisuals.get(id).surfacePath(),
						};
					}, subject.id);
				};
				const withShadow = await capture(0.7);
				const noShadow = await capture(0);
				check(
					`cloud shadow controls actually draw the ${path} program`,
					withShadow.path === path && noShadow.path === path,
					`on: ${withShadow.path}, off: ${noShadow.path}`,
				);
				const ratio = withShadow.mean / noShadow.mean;
				check(
					`${path}: a terran surface under a forced cloud blob is darker than with clouds off`,
					withShadow.pixels > 0 &&
						withShadow.pixels === noShadow.pixels &&
						noShadow.mean > 1 &&
						ratio < 0.96 &&
						ratio > 0.5,
					`with shadow ${withShadow.mean.toFixed(1)}, without ${noShadow.mean.toFixed(1)}, ratio ${ratio.toFixed(3)} (expected 0.50–0.96), ${withShadow.pixels}/${noShadow.pixels} px`,
				);
			}
		} finally {
			await shadowPage.evaluate(
				async ({ id, cover, testDir, held, shells }) => {
					const g = window.__seelite;
					const uniforms = g.bodyVisuals.get(id).uniforms;
					uniforms.cloudTestDir.value.fromArray(testDir);
					uniforms.cloudCover.value = cover;
					g.setSurfacePin(null);
					g.rebake(id, 512);
					g.clockHeld = held;
					for (const scene of [g.nearScene, g.approachScene, g.farScene])
						scene.traverse((o) => {
							const prior = shells.find((s) => s.uuid === o.uuid);
							if (prior) o.visible = prior.visible;
						});
				},
				subject,
			);
		}
		const cloudShellPresent = await shadowPage.evaluate((id) => {
			let present = false;
			window.__seelite.bodyVisuals.get(id).group.traverse((o) => {
				if (o.userData?.shell === "cloud") present = true;
			});
			return present;
		}, subject.id);
		check(
			"the cloud shell mesh is still present after the shadow test",
			cloudShellPresent,
			`cloudShellPresent: ${cloudShellPresent}`,
		);
	}
	await shadowPage.close();
}

await browser.close();
exit();
