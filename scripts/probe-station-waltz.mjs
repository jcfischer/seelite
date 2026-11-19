/**
 * https://github.com/jcfischer/seelite/issues/1324
 *
 * Each station plays its own version of the docking waltz, in the running
 * game. The headless rows (`tests/station-waltz.test.ts`,
 * `tests/music-director.test.ts`) own the pick and the director. What only the
 * page can answer is the wiring: the docking computer engaged at a station
 * loads that station's version, as `stationWaltz` names it on the page, and
 * `?waltz=` overrides it.
 *
 * Two systems with different governments are chosen on the page, from the
 * galaxy the game generated, so that their stations cover at least three
 * roles. At every station of each the computer is engaged, the loaded
 * version's name is read off `window.__seelite`, and it is compared with
 * `stationWaltz` called on the page.
 */
import { gameUrl } from "./lib/game-url.mjs";
import {
	bootedGame,
	guardedOrigin,
	installViewPlacement,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const SEED = 19;
const origin = await guardedOrigin(
	process.argv[2] ?? process.env.PROBE_ORIGIN ?? "http://127.0.0.1:5173",
);
const browser = await launchChromium();
const { check, watch, exit } = tally();

const open = async (params) => {
	const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
	watch(page);
	const warnings = [];
	page.on("console", (m) => {
		if (m.type() === "warning") warnings.push(m.text());
	});
	await installViewPlacement(page);
	await page.goto(gameUrl(origin, { seed: SEED, raider: "off", ...params }));
	await bootedGame(page);
	await page.keyboard.press("F8");
	const ready = await page.evaluate(async () => {
		const g = window.__seelite;
		for (let i = 0; i < 50 && !g.music.ready; i++)
			await new Promise((r) => setTimeout(r, 100));
		await new Promise((r) => setTimeout(r, 1500));
		return g.music.ready;
	});
	return { page, warnings, ready };
};

const dockAt = (page) =>
	page.evaluate(async () => {
		const { migrateEquipment, equipmentNames } = await import(
			"/src/loadout.ts"
		);
		const { stationWaltz } = await import("/src/station-waltz.ts");
		const { startSystem } = await import("/src/galaxy.ts");
		const g = window.__seelite;
		g.clearTrafficPresentation();
		g.trafficSystemIndex = g.world.system.record.index;
		g.trafficActors = [];
		g.trafficInbound = [];
		g.trafficTick = Math.floor(g.world.gameTime * 10);
		g.updateTrafficAuthority = () => {};
		g.updateTrafficPresentation = () => {};
		if (!g.hasDockingComputer)
			g.commander = {
				...g.commander,
				loadout: migrateEquipment(g.commander.hull, [
					...equipmentNames(g.commander.loadout ?? {}),
					g.dockingComputerName,
				]).loadout,
			};
		const record = g.world.system.record;
		const start = startSystem(g.world.galaxy);
		const rows = [];
		for (const station of g.world.system.contents.stations) {
			const snap = g.dockingSnapshot(station.id);
			await window.__viewAlongAxis(station.id, snap.planeKm + 4.5, {
				comoving: true,
			});
			g.targetId = station.id;
			g.requestDockingClearance();
			g.toggleDockingComputer();
			for (let i = 0; i < 40 && g.musicState.waltz !== "playing"; i++)
				await new Promise((r) => setTimeout(r, 100));
			rows.push({
				station: station.id,
				role: station.type,
				engaged: g.dockingComputer.engaged,
				loaded: g.waltzVersion,
				picked: stationWaltz(record, station.type, start),
			});
			if (g.dockingComputer.engaged) g.toggleDockingComputer();
			for (let i = 0; i < 40 && g.musicState.waltz !== "none"; i++)
				await new Promise((r) => setTimeout(r, 100));
		}
		return {
			system: record.index,
			government: record.government,
			rows,
			errors: [...g.music.errors],
		};
	});

const chosen = await (async () => {
	const { page } = await open({});
	const picked = await page.evaluate(async () => {
		const { generateContents } = await import("/src/system.ts");
		const g = window.__seelite;
		const systems = g.world.galaxy.systems.map((s) => ({
			index: s.index,
			government: s.government,
			roles: generateContents(s).stations.map((st) => st.type),
		}));
		const rich = systems
			.filter((s) => s.roles.length >= 3)
			.sort((a, b) => b.roles.length - a.roles.length);
		const first = rich[0];
		const second = systems.find(
			(s) => s.government !== first.government && s.roles.length >= 2,
		);
		return [first, second];
	});
	await page.close();
	return picked;
})();

const seen = [];
for (const system of chosen) {
	const { page, ready } = await open({ system: system.index });
	const run = await dockAt(page);
	seen.push(run);
	check(
		`system ${run.system}: at every station the computer loads that station's own version`,
		ready &&
			run.rows.length >= 2 &&
			run.rows.every((r) => r.engaged && r.loaded === r.picked) &&
			run.errors.length === 0,
		JSON.stringify({ ready, ...run }),
	);
	await page.close();
}
const roles = new Set(seen.flatMap((s) => s.rows.map((r) => r.role)));
check(
	"the stations docked at cover at least three roles in two systems of different governments",
	roles.size >= 3 &&
		seen.length === 2 &&
		seen[0].government !== seen[1].government,
	JSON.stringify({
		roles: [...roles],
		governments: seen.map((s) => s.government),
	}),
);
const notHybrid = seen
	.flatMap((s) => s.rows)
	.filter((r) => r.loaded !== "hybrid");
check(
	"a station's version is played rather than hybrid",
	notHybrid.length > 0,
	JSON.stringify(seen.flatMap((s) => s.rows.map((r) => r.loaded))),
);

{
	const { page, ready } = await open({
		system: chosen[0].index,
		waltz: "jazz-trio",
	});
	const run = await dockAt(page);
	check(
		"?waltz=jazz-trio plays jazz-trio at every station",
		ready &&
			run.rows.length > 0 &&
			run.rows.every((r) => r.loaded === "jazz-trio"),
		JSON.stringify(run.rows),
	);
	await page.close();
}

{
	const { page, warnings, ready } = await open({
		system: chosen[0].index,
		waltz: "polka",
	});
	const run = await dockAt(page);
	const named = warnings.filter(
		(w) => w.includes("?waltz") && w.includes("polka"),
	);
	check(
		"?waltz=<unknown> plays each station's own pick and warns once, naming the value",
		ready &&
			run.rows.length > 0 &&
			run.rows.every((r) => r.loaded === r.picked) &&
			named.length === 1,
		JSON.stringify({ rows: run.rows, warnings: named }),
	);
	await page.close();
}

await browser.close();
exit();
