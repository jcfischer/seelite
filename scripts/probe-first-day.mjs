/**
 * A new pilot's first useful day, flown (#408).
 *
 * `tests/first-day.test.ts` owns which step a set of facts is; what only the
 * page can answer is the wiring. A guided new game has to boot **docked**, at
 * its start system's trade station, through a real clearance, and write the
 * `lastDocked` checkpoint that dock earns. Station control has to speak on the
 * console a docked pilot is looking at, the glass has to carry the step in
 * flight, and the day has to be flyable end to end on real systems: accept the
 * Local run, launch, dock at the delivery station, deliver, report, get paid.
 * A free pilot has to be left alone, with the First day tab still there.
 *
 * Every state is captured, because a green run is not a legible one.
 */
// A default-layout probe (#381 D11): it presses 1, 2 and 3 by name, as the
// shipped layout binds the head-look keys station control names, and a moved
// default turns it red for that reason.
import { mkdirSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const out = process.env.FIRST_DAY_EVIDENCE ?? "/tmp/seelite-408-evidence";
mkdirSync(out, { recursive: true });
const origin = await guardedOrigin(ORIGIN);
const browser = await launchChromium();
const { check, watch, exit } = tally();

/** A seed whose start system has a second station, so the Local run posts.
 *  The probe checks that it does rather than trusting the choice. */
const SEED = 42;

const shot = (page, name) =>
	page.screenshot({ path: `${out}/${name}.png` }).then(() => name);

/** Let the frame loop draw the state the evaluate just changed. */
const settle = (page) =>
	page.evaluate(
		() =>
			new Promise((r) =>
				requestAnimationFrame(() => requestAnimationFrame(() => r())),
			),
	);

const facts = (page) => page.evaluate(() => window.__seelite.firstDayFacts());
const stepOf = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		g.updateCockpit();
		return (
			document.querySelector("[data-first-day-state=current]")?.dataset
				.firstDayStep ?? null
		);
	});
/** Station control on the port console, when it is drawn and visible. */
const consoleLine = (page) =>
	page.evaluate(() => {
		const line = document.querySelector("[data-live-console-control]");
		return line?.checkVisibility() ? line.textContent : null;
	});

/** Out of the dock and into flight, with nothing selected and the head
 *  forward: the launch traversal skipped, as a pilot's Enter skips it. */
const untilFlying = (page) =>
	page.evaluate(() => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		for (let i = 0; i < 600 && g.dockPhase !== "flying"; i++) {
			g.skipDockTraversal();
			g.step(1 / 60);
		}
		g.targetId = null;
		g.updateCockpit();
	});

const stationLine = (page) =>
	page.evaluate(
		() =>
			document.querySelector("[data-live-station-control]")?.textContent ??
			null,
	);

// ---------------------------------------------------------------------------
// The guided day
// ---------------------------------------------------------------------------

const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
watch(page);
await installViewPlacement(page);
await installViewFraming(page);
// Raiders off: a raider leg would interrupt the cruise this page measures.
await page.goto(gameUrl(origin, { seed: SEED, guided: true, raider: "off" }));
await bootedGame(page);
await page.waitForFunction(() => !window.__seelite.clockHeld);

const boot = await page.evaluate(async () => {
	const g = window.__seelite;
	const trade = g.world.system.contents.stations.find(
		(s) => s.type === "trade",
	);
	const backend = g.save.backend;
	let record = null;
	for (let i = 0; i < 100 && !record; i++) {
		record = await backend.read("default", "lastDocked");
		if (!record) await new Promise((r) => setTimeout(r, 100));
	}
	return {
		firstDay: g.firstDay,
		phase: g.dockPhase,
		// How long the docked start's run-in took: the world clock at the dock.
		runInS: Number(g.world.gameTime.toFixed(1)),
		stationId: g.dock.stationId,
		tradeId: trade?.id ?? null,
		lastDocked: record
			? {
					dockedAt: record.commander.dockedAt,
					firstDay: record.commander.firstDay,
					version: record.saveSchemaVersion,
				}
			: null,
	};
});
check(
	"a guided new game boots docked at its start system's trade station",
	boot.firstDay === "guided" &&
		boot.phase === "docked" &&
		boot.stationId !== null &&
		boot.stationId === boot.tradeId,
	JSON.stringify(boot),
);
check(
	"that dock writes the lastDocked checkpoint, guided, at schema 6",
	boot.lastDocked !== null &&
		boot.lastDocked.dockedAt?.endsWith(`:${boot.tradeId}`) &&
		boot.lastDocked.firstDay === "guided" &&
		boot.lastDocked.version === 6,
	JSON.stringify(boot.lastDocked),
);

await settle(page);
let f = await facts(page);
check(
	"the start station posts a Local run",
	f.localRunOnBoard,
	JSON.stringify(f),
);
let line = await stationLine(page);
check(
	"station control names the Local run on the docked console",
	line?.includes("STATION CONTROL") && line.includes("Local run"),
	line ?? "no line",
);
await shot(page, "01-guided-boot");

// The First day tab, on the port console.
await page.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("left");
	g.leftTab = "First day";
	g.updateCockpit();
});
await settle(page);
check("the tab marks take-work", (await stepOf(page)) === "take-work");
await shot(page, "02-first-day-tab");
await page.evaluate(() => {
	const g = window.__seelite;
	g.leftTab = "Navigation";
	g.setHeadLook("forward");
	g.updateCockpit();
});

// Accept the Local run through the console, as a pilot would.
await page.locator('[data-live-station-tab="Requests"]').click();
const local = await page.evaluate(
	() =>
		window.__seelite
			.requestsView()
			.offers.find((o) => o.rowId === "courier-local-run") ?? null,
);
check(
	"the Local run delivers inside this system and pays",
	local !== null && local.distanceLy === 0 && local.rewardCr > 0,
	local ? `${local.reportName} · ${local.rewardCr} Cr` : "none",
);
// Everything below flies that offer, so without one there is nothing to fly:
// report what was checked rather than throwing on `local.id` (sage round 2).
if (local === null) {
	await browser.close();
	exit();
}
await shot(page, "03-requests-board");
await page
	.locator(
		`[data-live-station-console] [data-live-request-action="details"][data-live-request-id="${local.id}"]`,
	)
	.click();
await page
	.locator('[data-live-station-console] [data-live-request-action="accept"]')
	.click();
await settle(page);
f = await facts(page);
line = await stationLine(page);
check(
	"accepting it moves the day to launch, and station control says so",
	f.running?.reportAt === local.reportAt.carrierKey &&
		line?.toLowerCase().includes("launch") &&
		line.includes("right console"),
	line ?? "no line",
);
await shot(page, "04-accepted");

// Launch as a pilot does: turn to the right console and press LAUNCH. Enter
// on the docked console acts on the focused Requests control instead, which in
// playtest tracked the job rather than launching (2026-09-25).
const credits0 = await page.evaluate(() => window.__seelite.commander.credits);
await page.keyboard.press("3");
const launchButton = page.locator("[data-live-launch]");
check(
	"the right console carries LAUNCH, where station control sends the pilot",
	await launchButton.isVisible(),
);
await shot(page, "04b-right-console-launch");
await launchButton.click();
await untilFlying(page);

// A launch flies clear, then lets go still moving (#408, the principal's
// playtest): released two hull lengths past the usual 20 m, flying out along the
// axis at the gate speed, and still flying out two seconds later.
const clearOf = (id) =>
	page.evaluate((stationId) => {
		const g = window.__seelite;
		const body = g.world.system.byId.get(stationId);
		const { axis } = g.poseOfStation(stationId);
		const p = g.world.ship.pos;
		const v = g.world.ship.vel;
		const sv = g.stationVelocity(stationId);
		const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
		return {
			pastPlaneKm:
				dot(
					{ x: p.x - body.pos.x, y: p.y - body.pos.y, z: p.z - body.pos.z },
					axis,
				) - g.dockingSnapshot(stationId).planeKm,
			outwardKms: dot({ x: v.x - sv.x, y: v.y - sv.y, z: v.z - sv.z }, axis),
			throttle: g.throttle,
		};
	}, id);
const released = await clearOf(boot.stationId);
await page.evaluate(() => {
	const g = window.__seelite;
	for (let i = 0; i < 120; i++) g.step(1 / 60);
});
const twoSecondsOn = await clearOf(boot.stationId);
// Read off the page, not restated: the hull flown and the assist's cap.
const { hullKm, capKms } = await page.evaluate(() => ({
	hullKm: window.__seelite.playerHull.spec.env.lengthKm,
	capKms: window.__seelite.assistCapKms,
}));
check(
	"a launch lets go clear of the mouth, moving out at the speed its throttle holds",
	released.pastPlaneKm > 2 * hullKm &&
		released.outwardKms > 0 &&
		Math.abs(released.outwardKms - released.throttle * capKms) < 0.01 &&
		twoSecondsOn.pastPlaneKm > released.pastPlaneKm + 0.15,
	JSON.stringify({ released, twoSecondsOn }),
);
await settle(page);
const flying = await page.evaluate(() => ({
	phase: window.__seelite.dockPhase,
	prompt: window.__seelite.cockpitPrompt.text,
}));
check(
	"in flight the glass names the delivery station",
	flying.phase === "flying" && flying.prompt.includes(local.reportName),
	JSON.stringify(flying),
);
const controls = await page.evaluate(
	() => window.__seelite.firstDayControlsShown,
);
check(
	"in flight the glass shows how to fly and steer, keyboard and controller",
	controls.length === 2 &&
		controls[0].startsWith("THROTTLE ") &&
		controls[0].includes("PITCH") &&
		controls[1].startsWith("CONTROLLER · THROTTLE "),
	JSON.stringify(controls),
);
await shot(page, "05-flying-prompt");

// The playtest's path (2026-09-25): select the delivery station on the port
// console, face forward, turn toward it, cruise. The console carries the line
// while the head is turned, because the glass is not drawn there.
const destId = local.reportAt.carrierKey.split(":").slice(1).join(":");
await page.keyboard.press("1");
await settle(page);
let onConsole = await consoleLine(page);
check(
	"on the port console, station control asks for the delivery station",
	onConsole?.includes(`Select ${local.reportName}`) ?? false,
	onConsole ?? "no line",
);
await page
	.locator(`[data-live-panel="left"] [data-live-nav-target="${destId}"]`)
	.click();
await settle(page);
onConsole = await consoleLine(page);
check(
	"once it is selected, the console says 2, f, then j",
	(onConsole?.includes(`${local.reportName} is selected. Press 2`) &&
		onConsole.includes("then j to cruise")) ??
		false,
	onConsole ?? "no line",
);
await shot(page, "05b-selected-on-console");
await page.keyboard.press("2");
await settle(page);
const facing = await page.evaluate(() => window.__seelite.cockpitPrompt.text);
check(
	"facing forward, the glass says to turn toward it and cruise",
	facing === `press f to face ${local.reportName}, then j to cruise`,
	facing,
);
await shot(page, "05c-face-and-cruise");

// F then J: the leg tracks the station until the drop (principal, 2026-09-25).
// The station moves on its orbit through the leg, so a nose-locked leg that is
// not steered at it misses the 50 km drop sphere.
await page.keyboard.press("f");
await page.keyboard.press("j");
const leg = await page.evaluate((id) => {
	const g = window.__seelite;
	let cruised = false;
	for (let i = 0; i < 60 * 900; i++) {
		g.step(1 / 60);
		if (g.regime === "cruise") cruised = true;
		else if (cruised) break;
	}
	const body = g.world.system.byId.get(id);
	const p = g.world.ship.pos;
	return {
		cruised,
		regime: g.regime,
		distanceKm: Math.hypot(
			p.x - body.pos.x,
			p.y - body.pos.y,
			p.z - body.pos.z,
		),
		dropKm: g.cruiseParams.dropRadiusKm,
		exit: g.lastExit,
	};
}, destId);
check(
	"F then J cruises to the station and drops at it",
	leg.cruised && leg.regime === "normal" && leg.distanceKm <= leg.dropKm * 1.2,
	JSON.stringify(leg),
);
await shot(page, "05d-dropped-at-station");

// Near the delivery station with it selected: the glass names the clearance key.
const near = await page.evaluate(async (id) => {
	const g = window.__seelite;
	const snap = g.dockingSnapshot(id);
	await window.__viewAlongAxis(id, snap.planeKm + 4.5, { comoving: true });
	g.targetId = id;
	g.updateCockpit();
	await new Promise((r) => requestAnimationFrame(() => r()));
	return g.cockpitPrompt.text;
}, destId);
check(
	"beside the delivery station the glass asks for clearance by key",
	near.includes("clearance"),
	near,
);
await shot(page, "06-near-station");

// Cleared, with no docking computer: a new ship has none (#408), so the key
// does nothing and the glass says to fly in rather than naming it.
const cleared = await page.evaluate(async () => {
	const g = window.__seelite;
	g.requestDockingClearance();
	const fitted = g.hasDockingComputer;
	g.toggleDockingComputer();
	const engaged = g.dockingComputerEngaged;
	g.updateCockpit();
	await new Promise((r) => requestAnimationFrame(() => r()));
	return { fitted, engaged, prompt: g.cockpitPrompt.text };
});
check(
	"a new ship has no docking computer, and its key does nothing",
	cleared.fitted === false && cleared.engaged === false,
	JSON.stringify(cleared),
);
check(
	"cleared without one, the glass says to fly in, and names no docking key",
	cleared.prompt.includes("fly in slowly") && !cleared.prompt.includes("dock"),
	cleared.prompt,
);
await shot(page, "06b-cleared-by-hand");

// Dock at the delivery station through the real protocol. `__parkInBerth`
// fits the computer to fly the approach, so everything below has one. **The
// berth the grant above reserved**, not the first in the catalogue: a live grant
// is a reservation, and asking the placement for another berth is refused.
await page.evaluate(async (id) => {
	const g = window.__seelite;
	const held = g.dockingSnapshot(id)?.berthId;
	await window.__parkInBerth(id, held ?? g.berthIdsOfStation(id)[0]);
	g.setHeadLook("forward");
	g.updateCockpit();
}, destId);
await settle(page);
line = await stationLine(page);
check(
	"docked where the job reports, station control says report",
	line?.toLowerCase().includes("report"),
	line ?? "no line",
);
await shot(page, "07-at-delivery");

// Deliver and report through the console.
await page.locator('[data-live-station-tab="Requests"]').click();
for (const action of ["deliver", "report"]) {
	const button = page.locator(
		`[data-live-station-console] [data-live-request-action="${action}"]`,
	);
	if ((await button.count()) > 0) await button.first().click();
	await settle(page);
}
const paid = await page.evaluate(() => ({
	credits: window.__seelite.commander.credits,
	facts: window.__seelite.firstDayFacts(),
}));
check(
	"reporting pays the Local run",
	paid.facts.settledAny && paid.credits - credits0 === local.rewardCr,
	`${credits0} → ${paid.credits} Cr`,
);
line = await stationLine(page);
check(
	"station control closes the day once, at that berth",
	line?.includes("paid") ?? false,
	line ?? "no line",
);
await shot(page, "08-paid");

// The log keeps what station control said.
const log = await page.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("left");
	g.leftTab = "Communications";
	g.updateCockpit();
	return document.querySelector("[data-live-raider-log]")?.textContent ?? "";
});
await settle(page);
check(
	"the Communications log carries station control's lines",
	(log.match(/STATION CONTROL/g) ?? []).length >= 3,
	`${(log.match(/STATION CONTROL/g) ?? []).length} lines`,
);
await shot(page, "09-communications-log");

// After the day, launching ends the closing line and the glass is the game's.
await page.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("forward");
	g.leftTab = "Navigation";
	g.launch();
});
await untilFlying(page);
await settle(page);
const after = await page.evaluate(() => window.__seelite.cockpitPrompt.text);
check(
	"after the day the glass carries no first-day line",
	!after.includes("deliver") && !after.includes("clearance"),
	after,
);
await context.close();

// ---------------------------------------------------------------------------
// A free pilot
// ---------------------------------------------------------------------------

const freeContext = await browser.newContext({
	viewport: { width: 1440, height: 900 },
});
const free = await freeContext.newPage();
watch(free);
await installViewPlacement(free);
await installViewFraming(free);
await free.goto(gameUrl(origin, { seed: SEED, "no-save": true }));
await bootedGame(free);
await free.waitForFunction(() => !window.__seelite.clockHeld);
const freeBoot = await free.evaluate(() => {
	const g = window.__seelite;
	g.targetId = null;
	g.updateCockpit();
	return { firstDay: g.firstDay, phase: g.dockPhase };
});
check(
	"a free new game boots in flight, as before",
	freeBoot.firstDay === "free" && freeBoot.phase === "flying",
	JSON.stringify(freeBoot),
);

// A guided start that cannot dock puts back what it moved (sage round 2): the
// clearance is refused here, which is the first of its two ways to give up.
const failed = await free.evaluate(() => {
	const g = window.__seelite;
	const before = { ...g.world.ship.pos };
	const targetBefore = g.targetId;
	const real = g.requestDockingClearance;
	g.requestDockingClearance = () => ({ id: null, state: null });
	const docked = g.startDockedAtHome();
	g.requestDockingClearance = real;
	const p = g.world.ship.pos;
	return {
		docked,
		movedKm: Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z),
		engaged: g.dockingComputerEngaged,
		targetKept: g.targetId === targetBefore,
		phase: g.dockPhase,
	};
});
check(
	"a guided start that cannot dock leaves the ship where a free start has it",
	!failed.docked &&
		failed.movedKm === 0 &&
		!failed.engaged &&
		failed.targetKept &&
		failed.phase === "flying",
	JSON.stringify(failed),
);

// The second way: granted, but the run-in never ends. `step` is stubbed so the
// bound runs out; the grant the start was given must end with it.
const timedOut = await free.evaluate(() => {
	const g = window.__seelite;
	const before = { ...g.world.ship.pos };
	const trade = g.world.system.contents.stations.find(
		(s) => s.type === "trade",
	).id;
	const real = g.step;
	g.step = () => {};
	const docked = g.startDockedAtHome();
	g.step = real;
	const p = g.world.ship.pos;
	return {
		docked,
		movedKm: Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z),
		engaged: g.dockingComputerEngaged,
		clearance: g.dockingSnapshot(trade)?.grantLive ?? null,
		phase: g.dockPhase,
	};
});
check(
	"a guided start whose run-in never ends gives the grant back too",
	!timedOut.docked &&
		timedOut.movedKm === 0 &&
		!timedOut.engaged &&
		timedOut.clearance === false &&
		timedOut.phase === "flying",
	JSON.stringify(timedOut),
);
await free.evaluate(() => {
	const g = window.__seelite;
	g.setHeadLook("left");
	g.leftTab = "First day";
	g.updateCockpit();
});
await settle(free);
check(
	"a free pilot has the tab too, on find-station",
	(await stepOf(free)) === "find-station",
);
check(
	"and no station control line on its port console",
	(await consoleLine(free)) === null,
);
check(
	"and no flight controls on its glass",
	(await free.evaluate(() => window.__seelite.firstDayControlsShown)).length ===
		0,
);
await shot(free, "10-free-tab");
await free.evaluate(async () => {
	const g = window.__seelite;
	const id = g.world.system.contents.stations.find(
		(s) => s.type === "trade",
	).id;
	await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
	g.setHeadLook("forward");
	g.leftTab = "Navigation";
	g.updateCockpit();
});
await settle(free);
check(
	"a free pilot is not pushed: no station control line when docked",
	(await stationLine(free)) === null,
);
await shot(free, "11-free-docked");
await freeContext.close();

console.log(`captures: ${out}`);
await browser.close();
exit();
