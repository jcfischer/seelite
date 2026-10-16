import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Mesh } from "three";
import {
	ROCK_ARCHETYPE_COUNT,
	ROCK_HEIGHTFIELD_HEADER_BYTES,
	ROCK_HEIGHTFIELD_RES,
	dirOf,
	radiusAt,
	type RockHeightfield,
	type V3,
} from "../../src/rock-heightfields";
import { indexMesh, meshDistance } from "./rock-mesh-distance";
import { outermostExits } from "./rock-ray-exits";
import { decodeShippedGlb } from "./shipped-glb";

export const ROCK_GLB = "src/models/asteroids.glb";
export const ROCK_HEIGHTFIELDS_BIN = "src/models/rock-heightfields.bin";
export interface RockArchetype {
	index: number;
	name: string;
	/** Every drawn triangle of L0, L1, L2, after authored world transforms. */
	levels: Float32Array[];
}

export async function loadRockArchetypes(
	path = ROCK_GLB,
): Promise<RockArchetype[]> {
	const scene = await decodeShippedGlb(path);
	scene.updateMatrixWorld(true);
	const rocks: RockArchetype[] = [];
	scene.traverse((object) => {
		if (!(object instanceof Mesh)) return;
		const match = /^rock_(\d+)_(.*)_L([012])$/.exec(object.name);
		if (!match) throw new Error(`Unexpected rock mesh ${object.name}`);
		const index = Number(match[1]),
			level = Number(match[3]);
		if (index >= ROCK_ARCHETYPE_COUNT)
			throw new Error(`Unexpected rock index ${index}`);
		const rock = (rocks[index] ??= { index, name: match[2], levels: [] });
		if (rock.levels[level] || rock.name !== match[2])
			throw new Error(`Duplicate or inconsistent rock ${object.name}`);
		const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
		const flat = geometry.index ? geometry.toNonIndexed() : geometry;
		const p = flat.getAttribute("position");
		const triangles = new Float32Array(p.count * 3);
		if (!p.count || p.count % 3)
			throw new Error(`Invalid rock triangles ${object.name}`);
		for (let i = 0; i < p.count; i++) {
			const v: V3 = [p.getX(i), p.getY(i), p.getZ(i)];
			const r = Math.hypot(...v);
			if (!Number.isFinite(r) || r <= 0 || r > 1.00001)
				throw new Error(`Rock ${object.name} outside unit bound: ${r}`);
			triangles.set(v, i * 3);
		}
		rock.levels[level] = triangles;
		flat.dispose();
		if (flat !== geometry) geometry.dispose();
	});
	for (let i = 0; i < ROCK_ARCHETYPE_COUNT; i++)
		if (!rocks[i] || [0, 1, 2].some((level) => !rocks[i].levels[level]))
			throw new Error(`Incomplete rock archetype ${i}`);
	return rocks;
}

function allLevels(rock: RockArchetype): Float32Array {
	const all = new Float32Array(rock.levels.reduce((n, l) => n + l.length, 0));
	let offset = 0;
	for (const level of rock.levels) {
		all.set(level, offset);
		offset += level.length;
	}
	return all;
}

export function fitRockHeightfield(rock: RockArchetype): Float32Array {
	return outermostExits(allLevels(rock), ROCK_HEIGHTFIELD_RES);
}

/** Deterministic symmetric fit: exact centre-ray outermost exits across all LODs. */
export async function generateRockHeightfields(
	path = ROCK_GLB,
): Promise<Buffer> {
	const source = readFileSync(new URL(`../../${path}`, import.meta.url));
	const hash = createHash("sha256").update(source).digest();
	const rocks = await loadRockArchetypes(path);
	const res = ROCK_HEIGHTFIELD_RES,
		samples = 6 * res * res;
	const bytes = Buffer.alloc(
		ROCK_HEIGHTFIELD_HEADER_BYTES + rocks.length * samples * 2,
	);
	bytes.write("RHF1", 0, "ascii");
	bytes.writeUInt16LE(1, 4);
	bytes.writeUInt16LE(res, 6);
	bytes.writeUInt16LE(rocks.length, 8);
	bytes.writeUInt16LE(6, 10);
	hash.copy(bytes, 16);
	let offset = ROCK_HEIGHTFIELD_HEADER_BYTES;
	for (const rock of rocks) {
		const radii = fitRockHeightfield(rock);
		for (const radius of radii) {
			if (!Number.isFinite(radius) || radius <= 0 || radius > 1.00001)
				throw new Error(`Invalid generated radius for ${rock.name}: ${radius}`);
			// Quantize inward with one additional uint16 quantum of clearance.
			// Nearest rounding measured 0.03010485 R empty on stepped-strata,
			// just beyond node #966's 0.0301 R gate. Radii change by <2/65535 R;
			// both Euclidean fit budgets are checked on the decoded bytes.
			bytes.writeUInt16LE(
				Math.max(1, Math.floor(Math.min(1, radius) * 65535) - 1),
				offset,
			);
			offset += 2;
		}
	}
	return bytes;
}

/** Fine lattice of the bilinear surface, exactly as measure-outside.ts in #949. */
function triangulate(h: RockHeightfield): Float32Array {
	const k = h.res * 2,
		out = new Float32Array(6 * k * k * 18);
	const p = (f: number, i: number, j: number): V3 => {
		const d = dirOf(f, (i / k) * 2 - 1, (j / k) * 2 - 1);
		const r = radiusAt(h, d);
		return [d[0] * r, d[1] * r, d[2] * r];
	};
	let offset = 0;
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < k; j++)
			for (let i = 0; i < k; i++) {
				const a = p(f, i, j),
					b = p(f, i + 1, j),
					c = p(f, i + 1, j + 1),
					d = p(f, i, j + 1);
				for (const v of [a, b, c, a, c, d]) {
					out.set(v, offset);
					offset += 3;
				}
			}
	return out;
}

/**
 * Re-run #949 measure-euclid.ts (S=80, L0 truth) and measure-outside.ts
 * (2×res lattice, every vertex of every drawn level). The p99 population is
 * outside vertices only, including triangle duplicates, as in the spike.
 * These are sampled Euclidean errors, not global bounds or radial gaps.
 */
export function measureRockFit(rock: RockArchetype, h: RockHeightfield) {
	const truth = indexMesh(rock.levels[0]);
	const s = 80,
		exits = outermostExits(rock.levels[0], s);
	let emptyMax = 0,
		sample = 0;
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < s; j++)
			for (let i = 0; i < s; i++, sample++) {
				const d = dirOf(f, ((i + 0.5) / s) * 2 - 1, ((j + 0.5) / s) * 2 - 1);
				const r = radiusAt(h, d);
				if (r > exits[sample] + 1e-6)
					emptyMax = Math.max(
						emptyMax,
						meshDistance(truth, [d[0] * r, d[1] * r, d[2] * r]).d,
					);
			}
	const proxy = indexMesh(triangulate(h));
	const outside: number[] = [];
	for (const tris of rock.levels)
		for (let i = 0; i < tris.length; i += 3) {
			const v: V3 = [tris[i], tris[i + 1], tris[i + 2]],
				length = Math.hypot(...v);
			if (length <= radiusAt(h, [v[0] / length, v[1] / length, v[2] / length]))
				continue;
			outside.push(meshDistance(proxy, v).d);
		}
	outside.sort((a, b) => a - b);
	const result = {
		emptyMax,
		outsideP99: outside[Math.floor(outside.length * 0.99)] ?? 0,
		outsideMax: outside.at(-1) ?? 0,
	};
	if (!Object.values(result).every(Number.isFinite))
		throw new Error(`Non-finite rock fit: ${rock.name}`);
	return result;
}
