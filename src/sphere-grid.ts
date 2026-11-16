/**
 * A uniform grid over axis-aligned bounds, for a solid with hundreds or
 * thousands of primitives (the authored shipyards' proxies, node #818: 483 to
 * 2,806 boxes a list under the principal's 10 m collision rule).
 *
 * Every primitive is entered in each cell its bounds touch, which keeps a long
 * thin plate in the cells along it (node #1118); one spanning more cells than
 * any `LARGE_CELLS`-wide cube is kept apart and always returned. A query
 * names a box and returns every primitive whose bounds may touch it, each
 * once: a superset, so a caller keeps its exact test and only skips the far
 * ones.
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

/** An axis-aligned box, kilometres. */
export interface Bounds {
	minX: number;
	minY: number;
	minZ: number;
	maxX: number;
	maxY: number;
	maxZ: number;
}

/** The bounds of a box centred at `(cx, cy, cz)` with half-extents
 *  `hx, hy, hz` along `axes` (unit, orthogonal; absent is the frame's). */
export function boundsOfBox(
	cx: number,
	cy: number,
	cz: number,
	axes:
		| readonly [
				{ readonly x: number; readonly y: number; readonly z: number },
				{ readonly x: number; readonly y: number; readonly z: number },
				{ readonly x: number; readonly y: number; readonly z: number },
		  ]
		| undefined,
	hx: number,
	hy: number,
	hz: number,
): Bounds {
	let ex = hx;
	let ey = hy;
	let ez = hz;
	if (axes) {
		const [a, b, c] = axes;
		ex = Math.abs(a.x) * hx + Math.abs(b.x) * hy + Math.abs(c.x) * hz;
		ey = Math.abs(a.y) * hx + Math.abs(b.y) * hy + Math.abs(c.y) * hz;
		ez = Math.abs(a.z) * hx + Math.abs(b.z) * hy + Math.abs(c.z) * hz;
	}
	return {
		minX: cx - ex,
		minY: cy - ey,
		minZ: cz - ez,
		maxX: cx + ex,
		maxY: cy + ey,
		maxZ: cz + ez,
	};
}

/** The bounds of a sphere, or of a capsule from `a` to `b`. */
export function boundsOfSegment(
	ax: number,
	ay: number,
	az: number,
	bx: number,
	by: number,
	bz: number,
	r: number,
): Bounds {
	return {
		minX: Math.min(ax, bx) - r,
		minY: Math.min(ay, by) - r,
		minZ: Math.min(az, bz) - r,
		maxX: Math.max(ax, bx) + r,
		maxY: Math.max(ay, by) + r,
		maxZ: Math.max(az, bz) + r,
	};
}

export interface BoxGrid {
	readonly cell: number;
	readonly cells: Map<number, number[]>;
	/** Primitives too large to enter cell by cell; every query returns them. */
	readonly large: number[];
	/** One stamp per primitive, so a query returns each once. */
	readonly stamps: Uint32Array;
	stamp: number;
}

const SPAN = 2048;
const LARGE_CELLS = 8;
const key = (i: number, j: number, k: number) =>
	((i + SPAN / 2) * SPAN + (j + SPAN / 2)) * SPAN + (k + SPAN / 2);

export function buildBoxGrid(boxes: readonly Bounds[], cell: number): BoxGrid {
	const cells = new Map<number, number[]>();
	const large: number[] = [];
	boxes.forEach((b, n) => {
		const lo = [b.minX, b.minY, b.minZ].map((v) => Math.floor(v / cell));
		const hi = [b.maxX, b.maxY, b.maxZ].map((v) => Math.floor(v / cell));
		const span =
			(hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
		if (span > (LARGE_CELLS + 1) ** 3) {
			large.push(n);
			return;
		}
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
		stamps: new Uint32Array(boxes.length),
		stamp: 0,
	};
}

/** Every primitive whose bounds may touch the box `[min, max]`, each once,
 *  until `visit` returns `true`. */
export function queryBoxGrid(
	grid: BoxGrid,
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
