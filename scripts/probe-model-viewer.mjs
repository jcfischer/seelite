/** Prove the query-gated procedural-model workbench stays outside Game. */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";
import { workbenchUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const VIEWPORTS = [
	{ name: "desktop", width: 1280, height: 760 },
	{ name: "narrow", width: 390, height: 844 },
];

function state() {
	const root = document.querySelector("#model-viewer");
	const canvas = root?.querySelector("canvas");
	const buttons = [...document.querySelectorAll("[data-model-asset]")];
	const variants = [...document.querySelectorAll("[data-model-variant]")];
	return {
		root: Boolean(root),
		canvas: canvas instanceof HTMLCanvasElement && canvas.width > 0,
		assets: buttons.map((button) => button.getAttribute("data-model-asset")),
		selected: buttons
			.find((button) => button.getAttribute("aria-pressed") === "true")
			?.getAttribute("data-model-asset"),
		variants: variants.map(
			(button) =>
				`${button.getAttribute("data-model-role")}:${button.getAttribute("data-model-variant")}`,
		),
		selectedVariant: variants
			.find((button) => button.getAttribute("aria-pressed") === "true")
			?.getAttribute("data-model-variant"),
		ranking: document
			.querySelector("[data-model-ranking]")
			?.textContent?.trim(),
		gameConstructed: Boolean(window.__seelite),
		viewer: window.__seeliteModelViewer?.state,
	};
}

await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	watch(page, viewport.name);
	await page.goto(workbenchUrl(ORIGIN, { "model-viewer": "ship" }), {
		waitUntil: "load",
	});
	await page.waitForSelector("#model-viewer canvas");
	const initial = await page.evaluate(state);
	check(
		`${viewport.name}: model viewer presents every ranked candidate without Game`,
		initial.root &&
			initial.canvas &&
			initial.assets.join(",") ===
				"courier,interceptor,freighter,miner,patrol,explorer,raider,carrier,tug,prospector,dreadnought" &&
			initial.variants.length === 33 &&
			initial.selected === "courier" &&
			initial.selectedVariant === "a" &&
			!initial.gameConstructed,
	);
	await page.locator('[data-model-asset="freighter"]').click();
	await page
		.locator('[data-model-role="freighter"][data-model-variant="b"]')
		.click();
	for (const rankChoice of ["b", "a", "c"]) {
		await page
			.locator(`[data-model-role="freighter"][data-model-rank="${rankChoice}"]`)
			.click();
	}
	await page.locator('[data-model-control="beam"]').fill("130");
	await page.locator('[data-model-control="engine"]').fill("35");
	await page.locator('[data-model-control="wireframe"]').check();
	const adjusted = await page.evaluate(state);
	check(
		`${viewport.name}: asset and draft controls update the isolated visual state`,
		adjusted.selected === "freighter" &&
			adjusted.viewer?.asset === "freighter" &&
			adjusted.viewer?.variant === "b" &&
			adjusted.viewer?.rankings?.freighter?.join(",") === "b,a,c" &&
			adjusted.ranking?.includes("freighter: B > A > C") &&
			adjusted.viewer?.beam === 1.3 &&
			adjusted.viewer?.engine === 0.35 &&
			adjusted.viewer?.wireframe === true,
	);
	// #202's beacons are lit by name like the strobes; the selector is a
	// string test, so this reads the materials back rather than trusting it.
	await page.goto(
		workbenchUrl(ORIGIN, { "model-viewer": "station", finish: "industrial" }),
		{
			waitUntil: "load",
		},
	);
	await page.waitForSelector("#model-viewer canvas");
	await page.locator('[data-model-asset="trade"]').click();
	await page.locator('[data-model-control="engine"]').fill("35");
	const beacons = await page.evaluate(() => {
		const { holder, state } = window.__seeliteModelViewer;
		const out = {
			finish: state.finish,
			engine: state.engine,
			beacons: 0,
			lit: 0,
			glows: 0,
			glowsLit: 0,
		};
		holder.traverse((object) => {
			if (!object.name.startsWith("beacon")) return;
			// A beacon's glare is a child named like it (#300): a shader
			// material, read through its drive rather than `emissiveIntensity`.
			if (object.userData.glow) {
				out.glows += 1;
				if (object.material?.uniforms?.uIntensity?.value === state.engine)
					out.glowsLit += 1;
				return;
			}
			out.beacons += 1;
			if (object.material?.emissiveIntensity === state.engine) out.lit += 1;
		});
		return out;
	});
	check(
		`${viewport.name}: the industrial trade station's beacons take the engine cue, glare included`,
		beacons.finish === "industrial" &&
			beacons.engine === 0.35 &&
			beacons.beacons > 0 &&
			beacons.lit === beacons.beacons &&
			beacons.glows === beacons.beacons &&
			beacons.glowsLit === beacons.glows,
		JSON.stringify(beacons),
	);
	await page.close();
}

await browser.close();
exit();
