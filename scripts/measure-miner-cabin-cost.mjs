/**
 * What the Longwall's bridge costs a frame against the courier cabin it
 * replaces on that hull, https://github.com/jcfischer/seelite/issues/1198
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/measure-miner-cabin-cost.mjs
 *   INSTALL=1 node scripts/measure-miner-cabin-cost.mjs      # cold install
 *
 * The method is `measure-asteroid-field-cost.mjs`'s: its own dev server, headed,
 * the player's renderer asserted, 1440x900 at device scale 2, the clock held,
 * blocks shuffled from a printed seed, a warm pass, each block drained with a
 * 1x1 readPixels, medians with a Mann-Whitney count. The arms are the cabins and
 * seats, rebuilt in place before each block's warm pass, at each framing,
 * quality and antialias row; the occlusion gate decides each arm, as in flight.
 */
import { createServer } from "vite";
import { loadavg } from "node:os";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { placeAtRockFace } from "./lib/miner-bridge-fixture.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const FRAMES = Number(process.env.FRAMES ?? 120);
const BLOCKS = Number(process.env.BLOCKS ?? 8);
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261109);
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5297);
const ARMS = ["courier", "miner-pilot", "miner-seat"];
const FRAMINGS = (process.env.FRAMINGS ?? "open,rock").split(",");
const QUALITIES = (process.env.QUALITIES ?? "high,low").split(",");
const ANTIALIAS = (process.env.ANTIALIAS ?? "0,2").split(",").map(Number);

const releaseLock = await holdProbeLockOrExit("miner cabin cost");
console.log("  host load average at start:", loadavg().join(" / "));
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-miner-1198",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({
	viewport: VIEWPORT,
	deviceScaleFactor: 2,
});

await installViewPlacement(page);

async function install() {
	const started = Date.now();
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			hull: "miner",
			mining: 1,
			"no-save": true,
			raider: "off",
			"models-full": false,
		}),
	);
	await page.evaluate(() => {
		window.__gaps = [];
		let last = performance.now();
		const tick = () => {
			const now = performance.now();
			const g = window.__seelite;
			window.__gaps.push([now - last, g?.cabinId ?? "boot"]);
			last = now;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await bootedGame(page, 180000);
	console.log(`  renderer: ${await assertPlayersRenderer(page, "measure")}`);
	await page.waitForFunction(
		() => window.__seelite.cabinId === "miner",
		undefined,
		{
			timeout: 180000,
		},
	);
	await page.waitForTimeout(2000);
	const out = await page.evaluate(() => {
		const gaps = window.__gaps;
		const swapped = gaps.findIndex(([, id]) => id === "miner");
		const settled = gaps
			.slice(Math.max(0, swapped - 200), swapped)
			.map(([d]) => d);
		return {
			frames: gaps.length,
			swapFrame: swapped,
			beforeSwapMedianMs: settled.sort((a, b) => a - b)[settled.length >> 1],
			swapIntervalMs: gaps[swapped][0],
			firstFramesAfterMs: gaps.slice(swapped + 1, swapped + 6).map(([d]) => d),
			worstAfterBootMs: gaps
				.slice(Math.max(0, swapped - 200))
				.map(([d]) => d)
				.sort((a, b) => b - a)
				.slice(0, 5),
		};
	});
	console.log(`  cold install, ${Date.now() - started} ms from navigation:`);
	console.log(JSON.stringify(out, null, 1));
}

async function cost() {
	await page.goto(
		gameUrl(origin, {
			seed: 0x5ee11e,
			system: 173,
			hull: "miner",
			mining: 1,
			"no-save": true,
			raider: "off",
			"models-full": true,
		}),
	);
	await bootedGame(page, 180000);
	console.log(`  renderer: ${await assertPlayersRenderer(page, "measure")}`);
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 180000,
		},
	);
	await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		window.__arm = (arm) => {
			const cabin = arm === "courier" ? "courier" : "miner";
			if (g.cabinId !== cabin) g.replaceCabin(cabin);
			g.setMinerSeat(arm === "miner-seat" ? "miner" : "pilot");
		};
		window.__stand = () => {
			g.step(0);
			g.render(0);
		};
	});
	const shuffled = seededShuffler(ORDER_SEED);
	console.log(
		`  viewport ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, cockpit, clock held; ${BLOCKS} blocks per arm, ${FRAMES} frames per block, order seed ${ORDER_SEED}`,
	);
	for (const framing of FRAMINGS) {
		if (framing === "rock") await placeAtRockFace(page);
		for (const quality of QUALITIES)
			for (const aa of ANTIALIAS) {
				await page.evaluate(
					([q, a]) => {
						const g = window.__seelite;
						g.settings.set("quality", q);
						g.settings.set("antialias", a);
						g.view = "cockpit";
					},
					[quality, aa],
				);
				const blocks = Object.fromEntries(ARMS.map((a) => [a, []]));
				for (let b = 0; b < BLOCKS; b++)
					for (const arm of shuffled(ARMS))
						blocks[arm].push(
							await page.evaluate(
								([a, frames]) => {
									const g = window.__seelite;
									const gl = g.renderer.getContext();
									const sync = new Uint8Array(4);
									window.__arm(a);
									for (let i = 0; i < 40; i++) window.__stand();
									gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
									const started = performance.now();
									for (let i = 0; i < frames; i++) window.__stand();
									gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
									return (performance.now() - started) / frames;
								},
								[arm, FRAMES],
							),
						);
				console.log(
					`  ${framing}, ${quality}, antialias ${aa}, load ${loadavg()[0].toFixed(2)}`,
				);
				for (const arm of ARMS) {
					const info = await page.evaluate((a) => {
						const g = window.__seelite;
						window.__arm(a);
						for (let i = 0; i < 5; i++) window.__stand();
						const r = g.renderer;
						const auto = r.info.autoReset;
						r.info.autoReset = false;
						r.info.reset();
						g.render(0);
						const out = {
							calls: r.info.render.calls,
							triangles: r.info.render.triangles,
							programs: r.info.programs?.length ?? 0,
						};
						r.info.autoReset = auto;
						return out;
					}, arm);
					const m = median(blocks[arm]);
					const d = m - median(blocks.courier);
					console.log(
						`    ${arm.padEnd(12)} ${m.toFixed(3).padStart(8)} ms  ${arm === "courier" ? "".padEnd(24) : `${d >= 0 ? "+" : ""}${d.toFixed(3)} ms ${String(separation(blocks[arm], blocks.courier)).padEnd(10)}`}  ${info.calls} calls  ${info.triangles} tris  ${info.programs} programs`,
					);
				}
			}
	}
}

try {
	if (process.env.INSTALL === "1") await install();
	else await cost();
} finally {
	await browser.close();
	await server.close();
	console.log("  host load average at end:", loadavg().join(" / "));
	releaseLock();
}
