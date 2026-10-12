import { describe, expect, test } from "bun:test";
import {
	ExactAmountError,
	mass,
	money,
	signedMoney,
	massFromNative,
	quoteFromNumber,
	quoteMass,
	transferCost,
	type Mass,
	type Money,
	type SignedMoney,
	type PriceQuote,
} from "../src/exact-amount";

const Q = 1n << 1074n;
const M = (1n << 2156n) * 15625n;
const MONEY_MAX = (1n << 3200n) - 1n;
const MASS_MAX = (1n << 2176n) - 1n;
// #917 recipe outputs per input tonne, followed by native t/kg/g factors.
const factors = [
	200000, 400000, 800000, 500, 1000, 2000, 250, 500, 1000, 5, 10, 20, 1000000,
	1000, 1,
];

function refuses(fn: () => unknown, code: string) {
	try {
		fn();
	} catch (error) {
		expect<unknown>(error).toBeInstanceOf(ExactAmountError);
		expect<unknown>((error as ExactAmountError).code).toBe(code);
		return;
	}
	throw new Error(`Expected ${code}`);
}

describe("exact legacy lifting", () => {
	test("known binary values, endpoints and signed cash", () => {
		expect<unknown>(money.fromNumber(1)).toBe(M);
		expect<unknown>(mass.fromNumber(Number.MIN_VALUE)).toBe(1n);
		expect<unknown>(money.fromNumber(Number.MIN_VALUE)).toBe(M / Q);
		expect<unknown>(money.fromNumber(0.1)).toBe(3602879701896397n * (M >> 55n));
		expect<unknown>(mass.fromNumber(Number.MAX_VALUE)).toBe(
			((1n << 53n) - 1n) << 2045n,
		);
		for (const x of [
			0,
			-0,
			Number.MIN_VALUE,
			Number.MAX_VALUE,
			2 ** -1022,
			0.1,
			1 / 3,
			2 ** 53,
		]) {
			expect<unknown>(money.toNumberExact(money.fromNumber(x))).toBe(
				x === 0 ? 0 : x,
			);
			expect<unknown>(mass.toNumberExact(mass.fromNumber(x))).toBe(
				x === 0 ? 0 : x,
			);
			expect<unknown>(
				signedMoney.toNumberExact(signedMoney.fromNumber(-x)),
			).toBe(x === 0 ? 0 : -x);
			for (const factor of factors) {
				expect<unknown>(massFromNative(x, factor)).toBe(
					mass.fromNumber(x) * BigInt(factor),
				);
			}
		}
	});
	test("bit-pattern corpus spans every finite exponent and both signs", () => {
		const view = new DataView(new ArrayBuffer(8));
		for (let exponent = 0; exponent < 2047; exponent++) {
			for (const fraction of [0n, 1n, 0x5555555555555n, 0xfffffffffffffn]) {
				view.setBigUint64(0, (BigInt(exponent) << 52n) | fraction);
				const x = view.getFloat64(0);
				const g = mass.fromNumber(x);
				// Independent inverse: the exact gram ticks reconstruct the Number.
				expect<unknown>(mass.toNumberExact(g)).toBe(x);
				expect<unknown>(money.toNumberExact(money.fromNumber(x))).toBe(x);
				expect<unknown>(
					signedMoney.toNumberExact(signedMoney.fromNumber(-x)),
				).toBe(x === 0 ? 0 : -x);
				expect<unknown>(mass.parse(mass.encode(g))).toBe(g);
			}
		}
	});
	test("refuses nonfinite, negative material/cost, and inexact Number projection", () => {
		for (const x of [NaN, Infinity, -Infinity]) {
			for (const domain of [money, signedMoney, mass])
				refuses(() => domain.fromNumber(x), "nonfinite");
			refuses(() => quoteFromNumber(x), "nonfinite");
		}
		refuses(() => money.fromNumber(-1), "negative");
		refuses(() => massFromNative(-1, 1000000), "negative");
		refuses(() => quoteFromNumber(-1), "negative");
		refuses(() => money.toNumberExact(money.fromTicks(1n)), "not-binary64");
		refuses(() => mass.toNumberExact(mass.fromTicks(MASS_MAX)), "not-binary64");
		refuses(
			() =>
				money.toNumberExact(
					money.add(money.fromNumber(2 ** 53), money.fromNumber(1)),
				),
			"not-binary64",
		);
	});
});

describe("bounded canonical codec", () => {
	test("canonical zero, odd hex, binary shifts and maximum lengths", () => {
		expect<unknown>(money.encode(money.fromTicks(0n))).toBe("0");
		expect<unknown>(money.encode(money.fromTicks(24n))).toBe("3@3");
		expect<unknown>(signedMoney.encode(signedMoney.fromTicks(-24n))).toBe(
			"-3@3",
		);
		expect<unknown>(money.encode(money.fromTicks(MONEY_MAX)).length).toBe(802);
		expect<unknown>(
			signedMoney.encode(signedMoney.fromTicks(-MONEY_MAX)).length,
		).toBe(803);
		expect<unknown>(mass.encode(mass.fromTicks(MASS_MAX)).length).toBe(546);
		for (const [domain, bits] of [
			[money, 3200],
			[signedMoney, 3200],
			[mass, 2176],
		] as const) {
			// All shifts, including every boundary where the decimal shift grows.
			for (let shift = 0; shift < bits; shift++) {
				const n = 1n << BigInt(shift);
				const encoded = `1@${shift}`;
				expect<unknown>(domain.parse(encoded)).toBe(n);
			}
		}
	});
	test("hostile strings refuse before unbounded BigInt allocation", () => {
		for (const text of [
			"",
			"00",
			"-0",
			"+0",
			"0@0",
			"01@0",
			"2@0",
			"A@0",
			"1@00",
			"1@-1",
			"1@+1",
			"1@1.0",
			"1@0@0",
			" 1@0",
			"1@0\n",
			"1@1e3",
			"1@999999999",
			"f".repeat(1000000) + "@0",
		]) {
			for (const domain of [money, signedMoney, mass])
				refuses(() => domain.parse(text), "encoding");
		}
		refuses(() => money.parse("-1@0"), "encoding");
		refuses(() => mass.parse("-1@0"), "encoding");
		refuses(() => money.parse("1@3200"), "encoding");
		refuses(() => mass.parse("1@2176"), "encoding");
		refuses(() => money.parse("f".repeat(800) + "@1"), "encoding");
		refuses(() => mass.parse("f".repeat(544) + "@1"), "encoding");
		refuses(() => money.parse("1".repeat(801) + "@0"), "encoding");
		refuses(() => money.parse(null), "encoding");
	});
});

describe("checked settlement", () => {
	test("two separate 1 Cr receipts survive at 2^53 Cr", () => {
		const start = money.fromNumber(2 ** 53);
		const one = money.fromNumber(1);
		const balance = money.add(money.add(start, one), one);
		expect<unknown>(balance - start).toBe(2n * M);
		expect<unknown>(2 ** 53 + 1 + 1).toBe(2 ** 53);
		expect<unknown>(money.toNumberExact(balance)).toBe(2 ** 53 + 2);
	});
	test("boundaries validate operands as well as results", () => {
		for (const [domain, max] of [
			[money, MONEY_MAX],
			[mass, MASS_MAX],
		] as const) {
			expect<unknown>(domain.fromTicks(max)).toBe(max);
			refuses(() => domain.fromTicks(max + 1n), "overflow");
			refuses(() => domain.fromTicks(-1n), "negative");
		}
		const max = money.fromTicks(MONEY_MAX),
			one = money.fromTicks(1n),
			zero = money.fromTicks(0n);
		refuses(() => money.add(max, one), "overflow");
		refuses(() => money.subtract(zero, one), "negative");
		// Forged typed inputs cannot exploit cancellation to bypass validation.
		refuses(() => money.subtract((MONEY_MAX + 1n) as Money, one), "overflow");
		refuses(() => money.add(-1n as Money, one), "negative");
		refuses(
			() => signedMoney.subtract(signedMoney.fromTicks(-MONEY_MAX), one),
			"overflow",
		);
		expect<unknown>(
			signedMoney.add(signedMoney.fromNumber(-1), money.fromNumber(2)),
		).toBe(M);
		expect<unknown>(mass.add(mass.fromTicks(3n), mass.fromTicks(4n))).toBe(7n);
		refuses(
			() => mass.add(mass.fromTicks(MASS_MAX), mass.fromTicks(1n)),
			"overflow",
		);
		refuses(
			() => mass.subtract(mass.fromTicks(0n), mass.fromTicks(1n)),
			"negative",
		);
		expect<unknown>(max).toBe(MONEY_MAX);
	});
	test("every recipe/native-unit factor values exact quotes and smallest dust", () => {
		for (const factor of factors)
			for (const price of [
				0,
				0.1,
				1,
				17.3,
				Number.MIN_VALUE,
				Number.MAX_VALUE,
			]) {
				const quote = quoteFromNumber(price);
				expect<unknown>(
					quoteMass(quote, massFromNative(1, factor), factor),
				).toBe(money.fromNumber(price));
				const dust = quoteMass(quote, mass.fromTicks(1n), factor);
				// Fixed quantum sufficiency without copying the production expression.
				expect<unknown>(dust * Q * BigInt(factor)).toBe(
					money.fromNumber(price),
				);
				for (const amount of [1n, Q - 1n, Q, 2n * Q + 1n]) {
					expect<unknown>(
						quoteMass(quote, mass.fromTicks(amount), factor),
					).toBe(dust * amount);
				}
			}
		for (const factor of [0, -1, 3, 0.5, Infinity, NaN, 4000001]) {
			refuses(() => massFromNative(1, factor), "unit-factor");
			refuses(
				() => quoteMass(quoteFromNumber(1), mass.fromTicks(1n), factor),
				"unit-factor",
			);
		}
		refuses(
			() =>
				quoteMass(
					quoteFromNumber(Number.MAX_VALUE),
					mass.fromTicks(MASS_MAX),
					1,
				),
			"overflow",
		);
		refuses(
			() => quoteMass(-1n as PriceQuote, mass.fromTicks(0n), 1),
			"negative",
		);
		refuses(
			() => quoteMass((1n << 2098n) as PriceQuote, mass.fromTicks(0n), 1),
			"overflow",
		);
	});
	test("cross-grade unknown dust: equal quote splits preserve eligible proceeds", () => {
		// Unknown 250 g poor Platinum output crosses a rich 1000 g sale boundary.
		const unknown = mass.add(massFromNative(1, 250), mass.fromTicks(1n));
		const total = massFromNative(2, 1000);
		const quote = quoteFromNumber(17.3);
		const first = mass.subtract(massFromNative(1, 1000), unknown);
		const second = massFromNative(1, 1000);
		expect<unknown>(
			money.add(quoteMass(quote, first, 1000), quoteMass(quote, second, 1000)),
		).toBe(quoteMass(quote, mass.subtract(total, unknown), 1000));
		expect<unknown>(quoteMass(quote, unknown, 250)).toBe(
			quoteMass(quote, mass.fromTicks(unknown * 4n), 1000),
		);
	});
	test("proportional transfers retain exact remainder and final transfer takes all", () => {
		for (let q = 1n; q <= 32n; q++)
			for (let k = 0n; k <= q; k++) {
				for (const c of [0n, 1n, 17n, M / 10n, MONEY_MAX]) {
					const { moved, retained } = transferCost(
						money.fromTicks(c),
						mass.fromTicks(k),
						mass.fromTicks(q),
					);
					expect<unknown>(moved + retained).toBe(c);
					expect<unknown>(c * k - moved * q >= 0n).toBe(true);
					expect<unknown>(c * k - moved * q < q).toBe(true);
					if (k === q) expect<unknown>(retained).toBe(0n);
				}
			}
		const source = mass.fromTicks(4n),
			part = mass.fromTicks(1n),
			cost = money.fromTicks(2n);
		const a = transferCost(cost, part, source);
		const b = transferCost(a.retained, part, mass.subtract(source, part));
		const grouped = transferCost(cost, mass.fromTicks(2n), source);
		expect<unknown>(a.moved + b.moved).not.toBe(grouped.moved);
		expect<unknown>(
			transferCost(b.retained, mass.fromTicks(2n), mass.fromTicks(2n)).moved,
		).toBe(2n);
		refuses(() => transferCost(cost, source, part), "quantity");
		refuses(
			() => transferCost(cost, mass.fromTicks(0n), mass.fromTicks(0n)),
			"quantity",
		);
		refuses(() => transferCost(-1n as Money, part, source), "negative");
	});
});

// Typecheck-only contracts; no cross-domain arithmetic may compile.
function typeContracts(m: Money, s: SignedMoney, g: Mass, p: PriceQuote) {
	// @ts-expect-error mass is not money
	money.add(m, g);
	// @ts-expect-error signed cash is not a nonnegative cost
	transferCost(s, g, g);
	// @ts-expect-error raw bigint has not been checked
	money.encode(1n);
	// @ts-expect-error amounts are not lifted price quotes
	quoteMass(m, g, 1);
	// @ts-expect-error price quotes are not money
	signedMoney.add(s, p);
}
