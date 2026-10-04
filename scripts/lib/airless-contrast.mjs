/** Variance / mean squared: invariant under a uniform reflectance gain. */
export function relativeAlbedoVariance(samples) {
	if (samples.length < 2 || samples.some((v) => !Number.isFinite(v)))
		throw new Error("invalid airless albedo samples");
	const mean = samples.reduce((sum, v) => sum + v, 0) / samples.length;
	if (mean <= 0) throw new Error("airless albedo mean must be positive");
	return (
		samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) /
		(samples.length * mean ** 2)
	);
}

/** Both the parent comparison and the same-shader feature ablation must pass. */
export function airlessContrastPasses({ ratio, featureRatio }) {
	return (
		Number.isFinite(ratio) &&
		ratio >= 1.5 &&
		ratio <= 6 &&
		Number.isFinite(featureRatio) &&
		featureRatio >= 1.5
	);
}
