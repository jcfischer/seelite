import { decodeShippedGlb } from "../../scripts/lib/shipped-glb";

/** Decode the shipped geometry through the same loader as the browser.
 * Remove only texture references: Bun has no image decoder. Materials, names,
 * compressed vertex buffers and node transforms are retained, including normals.
 */
export async function readCoriolisGlb(name: string) {
	const scene = await decodeShippedGlb(
		name === "coriolis-industrial-flight.glb"
			? "public/models/coriolis.glb"
			: "spikes/coriolis/" + name,
	);
	scene.scale.setScalar(0.001);
	scene.updateMatrixWorld(true);
	return scene;
}
