// https://github.com/jcfischer/seelite/tree/71033d016f079bc79603c7cd66290b35a6f68800/spikes/asteroid-sweep-956

import {
	add,
	cross,
	dot,
	length,
	lengthSq,
	scale,
	sub,
	v3,
	type Vec3,
} from "../../../src/vec3";
import type { Pose, Primitive } from "../../../src/collision";

export type Placed =
	| { kind: "point"; c: Vec3; r: number }
	| { kind: "segment"; a: Vec3; b: Vec3; r: number }
	| { kind: "box"; c: Vec3; u: [Vec3, Vec3, Vec3]; h: readonly number[] }
	| { kind: "hull"; v: readonly Vec3[]; c: Vec3 };
export type PlacedBox = Placed & { kind: "box" };

const turn = (pose: Pose, local: Vec3): Vec3 =>
	add(
		add(scale(pose.x, local.x), scale(pose.y, local.y)),
		scale(pose.z, local.z),
	);
export const toWorld = (pose: Pose, local: Vec3): Vec3 =>
	add(pose.origin, turn(pose, local));
export function placeBox(
	p: Primitive & { kind: "box" },
	pose: Pose,
): PlacedBox {
	return {
		kind: "box",
		c: toWorld(pose, p.centre),
		u: [turn(pose, p.axes[0]), turn(pose, p.axes[1]), turn(pose, p.axes[2])],
		h: p.half,
	};
}

export function support(s: Placed, d: Vec3): Vec3 {
	if (s.kind === "point") return s.c;
	if (s.kind === "segment") return dot(s.a, d) >= dot(s.b, d) ? s.a : s.b;
	if (s.kind === "hull") {
		let best = s.v[0];
		let m = dot(best, d);
		for (let i = 1; i < s.v.length; i++) {
			const k = dot(s.v[i], d);
			if (k > m) {
				m = k;
				best = s.v[i];
			}
		}
		return best;
	}
	let out = s.c;
	for (let i = 0; i < 3; i++)
		out = add(out, scale(s.u[i], dot(s.u[i], d) >= 0 ? s.h[i] : -s.h[i]));
	return out;
}
const radiusOf = (s: Placed): number =>
	s.kind === "box" || s.kind === "hull" ? 0 : s.r;
const centreOf = (s: Placed): Vec3 =>
	s.kind === "segment" ? scale(add(s.a, s.b), 0.5) : s.c;

export type Separation =
	| { overlap: true }
	| {
			overlap: false;
			distanceKm: number;
			normal: Vec3;
			onShip: Vec3;
			onSurface: Vec3;
	  };

export function separation(ship: PlacedBox, other: Placed): Separation {
	const found = gjk(ship, other);
	if (!found) return { overlap: true };
	const gap = sub(found.a, found.b);
	const core = length(gap);
	const r = radiusOf(other);
	if (core <= r || core === 0) return { overlap: true };
	const normal = scale(gap, 1 / core);
	return {
		overlap: false,
		distanceKm: core - r,
		normal,
		onShip: found.a,
		onSurface: add(found.b, scale(normal, r)),
	};
}

export const counters = { gjk: 0 };

interface Vertex {
	w: Vec3;
	a: Vec3;
	b: Vec3;
}

interface Nearest {
	v: Vec3;
	keep: Vertex[];
	weights: number[];
}

function nearestOnSegment(p: Vertex, q: Vertex): Nearest {
	const pq = sub(q.w, p.w);
	const len2 = lengthSq(pq);
	const t = len2 > 0 ? -dot(p.w, pq) / len2 : 0;
	if (t <= 0) return { v: p.w, keep: [p], weights: [1] };
	if (t >= 1) return { v: q.w, keep: [q], weights: [1] };
	return {
		v: add(p.w, scale(pq, t)),
		keep: [p, q],
		weights: [1 - t, t],
	};
}

function nearestOnTriangle(a: Vertex, b: Vertex, c: Vertex): Nearest {
	const ab = sub(b.w, a.w);
	const ac = sub(c.w, a.w);
	const ap = scale(a.w, -1);
	const d1 = dot(ab, ap);
	const d2 = dot(ac, ap);
	if (d1 <= 0 && d2 <= 0) return { v: a.w, keep: [a], weights: [1] };
	const bp = scale(b.w, -1);
	const d3 = dot(ab, bp);
	const d4 = dot(ac, bp);
	if (d3 >= 0 && d4 <= d3) return { v: b.w, keep: [b], weights: [1] };
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const t = d1 / (d1 - d3);
		return { v: add(a.w, scale(ab, t)), keep: [a, b], weights: [1 - t, t] };
	}
	const cp = scale(c.w, -1);
	const d5 = dot(ab, cp);
	const d6 = dot(ac, cp);
	if (d6 >= 0 && d5 <= d6) return { v: c.w, keep: [c], weights: [1] };
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const t = d2 / (d2 - d6);
		return { v: add(a.w, scale(ac, t)), keep: [a, c], weights: [1 - t, t] };
	}
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const t = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return {
			v: add(b.w, scale(sub(c.w, b.w), t)),
			keep: [b, c],
			weights: [1 - t, t],
		};
	}
	const denom = va + vb + vc;
	if (!(denom > 0)) {
		const edges = [
			nearestOnSegment(a, b),
			nearestOnSegment(b, c),
			nearestOnSegment(a, c),
		];
		return edges.reduce((best, e) =>
			lengthSq(e.v) < lengthSq(best.v) ? e : best,
		);
	}
	const v = vb / denom;
	const w = vc / denom;
	return {
		v: add(a.w, add(scale(ab, v), scale(ac, w))),
		keep: [a, b, c],
		weights: [1 - v - w, v, w],
	};
}

function nearestOnTetrahedron(s: Vertex[]): Nearest | null {
	const faces: [number, number, number, number][] = [
		[0, 1, 2, 3],
		[0, 2, 3, 1],
		[0, 3, 1, 2],
		[1, 3, 2, 0],
	];
	let best: Nearest | null = null;
	let outside = false;
	for (const [i, j, k, l] of faces) {
		const a = s[i].w;
		const normal = cross(sub(s[j].w, a), sub(s[k].w, a));
		const signOrigin = -dot(a, normal);
		const signOther = dot(sub(s[l].w, a), normal);
		const scaleSq = lengthSq(normal);
		const flat = Math.abs(signOther) <= 1e-12 * Math.sqrt(scaleSq) + 1e-300;
		if (!flat && signOrigin * signOther >= 0) continue;
		outside = true;
		const n = nearestOnTriangle(s[i], s[j], s[k]);
		if (!best || lengthSq(n.v) < lengthSq(best.v)) best = n;
	}
	return outside ? best : null;
}

export function gjk(A: Placed, B: Placed): { a: Vec3; b: Vec3 } | null {
	counters.gjk++;
	const vertex = (d: Vec3): Vertex => {
		const a = support(A, d);
		const b = support(B, scale(d, -1));
		return { w: sub(a, b), a, b };
	};
	let first = sub(centreOf(B), centreOf(A));
	if (lengthSq(first) === 0) first = v3(1, 0, 0);
	let simplex: Vertex[] = [vertex(first)];
	let nearest: Nearest = { v: simplex[0].w, keep: simplex, weights: [1] };
	for (let i = 0; i < 64; i++) {
		const v = nearest.v;
		const vv = lengthSq(v);
		if (vv <= 1e-24) return null;
		const next = vertex(scale(v, -1));

		if (vv - dot(v, next.w) <= 1e-12 * vv + 1e-20) break;
		if (simplex.some((s) => lengthSq(sub(s.w, next.w)) <= 1e-24)) break;
		simplex = [...nearest.keep, next];
		let found: Nearest | null;
		if (simplex.length === 2) found = nearestOnSegment(simplex[0], simplex[1]);
		else if (simplex.length === 3)
			found = nearestOnTriangle(simplex[0], simplex[1], simplex[2]);
		else found = nearestOnTetrahedron(simplex);
		if (!found) return null;

		if (lengthSq(found.v) >= vv) break;
		nearest = found;
	}
	let a = v3();
	let b = v3();
	nearest.keep.forEach((s, k) => {
		a = add(a, scale(s.a, nearest.weights[k]));
		b = add(b, scale(s.b, nearest.weights[k]));
	});
	return { a, b };
}
