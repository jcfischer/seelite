import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { gameUrl } from "../../scripts/lib/game-url.mjs";
import {
	median,
	seededShuffler,
	separation,
} from "../../scripts/lib/measurement.mjs";
import { holdProbeLockOrExit } from "../../scripts/lib/probe-lock.mjs";
import { assertPlayersRenderer } from "../../scripts/lib/players-renderer.mjs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
} from "../../scripts/probe-guard.mjs";

const out = resolve(process.env.OUT ?? "/tmp/seelite-field-shape-1043");
const blocks = Number(process.env.BLOCKS ?? 12);
const frames = Number(process.env.FRAMES ?? 120);
const orderSeed = Number(process.env.ORDER_SEED ?? 7);
const system = Number(process.env.SYSTEM ?? 173);
const kind = process.env.KIND ?? "charted";
const port = Number(process.env.PORT ?? 5213);
const captures = process.env.CAPTURES !== "0";
for (const [key, n] of Object.entries({
	blocks,
	frames,
	orderSeed,
	system,
	port,
}))
	if (
		!Number.isInteger(n) ||
		n < (key === "system" || key === "orderSeed" ? 0 : 1)
	)
		throw new Error(`Invalid ${key}`);
mkdirSync(out, { recursive: true });
const release = await holdProbeLockOrExit("field shape1043 study");
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-field-shape-1043",
});
let browser;
const manifest = {
	gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim(),
	world: 0x5ee11e,
	system,
	kind,
	orderSeed,
	blocks,
	frames,
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	loadStart: loadavg(),
	rows: [],
	captures: [],
};
try {
	await server.listen();
	const origin = `http://127.0.0.1:${port}`;
	await guardedOrigin(origin);
	browser = await launchChromium({ headless: false });
	const page = await browser.newPage({
		viewport: manifest.viewport,
		deviceScaleFactor: 2,
	});
	page.on("pageerror", (e) => console.error("pageerror:", e.message));
	await page.goto(
		gameUrl(origin, {
			seed: manifest.world,
			system,
			"no-save": true,
			"models-full": true,
		}),
	);
	await bootedGame(page, 180000);
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 180000 },
	);
	manifest.renderer = await assertPlayersRenderer(page, "field shape1043");
	manifest.setup = await page.evaluate(async (kind) => {
		const g = window.__seelite;
		g.clockHeld = true;
		g.view = "chase";
		g.chaseYaw = 0;
		g.chaseElevation = 0;
		const A = await import("/src/asteroid-field.ts");
		const S = await import("/spikes/field-shape-1043/profiles.ts");
		const D = await import("/src/field-draw.ts");
		const M = await import("/src/asteroid-model.ts");
		const plan = A.systemFields(
			g.world.system.record,
			g.world.system.contents,
		).find((p) => p.profile === kind);
		if (!plan) throw new Error(`No ${kind} field`);
		const shapes = M.authoredRockShapes();
		if (!shapes) throw new Error("Authored shapes missing");
		const original = g.fields;
		for (const draw of original) draw.root.visible = false;
		const draws = {};
		const profiles = {};
		for (const name of S.CANDIDATES) {
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
			profiles[name] = S.candidateProfile(plan.profile, name);
		}
		const t0 = g.world.gameTime;
		const axis = A.rotateByQuat(plan.rotation, { x: 1, y: 0, z: 0 });
		const V3 = g.nearScene.position.constructor;
		g.orientation.setFromUnitVectors(
			new V3(0, 0, -1),
			new V3(axis.x, axis.y, axis.z),
		);
		let chosen = "baseline",
			view = "inside",
			quality = "high",
			field = true,
			t = 0;
		const point = () => {
			const rocks = draws[chosen].rocks;
			const largest = rocks.reduce((a, b) => (b.radiusKm > a.radiusKm ? b : a));
			const close = A.rockLocal(largest, g.world.gameTime);
			return view === "close"
				? { x: close.x - 1.2 * largest.radiusKm, y: close.y, z: close.z }
				: view === "inside"
					? { x: 1.8, y: 1.8, z: 1.8 }
					: view === "edge"
						? { x: -profiles[chosen].semiKm[0] - 2, y: 0, z: 0 }
						: { x: -224, y: 0, z: 0 };
		};
		const stand = () => {
			const centre = A.fieldCentre(plan, g.world.gameTime);
			const p = A.rotateByQuat(plan.rotation, point());
			const have = g.cameraPos();
			const ship = g.world.ship.pos;
			g.world.ship.pos = {
				x: ship.x + centre.x + p.x - have.x,
				y: ship.y + centre.y + p.y - have.y,
				z: ship.z + centre.z + p.z - have.z,
			};
		};
		window.__studyArm = (cfg) => {
			({ chosen, view, quality, field } = cfg);
			g.settings.set("quality", quality);
			for (const draw of Object.values(draws)) draw.root.visible = false;
			g.fieldDraws = field ? [draws[chosen]] : [];
			g.world.gameTime = t0;
			t = 0;
			for (let i = 0; i < 3; i++) {
				stand();
				g.render(0);
			}
		};
		window.__studyStep = () => {
			t = (t + 1 / 60) % 2;
			g.world.gameTime = t0 + t;
			stand();
			g.render(0);
		};
		window.__studyInfo = () => {
			const centre = A.fieldCentre(plan, g.world.gameTime);
			const local = A.rotateByQuat(plan.rotation, point());
			const have = g.cameraPos();
			const actual = {
				x: have.x - centre.x,
				y: have.y - centre.y,
				z: have.z - centre.z,
			};
			const missKm = Math.hypot(
				actual.x - local.x,
				actual.y - local.y,
				actual.z - local.z,
			);
			const direction = g.nearCamera.getWorldDirection(new V3());
			const offAxisDeg =
				(Math.acos(
					Math.max(
						-1,
						Math.min(
							1,
							direction.x * axis.x +
								direction.y * axis.y +
								direction.z * axis.z,
						),
					),
				) *
					180) /
				Math.PI;
			const r = g.renderer;
			const auto = r.info.autoReset;
			r.info.autoReset = false;
			r.info.reset();
			g.render(0);
			const stats = {
				calls: r.info.render.calls,
				triangles: r.info.render.triangles,
				levels: [...draws[chosen].perLevel],
				rocks: draws[chosen].rocks.length,
				missKm,
				offAxisDeg,
				askedKm: Math.hypot(local.x, local.y, local.z),
				actualKm: Math.hypot(actual.x, actual.y, actual.z),
			};
			r.info.autoReset = auto;
			return stats;
		};
		window.__studyScope = () => {
			g.view = "cockpit";
			g.render(0);
			g.updateCockpit();
			return g.scannerContacts.filter((c) => c.id === plan.id);
		};
		return {
			settings: { ...g.settings.value },
			plan: plan.id,
			clock: t0,
			profiles: Object.fromEntries(
				S.CANDIDATES.map((n) => [
					n,
					{ ...profiles[n], rocks: draws[n].rocks.length },
				]),
			),
		};
	}, kind);
	console.log(
		JSON.stringify({
			renderer: manifest.renderer,
			setup: manifest.setup,
			load: manifest.loadStart,
		}),
	);
	const shuffle = seededShuffler(orderSeed);
	const timed = async (cfg, occlusion) =>
		page.evaluate(
			([cfg, occlusion, frames]) => {
				const g = window.__seelite;
				window.__studyArm(cfg);
				g.setOcclusion(occlusion, occlusion);
				const gl = g.renderer.getContext(),
					sync = new Uint8Array(4);
				window.__studyStep();
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const start = performance.now();
				for (let i = 0; i < frames; i++) window.__studyStep();
				gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync);
				const ms = (performance.now() - start) / frames;
				if (!Number.isFinite(ms) || ms <= 0) throw new Error("Invalid timing");
				return ms;
			},
			[cfg, occlusion, frames],
		);
	for (const view of ["close", "inside", "edge", "far"])
		for (const quality of ["high", "low"])
			for (const occlusion of [false, true]) {
				const cases = Object.keys(manifest.setup.profiles).flatMap((chosen) =>
					[false, true].map((field) => ({ chosen, view, quality, field })),
				);
				const key = (cfg) => `${cfg.chosen}:${cfg.field}`;
				const samples = Object.fromEntries(cases.map((c) => [key(c), []]));
				for (const cfg of shuffle(cases)) await timed(cfg, occlusion);
				for (let b = 0; b < blocks; b++)
					for (const cfg of shuffle(cases))
						samples[key(cfg)].push(await timed(cfg, occlusion));
				for (const chosen of Object.keys(manifest.setup.profiles)) {
					const stats = {};
					for (const field of [false, true]) {
						await page.evaluate((cfg) => window.__studyArm(cfg), {
							chosen,
							view,
							quality,
							field,
						});
						stats[String(field)] = await page.evaluate(() =>
							window.__studyInfo(),
						);
						if (
							stats[String(field)].missKm > 1e-5 ||
							stats[String(field)].offAxisDeg > 0.01
						)
							throw new Error(`Framing drift ${JSON.stringify(stats)}`);
					}
					const yes = samples[`${chosen}:true`],
						no = samples[`${chosen}:false`];
					const deltaMs = median(yes) - median(no);
					if (
						(view === "inside" || view === "close") &&
						(stats.true.calls <= stats.false.calls ||
							stats.true.levels.reduce((a, b) => a + b, 0) === 0)
					)
						throw new Error(
							`Candidate field arm drew nothing: ${chosen} ${view} ${quality}`,
						);
					const row = {
						chosen,
						view,
						quality,
						occlusion,
						medianMs: median(yes),
						controlMs: median(no),
						deltaMs,
						separation: separation(yes, no),
						samples: { field: yes, control: no },
						stats: stats.true,
						deltaCalls: stats.true.calls - stats.false.calls,
					};
					manifest.rows.push(row);
					console.log(JSON.stringify(row));
					if (captures && !occlusion) {
						const file = `${chosen}-${view}-${quality}.png`;
						await page.screenshot({ path: join(out, file) });
						manifest.captures.push({ chosen, view, quality, file });
					}
					writeFileSync(
						join(out, "manifest.json"),
						JSON.stringify(manifest, null, 2),
					);
				}
			}
	if (captures)
		for (const chosen of Object.keys(manifest.setup.profiles)) {
			await page.evaluate((cfg) => window.__studyArm(cfg), {
				chosen,
				view: "inside",
				quality: "high",
				field: true,
			});
			const contacts = await page.evaluate(() => window.__studyScope());
			const file = `${chosen}-scope.png`;
			await page.screenshot({ path: join(out, file) });
			manifest.captures.push({
				chosen,
				view: "scope",
				quality: "high",
				file,
				contacts,
			});
			await page.evaluate(() => {
				window.__seelite.view = "chase";
			});
		}
	manifest.loadEnd = loadavg();
	writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
	const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
	let html = `<!doctype html><meta charset="utf-8"><title>Field shape1043</title><style>body{background:#10151d;color:#dde4ee;font:15px system-ui;margin:24px}h2{margin-top:30px}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}figure{margin:0}img{width:100%}p{max-width:1000px}figcaption{margin:5px}table{border-collapse:collapse}td,th{padding:5px 12px;border:1px solid #456}</style><h1>Field shape comparison1043</h1><p>Study candidates, no approved profile. ${esc(manifest.renderer)}. World0x5ee11e system${system} ${kind}, clock${manifest.setup.clock}. Production FieldDraw and authored rocks, 1440×900 at device scale2. Far: same224km centre distance; edge:2km beyond each profile's own long semi-axis; inside:same1.8km per coordinate; close:1.2 radii from each profile's largest rock. Camera miss and off-axis verified per row. The scope shows field centres only; profile density is not represented there.</p>`;
	for (const view of ["far", "edge", "inside", "close", "scope"]) {
		html += `<h2>${view}</h2>`;
		for (const quality of view === "scope" ? ["high"] : ["high", "low"]) {
			html += `<h3>${quality}</h3><div class="row">`;
			for (const c of manifest.captures.filter(
				(c) => c.view === view && c.quality === quality,
			))
				html += `<figure><a href="${c.file}"><img src="${c.file}" loading="lazy"></a><figcaption>${c.chosen}: ${manifest.setup.profiles[c.chosen].rocks} rocks</figcaption></figure>`;
			html += "</div>";
		}
	}
	html +=
		"<h2>Frame cost above matched no-field control</h2><table><tr><th>Profile</th><th>View</th><th>Quality</th><th>Occlusion</th><th>Δms</th><th>Pair separation</th><th>Δcalls</th></tr>";
	for (const r of manifest.rows)
		html += `<tr><td>${r.chosen}</td><td>${r.view}</td><td>${r.quality}</td><td>${r.occlusion}</td><td>${r.deltaMs.toFixed(3)}</td><td>${r.separation}</td><td>${r.deltaCalls}</td></tr>`;
	writeFileSync(join(out, "index.html"), html + "</table>");
} finally {
	await browser?.close();
	await server.close();
	release();
}
