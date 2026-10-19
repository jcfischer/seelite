// In-game evidence for the authored Discovery / Voyager A (node #820): boots a
// no-save game on the player's hardware renderer with every model installed,
// makes the voyager the flown hull (`?hull=` refuses it: no shipyard sells a
// capital, so this is `probe-fire-groups.mjs`'s `setFlownHull`), and frames the hull in chase view from five sides, plus the
// cockpit view and a close view of the drive block. Fails on page errors, a
// software renderer, or a voyager that is not the authored model. It does not
// dock (no berth admits a capital).
//
//   node spikes/discovery/capture-game.mjs [label]
//
// Frame cost is `scripts/measure-authored-hull-cost.mjs` with `HULL=voyager`
// and the install stall `scripts/measure-hull-install-stall.mjs`; this file is
// pictures and facts only.
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const label = process.argv[2] ?? "game";
const port = Number(process.env.PORT ?? 5197);
const out = `.dream-loop/discovery-game/${label}`;
const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-discovery-capture",
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
	await page.waitForFunction(() => window.__seelite.modelsSettled(), undefined, {
		timeout: 90000,
	});
	await page.evaluate(() => window.__seelite.setFlownHull("voyager"));
	await page.waitForFunction(() => window.__seelite.modelsSettled(), undefined, {
		timeout: 90000,
	});
	await page.waitForTimeout(1500);
	const facts = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			hull: g.flownHull,
			authored: g.shipMesh.userData.authored === true,
			frame: !!g.shipMesh.getObjectByName("voyager-hull-frame"),
			glows: g.shipMesh.children
				.flatMap((c) => c.children)
				.filter((o) => o.name.endsWith("-exhaust"))
				.map((o) => o.name)
				.sort(),
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(facts.renderer))
		throw Error("hardware renderer required");
	if (facts.hull !== "voyager" || !facts.authored || !facts.frame)
		throw Error(`not flying the authored voyager: ${JSON.stringify(facts)}`);
	await page.screenshot({ path: `${out}/cockpit.png` });
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite.view === "chase");
	const shot = async (name, yaw, elevation) => {
		await page.evaluate(
			([yaw, elevation]) => {
				const g = window.__seelite;
				g.chaseYaw = yaw;
				g.chaseElevation = elevation;
			},
			[yaw, elevation],
		);
		await page.waitForTimeout(600);
		await page.screenshot({ path: `${out}/${name}.png` });
	};
	await shot("chase-astern", 0, 0.25);
	await shot("chase-starboard", Math.PI / 2, 0.3);
	await shot("chase-port", -Math.PI / 2, 0.3);
	await shot("chase-bow", Math.PI * 0.85, 0.2);
	await shot("chase-below", 0.4, -0.6);
	const report = { ...facts, errors };
	await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
	if (errors.length) throw Error(errors.join("\n"));
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser.close();
	await server.close();
}
