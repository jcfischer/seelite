/**
 * Throwaway prototype for node #949: fit a rock archetype's collision proxy
 * as a set of oriented boxes, in the archetype's unit-bound space. Not
 * production code.
 *
 * The method, so it can run on any archetype set (#953's are in flight):
 *
 * 1. Voxelise the L0 mesh (watertight: ray parity along +x) on an N³ grid
 *    over [-1, 1]³, and take the exact Euclidean distance from every empty
 *    cell to the solid.
 * 2. Split the solid's cells recursively. Each part gets a PCA box; a part
 *    whose box holds an empty cell farther than `tol` from the solid is cut
 *    at its median along the box's longest axis.
 * 3. Grow the boxes until every drawn vertex of every level lies inside one.
 *    "No drawn vertex outside the proxy" then holds by construction, and the
 *    growth is reported.
 *
 * What the fit is measured on afterwards (`measureFit`): the colliding empty
 * space (how far a box reaches past the drawn L0 surface), on a finer grid
 * than the fit used, and the proxy's reach (its farthest corner).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import type { Primitive } from "../../src/collision";
import { decodeShippedGlb } from "../../scripts/lib/shipped-glb";

export type V3 = [number, number, number];
export interface Box {
	centre: V3;
	axes: [V3, V3, V3];
	half: V3;
}
export interface Archetype {
	index: number;
	name: string;
	/** L0, L1, L2 triangles, unit-bound space, flat xyz triples. */
	levels: Float32Array[];
}

export const DEFAULT_ROCKS_GLB =
	process.env.ROCKS_GLB ??
	"../seelite-953/spikes/asteroid-rocks-953/runtime/asteroids.glb";

/** The archetype file every figure was measured on (#953, uncommitted, 2026-10-13). */
export const MEASURED_ROCKS_SHA256 = "0622d06b78601aae32b7d6f414d0c1eebfb29e2a79a200e370529008f084cd1c";

export async function loadArchetypes(path = DEFAULT_ROCKS_GLB): Promise<Archetype[]> {
	const sha = createHash("sha256").update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest("hex");
	console.log(`rocks ${path.split("/").slice(-2).join("/")} sha256 ${sha.slice(0, 16)}${sha === MEASURED_ROCKS_SHA256 ? "" : " — NOT the file the proposal's figures came from"}`);
	const scene = await decodeShippedGlb(path);
	scene.updateMatrixWorld(true);
	const out: Archetype[] = [];
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const m = /^rock_(\d+)_(.*)_L([012])$/.exec(o.name);
		if (!m) return;
		const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld).toNonIndexed();
		const p = g.getAttribute("position");
		const tris = new Float32Array(p.count * 3);
		for (let i = 0; i < p.count; i++) {
			tris[i * 3] = p.getX(i);
			tris[i * 3 + 1] = p.getY(i);
			tris[i * 3 + 2] = p.getZ(i);
		}
		const index = Number(m[1]);
		const a = (out[index] ??= { index, name: m[2], levels: [] });
		a.levels[Number(m[3])] = tris;
	});
	return out;
}

// --- voxel grid ---------------------------------------------------------------

export interface Grid {
	n: number;
	h: number;
	/** 1 inside the solid. */
	solid: Uint8Array;
	/** Distance from each cell centre to the nearest solid cell centre, unit space. */
	edt: Float32Array;
}
const at = (n: number, i: number, j: number, k: number) => (k * n + j) * n + i;
export const centreOf = (g: Grid, c: number): V3 => {
	const i = c % g.n, j = Math.floor(c / g.n) % g.n, k = Math.floor(c / (g.n * g.n));
	return [-1 + (i + 0.5) * g.h, -1 + (j + 0.5) * g.h, -1 + (k + 0.5) * g.h];
};

/** Ray parity along +x, per (y, z) column; triangles binned by their yz bounds. */
export function voxelise(tris: Float32Array, n: number): Grid {
	const h = 2 / n;
	const solid = new Uint8Array(n * n * n);
	const cols: number[][] = Array.from({ length: n * n }, () => []);
	const nt = tris.length / 9;
	const cell = (v: number) => Math.min(n - 1, Math.max(0, Math.floor((v + 1) / h)));
	for (let t = 0; t < nt; t++) {
		const o = t * 9;
		const y0 = Math.min(tris[o + 1], tris[o + 4], tris[o + 7]), y1 = Math.max(tris[o + 1], tris[o + 4], tris[o + 7]);
		const z0 = Math.min(tris[o + 2], tris[o + 5], tris[o + 8]), z1 = Math.max(tris[o + 2], tris[o + 5], tris[o + 8]);
		for (let k = cell(z0); k <= cell(z1); k++) for (let j = cell(y0); j <= cell(y1); j++) cols[k * n + j].push(t);
	}
	// A tiny skew keeps the ray off shared edges and vertices.
	const ey = 1.37e-7, ez = 2.11e-7;
	for (let k = 0; k < n; k++)
		for (let j = 0; j < n; j++) {
			const y = -1 + (j + 0.5) * h + ey, z = -1 + (k + 0.5) * h + ez;
			const xs: number[] = [];
			for (const t of cols[k * n + j]) {
				const o = t * 9;
				const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
				const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
				const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
				// Barycentric in the yz projection.
				const d = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
				if (d === 0) continue;
				const u = ((y - ay) * (cz - az) - (z - az) * (cy - ay)) / d;
				const v = ((by - ay) * (z - az) - (bz - az) * (y - ay)) / d;
				if (u < 0 || v < 0 || u + v > 1) continue;
				xs.push(ax + u * (bx - ax) + v * (cx - ax));
			}
			xs.sort((a, b) => a - b);
			for (let p = 0; p + 1 < xs.length; p += 2) {
				const i0 = Math.ceil((xs[p] + 1) / h - 0.5), i1 = Math.floor((xs[p + 1] + 1) / h - 0.5);
				for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++) solid[at(n, i, j, k)] = 1;
			}
		}
	return { n, h, solid, edt: edt3(solid, n, h) };
}

/** Felzenszwalb–Huttenlocher squared EDT, separable; distance to nearest solid cell. */
function edt3(solid: Uint8Array, n: number, h: number): Float32Array {
	const INF = 1e20;
	const f = new Float64Array(n * n * n);
	for (let c = 0; c < f.length; c++) f[c] = solid[c] ? 0 : INF;
	const line = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
	const pass = (get: (q: number) => number, set: (q: number, x: number) => void) => {
		for (let q = 0; q < n; q++) line[q] = get(q);
		let k = 0;
		v[0] = 0;
		zz[0] = -INF;
		zz[1] = INF;
		for (let q = 1; q < n; q++) {
			let s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			while (s <= zz[k]) {
				k--;
				s = (line[q] + q * q - (line[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
			}
			k++;
			v[k] = q;
			zz[k] = s;
			zz[k + 1] = INF;
		}
		k = 0;
		for (let q = 0; q < n; q++) {
			while (zz[k + 1] < q) k++;
			out[q] = (q - v[k]) ** 2 + line[v[k]];
		}
		for (let q = 0; q < n; q++) set(q, out[q]);
	};
	for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) pass((q) => f[at(n, q, j, k)], (q, x) => { f[at(n, q, j, k)] = x; });
	for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) pass((q) => f[at(n, i, q, k)], (q, x) => { f[at(n, i, q, k)] = x; });
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pass((q) => f[at(n, i, j, q)], (q, x) => { f[at(n, i, j, q)] = x; });
	const d = new Float32Array(f.length);
	for (let c = 0; c < f.length; c++) d[c] = Math.sqrt(f[c]) * h;
	return d;
}

// --- boxes ------------------------------------------------------------------

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function pcaAxes(pts: V3[]): [V3, V3, V3] {
	const m = new THREE.Vector3();
	for (const p of pts) m.add(new THREE.Vector3(...p));
	m.multiplyScalar(1 / pts.length);
	const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
	for (const p of pts) {
		const d = [p[0] - m.x, p[1] - m.y, p[2] - m.z];
		for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) c[r * 3 + s] += d[r] * d[s];
	}
	// Jacobi eigen-decomposition of the 3×3 covariance.
	const a = c.slice();
	const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
	for (let sweep = 0; sweep < 50; sweep++) {
		let off = 0;
		for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) off += a[p * 3 + q] ** 2;
		if (off < 1e-18) break;
		for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
			const apq = a[p * 3 + q];
			if (Math.abs(apq) < 1e-30) continue;
			const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
			const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
			const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
			for (let k = 0; k < 3; k++) {
				const akp = a[k * 3 + p], akq = a[k * 3 + q];
				a[k * 3 + p] = cs * akp - sn * akq;
				a[k * 3 + q] = sn * akp + cs * akq;
			}
			for (let k = 0; k < 3; k++) {
				const apk = a[p * 3 + k], aqk = a[q * 3 + k];
				a[p * 3 + k] = cs * apk - sn * aqk;
				a[q * 3 + k] = sn * apk + cs * aqk;
			}
			for (let k = 0; k < 3; k++) {
				const vkp = V[k * 3 + p], vkq = V[k * 3 + q];
				V[k * 3 + p] = cs * vkp - sn * vkq;
				V[k * 3 + q] = sn * vkp + cs * vkq;
			}
		}
	}
	const e0: V3 = [V[0], V[3], V[6]], e1: V3 = [V[1], V[4], V[7]];
	const e2: V3 = [e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]];
	return [e0, e1, e2];
}

/** The box of a cell set: PCA axes, extents to the cells' outer faces. */
function boxOf(g: Grid, cells: number[]): Box {
	const pts = cells.map((c) => centreOf(g, c));
	const axes = pcaAxes(pts);
	const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
	for (const p of pts)
		for (let a = 0; a < 3; a++) {
			const s = dot(p, axes[a]);
			// A cell's half-width along an oblique axis, at most.
			const r = (g.h / 2) * (Math.abs(axes[a][0]) + Math.abs(axes[a][1]) + Math.abs(axes[a][2]));
			lo[a] = Math.min(lo[a], s - r);
			hi[a] = Math.max(hi[a], s + r);
		}
	const mid: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
	const centre: V3 = [0, 1, 2].map((k) => axes[0][k] * mid[0] + axes[1][k] * mid[1] + axes[2][k] * mid[2]) as V3;
	return { centre, axes, half: [(hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2] };
}

export function inBox(b: Box, p: V3, pad = 0): boolean {
	const d: V3 = [p[0] - b.centre[0], p[1] - b.centre[1], p[2] - b.centre[2]];
	for (let a = 0; a < 3; a++) if (Math.abs(dot(d, b.axes[a])) > b.half[a] + pad) return false;
	return true;
}

/** The farthest empty cell centre a box holds, by its distance to the solid. */
export function overshoot(g: Grid, b: Box): number {
	let worst = 0;
	const r = Math.hypot(...b.half);
	const lo = (v: number) => Math.max(0, Math.floor((v - r + 1) / g.h));
	const hi = (v: number) => Math.min(g.n - 1, Math.ceil((v + r + 1) / g.h));
	for (let k = lo(b.centre[2]); k <= hi(b.centre[2]); k++)
		for (let j = lo(b.centre[1]); j <= hi(b.centre[1]); j++)
			for (let i = lo(b.centre[0]); i <= hi(b.centre[0]); i++) {
				const c = at(g.n, i, j, k);
				if (g.solid[c]) continue;
				const p = centreOf(g, c);
				if (inBox(b, p)) worst = Math.max(worst, g.edt[c]);
			}
	return worst;
}

function split(g: Grid, cells: number[], tol: number, out: Box[], minCells: number) {
	const b = boxOf(g, cells);
	if (cells.length <= minCells || overshoot(g, b) <= tol) {
		out.push(b);
		return;
	}
	const long = b.half[0] >= b.half[1] && b.half[0] >= b.half[2] ? 0 : b.half[1] >= b.half[2] ? 1 : 2;
	const s = cells.map((c) => dot(centreOf(g, c), b.axes[long]));
	const sorted = s.slice().sort((x, y) => x - y);
	const median = sorted[Math.floor(sorted.length / 2)];
	const a: number[] = [], z: number[] = [];
	cells.forEach((c, i) => (s[i] < median ? a : z).push(c));
	if (!a.length || !z.length) {
		out.push(b);
		return;
	}
	split(g, a, tol, out, minCells);
	split(g, z, tol, out, minCells);
}

/** Grow a box to hold `p`, along its own axes. */
function growTo(b: Box, p: V3) {
	const d: V3 = [p[0] - b.centre[0], p[1] - b.centre[1], p[2] - b.centre[2]];
	for (let a = 0; a < 3; a++) {
		const s = dot(d, b.axes[a]);
		const over = Math.abs(s) - b.half[a];
		if (over <= 0) continue;
		// Move the far face out; keep the near face.
		const shift = (Math.sign(s) * over) / 2;
		for (let k = 0; k < 3; k++) b.centre[k] += b.axes[a][k] * shift;
		b.half[a] += over / 2;
	}
}

export interface Fit {
	boxes: Box[];
	/** The largest growth any drawn vertex asked of a box, unit space. */
	grewBy: number;
}

const IDENTITY: [V3, V3, V3] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** A grid-aligned box over cell indices lo..hi, shrunk to the solid cells it holds. */
interface Cellbox {
	lo: V3;
	hi: V3;
	/** The farthest empty cell it holds, by distance to the solid. */
	over: number;
}
function shrink(g: Grid, lo: V3, hi: V3): Cellbox | null {
	const a: V3 = [Infinity, Infinity, Infinity], b: V3 = [-1, -1, -1];
	for (let k = lo[2]; k <= hi[2]; k++)
		for (let j = lo[1]; j <= hi[1]; j++)
			for (let i = lo[0]; i <= hi[0]; i++)
				if (g.solid[at(g.n, i, j, k)]) {
					a[0] = Math.min(a[0], i); a[1] = Math.min(a[1], j); a[2] = Math.min(a[2], k);
					b[0] = Math.max(b[0], i); b[1] = Math.max(b[1], j); b[2] = Math.max(b[2], k);
				}
	if (b[0] < 0) return null;
	let over = 0;
	for (let k = a[2]; k <= b[2]; k++)
		for (let j = a[1]; j <= b[1]; j++)
			for (let i = a[0]; i <= b[0]; i++) {
				const c = at(g.n, i, j, k);
				if (!g.solid[c]) over = Math.max(over, g.edt[c]);
			}
	return { lo: a, hi: b, over };
}
function toBox(g: Grid, c: Cellbox): Box {
	const lo = c.lo.map((v) => -1 + v * g.h) as V3;
	const hi = c.hi.map((v) => -1 + (v + 1) * g.h) as V3;
	return {
		centre: [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2) as V3,
		axes: IDENTITY.map((x) => [...x]) as [V3, V3, V3],
		half: [0, 1, 2].map((a) => (hi[a] - lo[a]) / 2) as V3,
	};
}

/**
 * Greedy: start from the solid's box, and split the box with the worst
 * overshoot at the plane that most reduces it, until `budget` boxes. Every
 * split keeps every solid cell inside a box.
 */
export function fitArchetype(a: Archetype, budget: number, n = 48): Fit {
	const g = voxelise(a.levels[0], n);
	const first = shrink(g, [0, 0, 0], [n - 1, n - 1, n - 1]);
	if (!first) throw new Error(`empty archetype ${a.name}`);
	const set: Cellbox[] = [first];
	while (set.length < budget) {
		set.sort((x, y) => y.over - x.over);
		const worst = set[0];
		if (worst.over <= g.h) break;
		let best: [Cellbox, Cellbox] | null = null;
		let score = Infinity;
		for (let ax = 0; ax < 3; ax++)
			for (let cut = worst.lo[ax]; cut < worst.hi[ax]; cut++) {
				const hiA = [...worst.hi] as V3;
				hiA[ax] = cut;
				const loB = [...worst.lo] as V3;
				loB[ax] = cut + 1;
				const A = shrink(g, worst.lo, hiA), B = shrink(g, loB, worst.hi);
				if (!A || !B) continue;
				const s = Math.max(A.over, B.over);
				if (s < score) {
					score = s;
					best = [A, B];
				}
			}
		if (!best) break;
		set.splice(0, 1, ...best);
	}
	const boxes = set.map((c) => toBox(g, c));
	let grewBy = 0;
	for (const tris of a.levels)
		for (let i = 0; i < tris.length; i += 3) {
			const p: V3 = [tris[i], tris[i + 1], tris[i + 2]];
			if (boxes.some((b) => inBox(b, p, 1e-9))) continue;
			let best = 0, need = Infinity;
			boxes.forEach((b, bi) => {
				const d: V3 = [p[0] - b.centre[0], p[1] - b.centre[1], p[2] - b.centre[2]];
				let s = 0;
				for (let ax = 0; ax < 3; ax++) s += Math.max(0, Math.abs(dot(d, b.axes[ax])) - b.half[ax]) ** 2;
				if (s < need) {
					need = s;
					best = bi;
				}
			});
			grewBy = Math.max(grewBy, Math.sqrt(need));
			growTo(boxes[best], p);
		}
	return { boxes, grewBy };
}

export function corners(b: Box): V3[] {
	const out: V3[] = [];
	for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
		const p: V3 = [...b.centre];
		for (let k = 0; k < 3; k++) p[k] += sx * b.half[0] * b.axes[0][k] + sy * b.half[1] * b.axes[1][k] + sz * b.half[2] * b.axes[2][k];
		out.push(p);
	}
	return out;
}

export interface FitMeasure {
	boxes: number;
	/** Farthest box point from the drawn L0 surface, outside it: unit space. */
	overshoot: number;
	/** Share of the proxy's volume that lies outside the drawn L0 solid. */
	emptyShare: number;
	/** Farthest corner from the origin: the proxy's reach, unit space. */
	reach: number;
	/** Farthest drawn vertex of any level outside every box. Zero by construction. */
	drawnOutside: number;
}

/** Measured on a finer grid than the fit used, so the fit is not checking itself. */
export function measureFit(a: Archetype, fit: Fit, n = 96): FitMeasure {
	const g = voxelise(a.levels[0], n);
	let over = 0, inProxy = 0, emptyIn = 0;
	for (let c = 0; c < g.solid.length; c++) {
		const p = centreOf(g, c);
		if (!fit.boxes.some((b) => inBox(b, p))) continue;
		inProxy++;
		if (!g.solid[c]) {
			emptyIn++;
			over = Math.max(over, g.edt[c]);
		}
	}
	let drawnOutside = 0;
	for (const tris of a.levels)
		for (let i = 0; i < tris.length; i += 3) {
			const p: V3 = [tris[i], tris[i + 1], tris[i + 2]];
			if (fit.boxes.some((b) => inBox(b, p, 1e-9))) continue;
			drawnOutside = Math.max(drawnOutside, 1);
		}
	const reach = Math.max(...fit.boxes.flatMap(corners).map((p) => Math.hypot(...p)));
	// A grid measures to within one cell; the figure carries it.
	return { boxes: fit.boxes.length, overshoot: over + g.h * Math.sqrt(3) / 2, emptyShare: emptyIn / inProxy, reach, drawnOutside };
}

/** A fitted proxy in `collision.ts` form, scaled to a rock of `radiusKm`. The
 *  unit space is normalised so neither the drawn form nor the proxy reaches
 *  past 1 (`norm` = max(drawn, proxy reach)). */
export function toPrimitives(boxes: Box[], radiusKm: number, norm: number): Primitive[] {
	const s = radiusKm / norm;
	const v = (p: V3) => ({ x: p[0], y: p[1], z: p[2] });
	return boxes.map((b) => ({
		kind: "box" as const,
		centre: v([b.centre[0] * s, b.centre[1] * s, b.centre[2] * s]),
		axes: [v(b.axes[0]), v(b.axes[1]), v(b.axes[2])] as const,
		half: [b.half[0] * s, b.half[1] * s, b.half[2] * s] as const,
	}));
}
