/**
 * Node #950 instrument: what an asteroid field costs a frame, per arm and
 * quality side, against a no-field control. Throwaway prototype.
 *
 *   node spikes/asteroid-lod-950/measure.mjs
 *   VIEWS=inside BLOCKS=6 node spikes/asteroid-lod-950/measure.mjs
 *
 * The method is `scripts/measure-authored-hull-cost.mjs`'s, unforked: its own
 * dev server, headed, the player's renderer asserted, 1440x900 at device scale
 * 2, chase view with the clock held, blocks shuffled from a printed seed, a
 * warm pass, each block drained with a 1x1 readPixels, medians with a
 * Mann-Whitney count beside every delta (`scripts/lib/measurement.mjs`), draw
 * calls and triangles from `renderer.info` over one composed frame.
 *
 * One difference, and it is the subject: every rock moves every frame
 * (#948 D5), so each timed frame advances field time by 1/60 s and recomputes
 * every rock's matrix and level before `render`. That CPU cost is inside the
 * figure. The control arm advances nothing.
 *
 * The field is the p99 field on the fingerprint seed 0x5ee11e (galaxy 0,
 * system 173, field-00: 210 rocks), placed from the camera's own pose with its
 * 24 km axis down the view: `inside` stands in a cell corner near the centre,
 * `edge` 2 km off the end of the long axis (every rock ahead), `far` 200 km
 * off the end (the refinery's range, D3).
 */
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import { median, seededShuffler, separation } from "../../scripts/lib/measurement.mjs";
import { assertPlayersRenderer } from "../../scripts/lib/players-renderer.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "../../scripts/probe-guard.mjs";

const FRAMES = Number(process.env.FRAMES ?? 120);
const BLOCKS = Number(process.env.BLOCKS ?? 12);
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261013);
const K = Number(process.env.K ?? 8);
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5197);
const VIEWS = (process.env.VIEWS ?? "inside,edge,far").split(",");
const OCCLUSION = (process.env.OCCLUSION ?? "off,on").split(",").map((s) => s === "on");
const FIELD_ARMS = (process.env.ARMS ?? "inst-k,batch-k,batch-unique,naive").split(",");
const QUALITIES = ["high", "low"];
const ARMS = QUALITIES.flatMap((q) => ["none", ...FIELD_ARMS].map((a) => `${a}@${q}`));

const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-asteroid-950",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });
try {
	const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
	page.on("pageerror", (e) => console.error("  pageerror:", e.message));
	await page.goto(gameUrl(origin, { seed: 42, system: 0, "no-save": true, "coriolis-start": "approach" }));
	await bootedGame(page, 90000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite.view === "chase");
	const setup = await page.evaluate(
		async ([fieldArms, k]) => {
			const g = window.__seelite;
			await g.loadAuthoredHullsAfterBoot();
			g.clockHeld = true;
			g.chaseYaw = -0.8;
			g.chaseElevation = 0.3;
			const F = await import("/spikes/asteroid-fields-948/field-proto.ts");
			const R = await import("/spikes/asteroid-lod-950/field-render.ts");
			const { THREE } = R;
			const { generateGalaxy } = await import("/src/galaxy.ts");
			const { generateContents } = await import("/src/system.ts");
			const record = generateGalaxy(0x5ee11e, 0).systems[173];
			const contents = generateContents(record);
			const plan = F.chartedField(record, contents);
			const rocks = F.rocks(record, plan);
			g.render(0);
			const camera = g.nearCamera;
			camera.updateMatrixWorld(true);
			const size = g.renderer.getDrawingBufferSize(new THREE.Vector2());
			const pxPerRadian = size.y / 2 / Math.tan(((camera.fov / 2) * Math.PI) / 180);
			const eye = camera.getWorldPosition(new THREE.Vector3());
			const camQ = camera.getWorldQuaternion(new THREE.Quaternion());
			// Field +x down the view (camera −z), field y up the view's y.
			const fieldQ = camQ
				.clone()
				.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)));
			const a = 24;
			const STAND = {
				inside: new THREE.Vector3(1.2, 1.2, 1.2),
				edge: new THREE.Vector3(-a - 2, 0, 0),
				far: new THREE.Vector3(-a - 200, 0, 0),
				close: (() => {
					const big = rocks.reduce((x, y) => (y.radiusKm > x.radiusKm ? y : x));
					const at = F.rockLocal(big, 0);
					return new THREE.Vector3(at.x - 1.2 * big.radiusKm, at.y, at.z);
				})(),
			};
			const renderers = {};
			const build = {};
			for (const arm of fieldArms)
				for (const quality of ["high", "low"]) {
					const key = `${arm}@${quality}`;
					if (arm === "naive" && quality === "low") {
						renderers[key] = renderers["naive@high"];
						continue;
					}
					const fr = R.buildFieldRenderer(
						rocks,
						{ arm, k, quality, shadows: quality === "high" },
						pxPerRadian,
					);
					fr.root.quaternion.copy(fieldQ);
					fr.root.visible = false;
					g.nearScene.add(fr.root);
					renderers[key] = fr;
					build[key] = fr.stats();
				}
			let t = 0;
			const camLocal = new THREE.Vector3();
			window.__fieldView = (v) => {
				for (const fr of Object.values(renderers)) {
					// Put the stand point at the eye.
					const off = STAND[v].clone().applyQuaternion(fieldQ);
					fr.root.position.copy(eye).sub(off);
					fr.root.updateMatrixWorld(true);
				}
			};
			window.__fieldArm = (key) => {
				for (const fr of Object.values(renderers)) fr.root.visible = false;
				window.__field = key.startsWith("none") ? null : renderers[key];
				if (window.__field) {
					window.__field.root.visible = true;
					camLocal.copy(eye);
					window.__field.root.worldToLocal(camLocal);
				}
				g.settings.set("quality", key.split("@")[1]);
			};
			window.__fieldStep = () => {
				// A 2 s window: drift stays under 4 mm, so a close stand point holds.
				t = (t + 1 / 60) % 2;
				window.__field?.update(t, camLocal);
			};
			window.__fieldLevels = () => window.__field?.stats().perLevel;
			return {
				rocks: rocks.length,
				radii: [Math.min(...rocks.map((r) => r.radiusKm)), Math.max(...rocks.map((r) => r.radiusKm))],
				pxPerRadian,
				fov: camera.fov,
				build,
			};
		},
		[FIELD_ARMS, K],
	);

	const timed = (arm, occlusion) =>
		page.evaluate(
			([a, occ, frames]) => {
				const g = window.__seelite;
				const gl = g.renderer.getContext();
				window.__fieldArm(a);
				g.setOcclusion(occ, occ);
				const sync = new Uint8Array(4);
				window.__fieldStep();
				g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const started = performance.now();
				for (let i = 0; i < frames; i++) {
					window.__fieldStep();
					g.render(0);
				}
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				return (performance.now() - started) / frames;
			},
			[arm, occlusion, FRAMES],
		);
	const info = (arm, occlusion) =>
		page.evaluate(
			([a, occ]) => {
				const g = window.__seelite;
				window.__fieldArm(a);
				g.setOcclusion(occ, occ);
				window.__fieldStep();
				g.render(0);
				const r = g.renderer;
				const auto = r.info.autoReset;
				r.info.autoReset = false;
				r.info.reset();
				g.render(0);
				const out = {
					calls: r.info.render.calls,
					triangles: r.info.render.triangles,
					levels: window.__fieldLevels(),
				};
				r.info.autoReset = auto;
				return out;
			},
			[arm, occlusion],
		);

	console.log(`  renderer: ${renderer}`);
	console.log(
		`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, chase, clock held, fov ${setup.fov}, ${setup.pxPerRadian.toFixed(0)} px/rad`,
	);
	console.log(
		`  field: 0x5ee11e g0 s173 field-00, ${setup.rocks} rocks, radius ${(setup.radii[0] * 1000).toFixed(0)}–${(setup.radii[1] * 1000).toFixed(0)} m; K=${K}`,
	);
	console.log(`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`);
	console.log("  build (cold, main thread):");
	for (const [key, b] of Object.entries(setup.build))
		console.log(
			`    ${key.padEnd(18)} ${b.buildMs.toFixed(1).padStart(7)} ms  shapes ${String(b.uniqueShapes).padStart(3)}  geometry ${b.geometryVertices} verts / ${b.geometryTriangles} tris`,
		);
	const shuffled = seededShuffler(ORDER_SEED);
	for (const view of VIEWS) {
		await page.evaluate((v) => window.__fieldView(v), view);
		if (process.env.SHOTS) {
			for (const arm of ARMS) {
				await page.evaluate((a) => {
					window.__fieldArm(a);
					window.__seelite.setOcclusion(false, false);
					for (let i = 0; i < 3; i++) window.__fieldStep();
				}, arm);
				await page.waitForTimeout(300);
				await page.screenshot({ path: `${process.env.SHOTS}/${view}-${arm}.png` });
			}
			continue;
		}
		for (const occlusion of OCCLUSION) {
			const blocks = Object.fromEntries(ARMS.map((a) => [a, []]));
			for (const arm of ARMS) await timed(arm, occlusion);
			for (let b = 0; b < BLOCKS; b++)
				for (const arm of shuffled(ARMS)) blocks[arm].push(await timed(arm, occlusion));
			const counts = {};
			for (const arm of ARMS) counts[arm] = await info(arm, occlusion);
			console.log(`\n  view ${view}, occlusion ${occlusion ? "on (shadow + AO, pinned)" : "off (pinned)"}`);
			console.log("  arm                 ms/frame   Δ vs none           calls  triangles  levels L0/L1/L2/pt");
			for (const arm of ARMS) {
				const q = arm.split("@")[1];
				const base = `none@${q}`;
				const d = median(blocks[arm]) - median(blocks[base]);
				const sep = arm === base ? "" : separation(blocks[arm], blocks[base]);
				const lv = counts[arm].levels ? counts[arm].levels.join("/") : "";
				console.log(
					`  ${arm.padEnd(18)} ${median(blocks[arm]).toFixed(3).padStart(8)}  ${arm === base ? "".padEnd(18) : `${d >= 0 ? "+" : ""}${d.toFixed(3)} ${sep}`.padEnd(18)}  ${String(counts[arm].calls - counts[base].calls).padStart(5)}  ${String(counts[arm].triangles - counts[base].triangles).padStart(9)}  ${lv}`,
				);
			}
		}
	}
} finally {
	await browser.close();
	await server.close();
}
