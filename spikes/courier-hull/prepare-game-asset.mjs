// Run after build_model.py exports the approved courier hull study (node #812).
// Node #831 quantises normals and UVs, retaining exact positions, triangles
// and lossless texture pixels. No simplification or resize.
//
// Node #887 lifts nine hull paints here: the study's materials were lit for the
// spike's own viewer, and `AUTHORED_HULL_PAINT_LIFT` says what that costs in the
// game's light. The geometry and the texture pixels below are still checked
// exact, so the lift is the only thing that differs from the approved study.

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
	KHRMeshQuantization,
} from "@gltf-transform/extensions";
import {
	dedup,
	quantize,
	reorder,
	textureCompress,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import {
	AUTHORED_HULL_ASSETS,
	ceilingFailures,
	liftAuthoredHullPaint,
} from "../../scripts/lib/authored-hull-paint.mjs";
import { baseColorLumaByMaterial } from "../../scripts/lib/texture-luma.mjs";

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const document = await io.read("spikes/courier-hull/courier-hull.glb");
const asset = AUTHORED_HULL_ASSETS.find(
	(a) => a.shipped === "src/models/courier-hull.glb",
);
// The lift's brightness depends on each paint's base colour map, so the pixels are
// measured and held to the recorded figure: a re-authored wear map that has moved
// changes the shipped hull's brightness, and that is a look someone has to decide
// rather than a number a build quietly carries.
const measured = await baseColorLumaByMaterial(document);
for (const [name, recorded] of Object.entries(asset.baseColorLuma)) {
	const got = measured.get(name) ?? 1;
	assert(
		Math.abs(got - recorded) < 1e-3,
		`${name}: its base colour map means ${got.toFixed(4)}, not the recorded ${recorded}. Re-record the figure on the node that re-authored the texture.`,
	);
}
const lifted = liftAuthoredHullPaint(document, measured);
const missing = asset.liftedPaints.filter(
	(name) => !lifted.some((row) => row.name === name),
);
assert.deepEqual(missing, [], "the study lost a paint the lift names");
const over = ceilingFailures(lifted);
assert.deepEqual(
	over.map(
		(row) =>
			`${row.name}: ${row.diffuse.toFixed(4)} > ${row.ceiling.toFixed(4)}`,
	),
	[],
	"a paint the lift brightened past the roster's painted hull",
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
const triple = (tint) =>
	tint
		.slice(0, 3)
		.map((v) => v.toFixed(3))
		.join(",");
for (const row of lifted)
	console.log(
		`lifted ${row.name}: tint ${triple(row.from.tint)} -> ${triple(row.to.tint)} (x${row.scale.toFixed(2)}), metalness ${row.from.metalness.toFixed(2)} -> ${row.to.metalness.toFixed(2)}` +
			(row.ceilingBound ? " [diffuse ceiling]" : ""),
	);
