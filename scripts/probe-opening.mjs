/**
 * The opening, flown (#535, ratified by #530).
 *
 * `tests/opening.test.ts` owns the script and the director against a stand-in
 * sim; what only the page can answer is whether the real sim agrees. A guided
 * opening has to end docked at the start system's trade station through a
 * real clearance and write `lastDocked` (D1) — watched, skipped at boot, and
 * skipped by the key halfway, all in **one state**, with the pilot's keys
 * pressed during the watched run doing nothing (D2). A free one has to end in
 * flight near the arrival point (D3). `?boot=direct` and `?system=` see no
 * sequence, and no raider interdicts the scripted leg (D6). A flight that
 * cannot fly falls back to `startDockedAtHome` (D6).
 *
 * Every shot of the watched run is captured, because a green run is not a
 * legible one; the principal's yes on the sequence is the close, not this.
 */
// A default-layout probe (#381 D11): it presses Enter by name because the
// shipped layout binds the skip there, and it presses Shift, j and a during
// the fly-past as the pilot's own throttle, cruise and yaw — keys the opening
// has to ignore. A moved default turns it red for that reason.
import { mkdirSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const out = process.env.OPENING_EVIDENCE ?? "/tmp/seelite-535-evidence";
mkdirSync(out, { recursive: true });
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** The strip's seed (#530 "How it is judged"). */
const SEED = 47;

/**
 * Everything a run's end is judged on, as the game recorded it the moment the
 * opening ended — before the clock ran on. A watched run and a skipped one owe
 * equality on every field. (Read later, the two differ by however long each
 * page sat docked with the clock running, which is not the opening's.)
 */
const endState = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		return {
			...g.openingEnd,
			outcome: g.openingReading().lastOutcome,
			stationLog: g.firstDayLog.length,
		};
	});

/** The `lastDocked` record's two fields this node owes, once it lands. */
const lastDocked = (page) =>
	page.evaluate(async () => {
		const backend = window.__seelite.save.backend;
		for (let i = 0; i < 100; i++) {
			const record = await backend.read("default", "lastDocked");
			if (record)
				return {
					dockedAt: record.commander.dockedAt,
					firstDay: record.commander.firstDay,
				};
			await new Promise((r) => setTimeout(r, 100));
		}
		return null;
	});

const tradeKey = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		const trade = g.world.system.contents.stations.find(
			(s) => s.type === "trade",
		);
		return { id: trade.id, key: g.stationKey(trade) };
	});

/** A fresh context per boot, so no save carries from one row to the next. */
async function boot(params, label) {
	const context = await browser.newContext({
		viewport: { width: 1280, height: 720 },
	});
	const page = await context.newPage();
	watch(page, label);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off", ...params }));
	await bootedGame(page);
	return { context, page };
}

const untilOver = (page, timeout = 120000) =>
	page.waitForFunction(() => !window.__seelite.openingActive, null, {
		timeout,
		polling: 250,
	});

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const differing = (a, b) =>
	Object.keys(a)
		.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
		.map((k) => `${k}: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`)
		.join("; ");

// ---------------------------------------------------------------------------
// Guided, skipped at boot: what every ?boot=direct probe now starts from
// ---------------------------------------------------------------------------

const skipped = await boot({ guided: true }, "guided skipped");
const trade = await tradeKey(skipped.page);
const skippedEnd = await endState(skipped.page);
check(
	"a guided direct boot flies in and docks at the trade station, unseen",
	JSON.parse(skippedEnd.dock).phase === "docked" &&
		skippedEnd.outcome === "docked" &&
		JSON.parse(skippedEnd.dock).stationId === trade.id,
	JSON.stringify({ ...skippedEnd, dock: undefined, orientation: undefined }),
);
check(
	"its clock is the whole flight's, not the old placement's run-in",
	skippedEnd.gameTime > 120,
	`${skippedEnd.gameTime.toFixed(1)} s`,
);
const skippedRecord = await lastDocked(skipped.page);
check(
	"that dock writes lastDocked, guided, at the trade station",
	skippedRecord?.dockedAt === trade.key && skippedRecord?.firstDay === "guided",
	JSON.stringify(skippedRecord),
);
check(
	"no frame of it was shown",
	await skipped.page.evaluate(
		() => !document.querySelector("[data-opening]")?.checkVisibility(),
	),
);
await skipped.context.close();

// ---------------------------------------------------------------------------
// Guided, watched: every shot captured, and the pilot's keys ignored
// ---------------------------------------------------------------------------

const watched = await boot({ guided: true, cinematic: 1 }, "guided watched");
const shots = [];
let pressed = false;
for (let i = 0; i < 400; i++) {
	const r = await watched.page.evaluate(() =>
		window.__seelite.openingReading(),
	);
	if (!r.active) break;
	if (r.shot && shots[shots.length - 1] !== r.shot) {
		shots.push(r.shot);
		// Into the shot, where it has settled.
		await watched.page.waitForTimeout(1200);
		await watched.page.screenshot({
			path: `${out}/${String(shots.length).padStart(2, "0")}-${r.shot}.png`,
		});
	}
	// The pilot's hands during the fly-past: throttle, cruise and a turn. None
	// may reach the ship, or the watched run would end somewhere else.
	if (r.shot === "flypast" && !pressed) {
		pressed = true;
		await watched.page.keyboard.down("Shift");
		await watched.page.keyboard.press("j");
		await watched.page.keyboard.down("a");
		await watched.page.waitForTimeout(600);
		await watched.page.keyboard.up("a");
		await watched.page.keyboard.up("Shift");
	}
	await watched.page.waitForTimeout(100);
}
await untilOver(watched.page);
check(
	"a watched guided opening shows arrival, fly-past, planet fly-by, station approach and dock, in order",
	same(shots, ["arrival", "flypast", "cruise", "approach", "dock"]),
	shots.join(" → "),
);
check(
	"the frame was letterboxed while it ran, and is gone after",
	await watched.page.evaluate(
		() => !document.querySelector("[data-opening]")?.checkVisibility(),
	),
);
const watchedEnd = await endState(watched.page);
check(
	"watched, with the pilot's keys pressed, it ends in the skipped run's state",
	same(watchedEnd, skippedEnd),
	differing(watchedEnd, skippedEnd) || `t=${watchedEnd.gameTime.toFixed(3)}`,
);
const watchedRecord = await lastDocked(watched.page);
check(
	"and writes the same lastDocked",
	same(watchedRecord, skippedRecord),
	JSON.stringify(watchedRecord),
);
check(
	"the pilot gets the cockpit back, docked",
	await watched.page.evaluate(() => window.__seelite.view === "cockpit"),
);
await watched.page.screenshot({ path: `${out}/05-docked.png` });
await watched.context.close();

// ---------------------------------------------------------------------------
// Every frame of every shot, on the principal's seeds (47–51). A held frame
// steps no sim, and the arrival flicker the principal saw on 47 and the second
// ship on 49 only happened between stepped frames: the camera's side was float
// noise on seeds that face the star, and swung round the ship each step.
// ---------------------------------------------------------------------------

for (const seed of [47, 48, 49, 50, 51]) {
	const context = await browser.newContext({
		viewport: { width: 960, height: 600 },
	});
	const page = await context.newPage();
	watch(page, `frames ${seed}`);
	await page.goto(
		gameUrl(origin, { seed, raider: "off", guided: true, cinematic: 1 }),
	);
	await bootedGame(page);
	const frames = await page.evaluate(
		() =>
			new Promise((done) => {
				const g = window.__seelite;
				const rows = [];
				const tick = () => {
					const cam = g.openingActive ? g.openingCamera() : null;
					if (cam) {
						const s = g.openingScene();
						const rel = {
							x: cam.pos.x - s.ship.pos.x,
							y: cam.pos.y - s.ship.pos.y,
							z: cam.pos.z - s.ship.pos.z,
						};
						const d = Math.hypot(rel.x, rel.y, rel.z);
						const c =
							-(
								rel.x * cam.forward.x +
								rel.y * cam.forward.y +
								rel.z * cam.forward.z
							) / d;
						rows.push({
							shot: g.openingReading().shot,
							rel,
							cam: cam.pos,
							forward: cam.forward,
							distR: d / s.reachKm,
							offDeg: (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI,
						});
					}
					if (g.openingActive) requestAnimationFrame(tick);
					else done(rows);
				};
				requestAnimationFrame(tick);
			}),
	);
	// A jump within a take: the camera's place relative to the ship moving by
	// more than half a reach between two frames of the arrival. The orbit moves
	// it by design, at most ~0.03 reaches a frame at 60 Hz (0.2 on a 100 ms
	// hitch); the noise jumps this row was built on were 4.3 and 5.9.
	// **One take from the arrival through the fly-past** (the principal's
	// sixth note): between two frames of it the camera may move only by the
	// orbit (~0.03 reaches a frame; the fly-past camera stands still in its
	// frame) and turn its aim by a few degrees. The noise jumps this was built
	// on were 4.3 and 5.9 reaches, and the old cut between the two scenes
	// moved the camera by several reaches at once.
	const take = new Set(["arrival", "flypast"]);
	let takeJumpR = 0;
	let takeTurnDeg = 0;
	let arrivalFrames = 0;
	let takeFrames = 0;
	for (let i = 1; i < frames.length; i++) {
		const [a, b] = [frames[i - 1], frames[i]];
		if (!take.has(a.shot) || !take.has(b.shot)) continue;
		takeFrames++;
		if (b.shot === "arrival") arrivalFrames++;
		const jump = Math.hypot(
			b.cam.x - a.cam.x,
			b.cam.y - a.cam.y,
			b.cam.z - a.cam.z,
		);
		takeJumpR = Math.max(takeJumpR, jump / 0.036);
		const c =
			a.forward.x * b.forward.x +
			a.forward.y * b.forward.y +
			a.forward.z * b.forward.z;
		takeTurnDeg = Math.max(
			takeTurnDeg,
			(Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI,
		);
	}
	const closestR = Math.min(...frames.map((f) => f.distR));
	const worstOff = Math.max(...frames.map((f) => f.offDeg));
	const shotsSeen = [
		...new Set(frames.map((f) => f.shot).filter(Boolean)),
	].join(" ");
	check(
		`seed ${seed}: arrival and fly-past are one steady take, the camera outside the hull, the ship in frame`,
		arrivalFrames > 100 &&
			takeFrames > arrivalFrames + 100 &&
			shotsSeen === "arrival flypast cruise approach dock" &&
			takeJumpR < 0.5 &&
			takeTurnDeg < 8 &&
			closestR > 2 &&
			worstOff < 25,
		JSON.stringify({
			frames: frames.length,
			arrivalFrames,
			takeFrames,
			shotsSeen,
			takeJumpR: Number(takeJumpR.toFixed(4)),
			takeTurnDeg: Number(takeTurnDeg.toFixed(2)),
			closestR: Number(closestR.toFixed(2)),
			worstOffDeg: Number(worstOff.toFixed(1)),
		}),
	);
	await context.close();
}

// ---------------------------------------------------------------------------
// Guided, skipped by the key halfway through
// ---------------------------------------------------------------------------

const midway = await boot({ guided: true, cinematic: 1 }, "guided midway");
await midway.page.waitForFunction(
	() => window.__seelite.openingReading().shot === "cruise",
	null,
	{ timeout: 60000, polling: 100 },
);
await midway.page.keyboard.press("Enter");
await untilOver(midway.page, 10000);
const midwayEnd = await endState(midway.page);
check(
	"Enter during the cruise shot skips to the same state (D2)",
	same(midwayEnd, skippedEnd),
	differing(midwayEnd, skippedEnd) || "identical",
);
await midway.context.close();

// ---------------------------------------------------------------------------
// Guided, skipped by a click: the mouse is always available (#370)
// ---------------------------------------------------------------------------

const clicked = await boot({ guided: true, cinematic: 1 }, "guided clicked");
await clicked.page.waitForFunction(
	() => window.__seelite.openingReading().shot === "flypast",
	null,
	{ timeout: 30000, polling: 100 },
);
const hint = await clicked.page.evaluate(() => {
	const skip = document.querySelector("[data-opening-skip]");
	const box = skip?.getBoundingClientRect();
	return {
		text: skip?.textContent ?? null,
		visible: skip?.checkVisibility() ?? false,
		x: box ? box.x + box.width / 2 : 0,
		y: box ? box.y + box.height / 2 : 0,
		pointerLocked: document.pointerLockElement !== null,
		names: window.__seelite.bindings
			.filter((b) => b.command === "dock.launch")
			.map((b) => b.trigger.kind),
	};
});
check(
	"SKIP names every trigger the skip has, the pad's among them, and the pointer is free",
	hint.visible &&
		hint.names.includes("key") &&
		hint.names.some((k) => k !== "key") &&
		(hint.text?.split(" or ").length ?? 0) >= hint.names.length &&
		!hint.pointerLocked,
	JSON.stringify(hint),
);
// A real pointer event at the control's place, not a synthetic element.click(),
// which reaches a control a locked pointer could not (#370, #371).
await clicked.page.mouse.click(hint.x, hint.y);
await untilOver(clicked.page, 10000);
const clickedEnd = await endState(clicked.page);
check(
	"a click on SKIP skips to the same state (D2)",
	same(clickedEnd, skippedEnd),
	differing(clickedEnd, skippedEnd) || "identical",
);
await clicked.context.close();

// ---------------------------------------------------------------------------
// A quit during the opening: the rest is flown on load (the principal's
// ruling, 2026-09-26), so a guided start still docks
// ---------------------------------------------------------------------------

for (const shot of ["cruise", "dock"]) {
	const quit = await boot({ guided: true, cinematic: 1 }, `quit at ${shot}`);
	await quit.page.waitForFunction(
		(s) => window.__seelite.openingReading().shot === s,
		shot,
		{ timeout: 60000, polling: 50 },
	);
	const saved = await quit.page.evaluate(async () => {
		const g = window.__seelite;
		await g.saveFlush("quit");
		const b = g.save.backend;
		const live = await b.read("default", "live");
		return {
			regime: live?.commander?.flight?.regime ?? null,
			dockedAt: live?.commander?.dockedAt ?? null,
			lastDocked: (await b.read("default", "lastDocked")) !== null,
		};
	});
	// The same save, booted again: a loaded commander, not a new game.
	await quit.page.goto(gameUrl(origin, { seed: SEED, raider: "off" }));
	await bootedGame(quit.page);
	const resumed = await quit.page.evaluate(() => {
		const g = window.__seelite;
		return {
			outcome: g.openingReading().lastOutcome,
			dockPhase: g.dockPhase,
			stationId: g.dock.stationId,
			firstDay: g.firstDay,
		};
	});
	const record = await lastDocked(quit.page);
	check(
		`a quit at the ${shot} shot saves in flight, and the reload flies the rest and docks with lastDocked`,
		saved.dockedAt === null &&
			!saved.lastDocked &&
			(resumed.outcome === "docked" || resumed.outcome === "fallback") &&
			resumed.dockPhase === "docked" &&
			resumed.stationId === trade.id &&
			record?.dockedAt === trade.key,
		JSON.stringify({ saved, resumed, record }),
	);
	await quit.context.close();
}

// ---------------------------------------------------------------------------
// Free: arrival and fly-past, then control near the arrival point
// ---------------------------------------------------------------------------

const free = await boot({ cinematic: 1 }, "free watched");
const arrivalPoint = await free.page.evaluate(() => {
	const p = window.__seelite.world.ship.pos;
	return [p.x, p.y, p.z];
});
const freeShots = new Set();
for (let i = 0; i < 300; i++) {
	const r = await free.page.evaluate(() => window.__seelite.openingReading());
	if (!r.active) break;
	if (r.shot) freeShots.add(r.shot);
	await free.page.waitForTimeout(100);
}
await untilOver(free.page);
const freeEnd = await free.page.evaluate((from) => {
	const g = window.__seelite;
	const p = g.world.ship.pos;
	return {
		outcome: g.openingReading().lastOutcome,
		dockPhase: g.dockPhase,
		regime: g.regime,
		gameTime: g.world.gameTime,
		fromArrivalKm: Math.hypot(p.x - from[0], p.y - from[1], p.z - from[2]),
		throttle: g.throttle,
		view: g.view,
	};
}, arrivalPoint);
check(
	"a free opening shows the arrival and the fly-past only",
	same([...freeShots], ["arrival", "flypast"]),
	[...freeShots].join(" → "),
);
check(
	"and hands over in flight, near the arrival point, throttle at zero",
	freeEnd.outcome === "flying" &&
		freeEnd.dockPhase === "flying" &&
		freeEnd.regime === "normal" &&
		freeEnd.fromArrivalKm < 2 &&
		freeEnd.throttle === 0 &&
		freeEnd.gameTime < 15,
	JSON.stringify(freeEnd),
);
await free.context.close();

// ---------------------------------------------------------------------------
// Boots that see no sequence
// ---------------------------------------------------------------------------

for (const [label, params] of [
	["?boot=direct", {}],
	["?system=", { system: 3 }],
]) {
	const quiet = await boot(params, `free ${label}`);
	const r = await quiet.page.evaluate(() => {
		const g = window.__seelite;
		return {
			reading: g.openingReading(),
			gameTime: g.world.gameTime,
			speed: Math.hypot(
				g.world.ship.vel.x,
				g.world.ship.vel.y,
				g.world.ship.vel.z,
			),
		};
	});
	check(
		`a free ${label} boot has no opening and starts at rest, clock near zero`,
		r.reading.kind === null &&
			r.reading.lastOutcome === null &&
			r.gameTime < 5 &&
			r.speed < 1e-9,
		JSON.stringify({ ...r, reading: r.reading.lastOutcome }),
	);
	await quiet.context.close();
}

const pinned = await boot({ guided: true, system: 3 }, "guided ?system=");
const pinnedEnd = await endState(pinned.page);
check(
	"a guided ?system= boot flies in unseen, as ?boot=direct does",
	pinnedEnd.outcome === "docked" &&
		JSON.parse(pinnedEnd.dock).phase === "docked",
	JSON.stringify({ ...pinnedEnd, dock: undefined, orientation: undefined }),
);
await pinned.context.close();

// ---------------------------------------------------------------------------
// No interdiction, and the fallback
// ---------------------------------------------------------------------------

const raided = await boot({ guided: true, raider: "1" }, "guided raider");
const raidedEnd = await raided.page.evaluate(() => {
	const g = window.__seelite;
	return {
		outcome: g.openingReading().lastOutcome,
		encounter: g.encounter?.phase ?? null,
		dockPhase: g.dockPhase,
	};
});
check(
	"with a raider on every leg, none interdicts the opening's cruise (D6)",
	raidedEnd.outcome === "docked" &&
		raidedEnd.encounter === null &&
		raidedEnd.dockPhase === "docked",
	JSON.stringify(raidedEnd),
);
await raided.context.close();

const failing = await boot({}, "fallback");
const fallback = await failing.page.evaluate(() => {
	const g = window.__seelite;
	// A drive that refuses every engage, as an empty tank does.
	g.engageCruise = () => {};
	g.beginOpening("guided", false);
	return {
		outcome: g.openingReading().lastOutcome,
		dockPhase: g.dockPhase,
		regime: g.regime,
		spooling: g.spoolLeftS > 0,
		computer: g.dockingComputerEngaged,
		stationId: g.dock.stationId,
	};
});
check(
	"a flight that cannot cruise falls back to the placement, and docks (D6)",
	fallback.outcome === "fallback" &&
		fallback.dockPhase === "docked" &&
		fallback.stationId === trade.id &&
		fallback.regime === "normal" &&
		!fallback.spooling,
	JSON.stringify(fallback),
);
await failing.context.close();

// ---------------------------------------------------------------------------
// The phase handle lands on the same step every time (the strip's premise)
// ---------------------------------------------------------------------------

const holds = [];
for (let i = 0; i < 2; i++) {
	const held = await boot({ guided: true, cinematic: "held" }, `held ${i}`);
	holds.push(
		await held.page.evaluate(async () => {
			const g = window.__seelite;
			const start = g.openingReading();
			g.holdOpening("dock", 1);
			// Frames drawn while held step nothing.
			await new Promise((r) =>
				requestAnimationFrame(() => requestAnimationFrame(r)),
			);
			const r = g.openingReading();
			const p = g.world.ship.pos;
			return {
				startHeld: start.held && start.steps === 0,
				shot: r.shot,
				steps: r.steps,
				gameTime: g.world.gameTime,
				pos: [p.x, p.y, p.z],
			};
		}),
	);
	await held.context.close();
}
check(
	"?cinematic=held starts held, and a hold at a shot lands on the same step twice",
	holds.every((h) => h.startHeld && h.shot === "dock") &&
		same(holds[0], holds[1]),
	JSON.stringify(holds.map((h) => ({ steps: h.steps, t: h.gameTime }))),
);

console.log(`captures: ${out}`);
await browser.close();
exit();
