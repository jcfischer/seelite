/**
 * Collision: what meeting a surface does, and how the meeting is found inside
 * one tick (`docs/specs/collision.md`).
 *
 * **What is turned on.** The player against star, planet and moon spheres
 * (§2.1, node #661) and against every station's proxy (§2.2, node #663), in
 * normal flight with the assist on and off, with the aperture plane weighed
 * against the impacts (§4.2) — and since node #664, every other ship: raiders,
 * a relay's defender and Traffic carriers against bodies, proxies, the player
 * and each other (C4b, §6), through `sweepShipPair` below. The player meets
 * them in normal flight; while the player cruises, the flown ones still meet
 * bodies, proxies and each other (`stepFleet`). The resolver is
 * written against a **generic
 * primitive** — sphere, capsule, oriented box — in a solid's own frame, so a
 * station proxy is data handed to the same sweep and not a second resolver.
 *
 * **No Three.js, and no import of `sim.ts`.** `sim.ts` imports this, and the
 * sim may not import a renderer (CLAUDE.md). Everything is float64 kilometres.
 * Every query is taken relative to the met solid's own start origin, so a
 * star-centred coordinate at an AU never meets a 0.1 m separation in one
 * subtraction.
 *
 * Four parts, in this order:
 *
 * 1. **The law** (§3, P2, P3) — closing speed, damage, bounce. Pure functions,
 *    no geometry.
 * 2. **The distance query** — the gap between the ship's box and one
 *    primitive, its outward normal and the two witness points. Sphere-against-
 *    box is exact (a point clamped into a box); capsule and box go through GJK
 *    on their cores, a primitive being a convex core swept by a radius.
 * 3. **The sweep** (§3.1, §4.1, §4.3) — conservative advancement on that
 *    query. A separating plane at the closest points stays a separating plane
 *    until something crosses it, and nothing can cross it faster than the
 *    bound below, so an advance by `gap / bound` cannot step over any
 *    primitive however thin. That is §4.1's requirement met by construction
 *    rather than by a sub-step count.
 * 4. **Ship against ship** (C4b) — the same sweep, with the meeting landed on
 *    both ships: one damage, each its own side, and a momentum-conserving
 *    impulse split by mass.
 *
 * **A ship is every box in its primitive list** (node #959). The hull box (P1)
 * is always one; a deployed cutter (#949 D3) is a second, and it meets
 * everything the hull does — rocks, stations, ships and canisters (#956 Q3).
 * Each box carries the `ShipPart` it is, and every impact names the part that
 * met the surface (#956 Q4), so a caller can tell a cutter strike from a hull
 * strike. What a cutter strike costs is not decided here.
 */

import { DOCKING_DAMAGE_SCALE, V_GATE_KMS } from "./docking";
import {
	buildSphereGrid,
	INDEX_CELL_KM,
	INDEXED_ABOVE,
	querySphereGrid,
	type SphereGrid,
} from "./sphere-grid";
import type { HullBoxCentre, HullCutter, HullEnvelope } from "./hull";
import { type ShieldSide, sideStruck } from "./ship-condition";
import {
	type Vec3,
	add,
	cross,
	dot,
	length,
	lengthSq,
	rotateAbout,
	scale,
	sub,
	v3,
} from "./vec3";

// ---------------------------------------------------------------------------
// 1. The law
// ---------------------------------------------------------------------------

/**
 * **P2 (principal, 2026-10-03).** Below this closing speed an impact costs
 * nothing: half the docking gate. Chosen and not yet flown (§11, joint 1).
 */
export const V_SCRAPE_KMS = 0.05;

/**
 * **P2 (principal, 2026-10-03).** The share of the closing speed a bounce hands
 * back, outward. 0.5 is `docking.md` §2.0's repel, so "bounced" means one thing
 * in this game.
 */
export const RESTITUTION = 0.5;

/**
 * Where a resolved pair is left apart: 0.1 m. "Small against every primitive"
 * (§3) — the thinnest thing a later proxy is likely to declare is a boom of a
 * few metres, and a ship's box is tens of metres.
 */
export const SEPARATION_KM = 1e-4;

/**
 * A pair this close at the start of a step is **touching**, a resting pair
 * (§3.1). The placement separation plus a margin for rounding, so a ship the
 * last step placed is touching on this one.
 */
export const RESTING_KM = 1.5 * SEPARATION_KM;

/**
 * A resting pair closing slower than this is not met: 1 nm/s, the residue a
 * resolved pair's relative velocity is left with by rounding. Node #812's
 * courier box left a ship pair at 2e-17 km/s after the pair solver had stopped
 * it, and an exact `> 0` billed that as a resting impact of zero damage.
 * `tests/collision-traffic.test.ts`'s pair-solver row reads "no longer
 * closing" against this constant.
 *
 * The figure is set between two bounds rather than at the residue seen.
 * Below it is rounding: a ship flies at frame velocities of tens of km/s
 * (#104's ~30 km/s orbits), where one unit in the last place of a float64
 * is 7.1e-15 km/s at 40 km/s, and a relative velocity is a difference of
 * such figures — so the floor sits about a hundred and forty of those units
 * up, and the 2e-17 seen is far under it. Above it is anything a
 * contact could mean: 1 nm/s moves a pair 0.1 nm in a `MAX_DT` step,
 * against a `SEPARATION_KM` of 10 cm, and the slowest speed a contact law
 * names, `V_SCRAPE_KMS`, is 0.05 km/s. The value is a choice inside that
 * gap, not a measurement.
 */
export const RESTING_CLOSING_FLOOR_KMS = 1e-12;

/** The sweep declares an impact at or under this gap. */
const CONTACT_KM = 0.5 * SEPARATION_KM;

/** Each advance aims to leave this much gap, so a bound that is met exactly
 *  still lands short of the surface rather than on it. */
const ADVANCE_TARGET_KM = 0.25 * SEPARATION_KM;

/**
 * The most advances one pair may take in one step. Reaching it is read as an
 * impact at the time reached, never as clear: a sweep that gave up is not a
 * sweep that found nothing.
 */
const MAX_ADVANCES = 64;

/**
 * §3's closing speed: the inward normal component of the relative velocity of
 * the two points, `u = v_ship(p) − v_surface(p)`. Zero for a ship moving away
 * and zero for a pure graze.
 */
export function closingSpeed(u: Vec3, normal: Vec3): number {
	return Math.max(0, -dot(u, normal));
}

/**
 * §3's damage, **P3**: it reads `DOCKING_DAMAGE_SCALE`, so one constant says
 * what meeting a surface costs and a retune of docking's scale retunes this on
 * purpose. `v_n² − V_SCRAPE²` rather than `v_n²` behind a threshold, so the
 * damage rises from zero at the threshold with no step (derived).
 */
export function impactDamage(closingKms: number): number {
	const excess = closingKms * closingKms - V_SCRAPE_KMS * V_SCRAPE_KMS;
	return excess > 0
		? (DOCKING_DAMAGE_SCALE * excess) / (V_GATE_KMS * V_GATE_KMS)
		: 0;
}

/**
 * §3's bounce: the normal component of `u` reversed and multiplied by
 * `RESTITUTION`, the tangential kept. A `u` that is not closing is returned
 * unchanged.
 */
export function bounce(u: Vec3, normal: Vec3): Vec3 {
	const un = dot(u, normal);
	return un < 0 ? sub(u, scale(normal, (1 + RESTITUTION) * un)) : u;
}

// ---------------------------------------------------------------------------
// 2. Shapes and the distance query
// ---------------------------------------------------------------------------

/**
 * Which of a ship's own primitives a box is (node #959, #956 Q4): its hull box
 * (P1) or its deployed cutter (#949 D3).
 */
export type ShipPart = "hull" | "cutter";

/**
 * One convex piece of a solid, in the solid's own frame, kilometres (§2.2).
 * A sphere is a point swept by a radius, a capsule a segment swept by one; a
 * box carries no radius.
 */
export type Primitive =
	| {
			readonly kind: "sphere";
			readonly centre: Vec3;
			readonly radiusKm: number;
	  }
	| {
			readonly kind: "capsule";
			readonly a: Vec3;
			readonly b: Vec3;
			readonly radiusKm: number;
	  }
	| {
			readonly kind: "box";
			readonly centre: Vec3;
			/** The box's own axes in the solid's frame, unit and orthogonal. */
			readonly axes: readonly [Vec3, Vec3, Vec3];
			/** Half the box's extent along each axis. */
			readonly half: readonly [number, number, number];
			/**
			 * The ship part this box is, on a ship's own list. Absent on a
			 * station's or a body's box; a ship box without one is read as
			 * the hull, which is what every ship list was before the cutter.
			 */
			readonly part?: ShipPart;
	  };

/**
 * A primitive's thinnest dimension. §4.1 bounds motion by it; the sweep here
 * meets that bound without reading it, and a proxy module declares and asserts
 * its own thinnest figure against this.
 */
export function thicknessKm(p: Primitive): number {
	if (p.kind === "box") return 2 * Math.min(p.half[0], p.half[1], p.half[2]);
	return 2 * p.radiusKm;
}

/** The furthest any point of a primitive lies from its solid's origin. */
export function primitiveReachKm(p: Primitive): number {
	if (p.kind === "sphere") return length(p.centre) + p.radiusKm;
	if (p.kind === "capsule")
		return Math.max(length(p.a), length(p.b)) + p.radiusKm;
	return length(p.centre) + Math.hypot(p.half[0], p.half[1], p.half[2]);
}

/** The bounding sphere of a set of primitives about the solid's origin. */
export const reachKm = (primitives: readonly Primitive[]): number =>
	primitives.reduce((most, p) => Math.max(most, primitiveReachKm(p)), 0);

/**
 * A solid's frame in the world: an origin and the world images of its local
 * `x`, `y`, `z` axes (orthonormal).
 */
export interface Pose {
	origin: Vec3;
	x: Vec3;
	y: Vec3;
	z: Vec3;
}

export const IDENTITY_AXES = {
	x: v3(1, 0, 0),
	y: v3(0, 1, 0),
	z: v3(0, 0, 1),
} as const;

/** The pose of a ship: local `x` starboard, `y` dorsal, `z` along the nose —
 *  the frame `HullBoxCentre` is written in. */
export const shipPose = (pos: Vec3, nose: Vec3, up: Vec3): Pose => ({
	origin: pos,
	x: cross(nose, up),
	y: up,
	z: nose,
});

/**
 * A hull's collision box (P1), in the ship's own frame: `env`'s extents about
 * its measured centre (`HullBoxCentre`, §9.1.10).
 */
export function hullBox(env: HullEnvelope, centre: HullBoxCentre): Primitive {
	return {
		kind: "box",
		centre: v3(centre.rightKm, centre.upKm, centre.foreKm),
		axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
		half: [env.beamKm / 2, env.heightKm / 2, env.lengthKm / 2],
		part: "hull",
	};
}

/**
 * A hull's deployed cutter (#949 D3), in the ship's own frame: the box from
 * the bow plane to bow + feed travel, the rotor's radius either side of the
 * keel line, centred below the ship's axis (`HullCutter`).
 */
export function cutterBox(cutter: HullCutter): Primitive {
	return {
		kind: "box",
		centre: v3(0, -cutter.downKm, cutter.bowKm + cutter.feedTravelKm / 2),
		axes: [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)],
		half: [cutter.radiusKm, cutter.radiusKm, cutter.feedTravelKm / 2],
		part: "cutter",
	};
}

/**
 * A ship's primitive list (node #959): its hull box, and its cutter while the
 * cutter is deployed. Stowed, the list is the hull box alone, exactly as
 * before the cutter existed. `deployed` is an input — where it comes from is
 * Drill interaction's (#920) — and a hull with no cutter cannot deploy one.
 */
export function shipPrimitives(
	hull: {
		readonly env: HullEnvelope;
		readonly envCentre: HullBoxCentre;
		readonly cutter?: HullCutter;
	},
	cutterDeployed: boolean,
): Primitive[] {
	const box = hullBox(hull.env, hull.envCentre);
	if (!cutterDeployed) return [box];
	if (!hull.cutter) throw new Error("this hull carries no cutter to deploy");
	return [box, cutterBox(hull.cutter)];
}

/** The part a box on a ship's list is: its own, or the hull when unnamed. */
const partOf = (p: Primitive): ShipPart =>
	(p.kind === "box" && p.part) || "hull";

/** A star, a planet or a moon: a sphere at `radiusKm` (§2.1, C1). */
export const bodySphere = (radiusKm: number): Primitive => ({
	kind: "sphere",
	centre: v3(),
	radiusKm,
});

/** A primitive placed in the world (relative to some reference point). */
type Placed =
	| { kind: "point"; c: Vec3; r: number }
	| { kind: "segment"; a: Vec3; b: Vec3; r: number }
	| { kind: "box"; c: Vec3; u: [Vec3, Vec3, Vec3]; h: readonly number[] };

const turn = (pose: Pose, local: Vec3): Vec3 =>
	add(
		add(scale(pose.x, local.x), scale(pose.y, local.y)),
		scale(pose.z, local.z),
	);

const toWorld = (pose: Pose, local: Vec3): Vec3 =>
	add(pose.origin, turn(pose, local));

function place(p: Primitive, pose: Pose): Placed {
	if (p.kind === "sphere")
		return { kind: "point", c: toWorld(pose, p.centre), r: p.radiusKm };
	if (p.kind === "capsule")
		return {
			kind: "segment",
			a: toWorld(pose, p.a),
			b: toWorld(pose, p.b),
			r: p.radiusKm,
		};
	return {
		kind: "box",
		c: toWorld(pose, p.centre),
		u: [turn(pose, p.axes[0]), turn(pose, p.axes[1]), turn(pose, p.axes[2])],
		h: p.half,
	};
}

type PlacedBox = Placed & { kind: "box" };

/** The ship's hull box, placed. `sweepShip` refuses a ship without one. */
const placeBox = (p: Primitive, pose: Pose): PlacedBox =>
	place(p, pose) as PlacedBox;

/** The core's support point in direction `d` (the radius excluded). */
function support(s: Placed, d: Vec3): Vec3 {
	if (s.kind === "point") return s.c;
	if (s.kind === "segment") return dot(s.a, d) >= dot(s.b, d) ? s.a : s.b;
	let out = s.c;
	for (let i = 0; i < 3; i++)
		out = add(out, scale(s.u[i], dot(s.u[i], d) >= 0 ? s.h[i] : -s.h[i]));
	return out;
}

/** The furthest any point of the shape (radius included) reaches along `n`. */
function extentAlong(s: Placed, n: Vec3): number {
	if (s.kind === "box") {
		let h = dot(s.c, n);
		for (let i = 0; i < 3; i++) h += s.h[i] * Math.abs(dot(s.u[i], n));
		return h;
	}
	return dot(support(s, n), n) + s.r;
}

const radiusOf = (s: Placed): number => (s.kind === "box" ? 0 : s.r);

const centreOf = (s: Placed): Vec3 =>
	s.kind === "segment" ? scale(add(s.a, s.b), 0.5) : s.c;

/** The point of a box nearest `p`, exactly: `p` clamped into the box. */
function closestOnBox(box: PlacedBox, p: Vec3): Vec3 {
	const d = sub(p, box.c);
	let out = box.c;
	for (let i = 0; i < 3; i++) {
		const t = Math.max(-box.h[i], Math.min(box.h[i], dot(d, box.u[i])));
		out = add(out, scale(box.u[i], t));
	}
	return out;
}

/**
 * The gap between a ship's box and one primitive.
 *
 * `overlap` when the two share any volume — the ghost rule's case (§4.3), for
 * which no normal exists. Otherwise `distanceKm` is the gap, `normal` points
 * from the surface toward the ship, `onShip` is the ship's nearest point and
 * `onSurface` the primitive's.
 */
export type Separation =
	| { overlap: true }
	| {
			overlap: false;
			distanceKm: number;
			normal: Vec3;
			onShip: Vec3;
			onSurface: Vec3;
	  };

function separation(ship: PlacedBox, other: Placed): Separation {
	let onShip: Vec3;
	let onCore: Vec3;
	if (other.kind === "point") {
		onCore = other.c;
		onShip = closestOnBox(ship, other.c);
	} else {
		const found = gjk(ship, other);
		if (!found) return { overlap: true };
		onShip = found.a;
		onCore = found.b;
	}
	const gap = sub(onShip, onCore);
	const core = length(gap);
	const r = radiusOf(other);
	if (core <= r || core === 0) return { overlap: true };
	const normal = scale(gap, 1 / core);
	return {
		overlap: false,
		distanceKm: core - r,
		normal,
		onShip,
		onSurface: add(onCore, scale(normal, r)),
	};
}

/**
 * The gap between a ship's box and one primitive, each at its own pose: the
 * query the sweep advances on. Exported so a row can ask what a
 * point-in-volume test would have seen at either end of a step.
 */
export const pairSeparation = (
	shipBox: Primitive,
	shipAt: Pose,
	primitive: Primitive,
	solidAt: Pose,
): Separation =>
	separation(placeBox(shipBox, shipAt), place(primitive, solidAt));

/**
 * How far a ship's box must move along `normal` — pointing from the other
 * primitive toward the ship — for the two to stand `SEPARATION_KM` apart
 * along it: the push `settleTouching` gives an overlap. Apart along one axis
 * is apart (the separating axis), so this clears an overlap whichever axis is
 * chosen; `≤ 0` when the two already stand that far apart along it.
 */
export function pushOutAlong(
	shipBox: Primitive,
	shipAt: Pose,
	primitive: Primitive,
	solidAt: Pose,
	normal: Vec3,
): number {
	const ship = placeBox(shipBox, shipAt);
	const shipLow = -extentAlong(ship, scale(normal, -1));
	return (
		extentAlong(place(primitive, solidAt), normal) + SEPARATION_KM - shipLow
	);
}

/** One vertex of the Minkowski difference `A − B`, with its two witnesses. */
interface Vertex {
	w: Vec3;
	a: Vec3;
	b: Vec3;
}

/** A point of the simplex nearest the origin, as weights on its vertices. */
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

/** Ericson's closest point on a triangle, to the origin (RTCD §5.1.5). */
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
		// A degenerate triangle: its nearest point is on one of its edges.
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

/**
 * The nearest point of a tetrahedron to the origin, or `null` when the origin
 * is inside it. A face is a candidate when the origin lies on the far side of
 * its plane from the fourth vertex; a flat tetrahedron makes every face one.
 */
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

/**
 * GJK on two convex cores: their nearest points, or `null` when they
 * intersect. Polytopes and segments only, so it terminates on a vertex of the
 * difference; the tolerances guard rounding, not convergence.
 */
function gjk(A: Placed, B: Placed): { a: Vec3; b: Vec3 } | null {
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
		// No vertex further toward the origin than the current nearest point:
		// it is the nearest point of the whole difference.
		if (vv - dot(v, next.w) <= 1e-12 * vv + 1e-20) break;
		if (simplex.some((s) => lengthSq(sub(s.w, next.w)) <= 1e-24)) break;
		simplex = [...nearest.keep, next];
		let found: Nearest | null;
		if (simplex.length === 2) found = nearestOnSegment(simplex[0], simplex[1]);
		else if (simplex.length === 3)
			found = nearestOnTriangle(simplex[0], simplex[1], simplex[2]);
		else found = nearestOnTetrahedron(simplex);
		if (!found) return null;
		// No progress is the end of the descent, not a reason to keep going.
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

// ---------------------------------------------------------------------------
// 3. The sweep
// ---------------------------------------------------------------------------

/**
 * A solid across one step: its primitives in its own frame and its pose and
 * origin velocity at both ends. The pose between the ends is the straight
 * line for the origin and the shortest-arc turn for the axes, so the step's
 * velocity change is spread across it (§3.1).
 *
 * A turn of π or more inside one step cannot be told from its short way round;
 * at `MAX_DT` that is 31 rad/s, ten times any hull's rate.
 */
export interface SolidMotion {
	primitives: readonly Primitive[];
	start: Pose;
	end: Pose;
	velStart: Vec3;
	velEnd: Vec3;
}

/** A solid's turn across the step, as an axis and an angle. */
export interface Spin {
	axis: Vec3;
	angle: number;
}

/**
 * The rotation carrying `from`'s axes onto `to`'s, as an axis and an angle,
 * through the quaternion (Shepperd's method) so a turn near a half
 * revolution keeps its axis.
 */
export function spinBetween(from: Pose, to: Pose): Spin {
	// R = Σ to_i ⊗ from_i, so R·from_i = to_i.
	const col = (k: "x" | "y" | "z") => ({
		x: to.x[k] * from.x.x + to.y[k] * from.y.x + to.z[k] * from.z.x,
		y: to.x[k] * from.x.y + to.y[k] * from.y.y + to.z[k] * from.z.y,
		z: to.x[k] * from.x.z + to.y[k] * from.y.z + to.z[k] * from.z.z,
	});
	// Row k of R: R[k][j] = Σ_i to_i[k] · from_i[j].
	const r0 = col("x");
	const r1 = col("y");
	const r2 = col("z");
	const m00 = r0.x;
	const m01 = r0.y;
	const m02 = r0.z;
	const m10 = r1.x;
	const m11 = r1.y;
	const m12 = r1.z;
	const m20 = r2.x;
	const m21 = r2.y;
	const m22 = r2.z;
	const trace = m00 + m11 + m22;
	let w: number;
	let x: number;
	let y: number;
	let z: number;
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		w = 0.25 * s;
		x = (m21 - m12) / s;
		y = (m02 - m20) / s;
		z = (m10 - m01) / s;
	} else if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		w = (m21 - m12) / s;
		x = 0.25 * s;
		y = (m01 + m10) / s;
		z = (m02 + m20) / s;
	} else if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		w = (m02 - m20) / s;
		x = (m01 + m10) / s;
		y = 0.25 * s;
		z = (m12 + m21) / s;
	} else {
		const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
		w = (m10 - m01) / s;
		x = (m02 + m20) / s;
		y = (m12 + m21) / s;
		z = 0.25 * s;
	}
	if (w < 0) {
		w = -w;
		x = -x;
		y = -y;
		z = -z;
	}
	const sinHalf = Math.hypot(x, y, z);
	if (sinHalf < 1e-15) return { axis: v3(1, 0, 0), angle: 0 };
	return {
		axis: v3(x / sinHalf, y / sinHalf, z / sinHalf),
		angle: 2 * Math.atan2(sinHalf, Math.min(1, w)),
	};
}

/** The pose a fraction `s` of the way through the step, relative to `ref`. */
function poseAt(m: SolidMotion, spin: Spin, s: number, ref: Vec3): Pose {
	const origin = add(
		sub(m.start.origin, ref),
		scale(sub(m.end.origin, m.start.origin), s),
	);
	if (spin.angle === 0) return { ...m.start, origin };
	const a = spin.angle * s;
	return {
		origin,
		x: rotateAbout(m.start.x, spin.axis, a),
		y: rotateAbout(m.start.y, spin.axis, a),
		z: rotateAbout(m.start.z, spin.axis, a),
	};
}

const lerp = (a: Vec3, b: Vec3, s: number): Vec3 => add(a, scale(sub(b, a), s));

/** A point's velocity on a solid at fraction `s`: the origin's, plus the
 *  solid's turn about its origin at that point. */
function pointVelocity(
	m: SolidMotion,
	spin: Spin,
	dt: number,
	s: number,
	pose: Pose,
	point: Vec3,
): Vec3 {
	return add(
		lerp(m.velStart, m.velEnd, s),
		turnVelocity(spin, dt, pose, point),
	);
}

/** What a solid's turn about its origin adds to a point's velocity. */
function turnVelocity(spin: Spin, dt: number, pose: Pose, point: Vec3): Vec3 {
	if (spin.angle === 0 || !(dt > 0)) return v3();
	const omega = scale(spin.axis, spin.angle / dt);
	return cross(omega, sub(point, pose.origin));
}

/** A solid's bounding sphere across one step: its origin at both ends, and
 *  how far any of its primitives reaches from that origin. */
export interface Reach {
	start: Vec3;
	end: Vec3;
	reachKm: number;
}

/**
 * Whether two solids' bounding spheres can meet within the step at all
 * (§4.1's last sentence). Their origins' relative path is a straight segment,
 * so the test is the segment's distance from the origin.
 */
export function mayMeet(ship: Reach, solid: Reach): boolean {
	const r0 = sub(ship.start, solid.start);
	const r1 = sub(ship.end, solid.end);
	const d = sub(r1, r0);
	const dd = lengthSq(d);
	const t = dd > 0 ? Math.max(0, Math.min(1, -dot(r0, d) / dd)) : 0;
	const nearest = length(add(r0, scale(d, t)));
	return nearest <= ship.reachKm + solid.reachKm + 2 * RESTING_KM;
}

/** What one step's sweep found and did. */
export interface Impact {
	/** Index of the met solid in the list handed to `sweepShip`. */
	solid: number;
	/** Seconds into the step. A resting pair is met at 0. */
	timeS: number;
	/** Where the two met, world coordinates. */
	point: Vec3;
	/** The surface's outward normal there. */
	normal: Vec3;
	/** §3's `v_n`, km/s. */
	closingKms: number;
	/** §3's damage, for `applyDamage`. Zero below `V_SCRAPE_KMS`. */
	damage: number;
	/** The side `sideStruck` selects for it. */
	side: ShieldSide;
	/** A resting pair (§3.1) rather than a swept impact. */
	resting: boolean;
	/** Which of the ship's primitives met the surface (#956 Q4). */
	part: ShipPart;
}

export interface SweepResult {
	/** The ship's origin at the end of the step, outside every met surface. */
	pos: Vec3;
	/** The ship's velocity at the end of the step. */
	vel: Vec3;
	/**
	 * Every pair met this step, earliest first: resting pairs at the start, then
	 * the swept impact that owns the tick (§4.2), if there is one. Each is billed
	 * on its own side, so a caller lands every one through `applyDamage`.
	 */
	impacts: Impact[];
	/**
	 * The solids, by index, with a primitive that overlapped the ship at the
	 * start and so was not tested (§4.3) — once each, however many of its
	 * primitives overlapped. The rule fails open by design, so this list is
	 * how a caller sees that it did.
	 */
	ghosts: number[];
	/**
	 * §4.2: the aperture plane owned the tick. The ship's centre crossed a plane
	 * at `planeS` before any impact (a tie goes to the impact), so nothing was
	 * resolved: `impacts` is empty, and `pos` and `vel` are the step's own,
	 * for the caller's six checks to place. Always `false` without a plane.
	 */
	planeOwns: boolean;
}

/** What a step's sweep is told about the rest of the tick (§4.2). */
export interface SweepOptions {
	/**
	 * Seconds into the step at which the ship's centre crosses an aperture
	 * plane, or `null` when it crosses none. An impact at or before it owns the
	 * tick; one after it is never reached, because the plane's checks place
	 * the ship (`docking.md` §2, §12).
	 */
	planeS?: number | null;
}

interface PairState {
	solid: number;
	/** The ship's box this pair sweeps. */
	shipBox: Primitive;
	/** The met solid's primitive. */
	primitive: Primitive;
	reach: number;
}

/** A pair the ship ends the step against, and how it met it. */
interface Touching {
	pair: PairState;
	normal: Vec3;
	/** The start-of-step closing speed: a resting pair bounces on it. */
	closingKms: number;
}

/** What every stage of one sweep reads, fixed for the step. */
interface Sweep {
	ship: SolidMotion;
	/** Every box on the ship's list: the hull, and a deployed cutter. */
	shipBoxes: readonly Primitive[];
	shipReach: number;
	shipSpin: Spin;
	/** At rest, both ships keep the own-turn exemption (§3.1). */
	restingShipPair: boolean;
	solids: readonly SolidMotion[];
	/** Each solid's turn across the step, by index — computed once. */
	spins: readonly Spin[];
	dt: number;
}

/** The ship's end translation, as each stage corrects it. */
interface End {
	origin: Vec3;
	vel: Vec3;
}

/**
 * One step of the ship against a list of solids: §3.1, §4.1 and §4.3.
 *
 * **A pair that overlaps at the start is a ghost** (§4.3): untested until it
 * has separated, with no damage and no push-out. **A pair touching at the
 * start is resting** (§3.1): its closing speed is read at the start of the
 * step, before this step's thrust, the frame's acceleration or the ship's own
 * turn, and its inward motion is stopped at the surface. **Every other pair
 * is swept**, and the earliest impact owns the tick (§4.2): the ship is left
 * at the separation outside it, carried with the met solid for the rest of
 * the step, and bounced.
 *
 * Four stages, in order: `classifyPairs`, `stopResting`, `resolveEarliest`
 * and `settleTouching`. Each takes the ship's end translation as the stage
 * before left it and hands back its own correction.
 *
 * The ship's attitude is never touched — a bounce imparts no spin (§3) — so
 * the end pose's axes are the step's own.
 *
 * **The plane** (§4.2, node #663): given `options.planeS`, the earliest event
 * owns the tick. A resting impact is at the start of the step and a swept one
 * at its own time; either at or before the plane wins, and the step resolves
 * as above. Neither at or before it, the plane wins: nothing is resolved, and
 * the result says so (`planeOwns`).
 */
export function sweepShip(
	ship: SolidMotion,
	solids: readonly SolidMotion[],
	dt: number,
	options: SweepOptions = {},
): SweepResult {
	return sweepMotion(ship, solids, dt, options, false).result;
}

/**
 * `sweepShip`'s body, with the met solid's primitive beside each impact, in
 * the same order: the pair resolver reads which of B's parts was met.
 */
function sweepMotion(
	ship: SolidMotion,
	solids: readonly SolidMotion[],
	dt: number,
	options: SweepOptions,
	restingShipPair: boolean,
): { result: SweepResult; surfaces: Primitive[] } {
	const result: SweepResult = {
		pos: ship.end.origin,
		vel: ship.velEnd,
		impacts: [],
		ghosts: [],
		planeOwns: false,
	};
	const surfaces: Primitive[] = [];
	const planeS = options.planeS ?? null;
	if (!(dt > 0) || solids.length === 0) {
		result.planeOwns = planeS !== null;
		return { result, surfaces };
	}
	const shipBoxes = ship.primitives.filter((p) => p.kind === "box");
	if (shipBoxes.length === 0)
		throw new Error("a ship collides on its hull box (P1)");
	const sweep: Sweep = {
		ship,
		shipBoxes,
		shipReach: reachKm(ship.primitives),
		shipSpin: spinBetween(ship.start, ship.end),
		restingShipPair,
		solids,
		spins: solids.map((solid) => spinBetween(solid.start, solid.end)),
		dt,
	};
	const { touching, swept } = classifyPairs(sweep, result, surfaces);
	const stopped = stopResting(sweep, touching, {
		origin: ship.end.origin,
		vel: ship.velEnd,
	});
	// A resting pair can stop this step's thrust without a billed impact:
	// its start speed is zero (§3.1). The unconstrained path's crossing is
	// then unreachable, so that contact still owns the tick (§4.2). A ship
	// departing the surface is not constrained and may cross another plane.
	let end: End = stopped;
	const met = resolveEarliest(sweep, swept, end);
	const impactFirst =
		stopped.constrained ||
		result.impacts.length > 0 ||
		(met !== null && (planeS === null || met.impact.timeS <= planeS));
	if (planeS !== null && !impactFirst) {
		result.planeOwns = true;
		return { result, surfaces };
	}
	if (met) {
		end = met.end;
		touching.push(met.touching);
		result.impacts.push(met.impact);
		surfaces.push(met.touching.pair.primitive);
	}
	end = settleTouching(sweep, touching, end, met !== null);
	result.pos = end.origin;
	result.vel = end.vel;
	return { result, surfaces };
}

const solidIndexes = new WeakMap<
	readonly Primitive[],
	{ reach: number; grid: SphereGrid | null }
>();
function solidIndex(primitives: readonly Primitive[]) {
	let found = solidIndexes.get(primitives);
	if (!found) {
		found = {
			reach: reachKm(primitives),
			grid:
				primitives.length > INDEXED_ABOVE
					? buildSphereGrid(
							primitives.map((p) => {
								const { centre, radiusKm } = primitiveBound(p);
								return { x: centre.x, y: centre.y, z: centre.z, r: radiusKm };
							}),
							INDEX_CELL_KM,
						)
					: null,
		};
		solidIndexes.set(primitives, found);
	}
	return found;
}
/** A solid's reach, read once per primitive list rather than every step. */
const solidReachKm = (primitives: readonly Primitive[]) =>
	solidIndex(primitives).reach;

/**
 * The primitives `primitiveMayMeet` has to look at, in list order. A short
 * list is all of them. A long one (an authored shipyard's thousands of boxes,
 * node #818) is narrowed through its grid: the ship's path is taken into the
 * solid's own frame at both ends of the step and grown by everything
 * `primitiveMayMeet` allows for — the ship's reach, the resting margin, the
 * sagitta of the solid's turn, and how far that turn carries the ship's end
 * against the solid — so a primitive it could pass is never skipped.
 */
function nearPrimitives(
	sweep: Sweep,
	solid: SolidMotion,
	spin: Spin,
	reach: number,
): readonly Primitive[] {
	const { grid } = solidIndex(solid.primitives);
	if (!grid) return solid.primitives;
	const local = (pose: Pose, p: Vec3) => {
		const d = sub(p, pose.origin);
		return v3(dot(d, pose.x), dot(d, pose.y), dot(d, pose.z));
	};
	const a = local(solid.start, sweep.ship.start.origin);
	const b = local(solid.end, sweep.ship.end.origin);
	const turn = 2 * Math.sin(spin.angle / 2);
	const grow =
		sweep.shipReach +
		2 * RESTING_KM +
		reach * (1 - Math.cos(spin.angle / 2)) +
		(length(b) + reach) * turn;
	const near: number[] = [];
	querySphereGrid(
		grid,
		Math.min(a.x, b.x) - grow,
		Math.min(a.y, b.y) - grow,
		Math.min(a.z, b.z) - grow,
		Math.max(a.x, b.x) + grow,
		Math.max(a.y, b.y) + grow,
		Math.max(a.z, b.z) + grow,
		(n) => {
			near.push(n);
		},
	);
	near.sort((x, y) => x - y);
	return near.map((n) => solid.primitives[n]);
}

/** A primitive's bounding sphere in its solid's frame. */
function primitiveBound(p: Primitive): { centre: Vec3; radiusKm: number } {
	if (p.kind === "sphere") return { centre: p.centre, radiusKm: p.radiusKm };
	if (p.kind === "capsule")
		return {
			centre: scale(add(p.a, p.b), 0.5),
			radiusKm: length(sub(p.b, p.a)) / 2 + p.radiusKm,
		};
	return {
		centre: p.centre,
		radiusKm: Math.hypot(p.half[0], p.half[1], p.half[2]),
	};
}

/**
 * Whether one primitive's bounding sphere can meet the ship's within the step.
 * The primitive's centre is taken at both ends of the step and joined by a
 * chord; a solid that turns carries it on an arc instead, which leaves the
 * chord by at most its sagitta, `|c| · (1 − cos(θ / 2))`, so that is added to
 * the radius. Conservative: a primitive this rejects cannot be met.
 */
function primitiveMayMeet(
	sweep: Sweep,
	solid: SolidMotion,
	spin: Spin,
	primitive: Primitive,
): boolean {
	const { centre, radiusKm } = primitiveBound(primitive);
	const sagitta = length(centre) * (1 - Math.cos(spin.angle / 2));
	return mayMeet(
		{
			start: sweep.ship.start.origin,
			end: sweep.ship.end.origin,
			reachKm: sweep.shipReach,
		},
		{
			start: toWorld(solid.start, centre),
			end: toWorld(solid.end, centre),
			reachKm: radiusKm + sagitta,
		},
	);
}

/**
 * §4.3 and §3.1: every pair at the start of the step is a ghost, resting or
 * swept. Ghosts and resting impacts go onto `result` as they are found.
 */
function classifyPairs(
	sweep: Sweep,
	result: SweepResult,
	surfaces: Primitive[],
): { touching: Touching[]; swept: PairState[] } {
	const { ship, dt } = sweep;
	const touching: Touching[] = [];
	const swept: PairState[] = [];
	sweep.solids.forEach((solid, index) => {
		const reach = solidReachKm(solid.primitives);
		if (
			!mayMeet(
				{
					start: ship.start.origin,
					end: ship.end.origin,
					reachKm: sweep.shipReach,
				},
				{ start: solid.start.origin, end: solid.end.origin, reachKm: reach },
			)
		)
			return;
		const ref = solid.start.origin;
		const shipOrigin = sub(ship.start.origin, ref);
		const shipStart = { ...ship.start, origin: shipOrigin };
		const solidPose = { ...solid.start, origin: v3() };
		const spin = sweep.spins[index];
		for (const primitive of nearPrimitives(sweep, solid, spin, reach)) {
			// §4.1's last sentence, per primitive: a station's proxy is tens of
			// pieces, and a ship beside one face cannot reach the far side's.
			if (!primitiveMayMeet(sweep, solid, spin, primitive)) continue;
			const placed = place(primitive, solidPose);
			// Every ship box against it, each its own pair (node #959): a
			// deployed cutter is ghosted, resting or swept on its own terms.
			for (const shipBox of sweep.shipBoxes) {
				const pair = { solid: index, shipBox, primitive, reach };
				const gap = separation(placeBox(shipBox, shipStart), placed);
				if (gap.overlap) {
					if (!result.ghosts.includes(index)) result.ghosts.push(index);
					continue;
				}
				if (gap.distanceKm > RESTING_KM) {
					swept.push(pair);
					continue;
				}
				// Both ships keep the own-turn exemption at rest (§3.1). Their
				// translation at the start still bills; a moving world surface
				// is still billed. Swept impacts use both point velocities below.
				const surfaceVel = sweep.restingShipPair
					? solid.velStart
					: pointVelocity(
							solid,
							sweep.spins[index],
							dt,
							0,
							solidPose,
							gap.onSurface,
						);
				const closing = closingSpeed(
					sub(ship.velStart, surfaceVel),
					gap.normal,
				);
				touching.push({ pair, normal: gap.normal, closingKms: closing });
				if (closing > RESTING_CLOSING_FLOOR_KMS) {
					result.impacts.push({
						solid: index,
						timeS: 0,
						point: add(gap.onSurface, ref),
						normal: gap.normal,
						closingKms: closing,
						damage: impactDamage(closing),
						// §3: measured from the ship's position, as the swept branch is.
						side: sideStruck(ship.start.z, sub(gap.onShip, shipOrigin)),
						resting: true,
						part: partOf(shipBox),
					});
					surfaces.push(primitive);
				}
			}
		}
	});
	return { touching, swept };
}

/**
 * §3.1: a resting pair's inward motion is stopped at the surface. The
 * relative displacement loses its inward component along the pair's normal;
 * what is left — a turn carrying a corner in, a surface curving under a
 * slide — is pushed out by `settleTouching`.
 */
function stopResting(
	sweep: Sweep,
	touching: readonly Touching[],
	end: End,
): End & { constrained: boolean } {
	let origin = end.origin;
	let constrained = false;
	for (const r of touching) {
		const solid = sweep.solids[r.pair.solid];
		const relative = sub(
			sub(origin, sweep.ship.start.origin),
			sub(solid.end.origin, solid.start.origin),
		);
		const inward = dot(relative, r.normal);
		if (inward < 0) {
			origin = sub(origin, scale(r.normal, inward));
			constrained = true;
		}
	}
	return { origin, vel: end.vel, constrained };
}

/**
 * §4.1, §4.2: sweep every other pair; the earliest impact among them. The
 * ship is left at the separation outside it, carried with the met solid for
 * the rest of the step, and bounced; the impact is handed back for the caller
 * to weigh against the plane. `null` when no pair is met.
 */
function resolveEarliest(
	sweep: Sweep,
	swept: readonly PairState[],
	end: End,
): { end: End; touching: Touching; impact: Impact } | null {
	const { ship, shipSpin, dt } = sweep;
	const motion: SolidMotion = {
		...ship,
		end: { ...ship.end, origin: end.origin },
	};
	let earliest: { pair: PairState; s: number } | null = null;
	for (const pair of swept) {
		const s = advance(sweep, motion, pair);
		if (s === null) continue;
		if (!earliest || s < earliest.s) earliest = { pair, s };
	}
	if (!earliest) return null;

	const { pair, s } = earliest;
	const solid = sweep.solids[pair.solid];
	const solidSpin = sweep.spins[pair.solid];
	const ref = solid.start.origin;
	const shipAt = poseAt(motion, shipSpin, s, ref);
	const solidAt = poseAt(solid, solidSpin, s, ref);
	const shipBoxAt = placeBox(pair.shipBox, shipAt);
	const surfaceAt = place(pair.primitive, solidAt);
	const gap = separation(shipBoxAt, surfaceAt);
	// The advance stops short of the surface, so an overlap here is a bound
	// that failed; take the way the ship came *relative to the solid* as the
	// normal — a moon carried at 32 km/s would otherwise lift it along the
	// moon's own path — and, with no relative motion, out from the
	// primitive's centre.
	const normal = gap.overlap
		? overlapNormal(
				sub(
					sub(ship.start.origin, end.origin),
					sub(solid.start.origin, solid.end.origin),
				),
				sub(shipBoxAt.c, centreOf(surfaceAt)),
			)
		: gap.normal;
	const onShip = gap.overlap ? shipBoxAt.c : gap.onShip;
	const onSurface = gap.overlap ? shipBoxAt.c : gap.onSurface;
	const u = sub(
		pointVelocity(motion, shipSpin, dt, s, shipAt, onShip),
		pointVelocity(solid, solidSpin, dt, s, solidAt, onSurface),
	);
	const closing = closingSpeed(u, normal);
	// The bounce changes the ship's linear velocity only (§3), and the
	// frame's change across the rest of the step rides along with it.
	const kick = sub(bounce(u, normal), u);
	const carried = sub(solid.velEnd, lerp(solid.velStart, solid.velEnd, s));
	const vel = add(add(lerp(motion.velStart, motion.velEnd, s), kick), carried);
	// Left at the separation outside the surface, then carried with the
	// solid — turned with it where it spins — for the rest of the step.
	const lift = gap.overlap ? SEPARATION_KM : SEPARATION_KM - gap.distanceKm;
	const local = sub(add(shipAt.origin, scale(normal, lift)), solidAt.origin);
	const remaining = solidSpin.angle * (1 - s);
	const origin = add(
		solid.end.origin,
		remaining === 0 ? local : rotateAbout(local, solidSpin.axis, remaining),
	);
	return {
		end: { origin, vel },
		touching: { pair, normal, closingKms: 0 },
		impact: {
			solid: pair.solid,
			timeS: s * dt,
			point: add(onSurface, ref),
			normal,
			closingKms: closing,
			damage: impactDamage(closing),
			side: sideStruck(shipAt.z, sub(onShip, shipAt.origin)),
			resting: false,
			part: partOf(pair.shipBox),
		},
	};
}

/**
 * The end of the step: every touched pair apart by the separation, with no
 * inward velocity left against it (§3.1). A resting pair that closed faster
 * than `V_SCRAPE_KMS` bounces on the speed it closed at — unless a swept
 * impact has already bounced the ship this step.
 */
function settleTouching(
	sweep: Sweep,
	touching: readonly Touching[],
	end: End,
	bounced: boolean,
): End {
	const { ship, dt } = sweep;
	let { origin, vel } = end;
	for (const r of touching) {
		const solid = sweep.solids[r.pair.solid];
		const ref = solid.start.origin;
		const shipEnd = placeBox(r.pair.shipBox, {
			...ship.end,
			origin: sub(origin, ref),
		});
		const solidEnd = { ...solid.end, origin: sub(solid.end.origin, ref) };
		const surface = place(r.pair.primitive, solidEnd);
		const gap = separation(shipEnd, surface);
		let normal = r.normal;
		let push: number;
		if (gap.overlap) {
			// Out along the pair's own normal until the two projections part.
			const shipLow = -extentAlong(shipEnd, scale(normal, -1));
			push = extentAlong(surface, normal) + SEPARATION_KM - shipLow;
		} else {
			normal = gap.normal;
			push = SEPARATION_KM - gap.distanceKm;
		}
		if (push > 0) origin = add(origin, scale(normal, push));
		// Own rotation is held by separating the boxes (§3.1), rather than
		// adding translation to the other ship only when it happens to be A.
		const surfaceVel = sweep.restingShipPair
			? solid.velEnd
			: pointVelocity(
					solid,
					sweep.spins[r.pair.solid],
					dt,
					1,
					solidEnd,
					gap.overlap ? shipEnd.c : gap.onSurface,
				);
		const u = sub(vel, surfaceVel);
		const un = dot(u, normal);
		if (r.closingKms > V_SCRAPE_KMS && !bounced) {
			vel = add(
				surfaceVel,
				add(
					sub(u, scale(normal, un)),
					scale(normal, RESTITUTION * r.closingKms),
				),
			);
		} else if (un < 0) {
			vel = sub(vel, scale(normal, un));
		}
	}
	return { origin, vel };
}

/** The first of `back` and `out` that has a direction, as a unit vector;
 *  `+x` when neither has. */
function overlapNormal(back: Vec3, out: Vec3): Vec3 {
	for (const d of [back, out]) {
		const n = length(d);
		if (n > 1e-12) return scale(d, 1 / n);
	}
	return v3(1, 0, 0);
}

/**
 * Conservative advancement for one pair: the fraction of the step at which
 * the gap first falls to `CONTACT_KM`, or `null` if it does not.
 *
 * The bound is the separating plane's: at the closest points, the plane
 * normal to `n` separates the two by the gap, and neither can cross it faster
 * than its translation along `n` plus its turn at its reach. Advancing by
 * `gap / bound` therefore never steps past a surface, however thin (§4.1).
 */
function advance(
	sweep: Sweep,
	ship: SolidMotion,
	pair: PairState,
): number | null {
	const { shipSpin, dt } = sweep;
	const solid = sweep.solids[pair.solid];
	const solidSpin = sweep.spins[pair.solid];
	const ref = solid.start.origin;
	const translation = scale(
		sub(
			sub(ship.end.origin, ship.start.origin),
			sub(solid.end.origin, solid.start.origin),
		),
		1 / dt,
	);
	const turning =
		(shipSpin.angle / dt) * sweep.shipReach +
		(solidSpin.angle / dt) * pair.reach;
	let s = 0;
	for (let i = 0; i < MAX_ADVANCES; i++) {
		const shipAt = placeBox(pair.shipBox, poseAt(ship, shipSpin, s, ref));
		const solidAt = place(pair.primitive, poseAt(solid, solidSpin, s, ref));
		const gap = separation(shipAt, solidAt);
		if (gap.overlap || gap.distanceKm <= CONTACT_KM) return s;
		const bound = Math.max(0, -dot(translation, gap.normal)) + turning;
		if (!(bound > 0)) return null;
		s += (gap.distanceKm - ADVANCE_TARGET_KM) / bound / dt;
		if (s > 1) return null;
	}
	return s;
}

// ---------------------------------------------------------------------------
// 4. Ship against ship (C4b, node #664)
// ---------------------------------------------------------------------------

/** A ship across one step, as the pair resolver reads it: its motion and its
 *  mass, which the impulse is split by. */
export interface ShipMotion extends SolidMotion {
	massT: number;
}

/**
 * §3's ship-against-ship impulse (C4b): the change to each ship's velocity
 * that takes their relative normal velocity from `unBefore` to `unAfter`,
 * along `normal` (from B toward A), with momentum conserved — so it is split
 * by mass (derived). `J = (unAfter − unBefore) · mₐm_b / (mₐ + m_b)`; A gains
 * `J / mₐ` along the normal and B loses `J / m_b`. A courier that meets a
 * carrier moves; the carrier barely does.
 */
export function shipImpulse(
	normal: Vec3,
	unBefore: number,
	unAfter: number,
	massA: number,
	massB: number,
): { a: Vec3; b: Vec3 } {
	if (!(massA > 0) || !(massB > 0))
		throw new Error("a ship's mass is positive");
	const j = ((unAfter - unBefore) * massA * massB) / (massA + massB);
	return { a: scale(normal, j / massA), b: scale(normal, -j / massB) };
}

/** One meeting of two ships, as each lands it. */
export interface ShipPairImpact {
	/** Seconds into the step. A resting pair is met at 0. */
	timeS: number;
	/** Where they met, world coordinates. */
	point: Vec3;
	/** From B toward A. */
	normal: Vec3;
	/** §3's `v_n`: the closing speed of the two points, km/s. */
	closingKms: number;
	/** §3's damage, the same on each side (C4b). */
	damage: number;
	/** The side each ship is struck on, each by its own `sideStruck`. */
	sideA: ShieldSide;
	sideB: ShieldSide;
	resting: boolean;
	/** Which of each ship's primitives met the other (#956 Q4). */
	partA: ShipPart;
	partB: ShipPart;
}

export interface ShipPairResult {
	a: { pos: Vec3; vel: Vec3 };
	b: { pos: Vec3; vel: Vec3 };
	impacts: ShipPairImpact[];
	/** The two overlapped at the start, so were not tested (§4.3). */
	ghost: boolean;
}

/**
 * One step of two ships against each other (§3, C4b): A's box swept against
 * B's along both their motions, exactly as `sweepShip` sweeps a ship against
 * any solid, and then the meeting landed on both.
 *
 * - **The same damage on each side**, each on the side its own `sideStruck`
 *   gives it from where it was met.
 * - **The impulse is computed, not re-split.** `sweepShip`'s own bounce treats
 *   the met solid as immovable and carries the ship with the solid's own
 *   acceleration for the rest of the step — for a ship, the other ship's
 *   thrust — so its velocity is not the one a two-body bounce leaves. Each
 *   ship keeps the velocity its own step gave it, and `shipImpulse` takes the
 *   pair's relative normal velocity to `RESTITUTION · v_n` separating, with
 *   momentum conserved. A resting pair closing at or under `V_SCRAPE_KMS`
 *   only stops closing, as §3.1 has a resting ship stop.
 * - **The separation is split by mass as well.** `sweepShip` leaves A outside
 *   B's end pose; that correction is shared in the impulse's proportions, so
 *   the two still end the step apart by the same gap and a carrier is not
 *   shoved aside by a courier's step.
 * - **A resting pair is held apart even when nothing is billed.** Two ships
 *   touching at rest that thrust together close at zero at the start of the
 *   step, so §3.1 bills nothing — but `sweepShip` still holds A at the
 *   surface and takes the inward part off its velocity. Both corrections are
 *   split by mass, momentum kept, so the pair ends touching and not closing
 *   rather than overlapped, which the next step would read as a ghost.
 * - **`options.bProjected`**: B is a carrier on its projection (§6), a pose
 *   only a billed meeting can move, because a meeting hands it to flight. A
 *   hold with nothing billed is then put wholly on A, the one ship there is
 *   to move; a billed meeting splits as above.
 */
export function sweepShipPair(
	a: ShipMotion,
	b: ShipMotion,
	dt: number,
	options: { bProjected?: boolean } = {},
): ShipPairResult {
	const { result: swept, surfaces } = sweepMotion(a, [b], dt, {}, true);
	const result: ShipPairResult = {
		a: { pos: a.end.origin, vel: a.velEnd },
		b: { pos: b.end.origin, vel: b.velEnd },
		impacts: [],
		ghost: swept.ghosts.length > 0,
	};
	if (result.ghost) return result;
	const billed = swept.impacts.length > 0;
	/** A's share of what `sweepShip` did to A against an immovable B. */
	const shareA =
		options.bProjected && !billed ? 1 : b.massT / (a.massT + b.massT);
	const correction = sub(swept.pos, a.end.origin);
	result.a.pos = add(a.end.origin, scale(correction, shareA));
	result.b.pos = sub(b.end.origin, scale(correction, 1 - shareA));
	if (!billed) {
		// Resting, nothing billed: the hold's velocity change, split the way
		// the separation is, so momentum is kept.
		const dv = sub(swept.vel, a.velEnd);
		result.a.vel = add(a.velEnd, scale(dv, shareA));
		result.b.vel = sub(b.velEnd, scale(dv, 1 - shareA));
		return result;
	}
	// Each ship's turn across the step, as its box was swept turning
	// (`sweepShip`).
	const aSpin = spinBetween(a.start, a.end);
	const bSpin = spinBetween(b.start, b.end);
	for (const [k, impact] of swept.impacts.entries()) {
		const n = impact.normal;
		// Each pose at the meeting, on the arc its box was swept along: a chord
		// between its two end noses lags a fast turn by tens of degrees.
		const s = dt > 0 ? impact.timeS / dt : 0;
		const aAt = poseAt(a, aSpin, s, v3());
		const bAt = poseAt(b, bSpin, s, v3());
		// What the two turns add to the points' relative normal velocity. A
		// swept `closingKms` is measured on the points, turns included, so the
		// impulse must take the points to it; a resting one keeps both ships'
		// own-turn exemption (§3.1), and so does this. The impulse is linear
		// only (§3), so the turns' share is the same after it as before.
		const turns = impact.resting
			? 0
			: dot(
					sub(
						turnVelocity(aSpin, dt, aAt, impact.point),
						turnVelocity(bSpin, dt, bAt, impact.point),
					),
					n,
				);
		const unBefore = dot(sub(result.a.vel, result.b.vel), n) + turns;
		const unAfter =
			impact.resting && impact.closingKms <= V_SCRAPE_KMS
				? Math.max(unBefore, 0)
				: Math.max(unBefore, RESTITUTION * impact.closingKms);
		if (unAfter > unBefore) {
			const kick = shipImpulse(n, unBefore, unAfter, a.massT, b.massT);
			result.a.vel = add(result.a.vel, kick.a);
			result.b.vel = add(result.b.vel, kick.b);
		}
		result.impacts.push({
			timeS: impact.timeS,
			point: impact.point,
			normal: n,
			closingKms: impact.closingKms,
			damage: impact.damage,
			sideA: impact.side,
			sideB: sideStruck(bAt.z, sub(impact.point, bAt.origin)),
			resting: impact.resting,
			partA: impact.part,
			partB: partOf(surfaces[k]),
		});
	}
	return result;
}
