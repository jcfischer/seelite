import * as THREE from "three";

/** Visits each mesh triangle in world space; clone vertices retained by the callback. */
export function forEachWorldTriangle(
	root: THREE.Object3D,
	visit: (triangle: THREE.Triangle) => void,
): void {
	root.updateMatrixWorld(true);
	const triangle = new THREE.Triangle();
	root.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const p = o.geometry.getAttribute("position");
		const ix = o.geometry.index;
		for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
			for (const [j, v] of [triangle.a, triangle.b, triangle.c].entries())
				v.fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j).applyMatrix4(
					o.matrixWorld,
				);
			visit(triangle);
		}
	});
}
