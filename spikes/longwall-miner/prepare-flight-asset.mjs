// The game's Longwall B (node #815): the approved stowed export, Meshopt and
// lossless WebP, written to src/models/ (served hashed, #834). No simplification, quantization or
// resize, so the shipped hull is the one the principal approved (#803): the written file's
// triangles are compared with the approved export's as read, before `dedup` and `reorder`
// rewrite it (sage round 8; `verify-flight-asset.mjs` repeats that check without writing).
//
//   node spikes/longwall-miner/prepare-flight-asset.mjs

import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import { dedup, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { AUTHORED_HULL_ASSETS } from "../../scripts/lib/authored-hull-paint.mjs";
import {
	formatLiftRow,
	liftAndVerifyAuthoredHull,
} from "../../scripts/lib/authored-hull-prepare.mjs";
import { graftMounts } from "./mounts/graft-mounts.mjs";
import { triangleSoup } from "./triangle-soup.mjs";

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const source = "spikes/longwall-miner/longwall-miner.glb";
const target = "src/models/longwall-miner.glb";
// Node #1147: the approved study's two Mining Laser mounts join the approved
// export before anything is measured, so every check below is on the hull the
// game draws, mounts included.
const document = await graftMounts(await io.read(source), io);
// Node #887: the study's paints were lit for its own viewer. The lift runs
// before `approved` is taken so the geometry check below compares the approved
// export's triangles under the same paints the shipped file carries —
// `triangle-soup.mjs` keys each primitive by its material's factors, so a
// document lifted after that read would make this assert on two paint jobs.
const asset = AUTHORED_HULL_ASSETS.find((a) => a.shipped === target);
// Measure each paint's base colour map, hold it to the recorded figure, lift, and
// assert the ceiling — the same sequence the courier prepares with, in
// `authored-hull-prepare.mjs`. This export carries no map on two of these paints and
// one on three, and that difference is why the same rule lands twice as bright here
// as on the courier, which is what the measurement is for.
//
// **Before `triangleSoup`**: that module keys each primitive by its material's
// factors, so a document lifted after the read would make the triangle assert on two
// paint jobs.
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
// Node transforms to 10 µm: the writer drops a 2.4 µm child offset the export carries.
const round = (values) => values.map((v) => Math.round(v * 1e5) / 1e5 + 0);
const nodes = (doc) =>
	doc
		.getRoot()
		.listNodes()
		.map((node) => [
			node.getName(),
			round(node.getTranslation()),
			round(node.getRotation()),
			round(node.getScale()),
		]);
const beforeEncoding = attributes(document);
const beforeNodes = nodes(document);
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
	nodes(decoded),
	beforeNodes,
	"Encoding changed the mechanism hierarchy",
);
assert.deepEqual(
	await pixels(decoded),
	originalPixels,
	"WebP changed texture pixels",
);
console.log(
	`Verified the approved export's triangles and exact vertex attributes, texture pixels, node transforms to 10 µm; ${target} is ${((await stat(target)).size / 2 ** 20).toFixed(2)} MiB.`,
);
for (const row of lifted) console.log(formatLiftRow(row));
