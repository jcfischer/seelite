import { expect, test } from "bun:test";
import {
	deathWreckContents,
	worldAfterDeath,
	clearStationWreck,
} from "../src/death-wreck";
import { deathWreckPose } from "../src/derelict";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";
import { newWorld } from "../src/world-state";
import {
	makeWorld,
	advanceSystem,
	bodyVelocity,
	stationApertureFrame,
} from "../src/sim";
import { proxyReachKm, stationProxyOf } from "../src/station-proxy";
import { corridorRadiusKm } from "../src/station-interior";
import { scoopWreckContainer } from "../src/derelict-salvage";
import { sweepSources, parseSweepReadings } from "../src/system-sweep";
import {
	SaveStore,
	memorySaveBackend,
	memorySlotLocks,
} from "../src/save-store";
import { fnv1a } from "../src/rng";
import { requestAction, entrustedTonnesAboard } from "../src/requests";
import { generateGalaxy } from "../src/galaxy";
import { firstOffer } from "./helpers/job-board";
import { liveDerelicts, derelictReadings } from "../src/long-range-scanner";
import { applyHoldEvent } from "../src/holdings";
import { emptyPending } from "../src/ladder";
import { v3, add, sub, scale, dot, length } from "../src/vec3";

const system = makeWorld(47).system;
const dying = {
	...newCommanderRecord("courier", { systemIndex: system.record.index }),
	state: {
		...newCommanderRecord("courier").state,
		cargo: { Food: 8, Gold: 12 },
		ownedEquipment: ["Escape Pod", "Docking Computer", "Fuel Scoops"],
	},
	flight: {
		...newCommanderRecord("courier").flight,
		pos: [1e8, 2e8, 3e8] as const,
	},
};
test("per-item death draws are deterministic, independent of list order and other inventory", () => {
	const draw = deathWreckContents(47, 10, dying.state, "destroyed");
	expect(deathWreckContents(47, 10, dying.state, "destroyed")).toEqual(draw);
	const reordered = {
		...dying.state,
		cargo: { Gold: 12, Food: 8 },
		ownedEquipment: [...dying.state.ownedEquipment].reverse(),
	};
	expect(deathWreckContents(47, 10, reordered, "destroyed")).toEqual(draw);
	for (let at = 0; at < 100; at++) {
		const original = deathWreckContents(47, at, dying.state, "destroyed");
		const extra = deathWreckContents(
			47,
			at,
			{ ...dying.state, cargo: { ...dying.state.cargo, Textiles: 3 } },
			"destroyed",
		);
		expect(extra.filter((c) => c.id !== "Textiles")).toEqual(original);
		expect(
			original.some((c) => c.id === "Escape Pod" || c.id === "courier"),
		).toBe(false);
		expect(
			deathWreckContents(47, at, dying.state, "eject").every(
				(c) => c.kind === "good",
			),
		).toBe(true);
	}
	const survivors = Array.from({ length: 1000 }, (_, at) =>
		deathWreckContents(47, at, dying.state, "destroyed"),
	);
	for (const id of ["Food", "Gold", "Docking Computer", "Fuel Scoops"]) {
		const count = survivors.filter((cs) => cs.some((c) => c.id === id)).length;
		expect(count).toBeGreaterThan(420);
		expect(count).toBeLessThan(580);
	}
});
test("one own-loss wreck persists without expiry, follows the death frame and is replaced", () => {
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: 10 },
		dying,
		"destroyed",
		system.contents.star.id,
	);
	const row = world.galaxies[0].deathWreck!;
	expect(row).toBeDefined();
	expect(world.galaxies[0].knowledge[row.key].source).toBe("own loss");
	expect(deathWreckPose(system, row, 10).pos).toEqual(v3(1e8, 2e8, 3e8));
	const saved = parseSave(serializeSave({ world, commander: dying }));
	expect(saved.world.galaxies[0].deathWreck).toEqual(row);
	expect(liveDerelicts(world, system, 1e7).some((w) => w.key === row.key)).toBe(
		true,
	);
	expect(
		derelictReadings(world, system, v3(), [], 10).find((w) => w.key === row.key)
			?.identified,
	).toBe(true);
	const next = worldAfterDeath(
		{ ...world, gameTime: 20 },
		{ ...dying, galaxyIndex: 1, systemIndex: 4 },
		"eject",
	);
	expect(next.galaxies.filter((g) => g.deathWreck)).toHaveLength(1);
	expect(next.galaxies[0].knowledge[row.key]).toBeUndefined();
});
test("the Holdings wreck scoop recovers goods and fittings once and removes a stripped death wreck", () => {
	let world = worldAfterDeath(
		{ ...newWorld(47), gameTime: 10 },
		dying,
		"destroyed",
		system.contents.star.id,
	);
	const wreck = world.galaxies[0].deathWreck!;
	let holdings = {
		commander: newCommanderRecord("courier").state,
		requests: dying.requests,
		ladders: dying.ladders,
		ladderPending: emptyPending(),
	};
	for (let i = 0; i < wreck.containers.length; i++) {
		const at = { pos: v3(), vel: v3() };
		const event = {
			kind: "wreck-scoop" as const,
			key: wreck.key,
			galaxyIndex: 0,
			instanceOrdinal: wreck.instanceOrdinal,
			containerIndex: i,
			at: 10,
			container: at,
			ship: at,
		};
		const outcome = applyHoldEvent(holdings, world, event);
		expect(outcome.signals.wreckScoop?.tonnes).toBe(wreck.containers[i].left);
		world = outcome.world;
		holdings = outcome.holdings;
		expect(
			applyHoldEvent(holdings, world, event).signals.wreckScoop?.tonnes ?? 0,
		).toBe(0);
	}
	expect(world.galaxies[0].deathWreck).toBeUndefined();
	expect(holdings.commander.ownedEquipment).toEqual([]);
	parseSave(
		serializeSave({
			world,
			commander: {
				...dying,
				state: holdings.commander,
				ladders: holdings.ladders,
			},
		}),
	);
});

test("a body-frame death follows that body over time; station deaths clear keep-out and corridor", () => {
	const station = system.contents.stations[0];
	advanceSystem(system, 10);
	const centre = system.byId.get(station.id)!.pos;
	const atStation = {
		...dying,
		flight: { ...dying.flight, pos: [centre.x, centre.y, centre.z] as const },
	};
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: 10 },
		atStation,
		"destroyed",
		station.id,
	);
	const row = world.galaxies[0].deathWreck!;
	const frame = stationApertureFrame(system, station.id, 10);
	const delta = row.offset;
	expect(length(delta)).toBeGreaterThan(proxyReachKm(stationProxyOf(station)));
	expect(
		length(sub(delta, scale(frame.axis, dot(delta, frame.axis)))),
	).toBeGreaterThan(corridorRadiusKm(frame.aperture));
	const later = deathWreckPose(system, row, 100);
	advanceSystem(system, 100);
	expect(sub(later.pos, system.byId.get(station.id)!.pos)).toEqual(row.offset);
	expect(later.vel).toEqual(bodyVelocity(system, station.id, 100));
	const p = clearStationWreck(
		v3(0, 0, 10),
		v3(),
		v3(0, 0, 1),
		v3(1, 0, 0),
		2,
		1,
	);
	expect(p).toEqual(v3(1, 0, 10));
	const q = clearStationWreck(v3(), v3(), v3(0, 0, 1), v3(1, 0, 0), 2, 1);
	expect(length(q)).toBeCloseTo(2);
	expect(q.x).toBe(1);
});

test("death scoop honors speed, partial tonnes, whole fittings and native kg/g without extra hold tonnage", () => {
	const row = {
		instanceOrdinal: 0,
		lostAt: 0,
		containers: [
			{ kind: "good" as const, id: "Food", tonnes: 8, left: 8 },
			{ kind: "good" as const, id: "Gold", tonnes: 12, left: 12 },
			{ kind: "fitting" as const, id: "Docking Computer", tonnes: 1, left: 1 },
		],
	};
	const pose = { pos: v3(), vel: v3() };
	const full = { ...dying.state, cargo: { Food: 19 } };
	const partial = scoopWreckContainer(row, 0, full, 0, pose, pose, 1);
	expect(partial.tonnes).toBe(1);
	expect(partial.row.containers[0].left).toBe(7);
	const kg = scoopWreckContainer(row, 1, partial.commander, 0, pose, pose, 1);
	expect(kg.commander.cargo.Gold).toBe(12);
	expect(
		scoopWreckContainer(row, 2, kg.commander, 0, pose, pose, 1).refusal,
	).toContain("0 t free");
	expect(
		scoopWreckContainer(
			row,
			1,
			full,
			0,
			pose,
			{ pos: v3(), vel: v3(2, 0, 0) },
			1,
		).tonnes,
	).toBe(0);
});

test("schema 11 migrates empty and refuses a grafted death wreck; malformed new rows refuse", () => {
	const raw = serializeSave({ world: newWorld(47), commander: dying }) as any;
	raw.saveSchemaVersion = 11;
	const { integrity, ...body } = raw;
	raw.integrity = fnv1a(JSON.stringify(body));
	expect(parseSave(raw).world.galaxies.every((g) => !g.deathWreck)).toBe(true);
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: 10 },
		dying,
		"destroyed",
	);
	const saved = serializeSave({ world, commander: dying }) as any;
	for (const mutate of [
		(r: any) => {
			r.saveSchemaVersion = 11;
		},
		(r: any) => {
			r.world.galaxies[1].deathWreck = structuredClone(
				r.world.galaxies[0].deathWreck,
			);
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.bodyId = "missing-frame";
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.containers[0].id = "Escape Pod";
			r.world.galaxies[0].deathWreck.containers[0].kind = "fitting";
		},
		(r: any) => {
			r.world.galaxies[0].deathWreck.lostAt = 11;
		},
	]) {
		const bad = structuredClone(saved);
		mutate(bad);
		expect(() => parseSave(bad)).toThrow();
	}
});

test("sweep provenance names an own wreck but remains valid after it disappears", () => {
	const world = worldAfterDeath(
		{ ...newWorld(47), gameTime: 10 },
		dying,
		"destroyed",
	);
	const readings = sweepSources(world, 0, dying.systemIndex);
	expect(readings.some((r) => r.id.endsWith(":commander-wreck"))).toBe(true);
	expect(
		parseSweepReadings(readings, { ...newWorld(47), gameTime: 10 }),
	).toEqual(readings);
});

test("SaveStore writes the dying leg's owned cargo, not launch cargo or entrusted Requests lots", async () => {
	const backend = memorySaveBackend();
	const launch = {
		...dying,
		state: { ...dying.state, cargo: { Textiles: 7 } },
	};
	await backend.write(
		"death-test",
		"lastDocked",
		serializeSave({ world: newWorld(47), commander: launch }),
	);
	const envelope = {
		world: { ...newWorld(47), gameTime: 10 },
		commander: dying,
	};
	const store = new SaveStore({
		locks: memorySlotLocks(),
		schedule: () => () => {},
		backend,
		slot: "death-test",
		current: () => envelope,
	});
	const restored = await store.revertToLastDocked(
		dying,
		"destroyed",
		system.contents.star.id,
	);
	expect(restored?.world.galaxies[0].deathWreck?.containers).toEqual(
		deathWreckContents(47, 10, dying.state, "destroyed"),
	);
	expect(
		restored?.world.galaxies[0].deathWreck?.containers.some(
			(c) => c.id === "Textiles",
		),
	).toBe(false);
	expect(restored?.commander.state.cargo).toEqual({});
});

test("entrusted lots never enter either death cause's wreck", () => {
	const { offers, offer } = firstOffer(
		generateGalaxy(47, 0).systems,
		"courier",
	);
	const accepted = requestAction(dying.requests, offers, "accept", offer.id, {
		now: 60,
		docked: {
			galaxyIndex: offer.requester.galaxyIndex,
			carrierKey: offer.requester.carrierKey,
		},
		cargo: {},
		holdRoomT: 200,
		standing: "clean",
		equipment: [],
	});
	expect(accepted.ok).toBe(true);
	expect(entrustedTonnesAboard(accepted.state)).toBeGreaterThan(0);
	for (const cause of ["destroyed", "eject"] as const) {
		for (let at = 60; at < 160; at++) {
			const withLots = worldAfterDeath(
				{ ...newWorld(47), gameTime: at },
				{ ...dying, requests: accepted.state },
				cause,
			);
			const ownedOnly = worldAfterDeath(
				{ ...newWorld(47), gameTime: at },
				dying,
				cause,
			);
			expect(withLots).toEqual(ownedOnly);
		}
	}
});
