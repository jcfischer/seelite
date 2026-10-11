/** Slot selection, truthful pre-purchase comparison, removal and resale in the
 * live cockpit. Arithmetic and save-version rejection are headless tests.
 * default-layout probe (#381 D11): Enter activates the focused slot. */
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
const origin = process.env.PROBE_ORIGIN ?? "http://localhost:5173";
const out = process.env.OUTFITTING_EVIDENCE ?? "view-set/outfitting-869";
mkdirSync(out, { recursive: true });
await guardedOrigin(origin);
const browser = await launchChromium();
const t = tally();
let passed = 0;
function check(name, ok) {
	if (!ok) throw Error(name);
	console.log(`PASS ${name}`);
	passed++;
}
try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	t.watchShaders(page, "outfitting");
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await installViewPlacement(page);
	await installViewFraming(page);
	await page.goto(gameUrl(origin, { seed: 2 }));
	await bootedGame(page);
	await page.evaluate(async () => {
		const g = window.__seelite;
		const s = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "shipyard",
		);
		await window.__parkInBerth(s.id, g.berthIdsOfStation(s.id)[0]);
		const { threshold } = await import("/src/ladder.ts");
		g.clockHeld = true;
		g.commander = { ...g.commander, credits: 100000, cargo: {} };
		g.ladders = {
			...g.ladders,
			banked: {
				combat: threshold("combat", 8),
				trade: threshold("trade", 8),
				exploration: threshold("exploration", 8),
			},
		};
		g.stationConsoleRevision++;
		g.setHeadLook("forward");
		g.updateCockpit();
	});
	await page.locator('[data-live-station-tab="Equipment"]').click();
	check(
		"two panes are visible inside the docked station console",
		(await page
			.locator(
				"[data-live-station-console] [data-live-outfitting] .lc-outfit-panes > section",
			)
			.count()) === 2,
	);
	// Fuel is the first ship row (hotfix after #869): it was a 9 px footnote.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.commander = { ...g.commander, fuelLy: 1 };
		g.stationConsoleRevision++;
		g.updateCockpit();
	});
	const fuelRow = page
		.locator(".lc-outfit-scroll")
		.first()
		.locator(":scope > :first-child");
	check(
		"fuel is the first ship row",
		(await fuelRow.getAttribute("data-live-fuel")) !== null &&
			(await fuelRow.isVisible()),
	);
	await fuelRow.locator('[data-live-station-action="buy-fuel"]').click();
	check(
		"the fuel row's FILL fills the tank",
		await page.evaluate(async () => {
			const g = window.__seelite;
			const { commanderJumpRangeLy } = await import("/src/station-commerce.ts");
			return g.commander.fuelLy === commanderJumpRangeLy(g.commander);
		}),
	);
	const credits = await page.evaluate(() => window.__seelite.commander.credits);
	await page.locator('[data-outfit-candidate="stock:pulse-laser/1/E"]').click();
	check(
		"selecting a row spends nothing",
		(await page.evaluate(() => window.__seelite.commander.credits)) === credits,
	);
	const preview = page.locator("[data-live-outfit-preview]");
	check(
		"comparison includes handling range and credit before purchase",
		/ACCEL.*→.*JUMP.*→.*CREDIT \/ RAIDER.*→/s.test(await preview.innerText()),
	);
	await page.screenshot({ path: `${out}/comparison.png` });
	await page.evaluate(async () => {
		const g = window.__seelite;
		const { makeModule } = await import("/src/loadout.ts");
		g.commander = {
			...g.commander,
			loadout: {
				...g.commander.loadout,
				u1: makeModule("identity-scanner", 1),
			},
		};
		g.cycleFireGroup();
	});
	check(
		"scanner is armed before the refit",
		await page.evaluate(
			() =>
				window.__seelite.armedFireGroup.current(window.__seelite.fireGroups)
					?.kind === "scanner",
		),
	);
	// Repaint the comparison after the fixture added the scanner.
	await page.evaluate(() => {
		const g = window.__seelite;
		g.stationConsoleRevision++;
		g.updateCockpit();
	});
	const expected = await page.evaluate(
		() => window.__seelite.stationConsoleCache.outfitting.after,
	);
	await preview.locator('[data-live-station-action="buy-module"]').click();
	check(
		"the fit matches the shown preview and retains purchase cost",
		await page.evaluate(async (expected) => {
			const g = window.__seelite;
			const { fitReadout } = await import("/src/outfitting.ts");
			return (
				JSON.stringify(fitReadout(g.commander, 0)) ===
					JSON.stringify(expected) && g.commander.loadout.h1.purchaseCostCr > 0
			);
		}, expected),
	);
	check(
		"Equipment refit resets the armed group",
		await page.evaluate(() => {
			const g = window.__seelite;
			return g.armedFireGroup.label(g.fireGroups) === "H1 PULSE LASER · 1/2";
		}),
	);
	await page
		.locator('[data-live-slot="h1"] [data-live-station-action="remove-module"]')
		.click();
	check(
		"remove empties the selected slot",
		await page.evaluate(() => !window.__seelite.commander.loadout.h1),
	);
	const tradeBefore = await page.evaluate(
		() => window.__seelite.ladders.banked.trade,
	);
	// Sell the bought module, which was appended after the displaced stock one.
	await page
		.locator(
			'[data-live-recovered-fitting] [data-live-station-action="sell-recovered"]',
		)
		.last()
		.click();
	check(
		"bought-module resale cannot buy trade rank",
		(await page.evaluate(() => window.__seelite.ladders.banked.trade)) ===
			tradeBefore,
	);
	await page.locator('[data-outfit-candidate="hold:0"]').click();
	await preview.locator('[data-live-station-action="fit-recovered"]').click();
	check(
		"a carried module can be fitted again",
		await page.evaluate(
			() => window.__seelite.commander.loadout.h1?.module === "pulse-laser",
		),
	);
	await page.locator('[data-outfit-slot="plant"]').click();
	check(
		"core plant is replace-only",
		(await page
			.locator(
				'[data-live-slot="plant"] [data-live-station-action="remove-module"]',
			)
			.count()) === 0,
	);
	await page.locator('[data-outfit-candidate="stock:power-plant/1/E"]').focus();
	await page.keyboard.press("Enter");
	check(
		"keyboard selection opens a comparison",
		/Power plant/.test(await preview.innerText()),
	);
	await page.screenshot({ path: `${out}/core.png` });
	check(
		"controller navigation includes uniquely named slot and stock controls",
		await page.evaluate(() => {
			const c = window.__seelite.liveCockpit;
			const els = c.focusElements();
			const ids = c.focusIds(els);
			return (
				ids.some((id) => id.startsWith("outfit-slot:")) &&
				ids.some((id) => id.startsWith("outfit-candidate:stock:")) &&
				new Set(ids).size === ids.length
			);
		}),
	);
	check(
		"a market epoch refreshes the painted stock without a transaction",
		await page.evaluate(async () => {
			const g = window.__seelite;
			const { MARKET_PERIOD_MIN } = await import("/src/market.ts");
			const before = g.stationConsoleCache.outfitting.epoch;
			g.world.gameTime += MARKET_PERIOD_MIN * 60;
			g.updateCockpit();
			const screen = g.stationConsoleCache.outfitting;
			const painted = [...document.querySelectorAll(".lc-outfit-stock")].map(
				(e) => e.dataset.outfitCandidate,
			);
			return (
				screen.epoch !== before &&
				JSON.stringify(painted) ===
					JSON.stringify(screen.stock.map((c) => c.id))
			);
		}),
	);
	check("no browser errors", errors.length === 0);
} finally {
	await browser.close();
}
console.log(`${passed}/${passed} checks passed`);
if (t.failures) process.exit(1);
