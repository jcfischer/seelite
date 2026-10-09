/**
 * What the authored courier costs a frame, against the procedural Kestrel it
 * replaced (node #812).
 *
 *   node scripts/measure-courier-hull-cost.mjs
 *
 * Starts its own dev server on this tree, boots headed and refuses a software
 * rasteriser (#98), and measures **one page, one camera, one clock**: the
 * player's hull group in chase view holds, block by block, nothing, the
 * authored O4, or the procedural Kestrel — and, for Traffic, the same hull
 * with four more of it parked in frame ahead. Both hulls are built on this
 * page by the game's own `ship-mesh.ts` (vite serves the one module instance),
 * the Kestrel by uninstalling the authored builder for one build and putting
 * it back. So the arms differ by the hull drawn and nothing else.
 *
 * The design is `measure-occlusion-cost.mjs`'s and for its reasons: blocks
 * interleaved and shuffled from a printed seed, each block drained before and
 * after the clock with a 1x1 `readPixels`, the median block reported and a
 * Mann-Whitney pairing count beside every delta (`lib/measurement.mjs`). It
 * is a diagnosis that asserts no threshold. Two occlusion states are run,
 * pinned rather than gated, because a courier beside a station draws with the
 * shadow and the ambient occlusion and one in open space without them; the
 * hulls are marked for occlusion as the game marks every hull it draws.
 *
 * Draw calls and triangles are `renderer.info` over one composed frame, so
 * they count every pass that frame draws (the shadow map's included).
 */
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { bootedGame, guardedOrigin, launchChromium } from "./probe-guard.mjs";

const FRAMES = 120;
const BLOCKS = Number(process.env.BLOCKS ?? 12);
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261009);
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5196);

const ARMS = ["none", "authored", "kestrel", "authored+4", "kestrel+4"];

const server = await createServer({
	server: { host: "127.0.0.1", port, strictPort: true },
	cacheDir: "node_modules/.vite-courier-cost",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });
try {
	// Device scale 2: the player's retina panel, as the other cost
	// instruments measure (`measure-occlusion-cost.mjs`).
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	await page.goto(
		gameUrl(origin, {
			seed: 42,
			system: 0,
			"no-save": true,
			"coriolis-start": "approach",
		}),
	);
	await bootedGame(page, 90000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.keyboard.press("v");
	await page.waitForFunction(() => window.__seelite.view === "chase");
	const setup = await page.evaluate(async () => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.chaseYaw = -0.8;
		g.chaseElevation = 0.3;
		const mesh = await import("/src/ship-mesh.ts");
		const { markOcclusion } = await import("/src/occlusion-mesh.ts");
		const builder = mesh.authoredCourierBuilder();
		if (!builder)
			throw new Error("the page's ship-mesh module has no authored courier");
		const ship = g.shipMesh;
		if (ship.userData.authored !== true)
			throw new Error("the player's hull is not the authored courier");
		const build = (authored) => {
			if (!authored) mesh.installAuthoredCourier(undefined);
			try {
				const root = mesh.buildShipMesh("courier", "a").root;
				markOcclusion(root);
				return root;
			} finally {
				mesh.installAuthoredCourier(builder);
			}
		};
		const kids = {
			authored: [...ship.children],
			kestrel: [...build(false).children],
		};
		// Four more of each hull ahead of the player, in the ship's frame
		// (kilometres, nose −z): Traffic's case, every one in the frustum.
		const SLOTS = [
			[-0.09, 0.02, -0.16],
			[0.09, 0.02, -0.16],
			[-0.05, -0.03, -0.32],
			[0.05, -0.03, -0.32],
		];
		const fleet = (authored) => {
			const group = new ship.constructor();
			for (const [x, y, z] of SLOTS) {
				const root = build(authored);
				root.position.set(x, y, z);
				group.add(root);
			}
			return group;
		};
		const fleets = { authored: fleet(true), kestrel: fleet(false) };
		window.__courierArm = (arm) => {
			for (const child of [...ship.children]) ship.remove(child);
			if (arm === "none") return;
			const hull = arm.startsWith("authored") ? "authored" : "kestrel";
			for (const child of kids[hull]) ship.add(child);
			if (arm.endsWith("+4")) ship.add(fleets[hull]);
		};
		const count = (children) => {
			let meshes = 0;
			let triangles = 0;
			for (const child of children)
				child.traverse((o) => {
					if (!o.isMesh) return;
					meshes++;
					const geo = o.geometry;
					triangles +=
						(geo.index ? geo.index.count : geo.attributes.position.count) / 3;
				});
			return { meshes, triangles };
		};
		return {
			authored: count(kids.authored),
			kestrel: count(kids.kestrel),
		};
	});

	const timed = (arm, occlusion) =>
		page.evaluate(
			([a, occ, frames]) => {
				const g = window.__seelite;
				const gl = g.renderer.getContext();
				window.__courierArm(a);
				g.setOcclusion(occ, occ);
				const sync = new Uint8Array(4);
				g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const started = performance.now();
				for (let i = 0; i < frames; i++) g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				return (performance.now() - started) / frames;
			},
			[arm, occlusion, FRAMES],
		);
	const info = (arm, occlusion) =>
		page.evaluate(
			([a, occ]) => {
				const g = window.__seelite;
				window.__courierArm(a);
				g.setOcclusion(occ, occ);
				g.render(0);
				const r = g.renderer;
				const auto = r.info.autoReset;
				r.info.autoReset = false;
				r.info.reset();
				g.render(0);
				const out = {
					calls: r.info.render.calls,
					triangles: r.info.render.triangles,
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
		`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, arm order shuffled from seed ${ORDER_SEED}`,
	);
	console.log(
		`  hull: authored ${setup.authored.meshes} meshes / ${setup.authored.triangles} triangles; ` +
			`Kestrel ${setup.kestrel.meshes} meshes / ${setup.kestrel.triangles} triangles`,
	);
	const shuffled = seededShuffler(ORDER_SEED);
	for (const occlusion of [false, true]) {
		const blocks = Object.fromEntries(ARMS.map((a) => [a, []]));
		// One warm pass over every arm, so no arm's first block compiles.
		for (const arm of ARMS) await timed(arm, occlusion);
		for (let b = 0; b < BLOCKS; b++)
			for (const arm of shuffled(ARMS))
				blocks[arm].push(await timed(arm, occlusion));
		const counts = {};
		for (const arm of ARMS) counts[arm] = await info(arm, occlusion);
		console.log(
			`\n  occlusion ${occlusion ? "on (shadow + AO, pinned)" : "off (pinned)"}`,
		);
		console.log("  arm         ms/frame  calls  triangles");
		for (const arm of ARMS)
			console.log(
				`  ${arm.padEnd(11)} ${median(blocks[arm]).toFixed(3).padStart(8)}  ${String(counts[arm].calls).padStart(5)}  ${String(counts[arm].triangles).padStart(9)}`,
			);
		const delta = (a, b) =>
			`${(median(blocks[a]) - median(blocks[b])).toFixed(3)} ms, ${a} slower in ${separation(blocks[a], blocks[b])}`;
		console.log(`  authored − none:        ${delta("authored", "none")}`);
		console.log(`  kestrel − none:         ${delta("kestrel", "none")}`);
		console.log(`  authored − kestrel:     ${delta("authored", "kestrel")}`);
		console.log(
			`  authored+4 − kestrel+4: ${delta("authored+4", "kestrel+4")}`,
		);
	}
	await page.evaluate(() => window.__courierArm("authored"));
} finally {
	await browser.close();
	await server.close();
}
