// Run after Blender's --flight export. No simplification, quantization or resize.
// Scale detail ships in its own file: https://github.com/jcfischer/seelite/issues/1142
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { cloneDocument, dedup, prune, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
});
const document = await io.read('.dream-loop/coriolis-industrial-flight.glb');
const pixels = async doc => Promise.all(doc.getRoot().listTextures().map(async texture => [
 texture.getName(), await sharp(texture.getImage()).ensureAlpha().raw().toBuffer(),
]));
const originalPixels = await pixels(document);
await document.transform(dedup(), reorder({encoder: MeshoptEncoder}), textureCompress({encoder: sharp, targetFormat: 'webp', lossless: true}));
const digest = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
const attributes = doc => doc.getRoot().listMeshes().map(mesh => ({
 name: mesh.getName(),
 primitives: mesh.listPrimitives().map(primitive => Object.fromEntries(
  primitive.listSemantics().sort().map(semantic => [semantic, digest(primitive.getAttribute(semantic).getArray())]),
 )),
}));
const isDetail = node => node.getName().startsWith('scale-detail-');
const beforeEncoding = attributes(document);
const detail = cloneDocument(document);
for (const node of document.getRoot().listNodes()) if (isDetail(node)) node.dispose();
for (const node of detail.getRoot().listNodes()) if (!isDetail(node)) node.dispose();
for (const material of detail.getRoot().listMaterials()) {
 const texture = material.getBaseColorTexture();
 if (!texture) continue;
 material.setExtras({...material.getExtras(), baseColorMap: texture.getName()});
 material.setBaseColorTexture(null);
}
await document.transform(prune({keepAttributes: true}));
await detail.transform(prune({keepAttributes: true}));
assert.equal(detail.getRoot().listTextures().length, 0, 'detail file carries an image');
// QUANTIZE selects the lossless NONE filter in glTF Transform. It expects a
// caller to run quantize() first if desired; we deliberately do not. FILTER
// would introduce lossy normal/rotation filters. Verify the decoded arrays.
for (const doc of [document, detail])
 doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method: EXTMeshoptCompression.EncoderMethod.QUANTIZE});
await mkdir('src/models', {recursive: true});
await io.write('src/models/coriolis.glb', document);
await io.write('src/models/coriolis-detail.glb', detail);
const decoded = await io.read('src/models/coriolis.glb');
const decodedDetail = await io.read('src/models/coriolis-detail.glb');
const byName = list => [...list].sort((a, b) => a.name.localeCompare(b.name));
assert.deepEqual(
 byName([...attributes(decoded), ...attributes(decodedDetail)]),
 byName(beforeEncoding),
 'Meshopt or the split changed vertex attributes',
);
assert.deepEqual(await pixels(decoded), originalPixels, 'WebP changed texture pixels');
console.log('Verified exact vertex attributes across both files and texture pixels after encoding/decoding.');
