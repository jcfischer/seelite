import { mkdir, writeFile } from "node:fs/promises";
import { launchChromium, guardedOrigin } from "../../scripts/probe-guard.mjs";
import { assertBrowserRenderer } from "../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
const origin = "http://127.0.0.1:5213",
	label = process.argv[2] ?? "round-1";
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error("Invalid label");
const out = `.dream-loop/${label}`;
await mkdir(out, { recursive: true });
await guardedOrigin(origin);
const release = await holdProbeLockOrExit("Longwall design capture");
let browser;
try {
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1536, height: 1024 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(origin + "/spikes/longwall-miner/");
	await page.waitForFunction(
		() => window.__longwall?.stats.loaded,
		{},
		{ timeout: 60000 },
	);
	const gpu = await assertBrowserRenderer(page, "Longwall capture");
	await page.evaluate(() => window.__longwall.capture());
	for (const view of ["hero", "front", "top", "rear", "detail", "under"]) {
		await page.evaluate((v) => window.__longwall.setView(v), view);
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${out}/${view}.png` });
	}
	await page.evaluate(() => {
		window.__longwall.setPose({
			anchors: 1,
			extension: 1,
			rock: true,
			cutting: false,
		});
		window.__longwall.setView("mining");
	});
	await page.waitForTimeout(800);
	await page.screenshot({ path: `${out}/mining.png` });
	await page.evaluate(() => window.__longwall.setPose({ rock: false }));
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${out}/deployed.png` });
	await page.evaluate(() => {
		document.body.classList.remove("capture");
		window.__longwall.setView("hero");
		window.__longwall.setPose({ anchors: 0, extension: 0 });
	});
	const read = () =>
		page.evaluate(() => {
			const w = window.__longwall;
			w.ship.updateMatrixWorld(true);
			return {
				feed: w.ship.getObjectByName("feed").position.toArray(),
				foot: w.ship.getObjectByName("anchor-0-foot").position.toArray(),
				rotor: w.ship.getObjectByName("rotor").rotation.z,
			};
		});
	const initial = await read();
	await page.locator("#anchors").fill("1");
	await page.locator("#anchors").dispatchEvent("input");
	const anchored = await read();
	if (anchored.foot[2] !== 60.75 || anchored.feed.join() != initial.feed.join())
		throw Error("Anchor independence failed");
	await page.locator("#extension").fill("1");
	await page.locator("#extension").dispatchEvent("input");
	const extended = await read();
	if (
		extended.feed[2] <= anchored.feed[2] ||
		extended.foot.join() != anchored.foot.join()
	)
		throw Error("Feed independence failed");
	await page.locator("#cut").click();
	await page.waitForTimeout(300);
	if ((await read()).rotor === extended.rotor)
		throw Error("Rotor did not rotate");
	await page.locator("#cut").click();
	await page.locator("#stow").click();
	const stowed = await read();
	if (
		stowed.feed.join() != initial.feed.join() ||
		stowed.foot.join() != initial.foot.join()
	)
		throw Error("Stow failed");
	await page.locator("#mine").click();
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${out}/viewer.png` });
	const metrics = await page.evaluate(() => ({ ...window.__longwall.stats }));
	const before = await page.evaluate(() =>
		window.__longwall.camera.position.toArray(),
	);
	await page.mouse.move(850, 420);
	await page.mouse.down();
	await page.mouse.move(950, 490, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(250);
	const after = await page.evaluate(() =>
		window.__longwall.camera.position.toArray(),
	);
	if (before.every((v, i) => Math.abs(v - after[i]) < 0.001))
		throw Error("Orbit failed");
	await page.locator("#target").click();
	await page.locator("#target-dialog").waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	const dl = page.waitForEvent("download");
	await page.locator("#save").click();
	await (await dl).delete();
	await page.setViewportSize({ width: 900, height: 700 });
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${out}/narrow.png` });
	const report = {
		gpu,
		errors,
		...metrics,
		controls:
			"anchors, independent feed, cutter rotation, stow, mining pose, orbit, target and PNG export passed",
	};
	await writeFile(`${out}/metrics.json`, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report));
	if (errors.length) throw Error("Browser errors");
} finally {
	await browser?.close();
	release();
}
