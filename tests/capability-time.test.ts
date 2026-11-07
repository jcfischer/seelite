import { expect, test } from "bun:test";
import {
	capabilityRates,
	initialCapabilityTime,
	projectCapabilityTime,
	queryCapabilityTime,
	capabilityDuration,
} from "../src/capability-time";

const context = { seed: 1, government: 0, active: 0, total: 4 };

test("approved odds fixtures include partial pressure and an empty roster", () => {
	for (const [government, active, total, base, odds, multiplier, share] of [
		[0, 0, 4, 0.12, 3 / 22, 1, 0.12],
		[7, 0, 4, 0.03, 3 / 97, 1, 0.03],
		[0, 2, 4, 0.12, 3 / 22, 1.5, 9 / 53],
		[7, 1, 4, 0.03, 3 / 97, 1.25, 15 / 403],
		[0, 4, 4, 0.12, 3 / 22, 2, 3 / 14],
		[7, 0, 0, 0.03, 3 / 97, 1, 0.03],
	]) {
		const rates = capabilityRates({ ...context, government, active, total });
		expect(rates.base).toBeCloseTo(base, 12);
		expect(rates.odds).toBeCloseTo(odds, 12);
		expect(rates.multiplier).toBe(multiplier);
		expect(rates.share).toBeCloseTo(share, 12);
	}
});

test("zero-length retained intervals grant no work and reversed intervals refuse", () => {
	const anchor = initialCapabilityTime(context, 0);
	expect(queryCapabilityTime(context, anchor, 0, 0)).toBe(0);
	expect(queryCapabilityTime(context, anchor, 5, 5)).toBe(0);
	expect(() => queryCapabilityTime(context, anchor, 100, 99)).toThrow();
});

test("supported seed endpoints work and invalid seeds or initial clocks refuse", () => {
	for (const seed of [0, 0xffffffff])
		expect(capabilityDuration(seed, 1)).toBeGreaterThanOrEqual(600);
	for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000])
		expect(() => capabilityDuration(seed, 1)).toThrow();
	for (const at of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
		expect(() => initialCapabilityTime(context, at)).toThrow();
});

test("fixed outage excludes disabled seconds and retained history refuses", () => {
	const anchor = {
		at: 0,
		cycle: 0,
		phase: "down" as const,
		left: 900,
		endsAt: 900,
		repaired: false,
	};
	expect(queryCapabilityTime(context, anchor, 0, 1200)).toBe(300);
	const next = projectCapabilityTime(context, anchor, 1000);
	expect(queryCapabilityTime(context, next.state, 1000, 1200)).toBe(200);
	expect(() => queryCapabilityTime(context, next.state, 0, 1200)).toThrow();
	expect(
		queryCapabilityTime(context, { ...anchor, repaired: true }, 0, 1200),
	).toBe(1200);
});

test("stationary initialization and complete cycles follow approved odds", () => {
	for (let government = 0; government < 8; government++)
		for (const active of [0, 4]) {
			let disabled = 0;
			for (let seed = 0; seed < 8192; seed++)
				if (
					initialCapabilityTime({ ...context, government, active, seed }, 0)
						.phase === "down"
				)
					disabled++;
			const c = { ...context, government, active };
			const r = capabilityRates(c);
			expect(Math.abs(disabled / 8192 - r.share)).toBeLessThan(0.018);
			for (let seed = 0; seed < 8; seed++) {
				const c = { ...context, government, active, seed };
				let end = 0;
				for (let cycle = 0; cycle < 32; cycle++)
					end +=
						capabilityDuration(seed, cycle) * (1 + 1 / (r.odds * r.multiplier));
				const anchor = {
					at: 0,
					cycle: 0,
					phase: "up" as const,
					left: capabilityDuration(seed, 0) / r.odds,
					repaired: false,
				};
				expect(1 - queryCapabilityTime(c, anchor, 0, end) / end).toBeCloseTo(
					r.share,
					10,
				);
			}
		}
});

test("projection partitions, pressure preserves a fixed outage and malformed input refuses", () => {
	const a = initialCapabilityTime(context, 0);
	const whole = projectCapabilityTime(context, a, 10000);
	const first = projectCapabilityTime(context, a, 4444);
	const second = projectCapabilityTime(context, first.state, 10000);
	expect(first.operational + second.operational).toBeCloseTo(
		whole.operational,
		8,
	);
	const down = {
		at: 100,
		cycle: 1,
		phase: "down" as const,
		left: 500,
		endsAt: 600,
		repaired: true,
	};
	expect(
		projectCapabilityTime({ ...context, active: 4 }, down, 600).state.phase,
	).toBe("up");
	expect(
		projectCapabilityTime({ ...context, active: 4 }, down, 599).state.repaired,
	).toBe(true);
	for (const bad of [
		{ ...context, active: 5 },
		{ ...context, total: -1 },
		{ ...context, government: 8 },
	])
		expect(() => capabilityRates(bad)).toThrow();
	for (const bad of [
		{ ...a, left: Infinity },
		{ ...a, cycle: 1.5 },
		{ ...a, left: 1e100 },
		{ ...a, phase: "wrong" },
		{ ...a, at: -1 },
	])
		expect(() =>
			projectCapabilityTime(context, bad as typeof a, 1000),
		).toThrow();
	for (const bad of [
		{ ...down, endsAt: undefined },
		{ ...down, endsAt: Infinity },
		{ ...down, endsAt: 100 },
		{ ...down, endsAt: 601 },
	])
		expect(() => projectCapabilityTime(context, bad, 599)).toThrow();
});

test("initial duration is length biased, later duration is uniform and remaining position is independent", () => {
	let initialBelow = 0,
		laterBelow = 0,
		initialSum = 0,
		laterSum = 0;
	const fractions = { up: [] as number[], down: [] as number[] };
	const joint = {
		low: { up: [] as number[], down: [] as number[] },
		high: { up: [] as number[], down: [] as number[] },
	};
	for (let seed = 0; seed < 16384; seed++) {
		const first = capabilityDuration(seed, 0),
			later = capabilityDuration(seed, 1);
		if (first < 900) initialBelow++;
		if (later < 900) laterBelow++;
		initialSum += first;
		laterSum += later;
		expect(first).toBeGreaterThanOrEqual(600);
		expect(first).toBeLessThan(1200);
		expect(later).toBeGreaterThanOrEqual(600);
		expect(later).toBeLessThan(1200);
		const c = { ...context, seed };
		const a = initialCapabilityTime(c, 0);
		const r = capabilityRates(c);
		fractions[a.phase].push(a.left / (first / (a.phase === "up" ? r.odds : 1)));
		joint[first < 900 ? "low" : "high"][a.phase].push(
			a.left / (first / (a.phase === "up" ? r.odds : 1)),
		);
	}
	expect(initialBelow / 16384).toBeCloseTo(5 / 12, 1);
	expect(Math.abs(initialBelow / 16384 - 5 / 12)).toBeLessThan(0.018);
	expect(Math.abs(laterBelow / 16384 - 0.5)).toBeLessThan(0.018);
	expect(initialSum / 16384).toBeCloseTo(933.333333, -1);
	expect(laterSum / 16384).toBeCloseTo(900, -1);
	for (const samples of Object.values(fractions))
		expect(
			Math.abs(samples.reduce((s, x) => s + x, 0) / samples.length - 0.5),
		).toBeLessThan(0.04);
	for (const bin of Object.values(joint)) {
		for (const samples of Object.values(bin))
			expect(
				Math.abs(samples.reduce((sum, x) => sum + x, 0) / samples.length - 0.5),
			).toBeLessThan(0.04);
		expect(
			Math.abs(
				bin.down.length / (bin.up.length + bin.down.length) -
					capabilityRates(context).share,
			),
		).toBeLessThan(0.025);
	}
	expect(() => capabilityDuration(1, Number.MAX_SAFE_INTEGER + 1)).toThrow();
});

test("later cycle identities retain their high bits in the duration stream", () => {
	expect(capabilityDuration(1, 2 ** 32 + 1)).not.toBe(capabilityDuration(1, 1));
});

test("a natural end is retained exactly when subtraction would round its reconstruction", () => {
	const c = { seed: 33, government: 0, active: 1, total: 2 };
	const a = initialCapabilityTime(c, 0);
	expect(a.phase).toBe("down");
	const end = a.at + a.left;
	const first = projectCapabilityTime(c, a, 65.51451133490579).state;
	expect(first.endsAt).toBe(end);
	for (let i = 1; i < 20; i++) {
		const next = projectCapabilityTime(c, first, first.at + i * 0.137).state;
		expect(next.endsAt).toBe(end);
		expect(projectCapabilityTime(c, next, end).state.phase).toBe("up");
	}
});
