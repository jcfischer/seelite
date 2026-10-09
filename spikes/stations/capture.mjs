import { mkdir, writeFile } from "node:fs/promises";
import { guardedOrigin, launchChromium } from "../../scripts/probe-guard.mjs";
import { assertBrowserRenderer } from "../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
const origin = "http://127.0.0.1:5217",
	label = process.argv[2] ?? "round1";
if (!/^[a-z0-9-]+$/i.test(label)) throw Error("Bad label");
const models = process.argv.slice(3);
if (!models.length)
	models.push(
		"ring",
		"drum",
		"assembly",
		"wheel",
		"derrick",
		"buoy",
		"rig",
		"cluster",
		"salvage",
	);
await guardedOrigin(origin);
const release = await holdProbeLockOrExit("nine station model capture");
let browser;
const out = ".dream-loop/" + label;
await mkdir(out, { recursive: true });
try {
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1254, height: 1254 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(origin + "/spikes/stations/?model=" + models[0]);
	await page.waitForFunction(
		() => window.__stations?.stats.loaded,
		{},
		{ timeout: 120000 },
	);
	const renderer = await page.evaluate(() => {
		const gl = window.__stations.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
	});
	if (!renderer || /swiftshader|llvmpipe|software/i.test(renderer))
		throw Error("Hardware required: " + renderer);
	const results = [];
	for (const name of models) {
		await page.evaluate((id) => window.__stations.selectModel(id), name);
		await page.waitForFunction(
			(id) =>
				window.__stations.stats.loaded &&
				window.__stations.stats.modelId === id,
			name,
		);
		await page.evaluate(() => window.__stations.capture());
		for (const view of ["hero", "front", "rear", "top", "detail", "under"]) {
			await page.evaluate((v) => window.__stations.setView(v), view);
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${out}/${name}-${view}.png` });
		}
		await page.evaluate(() => window.__stations.setView("hero"));
		await page.waitForTimeout(1500);
		const stats = await page.evaluate(() => ({ ...window.__stations.stats }));
		const before = await page.evaluate(() =>
			window.__stations.camera.position.toArray(),
		);
		await page.mouse.move(630, 620);
		await page.mouse.down();
		await page.mouse.move(750, 710, { steps: 5 });
		await page.mouse.up();
		await page.waitForTimeout(300);
		const after = await page.evaluate(() =>
			window.__stations.camera.position.toArray(),
		);
		if (before.every((v, i) => Math.abs(v - after[i]) < 1e-5))
			throw Error("Orbit failed " + name);
		await page.mouse.wheel(0, -300);
		await page.waitForTimeout(250);
		const zoom = await page.evaluate(() =>
			window.__stations.camera.position.toArray(),
		);
		if (after.every((v, i) => Math.abs(v - zoom[i]) < 1e-5))
			throw Error("Zoom failed");
		await page.evaluate(() => document.body.classList.remove("capture"));
		await page.click("#target");
		await page.waitForSelector("#target-dialog[open]");
		await page.click("#close-target");
		await page.click("#lights");
		await page.click("#lights");
		const download = page.waitForEvent("download");
		await page.click("#save");
		if (!(await download).suggestedFilename().endsWith(".png"))
			throw Error("Export failed");
		await page.evaluate(() => window.__stations.setView("hero"));
		await page.screenshot({ path: `${out}/${name}-viewer.png` });
		results.push({ name, ...stats });
		console.log(
			name,
			stats.fps.toFixed(1) + " fps",
			stats.modelTriangles + " triangles",
		);
	}
	await writeFile(
		out + "/metrics.json",
		JSON.stringify({ renderer, errors, results }, null, 2),
	);
	if (errors.length) throw Error(errors.join("\n"));
} finally {
	await browser?.close();
	release();
}
