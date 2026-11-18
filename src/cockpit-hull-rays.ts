import * as THREE from "three";

interface HullNode {
	box: THREE.Box3;
	triangles: readonly THREE.Triangle[];
	children: readonly HullNode[];
}

function partition(triangles: THREE.Triangle[]): HullNode {
	const box = new THREE.Box3();
	for (const triangle of triangles)
		for (const point of [triangle.a, triangle.b, triangle.c])
			box.expandByPoint(point);
	if (triangles.length <= 32) return { box, triangles, children: [] };
	const size = box.getSize(new THREE.Vector3());
	let axis: "x" | "y" | "z" = "x";
	if (size.y > size[axis]) axis = "y";
	if (size.z > size[axis]) axis = "z";
	const center = (t: THREE.Triangle) => t.a[axis] + t.b[axis] + t.c[axis];
	triangles.sort((a, b) => center(a) - center(b));
	const middle = Math.floor(triangles.length / 2);
	return {
		box,
		triangles: [],
		children: [
			partition(triangles.slice(0, middle)),
			partition(triangles.slice(middle)),
		],
	};
}

/** Finite double-sided hull rays and visible tail-to-head intervals in the chosen kilometre frame. */
export function cockpitHullRays(
	meshes: readonly THREE.Mesh[],
	worldToFrame = new THREE.Matrix4(),
) {
	const triangles: THREE.Triangle[] = [];
	for (const mesh of meshes) {
		const pos = mesh.geometry.getAttribute("position");
		const index = mesh.geometry.getIndex();
		const count = index?.count ?? pos.count;
		for (let n = 0; n < count; n += 3) {
			const [a, b, c] = [0, 1, 2].map((i) =>
				new THREE.Vector3()
					.fromBufferAttribute(pos, index ? index.getX(n + i) : n + i)
					.applyMatrix4(mesh.matrixWorld),
			);
			triangles.push(
				new THREE.Triangle(
					a.applyMatrix4(worldToFrame),
					b.applyMatrix4(worldToFrame),
					c.applyMatrix4(worldToFrame),
				),
			);
		}
	}
	const tree = partition(triangles);
	const point = new THREE.Vector3();
	const hit = (
		ray: THREE.Ray,
		far = Number.POSITIVE_INFINITY,
	): number | null => {
		let nearest = far;
		let hit = false;
		const visit = (node: HullNode) => {
			if (!ray.intersectBox(node.box, point)) return;
			if (
				!node.box.containsPoint(ray.origin) &&
				point.distanceTo(ray.origin) > nearest
			)
				return;
			for (const triangle of node.triangles) {
				if (
					!ray.intersectTriangle(
						triangle.a,
						triangle.b,
						triangle.c,
						false,
						point,
					)
				)
					continue;
				const distance = point.distanceTo(ray.origin);
				if (distance <= nearest) {
					nearest = distance;
					hit = true;
				}
			}
			for (const child of node.children) visit(child);
		};
		visit(tree);
		return hit ? nearest : null;
	};
	const wedge = new THREE.Triangle();
	const plane = new THREE.Plane();
	const edge = new THREE.Line3();
	const bary = new THREE.Vector3();
	const ray = new THREE.Ray();
	const visibleSegments = (
		eye: THREE.Vector3,
		tail: THREE.Vector3,
		head: THREE.Vector3,
	): [number, number][] => {
		wedge.set(eye, tail, head);
		if (wedge.getArea() === 0) {
			point.copy(tail).sub(eye);
			if (point.lengthSq() === 0) point.copy(head).sub(eye);
			ray.set(eye, point.normalize());
			const a = point.copy(tail).sub(eye).dot(ray.direction);
			const b = point.copy(head).sub(eye).dot(ray.direction);
			const forward = hit(ray) ?? Number.POSITIVE_INFINITY;
			ray.direction.negate();
			const backward = -(hit(ray) ?? Number.POSITIVE_INFINITY);
			if (a === b) return a > backward && a < forward ? [[0, 1]] : [];
			const near = (backward - a) / (b - a);
			const far = (forward - a) / (b - a);
			const start = Math.max(0, Math.min(near, far));
			const end = Math.min(1, Math.max(near, far));
			return start < end ? [[start, end]] : [];
		}
		wedge.getPlane(plane);
		const hidden: [number, number][] = [];
		const project = (p: THREE.Vector3): THREE.Vector3 => {
			wedge.getBarycoord(p, bary);
			return bary.clone();
		};
		const clip = (polygon: THREE.Vector3[]) => {
			const axes: ("x" | "y" | "z")[] = ["x", "y", "z"];
			for (const axis of axes) {
				const out: THREE.Vector3[] = [];
				for (let i = 0; i < polygon.length; i++) {
					const a = polygon[i];
					const b = polygon[(i + 1) % polygon.length];
					if (a[axis] >= 0) out.push(a);
					if (a[axis] < 0 !== b[axis] < 0)
						out.push(a.clone().lerp(b, a[axis] / (a[axis] - b[axis])));
				}
				polygon = out;
			}
			if (polygon.length === 0) return;
			let start = 1;
			let end = 0;
			for (const p of polygon) {
				const t = p.z / (p.y + p.z);
				if (!Number.isFinite(t)) continue;
				start = Math.min(start, t);
				end = Math.max(end, t);
			}
			if (start <= end) hidden.push([start, end]);
		};
		const visit = (node: HullNode) => {
			if (!node.box.intersectsTriangle(wedge)) return;
			for (const triangle of node.triangles) {
				const vertices = [triangle.a, triangle.b, triangle.c];
				const distances = vertices.map((p) => plane.distanceToPoint(p));
				if (distances.every((d) => d > 1e-12)) continue;
				if (distances.every((d) => d < -1e-12)) continue;
				if (distances.every((d) => Math.abs(d) <= 1e-12)) {
					clip(vertices.map(project));
					continue;
				}
				const slice: THREE.Vector3[] = [];
				for (let i = 0; i < 3; i++) {
					if (Math.abs(distances[i]) <= 1e-12) slice.push(project(vertices[i]));
					const j = (i + 1) % 3;
					if (distances[i] * distances[j] >= 0) continue;
					edge.set(vertices[i], vertices[j]);
					if (plane.intersectLine(edge, point)) slice.push(project(point));
				}
				clip(slice);
			}
			for (const child of node.children) visit(child);
		};
		visit(tree);
		hidden.sort((a, b) => a[0] - b[0]);
		const visible: [number, number][] = [];
		let start = 0;
		for (const [a, b] of hidden) {
			if (a > start) visible.push([start, a]);
			start = Math.max(start, b);
		}
		if (start < 1) visible.push([start, 1]);
		return visible;
	};
	return Object.assign(hit, { visibleSegments });
}

const HULL_RAYS = new WeakMap<
	THREE.Object3D,
	ReturnType<typeof cockpitHullRays>
>();

/** A ship owner's hull node and the named parts that transmit light. */
export interface CockpitHullSource {
	node: THREE.Object3D;
	transparentNames: RegExp;
}

/** Mesh selection shared by cached hull queries and live silhouette probes. */
export function cockpitHullMeshes(source: CockpitHullSource): THREE.Mesh[] {
	const meshes: THREE.Mesh[] = [];
	source.node.traverse((o) => {
		if (o instanceof THREE.Mesh && !source.transparentNames.test(o.name))
			meshes.push(o);
	});
	return meshes;
}

/** Cached hull queries in root-local kilometres, independent of the display pose. */
export function cockpitHullBlocker(
	root: THREE.Object3D,
	source: CockpitHullSource,
) {
	const hull = source.node;
	let hit = HULL_RAYS.get(hull);
	if (!hit) {
		root.updateWorldMatrix(true, true);
		hit = cockpitHullRays(
			cockpitHullMeshes(source),
			root.matrixWorld.clone().invert(),
		);
		HULL_RAYS.set(hull, hit);
	}
	return hit;
}
