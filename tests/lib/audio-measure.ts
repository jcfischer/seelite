/**
 * Measures of a rendered signal, shared by the suites that read one:
 * `tests/music-voices.test.ts` and `tests/music-voice-kinds.test.ts` for the
 * synth's voices (sage round 8), and the speech suites for the band energy
 * (#600's sage round 2). Each file had its own copy, so a fix to one landed
 * in one file.
 */

/** Energy in `[lo, hi)` Hz over frames `a` to `b`, summed over DFT bins
 *  25 Hz apart and divided by the window's length. */
export function bandEnergy(
	x: Float32Array,
	sampleRate: number,
	lo: number,
	hi: number,
	a = 0,
	b = x.length,
): number {
	let e = 0;
	const n = Math.max(1, b - a);
	for (let hz = lo; hz < hi; hz += 25) {
		const w = (2 * Math.PI * hz) / sampleRate;
		let re = 0;
		let im = 0;
		for (let i = a; i < b; i++) {
			re += x[i] * Math.cos(w * i);
			im += x[i] * Math.sin(w * i);
		}
		e += (re * re + im * im) / n;
	}
	return e;
}

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
