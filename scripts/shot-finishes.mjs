/**
 * The finish sheet (#202, #203): every subject under every finish, from the
 * workbench, captured **headed** on the player's renderer.
 *
 * A finish is chosen by looking, and `capture-views.mjs` records why that
 * cannot be done on SwiftShader: a software rasteriser draws a different
 * picture, not merely a slower one. So this launches headed, reads the real
 * renderer back off the workbench, and refuses to write a frame it cannot
 * show is hardware — the same refusal `lib/players-renderer.mjs` makes for
 * the canonical view set, made here against the workbench's own renderer
 * because the workbench never constructs `Game` and never sets
 * `window.__seelite`.
 *
 * Every capture asks the page for `?finish=<id>` and then **reads the finish
 * back** off the workbench state before shooting: a capture under the wrong
 * finish with the right filename is the failure a sheet cannot show.
 *
 * Output: `view-set/finishes/<label>/<family>-<subject>-<variant>-<finish>-<view>.png`
 * and an `index.html` beside them laying the sheet out as subjects down
 * and finishes across, one table per view. `view-set/` is gitignored.
 *
 *   npm run dev                                    # in one shell
 *   node scripts/shot-finishes.mjs --label round1  # in another
 *
 * `FAMILY=ship|station`, `SUBJECTS=courier,carrier`, `VARIANT=a`,
 * `FINISHES=stock,industrial` and `VIEWS=hero,aft` narrow a run.
 *
 * **`SEEDS=0,1,2` adds an axis** (#257): every station subject is captured
 * once per assembly seed, as `?assembly=<n>` on the workbench, and the sheet
 * gets a row per seed. A form solved by wave function collapse is its seed's
 * plan, so one capture of it is one plan of many and cannot show the variety
 * the form is for; a hand-authored form ignores the seed and its rows repeat,
 * which is what a reader should see. The workbench's berth seed stays zero
 * throughout. Default `0`, so a run that does not ask is what it was.
 *
 * **`VARIANTS=a,b,c,d,e` is a third** (#518): a ranking round puts a new form
 * beside the ones it competes with, and one variant per run gave one sheet per
 * form — the comparison made across browser tabs. Each subject gets a row per
 * variant it carries; a variant a subject does not carry is skipped, as a
 * single `VARIANT` always was. `VARIANT=x` is still read, as a one-entry list.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { fillStage } from "./lib/workbench.mjs";
import { guardedOrigin, launchChromium } from "./probe-guard.mjs";
import { workbenchUrl } from "./lib/game-url.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const labelFlag = process.argv.indexOf("--label");
const label =
	labelFlag >= 0 && process.argv[labelFlag + 1]
		? process.argv[labelFlag + 1]
		: new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join("view-set", "finishes", label);

const FAMILIES = (process.env.FAMILY ?? "ship,station").split(",");
// `SUBJECTS` names one family's subjects, so it applies only when `FAMILY`
// names one family: `SUBJECTS=courier` over both families made the station
// pass click an asset that does not exist and abort before the sheet.
const only = FAMILIES.length === 1 ? process.env.SUBJECTS : undefined;
const SUBJECTS = {
	ship: (only ?? "courier,interceptor,freighter,miner,carrier")
		.split(",")
		.filter(Boolean),
	station: (only ?? "trade,shipyard,refinery,outpost")
		.split(",")
		.filter(Boolean),
	// #333: one subject, one concept, one "as-built" finish.
	rama: (only ?? "rama").split(",").filter(Boolean),
};
const VARIANTS = (process.env.VARIANTS ?? process.env.VARIANT ?? "a")
	.split(",")
	.filter(Boolean);
const FINISHES = (
	process.env.FINISHES ?? "stock,plated,industrial,worn,nostromo"
).split(",");
/**
 * Camera framings, in the workbench's orbit terms. The workbench's up is Y
 * and its camera sits at `(sin az, ·, cos az)`, so azimuth 0 is **on +Z
 * looking down −Z** — at a station's aperture, which faces +Z, and at a
 * hull's drives, since a hull flies towards −Z, which is why `aft` sits near
 * it. `front` was first authored at π, which is the docking face's back —
 * and a hull's nose, which is what `bow` is for.
 */
const VIEWS = {
	hero: { azimuth: 2.35, elevation: 0.3 },
	aft: { azimuth: 0.4, elevation: 0.2 },
	front: { azimuth: 0, elevation: 0.12 },
	bow: { azimuth: Math.PI, elevation: 0.12 },
	side: { azimuth: Math.PI / 2, elevation: 0.12 },
	sideclose: { azimuth: Math.PI / 2 + 0.3, elevation: 0.18, zoom: 0.5 },
	close: { azimuth: 2.0, elevation: 0.25, zoom: 0.55 },
};
const VIEW_NAMES = (process.env.VIEWS ?? "hero,aft,close").split(",");
const SEEDS = (process.env.SEEDS ?? "0").split(",").map((value) => {
	const n = Number.parseInt(value, 10);
	if (!Number.isInteger(n) || n < 0)
		throw new Error(`SEEDS: ${value} is not a seed`);
	return n;
});

await guardedOrigin(ORIGIN);
await mkdir(OUT, { recursive: true });
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

let renderer = null;
const captured = [];
try {
	for (const family of FAMILIES) {
		// A hull ignores the assembly seed, so the ship family is captured once.
		const seeds = family === "station" ? SEEDS : [0];
		for (const finish of FINISHES)
			for (const seed of seeds) {
				await page.goto(
					workbenchUrl(ORIGIN, {
						"model-viewer": family,
						finish,
						assembly: seed,
					}),
					{ waitUntil: "load" },
				);
				await page.waitForSelector("#model-viewer canvas");
				// The refusal, on every page load: the renderer does not change
				// between finishes, and a check that only ran on the first load would
				// be a check on the first load.
				renderer = await assertPlayersRenderer(
					page,
					"capture a finish sheet — a finish is judged by eye and a software rasteriser is the wrong picture",
					{ global: "__seeliteModelViewer" },
				);
				const got = await page.evaluate(() => {
					const state = window.__seeliteModelViewer.state;
					return { finish: state.finish, assembly: state.assembly };
				});
				if (got.finish !== finish)
					throw new Error(
						`asked for finish ${finish}, the workbench has ${got.finish}`,
					);
				// Read back for the finish's reason: a capture at the wrong seed under
				// the right filename is a sheet that lies about variety.
				if (got.assembly !== seed)
					throw new Error(
						`asked for assembly seed ${seed}, the workbench has ${got.assembly}`,
					);
				await fillStage(page);
				for (const subject of SUBJECTS[family])
					for (const variant of VARIANTS) {
						await page.click(`[data-model-asset="${subject}"]`);
						const variantButton = `[data-model-variant="${variant}"][data-model-role="${subject}"]`;
						if ((await page.locator(variantButton).count()) === 0) continue;
						await page.click(variantButton);
						for (const view of VIEW_NAMES) {
							const framing = VIEWS[view];
							if (!framing) throw new Error(`no view named ${view}`);
							await page.evaluate((v) => {
								const s = window.__seeliteModelViewer.state;
								s.azimuth = v.azimuth;
								s.elevation = v.elevation;
								if (v.zoom) s.distance *= v.zoom;
							}, framing);
							// Two frames: one to apply the orbit, one to draw it.
							await page.waitForTimeout(250);
							const file = `${family}-${subject}-${variant}-${finish}-s${seed}-${view}.png`;
							await page
								.locator("#model-viewer canvas")
								.screenshot({ path: join(OUT, file) });
							captured.push({
								family,
								subject,
								variant,
								finish,
								seed,
								view,
								file,
							});
							// Undo the zoom so the next view starts from the workbench's
							// own framing rather than compounding it.
							if (framing.zoom)
								await page.evaluate((z) => {
									window.__seeliteModelViewer.state.distance /= z;
								}, framing.zoom);
						}
					}
			}
	}
} finally {
	await browser.close();
}

const html = [
	"<!doctype html><meta charset=utf-8><title>finish sheet</title>",
	"<style>body{background:#06090c;color:#c9dbe4;font:13px/1.4 ui-monospace,Menlo,monospace;margin:16px}",
	"table{border-collapse:collapse;margin-bottom:28px}th,td{padding:4px;text-align:left;vertical-align:top}",
	"img{width:300px;height:300px;display:block;background:#000}h2{font-weight:normal;letter-spacing:.06em}</style>",
	`<h1>finish sheet · ${label}</h1><p>renderer: ${renderer}</p>`,
];
for (const family of FAMILIES)
	for (const view of VIEW_NAMES) {
		html.push(`<h2>${family} · ${view}</h2><table><tr><th></th>`);
		for (const finish of FINISHES) html.push(`<th>${finish}</th>`);
		html.push("</tr>");
		const seeds = family === "station" ? SEEDS : [0];
		for (const subject of SUBJECTS[family])
			for (const variant of VARIANTS)
				for (const seed of seeds) {
					// A variant the subject does not carry has no captures: no row.
					if (
						!captured.some(
							(c) =>
								c.family === family &&
								c.subject === subject &&
								c.variant === variant,
						)
					)
						continue;
					html.push(
						`<tr><th>${subject} ${variant}${seeds.length > 1 ? ` · seed ${seed}` : ""}</th>`,
					);
					for (const finish of FINISHES) {
						const shot = captured.find(
							(c) =>
								c.family === family &&
								c.subject === subject &&
								c.variant === variant &&
								c.finish === finish &&
								c.seed === seed &&
								c.view === view,
						);
						html.push(
							shot
								? `<td><img src="${shot.file}" alt="${shot.file}"></td>`
								: "<td>—</td>",
						);
					}
					html.push("</tr>");
				}
		html.push("</table>");
	}
await writeFile(join(OUT, "index.html"), html.join("\n"));
console.log(
	`${captured.length} frames → ${OUT}\n  renderer: ${renderer}\n  sheet: ${join(OUT, "index.html")}`,
);
