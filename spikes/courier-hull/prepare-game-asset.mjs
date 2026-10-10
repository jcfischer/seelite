// Run after build_model.py exports the approved courier hull study (node #812).
// Node #831 quantises normals and UVs, retaining exact positions, triangles
// and lossless texture pixels. No simplification or resize.
import { NodeIO } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
	KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { dedup, quantize, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const document = await io.read(
	"spikes/courier-hull/courier-hull.glb",
);
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
const originalPixels = await pixels(document);
await document.transform(
	dedup(),
	reorder({ encoder: MeshoptEncoder }),
	quantize({
		pattern: /^(NORMAL|TEXCOORD_\d+)$/,
		quantizeNormal: 16,
		quantizeTexcoord: 16,
	}),
	textureCompress({ encoder: sharp, targetFormat: "webp", lossless: true }),
);
// glTF Transform 4.5.1's extension detector reads POSITION for every
// semantic, missing quantised normals when positions stay float32.
// Signed-short NORMAL needs this extension even with exact positions.
document.createExtension(KHRMeshQuantization).setRequired(true);
// QUANTIZE selects the lossless NONE filter in glTF Transform. It expects a
// caller to run quantize() first, as above. FILTER
// would introduce lossy normal/rotation filters. Verify the decoded arrays.
document
	.createExtension(EXTMeshoptCompression)
	.setRequired(true)
	.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
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
// Taken after dedup and reorder, so this asserts the Meshopt round trip:
// what is written decodes to exactly what was encoded. That the shipped file
// draws the study's triangles and exact positions with bounded normal/UV error is
// `tests/courier-hull.test.ts`'s row, against the study export itself.
const beforeEncoding = attributes(document);
await mkdir("src/models", { recursive: true });
await io.write("src/models/courier-hull.glb", document);
const decoded = await io.read("src/models/courier-hull.glb");
assert.deepEqual(
	attributes(decoded),
	beforeEncoding,
	"Meshopt changed vertex attributes",
);
assert.deepEqual(
	await pixels(decoded),
	originalPixels,
	"WebP changed texture pixels",
);
console.log(
	"Verified the Meshopt round trip of every vertex attribute, and exact texture pixels.",
);
