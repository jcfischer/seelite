/**
 * https://github.com/jcfischer/seelite/issues/1305
 * Ore aboard, the docking computer flies the approach through a real
 * clearance, and REVIEW QUOTE is pressable the moment the Refinery tab shows.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = await guardedOrigin(
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const WORK_SYSTEM = 9;

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await installViewPlacement(page);
	await page.goto(
		gameUrl(origin, { seed: 0x5ee11e, hull: "miner", raider: "off" }),
	);
	await bootedGame(page, 180000);
	const run = await page.evaluate(async (workSystem) => {
		const g = window.__seelite;
		const Sim = await import("/src/sim.ts");
		const W = await import("/src/world-state.ts");
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);
		g.clockHeld = true;
		g.launch();
		Sim.jumpWorldTo(g.world, g.world.galaxy.systems[workSystem]);
		g.rebuildSystem();
		g.adoptWorld(W.visit(g.commerceWorld, 0, workSystem));
		const station = g.world.system.bodies.find(
			(b) => b.kind === "station" && b.stationType === "refinery",
		);
		if (!station) throw Error("no refinery in the work system");
		g.commander = {
			...g.commander,
			loadout: migrateEquipment(g.commander.hull, [
				...equipmentNames(g.commander.loadout ?? {}),
				g.dockingComputerName,
			]).loadout,
		};
		g.takeMinedOre("Metallic ore STD", 3);
		const dt = g.units.MAX_DT;
		const id = station.id;
		const seen = g.dockingSnapshot(id);
		const V = (v) => ({ x: v.x, y: v.y, z: v.z });
		const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
		const mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
		g.world.ship.pos = add(V(station.pos), mul(seen.axis, seen.planeKm + 3));
		g.world.ship.vel = V(g.stationVelocity(id));
		g.regime = "normal";
		g.setThrottle(0);
		g.targetId = id;
		g.resetDock();
		const cleared = g.requestDockingClearance();
		g.toggleDockingComputer();
		let t = 0;
		for (
			;
			t < 400 && !(g.dock.phase === "docked" && g.dock.stationId === id);
			t += dt
		) {
			g.step(dt);
			g.render(dt);
		}
		g.stationConsoleTab = "Refinery";
		g.setHeadLook("forward");
		g.updateCockpit();
		return {
			cleared: cleared.id !== null,
			phase: g.dock.phase,
			t,
			cargo: g.commander.cargo,
		};
	}, WORK_SYSTEM);
	check(
		"the approach docks through a real clearance with ore aboard",
		run.cleared && run.phase === "docked",
		JSON.stringify(run),
	);
	const button = page.locator('[data-live-refinery-action="quote"]');
	await button.waitFor({ timeout: 20000 });
	const detail = await page.evaluate(() => ({
		ore: window.__seelite.stationConsoleState()?.refinery?.ore,
		html: document
			.querySelector("[data-live-refinery]")
			?.outerHTML.slice(0, 400),
	}));
	check(
		"REVIEW QUOTE is enabled at once",
		await button.isEnabled(),
		JSON.stringify(detail),
	);
	await button.click();
	check(
		"no reason is shown beside an enabled button",
		(await page.locator("[data-live-refinery-reason]").count()) === 0,
	);
	check(
		"clicking it shows the quote",
		(await page.locator("[data-live-refinery-quote]").count()) === 1,
	);
} finally {
	await browser.close();
}
exit();
