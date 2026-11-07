import { expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { generateGalaxy } from "../src/galaxy";
import { generateContents } from "../src/system";
import { capabilitySlots, capabilityIdentity } from "../src/capability-slots";
import {
	advanceTo,
	applyTransition,
	capabilityAvailability,
	operationalDuration,
	repairCapability,
	parseWorld,
	serializeWorld,
	newWorld,
	compactWorld,
	enumerateCarriers,
} from "../src/world-state";
import { raiderSlots } from "../src/raider-slots";

const seed = 47;
const record = generateGalaxy(seed, 0).systems.find(
	(r) => raiderSlots(r.index, r.government).length >= 2,
)!;
const station = generateContents(record).stations.find(
	(s) => s.type === "trade",
)!;
const slots = capabilitySlots(record.index, station);
const key = slots[0].key;
const cause = {
	causeKind: "player-weapons" as const,
	actorId: "player",
	playerRole: "direct" as const,
};

test("fixed service slots have generated identity and independent stable seeds", () => {
	expect(slots.map((s) => s.service)).toEqual(["market", "equipment"]);
	for (const s of slots)
		expect(capabilityIdentity(seed, 0, s.key).stationKey).toBe(
			carrierKey(record.index, station.localCarrierId),
		);
	const all = [...enumerateCarriers(seed, 0)];
	for (const s of slots)
		expect(all.find((c) => c.key === s.key)?.kind).toBe("capability");
	expect(capabilityIdentity(seed, 0, slots[0].key).seed).not.toBe(
		capabilityIdentity(seed, 0, slots[1].key).seed,
	);
	expect(() =>
		capabilityIdentity(
			seed,
			0,
			carrierKey(record.index, "station-outpost/capability/market"),
		),
	).toThrow();
});

test("capability identity accepts supported namespace endpoints and refuses invalid namespaces", () => {
	for (const worldSeed of [0, 0xffffffff])
		for (const galaxyIndex of [0, 7]) {
			const system = generateGalaxy(worldSeed, galaxyIndex).systems[255];
			const parent = generateContents(system).stations.find(
				(s) => s.type !== "outpost",
			)!;
			expect(parent).toBeDefined();
			const slot = capabilitySlots(system.index, parent)[0];
			expect(capabilityIdentity(worldSeed, galaxyIndex, slot.key).key).toBe(
				slot.key,
			);
		}
	for (const worldSeed of [-1, 1.5, NaN, Infinity, 0x100000000])
		expect(() => capabilityIdentity(worldSeed, 0, key)).toThrow();
	for (const galaxyIndex of [-1, 1.5, NaN, Infinity, 8])
		expect(() => capabilityIdentity(seed, galaxyIndex, key)).toThrow();
	for (const systemIndex of [-1, 1.5, NaN, Infinity, 256])
		expect(() => capabilitySlots(systemIndex, station)).toThrow();
});

test("real remote raider recovery boundaries settle FIFO work before replacement", () => {
	let w = newWorld(seed);
	const raiders = raiderSlots(record.index, record.government);
	for (const [i, r] of raiders.slice(0, 2).entries()) {
		w = applyTransition(w, 0, r.key, {
			kind: "destroy",
			occurredAt: 0,
			cause,
			schedule: {
				startsAt: 100 + i * 100,
				completesAt: 1000 + i * 500,
				consequenceArea: `system:${record.index}`,
				cause,
			},
		});
	}
	const baseline = w;
	const run = (partition: boolean) => {
		let jobs = [10000, 10000],
			cursor = 0;
		const seen: number[] = [];
		const settle = (world: typeof w, to: number) => {
			let seconds = operationalDuration(world, 0, key, cursor, to);
			for (let i = 0; i < jobs.length; i++) {
				const take = Math.min(seconds, jobs[i]);
				jobs[i] -= take;
				seconds -= take;
			}
			cursor = to;
			seen.push(to);
			return world;
		};
		let current = baseline;
		for (const t of partition ? [500, 1100, 1600, 2000] : [2000])
			current = advanceTo(current, t, settle);
		return { current, jobs, seen };
	};
	const a = run(false),
		b = run(true);
	expect(a.seen).toContain(1000);
	expect(a.seen).toContain(1500);
	expect(a.jobs[0]).toBeCloseTo(b.jobs[0], 8);
	expect(a.jobs[1]).toBeCloseTo(b.jobs[1], 8);
	expect(parseWorld(serializeWorld(a.current))).toEqual(a.current);
	expect(() => operationalDuration(a.current, 0, key, 0, 2000)).toThrow();
	expect(Object.keys(a.current.galaxies[0].capabilityTime.anchors).length).toBe(
		slots.length +
			generateContents(record).stations.filter(
				(s) => s.type !== "trade" && s.type !== "outpost",
			).length *
				3,
	);
});

test("repair suppression survives pressure mutation, compaction and reload", () => {
	let w = newWorld(seed);
	let at = 0;
	while (capabilityAvailability(w, 0, key, at).operational) at += 100;
	w = advanceTo(w, at);
	const before = capabilityAvailability(w, 0, key, at);
	w = repairCapability(w, 0, key, at, cause);
	expect(capabilityAvailability(w, 0, key, at).operational).toBe(true);
	const raider = raiderSlots(record.index, record.government)[0];
	w = applyTransition(w, 0, raider.key, {
		kind: "disable",
		occurredAt: at + 1,
		cause,
	});
	w = compactWorld(w, at + 2);
	w = parseWorld(serializeWorld(w));
	expect(capabilityAvailability(w, 0, key, at + 2).operational).toBe(true);
	expect(capabilityAvailability(w, 0, key, at + 2).naturalEnd).toBeCloseTo(
		before.naturalEnd!,
		8,
	);
});

test("knowledge and public condition reads use natural capability timing after repairs expire", async () => {
	const { observe, effectiveCarrier } = await import("../src/world-state");
	let w = newWorld(seed);
	const cap = [...enumerateCarriers(seed, 0)].find(
		(c) =>
			c.kind === "capability" &&
			!capabilityAvailability(w, 0, c.key, 0).operational,
	)!;
	expect(cap).toBeDefined();
	expect(() => effectiveCarrier(w.galaxies[0], cap.key, 0)).toThrow(
		"world context",
	);
	w = observe(w, 0, cap.key, 0, "test");
	expect(w.galaxies[0].knowledge[cap.key].observedCondition).toBe("disabled");
	expect(effectiveCarrier(w.galaxies[0], cap.key, 0, w).condition).toBe(
		"disabled",
	);
	w = repairCapability(w, 0, cap.key, 0, cause);
	expect(w.galaxies[0].episodes[cap.key].latest.cause).toEqual(cause);
	expect(w.galaxies[0].objective[cap.key].condition).toBe("operational");
	let later = capabilityAvailability(w, 0, cap.key, 0).naturalEnd! + 1;
	while (capabilityAvailability(w, 0, cap.key, later).operational) later += 100;
	w = observe(w, 0, cap.key, later, "test");
	expect(w.galaxies[0].knowledge[cap.key].observedCondition).toBe("disabled");
});

test("production boundaries discard idle work and a later submission receives only its own interval", () => {
	let w = newWorld(seed),
		cursor = 0,
		jobs: number[] = [];
	let discarded = 0;
	const settle = (world: typeof w, to: number) => {
		let seconds = operationalDuration(world, 0, key, cursor, to);
		for (let i = 0; i < jobs.length; i++) {
			const take = Math.min(jobs[i], seconds);
			jobs[i] -= take;
			seconds -= take;
		}
		discarded += seconds;
		cursor = to;
		return world;
	};
	w = advanceTo(w, 1000, settle);
	const idle = discarded;
	expect(idle).toBeGreaterThan(0);
	jobs.push(10000);
	w = advanceTo(w, 2000, settle);
	expect(10000 - jobs[0]).toBeCloseTo(
		operationalDuration(w, 0, key, 1000, 2000),
		8,
	);
	expect(discarded).toBe(idle);
	jobs = [1];
	w = advanceTo(w, 2500, settle);
	expect(jobs).toEqual([0]);
	expect(discarded).toBeGreaterThan(idle);
});

test("a dependent resumes through the real save envelope at the same FIFO result", async () => {
	const { serializeSave, parseSave, newCommanderRecord } = await import(
		"../src/save-envelope"
	);
	let w = newWorld(seed);
	const r = raiderSlots(record.index, record.government)[0];
	w = applyTransition(w, 0, r.key, {
		kind: "destroy",
		occurredAt: 0,
		cause,
		schedule: {
			startsAt: 100,
			completesAt: 1500,
			consequenceArea: `system:${record.index}`,
			cause,
		},
	});
	const run = (restore: boolean) => {
		let world = w,
			cursor = 0,
			jobs = [5000, 1000];
		const settle = (state: typeof w, to: number) => {
			let seconds = operationalDuration(state, 0, key, cursor, to);
			jobs = jobs.map((left) => {
				const used = Math.min(left, seconds);
				seconds -= used;
				return left - used;
			});
			cursor = to;
			return state;
		};
		world = advanceTo(world, 1000, settle);
		if (restore) {
			const raw = JSON.parse(
				JSON.stringify({
					save: serializeSave({
						world,
						commander: newCommanderRecord("courier"),
					}),
					dependent: { cursor, jobs },
				}),
			);
			world = parseSave(raw.save).world;
			({ cursor, jobs } = raw.dependent);
		}
		world = advanceTo(world, 2000, settle);
		return { jobs, cursor, world };
	};
	const a = run(false),
		b = run(true);
	expect(b.jobs[0]).toBeCloseTo(a.jobs[0], 8);
	expect(b.jobs[1]).toBeCloseTo(a.jobs[1], 8);
	expect(b.cursor).toBe(a.cursor);
	expect(b.world).toEqual(a.world);
});

test("restoring at natural completion cannot suppress the following cycle", () => {
	const w = newWorld(seed);
	const c = [...enumerateCarriers(seed, 0)].find(
		(c) =>
			c.kind === "capability" &&
			!capabilityAvailability(w, 0, c.key, 0).operational,
	)!;
	const end = capabilityAvailability(w, 0, c.key, 0).naturalEnd!;
	expect(() => repairCapability(w, 0, c.key, end, cause)).toThrow(
		"operational",
	);
	expect(capabilityAvailability(w, 0, c.key, end).state.repaired).toBe(false);
});

test("omitting an exclusive slot moves neither universal service identity nor seed", () => {
	const trade = capabilitySlots(record.index, { ...station, type: "trade" });
	const refinery = capabilitySlots(record.index, {
		...station,
		type: "refinery",
	});
	expect(refinery.slice(0, 2)).toEqual(trade);
	const before = trade.map((c) => capabilityIdentity(seed, 0, c.key).seed);
	for (const c of [...trade].reverse()) capabilityIdentity(seed, 0, c.key);
	expect(trade.map((c) => capabilityIdentity(seed, 0, c.key).seed)).toEqual(
		before,
	);
});

test("repeated remote pressure events replace a bounded anchor set", () => {
	let w = newWorld(seed);
	const r = raiderSlots(record.index, record.government)[0];
	let count = 0;
	for (let i = 0; i < 24; i++) {
		w = applyTransition(w, 0, r.key, {
			kind: i % 2 === 0 ? "disable" : "restore",
			occurredAt: i,
			cause,
		});
		const next = Object.keys(w.galaxies[0].capabilityTime.anchors).length;
		if (i === 0) count = next;
		expect(next).toBe(count);
	}
	const loaded = parseWorld(serializeWorld(w));
	expect(Object.keys(loaded.galaxies[0].capabilityTime.anchors)).toEqual(
		Object.keys(w.galaxies[0].capabilityTime.anchors).sort(),
	);
	expect(Object.keys(loaded.galaxies[0].capabilityTime).sort()).toEqual([
		"anchors",
		"genesisAt",
	]);
});

test("reported natural end is half-open after arbitrary projection and pressure reanchor", () => {
	const c = carrierKey(90, "station-refinery/capability/market");
	const at = 12184.266499999996;
	let w = advanceTo(newWorld(1), at);
	for (const reanchor of [false, true]) {
		if (reanchor) {
			const record = generateGalaxy(1, 0).systems[90];
			w = applyTransition(w, 0, raiderSlots(90, record.government)[0].key, {
				kind: "disable",
				occurredAt: at + 1,
				cause,
			});
		}
		const a = capabilityAvailability(w, 0, c);
		expect(a.operational).toBe(false);
		const end = a.naturalEnd!;
		expect(capabilityAvailability(w, 0, c, end - 1e-6).operational).toBe(false);
		expect(capabilityAvailability(w, 0, c, end).operational).toBe(true);
		expect(capabilityAvailability(w, 0, c, end + 1e-6).operational).toBe(true);
		const full = advanceTo(w, end + 1);
		const from = w.gameTime;
		const split =
			operationalDuration(full, 0, c, from, end) +
			operationalDuration(full, 0, c, end, end + 1);
		expect(split).toBeCloseTo(
			operationalDuration(full, 0, c, from, end + 1),
			9,
		);
		expect(operationalDuration(full, 0, c, end, end + 1)).toBeCloseTo(1, 9);
		expect(() => repairCapability(w, 0, c, end, cause)).toThrow();
	}
});

test("a captured natural end stays exact through fractional projections and reanchors", () => {
	const c = carrierKey(90, "station-refinery/capability/market");
	const at = 12184.266499999996;
	let w = advanceTo(newWorld(1), at);
	const end = capabilityAvailability(w, 0, c).naturalEnd!;
	const record = generateGalaxy(1, 0).systems[90];
	const raider = raiderSlots(90, record.government)[0];
	for (let i = 1; i <= 32; i++) {
		const next = at + i * 0.137;
		expect(capabilityAvailability(w, 0, c, next).naturalEnd).toBe(end);
		w = applyTransition(w, 0, raider.key, {
			kind: i % 2 ? "disable" : "restore",
			occurredAt: next,
			cause,
		});
		expect(capabilityAvailability(w, 0, c).naturalEnd).toBe(end);
		expect(capabilityAvailability(w, 0, c, end).operational).toBe(true);
	}
});
