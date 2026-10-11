import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { baseColorLumaByMaterial } from "../scripts/lib/texture-luma.mjs";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
for (const f of ["spikes/courier-hull/courier-hull.glb", "spikes/longwall-miner/longwall-miner.glb"]) {
  const doc = await io.read(f);
  const m = await baseColorLumaByMaterial(doc);
  console.log("==", f);
  const by = new Map();
  for (const [name, v] of m) if (!by.has(v)) by.set(v, []);
  for (const [name, v] of m) by.get(v).push(name);
  for (const [v, names] of by) console.log("  ", v.toFixed(4), "->", names.filter(n=>/structure|alloy|rail|pale|blue-grey/.test(n)).join(", "));
}
