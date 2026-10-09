// In-game evidence for the authored courier exterior (node #812): boots a
// no-save game on a hardware renderer, frames the player's courier in chase
// view round the hull and in the light rig's `hull-chase` framing, checks the
// cockpit view draws no exterior, and fails on page errors.
// Usage: node spikes/courier-hull/capture-game.mjs [label]
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import { installViewFraming } from "../../scripts/lib/view-placement.mjs";
import { GAME_TIME_S, SEED } from "../../scripts/lib/view-set.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const label = process.argv[2] ?? "game";
const port = Number(process.env.PORT ?? 5194);
const out = `.dream-loop/courier-game/${label}`;
const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-courier-capture",
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
			"coriolis-start": "approach",
		}),
	);
	await bootedGame(page, 90000);
	await page.waitForTimeout(2000);
	const facts = await page.evaluate(async () => {
		const g = window.__seelite;
		g.clockHeld = true;
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const ship = g.shipMesh;
		const { meshStats } = await import("/scripts/lib/mesh-stats.mjs");
		const { isLevelStandIn } = await import("/src/ship-detail.ts");
		// The approved model and its glows; the reduced levels are counted by
		// `tests/courier-hull.test.ts`.
		const { meshes, triangles } = meshStats([ship], isLevelStandIn);
		return {
			view: g.view,
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			authored: ship.userData.authored === true,
			meshes,
			triangles,
			cockpitShipVisible: ship.visible,
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(facts.renderer))
		throw Error("hardware renderer required");
	if (!facts.authored) throw Error("the courier is not the authored model");
	if (facts.cockpitShipVisible)
		throw Error("the exterior is drawn in cockpit view");
	await page.screenshot({ path: `${out}/cockpit.png` });
	await page.keyboard.press("v");
	await page.waitForFunction(
		() =>
			window.__seelite.view === "chase" && window.__seelite.shipMesh.visible,
	);
	const shot = async (name, yaw, elevation) => {
		await page.evaluate(
			([y, e]) => {
				const g = window.__seelite;
				g.chaseYaw = y;
				g.chaseElevation = e;
			},
			[yaw, elevation],
		);
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${out}/${name}.png` });
	};
	await shot("chase-astern", 0, 0.18);
	await shot("chase-quarter", -0.8, 0.3);
	await shot("chase-beam", -1.57, 0.12);
	await shot("chase-bow", -2.6, 0.25);
	await shot("chase-high", -0.4, 1.0);
	await shot("chase-low", 0.6, -0.5);
	// The light rig's own framing (`scripts/lib/hull-chase.mjs`), on its own
	// page as `probe-light-rig.mjs` boots it: the view set's seed and clock,
	// the largest planet at six radii with the sun 150° round.
	const rig = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	rig.on("pageerror", (e) => errors.push(e.message));
	await installViewPlacement(rig);
	await installViewFraming(rig);
	await rig.goto(gameUrl(origin, { seed: SEED }));
	await bootedGame(rig, 90000);
	await rig.evaluate((clock) => window.__startClockAt(clock), GAME_TIME_S);
	await rig.evaluate(() => {
		const planets = window.__seelite.world.system.bodies.filter(
			(body) => body.kind === "planet",
		);
		planets.sort((a, b) => b.radiusKm - a.radiusKm || (a.id < b.id ? -1 : 1));
		window.__sunOffset(planets[0].id, 6, 150);
	});
	await rig.keyboard.press("v");
	await rig.waitForFunction(() => window.__seelite.view === "chase");
	await rig.waitForTimeout(500);
	await rig.screenshot({ path: `${out}/hull-chase-framing.png` });
	await writeFile(
		`${out}/report.json`,
		`${JSON.stringify({ ...facts, errors }, null, 2)}\n`,
	);
	if (errors.length) throw Error(errors.join("\n"));
	console.log(JSON.stringify(facts));
} finally {
	await browser.close();
	await server.close();
}
