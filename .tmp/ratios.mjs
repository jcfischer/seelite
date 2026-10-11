import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { tintLuma } from "../scripts/lib/authored-hull-paint.mjs";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder": MeshoptDecoder});
const s = await io.read("spikes/courier-hull/courier-hull.glb");
const p = await io.read("src/models/courier-hull.glb");
const get = d => new Map(d.getRoot().listMaterials().map(m => [m.getName(), m]));
const a = get(s), b = get(p);
for (const n of ["dark-structure","machined-alloy","brushed-rail","pale-steel-0","pale-steel-1","blue-grey-0","blue-grey-1","blue-grey-2","blue-grey-3"]) {
  const f = a.get(n), t = b.get(n);
  const before = tintLuma(f.getBaseColorFactor()) * (1 - f.getMetallicFactor());
  const after = tintLuma(t.getBaseColorFactor()) * (1 - t.getMetallicFactor());
  console.log(n.padEnd(16), before.toFixed(4), "->", after.toFixed(4), (after/before).toFixed(2)+"x");
}
