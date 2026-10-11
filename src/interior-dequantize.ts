/**
 * Undo the shipped interior kit's quantisation on load (hotfix after #843).
 *
 * `prepare-game-assets.mjs` quantises positions and normals to 16 bits so the
 * GLB fits Cloudflare Pages' 25 MiB per-file limit. `KHR_mesh_quantization`
 * stores them as normalised integers and moves each mesh's dequantising scale
 * and offset onto its node. Every mesh node in the kit was an identity leaf
 * before that, and the kit reads geometry as if it still were: instanced LOD
 * buckets, berth transforms and the clearance rows. So each attribute becomes
 * float32 again and the node's transform is folded into its geometry, which
 * gives back the old structure to within the quantisation step. Only the
 * download is smaller.
 *
 * A geometry shared by several nodes is folded once; a node that would need a
 * different fold gets its own copy.
 */
import * as THREE from "three";

function toFloat(
	attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
) {
	if (
		attribute.array instanceof Float32Array &&
		!(attribute as THREE.InterleavedBufferAttribute)
			.isInterleavedBufferAttribute &&
		!attribute.normalized
	)
		return attribute as THREE.BufferAttribute;
	const size = attribute.itemSize;
	const out = new Float32Array(attribute.count * size);
	for (let i = 0; i < attribute.count; i++) {
		out[i * size] = attribute.getX(i);
		if (size > 1) out[i * size + 1] = attribute.getY(i);
		if (size > 2) out[i * size + 2] = attribute.getZ(i);
		if (size > 3) out[i * size + 3] = attribute.getW(i);
	}
	return new THREE.BufferAttribute(out, size);
}

export function bakeQuantisedNodes(roots: Iterable<THREE.Object3D>): void {
	// The fold each geometry got, and an unfolded copy to fold differently.
	const folded = new Map<
		THREE.BufferGeometry,
		{ matrix: THREE.Matrix4; pristine: THREE.BufferGeometry }
	>();
	for (const root of roots)
		root.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh) return;
			mesh.updateMatrix();
			const matrix = mesh.matrix.clone();
			const done = folded.get(mesh.geometry);
			if (!done || !done.matrix.equals(matrix)) {
				const geometry = done ? done.pristine.clone() : mesh.geometry;
				const pristine = done ? done.pristine : geometry.clone();
				for (const name of Object.keys(geometry.attributes))
					geometry.setAttribute(name, toFloat(geometry.getAttribute(name)));
				geometry.applyMatrix4(matrix);
				folded.set(geometry, { matrix, pristine });
				mesh.geometry = geometry;
			}
			mesh.position.set(0, 0, 0);
			mesh.quaternion.identity();
			mesh.scale.set(1, 1, 1);
			mesh.updateMatrix();
		});
}
