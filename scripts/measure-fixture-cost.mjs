/**
 * What a station finish costs to draw — node #202's fixtures at ship scale.
 *
 *   npm run dev                                      # in one shell
 *   node scripts/measure-fixture-cost.mjs            # in another
 *
 * The principal's ruling put a station's details at ship scale, which meant
 * more members: the Coriolis's two 47 m trusses became four 12 m ladders with
 * rungs, its four radiator panels seventy-two, its three tanks eighteen. The
 * pools make each member one instance, so the draw-call count does not move;
 * what can move is fill and vertex work, and "instancing makes it cheap" is a
 * belief until it is a figure. This prints the figure.
 *
 * **The workbench, on purpose.** An in-game frame at a station is dominated
 * by whatever planet is in the frustum (#242: 86.6% of `berth-free-look`),
 * so a before/after read there measures the camera's luck. The workbench
 * draws one station, the grid and nothing else, so the difference between
 * two finishes on it is the finish's cost and only that. It is not the
 * player's frame; it is the term the player's frame gains.
 *
 * Headed at the player's viewport, on the player's renderer, refusing a
 * software rasteriser (`capture-views.mjs`'s reason), with vsync and the
 * frame-rate limit lifted (`lib/planet-cost.mjs`'s reason: under vsync a
 * frame costs whole refresh intervals and the meter reads the display). It
 * reads the workbench's own fps meter, which counts delivered frames, and
 * reports the median of a run of samples per cell. A same-build control —
 * `stock` against itself, on the same page — is printed first so the noise
 * floor sits beside the deltas.
 */
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { fillStage } from "./lib/workbench.mjs";
import { guardedOrigin, launchChromium } from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const VIEWPORT = { width: 1440, height: 900 };
const SUBJECTS = [
	{ asset: "trade", variant: "a" },
	{ asset: "shipyard", variant: "a" },
	{ asset: "trade", variant: "d" },
];
// Stock is always the baseline the table's delta column names, whatever the
// run is asked to measure beside it: a baseline that followed the first
// configured finish published "Δ vs stock" figures taken against worn.
const FINISHES = [
	"stock",
	...(process.env.FINISHES ?? "worn,nostromo")
		.split(",")
		.filter((f) => f && f !== "stock"),
];
const SAMPLES = Number(process.env.SAMPLES ?? 8);

await guardedOrigin(ORIGIN, ["src/ship-surface.ts", "src/station-mesh.ts"]);
const browser = await launchChromium({
	headless: false,
	args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
});
const page = await browser.newPage({ viewport: VIEWPORT });

/** Median fps off the workbench's meter over `SAMPLES` half-second reads. */
async function sampleFps() {
	await page.waitForTimeout(1500);
	const fps = [];
	for (let i = 0; i < SAMPLES; i++) {
		await page.waitForTimeout(500);
		const text = await page.evaluate(
			() => document.querySelector("[data-fps-meter]")?.textContent ?? "",
		);
		const match = text.match(/([\d.]+)\s*fps/);
		if (match) fps.push(Number(match[1]));
	}
	fps.sort((a, b) => a - b);
	return fps[Math.floor(fps.length / 2)];
}

const rows = [];
let renderer = null;
try {
	for (const { asset, variant } of SUBJECTS) {
		// The same-build control is its own cell, named as one: stock read a
		// second time on a fresh page, so the noise floor sits beside the
		// deltas as a row and not as a double entry.
		const cells = [
			{ finish: "stock", label: "control (stock again)" },
			...FINISHES.map((finish) => ({ finish, label: finish })),
		];
		for (const { finish, label } of cells) {
			await page.goto(`${ORIGIN}/?model-viewer=station&finish=${finish}`, {
				waitUntil: "load",
			});
			await page.waitForSelector("#model-viewer canvas");
			renderer = await assertPlayersRenderer(
				page,
				"measure a finish's frame cost — a software rasteriser's frame is not the player's",
				{ global: "__seeliteModelViewer" },
			);
			await page.click(`[data-model-asset="${asset}"]`);
			await page.click(
				`[data-model-variant="${variant}"][data-model-role="${asset}"]`,
			);
			await fillStage(page, { height: "viewport", keepMeter: true });
			await page.evaluate(() => {
				const s = window.__seeliteModelViewer.state;
				s.azimuth = 2.35;
				s.elevation = 0.3;
			});
			const fps = await sampleFps();
			rows.push({ asset, variant, finish, label, fps, ms: 1000 / fps });
		}
	}
} finally {
	await browser.close();
}

console.log(
	`fixture cost — workbench, ${VIEWPORT.width}×${VIEWPORT.height}, vsync off`,
);
console.log(`renderer: ${renderer}`);
console.log("subject      finish     fps       ms/frame   Δ vs stock");
for (const { asset, variant } of SUBJECTS) {
	const cells = rows.filter((r) => r.asset === asset && r.variant === variant);
	const stock = cells.find((r) => r.label === "stock");
	for (const r of cells) {
		const delta =
			r.label === "stock" ? "" : `${(r.ms - stock.ms).toFixed(2)} ms`;
		console.log(
			`${`${asset} ${variant}`.padEnd(12)} ${r.label.padEnd(22)} ${r.fps.toFixed(1).padStart(7)} ${r.ms.toFixed(2).padStart(9)}   ${delta}`,
		);
	}
}
