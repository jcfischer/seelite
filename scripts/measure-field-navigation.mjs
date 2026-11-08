/**
 * https://github.com/jcfischer/seelite/issues/1209 — the populated cockpit Navigation path in a production
 * field, flown on the real animation loop.
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/measure-field-navigation.mjs
 *   SYSTEM=0 KIND=rare ANTIALIAS=2 BLOCKS=6 FRAMES=120 node scripts/measure-field-navigation.mjs
 *
 * Headed on the hardware lane, 1440x900 at device scale 2, with `?mining=1`, the
 * only way a player reaches rock rows. Every arm runs `requestAnimationFrame`
 * frames of the live loop with the clock running, so it includes flight, the
 * collision sweep and the deferred browser work a tight loop misses. Script,
 * style and layout per frame come from the browser's own counters over a block,
 * and the frame period from the rAF deltas, which vsync floors.
 *
 * - `nav-field`: the Navigation tab at the densest stand, drifting 50 m/s through
 *   the cluster, every rock surveyed so every row is populated.
 * - `forward-field`: the same flight with the head forward, the tab unseen.
 * - `nav-open`: the Navigation tab far from any field, the paired control.
 *
 * A row's press is timed from dispatch to the frame that shows it selected. The
 * stand, the cockpit camera and the local density are printed for each arm.
 */
import { loadavg } from "node:os";
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler } from "./lib/measurement.mjs";
import { assertPlayersRenderer } from "./lib/players-renderer.mjs";
import { holdProbeLockOrExit } from "./lib/probe-lock.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
} from "./probe-guard.mjs";

const FRAMES = Number(process.env.FRAMES ?? 120);
const BLOCKS = Number(process.env.BLOCKS ?? 6);
const WORLD = Number(process.env.WORLD ?? 0x5ee11e);
const SYSTEM = Number(process.env.SYSTEM ?? 173);
const KIND = process.env.KIND ?? "charted";
const ANTIALIAS = Number(process.env.ANTIALIAS ?? 0);
const port = Number(process.env.PORT ?? 5202);
const ARMS = ["nav-field", "forward-field", "nav-open"];

const releaseLock = await holdProbeLockOrExit("field navigation cost");
console.log("  host load average at start:", loadavg().join(" / "));
const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-field-navigation",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });

const SETUP = async ({ kind, aa }) => {
	const A = await import("/src/asteroid-field.ts");
	const F = await import("/scripts/lib/field-stands.mjs");
	const T = await import("/src/rock-target.ts");
	const g = window.__seelite;
	g.settings.set("quality", "high");
	g.settings.set("antialias", aa);
	g.setOcclusion();
	g.keys.clear();
	g.fitPrototypeMiningLaser(true);
	const draw = g.fields.find((d) => d.plan.profile === kind);
	if (!draw) throw new Error(`system has no ${kind} field`);
	const { plan, rocks } = draw;
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
	const peak = F.densestRock(rocks).rock;
	const stand = F.clearStandBeside(peak.anchor, (p) =>
		rocks.every((r) => dist(p, r.anchor) > r.radiusKm + r.driftKm + 0.2),
	);
	if (!stand) throw new Error("no clear dense stand");
	const world = (local, t) => {
		const c = A.fieldCentre(plan, t);
		const r = A.rotateByQuat(plan.rotation, local);
		return { x: c.x + r.x, y: c.y + r.y, z: c.z + r.z };
	};
	const drift = A.rotateByQuat(plan.rotation, { x: -0.05, y: 0, z: 0 });
	const moving = () => {
		const v = A.fieldCentreVelocity(plan, g.world.gameTime);
		return { x: v.x + drift.x, y: v.y + drift.y, z: v.z + drift.z };
	};
	const place = (p, v) => window.__placeShipAt(p, v);
	window.__arm = async (arm) => {
		g.view = "cockpit";
		g.leftTab = "Navigation";
		g.setHeadLook(arm === "forward-field" ? "forward" : "left");
		if (arm === "nav-open")
			await place(
				world({ x: 0, y: 0, z: 2 * g.units.NEAR_FAR_KM }, g.world.gameTime),
				moving(),
			);
		else await place(world(stand, g.world.gameTime), moving());
		g.updateLocalFrameBody();
		if (arm !== "nav-open") {
			const refs = T.nearRocks(
				[draw],
				g.world.ship.pos,
				g.world.gameTime,
				Number.POSITIVE_INFINITY,
			);
			for (const ref of refs)
				if (g.rockDepositRow(ref)?.surveyedAt === undefined)
					g.putDepositRow(ref, {
						...g.rockDepositRow(ref),
						surveyedAt: g.world.gameTime,
					});
			g.targetId = refs[0].id;
		} else g.targetId = null;
		g.updateCockpit();
		const camera = g.cameraPos();
		const centre = A.fieldCentre(plan, g.world.gameTime);
		const local = A.rotateByQuat(
			{
				x: -plan.rotation.x,
				y: -plan.rotation.y,
				z: -plan.rotation.z,
				w: plan.rotation.w,
			},
			{
				x: camera.x - centre.x,
				y: camera.y - centre.y,
				z: camera.z - centre.z,
			},
		);
		const rows = g.navRows().filter((r) => r.kind === "rock");
		return {
			arm,
			frame: g.frameField?.id ?? null,
			cameraLocalKm: [local.x, local.y, local.z].map((v) => +v.toFixed(3)),
			fov: g.nearCamera.fov,
			within8Km: rocks.filter(
				(r) => dist(A.rockLocal(r, g.world.gameTime), local) < 8,
			).length,
			rockRows: rows.length,
			disabledRows: rows.filter((r) => r.disabledReason).length,
			domRows: document.querySelectorAll("[data-live-nav-target]").length,
			gate: g.occlusionState.open,
			ao: g.occlusionState.aoOpen,
			levels: [...draw.perLevel],
		};
	};
	window.__frames = (count) =>
		new Promise((resolve) => {
			const deltas = [];
			let last = performance.now();
			const tick = () => {
				const now = performance.now();
				deltas.push(now - last);
				last = now;
				if (deltas.length >= count) resolve(deltas.slice(1));
				else requestAnimationFrame(tick);
			};
			requestAnimationFrame(tick);
		});
	window.__press = async () => {
		const rows = [
			...document.querySelectorAll("[data-live-nav-target]"),
		].filter((e) => e.dataset.liveNavTarget !== g.targetId && !e.disabled);
		const row = rows[Math.floor(rows.length / 2)];
		const wanted = row.dataset.liveNavTarget;
		const started = performance.now();
		row.click();
		for (let frames = 0; frames < 60; frames++) {
			await new Promise((r) => requestAnimationFrame(r));
			if (g.targetId === wanted) {
				await new Promise((r) => requestAnimationFrame(r));
				return performance.now() - started;
			}
		}
		throw new Error(`pressing ${wanted} did not select it`);
	};
	return { rocks: rocks.length, plan: plan.id };
};

const pageErrors = [];
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
	});
	page.on("pageerror", (e) => pageErrors.push(e.message));
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, {
			seed: WORLD,
			system: SYSTEM,
			"no-save": true,
			"models-full": true,
			voices: "formant",
			raider: "off",
			cinematic: false,
			mining: 1,
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
	const setup = await page.evaluate(SETUP, { kind: KIND, aa: ANTIALIAS });
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	const metrics = async () =>
		Object.fromEntries(
			(await cdp.send("Performance.getMetrics")).metrics.map((m) => [
				m.name,
				m.value,
			]),
		);
	console.log(`  renderer: ${renderer}`);
	console.log(
		`  field: world 0x${WORLD.toString(16)} system ${SYSTEM} ${setup.plan}, ${setup.rocks} rocks, antialias ${ANTIALIAS}, quality high`,
	);
	const samples = Object.fromEntries(
		ARMS.map((a) => [
			a,
			{ period: [], script: [], style: [], layout: [], task: [] },
		]),
	);
	const facts = {};
	const shuffled = seededShuffler(1209);
	for (const arm of ARMS) await page.evaluate((a) => window.__arm(a), arm);
	for (let b = 0; b < BLOCKS; b++)
		for (const arm of shuffled(ARMS)) {
			facts[arm] = await page.evaluate((a) => window.__arm(a), arm);
			await page.evaluate(() => window.__frames(20));
			const before = await metrics();
			const deltas = await page.evaluate((n) => window.__frames(n), FRAMES);
			const after = await metrics();
			const per = (name) =>
				((after[name] - before[name]) * 1000) / deltas.length;
			samples[arm].period.push(median(deltas));
			samples[arm].script.push(per("ScriptDuration"));
			samples[arm].style.push(per("RecalcStyleDuration"));
			samples[arm].layout.push(per("LayoutDuration"));
			samples[arm].task.push(per("TaskDuration"));
		}
	console.log(
		"  arm            period  script   style  layout    task  (ms per frame, medians of block figures)",
	);
	for (const arm of ARMS) {
		const s = samples[arm];
		console.log(
			`  ${arm.padEnd(13)} ${[s.period, s.script, s.style, s.layout, s.task]
				.map((x) => median(x).toFixed(2).padStart(7))
				.join(
					" ",
				)}   task range ${Math.min(...s.task).toFixed(2)}–${Math.max(...s.task).toFixed(2)}`,
		);
		console.log(`    ${JSON.stringify(facts[arm])}`);
	}
	await page.evaluate(() => window.__arm("nav-field"));
	const presses = [];
	for (let i = 0; i < 24; i++)
		presses.push(await page.evaluate(() => window.__press()));
	if (pageErrors.length)
		throw new Error(`page errors: ${pageErrors.join("; ")}`);
	console.log(
		`  row press to the frame showing it: median ${median(presses).toFixed(1)} ms, max ${Math.max(...presses).toFixed(1)} ms over ${presses.length}`,
	);
} finally {
	await browser.close();
	await server.close();
	console.log("  host load average at end:", loadavg().join(" / "));
	releaseLock();
}
