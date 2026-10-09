// The game's Longwall B (node #815): the approved stowed export, Meshopt and
// lossless WebP, written to public/models/. No simplification, quantization or
// resize, so the shipped hull is the one the principal approved (#803).
//
//   node spikes/longwall-miner/prepare-flight-asset.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const source = 'spikes/longwall-miner/longwall-miner.glb';
const target = 'public/models/longwall-miner.glb';
const document = await io.read(source);
const pixels = async doc => Promise.all(doc.getRoot().listTextures().map(async texture => [
 texture.getName(), await sharp(texture.getImage()).ensureAlpha().raw().toBuffer(),
]));
const originalPixels = await pixels(document);
await document.transform(dedup(), reorder({encoder: MeshoptEncoder}), textureCompress({encoder: sharp, targetFormat: 'webp', lossless: true}));
// QUANTIZE selects the lossless NONE filter in glTF Transform (see the
// Coriolis script); FILTER would introduce lossy normal/rotation filters.
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
const attributes = doc => doc.getRoot().listMeshes().map(mesh => ({
 name: mesh.getName(),
 primitives: mesh.listPrimitives().map(primitive => Object.fromEntries(
  primitive.listSemantics().sort().map(semantic => [semantic, Array.from(primitive.getAttribute(semantic).getArray())]),
 )),
}));
// Node transforms to 10 µm: the writer drops a 2.4 µm child offset the export carries.
const round = values => values.map(v => Math.round(v * 1e5) / 1e5 + 0);
const nodes = doc => doc.getRoot().listNodes().map(node => [node.getName(), round(node.getTranslation()), round(node.getRotation()), round(node.getScale())]);
const beforeEncoding = attributes(document);
const beforeNodes = nodes(document);
await mkdir('public/models', {recursive: true});
await io.write(target, document);
const decoded = await io.read(target);
assert.deepEqual(attributes(decoded), beforeEncoding, 'Meshopt changed vertex attributes');
assert.deepEqual(nodes(decoded), beforeNodes, 'Encoding changed the mechanism hierarchy');
assert.deepEqual(await pixels(decoded), originalPixels, 'WebP changed texture pixels');
console.log(`Verified exact vertex attributes and texture pixels, node transforms to 10 µm; ${target} is ${((await stat(target)).size / 2 ** 20).toFixed(2)} MiB.`);
