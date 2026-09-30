/**
 * Two measures of a rendered signal, shared by the two voice suites:
 * `tests/music-voices.test.ts` for the first voices and
 * `tests/music-voice-kinds.test.ts` for the second (sage round 8). Each file
 * had its own copy of both, so a fix to the pitch estimator landed in one.
 */

/** Rms over frames `a` to `b`. */
export const rms = (x: Float32Array, a = 0, b = x.length): number => {
	let s = 0;
	for (let i = a; i < b; i++) s += x[i] * x[i];
	return Math.sqrt(s / Math.max(1, b - a));
};

/** The period, in frames, with the strongest autocorrelation between two
 *  lags: a fundamental estimate for a steady tone. */
export const period = (
	x: Float32Array,
	from: number,
	len: number,
	lo: number,
	hi: number,
): number => {
	// The autocorrelation at one lag.
	const at = (lag: number) => {
		let r = 0;
		for (let i = from; i < from + len; i++) r += x[i] * x[i + lag];
		return r;
	};
	let best = lo;
	let bestR = Number.NEGATIVE_INFINITY;
	for (let lag = lo; lag <= hi; lag++) {
		const r = at(lag);
		if (r > bestR) {
			bestR = r;
			best = lag;
		}
	}
	// Parabolic refinement around the peak.
	const a = at(best - 1);
	const c = at(best + 1);
	return best + (0.5 * (a - c)) / (a - 2 * bestR + c);
};
