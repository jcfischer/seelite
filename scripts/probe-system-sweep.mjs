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
		const g = window.__seelite;
		const market = await import("/src/market.ts");
		const sweep = await import("/src/system-sweep.ts");
		const cruise = await import("/src/cruise.ts");
		g.commander.ownedEquipment.push(market.LONG_RANGE_SCANNER);
		// Leave headroom so passive regeneration cannot conceal a sweep cost.
		g.chargeAu = g.chargeCapacityAu / 2;
		// Active derelicts at this clock; no materialisation or discovery write.
		const derelict = await import("/src/derelict-slots.ts");
		g.world.gameTime = derelict.DERELICT_FIRST_LOSS_S;
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
} finally {
	await browser.close();
}
exit();
