/**
 * Node #956 prototype: a ship's primitives (hull box, deployed cutter box)
 * swept against a rock's pieces (`pieces.ts`) in the rock's own frame.
 * Unit-bound space: every length is a fraction of the rock's bound radius R.
 * Not production.
 *
 * **The bound (§4.1, #75).** Conservative advancement per convex pair, exactly
 * `collision.ts` `advance`: at the nearest points the plane normal to `n`
 * separates the two by the gap, and neither crosses it faster than the
 * relative translation along `n` plus the ship's turn at its reach. That is
 * a bound per convex pair, never for a union, so it is run on the quadtree:
 * a node's bound is convex and holds every piece below it, so the time it is
 * first met is never later than any of its pieces'. The sweep advances on a
 * node until it is met, then advances each child from that time, and keeps
 * the earliest leaf. No piece is skipped that the bound could not exclude.
 *
 * **The rock frame.** The caller hands both ends of the ship's pose in the
 * rock's frame at `t` and `t + dt` (#949 D4, #43); the ship's path between
 * them is the straight chord, and the true relative path is an arc of the
 * rock's spin. `arcSagitta` is that error at the ship's distance, added to the
 * contact gap.
 *
 * **Start of the step (§4.3, §3.1).** A piece overlapping the ship at the
 * start is a ghost. `ghost: "rock"` ghosts the whole rock (the proposal);
 * `ghost: "piece"` ghosts only the overlapping pieces, as `classifyPairs` does
 * for a station's proxy, which row G1 shows traps a ship inside. A piece within
 * `restingGap` is resting and is not swept.
 */
import { add, dot, length, rotateAbout, scale, sub, v3, type Vec3 } from "../../src/vec3";
import { type Pose, type Primitive, spinBetween, type Spin } from "../../src/collision";
import { type Placed, placeBox, separation } from "./gjk";
import type { BoundNode, RockPieces } from "./pieces";

export type BoxPrim = Primitive & { kind: "box" };
export interface ShipStep {
	/** In the ship's frame, unit space. Index 0 is the hull box. */
	prims: readonly BoxPrim[];
	start: Pose;
	end: Pose;
}
export interface SweepConfig {
	dt: number;
	/** Declared gap at or under which the pair has met (unit space). */
	contact: number;
	/** Each advance aims to leave this much gap. */
	target: number;
	/** A pair this close at the start is resting. */
	restingGap: number;
	ghost: "rock" | "piece";
	maxAdvances: number;
	/** Extra contact gap for the rock-spin chord (unit space). */
	arcSagitta: number;
}
export interface RockSweepResult {
	kind: "clear" | "impact" | "ghost";
	/** Fraction of the step at first contact. */
	s: number;
	piece: number;
	/** Which ship primitive met the rock: 0 hull, 1 cutter. */
	prim: number;
	normal: Vec3 | null;
	ghostPieces: number;
	restingPieces: number;
	/** Advances taken over every pair, and whether a pair ran out of them. */
	advances: number;
	capped: boolean;
}

const lerp = (a: Vec3, b: Vec3, s: number): Vec3 => add(a, scale(sub(b, a), s));
function poseAt(start: Pose, end: Pose, spin: Spin, s: number): Pose {
	const origin = lerp(start.origin, end.origin, s);
	if (spin.angle === 0) return { ...start, origin };
	const a = spin.angle * s;
	return { origin, x: rotateAbout(start.x, spin.axis, a), y: rotateAbout(start.y, spin.axis, a), z: rotateAbout(start.z, spin.axis, a) };
}
const reachOf = (p: BoxPrim) => length(p.centre) + Math.hypot(p.half[0], p.half[1], p.half[2]);

export function sweepRock(ship: ShipStep, rock: RockPieces, cfg: SweepConfig): RockSweepResult {
	const spin = spinBetween(ship.start, ship.end);
	const translation = scale(sub(ship.end.origin, ship.start.origin), 1 / cfg.dt);
	const out: RockSweepResult = { kind: "clear", s: 1, piece: -1, prim: -1, normal: null, ghostPieces: 0, restingPieces: 0, advances: 0, capped: false };

	// §4.3 / §3.1 at s = 0: which pieces overlap (ghost) or rest against the ship.
	const skip = new Set<number>();
	ship.prims.forEach((prim) => {
		const at = placeBox(prim, ship.start);
		const visit = (n: BoundNode) => {
			const g = separation(at, n.hull);
			if (!g.overlap && g.distanceKm > cfg.restingGap) return;
			if (n.piece >= 0) {
				if (g.overlap) out.ghostPieces++;
				else out.restingPieces++;
				skip.add(n.piece);
				return;
			}
			for (const c of n.children) visit(c);
		};
		for (const r of rock.roots) visit(r);
	});
	if (out.ghostPieces > 0 && cfg.ghost === "rock") {
		out.kind = "ghost";
		return out;
	}

	const contact = cfg.contact + cfg.arcSagitta;
	if (BEST_FIRST) return bestFirst(ship, rock, cfg, spin, translation, skip, out);
	ship.prims.forEach((prim, pi) => {
		const turning = (spin.angle / cfg.dt) * reachOf(prim);
		/** Advance on one convex bound from `s0`; the time it is met, or null if not before `limit`. */
		const advance = (hull: Placed, s0: number, limit: number): { s: number; normal: Vec3 | null } | null => {
			let s = s0;
			for (let i = 0; i < cfg.maxAdvances; i++) {
				out.advances++;
				const at = placeBox(prim, poseAt(ship.start, ship.end, spin, s));
				const g = separation(at, hull);
				if (g.overlap) return { s, normal: null };
				if (g.distanceKm <= contact) return { s, normal: g.normal };
				const bound = Math.max(0, -dot(translation, g.normal)) + turning;
				if (!(bound > 0)) return null;
				s += (g.distanceKm - cfg.target) / bound / cfg.dt;
				if (s >= limit) return null;
			}
			out.capped = true;
			return { s, normal: null };
		};
		const descend = (n: BoundNode, s0: number) => {
			if (n.piece >= 0 && skip.has(n.piece)) return;
			const met = advance(n.hull, s0, out.s);
			if (!met) return;
			if (n.piece >= 0) {
				if (met.s < out.s || out.kind === "clear") {
					out.kind = "impact";
					out.s = met.s;
					out.piece = n.piece;
					out.prim = pi;
					out.normal = met.normal;
				}
				return;
			}
			for (const c of n.children) descend(c, met.s);
		};
		for (const r of rock.roots) descend(r, 0);
	});
	return out;
}

/** Bench switch: best-first descent (true) or depth-first in tile order. */
export let BEST_FIRST = true;
export const setBestFirst = (on: boolean) => { BEST_FIRST = on; };

/**
 * Best-first: a heap of (time a bound is met, bound, primitive). A child is
 * never met before its parent, so the first leaf popped is the earliest
 * contact over every piece and both primitives, and nothing met later is
 * expanded.
 */
function bestFirst(ship: ShipStep, rock: RockPieces, cfg: SweepConfig, spin: Spin, translation: Vec3, skip: Set<number>, out: RockSweepResult): RockSweepResult {
	const contact = cfg.contact + cfg.arcSagitta;
	type Item = { s: number; n: BoundNode; prim: number; normal: Vec3 | null };
	const heap: Item[] = [];
	const push = (it: Item) => {
		heap.push(it);
		let i = heap.length - 1;
		while (i > 0) { const p = (i - 1) >> 1; if (heap[p].s <= heap[i].s) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
	};
	const pop = (): Item => {
		const top = heap[0], last = heap.pop() as Item;
		if (heap.length) {
			heap[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1, r = l + 1;
				let m = i;
				if (l < heap.length && heap[l].s < heap[m].s) m = l;
				if (r < heap.length && heap[r].s < heap[m].s) m = r;
				if (m === i) break;
				[heap[m], heap[i]] = [heap[i], heap[m]];
				i = m;
			}
		}
		return top;
	};
	const turning = ship.prims.map((p) => (spin.angle / cfg.dt) * reachOf(p));
	const advance = (pi: number, hull: Placed, s0: number): { s: number; normal: Vec3 | null } | null => {
		const prim = ship.prims[pi];
		let s = s0;
		for (let i = 0; i < cfg.maxAdvances; i++) {
			out.advances++;
			const g = separation(placeBox(prim, poseAt(ship.start, ship.end, spin, s)), hull);
			if (g.overlap) return { s, normal: null };
			if (g.distanceKm <= contact) return { s, normal: g.normal };
			const bound = Math.max(0, -dot(translation, g.normal)) + turning[pi];
			if (!(bound > 0)) return null;
			s += (g.distanceKm - cfg.target) / bound / cfg.dt;
			if (s >= 1) return null;
		}
		out.capped = true;
		return { s, normal: null };
	};
	const offer = (pi: number, n: BoundNode, s0: number) => {
		if (n.piece >= 0 && skip.has(n.piece)) return;
		const met = advance(pi, n.hull, s0);
		if (met) push({ s: met.s, n, prim: pi, normal: met.normal });
	};
	ship.prims.forEach((_, pi) => { for (const r of rock.roots) offer(pi, r, 0); });
	while (heap.length) {
		const it = pop();
		if (it.n.piece >= 0) {
			out.kind = "impact";
			out.s = it.s;
			out.piece = it.n.piece;
			out.prim = it.prim;
			out.normal = it.normal;
			return out;
		}
		for (const c of it.n.children) offer(it.prim, c, it.s);
	}
	return out;
}

/**
 * The flat arm: every piece advanced on its own, no quadtree. The same bound,
 * so the same answer; it is here for the cost comparison and as a check that
 * the quadtree skips nothing.
 */
export function sweepRockFlat(ship: ShipStep, rock: RockPieces, cfg: SweepConfig): RockSweepResult {
	const flat: RockPieces = { ...rock, roots: rock.pieces.map((hull, piece) => ({ hull, piece, children: [] })) };
	return sweepRock(ship, flat, cfg);
}

/**
 * The reference: the step cut into `n` equal sub-steps, each a point-in-volume
 * test of every primitive against every piece. Not a sweep — it is what a
 * sweep must never be later than, up to one sub-step.
 */
export function firstOverlap(ship: ShipStep, rock: RockPieces, n: number): number | null {
	const spin = spinBetween(ship.start, ship.end);
	for (let k = 0; k <= n; k++) {
		const s = k / n;
		const pose = poseAt(ship.start, ship.end, spin, s);
		for (const prim of ship.prims) {
			const at = placeBox(prim, pose);
			let hit = false;
			const visit = (nd: BoundNode) => {
				if (hit) return;
				const g = separation(at, nd.hull);
				if (!g.overlap) return;
				if (nd.piece >= 0) { hit = true; return; }
				for (const c of nd.children) visit(c);
			};
			for (const r of rock.roots) visit(r);
			if (hit) return s;
		}
	}
	return null;
}

export const shipPoseAt = poseAt;
export { v3 };
