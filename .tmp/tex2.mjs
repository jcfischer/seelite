import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read("src/models/courier-hull.glb");
for (const t of doc.getRoot().listTextures()) {
  const img = t.getImage();
  console.log(t.getName(), "bytes", img?.length, img?.slice(0, 16).toString("latin1").replace(/[^\x20-\x7e]/g, "."));
  const md = await sharp(img).metadata();
  console.log("  meta", JSON.stringify(md).slice(0, 200));
}
