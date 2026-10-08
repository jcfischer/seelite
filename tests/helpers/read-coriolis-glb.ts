import { readFileSync } from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

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

/** Decode a GLB at its authored scale, as `readCoriolisGlb` does. The path is
 *  from the repository root: shipped models sit under `public/`, and the
 *  review-only study files beside their spike's README. */
export async function decodeShippedGlb(repoPath: string) {
	const file = readFileSync(new URL("../../" + repoPath, import.meta.url));
	if (file.readUInt32LE(0) !== 0x46546c67 || file.readUInt32LE(4) !== 2)
		throw new Error("Expected a glTF 2 binary");
	const jsonLength = file.readUInt32LE(12);
	const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
	function stripTextures(value: Record<string, unknown>) {
		for (const [key, child] of Object.entries(value)) {
			if (key.endsWith("Texture")) delete value[key];
			else if (child && typeof child === "object")
				stripTextures(child as Record<string, unknown>);
		}
	}
	for (const material of gltf.materials ?? []) stripTextures(material);
	delete gltf.textures;
	delete gltf.images;
	for (const key of ["extensionsUsed", "extensionsRequired"])
		if (gltf[key])
			gltf[key] = gltf[key].filter((s: string) => s !== "EXT_texture_webp");
	const json = Buffer.from(JSON.stringify(gltf));
	const padded = Math.ceil(json.length / 4) * 4;
	const binary = file.subarray(20 + jsonLength);
	const output = Buffer.alloc(20 + padded + binary.length, 0x20);
	file.copy(output, 0, 0, 20);
	output.writeUInt32LE(output.length, 8);
	output.writeUInt32LE(padded, 12);
	json.copy(output, 20);
	binary.copy(output, 20 + padded);
	const data = output.buffer.slice(
		output.byteOffset,
		output.byteOffset + output.byteLength,
	);
	const { scene } = await new GLTFLoader()
		.setMeshoptDecoder(MeshoptDecoder)
		.parseAsync(data, "");
	return scene;
}
