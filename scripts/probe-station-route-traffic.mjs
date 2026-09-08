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
		const docking = await import("/src/docking.ts");
		const hull = await import("/src/hull.ts");
		let maxWarmTicksPerCall = 0;
		const cachedWork = () =>
			[...g.trafficCruiseCache.values()].reduce(
				(total, state) => total + state.workTicks,
				0,
			);
		const refreshTraffic = () => {
			let attempts = 0;
			do {
				g.trafficTick = Number.NaN;
				const wasWarming = g.trafficWarmIndex < g.trafficActors.length;
				const beforeWork = cachedWork();
				g.updateTrafficAuthority();
				if (wasWarming)
					maxWarmTicksPerCall = Math.max(
						maxWarmTicksPerCall,
						cachedWork() - beforeWork,
					);
				attempts++;
			} while (!g.trafficAuthorityReady() && attempts <= 2_000);
			return attempts;
		};
		const coldProbeAt = 4;
		g.world.gameTime = coldProbeAt;
		sim.advanceSystem(g.world.system, coldProbeAt);
		g.updateTrafficAuthority();
		const coldStartIndex = g.trafficWarmIndex;
		const coldRoutes = g.trafficRoutes.map((projection) => ({
			key: projection.key,
			phase: projection.phase,
			berthId: projection.berthId,
			stationId: projection.terminalStationId,
		}));
		const coldRoutesArePreDeparture = coldRoutes.every((projection) => {
			const actor = g.trafficActors.find(
				(candidate) => candidate.key === projection.key,
			);
			return actor && g.world.gameTime < actor.schedule.departureAtS;
		});
		const coldStationId = g.world.system.contents.stations.some(
			(candidate) => candidate.id === "station-trade",
		)
			? "station-trade"
			: g.trafficActors[0]?.homeStationId;
		const coldBerthCount = coldStationId
			? g.berthIdsOfStation(coldStationId).length
			: 0;
		const coldOccupiedCount = coldStationId
			? g.occupiedAt(coldStationId).size
			: 0;
		const coldLaneAvailable = coldStationId
			? g.playerWinsTrafficLane(coldStationId, coldProbeAt, "arrival")
			: true;
		const savedShipPos = { ...g.world.ship.pos };
		const savedTargetId = g.targetId;
		const coldStationBody = coldStationId
			? g.world.system.byId.get(coldStationId)
			: null;
		if (coldStationBody) {
			const frame = g.apertureFrameOf(coldStationId);
			Object.assign(g.world.ship.pos, {
				x: coldStationBody.pos.x + frame.axis.x * 40,
				y: coldStationBody.pos.y + frame.axis.y * 40,
				z: coldStationBody.pos.z + frame.axis.z * 40,
			});
			g.targetId = coldStationId;
			g.updateTrafficPresentation(g.world.ship.pos);
			g.view = "cockpit";
			g.headLook = "forward";
			g.faceTarget();
		}
		const coldStationRoutes = coldRoutes.filter(
			(projection) => projection.stationId === coldStationId,
		);
		const coldAttachedMeshes = coldStationRoutes.filter(
			(projection) => g.trafficMeshes.get(projection.key)?.parent,
		).length;
		const coldShipNames = coldStationRoutes
			.map(
				(projection) =>
					g.trafficActors.find((actor) => actor.key === projection.key)
						?.callsign,
			)
			.filter(Boolean);
		const drawnLabelFrames = [];
		const originalFillText = g.overlayCtx.fillText.bind(g.overlayCtx);
		g.overlayCtx.fillText = (text, ...args) => {
			drawnLabelFrames.at(-1)?.push(String(text));
			return originalFillText(text, ...args);
		};
		for (let frame = 0; frame < 8; frame++) {
			drawnLabelFrames.push([]);
			g.drawMarkers(g.world.ship.pos);
		}
		g.overlayCtx.fillText = originalFillText;
		const coldLabelContinuity = drawnLabelFrames.every((labels) =>
			coldShipNames.every((name) =>
				labels.some((label) => label.startsWith(`${name}  `)),
			),
		);
		const coldLabelMissing = drawnLabelFrames.map((labels) =>
			coldShipNames.filter(
				(name) => !labels.some((label) => label.startsWith(`${name}  `)),
			),
		);
		g.setHeadLook("left");
		g.updateCockpit();
		const navContact = [...g.trafficContacts.values()].find((contact) =>
			coldShipNames.includes(contact.name),
		);
		const navBefore = [
			...document.querySelectorAll("[data-live-nav-target]"),
		].find((element) => element.dataset.liveNavTarget === navContact?.id);
		navBefore?.focus();
		const navTextBefore = navBefore?.textContent;
		if (navContact) navContact.pos.x += 0.75;
		g.updateCockpit();
		const navAfter = [
			...document.querySelectorAll("[data-live-nav-target]"),
		].find((element) => element.dataset.liveNavTarget === navContact?.id);
		const navRowIdentity = {
			present: Boolean(navBefore && navAfter),
			sameNode: navBefore === navAfter,
			focusRetained: document.activeElement === navAfter,
			textChanged: navTextBefore !== navAfter?.textContent,
		};
		g.setHeadLook("forward");
		const coldClearance = coldStationId
			? g.requestDockingClearance().state?.clearance
			: null;
		const coldPlayerBerth = coldStationId
			? g.dockingStates.get(coldStationId)?.berthId
			: null;
		const coldWarmCalls = refreshTraffic();
		const warmPlayerReserved = Boolean(
			coldStationId &&
				coldPlayerBerth &&
				g.occupiedAt(coldStationId).has(coldPlayerBerth),
		);
		const warmTrafficConflict = g.trafficRoutes.some(
			(projection) =>
				projection.terminalStationId === coldStationId &&
				projection.berthId === coldPlayerBerth &&
				(projection.phase === "parked-home" ||
					projection.phase === "docked-away"),
		);
		const warmSettled = g.trafficRoutes.find(
			(projection) =>
				projection.terminalStationId === coldStationId &&
				(projection.phase === "parked-home" ||
					projection.phase === "docked-away"),
		);
		let trafficAnchorDriftKm = Number.POSITIVE_INFINITY;
		let parkedAttitudeStepRatio = Number.POSITIVE_INFINITY;
		if (warmSettled && coldStationBody) {
			g.updateTrafficPresentation(g.world.ship.pos);
			const contact = g.trafficContacts.get(warmSettled.key);
			const mesh = g.trafficMeshes.get(warmSettled.key);
			if (contact && mesh) {
				const initial = {
					x: contact.pos.x - coldStationBody.pos.x,
					y: contact.pos.y - coldStationBody.pos.y,
					z: contact.pos.z - coldStationBody.pos.z,
				};
				trafficAnchorDriftKm = 0;
				const attitudeSteps = [];
				let priorAttitude = mesh.quaternion.clone();
				for (let frame = 1; frame <= 12; frame++) {
					g.world.gameTime = 4 + frame / 60;
					sim.advanceSystem(g.world.system, g.world.gameTime);
					g.updateTrafficAuthority();
					g.updateTrafficPresentation(g.world.ship.pos);
					trafficAnchorDriftKm = Math.max(
						trafficAnchorDriftKm,
						Math.hypot(
							contact.pos.x - coldStationBody.pos.x - initial.x,
							contact.pos.y - coldStationBody.pos.y - initial.y,
							contact.pos.z - coldStationBody.pos.z - initial.z,
						),
					);
					attitudeSteps.push(priorAttitude.angleTo(mesh.quaternion));
					priorAttitude = mesh.quaternion.clone();
				}
				const movingSteps = attitudeSteps.filter((step) => step > 1e-9);
				parkedAttitudeStepRatio =
					movingSteps.length > 0
						? Math.max(...movingSteps) /
							(movingSteps.reduce((sum, step) => sum + step, 0) /
								movingSteps.length)
						: 1;
			}
			g.world.gameTime = 4;
			sim.advanceSystem(g.world.system, 4);
			g.trafficTick = Number.NaN;
			g.updateTrafficAuthority();
		}
		if (coldStationId) g.dockingStates.delete(coldStationId);
		Object.assign(g.world.ship.pos, savedShipPos);
		g.targetId = savedTargetId;
		g.trafficTick = Number.NaN;
		g.updateTrafficAuthority();
		const coldActorCount = g.trafficActors.length;
		const settledBerths = g.trafficRoutes
			.filter(
				(item) =>
					item.berthId &&
					(item.phase === "parked-home" || item.phase === "docked-away"),
			)
			.map((item) =>
				[
					item.phase === "parked-home"
						? g.trafficActors.find((candidate) => candidate.key === item.key)
								?.homeStationId
						: item.destinationStationId,
					item.berthId,
				].join("|"),
			);
		const duplicateSettledBerths = settledBerths.filter(
			(key, index) => settledBerths.indexOf(key) !== index,
		);
		// The browser lazily optimises the first full canonical replay after the
		// bounded cold warm-up. Prime that path before measuring the steady 10 Hz
		// authority cost this row names.
		g.world.gameTime = 4.1;
		sim.advanceSystem(g.world.system, g.world.gameTime);
		g.updateTrafficAuthority();
		const authorityTickMs = [];
		for (let i = 2; i <= 13; i++) {
			g.world.gameTime = 4 + i * 0.1;
			sim.advanceSystem(g.world.system, g.world.gameTime);
			const started = performance.now();
			g.updateTrafficAuthority();
			authorityTickMs.push(performance.now() - started);
		}
		const sortedAuthorityTickMs = [...authorityTickMs].sort((a, b) => a - b);
		const authorityP95Ms =
			sortedAuthorityTickMs[Math.ceil(sortedAuthorityTickMs.length * 0.95) - 1];
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

		const angleBetween = (a, b) =>
			Math.acos(
				Math.max(
					-1,
					Math.min(
						1,
						(a.x * b.x + a.y * b.y + a.z * b.z) /
							(Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)),
					),
				),
			);
		let worstTurn = null;
		const movingPhase = new Set([
			"departing",
			"local-departure",
			"cruise",
			"local-approach",
			"arriving",
		]);
		const firstAuthorityTick = Math.ceil(departure * 10);
		let priorTurnProjection = route.projectSystemTrafficActor({
			record: g.world.system.record,
			actor,
			gameTime: firstAuthorityTick / 10,
		});
		for (
			let tick = firstAuthorityTick + 1;
			tick <= firstAuthorityTick + 9_000;
			tick++
		) {
			const t = tick / 10;
			const projected = route.projectSystemTrafficActor({
				record: g.world.system.record,
				actor,
				gameTime: t,
			});
			if (
				movingPhase.has(priorTurnProjection.phase) &&
				movingPhase.has(projected.phase) &&
				priorTurnProjection.nose &&
				projected.nose
			) {
				const angleRad = angleBetween(priorTurnProjection.nose, projected.nose);
				if (!worstTurn || angleRad > worstTurn.angleRad)
					worstTurn = { t, angleRad };
			}
			priorTurnProjection = projected;
			if (projected.phase === "docked-away") break;
		}
		let flyingAttitudeStepRatio = Number.POSITIVE_INFINITY;
		let flyingPositionStepRatio = Number.POSITIVE_INFINITY;
		let flyingAttitudeSteps = [];
		let flyingPositionSteps = [];
		if (worstTurn && worstTurn.angleRad > 1e-6) {
			const startT = worstTurn.t - 0.1;
			g.world.gameTime = startT;
			sim.advanceSystem(g.world.system, startT);
			const startProjection = route.projectSystemTrafficActor({
				record: g.world.system.record,
				actor,
				gameTime: startT,
			});
			g.world.ship.pos = {
				x: startProjection.pos.x + 100,
				y: startProjection.pos.y,
				z: startProjection.pos.z,
			};
			refreshTraffic();
			g.updateTrafficPresentation(g.world.ship.pos);
			const contact = g.trafficContacts.get(actor.key);
			const mesh = g.trafficMeshes.get(actor.key);
			if (contact && mesh) {
				const positions = [{ ...contact.pos }];
				const attitudes = [mesh.quaternion.clone()];
				for (let frame = 0; frame <= 6; frame++) {
					g.world.gameTime = worstTurn.t + frame / 60;
					sim.advanceSystem(g.world.system, g.world.gameTime);
					g.updateTrafficAuthority();
					g.updateTrafficPresentation(g.world.ship.pos);
					positions.push({ ...contact.pos });
					attitudes.push(mesh.quaternion.clone());
				}
				flyingAttitudeSteps = attitudes
					.slice(1)
					.map((value, index) => attitudes[index].angleTo(value));
				flyingPositionSteps = positions
					.slice(1)
					.map((value, index) =>
						Math.hypot(
							value.x - positions[index].x,
							value.y - positions[index].y,
							value.z - positions[index].z,
						),
					);
				const ratio = (values) => {
					const moving = values.filter((value) => value > 1e-9);
					return moving.length > 0
						? Math.max(...moving) /
								(moving.reduce((sum, value) => sum + value, 0) / moving.length)
						: 1;
				};
				flyingAttitudeStepRatio = ratio(flyingAttitudeSteps);
				flyingPositionStepRatio = ratio(flyingPositionSteps);
			}
		}

		const present = (t, distanceKm, events = [], resetVisibility = false) => {
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
			refreshTraffic();
			g.updateTrafficPresentation(g.world.ship.pos);
			const anchored = g.trafficContacts.get(actor.key);
			if (anchored) {
				const anchor = { ...anchored.pos };
				if (resetVisibility) {
					g.clearTrafficPresentation();
					g.trafficSystemIndex = g.world.system.record.index;
				}
				g.world.ship.pos = {
					x: anchor.x + distanceKm,
					y: anchor.y,
					z: anchor.z,
				};
				refreshTraffic();
			}
			g.render(0);
			g.updateCockpit();
			const contact = g.trafficContacts.get(actor.key);
			const mesh = g.trafficMeshes.get(actor.key);
			const liveProjection = g.trafficRoutes.find(
				(item) => item.key === actor.key,
			);
			let attitude = null;
			if (mesh && liveProjection?.nose && liveProjection.up) {
				mesh.updateMatrixWorld(true);
				const e = mesh.matrixWorld.elements;
				const worldForward = { x: -e[8], y: -e[9], z: -e[10] };
				const worldUp = { x: e[4], y: e[5], z: e[6] };
				const cosine = (a, b) =>
					(a.x * b.x + a.y * b.y + a.z * b.z) /
					(Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
				attitude = {
					noseDot: cosine(worldForward, liveProjection.nose),
					upDot: cosine(worldUp, liveProjection.up),
				};
			}
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
				attitude,
			};
		};

		const cruise = present(samples.get("cruise").t, 100);
		const retained = present(samples.get("cruise").t, 10_000.01);
		const outside = present(samples.get("cruise").t, 12_000.01);
		const absentBand = present(samples.get("cruise").t, 11_000, [], true);
		const boundary = present(samples.get("cruise").t, 10_000);
		const insideAgain = present(samples.get("cruise").t, 100);
		const arrivingSample = samples.get("arriving");
		const clearanceEvent = {
			stationId: destination,
			kind: "clearance",
			fromS: departure,
			toS: departure + 1_000,
			participant: { kind: "player" },
			hull: hull.HULL_SPECS.explorer.env,
		};
		const arrivalAt = arrivingSample.t + 0.2;
		const clearance = present(arrivalAt, 100, [clearanceEvent]);
		const incompatibleClearance = present(arrivalAt, 100, [
			{ ...clearanceEvent, hull: hull.HULL_SPECS.carrier.env },
		]);
		const laneEvent = {
			stationId: destination,
			kind: "lane",
			fromS: departure,
			toS: arrivalAt + 30,
			participant: { kind: "player" },
			movement: "launch",
		};
		const lane = present(arrivalAt, 100, [laneEvent]);
		const arriving = present(arrivalAt, 100);
		const docked = present(samples.get("docked-away").t + 0.2, 100);
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
			participant: { kind: "player" },
			movement: "arrival",
		});
		g.world.gameTime = samples.get("cruise").t;
		g.trafficTick = Number.NaN;
		g.updateTrafficAuthority();
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
			coldWarmCalls,
			coldActorCount,
			coldStartIndex,
			coldRoutes,
			coldRoutesArePreDeparture,
			coldAttachedMeshes,
			coldLabelContinuity,
			coldLabelMissing,
			coldDrawnLabels: drawnLabelFrames[0],
			navRowIdentity,
			coldBerthCount,
			coldOccupiedCount,
			coldLaneAvailable,
			coldClearance,
			coldPlayerBerth,
			warmPlayerReserved,
			warmTrafficConflict,
			trafficAnchorDriftKm,
			parkedAttitudeStepRatio,
			worstAuthorityTurnDeg: worstTurn
				? (worstTurn.angleRad * 180) / Math.PI
				: null,
			flyingAttitudeStepRatio,
			flyingPositionStepRatio,
			flyingAttitudeSteps,
			flyingPositionSteps,
			maxWarmTicksPerCall,
			settledBerths,
			duplicateSettledBerths,
			authorityP95Ms,
			authorityTickMs,
			actor: {
				key: actor.key,
				name: actor.callsign,
				hull: actor.hullId,
				home: actor.homeStationId,
			},
			destination,
			phases: [...samples.keys()],
			sampleTimes: Object.fromEntries(
				[...samples].map(([phase, sample]) => [phase, sample.t]),
			),
			cruise,
			retained,
			outside,
			absentBand,
			boundary,
			insideAgain,
			clearance,
			incompatibleClearance,
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
			...(() => {
				const stationId = destination;
				const frame = g.apertureFrameOf(stationId);
				const berthId = g.berthIdsOfStation(stationId)[0];
				g.trafficWarmIndex = g.trafficActors.length;
				g.trafficRoutes.length = 0;
				g.trafficRoutes.push({
					...holdProjection,
					terminalStationId: stationId,
					phase: "launch-queued",
					laneRequest: {
						participant: { kind: "carrier", key: actor.key },
						readyAt: g.world.gameTime - 1,
						kind: "launch",
					},
				});
				g.playerLaneRequests.set(stationId, {
					readyAt: g.world.gameTime,
					movement: "launch",
				});
				const playerBeatsOlderQueuedLaunch = g.playerWinsTrafficLane(
					stationId,
					g.world.gameTime,
					"launch",
				);
				g.trafficRoutes[0] = {
					...g.trafficRoutes[0],
					phase: "docked-away",
				};
				const playerIgnoresSettledLaneHistory = g.playerWinsTrafficLane(
					stationId,
					g.world.gameTime,
					"launch",
				);
				const activeRoute = {
					...holdProjection,
					terminalStationId: stationId,
					phase: "departing",
				};
				g.trafficRoutes.length = 0;
				g.trafficRoutes.push(activeRoute);
				g.dock = {
					phase: "flying",
					stationId: null,
					berthId: null,
					law: null,
				};
				g.dockingStates.set(stationId, {
					clearance: { kind: "granted", expiresAtS: g.world.gameTime + 60 },
					hostile: false,
					hostileUntilS: null,
					berthId,
				});
				g.resolveCrossing(stationId, frame, {
					rel: {
						x: frame.axis.x * (frame.planeKm + 1e-6),
						y: frame.axis.y * (frame.planeKm + 1e-6),
						z: frame.axis.z * (frame.planeKm + 1e-6),
					},
					vRel: {
						x: frame.axis.x * -0.05,
						y: frame.axis.y * -0.05,
						z: frame.axis.z * -0.05,
					},
					nose: {
						x: -frame.axis.x,
						y: -frame.axis.y,
						z: -frame.axis.z,
					},
					up: docking.slotBasis(frame).up,
				});
				const playerArrivalGuard = {
					docked: g.lastEntry?.docked,
					laneBlocked: g.lastEntry?.laneBlocked,
					damage: g.lastEntry?.damage,
					dockPhase: g.dock.phase,
				};
				g.dock = {
					phase: "docked",
					stationId,
					berthId,
					law: null,
				};
				g.playerLaneRequests.clear();
				const launched = g.launch();
				const refusedLaunch = {
					launched,
					dockPhase: g.dock.phase,
					requestCount: g.playerLaneRequests.size,
				};
				g.berthOccupancy.set(stationId, new Set([berthId]));
				g.clearTrafficPresentation();
				const staleOccupancyCleared = g.berthOccupancy.size === 0;
				g.trafficSystemIndex = g.world.system.record.index;
				g.trafficActors = [];
				g.trafficTick = 42;
				g.render(0);
				const renderLeavesAuthorityAlone = g.trafficTick === 42;
				return {
					playerBeatsOlderQueuedLaunch,
					playerIgnoresSettledLaneHistory,
					playerArrivalGuard,
					refusedLaunch,
					staleOccupancyCleared,
					renderLeavesAuthorityAlone,
				};
			})(),
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
		"materialization uses a 10,000/12,000 km visibility hysteresis",
		result.retained.contact?.id === result.actor.key &&
			result.retained.meshAttached &&
			!result.outside.contact &&
			!result.outside.meshAttached &&
			!result.absentBand.contact &&
			result.boundary.contact?.id === result.actor.key &&
			result.boundary.meshAttached,
		JSON.stringify({
			retained: result.retained,
			outside: result.outside,
			absentBand: result.absentBand,
			boundary: result.boundary,
		}),
	);
	check(
		"repeated crossings retain one contact, mesh, name, and hull",
		result.insideAgain.contact?.name === result.actor.name &&
			result.insideAgain.contact?.shipType === result.actor.hull &&
			result.insideAgain.contactCount === 1 &&
			result.insideAgain.meshCount === 1,
		JSON.stringify(result.insideAgain),
	);
	check(
		"settled generated actors never share a berth",
		result.duplicateSettledBerths.length === 0,
		JSON.stringify({
			settledBerths: result.settledBerths,
			duplicates: result.duplicateSettledBerths,
		}),
	);
	check(
		"cold route replay is split across fixed-budget presentation calls",
		result.coldWarmCalls > result.coldActorCount - result.coldStartIndex + 1 &&
			result.coldWarmCalls <= 2_000 &&
			result.maxWarmTicksPerCall > 0 &&
			result.maxWarmTicksPerCall <= 100,
		JSON.stringify({
			calls: result.coldWarmCalls,
			actors: result.coldActorCount,
			start: result.coldStartIndex,
			maxTicks: result.maxWarmTicksPerCall,
		}),
	);
	check(
		"cold authority shows only never-departed parked occupancy before replay finishes",
		result.coldRoutes.length > 0 &&
			result.coldRoutesArePreDeparture === true &&
			result.coldRoutes.every(
				(projection) =>
					projection.phase === "parked-home" && projection.berthId,
			) &&
			result.coldOccupiedCount ===
				result.coldRoutes.filter(
					(projection) => projection.stationId === "station-trade",
				).length &&
			result.coldAttachedMeshes === result.coldOccupiedCount,
		JSON.stringify({
			berths: result.coldBerthCount,
			occupied: result.coldOccupiedCount,
			routes: result.coldRoutes,
			preDeparture: result.coldRoutesArePreDeparture,
			attachedMeshes: result.coldAttachedMeshes,
		}),
	);
	check(
		"a truthful full cold station queues the player without inventing a reservation",
		result.coldOccupiedCount === result.coldBerthCount &&
			result.coldLaneAvailable === false &&
			result.coldClearance?.kind === "queued" &&
			!result.coldPlayerBerth &&
			!result.warmPlayerReserved &&
			!result.warmTrafficConflict,
		JSON.stringify({
			berths: result.coldBerthCount,
			occupied: result.coldOccupiedCount,
			laneAvailable: result.coldLaneAvailable,
			clearance: result.coldClearance,
			playerBerth: result.coldPlayerBerth,
			warmPlayerReserved: result.warmPlayerReserved,
			warmTrafficConflict: result.warmTrafficConflict,
		}),
	);
	check(
		"every cold ship tracking label is continuous across repeated real draws",
		result.coldLabelContinuity === true,
		JSON.stringify({
			coldLabelContinuity: result.coldLabelContinuity,
			missing: result.coldLabelMissing,
			drawn: result.coldDrawnLabels,
		}),
	);
	check(
		"settled Traffic stays attached between 10 Hz authority ticks",
		result.trafficAnchorDriftKm < 0.01,
		JSON.stringify({ driftKm: result.trafficAnchorDriftKm }),
	);
	check(
		"parked Traffic follows berth rotation without authority-tick attitude snaps",
		result.parkedAttitudeStepRatio < 1.2,
		JSON.stringify({ maxToMeanStep: result.parkedAttitudeStepRatio }),
	);
	check(
		"flying Traffic spreads authority course corrections across render frames",
		(result.worstAuthorityTurnDeg ?? 0) > 0.1 &&
			result.flyingAttitudeStepRatio < 1.5 &&
			result.flyingPositionStepRatio < 1.5,
		JSON.stringify({
			authorityTurnDeg: result.worstAuthorityTurnDeg,
			attitudeMaxToMeanStep: result.flyingAttitudeStepRatio,
			positionMaxToMeanStep: result.flyingPositionStepRatio,
		}),
	);
	check(
		"Navigation updates a changing range without replacing or defocusing its row",
		result.navRowIdentity.present &&
			result.navRowIdentity.sameNode &&
			result.navRowIdentity.focusRetained &&
			result.navRowIdentity.textChanged,
		JSON.stringify(result.navRowIdentity),
	);
	check(
		"warm 10 Hz Traffic authority stays inside one 60 Hz frame",
		result.authorityP95Ms < 1000 / 60,
		JSON.stringify({ p95Ms: result.authorityP95Ms }),
	);
	check(
		"an incompatible player request does not block a fitting Traffic berth",
		result.incompatibleClearance.phase === "arriving",
		JSON.stringify(result.incompatibleClearance),
	);
	check(
		"explicit player events delay Traffic through shared queue arbitration",
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
		"parked Traffic meshes preserve the projected nose and roll",
		result.docked.attitude?.noseDot > 0.999 &&
			result.docked.attitude?.upDot > 0.999,
		JSON.stringify(result.docked.attitude),
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
	check(
		"an older queued Traffic launch wins the live player lane check",
		result.playerBeatsOlderQueuedLaunch === false,
		JSON.stringify({
			playerBeatsOlderQueuedLaunch: result.playerBeatsOlderQueuedLaunch,
		}),
	);
	check(
		"settled route history is not a live Transit-lane contender",
		result.playerIgnoresSettledLaneHistory === true,
		JSON.stringify({
			playerIgnoresSettledLaneHistory: result.playerIgnoresSettledLaneHistory,
		}),
	);
	check(
		"a real player crossing yields to an active Traffic lane",
		result.playerArrivalGuard.docked === false &&
			result.playerArrivalGuard.laneBlocked === true &&
			result.playerArrivalGuard.damage === 0 &&
			result.playerArrivalGuard.dockPhase === "flying",
		JSON.stringify(result.playerArrivalGuard),
	);
	check(
		"a refused player launch leaves no request that can starve Traffic",
		result.refusedLaunch.launched === false &&
			result.refusedLaunch.dockPhase === "docked" &&
			result.refusedLaunch.requestCount === 0,
		JSON.stringify(result.refusedLaunch),
	);
	check(
		"system cleanup drops stale berth occupancy before warm-up",
		result.staleOccupancyCleared === true,
		JSON.stringify({ staleOccupancyCleared: result.staleOccupancyCleared }),
	);
	check(
		"rendering presentation does not advance Traffic authority",
		result.renderLeavesAuthorityAlone === true,
		JSON.stringify({
			renderLeavesAuthorityAlone: result.renderLeavesAuthorityAlone,
		}),
	);
	await page.close();
} finally {
	await browser.close();
}
exit();
