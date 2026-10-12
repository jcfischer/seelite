/**
 * A uniform grid over bounding spheres, for a solid with hundreds or
 * thousands of primitives (the authored shipyards' proxies, node #818: 483 to
 * 2,806 boxes a list under the principal's 10 m collision rule).
 *
 * Every sphere is entered in each cell its bounding box touches; one larger
 * than `LARGE_CELLS` cells across is kept apart and always returned. A query
 * names a box and returns every sphere that may touch it, each once: a
 * superset, so a caller keeps its exact test and only skips the far ones.
 *
 * Pure arithmetic, no imports: `sim.ts` and `collision.ts` reach it, and both
 * are headless.
 */
/** A primitive list longer than this is searched through a grid: the
 *  authored shipyards' 490 to 2,800 boxes a list (node #818). Every other
 *  proxy is tens of primitives and stays a plain walk — refinery/a's 66, big
 *  rock spheres among them, took 27 s through the grid in the vertex row and
 *  0.4 s without it. One figure for the sweep (`collision.ts`) and the
 *  proxy queries (`station-proxy.ts`). */
export const INDEXED_ABOVE = 128;
/** The grid's cell, kilometres. */
export const INDEX_CELL_KM = 0.05;

export interface Sphere {
	x: number;
	y: number;
	z: number;
	r: number;
}

export interface SphereGrid {
	readonly cell: number;
	readonly cells: Map<number, number[]>;
	/** Spheres too large to enter cell by cell; every query returns them. */
	readonly large: number[];
	/** One stamp per sphere, so a query returns each once. */
	readonly stamps: Uint32Array;
	stamp: number;
}

const SPAN = 2048;
const LARGE_CELLS = 8;
const key = (i: number, j: number, k: number) =>
	((i + SPAN / 2) * SPAN + (j + SPAN / 2)) * SPAN + (k + SPAN / 2);

export function buildSphereGrid(
	spheres: readonly Sphere[],
	cell: number,
): SphereGrid {
	const cells = new Map<number, number[]>();
	const large: number[] = [];
	spheres.forEach((s, n) => {
		if (s.r * 2 > cell * LARGE_CELLS) {
			large.push(n);
			return;
		}
		const lo = [s.x - s.r, s.y - s.r, s.z - s.r].map((v) =>
			Math.floor(v / cell),
		);
		const hi = [s.x + s.r, s.y + s.r, s.z + s.r].map((v) =>
			Math.floor(v / cell),
		);
		for (let i = lo[0]; i <= hi[0]; i++)
			for (let j = lo[1]; j <= hi[1]; j++)
				for (let k = lo[2]; k <= hi[2]; k++) {
					const at = key(i, j, k);
					const list = cells.get(at);
					if (list) list.push(n);
					else cells.set(at, [n]);
				}
	});
	return {
		cell,
		cells,
		large,
		stamps: new Uint32Array(spheres.length),
		stamp: 0,
	};
}

/** Every sphere that may touch the box `[min, max]`, each once, until
 *  `visit` returns `true`. */
export function querySphereGrid(
	grid: SphereGrid,
	minX: number,
	minY: number,
	minZ: number,
	maxX: number,
	maxY: number,
	maxZ: number,
	visit: (index: number) => boolean | void,
): void {
	const stamp = ++grid.stamp;
	if (stamp === 0xffffffff) {
		grid.stamps.fill(0);
		grid.stamp = 1;
	}
	const s = grid.stamp;
	for (const n of grid.large) if (visit(n)) return;
	const c = grid.cell;
	const i0 = Math.floor(minX / c);
	const i1 = Math.floor(maxX / c);
	const j0 = Math.floor(minY / c);
	const j1 = Math.floor(maxY / c);
	const k0 = Math.floor(minZ / c);
	const k1 = Math.floor(maxZ / c);
	// A query wider than the grid's own cells walks the cell list instead.
	if ((i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1) > grid.cells.size) {
		for (const [at, list] of grid.cells) {
			const k = (at % SPAN) - SPAN / 2;
			const rest = Math.floor(at / SPAN);
			const j = (rest % SPAN) - SPAN / 2;
			const i = Math.floor(rest / SPAN) - SPAN / 2;
			if (i < i0 || i > i1 || j < j0 || j > j1 || k < k0 || k > k1) continue;
			for (const n of list)
				if (grid.stamps[n] !== s) {
					grid.stamps[n] = s;
					if (visit(n)) return;
				}
		}
		return;
	}
	for (let i = i0; i <= i1; i++)
		for (let j = j0; j <= j1; j++)
			for (let k = k0; k <= k1; k++) {
				const list = grid.cells.get(key(i, j, k));
				if (!list) continue;
				for (const n of list)
					if (grid.stamps[n] !== s) {
						grid.stamps[n] = s;
						if (visit(n)) return;
					}
			}
}
