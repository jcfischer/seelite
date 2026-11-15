import { expect, test } from "bun:test";
import { carrierKey, type CarrierKey } from "../src/carrier-key";
import { money } from "../src/exact-amount";
import { systemAt } from "../src/galaxy";
import { exclusiveCapabilityKey, type RefineryQueue } from "../src/refinery";
import { fnv1a } from "../src/rng";
import { generateContents } from "../src/system";
import {
	advanceTo,
	capabilityAvailability,
	newWorld,
	operationalDuration,
	parseWorld,
	serializeWorld,
	withRefineryQueue,
} from "../src/world-state";

const seed = 47;
const stations = (type: "refinery" | "trade", except?: CarrierKey) => {
	for (let index = 0; index < 256; index++) {
		const station = generateContents(systemAt(seed, 0, index)).stations.find(
			(s) => s.type === type,
		);
		if (station) {
			const candidate = carrierKey(index, station.localCarrierId);
			if (candidate !== except) return candidate;
		}
	}
	throw new Error(`Missing ${type}`);
};
const key = stations("refinery");
const queue = (at = 0): RefineryQueue => ({
	accountedThrough: at,
	nextJobId: 2,
	jobs: [
		{
			id: 1,
			good: "Silicate ore STD",
			tonnes: 2000,
			product: "Minerals",
			outputGrams: 800000000,
			fee: money.encode(money.fromNumber(5)),
			basis: money.encode(money.fromNumber(8)),
			work: 2000,
			totalWork: 2000,
		},
	],
});
const seal = (raw: Record<string, any>) => {
	const { integrity: _, ...body } = raw;
	return { ...body, integrity: fnv1a(JSON.stringify(body)) };
};

test("queue writes preserve other stations, galaxies and world metadata", () => {
	const world = advanceTo(newWorld(seed), 100);
	const initial = withRefineryQueue(world, 0, key, queue(100));
	const second = carrierKey(255, "station-01");
	const next = withRefineryQueue(initial, 0, second, queue(100));
	expect(next.gameTime).toBe(100);
	expect(next.seed).toBe(seed);
	expect(next.galaxies[0].refineries[key]).toBe(
		initial.galaxies[0].refineries[key],
	);
	expect(next.galaxies[0].refineries[second]).toEqual(queue(100));
	expect(initial.galaxies[0].refineries[second]).toBeUndefined();
	for (let i = 1; i < 8; i++) expect(next.galaxies[i]).toBe(world.galaxies[i]);
	expect(() => withRefineryQueue(world, 8, key, queue())).toThrow();
	expect(() =>
		withRefineryQueue(world, 0, "bad" as CarrierKey, queue()),
	).toThrow();
});

test("advancing settles every station only once and preserves untouched galaxies", () => {
	const world = advanceTo(newWorld(seed), 100);
	const initial = withRefineryQueue(world, 0, key, queue(100));
	expect(advanceTo(initial, 100)).toEqual(initial);
	expect(advanceTo(initial, 100).galaxies[0].refineries[key]).toBe(
		initial.galaxies[0].refineries[key],
	);
	const next = advanceTo(initial, 2000);
	const elapsed = operationalDuration(
		next,
		0,
		exclusiveCapabilityKey(key),
		100,
		2000,
	);
	expect(elapsed).toBeGreaterThan(0);
	expect(next.galaxies[0].refineries[key].jobs[0].work).toBe(2000 - elapsed);
	expect(next.galaxies[0].refineries[key].accountedThrough).toBe(2000);
	expect(next.galaxies[0].visited).toEqual(initial.galaxies[0].visited);
	expect(next.seed).toBe(seed);
	expect(advanceTo(next, 2000)).toEqual(next);
	const second = stations("refinery", key);
	const mixed = withRefineryQueue(initial, 0, second, queue(3000));
	expect(advanceTo(mixed, 2000).galaxies[0].refineries[second]).toBe(
		mixed.galaxies[0].refineries[second],
	);
	const future = withRefineryQueue(initial, 0, key, queue(600));
	expect(advanceTo(future, 500).galaxies[0].refineries[key]).toBe(
		future.galaxies[0].refineries[key],
	);
	const empty = { ...queue(100), jobs: [] };
	const noJobs = advanceTo(withRefineryQueue(initial, 0, key, empty), 500);
	expect(noJobs.galaxies[0].refineries[key]).toEqual({
		...empty,
		accountedThrough: 500,
	});
	expect(noJobs.galaxies[0].refineries[key].jobs).toBe(empty.jobs);
});

test("queues and partial progress round-trip and legacy world 4 migrates empty", () => {
	const world = advanceTo(newWorld(seed), 100);
	const initial = withRefineryQueue(world, 0, key, queue(100));
	expect(parseWorld(serializeWorld(initial))).toEqual(initial);
	const raw = serializeWorld(world) as Record<string, any>;
	raw.worldSchemaVersion = 4;
	const loaded = parseWorld(seal(raw));
	expect(loaded.worldSchemaVersion).toBe(5);
	expect(loaded.galaxies.map((g) => g.refineries)).toEqual(
		Array.from({ length: 8 }, () => ({})),
	);
	raw.galaxies[0].refineries = {};
	expect(() => parseWorld(seal(raw))).toThrow(
		"legacy world contains refinery queues",
	);
});

test("saved refinery identity, genesis, clock and retained anchors are enforced", () => {
	const initial = withRefineryQueue(
		advanceTo(newWorld(seed), 100),
		0,
		key,
		queue(100),
	);
	const raw = () => serializeWorld(initial) as Record<string, any>;
	for (const invalid of [stations("trade"), carrierKey(0, "absent")]) {
		const save = raw();
		save.galaxies[0].refineries = { [invalid]: queue(100) };
		expect(() => parseWorld(seal(save))).toThrow(
			`refinery ${invalid} is not a generated refinery station`,
		);
	}
	const beyond = raw();
	beyond.galaxies[0].refineries[key].accountedThrough = 101;
	expect(() => parseWorld(seal(beyond))).toThrow(
		`refinery ${key} is settled beyond the clock`,
	);
	const beforeGenesis = raw();
	beforeGenesis.galaxies[0].capabilityTime.genesisAt = 100;
	beforeGenesis.galaxies[0].refineries[key].accountedThrough = 99;
	expect(() => parseWorld(seal(beforeGenesis))).toThrow(
		`refinery ${key} is settled before capability genesis`,
	);
	const stale = raw();
	const slot = exclusiveCapabilityKey(key);
	stale.galaxies[0].capabilityTime.anchors[slot] = capabilityAvailability(
		initial,
		0,
		slot,
		100,
	).state;
	stale.galaxies[0].refineries[key].accountedThrough = 0;
	expect(() => parseWorld(seal(stale))).toThrow(
		`refinery ${key} lost settled service before its retained anchor`,
	);
	const anchored = structuredClone(stale);
	anchored.galaxies[0].refineries[key].accountedThrough = 100;
	expect(parseWorld(seal(anchored)).galaxies[0].refineries[key]).toEqual(
		queue(100),
	);
	const noJobs = structuredClone(stale);
	noJobs.galaxies[0].refineries[key].jobs = [];
	noJobs.galaxies[0].refineries[key].accountedThrough = 0;
	expect(parseWorld(seal(noJobs)).galaxies[0].refineries[key].jobs).toEqual([]);
});
