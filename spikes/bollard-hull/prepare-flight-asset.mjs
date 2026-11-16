// The game's Bollard O4 (node #814): the approved export (#798, 26d6958),
// Meshopt and lossless WebP, written to src/models/ (served hashed, #834). No
// simplification, quantization or resize, so the shipped hull is the one the
// principal approved: node #909 lifts only paint factors by #887's shared rule.
// The written file's triangles are compared with the lifted approved export,
// before `dedup` and `reorder` rewrite it, the way
// Longwall B's are (`spikes/longwall-miner/prepare-flight-asset.mjs`).
//
//   node spikes/bollard-hull/prepare-flight-asset.mjs
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
import { AUTHORED_HULL_ASSETS } from "../../scripts/lib/authored-hull-paint.mjs";
import {
	formatLiftRow,
	liftAndVerifyAuthoredHull,
} from "../../scripts/lib/authored-hull-prepare.mjs";
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const source = "spikes/bollard-hull/bollard-hull.glb";
const target = "src/models/bollard-tug.glb";
const document = await io.read(source);
// Node #909: verify the map's measured luma, then apply #887's shared lift.
// Before triangleSoup: it keys primitives by material factors as well as vertices.
const asset = AUTHORED_HULL_ASSETS.find((a) => a.shipped === target);
const lifted = await liftAndVerifyAuthoredHull(document, asset);
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
const beforeEncoding = attributes(document);
await mkdir("src/models", { recursive: true });
await io.write(target, document);
const decoded = await io.read(target);
assert.deepEqual(
	attributes(decoded),
	beforeEncoding,
	"Meshopt changed vertex attributes",
);
assert.deepEqual(
	triangleSoup(decoded),
	approved,
	"The written file draws other triangles than the approved export",
);
assert.deepEqual(
	await pixels(decoded),
	originalPixels,
	"WebP changed texture pixels",
);
const sha256 = createHash("sha256")
	.update(await readFile(target))
	.digest("hex");
console.log(
	`Verified the approved export's triangles, exact vertex attributes and texture pixels; ${target} is ${(await stat(target)).size} bytes (${((await stat(target)).size / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}.`,
);
for (const row of lifted) console.log(formatLiftRow(row));
