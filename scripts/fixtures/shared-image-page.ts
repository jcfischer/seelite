/** What `probe-shared-image.mjs` and the decode check import into a page: https://github.com/jcfischer/seelite/issues/1222 */
import * as THREE from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { sharedImagePlugin } from "../../src/shared-image";

export { THREE, GLTFLoader, MeshoptDecoder };
export { disposeSubtree } from "../../src/gpu-teardown";
export { ModelQueue } from "../../src/model-queue";
export { prepareTugHullModel } from "../../src/tug-hull";
export { prepareOutpostModel } from "../../src/outpost-flight";
export {
	ASSEMBLY_GLB_URL,
	BOLLARD_TUG_GLB_URL,
	REFINERY_GLB_URLS,
	OUTPOST_GLB_URLS,
	STATION_INTERIORS_GLB_URL,
	TRADE_GLB_URLS,
} from "../../src/model-urls";

/** A model through the plugin, as the game's own loaders register it. */
export const loadShared = (url: string, owner?: string) =>
	new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.register(sharedImagePlugin(owner))
		.loadAsync(url);

/** The one base-colour map a loaded model uses. */
export function mapsOf(scene: THREE.Object3D): THREE.Texture[] {
	const maps = new Set<THREE.Texture>();
	scene.traverse((o) => {
		const { material } = o as THREE.Mesh;
		for (const m of [material ?? []].flat() as THREE.MeshStandardMaterial[])
			if (m.map) maps.add(m.map);
	});
	return [...maps];
}

/** A model's base-colour map, optionally selected by image name. */
export function mapOf(scene: THREE.Object3D, name?: string): THREE.Texture {
	const maps = mapsOf(scene).filter(
		(t) => name === undefined || t.name === name,
	);
	if (maps.length !== 1)
		throw new Error(`expected one map, found ${maps.length}`);
	return maps[0] as THREE.Texture;
}
