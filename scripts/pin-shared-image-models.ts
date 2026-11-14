/**
 * Records what the named models decode to, for `tests/shared-image.test.ts`.
 * Run on purpose after a geometry or material change, while the model still
 * embeds its image: https://github.com/jcfischer/seelite/issues/1222
 *
 *   bun scripts/pin-shared-image-models.ts trade-drum
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { glbDigest } from "./lib/glb-digest";
import { SHARED_MODEL_IMAGES, shareImage } from "./share-model-image.mjs";

const FILE = "tests/fixtures/shared-image-originals.json";
const models = process.argv.slice(2);
if (!models.length) throw new Error("name the models to pin");
const pinned = JSON.parse(readFileSync(FILE, "utf8"));
for (const model of models) {
	const image = SHARED_MODEL_IMAGES.find((image) =>
		image.models.includes(model),
	);
	if (!image) throw new Error(`${model} does not use the shared image`);
	const path = `src/models/${model}.glb`;
	const file = readFileSync(path);
	const json = JSON.parse(
		file.subarray(20, 20 + file.readUInt32LE(12)).toString(),
	);
	if (
		json.textures?.some(
			(t: any) => t.extensions?.SEELITE_shared_image?.sha256 === image.sha256,
		)
	)
		throw new Error(`${model} is already prepared; pin it before preparing it`);
	pinned[model] = {
		...(await glbDigest(path)),
		preparedSha256: createHash("sha256")
			.update(shareImage(file, image.sha256).bytes)
			.digest("hex"),
	};
}
writeFileSync(FILE, `${JSON.stringify(pinned, null, "\t")}\n`);
