import { mkdir, writeFile } from "node:fs/promises";
import { bootedGame, installViewPlacement } from "../probe-guard.mjs";
import { gameUrl } from "./game-url.mjs";
import { installViewFraming } from "./view-placement.mjs";

async function installTradeStation(page) {
	await page.evaluate(() => {
		window.__tradeStation = () => {
			const station = window.__seelite.world.system.contents.stations.find(
				(s) => s.type === "trade",
			);
			if (!station) throw Error("trade fixture has no trade station");
			return station;
		};
	});
}

async function frameTrade(page, distance, view) {
	await page.evaluate(
		async ({ distance, view }) => {
			const g = window.__seelite;
			await window.__viewAlongAxis(window.__tradeStation().id, distance);
			g.view = view;
			g.render(0);
		},
		{ distance, view },
	);
}

/** Held responses prove the authored trade forms' production installation (node #1033). */
export async function probeTradeModels(
	browser,
	origin,
	params,
	{ check, watch },
) {
	const out = "probe-shots/trade-models";
	await mkdir(out, { recursive: true });
	const measurements = [];
	for (const [form, name, system, from] of [
		["b", "ring", 1, 5],
		["c", "drum", 0, 52],
		["e", "wheel", 3, 26],
	]) {
		const page = await browser.newPage({
			viewport: { width: 1440, height: 900 },
		});
		watch(page);
		await installViewPlacement(page);
		await installViewFraming(page);
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		let attempts = 0;
		await page.route(new RegExp(`/trade-${name}[^/]*\\.glb`), async (route) => {
			attempts++;
			await gate;
			await route.continue();
		});
		await page.goto(
			gameUrl(origin, { ...params, seed: 42, system: from, "no-save": true }),
		);
		await bootedGame(page, 120000);
		await installTradeStation(page);
		await page.evaluate((index) => {
			const g = window.__seelite;
			g.clockHeld = true;
			g.performJump(g.world.galaxy.systems.find((s) => s.index === index));
			if (g.world.system.record.index !== index)
				throw Error(`trade jump fixture refused ${index}`);
			g.setWitchspace({ kind: "idle" });
		}, system);
		await frameTrade(page, 3, "chase");
		const standIn = await page.evaluate(() => {
			const g = window.__seelite;
			const station = window.__tradeStation();
			const mesh = g.stationVisuals.get(station.id);
			return {
				form: station.formId,
				authored: !!mesh.root.getObjectByName("authored-exterior"),
				settled: g.modelsSettled(),
			};
		});
		check(
			`trade/${form}: a held model leaves its procedural form after a jump`,
			standIn.form === form && !standIn.authored && !standIn.settled,
			JSON.stringify(standIn),
		);
		await page.screenshot({ path: `${out}/${name}-before.png` });
		const closeShot = async (label) => {
			await frameTrade(page, 0.65, "cockpit");
			await page.screenshot({ path: `${out}/${name}-mouth-${label}.png` });
			await frameTrade(page, 3, "chase");
		};
		await closeShot("before");
		const measure = async () =>
			page.evaluate(() => {
				const g = window.__seelite;
				const station = window.__tradeStation();
				const mesh = g.stationVisuals.get(station.id);
				let owner = mesh.root;
				while (owner.parent && owner.parent !== g.nearScene)
					owner = owner.parent;
				if (owner.parent !== g.nearScene)
					throw Error("trade measurement is not in the near scene");
				const saved = g.nearScene.children.map((o) => [o, o.visible]);
				mesh.root.traverse((o) => {
					if (o.name === "station-interior") saved.push([o, o.visible]);
				});
				const reset = g.renderer.info.autoReset;
				const shadow = g.renderer.shadowMap;
				const shadowState = [shadow.autoUpdate, shadow.needsUpdate];
				try {
					for (const [o] of saved)
						if (o !== owner && !o.isLight) o.visible = false;
					g.renderer.info.autoReset = false;
					shadow.autoUpdate = false;
					shadow.needsUpdate = false;
					g.renderer.info.reset();
					g.renderer.render(g.nearScene, g.nearCamera);
					const { calls, triangles } = g.renderer.info.render;
					return { calls, triangles };
				} finally {
					for (const [o, visible] of saved) o.visible = visible;
					g.renderer.info.autoReset = reset;
					[shadow.autoUpdate, shadow.needsUpdate] = shadowState;
				}
			});
		const procedural = await measure();
		await page.evaluate(() => {
			window.__tradeInstallIntervals = [];
			window.__tradeInstallRecording = true;
			let previous = performance.now();
			const sample = (now) => {
				window.__tradeInstallIntervals.push(now - previous);
				previous = now;
				if (window.__tradeInstallRecording) requestAnimationFrame(sample);
			};
			requestAnimationFrame(sample);
		});
		release();
		await page.waitForFunction(
			() => window.__seelite.modelsSettled(),
			undefined,
			{ timeout: 180000 },
		);
		const authored = await measure();
		const timing = await page.evaluate(async () => {
			window.__tradeInstallRecording = false;
			const intervals = [];
			let previous = await new Promise((resolve) =>
				requestAnimationFrame(resolve),
			);
			for (let i = 0; i < 120; i++) {
				const now = await new Promise((resolve) =>
					requestAnimationFrame(resolve),
				);
				intervals.push(now - previous);
				previous = now;
			}
			intervals.sort((a, b) => a - b);
			return {
				quality: window.__seelite.settings.value.quality,
				samples: intervals.length,
				medianMs: intervals[60],
				p95Ms: intervals[114],
				maxInstallIntervalMs: Math.max(...window.__tradeInstallIntervals),
			};
		});
		const installed = await page.evaluate(async () => {
			const g = window.__seelite;
			const station = window.__tradeStation();
			const mesh = g.stationVisuals.get(station.id);
			const root = mesh.root;
			await g.modelInstalled(`trade/${station.formId}`);
			return {
				authored: !!root.getObjectByName("authored-exterior"),
				stable: g.stationVisuals.get(station.id).root === root,
				stationId: station.id,
			};
		});
		check(
			`trade/${form}: installs once into the live scene`,
			attempts === 1 && installed.authored && installed.stable,
			JSON.stringify({ attempts, ...installed }),
		);
		await page.screenshot({ path: `${out}/${name}-after.png` });
		await closeShot("after");
		const dock = await page.evaluate(async (id) => {
			await window.__parkInBerth(id, "deck-near");
			const g = window.__seelite;
			const docked = g.dockPhase === "docked";
			g.launch();
			g.skipDockTraversal();
			for (let i = 0; i < 600 && g.dockPhase !== "flying"; i++) g.step(1 / 60);
			return { docked, launched: g.dockPhase === "flying" };
		}, installed.stationId);
		check(
			`trade/${form}: docks with game-clock spin and launches`,
			dock.docked && dock.launched,
			JSON.stringify(dock),
		);
		measurements.push({ form, name, procedural, authored, timing });
		await page.close();
	}
	const failed = await browser.newPage();
	watch(failed);
	let attempts = 0;
	const warnings = [];
	failed.on("console", (m) => {
		if (m.type() === "warning" && m.text().startsWith("trade/b:"))
			warnings.push(m.text());
	});
	await failed.route(/\/trade-ring[^/]*\.glb/, (route) => {
		attempts++;
		return route.abort();
	});
	await failed.goto(
		gameUrl(origin, { ...params, seed: 42, system: 5, "no-save": true }),
	);
	await bootedGame(failed, 120000);
	await installTradeStation(failed);
	await failed.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.performJump(g.world.galaxy.systems.find((s) => s.index === 1));
	});
	await failed.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 180000 },
	);
	const fallback = await failed.evaluate(() => {
		const g = window.__seelite;
		g.startModelQueue();
		const station = window.__tradeStation();
		return (
			!g.stationVisuals
				.get(station.id)
				.root.getObjectByName("authored-exterior") &&
			!document.querySelector("[data-model-retry]")
		);
	});
	check(
		"trade failure keeps the procedural form and warns once",
		fallback && attempts === 1 && warnings.length === 1,
		JSON.stringify({ attempts, warnings }),
	);
	await failed.close();
	await writeFile(
		`${out}/measurements.json`,
		JSON.stringify(measurements, null, 2),
	);
	console.log(JSON.stringify({ tradeModelDrawMeasurements: measurements }));
}
