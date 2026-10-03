/**
 * Prove #651: no world fragment is written inside the cabin's footprint, and
 * what the cabin's own pass carries with it reaches the cabin.
 *
 * The cabin is authored at about a hundred times life size, so near a berth
 * the bay's structure stands *inside* it and draws over the dash. #651 draws
 * the cabin in its own pass, after every world layer and over a cleared depth
 * buffer, so nothing from the world can reach a pixel the cabin covers.
 *
 * **Every arm is one task with the loop stopped**, at 0.9 of the deep-berth
 * traversal — the frame `berth-arrival-cabin` shows — so nothing moves between
 * two arms. The helpers they share are defined once, inside that one
 * evaluate, so the footprint every row reads is the same mask.
 *
 * 1. **The footprint and the world.** Every opaque cabin mesh in flat green
 *    with the near layer drawing nothing gives the footprint; the same frame
 *    with the world in flat red gives what the world wrote. Inside the
 *    footprint (eroded, so a multisampled edge cannot count), a red pixel is a
 *    world fragment the cabin did not cover. A coverage mask must not look at
 *    what anything *looks like*, so the arms are flat colours with bloom,
 *    dither, the occlusion passes and the far layers off, and the test is
 *    which channel dominates. The glass and the additive lamp pools are no
 *    footprint: through them the world is meant to show.
 * 2. **The cabin camera brackets the built cabin.** Every vertex of every
 *    cabin mesh, in world space with the camera at the origin, lies between
 *    the cabin camera's near and far planes — so no head turn slices a
 *    fitting open, and nothing is clipped at the back.
 * 3. **The ambient occlusion follows the view (D6).** Pinned on against
 *    pinned off, it darkens part of the footprint and nothing outside it,
 *    because in cockpit view the pass is handed the cabin's scene.
 * 4. **A world lamp reaches the cabin only through its mirror (D5).** A lamp
 *    in the near layer alone leaves the footprint untouched; mirrored with
 *    `mirrorIntoCabin` it lights it; the undo takes the light away again.
 *
 * **Both halves of each comparison must register.** The footprint must be a
 * real share of the frame and the world must draw red somewhere, or a frame
 * that drew nothing would pass. Row 1 was watched red on the build before
 * #651: 312,460 px of world inside a 32.5% footprint.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import {
	installViewFraming,
	startLoop,
	stopLoop,
} from "./lib/view-placement.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 47;
/** Pixels trimmed off the footprint's edge before row 1 reads it. */
const ERODE_PX = 2;
/** A display code a pixel must move by to count as darkened (row 3). */
const MOVED = 4;

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t = tally();
t.watch(page);
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
await bootedGame(page);

await page.evaluate(async () => {
	window.__seelite.view = "cockpit";
	await window.__parkInBerth("station-trade", "overhead-deep", {
		stopAtArrivalFraction: 0.9,
	});
});
await stopLoop(page);

const r = await page.evaluate(
	([erode, moved]) => {
		const game = window.__seelite;
		// No three on the page; the canopy glass is a `MeshBasicMaterial`, and
		// its class is the one wanted. The cabin lamp's class is a point light.
		const Basic = game.canopyGlass.constructor;
		if (Basic.name !== "MeshBasicMaterial")
			throw new Error(`canopy glass is a ${Basic.name}`);
		const PointLight =
			game.cockpit.mesh.getObjectByName("cockpit-light").constructor;
		const canvas = game.renderer.domElement;
		const W = canvas.width;
		const H = canvas.height;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		/** Render and read in the same task: the canvas is cleared at the next
		 *  composite. */
		const frame = () => {
			game.render(0);
			ctx.drawImage(canvas, 0, 0);
			return ctx.getImageData(0, 0, W, H).data;
		};
		// By a margin rather than a ratio: the output stage tone-maps the whole
		// composite, which desaturates — the flat green reads about
		// (147, 228, 89) on screen, and the flat red about (250, 16, 20).
		const green = (d, i) => d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 40;
		const red = (d, i) => d[i] > d[i + 1] + 40 && d[i] > d[i + 2] + 40;
		const luma = (d, i) =>
			0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

		const cabin = new Set();
		game.cockpit.mesh.traverse((o) => cabin.add(o));
		const near = [];
		game.nearScene.traverse((o) => {
			if (!cabin.has(o)) near.push(o);
		});
		const materialOf = (o) =>
			Array.isArray(o.material) ? o.material[0] : o.material;
		/** A fitting the world cannot be seen through. */
		const opaque = (o) =>
			o.isMesh && o.name !== "canopy-glass" && !materialOf(o)?.transparent;

		/** Bloom, dither and the occlusion passes off, restorable. */
		const quiet = () => {
			const bloomWas = game.bloom?.enabled;
			if (game.bloom) game.bloom.enabled = false;
			const dither = game.settings.value.dither;
			game.outputPass.setDither(false);
			game.setOcclusion(false, false);
			return () => {
				if (game.bloom) game.bloom.enabled = bloomWas;
				game.outputPass.setDither(dither === "on");
				game.setOcclusion();
			};
		};

		/**
		 * Repaint for the flat arms, restorable: opaque cabin fittings green,
		 * the rest of the cabin and every non-mesh in the near layer hidden,
		 * the far layers off, and the near layer's meshes painted per arm.
		 */
		const flat = () => {
			const GREEN = new Basic({ color: 0x00ff00, toneMapped: false });
			const RED = new Basic({ color: 0xff0000, toneMapped: false });
			const NOTHING = new Basic({ colorWrite: false, depthWrite: false });
			const swapped = [];
			const hidden = [];
			const hide = (o) => {
				hidden.push([o, o.visible]);
				o.visible = false;
			};
			for (const o of cabin) {
				if (o === game.cockpit.mesh) continue;
				if (opaque(o)) {
					swapped.push([o, o.material]);
					o.material = GREEN;
				} else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) hide(o);
			}
			const world = [];
			for (const o of near) {
				if (o.isMesh) {
					swapped.push([o, o.material]);
					world.push(o);
				} else if (o.isLine || o.isPoints || o.isSprite) hide(o);
			}
			const layers = [game.backdropScene, game.farScene, game.approachScene];
			const layerWas = layers.map((s) => s.visible);
			for (const s of layers) s.visible = false;
			return {
				world: (paint) => {
					const m = paint === "red" ? RED : NOTHING;
					for (const o of world) o.material = m;
				},
				restore: () => {
					for (const [o, m] of swapped) o.material = m;
					for (const [o, v] of hidden) o.visible = v;
					layers.forEach((s, i) => {
						s.visible = layerWas[i];
					});
					for (const m of [GREEN, RED, NOTHING]) m.dispose();
				},
			};
		};

		const loud = quiet();

		// ---- 1. the footprint, and what the world wrote ----
		const paint = flat();
		paint.world("nothing");
		const alone = frame();
		paint.world("red");
		const both = frame();
		paint.restore();
		const inside = new Uint8Array(W * H);
		for (let p = 0; p < W * H; p++) inside[p] = green(alone, p * 4) ? 1 : 0;
		const coreOf = (p) => {
			if (inside[p] !== 1) return false;
			const x = p % W;
			const y = (p - x) / W;
			for (let dy = -erode; dy <= erode; dy++)
				for (let dx = -erode; dx <= erode; dx++) {
					const yy = y + dy;
					const xx = x + dx;
					if (yy < 0 || yy >= H || xx < 0 || xx >= W) return false;
					if (inside[yy * W + xx] !== 1) return false;
				}
			return true;
		};
		let footprint = 0;
		let entered = 0;
		let redAnywhere = 0;
		let first = null;
		for (let p = 0; p < W * H; p++) {
			if (red(both, p * 4)) redAnywhere++;
			if (!coreOf(p)) continue;
			footprint++;
			if (red(both, p * 4)) {
				entered++;
				if (!first) first = [p % W, Math.floor(p / W)];
			}
		}

		// ---- 2. the built cabin between the cabin camera's planes ----
		let nearestKm = Number.POSITIVE_INFINITY;
		let farthestKm = 0;
		game.cockpit.mesh.updateWorldMatrix(true, true);
		for (const o of cabin) {
			if (!o.isMesh) continue;
			const pos = o.geometry.getAttribute("position");
			const e = o.matrixWorld.elements;
			for (let i = 0; i < pos.count; i++) {
				const x = pos.getX(i);
				const y = pos.getY(i);
				const z = pos.getZ(i);
				const d = Math.hypot(
					e[0] * x + e[4] * y + e[8] * z + e[12],
					e[1] * x + e[5] * y + e[9] * z + e[13],
					e[2] * x + e[6] * y + e[10] * z + e[14],
				);
				nearestKm = Math.min(nearestKm, d);
				farthestKm = Math.max(farthestKm, d);
			}
		}

		// ---- 3. the ambient occlusion, on the cabin and only there ----
		const aoScene = game.gtaoPass.scene === game.cabinScene;
		game.setOcclusion(false, false);
		const aoOff = frame();
		game.setOcclusion(false, true);
		const aoOn = frame();
		game.setOcclusion(false, false);
		let darkInside = 0;
		let darkOutside = 0;
		let inCount = 0;
		let outCount = 0;
		for (let p = 0; p < W * H; p++) {
			const i = p * 4;
			const darker = luma(aoOn, i) < luma(aoOff, i) - moved;
			// The raw footprint, not the core: the AO stops at the cabin's own
			// edge, and an eroded mask would count that edge as outside.
			if (inside[p] === 1) {
				inCount++;
				if (darker) darkInside++;
			} else {
				outCount++;
				if (darker) darkOutside++;
			}
		}

		// ---- 4. a world lamp, alone and mirrored ----
		const lamp = new PointLight(0xffe0b0, 0.002, 0.09, 2);
		lamp.name = "probe-bay-lamp";
		// Overhead and behind the pilot, in the ship's frame (−z is the nose):
		// where it reaches the deck tops that face up and back, rather than only
		// the few faces that look forward.
		lamp.position.set(0, 0.015, 0.01).applyQuaternion(game.orientation);
		const unlit = frame();
		game.nearScene.add(lamp);
		const lampAlone = frame();
		const undo = game.mirrorIntoCabin(lamp);
		const mirrored = frame();
		undo();
		const undone = frame();
		lamp.removeFromParent();
		lamp.dispose();

		loud();

		// The opaque footprint only: through the glass and the pools the world
		// lamp is meant to show.
		const delta = (a, b) => {
			let sum = 0;
			let worst = 0;
			for (let p = 0; p < W * H; p++) {
				if (inside[p] !== 1) continue;
				const d = luma(b, p * 4) - luma(a, p * 4);
				sum += d;
				worst = Math.max(worst, Math.abs(d));
			}
			return { mean: sum / Math.max(1, inCount), worst };
		};
		return {
			W,
			H,
			footprintPct: (100 * footprint) / (W * H),
			entered,
			redAnywherePct: (100 * redAnywhere) / (W * H),
			first,
			dockPhase: game.dockPhase,
			nearestKm,
			farthestKm,
			cameraNearKm: game.cabinCamera.near,
			cameraFarKm: game.cabinCamera.far,
			aoScene,
			aoInsidePct: (100 * darkInside) / Math.max(1, inCount),
			aoOutsidePct: (100 * darkOutside) / Math.max(1, outCount),
			lampAlone: delta(unlit, lampAlone),
			mirrored: delta(unlit, mirrored),
			undone: delta(unlit, undone),
		};
	},
	[ERODE_PX, MOVED],
);
await startLoop(page);

t.check(
	"the cabin's footprint is a real share of the frame near the berth",
	r.footprintPct > 10,
	`${r.footprintPct.toFixed(1)}% of ${r.W}x${r.H}, ${r.dockPhase}`,
);
t.check(
	"the world draws in that frame",
	r.redAnywherePct > 5,
	`${r.redAnywherePct.toFixed(1)}% red`,
);
t.check(
	"no world fragment is written inside the cabin's footprint",
	r.entered === 0,
	`${r.entered} px${r.first ? `, first at ${r.first}` : ""}`,
);
t.check(
	"the built cabin lies between the cabin camera's planes",
	r.nearestKm > r.cameraNearKm && r.farthestKm < r.cameraFarKm,
	`vertices ${(r.nearestKm * 1000).toFixed(1)}–${(r.farthestKm * 1000).toFixed(1)} m, ` +
		`planes ${(r.cameraNearKm * 1000).toFixed(1)}–${(r.cameraFarKm * 1000).toFixed(1)} m`,
);
t.check(
	"in cockpit view the ambient occlusion is handed the cabin's scene",
	r.aoScene,
);
t.check(
	"the ambient occlusion darkens the cabin",
	r.aoInsidePct > 1,
	`${r.aoInsidePct.toFixed(2)}% of the footprint past ${MOVED} codes`,
);
t.check(
	"and nothing of the world outside it",
	r.aoOutsidePct < 0.05,
	`${r.aoOutsidePct.toFixed(3)}% of the rest`,
);
t.check(
	"a world lamp alone does not light the cabin",
	r.lampAlone.worst < 0.5,
	`worst ${r.lampAlone.worst.toFixed(2)} codes`,
);
t.check(
	"the same lamp mirrored into the cabin lights it",
	r.mirrored.mean > 3,
	`mean +${r.mirrored.mean.toFixed(2)} codes, worst ${r.mirrored.worst.toFixed(1)}`,
);
t.check(
	"undoing the mirror takes the light away again",
	r.undone.worst < 0.5,
	`worst ${r.undone.worst.toFixed(2)} codes`,
);

await browser.close();
t.exit();
