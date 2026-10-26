import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

await holdProbeLockOrExit("Lance distance-level captures");
const { check, watch, exit } = tally();
const out = process.env.OUT ?? "view-set/node-1034/current-transitions";
await mkdir(out, { recursive: true });
const server = await createServer({
	server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
let browser;
try {
	const origin = await guardedOrigin(server.resolvedUrls.local[0]);
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
	});
	watch(page);
	await page.goto(
		gameUrl(origin, {
			seed: 47,
			hull: "interceptor",
			"no-save": true,
			raider: "off",
		}),
	);
	await bootedGame(page, 90000);
	const fixture = await page.evaluate(async () => {
		const g = window.__seelite;
		await g.loadAuthoredHullsAfterBoot();
		if (g.shipMesh.userData.hullId !== "interceptor")
			throw new Error("Lance capture did not boot the interceptor");
		g.clockHeld = true;
		g.view = "chase";
		const mesh = await import("/src/ship-mesh.ts");
		const { HULL_SPECS } = await import("/src/hull.ts");
		const root = mesh.buildShipMesh(
			"interceptor",
			HULL_SPECS.interceptor.variant,
		).root;
		window.__lanceCapture = root;
		g.nearScene.add(root);
		g.render(0);
		return {
			renderer: g.renderer
				.getContext()
				.getParameter(
					g.renderer.getContext().getExtension("WEBGL_debug_renderer_info")
						.UNMASKED_RENDERER_WEBGL,
				),
			fov: g.nearCamera.fov,
			reachKm: mesh.HULL_REACH_KM.interceptor,
		};
	});
	const cases = [
		[35, "full"],
		[40.8, "full"],
		[44, "reduced"],
		[40.8, "reduced"],
		[408, "reduced"],
		[440, "outline"],
		[408, "outline"],
		[380, "reduced"],
		[38, "full"],
	];
	const rows = [];
	for (const [radii, expected] of cases) {
		const row = await page.evaluate(async (range) => {
			const mesh = await import("/src/ship-mesh.ts");
			const { INTERCEPTOR_LEVEL_NAMES } = await import(
				"/src/interceptor-hull.ts"
			);
			const g = window.__seelite;
			const root = window.__lanceCapture;
			g.render(0);
			const camera = g.nearCamera;
			const distance = range * mesh.HULL_REACH_KM.interceptor;
			root.quaternion.copy(camera.quaternion);
			root.position
				.copy(camera.position)
				.addScaledVector(
					camera.getWorldDirection(root.position.clone()),
					distance,
				);
			mesh.updateShipVisuals(root, distance, "high");
			g.render(0);
			return {
				radii: range,
				actualKm: root.position.distanceTo(camera.position),
				visible: Object.entries(INTERCEPTOR_LEVEL_NAMES)
					.filter(([, name]) => root.getObjectByName(name).visible)
					.map(([level]) => level),
			};
		}, radii);
		check(
			`${radii} reaches draws ${expected} alone`,
			row.visible.length === 1 && row.visible[0] === expected,
			`visible ${JSON.stringify(row.visible)}`,
		);
		check(
			`${radii} reaches is placed at ${radii} reaches`,
			Math.abs(row.actualKm - radii * fixture.reachKm) < 1e-9,
			`${row.actualKm} km against ${radii * fixture.reachKm} km`,
		);
		const file = `${rows.length + 1}-${radii}-${expected}.png`;
		await page.screenshot({ path: `${out}/${file}` });
		rows.push({ ...row, file });
	}
	await writeFile(
		`${out}/report.json`,
		JSON.stringify(
			{ ...fixture, viewport: [1440, 900], deviceScale: 2, rows },
			null,
			2,
		),
	);
	console.log(
		`Captured and checked ${rows.length} Lance level transitions: ${out}`,
	);
} finally {
	await browser?.close();
	await server.close();
}
exit();
