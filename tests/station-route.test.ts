import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { DEFAULT_CRUISE } from "../src/cruise";
import {
	beginCruiseGuidance,
	stepCruiseGuidance,
} from "../src/cruise-guidance";
import { generateGalaxy, startSystem } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { bodyVelocity, makeSystem } from "../src/sim";
import {
	CANONICAL_ROUTE_DT_S,
	evaluateTrafficCruise,
	projectParkedTrafficActor,
	projectSystemTrafficAuthority,
	projectSystemTrafficActor,
	selectTrafficDestination,
	type TrafficCruiseEnvironment,
	type TrafficCruiseState,
} from "../src/station-route";
import {
	stationTrafficRoster,
	TRAFFIC_MIN_DOCKED_S,
	TRAFFIC_STATION_EXCLUSION_KM,
	TRAFFIC_STATION_LOCAL_SPEED_KM_S,
	trafficScheduleAt,
} from "../src/station-traffic";
import { STATION_LAWFUL } from "../src/station";
import { generateContents } from "../src/system";
import { AU_KM } from "../src/units";

const ACTOR = {
	key: carrierKey(4, "station-trade/traffic-01"),
	ordinal: 1,
	hullId: "explorer" as const,
};

const required = <T>(value: T | undefined, label: string): T => {
	if (value === undefined) throw new Error(`missing ${label}`);
	return value;
};

describe("Traffic destination selection", () => {
	test("sorts station ids, excludes home/unfitting/unreachable, and cycles by away ordinal", () => {
		const candidates = [
			{ id: "station-z", fits: true, hold: { x: 6e7, y: 0, z: 0 } },
			{ id: "station-home", fits: true, hold: { x: 1e6, y: 0, z: 0 } },
			{ id: "station-a", fits: true, hold: { x: 3e7, y: 0, z: 0 } },
			{ id: "station-no-fit", fits: false, hold: { x: 2e7, y: 0, z: 0 } },
			{ id: "station-too-far", fits: true, hold: { x: 30e8, y: 0, z: 0 } },
		];
		const base = {
			actor: ACTOR,
			homeStationId: "station-home",
			from: { x: 0, y: 0, z: 0 },
			candidates,
			masses: [],
			capacityAu: HULL_SPECS.explorer.chargeAu,
		};
		expect(selectTrafficDestination({ ...base, awayOrdinal: 0 })?.id).toBe(
			"station-z",
		);
		expect(selectTrafficDestination({ ...base, awayOrdinal: 1 })?.id).toBe(
			"station-a",
		);
		expect(selectTrafficDestination({ ...base, awayOrdinal: 2 })?.id).toBe(
			"station-z",
		);
	});

	test("collection order cannot change the selected station", () => {
		const candidates = [
			{ id: "station-b", fits: true, hold: { x: 2e7, y: 0, z: 0 } },
			{ id: "station-a", fits: true, hold: { x: 1e7, y: 0, z: 0 } },
		];
		const input = {
			actor: ACTOR,
			homeStationId: "station-home",
			from: { x: 0, y: 0, z: 0 },
			candidates,
			masses: [],
			capacityAu: HULL_SPECS.explorer.chargeAu,
			awayOrdinal: 0,
		};
		expect(selectTrafficDestination(input)).toEqual(
			selectTrafficDestination({
				...input,
				candidates: [...candidates].reverse(),
			}),
		);
	});

	test("traffic routes around the planet approach boundary", () => {
		const selected = selectTrafficDestination({
			actor: ACTOR,
			homeStationId: "station-home",
			from: { x: 0, y: 0, z: 0 },
			candidates: [
				{
					id: "station-a",
					fits: true,
					hold: { x: 200, y: 0, z: 0 },
				},
			],
			masses: [
				{
					id: "planet",
					kind: "planet",
					pos: { x: 100, y: 22, z: 0 },
					radiusKm: 20,
				},
			],
			capacityAu: HULL_SPECS.explorer.chargeAu,
			awayOrdinal: 0,
		});
		expect(selected?.chain).toHaveLength(4);
	});
});

describe("terminal-to-terminal route projection", () => {
	const record = required(
		generateGalaxy(0x5ee11e, 0).systems.find(
			(candidate) => generateContents(candidate).stations.length >= 2,
		),
		"multi-station fixture",
	);
	const home = generateContents(record).stations[0];
	const actor = stationTrafficRoster(record.index, home)[0];
	const departure = trafficScheduleAt(
		actor,
		actor.schedule.departureAtS + 0.01,
	).boundaryS;

	test("a one-station actor stays abstract while away and returns to its home berth", () => {
		const loneRecord = required(
			generateGalaxy(17, 0).systems.find(
				(candidate) => generateContents(candidate).stations.length === 1,
			),
			"one-station fixture",
		);
		const loneHome = generateContents(loneRecord).stations[0];
		const loneActor = stationTrafficRoster(loneRecord.index, loneHome)[0];
		const loneDeparture = loneActor.schedule.departureAtS;
		expect(
			projectSystemTrafficActor({
				record: loneRecord,
				actor: loneActor,
				gameTime: loneDeparture + 20,
			}).phase,
		).toBe("abstract-away");
		expect(
			projectSystemTrafficActor({
				record: loneRecord,
				actor: loneActor,
				gameTime: loneDeparture + loneActor.schedule.awayS + 0.01,
			}).phase,
		).toBe("parked-home");
	});

	test("one home-owned Carrier traverses the specified phase order", () => {
		const phases: string[] = [];
		let destination: string | null = null;
		for (let t = departure; t <= departure + 900; t += 0.5) {
			const projection = projectSystemTrafficActor({
				record,
				actor,
				gameTime: t,
			});
			if (projection.phase !== phases.at(-1)) phases.push(projection.phase);
			destination ??= projection.destinationStationId;
			if (projection.phase === "docked-away") break;
		}
		expect(destination).not.toBeNull();
		expect(destination).not.toBe(home.id);
		expect(phases).toContain("departing");
		expect(phases).toContain("local-departure");
		expect(phases).toContain("cruise");
		expect(phases).toContain("local-approach");
		expect(phases).toContain("arriving");
		expect(phases.at(-1)).toBe("docked-away");
	});

	test("every visible moving phase carries a continuous complete attitude", () => {
		const moving = new Set([
			"departing",
			"local-departure",
			"cruise",
			"regenerating",
			"local-approach",
			"clearance-queued",
			"lane-queued",
			"arriving",
		]);
		let prior: ReturnType<typeof projectSystemTrafficActor> | null = null;
		let worstStepDeg = 0;
		for (
			let tick = Math.ceil(departure * 10);
			tick <= (departure + 900) * 10;
			tick++
		) {
			const projection = projectSystemTrafficActor({
				record,
				actor,
				gameTime: tick / 10,
			});
			if (!moving.has(projection.phase)) {
				prior = null;
				if (projection.phase === "docked-away") break;
				continue;
			}
			expect([
				projection.phase,
				Boolean(projection.nose),
				Boolean(projection.up),
			]).toEqual([projection.phase, true, true]);
			const nose = projection.nose!;
			const up = projection.up!;
			const cosine = (a: typeof nose, b: typeof nose) =>
				(a.x * b.x + a.y * b.y + a.z * b.z) /
				(Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
			expect(Math.abs(cosine(nose, up))).toBeLessThan(1e-8);
			if (prior?.nose && prior.up) {
				const noseStep = Math.acos(
					Math.max(-1, Math.min(1, cosine(prior.nose, nose))),
				);
				const upStep = Math.acos(
					Math.max(-1, Math.min(1, cosine(prior.up, up))),
				);
				worstStepDeg = Math.max(worstStepDeg, noseStep, upStep);
			}
			prior = projection;
		}
		expect(worstStepDeg * (180 / Math.PI)).toBeLessThan(6);
	}, 10_000);

	test("station-zone legs stay slow, clear the bubble, and visibly dwell", () => {
		let maxZoneSpeedKms = 0;
		let lastDepartureRangeKm = 0;
		let dockedAtS: number | null = null;
		let leftDockAtS: number | null = null;
		for (let t = departure; t <= departure + 900; t += 0.5) {
			const projection = projectSystemTrafficActor({
				record,
				actor,
				gameTime: t,
			});
			const system = makeSystem(record, t);
			const nearestStation = system.contents.stations
				.map((station) => ({
					station,
					body: system.byId.get(station.id),
				}))
				.filter(
					(row): row is typeof row & { body: NonNullable<typeof row.body> } =>
						Boolean(row.body),
				)
				.sort(
					(a, b) =>
						Math.hypot(
							projection.pos.x - a.body.pos.x,
							projection.pos.y - a.body.pos.y,
							projection.pos.z - a.body.pos.z,
						) -
						Math.hypot(
							projection.pos.x - b.body.pos.x,
							projection.pos.y - b.body.pos.y,
							projection.pos.z - b.body.pos.z,
						),
				)[0];
			if (nearestStation) {
				const rangeKm = Math.hypot(
					projection.pos.x - nearestStation.body.pos.x,
					projection.pos.y - nearestStation.body.pos.y,
					projection.pos.z - nearestStation.body.pos.z,
				);
				if (projection.phase === "local-departure")
					lastDepartureRangeKm = Math.max(lastDepartureRangeKm, rangeKm);
				if (
					projection.phase === "local-departure" ||
					(projection.phase === "arriving" &&
						rangeKm > nearestStation.body.radiusKm + 0.01)
				) {
					const stationVel = bodyVelocity(system, nearestStation.station.id, t);
					maxZoneSpeedKms = Math.max(
						maxZoneSpeedKms,
						Math.hypot(
							projection.vel.x - stationVel.x,
							projection.vel.y - stationVel.y,
							projection.vel.z - stationVel.z,
						),
					);
				}
			}
			if (projection.phase === "docked-away") dockedAtS ??= t;
			else if (dockedAtS !== null && leftDockAtS === null) leftDockAtS = t;
			if (leftDockAtS !== null) break;
		}
		expect(maxZoneSpeedKms).toBeLessThanOrEqual(
			TRAFFIC_STATION_LOCAL_SPEED_KM_S + 1e-3,
		);
		expect(lastDepartureRangeKm).toBeGreaterThan(TRAFFIC_STATION_EXCLUSION_KM);
		expect(dockedAtS).not.toBeNull();
		expect((leftDockAtS ?? 0) - (dockedAtS ?? 0)).toBeGreaterThanOrEqual(
			TRAFFIC_MIN_DOCKED_S - 0.5,
		);
	});

	test("a player-input timeline delays the shared queues without changing identity", () => {
		let queueTime = departure;
		let baseline = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queueTime,
		});
		while (baseline.phase !== "arriving" && queueTime < departure + 900) {
			queueTime += 0.5;
			baseline = projectSystemTrafficActor({
				record,
				actor,
				gameTime: queueTime,
			});
		}
		expect(baseline.phase).toBe("arriving");
		const delayed = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queueTime,
			playerTimeline: [
				{
					stationId: required(
						baseline.destinationStationId ?? undefined,
						"clearance destination",
					),
					kind: "clearance",
					fromS: departure,
					toS: departure + 1000,
					participant: { kind: "player" },
					hull: HULL_SPECS.explorer.env,
				},
			],
		});
		expect(delayed.key).toBe(actor.key);
		expect(delayed.phase).toBe("clearance-queued");
		expect(delayed.queueRequest?.participant).toEqual({
			kind: "carrier",
			key: actor.key,
		});
	});

	test("a completed player clearance still delays a direct historical replay", () => {
		let queryAt = departure;
		let baseline = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queryAt,
		});
		while (baseline.phase !== "docked-away" && queryAt < departure + 900) {
			queryAt += 0.5;
			baseline = projectSystemTrafficActor({
				record,
				actor,
				gameTime: queryAt,
			});
		}
		expect(baseline.phase).toBe("docked-away");
		const delayed = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queryAt,
			playerTimeline: [
				{
					stationId: required(
						baseline.destinationStationId ?? undefined,
						"completed-clearance destination",
					),
					kind: "clearance",
					fromS: departure,
					toS: queryAt - 1,
					participant: { kind: "player" },
					hull: HULL_SPECS.explorer.env,
				},
			],
		});
		expect(delayed.phase).toBe("arriving");
		expect(delayed.key).toBe(actor.key);
	});

	test("an older incompatible player request does not block a fitting Carrier", () => {
		let arrivalTime = departure;
		let baseline = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
		});
		while (baseline.phase !== "arriving" && arrivalTime < departure + 900) {
			arrivalTime += 0.5;
			baseline = projectSystemTrafficActor({
				record,
				actor,
				gameTime: arrivalTime,
			});
		}
		const projected = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
			playerTimeline: [
				{
					stationId: required(
						baseline.destinationStationId ?? undefined,
						"incompatible-player destination",
					),
					kind: "clearance",
					fromS: departure,
					toS: departure + 1_000,
					participant: { kind: "player" },
					hull: HULL_SPECS.carrier.env,
				},
			],
		});
		expect(projected.phase).toBe("arriving");
	});

	test("shared lane arbitration honors ready time instead of privileging the player", () => {
		let arrivalTime = departure;
		let baseline = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
		});
		while (baseline.phase !== "arriving" && arrivalTime < departure + 900) {
			arrivalTime += 0.5;
			baseline = projectSystemTrafficActor({
				record,
				actor,
				gameTime: arrivalTime,
			});
		}
		const olderPlayer = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
			playerTimeline: [
				{
					stationId: required(
						baseline.destinationStationId ?? undefined,
						"older-player destination",
					),
					kind: "lane",
					movement: "launch",
					participant: { kind: "player" },
					fromS: departure,
					toS: arrivalTime + 10,
				},
			],
		});
		const laterPlayer = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
			playerTimeline: [
				{
					stationId: required(
						baseline.destinationStationId ?? undefined,
						"later-player destination",
					),
					kind: "lane",
					movement: "launch",
					participant: { kind: "player" },
					fromS: arrivalTime,
					toS: arrivalTime + 10,
				},
			],
		});
		expect(olderPlayer.phase).toBe("lane-queued");
		expect(laterPlayer.phase).toBe("arriving");
	});

	test("a committed traversal does not reset an older queued launch behind the player", () => {
		const other = stationTrafficRoster(record.index, home)[1];
		const afterCommittedLane = departure + 5.1;
		const projected = projectSystemTrafficActor({
			record,
			actor,
			gameTime: afterCommittedLane,
			playerTimeline: [
				{
					stationId: home.id,
					kind: "lane",
					movement: "arrival",
					participant: { kind: "carrier", key: other.key },
					fromS: departure,
					toS: departure + 5,
					committed: true,
				},
				{
					stationId: home.id,
					kind: "lane",
					movement: "arrival",
					participant: { kind: "player" },
					fromS: departure + 3,
					toS: departure + 20,
				},
			],
		});
		expect(projected.phase).toBe("departing");
		expect(projected.laneStartedAtS).toBe(departure + 5);
	});

	test("a committed lane traversal cannot retroactively block its own Carrier", () => {
		let arrivalTime = departure;
		let baseline = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
		});
		while (baseline.phase !== "arriving" && arrivalTime < departure + 900) {
			arrivalTime += 0.5;
			baseline = projectSystemTrafficActor({
				record,
				actor,
				gameTime: arrivalTime,
			});
		}
		const stationId = required(
			baseline.terminalStationId ?? undefined,
			"active arrival station",
		);
		const laneStartedAtS = required(
			baseline.laneStartedAtS ?? undefined,
			"active arrival start",
		);
		const replayed = projectSystemTrafficActor({
			record,
			actor,
			gameTime: arrivalTime,
			playerTimeline: [
				{
					stationId,
					kind: "lane",
					fromS: laneStartedAtS,
					toS: arrivalTime + 1,
					participant: { kind: "carrier", key: actor.key },
					movement: "arrival",
					committed: true,
				},
			],
		});
		expect(replayed.phase).toBe("arriving");
		expect(replayed.laneStartedAtS).toBe(laneStartedAtS);
	});

	test("bunched departures retain the first launch as the committed lane owner", () => {
		const startedAtS = departure;
		const active = projectSystemTrafficActor({
			record,
			actor,
			gameTime: startedAtS + 0.1,
		});
		expect(active.phase).toBe("departing");
		expect(active.laneStartedAtS).toBe(startedAtS);

		const committed = {
			stationId: home.id,
			kind: "lane" as const,
			fromS: startedAtS,
			toS: startedAtS + 5,
			participant: { kind: "carrier" as const, key: actor.key },
			movement: "launch" as const,
			committed: true,
		};
		const replayed = projectSystemTrafficActor({
			record,
			actor,
			gameTime: startedAtS + 0.1,
			playerTimeline: [committed],
		});
		expect(replayed.phase).toBe("departing");
		expect(replayed.laneStartedAtS).toBe(startedAtS);

		const other = {
			...stationTrafficRoster(record.index, home)[1],
			schedule: {
				...stationTrafficRoster(record.index, home)[1].schedule,
				departureAtS: startedAtS,
			},
		};
		const queued = projectSystemTrafficActor({
			record,
			actor: other,
			gameTime: startedAtS + 0.1,
			playerTimeline: [committed],
		});
		expect(queued.phase).toBe("launch-queued");
		expect(queued.laneStartedAtS).toBe(committed.toS);
	});

	test("a physical visit keeps its granted berth when current occupancy is replayed", () => {
		let queryAt = departure;
		let baseline = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queryAt,
		});
		while (baseline.phase !== "docked-away" && queryAt < departure + 900) {
			queryAt += 0.5;
			baseline = projectSystemTrafficActor({
				record,
				actor,
				gameTime: queryAt,
			});
		}
		const berthCache = new Map<string, string>();
		const committed = projectSystemTrafficAuthority({
			record,
			actor,
			gameTime: queryAt,
			berthCache,
		});
		const stationId = required(
			committed.terminalStationId ?? undefined,
			"settled visit station",
		);
		const berthId = required(
			committed.berthId ?? undefined,
			"settled visit berth",
		);
		expect(berthCache.size).toBeGreaterThan(0);
		const replayed = projectSystemTrafficAuthority({
			record,
			actor,
			gameTime: queryAt + 0.1,
			occupiedByStation: new Map([[stationId, new Set([berthId])]]),
			berthCache,
		});
		expect(replayed.phase).toBe("docked-away");
		expect(replayed.terminalStationId).toBe(stationId);
		expect(replayed.berthId).toBe(berthId);
	});

	test("a parked schedule boundary remains pending until the outbound leg docks", () => {
		const lateRecord = generateGalaxy(0, 0).systems[1];
		const lateHome = generateContents(lateRecord).stations[0];
		const lateActor = stationTrafficRoster(lateRecord.index, lateHome)[0];
		const due = lateActor.schedule.departureAtS + lateActor.schedule.awayS;
		const projection = projectSystemTrafficActor({
			record: lateRecord,
			actor: lateActor,
			gameTime: due + 0.01,
		});
		expect(projection.phase).not.toBe("parked-home");
		expect(projection.pendingIntent).toEqual({
			desired: "parked",
			readyAt: due,
		});
	});

	test("a long visit stays continuous across later schedule intent boundaries", () => {
		const overlapRecord = startSystem(generateGalaxy(2, 0));
		const overlapHome = required(
			generateContents(overlapRecord).stations.find(
				(station) => station.id === "station-refinery",
			),
			"overlap refinery",
		);
		const overlapActor = stationTrafficRoster(
			overlapRecord.index,
			overlapHome,
		)[0];
		const secondDeparture =
			overlapActor.schedule.departureAtS + overlapActor.schedule.cycleS;
		for (const boundary of [
			secondDeparture,
			secondDeparture + overlapActor.schedule.awayS,
			secondDeparture + overlapActor.schedule.cycleS,
		]) {
			const before = projectSystemTrafficActor({
				record: overlapRecord,
				actor: overlapActor,
				gameTime: boundary - 0.01,
			});
			const after = projectSystemTrafficActor({
				record: overlapRecord,
				actor: overlapActor,
				gameTime: boundary + 0.01,
			});
			const distance = Math.hypot(
				after.pos.x - before.pos.x,
				after.pos.y - before.pos.y,
				after.pos.z - before.pos.z,
			);
			const physicalTravel =
				Math.hypot(before.vel.x, before.vel.y, before.vel.z) * 0.02;
			// Cruise can legitimately cover more than 10,000 km in these 20 ms.
			// Continuity means the displacement is the motion already in progress,
			// not a restart at the home station when schedule intent changes.
			expect(distance).toBeLessThanOrEqual(physicalTravel * 1.05 + 1);
		}
	});

	test("the actor returns physically and requests any fitting home berth", () => {
		const originalBerth = stationTrafficRoster(record.index, home)[0].ordinal;
		const homeBerthId = `deck-${originalBerth === 0 ? "near" : "deep"}`;
		const occupied = new Map([[home.id, new Set([homeBerthId])]]);
		let returned: ReturnType<typeof projectSystemTrafficActor> | null = null;
		for (
			let t = departure + actor.schedule.awayS;
			t < departure + 800;
			t += 0.5
		) {
			const projection = projectSystemTrafficActor({
				record,
				actor,
				gameTime: t,
				occupiedByStation: occupied,
			});
			if (projection.phase === "parked-home") {
				returned = projection;
				break;
			}
		}
		expect(returned?.phase).toBe("parked-home");
		expect(returned?.berthId).not.toBe(homeBerthId);
		expect(returned?.chargeAu).toBe(HULL_SPECS[actor.hullId].chargeAu);
	});

	test("route projection is independent of query cadence", () => {
		const queryAt = departure + 120.25;
		const cruiseCache = new Map();
		let afterStepping = projectSystemTrafficAuthority({
			record,
			actor,
			gameTime: departure,
			cruiseCache,
		});
		for (let t = departure + 0.1; t < queryAt; t += 0.1)
			afterStepping = projectSystemTrafficAuthority({
				record,
				actor,
				gameTime: t,
				cruiseCache,
			});
		afterStepping = projectSystemTrafficAuthority({
			record,
			actor,
			gameTime: queryAt,
			cruiseCache,
		});
		const direct = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queryAt,
		});
		expect({
			...afterStepping,
			pos: null,
			vel: null,
			nose: null,
			up: null,
		}).toEqual({ ...direct, pos: null, vel: null, nose: null, up: null });
		for (const axis of ["x", "y", "z"] as const) {
			expect(afterStepping.pos[axis]).toBeCloseTo(direct.pos[axis], 8);
			expect(afterStepping.vel[axis]).toBeCloseTo(direct.vel[axis], 8);
			expect(afterStepping.nose?.[axis] ?? 0).toBeCloseTo(
				direct.nose?.[axis] ?? 0,
				8,
			);
			expect(afterStepping.up?.[axis] ?? 0).toBeCloseTo(
				direct.up?.[axis] ?? 0,
				8,
			);
		}
		expect(cruiseCache.size).toBeGreaterThan(0);
	}, 10_000);

	test("a route gives the lane back when it said it would (#521)", () => {
		// The player's wait estimate reads `laneEndsAtS` off queued and flying
		// routes, so the prediction must be the moment the route actually leaves
		// `departing` or `arriving` — within one step of this walk. A launch and
		// an arrival are both flown, so both halves of the composition are held.
		const STEP_S = 0.25;
		const cruiseCache = new Map();
		const exits: { movement: string; predicted: number; actual: number }[] = [];
		let open: { phase: string; predicted: number } | null = null;
		for (
			let t = departure - 5;
			t < departure + actor.schedule.awayS + 900 && exits.length < 2;
			t += STEP_S
		) {
			const projection = projectSystemTrafficAuthority({
				record,
				actor,
				gameTime: t,
				cruiseCache,
			});
			const lanePhase =
				projection.phase === "departing" || projection.phase === "arriving";
			if (lanePhase) {
				expect(projection.laneEndsAtS).toBeDefined();
				open ??= {
					phase: projection.phase,
					predicted: projection.laneEndsAtS ?? Number.NaN,
				};
				// One prediction for the whole traversal, not one that drifts.
				expect(projection.laneEndsAtS).toBeCloseTo(open.predicted, 9);
			} else if (open) {
				exits.push({
					movement: open.phase,
					predicted: open.predicted,
					actual: t,
				});
				open = null;
			}
		}
		expect(exits.map((exit) => exit.movement)).toEqual([
			"departing",
			"arriving",
		]);
		for (const exit of exits) {
			expect(exit.actual).toBeGreaterThanOrEqual(exit.predicted);
			expect(exit.actual - exit.predicted).toBeLessThan(STEP_S);
		}
	}, 20_000);

	test("cold cache warm-up obeys a fixed canonical tick budget", () => {
		const cruiseCache = new Map();
		const queryAt = departure + 120.25;
		let projection = projectSystemTrafficAuthority({
			record,
			actor,
			gameTime: queryAt,
			cruiseCache,
			cruiseTickBudget: 25,
		});
		expect(projection.warmIncomplete).toBe(true);
		const cachedWork = () =>
			[...cruiseCache.values()].reduce(
				(total, state) => total + state.workTicks,
				0,
			);
		expect(cachedWork()).toBeLessThanOrEqual(25);
		let calls = 1;
		while (projection.warmIncomplete && calls < 1_000) {
			const beforeWork = cachedWork();
			projection = projectSystemTrafficAuthority({
				record,
				actor,
				gameTime: queryAt,
				cruiseCache,
				cruiseTickBudget: 25,
			});
			expect(cachedWork() - beforeWork).toBeLessThanOrEqual(25);
			calls++;
		}
		expect(projection.warmIncomplete).toBe(false);
		expect(calls).toBeGreaterThan(1);
		expect(calls).toBeLessThan(1_000);
		const direct = projectSystemTrafficActor({
			record,
			actor,
			gameTime: queryAt,
		});
		expect({
			...projection,
			pos: null,
			vel: null,
			nose: null,
			up: null,
		}).toEqual({
			...direct,
			pos: null,
			vel: null,
			nose: null,
			up: null,
		});
		for (const axis of ["x", "y", "z"] as const)
			expect(projection.up?.[axis] ?? 0).toBeCloseTo(direct.up?.[axis] ?? 0, 8);
	});

	test("cold presentation parks only actors whose base schedule is parked", () => {
		const projectionSystem = makeSystem(record, 0);
		const actors = projectionSystem.contents.stations.flatMap((station) =>
			stationTrafficRoster(record.index, station),
		);
		const cold = actors
			.filter(
				(candidate) => trafficScheduleAt(candidate, 0).desired === "parked",
			)
			.map((candidate) =>
				projectParkedTrafficActor({
					actor: candidate,
					gameTime: 0,
					projectionSystem,
				}),
			);
		expect(cold.length).toBeGreaterThan(0);
		expect(cold.length).toBeLessThan(actors.length);
		for (const projection of cold) {
			const candidate = required(
				actors.find((item) => item.key === projection.key),
				"cold actor",
			);
			expect(trafficScheduleAt(candidate, 0).desired).toBe("parked");
			expect(projection.phase).toBe("parked-home");
			expect(projection.terminalStationId).toBe(candidate.homeStationId);
			expect(projection.berthId).not.toBeNull();
		}
	});

	test("phase-equivalent cold queries do work independent of epoch age", () => {
		const offset = 30;
		const dayCycle = Math.floor(
			(86_400 - actor.schedule.departureAtS) / actor.schedule.cycleS,
		);
		const yearCycle = Math.floor(
			(365 * 86_400 - actor.schedule.departureAtS) / actor.schedule.cycleS,
		);
		const day = projectSystemTrafficActor({
			record,
			actor,
			gameTime:
				actor.schedule.departureAtS + dayCycle * actor.schedule.cycleS + offset,
		});
		const year = projectSystemTrafficActor({
			record,
			actor,
			gameTime:
				actor.schedule.departureAtS +
				yearCycle * actor.schedule.cycleS +
				offset,
		});
		expect(year.phase).toBe(day.phase);
		expect(day.workTicks).toBeLessThan(5_000);
		expect(Math.abs(year.workTicks - day.workTicks)).toBeLessThanOrEqual(50);
	});
});

describe("canonical Traffic cruise", () => {
	const environment: TrafficCruiseEnvironment = {
		params: DEFAULT_CRUISE,
		targetAt: () => ({
			id: "hold",
			pos: { x: 5e6, y: 0, z: 0 },
			vel: { x: 0, y: 0, z: 0 },
			radiusKm: 0,
		}),
		massesAt: () => [],
		targetParentId: null,
		capacityAu: HULL_SPECS.courier.chargeAu,
	};
	const initial: TrafficCruiseState = {
		phase: "cruise",
		pos: { x: 0, y: 0, z: 0 },
		vel: { x: 0, y: 0, z: 0 },
		nose: { x: 1, y: 0, z: 0 },
		up: { x: 0, y: 1, z: 0 },
		chargeAu: 12,
		startedAtS: 100,
		atS: 100,
		workTicks: 0,
	};

	test("direct evaluation equals repeated canonical stepping including a fractional tick", () => {
		const direct = evaluateTrafficCruise(initial, 112.35, environment);
		let stepped = initial;
		for (
			let t = 100 + CANONICAL_ROUTE_DT_S;
			t <= 112.3 + 1e-9;
			t += CANONICAL_ROUTE_DT_S
		)
			stepped = evaluateTrafficCruise(
				stepped,
				Number(t.toFixed(10)),
				environment,
			);
		stepped = evaluateTrafficCruise(stepped, 112.35, environment);
		expect(stepped).toEqual(direct);
		expect(direct.workTicks).toBe(124);
	});

	test("render cadence is not an input to route progress", () => {
		const a = evaluateTrafficCruise(initial, 105, environment);
		let b = initial;
		for (let t = 100.016; t < 105; t += 0.016)
			b = evaluateTrafficCruise(b, Math.min(t, 105), environment);
		b = evaluateTrafficCruise(b, 105, environment);
		expect(b.pos).toEqual(a.pos);
		expect(b.chargeAu).toBe(a.chargeAu);
	});

	test("detour guidance also replays from its physical-leg boundary", () => {
		const mass = {
			id: "planet",
			pos: { x: 500_000, y: 0, z: 0 },
			vel: { x: 0, y: 0, z: 0 },
			radiusKm: 100_000,
		};
		const target = {
			id: "hold",
			pos: { x: 1_000_000, y: 0, z: 0 },
			vel: { x: 0, y: 0, z: 0 },
			radiusKm: 0,
		};
		const guidance = beginCruiseGuidance({
			from: initial.pos,
			target,
			masses: [mass],
			targetParentId: null,
		}).guidance;
		const detourInitial: TrafficCruiseState = { ...initial, guidance };
		const detourEnvironment: TrafficCruiseEnvironment = {
			...environment,
			targetAt: () => target,
			massesAt: () => [mass],
			guide: (state, _time, dt, currentTarget) => {
				const guided = stepCruiseGuidance({
					guidance: state.guidance ?? null,
					pos: state.pos,
					nose: state.nose,
					target: currentTarget,
					masses: [mass],
					targetParentId: null,
					dt,
					speedKms: Math.hypot(state.vel.x, state.vel.y, state.vel.z),
					steerDirect: true,
				});
				return {
					nose: guided.nose,
					throttle: guided.throttle,
					guidance: guided.guidance,
				};
			},
		};
		const direct = evaluateTrafficCruise(detourInitial, 101, detourEnvironment);
		let stepped = detourInitial;
		for (let t = 100.1; t <= 101 + 1e-9; t += 0.1)
			stepped = evaluateTrafficCruise(
				stepped,
				Number(t.toFixed(1)),
				detourEnvironment,
			);
		expect(stepped).toEqual(direct);
	});

	test("work depends on active-leg age, not the absolute epoch", () => {
		const day = evaluateTrafficCruise(
			{ ...initial, startedAtS: 86_390, atS: 86_390 },
			86_400,
			environment,
		);
		const year = evaluateTrafficCruise(
			{ ...initial, startedAtS: 365 * 86_400 - 10, atS: 365 * 86_400 - 10 },
			365 * 86_400,
			environment,
		);
		expect(year.workTicks).toBe(day.workTicks);
	});

	test("an exhausted actor regenerates against its explicit hull capacity and retries", () => {
		const shortEnvironment: TrafficCruiseEnvironment = {
			...environment,
			capacityAu: 18,
			targetAt: () => ({
				id: "hold",
				pos: { x: 0.001 * AU_KM, y: 0, z: 0 },
				vel: { x: 0, y: 0, z: 0 },
				radiusKm: 0,
			}),
		};
		const recovered = evaluateTrafficCruise(
			{ ...initial, phase: "regenerating", chargeAu: 0 },
			100.2,
			shortEnvironment,
		);
		expect(recovered.phase).toBe("cruise");
		expect(recovered.chargeAu).toBeGreaterThan(0);
		expect(recovered.chargeAu).toBeLessThanOrEqual(18);
		expect(
			Math.hypot(recovered.vel.x, recovered.vel.y, recovered.vel.z),
		).toBeGreaterThan(0);
	});

	test("an unavailable detour stops in the blocker frame instead of becoming an arrival", () => {
		const blocked = evaluateTrafficCruise(initial, 100.1, {
			...environment,
			massesAt: () => [
				{
					id: "planet",
					pos: { x: 1_000, y: 0, z: 0 },
					vel: { x: 4, y: 5, z: 6 },
					radiusKm: 100,
				},
			],
			guide: (state) => ({
				nose: state.nose,
				throttle: 0,
				error: { kind: "detour-unavailable", blockerId: "planet" },
			}),
		});
		expect(blocked.phase).toBe("blocked");
		expect(blocked.blockedById).toBe("planet");
		expect(blocked.vel).toEqual({ x: 4, y: 5, z: 6 });
		expect(blocked.completedAtS).toBeUndefined();
	});

	test("replay preserves an initially blocked route until guidance replans it", () => {
		const phases: string[] = [];
		const replayed = evaluateTrafficCruise(
			{
				...initial,
				phase: "blocked",
				blockedById: "planet",
				initialPhase: "blocked",
				initialBlockedById: "planet",
			},
			100.1,
			{
				...environment,
				guide: (state) => {
					phases.push(state.phase);
					return {
						nose: state.nose,
						throttle: 0,
						error: {
							kind: "detour-unavailable",
							blockerId: "planet",
						},
					};
				},
			},
		);
		expect(phases[0]).toBe("blocked");
		expect(replayed.phase).toBe("blocked");
		expect(replayed.blockedById).toBe("planet");
	});
});

/**
 * Node #491: Traffic trades on its own side of #490's line (`STATION_LAWFUL`).
 *
 * The rule is a choice this node made, not one #490 ruled, and it is here so it
 * can be reversed on purpose: it is what kept every existing carrier's
 * schedule where it was when the outpost was placed. A lawful station's
 * carriers are never sent to the raider outpost, and the outpost's own — with
 * no other outpost in the system — leave abstractly and come home.
 */
describe("node #491: Traffic stays on its own side of the line", () => {
	const record = required(
		generateGalaxy(0x5ee11e, 0).systems.find((candidate) => {
			const stations = generateContents(candidate).stations;
			return (
				stations.some((s) => s.type === "outpost") &&
				stations.filter((s) => STATION_LAWFUL[s.type]).length >= 2
			);
		}),
		"a lawless system with two lawful stations beside its outpost",
	);
	const stations = generateContents(record).stations;

	/** Where an actor's `cycle`th away leg goes, or null for abstract-away. */
	const destinationOf = (
		actor: ReturnType<typeof stationTrafficRoster>[number],
		cycle: number,
	) => {
		const departure =
			actor.schedule.departureAtS + cycle * actor.schedule.cycleS;
		for (let t = departure; t <= departure + 900; t += 5) {
			const projection = projectSystemTrafficActor({
				record,
				actor,
				gameTime: t,
			});
			if (projection.destinationStationId)
				return projection.destinationStationId;
			if (projection.phase === "abstract-away") return null;
		}
		return null;
	};

	test("no lawful station's carrier is routed to the outpost", () => {
		let legs = 0;
		for (const home of stations.filter((s) => STATION_LAWFUL[s.type]))
			for (const actor of stationTrafficRoster(record.index, home).slice(0, 3))
				for (let cycle = 0; cycle < 3; cycle++) {
					const to = destinationOf(actor, cycle);
					if (to === null) continue;
					legs++;
					expect(to).not.toBe("station-outpost");
				}
		// The rule above over no legs passes anything.
		expect(legs).toBeGreaterThan(5);
	});

	test("the outpost's own carrier goes away abstractly and comes home", () => {
		const outpost = required(
			stations.find((s) => s.type === "outpost"),
			"outpost",
		);
		const actor = required(
			stationTrafficRoster(record.index, outpost)[0],
			"outpost Traffic",
		);
		const departure = actor.schedule.departureAtS;
		expect(
			projectSystemTrafficActor({ record, actor, gameTime: departure + 20 })
				.phase,
		).toBe("abstract-away");
		expect(
			projectSystemTrafficActor({
				record,
				actor,
				gameTime: departure + actor.schedule.awayS + 0.01,
			}).phase,
		).toBe("parked-home");
	});
});
