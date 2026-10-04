import { expect, test } from "bun:test";
import {
	relativeAlbedoVariance,
	airlessContrastPasses,
} from "../scripts/lib/airless-contrast.mjs";
import { AIRLESS } from "../src/planet-classes.glsl";

test("albedo contrast rejects brightness gain and absent sparse features", () => {
	const before = [0.18, 0.2, 0.22, 0.24];
	const bright = before.map((v) => v * (0.4 / 0.235));
	const base = relativeAlbedoVariance(before);
	expect(relativeAlbedoVariance(bright) / base).toBeCloseTo(1, 12);
	expect(
		airlessContrastPasses({
			ratio: relativeAlbedoVariance(bright) / base,
			featureRatio: 1,
		}),
	).toBe(false);
	expect(airlessContrastPasses({ ratio: 2, featureRatio: 1 })).toBe(false);
	expect(airlessContrastPasses({ ratio: 2, featureRatio: 2 })).toBe(true);
	for (const ratio of [NaN, Infinity, 0, 1, 7])
		expect(airlessContrastPasses({ ratio, featureRatio: 2 })).toBe(false);
});

test("albedo instrument refuses invalid readings", () => {
	for (const samples of [[], [0, 0], [NaN, 0.2], [Infinity, 0.2]])
		expect(() => relativeAlbedoVariance(samples)).toThrow();
});

test("airless retains the parent's warm highland and cold frost reflectance", () => {
	expect(AIRLESS).toContain("vec3 highland = vec3(0.235, 0.225, 0.210)");
	expect(AIRLESS).toContain("vec3 frost    = vec3(0.400, 0.415, 0.440)");
});
