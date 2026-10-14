import { describe, expect, test } from "bun:test";
import {
	CAPACITY,
	createGrowthPlan,
	modulesAt,
	type GrowthModule,
} from "./growth";

describe("metropolis expansion", () => {
	test("each count is an exact connected prefix, independent of visit history", () => {
		for (let seed = 0; seed < 128; seed++) {
			const plan = createGrowthPlan(seed);
			expect(plan.modules).toHaveLength(CAPACITY);
			expect(plan.fallback).toBe(false);
			expect(createGrowthPlan(seed)).toEqual(plan);
			for (let count = 0; count <= CAPACITY; count++) {
				const built = modulesAt(plan, count);
				expect(built).toHaveLength(count);
				expect(
					modulesAt(plan, Math.min(CAPACITY, count + 1)).slice(0, count),
				).toEqual(built);
				const ids = new Set<string>(["spine"]);
				for (const module of built) {
					expect(ids.has(module.parentId)).toBe(true);
					expect(ids.has(module.id)).toBe(false);
					ids.add(module.id);
					// Growth sockets stay behind the forward dock approach and clear of wheels.
					expect(Math.abs(module.x)).toBeLessThan(1400);
					expect(
						Math.abs(module.y) - module.radius > 35 ||
							Math.abs(module.x) - module.radius > 60,
					).toBe(true);
				}
			}
		}
	});
	test("districts occupy all four radial sectors with unequal reach", () => {
		const plan = createGrowthPlan(47);
		const sectors = new Map<string, number>();
		for (const m of plan.modules) {
			const key = m.angle + ":" + m.side;
			sectors.set(
				key,
				Math.max(sectors.get(key) ?? 0, Math.hypot(m.y, m.z + 170)),
			);
		}
		expect(sectors.size).toBe(4);
		expect(new Set([...sectors.values()].map(Math.round)).size).toBeGreaterThan(
			1,
		);
	});
	test("seed changes modules without moving the fixed socket lattice", () => {
		const a = createGrowthPlan(1),
			b = createGrowthPlan(2);
		expect(a.modules.map((m) => m.kind)).not.toEqual(
			b.modules.map((m) => m.kind),
		);
		const sockets = (ms: GrowthModule[]) =>
			ms.map(({ id, x, y, z, parentId }) => ({ id, x, y, z, parentId }));
		expect(sockets(a.modules)).toEqual(sockets(b.modules));
	});
	test("invalid counts and seeds are refused, never silently rerolled or rounded", () => {
		const p = createGrowthPlan(47);
		for (const n of [-1, 1.5, NaN, Infinity, CAPACITY + 1])
			expect(() => modulesAt(p, n)).toThrow();
		for (const n of [-1, 1.5, NaN, Infinity, 2 ** 32])
			expect(() => createGrowthPlan(n)).toThrow();
	});
});
