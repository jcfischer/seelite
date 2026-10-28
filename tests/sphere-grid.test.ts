import { describe, expect, test } from "bun:test";
import {
	type Bounds,
	INDEX_CELL_KM,
	boundsOfBox,
	buildBoxGrid,
	queryBoxGrid,
} from "../src/sphere-grid";
import { makeRng } from "../src/wfc";

type V = { x: number; y: number; z: number };

const unit = (v: V): V => {
	const n = Math.hypot(v.x, v.y, v.z);
	return { x: v.x / n, y: v.y / n, z: v.z / n };
};
const cross = (a: V, b: V): V => ({
	x: a.y * b.z - a.z * b.y,
	y: a.z * b.x - a.x * b.z,
	z: a.x * b.y - a.y * b.x,
});

function randomAxes(rng: () => number): [V, V, V] {
	const a = unit({ x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 });
	const b = unit(cross(a, { x: rng() - 0.5, y: rng() - 0.5, z: rng() - 0.5 }));
	return [a, b, cross(a, b)];
}

function corners(c: V, axes: readonly [V, V, V], h: readonly number[]): V[] {
	const out: V[] = [];
	for (const s0 of [-1, 1])
		for (const s1 of [-1, 1])
			for (const s2 of [-1, 1]) {
				const k = [s0 * h[0], s1 * h[1], s2 * h[2]];
				out.push({
					x: c.x + axes[0].x * k[0] + axes[1].x * k[1] + axes[2].x * k[2],
					y: c.y + axes[0].y * k[0] + axes[1].y * k[1] + axes[2].y * k[2],
					z: c.z + axes[0].z * k[0] + axes[1].z * k[1] + axes[2].z * k[2],
				});
			}
	return out;
}

const overlaps = (a: Bounds, b: Bounds) =>
	a.minX <= b.maxX &&
	a.maxX >= b.minX &&
	a.minY <= b.maxY &&
	a.maxY >= b.minY &&
	a.minZ <= b.maxZ &&
	a.maxZ >= b.minZ;

function query(grid: ReturnType<typeof buildBoxGrid>, q: Bounds): number[] {
	const out: number[] = [];
	queryBoxGrid(grid, q.minX, q.minY, q.minZ, q.maxX, q.maxY, q.maxZ, (n) => {
		out.push(n);
	});
	return out;
}

describe("the box grid (node #1118)", () => {
	test("an oriented box's bounds are the tightest box over its corners", () => {
		const raw = makeRng(11);
		const rng = () => raw() / 2 ** 32;
		for (let i = 0; i < 200; i++) {
			const c = { x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 };
			const axes = randomAxes(rng);
			const h = [rng() * 0.7, rng() * 0.01, rng() * 0.2];
			const b = boundsOfBox(c.x, c.y, c.z, axes, h[0], h[1], h[2]);
			const ps = corners(c, axes, h);
			const eps = 1e-12;
			expect(b.minX).toBeCloseTo(Math.min(...ps.map((p) => p.x)), 12);
			expect(b.maxX).toBeCloseTo(Math.max(...ps.map((p) => p.x)), 12);
			expect(b.minY).toBeCloseTo(Math.min(...ps.map((p) => p.y)), 12);
			expect(b.maxY).toBeCloseTo(Math.max(...ps.map((p) => p.y)), 12);
			expect(b.minZ).toBeCloseTo(Math.min(...ps.map((p) => p.z)), 12);
			expect(b.maxZ).toBeCloseTo(Math.max(...ps.map((p) => p.z)), 12);
			for (const p of ps)
				expect(
					p.x >= b.minX - eps &&
						p.x <= b.maxX + eps &&
						p.y >= b.minY - eps &&
						p.y <= b.maxY + eps &&
						p.z >= b.minZ - eps &&
						p.z <= b.maxZ + eps,
				).toBe(true);
		}
		const plain = boundsOfBox(1, 2, 3, undefined, 0.1, 0.2, 0.3);
		expect(plain).toEqual({
			minX: 0.9,
			minY: 1.8,
			minZ: 2.7,
			maxX: 1.1,
			maxY: 2.2,
			maxZ: 3.3,
		});
	});

	test("every query returns each box its range touches, once, against brute force", () => {
		const raw = makeRng(1118);
		const rng = () => raw() / 2 ** 32;
		const boxes: Bounds[] = [];
		for (let i = 0; i < 1500; i++) {
			const c = { x: rng() * 3 - 1.5, y: rng() * 3 - 1.5, z: rng() * 3 - 1.5 };
			const pick = rng();
			if (pick < 0.5) {
				const h = [rng() * 0.02, rng() * 0.02, rng() * 0.02];
				boxes.push(
					boundsOfBox(c.x, c.y, c.z, randomAxes(rng), h[0], h[1], h[2]),
				);
			} else if (pick < 0.8) {
				const h = [0.2 + rng() * 0.5, 0.004, 0.01 + rng() * 0.03];
				boxes.push(
					boundsOfBox(c.x, c.y, c.z, randomAxes(rng), h[0], h[1], h[2]),
				);
			} else if (pick < 0.97) {
				const r = rng() * 0.3;
				boxes.push({
					minX: c.x - r,
					minY: c.y - r,
					minZ: c.z - r,
					maxX: c.x + r,
					maxY: c.y + r,
					maxZ: c.z + r,
				});
			} else {
				const r = 0.5 + rng() * 1.5;
				boxes.push({
					minX: c.x - r,
					minY: c.y - r,
					minZ: c.z - r,
					maxX: c.x + r,
					maxY: c.y + r,
					maxZ: c.z + r,
				});
			}
		}
		const grid = buildBoxGrid(boxes, INDEX_CELL_KM);
		let checked = 0;
		for (let i = 0; i < 3000; i++) {
			const c = { x: rng() * 4 - 2, y: rng() * 4 - 2, z: rng() * 4 - 2 };
			const r = i % 3 === 0 ? 0 : rng() ** 3 * (i % 7 === 0 ? 3 : 0.3);
			const q = {
				minX: c.x - r,
				minY: c.y - r,
				minZ: c.z - r,
				maxX: c.x + r,
				maxY: c.y + r,
				maxZ: c.z + r,
			};
			const got = query(grid, q);
			expect(new Set(got).size).toBe(got.length);
			const set = new Set(got);
			const missing = boxes
				.map((b, n) => (overlaps(b, q) ? n : -1))
				.filter((n) => n >= 0 && !set.has(n));
			expect({ i, missing }).toEqual({ i, missing: [] });
			checked += got.length;
		}
		expect(checked).toBeGreaterThan(0);
	});

	test("a 1.38 km plate, 28 cells long, is indexed cell by cell, not visited by every query", () => {
		const c = Math.cos(0.17);
		const s = Math.sin(0.17);
		const plate = boundsOfBox(
			0,
			0,
			0,
			[
				{ x: c, y: s, z: 0 },
				{ x: -s, y: c, z: 0 },
				{ x: 0, y: 0, z: 1 },
			],
			0.69,
			0.004,
			0.01,
		);
		const grid = buildBoxGrid([plate], INDEX_CELL_KM);
		expect(grid.large).toEqual([]);
		expect(
			query(grid, {
				...plate,
				maxX: plate.minX,
				maxY: plate.minY,
				maxZ: plate.minZ,
			}),
		).toEqual([0]);
		expect(
			query(grid, { minX: 5, minY: 5, minZ: 5, maxX: 5, maxY: 5, maxZ: 5 }),
		).toEqual([]);
	});

	test("a box larger than the large threshold is still returned by every query", () => {
		const huge: Bounds = {
			minX: -3,
			minY: -3,
			minZ: -3,
			maxX: 3,
			maxY: 3,
			maxZ: 3,
		};
		const small: Bounds = {
			minX: 0,
			minY: 0,
			minZ: 0,
			maxX: 0.01,
			maxY: 0.01,
			maxZ: 0.01,
		};
		const grid = buildBoxGrid([small, huge], INDEX_CELL_KM);
		expect(grid.large).toEqual([1]);
		for (const at of [0, 2.9, -2.9, 50, -400])
			expect(
				query(grid, {
					minX: at,
					minY: at,
					minZ: at,
					maxX: at,
					maxY: at,
					maxZ: at,
				}),
			).toContain(1);
		expect(
			query(grid, {
				minX: -10,
				minY: -10,
				minZ: -10,
				maxX: 10,
				maxY: 10,
				maxZ: 10,
			}).sort(),
		).toEqual([0, 1]);
	});
});
