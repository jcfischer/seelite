/** Node #843: non-boot install, failure stand-in, capture wait, live LODs.
 * Optional SEELITE_INTERIOR_MEASURE=1 records shuffled Procedural/Full/Auto/LOD2 drained frame
 * costs under the production camera and 1440x900 drawing buffer. These serial
 * render+readPixels costs are not rAF cadence or timer-query GPU milliseconds.
 */
import { PNG } from "pngjs";
import { mkdir, writeFile } from "node:fs/promises";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
	installViewPlacement,
} from "./probe-guard.mjs";
import { installViewFraming, setView } from "./lib/view-placement.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const output = "probe-shots/interior-kit";
await mkdir(output, { recursive: true });
const params = {
	seed: 5,
	voices: "formant",
	raider: "off",
	cinematic: "off",
	"interiors-full": false,
};
const options = {
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 1,
};
const livePage = async () => {
	const page = await browser.newPage(options);
	watch(page);
	await page.addInitScript(() => {
		window.__countFrame = () => {
			const g = window.__seelite;
			g.renderer.info.autoReset = false;
			g.renderer.info.reset();
			g.render(0);
			return { ...g.renderer.info.render };
		};
	});
	// Built-bundle measurements stay offline too; satisfy the analytics script
	// locally before any request can leave the probe's origin.
	await page.route(
		"https://counterscale.jens-christian-66c.workers.dev/**",
		(route) =>
			route.fulfill({
				status: 200,
				contentType: "application/javascript",
				body: "",
			}),
	);
	return page;
};
const hasKit = (page) =>
	page.evaluate(() =>
		[...window.__seelite.stationVisuals.values()].some(
			(s) => !!s.root.getObjectByName("authored-interior"),
		),
	);
try {
	const held = await livePage();
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	await held.route("**/*station-interiors*.glb*", async (route) => {
		await gate;
		await route.continue();
	});
	const backgroundRequest = held.waitForRequest("**/*station-interiors*.glb*");
	await held.goto(gameUrl(origin, params));
	await bootedGame(held);
	await backgroundRequest;
	check(
		"interiors never block normal boot",
		!(await hasKit(held)) &&
			(await held.evaluate(() => !window.__seelite.interiorModelsSettled)),
	);
	await held.waitForFunction(() => !!window.__seelite.postcardPanel);
	await held.evaluate(() => {
		window.__seelite.openPostcardWithModels();
	});
	await held.waitForFunction(
		() => !!document.querySelector("[data-model-load]"),
	);
	check(
		"a player postcard waits for the authored kit",
		await held.evaluate(() => !window.__seelite.postcardPanel.isOpen()),
	);
	release();
	await held.waitForFunction(
		() => window.__seelite.interiorModelsSettled,
		{},
		{ timeout: 60000 },
	);
	check("background install replaces procedural bays", await hasKit(held));
	await held.waitForFunction(() => window.__seelite.postcardPanel.isOpen());
	check(
		"postcard opens after the same background download",
		await hasKit(held),
	);
	await held.evaluate(() => window.__seelite.postcardPanel.close());
	const before = await held.evaluate(
		() => window.__seelite.interiorPresentations.size,
	);
	await held.evaluate(() => window.__seelite.loadInteriorsAfterBoot());
	check(
		"repeated install preserves presentation population",
		before ===
			(await held.evaluate(() => window.__seelite.interiorPresentations.size)),
	);
	check(
		"registration without a kit releases and forgets the old presentation once",
		await held.evaluate(() => {
			const g = window.__seelite;
			const [id, handle] = g.interiorPresentations.entries().next().value;
			let releases = 0;
			const count = handle.release.length;
			handle.release = handle.release.map((undo) => () => {
				releases++;
				undo();
			});
			const withoutKit = { root: { getObjectByName: () => undefined } };
			g.registerInteriorPresentation(id, withoutKit);
			g.registerInteriorPresentation(id, withoutKit);
			const forgotten = !g.interiorPresentations.has(id);
			g.registerInteriorPresentation(id, g.stationVisuals.get(id));
			return forgotten && count > 0 && releases === count;
		}),
	);
	await held.close();
	const failed = await livePage();
	let warnings = 0;
	failed.on("console", (m) => {
		if (m.type() === "warning" && m.text().includes("station interiors:"))
			warnings++;
	});
	await failed.route("**/*station-interiors*.glb*", (route) => route.abort());
	await failed.goto(gameUrl(origin, params));
	await bootedGame(failed);
	await failed.waitForFunction(() => window.__seelite.interiorModelsSettled);
	await failed.evaluate(() => window.__seelite.loadInteriorsAfterBoot());
	check(
		"failed install retains stand-in, warns once, offers no Retry",
		!(await hasKit(failed)) &&
			warnings === 1 &&
			(await failed.locator("[data-model-load]").count()) === 0,
	);
	await failed.close();
	const full = await livePage();
	let fullRelease;
	const fullGate = new Promise((resolve) => {
		fullRelease = resolve;
	});
	let signal;
	const request = new Promise((resolve) => {
		signal = resolve;
	});
	await full.route("**/*station-interiors*.glb*", async (route) => {
		signal();
		await fullGate;
		await route.continue();
	});
	await full.goto(gameUrl(origin, { ...params, "interiors-full": true }), {
		waitUntil: "commit",
	});
	await request;
	check(
		"capture flag waits for fitting bundle before Game construction",
		await full.evaluate(() => !window.__seelite),
	);
	fullRelease();
	await bootedGame(full);
	check(
		"capture flag constructs authored bays immediately",
		await hasKit(full),
	);
	await full.close();
	// Independent pages boot once each. The failed optional load draws the exact
	// pre-kit procedural builder; both arms reset before the same scripted docking.
	const placeFixture = async (page) => {
		await page.evaluate(() => {
			const g = window.__seelite;
			cancelAnimationFrame(g.animationFrame);
			g.skipOpening();
			g.resetFlightToStart();
		});
		await page.evaluate(() =>
			window.__parkInBerth("station-trade", "port-deep"),
		);
		await setView(page, "chase");
		return page.evaluate(() => {
			const g = window.__seelite;
			g.clockHeld = true;
			g.render(0);
			return {
				gameTime: g.world.gameTime,
				ship: g.world.ship.pos,
				position: g.nearCamera.position.toArray(),
				quaternion: g.nearCamera.quaternion.toArray(),
				projection: g.nearCamera.projectionMatrix.elements,
				quality: g.settings.value.quality,
				width: g.renderer.domElement.width,
				height: g.renderer.domElement.height,
			};
		});
	};
	const rows = [];
	const shuffle = seededShuffler(843);
	for (const fixture of [
		{ seed: 5, theme: "civic" },
		{ seed: 2, theme: "works" },
		{ seed: 12, theme: "frontier" },
		{ seed: 1, theme: "survey" },
	]) {
		const page = await livePage();
		await installViewPlacement(page);
		await installViewFraming(page);
		await page.goto(
			gameUrl(origin, {
				...params,
				seed: fixture.seed,
				"interiors-full": true,
			}),
		);
		await bootedGame(page);
		await page.waitForFunction(() => window.__seelite.interiorModelsSettled);
		const renderer =
			process.env.SEELITE_PROBE_RENDERER === "hardware"
				? await assertPlayersRenderer(page, "measure production interiors")
				: "SwiftShader CPU lane";
		const fixtureState = await placeFixture(page);
		const actual = await page.evaluate(() => {
			const g = window.__seelite;
			cancelAnimationFrame(g.animationFrame);
			g.clockHeld = true;
			g.render(0);
			return {
				openingActive: g.openingActive,
				dockPhase: g.dockPhase,
				theme: g.stationVisuals
					.get("station-trade")
					.root.getObjectByName("authored-interior").userData.theme,
				near: g.nearCamera.near,
				width: g.renderer.domElement.width,
				height: g.renderer.domElement.height,
			};
		});
		check(
			`${fixture.theme} draws in a real docked bay with the game near plane`,
			actual.theme === fixture.theme &&
				actual.near === 0.01 &&
				!actual.openingActive &&
				actual.dockPhase === "docked",
		);
		const counts = {};
		for (const mode of ["default", "0", "auto", "2"]) {
			counts[mode] = await page.evaluate((mode) => {
				const g = window.__seelite;
				if (mode !== "default")
					for (const h of g.interiorPresentations.values())
						h.lods.setMode(mode);
				const stat = window.__countFrame();
				return {
					...stat,
					modes: [...g.interiorPresentations.values()].map((h) => h.lods.mode),
					levels: g.interiorPresentations.get("station-trade").lods.stats()
						.levels,
				};
			}, mode);
		}
		check(
			`${fixture.theme} defaults to per-fitting Auto and retains nearby full detail`,
			counts.default.modes.length > 0 &&
				counts.default.modes.every((mode) => mode === "auto") &&
				counts.default.levels[0] > counts["2"].levels[0] &&
				counts.default.levels[2] > 0 &&
				JSON.stringify(counts.default.levels) ===
					JSON.stringify(counts.auto.levels) &&
				counts.default.calls === counts.auto.calls &&
				counts.default.triangles === counts.auto.triangles &&
				counts.default.triangles < counts["0"].triangles,
		);
		check(
			`${fixture.theme} reduced buckets submit fewer triangles without changing instance population`,
			counts["2"].triangles < counts["0"].triangles &&
				counts["2"].levels.reduce((a, b) => a + b, 0) ===
					counts["0"].levels.reduce((a, b) => a + b, 0),
		);
		check(
			`${fixture.theme} auto partitions individual fittings`,
			counts.auto.levels.filter((n) => n > 0).length >= 2,
		);
		await page.evaluate(() => {
			const g = window.__seelite;
			for (const h of g.interiorPresentations.values()) h.lods.setMode("auto");
			g.render(0);
		});
		await page.screenshot({ path: `${output}/${fixture.theme}.png` });

		const fullPng = PNG.sync.read(await page.screenshot());
		const repeatPng = PNG.sync.read(await page.screenshot());
		const changed = (a, b) => {
			let n = 0;
			for (let i = 0; i < a.data.length; i += 4)
				if (
					Math.max(
						...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b.data[i + c])),
					) > 24
				)
					n++;
			return n;
		};
		check(
			`${fixture.theme} control frame is stable`,
			changed(fullPng, repeatPng) === 0,
		);
		await page.evaluate(() => {
			const g = window.__seelite;
			window.__interiorVisibility = [];
			for (const h of g.interiorPresentations.values())
				for (const child of h.group.children) {
					window.__interiorVisibility.push([child, child.visible]);
					child.visible = false;
				}
			g.render(0);
		});
		const hiddenPng = PNG.sync.read(await page.screenshot());
		const paintedPixels = changed(fullPng, hiddenPng);
		check(
			`${fixture.theme} fitting geometry actually paints the frame`,
			paintedPixels > 1000,
			`${paintedPixels} changed pixels`,
		);
		await page.evaluate(() => {
			for (const [child, visible] of window.__interiorVisibility)
				child.visible = visible;
			window.__seelite.render(0);
		});
		let procedural;
		let proceduralState;
		if (process.env.SEELITE_INTERIOR_MEASURE === "1") {
			procedural = await livePage();
			await installViewPlacement(procedural);
			await installViewFraming(procedural);
			await procedural.route("**/*station-interiors*.glb*", (route) =>
				route.abort(),
			);
			await procedural.goto(gameUrl(origin, { ...params, seed: fixture.seed }));
			await bootedGame(procedural);
			await procedural.waitForFunction(
				() => window.__seelite.interiorModelsSettled,
			);
			await assertPlayersRenderer(procedural, "measure procedural baseline");
			proceduralState = await placeFixture(procedural);
			const matching =
				JSON.stringify(proceduralState) === JSON.stringify(fixtureState);
			check(
				fixture.theme +
					" procedural arm has no kit and matches camera, clock and quality",
				!(await hasKit(procedural)) && matching,
				JSON.stringify({ fixtureState, proceduralState }),
			);
			if (!matching || (await hasKit(procedural)))
				throw Error("Invalid procedural comparison");
			counts.procedural = await procedural.evaluate(() =>
				window.__countFrame(),
			);
			await procedural.screenshot({
				path: output + "/" + fixture.theme + "-procedural.png",
			});
		}
		const timings = { procedural: [], 0: [], auto: [], 2: [] };
		if (process.env.SEELITE_INTERIOR_MEASURE === "1")
			for (let block = 0; block < 8; block++)
				for (const mode of shuffle(["procedural", "0", "auto", "2"]))
					timings[mode].push(
						await (mode === "procedural" ? procedural : page).evaluate(
							(mode) => {
								const g = window.__seelite,
									gl = g.renderer.getContext(),
									pixel = new Uint8Array(4);
								for (const h of g.interiorPresentations.values())
									h.lods.setMode(mode);
								g.render(0);
								gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
								const t = performance.now();
								for (let i = 0; i < 8; i++) {
									g.render(0);
									gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
								}
								return (performance.now() - t) / 8;
							},
							mode,
						),
					);
		const row = {
			...fixture,
			renderer,
			camera: actual,
			counts,
			fixtureState,
			proceduralState,
			timings,
			paintedPixels,
			medianProceduralMs: timings.procedural.length
				? median(timings.procedural)
				: null,
			fullVsProcedural: timings.procedural.length
				? separation(timings["0"], timings.procedural)
				: null,
			autoVsProcedural: timings.procedural.length
				? separation(timings.auto, timings.procedural)
				: null,
			medianFullMs: timings["0"].length ? median(timings["0"]) : null,
			medianDefaultMs: timings.auto.length ? median(timings.auto) : null,
			defaultVsFull: timings.auto.length
				? separation(timings.auto, timings["0"])
				: null,
			defaultVsProcedural: timings.procedural.length
				? separation(timings.auto, timings.procedural)
				: null,
			medianLod2Ms: timings["2"].length ? median(timings["2"]) : null,
			medianAutoMs: timings.auto.length ? median(timings.auto) : null,
			separation: timings.auto.length
				? separation(timings.auto, timings["0"])
				: null,
		};
		rows.push(row);
		console.log(JSON.stringify(row));
		await procedural?.close();
		await page.close();
	}
	await writeFile(
		`${output}/production.json`,
		JSON.stringify(
			{
				build: process.env.SEELITE_INTERIOR_BUILD ?? "Vite development modules",
				measurement:
					"serial render + 1x1 readPixels per frame; shuffled seed 843; 8 blocks x 8 frames per arm",
				rows,
			},
			null,
			2,
		) + "\n",
	);
} finally {
	await browser.close();
}
exit();
