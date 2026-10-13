/**
 * Node #956 prototype: a rock's radial heightfield (#949 D1) as a union of
 * convex pieces, and a quadtree of coarser convex bounds over them. Unit-bound
 * space. Three-free. Not production.
 *
 * **The pieces.** The field's surface is bilinear between texel centres
 * (`heightfield.ts` `radiusAt`, clamped in the half texel at each face edge).
 * On one cube face, the nodes are the texel centres plus the face edges, so a
 * face has (res + 1)² cells. A cell's piece is the convex hull of the origin
 * and the cell's four corner surface points. Its side faces are the planes of
 * the cell's cone (a cube-face rectangle seen from the origin), so the pieces
 * tile space by cones: their union is the field's solid, with no bridge over a
 * concavity wider than one cell. The hull's top is the convex one of the two
 * triangulations, which lies on or above the bilinear patch in the radius;
 * the normalisation onto the sphere can still bow the patch out, so each piece
 * is scaled out by the factor a dense sample of its patch needs (`inflate`).
 *
 * **The bounds.** Per face, a quadtree over cell ranges. A node's bound is the
 * cone over its rectangle cut by the face plane at the largest face-axis
 * coordinate of any vertex below it. Convex, and it holds every piece below it,
 * so a node's first contact in a step is never later than any of its pieces'.
 */
import { faceUV, type Heightfield, texel } from "../asteroid-collision-949/heightfield";
import { type Vec3, v3 } from "../../src/vec3";
import type { Placed } from "./gjk";

export interface BoundNode {
	hull: Placed & { kind: "hull" };
	/** Leaf: the piece index. */
	piece: number;
	children: BoundNode[];
}
export interface RockPieces {
	res: number;
	pieces: (Placed & { kind: "hull" })[];
	/** Each piece's outward scale (≥ 1) that holds its bilinear patch. */
	inflate: Float32Array;
	roots: BoundNode[];
}

/** The unnormalised cube-face point for face `f` at `u`, `v` (major coordinate ±1). */
export function facePoint(f: number, u: number, v: number): Vec3 {
	switch (f) {
		case 0: return v3(1, v, -u);
		case 1: return v3(-1, v, u);
		case 2: return v3(u, 1, -v);
		case 3: return v3(u, -1, v);
		case 4: return v3(u, v, 1);
		default: return v3(-u, v, -1);
	}
}
const majorAxis = (f: number): "x" | "y" | "z" => (f < 2 ? "x" : f < 4 ? "y" : "z");

/** The field's radius on face `f` at `u`, `v`, read on that face (no seam hop). */
export function radiusOnFace(h: Heightfield, f: number, u: number, v: number): number {
	const x = Math.min(h.res - 1, Math.max(0, ((u + 1) / 2) * h.res - 0.5));
	const y = Math.min(h.res - 1, Math.max(0, ((v + 1) / 2) * h.res - 0.5));
	const i0 = Math.floor(x), j0 = Math.floor(y), i1 = Math.min(h.res - 1, i0 + 1), j1 = Math.min(h.res - 1, j0 + 1);
	const fx = x - i0, fy = y - j0;
	const r = (i: number, j: number) => h.r[texel(h.res, f, i, j)];
	return (r(i0, j0) * (1 - fx) + r(i1, j0) * fx) * (1 - fy) + (r(i0, j1) * (1 - fx) + r(i1, j1) * fx) * fy;
}
/** Node position k (0..res+1) along a face axis: the edge, texel centres, the edge. */
const nodePos = (res: number, k: number) => (k === 0 ? -1 : k === res + 1 ? 1 : ((k - 0.5) / res) * 2 - 1);

const surf = (h: Heightfield, f: number, u: number, v: number): Vec3 => {
	const q = facePoint(f, u, v);
	const l = Math.hypot(q.x, q.y, q.z);
	const r = radiusOnFace(h, f, u, v);
	return v3((q.x / l) * r, (q.y / l) * r, (q.z / l) * r);
};

/** Ray from the origin along unit `d` out of the hull {0, P0..P3} whose sides are the cell's cone. */
export function hullExit(P: readonly Vec3[], d: Vec3): number {
	const plane = (a: Vec3, b: Vec3, c: Vec3) => {
		const e1 = v3(b.x - a.x, b.y - a.y, b.z - a.z), e2 = v3(c.x - a.x, c.y - a.y, c.z - a.z);
		let n = v3(e1.y * e2.z - e1.z * e2.y, e1.z * e2.x - e1.x * e2.z, e1.x * e2.y - e1.y * e2.x);
		let k = n.x * a.x + n.y * a.y + n.z * a.z;
		if (k < 0) { n = v3(-n.x, -n.y, -n.z); k = -k; }
		return { n, k };
	};
	// The convex triangulation: P3 on the origin side of plane(P0, P1, P2).
	const a = plane(P[0], P[1], P[2]);
	const tris = a.n.x * P[3].x + a.n.y * P[3].y + a.n.z * P[3].z <= a.k * (1 + 1e-12)
		? [a, plane(P[0], P[2], P[3])]
		: [plane(P[0], P[1], P[3]), plane(P[1], P[2], P[3])];
	let t = Infinity;
	for (const { n, k } of tris) {
		const nd = n.x * d.x + n.y * d.y + n.z * d.z;
		if (nd > 0) t = Math.min(t, k / nd);
	}
	return t;
}

/** Build the pieces and their bounds. `check` patch samples per cell edge set the inflation. */
/** Relative margin over the sampled need: covers the patch between samples (P1, P2 measure the residual). */
export const INFLATE_MARGIN = 2e-5;
export function buildPieces(h: Heightfield, check = 9): RockPieces {
	const res = h.res, n = res + 1;
	const pieces: (Placed & { kind: "hull" })[] = [];
	const inflate = new Float32Array(6 * n * n);
	const origin = v3();
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++) {
				const u0 = nodePos(res, i), u1 = nodePos(res, i + 1), w0 = nodePos(res, j), w1 = nodePos(res, j + 1);
				const P = [surf(h, f, u0, w0), surf(h, f, u1, w0), surf(h, f, u1, w1), surf(h, f, u0, w1)];
				let need = 1;
				for (let b = 0; b < check; b++)
					for (let a = 0; a < check; a++) {
						const u = u0 + ((u1 - u0) * a) / (check - 1), w = w0 + ((w1 - w0) * b) / (check - 1);
						const p = surf(h, f, u, w);
						const l = Math.hypot(p.x, p.y, p.z);
						need = Math.max(need, l / hullExit(P, v3(p.x / l, p.y / l, p.z / l)));
					}
				const k = (f * n + j) * n + i;
				inflate[k] = need;
				const s = need * (1 + INFLATE_MARGIN);
				const V = P.map((p) => v3(p.x * s, p.y * s, p.z * s));
				const c = v3((V[0].x + V[1].x + V[2].x + V[3].x) / 5, (V[0].y + V[1].y + V[2].y + V[3].y) / 5, (V[0].z + V[1].z + V[2].z + V[3].z) / 5);
				pieces[k] = { kind: "hull", v: [origin, ...V], c };
			}
	const roots: BoundNode[] = [];
	for (let f = 0; f < 6; f++) roots.push(bound(pieces, res, f, 0, n, 0, n));
	return { res, pieces, inflate, roots };
}

/** Bench switch: node caps square to each tile's direction (true) or cut by the face plane. */
export let TILTED_CAPS = true;
export const setTiltedCaps = (on: boolean) => { TILTED_CAPS = on; };
function bound(pieces: RockPieces["pieces"], res: number, f: number, i0: number, i1: number, j0: number, j1: number): BoundNode {
	const n = res + 1;
	if (i1 - i0 === 1 && j1 - j0 === 1) {
		const k = (f * n + j0) * n + i0;
		return { hull: pieces[k], piece: k, children: [] };
	}
	const im = i1 - i0 > 1 ? (i0 + i1) >> 1 : i1, jm = j1 - j0 > 1 ? (j0 + j1) >> 1 : j1;
	const children: BoundNode[] = [];
	for (const [a, b] of [[i0, im], [im, i1]] as const)
		for (const [c, d] of [[j0, jm], [jm, j1]] as const)
			if (b > a && d > c) children.push(bound(pieces, res, f, a, b, c, d));
	const u0 = nodePos(res, i0), u1 = nodePos(res, i1), w0 = nodePos(res, j0), w1 = nodePos(res, j1);
	const Q = [facePoint(f, u0, w0), facePoint(f, u1, w0), facePoint(f, u1, w1), facePoint(f, u0, w1)];
	let V: Vec3[];
	if (TILTED_CAPS) {
		// Cap square to the tile's own centre direction: tight for a tile far from the face centre.
		const cq = facePoint(f, (u0 + u1) / 2, (w0 + w1) / 2), cl = Math.hypot(cq.x, cq.y, cq.z);
		const c = v3(cq.x / cl, cq.y / cl, cq.z / cl);
		let m = 0;
		for (const ch of children) for (const p of ch.hull.v) m = Math.max(m, c.x * p.x + c.y * p.y + c.z * p.z);
		V = Q.map((q) => { const t = m / (c.x * q.x + c.y * q.y + c.z * q.z); return v3(q.x * t, q.y * t, q.z * t); });
	} else {
		const ax = majorAxis(f);
		let t = 0;
		for (const ch of children) for (const p of ch.hull.v) t = Math.max(t, Math.abs(p[ax]));
		V = Q.map((q) => v3(q.x * t, q.y * t, q.z * t));
	}
	const c = v3((V[0].x + V[1].x + V[2].x + V[3].x) / 5, (V[0].y + V[1].y + V[2].y + V[3].y) / 5, (V[0].z + V[1].z + V[2].z + V[3].z) / 5);
	return { hull: { kind: "hull", v: [v3(), ...V], c }, piece: -1, children };
}

/** The pieces' outer envelope along unit `d`: the field's radius as the sweep sees it. */
export function envelopeAt(rp: RockPieces, h: Heightfield, d: Vec3): number {
	const [f, u, v] = faceUV([d.x, d.y, d.z]);
	const res = rp.res, n = res + 1;
	// The cell holding (u, v): node positions are the edge, then texel centres.
	const cellOf = (x: number) => {
		const g = ((x + 1) / 2) * res + 0.5; // 0.5 at u = -1 → node 0 spans [-1, centre 0]
		return Math.min(n - 1, Math.max(0, Math.floor(g)));
	};
	const i = cellOf(u), j = cellOf(v);
	const k = (f * n + j) * n + i;
	const P = rp.pieces[k].v.slice(1);
	void h;
	return hullExit(P, d);
}
