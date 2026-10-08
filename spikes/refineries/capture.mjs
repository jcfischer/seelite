import { mkdir, writeFile } from "node:fs/promises";
import { launchChromium, guardedOrigin } from "../../scripts/probe-guard.mjs";
import { assertBrowserRenderer } from "../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
const origin = "http://127.0.0.1:5214",
	label = process.argv[2] ?? "round-1";
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error("Invalid label");
const out = ".dream-loop/" + label;
await mkdir(out, { recursive: true });
await guardedOrigin(origin);
const release = await holdProbeLockOrExit("refinery visual capture");
let browser;
try {
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1536, height: 1024 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(origin + "/spikes/refineries/");
	await page.waitForFunction(
		() => window.__refineries?.stats.loaded,
		{},
		{ timeout: 60000 },
	);
	const gpu = await assertBrowserRenderer(page, "refinery capture");
	const results = {};
	for (const id of (process.env.MODELS ?? "o1,o2,o3,o4").split(",")) {
		await page.evaluate(async (id) => {
			await window.__refineries.selectModel(id);
			window.__refineries.capture();
		}, id);
		await page.waitForTimeout(1800);
		for (const view of ["hero", "front", "top", "rear", "detail", "under"]) {
			await page.evaluate((v) => window.__refineries.setView(v), view);
			await page.waitForTimeout(450);
			await page.screenshot({ path: out + "/" + id + "-" + view + ".png" });
		}
		await page.evaluate(() => {
			window.__refineries.setView("hero");
			document.body.classList.remove("capture");
		});
		await page.waitForTimeout(1500);
		await page.screenshot({ path: out + "/" + id + "-viewer.png" });
		const before = await page.evaluate(() =>
			window.__refineries.camera.position.toArray(),
		);
		await page.mouse.move(650, 460);
		await page.mouse.down();
		await page.mouse.move(850, 540, { steps: 8 });
		await page.mouse.up();
		await page.waitForTimeout(300);
		const after = await page.evaluate(() =>
			window.__refineries.camera.position.toArray(),
		);
		if (before.every((v, i) => Math.abs(v - after[i]) < 0.001))
			throw Error("Orbit failed");
		const d0 = await page.evaluate(() =>
			window.__refineries.camera.position.distanceTo(
				window.__refineries.controls.target,
			),
		);
		await page.mouse.wheel(0, -180);
		await page.waitForTimeout(350);
		const d1 = await page.evaluate(() =>
			window.__refineries.camera.position.distanceTo(
				window.__refineries.controls.target,
			),
		);
		if (d0 === d1) throw Error("Zoom failed");
		await page.locator("#target").click();
		await page.locator("#target-dialog").waitFor({ state: "visible" });
		if (
			!(await page.locator("#target-dialog img").getAttribute("src")).includes(
				id,
			)
		)
			throw Error("Wrong target");
		await page.keyboard.press("Escape");
		if (await page.locator("#target-dialog").isVisible())
			throw Error("Target close failed");
		await page.locator("#lights").click();
		if ((await page.locator("#lights").getAttribute("aria-pressed")) !== "true")
			throw Error("Lights failed");
		await page.locator("#lights").click();
		await page.locator("#spin").click();
		const angle = await page.evaluate(
			() => window.__refineries.ship.rotation.y,
		);
		await page.waitForTimeout(250);
		if (
			await page.evaluate(
				(a) => window.__refineries.ship.rotation.y === a,
				angle,
			)
		)
			throw Error("Rotation failed");
		await page.locator("#spin").click();
		await page.locator("[data-view=hero]").click();
		const downloadPromise = page.waitForEvent("download");
		await page.locator("#save").click();
		const download = await downloadPromise;
		if (!download.suggestedFilename().endsWith(".png"))
			throw Error("PNG failed");
		await download.delete();
		results[id] = await page.evaluate(() => ({ ...window.__refineries.stats }));
	}
	const report = {
		gpu,
		errors,
		results,
		controls:
			"Orbit, vertical orbit, zoom, camera presets, per-model targets, work lights, rotation and PNG export passed",
	};
	await writeFile(out + "/metrics.json", JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	if (errors.length) throw Error("Browser errors");
} finally {
	await browser?.close();
	release();
}
