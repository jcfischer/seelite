import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
	ASSEMBLY_BLOCKS,
	ASSEMBLY_CELL_KM,
	assemblyInstances,
} from "./assembly-plan";
import { shared } from "./gpu-teardown";
import { EMISSIVE_CEILING } from "./light-rig";
import type { ModelProgressListener } from "./model-progress";
import { ASSEMBLY_GLB_URL } from "./model-urls";
import { installAssemblyBlocks, type AssemblyBlocks } from "./station-mesh";
import { AUTHORED_EXTERIOR_NAME } from "./station-visuals";

export { assemblyInstances } from "./assembly-plan";

export function createAssemblyBlocks(kit: THREE.Object3D): AssemblyBlocks {
	kit.updateMatrixWorld(true);
	const blocks = ASSEMBLY_BLOCKS.map((name) => {
		const source = kit.getObjectByName(name);
		if (!source) throw Error(`Missing authored Assembly block ${name}`);
		const meshes: THREE.Mesh[] = [];
		source.traverse((o) => {
			if (o instanceof THREE.Mesh) meshes.push(o);
		});
		if (!meshes.length) throw Error(`Empty authored Assembly block ${name}`);
		return { name, meshes };
	});
	const materials = new Set<THREE.MeshStandardMaterial>();
	for (const { meshes } of blocks)
		for (const mesh of meshes) {
			shared(mesh.geometry);
			for (const mat of Array.isArray(mesh.material)
				? mesh.material
				: [mesh.material]) {
				shared(mat);
				if (mat instanceof THREE.MeshStandardMaterial) materials.add(mat);
				for (const value of Object.values(mat))
					if (value instanceof THREE.Texture) shared(value);
			}
		}
	const divisor = Math.max(
		1,
		...[...materials].map((m) => m.emissiveIntensity / EMISSIVE_CEILING),
	);
	for (const material of materials) material.emissiveIntensity /= divisor;
	return (placements, group, spinner) => {
		const instances = assemblyInstances(placements);
		for (const { name, meshes } of blocks) {
			const cells = instances.filter((p) => p.block === name);
			if (!cells.length) continue;
			const exterior = new THREE.Group();
			exterior.name = AUTHORED_EXTERIOR_NAME;
			(name === "HUB" ? spinner : group).add(exterior);
			const part = new THREE.Group();
			part.name = `authored-${name}`;
			exterior.add(part);
			for (const source of meshes) {
				const batch = new THREE.InstancedMesh(
					source.geometry,
					source.material,
					cells.length,
				);
				batch.name = source.name.includes("amber-lamp")
					? "windows"
					: source.name;
				batch.userData.assemblyBlock = name;
				batch.castShadow = true;
				batch.receiveShadow = true;
				for (const [index, p] of cells.entries()) {
					const matrix = new THREE.Matrix4().makeRotationZ(p.turn);
					matrix.setPosition(
						p.dx * ASSEMBLY_CELL_KM,
						p.dy * ASSEMBLY_CELL_KM,
						0,
					);
					batch.setMatrixAt(index, matrix.multiply(source.matrixWorld));
				}
				batch.instanceMatrix.needsUpdate = true;
				batch.computeBoundingSphere();
				part.add(batch);
			}
		}
	};
}

let ready: Promise<void> | undefined;
export function prepareAssemblyModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(ASSEMBLY_GLB_URL, onProgress)
		.then((gltf) => {
			installAssemblyBlocks(createAssemblyBlocks(gltf.scene));
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
