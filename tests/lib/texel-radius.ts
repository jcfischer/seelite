/**
 * The apparent radius at which a cube face reaches a given pixels-per-texel.
 *
 * Two tests invert `pxPerCubeTexel` to find a band's crossing —
 * `relief-bands.test.ts` for the band itself and `planet-bake.test.ts` for the
 * face-size ladder — and each had its own bisection with its own bounds,
 * iteration count and return convention (sage, PR #256, round 2). One
 * inversion, so a change to the measure cannot leave the two disagreeing about
 * where its threshold is.
 *
 * Monotone in `m` over `m > 1`, which is what makes a bisection the right tool:
 * the function rises without bound as the camera lands and falls to zero at
 * infinity.
 */
import { pxPerCubeTexel } from "../../src/relief-bands";

export function radiusAtTexelRatio(
	focal: number,
	facePx: number,
	ratio: number,
): number {
	let lo = 1.0001;
	let hi = 1e4;
	for (let i = 0; i < 80; i++) {
		const mid = (lo + hi) / 2;
		if (pxPerCubeTexel(focal / mid, focal, facePx) > ratio) lo = mid;
		else hi = mid;
	}
	// The apparent radius, which is what every caller compares against — not the
	// multiple of body radii the bisection ran in.
	return focal / ((lo + hi) / 2);
}
