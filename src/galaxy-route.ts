/**
 * Reachability, route planning and the set course — the arithmetic behind the
 * galaxy map (#11).
 *
 * Split from the map's rendering for the reason `market.ts` was split from its
 * measurement surface (#25): a chart is judged by flying it, and nothing about
 * a chain of jumps needs a camera to be checked. Everything here is a pure
 * function of a galaxy's system records, so `tests/galaxy-route.test.ts` can
 * enumerate the answers by brute force on small graphs and compare.
 *
 * It imports no Three.js, and it must not: the map draws what this computes,
 * never the other way round.
 */

import {
	JUMP_RANGE_LY,
	type SystemRecord,
	distanceLy,
	jumpCost,
	neighbours,
} from "./galaxy";

/**
 * Systems one jump from `from`, nearest first — the lit points inside the
 * map's 7 LY shell.
 *
 * A thin scope over `neighbours`, and the scope is the point. `neighbours`
 * takes identity as `(galaxy, index)` precisely so a caller *may* hold two
 * galaxies in one array; the map may not. D6 draws the current galaxy and
 * nothing else, so a system from another one is not a distant neighbour, it is
 * not on this chart at all.
 */
export function reachable(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): SystemRecord[] {
	return neighbours(
		systems.filter((s) => s.galaxy === from.galaxy),
		from,
		maxJump,
	);
}

/** One leg of a route: where it lands, how far, and what the fuel costs. */
export interface RouteHop {
	system: SystemRecord;
	ly: number;
	costCr: number;
}

/**
 * A planned chain. `hops` excludes the origin and ends at the destination, so
 * `hops.length === jumps` and a zero-jump route to the current system has
 * neither.
 */
export interface Route {
	from: SystemRecord;
	to: SystemRecord;
	hops: RouteHop[];
	jumps: number;
	totalLy: number;
	totalCr: number;
}

/** Distances differ in the last bits depending on the order they were summed,
 *  so the tie-break needs a tolerance or it becomes a coin toss on rounding. */
const LY_EPSILON = 1e-9;

/**
 * The cheapest chain from `from` to `to`, or `null` if there is none.
 *
 * **The objective is fewest jumps, then shortest total distance.** Not shortest
 * distance alone: a jump is a wind-up with a vulnerability window
 * (`galaxy-generation.md` §8) and an arrival 1 AU out that has to be crossed
 * (§7.4), so an extra hop costs the player far more than the ~2 Cr of fuel that
 * separates two equal-length chains. Fuel is the tie-break, not the goal.
 *
 * Lexicographic Dijkstra over `(jumps, ly)`. Both components are non-negative
 * and monotone along a path, which is the whole requirement — the ordering is a
 * different one from the usual scalar, not a weaker one. Selection is a linear
 * scan rather than a heap: 256 systems makes the scan cheaper than maintaining
 * the structure, the same trade `isConnected` makes one module over.
 */
export function planRoute(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	to: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): Route | null {
	if (from.galaxy !== to.galaxy) return null;

	const pool = systems.filter((s) => s.galaxy === from.galaxy);
	const n = pool.length;
	const slot = new Map<number, number>();
	for (let i = 0; i < n; i++) slot.set(pool[i].index, i);

	const start = slot.get(from.index);
	const goal = slot.get(to.index);
	if (start === undefined || goal === undefined) return null;

	if (start === goal) {
		return { from, to, hops: [], jumps: 0, totalLy: 0, totalCr: 0 };
	}

	// `0x7fffffff` and not `Number.MAX_SAFE_INTEGER`: the latter does not fit an
	// `Int32Array` and stores as −1, which makes every relaxation test read
	// `1 < -1` and the planner return `null` for every reachable pair. It failed
	// twelve tests in one run and would have failed none of them silently.
	const UNREACHED = 0x7fffffff;
	const jumps = new Int32Array(n).fill(UNREACHED);
	const ly = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
	const prev = new Int32Array(n).fill(-1);
	const settled = new Uint8Array(n);
	jumps[start] = 0;
	ly[start] = 0;

	const maxJumpSq = maxJump * maxJump;

	for (let step = 0; step < n; step++) {
		let u = -1;
		for (let i = 0; i < n; i++) {
			if (settled[i] || !Number.isFinite(ly[i])) continue;
			if (
				u === -1 ||
				jumps[i] < jumps[u] ||
				(jumps[i] === jumps[u] && ly[i] < ly[u])
			) {
				u = i;
			}
		}
		// Nothing reachable is left unsettled: the rest of the pool is in
		// another component, which for a §5-connected layout cannot happen —
		// but this module is also handed hand-built graphs where it can.
		if (u === -1) break;
		if (u === goal) break;
		settled[u] = 1;

		for (let v = 0; v < n; v++) {
			if (settled[v] || v === u) continue;
			const dx = pool[u].pos.x - pool[v].pos.x;
			const dy = pool[u].pos.y - pool[v].pos.y;
			const dz = pool[u].pos.z - pool[v].pos.z;
			const dSq = dx * dx + dy * dy + dz * dz;
			if (dSq > maxJumpSq) continue;
			const candJumps = jumps[u] + 1;
			const candLy = ly[u] + Math.sqrt(dSq);
			if (
				candJumps < jumps[v] ||
				(candJumps === jumps[v] && candLy < ly[v] - LY_EPSILON)
			) {
				jumps[v] = candJumps;
				ly[v] = candLy;
				prev[v] = u;
			}
		}
	}

	if (!Number.isFinite(ly[goal])) return null;

	const chain: number[] = [];
	for (let at = goal; at !== -1 && at !== start; at = prev[at]) chain.push(at);
	chain.reverse();

	const hops: RouteHop[] = [];
	let at = pool[start];
	let totalLy = 0;
	for (const step of chain) {
		const next = pool[step];
		// Re-measured from the positions rather than differenced out of the
		// accumulator: a hop's own distance is what the panel prints, and a
		// subtraction of two f64 sums is not that number.
		const d = distanceLy(at.pos, next.pos);
		hops.push({ system: next, ly: d, costCr: jumpCost(d) });
		totalLy += d;
		at = next;
	}

	return {
		from,
		to,
		hops,
		jumps: hops.length,
		totalLy,
		totalCr: jumpCost(totalLy),
	};
}

/**
 * The saved course. Bumped when its shape changes, per
 * `persistent-world-state.md` §2's version discipline.
 */
export const COURSE_SCHEMA_VERSION = 1;

/**
 * A committed destination — and deliberately nothing else.
 *
 * **The chain is derived, never stored.** `persistent-world-state.md` §8 says
 * map presentation is a projection of generated facts and is not persisted for
 * being derivable, and a route is exactly that: `planRoute` recovers it from
 * the world seed, the galaxy index and where the ship is. Storing it would also
 * make it wrong the first time the player jumps somewhere that is not on it —
 * a saved plan describes a position the ship has left, while a saved
 * *destination* is still true from wherever it ends up.
 */
export interface Course {
	version: number;
	galaxy: number;
	destinationIndex: number;
}

/** Where a course stands from the ship's current system. */
export interface CourseProgress {
	route: Route;
	/** The next system to jump to, or `null` on arrival. */
	nextHop: RouteHop | null;
	/** Jumps left from here — re-derived, so an off-plan jump is not an error
	 *  state but simply a different remainder. */
	remaining: number;
	arrived: boolean;
}

/**
 * Commit to a destination, or refuse.
 *
 * Refusing on an unroutable destination is what keeps the panel honest: a
 * §5-connected layout means this can only fire on a graph the generator did
 * not produce, and if it ever does, the map must not display a course it
 * cannot complete.
 */
export function setCourse(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	to: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): Course | null {
	if (planRoute(systems, from, to, maxJump) === null) return null;
	return {
		version: COURSE_SCHEMA_VERSION,
		galaxy: to.galaxy,
		destinationIndex: to.index,
	};
}

/**
 * Re-derive the course from where the ship actually is.
 *
 * Called after every jump, and after a load. It takes `current` rather than
 * remembering a cursor into a stored chain, which is what makes an off-plan
 * jump a re-plan instead of a desync.
 */
export function courseProgress(
	systems: readonly SystemRecord[],
	course: Course,
	current: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): CourseProgress | null {
	if (current.galaxy !== course.galaxy) return null;
	const to = systems.find(
		(s) => s.galaxy === course.galaxy && s.index === course.destinationIndex,
	);
	if (to === undefined) return null;
	const route = planRoute(systems, current, to, maxJump);
	if (route === null) return null;
	return {
		route,
		nextHop: route.hops[0] ?? null,
		remaining: route.jumps,
		arrived: route.jumps === 0,
	};
}

/** The course as it goes into a galaxy's persistence envelope (§7). */
export const serialiseCourse = (course: Course): string =>
	JSON.stringify(course);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const isIndex = (v: unknown, hi: number): v is number =>
	typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= hi;

/**
 * Read a course out of a save, or throw.
 *
 * Absence is a valid state — no course is not a corrupt course — so `null` and
 * `undefined` return `null`. Everything else is checked rather than cast, and
 * a failure throws: `persistent-world-state.md` §7 requires a truncated or
 * partially written snapshot to fail loudly rather than be reinterpreted as an
 * untouched healthy value, and silently dropping an unreadable course is
 * exactly that reinterpretation.
 *
 * `envelopeGalaxy` is the galaxy whose envelope this course was filed under.
 * §7 makes the match mandatory: an embedded index that disagrees with its
 * container is a corrupted save, not a course in another galaxy.
 */
export function parseCourse(
	raw: unknown,
	envelopeGalaxy: number,
): Course | null {
	if (raw === null || raw === undefined) return null;
	if (!isPlainObject(raw)) {
		throw new Error(`course: expected an object, got ${typeof raw}`);
	}
	if (raw.version !== COURSE_SCHEMA_VERSION) {
		throw new Error(
			`course: unsupported schema version ${String(raw.version)}, expected ${COURSE_SCHEMA_VERSION}`,
		);
	}
	if (!isIndex(raw.galaxy, 7)) {
		throw new Error(`course: galaxy ${String(raw.galaxy)} is not 0..7`);
	}
	if (raw.galaxy !== envelopeGalaxy) {
		throw new Error(
			`course: galaxy ${raw.galaxy} does not match its envelope ${envelopeGalaxy}`,
		);
	}
	if (!isIndex(raw.destinationIndex, 255)) {
		throw new Error(
			`course: destinationIndex ${String(raw.destinationIndex)} is not 0..255`,
		);
	}
	return {
		version: COURSE_SCHEMA_VERSION,
		galaxy: raw.galaxy,
		destinationIndex: raw.destinationIndex,
	};
}
