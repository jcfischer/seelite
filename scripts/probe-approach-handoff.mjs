import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGE_URL = gameUrl(
	ORIGIN,
	{ seed: 47, system: 185 },
	{ override: process.env.PROBE_URL },
);
const EPS = 0.005;
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
await installCamSim(page);
await page.goto(PAGE_URL, { waitUntil: "load" });
await bootedGame(page);
const setup = await page.evaluate(() => {
	const g = window.__seelite;
	const body = g.world.system.bodies
		.filter((b) => g.units.isMassive(b.kind))
		.sort((a, b) => b.radiusKm - a.radiusKm)[0];
	return {
		id: body?.id ?? null,
		handoffKm: g.units.HANDOFF_KM,
		farScale: g.units.FAR_SCALE,
		approachScale: g.units.APPROACH_SCALE,
	};
});
check("the system has a massive body", setup.id !== null);
async function sample(surfaceKm) {
	return page.evaluate(
		async ([id, surface]) => {
			const g = window.__seelite;
			const body = g.world.system.bodies.find((b) => b.id === id);
			const n = Math.hypot(body.pos.x, body.pos.y, body.pos.z);
			const d = body.radiusKm + surface;
			const ux = n ? body.pos.x / n : 1;
			const uy = n ? body.pos.y / n : 0;
			const uz = n ? body.pos.z / n : 0;
			g.world.ship.pos = {
				x: body.pos.x + ux * d,
				y: body.pos.y + uy * d,
				z: body.pos.z + uz * d,
			};
			g.world.ship.vel = { x: 0, y: 0, z: 0 };
			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => requestAnimationFrame(resolve));
			const now = g.world.system.bodies.find((b) => b.id === id);
			const approachMesh = g.approachScene.getObjectByName(id);
			const farMesh = g.farScene.getObjectByName(id);
			const mesh = approachMesh ?? farMesh;
			const cam = window.__recoverCamSim();
			return {
				layer: approachMesh ? "approach" : farMesh ? "far" : "missing",
				radiusKm: now.radiusKm,
				drawnRadius: mesh?.scale.x ?? null,
				drawnDistance: mesh
					? Math.hypot(mesh.position.x, mesh.position.y, mesh.position.z)
					: null,
				trueDistance: Math.hypot(
					now.pos.x - cam.x,
					now.pos.y - cam.y,
					now.pos.z - cam.z,
				),
			};
		},
		[setup.id, surfaceKm],
	);
}
if (setup.id) {
	// Reset hysteresis before sampling its outward side.
	await sample(setup.handoffKm * (setup.handoffKm > 0 ? 2 : 1));
	const outer = await sample(setup.handoffKm * 1.001);
	const inner = await sample(setup.handoffKm * 0.999);
	for (const [name, s, scale, layer] of [
		["outside", outer, setup.farScale, "far"],
		["inside", inner, setup.approachScale, "approach"],
	]) {
		check(name + ": expected layer", s.layer === layer);
		const r = s.drawnRadius / s.radiusKm;
		const d = s.drawnDistance / s.trueDistance;
		check(
			name + ": position and radius share scale",
			Math.abs(r - d) <= EPS * scale,
		);
		check(name + ": page scale applied", Math.abs(r - scale) <= EPS * scale);
	}
	check(
		"apparent size is continuous across far-to-approach handoff",
		Math.abs(
			outer.drawnRadius / outer.drawnDistance -
				inner.drawnRadius / inner.drawnDistance,
		) <=
			EPS *
				Math.max(
					outer.drawnRadius / outer.drawnDistance,
					inner.drawnRadius / inner.drawnDistance,
				),
	);
}

// Node #1017: scale the same surface and camera together. Apparent size can
// stay continuous while the shader's terrain slopes change with render units.
// Hold geometry, sun, clock and shader path fixed so only those units differ.
const relief = await page.evaluate(async () => {
	const THREE = await import("/node_modules/.vite/deps/three.js");
	const { buildBodyVisual, surfaceSphere } = await import(
		"/src/planet-surface.ts"
	);
	const { FAR_SCALE, APPROACH_SCALE } = await import("/src/units.ts");
	const body = window.__seelite.world.system.bodies.find(
		(b) => b.id === "planet-2",
	);
	if (body?.appearance?.surface !== "desert")
		throw new Error("node #1017 fixture must be ABITI III, a desert planet");
	const renderer = new THREE.WebGLRenderer();
	const size = 320;
	renderer.setSize(size, size);
	const target = new THREE.WebGLRenderTarget(size, size);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(60, 1, 0.0001, 1e6);
	// ABITI III's appearance; a second radius prevents a constant calibrated for one
	// world from passing. Both sides use the production desert program.
	const visual = buildBodyVisual(body.appearance, surfaceSphere("approach"));
	for (const shell of visual.group.children)
		shell.visible = shell === visual.surfaceMesh;
	scene.add(visual.group);
	const read = (radius, scale, path) => {
		visual.setSurfacePath(path);
		visual.group.scale.setScalar(radius * scale);
		camera.position.set(0, 0, 3 * radius * scale);
		renderer.setRenderTarget(target);
		renderer.render(scene, camera);
		const pixels = new Uint8Array(size * size * 4);
		renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
		return pixels;
	};
	// Centre patch avoids tessellation/silhouette coverage and derivative helper
	// lanes. It still contains thousands of painted terrain pixels.
	const difference = (a, b) => {
		let sum = 0;
		let count = 0;
		for (let y = 110; y < 210; y++)
			for (let x = 110; x < 210; x++)
				for (let c = 0; c < 3; c++) {
					sum += Math.abs(
						a[(y * size + x) * 4 + c] - b[(y * size + x) * 4 + c],
					);
					count++;
				}
		return sum / count;
	};
	try {
		return [body.radiusKm, 20000].map((radius) => {
			const far = read(radius, FAR_SCALE, "screen-space");
			const approach = read(radius, APPROACH_SCALE, "screen-space");
			const flat = read(radius, APPROACH_SCALE, "none");
			return {
				radius,
				delta: difference(far, approach),
				repeat: difference(
					approach,
					read(radius, APPROACH_SCALE, "screen-space"),
				),
				detail: difference(approach, flat),
			};
		});
	} finally {
		visual.dispose();
		target.dispose();
		renderer.dispose();
	}
});
for (const row of relief) {
	console.log("relief layer comparison", JSON.stringify(row));
	check(
		`${row.radius} km: repeated terrain is deterministic`,
		row.repeat === 0,
	);
	check(
		`${row.radius} km: relief survives the approach scale`,
		row.detail > 0.5,
	);
	// Allow sub-code float32 roundoff, not a visible change in terrain shading.
	check(
		`${row.radius} km: terrain is independent of layer scale`,
		row.delta < 0.1,
	);
}
await browser.close();
exit();
