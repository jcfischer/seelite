import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, reorder, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { triangleSoup } from "../../longwall-miner/triangle-soup.mjs";

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
	"meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder,
});
const source = new URL("blocks.glb", import.meta.url);
const target = new URL("../../../src/models/trade-assembly.glb", import.meta.url);
const document = await io.read(fileURLToPath(source));
const before = triangleSoup(document);
const pixels = async (doc) => Promise.all(doc.getRoot().listTextures().map(async (t) =>
	(await sharp(t.getImage()).ensureAlpha().raw().toBuffer()).toString("base64")));
const originalPixels = await pixels(document);
const attributes = (doc) => doc.getRoot().listMeshes().map((mesh) => ({
	name: mesh.getName(),
	primitives: mesh.listPrimitives().map((p) => Object.fromEntries(p.listSemantics().sort().map((s) => [s, Array.from(p.getAttribute(s).getArray())]))),
}));
await document.transform(dedup(), reorder({ encoder: MeshoptEncoder }), textureCompress({ encoder: sharp, targetFormat: "webp", lossless: true }));
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
const beforeEncoding = attributes(document);
await io.write(fileURLToPath(target), document);
const decoded = await io.read(fileURLToPath(target));
assert.deepEqual(attributes(decoded), beforeEncoding, "Meshopt changed vertex attributes");
assert.deepEqual(triangleSoup(decoded), before, "Shipping triangles differ from the Blender kit");
assert.deepEqual(await pixels(decoded), originalPixels, "Shipping texture pixels differ");
const { size } = await stat(target);
assert(size < 25_000_000, "Shipping kit exceeds the node's size limit");
const sha256 = createHash("sha256").update(await readFile(target)).digest("hex");
await writeFile(new URL("flight-asset.json", import.meta.url), JSON.stringify({ bytes: size, sha256, sourceSha256: createHash("sha256").update(await readFile(source)).digest("hex"), units: "km", encoding: "Meshopt NONE filter and lossless WebP; triangle and pixel round-trip checked" }, null, 2) + "\n");
console.log(`Verified full Assembly kit: ${size} bytes, sha256 ${sha256}`);
