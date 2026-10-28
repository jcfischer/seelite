import { expect, test } from "bun:test";
import { PURCHASABLE_HULL_IDS } from "../src/hull";
import { AUTHORED_HULL_MODELS } from "../src/model-catalog";
import { codeOf } from "./lib/source-scan";

test("the generated-plating probe flies a hull that still uses generated plating", () => {
	const code = codeOf("scripts/probe-ship-visuals.mjs");
	const hull = code.match(/hull: "([a-z]+)"/)?.[1];
	expect(PURCHASABLE_HULL_IDS.some((id) => id === hull)).toBe(true);
	expect(AUTHORED_HULL_MODELS.some((id) => id === hull)).toBe(false);
});
