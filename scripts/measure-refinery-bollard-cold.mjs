/**
 * A cold session drawing a refinery and Bollard:
 * https://github.com/jcfischer/seelite/issues/1226
 * Run once per process, alternating base and head servers with an empty browser cache.
 * Asset bytes come from completed requests. Frame gaps start after the driver
 * observes boot/sky readiness and end after 120 settled frames; earlier work is excluded.
 */
import { loadavg } from "node:os";
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
const loadBefore = loadavg();
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
	const failures = [];
	page.on("console", (message) => {
		if (
			/background load failed|mesh refresh failed|Model download failed|Multiple instances of Three/.test(
				message.text(),
			)
		)
			failures.push(message.text());
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	const fetched = [];
	const pendingSizes = [];
	page.on("requestfinished", (request) => {
		const url = new URL(request.url());
		if (!/\.(glb|webp|bin)$/.test(url.pathname)) return;
		pendingSizes.push(
			request.sizes().then(
				({ responseBodySize }) => {
					fetched.push({
						file: url.pathname.split("/").pop(),
						bytes: responseBodySize,
					});
				},
				(error) => failures.push(`request size failed: ${error}`),
			),
		);
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
		window.__refineryId = refinery.id;
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
		const paintMaps = (root) => {
			const maps = new Set();
			root.traverse((o) => {
				for (const m of [o.material ?? []].flat())
					if (m.map?.name === "paint-wear") maps.add(m.map);
			});
			return maps;
		};
		const station = g.stationVisuals.get(window.__refineryId);
		if (!station) throw new Error("fixture refinery has no visual");
		const stationMaps = paintMaps(station.root);
		const hullMaps = paintMaps(g.shipMesh);
		const stationPaintMaps = stationMaps.size;
		const maps = new Set([...stationMaps, ...hullMaps]);
		if (!g.shipMesh.userData.authored || !stationPaintMaps || !hullMaps.size)
			throw new Error("authored refinery and Bollard have not both installed");
		const sorted = [...window.__gaps].sort((a, b) => b - a);
		if (g.settings.value.quality !== "high")
			throw new Error("cold fixture expects high quality");
		return {
			quality: g.settings.value.quality,
			viewport: [innerWidth, innerHeight],
			buffer: [g.renderer.domElement.width, g.renderer.domElement.height],
			uploads: window.__uploads,
			textures: g.renderer.info.memory.textures,
			paintMaps: maps.size,
			stationPaintMaps,
			hullPaintMaps: hullMaps.size,
			anisotropies: [...maps].map((m) => m.anisotropy).sort((a, b) => a - b),
			frames: sorted.length,
			stallMs: sorted[0],
			top: sorted.slice(0, 3).map((v) => Math.round(v)),
			over50: sorted.filter((v) => v > 50).length,
			over100: sorted.filter((v) => v > 100).length,
			heap: performance.memory?.usedJSHeapSize,
		};
	});
	await Promise.all(pendingSizes);
	if (failures.length) throw new Error(failures.join("\n"));
	if (
		![report.stallMs, report.textures, ...fetched.map((f) => f.bytes)].every(
			Number.isFinite,
		)
	)
		throw new Error("non-finite cold-load measurement");
	console.log(
		JSON.stringify({
			renderer,
			load: { before: loadBefore, after: loadavg() },
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
