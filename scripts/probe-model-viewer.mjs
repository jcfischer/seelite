/** Prove the query-gated procedural-model workbench stays outside Game. */
import { guardedOrigin, launchChromium, tally } from "./probe-guard.mjs";

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
	return {
		root: Boolean(root),
		canvas: canvas instanceof HTMLCanvasElement && canvas.width > 0,
		assets: buttons.map((button) => button.getAttribute("data-model-asset")),
		selected: buttons
			.find((button) => button.getAttribute("aria-pressed") === "true")
			?.getAttribute("data-model-asset"),
		gameConstructed: Boolean(window.__seelite),
		viewer: window.__seeliteModelViewer?.state,
	};
}

await guardedOrigin(ORIGIN, ["src/model-viewer.ts"]);
const browser = await launchChromium();
const { check, exit } = tally();

for (const viewport of VIEWPORTS) {
	const page = await browser.newPage({ viewport });
	page.on("pageerror", (error) =>
		check(`${viewport.name}: no page error (${error.message})`, false),
	);
	await page.goto(`${ORIGIN}/?model-viewer=ship`, { waitUntil: "load" });
	await page.waitForSelector("#model-viewer canvas");
	const initial = await page.evaluate(state);
	check(
		`${viewport.name}: model viewer presents the three ship studies without Game`,
		initial.root &&
			initial.canvas &&
			initial.assets.join(",") === "courier,interceptor,freighter" &&
			initial.selected === "courier" &&
			!initial.gameConstructed,
	);
	await page.locator('[data-model-asset="freighter"]').click();
	await page.locator('[data-model-control="beam"]').fill("130");
	await page.locator('[data-model-control="engine"]').fill("35");
	await page.locator('[data-model-control="wireframe"]').check();
	const adjusted = await page.evaluate(state);
	check(
		`${viewport.name}: asset and draft controls update the isolated visual state`,
		adjusted.selected === "freighter" &&
			adjusted.viewer?.asset === "freighter" &&
			adjusted.viewer?.beam === 1.3 &&
			adjusted.viewer?.engine === 0.35 &&
			adjusted.viewer?.wireframe === true,
	);
	await page.close();
}

await browser.close();
exit();
