import {
	migrateEquipment,
	equipmentNames,
	stockLoadout,
	moduleRow,
} from "../src/loadout";
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
	parseWorld,
	serializeWorld,
} from "../src/world-state";
import { identifyDerelicts, derelictReadings } from "../src/long-range-scanner";
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

import {
	sweepSources,
	replaceSystemReadings,
	type SweepReading,
} from "../src/system-sweep";
import { wreckContact } from "../src/long-range-scanner";
import { HULL_SPECS } from "../src/hull";
import { gameMethods } from "./lib/game-methods";

const system = makeWorld(47).system;
const key = derelictSlots(system.record.index, system.record.government)[0].key;
const at = derelictFirstLossAt(system.record.seed, key) + 1;
const world = advanceTo(newWorld(47), at);
const row = effectiveDerelict(world, 0, key, at);
if (row.condition !== "destroyed") throw Error("fixture has no wreck");
const pose = derelictPose(system, key, row.instanceOrdinal, at);
const far = add(pose.pos, v3(3000, 0, 0));
const modules = [LONG_RANGE_SCANNER];

test("the canonical sweep writes dated region provenance without identifying a wreck", () => {
	const readings = sweepSources(world, 0, system.record.index);
	const lead = readings.find((r) => r.id.endsWith(":" + key.split(":")[1]))!;
	expect(lead).toMatchObject({
		kind: "wreck",
		source: "own-sensors",
		observedAt: at,
		region: { kind: "system-space" },
	});
	expect(lead).not.toHaveProperty("pos");
	expect(world.galaxies[0].knowledge[key]).toBeUndefined();
	expect(identifyDerelicts(world, system, far, modules, at).world).toBe(world);
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
test("stripped and taken wrecks retain dated commander provenance until a new sweep", () => {
	const otherIndex = (system.record.index + 1) % 256;
	const foreign: SweepReading = {
		id: "sweep:0:" + otherIndex + ":derelict-00",
		galaxyIndex: 0,
		systemIndex: otherIndex,
		kind: "wreck",
		region: { kind: "system-space" },
		source: "own-sensors",
		observedAt: at - 1,
	};
	const readings = replaceSystemReadings(
		[foreign],
		sweepSources(world, 0, system.record.index),
		0,
		system.record.index,
	);
	const commander = {
		...newCommanderRecord("courier"),
		sweepReadings: readings,
	};
	const lead = readings.find(
		(r) =>
			r.systemIndex === system.record.index && r.id.endsWith(":derelict-00"),
	)!;
	expect(lead).toBeDefined();
	let stripped = world;
	row.containers.forEach((c, i) => {
		stripped = scoopDerelict(stripped, 0, key, i, c.left, at);
	});
	const taken = advanceTo(world, row.salvagerAt + 1);
	for (const gone of [stripped, taken]) {
		const arrived = identifyDerelicts(
			gone,
			system,
			pose.pos,
			modules,
			gone.gameTime,
		);
		expect(arrived.world).toBe(gone);
		expect(arrived.identified).toEqual([]);
		expect(commander.sweepReadings).toBe(readings);
		const saved = parseSave(serializeSave({ world: gone, commander }));
		expect(saved.commander.sweepReadings).toContainEqual(lead);
		const refreshed = replaceSystemReadings(
			readings,
			sweepSources(gone, 0, system.record.index),
			0,
			system.record.index,
		);
		expect(refreshed).toContainEqual(foreign);
		expect(refreshed.find((r) => r.id === lead.id)).toBeUndefined();
	}
});

// glossary-ignore: slot
test("a later wreck in a known carrier slot requires its own identification", () => {
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
	const found = identifyDerelicts(world, system, pose.pos, modules, at).world;
	const saved = parseSave(
		serializeSave({
			world: found,
			commander: {
				...newCommanderRecord("courier"),
				sweepReadings: sweepSources(world, 0, system.record.index),
			},
		}),
	);
	expect(saved.commander.sweepReadings).toEqual(
		sweepSources(world, 0, system.record.index),
	);
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

test("sweep ledger is saved only on the commander, and world parser refuses a second owner", () => {
	const commander = {
		...newCommanderRecord("courier"),
		sweepReadings: sweepSources(world, 0, system.record.index),
	};
	const wire = serializeSave({ world, commander }) as any;
	expect(wire.commander.sweepReadings.length).toBeGreaterThan(0);
	expect(wire.world.galaxies[0]).not.toHaveProperty("sweepReadings");
	const malformed = serializeWorld(world) as any;
	malformed.galaxies[0].sweepReadings = {};
	delete malformed.integrity;
	malformed.integrity = fnv1a(JSON.stringify(malformed));
	expect(() => parseWorld(malformed)).toThrow("sweepReadings");
});

test("the live hold event adopts knowledge and pending credit together and a refusal changes neither", () => {
	const holdings = {
		commander: {
			...newCommander("courier"),
			loadout: migrateEquipment("courier", modules).loadout,
		},
		requests: emptyRequests(),
		ladders: emptyLadderRecord(),
		ladderPending: emptyPending(),
	};
	const refused = applyHoldEvent(holdings, world, {
		kind: "derelict-identify",
		system,
		shipPos: far,
		at,
	});
	expect(refused.holdings).toBe(holdings);
	expect(refused.world).toBe(world);
	const found = applyHoldEvent(holdings, world, {
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

test("wreck contact builder exposes only identified readings and copies authoritative motion", () => {
	const unknown = derelictReadings(world, system, far, [], at).find(
		(w) => w.key === key,
	)!;
	expect(wreckContact(unknown)).toBeNull();
	const found = identifyDerelicts(world, system, pose.pos, [], at).world;
	const reading = derelictReadings(found, system, far, [], at).find(
		(w) => w.key === key,
	)!;
	const contact = wreckContact(reading)!;
	expect(contact).toMatchObject({
		id: key,
		kind: "wreck",
		condition: "destroyed",
		shipType: pose.hull,
		standing: null,
		scannerClass: "unknown",
		pos: pose.pos,
		velocity: pose.vel,
	});
	const env = HULL_SPECS[pose.hull].env;
	expect(contact.radiusKm).toBe(
		Math.hypot(env.beamKm, env.heightKm, env.lengthKm) / 2,
	);
	expect(contact.pos).not.toBe(reading.pose.pos);
	expect(contact.velocity).not.toBe(reading.pose.vel);
});

// Run the production sync without constructing WebGL; the registered object
// must stay stable while every builder-owned field follows the current reading.
test("registered wreck contact follows a changed hull and motion without re-registration", () => {
	const known = identifyDerelicts(world, system, pose.pos, [], at).world;
	let reading = derelictReadings(known, system, pose.pos, [], at).find(
		(w) => w.key === key,
	)!;
	const registered: unknown[] = [];
	const subject = Object.assign(
		Object.create(gameMethods(["syncWreckContacts"], { wreckContact })),
		{
			wreckContacts: new Map(),
			wreckReadings: () => [reading],
			registerContact: (c: unknown) => registered.push(c),
			selectableCache: {},
		},
	);
	subject.syncWreckContacts();
	const original = subject.wreckContacts.get(key);
	const hull = pose.hull === "courier" ? "tug" : "courier";
	reading = {
		...reading,
		pose: {
			...reading.pose,
			hull,
			pos: add(reading.pose.pos, v3(2, 3, 4)),
			vel: v3(7, 8, 9),
		},
	};
	subject.syncWreckContacts();
	expect(subject.wreckContacts.get(key)).toBe(original);
	expect(registered).toEqual([original]);
	expect(original).toEqual(wreckContact(reading));
});
