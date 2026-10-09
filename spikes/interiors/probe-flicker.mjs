import { mkdir, writeFile } from "node:fs/promises";
import { webkit } from "playwright";
import { PNG } from "pngjs";
import { guardedTree, launchChromium } from "../../scripts/probe-guard.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";

const origin = "http://127.0.0.1:5205";
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const oldDepth = process.argv.includes("--prove-baseline");
const output = `.dream-loop/flicker-${engine}${oldDepth ? "-baseline" : "-fixed"}`;
await guardedTree(origin);
const release = await holdProbeLockOrExit(
	"interior back-wall depth regression",
);
let browser;
try {
	await mkdir(output, { recursive: true });
	browser =
		engine === "webkit"
			? await webkit.launch({
					headless: false,
					executablePath: process.env.WEBKIT_EXECUTABLE,
				})
			: await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1840, height: 1240 },
		deviceScaleFactor: 2,
	});
	await page.goto(
		`${origin}/spikes/interiors/?theme=works&role=shipyard&seed=206`,
	);
	await page.waitForFunction(() => window.__interiors?.stats.loaded, null, {
		timeout: 120000,
	});
	const near = oldDepth
		? 0.3
		: await page.evaluate(() => window.__interiors.camera.near);
	await page.evaluate(() => {
		const w = window.__interiors;
		w.setView("arrival");
		w.capture();
		w.controls.enableDamping = false;
	});
	const setNear = async (value) =>
		page.evaluate((value) => {
			const w = window.__interiors;
			w.camera.near = value;
			w.camera.updateProjectionMatrix();
			w.diagnostics.ao.ssaoMaterial.uniforms.cameraNear.value = value;
		}, value);
	const results = [];
	for (const [index, offset] of [
		[1.7, 0.8],
		[-1.4, 0.6],
		[2.1, -1.1],
	].entries()) {
		await page.evaluate(([x, y]) => {
			const w = window.__interiors;
			w.setView("arrival");
			w.camera.position.x += x;
			w.camera.position.y += y;
			w.controls.update();
		}, offset);
		await setNear(near);
		await page.waitForTimeout(350);
		const actual = PNG.sync.read(
			await page.screenshot({ path: `${output}/angle-${index}.png` }),
		);
		// This camera has no surface within 12 m. Increasing near preserves its
		// composition and exposes unstable distant depth ordering, without a golden image.
		await setNear(12);
		await page.waitForTimeout(350);
		const reference = PNG.sync.read(
			await page.screenshot({ path: `${output}/reference-${index}.png` }),
		);
		let darkened = 0,
			samples = 0;
		for (
			let y = Math.floor(actual.height * 0.31);
			y < actual.height * 0.69;
			y += 2
		)
			for (
				let x = Math.floor(actual.width * 0.39);
				x < actual.width * 0.61;
				x += 2
			) {
				const i = (y * actual.width + x) * 4;
				const a =
					(actual.data[i] + actual.data[i + 1] + actual.data[i + 2]) / 3;
				const b =
					(reference.data[i] + reference.data[i + 1] + reference.data[i + 2]) /
					3;
				if (b - a > 25 && a < b * 0.75) darkened++;
				samples++;
			}
		results.push({ offset, darkened, samples, fraction: darkened / samples });
	}
	await setNear(near);
	// The clipping fix must also preserve the existing inspection presets.
	for (const view of ["command", "loading", "gangway", "kit"]) {
		await page.evaluate((v) => window.__interiors.setView(v), view);
		await page.waitForTimeout(350);
		await page.screenshot({ path: `${output}/${view}.png` });
	}
	await writeFile(
		`${output}/result.json`,
		JSON.stringify({ engine, near, results }, null, 2),
	);
	console.log(JSON.stringify({ engine, near, results }));
	if (results.some((r) => r.fraction > 0.001))
		throw Error("Back-wall depth ordering is unstable");
} finally {
	await browser?.close();
	release();
}
