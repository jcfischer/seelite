/**
 * Does an axis-aligned line meet any of these meshes? Three's raycast,
 * answered from a grid (node #812).
 *
 * `measure-vent-placement.ts` asks that question on the order of 10⁵ times a
 * hull, every line parallel to one of the root's axes. Three answers each one
 * by testing every triangle of every mesh the line's bounding sphere admits,
 * which was free on a procedural hull of a few thousand triangles and is not
 * on the authored courier's 354k: there it would have run for most of an
 * hour, inside a test row with a minute's budget.
 *
 * **The answer is three's, not an approximation of it.** Each mesh's
 * triangles are bucketed once per axis by their projected box in the root's
 * frame, which only decides *which* triangles are tested; the test itself is
 * `Mesh.raycast`'s: the ray carried into the mesh's local space, the
 * material's side choosing the winding and the culling exactly as
 * `checkIntersection` does, and the distance held to the ray's near and far.
 * A triangle whose projection holds the line's point is in that point's cell
 * however the cells are cut, so the grid can only skip a triangle the line
 * misses — and `tests/vent-placement.test.ts` holds every procedural hull's
 * stored placement, measured through three, equal to this.
 */
import * as THREE from "three";

/** Cells per side of each projection's grid. */
const CELLS = 128;

interface Triangle {
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly material: THREE.Material;
}

interface Grid {
	readonly min: [number, number];
	readonly size: [number, number];
	readonly cells: Triangle[][];
}

interface Indexed {
	readonly mesh: THREE.Mesh;
	readonly inverse: THREE.Matrix4;
	/** One grid per axis the line runs along: 0 = x, 1 = y, 2 = z. */
	readonly grids: readonly [Grid, Grid, Grid];
}

/** The two coordinates a line along `axis` is located by. */
const PLANE: readonly [[number, number], [number, number], [number, number]] = [
	[1, 2],
	[0, 2],
	[0, 1],
];

/** Every triangle `Mesh.raycast` would test, with the material it tests it
 *  under: groups for a material array, the whole draw range otherwise. */
function trianglesOf(mesh: THREE.Mesh): Triangle[] {
	const geometry = mesh.geometry;
	const index = geometry.getIndex();
	const position = geometry.getAttribute("position");
	const count = index ? index.count : position.count;
	const vertex = (i: number) => (index ? index.getX(i) : i);
	const range = geometry.drawRange;
	const out: Triangle[] = [];
	const push = (start: number, end: number, material: THREE.Material) => {
		for (let i = start; i < end; i += 3)
			out.push({
				a: vertex(i),
				b: vertex(i + 1),
				c: vertex(i + 2),
				material,
			});
	};
	if (Array.isArray(mesh.material)) {
		for (const group of geometry.groups) {
			const material = mesh.material[group.materialIndex as number];
			if (!material) continue;
			push(
				Math.max(group.start, range.start),
				Math.min(count, group.start + group.count, range.start + range.count),
				material,
			);
		}
	} else
		push(
			Math.max(0, range.start),
			Math.min(count, range.start + range.count),
			mesh.material,
		);
	return out;
}

function index(mesh: THREE.Mesh): Indexed {
	const triangles = trianglesOf(mesh);
	const corners = triangles.map((t) =>
		[t.a, t.b, t.c].map((v) =>
			mesh
				.getVertexPosition(v, new THREE.Vector3())
				.applyMatrix4(mesh.matrixWorld),
		),
	);
	const grid = (axis: 0 | 1 | 2): Grid => {
		const [u, v] = PLANE[axis];
		const min: [number, number] = [Infinity, Infinity];
		const max: [number, number] = [-Infinity, -Infinity];
		for (const tri of corners)
			for (const p of tri) {
				const q = [p.getComponent(u), p.getComponent(v)];
				for (const k of [0, 1]) {
					min[k] = Math.min(min[k], q[k]);
					max[k] = Math.max(max[k], q[k]);
				}
			}
		// A margin over float error between the root frame the cells are cut
		// in and the local frame the test runs in: a triangle is filed in
		// every cell its slightly grown box touches.
		const pad = 1e-9 * Math.max(max[0] - min[0], max[1] - min[1], 1e-9);
		const size: [number, number] = [
			(max[0] - min[0] + 2 * pad) / CELLS || 1,
			(max[1] - min[1] + 2 * pad) / CELLS || 1,
		];
		min[0] -= pad;
		min[1] -= pad;
		const cells: Triangle[][] = Array.from({ length: CELLS * CELLS }, () => []);
		const cell = (x: number, k: 0 | 1) =>
			Math.min(CELLS - 1, Math.max(0, Math.floor((x - min[k]) / size[k])));
		triangles.forEach((triangle, t) => {
			const us = corners[t].map((p) => p.getComponent(u));
			const vs = corners[t].map((p) => p.getComponent(v));
			const i0 = cell(Math.min(...us) - pad, 0);
			const i1 = cell(Math.max(...us) + pad, 0);
			const j0 = cell(Math.min(...vs) - pad, 1);
			const j1 = cell(Math.max(...vs) + pad, 1);
			for (let i = i0; i <= i1; i++)
				for (let j = j0; j <= j1; j++) cells[i * CELLS + j].push(triangle);
		});
		return { min, size, cells };
	};
	return {
		mesh,
		inverse: mesh.matrixWorld.clone().invert(),
		grids: [grid(0), grid(1), grid(2)],
	};
}

/**
 * A tester for lines along the root's axes through `meshes`, whose world
 * matrices must be current and must not change while it is used. The tester
 * takes a ray as three would (`origin`, unit `direction` along one axis) and
 * the raycaster's `near` and `far`, and says whether any triangle meets it.
 */
export function axisLineTester(meshes: readonly THREE.Mesh[]) {
	const indexed = meshes.map(index);
	const local = new THREE.Ray();
	const world = new THREE.Ray();
	const a = new THREE.Vector3();
	const b = new THREE.Vector3();
	const c = new THREE.Vector3();
	const point = new THREE.Vector3();
	return (
		origin: THREE.Vector3,
		direction: THREE.Vector3,
		near: number,
		far: number,
	): boolean => {
		const components = direction.toArray();
		if (components.filter((d) => d !== 0).length !== 1)
			throw new Error("axisLineTester: the line is not along an axis");
		const axis = components.findIndex((d) => d !== 0) as 0 | 1 | 2;
		world.set(origin, direction);
		const [u, v] = PLANE[axis];
		const pu = origin.getComponent(u);
		const pv = origin.getComponent(v);
		for (const { mesh, inverse, grids } of indexed) {
			const grid = grids[axis];
			const i = Math.floor((pu - grid.min[0]) / grid.size[0]);
			const j = Math.floor((pv - grid.min[1]) / grid.size[1]);
			if (i < 0 || j < 0 || i >= CELLS || j >= CELLS) continue;
			const candidates = grid.cells[i * CELLS + j];
			if (candidates.length === 0) continue;
			local.copy(world).applyMatrix4(inverse);
			for (const t of candidates) {
				mesh.getVertexPosition(t.a, a);
				mesh.getVertexPosition(t.b, b);
				mesh.getVertexPosition(t.c, c);
				// `Mesh.raycast`'s `checkIntersection`, verbatim in effect.
				const hit =
					t.material.side === THREE.BackSide
						? local.intersectTriangle(c, b, a, true, point)
						: local.intersectTriangle(
								a,
								b,
								c,
								t.material.side === THREE.FrontSide,
								point,
							);
				if (!hit) continue;
				const distance = origin.distanceTo(
					point.applyMatrix4(mesh.matrixWorld),
				);
				if (distance < near || distance > far) continue;
				return true;
			}
		}
		return false;
	};
}
