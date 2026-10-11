import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read("src/models/courier-hull.glb");
for (const t of doc.getRoot().listTextures()) {
  const { data, width, height } = await sharp(t.getImage()).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  let n = 0; const sum = [0, 0, 0];
  for (let i = 0; i < width * height; i += 97) { sum[0] += data[i*4]; sum[1] += data[i*4+1]; sum[2] += data[i*4+2]; n++; }
  console.log((t.getName()||"?").padEnd(24), width+"x"+height, "mean sRGB", sum.map(v=>Math.round(v/n)).join(","));
}
for (const m of doc.getRoot().listMaterials()) {
  const n = m.getName(), t = m.getBaseColorTexture();
  const f = m.getBaseColorFactor();
  console.log(n.padEnd(24), t ? "mapped" : "unmapped", f.map(v=>v.toFixed(3)).join(","));
}
