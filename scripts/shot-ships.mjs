/** Dev-only: capture every ship candidate from a fixed 3/4 view for design review. */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { fillStage } from "./lib/workbench.mjs";
import { workbenchUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const OUT = process.argv[2] ?? "/tmp/ships";
const VARIANTS = ["a", "b", "c"];
const DISTANCE = {
	courier: 0.125,
	interceptor: 0.14,
	freighter: 0.155,
	miner: 0.165,
	patrol: 0.13,
	explorer: 0.175,
	raider: 0.15,
	carrier: 0.72,
	tug: 0.115,
	prospector: 0.125,
	dreadnought: 0.8,
	voyager: 0.42,
};
const VIEWS = [
	{ name: "hero", azimuth: 2.35, elevation: 0.3 },
	{ name: "top", azimuth: 3.14159, elevation: 1.35 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto(workbenchUrl(ORIGIN, { "model-viewer": "ship" }), {
	waitUntil: "load",
});
await page.waitForSelector("#model-viewer canvas");
const ROLES = await page.evaluate(() =>
	[...document.querySelectorAll("[data-model-asset]")].map(
		(button) => button.dataset.modelAsset,
	),
);
const missing = ROLES.filter((role) => DISTANCE[role] === undefined);
if (missing.length)
	throw new Error(`no framing distance for: ${missing.join(", ")}`);
await fillStage(page);

for (const role of ROLES) {
	for (const variant of VARIANTS) {
		await page.click(`[data-model-asset="${role}"]`);
		await page.click(
			`[data-model-variant="${variant}"][data-model-role="${role}"]`,
		);
		for (const view of VIEWS) {
			await page.evaluate(
				(v) => {
					const s = window.__seeliteModelViewer.state;
					s.azimuth = v.azimuth;
					s.elevation = v.elevation;
					s.distance = v.distance;
				},
				{
					...view,
					// Per-role framing by default, so each hull fills the frame.
					// `SHOT_DISTANCE` overrides it with one shared orbit radius,
					// which is the only way the shots show relative size — the
					// default deliberately hides it.
					distance: process.env.SHOT_DISTANCE
						? Number(process.env.SHOT_DISTANCE)
						: DISTANCE[role],
				},
			);
			await page.waitForTimeout(220);
			await page
				.locator("#model-viewer canvas")
				.screenshot({ path: `${OUT}/${role}-${variant}-${view.name}.png` });
		}
	}
}
await browser.close();
console.log(
	`wrote ${ROLES.length * VARIANTS.length * VIEWS.length} shots to ${OUT}`,
);
