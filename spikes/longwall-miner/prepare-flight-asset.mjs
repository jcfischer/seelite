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
import {
	AUTHORED_HULL_ASSETS,
	ceilingFailures,
	liftAuthoredHullPaint,
} from "../../scripts/lib/authored-hull-paint.mjs";
import { baseColorLumaByMaterial } from "../../scripts/lib/texture-luma.mjs";
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
const document = await io.read(source);
// Node #887: the study's paints were lit for its own viewer. The lift runs
// before `approved` is taken so the geometry check below compares the approved
// export's triangles under the same paints the shipped file carries —
// `triangle-soup.mjs` keys each primitive by its material's factors, so a
// document lifted after that read would make this assert on two paint jobs.
const asset = AUTHORED_HULL_ASSETS.find((a) => a.shipped === target);
// The lift's brightness depends on each paint's base colour map, so the pixels are
// measured and held to the recorded figure: this export carries no map on two of
// these paints and one on three, and that difference is why the same rule lands
// twice as bright here as on the courier.
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
assert.deepEqual(
	missing,
	[],
	"the approved export lost a paint the lift names",
);
const over = ceilingFailures(lifted);
assert.deepEqual(
	over.map(
		(row) =>
			`${row.name}: ${row.diffuse.toFixed(4)} > ${row.ceiling.toFixed(4)}`,
	),
	[],
	`a paint the lift brightened past the roster's painted hull`,
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
