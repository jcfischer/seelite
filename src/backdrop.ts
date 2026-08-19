/**
 * The star field behind everything: seeded, generated, never downloaded.
 *
 * Headless on purpose — it produces plain typed arrays and knows nothing about
 * Three.js. Two reasons, and only the second is about tests:
 *
 * 1. It is the one part of the backdrop that has to be *identical* between two
 *    runs of the same seed, and a function returning buffers is something a
 *    test can compare element by element. A function that returned a
 *    `THREE.Points` would not be.
 * 2. The renderer's job is to wrap these in a `BufferGeometry`, which is three
 *    lines and no decisions.
 *
 * The scale research recommends a hybrid backdrop: a baked cubemap for galaxy
 * haze and nebulae, with a points layer on top for the bright, nameable stars —
 * the ones that are also systems you can jump to. Only the points layer exists
 * here. The nebula bake needs a galaxy to be a picture *of*, and the galaxy is
 * an open decision on the map.
 */

import { streamFor } from "./rng";
import { BACKDROP_RADIUS } from "./units";

export interface StarField {
	/** xyz triples on a sphere of radius `BACKDROP_RADIUS`. */
	positions: Float32Array;
	/** rgb triples, 0..1, linear. */
	colors: Float32Array;
	/** Per-point size, in the units `PointsMaterial` wants. */
	sizes: Float32Array;
	count: number;
}

/**
 * Roughly-blackbody star colour, from a 0..1 "how hot is it" parameter.
 *
 * Not a physical fit and does not need to be: it interpolates a red-orange
 * through white to a blue-white, which is the range the eye reads as "stars"
 * and covers what a real sky looks like at this level of abstraction. A real
 * Planck curve is a candidate refinement, not a correctness fix.
 */
function starColor(t: number): [number, number, number] {
	// Two segments, meeting at white. Warm stars are the common case, so the
	// distribution that feeds this is biased toward the low end, not this ramp.
	if (t < 0.5) {
		const k = t / 0.5;
		return [1, 0.62 + 0.38 * k, 0.38 + 0.62 * k];
	}
	const k = (t - 0.5) / 0.5;
	return [1 - 0.28 * k, 1 - 0.1 * k, 1];
}

/**
 * `count` stars, uniformly scattered over a sphere, from the world seed.
 *
 * **Uniform on the sphere, not on (θ, φ).** Drawing both angles uniformly
 * bunches points at the poles — the classic mistake, and a visible one against
 * a black sky. `z` is drawn uniformly instead and the ring radius follows from
 * it, which is the standard area-preserving construction.
 *
 * Drawn from `STREAMS.backdrop`, so the sky does not move when the market
 * generator gains a draw. Two calls with the same seed and count return
 * identical buffers; `tests/backdrop.test.ts` is what holds that.
 */
export function starField(worldSeed: number, count = 4000): StarField {
	const rand = streamFor(worldSeed, "backdrop");
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const sizes = new Float32Array(count);

	for (let i = 0; i < count; i++) {
		const z = rand() * 2 - 1;
		const ring = Math.sqrt(Math.max(0, 1 - z * z));
		const theta = rand() * Math.PI * 2;
		positions[i * 3] = Math.cos(theta) * ring * BACKDROP_RADIUS;
		positions[i * 3 + 1] = z * BACKDROP_RADIUS;
		positions[i * 3 + 2] = Math.sin(theta) * ring * BACKDROP_RADIUS;

		// Biased warm: cubing a uniform draw puts most stars at the red end,
		// which is both what the real sky does and what keeps the handful of
		// blue-white ones reading as exceptional.
		const t = rand() ** 3;
		const [r, g, b] = starColor(t);
		colors[i * 3] = r;
		colors[i * 3 + 1] = g;
		colors[i * 3 + 2] = b;

		// Magnitude: a steep power so the field is mostly faint pinpricks with a
		// few bright ones. A flat distribution reads as noise rather than as a
		// sky.
		sizes[i] = 0.006 + 0.05 * rand() ** 6;
	}

	return { positions, colors, sizes, count };
}
