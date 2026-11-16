import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { deriveMaterialMaps } from "./lib/derive-material-maps";
import { readSharedModel } from "./lib/shared-image-io.mjs";
import { STEEL_WEAR } from "./share-model-image.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		out: { type: "string" },
		"normal-out": { type: "string" },
	},
});
if (!values.out)
	throw new Error(
		"Usage: bun scripts/derive-material-maps.ts --out <height-output-directory> [--normal-out <path>]",
	);
const output = resolve(values.out);
await mkdir(output, { recursive: true });
const actual = await realpath(output);
const sourceDirectory = await realpath(join(root, "src"));
if (actual === sourceDirectory || actual.startsWith(sourceDirectory + "/"))
	throw new Error("Height output must be outside src so it cannot be bundled");

const io = new NodeIO()
	.registerExtensions(ALL_EXTENSIONS)
	.registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const document: Document = await readSharedModel(
	io,
	join(root, "src/models/courier-hull.glb"),
);
const texture = document
	.getRoot()
	.listTextures()
	.find((texture) => texture.getName() === STEEL_WEAR.name);
const image = texture?.getImage();
if (!image) throw new Error("Courier exterior steel image is missing");
for (const material of document.getRoot().listMaterials()) {
	const map = material.getBaseColorTexture();
	if (!map || material.getName().startsWith("cockpit-")) continue;
	if (map !== texture)
		throw new Error(
			`Exterior material ${material.getName()} does not use ${STEEL_WEAR.name}; stop and escalate`,
		);
}
const { data, info } = await sharp(image)
	.removeAlpha()
	.toColourspace("srgb")
	.raw()
	.toBuffer({ resolveWithObject: true });
const maps = deriveMaterialMaps(data, info.width, info.height);
const normalPath = resolve(
	values["normal-out"] ??
		join(root, "src/models/courier-steel-wear-normal.webp"),
);
await sharp(maps.normal, {
	raw: { width: info.width, height: info.height, channels: 3 },
})
	.resize(Math.round(info.width / 2), Math.round(info.height / 2))
	.webp({ quality: 88 })
	.toFile(normalPath);
const heightPath = join(output, "courier-steel-wear-height.png");
await sharp(maps.height, {
	raw: { width: info.width, height: info.height, channels: 1 },
})
	.png()
	.toFile(heightPath);
console.log(
	JSON.stringify({
		source: `src/models/courier-hull.glb ${STEEL_WEAR.name}`,
		tile: [info.width, info.height],
		normal: normalPath,
		height: heightPath,
	}),
);
