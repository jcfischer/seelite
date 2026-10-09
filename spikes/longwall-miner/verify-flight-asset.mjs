// Check the shipped Longwall B against the approved export without writing
// anything (node #815, sage round 8): the same triangles, every attribute of
// every corner exact, in the same meshes with the same materials.
//
//   node spikes/longwall-miner/verify-flight-asset.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import assert from 'node:assert/strict';
import { triangleSoup } from './triangle-soup.mjs';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const approved = triangleSoup(await io.read('spikes/longwall-miner/longwall-miner.glb'));
const shipped = triangleSoup(await io.read('src/models/longwall-miner.glb'));
assert.deepEqual(Object.keys(shipped).sort(), Object.keys(approved).sort(), 'the meshes or their materials differ');
let triangles = 0;
for (const [key, list] of Object.entries(approved)) {
 assert.deepEqual(shipped[key], list, `${key}: the triangles differ`);
 triangles += list.length;
}
console.log(`Verified ${triangles} triangles in ${Object.keys(approved).length} primitives: the shipped file draws the approved export's triangles, every attribute exact.`);
