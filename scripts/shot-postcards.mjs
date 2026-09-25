/**
 * The postcard sheet (#406): for each scene, the pilot's view in the game,
 * the card the Postcard screen exports from it, and the card a page opened on
 * its link rebuilds — side by side, so the principal can judge framing,
 * typography, place attribution and what the card leaves out.
 *
 * A probe cannot say yes to a look; this is the page a person says it on.
 * Headed and on the player's renderer: `launchChromium` refuses a software
 * rasteriser under `SEELITE_PROBE_RENDERER=hardware`, which this script sets
 * unless the caller chose otherwise.
 *
 *   npm run dev -- --port 5406          # in one shell
 *   PROBE_ORIGIN=http://localhost:5406 node scripts/shot-postcards.mjs
 *   open probe-shots/postcards/index.html
 *
 * Every game boots `?no-save`, so making the sheet writes no Commander.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl, postcardUrl } from "./lib/game-url.mjs";
import {
	installViewFraming,
	setView,
	settleFrames,
} from "./lib/view-placement.mjs";

process.env.SEELITE_PROBE_RENDERER ??= "hardware";
const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const OUT = "probe-shots/postcards";
const VIEWPORT = { width: 1440, height: 900 };

/**
 * The scenes. Each names a world, a placement, the view the pilot is in, and
 * the composition exported from it. Station framings stand on the aperture
 * axis, co-moving; the planet stands sunward and off to one side.
 */
const SCENES = [
	{
		name: "station-clear",
		what: "Off a trade station, the clear composition",
		seed: 47,
		place: (kind) => ({ station: kind ?? "trade", rangeKm: 2.5 }),
		view: "cockpit",
		mode: "clear",
	},
	{
		name: "station-cockpit",
		what: "The same moment, the cockpit composition",
		seed: 47,
		place: (kind) => ({ station: kind ?? "trade", rangeKm: 2.5 }),
		view: "cockpit",
		mode: "cockpit",
	},
	{
		name: "station-exterior",
		what: "The same moment, the exterior composition",
		seed: 47,
		place: (kind) => ({ station: kind ?? "trade", rangeKm: 2.5 }),
		view: "chase",
		mode: "exterior",
	},
	{
		name: "planet-clear",
		what: "A planet, lit from the side, the clear composition",
		seed: 47,
		place: () => ({ planet: true, radii: 2.6, sunAngleDeg: 70 }),
		view: "cockpit",
		mode: "clear",
	},
	{
		name: "refinery-exterior",
		what: "Another world: a refinery's pad, the exterior composition",
		seed: 2,
		place: () => ({ station: "refinery", rangeKm: 3.2 }),
		view: "chase",
		mode: "exterior",
	},
];

mkdirSync(OUT, { recursive: true });
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { watch } = tally();
const context = await browser.newContext({ viewport: VIEWPORT });

async function keepCard(page, selector, path) {
	const b64 = await page.evaluate(async (sel) => {
		const img = document.querySelector(sel);
		const blob = await (await fetch(img.src)).blob();
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let text = "";
		for (const byte of bytes) text += String.fromCharCode(byte);
		return btoa(text);
	}, selector);
	writeFileSync(path, Buffer.from(b64, "base64"));
}

const rows = [];
for (const scene of SCENES) {
	const page = await context.newPage();
	watch(page, scene.name);
	await installViewPlacement(page);
	await installViewFraming(page);
	const at = gameUrl(ORIGIN, {
		seed: scene.seed,
		raider: "off",
		"no-save": true,
	});
	await page.goto(at, { waitUntil: "load" });
	await bootedGame(page, 60000);
	await page.waitForFunction(() => window.__seelite.postcardPanel, null, {
		timeout: 30000,
	});
	const spec = scene.place();
	const placed = await page.evaluate(async (s) => {
		const g = window.__seelite;
		const bodies = g.world.system.bodies;
		if (s.station) {
			const station =
				bodies.find(
					(b) => b.kind === "station" && b.stationType === s.station,
				) ?? bodies.find((b) => b.kind === "station");
			return {
				subject: station.name,
				framing: await window.__viewAlongAxis(station.id, s.rangeKm),
			};
		}
		const planet = [...bodies]
			.filter((b) => b.kind === "planet")
			.sort((a, b) => b.radiusKm - a.radiusKm)[0];
		await window.__sunOffset(planet.id, s.radii, s.sunAngleDeg);
		return { subject: planet.name, framing: null };
	}, spec);
	await setView(page, scene.view);
	// Held before the shutter, so the pilot's frame and the card are one moment.
	await page.evaluate(() => {
		window.__seelite.clockHeld = true;
	});
	await settleFrames(page, 4);
	await page.screenshot({ path: `${OUT}/${scene.name}-game.png` });
	await page.keyboard.press("6");
	await page.waitForFunction(
		() => window.__seelite.postcardPanel.state.fragment !== null,
		null,
		{ timeout: 30000 },
	);
	const before = await page.evaluate(
		() => document.querySelector("#seelite-postcard img.card")?.src ?? "",
	);
	await page.evaluate(
		(m) => window.__seelite.postcardPanel.setMode(m),
		scene.mode,
	);
	await page.waitForFunction(
		(prev) => {
			const img = document.querySelector("#seelite-postcard img.card");
			return img && img.src !== prev && img.src.startsWith("blob:");
		},
		before,
		{ timeout: 30000 },
	);
	await keepCard(
		page,
		"#seelite-postcard img.card",
		`${OUT}/${scene.name}-card.png`,
	);
	const state = await page.evaluate(() =>
		structuredClone(window.__seelite.postcardPanel.state),
	);
	await page.close();

	const viewer = await context.newPage();
	watch(viewer, `${scene.name} viewer`);
	const link = postcardUrl(ORIGIN, state.fragment);
	await viewer.goto(link, { waitUntil: "load" });
	await viewer.waitForFunction(
		() => {
			const img = document.querySelector("#seelite-postcard-viewer img.card");
			return img?.src.startsWith("blob:") && img.complete;
		},
		null,
		{ timeout: 60000 },
	);
	await keepCard(
		viewer,
		"#seelite-postcard-viewer img.card",
		`${OUT}/${scene.name}-rebuilt.png`,
	);
	await viewer.screenshot({ path: `${OUT}/${scene.name}-viewer.png` });
	const rebuilt = await viewer.evaluate(
		() => window.__seelite.postcardView.rebuiltFragment,
	);
	await viewer.close();
	rows.push({ scene, placed, state, rebuilt });
	console.log(
		`${scene.name}: ${state.caption.place} — rebuilt ${rebuilt === state.fragment ? "identical" : "DIFFERENT"}`,
	);
}
await context.close();
await browser.close();

const escape = (s) =>
	String(s).replace(
		/[&<>"]/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
	);
writeFileSync(
	`${OUT}/index.html`,
	`<!doctype html><meta charset="utf-8"><title>Postcards — #406 sheet</title>
<style>
body { background: #0b0f14; color: #cfdce2; font: 13px/1.5 ui-monospace, Menlo, monospace; margin: 24px; }
h1 { font-size: 16px; } h2 { font-size: 14px; margin: 28px 0 6px; color: #ffd479; }
table { border-collapse: collapse; width: 100%; } td { vertical-align: top; padding: 4px; width: 33%; }
th { text-align: left; color: #8fa6b0; font-weight: normal; padding: 4px; }
img { width: 100%; display: block; border: 1px solid #243240; }
.link { word-break: break-all; color: #7f97b8; font-size: 11px; }
.flag { color: #ff8a7a; }
</style>
<h1>Postcards from The Far Between — #406</h1>
<p>Each row: the pilot's view in the game (HUD and all), the card the Postcard screen exported from that moment, and the card a page opened on its link rebuilt. Judge framing, typography, place attribution, and that nothing private is on the card. Click an image for full size.</p>
${rows
	.map(
		({ scene, placed, state, rebuilt }) => `<h2>${escape(scene.what)}</h2>
<p>${escape(scene.name)} · seed ${scene.seed} · subject ${escape(placed.subject)} · caption “${escape(state.caption.place)}” · ${escape(state.caption.inscription)}${rebuilt === state.fragment ? "" : ' · <span class="flag">rebuilt recipe differs</span>'}</p>
<table><tr><th>In game</th><th>Exported card</th><th>Rebuilt from the link</th></tr>
<tr><td><a href="${scene.name}-game.png"><img src="${scene.name}-game.png"></a></td>
<td><a href="${scene.name}-card.png"><img src="${scene.name}-card.png"></a></td>
<td><a href="${scene.name}-rebuilt.png"><img src="${scene.name}-rebuilt.png"></a><br><a href="${scene.name}-viewer.png">the viewer page</a></td></tr></table>
<p class="link">${escape(state.link)}</p>`,
	)
	.join("\n")}
`,
);
console.log(`sheet: ${OUT}/index.html`);
