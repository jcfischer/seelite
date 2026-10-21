// In-game evidence for the authored Porter (node #813): boots a no-save game
// flying the freighter on a hardware renderer, frames the player's Porter in
// chase view from four sides, and prices a Porter's frame cost against the
// procedural freighter A on the same frame. Fails on page errors or a software
// renderer. It does not dock.
//
//   node spikes/porter-hull/capture-game.mjs [label]
//
// The cost arms add four hulls in front of the camera, so the reading is the
// cost of four Porters (or four Derricks) in view, not of the scene the
// player meets. Arms run in shuffled blocks from a printed seed; each block
// times `render(0)` in a tight loop drained by `readPixels`, so the figure is
// serialised CPU-and-GPU time per frame, not the player's cadence, and only
// the deltas between arms mean anything.
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const label = process.argv[2] ?? "game";
const port = Number(process.env.PORT ?? 5194);
const seed = Number(process.env.SEED ?? 813);
const out = `.dream-loop/porter-game/${label}`;
const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-porter-capture",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
await mkdir(out, { recursive: true });
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(
		gameUrl(origin, {
			seed: 42,
			system: 0,
			hull: "freighter",
			"no-save": true,
			"coriolis-start": "approach",
			models: "all",
		}),
	);
	await bootedGame(page, 90000);
	await page.waitForTimeout(3000);
	const facts = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		let porters = 0;
		g.nearScene.traverse((o) => {
			if (o.name === "porter-model") porters++;
		});
		return {
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			hull: g.commander.hull,
			playerPorter: !!g.shipMesh.getObjectByName("porter-model"),
			portersInNearScene: porters,
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(facts.renderer))
		throw Error("hardware renderer required");
	if (facts.hull !== "freighter" || !facts.playerPorter)
		throw Error(`not flying the authored Porter: ${JSON.stringify(facts)}`);
	await page.keyboard.press("v");
	const shot = async (name, yaw, elevation) => {
		await page.evaluate(
			([yaw, elevation]) => {
				const g = window.__seelite;
				g.chaseYaw = yaw;
				g.chaseElevation = elevation;
			},
			[yaw, elevation],
		);
		await page.waitForTimeout(500);
		await page.screenshot({ path: `${out}/${name}.png` });
	};
	await shot("chase-astern", 0, 0.25);
	// A positive yaw swings the camera to starboard: the green light is the
	// near one there, and the cassettes are beyond the keel.
	await shot("chase-starboard", Math.PI / 2, 0.3);
	await shot("chase-port", -Math.PI / 2, 0.3);
	await shot("chase-bow", Math.PI * 0.85, 0.2);
	await shot("chase-below", 0.4, -0.6);

	// The cost arms: four hulls parked ahead of the camera, in view.
	const cost = await page.evaluate(
		async ([seed]) => {
			const g = window.__seelite;
			g.chaseYaw = 0;
			g.chaseElevation = 0.25;
			for (let i = 0; i < 3; i++)
				await new Promise((r) => requestAnimationFrame(() => r()));
			const { buildShipMesh } = await import("/src/ship-mesh.ts");
			const { markOcclusion } = await import("/src/occlusion-mesh.ts");
			const camera = g.nearCamera;
			camera.updateMatrixWorld(true);
			const ahead = aheadOf(camera);
			const group = (variant) => {
				const hulls = [];
				for (let i = 0; i < 4; i++) {
					const root = buildShipMesh("freighter", variant).root;
					markOcclusion(root);
					root.position.copy(ahead.at(0.25 + 0.06 * i, (i - 1.5) * 0.05));
					root.quaternion.copy(camera.quaternion);
					root.visible = false;
					g.nearScene.add(root);
					hulls.push(root);
				}
				return hulls;
			};
			function aheadOf(cam) {
				const origin = cam.position.clone();
				const forward = cam.getWorldDirection(origin.clone());
				const right = forward.clone().cross(cam.up).normalize();
				return {
					at: (distanceKm, sideKm) =>
						origin
							.clone()
							.addScaledVector(forward, distanceKm)
							.addScaledVector(right, sideKm),
				};
			}
			const arms = {
				none: [],
				porter: group("b"),
				derrick: group("a"),
			};
			const gl = g.renderer.getContext();
			const sync = new Uint8Array(4);
			const timeArm = (name, n) => {
				for (const hull of arms[name]) hull.visible = true;
				const wasAuto = g.renderer.info.autoReset;
				g.renderer.info.autoReset = false;
				g.renderer.info.reset();
				g.render(0);
				const drawn = {
					calls: g.renderer.info.render.calls,
					triangles: g.renderer.info.render.triangles,
				};
				g.renderer.info.autoReset = wasAuto;
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const started = performance.now();
				for (let i = 0; i < n; i++) g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const ms = (performance.now() - started) / n;
				for (const hull of arms[name]) hull.visible = false;
				return { ms, ...drawn };
			};
			let s = seed >>> 0;
			const rand = () =>
				(s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
			const samples = { none: [], porter: [], derrick: [] };
			const drawn = {};
			for (let block = 0; block < 12; block++) {
				const order = Object.keys(arms);
				for (let i = order.length - 1; i > 0; i--) {
					const j = Math.floor(rand() * (i + 1));
					[order[i], order[j]] = [order[j], order[i]];
				}
				for (const name of order) {
					const r = timeArm(name, 30);
					samples[name].push(r.ms);
					drawn[name] = { calls: r.calls, triangles: r.triangles };
				}
			}
			const median = (xs) => {
				const v = [...xs].sort((a, b) => a - b);
				return v[Math.floor(v.length / 2)];
			};
			// Pairings separated: of every (arm, none) pair of blocks, how many
			// put the arm above the bare frame.
			const separated = (name) => {
				let above = 0;
				for (const a of samples[name])
					for (const b of samples.none) if (a > b) above++;
				return `${above}/${samples[name].length * samples.none.length}`;
			};
			// Show the four Porters for the frame the principal looks at.
			for (const hull of arms.porter) hull.visible = true;
			return {
				seed,
				blocks: 12,
				framesPerBlock: 30,
				medianMs: Object.fromEntries(
					Object.entries(samples).map(([k, v]) => [k, median(v)]),
				),
				fourPortersOverBareMs: median(samples.porter) - median(samples.none),
				fourDerricksOverBareMs: median(samples.derrick) - median(samples.none),
				separated: {
					porter: separated("porter"),
					derrick: separated("derrick"),
				},
				drawn,
			};
		},
		[seed],
	);
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${out}/four-porters.png` });
	const report = { ...facts, cost, errors };
	await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
	if (errors.length) throw Error(errors.join("\n"));
	console.log(JSON.stringify(report, null, 2));
} finally {
	await browser.close();
	await server.close();
}
