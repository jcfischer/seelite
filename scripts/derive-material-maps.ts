import { mkdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { deriveMaterialMaps } from "./lib/derive-material-maps";

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

const glb = await readFile(join(root, "src/models/courier-hull.glb"));
if (glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2)
	throw new Error("Expected a glTF 2 binary");
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString());
for (const material of gltf.materials) {
	const index = material.pbrMetallicRoughness?.baseColorTexture?.index;
	if (index === undefined || material.name?.startsWith("cockpit-")) continue;
	const texture = gltf.textures[index];
	if ((texture.extensions?.EXT_texture_webp?.source ?? texture.source) !== 0)
		throw new Error(
			`Exterior material ${material.name} does not use image 0; stop and escalate`,
		);
}
const view = gltf.bufferViews[gltf.images[0].bufferView];
const start = 20 + jsonLength + 8 + (view.byteOffset ?? 0);
const image = glb.subarray(start, start + view.byteLength);
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
		source: "src/models/courier-hull.glb image 0",
		tile: [info.width, info.height],
		normal: normalPath,
		height: heightPath,
	}),
);
