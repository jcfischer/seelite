/**
 * The slow filter sweep (`sweepS`, `sweepOct`): the Berlin-school sequence's
 * filter opening and closing over many bars, and the Zeit-style noise wash.
 * One phase per part on the bank's clock, so every note of a part reads the
 * same point of the sweep: a sequence of short notes hears one continuous
 * movement, not a sweep restarted on every note.
 */
import { describe, expect, test } from "bun:test";
import type { PartSpec, VoiceKind } from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";

const SR = 48000;
const unity = { gain: () => 1 };

const part = (voice: VoiceKind, over: Partial<PartSpec> = {}) =>
	resolvePart({ voice, level: 1, ...over }, SR);

const render = (b: VoiceBank, frames: number) => {
	const out = new Float32Array(frames);
	for (let f = 0; f < frames; f += 128)
		b.render(out.subarray(f, Math.min(frames, f + 128)), f, unity);
	return out;
};

/** Rms of the first difference over rms: how bright a stretch is. */
const bright = (x: Float32Array, a: number, b: number) => {
	let d = 0;
	let e = 0;
	for (let i = a + 1; i < b; i++) {
		d += (x[i] - x[i - 1]) ** 2;
		e += x[i] * x[i];
	}
	return Math.sqrt(d / e);
};

describe("the slow sweep", () => {
	test("a held noise band opens as the sweep rises", () => {
		const p = part("noise", {
			sustain: 1,
			attackS: 0.01,
			sweepS: 4,
			sweepOct: 3,
		});
		const b = new VoiceBank(4, SR);
		b.noteOn(0, p, 0, 0, 60, 1, 4 * SR);
		const x = render(b, 3 * SR);
		const start = bright(x, 0.05 * SR, 0.3 * SR);
		const top = bright(x, 1.85 * SR, 2.15 * SR);
		expect(top).toBeGreaterThan(2 * start);
	});

	test("a held analog note opens as the sweep rises", () => {
		const p = part("analog", {
			sustain: 1,
			envAmount: 0,
			cutoffHz: 300,
			unison: 1,
			sweepS: 4,
			sweepOct: 3,
		});
		const b = new VoiceBank(4, SR);
		b.noteOn(0, p, 0, 0, 45, 1, 4 * SR);
		const x = render(b, 3 * SR);
		expect(bright(x, 1.85 * SR, 2.15 * SR)).toBeGreaterThan(
			2 * bright(x, 0.05 * SR, 0.3 * SR),
		);
	});

	test("a held acid note opens as the sweep rises", () => {
		const p = part("acid", {
			sustain: 1,
			envAmount: 0,
			sweepS: 4,
			sweepOct: 3,
		});
		const b = new VoiceBank(4, SR);
		b.noteOn(0, p, 0, 0, 45, 1, 4 * SR);
		const x = render(b, 3 * SR);
		expect(bright(x, 1.85 * SR, 2.15 * SR)).toBeGreaterThan(
			2 * bright(x, 0.05 * SR, 0.3 * SR),
		);
	});

	test("a note starts where the part's sweep is, not at its bottom", () => {
		const p = part("analog", {
			attackS: 0.001,
			sustain: 1,
			envAmount: 0,
			cutoffHz: 300,
			// One oscillator: the unison's random phases move this metric more
			// than the sweep does.
			unison: 1,
			drift: 0,
			sweepS: 4,
			sweepOct: 3,
		});
		const b = new VoiceBank(4, SR);
		// One note at the sweep's bottom, one at its top.
		b.noteOn(0, p, 0, 0, 45, 1, 0.3 * SR);
		b.noteOn(2 * SR, p, 0, 0, 45, 1, 0.3 * SR);
		const x = render(b, 2.4 * SR);
		expect(bright(x, 2.02 * SR, 2.25 * SR)).toBeGreaterThan(
			2 * bright(x, 0.02 * SR, 0.25 * SR),
		);
	});

	test("no sweep is no change: the default noise band keeps its damping", () => {
		expect(part("noise").damp).toBeCloseTo(0.9, 12);
		expect(part("noise").sweepOct).toBe(0);
		expect(part("analog").sweepOct).toBe(0);
	});

	test("resonance narrows the noise band", () => {
		const render1 = (resonance: number) => {
			const b = new VoiceBank(4, SR);
			b.noteOn(0, part("noise", { sustain: 1, resonance }), 0, 0, 72, 1, SR);
			return render(b, SR / 2);
		};
		// A narrower band is closer to a sine at its centre: its first
		// difference over rms approaches 2 sin(pi f / SR), and a wide band's
		// is higher, from everything above the centre.
		const wide = bright(render1(0.3), 0.05 * SR, 0.45 * SR);
		const narrow = bright(render1(0.95), 0.05 * SR, 0.45 * SR);
		expect(narrow).toBeLessThan(wide);
	});
});
