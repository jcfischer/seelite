import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder": MeshoptDecoder});
const doc = await io.read("src/models/courier-cockpit.glb");
const EYE = [0, 0.3, 1.15];
const pts = [];
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial()?.getName() ?? "(none)";
    const pos = prim.getAttribute("POSITION"); if (!pos) continue;
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    const v=[0,0,0];
    for (let i=0;i<n;i++){ const j = idx ? idx.getScalar(i) : i; pos.getElement(j, v);
      const p = [v[0]-EYE[0], v[1]-EYE[1], v[2]-EYE[2]];
      pts.push({m, p, r: Math.hypot(p[0],p[1],p[2])});
    }
  }
const above = pts.filter(q => q.p[1] > 0.05 && q.p[2] < 0.6 && q.r < 3.0);
console.log("vertices above eye, forward-ish, within 3 m:", above.length);
const mats = new Map();
for (const q of above) mats.set(q.m, (mats.get(q.m)??0)+1);
console.log([...mats].map(([k,v])=>k+":"+v).join("  "));
// azimuth around the roll axis (x, y-elev): 0 = straight up, + = right
const bins = new Map();
for (const q of above) {
  const az = Math.atan2(q.p[0], q.p[1]);           // rad from vertical, + right
  const r = Math.hypot(q.p[0], q.p[1]);
  const key = (Math.round(az/(15*Math.PI/180))*15);
  const b = bins.get(key) ?? {n:0, r0:9e9, r1:-9e9, z0:9e9, z1:-9e9, y:0};
  b.n++; b.r0=Math.min(b.r0,r); b.r1=Math.max(b.r1,r);
  b.z0=Math.min(b.z0,q.p[2]); b.z1=Math.max(b.z1,q.p[2]); b.y+=q.p[1];
  bins.set(key, b);
}
const keys=[...bins.keys()].sort((a,b)=>a-b);
for (const k of keys) { const b=bins.get(k);
  console.log(`az ${String(k).padStart(4)}deg  n ${String(b.n).padStart(6)}  r ${b.r0.toFixed(2)}-${b.r1.toFixed(2)}  z ${b.z0.toFixed(2)}..${b.z1.toFixed(2)}  mean elev ${ (b.y/b.n).toFixed(2)}`); }
