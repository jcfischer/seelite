import { expect, test } from "bun:test";
import { carrierKey, type CarrierKey } from "../src/carrier-key";
import {
	accountOf,
	acquire,
	emptyAccount,
	withAccount,
} from "../src/commodity-pools";
import { mass, massFromNative, money } from "../src/exact-amount";
import {
	collectionRoomUnits,
	collectRefineryEnvelope,
} from "../src/refinery-pricing";
import { refineryRefusal, type RefineryQueue } from "../src/refinery";
import { newCommanderRecord } from "../src/save-envelope";
import { newWorld, withRefineryQueue } from "../src/world-state";

const key = carrierKey(3, "refinery/a");
const fixture = (food = 17.25) => {
	const base = newCommanderRecord("courier");
	const commander = {
		...base,
		dockedAt: key,
		state: withAccount(
			base.state,
			acquire(emptyAccount(100), "Food", food, money.fromNumber(10)),
		),
	};
	const queue: RefineryQueue = {
		accountedThrough: 0,
		nextJobId: 2,
		jobs: [
			{
				id: 1,
				good: "Metallic ore STD",
				tonnes: 8,
				product: "Alloys",
				outputGrams: 3200000,
				work: 0,
				totalWork: 8,
				basis: money.encode(money.fromNumber(32)),
				fee: money.encode(money.fromNumber(2)),
				unknownMass: mass.encode(mass.fromTicks(0n)),
			},
		],
	};
	return { commander, world: withRefineryQueue(newWorld(47), 0, key, queue) };
};

test("collection room floors free tonnes, clamps a full hold, and never limits kg or g", () => {
	expect(collectionRoomUnits(fixture().commander, "Alloys")).toBe(2);
	expect(collectionRoomUnits(fixture(21).commander, "Alloys")).toBe(0);
	for (const product of ["Gold", "Platinum", "Gem-Stones"])
		expect(collectionRoomUnits(fixture(21).commander, product)).toBe(Infinity);
});

test("collection envelope contains both physical receipt and retained custody without mutating its input", () => {
	const before = fixture();
	const snapshot = structuredClone(before);
	const out = collectRefineryEnvelope(before, 0, key, "Alloys");
	if (!out.ok) throw new Error(out.sentence);
	expect(out.ok).toBe(true);
	expect(out.units).toBe(2);
	expect(out.envelope.commander).toEqual({
		...before.commander,
		state: withAccount(before.commander.state, {
			...accountOf(before.commander.state),
			basis: {
				...accountOf(before.commander.state).basis,
				Alloys: {
					heldMass: massFromNative(2, 1000000),
					knownMass: massFromNative(2, 1000000),
					cost: money.fromNumber(20),
					legacyCost: money.fromTicks(0n),
				},
			},
		}),
	});
	expect(out.envelope.world).toEqual(
		withRefineryQueue(before.world, 0, key, {
			accountedThrough: 0,
			nextJobId: 2,
			jobs: [
				{
					...before.world.galaxies[0].refineries[key].jobs[0],
					taken: 2000000,
					basis: money.encode(money.fromNumber(12)),
				},
			],
		}),
	);
	expect(before).toEqual(snapshot);
});

test("collection refuses an invalid key, an empty queue and a full hold unchanged", () => {
	const before = fixture(20);
	const snapshot = structuredClone(before);
	expect(
		collectRefineryEnvelope(before, 0, "bad" as CarrierKey, "Alloys"),
	).toEqual(refineryRefusal("not-refinery"));
	expect(
		collectRefineryEnvelope(before, 0, carrierKey(4, "refinery/a"), "Alloys"),
	).toEqual(refineryRefusal("nothing-to-collect"));
	expect(collectRefineryEnvelope(before, 0, key, "Alloys")).toEqual(
		refineryRefusal("hold-full"),
	);
	expect(before).toEqual(snapshot);
});
