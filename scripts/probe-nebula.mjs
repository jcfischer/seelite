/** Seeded arrival bake: actual texture determinism, quality and ownership. */
import assert from "node:assert/strict";
import { gameUrl } from "./lib/game-url.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? "http://localhost:5173",
);
const browser = await launchChromium();
const t = tally();
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watch(page);
	await page.goto(gameUrl(origin, { seed: 47, system: 187, raider: "off" }));
	await bootedGame(page, 120000);
	const result = await page.evaluate(async () => {
		const g = window.__seelite;
		g.settings.set("quality", "high");
		const read = () => {
			const t = g.nebulaTarget;
			const pixels = new Uint16Array(t.width * t.height * 4);
			g.renderer.readRenderTargetPixels(t, 0, 0, t.width, t.height, pixels);
			let hash = 2166136261;
			for (const v of pixels) hash = Math.imul(hash ^ v, 16777619);
			return hash >>> 0;
		};
		const source = g.environmentSource;
		const shared =
			g.backdropScene.background === source &&
			g.layerLights.every(
				({ scene }) => scene.environment === g.environmentMap,
			);
		const before = read();
		g.orientation.setFromAxisAngle(
			g.nearScene.position.clone().set(0, 1, 0),
			1,
		);
		const stamps = [];
		await new Promise((resolve) => {
			const frame = (t) => {
				stamps.push(t);
				if (stamps.length < 121) requestAnimationFrame(frame);
				else resolve();
			};
			requestAnimationFrame(frame);
		});
		const stable = g.environmentSource === source && read() === before;
		g.settings.set("quality", "low");
		const low =
			g.backdropScene.background === null &&
			g.layerLights.every(({ scene }) => scene.environment === null);
		g.settings.set("quality", "high");
		const restored = g.backdropScene.background === source;
		const counts = [],
			times = [],
			hashes = [];
		for (let i = 0; i < 3; i++) {
			const start = performance.now();
			g.buildEnvironment();
			hashes.push(read());
			times.push(performance.now() - start);
			counts.push(g.renderer.info.memory.textures);
		}
		const own = g.skyBake;
		g.bakeSky({ haze: null, gas: null });
		const custom = g.nebulaTarget === null;
		g.bakeSky(own);
		const replay = read() === before;
		// Use the actual jump/rebuild path, then revisit the original system.
		g.performJump(g.world.galaxy.systems[141]);
		const moved = read() !== before;
		g.performJump(g.world.galaxy.systems[187]);
		const revisit = read() === before;
		return {
			shared,
			stable,
			low,
			restored,
			custom,
			replay,
			moved,
			revisit,
			hashes,
			before,
			counts,
			times,
			fps: 120000 / (stamps[120] - stamps[0]),
		};
	});
	for (const key of [
		"shared",
		"stable",
		"low",
		"restored",
		"custom",
		"replay",
		"moved",
		"revisit",
	])
		assert.equal(result[key], true, key);
	assert.ok(
		result.hashes.every((hash) => hash === result.before),
		"deterministic rebake",
	);
	assert.equal(
		new Set(result.counts).size,
		1,
		"GPU textures do not accumulate",
	);
	assert.equal(t.failures, 0, "no shader or page errors");
	console.log("nebula", JSON.stringify(result));
} finally {
	await browser.close();
}
