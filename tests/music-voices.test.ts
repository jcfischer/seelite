/**
 * The synth's voices (#560, after #543's D1 and D7): plain classes with the
 * sample rate passed in, so bun renders them without WebAudio. What they
 * *sound* like is the principal's ear; what is arithmetic is here — a note
 * starts on its frame, ends and frees its slot, sounds at its pitch, and the
 * bank never holds more than its cap.
 */
import { describe, expect, test } from "bun:test";
import type { PartSpec, VoiceKind } from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";

const SR = 48000;
const unity = { gain: () => 1 };

const bank = (cap = 8) => new VoiceBank(cap, SR);
const part = (voice: VoiceKind, over: Partial<PartSpec> = {}) =>
	resolvePart({ voice, level: 1, ...over }, SR);

/** Render `frames` from frame 0 in 128-frame blocks. */
const render = (b: VoiceBank, frames: number) => {
	const out = new Float32Array(frames);
	for (let f = 0; f < frames; f += 128)
		b.render(out.subarray(f, Math.min(frames, f + 128)), f, unity);
	return out;
};

const rms = (x: Float32Array, a = 0, b = x.length) => {
	let s = 0;
	for (let i = a; i < b; i++) s += x[i] * x[i];
	return Math.sqrt(s / Math.max(1, b - a));
};

/** The period, in frames, with the strongest autocorrelation between two
 *  lags: a fundamental estimate for a steady tone. */
const period = (x: Float32Array, from: number, len: number, lo: number, hi: number) => {
	let best = lo;
	let bestR = -Infinity;
	for (let lag = lo; lag <= hi; lag++) {
		let r = 0;
		for (let i = from; i < from + len; i++) r += x[i] * x[i + lag];
		if (r > bestR) {
			bestR = r;
			best = lag;
		}
	}
	// Parabolic refinement around the peak.
	const at = (lag: number) => {
		let r = 0;
		for (let i = from; i < from + len; i++) r += x[i] * x[i + lag];
		return r;
	};
	const a = at(best - 1);
	const c = at(best + 1);
	return best + (0.5 * (a - c)) / (a - 2 * bestR + c);
};

const KINDS: VoiceKind[] = ["pad", "pluck", "fm", "noise", "tone"];

describe("a note", () => {
	test.each(KINDS)("%s starts on its frame and not before", (kind) => {
		const b = bank();
		b.noteOn(1000, part(kind), 0, 0, 69, 1, 4800);
		const out = render(b, 6000);
		expect(rms(out, 0, 1000)).toBe(0);
		expect(rms(out, 1000, 6000)).toBeGreaterThan(0.001);
		let peak = 0;
		for (const v of out) {
			expect(Number.isFinite(v)).toBe(true);
			peak = Math.max(peak, Math.abs(v));
		}
		// A voice at full velocity and level stays under full scale.
		expect(peak).toBeLessThan(1);
	});

	test.each(KINDS)("%s ends and frees its slot", (kind) => {
		const b = bank();
		b.noteOn(0, part(kind), 0, 0, 60, 1, 2400);
		expect(b.sounding).toBe(1);
		const out = render(b, SR * 8);
		expect(b.sounding).toBe(0);
		expect(rms(out, out.length - 4800)).toBe(0);
	});

	test("velocity scales the level", () => {
		const loud = bank();
		loud.noteOn(0, part("fm"), 0, 0, 60, 1, 4800);
		const soft = bank();
		soft.noteOn(0, part("fm"), 0, 0, 60, 0.5, 4800);
		const r = rms(render(soft, 4800)) / rms(render(loud, 4800));
		expect(r).toBeCloseTo(0.5, 2);
	});

	test("the gain the engine hands in is applied per owner and part", () => {
		const b = bank();
		b.noteOn(0, part("fm"), 2, 3, 60, 1, 4800);
		const seen = new Set<string>();
		const out = new Float32Array(128);
		b.render(out, 0, {
			gain(owner, p) {
				seen.add(`${owner}/${p}`);
				return 0;
			},
		});
		expect([...seen]).toEqual(["2/3"]);
		expect(rms(out)).toBe(0);
	});
});

describe("pitch", () => {
	// A4 is 109.09 frames at 48 kHz.
	const A4 = SR / 440;
	test.each([
		["fm", { index: 0, feedback: 0 }],
		["pluck", {}],
		["pad", { cutoffHz: 8000 }],
		["tone", {}],
	] as const)("%s sounds at its pitch", (kind, over) => {
		const b = bank();
		b.noteOn(0, part(kind, over), 0, 0, 69, 1, SR);
		const out = render(b, 12000);
		// After the tone voice's glide has settled.
		const p = period(out, 6000, 2000, 90, 130);
		expect(Math.abs(p / A4 - 1)).toBeLessThan(0.005);
	});

	test("a pluck high in the range is in tune: the delay is fractional", () => {
		const b = bank();
		// C6, 1046.5 Hz: a whole-sample delay would be 34 cents sharp.
		b.noteOn(0, part("pluck"), 0, 0, 84, 1, SR);
		const out = render(b, 8000);
		const p = period(out, 2000, 2000, 40, 52);
		expect(Math.abs(p / (SR / 1046.502) - 1)).toBeLessThan(0.003);
	});
});

describe("the cap (#543 D7)", () => {
	test("no more voices sound than the cap, and the oldest gives way", () => {
		const b = bank(8);
		for (let i = 0; i < 30; i++)
			b.noteOn(i * 10, part("pad"), 0, 0, 40 + i, 1, SR);
		expect(b.sounding).toBe(8);
		expect(b.pitches().sort((x, y) => x - y)).toEqual([
			62, 63, 64, 65, 66, 67, 68, 69,
		]);
	});

	test("a slot that has ended is reused before one is taken", () => {
		const b = bank(2);
		b.noteOn(0, part("tone"), 0, 0, 50, 1, 100);
		b.noteOn(0, part("pad"), 0, 0, 60, 1, SR * 4);
		render(b, SR);
		expect(b.pitches()).toEqual([60]);
		b.noteOn(SR, part("pad"), 0, 0, 70, 1, SR);
		expect(b.pitches().sort()).toEqual([60, 70]);
	});

	test("clear silences every voice at once", () => {
		const b = bank();
		b.noteOn(0, part("pad"), 0, 0, 60, 1, SR);
		b.clear();
		expect(b.sounding).toBe(0);
		expect(rms(render(b, 1000))).toBe(0);
	});
});

describe("a part's defaults", () => {
	test("each voice has its own, and a spec overrides only what it names", () => {
		const pad = resolvePart({ voice: "pad", level: 0.5 }, SR);
		const quick = resolvePart({ voice: "pad", level: 0.5, attackS: 0.01 }, SR);
		expect(quick.attackFrames).toBe(480);
		expect(pad.attackFrames).toBeGreaterThan(quick.attackFrames);
		expect(quick.releaseCoef).toBe(pad.releaseCoef);
		expect(pad.level).toBe(0.5);
	});
});
