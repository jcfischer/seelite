import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { RELIEF_PATHS, fragmentFor } from "../src/planet-shaders";
import {
	PLANET_RELIEF_PATHS,
	type PlanetReliefPolicy,
	reliefPathFor,
	SCREEN_SPACE_BELOW_PX,
	RELIEF_BAND_HYSTERESIS,
} from "../src/relief-bands";

test("analytic-gradient is a cost arm while terran keeps shipping screen-space", () => {
	expect([...RELIEF_PATHS]).toEqual([
		"four-tap",
		"screen-space",
		"none",
		"analytic-gradient",
	]);
	expect(PLANET_RELIEF_PATHS.terran).toBe("screen-space");
	const experimental: PlanetReliefPolicy = {
		...PLANET_RELIEF_PATHS,
		terran: "analytic-gradient",
	};
	expect(experimental.terran).toBe("analytic-gradient");
	const instrument = readFileSync(
		new URL("../scripts/measure-planet-cost.mjs", import.meta.url),
		"utf8",
	);
	expect(instrument).toContain("return [...mod.RELIEF_PATHS]");
	expect(instrument).toContain('narrow(availablePaths, ONLY_RELIEF, "relief")');
});

test("an analytic class policy retains the full-detail band's hysteresis", () => {
	const release = SCREEN_SPACE_BELOW_PX / RELIEF_BAND_HYSTERESIS;
	expect(
		reliefPathFor((release + SCREEN_SPACE_BELOW_PX) / 2, "analytic-gradient"),
	).toBe("four-tap");
	expect(reliefPathFor(release - 1, "analytic-gradient")).toBe("screen-space");
});

test("both shipped terran programs retain their merged-base source byte for byte", () => {
	for (const [footprint, digest] of [
		[false, "692eefddfe12c9be8a512aa369071fc505bc31cb9783d8872012a6d7078fe59e"],
		[true, "a1ab9c4fce377164570b270220954c45e59b641af0abd806b9215467b40e9642"],
	] as const) {
		expect(
			createHash("sha256")
				.update(fragmentFor("terran", "screen-space", footprint))
				.digest("hex"),
		).toBe(digest);
	}
});

test("analytic source differentiates the same base and footprint height field", () => {
	for (const footprint of [false, true]) {
		const source = fragmentFor("terran", "analytic-gradient", footprint);
		expect(source).toContain("#define RELIEF_ANALYTIC_GRADIENT 1");
		expect(source).toContain("vec4 heightAndGradient(vec3 p)");
		expect(source).toContain("vec4 vnoiseAndGradient(vec3 p)");
		expect(source).toContain("vec3 df = 6.0 * f * (1.0 - f)");
		expect(source).toContain("-2.0 * sign(2.0 * sampleVG.w - 1.0)");
		expect(source).toContain("vec3 grad = heightAndGradient(p).xyz");
		expect(source).toContain("strength * 0.007");
		expect(source).toContain(
			footprint ? "fbm5FootprintAndGradient" : "fbm5AndGradient",
		);
		expect(source).toContain(
			footprint ? "ridgedFootprintAndGradient" : "ridgedAndGradient",
		);
		expect(source).toContain("c.x * wx.xyz + c.y * wy.xyz + c.z * wz.xyz");
	}
	expect(() => fragmentFor("desert", "analytic-gradient")).toThrow(
		"analytic-gradient relief is implemented for terran only",
	);
});
