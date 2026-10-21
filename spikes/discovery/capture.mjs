import { mkdir, writeFile } from "node:fs/promises";
import { launchChromium, guardedOrigin } from "../../scripts/probe-guard.mjs";
import { assertBrowserRenderer } from "../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
const origin = "http://127.0.0.1:5189";
const label = process.argv[2] ?? "round-1";
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error("Invalid capture label");
const out = `.dream-loop/${label}`;
await mkdir(out, { recursive: true });
await guardedOrigin(origin);
const release = await holdProbeLockOrExit("Discovery visual capture");
let browser;
try {
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1536, height: 1024 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
		console.error("PAGE ERROR", e.message);
	});
	page.on("requestfailed", (r) =>
		console.error("REQUEST FAILED", r.url(), r.failure()?.errorText),
	);
	await page.goto(`${origin}/spikes/discovery/`);
	await page.waitForFunction(
		() => window.__discovery?.stats.loaded,
		{},
		{ timeout: 60000 },
	);
	const gpu = await assertBrowserRenderer(page, "Discovery capture");
	await page.waitForTimeout(1500);
	await page.evaluate(() => window.__discovery.capture());
	for (const view of ["hero", "front", "top", "rear", "detail", "under"]) {
		await page.evaluate((v) => window.__discovery.setView(v), view);
		await page.waitForTimeout(700);
		await page.screenshot({ path: `${out}/${view}.png` });
	}
	await page.evaluate(() => {
		window.__discovery.setView("hero");
		document.body.classList.remove("capture");
	});
	await page.waitForTimeout(2000);
	await page.screenshot({ path: `${out}/viewer.png` });
	const metrics = await page.evaluate(() => ({ ...window.__discovery.stats }));
	const before = await page.evaluate(() =>
		window.__discovery.camera.position.toArray(),
	);
	await page.mouse.move(720, 420);
	await page.mouse.down();
	await page.mouse.move(850, 490, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(400);
	const after = await page.evaluate(() =>
		window.__discovery.camera.position.toArray(),
	);
	if (before.every((v, i) => Math.abs(v - after[i]) < 0.001))
		throw Error("Orbit did not move");
	await page.locator("#target").click();
	await page.locator("#target-dialog").waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	if (await page.locator("#target-dialog").isVisible())
		throw Error("Target did not close");
	await page.locator("#lights").click();
	if ((await page.locator("#lights").getAttribute("aria-pressed")) !== "true")
		throw Error("Work lights failed");
	await page.locator("#lights").click();
	await page.locator("#spin").click();
	const rot = await page.evaluate(() => window.__discovery.ship.rotation.y);
	await page.waitForTimeout(300);
	if (await page.evaluate((v) => window.__discovery.ship.rotation.y === v, rot))
		throw Error("Rotation failed");
	await page.locator("#spin").click();
	await page.locator("[data-view=hero]").click();
	const downloadPromise = page.waitForEvent("download");
	await page.locator("#save").click();
	const download = await downloadPromise;
	if (!download.suggestedFilename().endsWith(".png"))
		throw Error("Image export failed");
	await download.delete();
	await page.setViewportSize({ width: 900, height: 700 });
	await page.waitForTimeout(300);
	await page.screenshot({ path: `${out}/narrow.png` });
	const report = {
		gpu,
		errors,
		...metrics,
		controls: "orbit, target, lights, rotation, presets and PNG export passed",
	};
	await writeFile(`${out}/metrics.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	if (errors.length) throw Error("Browser errors");
} finally {
	await browser?.close();
	release();
}
