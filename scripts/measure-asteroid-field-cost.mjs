/**
 * Node #968 instrument: what the production asteroid field costs a frame,
 * against a no-field control, on the GPU lane, by #950's method.
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/measure-asteroid-field-cost.mjs
 *   VIEWS=close,inside,edge,far BLOCKS=12 ORDER_SEED=7 node scripts/measure-asteroid-field-cost.mjs
 *   INSTALL=1 node scripts/measure-asteroid-field-cost.mjs      # cold install stalls
 *
 * The method is `spikes/asteroid-lod-950/measure.mjs`'s: its own dev server,
 * headed, the player's renderer asserted, 1440x900 at device scale 2, chase
 * view with the clock held, blocks shuffled from a printed seed, a warm pass,
 * each block drained with a 1x1 readPixels, medians with a Mann-Whitney count.
 *
 * The difference is the subject: this measures the **shipped** path. The field
 * is the one `Game` built for system 173 of world 0x5ee11e (field-00, the
 * charted p99-class fixture), installed through the model queue, updated inside
 * `Game.render` from the clock. Every timed frame advances game time by 1/60 s
 * (a 2 s window) and re-stands the camera at the same field-frame point, so the
 * field's orbit does not carry the view away; that re-standing is in both arms.
 * The control arm hides the field and skips its update.
 *
 * `INSTALL=1` measures instead the swap from points to rocks on a cold boot:
 * the longest frame interval while the rocks fetch, decode, build and warm,
 * and the first frame that draws them.
 */
// A default-layout probe (#381 D11): it presses `v` for the chase view, as the
// shipped layout binds it, and a moved default turns it red for that reason.
import { createServer } from "vite";
import { loadavg } from "node:os";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const FRAMES = Number(process.env.FRAMES ?? 120);
const BLOCKS = Number(process.env.BLOCKS ?? 12);
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261019);
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5201);
const VIEWS = (process.env.VIEWS ?? "close,inside,edge,far").split(",");
const OCCLUSION = (process.env.OCCLUSION ?? "off,on")
	.split(",")
	.map((s) => s === "on");
const QUALITIES = ["high", "low"];
const ARMS = QUALITIES.flatMap((q) => [`none@${q}`, `field@${q}`]);
const WORLD = 0x5ee11e;
const SYSTEM = 173;

const releaseLock = await holdProbeLockOrExit("asteroid field cost");
console.log("  host load average at start:", loadavg().join(" / "));
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-asteroid-968",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });

/** In the page: stand the camera at a field-frame point looking along field +x. */
const SETUP = async (install) => {
	const g = window.__seelite;
	g.clockHeld = true;
	const A = await import("/src/asteroid-field.ts");
	const draw = g.fields[0];
	const plan = draw.plan;
	const T0 = g.world.gameTime;
	const Q = plan.rotation;
	const fieldAxis = A.rotateByQuat(Q, { x: 1, y: 0, z: 0 });
	const V3 = g.nearScene.position.constructor;
	const aimDir = new V3(fieldAxis.x, fieldAxis.y, fieldAxis.z);
	g.orientation.setFromUnitVectors(new V3(0, 0, -1), aimDir);
	const big = draw.rocks.reduce(
		(best, r, i, all) => (r.radiusKm > all[best].radiusKm ? i : best),
		0,
	);
	const semi = 24;
	const STAND = {
		inside: { x: 1.2, y: 1.2, z: 1.2 },
		edge: { x: -semi - 2, y: 0, z: 0 },
		far: { x: -semi - 200, y: 0, z: 0 },
		close: (() => {
			const r = draw.rocks[big];
			const at = A.rockLocal(r, T0);
			return { x: at.x - 1.2 * r.radiusKm, y: at.y, z: at.z };
		})(),
	};
	let view = "inside";
	let t = 0;
	const stand = () => {
		const centre = A.fieldCentre(plan, g.world.gameTime);
		const r = A.rotateByQuat(Q, STAND[view]);
		const want = { x: centre.x + r.x, y: centre.y + r.y, z: centre.z + r.z };
		const have = g.cameraPos();
		const p = g.world.ship.pos;
		g.world.ship.pos = {
			x: p.x + want.x - have.x,
			y: p.y + want.y - have.y,
			z: p.z + want.z - have.z,
		};
	};
	const saved = g.fields;
	window.__arm = (key) => {
		const [arm, quality] = key.split("@");
		g.settings.set("quality", quality);
		g.fieldDraws = arm === "none" ? [] : saved;
		for (const d of saved) d.root.visible = arm !== "none";
	};
	window.__view = (v) => {
		view = v;
		g.world.gameTime = T0;
		stand();
	};
	window.__step = () => {
		t = (t + 1 / 60) % 2;
		g.world.gameTime = T0 + t;
		stand();
		g.render(0);
	};
	window.__levels = () => [...draw.perLevel];
	return { rocks: draw.rocks.length, shapes: draw.shapes, plan: plan.id };
};

try {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	page.on("pageerror", (e) => console.error("  pageerror:", e.message));
	if (process.env.INSTALL) await installCold(page);
	else await frameCost(page);
} finally {
	await browser.close();
	await server.close();
	console.log("  host load average at end:", loadavg().join(" / "));
	releaseLock();
}

async function frameCost(page) {
	await page.goto(
		gameUrl(origin, {
			seed: WORLD,
			system: SYSTEM,
			"no-save": true,
			"models-full": true,
		}),
	);
	await bootedGame(page, 180000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite.view === "chase");
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 180000,
		},
	);
	const setup = await page.evaluate(SETUP);
	if (setup.shapes !== "authored")
		throw new Error(`field is not drawing the authored rocks: ${setup.shapes}`);

	const timed = (arm, occlusion) =>
		page.evaluate(
			([a, occ, frames]) => {
				const g = window.__seelite;
				const gl = g.renderer.getContext();
				window.__arm(a);
				g.setOcclusion(occ, occ);
				const sync = new Uint8Array(4);
				window.__step();
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const started = performance.now();
				for (let i = 0; i < frames; i++) window.__step();
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				return (performance.now() - started) / frames;
			},
			[arm, occlusion, FRAMES],
		);
	const info = (arm, occlusion) =>
		page.evaluate(
			([a, occ]) => {
				const g = window.__seelite;
				window.__arm(a);
				g.setOcclusion(occ, occ);
				window.__step();
				const r = g.renderer;
				const auto = r.info.autoReset;
				r.info.autoReset = false;
				r.info.reset();
				g.render(0);
				const out = {
					calls: r.info.render.calls,
					triangles: r.info.render.triangles,
					levels: window.__levels(),
				};
				r.info.autoReset = auto;
				return out;
			},
			[arm, occlusion],
		);

	console.log(`  renderer: ${renderer}`);
	console.log(
		`  viewport: ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, chase, clock held`,
	);
	console.log(
		`  field: world 0x${WORLD.toString(16)} system ${SYSTEM} ${setup.plan}, ${setup.rocks} rocks, the shipped path (${setup.shapes})`,
	);
	console.log(
		`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`,
	);
	const shuffled = seededShuffler(ORDER_SEED);
	const worst = { high: { ms: -Infinity }, low: { ms: -Infinity } };
	for (const view of VIEWS) {
		await page.evaluate((v) => window.__view(v), view);
		for (const occlusion of OCCLUSION) {
			const blocks = Object.fromEntries(ARMS.map((a) => [a, []]));
			for (const arm of ARMS) await timed(arm, occlusion);
			for (let b = 0; b < BLOCKS; b++)
				for (const arm of shuffled(ARMS))
					blocks[arm].push(await timed(arm, occlusion));
			const counts = {};
			for (const arm of ARMS) counts[arm] = await info(arm, occlusion);
			console.log(
				`\n  view ${view}, occlusion ${occlusion ? "on (shadow + AO, pinned)" : "off (pinned)"}`,
			);
			console.log(
				"  arm                 ms/frame   Δ vs none           calls  triangles  levels L0/L1/L2/pt",
			);
			for (const arm of ARMS) {
				const q = arm.split("@")[1];
				const base = `none@${q}`;
				const d = median(blocks[arm]) - median(blocks[base]);
				const sep = arm === base ? "" : separation(blocks[arm], blocks[base]);
				if (arm !== base && d > worst[q].ms)
					worst[q] = {
						ms: d,
						view,
						occlusion,
						calls: counts[arm].calls - counts[base].calls,
					};
				const lv = arm === base ? "" : counts[arm].levels.join("/");
				console.log(
					`  ${arm.padEnd(18)} ${median(blocks[arm]).toFixed(3).padStart(8)}  ${arm === base ? "".padEnd(18) : `${d >= 0 ? "+" : ""}${d.toFixed(3)} ${sep}`.padEnd(18)}  ${String(counts[arm].calls - counts[base].calls).padStart(5)}  ${String(counts[arm].triangles - counts[base].triangles).padStart(9)}  ${lv}`,
				);
			}
		}
	}
	console.log(
		"\n  worst Δ per side (budget: high ≤ 1.0 ms / ≤ 12 calls, low ≤ 0.4 ms / ≤ 6 calls):",
	);
	for (const q of QUALITIES)
		console.log(
			`    ${q.padEnd(5)} +${worst[q].ms.toFixed(3)} ms at ${worst[q].view}, occlusion ${worst[q].occlusion ? "on" : "off"}, +${worst[q].calls} calls`,
		);
}

/** The swap from points to rocks on a cold boot: held, released, observed. */
async function installCold(page) {
	let release;
	let asked;
	const gate = new Promise((r) => {
		release = r;
	});
	const requested = new Promise((r) => {
		asked = r;
	});
	await page.route(/\/asteroids[^/]*\.glb/, async (route) => {
		asked();
		await gate;
		await route.continue();
	});
	await page.goto(
		gameUrl(origin, {
			seed: WORLD,
			system: SYSTEM,
			"no-save": true,
			"models-full": false,
		}),
	);
	await bootedGame(page, 180000);
	console.log("  booted, rocks held");
	await assertPlayersRenderer(page, "measure");
	await page.waitForFunction(
		() => {
			const g = window.__seelite;
			return g.fields.length > 0;
		},
		undefined,
		{ timeout: 60000 },
	);
	const setup = await page.evaluate(SETUP);
	console.log("  field built, camera stood");
	await page.evaluate(() => window.__view("inside"));
	// The queue is serial and the rocks are the last of this system's models:
	// once their request is held, every earlier install has finished, so the
	// stall under test is the rocks' own.
	await requested;
	await page.waitForFunction(
		() => window.__seelite.interiorModelsSettled,
		undefined,
		{
			timeout: 180000,
		},
	);
	console.log(`  other models settled; field before release: ${setup.shapes}`);
	await page.evaluate(() => {
		window.__gaps = [];
		window.__shown = null;
		let last = performance.now();
		const g = window.__seelite;
		const tick = () => {
			const now = performance.now();
			window.__gaps.push([now - last, g.fields[0].shapes]);
			last = now;
			if (g.fields[0].shapes === "none" || window.__gaps.length < 30)
				requestAnimationFrame(tick);
			else window.__done = true;
		};
		requestAnimationFrame(tick);
	});
	release();
	await page.waitForFunction(() => window.__done === true, undefined, {
		timeout: 120000,
	});
	const out = await page.evaluate(() => {
		const gaps = window.__gaps;
		const swapped = gaps.findIndex(([, s]) => s !== "none");
		return {
			frames: gaps.length,
			swapAt: swapped,
			maxBefore: Math.max(...gaps.slice(0, swapped).map(([d]) => d)),
			medianBefore: gaps
				.slice(0, swapped)
				.map(([d]) => d)
				.sort((a, b) => a - b)[Math.floor(swapped / 2)],
			swapFrame: gaps[swapped][0],
			afterSwap: gaps.slice(swapped + 1, swapped + 6).map(([d]) => d),
			worst: gaps
				.map(([d], i) => [d, i])
				.sort((a, b) => b[0] - a[0])
				.slice(0, 5),
		};
	});
	console.log(
		"  cold install, rocks held then released (frame intervals, ms):",
	);
	console.log(JSON.stringify(out, null, 1));
}
