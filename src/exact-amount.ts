/**
 * Bounded settlement primitives. Refs #940; approved #935 D10/D13/D14/D17.
 * Money ticks are 1/(2^2156 * 5^6) Cr; mass ticks are 2^-1074 grams.
 * No storage, wallet, pool policy or presentation rounding lives here.
 *
 * Public operations validate inputs before arithmetic and throw ExactAmountError
 * on refusal. BigInts are immutable; callers preflight a whole transaction before
 * adopting any of its results. Brands distinguish dimensions at compile time;
 * runtime checks enforce signs and bounds even for incorrectly cast inputs.
 */
declare const moneyBrand: unique symbol;
declare const nonnegativeBrand: unique symbol;
declare const massBrand: unique symbol;
declare const quoteBrand: unique symbol;
export type SignedMoney = bigint & { readonly [moneyBrand]: true };
export type Money = SignedMoney & { readonly [nonnegativeBrand]: true };
export type Mass = bigint & { readonly [massBrand]: true };
/** A binary64 price lifted to integer multiples of 2^-1074 Cr/native unit. */
export type PriceQuote = bigint & { readonly [quoteBrand]: true };

export type ExactAmountFailure =
	| "nonfinite"
	| "negative"
	| "overflow"
	| "encoding"
	| "not-binary64"
	| "unit-factor"
	| "quantity"
	| "invalid-ticks"
	| "invalid-quote";

export class ExactAmountError extends Error {
	constructor(readonly code: ExactAmountFailure) {
		super(`Exact amount refused: ${code}`);
		this.name = "ExactAmountError";
	}
}

function refuse(code: ExactAmountFailure): never {
	throw new ExactAmountError(code);
}

const BINARY_SCALE = 1n << 1074n;
const MONEY_SCALE = (1n << 2156n) * 15625n;
const MONEY_PER_BINARY_TICK = MONEY_SCALE / BINARY_SCALE;
const MAX_BINARY_TICKS = ((1n << 53n) - 1n) << 2045n;

function checked(value: bigint, max: bigint, signed: boolean): bigint {
	if (typeof value !== "bigint") refuse("invalid-ticks");
	if (!signed && value < 0n) refuse("negative");
	if (value > max || value < -max) refuse("overflow");
	return value;
}

/** Decompose the received binary value, never its rounded decimal spelling. */
function binaryTicks(value: number): bigint {
	if (!Number.isFinite(value)) refuse("nonfinite");
	const view = new DataView(new ArrayBuffer(8));
	view.setFloat64(0, value);
	const bits = view.getBigUint64(0);
	const exponent = Number((bits >> 52n) & 2047n);
	const fraction = bits & ((1n << 52n) - 1n);
	const magnitude =
		exponent === 0
			? fraction
			: ((1n << 52n) | fraction) << BigInt(exponent - 1);
	return bits >> 63n ? -magnitude : magnitude;
}

function oddParts(value: bigint): { coefficient: bigint; shift: number } {
	let coefficient = value;
	let shift = 0;
	while (coefficient !== 0n && (coefficient & 1n) === 0n) {
		coefficient >>= 1n;
		shift++;
	}
	return { coefficient, shift };
}

export interface AmountDomain<T extends bigint> {
	readonly maxTicks: bigint;
	readonly maxEncodingLength: number;
	fromTicks(value: bigint): T;
	/** Cr for money, grams for mass. Negative zero canonicalizes to zero. */
	fromNumber(value: number): T;
	/** Exact-only legacy projection; never use a rounded Number for settlement. */
	toNumberExact(value: T): number;
	parse(value: unknown): T;
	encode(value: T): string;
	add(left: T, right: T): T;
	subtract(left: T, right: T): T;
}

function domain<T extends bigint>(
	bits: number,
	signed: boolean,
	scale: bigint,
): AmountDomain<T> {
	const maxTicks = (1n << BigInt(bits)) - 1n;
	const maxEncodingLength = bits / 4 + 2 + (signed ? 1 : 0);
	const fromTicks = (value: bigint): T => checked(value, maxTicks, signed) as T;
	const fromNumber = (value: number): T =>
		fromTicks(binaryTicks(value) * (scale / BINARY_SCALE));
	return Object.freeze({
		maxTicks,
		maxEncodingLength,
		fromTicks,
		fromNumber,
		toNumberExact(value: T): number {
			const ticks: bigint = fromTicks(value);
			const negative = ticks < 0n;
			let magnitude = negative ? -ticks : ticks;
			if (magnitude === 0n) return 0;
			// Remove the money scale's odd factor. A remaining factor of five in the
			// denominator cannot be represented by any finite binary64 value.
			const oddScale = scale === MONEY_SCALE ? 15625n : 1n;
			if (magnitude % oddScale !== 0n) refuse("not-binary64");
			magnitude /= oddScale;
			const { coefficient, shift } = oddParts(magnitude);
			const exponent = shift - (scale === MONEY_SCALE ? 2156 : 1074);
			if (coefficient >= 1n << 53n || exponent < -1074 || exponent > 1023)
				refuse("not-binary64");
			const result = Number(coefficient) * 2 ** exponent * (negative ? -1 : 1);
			if (!Number.isFinite(result) || fromNumber(result) !== value)
				refuse("not-binary64");
			return result;
		},
		parse(value: unknown): T {
			// Bound string work and coefficient allocation before BigInt sees input.
			if (typeof value !== "string" || value.length > maxEncodingLength)
				refuse("encoding");
			if (value === "0") return fromTicks(0n);
			const match = /^(-?)([1-9a-f][0-9a-f]*)@(0|[1-9][0-9]{0,3})$/.exec(value);
			// JS $ also matches before a final newline: require the whole input.
			if (!match || match[0].length !== value.length || (match[1] && !signed))
				refuse("encoding");
			const coefficientText = match[2];
			const shift = Number(match[3]);
			if (coefficientText.length > bits / 4 || shift >= bits)
				refuse("encoding");
			const first = Number.parseInt(coefficientText[0], 16);
			const coefficientBits =
				(coefficientText.length - 1) * 4 + (32 - Math.clz32(first));
			const last = Number.parseInt(
				coefficientText[coefficientText.length - 1],
				16,
			);
			if ((last & 1) === 0 || coefficientBits + shift > bits)
				refuse("encoding");
			const magnitude = BigInt(`0x${coefficientText}`) << BigInt(shift);
			return fromTicks(match[1] ? -magnitude : magnitude);
		},
		encode(value: T): string {
			const ticks: bigint = fromTicks(value);
			if (ticks === 0n) return "0";
			const { coefficient, shift } = oddParts(ticks < 0n ? -ticks : ticks);
			return `${value < 0n ? "-" : ""}${coefficient.toString(16)}@${shift}`;
		},
		add(left: T, right: T): T {
			const a: bigint = fromTicks(left);
			const b: bigint = fromTicks(right);
			return fromTicks(a + b);
		},
		subtract(left: T, right: T): T {
			const a: bigint = fromTicks(left);
			const b: bigint = fromTicks(right);
			return fromTicks(a - b);
		},
	});
}

export const money: AmountDomain<Money> = domain(3200, false, MONEY_SCALE);
export const signedMoney: AmountDomain<SignedMoney> = domain(
	3200,
	true,
	MONEY_SCALE,
);
export const mass: AmountDomain<Mass> = domain(2176, false, BINARY_SCALE);

/**
 * The approved recipe/native factors divide 4,000,000 grams. Accept that closed
 * arithmetic domain (including t/kg/g), not arbitrary rational denominators.
 */
function unitFactor(gramsPerNativeUnit: number): bigint {
	if (
		!Number.isSafeInteger(gramsPerNativeUnit) ||
		gramsPerNativeUnit <= 0 ||
		gramsPerNativeUnit > 4000000 ||
		4000000 % gramsPerNativeUnit !== 0
	)
		refuse("unit-factor");
	return BigInt(gramsPerNativeUnit);
}

/** Multiply AFTER lifting: Number.MIN_VALUE tonnes is not rounded to grams. */
export function massFromNative(
	quantity: number,
	gramsPerNativeUnit: number,
): Mass {
	const factor = unitFactor(gramsPerNativeUnit);
	return mass.fromTicks(mass.fromNumber(quantity) * factor);
}

export function quoteFromNumber(pricePerNativeUnit: number): PriceQuote {
	return checked(
		binaryTicks(pricePerNativeUnit),
		MAX_BINARY_TICKS,
		false,
	) as PriceQuote;
}

function validateQuote(quote: PriceQuote): bigint {
	checked(quote, MAX_BINARY_TICKS, false);
	// A forged quote must still have a finite binary64 preimage. This keeps the
	// public quote boundary as strict as the finite-price lifting boundary.
	const { coefficient } = oddParts(quote);
	if (coefficient >= 1n << 53n) refuse("invalid-quote");
	return quote;
}

/**
 * Exact eligible-price allocation: p/Q * grams/Q / factor * M ticks.
 * M/Q² = 4,000,000, so no rounding or remainder exists here. Validated operands
 * bound intermediates to 2098 + 2176 + 22 bits; the result must fit 3200 bits.
 */
export function quoteMass(
	quote: PriceQuote,
	quantity: Mass,
	gramsPerNativeUnit: number,
): Money {
	const factor = unitFactor(gramsPerNativeUnit);
	const price = validateQuote(quote);
	const grams = mass.fromTicks(quantity);
	return money.fromTicks(price * grams * (4000000n / factor));
}

/**
 * Physical basis only, never progression: floor(cost * movedMass / sourceMass).
 * Inputs bound the product to 5376 bits. The remainder belongs to the source;
 * taking the whole source takes all cost. Empty sources refuse (including 0/0).
 * Sequential rounded allocations need not equal one grouped allocation.
 */
export function transferCost(
	cost: Money,
	movedMass: Mass,
	sourceMass: Mass,
): Readonly<{ moved: Money; retained: Money }> {
	money.fromTicks(cost);
	mass.fromTicks(movedMass);
	mass.fromTicks(sourceMass);
	if (sourceMass === 0n || movedMass > sourceMass) refuse("quantity");
	const moved = money.fromTicks((cost * movedMass) / sourceMass);
	return { moved, retained: money.subtract(cost, moved) };
}
