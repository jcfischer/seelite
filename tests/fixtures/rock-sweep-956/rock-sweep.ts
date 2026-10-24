// https://github.com/jcfischer/seelite/tree/71033d016f079bc79603c7cd66290b35a6f68800/spikes/asteroid-sweep-956

import {
	add,
	dot,
	length,
	rotateAbout,
	scale,
	sub,
	v3,
	type Vec3,
} from "../../../src/vec3";
import {
	type Pose,
	type Primitive,
	spinBetween,
	type Spin,
} from "../../../src/collision";
import { type Placed, placeBox, separation } from "./gjk";
import type { BoundNode, RockPieces } from "./pieces";

export type BoxPrim = Primitive & { kind: "box" };
export interface ShipStep {
	prims: readonly BoxPrim[];
	start: Pose;
	end: Pose;
}
export interface SweepConfig {
	dt: number;

	contact: number;

	target: number;

	restingGap: number;
	ghost: "rock" | "piece";
	maxAdvances: number;

	arcSagitta: number;
}
export interface RockSweepResult {
	kind: "clear" | "impact" | "ghost";

	s: number;
	piece: number;

	prim: number;
	normal: Vec3 | null;
	ghostPieces: number;
	restingPieces: number;

	advances: number;
	capped: boolean;
}

const lerp = (a: Vec3, b: Vec3, s: number): Vec3 => add(a, scale(sub(b, a), s));
function poseAt(start: Pose, end: Pose, spin: Spin, s: number): Pose {
	const origin = lerp(start.origin, end.origin, s);
	if (spin.angle === 0) return { ...start, origin };
	const a = spin.angle * s;
	return {
		origin,
		x: rotateAbout(start.x, spin.axis, a),
		y: rotateAbout(start.y, spin.axis, a),
		z: rotateAbout(start.z, spin.axis, a),
	};
}
const reachOf = (p: BoxPrim) =>
	length(p.centre) + Math.hypot(p.half[0], p.half[1], p.half[2]);

export function sweepRock(
	ship: ShipStep,
	rock: RockPieces,
	cfg: SweepConfig,
): RockSweepResult {
	const spin = spinBetween(ship.start, ship.end);
	const translation = scale(
		sub(ship.end.origin, ship.start.origin),
		1 / cfg.dt,
	);
	const out: RockSweepResult = {
		kind: "clear",
		s: 1,
		piece: -1,
		prim: -1,
		normal: null,
		ghostPieces: 0,
		restingPieces: 0,
		advances: 0,
		capped: false,
	};

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
	if (BEST_FIRST)
		return bestFirst(ship, rock, cfg, spin, translation, skip, out);
	ship.prims.forEach((prim, pi) => {
		const turning = (spin.angle / cfg.dt) * reachOf(prim);

		const advance = (
			hull: Placed,
			s0: number,
			limit: number,
		): { s: number; normal: Vec3 | null } | null => {
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

export let BEST_FIRST = true;
export const setBestFirst = (on: boolean) => {
	BEST_FIRST = on;
};

function bestFirst(
	ship: ShipStep,
	rock: RockPieces,
	cfg: SweepConfig,
	spin: Spin,
	translation: Vec3,
	skip: Set<number>,
	out: RockSweepResult,
): RockSweepResult {
	const contact = cfg.contact + cfg.arcSagitta;
	type Item = { s: number; n: BoundNode; prim: number; normal: Vec3 | null };
	const heap: Item[] = [];
	const push = (it: Item) => {
		heap.push(it);
		let i = heap.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (heap[p].s <= heap[i].s) break;
			[heap[p], heap[i]] = [heap[i], heap[p]];
			i = p;
		}
	};
	const pop = (): Item => {
		const top = heap[0],
			last = heap.pop() as Item;
		if (heap.length) {
			heap[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1,
					r = l + 1;
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
	const advance = (
		pi: number,
		hull: Placed,
		s0: number,
	): { s: number; normal: Vec3 | null } | null => {
		const prim = ship.prims[pi];
		let s = s0;
		for (let i = 0; i < cfg.maxAdvances; i++) {
			out.advances++;
			const g = separation(
				placeBox(prim, poseAt(ship.start, ship.end, spin, s)),
				hull,
			);
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
	ship.prims.forEach((_, pi) => {
		for (const r of rock.roots) offer(pi, r, 0);
	});
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

export function sweepRockFlat(
	ship: ShipStep,
	rock: RockPieces,
	cfg: SweepConfig,
): RockSweepResult {
	const flat: RockPieces = {
		...rock,
		roots: rock.pieces.map((hull, piece) => ({ hull, piece, children: [] })),
	};
	return sweepRock(ship, flat, cfg);
}

export function firstOverlap(
	ship: ShipStep,
	rock: RockPieces,
	n: number,
): number | null {
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
				if (nd.piece >= 0) {
					hit = true;
					return;
				}
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
