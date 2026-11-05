import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import { median, seededShuffler, separation } from "../../scripts/lib/measurement.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import { assertPlayersRenderer } from "../../scripts/lib/players-renderer.mjs";
import { installViewFraming } from "../../scripts/lib/view-placement.mjs";
import { launchChromium } from "../../scripts/probe-guard.mjs";
import { waitForStationDetail } from "../../scripts/lib/station-detail.mjs";

const roots = [await realpath(process.argv[2]), await realpath(process.cwd())];
const baselineRef = execFileSync("git", ["rev-parse", process.env.BASE_REF ?? "origin/main"], { encoding: "utf8" }).trim();
for (const file of ["src/trade-flight.ts", "src/coriolis-flight.ts", "src/models/trade-ring.glb"]) {
	const expected = execFileSync("git", ["show", `${baselineRef}:${file}`], { maxBuffer: 32 * 1024 * 1024 });
	if (!expected.equals(await readFile(resolve(roots[0], file)))) throw Error(`baseline differs from ${baselineRef}: ${file}`);
}
const out = resolve(process.argv[3] ?? "spikes/station-scale/evidence-ring/cost.json");
const release = await holdProbeLockOrExit("node-1145-interleaved-cost");
const servers = [];
const pages = [];
const errors = [];
const frames = 120;
const blocks = 12;
const orderSeed = 1145;
const shuffle = seededShuffler(orderSeed);
const report = {
	startedAt: new Date().toISOString(),
	load: loadavg(),
	cpus: cpus().length,
	frames,
	blocks,
	orderSeed,
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 1,
	method: "Vite dev trees; synchronous whole-frame render throughput, one readPixels drain per 120 frames; no simulated step, both automatic frame loops cancelled after settled boot; hardware; high, 100%, no MSAA",
	arms: [],
	results: [],
};
report.hardware = { model: cpus()[0]?.model, platform: process.platform, arch: process.arch };
const browser = await launchChromium({
	headless: false,
	args: ["--disable-frame-rate-limit", "--disable-gpu-vsync"],
});
try {
	for (const [i, root] of roots.entries()) {
		const server = await createServer({
			root,
			configFile: resolve(root, "vite.config.ts"),
			cacheDir: resolve(root, `node_modules/.vite-scale-cost-${i}`),
			server: { host: "127.0.0.1", port: 5194 + i, strictPort: true },
		});
		servers.push(server);
		await server.listen();
		const origin = `http://127.0.0.1:${5194 + i}`;
		const guard = await import(pathToFileURL(resolve(root, "scripts/probe-guard.mjs")));
		const serving = await guard.guardedTree(origin);
		const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
		pages.push(page);
		page.on("pageerror", e => errors.push({ arm: i, error: e.message }));
		page.on("console", m => {
			if (m.type() === "error" && /shader|program|webgl/i.test(m.text()))
				errors.push({ arm: i, error: m.text() });
		});
		await guard.installViewPlacement(page);
		await installViewFraming(page);
		await page.goto(gameUrl(origin, { seed: 42, system: 1, "no-save": true, "models-full": true, raider: "off" }));
		await guard.bootedGame(page, 120000);
		await page.waitForFunction(() => window.__seelite.modelsSettled());
		const renderer = await assertPlayersRenderer(page, "measure Ring cost");
		await page.evaluate(() => {
			const g = window.__seelite;
			cancelAnimationFrame(g.animationFrame);
			g.animationFrame = 0;
			g.clockHeld = true;
			g.settings.set("quality", "high");
			g.settings.set("renderScale", 1);
			g.setComposerSamples(0);
			g.world.gameTime = 0;
			g.step(0);
		});
		const bytes = await readFile(resolve(root, "src/models/trade-ring.glb"));
		const detailBytes = i === 1 ? await readFile(resolve(root, "src/models/trade-ring-detail.glb")) : undefined;
		report.arms.push({
			name: i === 0 ? "main" : "branch",
			root,
			served: serving.served,
			renderer,
			assetBytes: bytes.length,
			assetSha256: createHash("sha256").update(bytes).digest("hex"),
			detailAssetBytes: detailBytes?.length ?? 0,
			detailAssetSha256: detailBytes ? createHash("sha256").update(detailBytes).digest("hex") : null,
			lightingSha256: createHash("sha256").update(await readFile(resolve(root, i === 0 ? "src/coriolis-flight.ts" : "src/station-light.ts"))).digest("hex"),
 sourceSha256: createHash("sha256").update(await readFile(resolve(root, "src/trade-flight.ts"))).digest("hex"),
			ref: i === 0 ? baselineRef : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		});
	}
	for (const framing of ["station-approach", "chase"]) {
		const facts = [];
		for (const [arm, page] of pages.entries()) {
			facts.push(await page.evaluate(async framing => {
				const g = window.__seelite;
				const id = "station-trade";
				const range = framing === "station-approach" ? window.__radiusOf(id) * 3 : g.dockingSnapshot(id).planeKm + 0.6;
				g.view = "chase";
				const placement = await window.__viewAlongAxis(id, range, { comoving: true });
				if (Math.abs(placement.actualKm - range) > 0.00001 || placement.offAxisDeg > 0.001) throw Error("framing drift");
				for (let i = 0; i < 10; i++) g.render(0);
				const station = g.visualOfStation(id);
				if (station.formId !== "b" || station.detail !== "full") throw Error("measurement requires full trade-B");
				const gl = g.renderer.getContext();
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
				let detailMeshes = 0;
				window.__meshOfBody(id).traverse(o => { if (o.visible && o.name.startsWith("scale-detail")) detailMeshes++; });
				return { rangeKm: range, placement, form: station.formId, detail: station.detail, detailMeshes, buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], quality: g.settings.value.quality };
			}, framing));
			await waitForStationDetail(page);
			const settled = await page.evaluate(() => {
				const g = window.__seelite;
				g.render(0);
				const parts = [];
				window.__meshOfBody("station-trade").traverse(o => {
					if (o.isMesh && o.name.startsWith("scale-detail"))
						parts.push({ name: o.name, visible: o.visible, triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3 });
				});
				return parts;
			});
			if (settled.length !== (arm === 1 ? 7 : 0) || settled.some(o => !o.visible))
				throw Error(`timing arm ${arm} lacks settled full detail: ${JSON.stringify(settled)}`);
			Object.assign(facts[arm], { detailMeshes: settled.length, parts: settled });
		}
		const times = [[], []];
		const order = [];
 const blockRecords = [];
		const counters = [];
		for (let round = 0; round < blocks; round++) {
			for (const i of shuffle([0, 1])) {
				order.push(i);
 const blockStartedAt = new Date().toISOString();
				await pages[i].bringToFront();
				const result = await pages[i].evaluate(frames => {
					const g = window.__seelite;
					const gl = g.renderer.getContext();
					const sync = new Uint8Array(4);
					for (let i = 0; i < 10; i++) g.render(0);
					gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
					const start = performance.now();
					for (let i = 0; i < frames; i++) g.render(0);
					gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
					const ms = (performance.now() - start) / frames;
					const reset = g.renderer.info.autoReset;
					g.renderer.info.autoReset = false;
					g.renderer.info.reset();
					g.render(0);
					const counters = { ...g.renderer.info.render };
					g.renderer.info.autoReset = reset;
					const error = gl.getError();
					if (error !== gl.NO_ERROR || !Number.isFinite(ms) || ms <= 0 || counters.triangles <= 0) throw Error(`invalid timing block: ${JSON.stringify({ error, ms, counters, contextLost: gl.isContextLost() })}`);
					return { ms, counters };
				}, frames);
				times[i].push(result.ms);
 blockRecords.push({ round, arm: i, startedAt: blockStartedAt, finishedAt: new Date().toISOString(), load: loadavg(), ...result });
				counters[i] = result.counters;
				console.log(`${framing} round ${round + 1} ${report.arms[i].name}: ${result.ms.toFixed(3)} ms/frame`);
			}
		}
		report.results.push({ framing, facts, order, blockRecords, times, counters, medians: times.map(median), ranges: times.map(xs => [Math.min(...xs), Math.max(...xs)]), branchSlowerPairs: separation(times[1], times[0]) });
	}
	if (errors.length) throw Error(JSON.stringify(errors));
	report.errors = errors;
	report.finishedAt = new Date().toISOString();
	report.finalLoad = loadavg();
	await mkdir(resolve(out, ".."), { recursive: true });
	await writeFile(out, JSON.stringify(report, null, 2) + "\n");
} catch (error) {
	report.errors = errors;
	report.failure = String(error);
	await mkdir(resolve(out, ".."), { recursive: true });
	await writeFile(out.replace(/\.json$/, "-failed.json"), JSON.stringify(report, null, 2) + "\n");
	throw error;
} finally {
	await browser.close();
	for (const server of servers) await server.close();
	release();
}
