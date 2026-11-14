// The game's seven-ship exteriors, one role at a time (node #1034 is the
// interceptor, the Lance). Run after the study exports its full `model.glb`:
// modelled on `spikes/courier-hull/prepare-game-asset.mjs`. Only the full
// model ships; `model-reduced.glb` and `model-outline.glb` stay here as
// reference, because the game makes its own distance levels
// (`src/authored-levels.ts`).
//
//   node spikes/seven-ships/prepare-game-asset.mjs <role> [source.glb]
//
// The source is `spikes/seven-ships/<role>/model.glb` (Git LFS) unless a path
// is given. The Bastion alone takes the lossy-UV recipe the principal approved
// on 2026-11-13 (node #1035): every UV set is stored as normalised 16-bit under
// one `KHR_texture_transform` per base-colour texture, and the wear map is
// lossy WebP, embedded rather than shared (the shared-image script refuses a
// texture transform). Positions and triangles stay exact; the script measures
// the UV and pixel error and asserts it. Every other hull stays lossless.
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
	KHRTextureTransform,
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
	patrol: "src/models/warden-patrol.glb",
	explorer: "src/models/pilgrim-explorer.glb",
	raider: "src/models/shiv-raider.glb",
	carrier: "src/models/bastion-carrier.glb",
	prospector: "src/models/sluice-prospector.glb",
};
const LOSSY_UV = new Set(["carrier"]);
const WEBP_QUALITY = 80;
const UV_STEP_TOLERANCE = 1.0;
const PIXEL_MEAN_TOLERANCE = 3;
const MAX_BYTES = 25_000_000;
const role = process.argv[2] ?? "interceptor";
if (!SHIPPED[role])
	throw new Error(
		`no shipping asset for "${role}": ${Object.keys(SHIPPED).join(", ")}`,
	);
const source = process.argv[3] ?? `spikes/seven-ships/${role}/model.glb`;
const lossy = LOSSY_UV.has(role);
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

function uvArrays(doc) {
	return [
		...new Set(
			doc
				.getRoot()
				.listMeshes()
				.flatMap((mesh) => mesh.listPrimitives())
				.map((primitive) => primitive.getAttribute("TEXCOORD_0"))
				.filter(Boolean),
		),
	].map((accessor) => {
		const out = new Float32Array(accessor.getCount() * 2);
		const pair = [0, 0];
		for (let i = 0; i < accessor.getCount(); i++) {
			accessor.getElement(i, pair);
			out[i * 2] = pair[0];
			out[i * 2 + 1] = pair[1];
		}
		return out;
	});
}

function quantiseUvs(doc) {
	const accessors = [
		...new Set(
			doc
				.getRoot()
				.listMeshes()
				.flatMap((mesh) => mesh.listPrimitives())
				.map((primitive) => primitive.getAttribute("TEXCOORD_0"))
				.filter(Boolean),
		),
	];
	const min = [Infinity, Infinity];
	const max = [-Infinity, -Infinity];
	for (const accessor of accessors) {
		const a = accessor.getArray();
		for (let i = 0; i < a.length; i += 2)
			for (let k = 0; k < 2; k++) {
				min[k] = Math.min(min[k], a[i + k]);
				max[k] = Math.max(max[k], a[i + k]);
			}
	}
	const scale = [max[0] - min[0], max[1] - min[1]];
	for (const accessor of accessors) {
		const a = accessor.getArray();
		const q = new Uint16Array(a.length);
		for (let i = 0; i < a.length; i += 2)
			for (let k = 0; k < 2; k++)
				q[i + k] = Math.round(((a[i + k] - min[k]) / scale[k]) * 65535);
		accessor.setArray(q).setNormalized(true);
	}
	const extension = doc.createExtension(KHRTextureTransform).setRequired(true);
	for (const material of doc.getRoot().listMaterials()) {
		const info = material.getBaseColorTextureInfo();
		if (!info) continue;
		info.setExtension(
			"KHR_texture_transform",
			extension.createTransform().setOffset(min).setScale(scale),
		);
	}
	return { min, scale };
}
await document.transform(
	dedup(),
	reorder({ encoder: MeshoptEncoder }),
	quantize({
		pattern: lossy ? /^NORMAL$/ : /^(NORMAL|TEXCOORD_\d+)$/,
		quantizeNormal: 16,
		quantizeTexcoord: 16,
	}),
	textureCompress({
		encoder: sharp,
		targetFormat: "webp",
		lossless: !lossy,
		quality: WEBP_QUALITY,
	}),
);
const originalUvs = lossy ? uvArrays(document) : [];
const uvRange = lossy ? quantiseUvs(document) : null;
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
const stripUv = (list) =>
	list.map((mesh) => ({
		...mesh,
		primitives: mesh.primitives.map(({ TEXCOORD_0: _uv, ...rest }) => rest),
	}));
const beforeEncoding = lossy
	? stripUv(attributes(document))
	: attributes(document);
await mkdir("src/models", { recursive: true });
await io.write(target, document);
const decoded = await io.read(target);
assert.deepEqual(
	lossy ? stripUv(attributes(decoded)) : attributes(decoded),
	beforeEncoding,
	"Meshopt changed vertex attributes",
);
let measured = "exact texture pixels";
if (lossy) {
	const { min, scale } = uvRange;
	const decodedUvs = uvArrays(decoded);
	assert.equal(decodedUvs.length, originalUvs.length);
	let worstUv = 0;
	for (const [n, list] of decodedUvs.entries())
		for (let i = 0; i < list.length; i++) {
			const k = i % 2;
			const back = min[k] + list[i] * scale[k];
			worstUv = Math.max(worstUv, Math.abs(back - originalUvs[n][i]));
		}
	const stepUv = Math.max(scale[0], scale[1]) / 65535;
	assert(
		worstUv <= stepUv * UV_STEP_TOLERANCE,
		`UV error ${worstUv} is over ${UV_STEP_TOLERANCE} quantisation step (${stepUv})`,
	);
	let sum = 0;
	let count = 0;
	for (const [i, [, after]] of (await pixels(decoded)).entries()) {
		const before = originalPixels[i][1];
		for (let j = 0; j < before.length; j++) {
			sum += Math.abs(before[j] - after[j]);
			count++;
		}
	}
	const meanErr = sum / count;
	assert(
		meanErr <= PIXEL_MEAN_TOLERANCE,
		`WebP mean error ${meanErr} is over ${PIXEL_MEAN_TOLERANCE} of 255`,
	);
	measured = `UV error ${worstUv.toExponential(3)} (step ${stepUv.toExponential(3)}, range ${scale.map((x) => x.toFixed(3))}), lossy WebP q${WEBP_QUALITY} mean pixel error ${meanErr.toFixed(3)}/255`;
} else
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
	`Verified the Meshopt round trip of every vertex attribute, and ${measured}.`,
);
console.log(
	`${target}: ${bytes} bytes (${(bytes / 2 ** 20).toFixed(2)} MiB), sha256 ${sha256}`,
);
