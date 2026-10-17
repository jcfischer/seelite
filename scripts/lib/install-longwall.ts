import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import { installLongwallModel } from "../../src/ship-mesh";
import { decodeShippedGlb } from "./shipped-glb";

/** Install the shipped Longwall B (node #815) as the browser does, through the
 *  same loader with textures stripped, so headless measurements read the
 *  authored model rather than its after-boot stand-in. Its envelope, collision
 *  box, vents and muzzles are measured on the model the game draws. `tests/setup/longwall-model.ts` runs it before every test
 *  file; a script that builds ships awaits it itself. */
export async function installShippedLongwall(): Promise<void> {
	const scene = await decodeShippedGlb("src/models/longwall-miner.glb");
	await MeshoptSimplifier.ready;
	installLongwallModel(scene);
}
