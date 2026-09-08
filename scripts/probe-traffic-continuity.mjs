/** #266: live multi-Carrier arbitration never rewrites an existing trip. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:5173";
await guardedOrigin(origin, ["src/station-route.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(`${origin}/?seed=54`, { waitUntil: "load" });
	await bootedGame(page);
	const result = await page.evaluate(async () => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const sim = await import("/src/sim.ts");
		const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
		g.world.gameTime = 4;
		sim.advanceSystem(g.world.system, 4);
		let warmCalls = 0;
		do {
			g.trafficTick = Number.NaN;
			g.updateTrafficAuthority();
			warmCalls++;
		} while (!g.trafficAuthorityReady() && warmCalls < 2_000);

		const previous = new Map();
		const jumps = [];
		const berthChanges = [];
		const duplicateBerths = [];
		const playerBerthConflicts = [];
		let playerReservation = null;
		// Two full minimum schedule cycles cover arrivals, departures, returns and
		// the exact intent boundaries that used to rewrite an in-progress visit.
		for (let tick = 41; tick <= 18_000; tick++) {
			const t = tick / 10;
			g.world.gameTime = t;
			sim.advanceSystem(g.world.system, t);
			g.updateTrafficAuthority();
			if (!playerReservation && t >= 120) {
				for (const station of g.world.system.contents.stations) {
					const occupied = g.berthOccupancy.get(station.id) ?? new Set();
					const berthId = g
						.berthIdsOfStation(station.id)
						.find((candidate) => !occupied.has(candidate));
					if (!berthId) continue;
					const state = g.dockingStateOf(station.id);
					g.dockingStates.set(station.id, {
						...state,
						clearance: { kind: "granted", expiresAtS: 10_000 },
						berthId,
					});
					playerReservation = { stationId: station.id, berthId, atS: t };
					break;
				}
			}
			const settledAtBerth = new Map();
			for (const route of g.trafficRoutes) {
				if (route.berthId && route.terminalStationId) {
					const berthKey = `${route.terminalStationId}|${route.berthId}`;
					const owner = settledAtBerth.get(berthKey);
					if (owner && owner.key !== route.key)
						duplicateBerths.push({
							t,
							berthKey,
							owner: owner.key,
							ownerPhase: owner.phase,
							ownerPrior: previous.get(owner.key)?.phase,
							contender: route.key,
							contenderPhase: route.phase,
							contenderPrior: previous.get(route.key)?.phase,
						});
					else
						settledAtBerth.set(berthKey, {
							key: route.key,
							phase: route.phase,
						});
					if (
						playerReservation?.stationId === route.terminalStationId &&
						playerReservation.berthId === route.berthId
					)
						playerBerthConflicts.push({
							t,
							key: route.key,
							phase: route.phase,
							berthId: route.berthId,
						});
				}
				const prior = previous.get(route.key);
				if (prior) {
					const deltaKm = dist(route.pos, prior.pos);
					const expectedKm =
						(Math.hypot(prior.vel.x, prior.vel.y, prior.vel.z) +
							Math.hypot(route.vel.x, route.vel.y, route.vel.z)) *
						0.05;
					// Position samples are 0.1 s apart. Fifty metres covers integration
					// and moving-frame curvature at phase boundaries; 2x the trapezoid
					// distance covers guided acceleration without allowing low-speed
					// kilometre teleports.
					const allowedKm = Math.max(0.05, expectedKm * 2);
					if (deltaKm > allowedKm)
						jumps.push({
							t,
							key: route.key,
							deltaKm,
							expectedKm,
							allowedKm,
							from: prior.phase,
							to: route.phase,
							fromBerth: prior.berthId,
							toBerth: route.berthId,
							fromTerminal: prior.terminalStationId,
							toTerminal: route.terminalStationId,
						});
					const priorSettled = [
						"parked-home",
						"docked-away",
						"launch-queued",
					].includes(prior.phase);
					const settled = [
						"parked-home",
						"docked-away",
						"launch-queued",
					].includes(route.phase);
					if (
						priorSettled &&
						settled &&
						prior.terminalStationId === route.terminalStationId &&
						prior.berthId !== route.berthId
					)
						berthChanges.push({
							t,
							key: route.key,
							phase: route.phase,
							station: route.terminalStationId,
							from: prior.berthId,
							to: route.berthId,
						});
				}
				previous.set(route.key, {
					phase: route.phase,
					pos: { ...route.pos },
					vel: { ...route.vel },
					berthId: route.berthId,
					terminalStationId: route.terminalStationId,
					destinationStationId: route.destinationStationId,
				});
			}
		}
		return {
			warmCalls,
			jumpCount: jumps.length,
			largestJumps: jumps.sort((a, b) => b.deltaKm - a.deltaKm).slice(0, 5),
			berthChangeCount: berthChanges.length,
			berthChanges: berthChanges.slice(0, 5),
			duplicateBerthCount: duplicateBerths.length,
			duplicateBerths: duplicateBerths.slice(0, 5),
			playerReservation,
			playerBerthConflictCount: playerBerthConflicts.length,
			playerBerthConflicts: playerBerthConflicts.slice(0, 5),
			carrierEventCount: g.trafficCarrierTimeline.length,
			berthCacheSize: g.trafficBerthCache.size,
			actorCount: g.trafficActors.length,
		};
	});
	check(
		"live Traffic never rewrites one Carrier onto a discontinuous route",
		result.jumpCount === 0,
		JSON.stringify(result.largestJumps),
	);
	check(
		"a settled Carrier keeps the berth its physical visit was granted",
		result.berthChangeCount === 0,
		JSON.stringify(result.berthChanges),
	);
	check(
		"Traffic never shares a berth with another Carrier or the player",
		result.duplicateBerthCount === 0 &&
			result.playerReservation &&
			result.playerBerthConflictCount === 0,
		JSON.stringify({
			duplicates: result.duplicateBerths,
			playerReservation: result.playerReservation,
			playerConflicts: result.playerBerthConflicts,
		}),
	);
	check(
		"remembered Traffic commitments remain bounded by active replay history",
		result.carrierEventCount <= result.actorCount * 8 &&
			result.berthCacheSize <= result.actorCount * 4,
		JSON.stringify({
			actors: result.actorCount,
			carrierEvents: result.carrierEventCount,
			berthAssignments: result.berthCacheSize,
		}),
	);
	await page.close();
} finally {
	await browser.close();
}
exit();
