/**
 * Records what the named models decode to, for `tests/shared-image.test.ts`.
 * Run on purpose after a geometry or material change, while the model still
 * embeds its image: https://github.com/jcfischer/seelite/issues/1222
 *
 *   bun scripts/pin-shared-image-models.ts trade-drum
 */
import { readFileSync, writeFileSync } from "node:fs";
import { glbDigest } from "./lib/glb-digest";
import { INDUSTRIAL_SURFACE, STEEL_WEAR } from "./share-model-image.mjs";

const FILE = "tests/fixtures/shared-image-originals.json";
const models = process.argv.slice(2);
if (!models.length) throw new Error("name the models to pin");
const pinned = JSON.parse(readFileSync(FILE, "utf8"));
for (const model of models) {
	const shared = [INDUSTRIAL_SURFACE, STEEL_WEAR].find((image) =>
		image.models.includes(model),
	);
	if (!shared) throw new Error(`${model} does not use a shared image`);
	const path = `src/models/${model}.glb`;
	const file = readFileSync(path);
	const json = JSON.parse(
		file.subarray(20, 20 + file.readUInt32LE(12)).toString(),
	);
	if (!json.images)
		throw new Error(`${model} is already prepared; pin it before preparing it`);
	pinned[model] = await glbDigest(path);
}
writeFileSync(FILE, `${JSON.stringify(pinned, null, "\t")}\n`);
