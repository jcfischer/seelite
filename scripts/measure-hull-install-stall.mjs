/**
 * What an after-boot hull's install costs the frame it lands in (node #814,
 * the model-integration SOP's "measured cold-install stalls").
 *
 *   node scripts/measure-hull-install-stall.mjs
 *
 * A live Game installs the courier, the tug and the voyager (node #820) after boot
 * (`loadAuthoredHullsAfterBoot`), while the player flies. Past the download,
 * each install is main-thread work: the GLB's parse and Meshopt decode, the
 * builder (`createAuthoredHullBuilder`, whose two reduced levels are made by
 * the simplifier), and the first build, which places the nav lights by
 * raycast and measures the throats; and then, in the same task, the Game's // glossary-ignore: throat
 * refresh (`refreshAuthoredHulls`), which rebuilds every live ship of the hull
 * and measures its muzzles again. This boots the game headed on the
 * player's renderer, lets it settle with both hulls installed, then repeats
 * each hull's install from bytes already fetched — so the download is not in
 * the figure — with the frame loop running, and reports each phase's wall
 * time and the longest gap between two animation frames across the whole
 * install. For the refresh, every live root of the hull is marked a stand-in
 * again so the Game rebuilds it as it rebuilds a loft, and the count of roots
 * is printed: the refresh's cost scales with it, and how many ships are live
 * at install depends on where the player is. `RUNS` repeats it; the first run of a page also pays shader and
 * module warm-up, so the median is the figure and the first is printed beside
 * it. It is a diagnosis that asserts no threshold.
 */
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { median } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const RUNS = Number(process.env.RUNS ?? 5);
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5197);

const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-install-stall",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	await page.goto(
		gameUrl(origin, {
			seed: 42,
			"no-save": true,
			raider: "off",
		}),
	);
	await bootedGame(page, 90000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.evaluate(async () => {
		const g = window.__seelite;
		await g.loadAuthoredHullsAfterBoot();
		g.clockHeld = false;
	});
	console.log(`  renderer: ${renderer}`);
	console.log(
		`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, clock running, ${RUNS} runs per hull`,
	);
	const HULLS = [
		{
			id: "courier",
			module: "/src/courier-hull.ts",
			create: "createCourierHullBuilder",
			url: "COURIER_HULL_GLB_URL",
		},
		{
			id: "tug",
			module: "/src/tug-hull.ts",
			create: "createTugHullBuilder",
			url: "BOLLARD_TUG_GLB_URL",
		},
		{
			id: "voyager",
			module: "/src/voyager-hull.ts",
			create: "createVoyagerHullBuilder",
			url: "DISCOVERY_VOYAGER_GLB_URL",
		},
	];
	for (const hull of HULLS) {
		// At a home station of the hull's Traffic, as `probe-model-download`
		// stands, so the refresh has that station's ships to rebuild.
		await page.evaluate((id) => {
			const g = window.__seelite;
			const actor = g.trafficActors.find((a) => a.hullId === id);
			// The voyager (node #820) flies in no Traffic: its refresh has no
			// roots to rebuild, and the figure is the install alone.
			if (!actor) {
				if (id === "voyager") return;
				throw new Error(`the fixture has no ${id} Traffic`);
			}
			const station = g.world.system.bodies.find(
				(b) => b.id === actor.homeStationId,
			);
			g.world.ship.pos = { ...station.pos };
			g.render(0);
		}, hull.id);
		const runs = [];
		for (let r = 0; r < RUNS; r++)
			runs.push(
				await page.evaluate(async (h) => {
					const mesh = await import("/src/ship-mesh.ts");
					const { HULL_SPECS } = await import("/src/hull.ts");
					const { ventThroats } = await import("/src/vent-plumes.ts");
					const { disposeSubtree } = await import("/src/gpu-teardown.ts");
					const urls = await import("/src/model-urls.ts");
					const made = await import(h.module);
					// The loader and decoder the game itself imports: their URLs read
					// off vite's transform of `authored-hull.ts`, which loads every
					// authored hull, so the page uses the same pre-bundled instances.
					const loaderModule = "/src/authored-hull.ts";
					const served = await (await fetch(loaderModule)).text();
					const urlOf = (name) => {
						const m = served.match(new RegExp(`from\\s+"([^"]*${name}[^"]*)"`));
						if (!m) throw new Error(`${loaderModule} imports no ${name}`);
						return m[1];
					};
					const { GLTFLoader } = await import(urlOf("GLTFLoader"));
					const { MeshoptDecoder } = await import(urlOf("meshopt_decoder"));
					const bytes = await (await fetch(urls[h.url])).arrayBuffer();
					const installed = mesh.authoredHullBuilder(h.id);
					// The frame loop's gaps, from before the first phase to after
					// the last.
					let last = performance.now();
					let worst = 0;
					let frames = 0;
					let watching = true;
					const tick = (t) => {
						worst = Math.max(worst, t - last);
						last = t;
						frames++;
						if (watching) requestAnimationFrame(tick);
					};
					await new Promise((done) =>
						requestAnimationFrame((t) => {
							last = t;
							requestAnimationFrame(tick);
							done();
						}),
					);
					const t0 = performance.now();
					const gltf = await new GLTFLoader()
						.setMeshoptDecoder(MeshoptDecoder)
						.parseAsync(bytes.slice(0), "");
					const t1 = performance.now();
					const builder = await made[h.create](gltf.scene);
					const t2 = performance.now();
					mesh.installAuthoredHull(h.id, builder);
					const { root } = mesh.buildShipMesh(h.id, HULL_SPECS[h.id].variant);
					const t3 = performance.now();
					ventThroats(root, h.id);
					const t4 = performance.now();
					disposeSubtree(root);
					// The Game's refresh, in the same task as in `loadAuthoredHull`:
					// every live root of the hull made a stand-in again, so it is
					// rebuilt as a loft would be.
					const g = window.__seelite;
					const live = [
						g.shipMesh,
						...g.trafficMeshes.values(),
						...g.fleet.map((f) => f.mesh),
						...[...g.derelictMeshes.values()].map((d) => d.root),
					].filter(
						(r) => r.userData.hullId === h.id && r.userData.authored === true,
					);
					for (const r of live) r.userData.authored = false;
					g.refreshAuthoredHulls();
					const t5 = performance.now();
					const rebuilt = live.filter((r) => r.userData.authored === true);
					await new Promise((done) =>
						requestAnimationFrame(() => requestAnimationFrame(done)),
					);
					watching = false;
					mesh.installAuthoredHull(h.id, installed);
					return {
						parse: t1 - t0,
						builder: t2 - t1,
						firstBuild: t3 - t2,
						throats: t4 - t3,
						refresh: t5 - t4,
						live: live.length,
						rebuilt: rebuilt.length,
						worstGap: worst,
						frames,
					};
				}, hull),
			);
		for (const run of runs)
			if (run.rebuilt !== run.live)
				throw new Error(
					`${hull.id}: the refresh rebuilt ${run.rebuilt} of ${run.live} live roots`,
				);
		const col = (k) =>
			`${median(runs.map((x) => x[k])).toFixed(1)} (first ${runs[0][k].toFixed(1)})`;
		console.log(
			`\n  ${hull.id}: ms, median of ${RUNS}; ${runs[0].live} live ${hull.id} root(s) refreshed`,
		);
		for (const k of [
			"parse",
			"builder",
			"firstBuild",
			"throats",
			"refresh",
			"worstGap",
		])
			console.log(`    ${k.padEnd(11)} ${col(k)}`);
	}
} finally {
	await browser.close();
	await server.close();
}
