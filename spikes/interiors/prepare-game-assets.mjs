/** Production bundle for node #843. Full and reduced geometry stay in metres.
 * Positions and normals are quantised to 16 bits (KHR_mesh_quantization), then
 * Meshopt-compressed losslessly; paint is embedded lossless WebP, and vite
 * hashes the GLB. Unquantised, the file was 27,963,660 bytes, over Cloudflare
 * Pages' 25 MiB per-file limit, and the deploy of #843 failed on it.
 * Review sources and intermediate assets remain under spikes/.
 */
import { NodeIO, Document } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
	KHRMeshQuantization,
} from "@gltf-transform/extensions";
import {
	mergeDocuments,
	unpartition,
	dedup,
	reorder,
	quantize,
	textureCompress,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import assert from "node:assert/strict";
import { readFile, writeFile, stat } from "node:fs/promises";
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({
		"meshopt.encoder": MeshoptEncoder,
		"meshopt.decoder": MeshoptDecoder,
	});
const report = JSON.parse(
	await readFile("spikes/interiors/lod-report.json", "utf8"),
).modules;
const document = new Document();
const records = {};
// Compare against each source BEFORE optimisation, independent of vertex order.
/** Triangle count and world-space bounds of a scene, decoding normalised
 *  attributes, so a quantised scene is comparable with its float source. */
const shape = (scene) => {
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	let triangles = 0;
	const v = [0, 0, 0];
	for (const root of scene.listChildren())
		root.traverse((n) => {
			const mesh = n.getMesh();
			if (!mesh) return;
			const m = n.getWorldMatrix();
			for (const p of mesh.listPrimitives()) {
				triangles += p.getIndices().getCount() / 3;
				const pos = p.getAttribute("POSITION");
				for (let i = 0; i < pos.getCount(); i++) {
					pos.getElement(i, v);
					for (let a = 0; a < 3; a++) {
						const w =
							m[a] * v[0] + m[4 + a] * v[1] + m[8 + a] * v[2] + m[12 + a];
						if (w < lo[a]) lo[a] = w;
						if (w > hi[a]) hi[a] = w;
					}
				}
			}
		});
	return { triangles, bounds: [...lo, ...hi] };
};
const approved = new Map();
for (const [name, record] of Object.entries(report)) {
	records[name] = { full: record.full, levels: record.levels };
	for (const file of new Set([
		`${name}.glb`,
		...record.levels.map((l) => l.file),
	])) {
		const source = await io.read(`spikes/interiors/modules/${file}`);
		const scene = source.getRoot().listScenes()[0];
		approved.set(file, shape(scene));
		scene.setExtras({ interiorFile: file });
		mergeDocuments(document, source);
	}
}
const paintPixels = await sharp(document.getRoot().listTextures()[0].getImage())
	.ensureAlpha()
	.raw()
	.toBuffer();
await document.transform(
	unpartition(),
	dedup(),
	reorder({ encoder: MeshoptEncoder }),
	textureCompress({ encoder: sharp, targetFormat: "webp", lossless: true }),
	// UVs leave [0,1] here, so `quantize` keeps them float; it says so per mesh.
	quantize({ quantizePosition: 16, quantizeNormal: 16, quantizeTexcoord: 16 }),
);
document.createExtension(KHRMeshQuantization).setRequired(true);
const attributes = (doc) =>
	doc
		.getRoot()
		.listMeshes()
		.map((m) =>
			m.listPrimitives().map((p) =>
				Object.fromEntries(
					p
						.listSemantics()
						.sort()
						.map((s) => [s, Array.from(p.getAttribute(s).getArray())]),
				),
			),
		);
const before = attributes(document);
document
	.createExtension(EXTMeshoptCompression)
	.setRequired(true)
	.setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const target = "src/models/station-interiors.glb";
await io.write(target, document);
const decoded = await io.read(target);
assert.deepEqual(
	attributes(decoded),
	before,
	"Meshopt changed vertex attributes",
);
assert.equal(decoded.getRoot().listScenes().length, 46);
// Quantisation moves vertices by up to half a step of each mesh's own
// extent, so the packed scenes are held to the sources by triangle count and
// world-space bounds within QUANTISED_BOUNDS_M rather than exactly.
const QUANTISED_BOUNDS_M = 0.002;
for (const scene of decoded.getRoot().listScenes()) {
	const file = scene.getExtras().interiorFile;
	const want = approved.get(file);
	const got = shape(scene);
	assert.equal(got.triangles, want.triangles, `${file}: triangle count`);
	for (let i = 0; i < 6; i++)
		assert.ok(
			Math.abs(got.bounds[i] - want.bounds[i]) <= QUANTISED_BOUNDS_M,
			`${file}: bound ${i} moved ${got.bounds[i] - want.bounds[i]} m`,
		);
}
for (const t of decoded.getRoot().listTextures())
	assert.deepEqual(
		await sharp(t.getImage()).ensureAlpha().raw().toBuffer(),
		paintPixels,
		"WebP changed paint pixels",
	);
await writeFile(
	"src/interior-lod-records.json",
	JSON.stringify(records, null, 2) + "\n",
);
console.log(
	`46 fitting scenes, exact encoded attributes and paint pixels; ${(await stat(target)).size} bytes.`,
);
