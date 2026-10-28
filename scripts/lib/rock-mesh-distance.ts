/** Exact point-to-mesh measurement from node #949 spike commit 31f9c00c. */
import type { V3 } from "../../src/rock-heightfields";
import { dot, sub } from "./v3";
/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
	const ab = sub(b, a),
		ac = sub(c, a),
		ap = sub(p, a);
	const d1 = dot(ab, ap),
		d2 = dot(ac, ap);
	if (d1 <= 0 && d2 <= 0) return a;
	const bp = sub(p, b),
		d3 = dot(ab, bp),
		d4 = dot(ac, bp);
	if (d3 >= 0 && d4 <= d3) return b;
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
	}
	const cp = sub(p, c),
		d5 = dot(ab, cp),
		d6 = dot(ac, cp);
	if (d6 >= 0 && d5 <= d6) return c;
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
	}
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return [
			b[0] + (c[0] - b[0]) * w,
			b[1] + (c[1] - b[1]) * w,
			b[2] + (c[2] - b[2]) * w,
		];
	}
	const denom = 1 / (va + vb + vc),
		v = vb * denom,
		w = vc * denom;
	return [
		a[0] + ab[0] * v + ac[0] * w,
		a[1] + ab[1] * v + ac[1] * w,
		a[2] + ab[2] * v + ac[2] * w,
	];
}
/** A uniform grid of n³ cubes from lo, spanning the mesh; cell c holds triangle ids ids[start[c]] to ids[start[c + 1] - 1]. */
export interface MeshIndex {
	tris: Float32Array;
	n: number;
	lo: number;
	cell: number;
	start: Int32Array;
	ids: Int32Array;
}
/** Bin each triangle's bounding box into an n³ grid over the mesh's bounding cube. */
export function indexMesh(tris: Float32Array, n = 96): MeshIndex {
	let lo = Infinity,
		hi = -Infinity;
	for (const v of tris) {
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
	}
	if (!(hi > lo)) {
		lo = Number.isFinite(lo) ? lo - 0.5 : 0;
		hi = lo + 1;
	}
	const cell = (hi - lo) / n;
	const ix = (v: number) =>
		Math.min(n - 1, Math.max(0, Math.floor((v - lo) / cell)));
	const count = tris.length / 9;
	const box = new Int32Array(count * 6);
	const start = new Int32Array(n * n * n + 1);
	const visit = (t: number, at: (c: number) => void) => {
		const b = t * 6;
		for (let k = box[b + 2]; k <= box[b + 5]; k++)
			for (let j = box[b + 1]; j <= box[b + 4]; j++)
				for (let i = box[b]; i <= box[b + 3]; i++) at((k * n + j) * n + i);
	};
	for (let t = 0; t < count; t++) {
		const o = t * 9;
		for (let k = 0; k < 3; k++) {
			box[t * 6 + k] = ix(
				Math.min(tris[o + k], tris[o + 3 + k], tris[o + 6 + k]),
			);
			box[t * 6 + 3 + k] = ix(
				Math.max(tris[o + k], tris[o + 3 + k], tris[o + 6 + k]),
			);
		}
		visit(t, (c) => start[c + 1]++);
	}
	for (let c = 0; c < n * n * n; c++) start[c + 1] += start[c];
	const ids = new Int32Array(start[n * n * n]);
	const fill = start.slice(0, n * n * n);
	for (let t = 0; t < count; t++) visit(t, (c) => (ids[fill[c]++] = t));
	return { tris, n, lo, cell, start, ids };
}
function outside(v: number, from: number, to: number): number {
	return v < from ? from - v : v > to ? v - to : 0;
}
function distanceToUnscannedCells(
	m: MeshIndex,
	p: V3,
	a: number[],
	b: number[],
): number {
	const { n, lo, cell } = m,
		hi = lo + n * cell;
	const gap = p.map((v) => outside(v, lo, hi));
	const rest = gap[0] * gap[0] + gap[1] * gap[1] + gap[2] * gap[2];
	let bound = Infinity;
	for (let k = 0; k < 3; k++) {
		const others = rest - gap[k] * gap[k];
		if (a[k] > 0) {
			const d = Math.max(0, p[k] - (lo + a[k] * cell));
			bound = Math.min(bound, Math.sqrt(d * d + others));
		}
		if (b[k] < n - 1) {
			const d = Math.max(0, lo + (b[k] + 1) * cell - p[k]);
			bound = Math.min(bound, Math.sqrt(d * d + others));
		}
	}
	return bound - cell * 1e-9;
}
/** Distance from p to the mesh, and the closest point; exact for any p, inside or outside the grid. */
export function meshDistance(m: MeshIndex, p: V3): { d: number; q: V3 } {
	const { n, lo, cell, tris, start, ids } = m;
	const c = p.map((v) =>
		Math.min(n - 1, Math.max(0, Math.floor((v - lo) / cell))),
	);
	let best = Infinity,
		bq: V3 = p;
	const seen = new Set<number>();
	for (let ring = 0; ring < n; ring++) {
		const a = c.map((v) => Math.max(0, v - ring)),
			b = c.map((v) => Math.min(n - 1, v + ring));
		for (let k = a[2]; k <= b[2]; k++)
			for (let j = a[1]; j <= b[1]; j++)
				for (let i = a[0]; i <= b[0]; i++) {
					if (
						Math.max(
							Math.abs(i - c[0]),
							Math.abs(j - c[1]),
							Math.abs(k - c[2]),
						) !== ring
					)
						continue;
					const cellIndex = (k * n + j) * n + i;
					for (let s = start[cellIndex]; s < start[cellIndex + 1]; s++) {
						const t = ids[s];
						if (seen.has(t)) continue;
						seen.add(t);
						const o = t * 9;
						const q = closestOnTriangle(
							p,
							[tris[o], tris[o + 1], tris[o + 2]],
							[tris[o + 3], tris[o + 4], tris[o + 5]],
							[tris[o + 6], tris[o + 7], tris[o + 8]],
						);
						const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
						if (d < best) {
							best = d;
							bq = q;
						}
					}
				}
		if (best <= distanceToUnscannedCells(m, p, a, b)) break;
	}
	return { d: best, q: bq };
}
