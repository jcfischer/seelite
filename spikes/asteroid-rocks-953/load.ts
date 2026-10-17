import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Study-only loader; called after game boot. No production registry changes. */
export async function loadRocks(shading = "lambert") {
	const started = performance.now();
	const response = await fetch(
		"/spikes/asteroid-rocks-953/runtime/asteroids.glb",
	);
	if (!response.ok) throw new Error(`Rock load ${response.status}`);
	const bytes = await response.arrayBuffer();
	const fetched = performance.now();
	const gltf = await new GLTFLoader().parseAsync(bytes, "");
	const decoded = performance.now();
	gltf.scene.updateMatrixWorld(true);
	const levels: THREE.BufferGeometry[][] = [];
	let material: THREE.MeshStandardMaterial | undefined;
	gltf.scene.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const match = /^rock_(\d+)_.*_L([012])$/.exec(o.name);
		if (!match) throw new Error(`Unrecognised rock ${o.name}`);
		const index = Number(match[1]),
			level = Number(match[2]);
		const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
		// BatchedMesh requires precisely the same attribute set for every level.
		for (const name of Object.keys(g.attributes))
			if (!["position", "normal", "uv"].includes(name)) g.deleteAttribute(name);
		g.computeBoundingSphere();
		(levels[index] ??= [])[level] = g;
		material = o.material as THREE.MeshStandardMaterial;
	});
	if (!material || !levels.length || levels.some((l) => l.length !== 3))
		throw new Error("Incomplete rock asset");
	material.roughness = 0.94;
	material.metalness = 0;
	material.color.setRGB(2.3, 2.3, 2.3);
	material.normalScale.setScalar(0.55);
	if (material.map) material.map.anisotropy = 4;
	if (material.normalMap) material.normalMap.anisotropy = 4;
	const shaded =
		shading === "lambert"
			? new THREE.MeshLambertMaterial({
					color: material.color,
					map: material.map,
					normalMap: material.normalMap,
					normalScale: material.normalScale,
				})
			: material;
	return {
		levels,
		material: shaded,
		timing: {
			bytes: bytes.byteLength,
			fetchMs: fetched - started,
			decodeMs: decoded - fetched,
			prepareMs: performance.now() - decoded,
		},
	};
}
