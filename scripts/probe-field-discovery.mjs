import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	installViewPlacement,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";
import { placeFieldDiscovery } from "./lib/field-discovery-fixture.mjs";
import { installCompositeFrame } from "./lib/composite-frame.mjs";

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
		await installCompositeFrame(page);
		await page.goto(
			gameUrl(origin, {
				seed: 47,
				mining: mining ? 1 : undefined,
				voices: "formant",
				raider: "off",
			}),
		);
		await bootedGame(page);
		check(
			`live mining flag matches initial arm=${mining}`,
			(await page.evaluate(() => window.__seelite.surveyState().on)) === mining,
		);
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
		const painted = await page.evaluate((id) => {
			const g = window.__seelite;
			g.setHeadLook("forward");
			const draw = g.fields.find((f) => f.plan.id === id);
			const parent = draw.root.parent;
			const region = { x: 260, y: 140, width: 120, height: 120 };
			const shown = window.__compositeFrame(640, 400, region).data;
			draw.root.removeFromParent();
			let hidden;
			try {
				hidden = window.__compositeFrame(640, 400, region).data;
			} finally {
				parent.add(draw.root);
			}
			const restored = window.__compositeFrame(640, 400, region).data;
			let changed = 0,
				unstable = 0;
			for (let i = 0; i < shown.length; i += 4) {
				if (
					shown[i] !== hidden[i] ||
					shown[i + 1] !== hidden[i + 1] ||
					shown[i + 2] !== hidden[i + 2]
				)
					changed++;
				if (
					shown[i] !== restored[i] ||
					shown[i + 1] !== restored[i + 1] ||
					shown[i + 2] !== restored[i + 2]
				)
					unstable++;
			}
			g.setHeadLook("left");
			return { changed, unstable, known: g.selectableIds().includes(id) };
		}, unknown.fieldId);
		check(
			`unknown physical field reaches stable rendered pixels with mining=${mining}`,
			painted.changed > 0 && painted.unstable === 0 && !painted.known,
			JSON.stringify(painted),
		);
		check(
			"scanner-free pilot has no sweep module",
			await page.evaluate(() => !window.__seelite.systemSweepContext().fitted),
		);
		const initialLoadout = await page.evaluate(
			() => window.__seelite.commander.loadout,
		);
		{
			await placeFieldDiscovery(page, "lead");
			const lead = await page.evaluate(() => {
				const g = window.__seelite;
				const row = g.sweepReadings.find((r) => r.kind === "field");
				return {
					row,
					known: g.commerceWorld.galaxies[0].fieldDiscoveries,
					ids: g.selectableIds(),
					fitted: g.systemSweepContext().fitted,
				};
			});
			check(
				"real Sweep press records a sourced regional field lead without discovering",
				lead.fitted &&
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
		}
		await page.evaluate((loadout) => {
			window.__seelite.commander.loadout = loadout;
		}, initialLoadout);
		check(
			"proximity flight has no scanner fitted",
			await page.evaluate(() => !window.__seelite.systemSweepContext().fitted),
		);
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
		await page.goto(
			gameUrl(origin, { voices: "formant", mining: mining ? 1 : undefined }),
		);
		await bootedGame(page);
		check(
			`live mining flag matches reload arm=${mining}`,
			(await page.evaluate(() => window.__seelite.surveyState().on)) === mining,
		);
		const loaded = await page.evaluate(async (id) => {
			const g = window.__seelite;
			g.clockHeld = true;
			const Sim = await import("/src/sim.ts");
			const row = g.sweepReadings.find((r) => r.kind === "field");
			if (row) {
				const L = await import("/src/loadout.ts");
				const M = await import("/src/market.ts");
				g.commander.loadout = L.migrateEquipment(g.commander.hull, [
					...L.equipmentNames(g.commander.loadout),
					M.LONG_RANGE_SCANNER,
				]).loadout;
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
		check(
			"reload preserves lead source/time and its independent stale age",
			JSON.stringify(loaded.row) ===
				JSON.stringify(saved.readings.find((r) => r.kind === "field")) &&
				loaded.stale.includes("STALE"),
		);
		await context.close();
	}
	for (const miss of [true, false]) {
		const context = await browser.newContext({
			viewport: { width: 900, height: 620 },
		});
		let page = await context.newPage();
		watch(page);
		await page.goto(
			gameUrl(origin, { seed: 47, voices: "formant", raider: "off" }),
		);
		await bootedGame(page);
		const flown = await page.evaluate(async (miss) => {
			const A = await import("/src/asteroid-field.ts");
			const Sim = await import("/src/sim.ts");
			const W = await import("/src/world-state.ts");
			const C = await import("/src/cruise.ts");
			const V = await import("/src/vec3.ts");
			const g = window.__seelite;
			g.clockHeld = true;
			Sim.jumpWorldTo(g.world, g.world.galaxy.systems[10]);
			g.rebuildSystem();
			g.clearSystemScopedState();
			g.adoptWorld(W.visit(g.commerceWorld, 0, 10));
			g.resetDock();
			g.dockingComputer.disengage();
			g.targetId = null;
			g.detour = null;
			g.cruiseTrackId = null;
			g.regime = "cruise";
			g.spoolLeftS = 0;
			g.setThrottle(1);
			const plan = g.fields.find((f) => f.plan.profile === "rare").plan;
			const dt = g.units.MAX_DT;
			const at = g.world.gameTime;
			const offset = miss ? 1001 : 0;
			const start = V.add(A.fieldCentre(plan, at), V.v3(offset, 0, -2000));
			const aim = V.add(A.fieldCentre(plan, at + dt), V.v3(offset, 0, 2000));
			const leg = V.sub(aim, start);
			const speed = V.length(leg) / dt;
			const nose = V.scale(leg, 1 / V.length(leg));
			g.setAttitude(nose, V.v3(0, 1, 0));
			g.world.ship.pos = start;
			g.world.ship.vel = V.scale(nose, speed);
			g.cruiseParams = {
				...g.cruiseParams,
				vMinKms: speed,
				vMaxKms: speed,
				vicinityKm: 0,
				dropSpeedKms: speed,
			};
			g.step(dt);
			const from = V.sub(start, A.fieldCentre(plan, at));
			const to = V.sub(g.world.ship.pos, A.fieldCentre(plan, g.world.gameTime));
			const relative = V.sub(to, from);
			return {
				startAt: at,
				endAt: g.world.gameTime,
				startKm: V.length(from),
				endKm: V.length(to),
				closestKm: C.closestApproachKm(
					from,
					V.scale(relative, 1 / V.length(relative)),
					V.length(relative),
					V.v3(),
				),
				known: g.commerceWorld.galaxies[0].fieldDiscoveries.includes(
					`10:${plan.id}`,
				),
				selectable: g.selectableIds().includes(plan.id),
				regime: g.regime,
			};
		}, miss);
		check(
			`actual Game cruise ${miss ? "near miss" : "fly-through"} has both endpoints outside at distinct clocks`,
			flown.startKm > 1000 &&
				flown.endKm > 1000 &&
				flown.endAt > flown.startAt &&
				flown.regime === "cruise",
			JSON.stringify(flown),
		);
		check(
			`actual Game cruise ${miss ? "near miss stays unknown" : "crossing discovers and updates selection"}`,
			miss
				? flown.closestKm > 1000 && !flown.known && !flown.selectable
				: flown.closestKm < 1000 && flown.known && flown.selectable,
			JSON.stringify(flown),
		);
		if (!miss) {
			const transition = await page.evaluate(async () => {
				const A = await import("/src/asteroid-field.ts");
				const S = await import("/src/system.ts");
				const C = await import("/src/cruise.ts");
				const V = await import("/src/vec3.ts");
				const g = window.__seelite;
				const to = g.world.galaxy.systems[230];
				const contents = S.generateContents(to);
				const plan = A.systemFields(to, contents).find(
					(f) => f.profile === "rare",
				);
				const at = g.world.gameTime + g.units.MAX_DT;
				const arrival = S.arrivalPoint(
					to,
					contents,
					g.world.system.record.pos,
					at,
				);
				const centre = A.fieldCentre(plan, at);
				g.regime = "normal";
				g.assist = false;
				g.setThrottle(0);
				g.world.ship.pos = V.sub(V.scale(centre, 2), arrival);
				g.world.ship.vel = V.v3();
				g.step(g.units.MAX_DT);
				const departure = { ...g.world.ship.pos };
				g.targetId = "field-01";
				if (!g.jumpDecision(to).ok)
					throw new Error("discovery jump fixture is not affordable");
				g.performJump(to);
				const jumpedAt = g.world.gameTime;
				const arrived = { ...g.world.ship.pos };
				const leg = V.sub(arrived, departure);
				const syntheticClosestKm = C.closestApproachKm(
					departure,
					V.scale(leg, 1 / V.length(leg)),
					V.length(leg),
					A.fieldCentre(plan, jumpedAt),
				);
				g.step(g.units.MAX_DT);
				g.saveFlush("quit");
				await g.saveStore.settled();
				return {
					system: g.world.system.record.index,
					at: g.world.gameTime,
					jumpedAt,
					syntheticClosestKm,
					departureKm: V.length(V.sub(departure, centre)),
					arrivalKm: V.length(V.sub(arrived, centre)),
					known: g.commerceWorld.galaxies[0].fieldDiscoveries,
					selectable: g.selectableIds().includes("field-01"),
					target: g.targetBody()?.kind ?? null,
				};
			});
			check(
				"actual jump/rebuild discards a would-be old-system segment through the destination field",
				transition.system === 230 &&
					transition.at > transition.jumpedAt &&
					transition.syntheticClosestKm < 1000 &&
					transition.departureKm > 1000 &&
					transition.arrivalKm > 1000 &&
					transition.known.includes("10:field-01") &&
					!transition.known.includes("230:field-01") &&
					!transition.selectable &&
					transition.target !== "field",
				JSON.stringify(transition),
			);
			await page.close();
			page = await context.newPage();
			watch(page);
			await page.goto(gameUrl(origin, { voices: "formant" }));
			await bootedGame(page);
			const restored = await page.evaluate(() => {
				const g = window.__seelite;
				g.clockHeld = true;
				g.step(g.units.MAX_DT);
				return {
					system: g.world.system.record.index,
					known: g.commerceWorld.galaxies[0].fieldDiscoveries,
					selectable: g.selectableIds().includes("field-01"),
					target: g.targetBody()?.kind ?? null,
				};
			});
			check(
				"reload retains only the old discovery and exposes no stale destination target",
				restored.system === 230 &&
					restored.known.includes("10:field-01") &&
					!restored.known.includes("230:field-01") &&
					!restored.selectable &&
					restored.target !== "field",
				JSON.stringify(restored),
			);
		}
		await context.close();
	}
} finally {
	await browser.close();
}
exit();
