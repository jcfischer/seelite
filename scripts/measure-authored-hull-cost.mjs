/**
 * What an authored hull costs a frame, against the procedural loft it
 * replaced: the courier against the Kestrel (node #812), the tug's
 * Bollard O4 against the tug loft (node #814, `HULL=tug`), or the voyager's
 * Discovery against the Odyssey loft (node #820, `HULL=voyager`).
 *
 *   node scripts/measure-authored-hull-cost.mjs
 *   HULL=tug node scripts/measure-authored-hull-cost.mjs
 *   HULL=voyager node scripts/measure-authored-hull-cost.mjs
 *
 * For the tug and the voyager the player's group holds that hull in place of
 * the courier: the player never flies either, but the same camera and clock
 * are what keep the arms comparable.
 *
 * Starts its own dev server on this tree, boots headed and refuses a software
 * rasteriser (#98), and measures **one page, one camera, one clock**: the
 * player's hull group in chase view holds, block by block, nothing, the
 * authored O4, or the procedural loft — and, for Traffic, the same hull
 * with four more of it parked in frame ahead: close (`+4`, inside the
 * detail band's first edge, so the full model) and far (`+4far`, past it,
 * so the reduced level the band switches a courier to there, and the
 * loft's reduced band without its clutter). Both hulls are built on this
 * page by the game's own `ship-mesh.ts` (vite serves the one module instance),
 * the loft by uninstalling the authored builder for one build and putting
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
// A default-layout probe (#381 D11): it presses keys by name, as the shipped
// layout binds them, and a moved default turns it red for that reason.
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
/** Each after-boot hull this measures: the module naming its levels, and
 *  whether the player's own group already holds it (the courier) or the
 *  authored arm is built (the tug). */
const HULLS = {
	courier: {
		module: "/src/courier-hull.ts",
		levelNames: "COURIER_LEVEL_NAMES",
		players: true,
	},
	tug: {
		module: "/src/tug-hull.ts",
		levelNames: "TUG_LEVEL_NAMES",
		players: false,
	},
	voyager: {
		module: "/src/voyager-hull.ts",
		levelNames: "VOYAGER_LEVEL_NAMES",
		players: false,
	},
	interceptor: {
		module: "/src/interceptor-hull.ts",
		levelNames: "INTERCEPTOR_LEVEL_NAMES",
		players: false,
	},
};
const HULL = process.env.HULL ?? "courier";
if (!HULLS[HULL])
	throw new Error(
		`HULL must be one of ${Object.keys(HULLS).join(", ")}, not ${HULL}`,
	);

const ARMS = [
	"none",
	"authored",
	"loft",
	"authored+4",
	"loft+4",
	"authored+4far",
	"loft+4far",
];

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
	const setup = await page.evaluate(
		async ([hullId, spec]) => {
			const g = window.__seelite;
			// Both after-boot hulls installed, as a live Game has them (#831).
			await g.loadAuthoredHullsAfterBoot();
			g.clockHeld = true;
			g.chaseYaw = -0.8;
			g.chaseElevation = 0.3;
			const mesh = await import("/src/ship-mesh.ts");
			const { markOcclusion } = await import("/src/occlusion-mesh.ts");
			const builder = mesh.authoredHullBuilder(hullId);
			if (!builder)
				throw new Error(
					`the page's ship-mesh module has no authored ${hullId}`,
				);
			const ship = g.shipMesh;
			if (ship.userData.authored !== true)
				throw new Error(
					"the player's courier is not authored: the page has not installed its after-boot hulls",
				);
			const build = (authored) => {
				if (!authored) mesh.installAuthoredHull(hullId, undefined);
				try {
					const root = mesh.buildShipMesh(hullId, "a").root;
					markOcclusion(root);
					return root;
				} finally {
					mesh.installAuthoredHull(hullId, builder);
				}
			};
			const kids = {
				authored: spec.players ? [...ship.children] : [...build(true).children],
				loft: [...build(false).children],
			};
			// Four more of each hull ahead of the player, in the ship's frame
			// (kilometres, nose −z): Traffic's case, every one in the frustum.
			const SLOTS = [
				[-0.09, 0.02, -0.16],
				[0.09, 0.02, -0.16],
				[-0.05, -0.03, -0.32],
				[0.05, -0.03, -0.32],
			];
			// Past the band's first edge: four hulls on the camera's own axis at
			// 60 and 80 courier reaches from it, against `DETAIL_RADII.full`'s 40,
			// spread across the frame. Placed from the chase camera's pose, because
			// "ahead of the ship" is out of frame at this yaw that far out.
			const { DETAIL_RADII } = await import("/src/detail-level.ts");
			const reach = mesh.HULL_REACH_KM[hullId];
			g.render(0);
			const camera = g.nearCamera;
			camera.updateMatrixWorld(true);
			const eye = camera.getWorldPosition(new ship.position.constructor());
			const basis = (x, y, z) =>
				new ship.position.constructor(x, y, z).transformDirection(
					camera.matrixWorld,
				);
			const forward = basis(0, 0, -1);
			const right = basis(1, 0, 0);
			const up = basis(0, 1, 0);
			const FAR = [
				[-0.25, 0.1, 60],
				[0.25, 0.1, 60],
				[-0.15, -0.1, 80],
				[0.15, -0.1, 80],
			];
			const placedFar = (root, [across, high, radii]) => {
				const range = radii * reach;
				const at = eye
					.clone()
					.addScaledVector(forward, range)
					.addScaledVector(right, across * range)
					.addScaledVector(up, high * range);
				const distance = at.distanceTo(eye);
				root.position.copy(ship.worldToLocal(at));
				return distance;
			};
			const fleet = (authored, far) => {
				const group = new ship.constructor();
				for (let i = 0; i < 4; i++) {
					const root = build(authored);
					let distance;
					if (far) distance = placedFar(root, FAR[i]);
					else {
						root.position.set(...SLOTS[i]);
						distance = root.position.length();
					}
					// Stepped once, as the game steps every hull it draws: the
					// clock is held, so the range does not change.
					mesh.updateShipVisuals(root, distance, "high");
					group.add(root);
				}
				return group;
			};
			const fleets = {
				"authored+4": fleet(true, false),
				"loft+4": fleet(false, false),
				"authored+4far": fleet(true, true),
				"loft+4far": fleet(false, true),
			};
			const LEVEL_NAMES = (await import(spec.module))[spec.levelNames];
			const levelOf = (root) =>
				Object.values(LEVEL_NAMES)
					.map((name) => root.getObjectByName(name))
					.find((o) => o?.visible)?.name;
			for (const [arm, levels] of [
				["authored+4", LEVEL_NAMES.full],
				["authored+4far", LEVEL_NAMES.reduced],
			])
				for (const root of fleets[arm].children)
					if (levelOf(root) !== levels)
						throw new Error(`${arm}: a ${hullId} draws ${levelOf(root)}`);
			if (FAR.some(([, , radii]) => radii <= DETAIL_RADII.full))
				throw new Error("a far slot is inside the band's first edge");
			window.__hullArm = (arm) => {
				for (const child of [...ship.children]) ship.remove(child);
				if (arm === "none") return;
				const hull = arm.startsWith("authored") ? "authored" : "loft";
				for (const child of kids[hull]) ship.add(child);
				if (fleets[arm]) ship.add(fleets[arm]);
			};
			const { meshStats } = await import("/scripts/lib/mesh-stats.mjs");
			const { isLevelStandIn } = await import("/src/ship-detail.ts");
			return {
				authored: meshStats(kids.authored, isLevelStandIn),
				loft: meshStats(kids.loft),
			};
		},
		[HULL, HULLS[HULL]],
	);

	const timed = (arm, occlusion) =>
		page.evaluate(
			([a, occ, frames]) => {
				const g = window.__seelite;
				const gl = g.renderer.getContext();
				window.__hullArm(a);
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
				window.__hullArm(a);
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
		`  hull ${HULL}: authored ${setup.authored.meshes} meshes / ${setup.authored.triangles} triangles; ` +
			`loft ${setup.loft.meshes} meshes / ${setup.loft.triangles} triangles`,
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
		console.log("  arm            ms/frame  calls  triangles");
		for (const arm of ARMS)
			console.log(
				`  ${arm.padEnd(14)} ${median(blocks[arm]).toFixed(3).padStart(8)}  ${String(counts[arm].calls).padStart(5)}  ${String(counts[arm].triangles).padStart(9)}`,
			);
		const delta = (a, b) =>
			`${(median(blocks[a]) - median(blocks[b])).toFixed(3)} ms, ${a} slower in ${separation(blocks[a], blocks[b])}`;
		console.log(`  authored − none:        ${delta("authored", "none")}`);
		console.log(`  loft − none:            ${delta("loft", "none")}`);
		console.log(`  authored − loft:        ${delta("authored", "loft")}`);
		console.log(`  authored+4 − loft+4:    ${delta("authored+4", "loft+4")}`);
		console.log(
			`  authored+4far − loft+4far: ${delta("authored+4far", "loft+4far")}`,
		);
		console.log(
			`  authored+4 − authored+4far: ${delta("authored+4", "authored+4far")}`,
		);
	}
	await page.evaluate(() => window.__hullArm("authored"));
} finally {
	await browser.close();
	await server.close();
}
