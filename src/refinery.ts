/**
 * Refinery services: a quoted job, paid once, processed in one FIFO queue
 * (node #1195).
 *
 * The decisions are #921 D1-D4, D6-D9 and D11, the recipes are #917's, the fee
 * share and throughput are #923's ratified table, and the transaction is
 * #936's `SaveStore.commit`. This module owns the queue's arithmetic and its
 * wire shape. It imports no world or renderer: the world's own settlement
 * boundary calls `settleRefineryQueue`, and the console prices a quote through
 * `refinery-pricing.ts`.
 *
 * **The queue is world custody, not a commander field.** A paid job survives a
 * ship loss because the world survives one, and the queue is settled inside
 * `advanceTo` before a raider boundary can replace the retained capability
 * interval. A commander field would have had to be settled from outside every
 * world mutation, which is the opt-in-on-submission failure #1194 names.
 *
 * https://github.com/jcfischer/seelite/issues/1195
 */

import {
	type CarrierKey,
	carrierKey,
	isCarrierKey,
	localCarrierIdOfKey,
	systemIndexOfKey,
} from "./carrier-key";
import {
	nativeGrams,
	removeMass,
	walletChange,
	type CommodityAccount,
} from "./commodity-pools";
import {
	massFromNative,
	money,
	signedMoney,
	type Money,
	type SignedMoney,
} from "./exact-amount";
import { oreGood } from "./ore-goods";

/** Approved throughput, one operational second per input tonne (#923). */
export const REFINERY_SECONDS_PER_TONNE = 1;
/** Approved fee, 35% of the product's market value (#923). */
export const REFINERY_FEE_PERCENT = 35n;
/** #921 D2: eight outstanding jobs, finished-but-uncollected included. */
export const REFINERY_JOB_LIMIT = 8;

function fail(message: string): never {
	throw new Error(`refinery: ${message}`);
}

export interface RefineryJob {
	id: number;
	good: string;
	tonnes: number;
	product: string;
	outputGrams: number;
	fee: string;
	basis: string;
	work: number;
	totalWork: number;
}

export interface RefineryQueue {
	accountedThrough: number;
	nextJobId: number;
	jobs: readonly RefineryJob[];
}

export type RefineryState = Readonly<Record<CarrierKey, RefineryQueue>>;

export interface RefineryQuote {
	station: CarrierKey;
	good: string;
	tonnes: number;
	product: string;
	outputGrams: number;
	fee: string;
	position: number;
	workAhead: number;
	signature: string;
}

export type RefineryRefusalReason =
	| "invalid-quantity"
	| "unknown-good"
	| "insufficient-ore"
	| "insufficient-credits"
	| "queue-full"
	| "processing-offline"
	| "stale-quote"
	| "not-refinery";

export interface RefineryRefusal {
	ok: false;
	reason: RefineryRefusalReason;
	sentence: string;
}

export interface RefineryQuoteResult {
	ok: true;
	quote: RefineryQuote;
}

const REFUSAL: Readonly<Record<RefineryRefusalReason, string>> = {
	"invalid-quantity": "Choose a positive whole-tonne quantity.",
	"unknown-good": "That is not ore.",
	"insufficient-ore": "Not enough of that ore aboard.",
	"insufficient-credits": "Insufficient credits. Nothing has been taken.",
	"queue-full": "All 8 job slots are occupied. Collect a finished job first.",
	"processing-offline":
		"Processing offline. Existing output can still be collected.",
	"stale-quote":
		"The quote changed. Review the updated quote before confirming.",
	"not-refinery": "This station has no refinery service.",
};

export const refineryRefusal = (
	reason: RefineryRefusalReason,
): RefineryRefusal => ({
	ok: false,
	reason,
	sentence: REFUSAL[reason],
});

/** The fee for one input tonne: 35% of that tonne's output at this market. */
export function refineryFeePerTonne(unitValue: Money): Money {
	return money.fromTicks(
		((unitValue as unknown as bigint) * REFINERY_FEE_PERCENT) / 100n,
	);
}

/** The capability slot whose outage pauses this refinery's queue (#921 D8). */
export const exclusiveCapabilityKey = (stationKey: CarrierKey): CarrierKey =>
	carrierKey(
		systemIndexOfKey(stationKey),
		`${localCarrierIdOfKey(stationKey)}/capability/exclusive`,
	);

export const emptyRefineryQueue = (at: number): RefineryQueue => ({
	accountedThrough: at,
	nextJobId: 1,
	jobs: [],
});

/** The position a new job would take: behind every unfinished job. */
export const refineryPosition = (queue: RefineryQueue): number =>
	queue.jobs.filter((job) => job.work > 0).length + 1;

export const refineryWorkAhead = (
	queue: RefineryQueue,
	tonnes: number,
): number =>
	queue.jobs.reduce((sum, job) => sum + job.work, 0) +
	tonnes * REFINERY_SECONDS_PER_TONNE;

const quoteSignature = (quote: Omit<RefineryQuote, "signature">): string =>
	JSON.stringify([
		quote.station,
		quote.good,
		quote.tonnes,
		quote.product,
		quote.outputGrams,
		quote.fee,
		quote.position,
	]);

export interface RefineryQuoteInput {
	station: CarrierKey;
	queue: RefineryQueue | undefined;
	oreAboard: number;
	cash: SignedMoney;
	offline: boolean;
	good: string;
	tonnes: number;
	feePerTonne: Money;
}

/** Price one whole-tonne job, refusing before anything moves. */
export function refineryQuote(
	input: RefineryQuoteInput,
): RefineryQuoteResult | RefineryRefusal {
	const { station, good, tonnes } = input;
	if (!Number.isSafeInteger(tonnes) || tonnes < 1)
		return refineryRefusal("invalid-quantity");
	const ore = oreGood(good);
	if (!ore) return refineryRefusal("unknown-good");
	if (!Number.isSafeInteger(input.oreAboard) || input.oreAboard < tonnes)
		return refineryRefusal("insufficient-ore");
	if (input.offline) return refineryRefusal("processing-offline");
	const queue = input.queue ?? emptyRefineryQueue(0);
	if (queue.jobs.length >= REFINERY_JOB_LIMIT)
		return refineryRefusal("queue-full");
	const fee = money.fromTicks(
		(input.feePerTonne as unknown as bigint) * BigInt(tonnes),
	);
	if ((input.cash as unknown as bigint) < (fee as unknown as bigint))
		return refineryRefusal("insufficient-credits");
	const unsigned = {
		station,
		good,
		tonnes,
		product: ore.product,
		outputGrams: ore.yieldGPerT * tonnes,
		fee: money.encode(fee),
		position: refineryPosition(queue),
		workAhead: refineryWorkAhead(queue, tonnes),
	};
	return {
		ok: true,
		quote: { ...unsigned, signature: quoteSignature(unsigned) },
	};
}

export interface RefinerySubmitInput {
	account: CommodityAccount;
	queue: RefineryQueue | undefined;
	quote: RefineryQuote;
	at: number;
}

export interface RefinerySubmitted {
	ok: true;
	account: CommodityAccount;
	queue: RefineryQueue;
}

const addCustodyCost = (
	account: CommodityAccount,
	product: string,
	cost: Money,
): CommodityAccount => {
	const pool = account.pools[product];
	if (!pool) fail(`${product} is not a commodity pool`);
	return {
		...account,
		pools: {
			...account.pools,
			[product]: {
				...pool,
				unrecoveredCost: money.add(pool.unrecoveredCost, cost),
			},
		},
	};
};

/**
 * Take the ore and the fee into one job, or refuse without moving either.
 *
 * The queue's caller has already settled it to `at` (the world's advance does
 * that before any submission), so new work cannot receive old service time.
 */
export function refinerySubmit(
	input: RefinerySubmitInput,
): RefinerySubmitted | RefineryRefusal {
	const { quote, at } = input;
	if (!Number.isFinite(at) || at < 0) fail(`invalid settlement time ${at}`);
	const ore = oreGood(quote.good);
	if (!ore) return refineryRefusal("unknown-good");
	if (!Number.isSafeInteger(quote.tonnes) || quote.tonnes < 1)
		return refineryRefusal("invalid-quantity");
	const queue = input.queue ?? emptyRefineryQueue(at);
	if (queue.jobs.length >= REFINERY_JOB_LIMIT)
		return refineryRefusal("queue-full");
	if (refineryPosition(queue) !== quote.position)
		return refineryRefusal("stale-quote");
	const amount = massFromNative(quote.tonnes, 1000000);
	const held = input.account.basis[quote.good]?.heldMass ?? 0n;
	if (held < amount) return refineryRefusal("insufficient-ore");
	const fee = money.parse(quote.fee);
	if ((input.account.cash as unknown as bigint) < (fee as unknown as bigint))
		return refineryRefusal("insufficient-credits");
	const { account, share } = removeMass(input.account, quote.good, amount);
	const basis = money.add(share.cost, fee);
	const withCost = addCustodyCost(account, ore.product, basis);
	const paid = walletChange(
		withCost,
		signedMoney.fromTicks(-(fee as unknown as bigint)),
	);
	const totalWork = quote.tonnes * REFINERY_SECONDS_PER_TONNE;
	const job: RefineryJob = {
		id: queue.nextJobId,
		good: quote.good,
		tonnes: quote.tonnes,
		product: ore.product,
		outputGrams: ore.yieldGPerT * quote.tonnes,
		fee: money.encode(fee),
		basis: money.encode(basis),
		work: totalWork,
		totalWork,
	};
	return {
		ok: true,
		account: paid,
		queue: {
			accountedThrough: at,
			nextJobId: queue.nextJobId + 1,
			jobs: [...queue.jobs, job],
		},
	};
}

/**
 * Spend operational seconds on the unfinished jobs in submission order.
 *
 * A finished job keeps its slot and its cost (D2, D9); it simply stops taking
 * a budget the next job can use. `at` moves the settled cursor whether or not
 * any job was left, because an empty queue discards service time.
 */
export function settleRefineryQueue(
	queue: RefineryQueue,
	operationalSeconds: number,
	at: number,
): RefineryQueue {
	if (!Number.isFinite(operationalSeconds) || operationalSeconds < 0)
		fail(`invalid operational duration ${operationalSeconds}`);
	if (!Number.isFinite(at) || at < queue.accountedThrough)
		fail(`settlement time ${at} precedes the queue's cursor`);
	let budget = operationalSeconds;
	const jobs = queue.jobs.map((job) => {
		if (budget <= 0 || job.work <= 0) return job;
		const taken = Math.min(job.work, budget);
		budget -= taken;
		return { ...job, work: job.work - taken };
	});
	return { ...queue, accountedThrough: at, jobs };
}

/** The whole queue as a console row's work, for display only. */
export const refineryFinished = (job: RefineryJob): boolean => job.work <= 0;

const asObject = (raw: unknown, what: string): Record<string, unknown> => {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		fail(`${what} is not an object`);
	return raw as Record<string, unknown>;
};

const keys = (value: Record<string, unknown>, expected: readonly string[]) => {
	const actual = Object.keys(value);
	if (
		actual.length !== expected.length ||
		actual.some((key) => !expected.includes(key))
	)
		fail("malformed refinery fields");
};

const finite = (raw: Record<string, unknown>, field: string): number => {
	const value = raw[field];
	if (typeof value !== "number" || !Number.isFinite(value))
		fail(`${field} is not a finite number`);
	return value;
};

const whole = (
	raw: Record<string, unknown>,
	field: string,
	min: number,
): number => {
	const value = finite(raw, field);
	if (!Number.isSafeInteger(value) || value < min)
		fail(`${field} is not a whole number at or above ${min}`);
	return value;
};

const encodeJob = (job: RefineryJob) => ({
	id: job.id,
	good: job.good,
	tonnes: job.tonnes,
	product: job.product,
	outputGrams: job.outputGrams,
	fee: job.fee,
	basis: job.basis,
	work: job.work,
	totalWork: job.totalWork,
});

export const encodeRefineryQueue = (queue: RefineryQueue) => ({
	accountedThrough: queue.accountedThrough,
	nextJobId: queue.nextJobId,
	jobs: queue.jobs.map(encodeJob),
});

export const encodeRefineries = (state: RefineryState) => {
	const out: Record<string, unknown> = {};
	for (const key of (Object.keys(state) as CarrierKey[]).sort())
		out[key] = encodeRefineryQueue(state[key]);
	return out;
};

function parseJob(raw: unknown, nextJobId: number): RefineryJob {
	const o = asObject(raw, "refinery job");
	keys(o, [
		"id",
		"good",
		"tonnes",
		"product",
		"outputGrams",
		"fee",
		"basis",
		"work",
		"totalWork",
	]);
	const id = whole(o, "id", 1);
	if (id >= nextJobId) fail(`job ${id} is not below nextJobId ${nextJobId}`);
	const good = o.good;
	if (typeof good !== "string") fail("job good is not a name");
	const ore = oreGood(good);
	if (!ore) fail(`${good} is not ore`);
	const tonnes = whole(o, "tonnes", 1);
	if (o.product !== ore.product)
		fail(`job ${id}: ${String(o.product)} is not ${ore.product}`);
	const outputGrams = whole(o, "outputGrams", 1);
	if (outputGrams !== ore.yieldGPerT * tonnes)
		fail(`job ${id}: output does not match its recipe`);
	const fee = money.parse(o.fee);
	const basis = money.parse(o.basis);
	if ((basis as unknown as bigint) < (fee as unknown as bigint))
		fail(`job ${id}: basis is below its fee`);
	const work = finite(o, "work");
	const totalWork = finite(o, "totalWork");
	if (
		work < 0 ||
		work > totalWork ||
		totalWork !== tonnes * REFINERY_SECONDS_PER_TONNE
	)
		fail(`job ${id}: work is outside its total`);
	return {
		id,
		good,
		tonnes,
		product: ore.product,
		outputGrams,
		fee: money.encode(fee),
		basis: money.encode(basis),
		work,
		totalWork,
	};
}

export function parseRefineryQueue(raw: unknown): RefineryQueue {
	const o = asObject(raw, "refinery queue");
	keys(o, ["accountedThrough", "nextJobId", "jobs"]);
	const accountedThrough = finite(o, "accountedThrough");
	if (accountedThrough < 0) fail("queue cursor is negative");
	const nextJobId = whole(o, "nextJobId", 1);
	if (!Array.isArray(o.jobs)) fail("queue jobs is not an array");
	if (o.jobs.length > REFINERY_JOB_LIMIT)
		fail(`queue holds more than ${REFINERY_JOB_LIMIT} jobs`);
	const jobs = o.jobs.map((job) => parseJob(job, nextJobId));
	let previous = 0;
	for (const job of jobs) {
		if (job.id <= previous) fail("queue jobs are not in submission order");
		previous = job.id;
	}
	return { accountedThrough, nextJobId, jobs };
}

export function parseRefineries(raw: unknown): RefineryState {
	const o = asObject(raw, "refineries");
	const out: Record<CarrierKey, RefineryQueue> = {};
	for (const [key, value] of Object.entries(o)) {
		if (!isCarrierKey(key)) fail(`${key} is not a carrier key`);
		out[key as CarrierKey] = parseRefineryQueue(value);
	}
	return out;
}

/** Display-only: native units of an output, in the product's own unit. */
export function productUnits(outputGrams: number, product: string): number {
	return outputGrams / nativeGrams(product);
}
