import { expect, test } from "bun:test";
import {
	raySourcePasses,
	raySourceFragment,
} from "../scripts/lib/airless-ray-source.mjs";
import { AIRLESS } from "../src/planet-classes.glsl";
import { bakeFragmentFor, CRATER_CELL } from "../src/planet-shaders";

const valid = () => ({
	cpu: { centre: [1, 0, 0], radius: 0.04 },
	ray: [1, 0, 0, 0.04],
	walk: [1, 0, 0, 0.04],
	eligibility: [0.1, 0, 1, 1],
});

test("ray-source gate requires geometry agreement and an unflooded GPU crater", () => {
	expect(raySourcePasses(valid())).toBe(true);
	for (const key of ["ray", "walk"] as const) {
		const shifted = valid();
		shifted[key][0] += 0.02;
		expect(raySourcePasses(shifted)).toBe(false);
		const wrongRadius = valid();
		wrongRadius[key][3] *= 1.2;
		expect(raySourcePasses(wrongRadius)).toBe(false);
	}
	const cpuMismatch = valid();
	cpuMismatch.cpu.centre[0] += 0.02;
	expect(raySourcePasses(cpuMismatch)).toBe(false);
	const cpuRadiusMismatch = valid();
	cpuRadiusMismatch.cpu.radius *= 1.2;
	expect(raySourcePasses(cpuRadiusMismatch)).toBe(false);
	for (const [index, value] of [
		[0, 0.3],
		[1, 1],
		[2, 0],
		[3, 0],
	]) {
		const invalid = valid();
		invalid.eligibility[index] = value;
		expect(raySourcePasses(invalid)).toBe(false);
	}
	for (const key of ["ray", "walk", "eligibility"] as const) {
		const missing = valid();
		missing[key] = [];
		expect(raySourcePasses(missing)).toBe(false);
		const nonfinite = valid();
		nonfinite[key][0] = NaN;
		expect(raySourcePasses(nonfinite)).toBe(false);
	}
});

test("ray diagnostic reads shared crater-cell geometry and refuses missing splices", () => {
	const fragment = bakeFragmentFor("airless", "albedo");
	const walk = raySourceFragment(fragment, CRATER_CELL, "walk");
	expect(walk).toContain(CRATER_CELL);
	expect(walk).toContain(
		"gl_FragColor = vec4(centre / 8.0 - seedOffset * 1.7, radius / 8.0)",
	);
	expect(raySourceFragment(fragment, CRATER_CELL, "ray")).toContain(
		"gl_FragColor = source",
	);
	expect(raySourceFragment(fragment, CRATER_CELL, "eligibility")).toContain(
		"airlessRayEligible(source)",
	);
	expect(() =>
		raySourceFragment("void other() {}", CRATER_CELL, "ray"),
	).toThrow();
});

test("production rays guard GPU eligibility before painting a source", () => {
	expect(AIRLESS).toContain("if (!airlessRayEligible(source)) continue;");
	expect(AIRLESS).toContain("abs(length(source.xyz) - 1.0) >= source.w * 0.25");
	expect(AIRLESS).toContain(
		"distance(c, basins[i].xyz) <= basins[i].w + source.w",
	);
});
