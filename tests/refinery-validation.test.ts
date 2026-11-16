import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import { acquire, emptyAccount } from "../src/commodity-pools";
import { mass, massFromNative, money, signedMoney } from "../src/exact-amount";
import {
	encodeRefineries,
	encodeRefineryQueue,
	parseRefineries,
	parseRefineryQueue,
	productUnits,
	refineryFinished,
	refineryQuote,
	refineryRefusal,
	refinerySubmit,
	settleRefineryQueue,
	type RefineryJob,
	type RefineryRefusalReason,
} from "../src/refinery";

const key = carrierKey(3, "station-01");
const good = "Silicate ore STD";
const job = (id = 1): RefineryJob => ({
	id,
	good,
	tonnes: 2,
	product: "Minerals",
	outputGrams: 800000,
	fee: money.encode(money.fromNumber(5)),
	basis: money.encode(money.fromNumber(8)),
	work: 2,
	totalWork: 2,
});
const queue = () => ({ accountedThrough: 0, nextJobId: 2, jobs: [job()] });
const quoted = () => {
	const result = refineryQuote({
		station: key,
		queue: undefined,
		oreAboard: 2,
		cash: signedMoney.fromNumber(5),
		offline: false,
		good,
		tonnes: 2,
		feePerTonne: money.fromNumber(2.5),
	});
	if (!result.ok) throw new Error(result.sentence);
	return result.quote;
};

describe("refinery refusals and boundaries", () => {
	test.each([
		["invalid-quantity", "Choose a positive whole-tonne quantity."],
		["unknown-good", "That is not ore."],
		["insufficient-ore", "Not enough of that ore aboard."],
		["insufficient-credits", "Insufficient credits. Nothing has been taken."],
		[
			"queue-full",
			"All 8 job slots are occupied. Collect a finished job first.",
		],
		[
			"processing-offline",
			"Processing offline. Existing output can still be collected.",
		],
		[
			"stale-quote",
			"The quote changed. Review the updated quote before confirming.",
		],
		["not-refinery", "This station has no refinery service."],
		["nothing-to-collect", "No whole units are ready to collect."],
		["hold-full", "No room in the hold. Nothing was collected."],
	])("%s explains the refusal", (reason, sentence) => {
		expect(refineryRefusal(reason as RefineryRefusalReason)).toEqual({
			ok: false,
			reason: reason as RefineryRefusalReason,
			sentence,
		});
	});

	test("exactly enough ore and cash submits and spends both", () => {
		const quote = quoted();
		const account = acquire(emptyAccount(8), good, 2, money.fromNumber(3));
		const result = refinerySubmit({ account, queue: undefined, quote, at: 0 });
		if (!result.ok) throw new Error(result.sentence);
		expect(result.account.cash).toBe(signedMoney.fromNumber(0));
		expect(result.queue.jobs[0]).toEqual({ ...job(), unknownMass: "0" });
		expect(result.account.basis[good].heldMass).toBe(mass.fromTicks(0n));
		expect(account.cash).toBe(signedMoney.fromNumber(5));
	});

	test("a fractional ore manifest is refused", () => {
		expect(
			refineryQuote({
				station: key,
				queue: undefined,
				oreAboard: 2.5,
				cash: signedMoney.fromNumber(5),
				offline: false,
				good,
				tonnes: 2,
				feePerTonne: money.fromNumber(2.5),
			}),
		).toEqual(refineryRefusal("insufficient-ore"));
	});
	test("quote refuses a non-ore commodity", () => {
		expect(
			refineryQuote({
				station: key,
				queue: undefined,
				oreAboard: 2,
				cash: signedMoney.fromNumber(5),
				offline: false,
				good: "Food",
				tonnes: 2,
				feePerTonne: money.fromNumber(2.5),
			}),
		).toEqual(refineryRefusal("unknown-good"));
	});

	test.each([-1, NaN, Infinity])("invalid submission time %s throws", (at) => {
		expect(() =>
			refinerySubmit({
				account: emptyAccount(5),
				queue: undefined,
				quote: quoted(),
				at,
			}),
		).toThrow(`refinery: invalid settlement time ${at}`);
	});

	test.each([0, -1, 1.5, NaN, Infinity])(
		"invalid submitted quantity %s is refused",
		(tonnes) => {
			expect(
				refinerySubmit({
					account: emptyAccount(5),
					queue: undefined,
					quote: { ...quoted(), tonnes },
					at: 0,
				}),
			).toEqual(refineryRefusal("invalid-quantity"));
		},
	);

	test("unknown ore and insufficient credits are refused at submit", () => {
		const quote = quoted();
		expect(
			refinerySubmit({
				account: emptyAccount(5),
				queue: undefined,
				quote: { ...quote, good: "Food" },
				at: 0,
			}),
		).toEqual(refineryRefusal("unknown-good"));
		const account = acquire(emptyAccount(7), good, 2, money.fromNumber(3));
		expect(refinerySubmit({ account, queue: undefined, quote, at: 0 })).toEqual(
			refineryRefusal("insufficient-credits"),
		);
		expect(account.cash).toBe(signedMoney.fromNumber(4));
	});

	test("missing output pool refuses custody without mutating the account", () => {
		const account = acquire(emptyAccount(8), good, 2, money.fromNumber(3));
		const pools = { ...account.pools };
		delete pools.Minerals;
		expect(() =>
			refinerySubmit({
				account: { ...account, pools },
				queue: undefined,
				quote: quoted(),
				at: 0,
			}),
		).toThrow();
		expect(account.cash).toBe(signedMoney.fromNumber(5));
	});

	test.each([-1, NaN, Infinity])(
		"invalid operational duration %s throws",
		(seconds) => {
			expect(() => settleRefineryQueue(queue(), seconds, 1)).toThrow(
				`refinery: invalid operational duration ${seconds}`,
			);
		},
	);

	test.each([-1, NaN, Infinity])("invalid advance time %s throws", (at) => {
		expect(() => settleRefineryQueue(queue(), 1, at)).toThrow(
			`refinery: settlement time ${at} precedes the queue's cursor`,
		);
	});

	test("zero time retains jobs and a finished job leaves its budget to the next", () => {
		const original = queue();
		expect(settleRefineryQueue(original, 0, 0).jobs[0]).toBe(original.jobs[0]);
		const finished = { ...job(), work: 0 };
		const pending = job(2);
		const result = settleRefineryQueue(
			{ ...original, jobs: [finished, pending] },
			1,
			1,
		);
		expect(result.jobs[0]).toBe(finished);
		expect(result.jobs[1].work).toBe(1);
		expect(refineryFinished(finished)).toBe(true);
		expect(refineryFinished(pending)).toBe(false);
		expect(productUnits(800000, "Minerals")).toBe(0.8);
	});
});

describe("refinery saved-state validation", () => {
	test("encoding sorts station keys and round-trips a full queue", () => {
		const second = carrierKey(4, "station-01");
		const value = queue();
		const encoded = encodeRefineries({ [second]: value, [key]: value });
		expect(Object.keys(encoded)).toEqual([key, second]);
		expect(parseRefineries(encoded)).toEqual({ [key]: value, [second]: value });
		const full = {
			...value,
			nextJobId: 9,
			jobs: Array.from({ length: 8 }, (_, i) => job(i + 1)),
		};
		expect(parseRefineryQueue(encodeRefineryQueue(full))).toEqual(full);
		expect(
			parseRefineryQueue({ ...value, jobs: [{ ...job(), work: 0 }] }).jobs[0]
				.work,
		).toBe(0);
	});

	test.each([null, [], "queue", 1, undefined].map((value) => [value]))(
		"refuses a nonobject queue: %s",
		(value) => {
			expect(() => parseRefineryQueue(value)).toThrow(
				"refinery: refinery queue is not an object",
			);
		},
	);

	test.each([
		[{ ...queue(), extra: 1 }, "malformed refinery fields"],
		[
			{ accountedThrough: 0, nextJobId: 2, extra: [] },
			"malformed refinery fields",
		],
		[
			{ ...queue(), accountedThrough: "0" },
			"accountedThrough is not a finite number",
		],
		[
			{ ...queue(), accountedThrough: NaN },
			"accountedThrough is not a finite number",
		],
		[{ ...queue(), accountedThrough: -1 }, "queue cursor is negative"],
		[
			{ ...queue(), nextJobId: 0 },
			"nextJobId is not a whole number at or above 1",
		],
		[
			{ ...queue(), nextJobId: 2.5 },
			"nextJobId is not a whole number at or above 1",
		],
		[{ ...queue(), jobs: {} }, "queue jobs is not an array"],
		[
			{
				...queue(),
				nextJobId: 10,
				jobs: Array.from({ length: 9 }, (_, i) => job(i + 1)),
			},
			"queue holds more than 8 jobs",
		],
		[
			{ ...queue(), nextJobId: 3, jobs: [job(2), job(1)] },
			"queue jobs are not in submission order",
		],
		[
			{ ...queue(), jobs: [job(1), job(1)] },
			"queue jobs are not in submission order",
		],
	])("refuses malformed queue %#", (value, message) => {
		expect(() => parseRefineryQueue(value)).toThrow(`refinery: ${message}`);
	});

	test.each([
		[{ ...job(), id: 2 }, "job 2 is not below nextJobId 2"],
		[{ ...job(), good: 1 }, "job good is not a name"],
		[{ ...job(), good: "Food" }, "Food is not ore"],
		[{ ...job(), product: "Food" }, "job 1: Food is not Minerals"],
		[{ ...job(), outputGrams: 1 }, "job 1: output does not match its recipe"],
		[
			{ ...job(), basis: money.encode(money.fromNumber(4)) },
			"job 1: basis is below its fee",
		],
		[{ ...job(), work: -1 }, "job 1: work is outside its total"],
		[{ ...job(), work: 3 }, "job 1: work is outside its total"],
		[{ ...job(), totalWork: 3 }, "job 1: work is outside its total"],
	])("refuses malformed job %#", (value, message) => {
		expect(() => parseRefineryQueue({ ...queue(), jobs: [value] })).toThrow(
			`refinery: ${message}`,
		);
	});

	test("invalid station identity is refused before its queue", () => {
		expect(() => parseRefineries({ wrong: queue() })).toThrow(
			"refinery: wrong is not a carrier key",
		);
	});

	test("missing queue fields and nonobject jobs name their malformed boundary", () => {
		expect(() =>
			parseRefineryQueue({ accountedThrough: 0, nextJobId: 2 }),
		).toThrow("refinery: malformed refinery fields");
		expect(() => parseRefineryQueue({ ...queue(), jobs: [null] })).toThrow(
			"refinery: refinery job is not an object",
		);
		expect(() => parseRefineries(null)).toThrow(
			"refinery: refineries is not an object",
		);
	});
});

describe("saved custody boundaries", () => {
	const partial = () => ({
		...job(),
		taken: 200000,
		unknownMass: mass.encode(massFromNative(600000, 1)),
		basis: money.encode(money.fromNumber(1)),
	});
	const parse = (value: unknown) =>
		parseRefineryQueue({ ...queue(), jobs: [value] });

	test.each([
		[800000, "collected more than it made"],
		[800001, "collected more than it made"],
	])("refuses taken amount %i", (taken, message) => {
		expect(() => parse({ ...partial(), taken })).toThrow(
			`refinery: job 1: ${message}`,
		);
	});

	test("refuses partial output without custody and unknown mass beyond the remainder", () => {
		const { unknownMass: _unknown, ...legacy } = partial();
		expect(() => parse(legacy)).toThrow(
			"refinery: job 1: partial collection without custody",
		);
		expect(() =>
			parse({
				...partial(),
				unknownMass: mass.encode(massFromNative(600001, 1)),
			}),
		).toThrow("refinery: job 1: unknown mass exceeds its output");
	});

	test("accepts unknown mass exactly equal to the remainder and basis below the original paid fee", () => {
		expect(parse(partial()).jobs).toEqual([partial()]);
		const legacy = job();
		expect(Object.keys(parse(legacy).jobs[0])).not.toContain("unknownMass");
		expect(
			Object.keys(encodeRefineryQueue(parse(legacy)).jobs[0]),
		).not.toContain("unknownMass");
	});

	const balance = () => ({
		grams: 250,
		basis: money.encode(money.fromNumber(3)),
		unknownMass: mass.encode(massFromNative(250, 1)),
	});
	const pool = (value: unknown) =>
		parseRefineryQueue({ ...queue(), jobs: [], pool: value });

	test("pool products and unknown eligibility are validated with named refusals", () => {
		expect(() => pool(null)).toThrow(
			"refinery: refinery pool is not an object",
		);
		expect(() => pool({ Food: balance() })).toThrow(
			"refinery: Food is not a refined product",
		);
		expect(() => pool({ Platinum: null })).toThrow(
			"refinery: pool balance is not an object",
		);
		expect(() =>
			pool({
				Platinum: {
					...balance(),
					unknownMass: mass.encode(massFromNative(251, 1)),
				},
			}),
		).toThrow("refinery: Platinum: unknown exceeds balance");
		expect(pool({ Platinum: balance() }).pool).toEqual({ Platinum: balance() });
	});

	test("empty pools disappear while encoding orders products deterministically", () => {
		expect(Object.keys(pool({}))).not.toContain("pool");
		expect(
			Object.keys(encodeRefineryQueue({ ...queue(), pool: {} })),
		).not.toContain("pool");
		const balances = {
			Platinum: balance(),
			Alloys: balance(),
			Gold: balance(),
		};
		const wire = encodeRefineryQueue({ ...queue(), pool: balances });
		expect(Object.keys(wire.pool!)).toEqual(["Alloys", "Gold", "Platinum"]);
		expect(parseRefineryQueue(wire).pool).toEqual(balances);
	});
});
