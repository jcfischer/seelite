import { expect, test } from "bun:test";
import {
	fieldCentre,
	fieldId,
	FIELD_SLOT,
	systemFields,
} from "../src/asteroid-field";
import {
	canonicalFieldDiscoveries,
	discoverFieldsWithin,
	fieldIsKnown,
	parseFieldDiscoveries,
} from "../src/field-discovery";
import { generateGalaxy, SYSTEMS_PER_GALAXY } from "../src/galaxy";
import { generateContents, orbitNormal } from "../src/system";
import { add, scale, length, sub, v3 } from "../src/vec3";
import {
	newWorld,
	parseWorld,
	serializeWorld,
	discoverNearbyFields,
} from "../src/world-state";
import { fieldContactsAt } from "../src/field-contact";
import { makeWorldAtSystem } from "../src/sim";
import { parseSweepReadings, sweepSources } from "../src/system-sweep";
import {
	newCommanderRecord,
	parseSave,
	serializeSave,
	SAVE_SCHEMA_VERSION,
} from "../src/save-envelope";
import { fnv1a } from "../src/rng";
import { readFileSync } from "node:fs";
import {
	SaveStore,
	CommanderCatalog,
	memorySaveBackend,
	memorySlotLocks,
} from "../src/save-store";

const seed = 47;
const legacyBytes = () =>
	readFileSync(
		new URL(
			"./fixtures/discovery-legacy-save18-c8a9f3c0.json",
			import.meta.url,
		),
		"utf8",
	);
const reseal = (raw: any) => {
	const { integrity: wi, ...wb } = raw.world;
	raw.world.integrity = fnv1a(JSON.stringify(wb));
	const { integrity: si, ...sb } = raw;
	raw.integrity = fnv1a(JSON.stringify(sb));
	return raw;
};
const galaxyIndex = 0;
const galaxy = generateGalaxy(seed, galaxyIndex);
const rareSystems = galaxy.systems.flatMap((record) => {
	const contents = generateContents(record);
	const plan = systemFields(record, contents).find((p) => p.profile === "rare");
	return plan ? [{ record, contents, plan }] : [];
});
const [first, second] = rareSystems;
const firstKey =
	`${first.record.index}:${first.plan.id}` as `${number}:field-${string}`;
const secondKey =
	`${second.record.index}:${second.plan.id}` as `${number}:field-${string}`;

test("production discovery uses exactly 1000 km without a scanner and persists by galaxy", () => {
	const world = newWorld(seed);
	const centre = fieldCentre(first.plan, 0);
	const args = { record: first.record, contents: first.contents, gameTime: 0 };
	expect(
		discoverNearbyFields(world, {
			...args,
			shipPos: add(centre, v3(1000.01, 0, 0)),
		}),
	).toBe(world);
	const discovered = discoverNearbyFields(world, {
		...args,
		shipPos: add(centre, v3(0, 0, 1000)),
	});
	expect(discovered.galaxies[0].fieldDiscoveries).toEqual([firstKey]);
	expect(discovered.galaxies[1].fieldDiscoveries).toEqual([]);
	expect(discoverNearbyFields(discovered, { ...args, shipPos: centre })).toBe(
		discovered,
	);
	const restored = parseWorld(serializeWorld(discovered));
	expect(restored.galaxies[0].fieldDiscoveries).toEqual([firstKey]);
	expect(restored.galaxies[0].deposits).toEqual(world.galaxies[0].deposits);
});

test("unknown rare contacts are hidden while charted contacts and physical plans remain", () => {
	const sim = makeWorldAtSystem(seed, first.record.index);
	expect(
		fieldContactsAt(sim.system, 0, []).some((c) => c.id === first.plan.id),
	).toBe(false);
	expect(systemFields(sim.system.record, sim.system.contents)).toContainEqual(
		first.plan,
	);
	expect(
		fieldContactsAt(sim.system, 0, [firstKey]).some(
			(c) => c.id === first.plan.id,
		),
	).toBe(true);
	const charted = galaxy.systems.find((r) =>
		systemFields(r, generateContents(r)).some((p) => p.profile === "charted"),
	)!;
	expect(
		fieldContactsAt(makeWorldAtSystem(seed, charted.index).system, 0, []).some(
			(c) => c.id === "field-00",
		),
	).toBe(true);
});

test("a fast flight frame discovers across the radius and rejects a near miss", () => {
	const world = newWorld(seed);
	const centre = fieldCentre(first.plan, 0);
	const context = {
		record: first.record,
		contents: first.contents,
		gameTime: 0,
	};
	const crossed = discoverNearbyFields(world, {
		...context,
		previous: { shipPos: add(centre, v3(-2000, 0, 0)), gameTime: 0 },
		shipPos: add(centre, v3(2000, 0, 0)),
	});
	expect(crossed.galaxies[0].fieldDiscoveries).toEqual([firstKey]);
	const missed = discoverNearbyFields(world, {
		...context,
		previous: { shipPos: add(centre, v3(-2000, 1001, 0)), gameTime: 0 },
		shipPos: add(centre, v3(2000, 1001, 0)),
	});
	expect(missed).toBe(world);
});

test("a swept crossing evaluates both field centres at their own clocks", () => {
	const startAt = 100;
	const endAt = startAt + first.plan.orbit.periodS / 4;
	const startCentre = fieldCentre(first.plan, startAt);
	const endCentre = fieldCentre(first.plan, endAt);
	expect(length(sub(endCentre, startCentre))).toBeGreaterThan(100000);
	const normal = orbitNormal(first.plan.orbit);
	const result = discoverNearbyFields(newWorld(seed), {
		record: first.record,
		contents: first.contents,
		previous: {
			shipPos: add(startCentre, scale(normal, -2000)),
			gameTime: startAt,
		},
		shipPos: add(endCentre, scale(normal, 2000)),
		gameTime: endAt,
	});
	expect(result.galaxies[0].fieldDiscoveries).toEqual([firstKey]);
});

test("stationary previous motion discovers inside the radius and stays unknown outside", () => {
	const world = newWorld(seed);
	const centre = fieldCentre(first.plan, 0);
	const inside = add(centre, v3(0, 0, 900));
	const outside = add(centre, v3(0, 0, 1001));
	const context = {
		record: first.record,
		contents: first.contents,
		gameTime: 0,
	};
	expect(
		discoverNearbyFields(world, {
			...context,
			shipPos: inside,
			previous: { shipPos: inside, gameTime: 0 },
		}).galaxies[0].fieldDiscoveries,
	).toEqual([firstKey]);
	expect(
		discoverNearbyFields(world, {
			...context,
			shipPos: outside,
			previous: { shipPos: outside, gameTime: 0 },
		}),
	).toBe(world);
});

test("invalid previous motion refuses instead of manufacturing a discovery", () => {
	for (const previous of [
		{ shipPos: v3(NaN, 0, 0), gameTime: 0 },
		{ shipPos: v3(0, Infinity, 0), gameTime: 0 },
		{ shipPos: v3(), gameTime: NaN },
		{ shipPos: v3(), gameTime: Infinity },
		{ shipPos: v3(), gameTime: -1 },
		{ shipPos: v3(), gameTime: 11 },
	])
		expect(() =>
			discoverNearbyFields(newWorld(seed), {
				record: first.record,
				contents: first.contents,
				previous,
				shipPos: fieldCentre(first.plan, 10),
				gameTime: 10,
			}),
		).toThrow();
});

test("field sweep provenance is regional, aged independently, and cannot identify or discover", () => {
	const world = newWorld(seed);
	const rows = sweepSources(world, 0, first.record.index);
	const row = rows.find((r) => r.kind === "field")!;
	expect(row).toBeDefined();
	expect(row.region).toEqual({ kind: "system-space" });
	expect(row.observedAt).toBe(0);
	expect(world.galaxies[0].fieldDiscoveries).toEqual([]);
	expect(
		parseSweepReadings(rows, { ...world, gameTime: 7200 }, SAVE_SCHEMA_VERSION),
	).toEqual(rows);
	expect(() => parseSweepReadings([row], world, 18)).toThrow();
	expect(() =>
		parseSweepReadings(
			[
				{
					...row,
					region: {
						kind: "station-surrounds",
						stationId: first.contents.stations[0].id,
					},
				},
			],
			world,
			SAVE_SCHEMA_VERSION,
		),
	).toThrow();
	expect(() =>
		parseSweepReadings([{ ...row, pos: v3() }], world, SAVE_SCHEMA_VERSION),
	).toThrow();
});

test("historical discovery and source survive a generator no longer populating the stable rare slot", () => {
	const absent = galaxy.systems.find(
		(r) =>
			!systemFields(r, generateContents(r)).some((p) => p.profile === "rare"),
	)!;
	const world = { ...newWorld(seed), gameTime: 7200 };
	world.galaxies[0].fieldDiscoveries = [`${absent.index}:field-01`];
	const row = {
		id: `sweep:0:${absent.index}:field-01`,
		kind: "field" as const,
		galaxyIndex: 0,
		systemIndex: absent.index,
		source: "own-sensors" as const,
		observedAt: 0,
		region: { kind: "system-space" as const },
	};
	const commander = { ...newCommanderRecord("courier"), sweepReadings: [row] };
	const loaded = parseSave(
		JSON.parse(JSON.stringify(serializeSave({ world, commander }))),
	);
	expect(loaded.world.galaxies[0].fieldDiscoveries).toEqual([
		`${absent.index}:field-01`,
	]);
	expect(loaded.commander.sweepReadings).toEqual([row]);
	expect(
		sweepSources(loaded.world, 0, absent.index).some((r) => r.kind === "field"),
	).toBe(false);
	expect(() =>
		parseSweepReadings(
			[{ ...row, id: `sweep:0:${absent.index}:field-00` }],
			world,
			SAVE_SCHEMA_VERSION,
		),
	).toThrow();
});

test("save20 round trips discoveries; authentic save18 begins unknown and refuses assembled discoveries", () => {
	const world = discoverNearbyFields(newWorld(seed), {
		record: first.record,
		contents: first.contents,
		shipPos: fieldCentre(first.plan, 0),
		gameTime: 0,
	});
	const saved = serializeSave({
		world,
		commander: newCommanderRecord("courier"),
	});
	expect(parseSave(saved).world.galaxies[0].fieldDiscoveries).toEqual([
		firstKey,
	]);
	const raw = serializeSave({
		world: newWorld(seed),
		commander: newCommanderRecord("courier"),
	}) as any;
	raw.saveSchemaVersion = 18;
	delete raw.commander.state.accounting;
	reseal(raw);
	expect(
		parseSave(raw).world.galaxies.every((g) => g.fieldDiscoveries.length === 0),
	).toBe(true);
	raw.world = serializeWorld(world);
	reseal(raw);
	expect(() => parseSave(raw)).toThrow(
		"legacy world contains field discoveries",
	);
	const malformed = structuredClone(saved) as any;
	malformed.world.galaxies[0].fieldDiscoveries.push("bad");
	reseal(malformed);
	expect(() => parseSave(malformed)).toThrow("field discovery");
});

test("immutable main c8a9f3c0 save18 migrates unknown without changing its source", () => {
	const bytes = legacyBytes();
	expect(fnv1a(bytes)).toBe(2883759867);
	const raw = JSON.parse(bytes);
	expect(raw.saveSchemaVersion).toBe(18);
	const loaded = parseSave(raw);
	expect(
		loaded.world.galaxies.every((g) => g.fieldDiscoveries.length === 0),
	).toBe(true);
	expect(raw.world.galaxies[0].visited).toContain(4);
	expect(loaded.world.galaxies[0].visited).toContain(4);
	expect(JSON.stringify(raw)).toBe(JSON.stringify(JSON.parse(bytes)));
});

test("refused discovery bytes remain readable through real store export", async () => {
	const backend = memorySaveBackend();
	const locks = memorySlotLocks();
	const raw = JSON.parse(legacyBytes());
	raw.world.galaxies[0].fieldDiscoveries = [firstKey];
	reseal(raw);
	const bytes = JSON.stringify(raw);
	await backend.write("discovery", "live", raw);
	const store = new SaveStore({
		backend,
		locks,
		schedule: () => () => {},
		current: () => ({
			world: newWorld(seed),
			commander: newCommanderRecord("courier"),
		}),
		slot: "discovery",
	});
	await expect(store.load("discovery")).rejects.toThrow(
		"legacy world contains field discoveries",
	);
	expect(JSON.stringify(await backend.read("discovery", "live"))).toBe(bytes);
	const exported = JSON.parse(
		await new CommanderCatalog({ backend, locks }).exportSlot("discovery"),
	);
	expect(JSON.stringify(exported.live)).toBe(bytes);
});

test("old saves and empty discovery state write no new bytes", () => {
	expect(parseFieldDiscoveries(undefined)).toEqual([]);
	expect(canonicalFieldDiscoveries([])).toBeUndefined();
});

test("only charted or explicitly discovered fields are known in their system", () => {
	expect(fieldIsKnown([], first.record.index, first.plan)).toBe(false);
	const state = parseFieldDiscoveries([firstKey]);
	expect(fieldIsKnown(state, first.record.index, first.plan)).toBe(true);
	expect(fieldIsKnown(state, second.record.index, second.plan)).toBe(false);
	const charted = galaxy.systems.flatMap((r) =>
		systemFields(r, generateContents(r)).filter((p) => p.profile === "charted"),
	)[0];
	expect(charted).toBeDefined();
	expect(fieldIsKnown([], first.record.index, charted)).toBe(true);
});

test("caller-supplied radius discovers at the boundary and never before it", () => {
	const radiusKm = 7;
	const time = 12345;
	const centre = fieldCentre(first.plan, time);
	const far = add(centre, v3(radiusKm + 1, 0, 0));
	const boundary = add(centre, v3(0, 0, radiusKm));
	expect(
		discoverFieldsWithin([], {
			record: first.record,
			contents: first.contents,
			shipPos: far,
			gameTime: time,
			radiusKm: radiusKm,
		}),
	).toEqual([]);
	const discovered = discoverFieldsWithin([], {
		record: first.record,
		contents: first.contents,
		shipPos: boundary,
		gameTime: time,
		radiusKm: radiusKm,
	});
	expect(discovered).toEqual([firstKey]);
	expect(
		discoverFieldsWithin(discovered, {
			record: first.record,
			contents: first.contents,
			shipPos: centre,
			gameTime: time,
			radiusKm: radiusKm,
		}),
	).toEqual(discovered);
	expect(
		discoverFieldsWithin(discovered, {
			record: first.record,
			contents: first.contents,
			shipPos: far,
			gameTime: time,
			radiusKm: radiusKm,
		}),
	).toEqual(discovered);
	expect(
		discoverFieldsWithin([], {
			record: first.record,
			contents: first.contents,
			shipPos: boundary,
			gameTime: time,
			radiusKm: radiusKm - 1,
		}),
	).toEqual([]);
});

test("a fresh game can discover a rare field at time zero", () => {
	expect(
		discoverFieldsWithin([], {
			record: first.record,
			contents: first.contents,
			shipPos: fieldCentre(first.plan, 0),
			gameTime: 0,
			radiusKm: 7,
		}),
	).toEqual([firstKey]);
});

test("discovery round trips canonically without generator pins or deposit state", () => {
	const state = parseFieldDiscoveries([secondKey, firstKey]);
	expect(canonicalFieldDiscoveries(state)).toEqual([firstKey, secondKey]);
	expect(
		parseFieldDiscoveries(
			JSON.parse(JSON.stringify(canonicalFieldDiscoveries(state))),
		),
	).toEqual(state);
	expect(canonicalFieldDiscoveries([...state].reverse())).toEqual(
		canonicalFieldDiscoveries(state),
	);
});

test("saved discoveries reject malformed, duplicate, charted and unknown identities atomically", () => {
	for (const raw of [
		null,
		{},
		"",
		"field-01",
		[[firstKey]],
		[firstKey, firstKey],
		[firstKey, null],
		[`${first.record.index}:${fieldId(FIELD_SLOT.charted)}`],
		[`${SYSTEMS_PER_GALAXY}:${first.plan.id}`],
		[`-1:${first.plan.id}`],
		[`0${first.record.index}:${first.plan.id}`],
		[firstKey, `${second.record.index}:field-02`],
		Array(SYSTEMS_PER_GALAXY + 1).fill(firstKey),
	]) {
		expect(() => parseFieldDiscoveries(raw)).toThrow();
	}
});

test("a valid field identity cannot carry a trailing suffix", () => {
	for (const suffix of ["-junk", ":extra"])
		expect(() =>
			parseFieldDiscoveries([firstKey, `${secondKey}${suffix}`]),
		).toThrow();
});

test("stable discovery identities survive field occurrence and geometry migrations", () => {
	const absent = galaxy.systems.find(
		(r) => !rareSystems.some((s) => s.record.index === r.index),
	)!;
	expect(absent).toBeDefined();
	const key =
		`${absent.index}:${fieldId(FIELD_SLOT.rare)}` as `${number}:field-${string}`;
	const state = parseFieldDiscoveries([key]);
	expect(canonicalFieldDiscoveries(state)).toEqual([key]);
	expect(
		fieldIsKnown(state, absent.index, {
			...first.plan,
			offPlaneKm: first.plan.offPlaneKm + 1000,
		}),
	).toBe(true);
	expect(fieldIsKnown([], absent.index, first.plan)).toBe(false);
});

test("the whole stable-slot set is bounded by the generated system count", () => {
	const raw = Array.from(
		{ length: SYSTEMS_PER_GALAXY },
		(_, i) => `${i}:${fieldId(FIELD_SLOT.rare)}` as `${number}:field-${string}`,
	);
	const state = parseFieldDiscoveries(raw);
	expect(canonicalFieldDiscoveries(state)).toEqual(raw);
	const maxKeyLength =
		String(SYSTEMS_PER_GALAXY - 1).length + 1 + fieldId(FIELD_SLOT.rare).length;
	expect(
		JSON.stringify(canonicalFieldDiscoveries(state)).length,
	).toBeLessThanOrEqual(SYSTEMS_PER_GALAXY * (maxKeyLength + 3) + 1);
});

test("discovery refuses invalid geometry and radius instead of granting knowledge", () => {
	for (const radius of [NaN, Infinity, -1, 0])
		expect(() =>
			discoverFieldsWithin([], {
				record: first.record,
				contents: first.contents,
				shipPos: v3(),
				gameTime: 0,
				radiusKm: radius,
			}),
		).toThrow();
	for (const pos of [v3(NaN, 0, 0), v3(0, Infinity, 0)])
		expect(() =>
			discoverFieldsWithin([], {
				record: first.record,
				contents: first.contents,
				shipPos: pos,
				gameTime: 0,
				radiusKm: 7,
			}),
		).toThrow();
	for (const time of [NaN, Infinity, -1])
		expect(() =>
			discoverFieldsWithin([], {
				record: first.record,
				contents: first.contents,
				shipPos: v3(),
				gameTime: time,
				radiusKm: 7,
			}),
		).toThrow();
});
