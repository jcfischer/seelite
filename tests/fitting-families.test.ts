import { expect, test } from "bun:test";
import {
	fittingFamilies,
	fittingExitName,
	isFittingFamily,
} from "../src/fitting-families";

test("each fitting resolves its authored exit and unrelated modules have no fitting", () => {
	expect(fittingFamilies).toEqual([
		"pulse-laser",
		"beam-laser",
		"military-laser",
		"mining-laser",
		"missile-rack",
		"autocannon",
		"railgun",
		"scattergun",
		"plasma-projector",
	]);
	for (const family of fittingFamilies) {
		expect(isFittingFamily(family)).toBe(true);
		expect(fittingExitName(family)).toBe(
			family === "missile-rack" ? "launch-exit" : "muzzle",
		);
	}
	expect(isFittingFamily("power-plant")).toBe(false);
});
