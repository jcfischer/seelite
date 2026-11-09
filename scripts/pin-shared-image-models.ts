/**
 * Records what each shared-image model decodes to, for `tests/shared-image.test.ts`.
 * Run on purpose after a geometry or material change, while the model still embeds
 * its image: https://github.com/jcfischer/seelite/issues/1222
 */
import { writeFileSync } from "node:fs";
import { glbDigest } from "./lib/glb-digest";
import { INDUSTRIAL_SURFACE } from "./share-model-image.mjs";

const pinned: Record<string, unknown> = {};
for (const model of INDUSTRIAL_SURFACE.models)
	pinned[model] = await glbDigest(`src/models/${model}.glb`);
writeFileSync(
	"tests/fixtures/shared-image-originals.json",
	`${JSON.stringify(pinned, null, "\t")}\n`,
);
