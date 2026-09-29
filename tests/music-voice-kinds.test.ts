/**
 * The synth's second set of voices (#560 D10, after the principal's
 * references on #548): analog unison, the morphing drone, acid and the
 * resonator keys, and the bell's decaying FM index. Written as seelite's own
 * code from the techniques (D9). What is arithmetic is here — each voice is in
 * tune, is stereo where it should be, moves the way its technique says, ends
 * in silence and frees its slot. What it sounds like is the principal's ear.
 */
import { describe, expect, test } from "bun:test";
import type { PartSpec, VoiceKind } from "../src/music-score";
import { resolvePart, VoiceBank } from "../src/music-voices";
import { period, rms } from "./lib/audio-measure";

const SR = 48000;
const unity = { gain: () => 1 };
const A3 = 57; // 220 Hz
const PERIOD_A3 = SR / 220;

const part = (voice: VoiceKind, over: Partial<PartSpec> = {}) =>
	resolvePart({ voice, level: 1, ...over }, SR);

/** Render `frames` in stereo, in 128-frame blocks. */
const render = (b: VoiceBank, frames: number) => {
	const L = new Float32Array(frames);
	const R = new Float32Array(frames);
	const scratch = () => new Float32Array(128);
	const revL = scratch();
	const revR = scratch();
	const echo = scratch();
	for (let f = 0; f < frames; f += 128) {
		const m = Math.min(128, frames - f);
		b.render(L.subarray(f, f + m), f, unity, {
			right: R.subarray(f, f + m),
			revL: revL.subarray(0, m),
			revR: revR.subarray(0, m),
			echo: echo.subarray(0, m),
		});
	}
	return { L, R };
};

const peakOf = (x: Float32Array) => {
	let m = 0;
	for (const v of x) m = Math.max(m, Math.abs(v));
	return m;
};
/** Rms of the first difference over rms: a crude high-pass, how bright. */
const bright = (x: Float32Array, a: number, b: number) => {
	let d = 0;
	let e = 0;
	for (let i = a + 1; i < b; i++) {
		d += (x[i] - x[i - 1]) ** 2;
		e += x[i] * x[i];
	}
	return Math.sqrt(d / e);
};
const correlation = (
	a: Float32Array,
	b: Float32Array,
	from: number,
	to: number,
) => {
	let ab = 0;
	let aa = 0;
	let bb = 0;
	for (let i = from; i < to; i++) {
		ab += a[i] * b[i];
		aa += a[i] * a[i];
		bb += b[i] * b[i];
	}
	return ab / Math.sqrt(aa * bb);
};

const NEW: VoiceKind[] = ["analog", "drone", "acid", "keys", "kick"];

describe("every new voice", () => {
	for (const kind of NEW)
		test(`${kind}: in tune, bounded, silent after its release, and its slot freed`, () => {
			const b = new VoiceBank(8, SR);
			const p = part(kind, { detune: 0, drift: 0 });
			b.noteOn(0, p, 0, 0, A3, 1, SR * 1.5);
			const { L, R } = render(b, SR * 8);
			const mid = (L: Float32Array, R: Float32Array) => {
				const m = new Float32Array(L.length);
				for (let i = 0; i < m.length; i++) m[i] = L[i] + R[i];
				return m;
			};
			const M = mid(L, R);
			// A kick sweeps by design: it has no one pitch to be in tune at.
			if (kind !== "kick") {
				const got = period(
					M,
					SR,
					4096,
					Math.round(PERIOD_A3 * 0.8),
					Math.round(PERIOD_A3 * 1.2),
				);
				expect(Math.abs(got / PERIOD_A3 - 1)).toBeLessThan(0.01);
			}
			expect(peakOf(L)).toBeLessThan(1.5);
			expect(peakOf(R)).toBeLessThan(1.5);
			expect(rms(M, 0, 0.2 * SR)).toBeGreaterThan(0.01);
			for (let i = 7 * SR; i < 8 * SR; i++) expect(M[i]).toBe(0);
			expect(b.sounding).toBe(0);
		});
});

describe("analog unison (R1, R2)", () => {
	test("detuned voices spread across the field: the two sides differ", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("analog", { unison: 4, spread: 1 }), 0, 0, A3, 1, SR);
		const { L, R } = render(b, SR);
		expect(correlation(L, R, 0.2 * SR, 0.8 * SR)).toBeLessThan(0.9);
	});

	test("one voice, no detune, no spread, no drift: one signal on both sides", () => {
		const b = new VoiceBank(4, SR);
		const p = part("analog", { unison: 1, spread: 0, detune: 0, drift: 0 });
		b.noteOn(0, p, 0, 0, A3, 1, SR);
		const { L, R } = render(b, SR);
		for (let i = 0; i < SR; i++) expect(L[i]).toBeCloseTo(R[i], 9);
	});

	test("the filter envelope opens bright and closes", () => {
		const b = new VoiceBank(4, SR);
		const p = part("analog", {
			envAmount: 3,
			envDecayS: 0.4,
			cutoffHz: 500,
			sustain: 1,
		});
		b.noteOn(0, p, 0, 0, A3, 1, SR * 2);
		const { L } = render(b, SR * 2);
		expect(bright(L, 0.02 * SR, 0.1 * SR)).toBeGreaterThan(
			1.5 * bright(L, 1.2 * SR, 1.5 * SR),
		);
	});
});

describe("the morphing drone (R5)", () => {
	test("it is wide", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(
			0,
			part("drone", { attackS: 0.05, releaseS: 0.5 }),
			0,
			0,
			A3,
			1,
			SR * 4,
		);
		const { L, R } = render(b, SR * 4);
		expect(correlation(L, R, SR, 3 * SR)).toBeLessThan(0.9);
	});

	test("its timbre moves while the note holds: the tables morph", () => {
		// One oscillator, no detune, no drift: the morph is all that can move.
		const b = new VoiceBank(4, SR);
		const p = part("drone", {
			attackS: 0.05,
			releaseS: 0.5,
			unison: 1,
			detune: 0,
			drift: 0,
			spread: 0,
		});
		b.noteOn(0, p, 0, 0, A3, 1, SR * 12);
		const { L } = render(b, SR * 12);
		const early = bright(L, SR, 1.5 * SR);
		const late = bright(L, 10 * SR, 10.5 * SR);
		expect(Math.abs(late / early - 1)).toBeGreaterThan(0.03);
	});
});

describe("acid (R3)", () => {
	/** Goertzel magnitude at `hz` over a window: one harmonic's level. */
	const at = (x: Float32Array, hz: number, a: number, b: number) => {
		const w = (2 * Math.PI * hz) / SR;
		const c = 2 * Math.cos(w);
		let s1 = 0;
		let s2 = 0;
		for (let i = a; i < b; i++) {
			const s0 = x[i] + c * s1 - s2;
			s2 = s1;
			s1 = s0;
		}
		return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
	};

	test("resonance lifts the harmonics at the cutoff", () => {
		const one = (resonance: number) => {
			const b = new VoiceBank(2, SR);
			b.noteOn(
				0,
				part("acid", { resonance, cutoffHz: 880, envAmount: 0, drive: 0 }),
				0,
				0,
				45,
				0.7,
				SR,
			);
			return render(b, SR).L;
		};
		// 110 Hz: its eighth harmonic sits on the cutoff.
		const ratio =
			at(one(0.9), 880, 0.1 * SR, 0.5 * SR) /
			at(one(0), 880, 0.1 * SR, 0.5 * SR);
		expect(ratio).toBeGreaterThan(2);
	});

	test("a note that overlaps the next slides to it on the same voice", () => {
		const b = new VoiceBank(4, SR);
		const p = part("acid", { glideS: 0.08 });
		b.noteOn(0, p, 0, 0, 45, 0.7, 0.6 * SR); // A2, held past the next start
		b.noteOn(0.5 * SR, p, 0, 0, 57, 0.7, 0.4 * SR); // A3
		render(b, 0.52 * SR);
		expect(b.sounding).toBe(1);
	});

	test("an acid note that takes another voice's slot starts on its own pitch (sage round 8)", () => {
		// One slot: an A5 pad sounding, then an A2 acid that must steal it. The
		// slide carries over only from an acid; a pad's A5 is not where it was.
		const b = new VoiceBank(1, SR);
		b.noteOn(0, part("pad"), 0, 0, 81, 0.7, SR);
		b.noteOn(
			0.1 * SR,
			part("acid", { glideS: 0.5, envAmount: 0, resonance: 0, cutoffHz: 4000 }),
			0,
			1,
			45,
			0.7,
			SR,
		);
		const { L } = render(b, 0.3 * SR);
		const P110 = SR / 110;
		const p = period(
			L,
			0.15 * SR,
			4096,
			Math.round(P110 * 0.4),
			Math.round(P110 * 1.2),
		);
		expect(Math.abs(p / P110 - 1)).toBeLessThan(0.01);
	});

	test("the slide glides: part-way between the two pitches, then at the second", () => {
		const b = new VoiceBank(4, SR);
		const p = part("acid", {
			glideS: 0.1,
			envAmount: 0,
			resonance: 0,
			cutoffHz: 4000,
		});
		b.noteOn(0, p, 0, 0, 45, 0.7, 0.6 * SR);
		b.noteOn(0.5 * SR, p, 0, 0, 57, 0.7, 0.8 * SR);
		const { L } = render(b, 1.2 * SR);
		const P110 = SR / 110;
		const early = period(
			L,
			0.3 * SR,
			4096,
			Math.round(P110 * 0.4),
			Math.round(P110 * 1.2),
		);
		const late = period(
			L,
			1.0 * SR,
			4096,
			Math.round(PERIOD_A3 * 0.8),
			Math.round(PERIOD_A3 * 1.2),
		);
		expect(Math.abs(early / P110 - 1)).toBeLessThan(0.01);
		expect(Math.abs(late / PERIOD_A3 - 1)).toBeLessThan(0.01);
		// 20 ms into the slide the pitch is on its way, not at either end.
		const during = period(
			L,
			0.52 * SR,
			1024,
			Math.round(PERIOD_A3 * 0.9),
			Math.round(P110 * 1.1),
		);
		expect(during).toBeGreaterThan(PERIOD_A3 * 1.05);
		expect(during).toBeLessThan(P110 * 0.95);
	});
});

describe("the resonator keys (R6)", () => {
	test("each note rings down, and its highs die first", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("keys", { decayS: 2 }), 0, 0, A3, 1, SR * 3);
		const { L } = render(b, SR * 3);
		expect(rms(L, 2.5 * SR, 2.9 * SR)).toBeLessThan(
			rms(L, 0.05 * SR, 0.3 * SR) / 5,
		);
		expect(bright(L, 2 * SR, 2.4 * SR)).toBeLessThan(
			0.8 * bright(L, 0.02 * SR, 0.2 * SR),
		);
	});
});

describe("the bell's decaying index (FM, `indexDecayS`)", () => {
	test("the tone darkens while the level holds", () => {
		const b = new VoiceBank(4, SR);
		const p = part("fm", {
			index: 3,
			indexDecayS: 0.3,
			sustain: 1,
			decayS: 5,
			ratio: 3.5,
		});
		b.noteOn(0, p, 0, 0, A3, 1, SR * 2);
		const { L } = render(b, SR * 2);
		expect(bright(L, 1.5 * SR, 1.9 * SR)).toBeLessThan(
			0.6 * bright(L, 0.01 * SR, 0.1 * SR),
		);
		expect(rms(L, 1.5 * SR, 1.9 * SR)).toBeGreaterThan(
			0.3 * rms(L, 0.01 * SR, 0.1 * SR),
		);
	});
});

describe("the layered kick (after 'Fat kick')", () => {
	test("a bright slap first, then a low body that falls in pitch", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("kick"), 0, 0, 29, 1, 0.3 * SR);
		const { L } = render(b, SR);
		// The slap: the first 8 ms are far brighter than the body.
		expect(bright(L, 0, 0.008 * SR)).toBeGreaterThan(
			3 * bright(L, 0.08 * SR, 0.2 * SR),
		);
		// The body sweeps down: its period grows from early to late.
		const early = period(L, 0.03 * SR, 2048, 200, 1400);
		const late = period(L, 0.15 * SR, 2048, 200, 1400);
		expect(late).toBeGreaterThan(early * 1.1);
		expect(rms(L, 0.05 * SR, 0.2 * SR)).toBeGreaterThan(0.05);
	});
});
