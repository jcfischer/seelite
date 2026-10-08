import { readFileSync } from "node:fs";
import * as THREE from "three";
export function readCoriolisGlb(name: string) {
	// Read the shipped GLB vertex buffers, including node transforms. These tests
	// measure the exported mesh, not a second description of the generator.
	const file = readFileSync(
		new URL("../../public/spikes/coriolis/" + name, import.meta.url),
	);
	const jsonLength = file.readUInt32LE(12);
	const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
	const binaryStart = 20 + jsonLength + 8;
	function attribute(index: number): Float32Array | Uint32Array | Uint16Array {
		const a = gltf.accessors[index];
		const view = gltf.bufferViews[a.bufferView];
		const offset = binaryStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
		const count = a.count * (a.type === "VEC3" ? 3 : 1);
		const data = file.buffer.slice(
			file.byteOffset + offset,
			file.byteOffset + offset + count * (a.componentType === 5123 ? 2 : 4),
		);
		return a.componentType === 5126
			? new Float32Array(data)
			: a.componentType === 5123
				? new Uint16Array(data)
				: new Uint32Array(data);
	}
	const root = new THREE.Group();
	function node(index: number, parent: THREE.Object3D) {
		const n = gltf.nodes[index];
		const group = new THREE.Group();
		if (n.matrix) group.applyMatrix4(new THREE.Matrix4().fromArray(n.matrix));
		else {
			if (n.translation) group.position.fromArray(n.translation);
			if (n.rotation) group.quaternion.fromArray(n.rotation);
			if (n.scale) group.scale.fromArray(n.scale);
		}
		parent.add(group);
		if (n.mesh !== undefined)
			for (const p of gltf.meshes[n.mesh].primitives) {
				const geometry = new THREE.BufferGeometry();
				geometry.setAttribute(
					"position",
					new THREE.BufferAttribute(attribute(p.attributes.POSITION), 3),
				);
				if (p.indices !== undefined)
					geometry.setIndex(new THREE.BufferAttribute(attribute(p.indices), 1));
				group.add(
					new THREE.Mesh(
						geometry,
						new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
					),
				);
			}
		for (const child of n.children ?? []) node(child, group);
	}
	for (const n of gltf.scenes[gltf.scene ?? 0].nodes) node(n, root);
	root.scale.setScalar(0.001);
	root.updateMatrixWorld(true);

	return root;
}
