/** Default-layout live missile/ECM controls, carrier consequence and painted
 * lock/warning cues. Arithmetic and seeker tuning live in missiles.test.ts. */
// A default-layout probe (#381 D11): F7 launches and F8 pulses the E.C.M.
import {
	bootedGame,
	installViewPlacement,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { stopLoop, installViewFraming } from "./lib/view-placement.mjs";
const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	for (const width of [900, 390]) {
		const page = await browser.newPage({ viewport: { width, height: 780 } });
		watch(page);
		await installViewPlacement(page);
		await installViewFraming(page);
		await page.goto(gameUrl(origin, { seed: 42 }));
		await bootedGame(page);
		await stopLoop(page);
		const npc = await page.evaluate(async () => {
			const g = window.__seelite;
			const { makeModule, stockLoadout } = await import("/src/loadout.ts");
			const { raiderAtDrop } = await import("/src/duel.ts");
			const { fullCondition } = await import("/src/ship-condition.ts");
			const { add, scale } = await import("/src/vec3.ts");
			g.commander = {
				...g.commander,
				loadout: {
					...stockLoadout("courier"),
					h1: makeModule("missile-rack", 1),
					u1: makeModule("ecm", 1),
				},
			};
			g.condition = fullCondition("courier");
			g.regime = "normal";
			g.forceRaider("ahead", 0, 5);
			const e = g.encounter;
			e.phase = "duel";
			e.raider = {
				flight: raiderAtDrop(
					add(g.world.ship.pos, scale(g.weaponAim(), 5)),
					g.world.ship,
					e.seed,
				),
				condition: fullCondition("raider"),
			};
			g.targetId = e.slot.key;
			g.stepMissileCombat(0, []);
			const enemy = g.missileCombat.enemy;
			enemy.loadout = { ...enemy.loadout, h2: makeModule("missile-rack", 1) };
			enemy.lock = { targetId: "player", seconds: 1.5 };
			enemy.launchAt = g.world.gameTime;
			g.stepMissileCombat(0.05, []);
			const npc = {
				ammo: enemy.loadout.h2.ammo,
				incoming: g.missileCombat.missiles.filter(
					(m) => m.targetId === "player",
				).length,
			};
			g.missileCombat.missiles = [];
			enemy.launchAt = g.world.gameTime + 1000;
			g.stepMissileCombat(1.5, []);
			g.render(0);
			return npc;
		});
		check(
			`${width}: fitted raider fires back through the live controller`,
			npc.ammo === 3 && npc.incoming === 1,
			JSON.stringify(npc),
		);
		let reading = await page.evaluate(() => window.__seelite.missileRender);
		check(
			`${width}: locked rack is named on fitted glass`,
			reading?.text.includes("LOCKED") &&
				reading.text.includes("4/4") &&
				reading.x >= 0 &&
				reading.x + reading.width <= width,
			JSON.stringify(reading),
		);
		await page.keyboard.press("F7");
		const launch = await page.evaluate(() => {
			const g = window.__seelite;
			return {
				ammo: g.commander.loadout.h1.ammo,
				flying: g.missileCombat.missiles.length,
			};
		});
		check(
			`${width}: bound launch spends one round`,
			launch.ammo === 3 && launch.flying === 1,
			JSON.stringify(launch),
		);
		const kill = await page.evaluate(() => {
			const g = window.__seelite,
				key = g.encounter.slot.key;
			for (let i = 0; i < 80 && g.encounter; i++) g.stepMissileCombat(0.05, []);
			return {
				ended: !g.encounter,
				condition: g.carrierCondition(key).condition,
				ammo: g.commander.loadout.h1.ammo,
			};
		});
		check(
			`${width}: missile hit writes the live raider destruction`,
			kill.ended && kill.condition === "destroyed" && kill.ammo === 3,
			JSON.stringify(kill),
		);
		await page.evaluate(async () => {
			const g = window.__seelite;
			const { add, scale } = await import("/src/vec3.ts");
			g.missileCombat.missiles = [
				{
					targetId: "player",
					pos: add(g.world.ship.pos, scale(g.nose(), 1)),
					nose: scale(g.nose(), -1),
					leftS: 12,
				},
			];
			g.render(0);
		});
		reading = await page.evaluate(() => window.__seelite.missileRender);
		const red = await page.evaluate(() => {
			const g = window.__seelite,
				r = g.missileRender;
			const canvas = document.getElementById("overlay"),
				ctx = canvas.getContext("2d");
			const data = ctx.getImageData(
				Math.floor(r.x),
				Math.floor(r.y),
				Math.ceil(r.width),
				65,
			).data;
			let count = 0;
			for (let i = 0; i < data.length; i += 4)
				if (
					data[i] > 180 &&
					data[i + 1] < 160 &&
					data[i + 2] < 140 &&
					data[i + 3] > 100
				)
					count++;
			return count;
		});
		check(
			`${width}: incoming warning paints red pixels`,
			reading?.incoming &&
				reading.text.includes("INCOMING MISSILE") &&
				red > 15,
			JSON.stringify({ reading, red }),
		);
		await page.screenshot({ path: `/tmp/seelite-874-incoming-${width}.png` });
		await page.keyboard.press("F8");
		const pulse = await page.evaluate(() => {
			const g = window.__seelite;
			g.render(0);
			return {
				energy: g.condition.energy,
				flying: g.missileCombat.missiles.length,
				text: g.missileRender.text,
			};
		});
		check(
			`${width}: bound ECM defeats the threat and spends bank`,
			pulse.energy === 92 &&
				pulse.flying === 0 &&
				pulse.text.includes("ECM PULSE"),
			JSON.stringify(pulse),
		);
		await page.keyboard.press("F8");
		check(
			`${width}: a repeated press on cooldown spends no bank`,
			await page.evaluate(() => window.__seelite.condition.energy === 92),
		);
		await page.screenshot({ path: `/tmp/seelite-874-pulse-${width}.png` });
		if (width === 900) {
			const credits = await page.evaluate(async () => {
				const g = window.__seelite;
				const { makeModule } = await import("/src/loadout.ts");
				g.commander = {
					...g.commander,
					loadout: {
						...g.commander.loadout,
						u2: makeModule("docking-computer", 1),
					},
				};
				const station = g.world.system.bodies.find(
					(b) => b.kind === "station" && b.stationType === "trade",
				);
				await window.__parkInBerth(
					station.id,
					g.berthIdsOfStation(station.id)[0],
				);
				g.setHeadLook("forward");
				g.updateCockpit();
				return g.commander.credits;
			});
			await page.locator('[data-live-station-tab="Equipment"]').click();
			await page.locator('[data-live-station-action="buy-missiles"]').click();
			const rearmed = await page.evaluate(() => ({
				ammo: window.__seelite.commander.loadout.h1.ammo,
				credits: window.__seelite.commander.credits,
			}));
			check(
				"dock REARM replaces the spent round and charges the wallet",
				rearmed.ammo === 4 && rearmed.credits === credits - 30,
				JSON.stringify(rearmed),
			);
		}
		await page.close();
	}
} finally {
	await browser.close();
}
exit();
