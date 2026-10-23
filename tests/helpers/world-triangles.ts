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
