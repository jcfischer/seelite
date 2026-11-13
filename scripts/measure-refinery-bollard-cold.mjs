/**
 * A cold session drawing a refinery and Bollard:
 * https://github.com/jcfischer/seelite/issues/1226
 * Run once per process, alternating base and head servers with an empty browser cache.
 * Asset bytes come from completed requests. Frame gaps span the first post-boot
 * frame through 120 settled frames; boot work before that window is excluded.
 */
import { gameUrl } from "./lib/game-url.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const { watch, exit } = tally();
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
await holdProbeLockOrExit("measure-refinery-bollard-cold");
const browser = await launchChromium({ headless: false });
try {
	const page = await (
		await browser.newContext({
			viewport: { width: 1440, height: 900 },
			deviceScaleFactor: 2,
		})
	).newPage();
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	const fetched = [];
	page.on("requestfinished", async (request) => {
		const url = new URL(request.url());
		if (!/\.(glb|webp|bin)$/.test(url.pathname)) return;
		const { responseBodySize } = await request.sizes();
		fetched.push({
			file: url.pathname.split("/").pop(),
			bytes: responseBodySize,
		});
	});
	await page.goto(
		gameUrl(origin, {
			seed: 2,
			hull: "tug",
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
		window.__gaps = [];
		window.__uploads = [];
		let last;
		let textures = g.renderer.info.memory.textures;
		let pendingUpload = null;
		const tick = (now) => {
			if (last !== undefined) window.__gaps.push(now - last);
			last = now;
			if (pendingUpload) {
				pendingUpload.push(Math.round(window.__gaps.at(-1)));
				pendingUpload = null;
			}
			const live = g.renderer.info.memory.textures;
			if (live !== textures && window.__gaps.length) {
				pendingUpload = [live - textures, Math.round(window.__gaps.at(-1))];
				window.__uploads.push(pendingUpload);
			}
			textures = live;
			window.__tick = requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		g.skipOpening();
		const refinery = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "refinery",
		);
		if (!refinery) throw new Error("fixture has no refinery");
		g.view = "chase";
		await window.__viewAlongAxis(
			refinery.id,
			window.__radiusOf(refinery.id) * 3,
		);
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
		const maps = new Set();
		for (const station of g.stationVisuals.values())
			station.root.traverse((o) => {
				for (const m of [o.material ?? []].flat())
					if (m.map?.name === "paint-wear") maps.add(m.map);
			});
		g.shipMesh.traverse((o) => {
			for (const m of [o.material ?? []].flat())
				if (m.map?.name === "paint-wear") maps.add(m.map);
		});
		if (!g.shipMesh.userData.authored || maps.size === 0)
			throw new Error("authored Bollard has not installed");
		const sorted = [...window.__gaps].sort((a, b) => b - a);
		return {
			uploads: window.__uploads,
			textures: g.renderer.info.memory.textures,
			paintMaps: maps.size,
			anisotropies: [...maps].map((m) => m.anisotropy).sort(),
			frames: sorted.length,
			stallMs: sorted[0],
			top: sorted.slice(0, 3).map((v) => Math.round(v)),
			over50: sorted.filter((v) => v > 50).length,
			over100: sorted.filter((v) => v > 100).length,
			heap: performance.memory?.usedJSHeapSize,
		};
	});
	if (
		![report.stallMs, report.textures, ...fetched.map((f) => f.bytes)].every(
			Number.isFinite,
		)
	)
		throw new Error("non-finite cold-load measurement");
	console.log(
		JSON.stringify({
			renderer,
			bytes: fetched.reduce((sum, f) => sum + f.bytes, 0),
			requests: fetched.length,
			images: fetched.filter((f) => f.file.includes("paint-wear")).length,
			files: fetched,
			...report,
		}),
	);
} finally {
	await browser.close();
}
exit();
