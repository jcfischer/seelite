import { describe, expect, test } from "bun:test";
import type { V3 } from "../src/rock-heightfields";
import { loadRockArchetypes } from "../scripts/lib/rock-heightfields";
import {
	closestOnTriangle,
	indexMesh,
	meshDistance,
} from "../scripts/lib/rock-mesh-distance";

function bruteForce(tris: Float32Array, p: V3): number {
	let best = Infinity;
	for (let o = 0; o < tris.length; o += 9) {
		const q = closestOnTriangle(
			p,
			[tris[o], tris[o + 1], tris[o + 2]],
			[tris[o + 3], tris[o + 4], tris[o + 5]],
			[tris[o + 6], tris[o + 7], tris[o + 8]],
		);
		best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
	}
	return best;
}

function seeded(seed: number) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function queries(seed: number): V3[] {
	const rand = seeded(seed),
		out: V3[] = [];
	const dir = (): V3 => {
		const z = rand() * 2 - 1,
			a = rand() * Math.PI * 2,
			r = Math.sqrt(1 - z * z);
		return [r * Math.cos(a), r * Math.sin(a), z];
	};
	for (const radius of [0.3, 0.9, 1.0, 1.1, 1.3, 1.7, 2.5, 4, 10, 60])
		for (let i = 0; i < 24; i++) {
			const d = dir();
			out.push([d[0] * radius, d[1] * radius, d[2] * radius]);
		}
	for (let i = 0; i < 24; i++)
		out.push([
			(rand() * 2 - 1) * 1.2,
			(rand() * 2 - 1) * 1.2,
			rand() < 0.5 ? -1.21 - rand() : 1.21 + rand(),
		]);
	out.push([1.2, 1.2, 1.2], [-1.2, -1.2, -1.2], [1.25, -1.25, 0], [0, 0, 0]);
	return out;
}

function beyondTheGrid(): Float32Array {
	const rand = seeded(1115),
		out = new Float32Array(400 * 9);
	for (let t = 0; t < 400; t++) {
		const centre = [0, 1, 2].map(() => (rand() * 2 - 1) * 2.4);
		for (let v = 0; v < 3; v++)
			for (let k = 0; k < 3; k++)
				out[t * 9 + v * 3 + k] = centre[k] + (rand() * 2 - 1) * 0.3;
	}
	return out;
}

describe("rock mesh distance index (node #1115)", () => {
	test("the default grid is 96 cells a side", () => {
		const tris = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		expect(indexMesh(tris).n).toBe(96);
	});

	test("every distance equals brute force at the default and at 24 cells, inside and outside the grid", async () => {
		const [rock] = await loadRockArchetypes();
		const meshes: [string, Float32Array][] = [
			[rock.name, rock.levels[0]],
			["triangles beyond the grid", beyondTheGrid()],
		];
		for (const [name, tris] of meshes) {
			const grids = [indexMesh(tris), indexMesh(tris, 24), indexMesh(tris, 7)];
			for (const p of queries(name.length)) {
				const want = bruteForce(tris, p);
				for (const grid of grids)
					expect(meshDistance(grid, p).d, `${name} n=${grid.n} ${p}`).toBe(
						want,
					);
			}
		}
	}, 60_000);
});
