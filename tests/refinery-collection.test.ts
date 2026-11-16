/**
 * Node #1196: refinery collection in whole native units, partial when the hold
 * is short, with fractions owned at the refinery and no change to the pools.
 *
 * https://github.com/jcfischer/seelite/issues/1196
 */

import { describe, expect, test } from "bun:test";
import {
	acquire,
	emptyAccount,
	migrateAccount,
	type CommodityAccount,
} from "../src/commodity-pools";
import { carrierKey } from "../src/carrier-key";
import { mass, massFromNative, money } from "../src/exact-amount";
import {
	encodeRefineryQueue,
	parseRefineryQueue,
	refineryCollect,
	refineryCollectable,
	refineryRemainingGrams,
	refineryQuote,
	refinerySubmit,
	settleRefineryQueue,
	type RefineryQueue,
} from "../src/refinery";

const KEY = carrierKey(3, "refinery/a");
const METAL = "Metallic ore STD";
const PLAT_POOR = "Platinum-bearing ore POOR";
const PLAT_STD = "Platinum-bearing ore STD";

const submit = (
	account: CommodityAccount,
	queue: RefineryQueue | undefined,
	good: string,
	tonnes: number,
) => {
	const quoted = refineryQuote({
		station: KEY,
		queue,
		oreAboard: 1000,
		cash: account.cash,
		offline: false,
		good,
		tonnes,
		feePerTonne: money.fromNumber(2),
	});
	if (!quoted.ok) throw new Error(quoted.sentence);
	const done = refinerySubmit({ account, queue, quote: quoted.quote, at: 0 });
	if (!done.ok) throw new Error(done.sentence);
	return done;
};

const finish = (queue: RefineryQueue) =>
	settleRefineryQueue(queue, 1e6, queue.accountedThrough + 1e6);

const stocked = (...lots: [string, number][]) =>
	lots.reduce(
		(a, [good, tonnes]) => acquire(a, good, tonnes, money.fromNumber(30)),
		emptyAccount(1000),
	);

const run = (lots: [string, number][]) => {
	let account = stocked(...lots);
	let queue: RefineryQueue | undefined;
	for (const [good, tonnes] of lots) {
		const done = submit(account, queue, good, tonnes);
		account = done.account;
		queue = done.queue;
	}
	return { account, queue: finish(queue!) };
};

const costOf = (a: CommodityAccount, good: string) => a.basis[good]?.cost ?? 0n;

test("a rounded aggregate cannot collect more grams than validated custody contains", () => {
	const queue = parseRefineryQueue({
		accountedThrough: 0,
		nextJobId: 2,
		jobs: [
			{
				id: 1,
				good: "Gem-bearing ore RICH",
				tonnes: 1,
				product: "Gem-Stones",
				outputGrams: 20,
				fee: "0",
				basis: "0",
				work: 0,
				totalWork: 1,
				unknownMass: "0",
			},
		],
		pool: {
			"Gem-Stones": {
				grams: Number.MAX_SAFE_INTEGER,
				basis: "0",
				unknownMass: "0",
			},
		},
	});
	const snapshot = structuredClone(queue);
	expect(() =>
		refineryCollect({
			account: emptyAccount(0),
			queue,
			product: "Gem-Stones",
			roomUnits: Infinity,
		}),
	).toThrow("refinery: collection fell 1 g short of its own count");
	expect(queue).toEqual(snapshot);
});

test("earlier finished fractions wait for whole jobs and keep their eligibility in the pool", () => {
	const { account, queue } = run([
		[PLAT_POOR, 1],
		[PLAT_STD, 2],
	]);
	const small = {
		...queue.jobs[0],
		unknownMass: mass.encode(massFromNative(250, 1)),
	};
	const out = refineryCollect({
		account,
		queue: { ...queue, jobs: [small, queue.jobs[1]] },
		product: "Platinum",
		roomUnits: 1,
	});
	if (!out.ok) throw new Error(out.sentence);
	expect(out.queue.pool?.Platinum).toEqual({
		grams: 250,
		basis: small.basis,
		unknownMass: small.unknownMass,
	});
	expect(out.account.basis.Platinum.knownMass).toBe(massFromNative(1000, 1));
	expect(out.account.basis.Platinum.cost).toBe(
		money.parse(queue.jobs[1].basis),
	);
});

test("earlier jobs for another product and unfinished output are never drawn", () => {
	const { account, queue } = run([
		[PLAT_POOR, 1],
		[METAL, 5],
		[METAL, 8],
	]);
	const waiting = { ...queue.jobs[1], work: 1 };
	const out = refineryCollect({
		account,
		queue: { ...queue, jobs: [queue.jobs[0], waiting, queue.jobs[2]] },
		product: "Alloys",
		roomUnits: 1,
	});
	if (!out.ok) throw new Error(out.sentence);
	expect(out.queue.jobs.slice(0, 2)).toEqual([queue.jobs[0], waiting]);
	expect(out.account.basis.Platinum).toBeUndefined();
});

test("collectable counts only remaining finished output and its matching pool in native units", () => {
	const { queue } = run([
		[METAL, 8],
		[METAL, 3],
		[PLAT_POOR, 1],
	]);
	const partial: RefineryQueue = {
		...queue,
		jobs: queue.jobs.map((job, i) => ({
			...job,
			taken: i === 0 ? 1000000 : 0,
			work: i === 1 ? 1 : 0,
		})),
		pool: { Alloys: { grams: 900000, basis: "0", unknownMass: "0" } },
	};
	expect(refineryRemainingGrams(partial.jobs[0])).toBe(2200000);
	expect(refineryRemainingGrams(queue.jobs[0])).toBe(3200000);
	expect(refineryCollectable(undefined, "Alloys")).toBe(0);
	expect(refineryCollectable(queue, "Alloys")).toBe(4);
	expect(refineryCollectable(partial, "Alloys")).toBe(3);
	expect(refineryCollectable(partial, "Platinum")).toBe(0);
	expect(refineryCollectable(partial, "Gold")).toBe(0);
	expect(
		refineryCollectable(
			{
				...partial,
				jobs: [],
				pool: { Platinum: { grams: 1250, basis: "0", unknownMass: "0" } },
			},
			"Platinum",
		),
	).toBe(1);
});

test("collecting leaves other products and unfinished jobs unchanged, including when demand is exhausted", () => {
	const { account, queue } = run([
		[METAL, 8],
		[METAL, 5],
		[PLAT_POOR, 1],
		[METAL, 5],
	]);
	const mixed = {
		...queue,
		jobs: queue.jobs.map((job, i) => (i === 1 ? { ...job, work: 1 } : job)),
	};
	const out = refineryCollect({
		account,
		queue: mixed,
		product: "Alloys",
		roomUnits: 2,
	});
	if (!out.ok) throw new Error(out.sentence);
	expect(out.queue.jobs.slice(1)).toEqual(mixed.jobs.slice(1));
	expect(out.queue.jobs[0]).toEqual({
		...mixed.jobs[0],
		taken: 2000000,
		basis: money.encode(money.fromNumber(21)),
	});
	expect(out.account.basis.Alloys.cost).toBe(money.fromNumber(35));
});

test("collecting again adds to taken and folds the final fraction with its exact cost", () => {
	const { account, queue } = run([[METAL, 8]]);
	const first = refineryCollect({
		account,
		queue,
		product: "Alloys",
		roomUnits: 1,
	});
	if (!first.ok) throw new Error(first.sentence);
	const second = refineryCollect({
		account: first.account,
		queue: first.queue,
		product: "Alloys",
		roomUnits: 1,
	});
	if (!second.ok) throw new Error(second.sentence);
	expect(second.queue.jobs[0].taken).toBe(2000000);
	const third = refineryCollect({
		account: second.account,
		queue: second.queue,
		product: "Alloys",
		roomUnits: 1,
	});
	if (!third.ok) throw new Error(third.sentence);
	expect(third.queue.jobs).toEqual([]);
	expect(third.queue.pool).toEqual({
		Alloys: {
			grams: 200000,
			basis: money.encode(money.fromNumber(2.875)),
			unknownMass: "0",
		},
	});
	expect(third.account.basis.Alloys.cost).toBe(money.fromNumber(43.125));
	expect(third.account.pools).toBe(account.pools);
});

test("pooled output can be partially collected, keeps other balances, and carries unknown eligibility first", () => {
	const account = emptyAccount(100);
	const other = { grams: 250, basis: "0", unknownMass: "0" };
	const queue: RefineryQueue = {
		accountedThrough: 10,
		nextJobId: 4,
		jobs: [],
		pool: {
			Alloys: {
				grams: 2250000,
				basis: money.encode(money.fromNumber(9)),
				unknownMass: mass.encode(massFromNative(1.5, 1000000)),
			},
			Platinum: other,
		},
	};
	const out = refineryCollect({
		account,
		queue,
		product: "Alloys",
		roomUnits: 1,
	});
	if (!out.ok) throw new Error(out.sentence);
	expect(out.queue).toEqual({
		...queue,
		pool: {
			Alloys: {
				grams: 1250000,
				basis: money.encode(money.fromNumber(5)),
				unknownMass: mass.encode(massFromNative(0.5, 1000000)),
			},
			Platinum: other,
		},
	});
	expect(out.account.basis.Alloys.knownMass).toBe(mass.fromTicks(0n));
	expect(out.account.basis.Alloys.cost).toBe(money.fromNumber(4));
	const next = refineryCollect({
		account: out.account,
		queue: out.queue,
		product: "Alloys",
		roomUnits: 1,
	});
	if (!next.ok) throw new Error(next.sentence);
	expect(next.account.basis.Alloys.knownMass).toBe(
		massFromNative(0.5, 1000000),
	);
	expect(next.queue.pool?.Alloys).toEqual({
		grams: 250000,
		basis: money.encode(money.fromNumber(1)),
		unknownMass: "0",
	});
	expect(
		refineryCollect({
			account,
			queue: { ...queue, jobs: [], pool: { Platinum: other } },
			product: "Alloys",
			roomUnits: 1,
		}),
	).toMatchObject({ ok: false, reason: "nothing-to-collect" });
});

test("a whole job is drawn before fractions, and a pool is untouched when jobs satisfy the collection", () => {
	const { account, queue } = run([[METAL, 5]]);
	const pool = {
		Alloys: {
			grams: 500000,
			basis: money.encode(money.fromNumber(5)),
			unknownMass: mass.encode(massFromNative(0.5, 1000000)),
		},
	};
	const out = refineryCollect({
		account,
		queue: { ...queue, pool },
		product: "Alloys",
		roomUnits: 2,
	});
	if (!out.ok) throw new Error(out.sentence);
	expect(out.queue.jobs).toEqual([]);
	expect(out.queue.pool).toEqual(pool);
	expect(out.account.basis.Alloys.knownMass).toBe(massFromNative(2, 1000000));
	expect(out.account.basis.Alloys.cost).toBe(money.fromNumber(40));
});

test("exactly one remaining native unit keeps job priority over another whole job", () => {
	const { account, queue } = run([
		[METAL, 5],
		[METAL, 5],
	]);
	const partial = {
		...queue,
		jobs: [
			{
				...queue.jobs[0],
				taken: 1000000,
				basis: money.encode(money.fromNumber(10)),
				unknownMass: mass.encode(massFromNative(1, 1000000)),
			},
			queue.jobs[1],
		],
	};
	const out = refineryCollect({
		account,
		queue: partial,
		product: "Alloys",
		roomUnits: 1,
	});
	if (!out.ok) throw new Error(out.sentence);
	expect(out.queue.jobs).toEqual([queue.jobs[1]]);
	expect(out.queue.pool).toBeUndefined();
	expect(out.account.basis.Alloys.cost).toBe(money.fromNumber(10));
	expect(out.account.basis.Alloys.knownMass).toBe(mass.fromTicks(0n));
});

describe("collecting", () => {
	test("3.2 t finished with 2 t free brings 2 t aboard and keeps 1.2 t in custody", () => {
		const { account, queue } = run([[METAL, 8]]);
		const job = queue.jobs[0];
		const out = refineryCollect({
			account,
			queue,
			product: "Alloys",
			roomUnits: 2,
		});
		if (!out.ok) throw new Error(out.sentence);
		expect(out.units).toBe(2);
		expect(out.account.basis.Alloys.heldMass).toBe(massFromNative(2, 1e6));
		const left = out.queue.jobs[0];
		expect(left.taken).toBe(2_000_000);
		expect(job.outputGrams - (left.taken ?? 0)).toBe(1_200_000);
		expect(
			costOf(out.account, "Alloys") + BigInt(money.parse(left.basis)),
		).toBe(BigInt(money.parse(job.basis)));
		expect(costOf(out.account, "Alloys") > 0n).toBe(true);
		expect(out.account.pools).toBe(account.pools);
	});

	test("a zero-fit collection refuses and leaves everything as it was", () => {
		const { account, queue } = run([[METAL, 8]]);
		const out = refineryCollect({
			account,
			queue,
			product: "Alloys",
			roomUnits: 0,
		});
		expect(out).toMatchObject({ ok: false, reason: "hold-full" });
		expect(
			refineryCollect({ account, queue, product: "Gold", roomUnits: 5 }),
		).toMatchObject({ ok: false, reason: "nothing-to-collect" });
	});

	test("four finished 1 t poor Platinum jobs yield exactly 1 kg", () => {
		const { account, queue } = run(
			Array.from({ length: 4 }, () => [PLAT_POOR, 1] as [string, number]),
		);
		expect(queue.jobs).toHaveLength(4);
		const out = refineryCollect({
			account,
			queue,
			product: "Platinum",
			roomUnits: Number.POSITIVE_INFINITY,
		});
		if (!out.ok) throw new Error(out.sentence);
		expect(out.units).toBe(1);
		expect(out.queue.jobs).toHaveLength(0);
		expect(out.queue.pool).toBeUndefined();
		const total = [...Array(4)].reduce(
			(sum, _, i) => sum + BigInt(money.parse(queue.jobs[i].basis)),
			0n,
		);
		expect(costOf(out.account, "Platinum")).toBe(total);
	});

	test("mixed grades of one product combine and the fraction stays pooled", () => {
		const { account, queue } = run([
			[PLAT_POOR, 1],
			[PLAT_STD, 2],
		]);
		const out = refineryCollect({
			account,
			queue,
			product: "Platinum",
			roomUnits: 9,
		});
		if (!out.ok) throw new Error(out.sentence);
		expect(out.units).toBe(1);
		expect(out.queue.jobs).toHaveLength(0);
		expect(out.queue.pool?.Platinum.grams).toBe(250);
	});

	test("a remainder with no whole unit left moves to the pool and frees the slot", () => {
		const { account, queue } = run([[PLAT_POOR, 1]]);
		const out = refineryCollect({
			account,
			queue,
			product: "Platinum",
			roomUnits: 9,
		});
		if (!out.ok) throw new Error(out.sentence);
		expect(out.units).toBe(0);
		expect(out.queue.jobs).toHaveLength(0);
		expect(out.queue.pool?.Platinum).toMatchObject({
			grams: 250,
			basis: queue.jobs[0].basis,
		});
		expect(out.account.basis.Platinum).toBeUndefined();
	});

	test("two collection orders leave the progression pools identical", () => {
		const { account, queue } = run([
			[METAL, 8],
			[METAL, 3],
		]);
		const take = (rooms: number[]) => {
			let a = account;
			let q: RefineryQueue = queue;
			for (const roomUnits of rooms) {
				const out = refineryCollect({
					account: a,
					queue: q,
					product: "Alloys",
					roomUnits,
				});
				if (!out.ok) throw new Error(out.sentence);
				a = out.account;
				q = out.queue;
			}
			return a;
		};
		const one = take([1, 3]);
		const two = take([3, 1]);
		expect(one.pools).toEqual(two.pools);
		expect(one.pools).toEqual(account.pools);
		expect(one.cash).toBe(two.cash);
		expect(one.bankedTrade).toBe(two.bankedTrade);
		expect(one.basis.Alloys.heldMass).toBe(two.basis.Alloys.heldMass);
	});
});

describe("submission keeps ownership through custody", () => {
	test("total and unknown mass stay in the pool and only the fee adds debt", () => {
		const account = migrateAccount(1000, 0, { [METAL]: 5 }, {});
		const before = account.pools.Alloys;
		const done = submit(account, undefined, METAL, 5);
		const after = done.account.pools.Alloys;
		expect(after.totalMass).toBe(before.totalMass);
		expect(after.unknownMass).toBe(before.unknownMass);
		expect(after.unrecoveredCost).toBe(
			money.add(before.unrecoveredCost, money.parse(done.queue.jobs[0].fee)),
		);
		expect(done.queue.jobs[0].unknownMass).toBeDefined();
	});

	test("unknown output arrives as unknown basis, and the pools do not move", () => {
		const account = migrateAccount(1000, 0, { [METAL]: 5 }, {});
		const done = submit(account, undefined, METAL, 5);
		const queue = finish(done.queue);
		const out = refineryCollect({
			account: done.account,
			queue,
			product: "Alloys",
			roomUnits: 99,
		});
		if (!out.ok) throw new Error(out.sentence);
		expect(out.account.basis.Alloys.knownMass).toBe(mass.fromTicks(0n));
		expect(out.account.pools).toBe(done.account.pools);
	});
});

describe("jobs saved before custody kept its pools", () => {
	test("load with their whole output unknown-cost, and are neither refused nor dropped", () => {
		const { account, queue } = run([[METAL, 5]]);
		const wire = encodeRefineryQueue(queue) as any;
		for (const job of wire.jobs) delete job.unknownMass;
		const legacy = parseRefineryQueue(wire);
		expect(legacy.jobs).toHaveLength(1);
		expect(legacy.jobs[0].unknownMass).toBeUndefined();
		const stripped = {
			...account,
			pools: {
				...account.pools,
				Alloys: {
					...account.pools.Alloys,
					totalMass: 0n,
				} as never,
			},
		};
		const out = refineryCollect({
			account: stripped as CommodityAccount,
			queue: legacy,
			product: "Alloys",
			roomUnits: 99,
		});
		if (!out.ok) throw new Error(out.sentence);
		expect(out.units).toBe(2);
		expect(out.account.basis.Alloys.knownMass).toBe(mass.fromTicks(0n));
		expect(
			out.account.pools.Alloys.unknownMass >= out.account.basis.Alloys.heldMass,
		).toBe(true);
	});
});

describe("the wire form", () => {
	test("a partial job and a pooled balance round-trip", () => {
		const { account, queue } = run([[METAL, 8]]);
		const partial = refineryCollect({
			account,
			queue,
			product: "Alloys",
			roomUnits: 2,
		});
		if (!partial.ok) throw new Error(partial.sentence);
		const wire = JSON.parse(JSON.stringify(encodeRefineryQueue(partial.queue)));
		expect(parseRefineryQueue(wire)).toEqual(partial.queue);
		const fractions = run([[PLAT_POOR, 1]]);
		const folded = refineryCollect({
			account: fractions.account,
			queue: fractions.queue,
			product: "Platinum",
			roomUnits: 9,
		});
		if (!folded.ok) throw new Error(folded.sentence);
		const again = JSON.parse(JSON.stringify(encodeRefineryQueue(folded.queue)));
		expect(parseRefineryQueue(again)).toEqual(folded.queue);
	});

	test("an empty queue still saves as it did before", () => {
		expect(
			Object.keys(
				encodeRefineryQueue({ accountedThrough: 0, nextJobId: 1, jobs: [] }),
			),
		).toEqual(["accountedThrough", "nextJobId", "jobs"]);
	});
});
