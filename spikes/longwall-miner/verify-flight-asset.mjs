// Check the shipped Longwall B against the approved export without writing
// anything (node #815, sage round 8): the same triangles, every attribute of
// every corner exact, in the same meshes with the same materials — where
// `same materials` has carried node #887's paint lift on the study's side too,
// because `triangle-soup.mjs` keys each primitive by its material's factors and
// the shipped file is written through that lift by `prepare-flight-asset.mjs`.
//
//   node spikes/longwall-miner/verify-flight-asset.mjs

import assert from "node:assert/strict";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { liftAuthoredHullPaint } from "../../scripts/lib/authored-hull-paint.mjs";
import { baseColorLumaByMaterial } from "../../scripts/lib/texture-luma.mjs";
import { triangleSoup } from "./triangle-soup.mjs";

await MeshoptDecoder.ready;
const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const study = await io.read("spikes/longwall-miner/longwall-miner.glb");
// The same lift, from the same measured maps, that `prepare-flight-asset.mjs`
// writes: `triangle-soup.mjs` keys a primitive by its material's factors, so
// checking an unlifted study against a lifted file compares two paint jobs.
liftAuthoredHullPaint(study, await baseColorLumaByMaterial(study));
const approved = triangleSoup(study);
const shipped = triangleSoup(await io.read("src/models/longwall-miner.glb"));
assert.deepEqual(
	Object.keys(shipped).sort(),
	Object.keys(approved).sort(),
	"the meshes or their materials differ",
);
let triangles = 0;
for (const [key, list] of Object.entries(approved)) {
	assert.deepEqual(shipped[key], list, `${key}: the triangles differ`);
	triangles += list.length;
}
console.log(
	`Verified ${triangles} triangles in ${Object.keys(approved).length} primitives: the shipped file draws the approved export's triangles, every attribute exact.`,
);
