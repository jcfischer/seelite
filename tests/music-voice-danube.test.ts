/**
 * The Danube versions' voices: the chip's pulse, the electric piano, the
 * harpsichord and the soft saws. Written as seelite's own code from the
 * techniques. What is arithmetic is here — each is in tune, bounded, ends in
 * silence and frees its slot, and moves the way its technique says. What it
 * sounds like is the principal's ear (`npm run sounds -- --set voices`).
 */
import { describe, expect, test } from "bun:test";
import type { PartSpec, VoiceKind } from "../src/music-score";
import { compileSong } from "../src/music-sequencer";
import { VOICE_DEMOS } from "../src/music-voice-demos";
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
			sends: [
				{
					revL: revL.subarray(0, m),
					revR: revR.subarray(0, m),
					echo: echo.subarray(0, m),
				},
			],
		});
	}
	return { L, R };
};

const mid = (L: Float32Array, R: Float32Array) => {
	const m = new Float32Array(L.length);
	for (let i = 0; i < m.length; i++) m[i] = L[i] + R[i];
	return m;
};

/** One note, rendered: `vel`, held `heldS`, over `totalS`. */
const note = (
	kind: VoiceKind,
	over: Partial<PartSpec> = {},
	{ pitch = A3, vel = 1, heldS = 1.5, totalS = 3 } = {},
) => {
	const b = new VoiceBank(8, SR);
	b.noteOn(0, part(kind, over), 0, 0, pitch, vel, SR * heldS);
	const { L, R } = render(b, Math.round(SR * totalS));
	return { b, L, R, M: mid(L, R) };
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

/** The magnitude of one frequency over frames `a` to `b`, through a Hann
 *  window so a loud tone elsewhere does not leak into it. */
const tone = (x: Float32Array, hz: number, a: number, b: number) => {
	const w = (2 * Math.PI * hz) / SR;
	let re = 0;
	let im = 0;
	for (let i = a; i < b; i++) {
		const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i - a)) / (b - a - 1));
		re += h * x[i] * Math.cos(w * i);
		im += h * x[i] * Math.sin(w * i);
	}
	return Math.hypot(re, im) / (b - a);
};

const peakOf = (x: Float32Array) => {
	let m = 0;
	for (const v of x) m = Math.max(m, Math.abs(v));
	return m;
};

const DANUBE: VoiceKind[] = ["pulse", "epiano", "harpsi", "softsaw"];

describe("every Danube voice", () => {
	for (const kind of DANUBE)
		test(`${kind}: in tune, bounded, silent after its release, and its slot freed`, () => {
			const { b, L, R, M } = note(kind, { detune: 0, drift: 0 }, { totalS: 8 });
			const got = period(
				M,
				SR,
				4096,
				Math.round(PERIOD_A3 * 0.8),
				Math.round(PERIOD_A3 * 1.2),
			);
			expect(Math.abs(got / PERIOD_A3 - 1)).toBeLessThan(0.01);
			expect(peakOf(L)).toBeLessThan(1.5);
			expect(peakOf(R)).toBeLessThan(1.5);
			expect(rms(M, 0, 0.2 * SR)).toBeGreaterThan(0.01);
			for (let i = 7 * SR; i < 8 * SR; i++) expect(M[i]).toBe(0);
			expect(b.sounding).toBe(0);
		});

	for (const kind of DANUBE)
		test(`${kind}: finite across the keyboard and at every velocity`, () => {
			for (const pitch of [24, 45, 69, 96, 108])
				for (const vel of [0.1, 0.6, 1]) {
					const { M } = note(kind, {}, { pitch, vel, heldS: 0.4, totalS: 0.6 });
					for (const v of M) expect(Number.isFinite(v)).toBe(true);
					expect(peakOf(M)).toBeLessThan(3);
				}
		});
});

describe("pulse", () => {
	test("its width is the share of the cycle it is high", () => {
		for (const width of [0.5, 0.25, 0.125]) {
			const { M } = note("pulse", { width, decayS: 9, sustain: 1 });
			let high = 0;
			let n = 0;
			for (let i = 0.5 * SR; i < SR; i++, n++) if (M[i] > 0) high++;
			expect(Math.abs(high / n - width)).toBeLessThan(0.02);
		}
	});

	test("a width out of range is held inside it", () => {
		const p = part("pulse", { width: 0.9 });
		expect(p.width).toBe(0.5);
		expect(part("pulse", { width: 0 }).width).toBe(0.05);
	});

	test("the sweep moves the width", () => {
		const share = (a: number, b: number, M: Float32Array) => {
			let high = 0;
			for (let i = a; i < b; i++) if (M[i] > 0) high++;
			return high / (b - a);
		};
		const { M } = note(
			"pulse",
			{ width: 0.3, pwmHz: 1, pwmDepth: 0.15, decayS: 9, sustain: 1 },
			{ heldS: 2, totalS: 2 },
		);
		// A quarter cycle in, the width is at its widest; three quarters, its
		// narrowest.
		const wide = share(0.2 * SR, 0.3 * SR, M);
		const narrow = share(0.7 * SR, 0.8 * SR, M);
		expect(wide).toBeGreaterThan(0.4);
		expect(narrow).toBeLessThan(0.2);
	});

	test("a lowpass asked for far above the eighth of the rate stays stable", () => {
		// The shared coefficient allows a sixth, where an undamped filter runs
		// away; a NaN there silences the song's whole room.
		const { M } = note("pulse", {
			cutoffHz: 20000,
			resonance: 0,
			decayS: 9,
			sustain: 1,
		});
		for (const v of M) expect(Number.isFinite(v)).toBe(true);
		expect(rms(M, 0.5 * SR, SR)).toBeGreaterThan(0.05);
		expect(peakOf(M)).toBeLessThan(1.5);
	});
});

describe("epiano", () => {
	test("struck harder it is brighter, not only louder", () => {
		const soft = note("epiano", {}, { vel: 0.3 }).M;
		const hard = note("epiano", {}, { vel: 1 }).M;
		expect(bright(hard, 0.05 * SR, 0.3 * SR)).toBeGreaterThan(
			1.2 * bright(soft, 0.05 * SR, 0.3 * SR),
		);
	});

	test("it mellows as it rings", () => {
		const { M } = note("epiano", {}, { heldS: 4, totalS: 4 });
		expect(bright(M, 0.02 * SR, 0.2 * SR)).toBeGreaterThan(
			1.3 * bright(M, 2.5 * SR, 3 * SR),
		);
	});

	test("the tine's clank is at its partial, and gone within a tenth of a second", () => {
		const { M } = note("epiano", {}, { heldS: 1, totalS: 1 });
		// The tine's sidebands sit ratio ± 1 times the note above it.
		const at = (a: number, b: number) =>
			tone(M, 220 * 12, a, b) + tone(M, 220 * 10, a, b);
		expect(at(0, 0.02 * SR)).toBeGreaterThan(10 * at(0.3 * SR, 0.32 * SR));
	});

	test("a high note leaves the tine out rather than alias it", () => {
		const { M } = note("epiano", {}, { pitch: 108, heldS: 0.3, totalS: 0.3 });
		for (const v of M) expect(Number.isFinite(v)).toBe(true);
		expect(rms(M, 0, 0.1 * SR)).toBeGreaterThan(0.01);
	});
});

describe("harpsi", () => {
	test("velocity barely moves its level", () => {
		const soft = rms(note("harpsi", {}, { vel: 0.2 }).M, 0, 0.5 * SR);
		const hard = rms(note("harpsi", {}, { vel: 1 }).M, 0, 0.5 * SR);
		expect(soft / hard).toBeGreaterThan(0.8);
	});

	test("plucked at a quarter of its length, its fourth harmonic is missing", () => {
		const { M } = note("harpsi", { index: 0.25, detune: 0 }, { pitch: 45 });
		// A2 is 110 Hz: harmonics 3, 4 and 5 at 330, 440 and 550 Hz.
		const a = 0.05 * SR;
		const b = 0.45 * SR;
		const h = (k: number) => tone(M, 110 * k, a, b);
		expect(h(4)).toBeLessThan(0.3 * h(3));
		expect(h(4)).toBeLessThan(0.3 * h(5));
	});

	test("it rings while the key is down, and the damper stops it", () => {
		const { M } = note("harpsi", {}, { heldS: 1, totalS: 1.6 });
		expect(rms(M, 0.8 * SR, 0.95 * SR)).toBeGreaterThan(0.05);
		expect(rms(M, 1.4 * SR, 1.6 * SR)).toBeLessThan(0.002);
	});

	test("the damper's thunk sounds as the key is let go", () => {
		// Below the string's fundamental, where only the thunk's noise is.
		const low = (M: Float32Array, a: number, b: number) =>
			tone(M, 60, a, b) + tone(M, 90, a, b) + tone(M, 120, a, b);
		const { M } = note("harpsi", {}, { pitch: 93, heldS: 0.5, totalS: 0.7 });
		expect(low(M, 0.5 * SR, 0.53 * SR)).toBeGreaterThan(
			3 * low(M, 0.4 * SR, 0.43 * SR),
		);
	});
});

describe("softsaw", () => {
	test("bright at the strike, rounder as it rings", () => {
		const { M } = note("softsaw", { detune: 0 }, { heldS: 3, totalS: 3 });
		expect(bright(M, 0.02 * SR, 0.1 * SR)).toBeGreaterThan(
			1.3 * bright(M, 2 * SR, 2.5 * SR),
		);
	});

	test("its saws sit across the field: the two sides differ", () => {
		const { L, R } = note("softsaw");
		let ab = 0;
		let aa = 0;
		let bb = 0;
		for (let i = 0.2 * SR; i < 0.8 * SR; i++) {
			ab += L[i] * R[i];
			aa += L[i] * L[i];
			bb += R[i] * R[i];
		}
		expect(ab / Math.sqrt(aa * bb)).toBeLessThan(0.9);
	});
});

describe("the voice demos (`npm run sounds -- --set voices`)", () => {
	test("each compiles, and between them they sound every Danube voice", () => {
		for (const s of Object.values(VOICE_DEMOS))
			expect(() => compileSong(s)).not.toThrow();
		const voices = new Set(
			Object.values(VOICE_DEMOS).flatMap((s) =>
				Object.values(s.parts).map((p) => p.voice),
			),
		);
		expect([...voices].sort()).toEqual([...DANUBE].sort());
	});
});
