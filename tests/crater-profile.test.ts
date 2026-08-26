/**
 * One crater field, one definition — and this is what holds that true.
 *
 * `planet-shaders.ts` exports the field as two GLSL snippets: `CRATER_CELL`
 * places a crater and `CRATER_PROFILE` shapes it. Two functions interpolate
 * them — `craters()`, which every planet class reads, and
 * `station-surface.ts`'s `cratersAndGradient()`, which sums the profile *and*
 * its slope so a refinery's asteroid pays one walk of the 3×3×3 neighbourhood
 * instead of the five that finite-differencing the height would cost.
 *
 * **This replaced a string-matching guard, and the reason is worth keeping.**
 * That version listed a dozen lines and asserted each appeared in both files.
 * Containment catches a line that is deleted or changed; it cannot catch one
 * that is *added*. A new term in `craters()` — a terrace, a second rim, a depth
 * clamp — would have left every asserted line intact and passed green while the
 * two fields quietly diverged. One definition cannot diverge at all.
 *
 * What is left to check is that the definition is still the *only* place the
 * field is written: that both functions interpolate the snippets rather than
 * having grown their own copy back, and that the shared strings still carry the
 * parts each consumer depends on. That is a much smaller claim than the one it
 * replaces, which is the point.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CRATER_CELL, CRATER_PROFILE } from "../src/planet-shaders";
import { repoPath } from "./lib/source-scan";

const shared = readFileSync(repoPath("src/planet-shaders.ts"), "utf8");
const station = readFileSync(repoPath("src/station-surface.ts"), "utf8");

describe("the crater field has one definition", () => {
	test.each([
		["planet-shaders.ts", shared],
		["station-surface.ts", station],
	])("%s interpolates the shared snippets", (_name, source) => {
		expect(source).toContain("${CRATER_CELL}");
		expect(source).toContain("${CRATER_PROFILE}");
	});

	test("neither has grown its own copy of the profile back", () => {
		// The rim gaussian is the field's signature: it appears in the snippet
		// and must appear nowhere else. A second occurrence in either file means
		// somebody has inlined the profile again, which is how the copy this
		// replaced came about in the first place.
		const rim = /exp\(-pow\(\(d - 0\.88\) \* 6\.5, 2\.0\)\)/g;
		expect(shared.match(rim)?.length ?? 0).toBe(1);
		expect(station.match(rim)?.length ?? 0).toBe(0);
	});

	test("the snippets carry what each consumer reads out of them", () => {
		// `cratersAndGradient` differentiates the profile, so it needs `inside`,
		// `rim` and `d` by name, and the offset and distance the cell computed.
		// A rename inside the snippet that did not reach the gradient would
		// otherwise fail as a shader compile error in a browser rather than here.
		for (const name of ["float inside", "float bowl", "float rim"])
			expect(CRATER_PROFILE).toContain(name);
		for (const name of ["vec3 offset", "float dist", "float d ="])
			expect(CRATER_CELL).toContain(name);
	});

	test("both walk the same neighbourhood", () => {
		// A crater's reach is at most 1.2 × its radius and its radius is under one
		// cell, so only the 27 cells around a point can affect it. The bound lives
		// in each function rather than in the snippets — it is part of the
		// accumulation, not of the field — so it is the one thing here that still
		// has to be checked twice.
		for (const source of [shared, station]) {
			for (const axis of ["x", "y", "z"])
				expect(source).toContain(
					`for (int ${axis} = -1; ${axis} <= 1; ++${axis})`,
				);
			expect(source).toContain("if (d < 1.2)");
		}
	});
});
