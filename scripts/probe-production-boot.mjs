/** Boot the bundled app: dev modules cannot expose Rollup-created async cycles.
 * Build into a private directory and serve that exact output, never a stale
 * dist or somebody else's dev server. This probe is part of every PR's smoke. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview } from "vite";
import { bootedGame, launchChromium, tally } from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), "seelite-production-boot-"));
const { check, watch, exit } = tally();
let server;
let browser;
try {
	await build({
		root,
		logLevel: "error",
		build: { outDir, emptyOutDir: true },
	});
	server = await preview({
		root,
		logLevel: "error",
		build: { outDir },
		preview: { host: "127.0.0.1", port: 0, open: false },
	});
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await launchChromium();
	for (const { boot, full } of [
		{ boot: "overlay", full: false },
		{ boot: "direct", full: false },
		{ boot: "direct", full: true },
	]) {
		const label = `${boot}${full ? " full catalog" : ""}`;
		const page = await browser.newPage();
		watch(page, `production ${label}`);
		await page.goto(
			gameUrl(
				origin,
				{
					seed: 42,
					voices: "formant",
					"no-save": true,
					"models-full": full,
				},
				{ boot },
			),
		);
		await bootedGame(page, 60000);
		check(
			`production ${label} boots and clears model loading`,
			await page.evaluate(
				() =>
					window.__seelite.frames > 0 &&
					!document.body.innerText.includes("Loading game") &&
					!document.body.innerText.includes("Building the world"),
			),
		);
		await page.close();
	}
} finally {
	await browser?.close();
	if (server) {
		server.httpServer.closeAllConnections();
		await new Promise((resolve) => server.httpServer.close(resolve));
	}
	await rm(outDir, { recursive: true, force: true });
}
exit();
