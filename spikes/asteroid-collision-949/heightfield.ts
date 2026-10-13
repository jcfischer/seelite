/**
 * Node #949 prototype: a rock's proxy as a radial heightfield — the surface
 * radius r(dir) over a cube map, unit-bound space. Three-free. Not production.
 *
 * Built conservatively: each texel holds the outermost exit of the solid along
 * its own and its neighbours' rays, plus a margin, and the surface between
 * texel centres is bilinear. So an overhang is filled (never open), and a
 * drawn vertex lies inside unless the margin is too small; both are measured.
 */
export type V3 = [number, number, number];
export interface Heightfield {
	res: number;
	/** 6 faces × res², radius in unit space. */
	r: Float32Array;
}
/** Direction → face, u, v in [-1, 1] (the usual cube-map major-axis rule). */
export function faceUV(d: V3): [number, number, number] {
	const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
	if (ax >= ay && ax >= az) return d[0] > 0 ? [0, -d[2] / ax, d[1] / ax] : [1, d[2] / ax, d[1] / ax];
	if (ay >= az) return d[1] > 0 ? [2, d[0] / ay, -d[2] / ay] : [3, d[0] / ay, d[2] / ay];
	return d[2] > 0 ? [4, d[0] / az, d[1] / az] : [5, -d[0] / az, d[1] / az];
}
export function dirOf(face: number, u: number, v: number): V3 {
	const p: V3 = [
		[1, -v, -u], [-1, -v, u], [u, 1, v], [u, -1, -v], [u, -v, 1], [-u, -v, -1],
	][face].map(Number) as V3;
	// Undo faceUV's mapping exactly.
	const m: Record<number, V3> = { 0: [1, v, -u], 1: [-1, v, u], 2: [u, 1, -v], 3: [u, -1, v], 4: [u, v, 1], 5: [-u, v, -1] };
	const q = m[face] ?? p;
	const l = Math.hypot(...q);
	return [q[0] / l, q[1] / l, q[2] / l];
}
const texel = (res: number, f: number, i: number, j: number) => (f * res + j) * res + i;
/** Bilinear radius at a direction. */
export function radiusAt(h: Heightfield, d: V3): number {
	const [f, u, v] = faceUV(d);
	const x = Math.min(h.res - 1, Math.max(0, ((u + 1) / 2) * h.res - 0.5));
	const y = Math.min(h.res - 1, Math.max(0, ((v + 1) / 2) * h.res - 0.5));
	const i0 = Math.floor(x), j0 = Math.floor(y), i1 = Math.min(h.res - 1, i0 + 1), j1 = Math.min(h.res - 1, j0 + 1);
	const fx = x - i0, fy = y - j0;
	const r = (i: number, j: number) => h.r[texel(h.res, f, i, j)];
	return (r(i0, j0) * (1 - fx) + r(i1, j0) * fx) * (1 - fy) + (r(i0, j1) * (1 - fx) + r(i1, j1) * fx) * fy;
}
/** Signed radial distance: positive outside. Not Euclidean; exact on the radius. */
export function radialDistance(h: Heightfield, p: V3): number {
	const l = Math.hypot(...p);
	if (l === 0) return -radiusAt(h, [0, 0, 1]);
	return l - radiusAt(h, [p[0] / l, p[1] / l, p[2] / l]);
}
/** The outward normal at a direction, by central differences of the surface. */
export function normalAt(h: Heightfield, d: V3): V3 {
	const e = 1 / h.res;
	const t1: V3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const a = cross(d, t1), al = Math.hypot(...a);
	const ua: V3 = [a[0] / al, a[1] / al, a[2] / al];
	const ub = cross(d, ua);
	const pt = (dd: V3) => { const l = Math.hypot(...dd); const n: V3 = [dd[0] / l, dd[1] / l, dd[2] / l]; const r = radiusAt(h, n); return [n[0] * r, n[1] * r, n[2] * r] as V3; };
	const add = (x: V3, y: V3, s: number): V3 => [x[0] + y[0] * s, x[1] + y[1] * s, x[2] + y[2] * s];
	const pa = sub(pt(add(d, ua, e)), pt(add(d, ua, -e))), pb = sub(pt(add(d, ub, e)), pt(add(d, ub, -e)));
	let n = cross(pa, pb);
	if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] < 0) n = [-n[0], -n[1], -n[2]];
	const nl = Math.hypot(...n);
	return [n[0] / nl, n[1] / nl, n[2] / nl];
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Build from triangles: the outermost exit along `ss`² sub-rays per texel
 * (exact ray–triangle), each texel's footprint maximum, then the max over the
 * 3×3 neighbourhood plus `margin`, so the bilinear surface between texel
 * centres stays outside the sampled truth.
 */
export function buildHeightfield(tris: Float32Array, res: number, margin: number, ss = 4): Heightfield {
	const fine = outermostExits(tris, res * ss);
	const raw = new Float32Array(6 * res * res);
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < res * ss; j++)
			for (let i = 0; i < res * ss; i++) {
				const t = texel(res, f, Math.floor(i / ss), Math.floor(j / ss));
				raw[t] = Math.max(raw[t], fine[texel(res * ss, f, i, j)]);
			}
	const r = new Float32Array(raw.length);
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < res; j++)
			for (let i = 0; i < res; i++) {
				let m = 0;
				for (let dj = -1; dj <= 1; dj++)
					for (let di = -1; di <= 1; di++) {
						const ii = Math.min(res - 1, Math.max(0, i + di)), jj = Math.min(res - 1, Math.max(0, j + dj));
						m = Math.max(m, raw[texel(res, f, ii, jj)]);
					}
				r[texel(res, f, i, j)] = m + margin;
			}
	return { res, r };
}

/** The outermost exit of the solid along each texel-centre ray, exact ray–triangle;
 *  triangles binned by the texels their sampled directions touch. */
export function outermostExits(tris: Float32Array, res: number): Float32Array {
	const nt = tris.length / 9;
	const bins: number[][] = Array.from({ length: 6 * res * res }, () => []);
	for (let t = 0; t < nt; t++) {
		const o = t * 9;
		const vs: V3[] = [0, 1, 2].map((k) => [tris[o + k * 3], tris[o + k * 3 + 1], tris[o + k * 3 + 2]] as V3);
		const seen = new Set<number>();
		// Dense enough that a triangle touches every texel it spans: its angular
		// size over the texel's, sampled at twice that.
		const ang = Math.max(...[0, 1, 2].map((k) => { const a = vs[k], b = vs[(k + 1) % 3]; return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / Math.max(1e-3, Math.min(Math.hypot(...a), Math.hypot(...b))); }));
		const steps = Math.max(2, Math.ceil((ang * res) / 0.7));
		for (let a = 0; a <= steps; a++)
			for (let b = 0; a + b <= steps; b++) {
				const w0 = a / steps, w1 = b / steps, w2 = 1 - w0 - w1;
				const p: V3 = [0, 1, 2].map((k) => vs[0][k] * w0 + vs[1][k] * w1 + vs[2][k] * w2) as V3;
				const [f, u, v] = faceUV(p);
				const i = Math.min(res - 1, Math.floor(((u + 1) / 2) * res)), j = Math.min(res - 1, Math.floor(((v + 1) / 2) * res));
				for (let dj = -1; dj <= 1; dj++)
					for (let di = -1; di <= 1; di++) {
						const ii = i + di, jj = j + dj;
						if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue;
						seen.add(texel(res, f, ii, jj));
					}
			}
		for (const s of seen) bins[s].push(t);
	}
	const raw = new Float32Array(6 * res * res);
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < res; j++)
			for (let i = 0; i < res; i++) {
				const d = dirOf(f, ((i + 0.5) / res) * 2 - 1, ((j + 0.5) / res) * 2 - 1);
				raw[texel(res, f, i, j)] = rayExit(tris, bins[texel(res, f, i, j)], d);
			}
	return raw;
}

/** The farthest hit along a ray from the origin, over the listed triangles. */
export function rayExit(tris: Float32Array, list: Iterable<number>, d: V3): number {
	let best = 0;
	for (const t of list) {
		const o = t * 9;
		const a: V3 = [tris[o], tris[o + 1], tris[o + 2]];
		const e1 = sub([tris[o + 3], tris[o + 4], tris[o + 5]], a), e2 = sub([tris[o + 6], tris[o + 7], tris[o + 8]], a);
		const pv = cross(d, e2), det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
		if (Math.abs(det) < 1e-12) continue;
		const tv: V3 = [-a[0], -a[1], -a[2]];
		const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
		if (u < 0 || u > 1) continue;
		const q = cross(tv, e1);
		const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
		if (v < 0 || u + v > 1) continue;
		const s = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
		if (s > best) best = s;
	}
	return best;
}

export { texel };

/** The nearest hit of a ray from `o` along unit `d`, over all triangles, or Infinity. */
export function rayFirstHit(tris: Float32Array, o: V3, d: V3): number {
	let best = Infinity;
	for (let t = 0; t < tris.length; t += 9) {
		const a: V3 = [tris[t] - o[0], tris[t + 1] - o[1], tris[t + 2] - o[2]];
		const e1: V3 = [tris[t + 3] - tris[t], tris[t + 4] - tris[t + 1], tris[t + 5] - tris[t + 2]];
		const e2: V3 = [tris[t + 6] - tris[t], tris[t + 7] - tris[t + 1], tris[t + 8] - tris[t + 2]];
		const pv = cross(d, e2), det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
		if (Math.abs(det) < 1e-12) continue;
		const tv: V3 = [-a[0], -a[1], -a[2]];
		const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
		if (u < 0 || u > 1) continue;
		const q = cross(tv, e1);
		const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
		if (v < 0 || u + v > 1) continue;
		const s = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
		if (s > 0 && s < best) best = s;
	}
	return best;
}
