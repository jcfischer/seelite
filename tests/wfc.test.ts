/**
 * The collapse solver and the modular station's vocabulary (#202).
 *
 * `wfc.ts` is seekolous's solver copied in and given directional adjacency;
 * `station-modular.ts` is what the modules mean. Both are arithmetic, so what
 * a plan has to be is asserted here rather than looked for on a sheet: the
 * tables are symmetric (or propagation contradicts itself), a seed reproduces
 * its plan byte for byte, every placed module is attached to the hub through
 * neighbours, every leaf names a host, and the field stays inside the
 * diamond. And the fallback path is exercised, because a branch nothing
 * reaches is a branch that ships broken.
 */

import { describe, expect, test } from "bun:test";
import {
	DISH,
	EMPTY,
	HUB,
	MODULAR_CENTRE,
	MODULAR_GRID,
	MODULAR_RADIUS,
	N_MODULES,
	RADIATOR,
	TANKS,
	TRUSS_Y,
	TUBE_X,
	buildAllowed,
	isHost,
	isLeaf,
	modularPlacements,
	modularSpec,
} from "../src/station-modular";
import { BIT, DIRECTIONS, opposite, popcount, solvePlan } from "../src/wfc";

describe("the solver", () => {
	test("popcount counts every bit, including the top one", () => {
		expect(popcount(0)).toBe(0);
		expect(popcount(1)).toBe(1);
		expect(popcount(0xffffffff | 0)).toBe(32);
		expect(popcount(BIT(31))).toBe(1);
	});

	test("the direction tables are symmetric: b beside a implies a beside b", () => {
		const allowed = buildAllowed();
		for (let dir = 0; dir < 4; dir++)
			for (let a = 0; a < N_MODULES; a++)
				for (let b = 0; b < N_MODULES; b++) {
					const ab = (allowed[dir][a] & BIT(b)) !== 0;
					const ba = (allowed[opposite(dir)][b] & BIT(a)) !== 0;
					expect([dir, a, b, ab]).toEqual([dir, a, b, ba]);
				}
	});

	test("the same seed gives the same plan, and different seeds differ", () => {
		const spec = modularSpec();
		const first = solvePlan(7, spec);
		const again = solvePlan(7, spec);
		expect([...again.plan]).toEqual([...first.plan]);
		const other = solvePlan(8, spec);
		expect([...other.plan]).not.toEqual([...first.plan]);
	});

	test("a spec that always contradicts falls back to its template", () => {
		// Two modules that may not sit beside each other in any direction, both
		// planted next to each other: no attempt can satisfy it.
		const never = new Uint32Array(2);
		const spec = {
			nModules: 2,
			allowed: [never, never, never, never] as [
				Uint32Array,
				Uint32Array,
				Uint32Array,
				Uint32Array,
			],
			gw: 3,
			gd: 3,
			freeMask: () => BIT(0) | BIT(1),
			plants: [
				{ i: 4, m: 1 },
				{ i: 5, m: 0 },
			],
			weights: new Uint32Array([1, 1]),
			isMass: (m: number) => m === 1,
			orphanTo: 0,
			fallbackFill: 0,
		};
		const result = solvePlan(1, spec);
		expect(result.fallback).toBe(true);
		expect(result.attempts).toBe(8);
		expect(result.plan[4]).toBe(1);
		expect(result.plan[5]).toBe(0);
	});
});

describe("the modular station's plans", () => {
	const seeds = [0, 1, 2, 3, 17, 42, 1000, 65535];

	test("no plan needs the fallback, over a spread of seeds", () => {
		for (const seed of seeds)
			expect([seed, modularPlacements(seed).fallback]).toEqual([seed, false]);
	});

	test("the hub, the spine and the two habitat tubes are in every plan", () => {
		for (const seed of seeds) {
			const { placements } = modularPlacements(seed);
			const at = (dx: number, dy: number) =>
				placements.find((p) => p.dx === dx && p.dy === dy)?.module ?? EMPTY;
			expect(at(0, 0)).toBe(HUB);
			expect(at(1, 0)).toBe(TUBE_X);
			expect(at(-1, 0)).toBe(TUBE_X);
			for (let d = 1; d <= MODULAR_RADIUS; d++) {
				expect(at(0, d)).toBe(TRUSS_Y);
				expect(at(0, -d)).toBe(TRUSS_Y);
			}
		}
	});

	// Grid adjacency, not attachment: this floods over occupied cells, while
	// the built form joins a leaf to its chosen host and nothing else. Whether
	// the parts *touch* is `tests/station-mesh.test.ts`'s island check, which
	// reads every instanced member on its own since sage found a radiator
	// bank 59.65 m from anything while this passed.
	test("every placed module is grid-adjacent to the hub through occupied cells", () => {
		for (const seed of seeds) {
			const { placements } = modularPlacements(seed);
			const key = (dx: number, dy: number) => `${dx},${dy}`;
			const placed = new Map(placements.map((p) => [key(p.dx, p.dy), p]));
			const seen = new Set<string>([key(0, 0)]);
			const queue = [[0, 0]];
			while (queue.length) {
				const [x, y] = queue.pop() as number[];
				for (const [dx, dy] of DIRECTIONS) {
					const k = key(x + dx, y + dy);
					if (seen.has(k) || !placed.has(k)) continue;
					seen.add(k);
					queue.push([x + dx, y + dy]);
				}
			}
			expect([seed, seen.size]).toEqual([seed, placements.length]);
		}
	});

	test("every leaf names a host beside it, and every module is inside the diamond", () => {
		for (const seed of seeds) {
			const { placements } = modularPlacements(seed);
			// `beside` and `joined` are two readings of one fact.
			for (const p of placements)
				for (let dir = 0; dir < 4; dir++)
					expect([seed, p.dx, p.dy, dir, p.joined[dir]]).toEqual([
						seed,
						p.dx,
						p.dy,
						dir,
						p.beside[dir] !== EMPTY,
					]);
			for (const p of placements) {
				expect(Math.abs(p.dx) + Math.abs(p.dy)).toBeLessThanOrEqual(
					MODULAR_RADIUS,
				);
				expect(Math.abs(p.dx)).toBeLessThan(MODULAR_CENTRE);
				if (isLeaf(p.module)) {
					expect([seed, p.dx, p.dy, p.host >= 0]).toEqual([
						seed,
						p.dx,
						p.dy,
						true,
					]);
					const [hx, hy] = DIRECTIONS[p.host];
					const host = placements.find(
						(q) => q.dx === p.dx + hx && q.dy === p.dy + hy,
					);
					expect(host && isHost(host.module)).toBe(true);
				}
			}
		}
	});

	test("plans are not all the same shape, and leaves appear", () => {
		// The vocabulary would be decoration if every seed solved to the plants
		// alone. Over the seed spread, more than the planted eleven cells are
		// placed and each leaf kind turns up somewhere.
		const kinds = new Set<number>();
		let extra = 0;
		for (const seed of seeds) {
			const { placements } = modularPlacements(seed);
			extra += placements.length - (1 + 2 * MODULAR_RADIUS + 2);
			for (const p of placements) kinds.add(p.module);
		}
		expect(extra).toBeGreaterThan(seeds.length * 3);
		for (const leaf of [RADIATOR, TANKS, DISH])
			expect(kinds.has(leaf)).toBe(true);
		expect(MODULAR_GRID % 2).toBe(1);
	});
});
