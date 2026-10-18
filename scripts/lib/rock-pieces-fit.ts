/**
 * Node #957: colliding empty space of a rock proxy, measured as #956's
 * `spikes/asteroid-sweep-956/measure-fit.ts` does. Each sampled direction's
 * proxy surface point that lies outside the drawn L0 solid counts by its exact
 * distance to the L0 mesh. Two samples: an S² lattice per face (the #949
 * figure), and the directions where the pieces stand farthest above the field,
 * which the lattice may step over. Sampled Euclidean errors in unit R, not
 * global bounds.
 */
import {
	dirOf,
	radiusAt,
	ROCK_HEIGHTFIELD_FACES,
	type RockHeightfield,
	type V3,
} from "../../src/rock-heightfields";
import { envelopeAt, type RockPieces } from "../../src/rock-pieces";
import { v3 } from "../../src/vec3";
import type { RockArchetype } from "./rock-heightfields";
import { indexMesh, type MeshIndex, meshDistance } from "./rock-mesh-distance";
import { outermostExits, rayExit } from "./rock-ray-exits";

export interface EmptySpace {
	max: number;
	p99: number;
}

/** Lattice arm: S² directions per face, a proxy radius against L0's exits along them. */
export function latticeEmptySpace(
	truth: MeshIndex,
	exits: Float32Array,
	s: number,
	radius: (d: V3) => number,
): EmptySpace {
	const overs: number[] = [];
	let k = 0;
	for (let f = 0; f < ROCK_HEIGHTFIELD_FACES; f++)
		for (let j = 0; j < s; j++)
			for (let i = 0; i < s; i++, k++) {
				const d = dirOf(f, ((i + 0.5) / s) * 2 - 1, ((j + 0.5) / s) * 2 - 1);
				const r = radius(d);
				overs.push(
					r > exits[k] + 1e-6
						? meshDistance(truth, [d[0] * r, d[1] * r, d[2] * r]).d
						: 0,
				);
			}
	overs.sort((a, b) => a - b);
	return {
		max: overs[overs.length - 1],
		p99: overs[Math.floor(overs.length * 0.99)],
	};
}

/** Peak arm: the `count` directions of a `grid`² lattice where the envelope most exceeds the field. */
export function peakEmptySpace(
	rock: RockArchetype,
	truth: MeshIndex,
	h: RockHeightfield,
	rp: RockPieces,
	count = 50,
	grid = 150,
): number {
	const ex: { d: V3; e: number }[] = [];
	for (let f = 0; f < ROCK_HEIGHTFIELD_FACES; f++)
		for (let j = 0; j < grid; j++)
			for (let i = 0; i < grid; i++) {
				const d = dirOf(
					f,
					((i + 0.37) / grid) * 2 - 1,
					((j + 0.61) / grid) * 2 - 1,
				);
				ex.push({ d, e: envelopeAt(rp, v3(...d)) - radiusAt(h, d) });
			}
	ex.sort((a, b) => b.e - a.e);
	const all = Array.from({ length: rock.levels[0].length / 9 }, (_, i) => i);
	let worst = 0;
	for (const { d } of ex.slice(0, count)) {
		const r = envelopeAt(rp, v3(...d));
		// Empty space only where the point is outside the drawn solid along its ray.
		if (r > rayExit(rock.levels[0], all, d) + 1e-6)
			worst = Math.max(
				worst,
				meshDistance(truth, [d[0] * r, d[1] * r, d[2] * r]).d,
			);
	}
	return worst;
}

/** Both arms for one rock: the field's own figure and the pieces' figures. */
export function measurePiecesFit(
	rock: RockArchetype,
	h: RockHeightfield,
	rp: RockPieces,
	s = 80,
) {
	const truth = indexMesh(rock.levels[0]);
	const exits = outermostExits(rock.levels[0], s);
	const result = {
		field: latticeEmptySpace(truth, exits, s, (d) => radiusAt(h, d)),
		pieces: latticeEmptySpace(truth, exits, s, (d) => envelopeAt(rp, v3(...d))),
		peak: peakEmptySpace(rock, truth, h, rp),
	};
	const figures = [
		result.field.max,
		result.field.p99,
		result.pieces.max,
		result.pieces.p99,
		result.peak,
	];
	if (!figures.every(Number.isFinite))
		throw new Error(`Non-finite pieces fit: ${rock.name}`);
	return result;
}
