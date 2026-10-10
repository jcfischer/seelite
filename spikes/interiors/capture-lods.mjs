import { mkdir, writeFile, readFile } from "node:fs/promises";
import { guardedTree, launchChromium } from "../../scripts/probe-guard.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import { PNG } from "pngjs";
const origin = "http://127.0.0.1:5205",
	out = ".dream-loop/lod-codex";
await guardedTree(origin);
const release = await holdProbeLockOrExit("interior LOD verification");
let browser;
function difference(a, b) {
	const x = PNG.sync.read(a),
		y = PNG.sync.read(b);
	let changed = 0,
		total = 0;
	for (let i = 0; i < x.data.length; i += 4) {
		let max = 0;
		for (let c = 0; c < 3; c++) {
			const d = Math.abs(x.data[i + c] - y.data[i + c]);
			max = Math.max(max, d);
			total += d;
		}
		if (max > 24) changed++;
	}
	return {
		changedPixels: changed,
		fraction: changed / (x.width * x.height),
		meanChannelDifference: total / (x.width * x.height * 3),
	};
}
try {
	await mkdir(out, { recursive: true });
	browser = await launchChromium({ headless: true });
	const page = await browser.newPage({
			viewport: { width: 1584, height: 992 },
			deviceScaleFactor: 1,
		}),
		errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(origin + "/spikes/interiors/");
	await page.waitForFunction(() => window.__interiors?.stats.loaded, null, {
		timeout: 120000,
	});
	const source = await readFile(
			new URL("./viewer.ts", import.meta.url),
			"utf8",
		),
		expected = source.match(/const BUILD_ID = "([^"]+)"/)[1];
	if (
		(await page.evaluate(() => window.__interiors.stats.buildId)) !== expected
	)
		throw Error("Stale viewer");
	const renderer = await page.evaluate(() => {
		const r = window.__interiors.renderer,
			gl = r.getContext();
		return gl.getParameter(
			gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL,
		);
	});
	if (/swiftshader|software|llvmpipe/i.test(renderer)) throw Error(renderer);
	await page.evaluate(() => {
		window.__interiors.capture();
		window.__interiors.controls.enableDamping = false;
	});
	const results = [];
	for (const theme of ["civic", "works", "frontier", "survey"]) {
		await page.evaluate((t) => window.__interiors.select(t), theme);
		for (const view of ["axis", "command", "loading", "gangway"]) {
			await page.evaluate((v) => window.__interiors.setView(v), view);
			const shots = {},
				metrics = {};
			for (const mode of view === "axis"
				? ["0", "auto", "1", "2"]
				: ["0", "auto"]) {
				await page.evaluate((m) => window.__interiors.setLod(m), mode);
				await page.waitForTimeout(700);
				shots[mode] = await page.screenshot({
					path: `${out}/${theme}-${view}-${mode}.png`,
				});
				metrics[mode] = await page.evaluate(() => ({
					lod: window.__interiors.lod(),
					renderTriangles: window.__interiors.renderer.info.render.triangles,
					calls: window.__interiors.renderer.info.render.calls,
				}));
				if (view === "axis" && metrics[mode].renderTriangles < 500000)
					throw Error("Missing authored geometry in rendered frame");
				if (mode === "auto") {
					if (!metrics[mode].lod.levels[0])
						throw Error("No full detail near camera");
					if (metrics[mode].lod.triangles > metrics["0"].lod.triangles)
						throw Error("LOD increased triangles");
				}
			}
			await page.evaluate(() => window.__interiors.setLod("0"));
			await page.waitForTimeout(300);
			const control = difference(shots["0"], await page.screenshot()),
				diff = difference(shots["0"], shots.auto);
			if (control.changedPixels > 0)
				throw Error(
					`${theme}/${view}: unstable full control ${JSON.stringify(control)}`,
				);
			if (diff.fraction > 0.01)
				throw Error(
					`${theme}/${view}: excessive automatic image change ${JSON.stringify(diff)}`,
				);
			const row = { theme, view, metrics, control, autoDifference: diff };
			results.push(row);
			console.log(JSON.stringify(row));
		}
	}
	// Force both automatic boundaries, then return to the same nearby full view.
	await page.evaluate(() => {
		const v = window.__interiors;
		v.setView("kit");
		v.setLod("auto");
		v.camera.position.set(0, 0, 10000);
		v.controls.target.set(0, 0, 0);
		v.controls.maxDistance = 20000;
		v.controls.update();
	});
	await page.waitForTimeout(200);
	const far = await page.evaluate(() => window.__interiors.lod());
	if (far.levels[2] !== 6) throw Error("Far kit did not select all outlines");
	await page.evaluate(() => {
		const v = window.__interiors;
		v.camera.position.set(0, -15, 0);
		v.controls.target.set(0, -15, -20);
		v.controls.update();
	});
	await page.waitForTimeout(200);
	const near = await page.evaluate(() => window.__interiors.lod());
	if (!near.levels[0]) throw Error("Return did not restore full detail");
	await page.evaluate(() => {
		document.body.classList.remove("capture");
		window.__interiors.setView("axis");
	});
	await page.selectOption("#lod", "1");
	await page.waitForTimeout(100);
	if ((await page.evaluate(() => window.__interiors.lod().mode)) !== "1")
		throw Error("Public selector failed");
	await page.selectOption("#role", "shipyard");
	await page.waitForTimeout(100);
	if (
		(await page.evaluate(() => window.__interiors.plan().berths.length)) !== 6
	)
		throw Error("Role rebuild failed");
	await page.selectOption("#lod", "auto");
	await page.click("#fittings");
	const fittingsVisible = () =>
		page.evaluate(
			() =>
				window.__interiors.diagnostics.scene.getObjectByName(
					"interior-fittings",
				).visible,
		);
	if (await fittingsVisible())
		throw Error("Fitting toggle missed the shared assembly");
	await page.click("#next");
	if (await fittingsVisible())
		throw Error("Rebuild lost the fitting visibility choice");
	await page.click("#fittings");
	if (!(await fittingsVisible()))
		throw Error("Fitting toggle missed the replacement assembly");
	await page.click("#next");
	await page.waitForTimeout(100);
	const report = { renderer, results, transitions: { far, near }, errors };
	await writeFile(
		`${out}/metrics.json`,
		JSON.stringify(report, null, 2) + "\n",
	);
	if (errors.length) throw Error(errors.join("\n"));
	console.log(
		"PASS: four themes, matched full/auto views, both reduced levels, return, controls and rebuild",
	);
} finally {
	await browser?.close();
	release();
}
