import { expect, test } from "bun:test";
import { derelictFirstLossAt, derelictSlots } from "../src/derelict-slots";
import { derelictPose } from "../src/derelict";
import { makeWorld } from "../src/sim";
import { LONG_RANGE_SCANNER } from "../src/market";
import { add, v3 } from "../src/vec3";
import {
	advanceTo,
	effectiveDerelict,
	newWorld,
	scoopDerelict,
	replaceSystemLeads,
	parseWorld,
	serializeWorld,
} from "../src/world-state";
import {
	identifyDerelicts,
	derelictReadings,
	sweepSystem,
	stepSweep,
	SWEEP_CHARGE_S,
} from "../src/long-range-scanner";
import {
	bankOnDock,
	emptyLadderRecord,
	emptyPending,
	pendingKind,
	parseLadders,
	serializeLadders,
} from "../src/ladder";
import { carrierKey } from "../src/carrier-key";
import { fnv1a } from "../src/rng";
import { applyHoldEvent } from "../src/holdings";
import { newCommander } from "../src/station-commerce";
import { emptyRequests } from "../src/requests";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
} from "../src/save-envelope";

const system = makeWorld(47).system;
const key = derelictSlots(system.record.index, system.record.government)[0].key;
const at = derelictFirstLossAt(system.record.seed, key) + 1;
const world = advanceTo(newWorld(47), at);
const row = effectiveDerelict(world, 0, key, at);
if (row.condition !== "destroyed") throw Error("fixture has no wreck");
const pose = derelictPose(system, key, row.instanceOrdinal, at);
const far = add(pose.pos, v3(3000, 0, 0));
const modules = [LONG_RANGE_SCANNER];

test("charged sweep requires the module and ten uninterrupted seconds", () => {
	expect(stepSweep(0, 20, []).complete).toBe(false);
	expect(stepSweep(0, SWEEP_CHARGE_S - 0.01, modules).complete).toBe(false);
	expect(stepSweep(SWEEP_CHARGE_S - 0.01, 0.01, modules).complete).toBe(true);
});
test("a system sweep writes region source and age but never knowledge", () => {
	expect(sweepSystem(world, system, [], at)).toBe(world);
	const swept = sweepSystem(world, system, modules, at);
	const lead = swept.galaxies[0].leads![key];
	expect(lead.kind).toBe("derelict");
	expect(lead.observedAt).toBe(at);
	expect(lead.source).toBe("Long-Range Scanner sweep");
	expect(lead.region).toContain(
		system.bodies.find((b) => b.id === pose.bodyId)!.name,
	);
	expect(lead.region).not.toContain(pose.bodyId);
	expect(lead).not.toHaveProperty("pos");
	expect(swept.galaxies[0].knowledge[key]).toBeUndefined();
	expect(identifyDerelicts(swept, system, far, modules, at).world).toBe(swept);
});
test("no module outside 10 km reads nothing; visual identification writes actual instance", () => {
	const outside = add(pose.pos, v3(10.01, 0, 0));
	expect(
		derelictReadings(world, system, outside, [], at).find((w) => w.key === key)
			?.signal,
	).toBeNull();
	expect(identifyDerelicts(world, system, outside, [], at).world).toBe(world);
	const found = identifyDerelicts(
		world,
		system,
		add(pose.pos, v3(9.99, 0, 0)),
		[],
		at,
	);
	expect(found.identified).toEqual([key]);
	expect(found.world.galaxies[0].knowledge[key]).toMatchObject({
		observedCondition: "destroyed",
		observedInstanceOrdinal: row.instanceOrdinal,
		observedAt: at,
		source: "visual identification",
	});
	expect(
		derelictReadings(found.world, system, far, [], at).find(
			(w) => w.key === key,
		)?.identified,
	).toBe(true);
	expect(
		identifyDerelicts(found.world, system, pose.pos, [], at).identified,
	).toEqual([]);
});
test("fitted scanner gives a passive signal then identification on relay approach ranges", () => {
	const approach = add(pose.pos, v3(500, 0, 0));
	const reading = derelictReadings(world, system, approach, modules, at).find(
		(w) => w.key === key,
	)!;
	expect(reading.signal?.strength).toBeGreaterThan(0);
	expect(reading.identified).toBe(false);
	expect(identifyDerelicts(world, system, approach, modules, at).world).toBe(
		world,
	);
	expect(
		identifyDerelicts(world, system, add(pose.pos, v3(100, 0, 0)), modules, at)
			.identified,
	).toContain(key);
});
test("stripped and taken wrecks leave the stale lead intact; sweeping replaces only this system", () => {
	const otherIndex = (system.record.index + 1) % 256;
	const other = carrierKey(otherIndex, "derelict-00");
	const foreign = {
		kind: "derelict" as const,
		region: "Another region",
		source: "Long-Range Scanner sweep",
		observedAt: at - 1,
	};
	const withOther = replaceSystemLeads(world, 0, otherIndex, at, {
		[other]: foreign,
	});
	const swept = sweepSystem(withOther, system, modules, at);
	let stripped = swept;
	row.containers.forEach((c, i) => {
		stripped = scoopDerelict(stripped, 0, key, i, c.left, at);
	});
	expect(effectiveDerelict(stripped, 0, key, at).condition).toBe("salvaged");
	expect(
		sweepSystem(stripped, system, modules, at).galaxies[0].leads![other],
	).toEqual(foreign);
	expect(identifyDerelicts(stripped, system, pose.pos, modules, at).world).toBe(
		stripped,
	);
	expect(stripped.galaxies[0].leads![key]).toEqual(
		swept.galaxies[0].leads![key],
	);
	expect(
		sweepSystem(stripped, system, modules, at).galaxies[0].leads![key],
	).toBeUndefined();
	const takenAt = row.salvagerAt + 1;
	const taken = advanceTo(swept, takenAt);
	expect(
		identifyDerelicts(taken, system, pose.pos, modules, takenAt).world,
	).toBe(taken);
	expect(taken.galaxies[0].leads![key]).toEqual(swept.galaxies[0].leads![key]);
	expect(
		sweepSystem(taken, system, modules, takenAt).galaxies[0].leads![key],
	).toBeUndefined();
});

test("a later wreck in a known slot requires its own identification", () => {
	const found = identifyDerelicts(world, system, pose.pos, modules, at).world;
	let stripped = found;
	row.containers.forEach((c, i) => {
		stripped = scoopDerelict(stripped, 0, key, i, c.left, at);
	});
	const gone = effectiveDerelict(stripped, 0, key, at);
	if (gone.condition !== "salvaged") throw Error("not stripped");
	const nextAt = gone.nextLossAt + 1;
	const next = advanceTo(stripped, nextAt);
	const reading = derelictReadings(next, system, far, [], nextAt).find(
		(w) => w.key === key,
	)!;
	expect(reading.row.instanceOrdinal).toBe(row.instanceOrdinal + 1);
	expect(reading.identified).toBe(false);
	expect(
		identifyDerelicts(next, system, reading.pose.pos, [], nextAt).identified,
	).toContain(key);
});
test("leads and identification survive a save, first wreck kind banks once commander-wide", () => {
	const found = identifyDerelicts(
		sweepSystem(world, system, modules, at),
		system,
		pose.pos,
		modules,
		at,
	).world;
	const saved = parseSave(
		serializeSave({ world: found, commander: newCommanderRecord("courier") }),
	);
	expect(saved.world.galaxies[0].leads).toEqual(found.galaxies[0].leads);
	expect(saved.world.galaxies[0].knowledge[key]).toEqual(
		found.galaxies[0].knowledge[key],
	);
	expect(serializeWorld(parseWorld(serializeWorld(found)))).toEqual(
		serializeWorld(found),
	);
	const record = emptyLadderRecord();
	const first = pendingKind(record, emptyPending(), "wreck");
	expect(pendingKind(record, first, "wreck")).toBe(first);
	const station = carrierKey(system.record.index, "station-trade");
	const banked = bankOnDock(record, first, {
		galaxyIndex: 0,
		station,
		gameTime: at,
	});
	expect(banked.banked.exploration).toBe(2); // station plus one wreck kind
	const loaded = parseLadders(serializeLadders(banked));
	expect(pendingKind(loaded, emptyPending(), "wreck").kinds ?? []).toEqual([]);
	expect(
		bankOnDock(loaded, emptyPending(), {
			galaxyIndex: 0,
			station,
			gameTime: at + 1,
		}).banked.exploration,
	).toBe(2);
});

test("saved leads refuse exact positions, wrong slots and invalid observation clocks", () => {
	const saved = serializeWorld(sweepSystem(world, system, modules, at)) as any;
	for (const change of [
		(lead: any) => {
			lead.pos = pose.pos;
		},
		(lead: any) => {
			lead.kind = "relay";
		},
		(lead: any) => {
			lead.observedAt = -1;
		},
		(lead: any) => {
			lead.observedAt = at + 1;
		},
	]) {
		const copy = structuredClone(saved);
		change(copy.galaxies[0].leads[key]);
		delete copy.integrity;
		copy.integrity = fnv1a(JSON.stringify(copy));
		expect(() => parseWorld(copy)).toThrow("lead");
	}
	expect(
		parseLadders(serializeLadders(emptyLadderRecord())).kinds,
	).toBeUndefined();
	expect(
		(serializeWorld(newWorld(47)) as any).galaxies[0].leads,
	).toBeUndefined();
});

test("the live hold event adopts knowledge and pending credit together and a refusal changes neither", () => {
	const holdings = {
		commander: { ...newCommander("courier"), ownedEquipment: modules },
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const swept = applyHoldEvent(holdings, world, {
		kind: "system-sweep",
		system,
		at,
	});
	expect(swept.holdings).toBe(holdings);
	expect(swept.world.galaxies[0].leads![key]).toBeDefined();
	const refused = applyHoldEvent(holdings, swept.world, {
		kind: "derelict-identify",
		system,
		shipPos: far,
		at,
	});
	expect(refused.holdings).toBe(holdings);
	expect(refused.world).toBe(swept.world);
	const found = applyHoldEvent(holdings, swept.world, {
		kind: "derelict-identify",
		system,
		shipPos: pose.pos,
		at,
	});
	expect(found.world.galaxies[0].knowledge[key].source).toBe(
		"scanner identification",
	);
	expect(found.holdings.ladderPending.kinds).toEqual(["wreck"]);
	const again = applyHoldEvent(found.holdings, found.world, {
		kind: "derelict-identify",
		system,
		shipPos: pose.pos,
		at,
	});
	expect(again.holdings).toBe(found.holdings);
	expect(again.world).toBe(found.world);
});
