// The game's three shipyards (node #818): the approved studies (#800) as flight
// exports, Meshopt and lossless WebP, written to src/models/. The flight export
// is `build_model.py --flight`: the approved layout without plate fasteners,
// seam strips, wear trails or the cladding bevel, its capsule throat widened to
// the production slot and its display rear wall removed. This step adds no
// simplification, quantization or resize: the written file's triangles are
// compared with the flight export's as read, the way Bollard's are.
//
//   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
//     --python spikes/shipyards/build_model.py -- o1 o2 o3 --flight
//   node spikes/shipyards/prepare-flight-asset.mjs
import { NodeIO } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import { dedup, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { triangleSoup } from "../longwall-miner/triangle-soup.mjs";
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const pixels = async (doc) =>
	Promise.all(
		doc
			.getRoot()
			.listTextures()
			.map(async (texture) => [
				texture.getName(),
				await sharp(texture.getImage()).ensureAlpha().raw().toBuffer(),
			]),
	);
const attributes = (doc) =>
	doc
		.getRoot()
		.listMeshes()
		.map((mesh) => ({
			name: mesh.getName(),
			primitives: mesh.listPrimitives().map((primitive) =>
				Object.fromEntries(
					primitive
						.listSemantics()
						.sort()
						.map((semantic) => [
							semantic,
							Array.from(primitive.getAttribute(semantic).getArray()),
						]),
				),
			),
		}));
await mkdir("src/models", { recursive: true });
for (const [id, name] of [
	["o1", "gantry"],
	["o2", "foundry"],
	["o3", "slipway"],
]) {
	const source = `.dream-loop/shipyard-flight/${id}.glb`;
	const target = `src/models/shipyard-${name}.glb`;
	const document = await io.read(source);
	const originalPixels = await pixels(document);
	const approved = triangleSoup(document);
	await document.transform(
		dedup(),
		reorder({ encoder: MeshoptEncoder }),
		textureCompress({ encoder: sharp, targetFormat: "webp", lossless: true }),
	);
	// QUANTIZE selects the lossless NONE filter in glTF Transform (see the
	// Coriolis script); FILTER would introduce lossy normal/rotation filters.
	document
		.createExtension(EXTMeshoptCompression)
		.setRequired(true)
		.setEncoderOptions({
			method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
		});
	const beforeEncoding = attributes(document);
	await io.write(target, document);
	const decoded = await io.read(target);
	assert.deepEqual(
		attributes(decoded),
		beforeEncoding,
		`${target}: Meshopt changed vertex attributes`,
	);
	assert.deepEqual(
		triangleSoup(decoded),
		approved,
		`${target}: the written file draws other triangles than the flight export`,
	);
	assert.deepEqual(
		await pixels(decoded),
		originalPixels,
		`${target}: WebP changed texture pixels`,
	);
	const { size } = await stat(target);
	const sha256 = createHash("sha256")
		.update(await readFile(target))
		.digest("hex");
	console.log(
		`Verified ${target}: flight-export triangles, exact vertex attributes and texture pixels; ${size} bytes (${(size / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}.`,
	);
}
