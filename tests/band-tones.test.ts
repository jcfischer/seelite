/**
 * The tone statistic #209's band check is built on, run against inputs a
 * browser cannot produce.
 *
 * The point of this file is the **rejection** case. A check nobody has watched
 * fail is a check whose failure is a conjecture, and this one passed a two-tone
 * surface twice on the way in: once because a screen row averaged belt and zone
 * together, and once because the detrend window was sized from the bin count
 * rather than from the bands actually populated, so it subtracted a constant and
 * left the planet-scale gradient in. Sage constructed the second case on the PR.
 * Both are here.
 */
import { describe, expect, test } from "bun:test";
import { bandMetrics, bimodality } from "../scripts/lib/band-tones.mjs";

/** Sarle's ceiling for a uniform distribution — the probe's own floor. */
const UNIFORM = 5 / 9;

const OPTS = { minSamples: 400 };

/**
 * A reading in the shape `__latitudeBands` returns: a mean per band, and every
 * sample as `[bandIndex, luma]`.
 *
 * `covered` bands are populated out of `bins`, centred, which is the shape the
 * lit face actually has — the cap is centred on the sub-solar point, so the
 * populated run is a minority of the latitude range and sits in the middle.
 */
const reading = (
	bins: number,
	covered: number,
	perBand: number,
	luma: (band: number, k: number) => number,
) => {
	const first = Math.floor((bins - covered) / 2);
	const rows: (number | null)[] = Array.from({ length: bins }, () => null);
	const samples: [number, number][] = [];
	for (let i = first; i < first + covered; i++) {
		let sum = 0;
		for (let k = 0; k < perBand; k++) {
			const v = luma(i, k);
			samples.push([i, v]);
			sum += v;
		}
		rows[i] = sum / perBand;
	}
	return { bins: rows, samples };
};

describe("Sarle's bimodality coefficient", () => {
	test("reads a two-point distribution near 1 and a normal one near a third", () => {
		const twoPoint = Array.from({ length: 2000 }, (_, i) =>
			i % 2 === 0 ? -10 : 10,
		);
		expect(bimodality(twoPoint)).toBeGreaterThan(0.9);

		// Box-Muller off a fixed lattice rather than Math.random: a test whose
		// input changes per run is a test that can fail for no reason.
		const normal = Array.from({ length: 4000 }, (_, i) => {
			const u = (i + 0.5) / 4000;
			const v = ((i * 7919) % 4000) / 4000;
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		});
		const b = bimodality(normal);
		expect(b).not.toBeNull();
		expect(b as number).toBeLessThan(0.45);
	});

	test("refuses a sample too small to have a fourth moment worth reading", () => {
		expect(bimodality([1, 2, 3])).toBeNull();
	});
});

describe("the band-tone reading", () => {
	/**
	 * **The case that carried a two-tone surface over the ceiling.**
	 *
	 * Alternating ±20 tones — a strictly two-tone banding — plus a linear
	 * gradient across latitude, which is what `JOVIAN`'s equatorial brightening
	 * and polar hood are. With the window sized from the bin count it is ±80
	 * over 100 populated bands: a near-constant subtraction that leaves the
	 * gradient in, and the gradient spreads the two tones into a middle that is
	 * not on the planet. It scored under the ceiling and passed.
	 */
	test("rejects two discrete tones carried over the ceiling by a gradient", () => {
		const r = reading(
			240,
			100,
			9,
			(band, k) => (k % 2 === 0 ? -20 : 20) + band * 1.5,
		);
		const m = bandMetrics(r, OPTS);
		expect(m).not.toBeNull();
		expect(m?.b).not.toBeNull();
		expect(m?.b as number).toBeGreaterThan(UNIFORM);
	});

	test("rejects two discrete tones with no gradient at all", () => {
		const r = reading(240, 100, 9, (_band, k) => (k % 2 === 0 ? -20 : 20));
		expect(bandMetrics(r, OPTS)?.b as number).toBeGreaterThan(UNIFORM);
	});

	/**
	 * **A flat sweep of the range is the uniform case, and it lands on 5/9.**
	 *
	 * This was written as an acceptance case — tones swept continuously across
	 * the range are what the node asked for, so surely they pass — and it failed
	 * at 0.5618 against a ceiling of 0.5556. The test was wrong, not the code: a
	 * linear sweep *is* a uniform distribution, and 5/9 is exactly uniform's
	 * coefficient, so it asked uniform to come in strictly under uniform.
	 *
	 * It is worth more as what it actually is. The ceiling this check compares
	 * against is a number from outside this repo, and a statistic that did not
	 * reproduce it on the distribution it is defined for would be the wrong
	 * statistic however plausible its readings looked.
	 */
	test("reproduces 5/9 on a uniform sweep, which is what the ceiling is", () => {
		const r = reading(240, 100, 9, (band, k) => {
			const t = (band * 9 + k) / 900;
			return (t * 2 - 1) * 20;
		});
		// One decimal: the sample-corrected estimate carries a finite-sample bias
		// at 900 samples and reads 0.562 against the exact 0.556. Pinning it
		// tighter would be pinning the sample size.
		expect(bandMetrics(r, OPTS)?.b as number).toBeCloseTo(UNIFORM, 1);
	});

	/** The acceptance case proper: tones clustered toward the middle of their
	 *  range rather than at its ends, which is what a graded band reads as. */
	test("accepts tones spread more smoothly than uniform", () => {
		const r = reading(240, 100, 9, (band, k) => {
			// Triangular: the sum of two flat sweeps is peaked in the middle.
			const a = ((band * 9 + k) % 300) / 300;
			const b = ((band * 7 + k * 3) % 300) / 300;
			return (a + b - 1) * 20;
		});
		expect(bandMetrics(r, OPTS)?.b as number).toBeLessThan(UNIFORM);
	});

	test("subtracts a pure gradient rather than reporting it as tones", () => {
		// No banding whatever — only the planet-scale ramp. Detrending should
		// leave nothing, so the statistic must not find structure in it.
		const r = reading(240, 100, 9, (band, k) => band * 1.5 + k * 0.01);
		const m = bandMetrics(r, OPTS);
		expect(m).not.toBeNull();
		expect(m?.sd as number).toBeLessThan(1);
	});

	test("sizes the detrend window from populated bands, not from the bin count", () => {
		// The same surface read at two bin counts with the same populated run.
		// A window taken from `bins.length` would change the answer between
		// these; taken from the populated count it cannot.
		const shape = (band: number, k: number) =>
			(k % 2 === 0 ? -20 : 20) + band * 1.5;
		const narrow = bandMetrics(reading(120, 100, 9, shape), OPTS);
		const wide = bandMetrics(reading(480, 100, 9, shape), OPTS);
		expect(narrow?.b).not.toBeNull();
		expect(wide?.b).not.toBeNull();
		expect(Math.abs((narrow?.b as number) - (wide?.b as number))).toBeLessThan(
			0.02,
		);
	});

	test("refuses a reading with too little of the surface populated", () => {
		expect(
			bandMetrics(
				reading(240, 12, 9, () => 1),
				OPTS,
			),
		).toBeNull();
		expect(
			bandMetrics(
				reading(240, 100, 1, () => 1),
				OPTS,
			),
		).toBeNull();
	});
});
