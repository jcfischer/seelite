/**
 * What a cold load of a docked Coriolis fetches, holds on the GPU and stalls
 * (#1222). One run per process, so a harness can alternate two checkouts: run
 * it from each, against that checkout's own dev server.
 *
 *   PROBE_ORIGIN=http://127.0.0.1:5173 SEELITE_PROBE_RENDERER=hardware \
 *     node scripts/measure-docked-coriolis-cold.mjs
 *
 * A new browser has an empty HTTP cache. The page boots seed 42 system 4, whose
 * home is the trade Coriolis, without the full catalog; parks in a berth so the
 * exterior and the interior both draw; and waits for the system's models to
 * settle. It prints one JSON line. `stallMs` is the longest gap between two
 * animation frames from the first frame after boot until 120 frames after
 * settling, which holds every upload; a dev server's module transforms are in
 * the boot, not in that window.
 */
import { gameUrl } from "./lib/game-url.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
await holdProbeLockOrExit("measure-docked-coriolis-cold");
const browser = await launchChromium({ headless: false });
try {
	const page = await (
		await browser.newContext({
			viewport: { width: 1440, height: 900 },
			deviceScaleFactor: 2,
		})
	).newPage();
	page.on("pageerror", (e) => console.error("pageerror:", e.message));
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: 42,
			system: 4,
			"no-save": true,
			voices: "formant",
			raider: "off",
			cinematic: false,
			"models-full": false,
			"interiors-full": false,
			"shipyards-full": false,
			"refineries-full": false,
			"outposts-full": false,
		}),
	);
	await bootedGame(page, 180000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.evaluate(async () => {
		const g = window.__seelite;
		g.skipOpening();
		await window.__parkInBerth("station-trade", "port-deep");
		window.__gaps = [];
		let last = performance.now();
		const tick = (now) => {
			window.__gaps.push(now - last);
			last = now;
			window.__tick = requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await page.waitForFunction(
		() =>
			window.__seelite.modelsSettled() &&
			window.__seelite.interiorModelsSettled,
		undefined,
		{ timeout: 180000 },
	);
	const report = await page.evaluate(async () => {
		for (let i = 0; i < 120; i++)
			await new Promise((resolve) => requestAnimationFrame(resolve));
		cancelAnimationFrame(window.__tick);
		const g = window.__seelite;
		const files = performance
			.getEntriesByType("resource")
			.filter((e) => /\.(glb|webp|bin)(\?|$)/.test(e.name))
			.map((e) => ({
				file: new URL(e.name).pathname.split("/").pop(),
				bytes: e.encodedBodySize,
			}));
		const maps = new Set();
		for (const station of g.stationVisuals.values())
			station.root.traverse((o) => {
				for (const m of [o.material ?? []].flat())
					if (m.map?.name === "industrial-surface") maps.add(m.map);
			});
		const sorted = [...window.__gaps].sort((a, b) => b - a);
		return {
			files,
			textures: g.renderer.info.memory.textures,
			industrialMaps: maps.size,
			anisotropies: [...maps].map((m) => m.anisotropy).sort(),
			frames: sorted.length,
			stallMs: sorted[0],
			top: sorted.slice(0, 3).map((v) => Math.round(v)),
			over50: sorted.filter((v) => v > 50).length,
			over100: sorted.filter((v) => v > 100).length,
			heap: performance.memory?.usedJSHeapSize,
		};
	});
	console.log(
		JSON.stringify({
			renderer,
			bytes: report.files.reduce((sum, f) => sum + f.bytes, 0),
			requests: report.files.length,
			images: report.files.filter((f) => f.file.includes("industrial-surface"))
				.length,
			...report,
		}),
	);
} finally {
	await browser.close();
}
process.exit(0);
