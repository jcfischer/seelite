import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder": MeshoptDecoder});
const doc = await io.read("src/models/courier-cockpit.glb");
const acc = (prim, name) => prim.getAttribute(name);
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial()?.getName() ?? "(none)";
    const pos = acc(prim, "POSITION"); if (!pos) continue;
    const v = [0,0,0];
    let min=[9e9,9e9,9e9], max=[-9e9,-9e9,-9e9];
    for (let i=0;i<pos.getCount();i++){ pos.getElement(i,v); for(let c=0;c<3;c++){min[c]=Math.min(min[c],v[c]);max[c]=Math.max(max[c],v[c]);} }
    console.log(m.padEnd(28), "n", String(pos.getCount()).padStart(6),
      " x", min[0].toFixed(2), max[0].toFixed(2),
      " y", min[1].toFixed(2), max[1].toFixed(2),
      " z", min[2].toFixed(2), max[2].toFixed(2));
  }
console.log("materials:");
for (const mat of doc.getRoot().listMaterials())
  console.log("  ", mat.getName().padEnd(28), "emissive", JSON.stringify(mat.getEmissiveFactor().map(n=>+n.toFixed(2))), "strength", mat.getEmissiveStrength());
