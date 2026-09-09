/**
 * How many tones a banded surface has, from a latitude profile of it.
 *
 * Extracted from `probe-planet-surfaces.mjs` so it can be run against inputs a
 * browser cannot produce — in particular against a surface that **must** be
 * rejected. A check nobody has seen fail is a check whose failure is a
 * conjecture, and this one passed a two-tone surface twice before it worked
 * (see `tests/band-tones.test.ts`, and the history in `bandMetrics` below).
 *
 * The caller supplies a mean per latitude band and every sample individually.
 * Both are needed and they are not interchangeable: averaging is right for
 * estimating the smooth planet-scale trend that gets subtracted, and wrong for
 * the tone distribution, because every averaging step manufactures the
 * intermediate tone the measurement is looking for.
 */

/**
 * Least-squares quadratic in band index, over the bands that have a value.
 *
 * **A fit and not a moving average, and that is a correction.** The first
 * version smoothed the band means with a wide window and subtracted that. Two
 * things were wrong with it and each hid the other. The window was taken as a
 * fraction of the *bin count* rather than of the bands actually populated —
 * around 100 of 240 — so it was ±80 over the run and subtracted a near-constant,
 * leaving the planet-scale gradient in; Sage caught that on the PR by
 * constructing two discrete tones plus a linear gradient and watching them pass.
 * And sizing it correctly did not fix it either, because a centred moving
 * average reproduces a ramp in the interior of a run and cannot at its ends: a
 * pure gradient with no banding at all came back with a residual sd of 11.9,
 * every bit of it edge artefact.
 *
 * A quadratic has neither problem. It removes a global ramp and a global bow —
 * which is what `JOVIAN`'s equatorial brightening and polar hood are — exactly
 * and at every band including the first and the last, and there is no window to
 * size.
 *
 * **It is not neutral toward every banding, and the first version of this
 * comment claimed it was.** "Too stiff to follow banding, so it cannot subtract
 * the signal" is false as stated: Sage constructed a profile whose populated
 * bands are two contiguous halves at two tones, which is a step, and a quadratic
 * fits a step well enough to pull the reading to 0.453 — under 5/9 for a surface
 * with exactly two tones. `tests/band-tones.test.ts` holds that case so the
 * limitation is recorded rather than asserted away.
 *
 * What is true is narrower and is what this is used for: a quadratic cannot
 * follow banding that **alternates several times** across the run, which is what
 * a gas giant's does, and the surfaces this reads are of that kind. A profile
 * whose whole banding is one step is outside what it can be trusted on. That is
 * one of several reasons the coefficient is reported rather than gated — see
 * `probe-planet-surfaces.mjs`, where the deciding reason is that Sarle's rises
 * with skewness too.
 */
export const quadraticTrend = (values) => {
	const pts = [];
	for (let i = 0; i < values.length; i++) {
		const v = values[i];
		if (v !== null && v !== undefined) pts.push([i, v]);
	}
	if (pts.length < 3) return values.map(() => null);
	// Centred and scaled, so the normal equations stay conditioned: raw band
	// indices in the hundreds give a fourth-power term in the billions.
	const mid = (pts[0][0] + pts[pts.length - 1][0]) / 2;
	const half = Math.max((pts[pts.length - 1][0] - pts[0][0]) / 2, 1);
	const u = (i) => (i - mid) / half;
	let s0 = 0,
		s1 = 0,
		s2 = 0,
		s3 = 0,
		s4 = 0,
		t0 = 0,
		t1 = 0,
		t2 = 0;
	for (const [i, v] of pts) {
		const x = u(i);
		const x2 = x * x;
		s0 += 1;
		s1 += x;
		s2 += x2;
		s3 += x2 * x;
		s4 += x2 * x2;
		t0 += v;
		t1 += v * x;
		t2 += v * x2;
	}
	// Cramer over the 3x3 normal matrix. Small and fixed, so it is written out
	// rather than reached for a solver.
	const m = [
		[s0, s1, s2],
		[s1, s2, s3],
		[s2, s3, s4],
	];
	const det3 = (a) =>
		a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
		a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
		a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
	const d = det3(m);
	if (Math.abs(d) < 1e-12) return values.map(() => null);
	const withCol = (c, col) =>
		m.map((row, r) => row.map((v, k) => (k === c ? col[r] : v)));
	const rhs = [t0, t1, t2];
	const a = det3(withCol(0, rhs)) / d;
	const b = det3(withCol(1, rhs)) / d;
	const c = det3(withCol(2, rhs)) / d;
	return values.map((v, i) => {
		if (v === null || v === undefined) return null;
		const x = u(i);
		return a + b * x + c * x * x;
	});
};

/**
 * Sarle's bimodality coefficient: `(skew² + 1) / kurtosis`, sample-corrected.
 *
 * 1.0 is a two-point distribution, 5/9 uniform, 1/3 normal. The correction is
 * what makes 5/9 the right number to compare a finite sample against; the
 * uncorrected form is biased low at small n.
 */
export const bimodality = (values) => {
	const n = values.length;
	if (n < 40) return null;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const dev = values.map((v) => v - mean);
	const m2 = dev.reduce((a, d) => a + d * d, 0) / n;
	if (m2 <= 0) return null;
	const sd = Math.sqrt(m2);
	const m3 = dev.reduce((a, d) => a + d ** 3, 0) / n;
	const m4 = dev.reduce((a, d) => a + d ** 4, 0) / n;
	const skew = m3 / sd ** 3;
	const excess = m4 / m2 ** 2 - 3;
	const denom = excess + (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
	return denom > 0 ? (skew * skew + 1) / denom : null;
};

/**
 * The tone statistic over one reading.
 *
 * The trend is estimated from the band **means** — the one job averaging is
 * right for — and subtracted from each sample at its own latitude. The tones
 * themselves are never averaged: every averaging step manufactures the
 * intermediate tone the measurement is looking for, which is how a screen-row
 * version of this passed a surface the eye reads as two-tone.
 */
export const bandMetrics = ({ bins, samples }, { minSamples }) => {
	if (samples.length < minSamples) return null;
	const covered = bins.filter((v) => v !== null && v !== undefined).length;
	if (covered < 24) return null;
	const trend = quadraticTrend(bins);
	// A sample whose own latitude has no trend estimate has nothing to be
	// detrended against, and passing it through raw would put the planet-scale
	// shape back into the distribution one band at a time.
	const residual = samples
		.filter(([i]) => trend[i] !== null && trend[i] !== undefined)
		.map(([i, luma]) => luma - trend[i]);
	if (residual.length < minSamples) return null;
	// The mean once, outside the reduction that uses it. Nested, this is O(n²):
	// 307-661 ms on 8,000 samples against 0.3-0.7 ms cached.
	const mean = residual.reduce((a, b) => a + b, 0) / residual.length;
	const sd = Math.sqrt(
		residual.reduce((a, v) => a + (v - mean) ** 2, 0) / residual.length,
	);
	return { b: bimodality(residual), samples: residual.length, covered, sd };
};
