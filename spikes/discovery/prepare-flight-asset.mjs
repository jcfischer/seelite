// The game's Discovery / Voyager A (node #820): the accepted export (#809,
// accepted 2026-10-09), turned to the game's frame, then Meshopt and lossless
// WebP, written to src/models/ (served hashed, #834). No simplification,
// quantization, resize or paint change, so the shipped hull is the look the
// principal accepted: bringing it under #887's paint lift is its own decision
// (the tug's was node #909).
//
// The study is metres with the nose on +X (`build_model.py` exports with
// `export_yup=False`, so Blender's axes reach the file as they were authored).
// Every other authored hull is nose +Z, Y up (`authored-hull.ts`), so the one
// thing this script does to the geometry is the rigid turn
// (x, y, z) -> (-z, y, x) about Y, applied to positions and normals. It maps
// the long axis onto +Z exactly (no rounding residue) and keeps the winding.
//
//   node spikes/discovery/prepare-flight-asset.mjs
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
const source = "spikes/discovery/discovery.glb";
const target = "src/models/discovery-voyager.glb";
const document = await io.read(source);

/** The study's long axis is X; the game's is Z. */
function turnNoseOntoZ(doc) {
	for (const node of doc.getRoot().listNodes()) {
		assert.deepEqual(
			[node.getTranslation(), node.getRotation(), node.getScale()].map((v) =>
				Array.from(v),
			),
			[
				[0, 0, 0],
				[0, 0, 0, 1],
				[1, 1, 1],
			],
			`${node.getName()}: the study's nodes carry no transform, so the turn is the geometry's alone`,
		);
	}
	for (const mesh of doc.getRoot().listMeshes())
		for (const primitive of mesh.listPrimitives())
			for (const semantic of ["POSITION", "NORMAL"]) {
				const accessor = primitive.getAttribute(semantic);
				if (!accessor) continue;
				const from = accessor.getArray();
				const to = new Float32Array(from.length);
				for (let i = 0; i < from.length; i += 3) {
					to[i] = -from[i + 2];
					to[i + 1] = from[i + 1];
					to[i + 2] = from[i];
				}
				accessor.setArray(to);
			}
}
const bounds = (doc) => {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const mesh of doc.getRoot().listMeshes())
		for (const primitive of mesh.listPrimitives()) {
			const a = primitive.getAttribute("POSITION").getArray();
			for (let i = 0; i < a.length; i += 3)
				for (let k = 0; k < 3; k++) {
					min[k] = Math.min(min[k], a[i + k]);
					max[k] = Math.max(max[k], a[i + k]);
				}
		}
	return { min, max };
};
const before = bounds(document);
turnNoseOntoZ(document);
const after = bounds(document);
assert.deepEqual(
	[after.min[2], after.max[2], after.min[1], after.max[1]],
	[before.min[0], before.max[0], before.min[1], before.max[1]],
	"the turn must carry the study's X extent onto Z and leave Y alone",
);
assert.deepEqual(
	[after.min[0], after.max[0]],
	[-before.max[2], -before.min[2]],
	"the turn must carry the study's Z extent onto -X",
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
// Before `dedup` and `reorder` rewrite it: the turned export's triangles, to
// compare the written file against.
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
	"The written file draws other triangles than the turned approved export",
);
assert.deepEqual(
	await pixels(decoded),
	originalPixels,
	"WebP changed texture pixels",
);
const sha256 = createHash("sha256")
	.update(await readFile(target))
	.digest("hex");
const size = (await stat(target)).size;
console.log(
	`Verified the turned export's triangles, exact vertex attributes and texture pixels; ${target} is ${size} bytes (${(size / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}.`,
);
console.log(
	`Bounds (m): x ${after.min[0].toFixed(2)}..${after.max[0].toFixed(2)}, y ${after.min[1].toFixed(2)}..${after.max[1].toFixed(2)}, z ${after.min[2].toFixed(2)}..${after.max[2].toFixed(2)}.`,
);
