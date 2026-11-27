import { expect, test } from "bun:test";
import { conceptEstimate, isConcept } from "../src/concept-estimates";

test("concept estimates count all hits and the complete firing cycle", () => {
	for (const [family, dps, price] of [
		["autocannon", (6 * 5) / (5 * 0.1 + 1), 2725],
		["railgun", 80 / (2 + 2), 6575],
		["scattergun", (8 * 3) / 1.5, 725],
		["plasma-projector", 54 / (1 + 2), 1650],
	] as const) {
		const estimate = conceptEstimate(family);
		expect(estimate.dps).toBeCloseTo(dps);
		expect(estimate.priceCr).toBe(price);
		expect(estimate.value).toBeCloseTo((dps * 1000) / price);
	}
});

test("only the four review concepts carry a concept label", () => {
	for (const family of [
		"autocannon",
		"railgun",
		"scattergun",
		"plasma-projector",
	]) {
		expect(isConcept(family)).toBe(true);
	}
	for (const family of [
		"pulse-laser",
		"beam-laser",
		"military-laser",
		"mining-laser",
		"missile-rack",
		"unknown",
	]) {
		expect(isConcept(family)).toBe(false);
	}
});
