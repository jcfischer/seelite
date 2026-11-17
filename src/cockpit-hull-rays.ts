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

/** Nearest double-sided hull hit in world kilometres, bounded by the ray's target distance. */
export function cockpitHullRays(meshes: readonly THREE.Mesh[]) {
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
			triangles.push(new THREE.Triangle(a, b, c));
		}
	}
	const tree = partition(triangles);
	const point = new THREE.Vector3();
	return (ray: THREE.Ray, far = Number.POSITIVE_INFINITY): number | null => {
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
}
