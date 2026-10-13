/**
 * Node #952: the asteroid field gallery. Throwaway prototype, not the
 * canonical view set (`scripts/lib/view-set.mjs` boots seed 47 and the
 * production game, and no field is in production).
 *
 *   node spikes/asteroid-gallery-952/capture.mjs
 *   FIELDS=s173 VIEWS=inside node spikes/asteroid-gallery-952/capture.mjs
 *   TRANSITIONS=0 node spikes/asteroid-gallery-952/capture.mjs
 *
 * Each field boots the game **in its own system** (`?seed=0x5ee11e&system=N`),
 * so the star, its light and the refinery are the ones the field belongs to.
 * The field centre is `fieldCentre(plan, contents, gameTime)` and its frame is
 * the plan's inertial quaternion (#948 D-placement), placed against the
 * camera's sim position on every render, the way `main.ts` places traffic.
 * The camera is placed relative to the field; the field is never placed
 * relative to the camera.
 *
 * Arms on every view: no field, the procedural K=16 arm (#950's batch-k) and
 * the authored arm (#953) on both quality sides. Same pose, seed and clock in
 * every arm.
 *
 * Transitions (#950 F4): the camera flies a straight line into the p99 field
 * and back out on the same line. Every frame is kept, each direction becomes a
 * clip, and the level changes of rocks drawn large enough to judge are cut
 * out as before/after pairs, inbound and outbound.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import { assertPlayersRenderer } from "../../scripts/lib/players-renderer.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const WORLD = 0x5ee11e;
const OUT = process.env.OUT ?? "spikes/asteroid-gallery-952/gallery";
const VIEWPORT = { width: 1440, height: 900 };
const port = Number(process.env.PORT ?? 5198);
/** Fixed by `pick-fields.ts`: the p99 charted field, the median charted field,
 *  and the median rare belt field of galaxy 0. */
const ALL_FIELDS = [
	{
		key: "s173",
		system: 173,
		kind: "charted",
		note: "charted, 210 rocks (#950's p99 fixture)",
	},
	{
		key: "s221",
		system: 221,
		kind: "charted",
		note: "charted, 185 rocks (median of 93)",
	},
	{
		key: "s84",
		system: 84,
		kind: "rare",
		note: "rare belt field, 90 rocks (median belt)",
	},
];
const FIELDS = process.env.FIELDS
	? ALL_FIELDS.filter((f) => process.env.FIELDS.split(",").includes(f.key))
	: ALL_FIELDS;
const ALL_VIEWS = ["far", "approach", "edge", "inside", "near", "backdrop"];
const VIEWS = (process.env.VIEWS ?? ALL_VIEWS.join(",")).split(",");
const ARMS = [
	"none@high",
	"batch-k@high",
	"batch-authored@high",
	"batch-authored@low",
];
const TRANSITIONS = process.env.TRANSITIONS !== "0";
const STEPS = Number(process.env.STEPS ?? 150);

mkdirSync(OUT, { recursive: true });
const releaseLock = await holdProbeLockOrExit("asteroid field gallery");
console.log("  host load average at start:", loadavg().join(" / "));
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-asteroid-952",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });
const manifest = { world: WORLD, viewport: VIEWPORT, arms: ARMS, fields: [] };

/** Page side: build every arm in the field's own system and hook `render`. */
async function installField(page, field) {
	return page.evaluate(
		async ([kind]) => {
			const g = window.__seelite;
			await g.loadAuthoredHullsAfterBoot?.();
			g.clockHeld = true;
			g.chaseYaw = 0.5;
			g.chaseElevation = 0.3;
			const F = await import("/spikes/asteroid-fields-948/field-proto.ts");
			const R = await import("/spikes/asteroid-lod-950/field-render.ts");
			const authored = await (
				await import("/spikes/asteroid-rocks-953/load.ts")
			).loadRocks("lambert");
			const { THREE } = R;
			const sys = await import("/src/system.ts");
			const record = g.world.system.record;
			const contents = sys.generateContents(record);
			const plan =
				kind === "charted"
					? F.chartedField(record, contents)
					: F.rareField(record, contents);
			if (!plan) throw new Error(`no ${kind} field in this system`);
			const rocks = F.rocks(record, plan);
			const t0 = g.world.gameTime;
			// Same orbit law as the bodies? Check against the host refinery.
			const ref = contents.stations.find((s) => s.type === "refinery");
			let hostCheckKm = null;
			if (ref) {
				const body = g.world.system.byId.get(ref.id);
				const p = sys.positionOnOrbit(ref.orbit, t0);
				hostCheckKm = Math.hypot(
					body.pos.x - p.x,
					body.pos.y - p.y,
					body.pos.z - p.z,
				);
			}
			g.render(0);
			const camera = g.nearCamera;
			const size = g.renderer.getDrawingBufferSize(new THREE.Vector2());
			const pxPerRadian =
				size.y / 2 / Math.tan(((camera.fov / 2) * Math.PI) / 180);
			const q = new THREE.Quaternion(
				plan.q[0],
				plan.q[1],
				plan.q[2],
				plan.q[3],
			);
			const renderers = {};
			for (const arm of ["batch-k", "batch-authored"])
				for (const quality of ["high", "low"]) {
					const fr = R.buildFieldRenderer(
						rocks,
						{
							arm,
							k: 16,
							quality,
							shadows: quality === "high",
							authored: arm === "batch-authored" ? authored : undefined,
						},
						pxPerRadian,
					);
					fr.root.quaternion.copy(q);
					fr.root.visible = false;
					g.nearScene.add(fr.root);
					renderers[`${arm}@${quality}`] = fr;
				}
			const centre = () => F.fieldCentre(plan, contents, g.world.gameTime);
			const camLocal = new THREE.Vector3();
			let active = null;
			const place = () => {
				if (!active) return;
				const c = centre();
				const cam = g.cameraSimPos;
				active.root.position.set(c.x - cam.x, c.y - cam.y, c.z - cam.z);
				active.root.updateMatrixWorld(true);
				camLocal.set(0, 0, 0);
				active.root.worldToLocal(camLocal);
				active.update(g.world.gameTime, camLocal);
			};
			const render = g.render.bind(g);
			g.render = (dt) => {
				place();
				return render(dt);
			};
			window.__galleryArm = (key) => {
				for (const fr of Object.values(renderers)) fr.root.visible = false;
				active = key.startsWith("none") ? null : renderers[key];
				if (active) active.root.visible = true;
				g.settings.set("quality", key.split("@")[1]);
			};
			// Field frame → sim, at the current clock.
			const toSim = (local) => {
				const c = centre();
				const v = new THREE.Vector3(local.x, local.y, local.z).applyQuaternion(
					q,
				);
				return { x: c.x + v.x, y: c.y + v.y, z: c.z + v.z };
			};
			const dirOf = (a, b) => {
				const d = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
				return d.normalize();
			};
			/** Put the *camera* (not the ship) at `eye`, looking at `at`. The chase
			 *  rig is turned off the nose, so the camera's own forward is aimed:
			 *  forward = orientation · orbit · (−z), and a world rotation Q applied
			 *  to the orientation turns it to Q · forward exactly. */
			window.__galleryLook = (eye, at) => {
				const dir = dirOf(eye, at);
				g.orientation.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
				g.world.ship.vel = { x: 0, y: 0, z: 0 };
				for (let i = 0; i < 2; i++) {
					g.render(0);
					const fwd = g.nearCamera.getWorldDirection(new THREE.Vector3());
					g.orientation.premultiply(
						new THREE.Quaternion().setFromUnitVectors(fwd, dir),
					);
					g.world.ship.pos = { ...eye };
					const cam = g.cameraSimPos;
					g.world.ship.pos = {
						x: 2 * eye.x - cam.x,
						y: 2 * eye.y - cam.y,
						z: 2 * eye.z - cam.z,
					};
				}
				g.render(0);
				const now = g.cameraSimPos;
				const fwd = g.nearCamera.getWorldDirection(new THREE.Vector3());
				return {
					missKm: Math.hypot(now.x - eye.x, now.y - eye.y, now.z - eye.z),
					offDeg: (fwd.angleTo(dir) * 180) / Math.PI,
				};
			};
			// A rare field is not the refinery's: it is framed against the star.
			const host = ref && plan.hostId === ref.id ? ref : null;
			const semi = F.PROFILE[plan.profile].semiKm;
			const big = rocks.reduce((x, y) => (y.radiusKm > x.radiusKm ? y : x));
			const C = centre();
			const toward = host
				? dirOf(C, g.world.system.byId.get(host.id).pos)
				: dirOf(C, { x: 0, y: 0, z: 0 });
			const sun = dirOf(C, { x: 0, y: 0, z: 0 });
			const along = (k) => ({
				x: C.x + toward.x * k,
				y: C.y + toward.y * k,
				z: C.z + toward.z * k,
			});
			// Views, each `{ eye, at }` in sim km, resolved at the held clock.
			const views = {
				// From the refinery (charted) or 200 km sunward (rare), looking at the field.
				far: () =>
					host
						? (() => {
								const R0 = g.world.system.byId.get(host.id).pos;
								const d = dirOf(R0, C);
								const eye = {
									x: R0.x + d.x * 3,
									y: R0.y + d.y * 3,
									z: R0.z + d.z * 3,
								};
								return { eye, at: C };
							})()
						: { eye: along(200), at: C },
				approach: () => ({ eye: along(semi[0] + 16), at: C }),
				// 2 km off the end of the long axis, along it.
				edge: () => ({
					eye: toSim({ x: -semi[0] - 2, y: 0, z: 0 }),
					at: toSim({ x: 0, y: 0, z: 0 }),
				}),
				// A cell corner near the centre, down the long axis.
				inside: () => ({
					eye: toSim({ x: 1.2, y: 1.2, z: 1.2 }),
					at: toSim({ x: 20, y: 1.2, z: 1.2 }),
				}),
				// The largest rock at 3 radii, from its sunlit side, a quarter turn off.
				near: () => {
					const at = toSim(F.rockLocal(big, g.world.gameTime));
					const side = new THREE.Vector3(sun.x, sun.y, sun.z)
						.cross(new THREE.Vector3(0, 1, 0))
						.normalize();
					const d = new THREE.Vector3(sun.x, sun.y, sun.z)
						.multiplyScalar(0.8)
						.add(side.multiplyScalar(0.6))
						.normalize()
						.multiplyScalar(3 * big.radiusKm);
					return { eye: { x: at.x + d.x, y: at.y + d.y, z: at.z + d.z }, at };
				},
				// From behind the field, through it, toward the refinery (or the star).
				backdrop: () => ({ eye: along(-(semi[0] + 3)), at: along(200) }),
			};
			window.__galleryView = (v) => {
				const { eye, at } = views[v]();
				return window.__galleryLook(eye, at);
			};
			// Transition path: approach point → inside point, sim km.
			window.__galleryPath = () => ({
				from: toSim({ x: -semi[0] - 8, y: 1.2, z: 1.2 }),
				to: toSim({ x: 0, y: 1.2, z: 1.2 }),
				at: toSim({ x: 20, y: 1.2, z: 1.2 }),
			});
			/** Per-rock level and screen position for the active arm. */
			window.__galleryLevels = () => {
				if (!active) return null;
				const levels = active.levelsOf?.() ?? null;
				return levels;
			};
			window.__galleryScreen = () => {
				const out = [];
				const cam = g.nearCamera;
				cam.updateMatrixWorld(true);
				for (const r of rocks) {
					const s = toSim(F.rockLocal(r, g.world.gameTime));
					const c = g.cameraSimPos;
					const v = new THREE.Vector3(s.x - c.x, s.y - c.y, s.z - c.z);
					const dist = v.length();
					v.project(cam);
					out.push({
						slot: r.slot,
						x: (v.x * 0.5 + 0.5) * window.innerWidth,
						y: (-v.y * 0.5 + 0.5) * window.innerHeight,
						front: v.z < 1 && v.z > -1,
						px: (r.radiusKm / dist) * pxPerRadian,
					});
				}
				return out;
			};
			return {
				plan: { kind: plan.kind, id: plan.id, hostId: plan.hostId },
				rocks: rocks.length,
				radiiM: [
					Math.round(Math.min(...rocks.map((r) => r.radiusKm)) * 1000),
					Math.round(big.radiusKm * 1000),
				],
				hostCheckKm,
				refineryKm: ref
					? Math.hypot(
							...["x", "y", "z"].map(
								(a) => g.world.system.byId.get(ref.id).pos[a] - C[a],
							),
						)
					: null,
				system: g.world.system.record.name ?? null,
				gameTime: g.world.gameTime,
			};
		},
		[field.kind],
	);
}

async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
	);
	await page.waitForTimeout(150);
}

try {
	for (const field of FIELDS) {
		const page = await browser.newPage({
			viewport: VIEWPORT,
			deviceScaleFactor: 2,
		});
		page.on("pageerror", (e) => console.error("  pageerror:", e.message));
		await page.goto(
			gameUrl(origin, { seed: WORLD, system: field.system, "no-save": true }),
		);
		await bootedGame(page, 90000);
		const renderer = await assertPlayersRenderer(page, "gallery");
		await page.keyboard.press("v");
		await page.waitForFunction(() => window.__seelite.view === "chase");
		const info = await installField(page, field);
		console.log(
			`  ${field.key}: ${JSON.stringify(info)}; renderer ${renderer}`,
		);
		const entry = { ...field, ...info, views: [], transitions: [] };
		for (const view of VIEWS) {
			for (const arm of ARMS) {
				const miss = await page.evaluate(
					([a, v]) => {
						window.__galleryArm(a);
						return window.__galleryView(v);
					},
					[arm, view],
				);
				await settle(page);
				const file = `${field.key}-${view}-${arm.replace("@", "-")}.jpg`;
				await page.screenshot({
					path: join(OUT, file),
					type: "jpeg",
					quality: 88,
				});
				entry.views.push({ view, arm, file, ...miss });
			}
			console.log(`    ${view} done`);
		}
		if (TRANSITIONS && field.key === "s173") {
			for (const arm of ["batch-authored@high", "batch-authored@low"]) {
				const tag = arm.replace("@", "-");
				const dir = join(OUT, `${field.key}-lod-${tag}`);
				mkdirSync(dir, { recursive: true });
				await page.evaluate((a) => window.__galleryArm(a), arm);
				const frames = [];
				// In, then out on the same line: hysteresis is direction-dependent.
				const path = [];
				for (let i = 0; i <= STEPS; i++) path.push(i / STEPS);
				for (let i = STEPS - 1; i >= 0; i--) path.push(i / STEPS);
				for (let n = 0; n < path.length; n++) {
					const f = path[n];
					const shot = await page.evaluate((k) => {
						const p = window.__galleryPath();
						const lerp = (a, b) => a + (b - a) * k;
						const eye = {
							x: lerp(p.from.x, p.to.x),
							y: lerp(p.from.y, p.to.y),
							z: lerp(p.from.z, p.to.z),
						};
						window.__galleryLook(eye, p.at);
						return {
							rocks: window.__galleryScreen(),
							levels: window.__galleryLevels(),
						};
					}, f);
					await settle(page);
					const name = `f${String(n).padStart(4, "0")}.jpg`;
					await page.screenshot({
						path: join(dir, name),
						type: "jpeg",
						quality: 85,
					});
					frames.push({ n, f, name, ...shot });
				}
				writeFileSync(join(dir, "frames.json"), JSON.stringify(frames));
				for (const [label, from, count] of [
					["in", 0, STEPS + 1],
					["out", STEPS + 1, STEPS],
				]) {
					execFileSync("ffmpeg", [
						"-y",
						"-loglevel",
						"error",
						"-framerate",
						"30",
						"-start_number",
						String(from),
						"-i",
						join(dir, "f%04d.jpg"),
						"-frames:v",
						String(count),
						"-vf",
						"scale=1440:-2",
						"-pix_fmt",
						"yuv420p",
						join(OUT, `${field.key}-lod-${tag}-${label}.mp4`),
					]);
				}
				entry.transitions.push({
					arm,
					dir: `${field.key}-lod-${tag}`,
					steps: STEPS,
				});
				console.log(`    transitions ${arm}: ${frames.length} frames`);
			}
		}
		manifest.fields.push(entry);
		await page.close();
	}
	// A partial run (FIELDS=…) replaces only its own fields in an existing manifest.
	const prior = join(OUT, "manifest.json");
	if (process.env.FIELDS && existsSync(prior)) {
		const old = JSON.parse(readFileSync(prior, "utf8"));
		const mine = new Set(manifest.fields.map((f) => f.key));
		manifest.fields = ALL_FIELDS.map(
			(f) =>
				manifest.fields.find((x) => x.key === f.key) ??
				(mine.has(f.key) ? null : old.fields.find((x) => x.key === f.key)),
		).filter(Boolean);
	}
	writeFileSync(prior, JSON.stringify(manifest, null, 1));
} finally {
	await browser.close();
	await server.close();
	console.log("  host load average at end:", loadavg().join(" / "));
	releaseLock();
}
