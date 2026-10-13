// The game's four refineries (node #819): the approved studies (#804) as flight
// exports, Meshopt and lossless WebP, written to src/models/. The flight export
// is `build_model.py --flight`: the approved layout without plate fasteners,
// seam strips, wear trails or the cladding bevel, the review box replaced by
// the recessed pad's housing (principal, 2026-10-13), and the whole model moved
// so the aperture plane lies on +Z at the sim's figure. This step adds no
// simplification, quantization or resize: the written file's triangles are
// compared with the flight export's as read.
//
//   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
//     --python spikes/refineries/build_model.py -- o1 o2 o3 o4 --flight
//   node spikes/refineries/prepare-flight-asset.mjs [o1 o2 o3 o4]
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
const wanted = process.argv.slice(2);
for (const [id, name] of [
	["o1", "warren"],
	["o2", "collar"],
	["o3", "spar"],
	["o4", "works"],
]) {
	if (wanted.length && !wanted.includes(id)) continue;
	const source = `.dream-loop/refinery-flight/${id}.glb`;
	const target = `src/models/refinery-${name}.glb`;
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
