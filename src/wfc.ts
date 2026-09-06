/**
 * A simple-tiled wave function collapse solver, copied in from seekolous and
 * diverged (the map's reuse rule: copy in, never depend).
 *
 * seekolous solved village plans with it — `wfc.ts` there, #139/#154 — and
 * the shape it settled is kept whole: whole-grid, `Uint32` bitmask domains
 * (at most 32 modules), identity in three layers (mask, plant, weight),
 * integer-only determinism from an LCG stream with a popcount cell pick and
 * per-cell integer noise breaking ties, a fixed neighbour order and a LIFO
 * stack, a restart on contradiction from a derived sub-seed, and a template
 * fallback so the worst case is a boring result and never a missing one. The
 * orphan pass after a solve floods the mass from the planted cells and turns
 * anything the collapse grew unattached back into `orphanTo`.
 *
 * **The one divergence is directional adjacency.** A village's tiles are
 * isotropic — a wall is a wall on every side — and seekolous's table is one
 * `allowed[k]` for all four directions. A station's modules are not: a tube
 * that runs along X docks to its neighbours on ±X and shows a flank to ±Y, so
 * what may sit beside it depends on which side. `allowed` is therefore four
 * tables, one per direction, and `station-modular.ts` builds them from
 * per-axis pair rules so they stay symmetric — `allowed[+X][a]` holding `b`
 * exactly when `allowed[−X][b]` holds `a`, without which propagation
 * contradicts itself.
 *
 * No Three.js and no vocabulary here: this is the arithmetic, and it runs in
 * the headless tier where a contradiction or a broken symmetry is a failing
 * assertion. `mix` is `rng.ts`'s, which owns seed derivation for the game.
 */

import { mix } from "./rng";

/** The house LCG as an integer stream. */
export function makeRng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s;
	};
}

/**
 * Bits set in a 32-bit word.
 *
 * No trailing mask: the byte sum of a 32-bit word is at most 32, which fits in
 * the six bits `>> 24` leaves. seekolous records that one which truncated it
 * to five wrapped a full domain to zero, and the solver reads zero as a
 * contradiction.
 */
export function popcount(v: number): number {
	let x = v - ((v >> 1) & 0x55555555);
	x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
	return Math.imul((x + (x >> 4)) & 0x0f0f0f0f, 0x01010101) >> 24;
}

export const BIT = (m: number): number => 1 << m;

/** The four neighbour directions, in the order propagation visits them. */
export const DIRECTIONS = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
] as const;

/** The direction opposite to `dir`, as an index into `DIRECTIONS`. */
export const opposite = (dir: number) => dir ^ 1;

/** A cell the vocabulary decided for the solver rather than leaving to it. */
export interface Plant {
	i: number;
	m: number;
}

/**
 * Everything the solver needs to know about one problem. The vocabulary owns
 * what the modules *mean*; this is only their arithmetic.
 */
export interface WfcSpec {
	/** Number of module ids, 0..nModules-1. At most 32, so a domain is one Uint32. */
	nModules: number;
	/** Per direction: bit m of `allowed[d][k]` = m may sit in direction d of k. */
	allowed: readonly [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
	gw: number;
	gd: number;
	/** Domain mask for a cell the grammar did not plant, by cell index — so a
	 *  vocabulary can shape the field (a diamond, a ring) as well as its
	 *  border. */
	freeMask: (i: number) => number;
	/** Cells the grammar decided outright (identity layer 2). */
	plants: Plant[];
	/** Integer weight per module (identity layer 3). */
	weights: Uint32Array;
	/** True for modules that count as built mass, for the connectivity pass. */
	isMass: (m: number) => boolean;
	/** What an orphaned (disconnected) mass cell becomes. */
	orphanTo: number;
	/** What the template fallback fills every unplanted cell with. */
	fallbackFill: number;
}

export interface PlanResult {
	/** Module per cell; index = y * gw + x. */
	plan: Uint8Array;
	gw: number;
	gd: number;
	/** Solve attempts spent — 1 means no contradiction was hit. */
	attempts: number;
	/** True when every attempt contradicted and the template stood in. */
	fallback: boolean;
}

/** Restart budget before the template fallback takes over. */
const MAX_ATTEMPTS = 8;

/**
 * Collapse one grid. Deterministic in (seed, spec): every number here is an
 * integer operation on the seed, so the same inputs give the same plan byte
 * for byte on every client at every clock.
 */
export function solvePlan(seed: number, spec: WfcSpec): PlanResult {
	const { gw, gd, nModules } = spec;
	const cells = gw * gd;
	const domains = new Uint32Array(cells);
	const noise = new Uint32Array(cells);
	const stack = new Uint32Array(cells * 4);

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const rng = makeRng(mix(seed, attempt));
		for (let i = 0; i < cells; i++) noise[i] = rng();
		for (let i = 0; i < cells; i++) domains[i] = spec.freeMask(i) >>> 0;
		for (const p of spec.plants) domains[p.i] = BIT(p.m) >>> 0;

		// Propagate every already-decided cell to a fixed point.
		let top = 0;
		for (let i = 0; i < cells; i++)
			if (popcount(domains[i]) === 1) stack[top++] = i;
		let ok = propagate(domains, stack, top, spec);

		while (ok) {
			// The lowest-entropy cell, integer noise breaking the tie.
			let best = -1;
			let bestPop = 33;
			let bestNoise = 0;
			for (let i = 0; i < cells; i++) {
				const p = popcount(domains[i]);
				if (p < 2) continue;
				if (p < bestPop || (p === bestPop && noise[i] < bestNoise)) {
					best = i;
					bestPop = p;
					bestNoise = noise[i];
				}
			}
			if (best < 0) break; // fully collapsed

			// A weighted pick over the set bits, ascending, in integers.
			const dom = domains[best];
			let total = 0;
			for (let m = 0; m < nModules; m++)
				if (dom & BIT(m)) total += spec.weights[m];
			let chosen = -1;
			if (total === 0) {
				for (let m = 0; m < nModules; m++)
					if (dom & BIT(m)) {
						chosen = m;
						break;
					}
			} else {
				let roll = rng() % total;
				for (let m = 0; m < nModules; m++) {
					if (!(dom & BIT(m))) continue;
					if (roll < spec.weights[m]) {
						chosen = m;
						break;
					}
					roll -= spec.weights[m];
				}
			}
			domains[best] = BIT(chosen) >>> 0;
			stack[0] = best;
			ok = propagate(domains, stack, 1, spec);
		}

		if (ok) {
			const plan = new Uint8Array(cells);
			for (let i = 0; i < cells; i++) plan[i] = 31 - Math.clz32(domains[i]);
			pruneOrphanMass(plan, spec);
			return { plan, gw, gd, attempts: attempt + 1, fallback: false };
		}
	}

	// Capped out: the planted grammar plus a plain fill. A boring station.
	const plan = new Uint8Array(cells);
	for (let i = 0; i < cells; i++) plan[i] = spec.fallbackFill;
	for (const p of spec.plants) plan[p.i] = p.m;
	return { plan, gw, gd, attempts: MAX_ATTEMPTS, fallback: true };
}

/**
 * Fixed neighbour order −X, +X, −Y, +Y; LIFO stack. False on a contradiction
 * (a domain went empty).
 *
 * The support a neighbour in direction `d` may keep is the union, over every
 * module still possible here, of what that module allows in `d`.
 */
function propagate(
	domains: Uint32Array,
	stack: Uint32Array,
	top: number,
	spec: WfcSpec,
): boolean {
	const { gw, gd, nModules, allowed } = spec;
	while (top > 0) {
		const i = stack[--top];
		const x = i % gw;
		const y = (i / gw) | 0;
		const dom = domains[i];
		for (let dir = 0; dir < 4; dir++) {
			const nx = x + DIRECTIONS[dir][0];
			const ny = y + DIRECTIONS[dir][1];
			if (nx < 0 || ny < 0 || nx >= gw || ny >= gd) continue;
			let allow = 0;
			const table = allowed[dir];
			for (let m = 0; m < nModules; m++) if (dom & BIT(m)) allow |= table[m];
			const n = ny * gw + nx;
			// `>>> 0` on the result: `&` yields an int32, so a domain with bit 31
			// set would compare unequal to itself and re-push forever.
			const next = (domains[n] & allow) >>> 0;
			if (next === domains[n]) continue;
			if (next === 0) return false;
			domains[n] = next;
			stack[top++] = n;
		}
	}
	return true;
}

/**
 * Flood the mass from every planted mass cell; anything the collapse grew
 * that never touches the planted structure is an orphan and becomes
 * `orphanTo`. Residual failures fail cosmetically, never fatally.
 */
function pruneOrphanMass(plan: Uint8Array, spec: WfcSpec): void {
	const { gw, gd } = spec;
	const seen = new Uint8Array(plan.length);
	const queue = new Uint32Array(plan.length);
	let head = 0;
	let tail = 0;
	for (const p of spec.plants)
		if (spec.isMass(plan[p.i]) && !seen[p.i]) {
			seen[p.i] = 1;
			queue[tail++] = p.i;
		}
	if (tail === 0) return; // nothing planted is mass: no anchor, nothing orphaned
	while (head < tail) {
		const i = queue[head++];
		const x = i % gw;
		const y = (i / gw) | 0;
		for (const [dx, dy] of DIRECTIONS) {
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= gw || ny >= gd) continue;
			const n = ny * gw + nx;
			if (seen[n] || !spec.isMass(plan[n])) continue;
			seen[n] = 1;
			queue[tail++] = n;
		}
	}
	for (let i = 0; i < plan.length; i++)
		if (spec.isMass(plan[i]) && !seen[i]) plan[i] = spec.orphanTo;
}
