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
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SOFTWARE } from "./lib/players-renderer.mjs";
import { guardedOrigin, launchChromium } from "./probe-guard.mjs";

const ORIGIN = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const label =
	process.argv[process.argv.indexOf("--label") + 1] ??
	new Date().toISOString().replace(/[:.]/g, "-");
const OUT = join("view-set", "finishes", label);

const FAMILIES = (process.env.FAMILY ?? "ship,station").split(",");
const SUBJECTS = {
	ship: (process.env.SUBJECTS ?? "courier,interceptor,freighter,miner,carrier")
		.split(",")
		.filter(Boolean),
	station: (process.env.SUBJECTS ?? "trade,shipyard,refinery,outpost")
		.split(",")
		.filter(Boolean),
};
const VARIANT = process.env.VARIANT ?? "a";
const FINISHES = (process.env.FINISHES ?? "stock,plated,industrial,worn").split(
	",",
);
/**
 * Camera framings, in the workbench's orbit terms. The workbench's up is Y
 * and a station's aperture axis is Z, so `front` looks down −Z at the
 * docking face and `aft` up +Z at a hull's drives.
 */
const VIEWS = {
	hero: { azimuth: 2.35, elevation: 0.3 },
	aft: { azimuth: 0.4, elevation: 0.2 },
	front: { azimuth: Math.PI, elevation: 0.12 },
	close: { azimuth: 2.0, elevation: 0.25, zoom: 0.55 },
};
const VIEW_NAMES = (process.env.VIEWS ?? "hero,aft,close").split(",");

await guardedOrigin(ORIGIN, ["src/ship-surface.ts", "src/station-mesh.ts"]);
await mkdir(OUT, { recursive: true });
const browser = await launchChromium({ headless: false });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

let renderer = null;
const captured = [];
try {
	for (const family of FAMILIES) {
		for (const finish of FINISHES) {
			await page.goto(`${ORIGIN}/?model-viewer=${family}&finish=${finish}`, {
				waitUntil: "load",
			});
			await page.waitForSelector("#model-viewer canvas");
			// The refusal, once per family: the renderer does not change between
			// finishes, and a check that only ran on the first page load would be
			// a check on the first page load.
			const gpu = await page.evaluate(() => {
				const gl = window.__seeliteModelViewer.renderer.getContext();
				const ext = gl.getExtension("WEBGL_debug_renderer_info");
				return {
					unmasked: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
					generic: gl.getParameter(gl.RENDERER),
				};
			});
			const name = gpu.unmasked ?? gpu.generic;
			if (!gpu.unmasked || SOFTWARE.test(name))
				throw new Error(
					`refusing to capture a finish sheet on ${name}: a finish is judged by eye and a software rasteriser is the wrong picture. Run this on a machine with a display.`,
				);
			renderer = name;
			const got = await page.evaluate(
				() => window.__seeliteModelViewer.state.finish,
			);
			if (got !== finish)
				throw new Error(`asked for finish ${finish}, the workbench has ${got}`);
			await page.evaluate(() => {
				document.querySelector(".mv-panel")?.setAttribute("hidden", "");
				const wrap = document.querySelector(".mv-wrap");
				if (wrap instanceof HTMLElement) wrap.style.gridTemplateColumns = "1fr";
				const stage = document.querySelector(".mv-stage");
				if (stage instanceof HTMLElement) {
					stage.style.minHeight = "0";
					stage.style.height = `${stage.clientWidth}px`;
				}
				document.querySelector("[data-fps-meter]")?.remove();
				window.dispatchEvent(new Event("resize"));
			});
			for (const subject of SUBJECTS[family]) {
				await page.click(`[data-model-asset="${subject}"]`);
				const variantButton = `[data-model-variant="${VARIANT}"][data-model-role="${subject}"]`;
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
					const file = `${family}-${subject}-${VARIANT}-${finish}-${view}.png`;
					await page
						.locator("#model-viewer canvas")
						.screenshot({ path: join(OUT, file) });
					captured.push({ family, subject, finish, view, file });
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
		for (const subject of SUBJECTS[family]) {
			html.push(`<tr><th>${subject} ${VARIANT}</th>`);
			for (const finish of FINISHES) {
				const shot = captured.find(
					(c) =>
						c.family === family &&
						c.subject === subject &&
						c.finish === finish &&
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
