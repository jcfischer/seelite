import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder": MeshoptDecoder});
const doc = await io.read("src/models/courier-hull.glb");
const EYE = [0.0, 1.142598, -0.042246];
const groups = new Map();
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial()?.getName() ?? "(none)";
    if (!/cockpit|canopy|pilot/.test(m)) continue;
    const pos = prim.getAttribute("POSITION");
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const g = groups.get(m) ?? { tris: 0, min: [9,9,9], max: [-9,-9,-9], radii: [] };
    for (let i = 0; i < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = idx ? idxScalar(idx, i+k) : i+k;
        const v = [0,0,0]; pos.getElement(j, v);
        for (let c=0;c<3;c++){ g.min[c]=Math.min(g.min[c],v[c]); g.max[c]=Math.max(g.max[c],v[c]); }
        const d = Math.hypot(v[0]-EYE[0], v[1]-EYE[1], v[2]-EYE[2]);
        g.radii.push(d);
      }
    }
    g.tris += n/3;
    groups.set(m, g);
  }
function idxScalar(idx, i){ return idx.getScalar(i); }
for (const [m, g] of groups) {
  g.radii.sort((a,b)=>a-b);
  const q = f => g.radii[Math.floor(f*(g.radii.length-1))].toFixed(2);
  console.log(m.padEnd(32), String(g.tris).padStart(6),
    "x", g.min[0].toFixed(2), g.max[0].toFixed(2),
    " y", g.min[1].toFixed(2), g.max[1].toFixed(2),
    " z", g.min[2].toFixed(2), g.max[2].toFixed(2),
    " | r to eye q10/50/90", q(0.1), q(0.5), q(0.9));
}
