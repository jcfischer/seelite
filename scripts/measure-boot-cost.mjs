/**
 * The player's frame at boot — node #202's owed figure, before and after.
 *
 *   npm run dev                                  # in one shell
 *   node scripts/measure-boot-cost.mjs           # in another; PROBE_ORIGIN
 *                                                # picks the tree
 *
 * `measure-fixture-cost.mjs` reads what a finish adds on the workbench, where
 * it is the only term. This reads the **game's** frame where the player
 * starts — the same framing on any tree, so a run against `main` and a run
 * against a branch are the before and after #202's closing rule asks for —
 * off the `?fps` meter, headed at 1440×900 on the player's renderer with
 * vsync and the frame-rate limit lifted (`lib/planet-cost.mjs`'s reason).
 * One framing, one number, a median of a run of samples; it is a receipt's
 * figure, not a gate, and asserts nothing.
 */
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const VIEWPORT = { width: 1440, height: 900 };
const SAMPLES = Number(process.env.SAMPLES ?? 10);

await guardedOrigin(ORIGIN);
const browser = await launchChromium({
	headless: false,
	args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const page = await browser.newPage({ viewport: VIEWPORT });
let renderer = null;
const fps = [];
try {
	await page.goto(`${ORIGIN}/?fps`, { waitUntil: "load" });
	await bootedGame(page);
	renderer = await assertPlayersRenderer(page, "measure the boot frame");
	// Let the boot settle: shaders compile and maps upload on the first frames.
	await page.waitForTimeout(4000);
	for (let i = 0; i < SAMPLES; i++) {
		await page.waitForTimeout(500);
		const text = await page.evaluate(
			() => document.querySelector("[data-fps-meter]")?.textContent ?? "",
		);
		const match = text.match(/([\d.]+)\s*fps/);
		if (match) fps.push(Number(match[1]));
	}
} finally {
	await browser.close();
}
fps.sort((a, b) => a - b);
const median = fps[Math.floor(fps.length / 2)];
console.log(
	`boot frame — ${ORIGIN}, ${VIEWPORT.width}×${VIEWPORT.height}, vsync off`,
);
console.log(`renderer: ${renderer}`);
console.log(
	`median ${median.toFixed(1)} fps · ${(1000 / median).toFixed(2)} ms/frame (min ${fps[0].toFixed(1)}, max ${fps[fps.length - 1].toFixed(1)}, ${fps.length} samples)`,
);
