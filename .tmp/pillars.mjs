import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder": MeshoptDecoder});
const doc = await io.read("src/models/courier-cockpit.glb");
const EYE = [0, 0.3, 1.15];
const FRAME = new Set(["weathered-blue-steel","exposed-machined-edges"]);
const pts = [];
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial()?.getName() ?? "(none)";
    if (!FRAME.has(m)) continue;
    const pos = prim.getAttribute("POSITION"); if (!pos) continue;
    const idx = prim.getIndices(); const n = idx ? idx.getCount() : pos.getCount();
    const v=[0,0,0];
    for (let i=0;i<n;i++){ const j = idx ? idx.getScalar(i) : i; pos.getElement(j, v);
      pts.push([v[0]-EYE[0], v[1]-EYE[1], v[2]-EYE[2]]); }
  }
// Pillar band: above eye height, forward, between 0.85 and 1.8 m out.
const band = pts.filter(p => p[1] > 0.05 && p[2] < -0.2 && Math.hypot(p[0],p[1],p[2]) > 0.8 && Math.hypot(p[0],p[1],p[2]) < 1.8);
for (const side of [-1, 1]) {
  const half = band.filter(p => Math.sign(p[0]) === side);
  half.sort((a,b)=>a[2]-b[2]);
  const z0 = half[0][2], z1 = half[half.length-1][2];
  const cuts = [0.15, 0.5, 0.85];
  console.log(`side ${side}  n ${half.length}  z ${z0.toFixed(2)}..${z1.toFixed(2)}`);
  for (const f of cuts) {
    const target = z0 + (z1-z0)*f;
    const near = half.filter(p => Math.abs(p[2]-target) < 0.12);
    if (!near.length) { console.log(`   f=${f} no geometry near z ${target.toFixed(2)}`); continue; }
    const avg = i => near.reduce((s,p)=>s+p[i],0)/near.length;
    const r = Math.hypot(avg(0), avg(1), avg(2));
    console.log(`   f=${f.toFixed(2)}  lamp (${avg(0).toFixed(2)}, ${avg(1).toFixed(2)}, ${avg(2).toFixed(2)})  r ${r.toFixed(2)}  n ${near.length}`);
  }
}
