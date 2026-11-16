import { expect, test } from "bun:test";
import { makeWorld, restoreWorld } from "../src/sim";
import { carrierKey } from "../src/carrier-key";
import { systemFields } from "../src/asteroid-field";
import { generateContents } from "../src/system";
import {
	AUTHORED_HULL_MODELS,
	isAuthoredHullModel,
	stationModel,
} from "../src/model-catalog";
import {
	bootModelIds,
	systemModelIds,
	trafficRosterHulls,
} from "../src/system-models";

test("boot waits only for cockpit and home exterior, including saves at any role", () => {
	const world = makeWorld(42);
	const home = world.system.contents.stations.find((s) => s.type === "trade")!;
	expect(bootModelIds(world.system, null)).toEqual([
		"cockpit",
		...[stationModel(home)].filter((id) => id !== null),
	]);
	for (let i = 0; i < 16; i++) {
		const { system } = restoreWorld(42, 0, i, 0);
		for (const station of system.contents.stations) {
			const ids = bootModelIds(system, carrierKey(i, station.localCarrierId));
			expect(ids).toEqual([
				"cockpit",
				...[stationModel(station)].filter((id) => id !== null),
			]);
			expect(ids).not.toContain("miner");
			expect(ids).not.toContain("interiors");
		}
	}
});

test("system set includes its stations, home and inbound Traffic hulls, and the flown hull", () => {
	const { system, galaxy } = makeWorld(42);
	const contents = (i: number) =>
		generateContents(galaxy.systems.find((r) => r.index === i)!);
	const hulls = trafficRosterHulls(galaxy, system.record.index, contents);
	const ids = systemModelIds(system, hulls, "miner");
	expect(ids).toContain("miner");
	expect(ids).toContain("cockpit");
	expect(ids).toContain("interiors");
	for (const station of system.contents.stations) {
		const id = stationModel(station);
		if (id) expect(ids).toContain(id);
	}
	for (const hull of hulls)
		if (isAuthoredHullModel(hull)) expect(ids).toContain(hull);
	expect(new Set(ids).size).toBe(ids.length);
});

test("every authored hull is queued when flown or in Traffic", () => {
	const { system } = makeWorld(42);
	for (const hull of AUTHORED_HULL_MODELS) {
		expect(systemModelIds(system, [], hull)).toContain(hull);
		expect(systemModelIds(system, [hull], "interceptor")).toContain(hull);
	}
});

test("a system with an asteroid field queues the field rocks, and one without does not", () => {
	let with_ = 0;
	let without = 0;
	for (let i = 0; i < 40; i++) {
		const { system } = restoreWorld(42, 0, i, 0);
		const ids = systemModelIds(system, [], "courier");
		if (systemFields(system.record, system.contents).length) {
			with_++;
			expect(ids).toContain("asteroids");
		} else {
			without++;
			expect(ids).not.toContain("asteroids");
		}
		// Never a boot model: a field draws points until the rocks install.
		expect(bootModelIds(system, null)).not.toContain("asteroids");
	}
	expect(with_).toBeGreaterThan(0);
	expect(without).toBeGreaterThan(0);
});
