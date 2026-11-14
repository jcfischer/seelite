import { expect, test } from "bun:test";
import { PURCHASABLE_HULL_IDS } from "../src/hull";
import { AUTHORED_HULL_MODELS } from "../src/model-catalog";
import { codeOf } from "./lib/source-scan";

test("the generated-plating probe flies the hull it names, and every hull now has a model", () => {
	// The probe was pointed at the prospector because it was the last hull drawn
	// as a loft. Node #1035 authored that hull too, so no hull the game flies
	// uses generated plating once its model installs; what the probe still reads
	// is the stand-in's plating on the frame before the swap. Recorded rather
	// than silently repointed: whether generated plating keeps a probe at all is
	// the principal's decision, and this row says which hull stands under it.
	const code = codeOf("scripts/probe-ship-visuals.mjs");
	const hull = code.match(/hull: "([a-z]+)"/)?.[1];
	expect(PURCHASABLE_HULL_IDS.some((id) => id === hull)).toBe(true);
	expect(AUTHORED_HULL_MODELS.some((id) => id === hull)).toBe(true);
});
