import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { launchChromium, guardedOrigin } from "../../scripts/probe-guard.mjs";
import { assertBrowserRenderer } from "../../scripts/lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
const origin = "http://127.0.0.1:5189",
	label = process.argv[2] ?? "round1";
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw Error("Bad capture label");
const out = `.dream-loop/${label}`;
await mkdir(out, { recursive: true });
await guardedOrigin(origin);
const release = await holdProbeLockOrExit("metropolis growth study");
let browser;
try {
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1586, height: 992 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => {
		errors.push(e.message);
		console.error(e.message);
	});
	page.on("console", (m) => {
		if (m.type() === "error") console.error(m.text());
	});
	await page.goto(`${origin}/spikes/metropolis/`);
	await page.waitForFunction(() => window.__metropolis?.loaded);
	const gpu = await assertBrowserRenderer(page, "metropolis capture");
	await page.waitForTimeout(1600);
	await page.screenshot({ path: `${out}/viewer.png` });
	await page.evaluate(() => window.__metropolis.capture());
	for (const view of ["hero", "detail", "front", "rear"]) {
		await page.evaluate((v) => window.__metropolis.setView(v), view);
		await page.waitForTimeout(450);
		await page.screenshot({ path: `${out}/${view}.png` });
	}
	const growth = await page.evaluate(() => {
		const a = window.__metropolis;
		a.setCount(8);
		const ids = [...a.station.attached].map(([id, g]) => [
			id,
			g.uuid,
			g.position.toArray(),
		]);
		a.setCount(9);
		const added = [...a.station.attached.keys()].filter(
			(id) => !ids.some((x) => x[0] === id),
		);
		const retained = ids.every(([id, uuid, p]) => {
			const g = a.station.attached.get(id);
			return (
				g?.uuid === uuid &&
				JSON.stringify(g.position.toArray()) === JSON.stringify(p)
			);
		});
		if (!retained || added.length !== 1)
			throw Error("Expansion moved/rebuilt old modules");
		return { retained, added };
	});
	const geometry = await page.evaluate(async () => {
		const T = await import("/node_modules/three/build/three.module.js");
		window.__metropolis.setCount(42);
		const root = window.__metropolis.station.root;
		root.updateMatrixWorld(true);
		const axes = ["outward-wheel-left", "outward-wheel-right"].map((name) =>
			new T.Vector3(0, 0, 1)
				.applyQuaternion(
					root.getObjectByName(name).getWorldQuaternion(new T.Quaternion()),
				)
				.toArray(),
		);
		if (axes[0][0] > -0.999 || axes[1][0] < 0.999)
			throw Error("Wheels do not face outward along the spine");
		const aperture = [];
		for (const x of [-58, 0, 58])
			for (const y of [-33, 0, 33]) {
				const ray = new T.Raycaster(
					new T.Vector3(x, y, 1000),
					new T.Vector3(0, 0, -1),
				);
				const hit = ray.intersectObject(root, true)[0];
				if (hit && hit.point.z > 200.01)
					throw Error(
						`Dock approach obstructed at ${x},${y}: z=${hit.point.z}`,
					);
				aperture.push(hit?.point.z ?? null);
			}
		return {
			axes,
			aperture,
			scope:
				"Nine rays through inner slot, not a production collision certification",
		};
	});
	await page.evaluate(() => window.__metropolis.setView("hero"));
	for (const n of [8, 20, 38, 42]) {
		await page.evaluate((n) => window.__metropolis.setCount(n), n);
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${out}/growth-${n}.png` });
	}
	await page.evaluate(() => {
		document.body.classList.remove("capture");
		window.__metropolis.setCount(8);
	});
	await page.locator("#add").click();
	if ((await page.locator("#count-value").textContent()) !== "9 / 42")
		throw Error("Add control failed");
	await page.locator("#grow").click();
	await page.waitForFunction(() => window.__metropolis.station.count >= 11);
	await page.locator("#grow").click();
	await page.locator("#seed").fill("82");
	await page.locator("#seed").dispatchEvent("change");
	await page.waitForFunction(
		() =>
			window.__metropolis.loaded &&
			window.__metropolis.station.plan.seed === 82,
	);
	await page.locator("#seed").fill("47");
	await page.locator("#seed").dispatchEvent("change");
	await page.waitForFunction(
		() =>
			window.__metropolis.loaded &&
			window.__metropolis.station.plan.seed === 47,
	);
	await page.evaluate(() => {
		window.__metropolis.setCount(42);
		window.__metropolis.capture();
		window.__metropolis.setView("hero");
	});
	await page.waitForTimeout(3000);
	const stats = await page.evaluate(() => window.__metropolis.stats);
	await page.screenshot({ path: `${out}/hero.png` });
	const imageStats = await sharp(`${out}/hero.png`).stats();
	if (imageStats.channels.slice(0, 3).every((c) => c.stdev < 8))
		throw Error("Capture is blank or has insufficient scene contrast");
	if (errors.length) throw Error(errors.join("\n"));
	await writeFile(
		`${out}/report.json`,
		JSON.stringify(
			{
				gpu,
				stats,
				growth,
				geometry,
				errors,
				scope:
					"Isolated viewer only; FPS is display-paced, not production headroom",
			},
			null,
			2,
		),
	);
	console.log(JSON.stringify({ out, gpu, stats, growth, geometry, errors }));
} finally {
	await browser?.close();
	await release();
}
