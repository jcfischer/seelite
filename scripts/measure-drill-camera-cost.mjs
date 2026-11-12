/**
 * What the Longwall bridge's drill camera costs a frame, against the same
 * bridge with the feed switched off, https://github.com/jcfischer/seelite/issues/1229
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/measure-drill-camera-cost.mjs
 *
 * The method is `measure-miner-cabin-cost.mjs`'s, which is
 * `measure-asteroid-field-cost.mjs`'s: its own dev server, headed, the player's
 * renderer asserted, 1440x900 at device scale 2, the clock held, blocks shuffled
 * from a printed seed, a warm pass, each block drained with a 1x1 readPixels,
 * medians with a Mann-Whitney count. The two arms are the same bridge at the
 * same rock with the drill out: the feed drawn, and the gate switched off. On
 * the low quality side the feed is excluded by the quality gate, so both arms
 * draw the same frame and the row measures the instrument's own noise.
 */
import { loadavg } from "node:os";
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { deployDrill, placeAtRockFace } from "./lib/miner-bridge-fixture.mjs";
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
const port = Number(process.env.PORT ?? 5298);
const ARMS = ["bridge", "feed"];
const QUALITIES = (process.env.QUALITIES ?? "high,low").split(",");
const BUDGET_MS = { high: 1.0, low: 0 };

const releaseLock = await holdProbeLockOrExit("drill camera cost");
console.log("  host load average at start:", loadavg().join(" / "));
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-drillcam-1229",
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

try {
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
		{ timeout: 180000 },
	);
	const labels = await placeAtRockFace(page);
	await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.setMinerSeat("miner");
		g.settings.set("cockpitFov", "wide");
		g.view = "cockpit";
		window.__arm = (arm) => {
			const game = window.__seelite;
			game.drillCameraEnabled = arm === "feed";
			game.setMinerSeat("miner");
			game.settings.set("cockpitFov", "wide");
			game.view = "cockpit";
		};
		window.__stand = () => {
			const game = window.__seelite;
			game.step(0);
			game.render(0);
		};
	});
	await deployDrill(page, labels);
	const gate = await page.evaluate(() => {
		const g = window.__seelite;
		window.__arm("feed");
		for (let i = 0; i < 5; i++) window.__stand();
		const on = g.drillCameraReport();
		window.__arm("bridge");
		for (let i = 0; i < 5; i++) window.__stand();
		const off = g.drillCameraReport();
		return { on, off };
	});
	if (!gate.on?.active || gate.off?.active) {
		throw new Error(`the feed arm is not the feed: ${JSON.stringify(gate)}`);
	}
	const shuffled = seededShuffler(ORDER_SEED);
	console.log(
		`  viewport ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, miner seat, wide cockpit, drill out at a rock face, clock held; ${BLOCKS} blocks per arm, ${FRAMES} frames per block, order seed ${ORDER_SEED}`,
	);
	console.log(
		`  budget: the feed may add at most ${BUDGET_MS.high} ms per frame on high; low excludes it, so the low row measures noise`,
	);
	for (const quality of QUALITIES) {
		await page.evaluate((quality) => {
			window.__seelite.settings.set("quality", quality);
		}, quality);
		const blocks = Object.fromEntries(ARMS.map((a) => [a, []]));
		for (let b = 0; b < BLOCKS; b++)
			for (const arm of shuffled(ARMS))
				blocks[arm].push(
					await page.evaluate(
						([arm, frames]) => {
							const g = window.__seelite;
							const gl = g.renderer.getContext();
							const sync = new Uint8Array(4);
							window.__arm(arm);
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
		console.log(`  rock, ${quality}, load ${loadavg()[0].toFixed(2)}`);
		for (const arm of ARMS) {
			const info = await page.evaluate((arm) => {
				const g = window.__seelite;
				window.__arm(arm);
				for (let i = 0; i < 5; i++) window.__stand();
				const before = g.drillCameraReport()?.frames;
				const r = g.renderer;
				const auto = r.info.autoReset;
				r.info.autoReset = false;
				r.info.reset();
				g.render(0);
				const out = {
					calls: r.info.render.calls,
					triangles: r.info.render.triangles,
					programs: r.info.programs?.length ?? 0,
					active: g.drillCameraReport()?.active,
					drawn: (g.drillCameraReport()?.frames ?? 0) - before,
				};
				r.info.autoReset = auto;
				return out;
			}, arm);
			const m = median(blocks[arm]);
			const d = m - median(blocks.bridge);
			const judged =
				arm === "bridge"
					? ""
					: `  ${d <= BUDGET_MS[quality] ? "inside" : "OVER"} the ${BUDGET_MS[quality]} ms budget`;
			console.log(
				`    ${arm.padEnd(8)} ${m.toFixed(3).padStart(8)} ms  ${
					arm === "bridge"
						? "".padEnd(24)
						: `${d >= 0 ? "+" : ""}${d.toFixed(3)} ms ${String(separation(blocks[arm], blocks.bridge)).padEnd(10)}`
				}  ${info.calls} calls  ${info.triangles} tris  ${info.programs} programs  feed ${info.active ? "active" : "off"}  drew ${info.drawn}${judged}`,
			);
		}
	}
} finally {
	await browser.close();
	await server.close();
	console.log("  host load average at end:", loadavg().join(" / "));
	releaseLock();
}
