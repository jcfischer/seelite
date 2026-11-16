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
	receiveCustody,
	sendToCustody,
	repoolUnknown,
	walletChange,
	type CommodityAccount,
} from "./commodity-pools";
import {
	mass,
	massFromNative,
	money,
	signedMoney,
	transferCost,
	type Mass,
	type Money,
	type SignedMoney,
} from "./exact-amount";
import { ORE_GOODS, oreGood } from "./ore-goods";

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
	unknownMass?: string;
	taken?: number;
}

/** Fractional output at one refinery, owned by the pilot and combined across jobs and grades (#917 D5). */
export interface RefineryPoolBalance {
	grams: number;
	basis: string;
	unknownMass: string;
}

export interface RefineryQueue {
	accountedThrough: number;
	nextJobId: number;
	jobs: readonly RefineryJob[];
	pool?: Readonly<Record<string, RefineryPoolBalance>>;
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
	| "not-refinery"
	| "nothing-to-collect"
	| "hold-full";

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
	"nothing-to-collect": "No whole units are ready to collect.",
	"hold-full": "No room in the hold. Nothing was collected.",
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
	// Stryker disable next-line ArithmeticOperator: Throughput is exactly 1; multiplying or dividing tonnes by 1 gives identical work.
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

const addFeeDebt = (
	account: CommodityAccount,
	product: string,
	fee: Money,
): CommodityAccount => {
	const pool = account.pools[product];
	return {
		...account,
		pools: {
			...account.pools,
			[product]: {
				...pool,
				unrecoveredCost: money.add(pool.unrecoveredCost, fee),
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
	const { account, share } = sendToCustody(input.account, quote.good, amount);
	const basis = money.add(share.cost, fee);
	const withCost = addFeeDebt(account, ore.product, fee);
	const paid = walletChange(
		withCost,
		signedMoney.fromTicks(-(fee as unknown as bigint)),
	);
	// Stryker disable next-line ArithmeticOperator: Throughput is exactly 1; multiplying or dividing tonnes by 1 gives identical work.
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
		unknownMass: mass.encode(share.unknownMass),
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

const remainingGrams = (job: RefineryJob): number =>
	job.outputGrams - (job.taken ?? 0);

export const refineryRemainingGrams = remainingGrams;

const gramsMass = (grams: number): Mass => massFromNative(grams, 1);

export interface RefineryCollectInput {
	account: CommodityAccount;
	queue: RefineryQueue | undefined;
	product: string;
	roomUnits: number;
}

export interface RefineryCollected {
	ok: true;
	account: CommodityAccount;
	queue: RefineryQueue;
	units: number;
}

const finishedJobs = (queue: RefineryQueue, product: string): RefineryJob[] =>
	queue.jobs.filter((job) => job.product === product && refineryFinished(job));

const collectableGrams = (queue: RefineryQueue, product: string): number =>
	(queue.pool?.[product]?.grams ?? 0) +
	finishedJobs(queue, product).reduce(
		(sum, job) => sum + remainingGrams(job),
		0,
	);

/** Whole native units of `product` collectable now: finished jobs plus its pooled balance. */
export function refineryCollectable(
	queue: RefineryQueue | undefined,
	product: string,
): number {
	if (!queue) return 0;
	return Math.floor(collectableGrams(queue, product) / nativeGrams(product));
}

interface Source {
	grams: number;
	basis: Money;
	unknown: Mass;
}

const poolWith = (
	pool: Readonly<Record<string, RefineryPoolBalance>> | undefined,
	product: string,
	add: Source,
): Record<string, RefineryPoolBalance> => {
	const held = pool?.[product];
	return {
		...pool,
		[product]: {
			grams: (held?.grams ?? 0) + add.grams,
			basis: money.encode(
				money.add(
					held ? money.parse(held.basis) : money.fromTicks(0n),
					add.basis,
				),
			),
			unknownMass: mass.encode(
				mass.add(
					held ? mass.parse(held.unknownMass) : mass.fromTicks(0n),
					add.unknown,
				),
			),
		},
	};
};

/**
 * Collect finished output in whole native units, partially when the hold is
 * short; any fraction stays owned at this refinery (#921 D5, #917 D5).
 *
 * Only physical material and its basis move. The commander-wide pools do not
 * (#935 D2, D16), so the order of two collections cannot change the trading
 * rating. A job saved before custody kept its pools has its output joined to
 * them first, all of it unknown-cost (the principal's ruling of 2026-11-16).
 */
export function refineryCollect(
	input: RefineryCollectInput,
): RefineryCollected | RefineryRefusal {
	const { product } = input;
	const queue = input.queue;
	if (!queue) return refineryRefusal("nothing-to-collect");
	const unit = nativeGrams(product);
	let account = input.account;
	let pool = queue.pool;
	const none = mass.fromTicks(0n);

	const touched = new Set(finishedJobs(queue, product).map((job) => job.id));
	const whole = Math.floor(collectableGrams(queue, product) / unit);
	const take = Math.min(whole, Math.max(0, Math.floor(input.roomUnits)));
	if (take === 0) {
		if (whole > 0) return refineryRefusal("hold-full");
		if (touched.size === 0) return refineryRefusal("nothing-to-collect");
	}

	let jobs = queue.jobs.map((job) => {
		if (!touched.has(job.id) || job.unknownMass !== undefined) return job;
		const left = gramsMass(remainingGrams(job));
		account = repoolUnknown(account, product, left);
		return { ...job, unknownMass: mass.encode(left) };
	});

	const toPool = (job: RefineryJob) => {
		const remaining = remainingGrams(job);
		pool = poolWith(pool, product, {
			grams: remaining,
			basis: money.parse(job.basis),
			unknown: mass.parse(job.unknownMass!),
		});
	};
	const foldSmall = () => {
		const keep: RefineryJob[] = [];
		for (const job of jobs) {
			if (
				job.product === product &&
				refineryFinished(job) &&
				remainingGrams(job) < unit
			)
				toPool(job);
			else keep.push(job);
		}
		jobs = keep;
	};
	foldSmall();

	let need = take * unit;
	let cost = money.fromTicks(0n);
	let unknown = none;
	const draw = (source: Source, drawn: number) => {
		const share = transferCost(
			source.basis,
			gramsMass(drawn),
			gramsMass(source.grams),
		).moved;
		const movedUnknown =
			// Stryker disable next-line EqualityOperator: Equal masses select the same bigint in both arms; https://github.com/jcfischer/seelite/issues/935
			source.unknown < gramsMass(drawn) ? source.unknown : gramsMass(drawn);
		cost = money.add(cost, share);
		unknown = mass.add(unknown, movedUnknown);
		return { share, movedUnknown };
	};
	jobs = jobs.flatMap((job) => {
		if (need <= 0 || job.product !== product || !refineryFinished(job))
			return [job];
		const remaining = remainingGrams(job);
		const drawn = Math.min(need, remaining);
		const { share, movedUnknown } = draw(
			{
				grams: remaining,
				basis: money.parse(job.basis),
				unknown: mass.parse(job.unknownMass!),
			},
			drawn,
		);
		need -= drawn;
		if (drawn === remaining) return [];
		return [
			{
				...job,
				taken: (job.taken ?? 0) + drawn,
				basis: money.encode(money.subtract(money.parse(job.basis), share)),
				unknownMass: mass.encode(
					mass.subtract(mass.parse(job.unknownMass!), movedUnknown),
				),
			},
		];
	});
	const held = pool?.[product];
	const drawn = Math.min(need, held?.grams ?? 0);
	if (drawn > 0) {
		const { share, movedUnknown } = draw(
			{
				grams: held!.grams,
				basis: money.parse(held!.basis),
				unknown: mass.parse(held!.unknownMass),
			},
			drawn,
		);
		need -= drawn;
		const { [product]: _gone, ...rest } = pool!;
		pool =
			drawn === held!.grams
				? rest
				: {
						...rest,
						[product]: {
							grams: held!.grams - drawn,
							basis: money.encode(
								money.subtract(money.parse(held!.basis), share),
							),
							unknownMass: mass.encode(
								mass.subtract(mass.parse(held!.unknownMass), movedUnknown),
							),
						},
					};
	}
	if (need > 0) fail(`collection fell ${need} g short of its own count`);
	foldSmall();
	if (take > 0)
		account = receiveCustody(
			account,
			product,
			massFromNative(take, unit),
			unknown,
			cost,
		);
	const next: RefineryQueue = {
		accountedThrough: queue.accountedThrough,
		nextJobId: queue.nextJobId,
		jobs,
		...(pool && Object.keys(pool).length ? { pool } : {}),
	};
	return { ok: true, account, queue: next, units: take };
}

/** The whole queue as a console row's work, for display only. */
export const refineryFinished = (job: RefineryJob): boolean => job.work <= 0;

const asObject = (raw: unknown, what: string): Record<string, unknown> => {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw))
		fail(`${what} is not an object`);
	return raw as Record<string, unknown>;
};

const keysWithin = (
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
) => {
	const actual = Object.keys(value);
	if (
		required.some((key) => !actual.includes(key)) ||
		actual.some((key) => !required.includes(key) && !optional.includes(key))
	)
		fail("malformed refinery fields");
};

const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
	keysWithin(value, expected, []);

const finite = (raw: Record<string, unknown>, field: string): number => {
	const value = raw[field];
	if (!Number.isFinite(value)) fail(`${field} is not a finite number`);
	return value as number;
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
	...(job.unknownMass !== undefined ? { unknownMass: job.unknownMass } : {}),
	...(job.taken ? { taken: job.taken } : {}),
});

const encodePool = (
	pool: Readonly<Record<string, RefineryPoolBalance>>,
): Record<string, RefineryPoolBalance> => {
	const out: Record<string, RefineryPoolBalance> = {};
	for (const product of Object.keys(pool).sort())
		out[product] = {
			grams: pool[product].grams,
			basis: pool[product].basis,
			unknownMass: pool[product].unknownMass,
		};
	return out;
};

export const encodeRefineryQueue = (queue: RefineryQueue) => ({
	accountedThrough: queue.accountedThrough,
	nextJobId: queue.nextJobId,
	jobs: queue.jobs.map(encodeJob),
	...(queue.pool && Object.keys(queue.pool).length
		? { pool: encodePool(queue.pool) }
		: {}),
});

export const encodeRefineries = (state: RefineryState) => {
	const out: Record<string, unknown> = {};
	for (const key of (Object.keys(state) as CarrierKey[]).sort())
		out[key] = encodeRefineryQueue(state[key]);
	return out;
};

function parseJob(raw: unknown, nextJobId: number): RefineryJob {
	const o = asObject(raw, "refinery job");
	keysWithin(
		o,
		[
			"id",
			"good",
			"tonnes",
			"product",
			"outputGrams",
			"fee",
			"basis",
			"work",
			"totalWork",
		],
		["unknownMass", "taken"],
	);
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
	const taken = o.taken === undefined ? 0 : whole(o, "taken", 1);
	if (taken >= outputGrams) fail(`job ${id}: collected more than it made`);
	if (taken === 0 && (basis as unknown as bigint) < (fee as unknown as bigint))
		fail(`job ${id}: basis is below its fee`);
	let unknownMass: string | undefined;
	if (o.unknownMass !== undefined) {
		const unknown = mass.parse(o.unknownMass);
		if (unknown > gramsMass(outputGrams - taken))
			fail(`job ${id}: unknown mass exceeds its output`);
		unknownMass = mass.encode(unknown);
	} else if (taken > 0) fail(`job ${id}: partial collection without custody`);
	const work = finite(o, "work");
	const totalWork = finite(o, "totalWork");
	if (
		work < 0 ||
		work > totalWork ||
		// Stryker disable next-line ArithmeticOperator: Throughput is exactly 1; multiplying or dividing tonnes by 1 gives identical work.
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
		...(unknownMass !== undefined ? { unknownMass } : {}),
		...(taken > 0 ? { taken } : {}),
	};
}

const POOL_PRODUCTS = new Set(ORE_GOODS.map((g) => g.product));

function parsePool(raw: unknown): Record<string, RefineryPoolBalance> {
	const o = asObject(raw, "refinery pool");
	const out: Record<string, RefineryPoolBalance> = {};
	for (const [product, value] of Object.entries(o)) {
		if (!POOL_PRODUCTS.has(product as never))
			fail(`${product} is not a refined product`);
		const b = asObject(value, "pool balance");
		keys(b, ["grams", "basis", "unknownMass"]);
		const grams = whole(b, "grams", 1);
		const unknown = mass.parse(b.unknownMass);
		if (unknown > gramsMass(grams)) fail(`${product}: unknown exceeds balance`);
		out[product] = {
			grams,
			basis: money.encode(money.parse(b.basis)),
			unknownMass: mass.encode(unknown),
		};
	}
	return out;
}

export function parseRefineryQueue(raw: unknown): RefineryQueue {
	const o = asObject(raw, "refinery queue");
	keysWithin(o, ["accountedThrough", "nextJobId", "jobs"], ["pool"]);
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
	const pool = o.pool === undefined ? undefined : parsePool(o.pool);
	return {
		accountedThrough,
		nextJobId,
		jobs,
		...(pool && Object.keys(pool).length ? { pool } : {}),
	};
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
