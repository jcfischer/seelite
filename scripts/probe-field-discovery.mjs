import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	installViewPlacement,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { placeFieldDiscovery } from "./lib/field-discovery-fixture.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
try {
	for (const mining of [false, true]) {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
		});
		let page = await context.newPage();
		watch(page);
		await installViewPlacement(page);
		await page.goto(
			gameUrl(origin, {
				seed: 47,
				mining,
				voices: "formant",
				raider: "off",
			}),
		);
		await bootedGame(page);
		await page.evaluate(async () => {
			const Sim = await import("/src/sim.ts");
			const W = await import("/src/world-state.ts");
			const g = window.__seelite;
			g.clockHeld = true;
			Sim.jumpWorldTo(g.world, g.world.galaxy.systems[4]);
			g.rebuildSystem();
			g.adoptWorld(W.visit(g.commerceWorld, 0, 4));
		});
		const unknown = await placeFieldDiscovery(page, "unknown");
		const initial = await page.evaluate((id) => {
			const g = window.__seelite;
			g.refreshScannerContacts();
			g.targetId = id;
			const draw = g.fields.find((f) => f.plan.id === id);
			const points = draw?.root.getObjectByName("asteroid-points");
			const out = {
				selectable: g.selectableIds().includes(id),
				scope: g.scannerContacts.some((c) => c.id === id),
				target: g.targetBody(),
				rocks: g.fields.find((f) => f.plan.id === id)?.rocks.length ?? 0,
				drawn:
					draw?.root.parent !== null &&
					points?.visible &&
					points.geometry.drawRange.count > 0,
			};
			g.targetId = null;
			return out;
		}, unknown.fieldId);
		check(
			`unknown rare field is hidden and untargetable with mining=${mining}`,
			!initial.selectable &&
				!initial.scope &&
				initial.target === null &&
				(await page
					.locator(`[data-live-nav-target="${unknown.fieldId}"]`)
					.count()) === 0,
		);
		check(
			`unknown physical rocks remain drawn with mining=${mining}`,
			initial.rocks > 0 && initial.drawn,
		);
		check(
			`charted field stays available with mining=${mining}`,
			await page.evaluate(() =>
				window.__seelite.selectableIds().includes("field-00"),
			),
		);
		if (mining) {
			await placeFieldDiscovery(page, "lead");
			const lead = await page.evaluate(() => {
				const g = window.__seelite;
				const row = g.sweepReadings.find((r) => r.kind === "field");
				return {
					row,
					known: g.commerceWorld.galaxies[0].fieldDiscoveries,
					ids: g.selectableIds(),
				};
			});
			check(
				"real Sweep press records a sourced regional field lead without discovering",
				lead.row?.region.kind === "system-space" &&
					lead.row.source === "own-sensors" &&
					lead.known.length === 0 &&
					!lead.ids.includes(unknown.fieldId),
			);
			const region = page.locator(`[data-live-sweep-region="${lead.row?.id}"]`);
			check(
				"field lead has no point target control",
				(await region.locator("button,a,[data-live-nav-target]").count()) ===
					0 && (await region.innerText()).includes("OWN SENSORS"),
			);
		} else {
			check(
				"scanner-free pilot has no sweep module",
				(await page.locator('[data-live-left-tab="Sweep"]').count()) === 0,
			);
		}
		await placeFieldDiscovery(page, "known");
		const row = page.locator(`[data-live-nav-target="${unknown.fieldId}"]`);
		check(
			`real normal-flight entry adds Navigation with mining=${mining}`,
			(await row.count()) === 1,
		);
		await row.click();
		const saved = await page.evaluate(async (id) => {
			const g = window.__seelite;
			g.refreshScannerContacts();
			const selected = g.targetBody()?.id === id;
			const scope = g.scannerContacts.some((c) => c.id === id);
			g.saveFlush("quit");
			await g.saveStore.settled();
			const loaded = await g.saveStore.load(g.saveStore.slot);
			return {
				selected,
				scope,
				known: loaded.world.galaxies[0].fieldDiscoveries,
				other: loaded.world.galaxies[1].fieldDiscoveries,
				readings: loaded.commander.sweepReadings,
			};
		}, unknown.fieldId);
		check(
			"selection, scope and real save store receive discovery only in its galaxy",
			saved.selected &&
				saved.scope &&
				saved.known.includes(`4:${unknown.fieldId}`) &&
				saved.other.length === 0,
		);
		await page.close();
		page = await context.newPage();
		watch(page);
		await page.goto(gameUrl(origin, { voices: "formant" }));
		await bootedGame(page);
		const loaded = await page.evaluate(async (id) => {
			const g = window.__seelite;
			g.clockHeld = true;
			const Sim = await import("/src/sim.ts");
			const row = g.sweepReadings.find((r) => r.kind === "field");
			if (row) {
				Sim.advanceWorldClock(
					g.world,
					Math.max(0, row.observedAt + 3600 - g.world.gameTime),
				);
				g.leftTab = "Sweep";
				g.setHeadLook("left");
				g.updateCockpit();
			}
			return {
				known: g.selectableIds().includes(id),
				ledger: g.commerceWorld.galaxies[0].fieldDiscoveries,
				row,
				stale: row
					? (document.querySelector(`[data-live-sweep-region="${row.id}"]`)
							?.textContent ?? "")
					: "",
			};
		}, unknown.fieldId);
		check(
			`reload retains field discovery with mining=${mining}`,
			loaded.known && loaded.ledger.includes(`4:${unknown.fieldId}`),
		);
		if (mining)
			check(
				"reload preserves lead source/time and its independent stale age",
				JSON.stringify(loaded.row) ===
					JSON.stringify(saved.readings.find((r) => r.kind === "field")) &&
					loaded.stale.includes("STALE"),
			);
		await context.close();
	}
} finally {
	await browser.close();
}
exit();
