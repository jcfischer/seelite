/**
 * How far one triangle surface strays from another, measured rather than
 * taken from the tool that made it (node #815, sage round 6). A simplifier's
 * own error figure is an estimate of its own metric; this is the distance in
 * space, point to nearest triangle, over a uniform grid so a quarter-million
 * triangles answer in seconds.
 */

/** A triangle soup in one frame: positions as xyz triples, and an index. */
export interface Surface {
	readonly positions: Float32Array;
	readonly index: ArrayLike<number>;
}

interface Grid {
	readonly surface: Surface;
	readonly cell: number;
	readonly cells: Map<number, number[]>;
	/** Per triangle, the query that last tested it, so a triangle in many
	 *  cells is measured once a query. */
	readonly seen: Int32Array;
	query: number;
}

/** A cell's key: 16 bits an axis, 48 in all, inside a double's 53. A cell
 *  index past ±32,768 on any axis would collide, so the grid refuses one. */
const SPAN = 2 ** 16;
const OFFSET = SPAN / 2;
const key = (x: number, y: number, z: number) => {
	if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) >= OFFSET)
		throw new Error(
			`surface-distance: cell (${x}, ${y}, ${z}) is out of range`,
		);
	return ((x + OFFSET) * SPAN + (y + OFFSET)) * SPAN + (z + OFFSET);
};

/** Bin every triangle into each cell its box touches. */
export function surfaceGrid(surface: Surface, cell: number): Grid {
	const { positions: p, index } = surface;
	const cells = new Map<number, number[]>();
	const triangles = index.length / 3;
	for (let t = 0; t < triangles; t++) {
		const lo = [Infinity, Infinity, Infinity];
		const hi = [-Infinity, -Infinity, -Infinity];
		for (let k = 0; k < 3; k++) {
			const v = index[t * 3 + k] * 3;
			for (let a = 0; a < 3; a++) {
				lo[a] = Math.min(lo[a], p[v + a]);
				hi[a] = Math.max(hi[a], p[v + a]);
			}
		}
		const [x0, y0, z0] = lo.map((c) => Math.floor(c / cell));
		const [x1, y1, z1] = hi.map((c) => Math.floor(c / cell));
		for (let x = x0; x <= x1; x++)
			for (let y = y0; y <= y1; y++)
				for (let z = z0; z <= z1; z++) {
					const k = key(x, y, z);
					const list = cells.get(k);
					if (list) list.push(t);
					else cells.set(k, [t]);
				}
	}
	return {
		surface,
		cell,
		cells,
		seen: new Int32Array(triangles).fill(-1),
		query: 0,
	};
}

/** Squared distance from `q` to the triangle `abc` (Ericson, *Real-Time
 *  Collision Detection*, 5.1.5). */
function triangleDistanceSq(
	p: Float32Array,
	a: number,
	b: number,
	c: number,
	qx: number,
	qy: number,
	qz: number,
): number {
	const ax = p[a],
		ay = p[a + 1],
		az = p[a + 2];
	const abx = p[b] - ax,
		aby = p[b + 1] - ay,
		abz = p[b + 2] - az;
	const acx = p[c] - ax,
		acy = p[c + 1] - ay,
		acz = p[c + 2] - az;
	const apx = qx - ax,
		apy = qy - ay,
		apz = qz - az;
	const at = (u: number, v: number) => {
		const dx = qx - (ax + abx * u + acx * v);
		const dy = qy - (ay + aby * u + acy * v);
		const dz = qz - (az + abz * u + acz * v);
		return dx * dx + dy * dy + dz * dz;
	};
	const d1 = abx * apx + aby * apy + abz * apz;
	const d2 = acx * apx + acy * apy + acz * apz;
	if (d1 <= 0 && d2 <= 0) return at(0, 0);
	const bpx = qx - p[b],
		bpy = qy - p[b + 1],
		bpz = qz - p[b + 2];
	const d3 = abx * bpx + aby * bpy + abz * bpz;
	const d4 = acx * bpx + acy * bpy + acz * bpz;
	if (d3 >= 0 && d4 <= d3) return at(1, 0);
	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
	const cpx = qx - p[c],
		cpy = qy - p[c + 1],
		cpz = qz - p[c + 2];
	const d5 = abx * cpx + aby * cpy + abz * cpz;
	const d6 = acx * cpx + acy * cpy + acz * cpz;
	if (d6 >= 0 && d5 <= d6) return at(0, 1);
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
		return at(1 - w, w);
	}
	const denom = 1 / (va + vb + vc);
	return at(vb * denom, vc * denom);
}

/**
 * The distance from `q` to the nearest triangle, searched shell by shell out
 * to `reach` (Infinity if nothing is that close). It stops as soon as it has
 * found anything within `enough`, because a caller taking a maximum cannot be
 * moved by a point closer than the maximum it already holds.
 */
function distanceTo(
	grid: Grid,
	qx: number,
	qy: number,
	qz: number,
	reach: number,
	enough: number,
): number {
	const { cell, cells, seen, surface } = grid;
	const { positions: p, index } = surface;
	const query = grid.query++;
	const cx = Math.floor(qx / cell),
		cy = Math.floor(qy / cell),
		cz = Math.floor(qz / cell);
	let best = Infinity;
	const shells = Math.ceil(reach / cell);
	for (let s = 0; s <= shells; s++) {
		for (let x = -s; x <= s; x++)
			for (let y = -s; y <= s; y++)
				for (let z = -s; z <= s; z++) {
					if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== s) continue;
					const list = cells.get(key(cx + x, cy + y, cz + z));
					if (!list) continue;
					for (const t of list) {
						if (seen[t] === query) continue;
						seen[t] = query;
						const d = triangleDistanceSq(
							p,
							index[t * 3] * 3,
							index[t * 3 + 1] * 3,
							index[t * 3 + 2] * 3,
							qx,
							qy,
							qz,
						);
						if (d < best) best = d;
					}
				}
		// Every triangle not yet met lies in a further shell, at least `s`
		// cells from the query point.
		const found = Math.sqrt(best);
		if (found <= enough || found <= s * cell) return found;
	}
	const found = Math.sqrt(best);
	return found <= reach ? found : Infinity;
}

/** The furthest any of `points` (xyz triples) lies from the surface. */
export function furthestFrom(
	grid: Grid,
	points: Float32Array,
	reach: number,
): number {
	let worst = 0;
	for (let i = 0; i < points.length; i += 3)
		worst = Math.max(
			worst,
			distanceTo(grid, points[i], points[i + 1], points[i + 2], reach, worst),
		);
	return worst;
}

/** How many of `points` (xyz triples) lie further than `distance` from the
 *  surface. */
export function countBeyond(
	grid: Grid,
	points: Float32Array,
	distance: number,
): number {
	let beyond = 0;
	for (let i = 0; i < points.length; i += 3)
		if (
			distanceTo(
				grid,
				points[i],
				points[i + 1],
				points[i + 2],
				distance,
				distance,
			) > distance
		)
			beyond++;
	return beyond;
}

/** The vertices `surface`'s index uses, as xyz triples. */
export function usedVertices(surface: Surface): Float32Array {
	const used = [...new Set(Array.from(surface.index))];
	const out = new Float32Array(used.length * 3);
	for (const [i, v] of used.entries())
		out.set(surface.positions.subarray(v * 3, v * 3 + 3), i * 3);
	return out;
}

/** Points spread over every triangle of `surface`: barycentric steps of
 *  1/`steps`, corners included. */
export function trianglePoints(surface: Surface, steps: number): Float32Array {
	const { positions: p, index } = surface;
	const out: number[] = [];
	for (let t = 0; t < index.length; t += 3) {
		const a = index[t] * 3,
			b = index[t + 1] * 3,
			c = index[t + 2] * 3;
		for (let i = 0; i <= steps; i++)
			for (let j = 0; i + j <= steps; j++) {
				const u = i / steps,
					v = j / steps,
					w = 1 - u - v;
				for (let k = 0; k < 3; k++)
					out.push(w * p[a + k] + u * p[b + k] + v * p[c + k]);
			}
	}
	return Float32Array.from(out);
}
