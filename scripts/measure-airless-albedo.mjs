/** Node #213 diagnostic: headed ?fps, vsync off, 1440x900. Interleaved
 * parent-shader/current-shader readings in the same scene, plus unlit linear
 * albedo measurements. This is a term comparison, not two canonical builds
 * and not the principal's visual approval. Writes scoped screenshots and JSON
 * to the gitignored view-set directory. Run in the foreground:
 *   node scripts/measure-airless-albedo.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import {
	bootedGame,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { parseFpsReadout, vsyncRefusal } from "./lib/planet-cost.mjs";
import { SEED, VIEWPORT, VIEWS } from "./lib/view-set.mjs";

const release = await holdProbeLockOrExit("measure-airless-albedo");
const { watch, check, exit } = tally();
let server, browser;
try {
	server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
	await server.listen();
	const address = server.httpServer.address();
	const origin = `http://127.0.0.1:${address.port}`;
	browser = await launchChromium({
		headless: false,
		args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
	});
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 1,
	});
	watch(page);
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: SEED, fps: true }));
	await bootedGame(page);
	const renderer = await assertPlayersRenderer(page, "measure airless albedo");
	const shot = VIEWS.find((v) => v.name === "airless-fill").shot;
	await page.evaluate(async (s) => {
		const g = window.__seelite;
		g.view = "chase";
		g.settings.set("renderScale", 1);
		g.settings.set("antialias", 0);
		g.setSurfacePin("four-tap");
		await window.__sunOffset(s.body, s.radii, s.sunAngleDeg);
	}, shot);
	await page.waitForFunction(
		() => window.__seelite.bakeQueue.length === 0,
		undefined,
		{ timeout: 60000 },
	);
	const albedo = await page.evaluate(async () => {
		const { airlessAlbedoReadings } = await import(
			"/scripts/lib/airless-albedo.mjs"
		);
		return airlessAlbedoReadings(window.__seelite);
	});
	const switchArm = async (arm) =>
		page.evaluate(
			async ({ id, arm }) => {
				const vis = window.__seelite.bodyVisuals.get(id);
				const { AIRLESS } = await import("/src/planet-classes.glsl.ts");
				const { AIRLESS: before } = await import(
					"/scripts/lib/fixtures/airless-before-213.ts"
				);
				const material = vis.surfaceMesh.material;
				const quality = window.__seelite.settings.value.quality;
				window.__airlessCurrentByQuality ??= {};
				const sources = window.__airlessCurrentByQuality;
				sources[quality] ??= material.fragmentShader;
				if (!sources[quality].includes(AIRLESS))
					throw new Error(
						"airless cost comparison has no procedural AIRLESS source",
					);
				material.fragmentShader =
					arm === "before"
						? sources[quality].replace(AIRLESS, before)
						: sources[quality];
				material.needsUpdate = true;
			},
			{ id: shot.body, arm },
		);
	await mkdir("view-set", { recursive: true });
	const rows = [],
		controls = [];
	for (const quality of ["high", "low"]) {
		await page.evaluate(async (q) => {
			window.__seelite.settings.set("quality", q);
			await new Promise(requestAnimationFrame);
		}, quality);
		// Alternate the order by block, so a drift is not always priced as after.
		for (let block = 0; block < 3; block++)
			for (const arm of block % 2 ? ["after", "before"] : ["before", "after"]) {
				await switchArm(arm);
				await page.waitForTimeout(1800); // discard compile/settle windows
				const readings = [];
				for (let i = 0; i < 3; i++) {
					await page.waitForTimeout(650);
					readings.push(
						parseFpsReadout(await page.locator("#seelite-fps").textContent()),
					);
				}
				rows.push({ quality, arm, block, readings });
				if (block === 0)
					await page.screenshot({
						path: `view-set/airless-${quality}-${arm}.png`,
					});
			}
		// Restore the production arm before applyQuality can rebuild its source.
		await switchArm("after");
	}
	await switchArm("after");
	await page.evaluate(async (id) => window.__sunOffset(id, 200, 60), shot.body);
	await page.waitForTimeout(1800);
	for (let i = 0; i < 3; i++) {
		await page.waitForTimeout(650);
		controls.push(
			parseFpsReadout(await page.locator("#seelite-fps").textContent()).ms,
		);
	}
	const refusal = vsyncRefusal([
		...controls,
		...rows.flatMap((r) => r.readings.map((v) => v.ms)),
	]);
	if (refusal) throw new Error(refusal);
	const result = {
		renderer,
		viewport: VIEWPORT,
		basis: "parent shader vs current shader; forced procedural four-tap",
		albedo,
		rows,
		controls,
	};
	check(
		"the diagnostic compares both shader arms at both qualities",
		rows.length === 12,
		`${rows.length} blocks`,
	);
	await writeFile(
		"view-set/airless-cost.json",
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
} finally {
	await browser?.close();
	await server?.close();
	release();
}
exit();
