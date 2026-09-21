/**
 * The refinery's and the outpost's vocabularies (#257), held to what the
 * trade Assembly's is held to in `tests/wfc.test.ts`: symmetric tables, a
 * plan reproduced byte for byte from its seed, every placed module attached
 * to the planted mass through occupied cells, every leaf naming a host, the
 * field inside the diamond — and plans that differ, because a vocabulary
 * whose every seed solved to the plants alone would be decoration.
 *
 * Both are arithmetic, so this is the headless half; whether the parts
 * *touch* is `tests/station-mesh.test.ts`'s island check over the built
 * forms, and what they look like is the sheet's.
 */

import { describe, expect, test } from "bun:test";
import {
	EMPTY,
	type Vocabulary,
	allowedOf,
	centreOf,
	placementsOf,
	specOf,
} from "../src/station-modular";
import {
	OUTPOST,
	OUTPOST_VOCABULARY,
	REFINERY,
	REFINERY_VOCABULARY,
} from "../src/station-plant";
import { BIT, DIRECTIONS, opposite, solvePlan } from "../src/wfc";

const SEEDS = [0, 1, 2, 3, 17, 42, 1000, 65535, 7, 8, 12345, 99999];

const VOCABULARIES: [string, Vocabulary][] = [
	["refinery", REFINERY_VOCABULARY],
	["outpost", OUTPOST_VOCABULARY],
];

describe.each(VOCABULARIES)("the %s vocabulary", (name, vocabulary) => {
	test("is well formed: ids in range, every module classed once, plants inside the field", () => {
		expect(vocabulary.nModules).toBeLessThanOrEqual(32);
		expect(vocabulary.grid % 2).toBe(1);
		expect(vocabulary.grid).toBeGreaterThanOrEqual(2 * vocabulary.radius + 3);
		for (const [a, b] of vocabulary.alongX) {
			expect(a).toBeGreaterThan(EMPTY);
			expect(b).toBeGreaterThan(EMPTY);
			expect(a).toBeLessThan(vocabulary.nModules);
			expect(b).toBeLessThan(vocabulary.nModules);
			// A leaf beside a leaf has no host to strut from.
			expect([
				name,
				a,
				b,
				vocabulary.leaves.has(a) && vocabulary.leaves.has(b),
			]).toEqual([name, a, b, false]);
		}
		for (let m = 1; m < vocabulary.nModules; m++) {
			const host = vocabulary.hosts.has(m);
			const leaf = vocabulary.leaves.has(m);
			expect([name, m, host !== leaf]).toEqual([name, m, true]);
			expect(vocabulary.swap(vocabulary.swap(m))).toBe(m);
			expect(vocabulary.weights[m]).toBeGreaterThanOrEqual(0);
		}
		for (const p of vocabulary.plants) {
			expect(Math.abs(p.dx) + Math.abs(p.dy)).toBeLessThanOrEqual(
				vocabulary.radius,
			);
			expect(p.m).toBeGreaterThan(EMPTY);
		}
		// A planted-only module the solver could reach for would be a second
		// head house; one it can never place is what the set is for.
		for (const m of vocabulary.plantedOnly)
			expect(vocabulary.plants.some((p) => p.m === m)).toBe(true);
	});

	test("the direction tables are symmetric: b beside a implies a beside b", () => {
		const allowed = allowedOf(vocabulary);
		for (let dir = 0; dir < 4; dir++)
			for (let a = 0; a < vocabulary.nModules; a++)
				for (let b = 0; b < vocabulary.nModules; b++) {
					const ab = (allowed[dir][a] & BIT(b)) !== 0;
					const ba = (allowed[opposite(dir)][b] & BIT(a)) !== 0;
					expect([name, dir, a, b, ab]).toEqual([name, dir, a, b, ba]);
				}
	});

	test("the same seed gives the same plan, and different seeds differ", () => {
		const spec = specOf(vocabulary);
		const first = solvePlan(7, spec);
		const again = solvePlan(7, spec);
		expect([...again.plan]).toEqual([...first.plan]);
		const other = solvePlan(8, spec);
		expect([...other.plan]).not.toEqual([...first.plan]);
	});

	test("no plan needs the fallback, over a spread of seeds", () => {
		for (const seed of SEEDS)
			expect([name, seed, placementsOf(vocabulary, seed).fallback]).toEqual([
				name,
				seed,
				false,
			]);
	});

	test("every plant is in every plan", () => {
		for (const seed of SEEDS) {
			const { placements } = placementsOf(vocabulary, seed);
			for (const plant of vocabulary.plants) {
				const at = placements.find(
					(p) => p.dx === plant.dx && p.dy === plant.dy,
				);
				expect([name, seed, plant.dx, plant.dy, at?.module]).toEqual([
					name,
					seed,
					plant.dx,
					plant.dy,
					plant.m,
				]);
			}
		}
	});

	test("every placed module is grid-adjacent to the centre through occupied cells", () => {
		for (const seed of SEEDS) {
			const { placements } = placementsOf(vocabulary, seed);
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
			expect([name, seed, seen.size]).toEqual([name, seed, placements.length]);
		}
	});

	test("every leaf names a host beside it, and every module is inside the diamond", () => {
		const centre = centreOf(vocabulary);
		for (const seed of SEEDS) {
			const { placements } = placementsOf(vocabulary, seed);
			for (const p of placements) {
				for (let dir = 0; dir < 4; dir++)
					expect(p.joined[dir]).toBe(p.beside[dir] !== EMPTY);
				expect(Math.abs(p.dx) + Math.abs(p.dy)).toBeLessThanOrEqual(
					vocabulary.radius,
				);
				expect(Math.abs(p.dx)).toBeLessThan(centre);
				expect(Math.abs(p.dy)).toBeLessThan(centre);
				if (vocabulary.leaves.has(p.module)) {
					expect([name, seed, p.dx, p.dy, p.host >= 0]).toEqual([
						name,
						seed,
						p.dx,
						p.dy,
						true,
					]);
					const [hx, hy] = DIRECTIONS[p.host];
					const host = placements.find(
						(q) => q.dx === p.dx + hx && q.dy === p.dy + hy,
					);
					expect(host && vocabulary.hosts.has(host.module)).toBe(true);
				}
				// A cell the vocabulary bars a module from never holds it.
				const barred = vocabulary.barred?.(p.dx, p.dy) ?? 0;
				expect([
					name,
					seed,
					p.dx,
					p.dy,
					(barred & BIT(p.module)) !== 0,
				]).toEqual([name, seed, p.dx, p.dy, false]);
			}
		}
	});

	test("plans are not all the same shape, and every free module appears somewhere", () => {
		const kinds = new Set<number>();
		let extra = 0;
		for (const seed of SEEDS) {
			const { placements } = placementsOf(vocabulary, seed);
			extra += placements.length - vocabulary.plants.length;
			for (const p of placements) kinds.add(p.module);
		}
		expect(extra).toBeGreaterThan(SEEDS.length * 3);
		for (let m = 1; m < vocabulary.nModules; m++)
			expect([name, m, kinds.has(m)]).toEqual([name, m, true]);
	});
});

describe("what the two vocabularies plant", () => {
	test("the refinery plants a head house at the centre and a pipe line to the mine head at the −Y tip", () => {
		const v = REFINERY_VOCABULARY;
		const at = (dx: number, dy: number) =>
			v.plants.find((p) => p.dx === dx && p.dy === dy)?.m;
		expect(at(0, 0)).toBe(REFINERY.HEAD);
		expect(at(0, -v.radius)).toBe(REFINERY.SHAFT);
		for (let d = 1; d < v.radius; d++) expect(at(0, -d)).toBe(REFINERY.PIPE_Y);
		expect(at(1, -1)).toBe(REFINERY.FLARE);
		expect(at(-1, -1)).toBe(REFINERY.RADIATOR);
		expect(v.plantedOnly.has(REFINERY.HEAD)).toBe(true);
		expect(v.plantedOnly.has(REFINERY.SHAFT)).toBe(true);
	});

	test("the outpost plants a core can, a truss spine to both tips, and a can either side", () => {
		const v = OUTPOST_VOCABULARY;
		const at = (dx: number, dy: number) =>
			v.plants.find((p) => p.dx === dx && p.dy === dy)?.m;
		expect(at(0, 0)).toBe(OUTPOST.CORE);
		for (let d = 1; d <= v.radius; d++) {
			expect(at(0, d)).toBe(OUTPOST.TRUSS_Y);
			expect(at(0, -d)).toBe(OUTPOST.TRUSS_Y);
		}
		expect(at(1, 0)).toBe(OUTPOST.CAN_X);
		expect(at(-1, 0)).toBe(OUTPOST.CAN_X);
	});

	test("the outpost keeps its tower out from under the pad", () => {
		// The pad deck overhangs the first ring of cells, so a tower there
		// would stand up into its underside.
		const v = OUTPOST_VOCABULARY;
		for (const [dx, dy] of DIRECTIONS)
			expect((v.barred?.(dx, dy) ?? 0) & BIT(OUTPOST.TOWER)).not.toBe(0);
		expect((v.barred?.(2, 0) ?? 0) & BIT(OUTPOST.TOWER)).toBe(0);
	});
});

describe("the two plans are pinned at seed zero", () => {
	/**
	 * `tests/wfc.test.ts` pins the trade Assembly's seed-zero plan because a
	 * refactor that moved every plan consistently would pass every other row.
	 * These two are new in #257 and have no prior plan to pin against; they
	 * are pinned on the PR that introduces them, so that a change to a
	 * weight, a pair rule or the solver is a red run here and has to be meant.
	 */
	const hexOf = (plan: Uint8Array) =>
		Array.from(plan, (m) => m.toString(16).padStart(2, "0")).join("");

	test("the refinery Works at seed zero", () => {
		expect(hexOf(solvePlan(0, specOf(REFINERY_VOCABULARY)).plan)).toBe(
			"00000000000000000000060000000000090308000000000201020200000004030500000000000400000000000000000000",
		);
	});

	test("the outpost Cluster at seed zero", () => {
		expect(hexOf(solvePlan(0, specOf(OUTPOST_VOCABULARY)).plan)).toBe(
			"000000000000000000000000000500000000000000060500000000000000000508030000000306020102000000000004000500000000000000000500000000000000000500000000000000000000000000",
		);
	});
});
