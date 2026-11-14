import { COMMODITIES } from "./market";
import {
	mass,
	money,
	signedMoney,
	massFromNative,
	quoteMass,
	transferCost,
	type Mass,
	type Money,
	type SignedMoney,
	type PriceQuote,
} from "./exact-amount";

export interface CommodityPool {
	readonly totalMass: Mass;
	readonly unknownMass: Mass;
	readonly unrecoveredCost: Money;
}
export interface PhysicalBasis {
	readonly legacyCost: Money;
	readonly heldMass: Mass;
	readonly knownMass: Mass;
	readonly cost: Money;
}
export interface CommodityAccount {
	readonly cash: SignedMoney;
	readonly bankedTrade: Money;
	readonly pools: Readonly<Record<string, CommodityPool>>;
	readonly basis: Readonly<Record<string, PhysicalBasis>>;
}
export interface RemovedShare {
	readonly totalMass: Mass;
	readonly unknownMass: Mass;
	readonly knownMass: Mass;
	readonly cost: Money;
}
export const COMMODITY_POOL_IDS = [
	"Food",
	"Textiles",
	"Radioactives",
	"Slaves",
	"Liquor/Wines",
	"Luxuries",
	"Narcotics",
	"Computers",
	"Machinery",
	"Alloys",
	"Firearms",
	"Furs",
	"Minerals",
	"Gold",
	"Platinum",
	"Gem-Stones",
	"Alien Items",
] as const;
const knownGood = (good: string) =>
	(COMMODITY_POOL_IDS.some((id) => id === good)
		? COMMODITIES.find((g) => g.name === good)
		: undefined) ?? refuse(`${good} is not a commodity`);
export const nativeGrams = (good: string): number =>
	({ t: 1000000, kg: 1000, g: 1 })[knownGood(good).unit];
const zeroMass = mass.fromTicks(0n);
const zeroMoney = money.fromTicks(0n);
const emptyPool = (): CommodityPool => ({
	totalMass: zeroMass,
	unknownMass: zeroMass,
	unrecoveredCost: zeroMoney,
});
const emptyBasis = (): PhysicalBasis => ({
	legacyCost: zeroMoney,
	heldMass: zeroMass,
	knownMass: zeroMass,
	cost: zeroMoney,
});
const minimum = <T extends bigint>(a: T, b: T): T => (a < b ? a : b);
export class CommodityAccountingError extends Error {
	constructor(reason: string) {
		super(`commodity accounting: ${reason}`);
		this.name = "CommodityAccountingError";
	}
}
const refuse = (why: string): never => {
	throw new CommodityAccountingError(why);
};
const quantity = (good: string, units: number) =>
	massFromNative(units, nativeGrams(good));

/** Rounded presentation only, including values without a binary64 preimage. */
export function displayAmount(
	ticks: bigint,
	dimension: "money" | "mass" = "money",
	nativeDivisor = 1,
): number {
	const negative = ticks < 0n,
		n = negative ? -ticks : ticks;
	if (!n) return 0;
	const scale = dimension === "money" ? 2156 : 1074;
	const odd = (dimension === "money" ? 15625n : 1n) * BigInt(nativeDivisor);
	let exponent = n.toString(2).length - odd.toString(2).length - scale;
	const power = exponent + scale;
	if (power >= 0 ? n < odd << BigInt(power) : n << BigInt(-power) < odd)
		exponent--;
	const unit = Math.max(-1074, exponent - 52),
		shift = scale + unit;
	const numerator = shift < 0 ? n << BigInt(-shift) : n;
	const denominator = shift < 0 ? odd : odd << BigInt(shift);
	let q = numerator / denominator;
	const remainder = numerator % denominator;
	if (
		remainder * 2n > denominator ||
		(remainder * 2n === denominator && q & 1n)
	)
		q++;
	return (
		(negative ? -1 : 1) * Math.min(Number.MAX_VALUE, Number(q) * 2 ** unit)
	);
}

const EMPTY_POOLS = Object.freeze(
	Object.fromEntries(
		COMMODITY_POOL_IDS.map((name) => [name, Object.freeze(emptyPool())]),
	),
);
export function emptyAccount(cash = 100): CommodityAccount {
	return {
		cash: signedMoney.fromNumber(cash),
		bankedTrade: zeroMoney,
		pools: EMPTY_POOLS,
		basis: {},
	};
}

export function migrateAccount(
	cash: number,
	banked: number,
	cargo: Readonly<Record<string, number>>,
	recorded: Readonly<Record<string, { units: number; cr: number }>>,
): CommodityAccount {
	let account = {
		...emptyAccount(cash),
		bankedTrade: money.fromNumber(banked),
	};
	const pools = { ...account.pools };
	const basis: Record<string, PhysicalBasis> = {};
	for (const good of new Set([
		...Object.keys(cargo),
		...Object.keys(recorded),
	])) {
		const held = quantity(good, cargo[good] ?? 0);
		const known = quantity(good, recorded[good]?.units ?? 0);
		const cost = money.fromNumber(recorded[good]?.cr ?? 0);
		if (known > held) refuse(`${good}: basis exceeds held quantity`);
		pools[good] = {
			totalMass: held,
			unknownMass: mass.subtract(held, known),
			unrecoveredCost: cost,
		};
		basis[good] = {
			heldMass: held,
			knownMass: known,
			cost,
			legacyCost: known === 0n ? cost : zeroMoney,
		};
	}
	account = { ...account, pools, basis };
	return account;
}

export function acquire(
	a: CommodityAccount,
	good: string,
	units: number,
	cost: Money = zeroMoney,
): CommodityAccount {
	const amount = quantity(good, units),
		p = a.pools[good],
		b = a.basis[good] ?? emptyBasis();
	money.fromTicks(cost);
	return {
		...a,
		cash: signedMoney.subtract(a.cash, cost),
		pools: {
			...a.pools,
			[good]: {
				...p,
				totalMass: mass.add(p.totalMass, amount),
				unrecoveredCost: money.add(p.unrecoveredCost, cost),
			},
		},
		basis: {
			...a.basis,
			[good]: {
				legacyCost: b.legacyCost,
				heldMass: mass.add(b.heldMass, amount),
				knownMass: mass.add(b.knownMass, amount),
				cost: money.add(b.cost, cost),
			},
		},
	};
}

/** Processing changes neither eligibility mass nor custody; its actual fee adds debt. */
export function charge(
	a: CommodityAccount,
	good: string,
	fee: Money,
): CommodityAccount {
	knownGood(good);
	const p = a.pools[good],
		b = a.basis[good] ?? emptyBasis();
	return {
		...a,
		cash: signedMoney.subtract(a.cash, fee),
		pools: {
			...a.pools,
			[good]: { ...p, unrecoveredCost: money.add(p.unrecoveredCost, fee) },
		},
		basis: {
			...a.basis,
			[good]: { ...b, knownMass: b.heldMass, cost: money.add(b.cost, fee) },
		},
	};
}

export function remove(
	a: CommodityAccount,
	good: string,
	units: number,
): { account: CommodityAccount; share: RemovedShare } {
	return removeMass(a, good, quantity(good, units));
}

export function removeMass(
	a: CommodityAccount,
	good: string,
	amount: Mass,
): { account: CommodityAccount; share: RemovedShare } {
	mass.fromTicks(amount);
	knownGood(good);
	const p = a.pools[good],
		b = a.basis[good] ?? emptyBasis();
	if (amount > p.totalMass || amount > b.heldMass)
		refuse(`${good}: removal exceeds owned quantity`);
	const unknown = minimum(p.unknownMass, amount);
	const physicalUnknown = mass.subtract(b.heldMass, b.knownMass);
	const known = mass.subtract(amount, minimum(physicalUnknown, amount));
	const allocation =
		b.knownMass === 0n
			? { moved: zeroMoney, retained: b.cost }
			: transferCost(money.subtract(b.cost, b.legacyCost), known, b.knownMass);
	return {
		account: {
			...a,
			pools: {
				...a.pools,
				[good]: {
					...p,
					totalMass: mass.subtract(p.totalMass, amount),
					unknownMass: mass.subtract(p.unknownMass, unknown),
				},
			},
			basis: {
				...a.basis,
				[good]: {
					legacyCost: b.legacyCost,
					heldMass: mass.subtract(b.heldMass, amount),
					knownMass: mass.subtract(b.knownMass, known),
					cost:
						b.knownMass === 0n
							? allocation.retained
							: money.add(allocation.retained, b.legacyCost),
				},
			},
		},
		share: {
			totalMass: amount,
			unknownMass: unknown,
			knownMass: known,
			cost: allocation.moved,
		},
	};
}

export function sell(
	a: CommodityAccount,
	good: string,
	units: number,
	quote: PriceQuote,
): CommodityAccount {
	const { account, share } = remove(a, good, units);
	const p = account.pools[good];
	const proceeds = quoteMass(quote, share.totalMass, nativeGrams(good));
	const eligible = quoteMass(
		quote,
		mass.subtract(share.totalMass, share.unknownMass),
		nativeGrams(good),
	);
	const recovered = minimum(p.unrecoveredCost, eligible);
	return {
		...account,
		cash: signedMoney.add(a.cash, proceeds),
		bankedTrade: money.add(a.bankedTrade, money.subtract(eligible, recovered)),
		pools: {
			...account.pools,
			[good]: {
				...p,
				unrecoveredCost: money.subtract(p.unrecoveredCost, recovered),
			},
		},
	};
}

export function recover(
	a: CommodityAccount,
	good: string,
	share: RemovedShare,
	units: number,
): { account: CommodityAccount; remaining: RemovedShare } {
	const amount =
			units === displayAmount(share.totalMass, "mass", nativeGrams(good))
				? share.totalMass
				: quantity(good, units),
		p = a.pools[good],
		b = a.basis[good] ?? emptyBasis();
	mass.fromTicks(share.totalMass);
	mass.fromTicks(share.unknownMass);
	mass.fromTicks(share.knownMass);
	money.fromTicks(share.cost);
	if (
		share.unknownMass > share.totalMass ||
		share.knownMass > share.totalMass ||
		amount > share.totalMass
	)
		refuse("invalid recovery share");
	const unknown = minimum(share.unknownMass, amount);
	const physicalUnknown = mass.subtract(share.totalMass, share.knownMass);
	const known = mass.subtract(amount, minimum(physicalUnknown, amount));
	const allocation =
		share.knownMass === 0n
			? {
					moved: amount === share.totalMass ? share.cost : zeroMoney,
					retained: amount === share.totalMass ? zeroMoney : share.cost,
				}
			: transferCost(share.cost, known, share.knownMass);
	return {
		account: {
			...a,
			pools: {
				...a.pools,
				[good]: {
					...p,
					totalMass: mass.add(p.totalMass, amount),
					unknownMass: mass.add(p.unknownMass, unknown),
				},
			},
			basis: {
				...a.basis,
				[good]: {
					legacyCost: b.legacyCost,
					heldMass: mass.add(b.heldMass, amount),
					knownMass: mass.add(b.knownMass, known),
					cost: money.add(b.cost, allocation.moved),
				},
			},
		},
		remaining: {
			totalMass: mass.subtract(share.totalMass, amount),
			unknownMass: mass.subtract(share.unknownMass, unknown),
			knownMass: mass.subtract(share.knownMass, known),
			cost: allocation.retained,
		},
	};
}

export function walletChange(
	a: CommodityAccount,
	delta: SignedMoney,
	tradeCredit: Money = zeroMoney,
): CommodityAccount {
	return {
		...a,
		cash: signedMoney.add(a.cash, delta),
		bankedTrade: money.add(a.bankedTrade, tradeCredit),
	};
}

export interface AccountHolder {
	credits: number;
	cargo: Readonly<Record<string, number>>;
	accounting?: CommodityAccount;
}
export const accountOf = (c: AccountHolder): CommodityAccount =>
	c.accounting ?? migrateAccount(c.credits, 0, c.cargo, {});
export function withAccount<T extends AccountHolder>(
	c: T,
	accounting: CommodityAccount,
): T {
	const cargo = Object.fromEntries(
		Object.entries(accounting.basis)
			.filter(([, b]) => b.heldMass > 0n)
			.map(([good, b]) => [
				good,
				displayAmount(b.heldMass, "mass", nativeGrams(good)),
			]),
	);
	return { ...c, accounting, credits: displayAmount(accounting.cash), cargo };
}
export function changeCash<T extends AccountHolder>(
	c: T,
	delta: number,
	tradeCredit = 0,
): T {
	return withAccount(
		c,
		walletChange(
			accountOf(c),
			signedMoney.fromNumber(delta),
			money.fromNumber(tradeCredit),
		),
	);
}

export function encodeAccount(a: CommodityAccount) {
	return {
		cash: signedMoney.encode(a.cash),
		bankedTrade: money.encode(a.bankedTrade),
		pools: Object.fromEntries(
			COMMODITY_POOL_IDS.map((name) => {
				const p = a.pools[name];
				return [
					name,
					{
						totalMass: mass.encode(p.totalMass),
						unknownMass: mass.encode(p.unknownMass),
						unrecoveredCost: money.encode(p.unrecoveredCost),
					},
				];
			}),
		),
		basis: Object.fromEntries(
			Object.keys(a.basis)
				.sort()
				.map((good) => {
					const b = a.basis[good];
					return [
						good,
						{
							legacyCost: money.encode(b.legacyCost),
							heldMass: mass.encode(b.heldMass),
							knownMass: mass.encode(b.knownMass),
							cost: money.encode(b.cost),
						},
					];
				}),
		),
	};
}
const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: refuse("malformed encoding");
export function parseAccount(raw: unknown): CommodityAccount {
	const a = object(raw);
	keys(a, ["cash", "bankedTrade", "pools", "basis"]);
	const ps = object(a.pools),
		bs = object(a.basis);
	if (Object.keys(bs).length > COMMODITY_POOL_IDS.length)
		refuse("basis catalogue mismatch");
	if (Object.keys(ps).length !== COMMODITY_POOL_IDS.length)
		refuse("pool catalogue mismatch");
	const pools: Record<string, CommodityPool> = {},
		basis: Record<string, PhysicalBasis> = {};
	for (const name of COMMODITY_POOL_IDS) {
		const p = object(ps[name]);
		keys(p, ["totalMass", "unknownMass", "unrecoveredCost"]);
		const totalMass = mass.parse(p.totalMass),
			unknownMass = mass.parse(p.unknownMass);
		if (unknownMass > totalMass) refuse(`${name}: unknown mass exceeds total`);
		pools[name] = {
			totalMass,
			unknownMass,
			unrecoveredCost: money.parse(p.unrecoveredCost),
		};
	}
	for (const [good, value] of Object.entries(bs)) {
		knownGood(good);
		const b = object(value);
		keys(b, ["heldMass", "knownMass", "cost", "legacyCost"]);
		const heldMass = mass.parse(b.heldMass),
			knownMass = mass.parse(b.knownMass);
		if (knownMass > heldMass || heldMass > pools[good].totalMass)
			refuse(`${good}: invalid held basis`);
		const cost = money.parse(b.cost),
			legacyCost = money.parse(b.legacyCost);
		if (legacyCost > cost) refuse(`${good}: legacy cost exceeds basis`);
		basis[good] = { heldMass, knownMass, cost, legacyCost };
	}
	return {
		cash: signedMoney.parse(a.cash),
		bankedTrade: money.parse(a.bankedTrade),
		pools,
		basis,
	};
}
export function projectBasis(a: CommodityAccount) {
	return Object.fromEntries(
		Object.entries(a.basis)
			.filter(([, b]) => b.knownMass > 0n || b.cost > 0n)
			.map(([good, b]) => [
				good,
				{
					units: displayAmount(b.knownMass, "mass", nativeGrams(good)),
					cr: displayAmount(b.cost),
				},
			]),
	);
}

export interface RecoveryWire {
	totalMass: string;
	unknownMass: string;
	knownMass: string;
	cost: string;
}
export const encodeShare = (share: RemovedShare): RecoveryWire => ({
	totalMass: mass.encode(share.totalMass),
	unknownMass: mass.encode(share.unknownMass),
	knownMass: mass.encode(share.knownMass),
	cost: money.encode(share.cost),
});
export function parseShare(raw: unknown): RemovedShare {
	const s = object(raw);
	keys(s, ["totalMass", "unknownMass", "knownMass", "cost"]);
	const share = {
		totalMass: mass.parse(s.totalMass),
		unknownMass: mass.parse(s.unknownMass),
		knownMass: mass.parse(s.knownMass),
		cost: money.parse(s.cost),
	};
	if (share.unknownMass > share.totalMass || share.knownMass > share.totalMass)
		refuse("invalid recovery share");
	return share;
}

function keys(
	value: Record<string, unknown>,
	expected: readonly string[],
): void {
	const actual = Object.keys(value);
	if (
		actual.length !== expected.length ||
		actual.some((k) => !expected.includes(k))
	)
		refuse("malformed accounting fields");
}
