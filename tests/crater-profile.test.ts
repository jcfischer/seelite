/**
 * Two functions describe one crater field. This is what stops them drifting.
 *
 * `planet-shaders.ts`'s `craters()` is #57's, and every planet class reads it.
 * `station-surface.ts` carries `cratersAndGradient()`, which is the same field
 * with its slope accumulated alongside — one walk of the 3×3×3 neighbourhood
 * instead of the five that `reliefNormal`'s finite differences cost, which on a
 * real GPU was the difference between 25 fps at docking range and not.
 *
 * The duplication is deliberate and it is the kind this project keeps paying
 * for, so it is guarded rather than trusted: the **profile** — the two
 * expressions that give a crater its bowl and its rim, and the cell layout that
 * places it — must appear verbatim in both. A change to one that is not made to
 * the other turns the refinery's rock into a different rock from the moons, and
 * nothing rendered would say so.
 *
 * What is *not* guarded is the gradient itself. A derivative cannot be checked
 * by string comparison, and checking it numerically would need a GLSL
 * interpreter. What the guard buys is that the two cannot disagree about the
 * shape being differentiated — which is the half that would go wrong silently.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { repoPath } from "./lib/source-scan";

const shared = readFileSync(repoPath("src/planet-shaders.ts"), "utf8");
const station = readFileSync(repoPath("src/station-surface.ts"), "utf8");

/** The lines that define a crater's shape and where it sits. Whitespace is
 *  normalised because the two live at different indents. */
const PROFILE = [
	"vec3 centre = cell + vec3(hash31(cell),",
	"hash31(cell + 61.7),",
	"hash31(cell + 13.3));",
	"float radius = 0.16 + 0.34 * hash31(cell + 3.1);",
	"float rim  = exp(-pow((d - 0.88) * 6.5, 2.0)) * 0.7;",
	// The reach, which decides *which* craters a point can see. A change here in
	// one function alone samples a different set of them.
	"if (d < 1.2)",
	// The neighbourhood, all three axes. Guarding only x — which the first
	// version did, while the PR claimed the check covered the neighbourhood —
	// leaves a y or z bound free to change on one side and pass green.
	"for (int x = -1; x <= 1; ++x)",
	"for (int y = -1; y <= 1; ++y)",
	"for (int z = -1; z <= 1; ++z)",
	// The cell the walk is anchored on, and the scaling that sizes it.
	"p *= scale;",
	"vec3 base = floor(p);",
	"vec3 cell = base + vec3(x, y, z);",
];

const squashed = (text: string) => text.replace(/[ \t]+/g, " ");

describe("the station's crater field is #57's crater field", () => {
	test.each(PROFILE)("both carry: %s", (line) => {
		const needle = squashed(line);
		expect(squashed(shared)).toContain(needle);
		expect(squashed(station)).toContain(needle);
	});

	test("the bowl is the same expression, modulo the gradient's own factor", () => {
		// The station's version splits `step(d, 1.0)` into a named `inside` so the
		// derivative can reuse it, which is why this is asserted by its parts
		// rather than as one string.
		expect(shared).toContain("-(1.0 - d * d) * step(d, 1.0)");
		expect(station).toContain("float inside = step(d, 1.0);");
		expect(station).toContain("-(1.0 - d * d) * inside");
	});

	test("the depth scaling is applied the same way on both sides", () => {
		// `depth` multiplies the summed profile in #57's and each term in the
		// station's, because the gradient needs it inside the loop. Both are
		// asserted, so neither can quietly drop it.
		expect(squashed(shared)).toContain("acc += (bowl + rim) * depth;");
		expect(squashed(station)).toContain("acc += (bowl + rim) * depth;");
		expect(squashed(station)).toContain("dProfile * depth * scale");
	});
});
