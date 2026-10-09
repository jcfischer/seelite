import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { installLongwallModel } from "../../src/ship-mesh";
import { decodeShippedGlb } from "./shipped-glb";

/** Install the shipped Longwall B (node #815) as the browser does, through the
 *  same loader with textures stripped: `buildShipMesh("miner", "b")` refuses
 *  to build without it, so every headless measurement of the miner — the
 *  envelope, the collision box, the vents and the muzzles — reads the model
 *  the game draws. `tests/setup/longwall-model.ts` runs it before every test
 *  file; a script that builds ships awaits it itself. */
export async function installShippedLongwall(): Promise<void> {
	const scene = await decodeShippedGlb("src/models/longwall-miner.glb");
	await MeshoptSimplifier.ready;
	installLongwallModel(scene);
}
