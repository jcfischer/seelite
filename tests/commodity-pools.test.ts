import { expect, test } from "bun:test";
import {
	money,
	signedMoney,
	massFromNative,
	quoteFromNumber,
} from "../src/exact-amount";
import {
	acquire,
	charge,
	emptyAccount,
	sell,
	remove,
	recover,
	migrateAccount,
} from "../src/commodity-pools";

test("committed 10/30 costs recover commodity-wide in either collection order", () => {
	const start = acquire(
		acquire(emptyAccount(1000), "Alloys", 1, money.fromNumber(10)),
		"Alloys",
		1,
		money.fromNumber(30),
	);
	const one = sell(start, "Alloys", 1, quoteFromNumber(20));
	expect(one.bankedTrade).toBe(money.fromTicks(0n));
	expect(one.pools.Alloys.unrecoveredCost).toBe(money.fromNumber(20));
	const two = sell(one, "Alloys", 1, quoteFromNumber(20));
	expect(two.bankedTrade).toBe(money.fromTicks(0n));
	expect(two.cash).toBe(signedMoney.fromNumber(1000));
	expect(sell(start, "Alloys", 2, quoteFromNumber(20))).toEqual(two);
});

test("unknown proceeds cannot repay costs; loss retains debt and partial own recovery retains shares", () => {
	let a = migrateAccount(
		1000,
		100,
		{ Alloys: 2 },
		{ Alloys: { units: 1, cr: 19 } },
	);
	const loss = remove(a, "Alloys", 1.5);
	expect(loss.account.pools.Alloys.unrecoveredCost).toBe(money.fromNumber(19));
	expect(loss.share.unknownMass).toBe(massFromNative(1, 1000000));
	const first = recover(loss.account, "Alloys", loss.share, 0.5);
	const second = recover(first.account, "Alloys", first.remaining, 1);
	expect(second.account).toEqual(a);
	a = sell(a, "Alloys", 1, quoteFromNumber(20));
	expect(a.bankedTrade).toBe(money.fromNumber(100));
	expect(a.pools.Alloys.unrecoveredCost).toBe(money.fromNumber(19));
	a = sell(a, "Alloys", 1, quoteFromNumber(20));
	expect(a.bankedTrade).toBe(money.fromNumber(101));
});

test("unknown stock fees stay debt and wallet retains sub-number payments", () => {
	let a = migrateAccount(2 ** 53, 0, { Gold: 1 }, {});
	a = charge(a, "Gold", money.fromNumber(7));
	a = sell(a, "Gold", 1, quoteFromNumber(20));
	expect(a.pools.Gold.unrecoveredCost).toBe(money.fromNumber(7));
	expect(a.bankedTrade).toBe(money.fromTicks(0n));
	expect(a.cash).toBe(
		signedMoney.fromTicks(
			signedMoney.fromNumber(2 ** 53) + money.fromNumber(13),
		),
	);
});

test("every fixed-price partition preserves exact cash, debt and credit across unknown dust", () => {
	for (const good of ["Alloys", "Gold", "Gem-Stones"])
		for (const price of [0.1, 0.4, 17.3, Number.MIN_VALUE])
			for (let n = 1; n <= 12; n++) {
				const start = migrateAccount(
					1000,
					100,
					{ [good]: n },
					{ [good]: { units: n - 0.25, cr: 2 } },
				);
				const whole = sell(start, good, n, quoteFromNumber(price));
				for (let k = 0; k <= n; k++) {
					const split = sell(
						sell(start, good, k, quoteFromNumber(price)),
						good,
						n - k,
						quoteFromNumber(price),
					);
					expect(split.cash).toBe(whole.cash);
					expect(split.bankedTrade).toBe(whole.bankedTrade);
					expect(split.pools).toEqual(whole.pools);
				}
			}
});

test("collection order changes no progression once both costs are committed", () => {
	const a = acquire(
		acquire(emptyAccount(1000), "Alloys", 1, money.fromNumber(10)),
		"Alloys",
		1,
		money.fromNumber(30),
	);
	const b = acquire(
		acquire(emptyAccount(1000), "Alloys", 1, money.fromNumber(30)),
		"Alloys",
		1,
		money.fromNumber(10),
	);
	expect(sell(a, "Alloys", 2, quoteFromNumber(30))).toEqual(
		sell(b, "Alloys", 2, quoteFromNumber(30)),
	);
});

test("a cost-only legacy row remains cost-only after new material moves", () => {
	let a = migrateAccount(100, 0, {}, { Alloys: { units: 0, cr: 3 } });
	a = acquire(a, "Alloys", 1, money.fromNumber(20));
	const loss = remove(a, "Alloys", 1);
	expect(loss.share.cost).toBe(money.fromNumber(20));
	expect(loss.account.basis.Alloys.cost).toBe(money.fromNumber(3));
	expect(loss.account.basis.Alloys.legacyCost).toBe(money.fromNumber(3));
	expect(loss.account.pools.Alloys.unrecoveredCost).toBe(money.fromNumber(23));
});

test("a fee follows unknown physical stock without changing its eligibility", () => {
	const a = charge(
		migrateAccount(100, 0, { Alloys: 2 }, {}),
		"Alloys",
		money.fromNumber(7),
	);
	const loss = remove(a, "Alloys", 1);
	expect(loss.share.cost).toBe(money.fromNumber(3.5));
	expect(loss.share.unknownMass).toBe(massFromNative(1, 1000000));
	expect(loss.account.pools.Alloys.unrecoveredCost).toBe(money.fromNumber(7));
});

test("production settlement matches the arithmetic instrument's worked cash/debt/bank states", () => {
	const cases = [
		{
			cash: 1000,
			total: 2,
			known: 2,
			basis: 40,
			debt: 40,
			sales: [
				[1, 20],
				[1, 20],
			],
			expected: [1040, 0, 100],
		},
		{
			cash: 1000,
			total: 2,
			known: 2,
			basis: 40,
			debt: 40,
			sales: [[2, 15]],
			expected: [1030, 10, 100],
		},
		{
			cash: 1030,
			total: 1,
			known: 1,
			basis: 20,
			debt: 30,
			sales: [[1, 35]],
			expected: [1065, 0, 105],
		},
		{
			cash: 993,
			total: 1,
			known: 0,
			basis: 7,
			debt: 7,
			sales: [[1, 20]],
			expected: [1013, 7, 100],
		},
	];
	for (const c of cases) {
		let a = migrateAccount(
			c.cash,
			100,
			{ Alloys: c.total },
			{ Alloys: { units: c.known, cr: c.basis } },
		);
		a = {
			...a,
			pools: {
				...a.pools,
				Alloys: {
					...a.pools.Alloys,
					unrecoveredCost: money.fromNumber(c.debt),
				},
			},
		};
		for (const [units, price] of c.sales)
			a = sell(a, "Alloys", units, quoteFromNumber(price));
		expect(a.cash).toBe(signedMoney.fromNumber(c.expected[0]));
		expect(a.pools.Alloys.unrecoveredCost).toBe(
			money.fromNumber(c.expected[1]),
		);
		expect(a.bankedTrade).toBe(money.fromNumber(c.expected[2]));
	}
});
