/**
 * Triangle queries for the authored pads' asset rows (the refineries, node
 * #819; the outpost Salvage, node #1031), in the station's frame, metres.
 */
import * as THREE from "three";

/** Separating-axis test of a triangle against an axis-aligned box. */
export function triangleHitsBox(
	tri: THREE.Vector3[],
	centre: THREE.Vector3,
	half: THREE.Vector3,
): boolean {
	const v = tri.map((p) => p.clone().sub(centre));
	const e = [
		v[1].clone().sub(v[0]),
		v[2].clone().sub(v[1]),
		v[0].clone().sub(v[2]),
	];
	const axes: THREE.Vector3[] = [
		new THREE.Vector3(1, 0, 0),
		new THREE.Vector3(0, 1, 0),
		new THREE.Vector3(0, 0, 1),
		e[0].clone().cross(e[1]),
	];
	for (const edge of e)
		for (const unit of axes.slice(0, 3)) axes.push(unit.clone().cross(edge));
	for (const axis of axes) {
		if (axis.lengthSq() < 1e-18) continue;
		const p = v.map((q) => q.dot(axis));
		const r =
			half.x * Math.abs(axis.x) +
			half.y * Math.abs(axis.y) +
			half.z * Math.abs(axis.z);
		if (Math.min(...p) >= r || Math.max(...p) <= -r) return false;
	}
	return true;
}

/** A box from its min and max corners. */
export function box(min: [number, number, number], max: [number, number, number]) {
	const lo = new THREE.Vector3(...min);
	const hi = new THREE.Vector3(...max);
	return {
		centre: lo.clone().add(hi).multiplyScalar(0.5),
		half: hi.clone().sub(lo).multiplyScalar(0.5),
	};
}

/** Where a ray down −z from (x, y, far in front) first meets a triangle. */
export function firstHitDownAxis(
	tris: THREE.Vector3[][],
	x: number,
	y: number,
): number | null {
	let best: number | null = null;
	for (const [a, b, c] of tris) {
		const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
		if (Math.abs(d) < 1e-9) continue;
		const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
		const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
		if (u < 0 || v < 0 || u + v > 1) continue;
		const z = u * a.z + v * b.z + (1 - u - v) * c.z;
		if (best === null || z > best) best = z;
	}
	return best;
}


/** Every triangle of a decoded scene in its world frame, with its mesh's name. */
export function sceneTriangles(
	scene: THREE.Object3D,
): { mesh: string; tri: THREE.Vector3[] }[] {
	scene.updateMatrixWorld(true);
	const tris: { mesh: string; tri: THREE.Vector3[] }[] = [];
	scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const g = o.geometry as THREE.BufferGeometry;
		const position = g.getAttribute("position");
		const index = g.getIndex()!;
		for (let i = 0; i < index.count; i += 3)
			tris.push({
				mesh: o.name,
				tri: [0, 1, 2].map((k) =>
					new THREE.Vector3()
						.fromBufferAttribute(position, index.getX(i + k))
						.applyMatrix4(o.matrixWorld),
				),
			});
	});
	return tris;
}
