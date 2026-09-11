/**
 * Measure a real player's cold boot from navigation to its first rendered frame.
 *
 *   npm run dev                       # in one shell
 *   node scripts/measure-boot-time.mjs
 *
 * This is deliberately a headed instrument. Normal browser probes in this repo
 * use SwiftShader, which can establish that a Game booted but cannot price the
 * player's boot. `assertPlayersRenderer` refuses software rendering rather than
 * producing a plausible-looking number with the wrong meaning.
 *
 * Each of the ten samples gets a new browser context. That makes every boot a
 * clean navigation: no module cache, settings residue, or page state from the
 * preceding sample can shorten it. The contexts run sequentially, spreading
 * thermal or background drift across the sample instead of warming one reused
 * page and calling its later reloads cold boots.
 */
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { VIEWPORT } from "./lib/view-set.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const SAMPLES = 10;
const SEED = 47;
const QUALITY = "high";
const MEDIAN_BUDGET_MS = 5_000;
const P95_BUDGET_MS = 8_000;

const nearestRank = (values, q) => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.ceil(q * sorted.length) - 1];
};

// Navigate to the origin the guard actually checked. A raw ORIGIN here would
// make this script's timing a claim about a server the guard did not examine.
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium({ headless: false });
const boots = [];
let renderer = null;

for (let i = 0; i < SAMPLES; i++) {
	const context = await browser.newContext({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	// Set high quality before the app module reads settings. Doing it after the
	// first frame would measure the default boot, then only prove a later switch.
	await context.addInitScript(() => {
		localStorage.setItem(
			"seelite:settings:v1",
			JSON.stringify({ renderScale: 1, quality: "high" }),
		);
	});
	const page = await context.newPage();
	const started = performance.now();
	await page.goto(`${origin}/?seed=${SEED}`, { waitUntil: "commit" });
	await bootedGame(page);
	const elapsed = performance.now() - started;
	renderer ??= await assertPlayersRenderer(page, "measure boot time");
	boots.push(elapsed);
	console.log(
		`  boot ${String(i + 1).padStart(2, "0")}: ${elapsed.toFixed(0)} ms`,
	);
	await context.close();
}

await browser.close();

const median = nearestRank(boots, 0.5);
const p95 = nearestRank(boots, 0.95);
const medianPasses = median <= MEDIAN_BUDGET_MS;
const p95Passes = p95 <= P95_BUDGET_MS;

console.log(`  renderer: ${renderer}`);
console.log(
	`  fixture: ${SAMPLES} clean-context headed boots of /?seed=${SEED} at ${QUALITY} quality`,
);
console.log(
	`  median: ${median.toFixed(0)} ms (${medianPasses ? "within" : "over"} ${MEDIAN_BUDGET_MS} ms budget)`,
);
console.log(
	`  p95:    ${p95.toFixed(0)} ms (${p95Passes ? "within" : "over"} ${P95_BUDGET_MS} ms budget)`,
);

if (!medianPasses || !p95Passes) process.exitCode = 1;
