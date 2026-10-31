/**
 * Longwall B, the authored miner (#803; node #815), as the browser loads it.
 *
 * The session model queue loads and installs this after boot (node #838).
 * Until then the selected miner draws its procedural stand-in. Postcards and
 * full-model capture boots require it when their frame calls for it.
 */
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LONGWALL_MINER_GLB_URL } from "./model-urls";
import type { ModelProgressListener } from "./model-progress";
import {
	installLongwallModelSliced,
	type LongwallModelOptions,
} from "./ship-mesh";

let ready: Promise<void> | undefined;

/** Install the template once. A failure clears the promise, so
 *  the Retry panel's next attempt fetches again. `onProgress` hears the
 *  download this call starts, as `prepareCoriolisModel`'s does. */
export function prepareLongwallModel(
	onProgress?: ModelProgressListener,
	options: LongwallModelOptions = {},
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(LONGWALL_MINER_GLB_URL, onProgress)
		.then(async (gltf) => {
			// The install simplifies the `reduced` hull (`ship-mesh.ts`).
			await MeshoptSimplifier.ready;
			await installLongwallModelSliced(gltf.scene, options);
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
