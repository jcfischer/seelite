/**
 * Node 564. The three ladders in the browser: credit banked on a real dock,
 * the Commander page on the right console, and a locked shipyard row.
 *
 * Headless rows own the arithmetic (`tests/ladder*.test.ts`); this owns what
 * only a running game can show — that the dock the docking computer flies
 * banks the flight's credit, that the page draws it, and that a shipyard's
 * Equipment tab lists a gated item locked, names its ladder and rung, draws no
 * BUY, and sells it once the rung is reached.
 *
 * Every figure is read off the page's own modules (`/src/ladder.ts`), never
 * restated here. Every assertion about the glass reads rendered text.
 */
import { mkdirSync } from "node:fs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { installViewFraming } from "./lib/view-placement.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5343";
const out = process.env.LADDERS_EVIDENCE ?? "/tmp/seelite-564-evidence";
const headed = process.env.HEADED === "1";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium({ headless: !headed });
const t = tally();
let passed = 0;
const check = (name, ok, detail = "") => {
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
	if (!ok) throw new Error(name);
	passed += 1;
};
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watchShaders(page, "ladders");
	page.on("pageerror", (e) => {
		throw e;
	});
	await installViewPlacement(page);
	await installViewFraming(page);
	// Galaxy 0 of seed 42, system 1: a system with a shipyard, which is where
	// the two shipyard-only gated items are sold.
	await page.goto(gameUrl(origin, { seed: 42, system: 1 }), {
		waitUntil: "load",
	});
	await bootedGame(page);

	const openCommander = async () => {
		await page.evaluate(() => {
			window.__seelite.setHeadLook("right");
			const tab = document.querySelector('[data-live-right-tab="Commander"]');
			if (!(tab instanceof HTMLElement)) throw new Error("no Commander tab");
			tab.click();
		});
	};
	const ladderRow = (ladder) =>
		page
			.locator(`[data-live-panel="right"] [data-live-ladder="${ladder}"]`)
			.innerText();

	// ---------------------------------------------------------------------
	// In flight: a kill's credit is pending, and the page says so.
	// ---------------------------------------------------------------------
	const credit = await page.evaluate(async () => {
		const L = await import("/src/ladder.ts");
		const g = window.__seelite;
		const banked = { ...g.ladders.banked };
		g.ladderPending = L.pendingKill(g.ladderPending, 0.75);
		g.updateCockpit();
		return { pending: g.ladderPending.combat, banked };
	});
	await openCommander();
	check(
		"the Commander page is on the right console and visible with the head turned",
		await page.locator("[data-live-ladders]").isVisible(),
	);
	const rows = await page
		.locator('[data-live-panel="right"] [data-live-ladder]')
		.count();
	check("it lists three ladders", rows === 3, `${rows}`);
	const combatInFlight = await ladderRow("combat");
	check(
		"this flight's pending kill credit, set directly, shows as unbanked (the kill paths are probe-raider-consequence's)",
		/\+0\.8 UNBANKED/.test(combatInFlight) && /^COMBAT/m.test(combatInFlight),
		combatInFlight.replaceAll("\n", " | "),
	);
	await page.screenshot({ path: `${out}/00-commander-in-flight.png` });

	// ---------------------------------------------------------------------
	// A real dock — the docking computer through the plane — banks it.
	// ---------------------------------------------------------------------
	const yard = await page.evaluate(async () => {
		const g = window.__seelite;
		const id = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "shipyard",
		)?.id;
		if (!id) throw Error("no shipyard in this system");
		await window.__parkInBerth(id, g.berthIdsOfStation(id)[0]);
		g.setHeadLook("forward");
		g.updateCockpit();
		return {
			id,
			phase: g.dock.phase,
			banked: { ...g.ladders.banked },
			pending: g.ladderPending.combat,
		};
	});
	check("the ship is docked at the shipyard", yard.phase === "docked", yard.id);
	// **Coarse on purpose (#627 D8).** What a dock banks, to the figure, is
	// `tests/holdings.test.ts`'s: these rows show only that this `Game`'s
	// dock reached the Holdings module at all, which no bun test can.
	check(
		"the dock banked the kill credit and cleared what was pending",
		credit.pending > 0 &&
			yard.banked.combat > credit.banked.combat &&
			yard.pending === 0,
		JSON.stringify({ before: credit, yard }),
	);
	check(
		"and the station's first dock banked an exploration kind",
		yard.banked.exploration > credit.banked.exploration,
		`${credit.banked.exploration} → ${yard.banked.exploration}`,
	);
	await openCommander();
	const combatDocked = await ladderRow("combat");
	check(
		"the page shows it banked, with nothing unbanked",
		/0\.8/.test(combatDocked) && !/UNBANKED/.test(combatDocked),
		combatDocked.replaceAll("\n", " | "),
	);
	await page.screenshot({ path: `${out}/01-commander-docked.png` });

	// ---------------------------------------------------------------------
	// The shipyard's Equipment tab: a locked row, and the rung that opens it.
	// ---------------------------------------------------------------------
	await page.evaluate(() => {
		const g = window.__seelite;
		g.setHeadLook("forward");
		g.commander = { ...g.commander, credits: 100_000 };
		g.stationConsoleRevision += 1;
		g.updateCockpit();
	});
	await page.locator('[data-live-station-tab="Equipment"]').click();
	const pulse = page.locator('[data-outfit-candidate="stock:pulse-laser/1/E"]');
	await pulse.click();
	const gate = await page.evaluate(async () => {
		const L = await import("/src/ladder.ts");
		const g = L.gateOf("Extra Pulse Laser");
		return { ...g, name: L.RUNG_NAMES[g.ladder][g.rung] };
	});
	const preview = page.locator("[data-live-outfit-preview]");
	check(
		"a locked module names its ladder, rung and rung name",
		(await preview.innerText()).includes(
			"COMBAT " + gate.rung + " · " + gate.name,
		),
	);
	check(
		"a locked preview has no BUY",
		(await preview
			.locator('[data-live-station-action="buy-module"]')
			.count()) === 0,
	);
	const columns = await page
		.locator(".lc-outfit-stock em")
		.evaluateAll((rows) =>
			rows.map((r) => Math.round(r.getBoundingClientRect().right)),
		);
	check(
		"stock prices align across grades and locked rows",
		columns.length > 0 && new Set(columns).size === 1,
	);
	await page.screenshot({ path: out + "/02-shipyard-locked-row.png" });
	await page.evaluate(async () => {
		const L = await import("/src/ladder.ts");
		const g = window.__seelite;
		g.ladders = {
			...g.ladders,
			banked: {
				...g.ladders.banked,
				combat: L.threshold("combat", L.gateOf("Extra Pulse Laser").rung),
			},
		};
		g.stationConsoleRevision += 1;
		g.updateCockpit();
	});
	const buy = preview.locator('[data-live-station-action="buy-module"]');
	check(
		"reaching the rung enables the selected purchase",
		(await buy.count()) === 1,
	);
	await buy.click();
	check(
		"purchase reaches the slot and leaves the displaced module in the hold",
		await page.evaluate(() => {
			const c = window.__seelite.commander;
			return (
				c.loadout.h1.module === "pulse-laser" &&
				c.loadout.h1.purchaseCostCr > 0 &&
				c.recoveredFittings.some((f) => f.module === "pulse-laser")
			);
		}),
	);
	await page.screenshot({ path: out + "/03-shipyard-unlocked.png" });
	await page.evaluate(async () => {
		const { stockLoadout } = await import("/src/loadout.ts");
		const g = window.__seelite;
		g.commander = {
			...g.commander,
			hull: "interceptor",
			loadout: stockLoadout("interceptor"),
			credits: 100000,
		};
		g.stationConsoleRevision += 1;
		g.updateCockpit();
	});
	await page.locator('[data-outfit-slot="h2"]').click();
	await pulse.click();
	await preview.locator('[data-live-station-action="buy-module"]').click();
	check(
		"a second pulse fits the selected second hardpoint",
		await page.evaluate(
			() => window.__seelite.commander.loadout.h2?.module === "pulse-laser",
		),
	);
	await page.close();
} finally {
	await browser.close();
}
// `check` throws, so reaching here means every one passed; `watchShaders` is
// what is left to read.
console.log(`\n${passed}/${passed} checks passed · captures in ${out}`);
if (t.failures) process.exit(1);
