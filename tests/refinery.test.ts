/**
 * Node #1195: refinery submission and its saved FIFO queue.
 *
 * The service's own arithmetic is tested directly; world settlement is tested
 * through `advanceTo`, which is the one boundary every production mutation and
 * save passes; the commit rows use the in-memory backend so the "nothing until
 * the write lands" criterion is checked against a write rather than a promise.
 *
 * https://github.com/jcfischer/seelite/issues/1195
 */

import { describe, expect, test } from "bun:test";
import {
	acquire,
	displayAmount,
	emptyAccount,
	migrateAccount,
	withAccount,
} from "../src/commodity-pools";
import { carrierKey } from "../src/carrier-key";
import { money, signedMoney } from "../src/exact-amount";
import { systemAt } from "../src/galaxy";
import { generateContents } from "../src/system";
import { oreGood } from "../src/ore-goods";
import {
	REFINERY_JOB_LIMIT,
	emptyRefineryQueue,
	exclusiveCapabilityKey,
	refineryFeePerTonne,
	refineryQuote,
	refineryRefusal,
	refinerySubmit,
	settleRefineryQueue,
	type RefineryJob,
	type RefineryQueue,
} from "../src/refinery";
import {
	refineryQuoteAt,
	submitRefineryEnvelope,
} from "../src/refinery-pricing";
import { newCommanderRecord, type SaveEnvelope } from "../src/save-envelope";
import {
	memorySaveBackend,
	SAVE_COMMIT_TIMEOUT_MS,
	SaveStore,
	type Scheduler,
} from "../src/save-store";
import {
	advanceTo,
	capabilityAvailability,
	newWorld,
	operationalDuration,
	serializeWorld,
	stationServices,
	visit,
	withRefineryQueue,
	parseWorld,
} from "../src/world-state";
import { holdingsAfterDeath } from "../src/holdings";
import { fnv1a } from "../src/rng";

const SEED = 47;
const GOOD = "Silicate ore STD";
const OTHER = "Metallic ore STD";
const KEY = carrierKey(3, "refinery/a");

const ore = oreGood(GOOD)!;

const feePerTonne = () => money.fromNumber(2.5);

const job = (id: number, work = 5, good = GOOD): RefineryJob => {
	const g = oreGood(good)!;
	return {
		id,
		good,
		tonnes: work,
		product: g.product,
		outputGrams: g.yieldGPerT * work,
		fee: money.encode(money.fromNumber(work * 2.5)),
		basis: money.encode(money.fromNumber(work * 2.5)),
		work,
		totalWork: work,
	};
};

const queue = (jobs: RefineryJob[], at = 0): RefineryQueue => ({
	accountedThrough: at,
	nextJobId: Math.max(1, ...jobs.map((j) => j.id + 1)),
	jobs,
});

const quote = (
	tonnes: number,
	options: {
		oreAboard?: number;
		cash?: number;
		offline?: boolean;
		queue?: RefineryQueue;
	} = {},
) => {
	const result = refineryQuote({
		station: KEY,
		queue: options.queue,
		oreAboard: options.oreAboard ?? 6,
		cash: signedMoney.fromNumber(options.cash ?? 100),
		offline: options.offline ?? false,
		good: GOOD,
		tonnes,
		feePerTonne: feePerTonne(),
	});
	if (!result.ok) throw new Error(result.sentence);
	return result.quote;
};

const account = (tonnes = 6, credits = 100) =>
	acquire(emptyAccount(credits), GOOD, tonnes, money.fromNumber(10));

describe("the quote", () => {
	test("prices output, fee, position and work from the ratified table", () => {
		const q = quote(2);
		expect(q.product).toBe("Minerals");
		expect(q.outputGrams).toBe(ore.yieldGPerT * 2);
		expect(q.fee).toBe(money.encode(money.fromNumber(5)));
		expect(q.position).toBe(1);
		expect(q.workAhead).toBe(2);
	});

	test("counts only unfinished jobs in the position and all work in the estimate", () => {
		const q = quote(1, { queue: queue([job(1, 7), job(2, 0)]) });
		expect(q.position).toBe(2);
		expect(q.workAhead).toBe(8);
	});

	test("a tome does not change the quote, a changed quantity, fee or position does", () => {
		const q = quote(2);
		expect(quote(2).signature).toBe(q.signature);
		expect(quote(3).signature).not.toBe(q.signature);
		expect(
			refineryQuote({
				station: KEY,
				queue: undefined,
				oreAboard: 6,
				cash: signedMoney.fromNumber(100),
				offline: false,
				good: GOOD,
				tonnes: 2,
				feePerTonne: money.fromNumber(3),
			}).ok,
		).toBe(true);
		const dearer = refineryQuote({
			station: KEY,
			queue: undefined,
			oreAboard: 6,
			cash: signedMoney.fromNumber(100),
			offline: false,
			good: GOOD,
			tonnes: 2,
			feePerTonne: money.fromNumber(3),
		});
		if (!dearer.ok) throw new Error(dearer.sentence);
		expect(dearer.quote.signature).not.toBe(q.signature);
		const later = quote(1, { queue: queue([job(1, 0)]) });
		expect(later.position).toBe(1);
	});

	test("refuses a changed quantity, missing ore, offline service, a full queue and short credits", () => {
		expect(
			refineryQuote({
				station: KEY,
				queue: undefined,
				oreAboard: 6,
				cash: signedMoney.fromNumber(100),
				offline: false,
				good: GOOD,
				tonnes: 0,
				feePerTonne: feePerTonne(),
			}),
		).toMatchObject({ reason: "invalid-quantity" });
		expect(
			refineryQuote({
				station: KEY,
				queue: undefined,
				oreAboard: 1,
				cash: signedMoney.fromNumber(100),
				offline: false,
				good: GOOD,
				tonnes: 2,
				feePerTonne: feePerTonne(),
			}),
		).toMatchObject({ reason: "insufficient-ore" });
		expect(
			refineryQuote({
				station: KEY,
				queue: undefined,
				oreAboard: 6,
				cash: signedMoney.fromNumber(100),
				offline: true,
				good: GOOD,
				tonnes: 2,
				feePerTonne: feePerTonne(),
			}),
		).toMatchObject({ reason: "processing-offline" });
		const full = queue(
			Array.from({ length: REFINERY_JOB_LIMIT }, (_, i) => job(i + 1)),
		);
		expect(
			refineryQuote({
				station: KEY,
				queue: full,
				oreAboard: 6,
				cash: signedMoney.fromNumber(100),
				offline: false,
				good: GOOD,
				tonnes: 2,
				feePerTonne: feePerTonne(),
			}),
		).toMatchObject({ reason: "queue-full" });
		expect(
			refineryQuote({
				station: KEY,
				queue: undefined,
				oreAboard: 6,
				cash: signedMoney.fromNumber(1),
				offline: false,
				good: GOOD,
				tonnes: 2,
				feePerTonne: feePerTonne(),
			}),
		).toMatchObject({ reason: "insufficient-credits" });
	});

	test("splitting a batch leaves total fee and total work unchanged", () => {
		const whole = quote(4);
		const first = quote(1);
		const one = refinerySubmit({
			account: account(6),
			queue: undefined,
			quote: first,
			at: 10,
		});
		if (!one.ok) throw new Error(one.sentence);
		const second = quote(3, { queue: one.queue });
		const two = refinerySubmit({
			account: one.account,
			queue: one.queue,
			quote: second,
			at: 10,
		});
		if (!two.ok) throw new Error(two.sentence);
		expect(two.queue.jobs.map((j) => j.work)).toEqual([1, 3]);
		expect(two.queue.jobs[0].fee).toBe(first.fee);
		expect(
			Number(displayAmount(money.parse(two.queue.jobs[0].fee))) +
				Number(displayAmount(money.parse(two.queue.jobs[1].fee))),
		).toBe(Number(displayAmount(money.parse(whole.fee))));
		expect(two.queue.jobs[0].work + two.queue.jobs[1].work).toBe(
			whole.workAhead,
		);
	});
});

describe("submitting", () => {
	test("moves the ore, the fee and the job into custody together", () => {
		const submitted = refinerySubmit({
			account: account(6),
			queue: undefined,
			quote: quote(2),
			at: 40,
		});
		if (!submitted.ok) throw new Error(submitted.sentence);
		expect(
			displayAmount(submitted.account.basis[GOOD]!.heldMass, "mass", 1000000),
		).toBe(4);
		expect(submitted.account.cash).toBe(signedMoney.fromNumber(85));
		expect(submitted.queue.jobs).toHaveLength(1);
		expect(submitted.queue.jobs[0]).toMatchObject({
			id: 1,
			good: GOOD,
			tonnes: 2,
			work: 2,
			totalWork: 2,
		});
		expect(
			Number(displayAmount(money.parse(submitted.queue.jobs[0].basis))),
		).toBeCloseTo(10 / 3 + 5, 6);
	});

	test("refuses without consuming anything when the quote no longer fits", () => {
		const base = account(6);
		const stale = quote(2, { queue: queue([job(1, 0)]) });
		const ahead = queue([job(2, 4)]);
		const refused = refinerySubmit({
			account: base,
			queue: ahead,
			quote: stale,
			at: 40,
		});
		expect(refused).toMatchObject({ reason: "stale-quote" });
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.sentence).toContain("Review");
		const full = queue(
			Array.from({ length: REFINERY_JOB_LIMIT }, (_, i) => job(i + 1)),
		);
		expect(
			refinerySubmit({ account: base, queue: full, quote: quote(1), at: 40 }),
		).toMatchObject({ reason: "queue-full" });
		expect(
			refinerySubmit({
				account: account(1),
				queue: undefined,
				quote: quote(1),
				at: 40,
			}).ok,
		).toBe(true);
		expect(
			refinerySubmit({
				account: migrateAccount(100, 0, {}, {}),
				queue: undefined,
				quote: quote(1),
				at: 40,
			}),
		).toMatchObject({ reason: "insufficient-ore" });
	});
});

describe("the FIFO advance", () => {
	test("spends the budget on the first unfinished job and carries the rest", () => {
		const settled = settleRefineryQueue(queue([job(1, 3), job(2, 2)]), 4, 100);
		expect(settled.jobs.map((j) => j.work)).toEqual([0, 1]);
		expect(settled.accountedThrough).toBe(100);
	});

	test("a finished job keeps its slot and does not take later service", () => {
		const settled = settleRefineryQueue(queue([job(1, 0), job(2, 3)]), 1, 100);
		expect(settled.jobs[0].work).toBe(0);
		expect(settled.jobs[1].work).toBe(2);
	});
});

const refineryHere = ((): {
	systemIndex: number;
	key: ReturnType<typeof carrierKey>;
} => {
	for (let index = 0; index < 256; index++) {
		const record = systemAt(SEED, 0, index);
		const station = generateContents(record).stations.find(
			(s) => s.type === "refinery",
		);
		if (station)
			return {
				systemIndex: index,
				key: carrierKey(index, station.localCarrierId),
			};
	}
	throw new Error("seed 47 has no refinery");
})();

const downAt = ((): number => {
	const probe = advanceTo(
		visit(newWorld(SEED), 0, refineryHere.systemIndex),
		0,
	);
	for (let at = 0; at < 12000; at += 10)
		if (stationServices(probe, 0, refineryHere.key, at).exclusive === false)
			return at;
	throw new Error("seed 47's refinery never goes down");
})();

const onlineAt = ((): number => {
	const probe = advanceTo(
		visit(newWorld(SEED), 0, refineryHere.systemIndex),
		0,
	);
	for (let at = 0; at < 12000; at += 10)
		if (stationServices(probe, 0, refineryHere.key, at).exclusive !== false)
			return at;
	throw new Error("seed 47's refinery never comes online");
})();

describe("an outage", () => {
	test("refuses a quote and a submission while the exclusive service is down", () => {
		const base = newCommanderRecord("miner", {
			galaxyIndex: 0,
			systemIndex: refineryHere.systemIndex,
		});
		const held = acquire(emptyAccount(1000), GOOD, 4, money.fromNumber(8));
		const envelope = {
			world: advanceTo(
				visit(newWorld(SEED), 0, refineryHere.systemIndex),
				downAt,
			),
			commander: {
				...base,
				state: withAccount({ ...base.state, credits: 1000 }, held),
				dockedAt: refineryHere.key,
			},
		};
		const quoted = refineryQuoteAt(envelope, 0, refineryHere.key, GOOD, 2);
		expect(quoted).toMatchObject({ reason: "processing-offline" });
		const submitted = submitRefineryEnvelope(
			envelope,
			0,
			{
				station: refineryHere.key,
				good: GOOD,
				tonnes: 2,
				product: "Minerals",
				outputGrams: ore.yieldGPerT * 2,
				fee: money.encode(money.fromNumber(1)),
				position: 1,
				workAhead: 2,
				signature: "assembled",
			},
			envelope.world.gameTime,
		);
		expect(submitted).toMatchObject({ reason: "processing-offline" });
	});
});

describe("world settlement", () => {
	test("operational time only, and the queue itself is the consumer", () => {
		const from = 500;
		const to = 900;
		const world = advanceTo(
			visit(newWorld(SEED), 0, refineryHere.systemIndex),
			from,
		);
		const seeded = withRefineryQueue(
			world,
			0,
			refineryHere.key,
			queue([job(1, 1000)], from),
		);
		const advanced = advanceTo(seeded, to);
		const operational = operationalDuration(
			advanced,
			0,
			exclusiveCapabilityKey(refineryHere.key),
			from,
			to,
		);
		const settled = advanced.galaxies[0].refineries[refineryHere.key];
		expect(settled.jobs[0].work).toBe(1000 - operational);
		expect(settled.accountedThrough).toBe(to);
	});

	test("a downtime interval pays nothing, and a later uptime interval pays", () => {
		let downAt = -1;
		let downEnd = -1;
		const probe = advanceTo(newWorld(SEED), 2000);
		for (let t = 2000; t < 8000; t += 10) {
			const state = capabilityAvailability(
				probe,
				0,
				exclusiveCapabilityKey(refineryHere.key),
				t,
			);
			if (!state.operational && state.naturalEnd !== null) {
				downAt = t;
				downEnd = state.naturalEnd;
				break;
			}
		}
		expect(downAt).toBeGreaterThanOrEqual(0);
		const from = downAt;
		const to = Math.min(downEnd, from + 100);
		expect(to).toBeGreaterThan(from);
		const world = advanceTo(
			visit(newWorld(SEED), 0, refineryHere.systemIndex),
			from,
		);
		const seeded = withRefineryQueue(
			world,
			0,
			refineryHere.key,
			queue([job(1, 10)], from),
		);
		const advanced = advanceTo(seeded, to);
		expect(advanced.galaxies[0].refineries[refineryHere.key].jobs[0].work).toBe(
			10,
		);
		expect(
			operationalDuration(
				advanced,
				0,
				exclusiveCapabilityKey(refineryHere.key),
				from,
				to,
			),
		).toBe(0);
	});
});

describe("save", () => {
	test("a schema-4 world loads with empty refinery queues and keeps its bytes", () => {
		const raw = serializeWorld(advanceTo(newWorld(SEED), 1000)) as Record<
			string,
			unknown
		>;
		raw.worldSchemaVersion = 4;
		const { integrity: _old, ...body } = raw;
		const sealed = { ...body, integrity: fnv1a(JSON.stringify(body)) };
		const before = JSON.stringify(sealed);
		const loaded = parseWorld(sealed);
		expect(loaded.worldSchemaVersion).toBe(5);
		expect(
			loaded.galaxies.every((g) => Object.keys(g.refineries).length === 0),
		).toBe(true);
		expect(JSON.stringify(sealed)).toBe(before);
		const rewritten = serializeWorld(loaded) as Record<string, unknown>;
		expect(parseWorld(rewritten)).toEqual(loaded);
	});

	test("a schema-4 world carrying a queue was assembled and is refused", () => {
		const raw = serializeWorld(advanceTo(newWorld(SEED), 1000)) as Record<
			string,
			any
		>;
		raw.worldSchemaVersion = 4;
		raw.galaxies[0].refineries = {
			[refineryHere.key]: {
				accountedThrough: 0,
				nextJobId: 1,
				jobs: [],
			},
		};
		const { integrity: _old, ...body } = raw;
		const sealed = { ...body, integrity: fnv1a(JSON.stringify(body)) };
		expect(() => parseWorld(sealed)).toThrow("refinery");
	});

	test("a queue's cursor cannot outrun the clock", () => {
		const world = advanceTo(newWorld(SEED), 1000);
		const withQueue = withRefineryQueue(
			world,
			0,
			refineryHere.key,
			queue([job(1, 1)], 2000),
		);
		const raw = serializeWorld(withQueue) as Record<string, any>;
		expect(() => parseWorld(raw)).toThrow("beyond the clock");
	});
});

describe("pricing and the commit path", () => {
	const commander = (credits: number, tonnes: number) => {
		const base = newCommanderRecord("miner", {
			galaxyIndex: 0,
			systemIndex: refineryHere.systemIndex,
		});
		const held = acquire(
			emptyAccount(credits),
			GOOD,
			tonnes,
			money.fromNumber(tonnes * 2),
		);
		return {
			...base,
			state: withAccount({ ...base.state, credits }, held),
			dockedAt: refineryHere.key,
		};
	};
	const envelope = (): SaveEnvelope => ({
		world: advanceTo(
			visit(newWorld(SEED), 0, refineryHere.systemIndex),
			onlineAt,
		),
		commander: commander(1000, 4),
	});

	test("prices a real refinery from the envelope alone and submits through it", () => {
		const live = envelope();
		const quoted = refineryQuoteAt(live, 0, refineryHere.key, GOOD, 2);
		if (!quoted.ok) throw new Error(quoted.sentence);
		expect(quoted.quote.outputGrams).toBe(ore.yieldGPerT * 2);
		expect(
			Number(displayAmount(money.parse(quoted.quote.fee))),
		).toBeGreaterThan(0);
		const submitted = submitRefineryEnvelope(
			live,
			0,
			quoted.quote,
			live.world.gameTime,
		);
		if (!submitted.ok) throw new Error(submitted.sentence);
		expect(submitted.envelope.commander.state.cargo[GOOD]).toBe(2);
		expect(
			submitted.envelope.world.galaxies[0].refineries[refineryHere.key]?.jobs,
		).toHaveLength(1);
		expect(
			Number(
				displayAmount(submitted.envelope.commander.state.accounting!.cash),
			),
		).toBeLessThan(1000);
	});

	test("a changed quote is refused at the commit seam", () => {
		const live = envelope();
		const quoted = refineryQuoteAt(live, 0, refineryHere.key, GOOD, 2);
		if (!quoted.ok) throw new Error(quoted.sentence);
		const tampered = { ...quoted.quote, tonnes: 3 };
		const submitted = submitRefineryEnvelope(
			live,
			0,
			tampered,
			live.world.gameTime,
		);
		expect(submitted).toMatchObject({ reason: "stale-quote" });
	});

	test("a commit lands both halves, and a repeat is stale", async () => {
		let live = envelope();
		const quoted = refineryQuoteAt(live, 0, refineryHere.key, GOOD, 2);
		if (!quoted.ok) throw new Error(quoted.sentence);
		const backend = memorySaveBackend();
		const store = new SaveStore({
			backend,
			locks: { tryHold: async () => () => {}, release: () => {} } as never,
			schedule: () => () => {},
			slot: "refinery-test",
			current: () => live,
		});
		const op = (txSeq: number) => ({
			txSeq,
			checkpoint: true,
			apply: (env: SaveEnvelope) => {
				const submitted = submitRefineryEnvelope(
					env,
					0,
					quoted.quote,
					env.world.gameTime,
				);
				if (!submitted.ok) throw new Error(submitted.sentence);
				return submitted.envelope;
			},
			adopt: (committed: SaveEnvelope) => {
				live = {
					world: withRefineryQueue(
						live.world,
						0,
						refineryHere.key,
						committed.world.galaxies[0].refineries[refineryHere.key]!,
					),
					commander: {
						...live.commander,
						state: committed.commander.state,
						txSeq: committed.commander.txSeq,
					},
				};
			},
		});
		expect(await store.commit(op(live.commander.txSeq))).toBe("committed");
		expect(live.commander.state.cargo[GOOD]).toBe(2);
		expect(
			live.world.galaxies[0].refineries[refineryHere.key]?.jobs,
		).toHaveLength(1);
		const landed = (await backend.raw("refinery-test", "lastDocked")) as Record<
			string,
			any
		>;
		expect(landed.commander.state.cargo[GOOD]).toBe(2);
		expect(
			Object.values(
				landed.world.galaxies[0].refineries as Record<string, any>,
			)[0].jobs,
		).toHaveLength(1);
		expect(landed.commander.state.accounting.cash).toBe(
			signedMoney.encode(live.commander.state.accounting!.cash),
		);
		expect(landed.commander.state.credits).toBeLessThan(1000);
		expect(await store.commit(op(0))).toBe("stale");
	});

	test("a failed write consumes nothing, and the same op can then land", async () => {
		let live = envelope();
		const quoted = refineryQuoteAt(live, 0, refineryHere.key, GOOD, 2);
		if (!quoted.ok) throw new Error(quoted.sentence);
		const backend = memorySaveBackend();
		const store = new SaveStore({
			backend,
			locks: { tryHold: async () => () => {}, release: () => {} } as never,
			schedule: () => () => {},
			slot: "refinery-fail",
			current: () => live,
		});
		const op = (txSeq: number) => ({
			txSeq,
			checkpoint: true,
			apply: (env: SaveEnvelope) => {
				const submitted = submitRefineryEnvelope(
					env,
					0,
					quoted.quote,
					env.world.gameTime,
				);
				if (!submitted.ok) throw new Error(submitted.sentence);
				return submitted.envelope;
			},
			adopt: (committed: SaveEnvelope) => {
				live = {
					world: withRefineryQueue(
						live.world,
						0,
						refineryHere.key,
						committed.world.galaxies[0].refineries[refineryHere.key]!,
					),
					commander: {
						...live.commander,
						state: committed.commander.state,
						txSeq: committed.commander.txSeq,
					},
				};
			},
		});
		backend.failNextWrite();
		expect(await store.commit(op(live.commander.txSeq))).toBe("failed");
		expect(live.commander.state.cargo[GOOD]).toBe(4);
		expect(live.world.galaxies[0].refineries[refineryHere.key]).toBeUndefined();
		expect(await backend.has("refinery-fail", "live")).toBe(false);
		expect(await backend.has("refinery-fail", "lastDocked")).toBe(false);
		expect(await store.commit(op(live.commander.txSeq))).toBe("committed");
		expect(live.commander.state.cargo[GOOD]).toBe(2);
	});

	test("a write that landed without its acknowledgement is decided by a read-back", async () => {
		let live = envelope();
		const quoted = refineryQuoteAt(live, 0, refineryHere.key, GOOD, 2);
		if (!quoted.ok) throw new Error(quoted.sentence);
		const backend = memorySaveBackend();
		const armed: { timeout?: () => void } = {};
		const scheduler: Scheduler = (fn, ms) => {
			if (ms === SAVE_COMMIT_TIMEOUT_MS) armed.timeout = fn;
			return () => {};
		};
		const store = new SaveStore({
			backend,
			locks: { tryHold: async () => () => {}, release: () => {} } as never,
			schedule: scheduler,
			slot: "refinery-uncertain",
			current: () => live,
		});
		const op = (txSeq: number) => ({
			txSeq,
			checkpoint: true,
			apply: (env: SaveEnvelope) => {
				const submitted = submitRefineryEnvelope(
					env,
					0,
					quoted.quote,
					env.world.gameTime,
				);
				if (!submitted.ok) throw new Error(submitted.sentence);
				return submitted.envelope;
			},
			adopt: (committed: SaveEnvelope) => {
				live = {
					world: withRefineryQueue(
						live.world,
						0,
						refineryHere.key,
						committed.world.galaxies[0].refineries[refineryHere.key]!,
					),
					commander: {
						...live.commander,
						state: committed.commander.state,
						txSeq: committed.commander.txSeq,
					},
				};
			},
		});
		backend.hangNextWriteApplied();
		const pending = store.commit(op(live.commander.txSeq));
		if (!armed.timeout) throw new Error("the commit armed no timeout");
		armed.timeout();
		expect(await pending).toBe("committed");
		expect(live.commander.state.cargo[GOOD]).toBe(2);
		expect(live.commander.txSeq).toBe(1);
		expect(store.hasUncertainCommit).toBe(false);
		backend.release();
		await store.settled();
	});
});

describe("death", () => {
	test("the paid job survives the commander's revert", () => {
		const live = advanceTo(
			visit(newWorld(SEED), 0, refineryHere.systemIndex),
			300,
		);
		const queueHere = queue([job(1, 2)], 300);
		const dying = {
			world: withRefineryQueue(live, 0, refineryHere.key, queueHere),
			commander: newCommanderRecord("miner", {
				galaxyIndex: 0,
				systemIndex: refineryHere.systemIndex,
			}),
		};
		const dock = {
			...dying.commander,
			state: { ...dying.commander.state, credits: 900 },
		};
		const after = holdingsAfterDeath(dock, dying, "destroyed");
		expect(
			after.world.galaxies[0].refineries[refineryHere.key]?.jobs,
		).toHaveLength(1);
		expect(after.commander.state.credits).toBe(900);
	});
});

test("the fee table and the output are linear in tonnes", () => {
	expect(ore.yieldGPerT).toBe(400000);
	expect(refineryFeePerTonne(money.fromNumber(10))).toBe(money.fromNumber(3.5));
});
