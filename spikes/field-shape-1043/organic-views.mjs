import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import {
	median,
	seededShuffler,
	separation,
} from "../../scripts/lib/measurement.mjs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";
import { assertPlayersRenderer } from "../../scripts/lib/players-renderer.mjs";

const out = resolve(
	process.env.OUT ?? "/tmp/seelite-field-shape-1043-organic/first",
);
const world = Number(process.env.WORLD ?? 0x5ee11e);
const system = Number(process.env.SYSTEM ?? 173),
	kind = process.env.KIND ?? "charted",
	port = Number(process.env.PORT ?? 5213);
const cost = process.env.COST === "1",
	antialias = Number(process.env.ANTIALIAS ?? 0),
	blocks = Number(process.env.BLOCKS ?? 6),
	frames = Number(process.env.FRAMES ?? 48);
const names = (process.env.CANDIDATES ?? "baseline,organic,braided").split(",");
mkdirSync(out, { recursive: true });
const release = await holdProbeLockOrExit("organic field1043 visual study");
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-field1043-organic",
});
const manifest = {
	mode: "visual diagnostic only; no performance measurement",
	head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	dirty: !!execFileSync("git", ["status", "--porcelain"], {
		encoding: "utf8",
	}).trim(),
	world,
	system,
	kind,
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	clock:
		"held at actual recorded gameTime; production FieldDraw renders the study rock arrays",
	worldOnly:
		"player hull children hidden to expose field; no material or rock shape edits",
	rows: [],
	errors: [],
	warnings: [],
};
manifest.sources = Object.fromEntries(
	[
		"spikes/field-shape-1043/organic.ts",
		"spikes/field-shape-1043/profiles.ts",
		"spikes/field-shape-1043/organic-views.mjs",
		"src/asteroid-field.ts",
		"src/field-draw.ts",
		"src/field-lod.ts",
		"src/main.ts",
		"src/models/rock-heightfields.bin",
	].map((path) => [
		path,
		createHash("sha256").update(readFileSync(path)).digest("hex"),
	]),
);
mkdirSync(join(out, "source"), { recursive: true });
for (const path of ["organic.ts", "profiles.ts", "organic-views.mjs"])
	writeFileSync(
		join(out, "source", path),
		readFileSync("spikes/field-shape-1043/" + path),
	);
writeFileSync(
	join(out, "source", "working.patch"),
	execFileSync("git", ["diff", "HEAD"], { encoding: "utf8" }),
);
let browser;
try {
	await server.listen();
	const origin = `http://127.0.0.1:${port}`;
	await guardedOrigin(origin);
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: manifest.viewport,
		deviceScaleFactor: 2,
	});
	page.on("pageerror", (e) => manifest.errors.push(e.message));
	page.on("console", (m) => {
		if (m.type() === "error") {
			const message = { text: m.text(), location: m.location() };
			if (
				/WebGLProgram|VALIDATE_STATUS|shader.*(?:compile|link)/i.test(m.text())
			)
				manifest.errors.push(message);
			else manifest.warnings.push(message);
		}
	});
	await page.goto(
		gameUrl(origin, {
			seed: manifest.world,
			system,
			"no-save": true,
			"models-full": true,
			voices: "formant",
			raider: "off",
			mining: 1,
		}),
	);
	await bootedGame(page, 180000);
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 180000 },
	);
	manifest.renderer = await assertPlayersRenderer(
		page,
		"organic field1043 visual study",
	);
	manifest.setup = await page.evaluate(
		async ({ kind, names, antialias }) => {
			const A = await import("/src/asteroid-field.ts"),
				S = await import("/spikes/field-shape-1043/profiles.ts"),
				D = await import("/src/field-draw.ts"),
				M = await import("/src/asteroid-model.ts");
			const g = window.__seelite;
			g.clockHeld = true;
			g.settings.set("quality", "high");
			g.settings.set("antialias", antialias);
			if (!g.surveyState().on) throw Error("mining flag is off");
			g.setOcclusion(false, false);
			g.view = "chase";
			g.chaseYaw = 0;
			g.chaseElevation = 0;
			g.targetId = null;
			for (const child of g.shipMesh.children) child.visible = false;
			const plan = A.systemFields(
				g.world.system.record,
				g.world.system.contents,
			).find((p) => p.profile === kind);
			if (!plan) throw Error(`missing ${kind} field`);
			const shapes = M.authoredRockShapes();
			if (!shapes) throw Error("authored rocks not installed");
			for (const old of g.fields) old.root.visible = false;
			const draws = {};
			for (const name of names) {
				if (!S.CANDIDATES.includes(name))
					throw Error(`unknown candidate ${name}`);
				const draw = new D.FieldDraw(
					plan,
					S.candidateRocks(g.world.system.record, plan, name),
				);
				g.nearScene.add(draw.root);
				await draw.install(
					shapes,
					"authored",
					async () => {},
					() => true,
					(mesh) => g.warmFieldBatch(mesh, shapes, () => true),
				);
				draw.root.visible = false;
				draws[name] = draw;
			}
			const V = g.nearScene.position.constructor;
			const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
			const pointAt = (rock) => A.rockLocal(rock, g.world.gameTime);
			const studyTime = g.world.gameTime;
			window.__organicView = (name, view) => {
				g.world.gameTime = studyTime;
				g.view = "chase";
				g.setHeadLook("forward");
				for (const draw of Object.values(draws)) draw.root.visible = false;
				const draw = draws[name],
					rocks = draw.rocks;
				let local,
					target = { x: 0, y: 0, z: 0 },
					slot = null;
				if (view === "close" || view === "sharedclose") {
					const shared = draws.baseline.rocks
						.filter((r) => draws.organic.rocks.some((o) => o.slot === r.slot))
						.sort((a, b) => b.radiusKm - a.radiusKm || a.slot - b.slot)[0];
					const rock =
						view === "sharedclose"
							? rocks.find((r) => r.slot === shared.slot)
							: rocks.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));
					target = pointAt(rock);
					slot = rock.slot;
					local = { ...target, x: target.x - 1.2 * rock.radiusKm };
				} else if (view === "dense") {
					const peak = rocks
						.map((rock) => ({
							rock,
							neighbours: rocks.filter(
								(other) => dist(rock.anchor, other.anchor) < 8,
							).length,
						}))
						.sort(
							(a, b) =>
								b.neighbours - a.neighbours || a.rock.slot - b.rock.slot,
						)[0];
					target = pointAt(peak.rock);
					slot = peak.rock.slot;
					local = [2.5, 4, 6, 8]
						.map((offset) => ({ ...target, x: target.x - offset }))
						.find((p) =>
							rocks.every(
								(rock) => dist(p, pointAt(rock)) > rock.radiusKm + 0.1,
							),
						);
					if (!local) throw Error("no clear dense viewpoint");
				} else
					local =
						view === "far"
							? { x: -224, y: 0, z: 0 }
							: view === "side"
								? { x: 0, y: -160, z: 0 }
								: view === "overview"
									? { x: -110, y: -90, z: 70 }
									: { x: 1.8, y: 1.8, z: 1.8 };
				const delta = {
					x: target.x - local.x,
					y: target.y - local.y,
					z: target.z - local.z,
				};
				const distance = Math.hypot(delta.x, delta.y, delta.z);
				const direction = A.rotateByQuat(plan.rotation, {
					x: delta.x / distance,
					y: delta.y / distance,
					z: delta.z / distance,
				});
				g.orientation.setFromUnitVectors(
					new V(0, 0, -1),
					new V(direction.x, direction.y, direction.z),
				);
				g.fieldDraws = [draw];
				g.render(0);
				for (let i = 0; i < 4; i++) {
					const centre = A.fieldCentre(plan, g.world.gameTime),
						offset = A.rotateByQuat(plan.rotation, local),
						have = g.cameraPos();
					g.world.ship.pos = {
						x: g.world.ship.pos.x + centre.x + offset.x - have.x,
						y: g.world.ship.pos.y + centre.y + offset.y - have.y,
						z: g.world.ship.pos.z + centre.z + offset.z - have.z,
					};
					g.render(0);
				}
				const centre = A.fieldCentre(plan, g.world.gameTime),
					offset = A.rotateByQuat(plan.rotation, local),
					have = g.cameraPos(),
					actualDirection = g.nearCamera.getWorldDirection(new V());
				const missKm = Math.hypot(
					have.x - centre.x - offset.x,
					have.y - centre.y - offset.y,
					have.z - centre.z - offset.z,
				);
				const offAxisDeg =
					(Math.acos(
						Math.max(
							-1,
							Math.min(
								1,
								actualDirection.x * direction.x +
									actualDirection.y * direction.y +
									actualDirection.z * direction.z,
							),
						),
					) *
						180) /
					Math.PI;
				if (missKm > 1e-5 || offAxisDeg > 0.01)
					throw Error(`camera mismatch ${missKm}/${offAxisDeg}`);
				const startTime = g.world.gameTime;
				let frame = 0;
				window.__organicStep = () => {
					g.world.gameTime = startTime + (++frame % 120) / 60;
					const c = A.fieldCentre(plan, g.world.gameTime),
						p = A.rotateByQuat(plan.rotation, local),
						h = g.cameraPos();
					g.world.ship.pos = {
						x: g.world.ship.pos.x + c.x + p.x - h.x,
						y: g.world.ship.pos.y + c.y + p.y - h.y,
						z: g.world.ship.pos.z + c.z + p.z - h.z,
					};
					g.render(0);
				};
				window.__organicField = (on) => {
					draw.root.visible = on;
					g.fieldDraws = on ? [draw] : [];
				};
				window.__organicStats = () => {
					const r = g.renderer,
						reset = r.info.autoReset;
					r.info.autoReset = false;
					r.info.reset();
					g.render(0);
					const stats = {
						calls: r.info.render.calls,
						triangles: r.info.render.triangles,
						levels: [...draw.perLevel],
						settings: { ...g.settings.value },
						shadowMap: { enabled: r.shadowMap.enabled, type: r.shadowMap.type },
						cameraLocal: local,
						targetSlot: slot,
					};
					r.info.autoReset = reset;
					return stats;
				};
				return {
					name,
					view,
					rocks: rocks.length,
					plan: plan.id,
					at: g.world.gameTime,
					held: g.clockHeld,
					local,
					target,
					targetSlot: slot,
					missKm,
					offAxisDeg,
					actualCamera: {
						position: g.nearCamera.position.toArray(),
						quaternion: g.nearCamera.quaternion.toArray(),
						fov: g.nearCamera.fov,
					},
					localRockCountWithin8Km: rocks.filter(
						(rock) => dist(pointAt(rock), local) < 8,
					).length,
					minimumSurfaceKm: Math.min(
						...rocks.map((rock) => dist(pointAt(rock), local) - rock.radiusKm),
					),
					levels: [...draw.perLevel],
				};
			};
			window.__organicNav = async (name) => {
				g.settings.set("quality", "high");
				g.setOcclusion(false, false);
				window.__organicView(name, "dense");
				const draw = draws[name],
					T = await import("/src/rock-target.ts");
				g.view = "cockpit";
				g.leftTab = "Navigation";
				g.setHeadLook("left");
				g.updateLocalFrameBody();
				if (g.frameField?.id !== plan.id)
					throw Error("dense view did not acquire actual field frame");
				const refs = T.nearRocks(
					[draw],
					g.world.ship.pos,
					g.world.gameTime,
					Infinity,
				);
				for (const ref of refs)
					g.putDepositRow(ref, {
						...g.rockDepositRow(ref),
						surveyedAt: g.world.gameTime,
					});
				g.targetId = refs[0].id;
				g.updateCockpit();
				g.render(0);
				const rows = g.navRows().filter((r) => r.kind === "rock"),
					dom = [...document.querySelectorAll("[data-live-nav-target]")].filter(
						(e) => rows.some((r) => r.id === e.dataset.liveNavTarget),
					);
				if (
					rows.length !== draw.rocks.length ||
					dom.length !== rows.length ||
					!rows.some((r) => r.selected)
				)
					throw Error("populated live Navigation projection mismatch");
				window.__organicNavRefresh = () => {
					g.render(0);
					return rows.length;
				};
				return {
					mining: g.surveyState().on,
					occlusion: false,
					fieldFrame: g.frameField.id,
					rows: rows.length,
					domRows: dom.length,
					selected: g.targetId,
					disabled: rows.filter((r) => r.disabledReason).length,
					furthestKm: Math.max(...rows.map((r) => r.distanceKm)),
					settings: { ...g.settings.value },
				};
			};
			return {
				plan,
				settings: { ...g.settings.value },
				counts: Object.fromEntries(
					names.map((n) => [n, draws[n].rocks.length]),
				),
			};
		},
		{ kind, names, antialias },
	);
	if (process.env.PROFILE === "1") {
		await page.evaluate(() => {
			window.__seelite.settings.set("quality", "high");
			window.__organicView("organic", "dense");
		});
		const cdp = await page.context().newCDPSession(page);
		await cdp.send("Profiler.enable");
		await cdp.send("Profiler.start");
		await page.evaluate(() => {
			const gl = window.__seelite.renderer.getContext(),
				p = new Uint8Array(4);
			for (let i = 0; i < 600; i++) window.__organicStep();
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
		});
		const { profile } = await cdp.send("Profiler.stop");
		writeFileSync(
			join(out, "nonreported-cpu.cpuprofile"),
			JSON.stringify(profile),
		);
		await cdp.detach();
	}
	if (cost) {
		manifest.mode =
			"synchronous hardware-render frame cost (CPU+GPU), performance.now + readPixels drain; manually advanced 2-second rendering clock, no flight step";
		manifest.timing = {
			antialias,
			blocks,
			frames,
			loadStart: loadavg(),
			rows: [],
		};
		const shuffle = seededShuffler(1043);
		for (const view of process.env.NAV_ONLY === "1"
			? []
			: ["far", "inside", "sharedclose", "close", "dense"])
			for (const quality of ["high", "low"])
				for (const occlusion of [false, true]) {
					const arms = names.flatMap((name) =>
							[false, true].map((field) => ({ name, field })),
						),
						samples = Object.fromEntries(
							arms.map((a) => [a.name + ":" + a.field, []]),
						);
					const run = async (arm) =>
						page.evaluate(
							({ arm, view, quality, occlusion, frames }) => {
								const g = window.__seelite;
								g.settings.set("quality", quality);
								g.setOcclusion(occlusion, occlusion);
								const pose = window.__organicView(arm.name, view);
								window.__organicField(arm.field);
								const gl = g.renderer.getContext(),
									pixel = new Uint8Array(4);
								for (let i = 0; i < 8; i++) window.__organicStep();
								gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
								const start = performance.now();
								for (let i = 0; i < frames; i++) window.__organicStep();
								gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
								const ms = (performance.now() - start) / frames;
								return { ms, pose, stats: window.__organicStats() };
							},
							{ arm, view, quality, occlusion, frames },
						);
					for (const arm of shuffle(arms)) await run(arm);
					for (let block = 0; block < blocks; block++)
						for (const arm of shuffle(arms)) {
							const r = await run(arm);
							samples[arm.name + ":" + arm.field].push(r.ms);
						}
					for (const name of names) {
						const yes = samples[name + ":true"],
							no = samples[name + ":false"],
							a = await run({ name, field: true }),
							b = await run({ name, field: false });
						const row = {
							name,
							view,
							quality,
							occlusion,
							antialias,
							yes,
							no,
							deltaMs: median(yes) - median(no),
							separation: separation(yes, no),
							drawCalls: a.stats.calls - b.stats.calls,
							withField: a,
							withoutField: b,
						};
						manifest.timing.rows.push(row);
						console.log(
							JSON.stringify({
								name,
								view,
								quality,
								occlusion,
								antialias,
								deltaMs: row.deltaMs,
								calls: row.drawCalls,
							}),
						);
					}
				}
		manifest.timing.loadEnd = loadavg();
		manifest.navigationMethod =
			"Held-clock stationary cockpit: exactly one production render (includes updateCockpit), plus cheap recorded row-count consumption; no extra refresh or projection. High, occlusion off, actual AA. Six alternating blocks.";
		manifest.navigation = names.map((name) => ({ name, samples: [] }));
		for (let block = 0; block < blocks; block++)
			for (const name of block % 2 ? [...names].reverse() : names) {
				const setup = await page.evaluate(
					(name) => window.__organicNav(name),
					name,
				);
				const sample = await page.evaluate(
					(frames) => {
						const gl = window.__seelite.renderer.getContext(),
							p = new Uint8Array(4);
						window.__organicNavRefresh();
						gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
						let consumed = 0;
						const at = performance.now();
						for (let i = 0; i < frames; i++)
							consumed += window.__organicNavRefresh();
						gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
						return { ms: (performance.now() - at) / frames, consumed };
					},
					Math.min(frames, 24),
				);
				if (sample.consumed !== setup.rows * Math.min(frames, 24))
					throw Error("navigation work count changed");
				const row = manifest.navigation.find((r) => r.name === name);
				row.setup = setup;
				row.samples.push(sample);
				if (block === blocks - 1) {
					row.file = name + "-navigation.png";
					await page.screenshot({ path: join(out, row.file) });
				}
			}
		await page.evaluate(() => {
			const g = window.__seelite;
			g.view = "chase";
			g.setHeadLook("forward");
			g.targetId = null;
		});
	}
	await page.evaluate(() => {
		const g = window.__seelite;
		g.settings.set("quality", "high");
		g.setOcclusion(false, false);
	});
	for (const view of ["far", "side", "overview", "inside", "dense"])
		for (const name of names) {
			const row = await page.evaluate(
				([name, view]) => window.__organicView(name, view),
				[name, view],
			);
			const file = `${name}-${view}.png`;
			await page.screenshot({ path: join(out, file) });
			const detailClip = { x: 480, y: 290, width: 480, height: 320 };
			const detailFile = `${name}-${view}-detail.png`;
			if (["far", "side", "overview"].includes(view))
				await page.screenshot({
					path: join(out, detailFile),
					clip: detailClip,
				});
			manifest.rows.push({
				...row,
				file,
				...(["far", "side", "overview"].includes(view)
					? { detailFile, detailClip }
					: {}),
			});
			console.log(
				JSON.stringify({
					name,
					view,
					rocks: row.rocks,
					near: row.localRockCountWithin8Km,
					missKm: row.missKm,
				}),
			);
		}
	if (manifest.errors.length) throw Error(JSON.stringify(manifest.errors));
	manifest.capturedAt = new Date().toISOString();
	writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
	let html = `<!doctype html><meta charset="utf-8"><title>Organic field1043 diagnostic</title><style>body{background:#111720;color:#eef;font:16px system-ui;margin:24px}.row{display:grid;grid-template-columns:repeat(${names.length},1fr);gap:12px}img{width:100%}figure{margin:0}h2{margin-top:32px}</style><h1>Organic field1043: early actual renderer views</h1><p>Diagnostic working source ${manifest.head}${manifest.dirty ? "-dirty" : ""}. ${manifest.renderer}. Clock held at actual recorded time. High, AA${antialias}, occlusion off, viewport1440×900 DPR2. Player hull children hidden; production FieldDraw and authored rock meshes/materials unchanged. Far, side, overview and inside use matching field-frame cameras; dense is candidate-targeted. No performance or production-readiness claim. <a href="manifest.json">Actual metadata</a>.</p>`;
	for (const view of ["far", "side", "overview", "inside", "dense"])
		html += `<h2>${view}</h2><div class="row">${manifest.rows
			.filter((r) => r.view === view)
			.map(
				(r) =>
					`<figure><a href="${r.file}"><img src="${r.file}"></a><figcaption>${r.name}: ${r.detailFile ? `<a href="${r.detailFile}">detail crop</a> (CSS480,290,480,320); ` : ""}${r.rocks} rocks; ${r.localRockCountWithin8Km} within8km; camera miss${r.missKm.toExponential(1)}km</figcaption></figure>`,
			)
			.join("")}</div>`;
	writeFileSync(join(out, "index.html"), html);
	console.log(`visual review ${join(out, "index.html")}`);
} finally {
	await browser?.close();
	await server.close();
	release();
}
