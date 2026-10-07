/**
 * Which recording of a sample set a note plays (map #1's ruling on
 * open-licensed music samples, 2026-10-06): one rule, read by the worklet's
 * `sampler` voice as a note starts and by the main thread's loader
 * (`music-samples.ts`) when it works out which recordings a song needs —
 * so the loader decodes exactly the recordings the voice will reach for.
 *
 * **A leaf that imports nothing**, and allocates nothing: the voice calls it
 * on every note.
 */

/**
 * The softest layer whose `maxVelocity` reaches `vel` — the loudest, above
 * them all. `layers` run soft to loud.
 */
export function pickLayer<L extends { readonly maxVelocity: number }>(
	layers: readonly L[],
	vel: number,
): L | undefined {
	for (const l of layers) if (vel <= l.maxVelocity) return l;
	return layers[layers.length - 1];
}

/**
 * The root nearest `pitch`, the lower of two equally near — so a note is
 * read faster rather than slower, which keeps its attack short. `zones` run
 * low to high.
 */
export function pickZone<Z extends { readonly root: number }>(
	zones: readonly Z[],
	pitch: number,
): Z | undefined {
	let best: Z | undefined;
	let bestD = Number.POSITIVE_INFINITY;
	for (const z of zones) {
		const d = Math.abs(z.root - pitch);
		if (d < bestD) {
			bestD = d;
			best = z;
		}
	}
	return best;
}
