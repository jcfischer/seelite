import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
for (const file of ["courier-hull", "longwall-miner"]) {
 const doc = await io.read(`src/models/${file}.glb`);
 const texId = new Map(); let i = 0;
 for (const t of doc.getRoot().listTextures()) texId.set(t, `${t.getName()}#${i++}`);
 console.log("==", file);
 for (const m of doc.getRoot().listMaterials()) {
  const bc = m.getBaseColorTexture(); const mr = m.getMetallicRoughnessTexture();
  const f = m.getBaseColorFactor();
  console.log("  ", m.getName().padEnd(32), (bc? texId.get(bc):"unmapped").padEnd(16), (mr? texId.get(mr):"—").padEnd(16), "f", f.slice(0,3).map(v=>v.toFixed(3)).join(","), "metal", m.getMetallicFactor());
 }
}
