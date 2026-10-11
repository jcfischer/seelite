import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
for (const file of ["courier-hull", "longwall-miner"]) {
 const doc = await io.read(`src/models/${file}.glb`);
 for (const t of doc.getRoot().listTextures()) {
  const { data, info } = await sharp(t.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let n = 0; const sum = [0,0,0];
  for (let i = 0; i < info.width*info.height; i += 97) { sum[0]+=data[i*4]; sum[1]+=data[i*4+1]; sum[2]+=data[i*4+2]; n++; }
  const mean = sum.map(v=>v/n/255);
  const lin = mean.map(v=> v<=0.04045? v/12.92 : ((v+0.055)/1.055)**2.4);
  console.log(file, t.getName(), "mean sRGB", mean.map(v=>v.toFixed(3)).join(","), "-> linear", lin.map(v=>v.toFixed(3)).join(","));
 }
}
