/** Texel-centre outermost exits, from node #949 spike commit 31f9c00c.
 * No dilation: this is the symmetric heightfield selected by D1.
 */
import {
	dirOf,
	faceUV,
	ROCK_HEIGHTFIELD_FACES,
	type V3,
} from "../../src/rock-heightfields";
import { cross, dot, sub } from "./v3";
const texel = (res: number, f: number, i: number, j: number) =>
	(f * res + j) * res + i;
export function outermostExits(tris: Float32Array, res: number): Float32Array {
	const nt = tris.length / 9;
	const bins: number[][] = Array.from(
		{ length: ROCK_HEIGHTFIELD_FACES * res * res },
		() => [],
	);
	for (let t = 0; t < nt; t++) {
		const o = t * 9;
		const vs: V3[] = [0, 1, 2].map(
			(k) => [tris[o + k * 3], tris[o + k * 3 + 1], tris[o + k * 3 + 2]] as V3,
		);
		const seen = new Set<number>();
		// Dense enough that a triangle touches every texel it spans: its angular
		// size over the texel's, sampled at twice that.
		const ang = Math.max(
			...[0, 1, 2].map((k) => {
				const a = vs[k],
					b = vs[(k + 1) % 3];
				return (
					Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) /
					Math.max(1e-3, Math.min(Math.hypot(...a), Math.hypot(...b)))
				);
			}),
		);
		const steps = Math.max(2, Math.ceil((ang * res) / 0.7));
		for (let a = 0; a <= steps; a++)
			for (let b = 0; a + b <= steps; b++) {
				const w0 = a / steps,
					w1 = b / steps,
					w2 = 1 - w0 - w1;
				const p: V3 = [0, 1, 2].map(
					(k) => vs[0][k] * w0 + vs[1][k] * w1 + vs[2][k] * w2,
				) as V3;
				const [f, u, v] = faceUV(p);
				const i = Math.min(res - 1, Math.floor(((u + 1) / 2) * res)),
					j = Math.min(res - 1, Math.floor(((v + 1) / 2) * res));
				for (let dj = -1; dj <= 1; dj++)
					for (let di = -1; di <= 1; di++) {
						const ii = i + di,
							jj = j + dj;
						if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue;
						seen.add(texel(res, f, ii, jj));
					}
			}
		for (const s of seen) bins[s].push(t);
	}
	const raw = new Float32Array(ROCK_HEIGHTFIELD_FACES * res * res);
	for (let f = 0; f < ROCK_HEIGHTFIELD_FACES; f++)
		for (let j = 0; j < res; j++)
			for (let i = 0; i < res; i++) {
				const d = dirOf(
					f,
					((i + 0.5) / res) * 2 - 1,
					((j + 0.5) / res) * 2 - 1,
				);
				raw[texel(res, f, i, j)] = rayExit(tris, bins[texel(res, f, i, j)], d);
			}
	return raw;
}

/** The farthest hit along a ray from the origin, over the listed triangles. */
export function rayExit(
	tris: Float32Array,
	list: Iterable<number>,
	d: V3,
): number {
	let best = 0;
	for (const t of list) {
		const o = t * 9;
		const a: V3 = [tris[o], tris[o + 1], tris[o + 2]];
		const e1 = sub([tris[o + 3], tris[o + 4], tris[o + 5]], a),
			e2 = sub([tris[o + 6], tris[o + 7], tris[o + 8]], a);
		const pv = cross(d, e2),
			det = dot(e1, pv);
		if (Math.abs(det) < 1e-12) continue;
		const tv: V3 = [-a[0], -a[1], -a[2]];
		const u = dot(tv, pv) / det;
		if (u < 0 || u > 1) continue;
		const q = cross(tv, e1);
		const v = dot(d, q) / det;
		if (v < 0 || u + v > 1) continue;
		const s = dot(e2, q) / det;
		if (s > best) best = s;
	}
	return best;
}
