import {
	bootedGame,
	guardedOrigin,
	installCamSim,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const PAGE_URL = process.env.PROBE_URL ?? ORIGIN + "/?seed=1";
const EPS = 0.005;
await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
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
await browser.close();
exit();
