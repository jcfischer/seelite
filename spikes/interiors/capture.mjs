import { mkdir, writeFile, readFile } from "node:fs/promises";
import { guardedTree, launchChromium } from "../../scripts/probe-guard.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import { PNG } from "pngjs";
const origin = "http://127.0.0.1:5205",
	label = process.argv[2] ?? "round1";
if (!/^[a-z0-9-]+$/.test(label)) throw Error("Invalid label");
await guardedTree(origin);
const release = await holdProbeLockOrExit("interior design capture");
let browser;
try {
	await mkdir(`.dream-loop/${label}`, { recursive: true });
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1584, height: 992 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(origin + "/spikes/interiors/");
	await page.waitForFunction(() => window.__interiors?.stats.loaded, null, {
		timeout: 120000,
	});
	const renderer = await page.evaluate(() => {
		const gl = window.__interiors.renderer.getContext();
		return gl.getParameter(
			gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL,
		);
	});
	if (/swiftshader|software|llvmpipe/i.test(renderer)) throw Error(renderer);
	const source = await readFile(
		new URL("./viewer.ts", import.meta.url),
		"utf8",
	);
	const expected = source.match(/const BUILD_ID = "([^"]+)"/)[1];
	const actual = await page.evaluate(() => window.__interiors.stats.buildId);
	if (actual !== expected)
		throw Error(
			`Stale viewer: served ${actual}, expected ${expected}; restart this dev server.`,
		);
	const results = [];
	for (const theme of ["civic", "works", "frontier", "survey"]) {
		await page.evaluate((t) => window.__interiors.select(t), theme);
		await page.evaluate(() => window.__interiors.capture());
		for (const view of ["axis", "command", "loading", "gangway", "kit"]) {
			await page.evaluate((v) => window.__interiors.setView(v), view);
			await page.waitForTimeout(600);
			const shot = await page.screenshot({
				path: `.dream-loop/${label}/${theme}-${view}.png`,
			});
			const png = PNG.sync.read(shot);
			let lit = 0,
				sampled = 0;
			// Sample the scene centre, excluding the viewer's HTML controls.
			for (let y = 180; y < png.height - 120; y += 4) {
				for (let x = 380; x < png.width - 280; x += 4) {
					const i = (y * png.width + x) * 4;
					if (Math.max(...png.data.subarray(i, i + 3)) > 25) lit++;
					sampled++;
				}
			}
			if (lit / sampled < 0.03) throw Error(`Blank scene: ${theme}/${view}`);
		}
		await page.evaluate(() => window.__interiors.setView("axis"));
		await page.waitForTimeout(1500);
		results.push(await page.evaluate(() => ({ ...window.__interiors.stats })));
	}
	// Exercise the public controls as a user would, after the visual capture.
	await page.evaluate(() => window.__interiors.select("civic"));
	for (const seed of [205, 206, 207]) {
		await page.evaluate((s) => window.__interiors.setSeed(s), seed);
		await page.evaluate(() => window.__interiors.setView("arrival"));
		await page.waitForTimeout(600);
		await page.screenshot({
			path: `.dream-loop/${label}/civic-seed-${seed}.png`,
		});
	}
	await page.keyboard.press("h");
	await page.selectOption("#role", "shipyard");
	if (
		(await page.evaluate(() => window.__interiors.plan().berths.length)) !== 6
	)
		throw Error("Shipyard selector did not select six berths");
	await page.selectOption("#role", "trade");
	const before = await page.evaluate(() =>
		JSON.stringify(window.__interiors.plan().fittings),
	);
	await page.click("#next");
	const after = await page.evaluate(() =>
		JSON.stringify(window.__interiors.plan().fittings),
	);
	if (before === after) throw Error("Next station did not rearrange fittings");
	for (const id of ["fittings", "ships", "clearance"]) {
		const initial = await page.getAttribute(`#${id}`, "aria-pressed");
		await page.click(`#${id}`);
		if ((await page.getAttribute(`#${id}`, "aria-pressed")) === initial)
			throw Error(`${id} toggle failed`);
		await page.click(`#${id}`);
	}
	await page.click("#target");
	if (!(await page.locator("#target-dialog").evaluate((d) => d.open)))
		throw Error("Target comparison did not open");
	await page.click("#close");
	const download = page.waitForEvent("download");
	await page.click("#save");
	if (!(await download).suggestedFilename().endsWith(".png"))
		throw Error("PNG export failed");
	const position = await page.evaluate(() =>
		window.__interiors.camera.position.toArray(),
	);
	await page.mouse.move(850, 500);
	await page.mouse.down();
	await page.mouse.move(920, 550, { steps: 10 });
	await page.mouse.up();
	await page.waitForTimeout(300);
	if (
		JSON.stringify(position) ===
		JSON.stringify(
			await page.evaluate(() => window.__interiors.camera.position.toArray()),
		)
	)
		throw Error("Orbit drag did not move camera");
	await writeFile(
		`.dream-loop/${label}/metrics.json`,
		JSON.stringify({ renderer, results, errors }, null, 2),
	);
	console.log(JSON.stringify({ renderer, results, errors }));
	if (errors.length) throw Error(errors.join("\n"));
} finally {
	await browser?.close();
	release();
}
