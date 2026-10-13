/** Node #949 prototype: exact point-to-mesh distance, grid-accelerated. Not production. */
import type { V3 } from "./heightfield";
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
	const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
	const d1 = dot(ab, ap), d2 = dot(ac, ap);
	if (d1 <= 0 && d2 <= 0) return a;
	const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
	if (d3 >= 0 && d4 <= d3) return b;
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]; }
	const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
	if (d6 >= 0 && d5 <= d6) return c;
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]; }
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
	const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
	return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}
export interface MeshIndex { tris: Float32Array; n: number; lo: number; cell: number; cells: number[][]; }
export function indexMesh(tris: Float32Array, n = 24, lo = -1.2, hi = 1.2): MeshIndex {
	const cell = (hi - lo) / n;
	const cells: number[][] = Array.from({ length: n * n * n }, () => []);
	const ix = (v: number) => Math.min(n - 1, Math.max(0, Math.floor((v - lo) / cell)));
	for (let t = 0; t < tris.length / 9; t++) {
		const o = t * 9;
		const mn = [0, 1, 2].map((k) => Math.min(tris[o + k], tris[o + 3 + k], tris[o + 6 + k]));
		const mx = [0, 1, 2].map((k) => Math.max(tris[o + k], tris[o + 3 + k], tris[o + 6 + k]));
		for (let k = ix(mn[2]); k <= ix(mx[2]); k++) for (let j = ix(mn[1]); j <= ix(mx[1]); j++) for (let i = ix(mn[0]); i <= ix(mx[0]); i++) cells[(k * n + j) * n + i].push(t);
	}
	return { tris, n, lo, cell, cells };
}
/** Distance from p to the mesh, and the closest point. */
export function meshDistance(m: MeshIndex, p: V3): { d: number; q: V3 } {
	const { n, lo, cell, tris } = m;
	const c = p.map((v) => Math.floor((v - lo) / cell));
	let best = Infinity, bq: V3 = p;
	const seen = new Set<number>();
	for (let ring = 0; ring < n; ring++) {
		for (let k = c[2] - ring; k <= c[2] + ring; k++) for (let j = c[1] - ring; j <= c[1] + ring; j++) for (let i = c[0] - ring; i <= c[0] + ring; i++) {
			if (Math.max(Math.abs(i - c[0]), Math.abs(j - c[1]), Math.abs(k - c[2])) !== ring) continue;
			if (i < 0 || j < 0 || k < 0 || i >= n || j >= n || k >= n) continue;
			for (const t of m.cells[(k * n + j) * n + i]) {
				if (seen.has(t)) continue;
				seen.add(t);
				const o = t * 9;
				const q = closestOnTriangle(p, [tris[o], tris[o + 1], tris[o + 2]], [tris[o + 3], tris[o + 4], tris[o + 5]], [tris[o + 6], tris[o + 7], tris[o + 8]]);
				const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
				if (d < best) { best = d; bq = q; }
			}
		}
		// Every cell within `ring` is searched; anything nearer lies inside it.
		if (best <= ring * cell) break;
	}
	return { d: best, q: bq };
}
