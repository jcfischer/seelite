/** #266: live multi-Carrier arbitration never rewrites an existing trip. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";
import { gameUrl } from "./lib/game-url.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:5173";
await guardedOrigin(origin);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(gameUrl(origin, { seed: 54 }), { waitUntil: "load" });
	await bootedGame(page);
	const injectRewrite =
		process.env.SEELITE_TRAFFIC_CONTINUITY_CONTROL === "rewrite";
	const result = await page.evaluate(async (injectRewrite) => {
		const { continuityAllowanceKm, cruiseContinuityResidualKm } = await import(
			"/scripts/lib/traffic-continuity.mjs"
		);
		let controlApplied = false;
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const sim = await import("/src/sim.ts");
		const { evaluateTrafficCruise, trafficCruiseEnvironment } = await import(
			"/src/station-route.ts"
		);
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
			// Rewrite the LIVE canonical cache, preserving the leg timestamp and
			// moving pose and integrated displacement together. The frozen prior
			// prediction is untouched; the actual projector consumes this rewrite.
			if (injectRewrite && !controlApplied) {
				for (const prior of previous.values()) {
					if (prior.phase !== "cruise" || !(prior.cruisePathKm > 0)) continue;
					const live = g.trafficCruiseCache.get(prior.canonicalKey);
					if (!live?.displacementKm) continue;
					live.pos = { ...live.pos, y: live.pos.y + 1 };
					live.displacementKm = {
						...live.displacementKm,
						y: live.displacementKm.y + 1,
					};
					controlApplied = true;
					break;
				}
			}
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
					const predicted =
						prior.canonical && prior.environment
							? evaluateTrafficCruise(prior.canonical, t, prior.environment)
							: undefined;
					const allowedKm = continuityAllowanceKm(prior, route, predicted);
					const deltaKm = dist(route.pos, prior.pos);
					const residualKm = cruiseContinuityResidualKm(
						prior,
						route,
						predicted,
					);
					if (deltaKm > allowedKm || residualKm > 0.05)
						jumps.push({
							t,
							key: route.key,
							deltaKm,
							residualKm,
							allowedKm,
							from: prior.phase,
							to: route.phase,
							fromBerth: prior.berthId,
							toBerth: route.berthId,
							fromTerminal: prior.terminalStationId,
							priorVisit: prior.visit,
							visit: {
								launch: route.visitLaunchReadyAtS,
								departure: route.visitOutboundDepartureAtS,
								arrival: route.visitReturnArrivalAtS,
								ordinal: route.visitAwayOrdinal,
								charge: route.chargeAu,
							},
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
				let canonicalKey, canonical, environment;
				if (route.phase === "cruise") {
					const entry = [...g.trafficCruiseCache].find(
						([key, state]) =>
							key.startsWith(
								g.world.system.record.index +
									"|" +
									route.key +
									"|" +
									route.destinationStationId +
									"|",
							) &&
							state.startedAtS === route.cruiseStartedAtS &&
							state.atS <= t + 1e-9,
					);
					if (!entry)
						throw new Error(
							"Missing previous canonical cruise state for " + route.key,
						);
					canonicalKey = entry[0];
					canonical = structuredClone(entry[1]);
					if (
						prior?.cruiseStartedAtS === route.cruiseStartedAtS &&
						prior.environment
					)
						environment = prior.environment;
					else {
						const actor = g.trafficActorByKey(route.key);
						const lane = route.destinationStationId === "traffic-lane-point";
						const endLanePoint = lane
							? g
									.trafficVoyages(actor, t)
									.find((v) => v.awayOrdinal === route.visitAwayOrdinal)
									?.departure
							: undefined;
						if (lane && !endLanePoint)
							throw new Error("Missing retained Lane point");
						const station = lane
							? null
							: sim.stationOf(g.world.system, route.destinationStationId);
						environment = trafficCruiseEnvironment({
							record: g.world.system.record,
							actor,
							atS: canonical.atS,
							selected: {
								id: route.destinationStationId,
								fits: true,
								hold: route.pos,
								parentId: station?.parentId ?? null,
							},
							endLanePoint: endLanePoint && structuredClone(endLanePoint),
						});
					}
				}
				previous.set(route.key, {
					canonicalKey,
					canonical,
					environment,
					phase: route.phase,
					cruisePathKm: route.cruisePathKm,
					cruiseDisplacementKm: route.cruiseDisplacementKm,
					cruiseStartedAtS: route.cruiseStartedAtS,
					visit: {
						launch: route.visitLaunchReadyAtS,
						departure: route.visitOutboundDepartureAtS,
						arrival: route.visitReturnArrivalAtS,
						ordinal: route.visitAwayOrdinal,
						charge: route.chargeAu,
					},
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
			controlApplied,
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
			actorCount: g.trafficActors.length + g.trafficInbound.length,
		};
	}, injectRewrite);
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
	if (injectRewrite)
		check(
			"rewrite control exercised a powered cruise sample",
			result.controlApplied,
			result,
		);
	await page.close();
} finally {
	await browser.close();
}
exit();
