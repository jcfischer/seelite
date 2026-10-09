/**
 * Longwall B, the authored miner (#803; node #815), as the browser loads it.
 *
 * `ship-mesh.ts` owns what the model becomes in the game's frame and refuses
 * to build `miner/b` without it; this module only fetches and decodes the
 * shipped asset and installs it. Every page that builds a ship — the game, the
 * postcard viewer and the ship workbench — passes `prepareLongwallModel` to
 * `prepareCoriolisPage` or `loadRequiredModels`, so one panel and one Retry
 * cover it with the station and the cockpit, and the boot's progress bar
 * counts its bytes (#833).
 */
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { LONGWALL_MINER_GLB_URL } from "./model-urls";
import type { ModelProgressListener } from "./model-progress";
import { installLongwallModel } from "./ship-mesh";

export const LONGWALL_MODEL_URL = LONGWALL_MINER_GLB_URL;

let ready: Promise<void> | undefined;

/** Await before anything builds `miner/b`. A failure clears the promise, so
 *  the Retry panel's next attempt fetches again. `onProgress` hears the
 *  download this call starts, as `prepareCoriolisModel`'s does. */
export function prepareLongwallModel(
	onProgress?: ModelProgressListener,
): Promise<void> {
	return (ready ??= new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.loadAsync(LONGWALL_MODEL_URL, onProgress)
		.then(async (gltf) => {
			// The install simplifies the `reduced` hull (`ship-mesh.ts`).
			await MeshoptSimplifier.ready;
			installLongwallModel(gltf.scene);
		})
		.catch((error) => {
			ready = undefined;
			throw error;
		}));
}
