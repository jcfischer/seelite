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
function check(name, ok, detail = "") {
	if (!ok) throw Error(detail ? `${name}: ${detail}` : name);
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
			const { commanderFuelCapacityLy } = await import(
				"/src/station-commerce.ts"
			);
			return g.commander.fuelLy === commanderFuelCapacityLy(g.commander);
		}),
	);
	// A fitted tank raises the gauge's capacity and leaves the range on the
	// hull (#926). The figures come off the page's own modules.
	const before = await page.evaluate(async () => {
		const g = window.__seelite;
		const { makeModule } = await import("/src/loadout.ts");
		const saved = g.commander;
		g.commander = {
			...saved,
			loadout: { ...saved.loadout, i1: makeModule("fuel-tank", 1, "E") },
		};
		g.stationConsoleRevision++;
		g.updateCockpit();
		return saved;
	});
	await fuelRow.locator('[data-live-station-action="buy-fuel"]').click();
	const tank = await page.evaluate(async () => {
		const g = window.__seelite;
		const { HULL_SPECS } = await import("/src/hull.ts");
		const { moduleRow } = await import("/src/loadout.ts");
		return {
			hullLy: HULL_SPECS[g.commander.hull].tankLy,
			addLy: moduleRow(g.commander.loadout.i1).output.fuelLy,
			fuelLy: g.commander.fuelLy,
			capacityLy: g.fuelCapacityLy,
			rangeLy: g.jumpRangeLy,
		};
	});
	const gauge = await fuelRow.innerText();
	check(
		"a fitted tank fills past the hull's tank and the gauge shows it",
		tank.capacityLy === tank.hullLy + tank.addLy &&
			tank.fuelLy === tank.capacityLy &&
			// The row prints `9.0 / 9.0 LY`; whitespace is not the claim.
			gauge.replace(/\s+/g, "").includes(`/${tank.capacityLy.toFixed(1)}LY`),
		JSON.stringify({ ...tank, gauge }),
	);
	check(
		"the jump range stays the hull's tankLy",
		tank.rangeLy === tank.hullLy,
		JSON.stringify(tank),
	);
	await page.evaluate((saved) => {
		const g = window.__seelite;
		g.commander = saved;
		g.stationConsoleRevision++;
		g.updateCockpit();
	}, before);
	const credits = await page.evaluate(() => window.__seelite.commander.credits);
	await page.locator('[data-outfit-candidate="stock:pulse-laser/1/E"]').click();
	check(
		"selecting a row spends nothing",
		(await page.evaluate(() => window.__seelite.commander.credits)) === credits,
	);
	const preview = page.locator("[data-live-outfit-preview]");
	const deltaText = async (label) =>
		(await page.locator(`[data-outfit-delta="${label}"]`).allInnerTexts()).join(
			"|",
		);
	// The same module as fitted: only the two always rows, each unmoved (#927).
	check(
		"comparison shows handling and credit, each with its signed change, before purchase",
		/^ACCEL .*→.*±0\.000$/.test(await deltaText("ACCEL")) &&
			/^CREDIT \/ RAIDER .*→.*±0\.00$/.test(await deltaText("CREDIT / RAIDER")),
		await preview.innerText(),
	);
	await page.screenshot({ path: `${out}/comparison.png` });
	// A candidate that moves a capacity prints that row with its change. A 1E
	// cargo rack is in every station's stock (`module-stock.ts`).
	await page.locator('[data-outfit-slot="i1"]').click();
	await page.locator('[data-outfit-candidate="stock:cargo-rack/1/E"]').click();
	const rackT = await page.evaluate(async () => {
		const { moduleRow, makeModule } = await import("/src/loadout.ts");
		return moduleRow(makeModule("cargo-rack", 1, "E")).output.cargoT;
	});
	const holdRow = await deltaText("HOLD");
	check(
		"a cargo rack prints HOLD with its tonnes as a signed change",
		holdRow.startsWith("HOLD ") && holdRow.endsWith(` t +${rackT}`),
		holdRow,
	);
	await page.screenshot({ path: `${out}/comparison-hold.png` });
	await page.locator('[data-outfit-slot="h1"]').click();
	await page.locator('[data-outfit-candidate="stock:pulse-laser/1/E"]').click();
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
	// #925: the fitted plant and Extra Energy Units set the flown bank, through
	// the console's own transactions; the expected figures come off the page.
	const bank = await page.evaluate(async () => {
		const g = window.__seelite;
		const { carriedModule, fittedCapacity, makeModule } = await import(
			"/src/loadout.ts"
		);
		const read = () => ({
			energy: g.condition.energy,
			max: g.condition.energyMax,
			regen: g.condition.energyRegenPerS,
		});
		const want = () => fittedCapacity(g.commander.hull, g.commander.loadout);
		const fit = (module, slot) => {
			g.commander = {
				...g.commander,
				recoveredFittings: [
					...(g.commander.recoveredFittings ?? []),
					carriedModule(module),
				],
			};
			const index = g.commander.recoveredFittings.length - 1;
			return g.transactStation({ type: "fit-recovered", slot, index });
		};
		g.condition = { ...g.condition, energy: g.condition.energyMax };
		const stock = read();
		const fitted =
			fit(makeModule("power-plant", 1, "A"), "plant") &&
			fit(makeModule("extra-energy-unit", 1, "E"), "flex");
		const bought = { ...read(), want: want() };
		const removed = g.transactStation({ type: "remove-module", slot: "flex" });
		const after = { ...read(), want: want() };
		const beforeRefusal = JSON.stringify(read());
		const plantRefused = !g.transactStation({
			type: "remove-module",
			slot: "plant",
		});
		const unchanged = JSON.stringify(read()) === beforeRefusal;
		// A hull bought to wait for the launch (#556 D10) is adopted without
		// being flown: the flown ship keeps its fitted bank until it takes over.
		const own = g.commander;
		const other = own.hull === "freighter" ? "courier" : "freighter";
		const holding = (commander) => ({
			holdings: { ...g.holdings(), commander },
			world: g.commerceWorld,
		});
		g.adopt("world", holding({ ...own, hull: other }), null);
		const pending = JSON.stringify(read()) === beforeRefusal;
		g.adopt("world", holding(own), null);
		const launched = g.launch();
		for (let i = 0; i < 30; i++) g.step(1 / 60);
		return {
			stock,
			fitted,
			bought,
			removed,
			after,
			plantRefused,
			unchanged,
			pending,
			launched,
			flown: { ...read(), want: want() },
		};
	});
	console.log(JSON.stringify(bank));
	check(
		"a refit plant and Extra Energy Unit arrive as the flown bank, full",
		bank.fitted &&
			bank.bought.max === bank.bought.want.bankE &&
			bank.bought.regen === bank.bought.want.regenPerS &&
			bank.bought.max > bank.stock.max &&
			bank.bought.energy === bank.bought.max,
	);
	check(
		"removing the Extra Energy Unit clamps the bank to the plant's",
		bank.removed &&
			bank.after.max === bank.after.want.bankE &&
			bank.after.max < bank.bought.max &&
			bank.after.energy === bank.after.max,
	);
	check(
		"the plant is replace-only and the refusal leaves the bank alone",
		bank.plantRefused && bank.unchanged,
	);
	check(
		"a hull waiting for the launch leaves the flown bank alone",
		bank.pending,
	);
	check(
		"the launched flight carries the fitted maxima",
		bank.launched &&
			bank.flown.max === bank.flown.want.bankE &&
			bank.flown.regen === bank.flown.want.regenPerS,
	);
	check("no browser errors", errors.length === 0);
} finally {
	await browser.close();
}
console.log(`${passed}/${passed} checks passed`);
if (t.failures) process.exit(1);
