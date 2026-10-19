/**
 * Node #968: an asteroid field is drawn where the sim charts it, through the
 * shipped install path.
 *
 * Boots the production game inside a system that has a field (world 0x5ee11e,
 * system 173, `field-00`: #950's and #952's fixture) and observes, with the
 * rock model's response held or refused rather than waited on by a sleep:
 *
 *   - the GLB not yet installed: points only, no batch in the scene;
 *   - installed: two batches and one points draw, placed against the camera's
 *     sim position at `fieldCentre` with the plan's frame, each rock's matrix
 *     at the current clock (drift and spin), read back off the batch;
 *   - the rocks reach the pixels (frame with the near batch shown vs hidden);
 *   - a failed load: plain-fill procedural K=16 rocks, never points alone, no
 *     `ROCK_SURFACE` splice, warned once, no Retry panel;
 *   - a jump after the install frees the field left behind and builds the one
 *     arrived in (a jump mid-install is asserted headlessly, not here);
 *   - both level directions follow #950's thresholds with hysteresis.
 *
 * Timing is not measured here (`measure-asteroid-field-cost.mjs` does that on
 * the GPU lane); this probe asserts behaviour on whichever lane it runs.
 */
import { mkdir } from "node:fs/promises";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installCompositeFrame } from "./lib/composite-frame.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const WORLD = 0x5ee11e;
const params = {
	seed: WORLD,
	system: 173,
	voices: "formant",
	raider: "off",
	cinematic: false,
	"no-save": true,
	"models-full": false,
	"interiors-full": false,
	"shipyards-full": false,
	"refineries-full": false,
};
const GLB = /\/asteroids[^/]*\.glb(?:\?|$)/;
/** Boot's own models. Every other model is refused so that a software-lane
 *  install of 20 MB of interiors cannot hold `modelsSettled` for minutes: this
 *  probe is about the rocks, and a refused model settles as a failure. */
const BOOT_GLB = /\/(?:courier-cockpit|coriolis)[^/]*\.glb(?:\?|$)/;
/** Route every GLB: boot models through, the rocks to `rocks`, the rest refused. */
const routeModels = (page, rocks) =>
	page.route(/\.glb(?:\?|$)/, (route) => {
		const url = route.request().url();
		if (GLB.test(url)) return rocks(route);
		if (BOOT_GLB.test(url)) return route.continue();
		return route.abort();
	});
await mkdir("probe-shots/asteroid-field", { recursive: true });

/** Installed in the page: stand the camera at a field-frame point, aimed at one. */
const PAGE_HELPERS = () => {
	window.__stand = async (local, aimLocal, frames = 2) => {
		const g = window.__seelite;
		const A = await import("/src/asteroid-field.ts");
		const draw = g.fields[0];
		const t = g.world.gameTime;
		const at = (p) => {
			const c = A.fieldCentre(draw.plan, t);
			const r = A.rotateByQuat(draw.plan.rotation, p);
			return { x: c.x + r.x, y: c.y + r.y, z: c.z + r.z };
		};
		const cam = at(local);
		const aim = at(aimLocal);
		// The camera sits ahead of the ship in cockpit view: solve for the ship.
		const before = g.cameraPos();
		const ship = g.world.ship.pos;
		await window.__placeShipAt(
			{
				x: ship.x + cam.x - before.x,
				y: ship.y + cam.y - before.y,
				z: ship.z + cam.z - before.z,
			},
			{ x: 0, y: 0, z: 0 },
		);
		const now = g.cameraPos();
		const d = { x: aim.x - now.x, y: aim.y - now.y, z: aim.z - now.z };
		const n = Math.hypot(d.x, d.y, d.z);
		g.orientation.setFromUnitVectors(
			new g.nearScene.position.constructor(0, 0, -1),
			new g.nearScene.position.constructor(d.x / n, d.y / n, d.z / n),
		);
		for (let i = 0; i < frames; i++)
			await new Promise((r) => requestAnimationFrame(r));
	};
	/** The field's biggest rock by radius, as { i, rock }. */
	window.__bigRock = () => {
		const draw = window.__seelite.fields[0];
		let best = 0;
		draw.rocks.forEach((r, i) => {
			if (r.radiusKm > draw.rocks[best].radiusKm) best = i;
		});
		return best;
	};
};

async function newPage(prepare) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(page);
	await installViewPlacement(page);
	await installCompositeFrame(page);
	await page.addInitScript(PAGE_HELPERS);
	await prepare?.(page);
	await page.goto(gameUrl(origin, params));
	await bootedGame(page, 90000);
	await page.evaluate(() => {
		window.__seelite.clockHeld = true;
	});
	return page;
}

try {
	// --- GLB held: the field is points only ---------------------------------
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const requests = [];
	const held = await newPage((page) =>
		routeModels(page, async (route) => {
			requests.push(route.request().url());
			await gate;
			await route.continue();
		}),
	);
	const pending = await held.evaluate(async () => {
		const g = window.__seelite;
		const draw = g.fields[0];
		const big = window.__bigRock();
		const rock = draw.rocks[big];
		const A = await import("/src/asteroid-field.ts");
		const p = A.rockLocal(rock, g.world.gameTime);
		await window.__stand({ x: p.x - 1.2 * rock.radiusKm, y: p.y, z: p.z }, p);
		const batches = [];
		g.nearScene.traverse((o) => {
			if (o.isBatchedMesh) batches.push(o);
		});
		return {
			fields: g.fields.length,
			id: draw.plan.id,
			rocks: draw.rocks.length,
			shapes: draw.shapes,
			batches: batches.length,
			perLevel: [...draw.perLevel],
			drawRange:
				draw.root.getObjectByName("asteroid-points").geometry.drawRange.count,
			pointsVisible: draw.root.getObjectByName("asteroid-points").visible,
			settled: g.modelsSettled(),
		};
	});
	check(
		"a field-bearing system builds its field before the rocks are installed",
		pending.fields === 1 && pending.id === "field-00" && pending.rocks > 100,
		JSON.stringify(pending),
	);
	check(
		"GLB not installed: the field draws as points only, every rock a point, no batch in the scene",
		pending.shapes === "none" &&
			pending.batches === 0 &&
			pending.perLevel[3] === pending.rocks &&
			pending.drawRange === pending.rocks &&
			pending.pointsVisible &&
			!pending.settled,
	);
	await held.screenshot({ path: "probe-shots/asteroid-field/points-only.png" });

	release();
	await held.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 120000,
		},
	);
	check(
		"the rock GLB was requested once, after boot",
		requests.length === 1,
		String(requests.length),
	);

	// --- installed: placement, levels, batches ------------------------------
	const placed = await held.evaluate(async () => {
		const g = window.__seelite;
		const A = await import("/src/asteroid-field.ts");
		const draw = g.fields[0];
		const big = window.__bigRock();
		const rock = draw.rocks[big];
		const t = g.world.gameTime;
		const p = A.rockLocal(rock, t);
		await window.__stand(
			{ x: p.x - 1.2 * rock.radiusKm, y: p.y, z: p.z },
			p,
			3,
		);
		const batches = [];
		g.nearScene.traverse((o) => {
			if (o.isBatchedMesh) batches.push(o);
		});
		const points = [];
		g.nearScene.traverse((o) => {
			if (o.isPoints && o.name === "asteroid-points") points.push(o);
		});
		const cam = g.cameraPos();
		const centre = A.fieldCentre(draw.plan, t);
		const rootErr = Math.hypot(
			draw.root.position.x - (centre.x - cam.x),
			draw.root.position.y - (centre.y - cam.y),
			draw.root.position.z - (centre.z - cam.z),
		);
		const q = draw.root.quaternion;
		const qErr = Math.max(
			Math.abs(q.x - draw.plan.rotation.x),
			Math.abs(q.y - draw.plan.rotation.y),
			Math.abs(q.z - draw.plan.rotation.z),
			Math.abs(q.w - draw.plan.rotation.w),
		);
		// A rock's drawn world position, read off the batch's own instance
		// matrix through the root, against the sim's pose minus the camera.
		const [near, far] = draw.batches;
		const worldErr = (mesh, i) => {
			const m = mesh.getMatrixAt(i, new draw.root.matrix.constructor());
			const e = m.elements;
			const local = { x: e[12], y: e[13], z: e[14] };
			const r = A.rotateByQuat(draw.plan.rotation, local);
			const pose = A.rockPose(draw.plan, draw.rocks[i], t);
			return Math.hypot(
				draw.root.position.x + r.x - (pose.pos.x - cam.x),
				draw.root.position.y + r.y - (pose.pos.y - cam.y),
				draw.root.position.z + r.z - (pose.pos.z - cam.z),
			);
		};
		let worst = 0;
		const drawn = { near: 0, far: 0 };
		for (let i = 0; i < draw.rocks.length; i++) {
			const level = draw.levels[i];
			if (level === 3) continue;
			const mesh = level === 0 ? near : far;
			worst = Math.max(worst, worldErr(mesh, i));
			drawn[level === 0 ? "near" : "far"]++;
		}
		let visibleNear = 0;
		let visibleFar = 0;
		for (let i = 0; i < draw.rocks.length; i++) {
			if (near.getVisibleAt(i)) visibleNear++;
			if (far.getVisibleAt(i)) visibleFar++;
		}
		return {
			shapes: draw.shapes,
			batches: batches.length,
			points: points.length,
			inScene: batches.every((b) => b.parent === draw.root),
			perLevel: [...draw.perLevel],
			rootErr,
			qErr,
			worst,
			drawn,
			visibleNear,
			visibleFar,
			calls: null,
			bigLevel: draw.levels[big],
			castNear: near.castShadow,
			castFar: far.castShadow,
			quality: g.settings.value.quality,
			frustum: [near.perObjectFrustumCulled, far.perObjectFrustumCulled],
			material: near.material.type,
			sameMaterial: near.material === far.material,
		};
	});
	check(
		"installed, the field is exactly two BatchedMeshes and one Points draw under its root",
		placed.shapes === "authored" &&
			placed.batches === 2 &&
			placed.points === 1 &&
			placed.inScene,
		JSON.stringify({ ...placed, perLevel: undefined }),
	);
	check(
		"the root is placed against the camera's sim position at fieldCentre, with the plan's inertial frame",
		placed.rootErr < 1e-3 && placed.qErr < 1e-6,
		`root ${placed.rootErr.toExponential(2)} km, frame ${placed.qErr.toExponential(2)}`,
	);
	check(
		"every drawn rock sits where rockPose puts it (within float32), drift included",
		placed.worst < 5e-3 && placed.drawn.near + placed.drawn.far > 50,
		`worst ${(placed.worst * 1000).toFixed(2)} m over ${placed.drawn.near + placed.drawn.far} rocks`,
	);
	check(
		"the batches show exactly the rocks the levels name, and the biggest rock is at level 0",
		placed.visibleNear === placed.perLevel[0] &&
			placed.visibleFar === placed.perLevel[1] + placed.perLevel[2] &&
			placed.bigLevel === 0 &&
			placed.perLevel[0] <= 5,
		`L0/L1/L2/pt ${placed.perLevel.join("/")}`,
	);
	check(
		"Lambert authored material, per-instance culling, shadows from level 0 on high only",
		placed.material === "MeshLambertMaterial" &&
			placed.sameMaterial &&
			placed.frustum.every(Boolean) &&
			placed.castNear === (placed.quality === "high") &&
			placed.castFar === false,
		`quality ${placed.quality}, cast ${placed.castNear}/${placed.castFar}`,
	);

	// --- the clock moves every rock: drift and spin ------------------------
	const moving = await held.evaluate(async () => {
		const g = window.__seelite;
		const draw = g.fields[0];
		const [near] = draw.batches;
		const big = window.__bigRock();
		const A = await import("/src/asteroid-field.ts");
		const a = near.getMatrixAt(big, new draw.root.matrix.constructor()).clone();
		const t0 = g.world.gameTime;
		// A minute of game time, standing at the same field-frame point.
		g.world.gameTime = t0 + 60;
		const rock = draw.rocks[big];
		const p = A.rockLocal(rock, g.world.gameTime);
		await window.__stand(
			{ x: p.x - 1.2 * rock.radiusKm, y: p.y, z: p.z },
			p,
			3,
		);
		const b = near.getMatrixAt(big, new draw.root.matrix.constructor()).clone();
		const spun = A.rockSpinAngle(rock, t0 + 60) - A.rockSpinAngle(rock, t0);
		// Rotation part differs by the spin about the rock's own axis.
		const ra = a.elements;
		const rb = b.elements;
		const s = rock.radiusKm;
		let diff = 0;
		for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10])
			diff = Math.max(diff, Math.abs(ra[i] - rb[i]) / s);
		g.world.gameTime = t0;
		return { spun, diff, level: draw.levels[big] };
	});
	check(
		"a rock's matrix turns with the clock (spin read off the instance, not the sim)",
		moving.spun > 0.01 ? moving.diff > 1e-3 : true,
		JSON.stringify(moving),
	);

	// --- pixels -------------------------------------------------------------
	const pixels = await held.evaluate(async () => {
		const g = window.__seelite;
		const draw = g.fields[0];
		const A = await import("/src/asteroid-field.ts");
		const big = window.__bigRock();
		const rock = draw.rocks[big];
		const p = A.rockLocal(rock, g.world.gameTime);
		await window.__stand({ x: p.x - 3 * rock.radiusKm, y: p.y, z: p.z }, p, 3);
		const [near, far] = draw.batches;
		const W = 640;
		const H = 400;
		const region = { x: W / 2 - 60, y: H / 2 - 60, width: 120, height: 120 };
		const mean = () => {
			const d = window.__compositeFrame(W, H, region).data;
			let s = 0;
			for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
			return s / (d.length / 4) / 3;
		};
		const shown = mean();
		near.visible = false;
		far.visible = false;
		const hiddenMean = mean();
		near.visible = true;
		far.visible = true;
		return { shown, hidden: hiddenMean, level: draw.levels[big] };
	});
	check(
		"the rocks reach the pixels: the frame differs where the biggest rock stands",
		Math.abs(pixels.shown - pixels.hidden) > 3,
		`mean ${pixels.shown.toFixed(1)} with, ${pixels.hidden.toFixed(1)} without`,
	);
	await held.screenshot({ path: "probe-shots/asteroid-field/installed.png" });

	// --- both level directions, with hysteresis ----------------------------
	const lod = await held.evaluate(async () => {
		const g = window.__seelite;
		const draw = g.fields[0];
		const A = await import("/src/asteroid-field.ts");
		const big = window.__bigRock();
		const rock = draw.rocks[big];
		const p = A.rockLocal(rock, g.world.gameTime);
		const aim = p;
		const at = async (distKm) => {
			await window.__stand({ x: p.x - distKm, y: p.y, z: p.z }, aim, 2);
			return draw.levels[big];
		};
		const size = g.renderer.getDrawingBufferSize(
			new g.fieldBuffer.constructor(),
		);
		const pxPerRadian =
			size.y / 2 / Math.tan(((g.nearCamera.fov / 2) * Math.PI) / 180);
		const distFor = (px) => (rock.radiusKm * pxPerRadian) / px;
		const high = g.settings.value.quality === "high";
		const edges = high ? [40, 10, 1.5] : [80, 20, 3];
		const out = [];
		// Inbound: from a point to level 0.
		for (const px of [
			edges[2] * 0.5,
			edges[2] * 1.1,
			edges[2] * 1.2,
			edges[1] * 1.2,
			edges[0] * 1.2,
		])
			out.push({ px, level: await at(distFor(px)), dir: "in" });
		// Outbound, hysteresis: 10 % inside the level-0 edge it holds level 0.
		for (const k of [0, 1, 2])
			for (const f of [0.9, 0.5])
				out.push({
					px: edges[k] * f,
					level: await at(distFor(edges[k] * f)),
					dir: "out",
				});
		// Turned round at level 1 (just below the level-0 edge): the band above
		// the bare edge is held, and only past edge × 1.15 does it step back up.
		await at(distFor(edges[0] * 0.9));
		const held = [];
		for (const f of [1.05, 1.12, 1.2])
			held.push({ f, level: await at(distFor(edges[0] * f)) });
		return { edges, out, held };
	});
	const inbound = lod.out.filter((o) => o.dir === "in").map((o) => o.level);
	const outbound = lod.out.filter((o) => o.dir === "out").map((o) => o.level);
	check(
		"inbound the biggest rock steps point → 2 → 1 → 0 only past each edge × 1.15",
		inbound.join() === "3,3,2,1,0",
		`levels ${inbound.join(",")} at ${lod.out
			.filter((o) => o.dir === "in")
			.map((o) => o.px.toFixed(1))
			.join(",")} px`,
	);
	check(
		"outbound it steps down at each bare edge: 0.9 × and 0.5 × of the 40 / 10 / 1.5 px (80 / 20 / 3 low) edges",
		outbound.join() === "1,1,2,2,3,3",
		`levels ${outbound.join(",")}`,
	);
	check(
		"turned round, a rock holds its level through the 15 % band and steps up only past edge × 1.15",
		lod.held.map((h) => h.level).join() === "1,1,0",
		lod.held.map((h) => `${h.f}×→${h.level}`).join(" "),
	);

	// --- jump while the install is in flight ------------------------------
	const jumped = await held.evaluate(async () => {
		const g = window.__seelite;
		const old = g.fields[0];
		const from = g.world.system.record.index;
		const to = g.world.galaxy.systems.find(
			(s) => s.index !== from && g.jumpDecision(s).ok,
		);
		if (!to || !g.commitCourseTo(to.index) || !g.chargeJump())
			throw Error("jump fixture refused");
		g.stepJumpCharge(g.jumpCharge.leftS ?? 100);
		g.takePendingJump();
		g.render(0);
		return {
			from,
			to: to.index,
			arrived: g.world.system.record.index,
			oldDisposed: old.root.parent === null && !old.meshesInstalled,
			fields: g.fields.length,
			stale: g.fields.includes(old),
		};
	});
	check(
		"a jump disposes the field left behind and builds the one arrived in",
		jumped.arrived === jumped.to && jumped.oldDisposed && !jumped.stale,
		JSON.stringify(jumped),
	);
	await held.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 120000,
		},
	);
	const arrived = await held.evaluate(() => {
		const g = window.__seelite;
		return g.fields.map((d) => ({
			id: d.plan.id,
			shapes: d.shapes,
			batches: d.batches.length,
			parent: d.root.parent === g.nearScene,
		}));
	});
	check(
		"the system arrived in draws rocks once settled, or has no field to draw",
		arrived.every(
			(d) => d.shapes === "authored" && d.batches === 2 && d.parent,
		),
		JSON.stringify(arrived),
	);
	check(
		"the system arrived in reuses the decoded rocks without refetch",
		requests.length === 1,
		String(requests.length),
	);
	await held.close();

	// --- failed load: plain procedural rocks, never points alone ------------
	const failed = await browser.newPage({
		viewport: { width: 1280, height: 800 },
	});
	watch(failed);
	await installViewPlacement(failed);
	await installCompositeFrame(failed);
	await failed.addInitScript(PAGE_HELPERS);
	let attempts = 0;
	const warnings = [];
	failed.on("console", (m) => {
		if (m.type() === "warning" && m.text().startsWith("asteroids:"))
			warnings.push(m.text());
	});
	await routeModels(failed, (route) => {
		attempts++;
		return route.abort();
	});
	await failed.goto(gameUrl(origin, params));
	await bootedGame(failed, 90000);
	await failed.evaluate(() => {
		window.__seelite.clockHeld = true;
	});
	await failed.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{
			timeout: 120000,
		},
	);
	const standin = await failed.evaluate(async () => {
		const g = window.__seelite;
		const draw = g.fields[0];
		const A = await import("/src/asteroid-field.ts");
		const big = window.__bigRock();
		const rock = draw.rocks[big];
		const p = A.rockLocal(rock, g.world.gameTime);
		await window.__stand(
			{ x: p.x - 1.2 * rock.radiusKm, y: p.y, z: p.z },
			p,
			3,
		);
		const [near, far] = draw.batches;
		const material = near.material;
		const geometryCount = (m) => m.geometry.getAttribute("position").count;
		return {
			shapes: draw.shapes,
			batches: draw.batches.length,
			perLevel: [...draw.perLevel],
			type: material.type,
			hasSplice: material.onBeforeCompile.toString().includes("vRockP"),
			cacheKey: String(material.customProgramCacheKey?.()),
			hasMap: !!material.map,
			vertices: [geometryCount(near), geometryCount(far)],
			retry: !!document.querySelector("[data-model-retry]"),
		};
	});
	check(
		"failed GLB load: the field draws plain-fill procedural rocks in two batches, not points alone",
		attempts === 1 &&
			standin.shapes === "standin" &&
			standin.batches === 2 &&
			standin.perLevel[0] + standin.perLevel[1] + standin.perLevel[2] > 10,
		JSON.stringify(standin),
	);
	check(
		"the stand-in is plain fill: no ROCK_SURFACE splice, no maps",
		standin.type === "MeshStandardMaterial" &&
			!standin.hasSplice &&
			!standin.hasMap,
	);
	check(
		"the failure warns once, shows no Retry panel and settles",
		warnings.length === 1 && !standin.retry,
		warnings.join(" | "),
	);
	const standinPixels = await failed.evaluate(() => {
		const g = window.__seelite;
		const draw = g.fields[0];
		const [near, far] = draw.batches;
		const W = 640;
		const H = 400;
		const region = { x: W / 2 - 60, y: H / 2 - 60, width: 120, height: 120 };
		const mean = () => {
			const d = window.__compositeFrame(W, H, region).data;
			let s = 0;
			for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
			return s / (d.length / 4) / 3;
		};
		const shown = mean();
		near.visible = false;
		far.visible = false;
		const hidden = mean();
		near.visible = true;
		far.visible = true;
		return { shown, hidden };
	});
	check(
		"the stand-in rocks reach the pixels",
		Math.abs(standinPixels.shown - standinPixels.hidden) > 3,
		`mean ${standinPixels.shown.toFixed(1)} with, ${standinPixels.hidden.toFixed(1)} without`,
	);
	await failed.screenshot({ path: "probe-shots/asteroid-field/stand-in.png" });
	await failed.close();
} finally {
	await browser.close();
}
exit();
