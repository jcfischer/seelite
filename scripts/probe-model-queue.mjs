/** Node #838: readiness is observed with model responses held, never a sleep. */
import { mkdir } from "node:fs/promises";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const params = {
	seed: 42,
	voices: "formant",
	raider: "off",
	cinematic: false,
	"no-save": true,
	"models-full": false,
	"interiors-full": false,
	"shipyards-full": false,
	"refineries-full": false,
	"outposts-full": false,
};
await mkdir("probe-shots/model-queue", { recursive: true });
try {
	const held = await browser.newPage();
	watch(held);
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const requests = [];
	await held.route(/\.glb(?:\?|$)/, async (route) => {
		const url = route.request().url();
		requests.push(url);
		// Seed 42 starts at trade/a: these two are the entire boot set.
		if (!/\/(?:coriolis|courier-cockpit)[^/]*\.glb/.test(url)) await gate;
		await route.continue();
	});
	await held.goto(gameUrl(origin, params));
	await bootedGame(held, 60000);
	check(
		"only cockpit and home exterior block Game; current set remains unsettled",
		await held.evaluate(() => {
			const g = window.__seelite;
			g.clockHeld = true;
			return (
				!g.modelsSettled() &&
				!g.shipMesh.userData.authored &&
				!document.querySelector("[data-model-retry]")
			);
		}),
	);
	const jump = await held.evaluate(() => {
		const g = window.__seelite;
		const from = g.world.system.record.index;
		const to = g.world.galaxy.systems.find(
			(s) => s.index !== from && g.jumpDecision(s).ok,
		);
		if (!to || !g.commitCourseTo(to.index) || !g.chargeJump())
			throw Error("jump fixture refused");
		// The shipped charge and cut, with every optional response still held.
		g.stepJumpCharge(g.jumpCharge.leftS ?? 100);
		g.takePendingJump();
		g.render(0);
		return {
			from,
			to: to.index,
			arrived: g.world.system.record.index,
			settled: g.modelsSettled(),
			standIns: [...g.stationVisuals.values()].some(
				(s) =>
					!s.root.getObjectByName("authored-exterior") &&
					!s.root.getObjectByName("industrial-coriolis-exterior"),
			),
		};
	});
	check(
		"jump charge and cut arrive with models held and stand-ins drawn",
		jump.arrived === jump.to && !jump.settled && jump.standIns,
		JSON.stringify(jump),
	);
	await held.screenshot({
		path: "probe-shots/model-queue/arrival-stand-ins.png",
	});
	release();
	await held.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
	check(
		"current set settles after installs and refreshes",
		await held.evaluate(() => window.__seelite.modelsSettled()),
	);
	await held.screenshot({
		path: "probe-shots/model-queue/arrival-installed.png",
	});
	await held.evaluate((from) => {
		const g = window.__seelite;
		g.fuelLy = g.fuelCapacityLy;
		g.performJump(g.world.galaxy.systems.find((s) => s.index === from));
	}, jump.from);
	await held.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
	check(
		"returning keeps decoded models without refetch",
		new Set(requests).size === requests.length,
	);
	await held.close();

	const miner = await browser.newPage();
	watch(miner);
	let releaseMiner;
	const minerGate = new Promise((resolve) => {
		releaseMiner = resolve;
	});
	await miner.route(/\/longwall-miner[^/]*\.glb/, async (route) => {
		await minerGate;
		await route.continue();
	});
	await miner.goto(gameUrl(origin, { ...params, hull: "miner" }));
	await bootedGame(miner, 60000);
	const minerRoot = await miner.evaluateHandle(() => {
		window.__seelite.clockHeld = true;
		return window.__seelite.shipMesh;
	});
	check(
		"a cold miner boots with its procedural stand-in while Longwall is held",
		await miner.evaluate(() => {
			const g = window.__seelite;
			return (
				g.flownHull === "miner" &&
				!g.shipMesh.userData.authored &&
				!g.modelsSettled()
			);
		}),
	);
	releaseMiner();
	await miner.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
	check(
		"Longwall installs into the existing miner root and a second refresh leaves it intact",
		await miner.evaluate(async (root) => {
			const g = window.__seelite;
			const child = root.children[0];
			await g.modelInstalled("miner");
			return (
				g.shipMesh === root &&
				root.userData.authored &&
				root.children[0] === child
			);
		}, minerRoot),
	);
	await minerRoot.dispose();
	await miner.close();

	const failed = await browser.newPage();
	watch(failed);
	let attempts = 0;
	const warnings = [];
	failed.on("console", (m) => {
		if (m.type() === "warning" && m.text().startsWith("courier:"))
			warnings.push(m.text());
	});
	await failed.route(/\/courier-hull[^/]*\.glb/, (route) => {
		attempts++;
		return route.abort();
	});
	await failed.goto(gameUrl(origin, params));
	await bootedGame(failed, 60000);
	await failed.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 120000 },
	);
	await failed.evaluate(() => window.__seelite.loadAuthoredHullsAfterBoot());
	check(
		"failure settles, keeps stand-in, warns once and never shows Retry",
		attempts === 1 &&
			warnings.length === 1 &&
			(await failed.evaluate(
				() =>
					!window.__seelite.shipMesh.userData.authored &&
					!document.querySelector("[data-model-retry]"),
			)),
	);
	await failed.close();

	const full = await browser.newPage();
	watch(full);
	let fullRelease, requested;
	const fullGate = new Promise((resolve) => {
		fullRelease = resolve;
	});
	const request = new Promise((resolve) => {
		requested = resolve;
	});
	await full.route(/\/courier-hull[^/]*\.glb/, async (route) => {
		requested();
		await fullGate;
		await route.continue();
	});
	await full.goto(gameUrl(origin, { ...params, "models-full": true }));
	await request;
	check(
		"models-full holds construction while a non-boot hull is held",
		await full.evaluate(
			() =>
				!window.__seelite &&
				!document.querySelector("body > canvas:not(#overlay)") &&
				!!document.querySelector("[data-model-load]"),
		),
	);
	fullRelease();
	await bootedGame(full, 120000);
	check(
		"models-full constructs Game with every catalog model installed",
		await full.evaluate(() => {
			const g = window.__seelite;
			return (
				g.modelsSettled() &&
				g.shipMesh.userData.authored &&
				g.shipyardModelsSettled &&
				g.refineryModelsSettled &&
				g.outpostModelsSettled &&
				g.interiorModelsSettled
			);
		}),
	);
	const launched = await full.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		if (!g.startDockedAtHome()) throw Error("launch capture could not dock");
		g.launch();
		g.clockHeld = false;
		for (let i = 0; i < 2000 && g.dockPhase === "docked"; i++) g.step(0.1);
		g.skipDockTraversal();
		g.step(0.1);
		g.render(0);
		return g.dockPhase === "flying" && !g.openingActive;
	});
	check("the launch capture is in flight with the opening finished", launched);
	await full.screenshot({
		path: "probe-shots/model-queue/launch-installed.png",
	});
	await full.close();
} finally {
	await browser.close();
}
exit();
