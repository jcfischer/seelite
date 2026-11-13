/**
 * https://github.com/jcfischer/seelite/issues/1234 — the cockpit Navigation
 * list's frame budget on a populated charted field, measured on the real loop
 * with and without `?mining=1`.
 *
 *   SEELITE_PROBE_RENDERER=hardware node scripts/measure-mining-nav-budget.mjs
 *   ANTIALIAS=2 BLOCKS=6 FRAMES=120 node scripts/measure-mining-nav-budget.mjs
 *
 * The budget is the principal's ruling of 2026-11-13 (via #1242): on the
 * populated charted cockpit path with `?mining=1` the whole frame stays at or
 * under 16.7 ms, paint included, measured on the quiet hardware GPU lane
 * against a paired run of the same path with the flag off. Interaction latency
 * was not ruled on; this instrument measures it and prints it beside the table.
 *
 * ## What the number is
 *
 * Two pages of one world, one field and one stand: the flag on and the flag
 * off. Each block brings its page to the front, re-stands the ship at the same
 * cleared point in the same drifting motion, lets 20 frames warm the arm, and
 * then reads `FRAMES` `requestAnimationFrame` intervals with the game clock
 * running. **The display's pacing is deliberately left on.** That is the only
 * view a frame cost has that carries paint and compositing: a frame that fits
 * is presented on its refresh, and one that does not is presented late or
 * skipped, so a missed frame shows up as an interval past `LATE_FRAME_MS`
 * rather than as a number nobody can see. Each pass records how many of its
 * intervals were late and how many it read, and the share the budget is judged
 * on is those counts summed, never a median of the passes' shares — see
 * `lib/mining-nav-budget.mjs`. `--disable-gpu-vsync` was tried and
 * withdrawn: with the pacing lifted, `requestAnimationFrame` runs ahead of the
 * presented frame and the interval stops containing the frame's own cost at
 * all, which read 14.2 ms of period beside 15.0 ms of main-thread work in one
 * arm.
 *
 * Beside the whole-frame interval, Chrome's own counters give the main-thread
 * split over the same frames: task, script, recalc-style and layout. Paint
 * recording is inside the task; raster and compositing are inside the interval.
 *
 * The arms:
 * - `nav-mining` — `?mining=1`, the Navigation tab at the densest stand,
 *   drifting 50 m/s through the cluster, every rock surveyed so every row is
 *   populated.
 * - `nav-off` — the same path, camera and tab with the flag off: the same
 *   flight, and the list a pilot without mining sees.
 * - `forward-mining` — `?mining=1` with the head forward, so the tab is unseen
 *   and no rows are built. The list's own cost, inside the flag.
 *
 * A row's press is timed from the dispatch to the frame that shows it selected.
 * The stand, the cockpit camera and the local density are printed for each arm.
 *
 * **Both pages fit the same prototype mining loadout**, which is the state
 * `?mining=1` boots a miner in. The flag-off page keeps it so that the only
 * difference between the two pages is the flag, and it makes the flag's added
 * cost the conservative reading: the baseline carries the laser it would not
 * otherwise be issued.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, loadavg } from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";
import { gameUrl } from "./lib/game-url.mjs";
import { median, seededShuffler } from "./lib/measurement.mjs";
import {
	assertControlHeld,
	LATE_FRAME_MS,
	summarizeMiningNavBudget,
} from "./lib/mining-nav-budget.mjs";
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
const WARM = 20;
const WORLD = Number(process.env.WORLD ?? 0x5ee11e);
const SYSTEM = Number(process.env.SYSTEM ?? 173);
const KIND = process.env.KIND ?? "charted";
const ANTIALIAS = Number(process.env.ANTIALIAS ?? 0);
const ORDER_SEED = Number(process.env.ORDER_SEED ?? 1234);
const MAX_LOAD = Number(process.env.MAX_LOAD ?? 5);
const PRESSES = Number(process.env.PRESSES ?? 12);
const port = Number(process.env.PORT ?? 5204);
const OUTPUT = resolve(
	process.env.OUTPUT ?? "/tmp/seelite-mining-nav-budget-1234",
);
for (const [name, value] of Object.entries({ FRAMES, BLOCKS, PRESSES }))
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`invalid ${name}: ${value}`);
if (![0, 2, 4].includes(ANTIALIAS))
	throw new Error(`invalid ANTIALIAS: ${ANTIALIAS}`);
if (!Number.isFinite(MAX_LOAD) || MAX_LOAD <= 0)
	throw new Error(`invalid MAX_LOAD: ${MAX_LOAD}`);
if (FRAMES < 120)
	console.warn(
		`  warning: FRAMES=${FRAMES} is a plumbing run, not a reading. A pass that short is dominated by the frames just after its ship is re-stood: the same scene at FRAMES=60 read 8.5% late and 10.17 ms of task, where 119-interval passes read none and 6.63 ms.`,
	);

const releaseLock = await holdProbeLockOrExit("mining navigation frame budget");
const host = { cores: cpus().length, before: loadavg(), samples: [] };
const quiet = (stage) => {
	const load = loadavg();
	host.samples.push(load);
	if (load[0] > MAX_LOAD)
		throw new Error(
			`quiet-host condition lost ${stage}: load ${load[0].toFixed(2)} > ${MAX_LOAD}`,
		);
};
quiet("at start");

const provenance = {
	head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	sourceSha256: createHash("sha256")
		.update(await readFile(new URL(import.meta.url)))
		.digest("hex"),
	startedAt: new Date().toISOString(),
};

const SETUP = async ({ kind, aa, worldSeed, systemIndex }) => {
	const A = await import("/src/asteroid-field.ts");
	const C = await import("/scripts/lib/frame-control.mjs");
	const F = await import("/scripts/lib/field-stands.mjs");
	const L = await import("/src/field-lod.ts");
	const T = await import("/src/rock-target.ts");
	const g = window.__seelite;
	g.settings.set("quality", "high");
	g.settings.set("antialias", aa);
	g.setOcclusion();
	g.keys.clear();
	if (g.fitPrototypeMiningLaser) g.fitPrototypeMiningLaser(true);
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
	C.installFrameControl(window);
	const place = (p, v) => window.__placeShipAt(p, v);
	window.__arm = async (arm) => {
		g.view = "cockpit";
		g.leftTab = "Navigation";
		g.setHeadLook(arm === "forward-mining" ? "forward" : "left");
		await place(world(stand, g.world.gameTime), moving());
		g.updateLocalFrameBody();
		if (arm !== "nav-off") {
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
		const local = L.fieldCameraLocal(plan, g.world.gameTime, camera);
		const rows = g.navRows();
		const rockRows = rows.filter((r) => r.kind === "rock");
		const navList = document.querySelector("[data-live-nav-list]");
		const box = navList?.getBoundingClientRect();
		const inView = navList
			? [...navList.children].filter((li) => {
					const r = li.getBoundingClientRect();
					return box && r.bottom > box.top && r.top < box.bottom;
				}).length
			: 0;
		return {
			arm,
			frame: g.frameField?.id ?? null,
			headLook: g.headLook,
			cameraLocalKm: [local.x, local.y, local.z].map((v) => +v.toFixed(3)),
			fov: g.nearCamera.fov,
			within8Km: rocks.filter(
				(r) => dist(A.rockLocal(r, g.world.gameTime), local) < 8,
			).length,
			navRows: rows.length,
			rockRows: rockRows.length,
			disabledRows: rows.filter((r) => r.disabledReason).length,
			domRows: document.querySelectorAll("[data-live-nav-target]").length,
			domRowsInView: inView,
			gate: g.occlusionState.open,
			ao: g.occlusionState.aoOpen,
			levels: [...draw.perLevel],
			fieldVisible: draw.root.visible,
			fieldMeshes: draw.meshesInstalled,
			gameTime: g.world.gameTime,
			renderScale: g.settings.value.resolution,
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
	return {
		rocks: rocks.length,
		plan: plan.id,
		stand,
		field: { world: worldSeed, system: systemIndex, kind },
	};
};

const server = await createServer({
	server: {
		host: "127.0.0.1",
		port,
		strictPort: true,
		hmr: false,
		watch: null,
	},
	cacheDir: "node_modules/.vite-mining-nav-budget",
});
await server.listen();
const origin = `http://127.0.0.1:${port}`;
await guardedOrigin(origin);
const browser = await launchChromium({ headless: false });

const errors = [];
const metered = async (cdp) =>
	Object.fromEntries(
		(await cdp.send("Performance.getMetrics")).metrics.map((m) => [
			m.name,
			m.value,
		]),
	);

const openPage = async (mining) => {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 2,
	});
	page.on("pageerror", (error) => errors.push(error.message));
	await installViewPlacement(page);
	await page.bringToFront();
	await page.goto(
		gameUrl(origin, {
			seed: WORLD,
			system: SYSTEM,
			"no-save": true,
			"models-full": true,
			voices: "formant",
			raider: "off",
			cinematic: false,
			...(mining ? { mining: 1 } : {}),
		}),
	);
	try {
		await bootedGame(page, 180000);
	} catch (error) {
		console.error(
			"boot did not complete:",
			JSON.stringify(
				await page.evaluate(() => ({
					frames: window.__seelite?.frames,
					skyPending: window.__seelite?.nebulaPending,
				})),
			),
			errors.join("; "),
		);
		throw error;
	}
	const renderer = await assertPlayersRenderer(
		page,
		"measure navigation frame",
	);
	await page.waitForFunction(
		() => window.__seelite.modelsSettled(),
		undefined,
		{ timeout: 180000 },
	);
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Performance.enable");
	const names = (await cdp.send("Performance.getMetrics")).metrics.map(
		(m) => m.name,
	);
	for (const wanted of [
		"TaskDuration",
		"ScriptDuration",
		"RecalcStyleDuration",
		"LayoutDuration",
	])
		if (!names.includes(wanted))
			throw new Error(`Chrome reports no ${wanted}: ${names.join(", ")}`);
	return {
		page,
		renderer,
		cdp,
		setup: await page.evaluate(SETUP, {
			kind: KIND,
			aa: ANTIALIAS,
			worldSeed: WORLD,
			systemIndex: SYSTEM,
		}),
	};
};

const samples = Object.fromEntries(
	["nav-mining", "nav-off", "forward-mining"].map((arm) => [
		arm,
		{
			period: [],
			task: [],
			script: [],
			style: [],
			layout: [],
			late: [],
			frames: [],
		},
	]),
);
const fastest = [];
const facts = {};
const presses = { "nav-mining": [], "nav-off": [] };
const pageOf = { "nav-mining": "on", "forward-mining": "on", "nav-off": "off" };
try {
	const on = await openPage(true);
	await on.page.evaluate(() => window.__hold());
	const off = await openPage(false);
	await on.page.evaluate(() => window.__resume());
	const pages = { on, off };
	console.log(`  renderer: ${on.renderer}`);
	console.log(
		`  field: world 0x${WORLD.toString(16)} system ${SYSTEM} ${on.setup.plan}, ${on.setup.rocks} rocks, antialias ${ANTIALIAS}, quality high`,
	);
	if (on.setup.plan !== off.setup.plan || on.setup.rocks !== off.setup.rocks)
		throw new Error(
			`the two pages are not the same field: ${JSON.stringify([on.setup, off.setup])}`,
		);

	/**
	 * https://github.com/jcfischer/seelite/issues/1234 — stop the page that is
	 * not being measured, and prove it stopped. Bringing a page to the front
	 * does not stop the one behind it: both tabs kept drawing 736 frames inside
	 * one arm of the first run. The hold replaces the page's
	 * `requestAnimationFrame` with a recorder, so nothing new is scheduled and
	 * the loop dies on its next tick; `__resume` gives the loop back. Both
	 * readings are compared, my frame counter and the game's clock, because a
	 * page whose loop was still turning would be a second copy of the game
	 * pricing the arm. Up to three attempts, because one pending callback can
	 * land after the first hold.
	 */
	const holdOther = async (target, side) => {
		for (let attempt = 0; attempt < 3; attempt++) {
			await target.evaluate(() => window.__hold());
			await new Promise((r) => setTimeout(r, 200));
			const before = await target.evaluate(() => window.__holdState());
			await new Promise((r) => setTimeout(r, 250));
			const after = await target.evaluate(() => window.__holdState());
			if (before.frames === after.frames && before.gameTime === after.gameTime)
				return after;
		}
		throw new Error(
			`the ${side === "on" ? "off" : "on"}-flag page would not hold still: ${JSON.stringify(await target.evaluate(() => window.__holdState()))}`,
		);
	};
	const runArm = async (arm, side) => {
		const active = pages[side];
		const other = pages[side === "on" ? "off" : "on"];
		await active.page.bringToFront();
		const drawnBefore = await holdOther(other.page, side);
		facts[arm] = await active.page.evaluate((a) => window.__arm(a), arm);
		await active.page.evaluate((n) => window.__frames(n), WARM);
		const counters = await metered(active.cdp);
		const deltas = await active.page.evaluate(
			(n) => window.__frames(n),
			FRAMES,
		);
		const after = await metered(active.cdp);
		const moved = await other.page.evaluate(() => window.__holdState());
		await other.page.evaluate(() => window.__resume());
		if (
			moved.frames !== drawnBefore.frames ||
			moved.gameTime !== drawnBefore.gameTime
		)
			throw new Error(
				`the ${side === "on" ? "off" : "on"}-flag page was not idle inside the ${arm} arm: ${JSON.stringify({ before: drawnBefore, after: moved })}`,
			);
		const per = (name) =>
			((after[name] - counters[name]) * 1000) / deltas.length;
		fastest.push(Math.min(...deltas));
		samples[arm].period.push(median(deltas));
		samples[arm].late.push(deltas.filter((ms) => ms > LATE_FRAME_MS).length);
		samples[arm].frames.push(deltas.length);
		samples[arm].task.push(per("TaskDuration"));
		samples[arm].script.push(per("ScriptDuration"));
		samples[arm].style.push(per("RecalcStyleDuration"));
		samples[arm].layout.push(per("LayoutDuration"));
	};

	const shuffled = seededShuffler(ORDER_SEED);
	for (const arm of ["nav-mining", "nav-off", "forward-mining"])
		await runArm(arm, pageOf[arm]);
	for (let block = 0; block < BLOCKS; block++) {
		quiet(`in block ${block + 1} of ${BLOCKS}`);
		for (const arm of shuffled(["nav-mining", "nav-off", "forward-mining"]))
			await runArm(arm, pageOf[arm]);
	}

	for (const [arm, side] of [
		["nav-mining", "on"],
		["nav-off", "off"],
	]) {
		const active = pages[side];
		const other = pages[side === "on" ? "off" : "on"];
		await active.page.bringToFront();
		await holdOther(other.page, side);
		facts[arm] = await active.page.evaluate((a) => window.__arm(a), arm);
		await active.page.evaluate((n) => window.__frames(n), WARM);
		for (let i = 0; i < PRESSES; i++)
			presses[arm].push(await active.page.evaluate(() => window.__press()));
		await other.page.evaluate(() => window.__resume());
	}

	const summary = assertControlHeld(summarizeMiningNavBudget(samples));
	console.log(
		`  display: fastest interval seen this run ${Math.min(...fastest).toFixed(2)} ms; a frame past ${LATE_FRAME_MS} ms is late`,
	);
	console.log(
		"  arm             period    late    task  script   style  layout  (ms per frame and late share, medians of block periods and pooled late frames)",
	);
	for (const row of summary.rows) {
		const meter = (ms) => ms.toFixed(2).padStart(7);
		console.log(
			`  ${row.arm.padEnd(15)} ${meter(row.period)} ${`${(row.lateShare * 100).toFixed(1)}%`.padStart(7)} ${meter(row.task)} ${meter(row.script)} ${meter(row.style)} ${meter(row.layout)}   ${row.lateFrames} late of ${row.frames} frames   ${JSON.stringify(facts[row.arm])}`,
		);
	}
	const pair = (label, key) => {
		const added = summary.added[key];
		console.log(
			`  ${label}: period ${added.period.addedMs.toFixed(2)} ms (${added.period.separation}), ` +
				`task ${added.task.addedMs.toFixed(2)} (${added.task.separation}), ` +
				`layout ${added.layout.addedMs.toFixed(2)}, style ${added.style.addedMs.toFixed(2)}`,
		);
	};
	pair("added over the flag off", "overOff");
	pair("added over the control, head forward", "overControl");
	for (const [arm, list] of Object.entries(presses))
		console.log(
			`  row press to the frame showing it, ${arm}: median ${median(list).toFixed(1)} ms, max ${Math.max(...list).toFixed(1)} ms over ${list.length}`,
		);
	console.log(
		`  whole frame ${summary.verdict.wholeFrameMs.toFixed(2)} ms against the ${summary.budgetMs} ms budget: ${summary.verdict.line}`,
	);

	await mkdir(OUTPUT, { recursive: true });
	await writeFile(
		`${OUTPUT}/summary.json`,
		JSON.stringify(
			{
				provenance,
				host: { ...host, after: loadavg(), maxLoad: MAX_LOAD },
				renderer: on.renderer,
				frame: on.setup.field,
				antialias: ANTIALIAS,
				quality: "high",
				viewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
				frames: FRAMES,
				warmFrames: WARM,
				blocks: BLOCKS,
				orderSeed: ORDER_SEED,
				method:
					"requestAnimationFrame intervals on the live loop with the clock running and the display's pacing left on, so a frame that missed its refresh reads as a late interval; whole-frame interval includes paint and compositing; main-thread split from Chrome's own counters over the same frames",
				lateFrameMs: LATE_FRAME_MS,
				fastestIntervalMs: Math.min(...fastest),
				samples,
				facts,
				presses,
				summary,
				errors,
			},
			null,
			2,
		),
	);
	if (errors.length) throw new Error(`page errors: ${errors.join("; ")}`);
} finally {
	await browser.close();
	await server.close();
	releaseLock();
}
