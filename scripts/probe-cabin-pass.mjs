/**
 * Prove #651: no world fragment is written inside the cabin's footprint.
 *
 * The cabin is authored at about a hundred times life size, so near a berth
 * the bay's structure stands *inside* it and draws over the dash. #651 draws
 * the cabin in its own pass, after every world layer and over a cleared depth
 * buffer, so nothing from the world can reach a pixel the cabin covers.
 *
 * **The frame is read, and read in flat colours.** Two renders in one task,
 * with the loop stopped so nothing moves between them:
 *
 * 1. the cabin alone, every cabin mesh in flat green and every near-layer
 *    world mesh drawing nothing — that is the cabin's footprint;
 * 2. the same frame with the world in flat red.
 *
 * Inside the footprint (eroded, so a multisampled edge cannot count), a red
 * pixel is a world fragment the cabin did not cover. A coverage mask must not
 * look at what anything *looks like* — two shaded frames differ for reasons
 * that are not the subject — so both arms are flat colours with bloom, dither,
 * the occlusion passes and the far layers off, and the test is which channel
 * dominates. The canopy glass is hidden: through it the world is meant to
 * show, and the glass is not part of the footprint.
 *
 * **Both arms must register hits.** The footprint must be a real share of the
 * frame and the second frame must carry red somewhere, or a frame that drew
 * nothing would pass. And the row was watched red on the build before #651:
 * at 0.9 of the deep-berth traversal a berth beam stands in front of the dash.
 */
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEED = 47;
/** Pixels trimmed off the footprint's edge before it is read. */
const ERODE_PX = 2;

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t = tally();
t.watch(page);
await installViewPlacement(page);
await installViewFraming(page);
await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
await bootedGame(page);

/**
 * Both arms, in one evaluate: between two, the loop runs and the ship moves.
 */
const read = () =>
	page.evaluate((erode) => {
		const game = window.__seelite;
		// No three on the page; the canopy glass is a `MeshBasicMaterial`, and its
		// class is the one wanted.
		const Basic = game.canopyGlass.constructor;
		if (Basic.name !== "MeshBasicMaterial")
			throw new Error(`canopy glass is a ${Basic.name}`);
		const canvas = game.renderer.domElement;
		const W = canvas.width;
		const H = canvas.height;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			// Render and read in the same task: the canvas is cleared at the next
			// composite.
			game.render(0);
			ctx.drawImage(canvas, 0, 0);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const flat = (color) => new Basic({ color, toneMapped: false });
		const GREEN = flat(0x00ff00);
		const RED = flat(0xff0000);
		const NOTHING = new Basic({
			colorWrite: false,
			depthWrite: false,
		});

		const cabin = new Set();
		game.cockpit.mesh.traverse((o) => cabin.add(o));
		const swapped = [];
		const hidden = [];
		const hide = (o) => {
			hidden.push([o, o.visible]);
			o.visible = false;
		};
		const world = [];
		for (const o of cabin) {
			if (o === game.cockpit.mesh) continue;
			// Opaque fittings only: the glass and the additive lamp pools let the
			// world show through, as they are meant to, so they are no footprint.
			const m = Array.isArray(o.material) ? o.material[0] : o.material;
			if (o.isMesh && o.name !== "canopy-glass" && !m?.transparent) {
				swapped.push([o, o.material]);
				o.material = GREEN;
			} else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) hide(o);
		}
		game.nearScene.traverse((o) => {
			if (cabin.has(o)) return;
			if (o.isMesh) {
				swapped.push([o, o.material]);
				world.push(o);
			} else if (o.isLine || o.isPoints || o.isSprite) hide(o);
		});
		const layers = [game.backdropScene, game.farScene, game.approachScene];
		const layerWas = layers.map((s) => s.visible);
		for (const s of layers) s.visible = false;
		const bloomWas = game.bloom?.enabled;
		if (game.bloom) game.bloom.enabled = false;
		const dither = game.settings.value.dither;
		game.outputPass.setDither(false);
		game.setOcclusion(false, false);

		for (const o of world) o.material = NOTHING;
		const alone = frame();
		for (const o of world) o.material = RED;
		const both = frame();

		for (const [o, m] of swapped) o.material = m;
		for (const [o, v] of hidden) o.visible = v;
		layers.forEach((s, i) => {
			s.visible = layerWas[i];
		});
		if (game.bloom) game.bloom.enabled = bloomWas;
		game.outputPass.setDither(dither === "on");
		game.setOcclusion();
		for (const m of [GREEN, RED, NOTHING]) m.dispose();

		// By a margin rather than a ratio: the output stage tone-maps the whole
		// composite, which desaturates — the flat green reads about
		// (147, 228, 89) on screen, and the flat red about (250, 16, 20).
		const green = (d, i) => d[i + 1] > d[i] + 40 && d[i + 1] > d[i + 2] + 40;
		const red = (d, i) => d[i] > d[i + 1] + 40 && d[i] > d[i + 2] + 40;
		const inside = new Uint8Array(W * H);
		for (let p = 0; p < W * H; p++) inside[p] = green(alone, p * 4) ? 1 : 0;
		let footprint = 0;
		let entered = 0;
		let redAnywhere = 0;
		let first = null;
		for (let y = 0; y < H; y++)
			for (let x = 0; x < W; x++) {
				const p = y * W + x;
				if (red(both, p * 4)) redAnywhere++;
				let core = inside[p] === 1;
				for (let dy = -erode; core && dy <= erode; dy++)
					for (let dx = -erode; core && dx <= erode; dx++) {
						const yy = y + dy;
						const xx = x + dx;
						if (yy < 0 || yy >= H || xx < 0 || xx >= W) core = false;
						else if (inside[yy * W + xx] !== 1) core = false;
					}
				if (!core) continue;
				footprint++;
				if (red(both, p * 4)) {
					entered++;
					if (!first) first = [x, y];
				}
			}
		return {
			W,
			H,
			footprintPct: (100 * footprint) / (W * H),
			entered,
			redAnywherePct: (100 * redAnywhere) / (W * H),
			first,
			dockPhase: game.dockPhase,
		};
	}, ERODE_PX);

/**
 * The principal's ruling for #651: the bay's lights light the cabin. A world
 * lamp 18 m from the eye, overhead and behind it, in three arms over one pose — none, the lamp
 * alone, the lamp mirrored into the cabin — and the cabin's footprint read in
 * each. The lamp alone must leave the cabin untouched, which is the pass's
 * isolation seen in light; mirrored, it must light it. Bloom, dither and the
 * occlusion passes are off, so a bright wall cannot bleed into the cabin.
 */
const readLamp = () =>
	page.evaluate(() => {
		const game = window.__seelite;
		const canvas = game.renderer.domElement;
		const W = canvas.width;
		const H = canvas.height;
		const scratch = document.createElement("canvas");
		scratch.width = W;
		scratch.height = H;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const frame = () => {
			game.render(0);
			ctx.drawImage(canvas, 0, 0);
			return ctx.getImageData(0, 0, W, H).data;
		};
		const PointLight =
			game.cockpit.mesh.getObjectByName("cockpit-light").constructor;
		const Basic = game.canopyGlass.constructor;
		const bloomWas = game.bloom?.enabled;
		if (game.bloom) game.bloom.enabled = false;
		const dither = game.settings.value.dither;
		game.outputPass.setDither(false);
		game.setOcclusion(false, false);

		// The footprint, as `read` takes it: the cabin alone, flat.
		const swapped = [];
		const GREEN = new Basic({ color: 0x00ff00, toneMapped: false });
		const NOTHING = new Basic({ colorWrite: false, depthWrite: false });
		const cabin = new Set();
		game.cockpit.mesh.traverse((o) => cabin.add(o));
		const hidden = [];
		for (const o of cabin) {
			if (o === game.cockpit.mesh) continue;
			const m = Array.isArray(o.material) ? o.material[0] : o.material;
			if (o.isMesh && o.name !== "canopy-glass" && !m?.transparent) {
				swapped.push([o, o.material]);
				o.material = GREEN;
			} else if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
				hidden.push([o, o.visible]);
				o.visible = false;
			}
		}
		game.nearScene.traverse((o) => {
			if (!cabin.has(o) && o.isMesh) {
				swapped.push([o, o.material]);
				o.material = NOTHING;
			}
		});
		const mask = frame();
		for (const [o, m] of swapped) o.material = m;
		for (const [o, v] of hidden) o.visible = v;
		GREEN.dispose();
		NOTHING.dispose();
		const inside = [];
		for (let p = 0; p < W * H; p++) {
			const i = p * 4;
			if (mask[i + 1] > mask[i] + 40 && mask[i + 1] > mask[i + 2] + 40)
				inside.push(i);
		}

		const lamp = new PointLight(0xffe0b0, 0.002, 0.09, 2);
		lamp.name = "probe-bay-lamp";
		// Overhead and behind the pilot, in the ship's frame (−z is the nose):
		// where a lamp reaches the deck tops that face up and back, rather than
		// only the few faces that look forward.
		lamp.position.set(0, 0.015, 0.01).applyQuaternion(game.orientation);
		const none = frame();
		game.nearScene.add(lamp);
		const alone = frame();
		const undo = game.mirrorIntoCabin(lamp);
		const mirrored = frame();
		undo();
		const undone = frame();
		lamp.removeFromParent();
		lamp.dispose();

		if (game.bloom) game.bloom.enabled = bloomWas;
		game.outputPass.setDither(dither === "on");
		game.setOcclusion();

		const luma = (d, i) =>
			0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
		const meanDelta = (a, b) => {
			let sum = 0;
			let worst = 0;
			for (const i of inside) {
				const d = luma(b, i) - luma(a, i);
				sum += d;
				worst = Math.max(worst, Math.abs(d));
			}
			return { mean: sum / Math.max(1, inside.length), worst };
		};
		return {
			footprintPx: inside.length,
			alone: meanDelta(none, alone),
			mirrored: meanDelta(none, mirrored),
			undone: meanDelta(none, undone),
		};
	});

// The frame `berth-arrival-cabin` shows: 0.9 of the deep-berth traversal.
await page.evaluate(async () => {
	window.__seelite.view = "cockpit";
	await window.__parkInBerth("station-trade", "overhead-deep", {
		stopAtArrivalFraction: 0.9,
	});
});
// Stop the loop, so the two arms are of one pose.
await page.evaluate(() => {
	const g = window.__seelite;
	cancelAnimationFrame(g.animationFrame);
	g.animationFrame = 0;
});
const near = await read();
const lamp = await readLamp();
await page.evaluate(() => window.__seelite.animate());

t.check(
	"the cabin's footprint is a real share of the frame near the berth",
	near.footprintPct > 10,
	`${near.footprintPct.toFixed(1)}% of ${near.W}x${near.H}, ${near.dockPhase}`,
);
t.check(
	"the world draws in that frame",
	near.redAnywherePct > 5,
	`${near.redAnywherePct.toFixed(1)}% red`,
);
t.check(
	"no world fragment is written inside the cabin's footprint",
	near.entered === 0,
	`${near.entered} px` + (near.first ? `, first at ${near.first}` : ""),
);

t.check(
	"a world lamp alone does not light the cabin",
	lamp.footprintPx > 0 && lamp.alone.worst < 0.5,
	`worst ${lamp.alone.worst.toFixed(2)} codes over ${lamp.footprintPx} px`,
);
t.check(
	"the same lamp mirrored into the cabin lights it",
	lamp.mirrored.mean > 3,
	`mean +${lamp.mirrored.mean.toFixed(2)} codes, worst ${lamp.mirrored.worst.toFixed(1)}`,
);
t.check(
	"undoing the mirror takes the light away again",
	lamp.undone.worst < 0.5,
	`worst ${lamp.undone.worst.toFixed(2)} codes`,
);

await browser.close();
t.exit();
