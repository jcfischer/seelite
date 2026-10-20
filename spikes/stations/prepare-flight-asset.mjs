// The game's authored outposts (nodes #1031 and #1032): the approved studies
// (#810) as flight exports, Meshopt and lossless WebP, written to src/models/. The flight
// export is `build_model.py -- <name> --flight`: the approved layout without
// plate fasteners, seam strips, wear trails or the cladding bevel, its front
// redrawn to the sim's outpost pad (principal ruling, 2026-10-19, option 1),
// and the whole model moved so the aperture plane lies on +Z at the sim's
// figure. Forms a-d (Derrick, Buoy, Rig, Cluster) are also turned so their
// pad faces +Z, and the Rig's moved so its pad is on the axis. This step adds no simplification, quantization or resize: the
// written file's triangles are compared with the flight export's as read.
//
//   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
//     --python spikes/stations/build_model.py -- salvage derrick buoy rig cluster --flight
//   node spikes/stations/prepare-flight-asset.mjs [name ...]
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
	["derrick", "derrick"],
	["buoy", "buoy"],
	["rig", "rig"],
	["cluster", "cluster"],
	["salvage", "salvage"],
	["ring", "ring"],
	["drum", "drum"],
	["wheel", "wheel"],
]) {
	if (wanted.length && !wanted.includes(id)) continue;
	const source = `.dream-loop/station-flight/${id}.glb`;
	const role = ["ring", "drum", "wheel"].includes(id) ? "trade" : "outpost";
	const target = `src/models/${role}-${name}.glb`;
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
	assert(size < 25_000_000, `${target}: exceeds the flight asset budget`);
	const sha256 = createHash("sha256")
		.update(await readFile(target))
		.digest("hex");
	console.log(
		`Verified ${target}: flight-export triangles, exact vertex attributes and texture pixels; ${size} bytes (${(size / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}.`,
	);
}
