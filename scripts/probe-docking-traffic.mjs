/** #266: a cleared docking computer must make progress through live Traffic. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const origin = process.argv[2] ?? "http://127.0.0.1:5173";
await guardedOrigin(origin);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	for (const startAtS of [120, 360, 720, 1_080]) {
		const page = await browser.newPage({
			viewport: { width: 900, height: 620 },
		});
		watch(page);
		await page.goto(`${origin}/?seed=54`, { waitUntil: "load" });
		await bootedGame(page);
		const result = await page.evaluate(async (startAtS) => {
			const g = window.__seelite;
			cancelAnimationFrame(g.animationFrame);
			const sim = await import("/src/sim.ts");
			const docking = await import("/src/docking.ts");
			g.clearTrafficPresentation();
			g.trafficSystemIndex = -1;
			g.trafficActors = [];
			g.world.gameTime = startAtS;
			sim.advanceSystem(g.world.system, startAtS);
			let warmCalls = 0;
			do {
				g.trafficTick = Number.NaN;
				g.updateTrafficAuthority();
				warmCalls++;
			} while (!g.trafficAuthorityReady() && warmCalls < 2_000);

			const station = g.world.system.contents.stations.find(
				(candidate) => candidate.id === "station-trade",
			);
			const body = g.world.system.byId.get(station.id);
			const snap = g.dockingSnapshot(station.id);
			const rel = {
				x: snap.axis.x * (snap.planeKm + 3.2),
				y: snap.axis.y * (snap.planeKm + 3.2),
				z: snap.axis.z * (snap.planeKm + 3.2),
			};
			g.world.ship.pos = {
				x: body.pos.x + rel.x,
				y: body.pos.y + rel.y,
				z: body.pos.z + rel.z,
			};
			const stationVel = g.stationVelocity(station.id);
			g.world.ship.vel = { ...stationVel };
			g.regime = "normal";
			g.spoolLeftS = 0;
			g.resetDock();
			g.setThrottle(0);
			g.rates = { pitch: 0, yaw: 0, roll: 0 };
			g.setAttitude(
				{ x: -snap.axis.x, y: -snap.axis.y, z: -snap.axis.z },
				snap.basis.up,
			);
			g.targetId = station.id;
			const clearance = g.requestDockingClearance().state?.clearance;
			g.toggleDockingComputer();

			let minAxialKm = snap.planeKm + 3.2;
			let firstGrantAtS = clearance?.kind === "granted" ? startAtS : null;
			let firstLaneAtS = null;
			const phases = new Set();
			for (let step = 0; step < 4_000; step++) {
				g.step(0.1);
				const current = g.dockingSnapshot(station.id);
				minAxialKm = Math.min(minAxialKm, current.axialKm);
				phases.add(current.dockPhase);
				if (!firstGrantAtS && current.clearance?.kind === "granted")
					firstGrantAtS = g.world.gameTime;
				if (!firstLaneAtS && g.playerLaneRequests.get(station.id))
					firstLaneAtS = g.world.gameTime;
				if (current.dockPhase !== "flying") break;
			}
			const final = g.dockingSnapshot(station.id);
			const finalCommand = docking.dockingComputerStep({
				frame: g.apertureFrameOf(station.id),
				pose: g.entryPoseOf(station.id),
				state: g.dockingStateOf(station.id),
				gameTime: g.world.gameTime,
				maxSpeedKms: g.assistCapKms,
			});
			const playerLane = g.playerLaneRequests.get(station.id);
			const queuedTraffic = g.trafficRoutes
				.filter(
					(route) =>
						route.terminalStationId === station.id && route.laneRequest,
				)
				.map((route) => ({
					key: route.key,
					phase: route.phase,
					readyAt: route.laneRequest.readyAt,
					kind: route.laneRequest.kind,
				}));
			return {
				startAtS,
				warmCalls,
				initialClearance: clearance?.kind,
				firstGrantAtS,
				firstLaneAtS,
				elapsedS: g.world.gameTime - startAtS,
				progressKm: snap.planeKm + 3.2 - minAxialKm,
				phases: [...phases],
				finalPhase: final.dockPhase,
				finalClearance: final.clearance?.kind,
				computerEngaged: final.computerEngaged,
				finalAxialKm: final.axialKm,
				finalOffAxisKm: final.offAxisKm,
				finalRangeKm: final.rangeKm,
				finalThrottle: final.throttle,
				spinRpm: final.spinRpm,
				finalCommand: {
					phase: finalCommand.phase,
					speedKms: finalCommand.speedKms,
				},
				playerLane,
				playerWinsLane: playerLane
					? g.playerWinsTrafficLane(station.id, playerLane.readyAt, "arrival")
					: null,
				queuedTraffic,
				stationCarrierEvents: g.trafficCarrierTimeline
					.filter((event) => event.stationId === station.id)
					.map((event) => ({
						fromS: event.fromS,
						toS: event.toS,
						kind: event.kind,
						movement: event.movement,
						participant: event.participant,
						committed: event.committed,
					})),
				activeTraffic: g.trafficRoutes
					.filter(
						(route) =>
							route.terminalStationId === station.id &&
							(route.phase === "arriving" || route.phase === "departing"),
					)
					.map((route) => ({ key: route.key, phase: route.phase })),
			};
		}, startAtS);
		check(
			`a live-Traffic docking computer starting at ${startAtS}s reaches the station`,
			result.finalPhase !== "flying",
			JSON.stringify(result),
		);
		await page.close();
	}
} finally {
	await browser.close();
}
exit();
