/** Gated corpus probe through the real Game steering loop. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
const SEEDS = Number(process.argv[3] ?? 20);
const FIRST_SEED = Number(process.argv[4] ?? 1);
const origin = await guardedOrigin(ORIGIN, [
	"src/main.ts",
	"src/cruise-detour.ts",
	"src/cruise.ts",
]);
const browser = await launchChromium();
const { check, watch, exit } = tally();
const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
watch(page);
const rows = [];
for (let seed = FIRST_SEED; seed < FIRST_SEED + SEEDS; seed++) {
	await page.goto(`${origin}/?seed=${seed}`);
	await bootedGame(page);
	const row = await page.evaluate((seed) => {
		const g = window.__seelite;
		const dt = g.units.MAX_DT;
		let station = null;
		for (const body of g.world.system.bodies) {
			if (body.kind !== "station") continue;
			g.resetFlightToStart();
			g.targetId = body.id;
			g.engageCruise();
			if (g.detour) {
				station = body;
				break;
			}
		}
		if (!station) return null;
		g.resetFlightToStart();
		g.targetId = station.id;
		const start = performance.now();
		g.engageCruise();
		let detourFrames = 0;
		const detourBodies = new Set();
		let lastDetour = null;
		for (let i = 0; i < 12000; i++) {
			g.step(dt);
			if (g.detour) {
				detourFrames++;
				detourBodies.add(`${g.detour.bodyId}:${g.detour.side}`);
				lastDetour = {
					bodyId: g.detour.bodyId,
					side: g.detour.side,
					waypoint: g.detour.waypoint,
				};
			}
			if (g.lastExit) break;
		}
		const exitBody = [...g.world.system.bodies].find((body) =>
			g.lastExit.endsWith(body.id),
		);
		return {
			seed,
			stationId: station.id,
			exit: g.lastExit,
			targetId: g.targetId,
			detourFrames,
			detourBodies: [...detourBodies],
			lastDetour,
			exitBodyPos: exitBody?.pos,
			shipPos: g.world.ship.pos,
			cpuMs: performance.now() - start,
			charge: g.chargeAu,
		};
	}, seed);
	if (row) rows.push(row);
}
const arrivals = rows.filter(
	(row) => row.exit === `arrived at ${row.stationId}`,
).length;
const timeouts = rows.filter((row) => !row.exit).length;
const detours = rows.filter((row) => row.detourFrames > 0).length;
const cpuMs = rows.reduce((sum, row) => sum + row.cpuMs, 0);
console.log(
	JSON.stringify(
		{
			seeds: SEEDS,
			firstSeed: FIRST_SEED,
			detourLegs: rows.length,
			arrivals,
			timeouts,
			detours,
			meanCpuMs: rows.length ? cpuMs / rows.length : 0,
			nonArrivals: rows.filter(
				(row) => row.exit !== `arrived at ${row.stationId}`,
			),
		},
		null,
		2,
	),
);
check("corpus contains at least one production detour leg", rows.length > 0);
check(
	"every production detour leg arrives at its selected station",
	arrivals === rows.length,
);
check("no production detour leg exhausts the frame budget", timeouts === 0);
check("every selected corpus leg activates a detour", detours === rows.length);
await browser.close();
exit();
