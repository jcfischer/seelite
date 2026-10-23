/**
 * Node #947: the authored shipyards' LOD policy, from measurement. Method, arms
 * and results: docs/receipts/node-947-shipyard-lod-policy.md
 * https://github.com/jcfischer/seelite/issues/947
 *
 *   SEELITE_PROBE_RENDERER=hardware MODE=cost node scripts/measure-shipyard-lod.mjs
 *   MODE=cost|pop|shots|install|levels  FORMS=a,b,c  VIEWS=close,edge  QUALITY=high|low
 *   ARMSET=base|amp AMP=6  BLOCKS=10 FRAMES=60 ORDER_SEED=20261022 OUT=<dir>
 */
import { createServer } from "vite";
import { loadavg } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler, separation } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const MODE = process.env.MODE ?? "cost";
const FRAMES = Number(process.env.FRAMES ?? 90);
const BLOCKS = Number(process.env.BLOCKS ?? 10);
const DIST_FRAMES = Number(process.env.DIST_FRAMES ?? 240);
const RUNS = Number(process.env.RUNS ?? 3);
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 20261022);
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5207);
const WORLD = 42;
const FIXTURES = { a: 7, b: 9, c: 1 };
const YARD_NAMES = { a: "gantry", b: "foundry", c: "slipway" };
const FORMS = (process.env.FORMS ?? "a,b,c").split(",");
const OUT = process.env.OUT ?? "probe-shots/shipyard-lod";
const QUALITY = process.env.QUALITY ?? "high";
const KEEP_ALL = process.env.KEEP_ALL === "1";
const KEEP_PAIRS = new Set(["p1", "p3", "p4", "p6"]);
const KEEP_KINDS = new Set(["a", "b", "a4", "b4", "diff4"]);
const AMP = Number(process.env.AMP ?? 6);
const ARMSET = process.env.ARMSET ?? "base";
if (!["base", "amp"].includes(ARMSET)) throw new Error("ARMSET is base or amp");
const LEVELS = (process.env.LEVELS ?? "lod1=40:0.5,lod2=400:0.5,lodc=40:2")
	.split(",")
	.map((spec) => {
		const [name, rest] = spec.split("=");
		const [radii, pixels] = rest.split(":").map(Number);
		return { name, radii, pixels };
	});
const VIEW_DEFS = {
	close: { sun: 35, radii: 2, pin: true },
	approach: { axis: true, radii: 6, pin: true },
	mid: { sun: 35, radii: 15, pin: true },
	edge: { sun: 35, radii: 41, pin: false },
	far100: { sun: 35, radii: 100, pin: false },
	far420: { sun: 35, radii: 420, pin: false },
	far1000: { sun: 35, radii: 1000, pin: false },
	mouth: { axis: true, rangeKm: "mouth", pin: true },
	bay: { bay: true, pin: true },
	traffic: { axis: true, radii: 6, pin: true, traffic: true },
};
const VIEWS = (
	process.env.VIEWS ??
	"close,approach,mid,edge,far100,far420,far1000,mouth,bay,traffic"
).split(",");
for (const v of VIEWS) if (!VIEW_DEFS[v]) throw new Error(`unknown view ${v}`);
const DETAIL = { full: 40, reduced: 400 };

const releaseLock = await holdProbeLockOrExit("shipyard lod");
console.log("  host load average at start:", loadavg().join(" / "));
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-shipyard-947",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });

const SETUP = async ({ form, levels, quality, amp, armset }) => {
	const g = window.__seelite;
	g.clockHeld = true;
	g.settings.set("quality", quality);
	g.clearTrafficPresentation();
	g.trafficSystemIndex = g.world.system.record.index;
	g.trafficActors = [];
	g.trafficInbound = [];
	const THREE_V = g.nearScene.position.constructor;
	const sm = await import("/src/station-mesh.ts");
	const sf = await import("/src/shipyard-flight.ts");
	const lv = await import("/scripts/lib/shipyard-levels.ts");
	const al = await import("/src/authored-levels.ts");
	const { markOcclusion } = await import("/src/occlusion-mesh.ts");
	const station = g.world.system.contents.stations.find(
		(s) => s.type === "shipyard",
	);
	if (!station || station.formId !== form)
		throw new Error(`fixture system has no shipyard form ${form}`);
	const body = g.world.system.bodies.find((b) => b.id === station.id);
	const urls = await import("/src/model-urls.ts");
	const phases = {};
	let t0 = performance.now();
	const bytes = await (await fetch(urls.SHIPYARD_GLB_URLS[form])).arrayBuffer();
	phases.fetchMs = performance.now() - t0;
	phases.glbBytes = bytes.byteLength;
	t0 = performance.now();
	const assets = await sf.loadShipyardAssets(form);
	const loadMs = performance.now() - t0;
	phases.loadMs = loadMs;
	t0 = performance.now();
	if (assets.lightmap) sf.applyShipyardLightmap(assets.scene, assets.lightmap);
	phases.lightmapApplyMs = performance.now() - t0;
	const builders = {};
	t0 = performance.now();
	const full = sf.createShipyardBuilder(form, assets.scene);
	phases.builderMs = performance.now() - t0;
	builders.full = full;
	t0 = performance.now();
	const probeBuild = full(station.berthSeed, body.color);
	phases.firstBuildMs = performance.now() - t0;
	t0 = performance.now();
	await g.prewarmStationPrograms(probeBuild.root);
	phases.prewarmMs = performance.now() - t0;
	const texture = assets.lightmap?.image;
	phases.lightmap = texture
		? { width: texture.width, height: texture.height }
		: null;
	const silhouetteKm = g.stationVisuals.get(station.id).silhouetteKm;
	const reduced = {};
	for (const level of levels) {
		const errorM =
			al.halfPixelKm(level.radii, silhouetteKm) * 1000 * (level.pixels / 0.5);
		const started = performance.now();
		const template = lv.reducedYard(assets.scene, errorM, level.name);
		reduced[level.name] = { errorM, ms: performance.now() - started, template };
		builders[level.name] = sf.createShipyardBuilder(form, template);
	}
	const roots = {};
	const buildBase = (arm) => {
		let mesh;
		if (arm === "standin") {
			sm.installShipyardBuilder(form, null);
			try {
				mesh = sm.buildStationMesh(station, body.color);
			} finally {
				sm.installShipyardBuilder(form, full);
			}
		} else if (arm === "none") {
			const proto = g.stationVisuals.get(station.id);
			mesh = {
				...proto,
				root: new g.shipMesh.constructor(),
				spinner: new g.shipMesh.constructor(),
				fixtures: [],
				accessories: [],
				nameplates: [],
				greebles: [],
				dispose: () => {},
			};
		} else
			mesh = builders[arm === "control" ? "full" : arm](
				station.berthSeed,
				body.color,
			);
		mesh.root.name = body.id;
		markOcclusion(mesh.root);
		return mesh;
	};
	const build = (arm) => {
		const [base, times] = arm.split("x");
		const mesh = buildBase(base);
		const copies = Number(times ?? 1);
		const radiusKm = body.radiusKm;
		for (let k = 1; k < copies; k++) {
			const extra = buildBase(base);
			extra.root.name = `${body.id}-copy${k}`;
			const side = k % 2 ? 1 : -1;
			extra.root.position.x =
				(side * Math.ceil(k / 2) * 2.4 * silhouetteKm) / radiusKm;
			mesh.root.add(extra.root);
		}
		return mesh;
	};
	const arms =
		armset === "amp"
			? [
					"none",
					"control",
					"full",
					`standinx${amp}`,
					`fullx${amp}`,
					...levels.map((l) => `${l.name}x${amp}`),
				]
			: ["none", "standin", "full", "control", ...levels.map((l) => l.name)];
	for (const arm of arms) roots[arm] = build(arm);
	const live = g.stationVisuals.get(station.id);
	window.__census = (arm) => {
		let meshes = 0;
		let groups = 0;
		roots[arm].root.traverse((o) => {
			if (!o.isMesh) return;
			meshes++;
			groups += Array.isArray(o.material)
				? Math.max(1, o.geometry.groups.length)
				: 1;
		});
		return { meshes, groups };
	};
	window.__setDetail = (arm, level) => sm.setStationDetail(roots[arm], level);
	window.__arm = (arm) => {
		const current = g.stationVisuals.get(station.id);
		current.root.removeFromParent();
		const next = roots[arm];
		g.stationVisuals.set(station.id, next);
		g.meshes.set(station.id, next.root);
		g.setLayer(body, g.layers.get(station.id) ?? "far");
	};
	live.root.removeFromParent();
	window.__form = form;
	window.__stationId = station.id;
	window.__silhouetteKm = silhouetteKm;
	window.__fleet = (on) => {
		const group = window.__fleetGroup;
		if (group) group.removeFromParent();
		if (on) g.nearScene.add(group);
	};
	const hulls = await import("/src/ship-mesh.ts");
	await g.loadAuthoredHullsAfterBoot();
	window.__buildFleet = () => {
		const camera = g.nearCamera;
		g.render(0);
		camera.updateMatrixWorld(true);
		const eye = camera.getWorldPosition(new THREE_V());
		const basis = (x, y, z) =>
			new THREE_V(x, y, z).transformDirection(camera.matrixWorld);
		const forward = basis(0, 0, -1);
		const right = basis(1, 0, 0);
		const up = basis(0, 1, 0);
		const SLOTS = [
			[-0.35, 0.1, 0.35],
			[0.35, 0.1, 0.35],
			[-0.18, -0.14, 0.7],
			[0.18, -0.14, 0.7],
		];
		const group = new g.shipMesh.constructor();
		group.name = "traffic-fleet";
		for (const [across, high, range] of SLOTS) {
			const hull = hulls.buildShipMesh("courier", "a").root;
			markOcclusion(hull);
			const at = eye
				.clone()
				.addScaledVector(forward, range)
				.addScaledVector(right, across * range)
				.addScaledVector(up, high * range);
			hull.position.copy(at);
			hulls.updateShipVisuals(hull, at.distanceTo(eye), "high");
			group.add(hull);
		}
		window.__fleetGroup = group;
	};
	const textures = new Set();
	assets.scene.traverse((o) => {
		if (!o.isMesh) return;
		for (const m of Array.isArray(o.material) ? o.material : [o.material])
			for (const value of Object.values(m))
				if (value?.isTexture) textures.add(value);
	});
	if (assets.lightmap) textures.add(assets.lightmap);
	let textureBytes = 0;
	for (const t of textures) {
		const img = t.image;
		if (img?.width) textureBytes += img.width * img.height * 4 * (4 / 3);
	}
	t0 = performance.now();
	for (const t of textures) g.renderer.initTexture(t);
	phases.textureUploadMs = performance.now() - t0;
	phases.textures = {
		count: textures.size,
		estimatedGpuMiB: textureBytes / 1048576,
	};
	const firstDraw = {};
	const gl = g.renderer.getContext();
	const sync = new Uint8Array(4);
	g.setOcclusion(false, false);
	for (const arm of ["full", ...levels.map((l) => l.name), "standin"]) {
		window.__arm(arm);
		const started = performance.now();
		g.render(0);
		gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
		firstDraw[arm] = performance.now() - started;
	}
	phases.firstDrawMs = firstDraw;
	return {
		phases,
		loadMs,
		silhouetteKm,
		arms,
		reduced: Object.fromEntries(
			Object.entries(reduced).map(([k, v]) => [
				k,
				{
					errorM: v.errorM,
					ms: v.ms,
					reachedM: v.template.userData.yardLevelReachedErrorM,
				},
			]),
		),
	};
};

const PLACE = async ({ def, silhouetteKm, id }) => {
	const g = window.__seelite;
	const radiusKm = window.__radiusOf(id);
	const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
	if (def.bay) {
		const pose = g.poseOfStation(id);
		const body = g.world.system.bodies.find((b) => b.id === id);
		const geometry = (await import("/src/station.ts")).STATION_GEOMETRY
			.shipyard;
		const bay = (await import("/src/station-interior.ts")).stationInterior(
			"shipyard",
			geometry.aperturePlaneKm,
		);
		const axial = (bay.mouthAxialKm + bay.endAxialKm) / 2;
		await window.__placeShipAt(
			{
				x: body.pos.x + pose.axis.x * axial,
				y: body.pos.y + pose.axis.y * axial,
				z: body.pos.z + pose.axis.z * axial,
			},
			g.stationVelocity(id),
		);
		const from = g.nearScene.position.clone().set(0, 0, -1);
		const to = g.nearScene.position
			.clone()
			.set(pose.axis.x, pose.axis.y, pose.axis.z);
		g.orientation.setFromUnitVectors(from, to);
		await frame();
		return { rangeKm: Math.abs(axial) };
	}
	if (def.axis) {
		const geometry = (await import("/src/station.ts")).STATION_GEOMETRY
			.shipyard;
		const rangeKm =
			def.rangeKm === "mouth"
				? geometry.aperturePlaneKm + 0.4
				: def.radii * silhouetteKm;
		const framing = await window.__viewAlongAxis(id, rangeKm);
		return { rangeKm: framing.actualKm, offAxisDeg: framing.offAxisDeg };
	}
	const body = g.world.system.bodies.find((b) => b.id === id);
	await window.__sunOffset(id, (def.radii * silhouetteKm) / radiusKm, def.sun);
	const p = g.world.ship.pos;
	return {
		rangeKm: Math.hypot(p.x - body.pos.x, p.y - body.pos.y, p.z - body.pos.z),
	};
};

try {
	if (MODE === "cost") for (const form of FORMS) await costForm(form);
	else if (MODE === "shots") for (const form of FORMS) await shotsForm(form);
	else if (MODE === "frames") for (const form of FORMS) await framesForm(form);
	else if (MODE === "bayposes") for (const form of FORMS) await bayPoses(form);
	else if (MODE === "pop") for (const form of FORMS) await popForm(form);
	else if (MODE === "install")
		for (const form of FORMS) await installForm(form);
	else if (MODE === "levels") for (const form of FORMS) await levelsForm(form);
	else
		throw new Error(
			`MODE must be cost, pop, shots, frames, bayposes, install or levels, not ${MODE}`,
		);
} finally {
	await browser.close();
	await server.close();
	console.log("  host load average at end:", loadavg().join(" / "));
	releaseLock();
}

async function openForm(form) {
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
	});
	page.on("pageerror", (e) => console.error("  pageerror:", e.message));
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(
		gameUrl(origin, {
			seed: WORLD,
			system: FIXTURES[form],
			"no-save": true,
			"models-full": true,
		}),
	);
	await bootedGame(page, 180000);
	const renderer = await assertPlayersRenderer(page, "measure");
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 180000,
		},
	);
	const setup = await page.evaluate(SETUP, {
		form,
		levels: LEVELS,
		quality: QUALITY,
		amp: AMP,
		armset: ARMSET,
	});
	return { page, renderer, setup };
}

async function costForm(form) {
	const { page, renderer, setup } = await openForm(form);
	const ARMS = setup.arms;
	console.log(
		`\n=== form ${form}, system ${FIXTURES[form]} of world ${WORLD} ===`,
	);
	console.log(
		`  phases (warm HTTP cache, this page): ${JSON.stringify(setup.phases)}`,
	);
	console.log(`  renderer: ${renderer}`);
	console.log(
		`  viewport ${VIEWPORT.width}x${VIEWPORT.height} at device scale 2, cockpit view, quality ${QUALITY}, clock held`,
	);
	console.log(
		`  ${BLOCKS} blocks per arm, ${FRAMES} frames per block, order shuffled from seed ${ORDER_SEED}; silhouette ${setup.silhouetteKm} km`,
	);
	for (const [name, r] of Object.entries(setup.reduced))
		console.log(
			`  ${name}: target ${r.errorM.toFixed(1)} m (reached ${r.reachedM.toFixed(1)} m), made in ${r.ms.toFixed(0)} ms`,
		);
	const id = await page.evaluate(() => window.__stationId);
	const timed = (arm, pin, frames) =>
		page.evaluate(
			([a, p, n]) => {
				const g = window.__seelite;
				const gl = g.renderer.getContext();
				window.__arm(a);
				g.setOcclusion(p, p);
				const sync = new Uint8Array(4);
				g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const started = performance.now();
				for (let i = 0; i < n; i++) g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				return (performance.now() - started) / n;
			},
			[arm, pin, frames],
		);
	const single = (arm, pin, frames) =>
		page.evaluate(
			([a, p, n]) => {
				const g = window.__seelite;
				const gl = g.renderer.getContext();
				window.__arm(a);
				g.setOcclusion(p, p);
				const sync = new Uint8Array(4);
				g.render(0);
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const out = [];
				for (let i = 0; i < n; i++) {
					const s = performance.now();
					g.render(0);
					gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
					out.push(performance.now() - s);
				}
				return out;
			},
			[arm, pin, frames],
		);
	const info = (arm, pin) =>
		page.evaluate(
			([a, p]) => {
				const g = window.__seelite;
				window.__arm(a);
				g.setOcclusion(p, p);
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
				const passes = [];
				const original = r.render.bind(r);
				r.render = (scene, camera) => {
					const calls = r.info.render.calls;
					const triangles = r.info.render.triangles;
					original(scene, camera);
					passes.push(
						`${scene.name || scene.type}${r.getRenderTarget() ? "*" : ""}:${r.info.render.calls - calls}/${r.info.render.triangles - triangles}`,
					);
				};
				r.info.reset();
				g.render(0);
				r.render = original;
				out.passes = passes.filter((x) => !/:0\/0$/.test(x)).join(" ");
				r.info.autoReset = auto;
				return out;
			},
			[arm, pin],
		);
	const shuffled = seededShuffler(ORDER_SEED);
	const quantile = (xs, q) => {
		const s = [...xs].sort((a, b) => a - b);
		return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
	};
	for (const view of VIEWS) {
		const def = VIEW_DEFS[view];
		await page.evaluate(() => window.__fleet(false));
		await page.evaluate(() => window.__arm("full"));
		const placed = await page.evaluate(PLACE, {
			def,
			silhouetteKm: setup.silhouetteKm,
			id,
		});
		if (def.traffic) {
			await page.evaluate(() => {
				window.__buildFleet();
				window.__fleet(true);
			});
		}
		const radii = placed.rangeKm / setup.silhouetteKm;
		const level =
			radii <= DETAIL.full ? "full" : radii <= DETAIL.reduced ? "lod1" : "lod2";
		const blocks = Object.fromEntries(ARMS.map((a) => [a, []]));
		for (const arm of ARMS) await timed(arm, def.pin, FRAMES);
		for (let b = 0; b < BLOCKS; b++)
			for (const arm of shuffled(ARMS))
				blocks[arm].push(await timed(arm, def.pin, FRAMES));
		const counts = {};
		for (const arm of ARMS) {
			counts[arm] = await info(arm, def.pin);
			counts[arm].census = await page.evaluate((a) => window.__census(a), arm);
		}
		const dist = Object.fromEntries(ARMS.map((a) => [a, []]));
		const chunks = 12;
		const per = Math.max(5, Math.round(DIST_FRAMES / chunks));
		for (let c = 0; c < chunks; c++)
			for (const arm of shuffled(ARMS))
				dist[arm].push(...(await single(arm, def.pin, per)));
		console.log(
			`\n  view ${view}: ${placed.rangeKm.toFixed(3)} km = ${radii.toFixed(1)} silhouette radii; band names ${level}; occlusion ${def.pin ? "on (pinned)" : "off (pinned)"}`,
		);
		console.log(
			"  arm         ms/frame   Δ vs none          Δ vs full          per yard   calls  triangles  meshes",
		);
		const sign = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(3)}`;
		for (const arm of ARMS) {
			const copies = Number(arm.split("x")[1] ?? 1);
			const ref = copies > 1 ? `fullx${copies}` : "full";
			const d = median(blocks[arm]) - median(blocks.none);
			const f = median(blocks[arm]) - median(blocks[ref]);
			const none = arm === "none";
			const isRef = arm === ref;
			console.log(
				`  ${arm.padEnd(10)} ${median(blocks[arm]).toFixed(3).padStart(8)}  ${
					none
						? "".padEnd(17)
						: `${sign(d)} ${separation(blocks[arm], blocks.none)}`.padEnd(17)
				}  ${
					none || isRef
						? "".padEnd(17)
						: `${sign(f)} ${separation(blocks[arm], blocks[ref])}`.padEnd(17)
				}  ${none ? "".padStart(8) : sign(d / copies).padStart(8)}  ${String(counts[arm].calls).padStart(5)}  ${String(counts[arm].triangles).padStart(9)}  ${String(counts[arm].census.meshes).padStart(6)}`,
			);
		}
		console.log(
			`  passes (calls/triangles; * = offscreen target), full: ${counts.full.passes}`,
		);
		for (const [arm, xs] of Object.entries(dist))
			console.log(
				`  single frames, ${arm.padEnd(10)} n=${xs.length}  p50 ${quantile(xs, 0.5).toFixed(2)}  p95 ${quantile(xs, 0.95).toFixed(2)}  p99 ${quantile(xs, 0.99).toFixed(2)}  max ${Math.max(...xs).toFixed(2)} ms`,
			);
	}
	await page.close();
}

async function popForm(form) {
	mkdirSync(OUT, { recursive: true });
	const { page, renderer, setup } = await openForm(form);
	const id = await page.evaluate(() => window.__stationId);
	console.log(`\n=== form ${form}: transitions, ${renderer} ===`);
	console.log(
		"  a pair is (arm A, arm B) at one range and sun angle, both arms forced to the stated band state and checked after the render",
	);
	const PAIRS = [
		{
			tag: "p1",
			note: "lod1 nearest (inbound hold), accessories reduced",
			a: ["full", "reduced"],
			b: ["lod1", "reduced"],
			radii: 40.2,
		},
		{
			tag: "p2",
			note: "Full farthest (outbound hold), accessories full",
			a: ["full", "full"],
			b: ["lod1", "full"],
			radii: 41.9,
		},
		{
			tag: "p3",
			note: "the outbound switch itself, Full to lod1",
			a: ["full", "full"],
			b: ["lod1", "reduced"],
			radii: 42.0,
		},
		{
			tag: "p4",
			note: "lod2 nearest (inbound), against Full",
			a: ["full", "outline"],
			b: ["lod2", "outline"],
			radii: 401,
		},
		{
			tag: "p5",
			note: "lod1 farthest (outbound hold), lod1 against lod2",
			a: ["lod1", "reduced"],
			b: ["lod2", "reduced"],
			radii: 419.5,
		},
		{
			tag: "p6",
			note: "the outbound switch itself, lod1 to lod2",
			a: ["lod1", "reduced"],
			b: ["lod2", "outline"],
			radii: 419.9,
		},
	];
	const SUNS = [35, 100, 170];
	console.log(
		"  pair  A           B           radii  sun  footprint px  control  moved A→B  of footprint  B only  mean |Δ| code  luma A→B   note",
	);
	for (const pair of PAIRS)
		for (const sun of SUNS) {
			await page.evaluate(() => window.__arm("full"));
			const placed = await page.evaluate(PLACE, {
				def: { sun, radii: pair.radii },
				silhouetteKm: setup.silhouetteKm,
				id,
			});
			const out = await page.evaluate(
				async ([a, b]) => {
					const g = window.__seelite;
					g.setOcclusion(false, false);
					const gl = g.renderer.getContext();
					const w = gl.drawingBufferWidth;
					const h = gl.drawingBufferHeight;
					const camera = g.nearCamera;
					const body = g.world.system.bodies.find(
						(x) => x.id === window.__stationId,
					);
					const range = Math.hypot(
						g.world.ship.pos.x - body.pos.x,
						g.world.ship.pos.y - body.pos.y,
						g.world.ship.pos.z - body.pos.z,
					);
					const half = Math.ceil(
						((1.4 * window.__silhouetteKm) /
							(2 * range * Math.tan((camera.fov * Math.PI) / 360))) *
							h,
					);
					const x0 = Math.max(0, (w >> 1) - half);
					const y0 = Math.max(0, (h >> 1) - half);
					const side = Math.min(2 * half, w - x0, h - y0);
					const grab = ([arm, detail]) => {
						window.__arm(arm);
						window.__setDetail(arm, detail);
						g.render(0);
						g.render(0);
						const held = g.visualOfStation(window.__stationId).detail;
						if (held !== detail)
							throw new Error(`${arm} drew ${held}, wanted ${detail}`);
						const out = new Uint8Array(side * side * 4);
						gl.readPixels(x0, y0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, out);
						return out;
					};
					const moved = (p, q) => {
						const out = new Uint8Array(p.length / 4);
						for (let i = 0; i < out.length; i++)
							for (let c = 0; c < 3; c++)
								if (Math.abs(p[4 * i + c] - q[4 * i + c]) > 24) out[i] = 1;
						return out;
					};
					const empty = grab(["none", a[1]]);
					const A = grab(a);
					const again = grab(a);
					const B = grab(b);
					const aPrint = moved(empty, A);
					const bPrint = moved(empty, B);
					const control = moved(A, again);
					const popped = moved(A, B);
					let n = 0;
					let c = 0;
					let r = 0;
					let only = 0;
					let sum = 0;
					let lumaA = 0;
					let lumaB = 0;
					for (let i = 0; i < aPrint.length; i++) {
						if (!aPrint[i] && !bPrint[i]) continue;
						n++;
						c += control[i];
						r += popped[i];
						if (!aPrint[i]) only++;
						for (let k = 0; k < 3; k++)
							sum += Math.abs(A[4 * i + k] - B[4 * i + k]);
						lumaA +=
							0.2126 * A[4 * i] + 0.7152 * A[4 * i + 1] + 0.0722 * A[4 * i + 2];
						lumaB +=
							0.2126 * B[4 * i] + 0.7152 * B[4 * i + 1] + 0.0722 * B[4 * i + 2];
					}
					const png = (data, scale) => {
						const image = new ImageData(side, side);
						for (let y = 0; y < side; y++)
							for (let x = 0; x < side; x++) {
								const sIdx = ((side - 1 - y) * side + x) * 4;
								const d = (y * side + x) * 4;
								image.data[d] = data[sIdx];
								image.data[d + 1] = data[sIdx + 1];
								image.data[d + 2] = data[sIdx + 2];
								image.data[d + 3] = 255;
							}
						const tmp = document.createElement("canvas");
						tmp.width = side;
						tmp.height = side;
						tmp.getContext("2d").putImageData(image, 0, 0);
						const canvas = document.createElement("canvas");
						canvas.width = side * scale;
						canvas.height = side * scale;
						const ctx = canvas.getContext("2d");
						ctx.imageSmoothingEnabled = false;
						ctx.drawImage(tmp, 0, 0, side * scale, side * scale);
						return canvas.toDataURL("image/png");
					};
					const diff = new Uint8Array(A.length);
					for (let i = 0; i < A.length / 4; i++) {
						for (let k = 0; k < 3; k++)
							diff[4 * i + k] = Math.min(
								255,
								4 * Math.abs(A[4 * i + k] - B[4 * i + k]),
							);
						diff[4 * i + 3] = 255;
					}
					return {
						n,
						c,
						r,
						only,
						side,
						mean: n ? sum / (3 * n) : 0,
						lumaA: n ? lumaA / n : 0,
						lumaB: n ? lumaB / n : 0,
						shots: {
							a: png(A, 1),
							b: png(B, 1),
							diff: png(diff, 1),
							a4: png(A, 4),
							b4: png(B, 4),
							diff4: png(diff, 4),
						},
					};
				},
				[pair.a, pair.b],
			);
			if (out.n === 0) {
				console.log(
					`  ${pair.tag}    ${pair.a.join("/").padEnd(10)}  ${pair.b.join("/").padEnd(10)}  ${String(pair.radii).padStart(5)}  ${String(sun).padStart(3)}  no pixel of the yard moves 24/255 from the empty frame`,
				);
				continue;
			}
			const tag = `${YARD_NAMES[form]}-${pair.tag}-sun${sun}`;
			const keep = KEEP_ALL || (sun === 35 && KEEP_PAIRS.has(pair.tag));
			for (const [kind, url] of Object.entries(out.shots))
				if (keep && (KEEP_ALL || KEEP_KINDS.has(kind)))
					writeFileSync(
						`${OUT}/${tag}-${kind}.png`,
						Buffer.from(url.split(",")[1], "base64"),
					);
			console.log(
				`  ${pair.tag}    ${pair.a.join("/").padEnd(10)}  ${pair.b.join("/").padEnd(10)}  ${String(pair.radii).padStart(5)}  ${String(sun).padStart(3)}  ${String(out.n).padStart(12)}  ${String(out.c).padStart(7)}  ${String(out.r).padStart(9)}  ${((out.r / out.n) * 100).toFixed(2).padStart(10)}%  ${String(out.only).padStart(6)}  ${out.mean.toFixed(2).padStart(13)}  ${out.lumaA.toFixed(1)}→${out.lumaB.toFixed(1)}  ${pair.note} [${placed.rangeKm.toFixed(1)} km, ${out.side}px box]`,
			);
		}
	await page.close();
}

async function framesForm(form) {
	const { page, renderer, setup } = await openForm(form);
	const id = await page.evaluate(() => window.__stationId);
	console.log(
		`\n=== form ${form}: whole-frame difference from Full, ${renderer} ===`,
	);
	console.log(
		"  view       arm       moved >24/255 of frame px   mean |Δ| code over moved   max |Δ| code     (none = no yard at all)",
	);
	for (const view of VIEWS) {
		const def = VIEW_DEFS[view];
		await page.evaluate(() => window.__arm("full"));
		await page.evaluate(PLACE, {
			def,
			silhouetteKm: setup.silhouetteKm,
			id,
		});
		if (def.traffic) {
			await page.evaluate(() => {
				window.__buildFleet();
				window.__fleet(true);
			});
		}
		const rows = await page.evaluate((pin) => {
			const g = window.__seelite;
			g.setOcclusion(pin, pin);
			const gl = g.renderer.getContext();
			const n = gl.drawingBufferWidth * gl.drawingBufferHeight;
			const grab = (arm) => {
				window.__arm(arm);
				g.render(0);
				g.render(0);
				const out = new Uint8Array(n * 4);
				gl.readPixels(
					0,
					0,
					gl.drawingBufferWidth,
					gl.drawingBufferHeight,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					out,
				);
				return out;
			};
			const full = grab("full");
			const out = [];
			for (const arm of ["control", "lod1", "lod2", "lodc", "none"]) {
				const other = grab(arm);
				let moved = 0;
				let sum = 0;
				let max = 0;
				for (let i = 0; i < n; i++) {
					let worst = 0;
					for (let c = 0; c < 3; c++)
						worst = Math.max(
							worst,
							Math.abs(full[4 * i + c] - other[4 * i + c]),
						);
					if (worst > 24) {
						moved++;
						sum += worst;
					}
					max = Math.max(max, worst);
				}
				out.push({ arm, moved, pixels: n, mean: moved ? sum / moved : 0, max });
			}
			return out;
		}, def.pin);
		for (const r of rows)
			console.log(
				`  ${view.padEnd(9)}  ${r.arm.padEnd(8)}  ${String(r.moved).padStart(9)} of ${r.pixels} (${((100 * r.moved) / r.pixels).toFixed(4)}%)  ${r.mean.toFixed(1).padStart(12)}  ${String(r.max).padStart(10)}`,
			);
	}
	await page.close();
}

async function bayPoses(form) {
	const { page, renderer } = await openForm(form);
	console.log(
		`\n=== form ${form}: inside the bay, Full against each level over many poses, ${renderer} ===`,
	);
	const out = await page.evaluate(async () => {
		const g = window.__seelite;
		const id = window.__stationId;
		const geometry = (await import("/src/station.ts")).STATION_GEOMETRY
			.shipyard;
		const bay = (await import("/src/station-interior.ts")).stationInterior(
			"shipyard",
			geometry.aperturePlaneKm,
		);
		const body = g.world.system.bodies.find((b) => b.id === id);
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
		const gl = g.renderer.getContext();
		const n = gl.drawingBufferWidth * gl.drawingBufferHeight;
		const V = g.nearScene.position.constructor;
		const grab = (arm) => {
			window.__arm(arm);
			g.render(0);
			const buf = new Uint8Array(n * 4);
			gl.readPixels(
				0,
				0,
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				buf,
			);
			return buf;
		};
		const diff = (a, b) => {
			let moved = 0;
			for (let i = 0; i < n; i++)
				for (let c = 0; c < 3; c++)
					if (Math.abs(a[4 * i + c] - b[4 * i + c]) > 24) {
						moved++;
						break;
					}
			return moved;
		};
		g.setOcclusion(true, true);
		const rows = [];
		const pose = g.poseOfStation(id);
		const axis = new V(pose.axis.x, pose.axis.y, pose.axis.z);
		const helper = Math.abs(axis.y) < 0.9 ? new V(0, 1, 0) : new V(1, 0, 0);
		const u = new V().crossVectors(axis, helper).normalize();
		const v = new V().crossVectors(axis, u).normalize();
		const depths = [0.15, 0.5, 0.85];
		const polar = [0, 25, 60, 90, 135, 180];
		const azimuth = [0, 90, 180, 270];
		for (const depth of depths) {
			const axial =
				bay.mouthAxialKm + depth * (bay.endAxialKm - bay.mouthAxialKm);
			for (const theta of polar)
				for (const phi of theta === 0 || theta === 180 ? [0] : azimuth) {
					await window.__placeShipAt(
						{
							x: body.pos.x + axis.x * axial,
							y: body.pos.y + axis.y * axial,
							z: body.pos.z + axis.z * axial,
						},
						g.stationVelocity(id),
					);
					const t = (theta * Math.PI) / 180;
					const f = (phi * Math.PI) / 180;
					const dir = axis
						.clone()
						.multiplyScalar(Math.cos(t))
						.addScaledVector(u, Math.sin(t) * Math.cos(f))
						.addScaledVector(v, Math.sin(t) * Math.sin(f));
					g.orientation.setFromUnitVectors(new V(0, 0, -1), dir.normalize());
					await frame();
					const full = grab("full");
					const row = { depth, theta, phi, depthKm: axial };
					for (const arm of ["lod1", "lod2", "lodc"])
						row[arm] = diff(full, grab(arm));
					rows.push(row);
				}
		}
		return rows;
	});
	let worst = { lod1: 0, lod2: 0, lodc: 0 };
	let nonzero = { lod1: 0, lod2: 0, lodc: 0 };
	for (const r of out)
		for (const arm of ["lod1", "lod2", "lodc"]) {
			worst[arm] = Math.max(worst[arm], r[arm]);
			if (r[arm] > 0) nonzero[arm]++;
		}
	console.log(
		`  ${out.length} poses (3 depths in the bay, polar angle from the aperture axis 0/25/60/90/135/180 degrees, 4 azimuths where it has one), 5184000 px a frame`,
	);
	for (const arm of ["lod1", "lod2", "lodc"])
		console.log(
			`  ${arm}: poses with any pixel moved >24/255: ${nonzero[arm]} of ${out.length}; most pixels moved in one pose: ${worst[arm]}`,
		);
	for (const r of out.filter((x) => x.lod2 > 0 || x.lod1 > 0 || x.lodc > 0))
		console.log(
			`  moved: depth ${r.depth} (${(r.depthKm * 1000).toFixed(0)} m), polar ${r.theta}, azimuth ${r.phi}: lod1 ${r.lod1}, lod2 ${r.lod2}, lodc ${r.lodc}`,
		);
	await page.close();
}

async function shotsForm(form) {
	mkdirSync(OUT, { recursive: true });
	const { page, renderer, setup } = await openForm(form);
	const id = await page.evaluate(() => window.__stationId);
	console.log(`\n=== form ${form}: production frames, ${renderer} ===`);
	const SHOTS = [
		["approach", { axis: true, radii: 6 }],
		["edge41", { sun: 35, radii: 41 }],
	];
	await page.evaluate(() => window.__arm("full"));
	for (const [name, def] of SHOTS) {
		const placed = await page.evaluate(PLACE, {
			def,
			silhouetteKm: setup.silhouetteKm,
			id,
		});
		await page.evaluate(() => {
			window.__seelite.setOcclusion();
			window.__seelite.render(0);
		});
		await page.waitForTimeout(300);
		const file = `${OUT}/${YARD_NAMES[form]}-${name}.jpg`;
		await page.screenshot({
			path: file,
			type: "jpeg",
			quality: 82,
			scale: "css",
		});
		console.log(
			`  ${file}: ${placed.rangeKm.toFixed(1)} km = ${(placed.rangeKm / setup.silhouetteKm).toFixed(1)} radii`,
		);
	}
	await page.evaluate(PLACE, {
		def: { bay: true },
		silhouetteKm: setup.silhouetteKm,
		id,
	});
	for (const arm of ["full", "lod2"]) {
		await page.evaluate((a) => {
			window.__arm(a);
			window.__seelite.setOcclusion();
			window.__seelite.render(0);
		}, arm);
		await page.waitForTimeout(300);
		const file = `${OUT}/${YARD_NAMES[form]}-bay-${arm}.jpg`;
		await page.screenshot({
			path: file,
			type: "jpeg",
			quality: 82,
			scale: "css",
		});
		console.log(`  ${file}`);
	}
	await page.close();
}

async function levelsForm(form) {
	const { page, renderer, setup } = await openForm(form);
	console.log(
		`\n=== form ${form}: what each candidate level is (${renderer}) ===`,
	);
	console.log(
		`  phases (warm HTTP cache, this page): ${JSON.stringify(setup.phases)}`,
	);
	const rows = await page.evaluate(async (levels) => {
		const sf = await import("/src/shipyard-flight.ts");
		const lv = await import("/scripts/lib/shipyard-levels.ts");
		const al = await import("/src/authored-levels.ts");
		const assets = await sf.loadShipyardAssets(window.__form);
		const { measureGenerator } = await import(
			"/scripts/lib/measure-generator.ts"
		);
		const silhouetteKm = window.__silhouetteKm;
		const census = (root) => {
			let meshes = 0;
			let triangles = 0;
			let vertexBytes = 0;
			let indexBytes = 0;
			let uv1 = 0;
			const seen = new Set();
			root.traverse((o) => {
				if (!o.isMesh) return;
				meshes++;
				const geo = o.geometry;
				triangles +=
					(geo.index ? geo.index.count : geo.attributes.position.count) / 3;
				if (geo.index) indexBytes += geo.index.count * 4;
				if (geo.attributes.uv1) uv1++;
				if (seen.has(geo.attributes.position)) return;
				seen.add(geo.attributes.position);
				for (const a of Object.values(geo.attributes))
					vertexBytes += a.count * a.itemSize * 4;
			});
			return { meshes, triangles, vertexBytes, indexBytes, uv1 };
		};
		const out = [
			{
				name: "full",
				...census(assets.scene),
				ms: 0,
				steps: 0,
				worstStepMs: 0,
			},
		];
		for (const level of levels) {
			const errorM =
				al.halfPixelKm(level.radii, silhouetteKm) * 1000 * (level.pixels / 0.5);
			const work = lv.reducedYardSteps(assets.scene, errorM, level.name);
			const { value: root, ms, steps, worstStepMs } = measureGenerator(work);
			out.push({
				name: level.name,
				errorM,
				reachedM: root.userData.yardLevelReachedErrorM,
				...census(root),
				ms,
				steps,
				worstStepMs,
			});
		}
		return out;
	}, LEVELS);
	console.log(
		"  level   target m  reached m  meshes  with uv1  triangles   index KiB  vertex KiB (shared)  make ms  worst step ms",
	);
	for (const r of rows)
		console.log(
			`  ${r.name.padEnd(6)} ${(r.errorM ?? 0).toFixed(1).padStart(9)} ${(r.reachedM ?? 0).toFixed(1).padStart(10)} ${String(r.meshes).padStart(7)} ${String(r.uv1).padStart(9)} ${String(r.triangles).padStart(10)} ${(r.indexBytes / 1024).toFixed(0).padStart(11)} ${(r.vertexBytes / 1024).toFixed(0).padStart(12)} ${r.ms.toFixed(0).padStart(11)} ${r.worstStepMs.toFixed(0).padStart(10)}`,
		);
	await page.close();
}

async function installForm(form) {
	const name = YARD_NAMES[form];
	console.log(`\n=== form ${form}: cold install, ${RUNS} runs ===`);
	for (let run = 0; run < RUNS; run++) {
		const page = await browser.newPage({
			viewport: VIEWPORT,
			deviceScaleFactor: 2,
		});
		page.on("pageerror", (e) => console.error("  pageerror:", e.message));
		await installViewPlacement(page);
		let release;
		let asked;
		let finish;
		const gate = new Promise((r) => {
			release = r;
		});
		const requested = new Promise((r) => {
			asked = r;
		});
		const others = new Promise((r) => {
			finish = r;
		});
		let targetSeen = false;
		const target = new RegExp(`/shipyard-${name}[^/]*\\.glb`);
		await page.route(/\.glb(\?|$)/, async (route) => {
			if (target.test(route.request().url())) {
				targetSeen = true;
				asked();
				await gate;
			} else if (targetSeen) await others;
			await route.continue();
		});
		await page.goto(
			gameUrl(origin, {
				seed: WORLD,
				system: FIXTURES[form],
				"no-save": true,
				"models-full": false,
			}),
		);
		await bootedGame(page, 180000);
		await assertPlayersRenderer(page, "measure");
		await requested;
		await page.evaluate(() => {
			const g = window.__seelite;
			g.clockHeld = true;
			window.__yardId = g.world.system.contents.stations.find(
				(x) => x.type === "shipyard",
			).id;
			window.__gaps = [];
			window.__done = false;
			window.__t0 = performance.now();
			let last = performance.now();
			let swappedAt = null;
			const tick = () => {
				const now = performance.now();
				window.__gaps.push([now - last, now - window.__t0]);
				last = now;
				const mesh = g.stationVisuals.get(window.__yardId);
				if (swappedAt === null && mesh?.root.getObjectByName("shipyard-yard"))
					swappedAt = now;
				if (swappedAt !== null && now - swappedAt > 500) window.__done = true;
				else requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
		const releasedAt = Date.now();
		release();
		await page.waitForFunction(() => window.__done, undefined, {
			timeout: 120000,
		});
		const aimed = await page.evaluate(async () => {
			const g = window.__seelite;
			const kmPerRadius = g.stationVisuals.get(window.__yardId).silhouetteKm;
			await window.__viewAlongAxis(window.__yardId, 6 * kmPerRadius);
			const gaps = [];
			let last = performance.now();
			for (let i = 0; i < 30; i++) {
				await new Promise((r) => requestAnimationFrame(r));
				const now = performance.now();
				gaps.push(now - last);
				last = now;
			}
			return gaps;
		});
		finish();
		const result = await page.evaluate(() => {
			const entry = performance
				.getEntriesByType("resource")
				.find((e) => /shipyard-.*\.glb/.test(e.name));
			const settled = window.__gaps.length;
			return {
				gaps: window.__gaps,
				settled,
				download: entry ? entry.responseEnd - entry.requestStart : null,
				bytes: entry ? entry.encodedBodySize : null,
			};
		});
		const intervals = result.gaps.map(([d]) => d).slice(1);
		const sorted = [...intervals].sort((x, y) => x - y);
		const q = (x) =>
			sorted[Math.min(sorted.length - 1, Math.ceil(x * sorted.length) - 1)];
		const worst = result.gaps.reduce((best, cur) =>
			cur[0] > best[0] ? cur : best,
		);
		const top = [...result.gaps]
			.sort((x, y) => y[0] - x[0])
			.slice(0, 3)
			.map(([d, t]) => `${d.toFixed(0)}@+${t.toFixed(0)}`)
			.join(", ");
		console.log(
			`  run ${run + 1}: frames ${intervals.length}, interval p50 ${q(0.5).toFixed(1)} p95 ${q(0.95).toFixed(1)} max ${worst[0].toFixed(1)} ms; over 50 ms: ${intervals.filter((d) => d > 50).length}, over 100 ms: ${intervals.filter((d) => d > 100).length}; worst three (ms@ms after release) ${top}; download ${result.download?.toFixed(0)} ms, ${result.bytes} bytes; release to swap ${Date.now() - releasedAt} ms; after aiming at the yard from 6 radii, max of 30 frames ${Math.max(...aimed).toFixed(1)} ms`,
		);
		await page.close();
	}
}
