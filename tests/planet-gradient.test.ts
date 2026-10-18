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

test("both shipped terran programs retain their pre-node source byte for byte", () => {
	for (const [footprint, digest] of [
		[false, "b3f289d26a46b83a4d14376ed8d83c958a69e50c3876caefe6081a7a8a07b317"],
		[true, "85f85ee9ba367dc06552336ed0d1d13bb79cbb6aff8c4c6fbb49ebdcf07dcba5"],
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
	// Other classes stay on their existing programs, even in a class cost sweep.
	expect(fragmentFor("desert", "analytic-gradient")).toBe(
		fragmentFor("desert", "four-tap"),
	);
});
