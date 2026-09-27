/**
 * `cueStats` is what a sound probe reads off a rendered buffer (#541): level,
 * onset, spectral centroid and a hash. bun has no WebAudio, so the one part of
 * `scripts/measure-audio.mjs` that can be held headless is this arithmetic,
 * run here on buffers built by hand where every answer is known.
 */
import { expect, test } from "bun:test";
import { cueStats } from "../scripts/lib/audio-stats.mjs";

/** A sine of `amp` at `hz`, silent until `startS`, `seconds` long. */
const sine = (
	sr: number,
	hz: number,
	amp: number,
	startS: number,
	seconds = 1,
) => {
	const x = new Float32Array(Math.round(sr * seconds));
	const start = Math.round(sr * startS);
	for (let i = start; i < x.length; i++)
		x[i] = amp * Math.sin((2 * Math.PI * hz * (i - start)) / sr);
	return x;
};

test("rms and peak of a sine are its amplitude over root two, and its amplitude", () => {
	const s = cueStats(sine(48000, 1000, 0.5, 0), 48000);
	expect(s.rms).toBeCloseTo(0.5 / Math.SQRT2, 3);
	expect(s.peak).toBeCloseTo(0.5, 3);
});

test("onset is the first sample above the threshold, in samples and in ms", () => {
	// A sine starts at zero, so the first sample over 1e-3 is one or two past
	// the start; the start itself is the floor.
	const s = cueStats(sine(48000, 1000, 0.5, 0.25), 48000);
	expect(s.onsetSample).toBeGreaterThanOrEqual(12000);
	expect(s.onsetSample).toBeLessThanOrEqual(12002);
	expect(s.onsetMs).toBeCloseTo((s.onsetSample * 1000) / 48000, 6);
});

test("a silent buffer has no onset and no centroid", () => {
	const s = cueStats(new Float32Array(4800), 48000);
	expect(s.onsetSample).toBe(-1);
	expect(s.centroidHz).toBe(0);
});

test("the centroid of a pure tone is the tone", () => {
	const s = cueStats(sine(48000, 1000, 0.5, 0.1), 48000);
	expect(Math.abs(s.centroidHz - 1000)).toBeLessThan(50);
});

/** A falling sweep, 4 kHz to 500 Hz over 140 ms, as `laser()` slides. */
const chirp = (sr: number) => {
	const x = new Float32Array(sr / 2);
	const start = Math.round(sr * 0.05);
	let ph = 0;
	for (let i = start; i < x.length; i++) {
		const t = (i - start) / sr;
		ph += (2 * Math.PI * 4000 * (500 / 4000) ** Math.min(1, t / 0.14)) / sr;
		x[i] = 0.5 * Math.sin(ph);
	}
	return x;
};

// The first harness read one cue, `laser()`'s square sweep, at 4861 Hz at
// 48 kHz and 4482 Hz at 44.1 kHz. Two causes, and a test each.

test("the centroid of a sweep does not move with the sample rate", () => {
	// A window of fixed *samples* covers a different stretch of a sweep at each
	// rate. A pure tone cannot show this — both windows read it within 1.5% —
	// so the case is a sweep. The rejected arm is run beside the shipped one,
	// so the test shows it can tell them apart.
	const apart = (opts: (sr: number) => object) => {
		const a = cueStats(chirp(48000), 48000, opts(48000)).centroidHz;
		const b = cueStats(chirp(44100), 44100, opts(44100)).centroidHz;
		return Math.abs(a - b) / a;
	};
	expect(apart(() => ({}))).toBeLessThan(0.01);
	expect(apart((sr) => ({ windowS: 4096 / sr }))).toBeGreaterThan(0.03);
});

/** A band-limited square at `hz`: every odd harmonic below Nyquist. */
const square = (sr: number, hz: number) => {
	const x = new Float32Array(sr / 4);
	for (let k = 1; k * hz < sr / 2; k += 2)
		for (let i = 0; i < x.length; i++)
			x[i] += (0.3 / k) * Math.sin((2 * Math.PI * k * hz * i) / sr);
	return x;
};

test("the centroid of a harmonic-rich tone does not move with the sample rate", () => {
	// A band-limited oscillator carries harmonics up to Nyquist, so a spectrum
	// summed to Nyquist has a different set at 48 kHz than at 44.1: the square
	// here reads far apart that way, and the larger part of the first harness's
	// gap was this rather than the window. The centroid stops at a fixed
	// frequency below both Nyquists; the uncapped arm runs beside it.
	const apart = (opts: object) => {
		const a = cueStats(square(48000, 880), 48000, opts).centroidHz;
		const b = cueStats(square(44100, 880), 44100, opts).centroidHz;
		return Math.abs(a - b) / a;
	};
	expect(apart({})).toBeLessThan(0.01);
	expect(apart({ maxHz: Number.POSITIVE_INFINITY })).toBeGreaterThan(0.2);
});

test("the cap cannot hold below twice itself, and the stats say so", () => {
	// Below 32 kHz Nyquist is under the cap, and the sum stops at Nyquist
	// again. A caller comparing rates there is told rather than trusted.
	expect(cueStats(square(48000, 880), 48000).centroidCapHz).toBe(16000);
	expect(cueStats(square(22050, 880), 22050).centroidCapHz).toBe(11025);
});

test("the hash is the samples: equal buffers agree, one changed sample does not", () => {
	const x = sine(48000, 440, 0.3, 0.05, 0.2);
	const y = x.slice();
	expect(cueStats(x, 48000).fnv).toBe(cueStats(y, 48000).fnv);
	y[5000] += 1e-6;
	expect(cueStats(x, 48000).fnv).not.toBe(cueStats(y, 48000).fnv);
});

test("cueStats is self-contained, because the page receives it as source", () => {
	// measure-audio.mjs ships the function to the browser by its text. A
	// reference to anything outside its own body would be a ReferenceError
	// there and nowhere in this file.
	const revived = new Function(`return (${cueStats.toString()})`)();
	const x = sine(48000, 1000, 0.5, 0.1);
	expect(revived(x, 48000)).toEqual(cueStats(x, 48000));
});
