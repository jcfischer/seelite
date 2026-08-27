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
	GALAXY_COUNT,
	JUMP_RANGE_LY,
	SYSTEMS_PER_GALAXY,
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
/**
 * One galaxy's jump graph, built once.
 *
 * Every call used to filter the pool, rebuild the index map and rescan all
 * 65,536 pairs — and a caller asking for a route to each of 256 systems in turn
 * (the map's own workbench does exactly that) paid for the same adjacency 256
 * times. The neighbour list is a function of the positions and the range, and
 * generated records do not move, so it is memoised on the identity of the array
 * it was built from.
 *
 * **It changes when work happens, never what is returned.** A different array,
 * galaxy or range is a different entry; nothing here is keyed on the search.
 */
interface JumpGraph {
	pool: SystemRecord[];
	slot: Map<number, number>;
	/** `neighbours[i]` — pool positions within `maxJump` of `i`. */
	neighbourOf: number[][];
	/** Matching distances, so the relaxation never recomputes a square root. */
	distanceOf: number[][];
}

const graphCache = new WeakMap<
	readonly SystemRecord[],
	Map<string, JumpGraph>
>();

function jumpGraph(
	systems: readonly SystemRecord[],
	galaxy: number,
	maxJump: number,
): JumpGraph {
	let perArray = graphCache.get(systems);
	if (perArray === undefined) {
		perArray = new Map();
		graphCache.set(systems, perArray);
	}
	const key = `${galaxy}:${maxJump}`;
	const cached = perArray.get(key);
	if (cached !== undefined) return cached;

	const pool = systems.filter((s) => s.galaxy === galaxy);
	const n = pool.length;
	const slot = new Map<number, number>();
	for (let i = 0; i < n; i++) slot.set(pool[i].index, i);

	const neighbourOf: number[][] = Array.from({ length: n }, () => []);
	const distanceOf: number[][] = Array.from({ length: n }, () => []);
	const maxJumpSq = maxJump * maxJump;
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const dx = pool[i].pos.x - pool[j].pos.x;
			const dy = pool[i].pos.y - pool[j].pos.y;
			const dz = pool[i].pos.z - pool[j].pos.z;
			const dSq = dx * dx + dy * dy + dz * dz;
			if (dSq > maxJumpSq) continue;
			const d = Math.sqrt(dSq);
			neighbourOf[i].push(j);
			distanceOf[i].push(d);
			neighbourOf[j].push(i);
			distanceOf[j].push(d);
		}
	}

	const graph = { pool, slot, neighbourOf, distanceOf };
	perArray.set(key, graph);
	return graph;
}

export function planRoute(
	systems: readonly SystemRecord[],
	from: SystemRecord,
	to: SystemRecord,
	maxJump = JUMP_RANGE_LY,
): Route | null {
	if (from.galaxy !== to.galaxy) return null;

	const { pool, slot, neighbourOf, distanceOf } = jumpGraph(
		systems,
		from.galaxy,
		maxJump,
	);
	const n = pool.length;

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

		const adjacent = neighbourOf[u];
		const spans = distanceOf[u];
		for (let k = 0; k < adjacent.length; k++) {
			const v = adjacent[k];
			if (settled[v]) continue;
			const candJumps = jumps[u] + 1;
			const candLy = ly[u] + spans[k];
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
	// **Accepts its own serialised form.** `serialiseCourse` returns a JSON
	// string, and a pair whose output the input rejects is a foot-gun for #46 —
	// the caller had to write `parseCourse(JSON.parse(serialiseCourse(c)), g)`.
	// A malformed string throws here rather than falling through to the
	// object check, so a truncated save still fails loudly.
	//
	// **Decoded at most once, deliberately.** Recursing into `parseCourse` was
	// the first shape of this and it accepted arbitrarily double-encoded JSON —
	// `JSON.stringify(serialiseCourse(c))` came back a healthy course and
	// `'"null"'` came back as absence, which is the precise reinterpretation the
	// paragraph above forbids. The decoded value falls through to the object
	// checks instead.
	let value: unknown = raw;
	if (typeof value === "string") {
		try {
			value = JSON.parse(value);
		} catch (cause) {
			throw new Error("course: unreadable JSON", { cause });
		}
		if (value === null) {
			throw new Error("course: JSON null is not an absent course");
		}
	}
	if (!isPlainObject(value)) {
		throw new Error(`course: expected an object, got ${typeof value}`);
	}
	if (value.version !== COURSE_SCHEMA_VERSION) {
		throw new Error(
			`course: unsupported schema version ${String(value.version)}, expected ${COURSE_SCHEMA_VERSION}`,
		);
	}
	// Bounds derived, not restated. As literal `7` and `255` these went stale
	// the moment `GALAXY_COUNT` or `SYSTEMS_PER_GALAXY` moved, and a validator
	// that silently accepts an out-of-range save is worse than none.
	if (!isIndex(value.galaxy, GALAXY_COUNT - 1)) {
		throw new Error(
			`course: galaxy ${String(value.galaxy)} is not 0..${GALAXY_COUNT - 1}`,
		);
	}
	if (value.galaxy !== envelopeGalaxy) {
		throw new Error(
			`course: galaxy ${value.galaxy} does not match its envelope ${envelopeGalaxy}`,
		);
	}
	if (!isIndex(value.destinationIndex, SYSTEMS_PER_GALAXY - 1)) {
		throw new Error(
			`course: destinationIndex ${String(value.destinationIndex)} is not 0..${SYSTEMS_PER_GALAXY - 1}`,
		);
	}
	return {
		version: COURSE_SCHEMA_VERSION,
		galaxy: value.galaxy,
		destinationIndex: value.destinationIndex,
	};
}
