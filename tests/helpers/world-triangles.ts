import * as THREE from "three";

/** Visits each mesh triangle in world space; clone vertices retained by the callback. */
export function forEachWorldTriangle(
	root: THREE.Object3D,
	visit: (triangle: THREE.Triangle) => void,
): void {
	root.updateMatrixWorld(true);
	const triangle = new THREE.Triangle();
	const instance = new THREE.Matrix4();
	const matrix = new THREE.Matrix4();
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const p = o.geometry.getAttribute("position");
		const ix = o.geometry.index;
		for (let n = 0; n < (o instanceof THREE.InstancedMesh ? o.count : 1); n++) {
			matrix.copy(o.matrixWorld);
			if (o instanceof THREE.InstancedMesh) {
				o.getMatrixAt(n, instance);
				matrix.multiply(instance);
			}
			for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
				for (const [j, v] of [triangle.a, triangle.b, triangle.c].entries())
					v.fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(
						matrix,
					);
				visit(triangle);
			}
		}
	});
}

/**
 * Visits each drawn vertex in world space, instance by instance, with the
 * object it belongs to; the vertex is reused, so a caller that keeps it clones
 * it. Objects `include` refuses are not walked.
 */
export function forEachWorldVertex(
	root: THREE.Object3D,
	visit: (vertex: THREE.Vector3, object: THREE.Object3D) => void,
	include: (object: THREE.Object3D) => boolean = () => true,
): void {
	root.updateMatrixWorld(true);
	const v = new THREE.Vector3();
	const instance = new THREE.Matrix4();
	root.traverse((object) => {
		const mesh = object as THREE.Mesh;
		const position = mesh.geometry?.getAttribute?.("position");
		if (!position || !include(object)) return;
		const instanced = object as THREE.InstancedMesh;
		const count = instanced.isInstancedMesh ? instanced.count : 1;
		for (let n = 0; n < count; n++) {
			if (instanced.isInstancedMesh) instanced.getMatrixAt(n, instance);
			else instance.identity();
			mesh.updateWorldMatrix(true, false);
			for (let i = 0; i < position.count; i++) {
				v.fromBufferAttribute(position as THREE.BufferAttribute, i);
				v.applyMatrix4(instance);
				v.applyMatrix4(mesh.matrixWorld);
				visit(v, object);
			}
		}
	});
}
