import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import { waitForStationDetail } from "../../scripts/lib/station-detail.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const OUT = process.argv[2] ?? "spikes/station-scale/out";
const release = await holdProbeLockOrExit("station-scale-capture");
const PORT = 5191;
const server = await createServer({
	cacheDir: "node_modules/.vite-station-scale",
	server: { host: "127.0.0.1", port: PORT, strictPort: true },
});
await server.listen();
const origin = `http://127.0.0.1:${PORT}`;
await guardedOrigin(origin);
await mkdir(OUT, { recursive: true });

const SHOTS = [
	{ name: "01-cockpit", view: "cockpit", ship: [1.2, 0, 0] },
	{ name: "02-chase", view: "chase", ship: [0.6, 0, 0] },
	{
		name: "03-face-close",
		ship: [0.25, 0.12, 0.05],
		cam: [0.6, 0.05, 0.12],
		look: "ship-face",
		fov: 50,
	},
	{
		name: "04-wide",
		ship: [0.3, 0.25, 0.1],
		cam: [2.2, -1.6, 0.9],
		look: "station",
		fov: 50,
	},
	{
		name: "06-hero",
		ship: [0.12, 0.18, -0.06],
		cam: [0.55, 0.42, 0.1],
		look: "station",
		fov: 45,
	},
	{
		name: "05-wide-tele",
		ship: [0.3, 0.25, 0.1],
		cam: [7.3, -5.3, 3.0],
		look: "station",
		fov: 16,
	},
	{ name: "07-sun-wide", sun: { ship: 0.75, cam: 2.4, off: 0.9 }, fov: 45 },
	{ name: "08-sun-close", sun: { ship: 0.7, cam: 1.15, off: 0.35 }, fov: 50 },
];
const SHIP_SCALES = (process.env.SCALES ?? "1,0.25").split(",").map(Number);
const STATION_TYPES = (process.env.TYPES ?? "trade,refinery").split(",");
const SYSTEM = Number(process.env.SYSTEM ?? 4);
const FORM = process.env.FORM ?? "a";
const ONLY = process.env.ONLY?.split(",");
const CLEAN = process.env.CLEAN === "1";
const LIGHT = Object.fromEntries(
	(process.env.LIGHT ?? "")
		.split(",")
		.filter(Boolean)
		.map((kv) => {
			const [k, v] = kv.split(":");
			return [k, Number(v)];
		}),
);

const browser = await launchChromium({ headless: false });
const report = [];
try {
	const page = await browser.newPage({
		viewport: { width: 1600, height: 900 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error" && /shader|program/i.test(m.text()))
			errors.push(m.text().slice(0, 300));
	});
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: 42,
 "models-full": true,
			system: SYSTEM,
			"no-save": true,
			"coriolis-start": "approach",
			raider: "off",
		}),
	);
	await bootedGame(page, 120000);
	await page.waitForFunction(() => window.__seelite.modelsSettled());
	const meta = await page.evaluate(() => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.setThrottle(0);
		const gl = g.renderer.getContext();
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		return {
			renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
			station: g.targetId,
			hull: g.flownHull,
		};
	});
	if (/swiftshader|llvmpipe|software/i.test(meta.renderer))
		throw Error(`hardware renderer required, got ${meta.renderer}`);
	console.log(JSON.stringify(meta));
	await page.evaluate((light) => {
		const g = window.__seelite;
		for (const rig of g.layerLights) {
			if (light.sun) rig.sun.intensity *= light.sun;
			if (light.hemi) rig.hemisphere.intensity *= light.hemi;
		}
		if (light.rim !== undefined)
			g.nearScene.traverse((o) => {
				const r = o.material?.userData?.coriolisRim;
				if (r) r.value = light.rim;
			});
		if (light.beacon)
			for (const scene of [g.nearScene, g.approachScene])
				scene.traverse((o) => {
					const m = o.material;
					if (m && /^navigation-(red|green)$/.test(m.name))
						m.emissiveIntensity *= light.beacon;
				});
	}, LIGHT);
	if (CLEAN)
		await page.evaluate(() => {
			for (const el of document.querySelectorAll("body *"))
				if (!(el instanceof HTMLCanvasElement) && !el.querySelector("canvas"))
					el.style.visibility = "hidden";
		});

	for (const type of STATION_TYPES)
		for (const scale of SHIP_SCALES) {
			for (const shot of SHOTS) {
				if (!shot.cam && !shot.sun && scale !== 1) continue;
				if (ONLY && !ONLY.includes(shot.name)) continue;
				const got = await page.evaluate(
					([shot, scale, type, form]) => {
						const g = window.__seelite;
						const station = g.world.system.contents.stations.find(
							(s) => s.type === type && (type !== "trade" || s.formId === form),
						);
						if (!station) throw Error(`no ${type} station`);
						const id = station.id;
						g.targetId = id;
						const body = g.world.system.byId.get(id);
						const snap = g.dockingSnapshot(id);
						const axis = snap.axis;
						const norm = (v) => {
							const l = Math.hypot(v.x, v.y, v.z);
							return { x: v.x / l, y: v.y / l, z: v.z / l };
						};
						const cross = (a, b) => ({
							x: a.y * b.z - a.z * b.y,
							y: a.z * b.x - a.x * b.z,
							z: a.x * b.y - a.y * b.x,
						});
						const add = (p, v, s) => ({
							x: p.x + v.x * s,
							y: p.y + v.y * s,
							z: p.z + v.z * s,
						});
						const sub = (a, b) => ({
							x: a.x - b.x,
							y: a.y - b.y,
							z: a.z - b.z,
						});
						const a = norm(axis);
						const side = norm(
							cross(
								a,
								Math.abs(a.y) < 0.9
									? { x: 0, y: 1, z: 0 }
									: { x: 1, y: 0, z: 0 },
							),
						);
						const up = norm(cross(side, a));
						const at = ([ax, sd, u], from) =>
							add(add(add(from, a, snap.planeKm + ax), side, sd), up, u);
						const sp = g.layerLights[0].sun.position;
						const toSun = norm({ x: sp.x, y: sp.y, z: sp.z });
						const sunSide = norm(cross(toSun, up));
						const sunCam = shot.sun
							? add(
									add(
										add(body.pos, toSun, shot.sun.cam),
										sunSide,
										shot.sun.off,
									),
									up,
									shot.sun.off * 0.5,
								)
							: null;
						g.world.ship.pos = shot.sun
							? add(add(body.pos, toSun, shot.sun.ship), sunSide, 0.08)
							: at(shot.ship, body.pos);
						g.world.ship.vel = g.stationVelocity(id);
						g.setAttitude({ x: -a.x, y: -a.y, z: -a.z }, snap.basis.up);
						g.shipMesh.scale.setScalar(scale);
						const fov = shot.fov ?? 60;
						for (const c of [
							g.backdropCamera,
							g.farCamera,
							g.approachCamera,
							g.nearCamera,
							g.cabinCamera,
						]) {
							c.fov = fov;
							c.updateProjectionMatrix();
						}
						if (shot.cam || shot.sun) {
							g.view = "chase";
							const pos = sunCam ?? at(shot.cam, body.pos);
							const target =
								shot.look === "station" || shot.sun
									? add(body.pos, a, snap.planeKm * 0.3)
									: add(g.world.ship.pos, a, -0.25);
							g.openingCamera = () => ({
								pos,
								forward: norm(sub(target, pos)),
								up,
							});
						} else {
							delete g.openingCamera;
							g.view = shot.view;
						}
						g.render(0);
						g.render(0);
						const cam = sunCam ?? (shot.cam ? at(shot.cam, body.pos) : null);
						return {
							shipToStationKm: Math.hypot(
								...Object.values(sub(g.world.ship.pos, body.pos)),
							),
							camToShipKm: cam
								? Math.hypot(...Object.values(sub(g.world.ship.pos, cam)))
								: null,
							camToStationKm: cam
								? Math.hypot(...Object.values(sub(body.pos, cam)))
								: null,
							planeKm: snap.planeKm,
						};
					},
					[shot, scale, type, FORM],
				);
				await page.waitForTimeout(600);
				await waitForStationDetail(page);
				got.detail = await page.evaluate((type) => {
					const station = window.__seelite.world.system.contents.stations.find(s => s.type === type);
					const parts = [];
					window.__meshOfBody(station.id).traverse(o => {
						if (o.isMesh && o.name.startsWith("scale-detail")) parts.push({ name: o.name, visible: o.visible });
					});
					return parts;
				}, type);
				if (process.env.EXPECT_RING_DETAIL !== undefined &&
					(got.detail.length !== Number(process.env.EXPECT_RING_DETAIL) || got.detail.some(o => !o.visible)))
					throw Error(`unsettled Ring capture: ${JSON.stringify(got.detail)}`);
				await page.evaluate(() => window.__seelite.render(0));
				const file = `${OUT}/${type}${FORM === "a" ? "" : `-${FORM}`}-${shot.name}${scale === 1 ? "" : "-ship-quarter"}.png`;
				await page.screenshot({ path: file });
				for (const rim of (process.env.RIM_SWEEP ?? "")
					.split(",")
					.filter(Boolean)) {
					await page.evaluate((value) => {
						const g = window.__seelite;
						g.nearScene.traverse((o) => {
							const r = o.material?.userData?.coriolisRim;
							if (r) r.value = value;
						});
						g.render(0);
					}, Number(rim));
					await page.waitForTimeout(300);
					await page.screenshot({
						path: file.replace(".png", `-rim${rim}.png`),
					});
				}
				report.push({ file, type, scale, ...got });
				console.log(file, JSON.stringify(got));
			}
		}
	if (errors.length) throw Error(errors.join("\n"));
	await writeFile(
		`${OUT}/report.json`,
		JSON.stringify({ meta, report }, null, 2),
	);
} finally {
	await browser.close();
	await server.close();
	release();
}
