// The game's seven-ship exteriors, one role at a time (node #1034 is the
// interceptor, the Lance). Run after the study exports its full `model.glb`:
// modelled on `spikes/courier-hull/prepare-game-asset.mjs`. Only the full
// model ships; `model-reduced.glb` and `model-outline.glb` stay here as
// reference, because the game makes its own distance levels
// (`src/authored-levels.ts`).
//
//   node spikes/seven-ships/prepare-game-asset.mjs interceptor
//
// Quantises normals to 16 bits; out-of-range UVs remain float32. Positions, triangles and
// texture pixels remain exact: Meshopt with the lossless NONE filter and lossless
// WebP. No simplification, resize or paint change. The study is metres, Y up,
// +Z forward, like every authored hull: the one conversion to the game's
// kilometres and -Z nose is the install's (`src/interceptor-hull.ts`), not this
// script's.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
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

const SHIPPED = {
	interceptor: "src/models/lance-interceptor.glb",
};
const MAX_BYTES = 25_000_000;
const role = process.argv[2] ?? "interceptor";
if (!SHIPPED[role])
	throw new Error(
		`no shipping asset for "${role}": ${Object.keys(SHIPPED).join(", ")}`,
	);
const source = `spikes/seven-ships/${role}/model.glb`;
const target = SHIPPED[role];

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const document = await io.read(source);
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
document.createExtension(KHRMeshQuantization).setRequired(true);
// QUANTIZE selects the lossless NONE filter in glTF Transform; FILTER would
// introduce lossy normal/rotation filters.
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
	await pixels(decoded),
	originalPixels,
	"WebP changed texture pixels",
);
const bytes = (await stat(target)).size;
assert(
	bytes < MAX_BYTES,
	`${target} is ${bytes} bytes, not under ${MAX_BYTES}`,
);
const sha256 = createHash("sha256")
	.update(await readFile(target))
	.digest("hex");
console.log(
	"Verified the Meshopt round trip of every vertex attribute, and exact texture pixels.",
);
console.log(
	`${target}: ${bytes} bytes (${(bytes / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}`,
);
