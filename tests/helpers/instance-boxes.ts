/**
 * One world-space box per instance of an `InstancedMesh`.
 *
 * `Box3.setFromObject` on an instanced mesh boxes every instance together, and
 * a pool of truss members spanning a station is then one box that touches
 * everything — which is how a radiator bank 59.65 m from any other member
 * passed the island check (sage, PR #255). Each instance gets the
 * **geometry's own box** under its matrix, not a unit cube: the fixture pools
 * are unit boxes and tubes, but a window pane is not, and a unit cube under a
 * pane's matrix was 1.67 core radii across.
 *
 * Shared by the island check (`station-mesh.test.ts`) and the support flood
 * (`station-finish.test.ts`); each caller applies its own tolerance.
 */
import * as THREE from "three";

export function instanceBoxes(mesh: THREE.InstancedMesh): THREE.Box3[] {
	if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
	const local = mesh.geometry.boundingBox as THREE.Box3;
	const matrix = new THREE.Matrix4();
	const boxes: THREE.Box3[] = [];
	for (let i = 0; i < mesh.count; i++) {
		mesh.getMatrixAt(i, matrix);
		boxes.push(
			local.clone().applyMatrix4(matrix).applyMatrix4(mesh.matrixWorld),
		);
	}
	return boxes;
}
