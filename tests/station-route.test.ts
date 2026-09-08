import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { DEFAULT_CRUISE } from "../src/cruise";
import {
	beginCruiseGuidance,
	stepCruiseGuidance,
} from "../src/cruise-guidance";
import { generateGalaxy, startSystem } from "../src/galaxy";
import { HULL_SPECS } from "../src/hull";
import { makeSystem } from "../src/sim";
import {
	CANONICAL_ROUTE_DT_S,
	evaluateTrafficCruise,
	projectParkedTrafficActor,
	projectSystemTrafficActor,
	selectTrafficDestination,
	type TrafficCruiseEnvironment,
	type TrafficCruiseState,
} from "../src/station-route";
import {
	stationTrafficRoster,
	trafficScheduleAt,
} from "../src/station-traffic";
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
		const committed = projectSystemTrafficActor({
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
		const replayed = projectSystemTrafficActor({
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
			t < departure + 420;
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
		const queryAt = departure + 73.25;
		const cruiseCache = new Map();
		let afterStepping = projectSystemTrafficActor({
			record,
			actor,
			gameTime: departure,
			cruiseCache,
		});
		for (let t = departure + 0.1; t < queryAt; t += 0.1)
			afterStepping = projectSystemTrafficActor({
				record,
				actor,
				gameTime: t,
				cruiseCache,
			});
		afterStepping = projectSystemTrafficActor({
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
		}).toEqual({ ...direct, pos: null, vel: null, nose: null });
		for (const axis of ["x", "y", "z"] as const) {
			expect(afterStepping.pos[axis]).toBeCloseTo(direct.pos[axis], 8);
			expect(afterStepping.vel[axis]).toBeCloseTo(direct.vel[axis], 8);
			expect(afterStepping.nose?.[axis] ?? 0).toBeCloseTo(
				direct.nose?.[axis] ?? 0,
				8,
			);
		}
		expect(cruiseCache.size).toBeGreaterThan(0);
	}, 10_000);

	test("cold cache warm-up obeys a fixed canonical tick budget", () => {
		const cruiseCache = new Map();
		const queryAt = departure + 73.25;
		let projection = projectSystemTrafficActor({
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
			projection = projectSystemTrafficActor({
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
		expect({ ...projection, pos: null, vel: null, nose: null }).toEqual({
			...direct,
			pos: null,
			vel: null,
			nose: null,
		});
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
	};
	const initial: TrafficCruiseState = {
		phase: "cruise",
		pos: { x: 0, y: 0, z: 0 },
		vel: { x: 0, y: 0, z: 0 },
		nose: { x: 1, y: 0, z: 0 },
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
