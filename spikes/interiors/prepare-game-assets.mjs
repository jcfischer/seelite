/** Production bundle for node #843. Full and reduced geometry stay in metres.
 * Meshopt is lossless, paint is embedded lossless WebP, and vite hashes the GLB.
 * Review sources and intermediate assets remain under spikes/.
 */
import { NodeIO, Document } from "@gltf-transform/core";
import {
	ALL_EXTENSIONS,
	EXTMeshoptCompression,
} from "@gltf-transform/extensions";
import {
	mergeDocuments,
	unpartition,
	dedup,
	reorder,
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
const soup = (scene) => {
	const rows = [];
	for (const node of scene.listChildren())
		node.traverse((n) => {
			const mesh = n.getMesh();
			if (!mesh) return;
			for (const p of mesh.listPrimitives()) {
				const semantics = p.listSemantics().sort();
				const attributes = semantics.map((s) => p.getAttribute(s));
				const indices = p.getIndices().getArray();
				const corner = (i) =>
					attributes
						.map((a) =>
							Array.from(
								a
									.getArray()
									.subarray(
										i * a.getElementSize(),
										(i + 1) * a.getElementSize(),
									),
							).join(","),
						)
						.join("|");
				const triangles = [];
				for (let t = 0; t < indices.length; t += 3) {
					const corners = [
						corner(indices[t]),
						corner(indices[t + 1]),
						corner(indices[t + 2]),
					];
					triangles.push(
						[0, 1, 2]
							.map((start) =>
								[0, 1, 2].map((i) => corners[(start + i) % 3]).join("/"),
							)
							.sort()[0],
					);
				}
				rows.push(JSON.stringify([n.getName(), semantics, triangles.sort()]));
			}
		});
	return rows.sort();
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
		approved.set(file, soup(scene));
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
);
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
for (const scene of decoded.getRoot().listScenes())
	assert.deepEqual(
		soup(scene),
		approved.get(scene.getExtras().interiorFile),
		"Packing changed source triangle attributes or winding",
	);
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
