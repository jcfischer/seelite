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
import { installViewFraming } from "./lib/view-placement.mjs";

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
const URL = process.env.PROBE_URL ?? `${ORIGIN}/?seed=6`;

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
			const g = window.__seelite;
			// Decorations off for the capture, and this is the only place it is
			// spelled — every measurement in this file goes through here, so
			// hiding them in the callers instead left whichever caller was added
			// last measuring a ring or a corona. Both mistakes happened: the class
			// signatures were once taken with a ringed giant's 4.8-radius ring
			// plane in the box, and the star's with its corona sprite in it.
			window.__setDecorVisible(bodyId, false);
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

// The guard's default pair. This probe's own subject — `planet-surface.ts` —
// declares no top-level numeric constants, and the question the guard asks is
// "is this the same tree?", not "is my subject current".
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
	const pathAt = async (radii) => {
		await page.evaluate(
			([id, r]) => window.__sunOffset(id, r, 60),
			[subject.id, radii],
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
		}, subject.id);
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
	const near = await pathAt(1.2);
	check(
		"and filling the frame it is back on four-tap",
		near === "four-tap",
		`${subject.id} at 1.2 radii: ${near}`,
	);
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
		released === "four-tap",
		`un-pinned at 1.2 radii: ${released}`,
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
	const bakeable = await page.evaluate(
		(id) => window.__seelite.bodyVisuals.get(id)?.bakeable === true,
		subject.id,
	);
	check(
		"the widest body in this system is a class that bakes",
		bakeable,
		// Not a property of the change — a system whose largest body is a gas
		// giant is a legitimate system — but every check below is vacuous without
		// it, and a vacuous check that reports green is the failure this file's
		// own history is mostly about. It refuses rather than skipping.
		`${subject.id} bakeable: ${bakeable}`,
	);
	if (bakeable) {
		const bakedFar = await pathAt(30);
		check(
			"a planet 30 radii away is drawn from its cube, not from noise",
			bakedFar === "baked",
			`${subject.id} at 30 radii: ${bakedFar}`,
		);
		const bakedMid = await pathAt(5);
		check(
			"and at five radii, where a 256 face is still under a pixel per texel",
			bakedMid === "baked",
			`${subject.id} at 5 radii: ${bakedMid}`,
		);
		const bakedNear = await pathAt(1.2);
		check(
			"filling the frame it is procedural again — no face size serves that rung",
			bakedNear === "four-tap",
			// The finding the node's resolution question has as its answer. A 512
			// face is 11.8 screen pixels per texel at 1.02 radii and it would take
			// faces around 6,000 px to reach parity, so the band refuses rather
			// than drawing a soft planet. `tests/relief-bands.test.ts` has the
			// arithmetic; this is that arithmetic reaching the frame loop.
			`${subject.id} at 1.2 radii: ${bakedNear}`,
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
		 * The band is **stated rather than tuned**: the two programs do not agree
		 * exactly and are not meant to. A 256 cube samples the height field at
		 * 0.35° a texel and the procedural path samples it per pixel, and both are
		 * under the field's own frequency — so the relief normals differ by
		 * genuinely different undersampling, not by an error in either. 12% of the
		 * patch mean is what that is worth here; a face basis error is several
		 * times it.
		 */
		const AGREEMENT = 0.12;
		const signatureAt = async (radii, allowed) => {
			await page.evaluate((v) => window.__seelite.setBakeAllowed(v), allowed);
			await page.evaluate(
				([id, r]) => window.__sunOffset(id, r, 60),
				[subject.id, radii],
			);
			await settleBakes();
			await page.evaluate(() => {
				window.__seelite.render(0);
				window.__seelite.render(0);
			});
			return page.evaluate(
				([id, grid]) => window.__bodySignature(id, grid),
				[subject.id, 6],
			);
		};
		for (const radii of [8, 4]) {
			const withBake = await signatureAt(radii, true);
			const without = await signatureAt(radii, false);
			const pairs = withBake.patches
				.map((a, i) => [a, without.patches[i]])
				.filter(([a, b]) => a && b);
			const worst = pairs.reduce((m, [a, b]) => {
				const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
				const [x, y] = [luma(a), luma(b)];
				const scale = Math.max(x, y, 1);
				return Math.max(m, Math.abs(x - y) / scale);
			}, 0);
			check(
				`the baked and procedural programs agree on the lit face at ${radii} radii`,
				pairs.length >= 8 && worst <= AGREEMENT,
				`${pairs.length} comparable patches, worst ${(worst * 100).toFixed(1)}%` +
					` against a ${(AGREEMENT * 100).toFixed(0)}% band`,
			);
		}
		await page.evaluate(() => window.__seelite.setBakeAllowed(true));

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
		await pathAt(8);
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
			}, subject.id);
		const first = await face();
		await page.evaluate(
			(id) => window.__seelite.bodyVisuals.get(id)?.startBake(256),
			subject.id,
		);
		await settleBakes();
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

		/**
		 * **The bake programs were pre-warmed**, on the same argument as the band
		 * warm-up above and with the same trap: compiled with no target bound they
		 * are keyed to the wrong colour space, and left uncompiled they land on the
		 * frame after a jump — the one frame the node says must not stall.
		 *
		 * A fresh bake is started and stepped to completion; if the two programs
		 * were already there the count does not move.
		 */
		const beforeBake = await page.evaluate(
			() => window.__seelite.renderer.info.programs?.length ?? -1,
		);
		await page.evaluate(
			(id) => window.__seelite.bodyVisuals.get(id)?.startBake(256),
			subject.id,
		);
		await settleBakes();
		const afterBake = await page.evaluate(
			() => window.__seelite.renderer.info.programs?.length ?? -1,
		);
		check(
			"a fresh bake compiles no new program",
			beforeBake > 0 && afterBake === beforeBake,
			`${beforeBake} programs before the bake, ${afterBake} after`,
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
const NEUTRAL_URL = process.env.PROBE_NEUTRAL_URL ?? `${ORIGIN}/?seed=8`;
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

await browser.close();
exit();
