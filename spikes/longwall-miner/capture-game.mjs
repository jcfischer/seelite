// In-game evidence for Longwall B as the game's miner (node #815): boots a
// no-save game flying the miner on a hardware renderer, frames the hull in
// chase view from four sides, records what one miner costs to draw, and fails
// on page errors or a missing model. It does not dock.
// Usage: node spikes/longwall-miner/capture-game.mjs [label]
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const label = process.argv[2] ?? "game";
const port = Number(process.env.PORT ?? 5215);
const out = `.dream-loop/longwall-game/${label}`;
const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-longwall-capture",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
await mkdir(out, { recursive: true });
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(
		gameUrl(origin, {
			seed: 42,
			system: 0,
			"no-save": true,
			hull: "miner",
			"coriolis-start": "approach",
		}),
	);
	await bootedGame(page, 90000);
	await page.waitForTimeout(3000);
	const facts = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.view = "chase";
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const ship = g.nearScene.getObjectByName("ship");
		let meshes = 0;
		let triangles = 0;
		ship.traverse((o) => {
			if (!o.isMesh) return;
			meshes += 1;
			const geometry = o.geometry;
			triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
		});
		return {
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			hull: ship.userData.hullId,
			variant: ship.userData.variant,
			authored: !!ship.getObjectByName("longwall-exterior"),
			mechanisms: ["feed", "rotor", "anchor-0-foot", "anchor-3-foot"].filter(
				(n) => ship.getObjectByName(n),
			),
			meshes,
			triangles,
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(facts.renderer))
		throw Error("hardware renderer required");
	if (facts.hull !== "miner" || !facts.authored || facts.mechanisms.length !== 4)
		throw Error(`Longwall B not flown: ${JSON.stringify(facts)}`);
	const shot = async (name, yawRad, elevationRad) => {
		await page.evaluate(
			([yaw, elevation]) => {
				const g = window.__seelite;
				g.chaseYaw = yaw;
				g.chaseElevation = elevation;
			},
			[yawRad, elevationRad],
		);
		await page.waitForTimeout(600);
		await page.screenshot({ path: `${out}/${name}.png` });
	};
	await shot("astern", 0, 0.25);
	await shot("quarter", 0.8, 0.35);
	await shot("beam", Math.PI / 2, 0.15);
	await shot("bow", Math.PI - 0.6, 0.3);
	// What drawing one miner costs: the frame's calls with the hull hidden
	// against with it shown, read off the renderer after a rendered frame.
	const calls = await page.evaluate(async () => {
		const g = window.__seelite;
		const ship = g.nearScene.getObjectByName("ship");
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
		// Summed over every pass of one frame: `info` resets per render by default.
		const info = g.renderer.info;
		// The children, not the root: the frame loop rewrites the root's flag.
		const read = async (visible) => {
			for (const child of ship.children) child.visible = visible;
			await frame();
			info.autoReset = false;
			info.reset();
			await frame();
			info.autoReset = true;
			const { calls, triangles } = info.render;
			return { calls, triangles };
		};
		const shown = await read(true);
		const hidden = await read(false);
		for (const child of ship.children) child.visible = true;
		return {
			shown,
			hidden,
			miner: {
				calls: shown.calls - hidden.calls,
				triangles: shown.triangles - hidden.triangles,
			},
		};
	});
	const report = { ...facts, calls, errors };
	await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
	if (errors.length) throw Error(errors.join("\n"));
	console.log(JSON.stringify(report));
} finally {
	await browser.close();
	await server.close();
}
