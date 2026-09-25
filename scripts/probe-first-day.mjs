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
await page.goto(gameUrl(origin, { seed: SEED, guided: true }));
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
		line?.toLowerCase().includes("launch"),
	line ?? "no line",
);
await shot(page, "04-accepted");

// Launch, and read the glass.
const credits0 = await page.evaluate(() => window.__seelite.commander.credits);
await page.evaluate(() => {
	const g = window.__seelite;
	g.launch();
	for (let i = 0; i < 600 && g.dockPhase !== "flying"; i++) {
		g.skipDockTraversal();
		g.step(1 / 60);
	}
	g.targetId = null;
	g.updateCockpit();
});
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
await shot(page, "05-flying-prompt");

// Near the delivery station with it selected: the glass names the clearance key.
const destId = local.reportAt.carrierKey.split(":").slice(1).join(":");
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
	for (let i = 0; i < 600 && g.dockPhase !== "flying"; i++) {
		g.skipDockTraversal();
		g.step(1 / 60);
	}
	g.targetId = null;
	g.updateCockpit();
});
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
