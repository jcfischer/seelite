/**
 * A vector comparison and a direction set, shared by the two suites that check
 * rotations: `tests/quat.test.ts` for the arithmetic and
 * `tests/galaxy-frame.test.ts` for the frame built on top of it.
 *
 * Each file had written `expectVec`, `UNIT` and a nine-direction spread by hand.
 * Two copies of a tolerance are two claims about the same property, and the
 * change that turns one of them off — a `tol` loosened to make a row pass —
 * leaves the other silently stricter. This is the same argument
 * `tests/lib/texel-radius.ts` and `tests/lib/source-scan.ts` are in the tree for.
 *
 * **And no Three.js in here.** `tests/quat.test.ts` imports this file, and
 * `quat.ts` is headless by declaration; a `three` import held here for one
 * renderer-side conversion would put the renderer in that suite's process and make
 * the leaf claim in `tests/headless.test.ts` a statement about the module and not
 * about the tier that tests it.
 *
 * **What is deliberately *not* here.** The second arithmetic those files check
 * against — `rodrigues`, `shortestArcEast`, the transcription of a deleted body
 * in `light-rig.test.ts` — stays local to the row that uses it. A cross-check
 * shared with the implementation it is checking is the shared bug the whole
 * pattern exists to avoid.
 */
import { expect } from "bun:test";
import { normalizeOr, type Vec3, v3 } from "../../src/vec3";

/** `+z`: the fallback every normalisation in these suites agrees on. */
export const UNIT: Vec3 = v3(0, 0, 1);

/**
 * Componentwise, always all three. A rotation checked on one component passes
 * on the reflection, and failing the wrong transform is the only thing these
 * rows are for.
 */
export const expectVec = (got: Vec3, want: Vec3, tol = 1e-9): void => {
	expect(Math.abs(got.x - want.x)).toBeLessThanOrEqual(tol);
	expect(Math.abs(got.y - want.y)).toBeLessThanOrEqual(tol);
	expect(Math.abs(got.z - want.z)).toBeLessThanOrEqual(tol);
};

/**
 * Directions all over the sphere, axes and their negatives included — a claim
 * checked on four pleasant directions is a claim about those four.
 */
export const DIRECTIONS: Vec3[] = [
	v3(1, 0, 0),
	v3(0, 1, 0),
	v3(0, 0, 1),
	v3(-1, 0, 0),
	v3(0, -1, 0),
	v3(0, 0, -1),
	v3(1, 1, 0),
	v3(1, 1, 1),
	v3(-0.3, 0.6, -0.74),
].map((v) => normalizeOr(v, UNIT));
