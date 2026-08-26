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
 * That last sentence is true of the *definition* and not of the file. Nothing
 * stops someone pasting the profile back in beside the interpolation, and no
 * source scan can rule that out for certain — the detector below says what it
 * catches and what it does not.
 *
 * What is left to check is that the definition is still the *only* place the
 * field is written: that both functions interpolate the snippets rather than
 * having grown their own copy back, and that the shared strings still carry the
 * parts each consumer depends on. That is a much smaller claim than the one it
 * replaces, which is the point.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CRATER_CELL, CRATER_PROFILE, CRATER_RIM } from "../src/planet-shaders";
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
		// **What this can and cannot see.** A detector that matches one exact
		// string has the blind spot of the guard it replaced, one level up: a
		// re-inline with different spacing, renamed locals, or the constants
		// hand-expanded walks straight past it. So it does not look for one
		// string.
		//
		// Whitespace is normalised first, which removes reformatting as a way
		// through. Then three of the field's marks are checked rather than one,
		// each of which a re-inlined profile has to reproduce *somehow* to
		// work: the rim gaussian's shape, the profile's own local names — which
		// the accumulation below reads by name, so a rename would have to reach
		// it too — and the cell's centre jitter.
		//
		// It is still a source scan and it can still be defeated on purpose.
		// What it catches is the accident: someone pasting the profile back in
		// to add a term, which is exactly how the copy this replaced came about.
		const flat = (t: string) => t.replace(/\s+/g, " ");
		const gaussian = /exp\( *- *pow\(/g;
		expect(flat(shared).match(gaussian)?.length ?? 0).toBe(1);
		expect(flat(station).match(gaussian)?.length ?? 0).toBe(0);

		// The profile's locals, and the cell's jitter. Declared in the snippets
		// and interpolated at build time, so the *source* of either consumer
		// naming them means a second copy.
		for (const mark of ["float bowl", "float rim", "hash31(cell"])
			expect(flat(station)).not.toContain(mark);
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

	test("the derivative reads the profile's own constants", () => {
		// This *is* guardable, and an earlier version of this file said it was
		// not: "the derivative needs a GLSL interpreter". Only its *value* does.
		// Its dependence on the profile is source text, and it was the one
		// remaining path by which the two could diverge in silence — a wrong
		// slope still shades plausibly, so nothing rendered would report it.
		//
		// The rim's position and sharpness are `#define`s now, used by the
		// profile and by the chain rule alike. What is checked is that neither
		// side has gone back to writing the number: `2 × 6.5² = 84.5` is what a
		// hand-expanded derivative looks like, and it is exactly what would be
		// left stale by a change to the sharpness.
		expect(CRATER_RIM).toContain("#define CRATER_RIM_AT");
		expect(CRATER_RIM).toContain("#define CRATER_RIM_SHARPNESS");
		expect(CRATER_PROFILE).toContain("CRATER_RIM_AT");
		expect(CRATER_PROFILE).toContain("CRATER_RIM_SHARPNESS");
		expect(station).toContain("CRATER_RIM_SHARPNESS * CRATER_RIM_SHARPNESS");
		expect(station).toContain("(d - CRATER_RIM_AT)");
		// Anchored to the *shape* a hand-expanded derivative has, not to the
		// bare numbers: `expect(station).not.toContain("0.88")` would also fail
		// on an unrelated roughness or blend weight that happened to be 0.88,
		// reporting it as a stale derivative.
		expect(station).not.toMatch(/d - 0\.88/);
		expect(station).not.toMatch(/-\s*84\.5/);
	});

	test("both interpolators supply what the snippets read", () => {
		// The snippets are text, so their contract is by name: `CRATER_CELL`
		// reads `base`, `p` and the loop counters, and declares the rest. A
		// consumer that fails to supply one gets a GLSL compile error in a
		// browser — which the probes now catch, but late and far from here.
		//
		// The names *declared* are guarded by the one-definition tests above.
		// These are the ones each consumer has to bring itself, and they are
		// checked here so a third interpolator learns the contract from a
		// failing unit test rather than from a shader log.
		for (const source of [shared, station]) {
			expect(source).toMatch(/vec3 base = floor\(p\)/);
			expect(source).toMatch(/vec3 p[ ,)]/);
		}
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
