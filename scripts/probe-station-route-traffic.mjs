/** #266: one live Traffic Carrier keeps its route and presentation identity. */
import {
	bootedGame,
	guardedOrigin,
	launchChromium,
	tally,
} from "./probe-guard.mjs";

const ORIGIN =
	process.env.PROBE_ORIGIN ?? process.argv[2] ?? "http://localhost:5173";
await guardedOrigin(ORIGIN, ["src/station-route.ts", "src/units.ts"]);
const browser = await launchChromium();
const { check, watch, exit } = tally();

try {
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
	});
	watch(page);
	await page.goto(`${ORIGIN}/?seed=54`, { waitUntil: "load" });
	await bootedGame(page);
	const result = await page.evaluate(async () => {
		const g = window.__seelite;
		cancelAnimationFrame(g.animationFrame);
		const route = await import("/src/station-route.ts");
		const sim = await import("/src/sim.ts");
		const station = await import("/src/station.ts");
		g.updateTrafficPresentation(g.cameraPos());
		const actor = g.trafficActors.find(
			(candidate) =>
				candidate.homeStationId === "station-trade" && candidate.ordinal === 0,
		);
		if (!actor) throw new Error("seed 54 produced no routable Traffic actor");
		// This probe watches one route through the real Game integration. Keeping the
		// cache focused avoids unrelated generated actors deciding which frame the
		// named actor enters a shared queue; player contention is injected below.
		g.trafficActors = [actor];
		g.clearTrafficPresentation();
		g.trafficSystemIndex = g.world.system.record.index;

		const departure = actor.schedule.departureAtS;
		const samples = new Map();
		let destination = null;
		for (let t = departure; t < departure + 900; t += 0.25) {
			const projected = route.projectSystemTrafficActor({
				record: g.world.system.record,
				actor,
				gameTime: t,
			});
			destination ??= projected.destinationStationId;
			if (!samples.has(projected.phase))
				samples.set(projected.phase, { t, projected });
			if (projected.phase === "docked-away") break;
		}

		const present = (t, distanceKm, events = []) => {
			g.trafficPlayerTimeline.length = 0;
			g.trafficPlayerTimeline.push(...events);
			g.world.gameTime = t;
			sim.advanceSystem(g.world.system, t);
			const expected = route.projectSystemTrafficActor({
				record: g.world.system.record,
				actor,
				gameTime: t,
				playerTimeline: events,
			});
			g.world.ship.pos = {
				x: expected.pos.x + distanceKm,
				y: expected.pos.y,
				z: expected.pos.z,
			};
			g.trafficTick = Number.NaN;
			g.updateTrafficPresentation(g.cameraPos());
			const projected = g.trafficRoutes.find((item) => item.key === actor.key);
			if (projected) {
				g.world.ship.pos = {
					x: projected.pos.x + distanceKm,
					y: projected.pos.y,
					z: projected.pos.z,
				};
				g.trafficTick = Number.NaN;
				g.updateTrafficPresentation(g.cameraPos());
			}
			g.render(0);
			g.updateCockpit();
			const contact = g.trafficContacts.get(actor.key);
			const mesh = g.trafficMeshes.get(actor.key);
			return {
				phase: g.trafficRoutes.find((item) => item.key === actor.key)?.phase,
				contact: contact
					? { id: contact.id, name: contact.name, shipType: contact.shipType }
					: null,
				meshName: mesh?.name ?? null,
				meshAttached: Boolean(mesh?.parent),
				contactCount: g.contacts.filter((item) => item.id === actor.key).length,
				meshCount: [...g.trafficMeshes.keys()].filter(
					(key) => key === actor.key,
				).length,
				scanner: g.scannerContacts.some((item) => item.id === actor.key),
			};
		};

		const cruise = present(samples.get("cruise").t, 100);
		const outside = present(samples.get("cruise").t, 10_000.01);
		const boundary = present(samples.get("cruise").t, 10_000);
		const outsideAgain = present(samples.get("cruise").t, 10_000.01);
		const insideAgain = present(samples.get("cruise").t, 100);
		const arrivingSample = samples.get("arriving");
		const clearanceEvent = {
			stationId: destination,
			kind: "clearance",
			fromS: departure,
			toS: departure + 1_000,
		};
		const clearance = present(arrivingSample.t, 100, [clearanceEvent]);
		const laneEvent = {
			stationId: destination,
			kind: "lane",
			fromS: departure,
			toS: arrivingSample.t + 30,
		};
		const lane = present(arrivingSample.t, 100, [laneEvent]);
		const arriving = present(arrivingSample.t, 100);
		const docked = present(samples.get("docked-away").t, 100);
		let returned = null;
		for (
			let t = departure + actor.schedule.awayS;
			t < departure + actor.schedule.awayS + 900;
			t += 0.5
		) {
			const projected = route.projectSystemTrafficActor({
				record: g.world.system.record,
				actor,
				gameTime: t,
			});
			if (projected.phase === "parked-home") {
				returned = { t, berthId: projected.berthId };
				break;
			}
		}
		const returnedLive = returned ? present(returned.t, 100) : null;

		g.trafficPlayerTimeline.length = 0;
		g.trafficPlayerTimeline.push({
			stationId: actor.homeStationId,
			kind: "lane",
			fromS: -2_000_000,
			toS: -1_000_000,
		});
		g.world.gameTime = samples.get("cruise").t;
		g.trafficTick = Number.NaN;
		g.updateTrafficPresentation(g.cameraPos());
		const retainedPlayerEvents = g.trafficPlayerTimeline.length;

		const planetId = g.world.system.contents.planets[0]?.id;
		if (!planetId) throw new Error("seed 54 produced no planet target");
		g.regime = "normal";
		g.spoolLeftS = 0;
		g.chargeAu = 1;
		g.targetId = planetId;
		g.engageCruise();
		const planetCruise = {
			spoolLeftS: g.spoolLeftS,
			lastExit: g.lastExit,
			detour: g.detour,
		};

		const holdProjection = route.projectSystemTrafficActor({
			record: g.world.system.record,
			actor,
			gameTime: arrivingSample.t,
			playerTimeline: [clearanceEvent],
		});
		const destinationBody = g.world.system.byId.get(destination);
		const destinationStation = sim.stationOf(g.world.system, destination);
		const holdDistance = Math.hypot(
			holdProjection.pos.x - destinationBody.pos.x,
			holdProjection.pos.y - destinationBody.pos.y,
			holdProjection.pos.z - destinationBody.pos.z,
		);

		return {
			stationCount: g.world.system.contents.stations.length,
			actor: {
				key: actor.key,
				name: actor.callsign,
				hull: actor.hullId,
				home: actor.homeStationId,
			},
			destination,
			phases: [...samples.keys()],
			cruise,
			outside,
			boundary,
			outsideAgain,
			insideAgain,
			clearance,
			lane,
			arriving,
			docked,
			returned,
			returnedLive,
			retainedPlayerEvents,
			planetCruise,
			holdDistance,
			stationRadius:
				station.STATION_GEOMETRY[destinationStation.type].coreRadiusKm,
		};
	});

	check(
		"fixture has alternatives and never selects the home station",
		result.stationCount >= 2 &&
			result.destination &&
			result.destination !== result.actor.home,
		JSON.stringify(result),
	);
	for (const phase of [
		"departing",
		"local-departure",
		"cruise",
		"local-approach",
		"arriving",
		"docked-away",
	])
		check(`route reaches ${phase}`, result.phases.includes(phase));
	check(
		"local flight and cruise are live scanner contacts",
		result.cruise.contact?.id === result.actor.key &&
			result.cruise.scanner &&
			result.cruise.meshAttached,
		JSON.stringify(result.cruise),
	);
	check(
		"10,000 km materialization boundary is inclusive",
		!result.outside.contact &&
			!result.outside.meshAttached &&
			result.boundary.contact?.id === result.actor.key &&
			result.boundary.meshAttached,
		JSON.stringify({ outside: result.outside, boundary: result.boundary }),
	);
	check(
		"repeated crossings retain one contact, mesh, name, and hull",
		!result.outsideAgain.contact &&
			result.insideAgain.contact?.name === result.actor.name &&
			result.insideAgain.contact?.shipType === result.actor.hull &&
			result.insideAgain.contactCount === 1 &&
			result.insideAgain.meshCount === 1,
		JSON.stringify({
			outside: result.outsideAgain,
			inside: result.insideAgain,
		}),
	);
	check(
		"player clearance and lane claims delay Traffic through live queues",
		result.clearance.phase === "clearance-queued" &&
			result.lane.phase === "lane-queued" &&
			result.arriving.phase === "arriving",
		JSON.stringify({
			clearance: result.clearance,
			lane: result.lane,
			arriving: result.arriving,
		}),
	);
	check(
		"Traffic hold remains outside destination geometry",
		result.holdDistance > result.stationRadius,
		JSON.stringify({
			holdDistance: result.holdDistance,
			stationRadius: result.stationRadius,
		}),
	);
	check(
		"arrival reserves a berth without duplicating presentation",
		result.docked.phase === "docked-away" &&
			result.docked.contactCount === 1 &&
			result.docked.meshCount === 1 &&
			result.docked.meshAttached,
		JSON.stringify(result.docked),
	);
	check(
		"a settled actor retains its own occupied berth",
		result.returned?.berthId &&
			result.returnedLive?.phase === "parked-home" &&
			result.returnedLive.contact?.id === result.actor.key,
		JSON.stringify({
			returned: result.returned,
			live: result.returnedLive,
		}),
	);
	check(
		"completed player arbitration history is pruned beyond the replay horizon",
		result.retainedPlayerEvents === 0,
		JSON.stringify({ retainedPlayerEvents: result.retainedPlayerEvents }),
	);
	check(
		"planet targets still enter ordinary cruise spool",
		result.planetCruise.spoolLeftS > 0 &&
			!result.planetCruise.lastExit.startsWith("detour unavailable") &&
			result.planetCruise.detour === null,
		JSON.stringify(result.planetCruise),
	);
	await page.close();
} finally {
	await browser.close();
}
exit();
