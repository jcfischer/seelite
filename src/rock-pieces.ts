/**
 * https://github.com/jcfischer/seelite/issues/956
 * Node #957: a rock's radial heightfield (#949 D1) as a union of convex cone
 * pieces, and a quadtree of convex bounds over them, for the swept test #956
 * ruled (Q1 O1). Unit-bound space, the field's own. Three-free and sim-free:
 * it reads the field through `rock-heightfields.ts` and nothing else.
 *
 * **The pieces.** The field's surface is bilinear between texel centres
 * (`radiusAt`, clamped in the half texel at each face edge). On one cube face
 * the nodes are the face edges plus the texel centres, so a face has
 * (res + 1)² cells. A cell's piece is the convex hull of the origin and the
 * cell's four corner surface points: its side faces are the planes of the
 * cell's cone, so the pieces tile space by cones and their union is the
 * field's solid, with no bridge over a concavity wider than one cell. The
 * hull's top is the convex one of the cell's two triangulations, on or above
 * the bilinear patch in the radius; normalising onto the sphere can still bow
 * the patch out past it, so each piece is scaled out by the factor a dense
 * sample of its patch needs. That factor is capped: a cell that needs more
 * than `INFLATION_LIMIT` is a field this construction does not fit, and the
 * build throws naming the cell rather than inflating past it.
 *
 * **The bounds.** Per face, a quadtree over cell ranges. A node's bound is the
 * cone over its rectangle, capped by the plane square to the rectangle's
 * centre direction at the farthest any vertex below it reaches along that
 * direction. Convex, and it holds every vertex of every piece below it, so a
 * node's first contact in a step is never later than any of its pieces'.
 */
import { faceUV, type RockHeightfield } from "./rock-heightfields";
import { type Vec3, v3 } from "./vec3";

/** A convex hull given by its vertices, and a point inside it. */
export interface ConvexHull {
	v: readonly Vec3[];
	c: Vec3;
}
export interface BoundNode {
	hull: ConvexHull;
	piece: number;
	children: BoundNode[];
}
export interface RockPieces {
	res: number;
	pieces: ConvexHull[];
	inflate: Float64Array;
	roots: BoundNode[];
}

/** The most a piece may be scaled out to hold its patch (#957; #956 measured 1.0077 at worst). */
export const INFLATION_LIMIT = 1.01;
/**
 * Relative margin over the sampled need: covers the patch between samples.
 * Measured on #953's set at 301² directions a face: 2e-5 leaves the envelope
 * 3e-6 R above the field at worst, and 5e-6 dips 6e-6 R below it.
 */
export const INFLATE_MARGIN = 2e-5;
/** Patch samples per cell edge that set the inflation (#956's `check`). */
export const INFLATE_SAMPLES = 9;

export interface BuildOptions {
	label?: string;
	limit?: number;
}

export const piecesPerFace = (res: number): number => (res + 1) ** 2;
export const pieceIndex = (
	res: number,
	face: number,
	i: number,
	j: number,
): number => (face * (res + 1) + j) * (res + 1) + i;

/** The unnormalised cube-face point for face `f` at `u`, `v` (`dirOf`'s mapping). */
export function facePoint(f: number, u: number, v: number): Vec3 {
	switch (f) {
		case 0:
			return v3(1, v, -u);
		case 1:
			return v3(-1, v, u);
		case 2:
			return v3(u, 1, -v);
		case 3:
			return v3(u, -1, v);
		case 4:
			return v3(u, v, 1);
		default:
			return v3(-u, v, -1);
	}
}

/** The field's radius on face `f` at `u`, `v`, read on that face: no hop across a seam at an edge. */
export function radiusOnFace(
	h: RockHeightfield,
	f: number,
	u: number,
	v: number,
): number {
	const x = Math.min(h.res - 1, Math.max(0, ((u + 1) / 2) * h.res - 0.5));
	const y = Math.min(h.res - 1, Math.max(0, ((v + 1) / 2) * h.res - 0.5));
	const i0 = Math.floor(x),
		j0 = Math.floor(y),
		i1 = Math.min(h.res - 1, i0 + 1),
		j1 = Math.min(h.res - 1, j0 + 1);
	const fx = x - i0,
		fy = y - j0;
	const r = (i: number, j: number) => h.r[(f * h.res + j) * h.res + i];
	return (
		(r(i0, j0) * (1 - fx) + r(i1, j0) * fx) * (1 - fy) +
		(r(i0, j1) * (1 - fx) + r(i1, j1) * fx) * fy
	);
}

/** Node position k (0..res+1) along a face axis: the edge, the texel centres, the edge. */
export const nodePos = (res: number, k: number): number =>
	k === 0 ? -1 : k === res + 1 ? 1 : ((k - 0.5) / res) * 2 - 1;

function surfacePoint(h: RockHeightfield, f: number, u: number, v: number) {
	const q = facePoint(f, u, v);
	const l = Math.hypot(q.x, q.y, q.z);
	const r = radiusOnFace(h, f, u, v);
	return v3((q.x / l) * r, (q.y / l) * r, (q.z / l) * r);
}

function outwardPlane(a: Vec3, b: Vec3, c: Vec3): { n: Vec3; k: number } {
	const e1x = b.x - a.x,
		e1y = b.y - a.y,
		e1z = b.z - a.z;
	const e2x = c.x - a.x,
		e2y = c.y - a.y,
		e2z = c.z - a.z;
	let n = v3(
		e1y * e2z - e1z * e2y,
		e1z * e2x - e1x * e2z,
		e1x * e2y - e1y * e2x,
	);
	let k = n.x * a.x + n.y * a.y + n.z * a.z;
	if (k < 0) {
		n = v3(-n.x, -n.y, -n.z);
		k = -k;
	}
	return { n, k };
}

/** How far a ray from the origin along unit `d` runs inside the hull {0, P0..P3} whose sides are the cell's cone. */
export function hullExit(P: readonly Vec3[], d: Vec3): number {
	const a = outwardPlane(P[0], P[1], P[2]);
	const tris =
		a.n.x * P[3].x + a.n.y * P[3].y + a.n.z * P[3].z <= a.k * (1 + 1e-12)
			? [a, outwardPlane(P[0], P[2], P[3])]
			: [outwardPlane(P[0], P[1], P[3]), outwardPlane(P[1], P[2], P[3])];
	let t = Infinity;
	for (const { n, k } of tris) {
		const nd = n.x * d.x + n.y * d.y + n.z * d.z;
		if (nd > 0) t = Math.min(t, k / nd);
	}
	return t;
}

const apexCentre = (V: readonly Vec3[]): Vec3 =>
	v3(
		(V[0].x + V[1].x + V[2].x + V[3].x) / 5,
		(V[0].y + V[1].y + V[2].y + V[3].y) / 5,
		(V[0].z + V[1].z + V[2].z + V[3].z) / 5,
	);

/** Build the pieces and their bounds; throws naming the first cell that needs more than the limit. */
export function buildRockPieces(
	h: RockHeightfield,
	options: BuildOptions = {},
): RockPieces {
	const limit = options.limit ?? INFLATION_LIMIT;
	if (!Number.isFinite(limit) || limit < 1 || limit > INFLATION_LIMIT)
		throw new Error(
			`Invalid rock piece inflation limit ${limit}: expected 1 to ${INFLATION_LIMIT}`,
		);
	const res = h.res,
		n = res + 1,
		m = INFLATE_SAMPLES;
	if (!Number.isInteger(res) || res < 1 || h.r.length !== 6 * res * res)
		throw new Error(`Rock heightfield has ${h.r.length} radii for res ${res}`);
	for (let k = 0; k < h.r.length; k++)
		if (!Number.isFinite(h.r[k]) || h.r[k] <= 0)
			throw new Error(`Invalid rock radius at sample ${k}: ${h.r[k]}`);
	const pieces: ConvexHull[] = new Array(6 * n * n);
	const inflate = new Float64Array(6 * n * n);
	const origin = v3();
	for (let f = 0; f < 6; f++)
		for (let j = 0; j < n; j++)
			for (let i = 0; i < n; i++) {
				const u0 = nodePos(res, i),
					u1 = nodePos(res, i + 1),
					w0 = nodePos(res, j),
					w1 = nodePos(res, j + 1);
				const P = [
					surfacePoint(h, f, u0, w0),
					surfacePoint(h, f, u1, w0),
					surfacePoint(h, f, u1, w1),
					surfacePoint(h, f, u0, w1),
				];
				let need = 1;
				for (let b = 0; b < m; b++)
					for (let a = 0; a < m; a++) {
						const p = surfacePoint(
							h,
							f,
							u0 + ((u1 - u0) * a) / (m - 1),
							w0 + ((w1 - w0) * b) / (m - 1),
						);
						const l = Math.hypot(p.x, p.y, p.z);
						need = Math.max(
							need,
							l / hullExit(P, v3(p.x / l, p.y / l, p.z / l)),
						);
					}
				const s = need * (1 + INFLATE_MARGIN);
				if (!(s <= limit))
					throw new Error(
						`Rock pieces${options.label ? ` for ${options.label}` : ""}: face ${f} cell (${i}, ${j}) needs inflation ${s.toFixed(6)}, over the limit ${limit}`,
					);
				const k = pieceIndex(res, f, i, j);
				inflate[k] = s;
				const V = P.map((p) => v3(p.x * s, p.y * s, p.z * s));
				pieces[k] = { v: [origin, ...V], c: apexCentre(V) };
			}
	const roots: BoundNode[] = [];
	for (let f = 0; f < 6; f++) roots.push(bound(pieces, res, f, 0, n, 0, n));
	return { res, pieces, inflate, roots };
}

function bound(
	pieces: readonly ConvexHull[],
	res: number,
	f: number,
	i0: number,
	i1: number,
	j0: number,
	j1: number,
): BoundNode {
	if (i1 - i0 === 1 && j1 - j0 === 1) {
		const k = pieceIndex(res, f, i0, j0);
		return { hull: pieces[k], piece: k, children: [] };
	}
	const im = i1 - i0 > 1 ? (i0 + i1) >> 1 : i1,
		jm = j1 - j0 > 1 ? (j0 + j1) >> 1 : j1;
	const children: BoundNode[] = [];
	for (const [a, b] of [
		[i0, im],
		[im, i1],
	] as const)
		for (const [c, d] of [
			[j0, jm],
			[jm, j1],
		] as const)
			if (b > a && d > c) children.push(bound(pieces, res, f, a, b, c, d));
	const u0 = nodePos(res, i0),
		u1 = nodePos(res, i1),
		w0 = nodePos(res, j0),
		w1 = nodePos(res, j1);
	const Q = [
		facePoint(f, u0, w0),
		facePoint(f, u1, w0),
		facePoint(f, u1, w1),
		facePoint(f, u0, w1),
	];

	const cq = facePoint(f, (u0 + u1) / 2, (w0 + w1) / 2),
		cl = Math.hypot(cq.x, cq.y, cq.z);
	const c = v3(cq.x / cl, cq.y / cl, cq.z / cl);
	let reach = 0;
	for (const ch of children)
		for (const p of ch.hull.v)
			reach = Math.max(reach, c.x * p.x + c.y * p.y + c.z * p.z);
	const V = Q.map((q) => {
		const t = reach / (c.x * q.x + c.y * q.y + c.z * q.z);
		return v3(q.x * t, q.y * t, q.z * t);
	});
	return { hull: { v: [v3(), ...V], c: apexCentre(V) }, piece: -1, children };
}

/** The piece holding unit direction `d`. */
export function pieceAt(rp: RockPieces, d: Vec3): number {
	const [f, u, v] = faceUV([d.x, d.y, d.z]);
	const res = rp.res,
		n = res + 1;

	const cellOf = (x: number) =>
		Math.min(n - 1, Math.max(0, Math.floor(((x + 1) / 2) * res + 0.5)));
	return pieceIndex(res, f, cellOf(u), cellOf(v));
}

/** The pieces' outer envelope along unit `d`: the field's radius as the sweep sees it. */
export function envelopeAt(rp: RockPieces, d: Vec3): number {
	return hullExit(rp.pieces[pieceAt(rp, d)].v.slice(1), d);
}
