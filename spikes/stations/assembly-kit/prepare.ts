import { Document, NodeIO } from "@gltf-transform/core";
import * as THREE from "three";
import { authorKit } from "./blocks";

export async function kitBinary() {
	const doc = new Document(),
		buffer = doc.createBuffer(),
		scene = doc.createScene();
	const source = authorKit();
	for (const block of source.children) {
		const node = doc.createNode(block.name);
		scene.addChild(node);
		for (const object of block.children) {
			const mesh = object as THREE.Mesh<
				THREE.BufferGeometry,
				THREE.MeshStandardMaterial
			>;
			const material = doc
				.createMaterial(mesh.material.name)
				.setBaseColorFactor([
					mesh.material.color.r,
					mesh.material.color.g,
					mesh.material.color.b,
					1,
				])
				.setRoughnessFactor(mesh.material.roughness)
				.setMetallicFactor(mesh.material.metalness)
				.setEmissiveFactor(
					mesh.material.emissive
						.clone()
						.multiplyScalar(mesh.material.emissiveIntensity)
						.toArray() as [number, number, number],
				);
			const primitive = doc.createPrimitive().setMaterial(material);
			for (const [name, semantic, type] of [
				["position", "POSITION", "VEC3"],
				["normal", "NORMAL", "VEC3"],
				["uv", "TEXCOORD_0", "VEC2"],
			] as const) {
				primitive.setAttribute(
					semantic,
					doc
						.createAccessor()
						.setType(type)
						.setArray(new Float32Array(mesh.geometry.getAttribute(name).array))
						.setBuffer(buffer),
				);
			}
			node.addChild(
				doc
					.createNode(mesh.name)
					.setMesh(doc.createMesh(mesh.name).addPrimitive(primitive)),
			);
		}
	}
	const bytes = await new NodeIO().writeBinary(doc);
	source.traverse((o) => {
		if (o instanceof THREE.Mesh) {
			o.geometry.dispose();
			o.material.dispose();
		}
	});
	return bytes;
}

if (import.meta.main) {
	const bytes = await kitBinary();
	await Bun.write(new URL("blocks.glb", import.meta.url), bytes);
	await Bun.write(
		new URL("asset.json", import.meta.url),
		`${JSON.stringify({ bytes: bytes.byteLength, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"), units: "km", blocks: ["HUB", "HUB_STATIC", "NODE", "TUBE"] }, null, 2)}\n`,
	);
	console.log(`Prepared Assembly spike: ${bytes.byteLength} bytes`);
}
