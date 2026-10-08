// In-game evidence for the authored cockpit (#792): boots a no-save game on a
// hardware renderer, frames the cockpit on approach, with each head look and
// docked, and fails on page errors. Usage: node spikes/courier-cockpit/capture-game.mjs [label]
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const label = process.argv[2] ?? "game";
const port = Number(process.env.PORT ?? 5193);
const out = `.dream-loop/cockpit-game/${label}`;
const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-cockpit-capture",
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
	await page.waitForTimeout(3000);
	const facts = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const cabin = g.cabinScene.getObjectByName("authored-cockpit");
		return {
			view: g.view,
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			cabin: !!cabin,
			faces: ["scanner", "flight-instrument", "target-instrument"].filter((n) =>
				g.cabinScene.getObjectByName(n),
			),
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(facts.renderer))
		throw Error("hardware renderer required");
	if (!facts.cabin || facts.faces.length !== 3)
		throw Error(`cabin incomplete: ${JSON.stringify(facts)}`);
	const shot = async (name, setup) => {
		await page.evaluate(setup);
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${out}/${name}.png` });
	};
	await shot("approach", () => window.__seelite.setHeadLook("forward"));
	await shot("look-left", () => window.__seelite.setHeadLook("left"));
	await shot("look-right", () => window.__seelite.setHeadLook("right"));
	await shot("forward", () => window.__seelite.setHeadLook("forward"));
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
