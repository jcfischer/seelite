import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type * as THREE from "three";
import { decodeShippedGlb } from "./shipped-glb";

/** Each part of a shipped GLB that sharing an image must leave alone, as a
 *  sha256: the decoded geometry, and the JSON that names materials and nodes. */
export interface GlbDigest {
	bytes: number;
	attributes: string;
	document: string;
}

/** Digest `repoPath` through the production decoder: every mesh in traversal
 *  order, with its transform and the exact bytes of each attribute and index. */
export async function glbDigest(repoPath: string): Promise<GlbDigest> {
	const scene = await decodeShippedGlb(repoPath);
	scene.updateMatrixWorld(true);
	const attributes = createHash("sha256");
	const write = (attribute: THREE.BufferAttribute) => {
		attributes.update(
			`${attribute.itemSize}/${attribute.normalized}/${attribute.array.constructor.name}`,
		);
		attributes.update(new Uint8Array(attribute.array.buffer));
	};
	scene.traverse((object) => {
		attributes.update(`${object.name}|${object.matrixWorld.elements.join()}`);
		const { geometry } = object as THREE.Mesh;
		if (!geometry) return;
		for (const name of Object.keys(geometry.attributes).sort()) {
			attributes.update(name);
			write(geometry.attributes[name] as THREE.BufferAttribute);
		}
		if (geometry.index) write(geometry.index);
	});
	const file = readFileSync(new URL(`../../${repoPath}`, import.meta.url));
	const json = JSON.parse(
		file.subarray(20, 20 + file.readUInt32LE(12)).toString(),
	);
	const document = createHash("sha256").update(
		JSON.stringify([
			json.scene,
			json.scenes,
			json.nodes,
			json.meshes,
			json.materials,
			json.samplers,
			json.animations,
		]),
	);
	return {
		bytes: statSync(new URL(`../../${repoPath}`, import.meta.url)).size,
		attributes: attributes.digest("hex"),
		document: document.digest("hex"),
	};
}
