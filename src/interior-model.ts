/** Optional production fitting bundle. No boot wait, no background Retry panel.
 * The loader seam is compatible with loadRequiredModels for captures/postcards.
 * Node #838 still owns the future general queue; this load adds no boot model.
 */
import * as THREE from "three";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STATION_INTERIORS_GLB_URL } from "./model-urls";
import { shared } from "./gpu-teardown";
import type { ModelProgressListener } from "./model-progress";
import { installInteriorKitBuilder } from "./station-interior-mesh";
import { bakeQuantisedNodes } from "./interior-dequantize";
import { buildInteriorKit, buildInteriorKitAsync } from "./interior-kit";
import { THEMES, type Theme } from "./interior-layout";
import records from "./interior-lod-records.json";
let ready: Promise<void> | undefined;
/** Every enclosed station gets one of the accepted four themes from its own
 * identity, without consuming a world RNG draw or changing a saved field. */
export function interiorTheme(seed: number): Theme {
	return THEMES[(seed >>> 0) % THEMES.length].id;
}
export function prepareInteriorModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	// Meshopt's async API otherwise runs its entire decode on the main thread.
	// These two workers decode bundle bytes only; no additional file is fetched.
	if (!ready) MeshoptDecoder.useWorkers(2);
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(STATION_INTERIORS_GLB_URL, onProgress)
		.then((gltf) => {
			bakeQuantisedNodes(gltf.scenes);
			const assets = new Map<string, THREE.Group>();
			for (const scene of gltf.scenes) {
				const file = scene.userData.interiorFile;
				if (typeof file !== "string")
					throw Error("Missing interior fitting identity");
				scene.traverse((o) => {
					if ((o as THREE.Mesh).isMesh) {
						const mesh = o as THREE.Mesh;
						shared(mesh.geometry);
						for (const material of Array.isArray(mesh.material)
							? mesh.material
							: [mesh.material]) {
							shared(material);
							for (const value of Object.values(material))
								if (value instanceof THREE.Texture) shared(value);
						}
					}
				});
				assets.set(file, scene);
			}
			for (const [name, record] of Object.entries(records))
				for (const file of new Set([
					`${name}.glb`,
					...record.levels.map((l) => l.file),
				]))
					if (!assets.has(file)) throw Error(`Missing fitting ${file}`);
			installInteriorKitBuilder(
				(interior, seed, recess) =>
					buildInteriorKit(
						interior,
						seed,
						interiorTheme(seed),
						assets,
						records,
						recess,
					),
				(interior, seed, recess, live) =>
					buildInteriorKitAsync(
						interior,
						seed,
						interiorTheme(seed),
						assets,
						records,
						recess,
						live,
					),
			);
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		})
		.finally(() => MeshoptDecoder.useWorkers(0)));
}
