/** Node #482: real console presses and Game steps. Time is stepped rather than
 * waited; relay approach is placed, not a claim of a principal flight. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	let page = await context.newPage();
	watch(page);
	await page.goto(gameUrl(origin, { seed: 56 }), { waitUntil: "load" });
	await bootedGame(page);
	await page.evaluate(() => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		g.headLook = "left";
		g.updateCockpit();
	});
	check(
		"unfitted pilot has no Sweep tab or action",
		(await page
			.locator('[data-live-left-tab="Sweep"], [data-live-sweep-action]')
			.count()) === 0,
	);
	await page.evaluate(async () => {
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);

		const g = window.__seelite;
		const market = await import("/src/market.ts");
		const sweep = await import("/src/system-sweep.ts");
		const cruise = await import("/src/cruise.ts");
		g.commander.loadout = migrateEquipment(g.commander.hull, [
			...equipmentNames(g.commander.loadout),
			market.LONG_RANGE_SCANNER,
		]).loadout;
		// Leave headroom so passive regeneration cannot conceal a sweep cost.
		g.chargeAu = g.chargeCapacityAu / 2;
		// An active derelict at this clock; no materialisation or discovery
		// write. A system holds one about a fifth of the time (node #775), so
		// the clock goes to this system's next loss rather than a fixed hour.
		const derelict = await import("/src/derelict-slots.ts");
		const { record } = g.world.system;
		g.world.gameTime =
			Math.min(
				...derelict
					.derelictSlots(record.index, record.government)
					.map(({ key }) => derelict.derelictNextLossAt(record.seed, key)),
			) + 1;
		window.__sweepProbe = {
			chargeS: sweep.SWEEP_CHARGE_S,
			staleS: sweep.SWEEP_STALE_S,
			maxChargeError: 0,
			step(seconds) {
				const n = Math.ceil(seconds / g.units.MAX_DT);
				for (let i = 0; i < n; i++) {
					const expected = cruise.chargeAfterRegen(
						g.chargeAu,
						seconds / n,
						g.chargeCapacityAu,
					);
					g.step(seconds / n);
					this.maxChargeError = Math.max(
						this.maxChargeError,
						Math.abs(g.chargeAu - expected),
					);
				}
				g.updateCockpit();
			},
			knowledge() {
				return JSON.stringify(
					g.commerceWorld.galaxies[g.world.system.record.galaxy].knowledge,
				);
			},
		};
		g.updateCockpit();
	});
	await page.locator('[data-live-left-tab="Sweep"]').click();
	const before = await page.evaluate(() => ({
		charge: window.__seelite.chargeAu,
		knowledge: window.__sweepProbe.knowledge(),
	}));
	await page.locator("[data-live-sweep-action]").click();
	check(
		"pressing Sweep consumes no drive charge",
		await page.evaluate(
			(charge) => window.__seelite.chargeAu === charge,
			before.charge,
		),
	);
	await page.evaluate(() =>
		window.__sweepProbe.step(window.__sweepProbe.chargeS / 2),
	);
	check(
		"one released press charges autonomously",
		(await page.locator("[data-live-sweep-status]").innerText()).includes(
			"CHARGING",
		) && (await page.locator("[data-live-sweep-region]").count()) === 0,
	);
	// Looking away and returning is not a held trigger.
	await page.locator('[data-live-left-tab="Navigation"]').click();
	await page.evaluate(() =>
		window.__sweepProbe.step(
			window.__sweepProbe.chargeS / 2 + window.__seelite.units.MAX_DT,
		),
	);
	await page.locator('[data-live-left-tab="Sweep"]').click();
	const completed = await page.evaluate(() => {
		const g = window.__seelite;
		return {
			rows: g.sweepReadings,
			chargeError: window.__sweepProbe.maxChargeError,
			knowledge: window.__sweepProbe.knowledge(),
			targetable: g.selectable().map((c) => c.id),
		};
	});
	check(
		"completion finds relay, wrecks and one pressure region",
		completed.rows.some((r) => r.kind === "relay") &&
			completed.rows.some((r) => r.kind === "wreck") &&
			completed.rows.filter((r) => r.kind === "pressure").length === 1,
	);
	check(
		"each sweep step changes drive charge only by passive regen",
		completed.chargeError <= 1e-12,
	);
	check(
		"sweep grants no knowledge, target or point",
		completed.knowledge === before.knowledge &&
			completed.rows.every(
				(r) =>
					!completed.targetable.includes(r.id) &&
					!("pos" in r) &&
					!("targetId" in r),
			),
	);
	const regions = page.locator("[data-live-sweep-region]");
	check(
		"rows show source and age and have no selectable controls",
		(await regions.count()) === completed.rows.length &&
			(await regions.allTextContents()).every(
				(t) => t.includes("OWN SENSORS") && t.includes("ago"),
			) &&
			(await regions.locator("button, a, [data-live-nav-target]").count()) ===
				0,
	);
	await page.screenshot({ path: "/tmp/node482-system-sweep.png" });
	// Node #769: the pressure row reads a strength in words, never a count.
	// This boot's system is lawful and has no outpost; an anarchy is swept in
	// its own context below for the contrast.
	const PRESSURE_ROW = '[data-live-sweep-region$=":pressure"]';
	const firstPressure = await page.evaluate(async () => {
		const g = window.__seelite;
		const record = g.world.system.record;
		const anarchy = (await import("/src/galaxy.ts"))
			.generateGalaxy(g.world.seed, record.galaxy)
			.systems.find((r) => r.government === 0);
		return {
			government: record.government,
			outpost: g.world.system.contents.stations.some(
				(s) => s.type === "outpost",
			),
			anarchyIndex: anarchy.index,
		};
	});
	firstPressure.label = await page.locator(`${PRESSURE_ROW} h3`).innerText();
	firstPressure.region = await page.locator(`${PRESSURE_ROW} p`).innerText();
	check(
		"without an outpost the pressure region names the cruise lanes",
		firstPressure.government >= 6 &&
			!firstPressure.outpost &&
			firstPressure.region.endsWith("· cruise lanes"),
		JSON.stringify(firstPressure),
	);
	const padAction = await page.evaluate(() => {
		const g = window.__seelite;
		g.liveCockpit.stepFocus(1);
		return g.liveCockpit.activateFocus() && g.sweepCharge !== null;
	});
	check(
		"the existing console focus/activation path can start Sweep",
		padAction,
	);
	const stamp = await page.evaluate(
		() => window.__seelite.sweepReadings[0].observedAt,
	);
	await page.evaluate(() => {
		window.__sweepProbe.step(2);
		window.__seelite.engageCruise();
		window.__seelite.updateCockpit();
	});
	check(
		"cruise engagement breaks charge and refuses Sweep",
		(await page.evaluate(
			() =>
				window.__seelite.sweepCharge === null &&
				window.__seelite.spoolLeftS > 0,
		)) &&
			(await page.locator("[data-live-sweep-action]").isDisabled()) &&
			(await page.locator("[data-live-sweep-status]").innerText()).includes(
				"Leave cruise",
			),
	);
	await page.evaluate(() => {
		window.__sweepProbe.step(
			window.__seelite.spoolLeftS + window.__seelite.units.MAX_DT,
		);
		window.__seelite.startSystemSweep();
	});
	check(
		"an active cruise leg cannot start a sweep",
		await page.evaluate(
			() =>
				window.__seelite.regime === "cruise" &&
				window.__seelite.sweepCharge === null,
		),
	);
	await page.evaluate(() => {
		const g = window.__seelite;
		g.dropOut("sweep probe");
		window.__sweepProbe.step(window.__sweepProbe.chargeS + g.units.MAX_DT);
	});
	check(
		"interrupted charge does not resume or refresh rows",
		await page.evaluate(
			(observedAt) =>
				window.__seelite.sweepReadings[0].observedAt === observedAt,
			stamp,
		),
	);
	const flushed = await page.evaluate(async () => {
		const g = window.__seelite;
		g.saveFlush("quit");
		await g.saveStore?.settled();
		const saved = await g.saveStore.load(g.saveStore.slot); // glossary-ignore: slot
		return (
			JSON.stringify(saved.commander.sweepReadings) ===
				JSON.stringify(g.sweepReadings) &&
			saved.commander.sweepReadings.length > 0
		);
	});
	check("completed readings reach the live save store", flushed);
	await page.close();
	page = await context.newPage();
	watch(page);
	await page.goto(gameUrl(origin), { waitUntil: "load" });
	await bootedGame(page);
	const loaded = await page.evaluate(async () => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const sweep = await import("/src/system-sweep.ts");
		const retained = JSON.stringify(g.sweepReadings);
		g.world.gameTime += sweep.SWEEP_STALE_S;
		g.headLook = "left";
		g.leftTab = "Sweep";
		g.updateCockpit();
		return { rows: retained, charge: g.sweepCharge };
	});
	check(
		"reload retains sensor readings and no running charge",
		loaded.rows === JSON.stringify(completed.rows) && loaded.charge === null,
	);
	check(
		"ages advance on the game clock and hour-old rows remain marked stale",
		(await page.locator("[data-live-sweep-region]").allTextContents()).every(
			(t) => t.includes("STALE"),
		) &&
			(await page.locator("[data-live-sweep-region]").count()) ===
				completed.rows.length,
	);
	check(
		"reload keeps the pressure row's recorded strength and cruise lanes",
		(await page.locator(`${PRESSURE_ROW} h3`).innerText()) ===
			firstPressure.label &&
			(await page.locator(`${PRESSURE_ROW} p`).innerText()) ===
				firstPressure.region,
	);
	const approach = await page.evaluate(async () => {
		const g = window.__seelite;
		const relay = await import("/src/pirate-relay.ts");
		const relayIdentity = await import("/src/relay-slot.ts"); // glossary-ignore: slot
		const ws = await import("/src/world-state.ts");
		const plan = g.currentRelayPlan();
		const key = relayIdentity.relaySlot(g.world.system.record.index).key;
		const place = (km) => {
			const pos = relay.relayPosition(
				plan,
				g.world.system.contents,
				g.world.gameTime,
			);
			g.world.ship.pos = { x: pos.x + km, y: pos.y, z: pos.z };
			g.world.ship.vel = relay.relayVelocity(
				plan,
				g.world.system.contents,
				g.world.gameTime,
			);
			g.step(g.units.MAX_DT);
			g.render(g.units.MAX_DT);
			g.updateCockpit();
		};
		place((relay.RELAY_SIGNAL_RANGE_KM + relay.RELAY_IDENTIFY_RANGE_KM) / 2);
		const cue = g.relayCue();
		const unknown =
			ws.readKnowledge(
				g.commerceWorld.galaxies[g.world.system.record.galaxy],
				key,
			) === undefined;
		place(relay.RELAY_IDENTIFY_RANGE_KM / 2);
		return {
			cue: !!cue,
			unknown,
			identified:
				ws.readKnowledge(
					g.commerceWorld.galaxies[g.world.system.record.galaxy],
					key,
				) !== undefined,
			contact: g.selectable().some((c) => c.id === key),
		};
	});
	check(
		"placement inside cue range preserves unknown state; placement inside identify range makes a contact",
		approach.cue && approach.unknown && approach.identified && approach.contact,
		JSON.stringify(approach),
	);
	// Node #769: an anarchy, swept by a real press in its own browser context.
	// A pinned system attaches no save store, which is why reload is proven on
	// the lawful boot above rather than here.
	const anarchyContext = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const anarchyPage = await anarchyContext.newPage();
	watch(anarchyPage);
	await anarchyPage.goto(
		gameUrl(origin, { seed: 56, system: firstPressure.anarchyIndex }),
		{ waitUntil: "load" },
	);
	await bootedGame(anarchyPage);
	const anarchy = await anarchyPage.evaluate(async () => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const market = await import("/src/market.ts");
		g.commander.ownedEquipment.push(market.LONG_RANGE_SCANNER);
		g.headLook = "left";
		g.updateCockpit();
		const record = g.world.system.record;
		return { index: record.index, government: record.government };
	});
	await anarchyPage.locator('[data-live-left-tab="Sweep"]').click();
	await anarchyPage.locator("[data-live-sweep-action]").click();
	await anarchyPage.evaluate(async () => {
		const g = window.__seelite;
		const sweep = await import("/src/system-sweep.ts");
		const seconds = sweep.SWEEP_CHARGE_S + g.units.MAX_DT;
		const n = Math.ceil(seconds / g.units.MAX_DT);
		for (let i = 0; i < n; i++) g.step(seconds / n);
		g.updateCockpit();
	});
	const anarchyRow = anarchyPage.locator(PRESSURE_ROW);
	anarchy.label = await anarchyRow.locator("h3").innerText();
	anarchy.region = await anarchyRow.locator("p").innerText();
	const strengthWords = /^(Light|Moderate|Heavy) raider pressure$/;
	check(
		"a lawful system and an anarchic one read different pressure strengths, neither as a count",
		anarchy.government === 0 &&
			anarchy.index === firstPressure.anarchyIndex &&
			strengthWords.test(firstPressure.label) &&
			strengthWords.test(anarchy.label) &&
			firstPressure.label !== anarchy.label,
		JSON.stringify({ firstPressure, anarchy }),
	);
	check(
		"an outpost keeps its station name as the pressure region",
		anarchy.region.startsWith("Surrounds of "),
		anarchy.region,
	);
	const anarchyClean = await anarchyPage.evaluate(() => {
		const g = window.__seelite;
		const targetable = g.selectable().map((c) => c.id);
		return g.sweepReadings.every(
			(r) => !targetable.includes(r.id) && !("pos" in r),
		);
	});
	check(
		"the anarchy's rows stay unselectable",
		anarchyClean &&
			(await anarchyPage
				.locator("[data-live-sweep-region]")
				.locator("button, a, [data-live-nav-target]")
				.count()) === 0,
	);
	await anarchyPage.screenshot({ path: "/tmp/node769-anarchy-sweep.png" });
	await anarchyContext.close();
} finally {
	await browser.close();
}
exit();
