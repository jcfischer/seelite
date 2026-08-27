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
import { readdirSync, readFileSync } from "node:fs";
import { CRATER_CELL, CRATER_PROFILE, CRATER_RIM } from "../src/planet-shaders";
import { repoPath } from "./lib/source-scan";

const shared = readFileSync(repoPath("src/planet-shaders.ts"), "utf8");
const station = readFileSync(repoPath("src/station-surface.ts"), "utf8");

/**
 * Every file that interpolates the snippets, found rather than listed.
 *
 * Two hardcoded paths could only ever check the two consumers that exist, and
 * this file's whole subject is what happens when a *third* appears. Named
 * explicitly, a third would be invisible here and would learn the contract
 * from a browser shader log — which is the outcome these tests are written to
 * prevent, arrived at by the test not looking.
 *
 * `src` is small enough to read whole; the alternative is a list that has to
 * be remembered at exactly the moment nobody is thinking about this file.
 *
 * **Either snippet counts, and the walk recurses.** Keying on the literal
 * "${CRATER_CELL}" in a flat `readdir` was narrower than the sentence above
 * it: a consumer that took only `${CRATER_PROFILE}`, or lived in a
 * subdirectory `src` does not have today, would have been outside the scan
 * while carrying its own copy of the field — and would have made every
 * `test.each` below vacuous rather than red.
 */
const sources = (dir: string): (readonly [string, string])[] =>
	readdirSync(repoPath(dir), { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sources(`${dir}/${entry.name}`)
			: entry.name.endsWith(".ts")
				? [
						[
							`${dir}/${entry.name}`.replace(/^src\//, ""),
							readFileSync(repoPath(`${dir}/${entry.name}`), "utf8"),
						] as const,
					]
				: [],
	);

const INTERPOLATORS = sources("src").filter(([, src]) =>
	/\$\{CRATER_(CELL|PROFILE)\}/.test(src),
);

/**
 * The text around each interpolation, rather than the file holding it.
 *
 * File-scoped assertions were satisfied by coincidence. `vec3 p` appears three
 * times in `station-surface.ts` — `float grain(vec3 p)`, `vec3 p =
 * normalize(vRockP)` — none of them the loop variable the snippet reads, so a
 * *second* interpolating function added to that file would have inherited a
 * green pass without supplying anything. The same width made the copy detector
 * count every `exp(-pow(` in `planet-shaders.ts`, where an unrelated gaussian
 * in some other planet class would fail under the label "grown its own copy of
 * the profile back" — the mislabelling this file rejects two tests later, for
 * `0.88`, and had not applied to itself.
 *
 * The unit is the **enclosing GLSL function**, not a character window. A fixed
 * window was tried first and is not good enough: 900 characters back from the
 * interpolation in `station-surface.ts` reaches into the function above it, so
 * a second walk that supplied nothing borrowed the neighbour's
 * `vec3 base = floor(p)` and passed. A function is the scope the contract is
 * actually about — whatever declares `base` and `p` has to be the same one
 * that reads them.
 */
const FN_START = /\n([A-Za-z_][\w ]*\([^)]*\)\s*\{)/g;
const walks = (source: string) => {
	const starts = [...source.matchAll(FN_START)].map((m) => m.index ?? 0);
	const out: string[] = [];
	for (const hit of source.matchAll(/\$\{CRATER_(?:CELL|PROFILE)\}/g)) {
		const at = hit.index ?? 0;
		const open = starts.filter((i) => i < at).pop() ?? 0;
		// To the first close brace at column zero after the interpolation,
		// which is where a GLSL function in these template literals ends.
		const close = source.indexOf("\n}", at);
		out.push(source.slice(open, close === -1 ? source.length : close));
	}
	return out;
};

describe("the crater field has one definition", () => {
	test("the shared file is the only interpolator, and the rest are callers", () => {
		// The scan is what every case below rests on, so it is checked rather
		// than trusted: a glob that silently matched nothing would make each of
		// them vacuously green.
		//
		// **This got narrower, and that is the improvement.** `station-surface.ts`
		// used to interpolate the snippets itself to build its own gradient
		// walk. #65 needed the same walk for AIRLESS, so it moved into
		// `NOISE_GLSL` beside `craters()` — one definition of the accumulation
		// as well as of the field, and two call sites that share it. A file that
		// only *calls* is outside the whole class of divergence these tests
		// exist for.
		const found = INTERPOLATORS.map(([name]) => name);
		expect(found).toContain("planet-shaders.ts");
		expect(found).toEqual(["planet-shaders.ts"]);
		// The rock still uses the field — as a caller, which is the point.
		expect(station).toMatch(/cratersAndGradient\(/);
	});

	test.each(INTERPOLATORS)(
		"%s interpolates the shared snippets",
		(_n, source) => {
			expect(source).toContain("${CRATER_CELL}");
			expect(source).toContain("${CRATER_PROFILE}");
		},
	);

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
		// Over every interpolator, not over two names. The scan exists because
		// a third consumer is the case this file is about, and a detector that
		// reads two hardcoded paths would let that third file interpolate the
		// snippets *and* paste a profile beside them.
		// Once in the snippet that defines it, and never in the code around an
		// interpolation of that snippet. Counting the whole of
		// `planet-shaders.ts` would have called an unrelated gaussian a copy.
		expect(flat(CRATER_PROFILE).match(gaussian)?.length ?? 0).toBe(1);
		for (const [name, source] of INTERPOLATORS)
			for (const [n, walk] of walks(source).entries()) {
				const at = `${name} walk ${n + 1}`;
				expect(`${at}: ${flat(walk).match(gaussian)?.length ?? 0}`).toBe(
					`${at}: 0`,
				);
			}

		// The profile's locals, and the cell's jitter. Declared in the snippets
		// and interpolated at build time, so the *source* of either consumer
		// naming them means a second copy.
		for (const [name, source] of INTERPOLATORS)
			for (const [n, walk] of walks(source).entries()) {
				const at = `${name} walk ${n + 1}`;
				for (const mark of ["float bowl", "float rim", "hash31(cell"])
					expect(`${at}: ${mark}: ${flat(walk).includes(mark)}`).toBe(
						`${at}: ${mark}: false`,
					);
			}
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
		//
		// The derivative lives in `planet-shaders.ts` now, beside the profile it
		// differentiates — #65 moved it there when AIRLESS became its second
		// consumer, which also removed the cross-file distance that made this
		// test necessary in the first place. It is kept because the *shape* it
		// refuses is still the one a future hand-expansion would take.
		expect(CRATER_RIM).toContain("#define CRATER_RIM_AT");
		expect(CRATER_RIM).toContain("#define CRATER_RIM_SHARPNESS");
		expect(CRATER_PROFILE).toContain("CRATER_RIM_AT");
		expect(CRATER_PROFILE).toContain("CRATER_RIM_SHARPNESS");
		expect(shared).toContain("CRATER_RIM_SHARPNESS * CRATER_RIM_SHARPNESS");
		expect(shared).toContain("(d - CRATER_RIM_AT)");
		// Anchored to the *shape* a hand-expanded derivative has, not to the
		// bare numbers: `not.toContain("0.88")` would also fail on an unrelated
		// roughness or blend weight that happened to be 0.88, reporting it as a
		// stale derivative.
		expect(shared).not.toMatch(/d - 0\.88/);
		expect(shared).not.toMatch(/-\s*84\.5/);
	});

	test("both interpolators supply what the snippets read", () => {
		// The snippets are text, so their contract is by name: `CRATER_CELL`
		// reads `base`, `p` and the loop counters, and declares the rest. A
		// consumer that fails to supply one gets a GLSL compile error in a
		// browser. What would catch *that* is thinner than it sounds and is
		// the reason this test exists: the probes' console listener matches the
		// text of three.js's error, which fails open on a rewording, and the
		// one check that asks the GL context directly names the rock's own
		// program. A third consumer, in some other material, has neither — but
		// it is inside `INTERPOLATORS` the moment it interpolates, so it is
		// inside this test too, without anyone remembering to add it.
		//
		// The names *declared* are guarded by the one-definition tests above.
		// These are the ones each consumer has to bring itself, and they are
		// checked here so a third interpolator learns the contract from a
		// failing unit test rather than from a shader log.
		for (const [name, source] of INTERPOLATORS)
			for (const [n, walk] of walks(source).entries()) {
				const at = `${name} walk ${n + 1}`;
				expect(`${at}: ${/vec3 base = floor\(p\)/.test(walk)}`).toBe(
					`${at}: true`,
				);
				expect(`${at}: ${/\(vec3 p[ ,)]/.test(walk)}`).toBe(`${at}: true`);
			}
	});

	test("both walk the same neighbourhood", () => {
		// A crater's reach is at most 1.2 × its radius and its radius is under one
		// cell, so only the 27 cells around a point can affect it. The bound lives
		// in each function rather than in the snippets — it is part of the
		// accumulation, not of the field — so it is the one thing here that still
		// has to be checked twice.
		for (const [, source] of INTERPOLATORS) {
			for (const axis of ["x", "y", "z"])
				expect(source).toContain(
					`for (int ${axis} = -1; ${axis} <= 1; ++${axis})`,
				);
			expect(source).toContain("if (d < 1.2)");
		}
	});
});
