/**
 * Midpoint median and nearest-rank p95 over finite samples.
 *
 * Kept dependency-free so both the browser sampler and the headed Node
 * instrument use exactly the same percentile policy.
 *
 * @param {readonly number[]} values
 * @returns {Readonly<{ medianMs: number | null, p95Ms: number | null, sampleCount: number }>}
 */
export function rollingStatistics(values) {
	const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
	if (sorted.length === 0)
		return Object.freeze({ medianMs: null, p95Ms: null, sampleCount: 0 });
	const middle = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 === 0
			? (sorted[middle - 1] + sorted[middle]) / 2
			: sorted[middle];
	const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
	return Object.freeze({
		medianMs: median,
		p95Ms: p95,
		sampleCount: sorted.length,
	});
}
