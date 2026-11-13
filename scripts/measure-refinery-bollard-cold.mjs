/**
 * A cold session drawing a refinery and Bollard:
 * https://github.com/jcfischer/seelite/issues/1226
 * Run once per process, alternating base and head servers with an empty browser cache.
 * Asset bytes come from completed requests. Frame gaps start after the driver
 * observes boot/sky readiness and end after 120 settled frames; earlier work is excluded.
 *
 * `--refinery-forms` (node #1227) draws the fixture's own refinery and then a
 * second authored form through the same production builder and the renderer's
 * own swap, because the generator puts at most one refinery in a system and the
 * shared rock-albedo's claim is about two drawn forms. The build is timed around
 * the build alone and the second form's frames are timed separately, so the
 * cold-install stall still belongs to the model install and not to the
 * instrument.
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
const FORMS = process.argv.includes("--refinery-forms");
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
			hull: FORMS ? undefined : "tug",
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
	const report = await page.evaluate(async (forms) => {
		for (let i = 0; i < 120; i++)
			await new Promise((resolve) => requestAnimationFrame(resolve));
		cancelAnimationFrame(window.__tick);
		const g = window.__seelite;
		const mapsNamed = (root, name) => {
			const maps = new Set();
			root.traverse((o) => {
				for (const m of [o.material ?? []].flat())
					if (m.map?.name === name) maps.add(m.map);
			});
			return maps;
		};
		const mineralMaps = (root) => {
			const maps = new Set();
			root.traverse((o) => {
				for (const m of [o.material ?? []].flat())
					if (/\bmineral-/.test(m.name ?? "") && m.map) maps.add(m.map);
			});
			return maps;
		};
		const station = g.stationVisuals.get(window.__refineryId);
		if (!station) throw new Error("fixture refinery has no visual");
		const sorted = [...window.__gaps].sort((a, b) => b - a);
		if (g.settings.value.quality !== "high")
			throw new Error("cold fixture expects high quality");
		const shared = {
			quality: g.settings.value.quality,
			viewport: [innerWidth, innerHeight],
			buffer: [g.renderer.domElement.width, g.renderer.domElement.height],
			uploads: window.__uploads,
			frames: sorted.length,
			stallMs: sorted[0],
			top: sorted.slice(0, 3).map((v) => Math.round(v)),
			over50: sorted.filter((v) => v > 50).length,
			over100: sorted.filter((v) => v > 100).length,
			heap: performance.memory?.usedJSHeapSize,
		};
		if (!forms) {
			const stationMaps = mapsNamed(station.root, "paint-wear");
			const hullMaps = mapsNamed(g.shipMesh, "paint-wear");
			const stationPaintMaps = stationMaps.size;
			const maps = new Set([...stationMaps, ...hullMaps]);
			if (!g.shipMesh.userData.authored || !stationPaintMaps || !hullMaps.size)
				throw new Error(
					"authored refinery and Bollard have not both installed",
				);
			return {
				...shared,
				textures: g.renderer.info.memory.textures,
				paintMaps: maps.size,
				stationPaintMaps,
				hullPaintMaps: hullMaps.size,
				anisotropies: [...maps].map((m) => m.anisotropy).sort((a, b) => a - b),
			};
		}
		const body = g.world.system.bodies.find(
			(b) => b.id === window.__refineryId,
		);
		const record = g.world.system.contents.stations.find(
			(s) => s.id === window.__refineryId,
		);
		const { buildStationForm } = await import("/src/station-mesh.ts");
		await g.loadRefineriesAfterBoot();
		const first = g.stationVisuals.get(window.__refineryId);
		if (!first) throw new Error("fixture refinery has no visual");
		const other = ["a", "b", "c", "d"].find((f) => f !== record.formId);
		const buildStartedAt = performance.now();
		const second = buildStationForm(
			"refinery",
			other,
			body.color,
			record.berthSeed,
			record.assemblySeed,
		);
		const secondBuildMs = Math.round(performance.now() - buildStartedAt);
		if (!second.root.getObjectByName(`refinery-${other}-model`))
			throw new Error(
				`second refinery form ${other} is not the authored model`,
			);
		const texturesAfterFirst = g.renderer.info.memory.textures;
		second.root.name = body.id;
		first.root.removeFromParent();
		g.stationVisuals.set(window.__refineryId, second);
		g.meshes.set(window.__refineryId, second.root);
		g.setLayer(body, g.layers.get(body.id) ?? "far");
		const secondGaps = [];
		let last;
		await new Promise((resolve) => {
			const tick = (now) => {
				if (last !== undefined) secondGaps.push(now - last);
				last = now;
				if (secondGaps.length >= 60) return resolve();
				requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const sortedSecond = secondGaps.sort((a, b) => b - a);
		const texturesAfterSecond = g.renderer.info.memory.textures;
		const mineral = new Set([
			...mineralMaps(first.root),
			...mineralMaps(second.root),
		]);
		const paint = new Set([
			...mapsNamed(first.root, "paint-wear"),
			...mapsNamed(second.root, "paint-wear"),
		]);
		const secondDrawn =
			g.meshes.get(window.__refineryId) === second.root &&
			second.root.parent !== null &&
			second.root.position.lengthSq() > 0;
		second.root.removeFromParent();
		g.stationVisuals.set(window.__refineryId, first);
		g.meshes.set(window.__refineryId, first.root);
		g.setLayer(body, g.layers.get(body.id) ?? "far");
		return {
			...shared,
			formDrawn: record.formId,
			formSecond: other,
			secondDrawn,
			texturesAfterFirst,
			textures: texturesAfterSecond,
			textureDelta: texturesAfterSecond - texturesAfterFirst,
			rockMaps: mineral.size,
			paintMaps: paint.size,
			secondBuildMs,
			secondStallMs: sortedSecond[0],
			secondFrames: sortedSecond.length,
		};
	}, FORMS);
	await Promise.all(pendingSizes);
	if (failures.length) throw new Error(failures.join("\n"));
	if (
		![
			report.stallMs,
			report.textures,
			report.secondBuildMs ?? 0,
			report.secondStallMs ?? 0,
			...fetched.map((f) => f.bytes),
		].every(Number.isFinite)
	)
		throw new Error("non-finite cold-load measurement");
	if (FORMS && !report.secondDrawn)
		throw new Error("the second refinery form was not drawn");
	console.log(
		JSON.stringify({
			renderer,
			load: { before: loadBefore, after: loadavg() },
			bytes: fetched.reduce((sum, f) => sum + f.bytes, 0),
			requests: fetched.length,
			images: fetched.filter((f) => f.file.includes("paint-wear")).length,
			rockAlbedo: fetched.filter((f) => f.file.includes("rock-albedo")).length,
			fields: fetched.filter((f) => /refinery-/.test(f.file)).length,
			files: fetched,
			...report,
		}),
	);
} finally {
	await browser.close();
}
exit();
