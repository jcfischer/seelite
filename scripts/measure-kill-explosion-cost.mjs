/**
 * https://github.com/jcfischer/seelite/issues/1090
 *
 * What node #1090's kill explosions cost a frame in the worst case: `COUNT`
 * carrier explosions at once, near the camera and in frame.
 *
 *   npm run dev                                       # in one shell
 *   node scripts/measure-kill-explosion-cost.mjs      # in another
 *
 * Two arms on the same boot, with the clock held:
 *
 * - `none` — no explosion live.
 * - `burst` — `COUNT` carrier explosions live, each a different age through
 *   its life and rewritten every frame, so the arm pays the CPU write as well
 *   as the draw.
 *
 * Each arm is a block of `FRAMES` renders fenced by a 1x1 `readPixels`,
 * shuffled from a printed seed and reported as medians with the Mann-Whitney
 * pairing count (`lib/measurement.mjs`). The renderer and the machine's load
 * are printed beside the figure.
 */
import os from "node:os";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { SEED, VIEWPORT } from "./lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const FRAMES = 60;
const BLOCKS = 12;
const COUNT = Number(process.env.COUNT ?? 4);
const SHUFFLE_SEED = Number(process.env.SHUFFLE_SEED ?? 1090);

const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});
const { watch, exit } = tally();
watch(page);
await page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
await bootedGame(page);
const renderer = await assertPlayersRenderer(page, "measure");
const loadBefore = os.loadavg()[0];

const setup = await page.evaluate(async (count) => {
	const g = window.__seelite;
	const { HULL_REACH_KM } = await import("/src/ship-mesh.ts");
	const { explosionDurationS } = await import("/src/kill-explosion.ts");
	g.view = "chase";
	g.clockHeld = true;
	const reachKm = HULL_REACH_KM.carrier;
	const life = explosionDurationS(reachKm);
	const nose = g.nose();
	const cam = g.cameraPos();
	const base = g.world.gameTime;
	const kills = Array.from({ length: count }, (_, i) => ({
		key: `measure:${i}`,
		at: base - (life * (i + 0.5)) / (count + 1),
		pos: {
			x: cam.x + nose.x * 2 + 0.4 * (i - (count - 1) / 2),
			y: cam.y + nose.y * 2,
			z: cam.z + nose.z * 2,
		},
		vel: { ...g.world.ship.vel },
		reachKm,
	}));
	window.__killArm = (arm, frames) => {
		const gl = g.renderer.getContext();
		g.killExplosions.clear();
		if (arm === "burst") for (const k of kills) g.killExplosions.start(k);
		g.render(0);
		const sync = new Uint8Array(4);
		const started = performance.now();
		for (let i = 0; i < frames; i++) g.render(0);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
		return (performance.now() - started) / frames;
	};
	window.__killPainted = () => {
		const src = g.renderer.domElement;
		const scratch = document.createElement("canvas");
		scratch.width = src.width;
		scratch.height = src.height;
		const ctx = scratch.getContext("2d", { willReadFrequently: true });
		const read = (arm) => {
			window.__killArm(arm, 0);
			ctx.drawImage(src, 0, 0);
			return ctx.getImageData(0, 0, src.width, src.height).data;
		};
		const none = read("none");
		const burst = read("burst");
		let rose = 0;
		for (let i = 0; i < none.length; i += 4) {
			const d =
				0.2126 * (burst[i] - none[i]) +
				0.7152 * (burst[i + 1] - none[i + 1]) +
				0.0722 * (burst[i + 2] - none[i + 2]);
			if (d >= 24) rose++;
		}
		return { rose, of: none.length / 4 };
	};
	return { reachKm, life, count };
}, COUNT);

const painted = await page.evaluate(() => window.__killPainted());
if (painted.rose === 0)
	throw new Error("measure: the burst arm painted no explosion pixel");

const arms = { none: [], burst: [] };
const shuffle = seededShuffler(SHUFFLE_SEED);
for (let b = 0; b < BLOCKS; b++)
	for (const arm of shuffle(Object.keys(arms)))
		arms[arm].push(
			await page.evaluate(
				([arm, frames]) => window.__killArm(arm, frames),
				[arm, FRAMES],
			),
		);
const loadAfter = os.loadavg()[0];
await browser.close();

const fmt = (x) => x.toFixed(3);
console.log(`renderer: ${renderer}`);
console.log(
	`load (1 min) ${loadBefore.toFixed(1)} before, ${loadAfter.toFixed(1)} after, on ${os.cpus().length} cores`,
);
console.log(
	`${setup.count} carrier explosions (reach ${setup.reachKm} km, ${setup.life.toFixed(2)} s life) 2 km ahead; ${BLOCKS} blocks of ${FRAMES} frames per arm, shuffle seed ${SHUFFLE_SEED}, ${VIEWPORT.width}x${VIEWPORT.height} @2x`,
);
console.log(
	`burst paints ${painted.rose} pixels (${((100 * painted.rose) / painted.of).toFixed(2)}% of the frame) ≥ 24 codes brighter than none`,
);
for (const [arm, xs] of Object.entries(arms))
	console.log(
		`${arm.padEnd(6)} median ${fmt(median(xs))} ms  range ${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}`,
	);
const delta = median(arms.burst) - median(arms.none);
console.log(
	`burst − none: ${fmt(delta)} ms, burst slower in ${separation(arms.burst, arms.none)} pairings`,
);
exit();
