/**
 * The two orchestral voices (#547 D7/D8): a bowed string section and a soft
 * brass. The waltz was heard as *too plinky* on keys and plucks; these hold a
 * note for its length rather than decaying, and move the way a bow and a
 * horn do. What is arithmetic is here — in tune, bounded, sustained, the
 * attack in its range, the vibrato arriving late, a legato line gliding
 * without a new attack. What they sound like is the principal's ear.
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

/** Render `frames` in stereo; returns the mid, (L + R) / 2. */
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
	const M = new Float32Array(frames);
	const E = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		M[i] = 0.5 * (L[i] + R[i]);
		E[i] = Math.sqrt(0.5 * (L[i] * L[i] + R[i] * R[i]));
	}
	return { L, R, M, E };
};

/** Rms in windows of `w` frames: the level's shape over time. */
const envelope = (x: Float32Array, w = 480) => {
	const out: number[] = [];
	for (let a = 0; a + w <= x.length; a += w) out.push(rms(x, a, a + w));
	return out;
};

/** The pitch, from the period, in a window. */
const hzAt = (x: Float32Array, at: number, lo = 150, hi = 700) =>
	SR / period(x, at, 2048, Math.round(SR / hi), Math.round(SR / lo));

/** Rms of the second difference over rms: how much of it is high. The
 *  first difference is dominated by the fundamental of a dark voice. */
const highs = (x: Float32Array, a: number, z: number) => {
	let d = 0;
	let e = 0;
	for (let i = a + 2; i < z; i++) {
		d += (x[i] - 2 * x[i - 1] + x[i - 2]) ** 2;
		e += x[i] ** 2;
	}
	return Math.sqrt(d / e);
};

const ORCHESTRA: VoiceKind[] = ["strings", "brass"];

describe("each orchestral voice", () => {
	for (const kind of ORCHESTRA) {
		test(`${kind}: in tune, finite, bounded, silent after release, slot freed`, () => {
			const b = new VoiceBank(8, SR);
			b.noteOn(
				0,
				part(kind, { detune: 0, drift: 0, vibrato: 0 }),
				0,
				0,
				A3,
				1,
				SR * 1.5,
			);
			const { L, R, M } = render(b, SR * 8);
			for (const v of L) expect(Number.isFinite(v)).toBe(true);
			const got = period(
				M,
				SR,
				4096,
				Math.round(PERIOD_A3 * 0.8),
				Math.round(PERIOD_A3 * 1.2),
			);
			expect(Math.abs(got / PERIOD_A3 - 1)).toBeLessThan(0.01);
			let peak = 0;
			for (let i = 0; i < L.length; i++)
				peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
			expect(peak).toBeLessThan(1.5);
			for (let i = 7 * SR; i < 8 * SR; i++) expect(M[i]).toBe(0);
			expect(b.sounding).toBe(0);
		});

		test(`${kind}: sustains for the note's length, where a pluck decays`, () => {
			const held = (voice: VoiceKind) => {
				const b = new VoiceBank(4, SR);
				b.noteOn(0, part(voice), 0, 0, A3, 1, SR * 2);
				// In 100 ms windows over both sides: a detuned section beats
				// inside a shorter one, and a mid folds its spread away.
				return envelope(render(b, SR * 2).E, SR / 10);
			};
			// Its level around 80% of the way through the held note, against
			// the level once it has spoken: means over 0.4 s, since a section
			// beats inside any one window.
			const mean = (e: number[], a: number, z: number) =>
				e.slice(a, z).reduce((x, y) => x + y, 0) / (z - a);
			const e = held(kind);
			expect(mean(e, 14, 18)).toBeGreaterThan(0.6 * mean(e, 2, 6));
			// The control: a pluck held as long has all but died by then.
			const p = held("pluck");
			expect(mean(p, 14, 18)).toBeLessThan(0.3 * mean(p, 2, 6));
		});
	}
});

/** One oscillator, still: the attack is the envelope's, not a beat's. */
const plain = { unison: 1, detune: 0, drift: 0, vibrato: 0 } as const;

/** The time from the note's start to 90% of its settled level, s. */
const riseS = (e: number[], w = 480) => {
	const settled = e.slice(
		Math.floor((0.4 * SR) / w),
		Math.floor((0.8 * SR) / w),
	);
	const target = (0.9 * settled.reduce((a, b) => a + b, 0)) / settled.length;
	return (e.findIndex((v) => v >= target) * w) / SR;
};

describe("bowed strings", () => {
	test("the bow takes 80–150 ms to reach the note", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("strings", plain), 0, 0, A3, 0.8, SR);
		const t = riseS(envelope(render(b, SR).M, 240), 240);
		expect(t).toBeGreaterThanOrEqual(0.06);
		expect(t).toBeLessThanOrEqual(0.2);
	});

	test("the vibrato arrives after the note is under way: none at first, ~5 Hz later", () => {
		const b = new VoiceBank(4, SR);
		const p = part("strings", { unison: 1, detune: 0, drift: 0, vibrato: 0.3 });
		b.noteOn(0, p, 0, 0, A3, 1, SR * 3);
		const { M } = render(b, SR * 3);
		// The pitch read every 20 ms: its spread is the vibrato's depth.
		const spread = (from: number, to: number) => {
			const hz: number[] = [];
			for (let t = from; t < to; t += 0.02)
				hz.push(hzAt(M, Math.round(t * SR)));
			return Math.max(...hz) - Math.min(...hz);
		};
		const early = spread(0.05, 0.2);
		const late = spread(1.5, 2.5);
		expect(late).toBeGreaterThan(1.5);
		expect(early).toBeLessThan(0.4 * late);
	});

	test("the bow is heard on the attack: noise at the onset, not in the hold", () => {
		const one = (vel: number) => {
			const b = new VoiceBank(4, SR);
			b.noteOn(
				0,
				part("strings", { unison: 1, detune: 0, drift: 0, vibrato: 0 }),
				0,
				0,
				A3,
				vel,
				SR,
			);
			return render(b, SR).M;
		};
		const x = one(1);
		// Noise is what is not periodic: compare the signal to itself one
		// period later, at the onset and in the hold.
		const aperiodic = (from: number) => {
			const P = Math.round(PERIOD_A3);
			let d = 0;
			let e = 0;
			for (let i = from; i < from + 2400; i++) {
				d += (x[i + P] - x[i]) ** 2;
				e += x[i] ** 2;
			}
			return d / e;
		};
		expect(aperiodic(Math.round(0.01 * SR))).toBeGreaterThan(
			3 * aperiodic(Math.round(0.6 * SR)),
		);
	});

	test("the filter opens with velocity: a harder bow is brighter", () => {
		const one = (vel: number) => {
			const b = new VoiceBank(4, SR);
			b.noteOn(0, part("strings", { vibrato: 0 }), 0, 0, A3, vel, SR);
			const { M } = render(b, SR);
			const s = M.subarray(0.4 * SR, 0.8 * SR);
			let d = 0;
			let e = 0;
			for (let i = 1; i < s.length; i++) {
				d += (s[i] - s[i - 1]) ** 2;
				e += s[i] ** 2;
			}
			return Math.sqrt(d / e);
		};
		expect(one(1)).toBeGreaterThan(1.3 * one(0.3));
	});

	test("legato: a note that follows on glides there without a new attack", () => {
		const b = new VoiceBank(4, SR);
		const p = part("strings", {
			unison: 1,
			detune: 0,
			drift: 0,
			vibrato: 0,
			glideS: 0.04,
		});
		b.noteOn(0, p, 0, 0, A3, 1, SR);
		// Overlapping by 10 ms, as a lilted line does: a fifth up.
		b.noteOn(SR - 480, p, 0, 0, A3 + 7, 1, SR);
		const { M } = render(b, 2 * SR);
		// One voice carried both notes.
		expect(b.pitches().length).toBeLessThanOrEqual(1);
		const e = envelope(M, 240);
		// No dip to silence and re-attack across the join.
		const join = Math.round(SR / 240);
		const around = e.slice(join - 4, join + 12);
		expect(Math.min(...around)).toBeGreaterThan(0.7 * e[join - 6]);
		// And it arrives at the new pitch.
		expect(
			Math.abs(hzAt(M, Math.round(1.5 * SR), 250, 450) / 329.63 - 1),
		).toBeLessThan(0.01);
	});

	test("without legato, a following note is a new bow", () => {
		const b = new VoiceBank(4, SR);
		const p = part("strings", { unison: 1, detune: 0, drift: 0, vibrato: 0 });
		b.noteOn(0, p, 0, 0, A3, 1, SR);
		b.noteOn(SR - 480, p, 0, 0, A3 + 7, 1, SR);
		render(b, SR + 480);
		expect(b.pitches().length).toBe(2);
	});

	test("a chord in one part is three voices, each at its own pitch", () => {
		const b = new VoiceBank(8, SR);
		const p = part("strings", { glideS: 0.04 });
		for (const n of [57, 61, 64]) b.noteOn(0, p, 0, 0, n, 1, SR);
		render(b, 0.1 * SR);
		expect(b.pitches().sort()).toEqual([57, 61, 64]);
	});
});

describe("soft brass", () => {
	test("the attack swells in 100–250 ms", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("brass", plain), 0, 0, A3, 0.8, SR);
		const t = riseS(envelope(render(b, SR).M, 240), 240);
		expect(t).toBeGreaterThanOrEqual(0.08);
		expect(t).toBeLessThanOrEqual(0.25);
	});

	test("it brightens as it speaks: the filter swells after the onset", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("brass"), 0, 0, A3, 1, SR);
		const { M } = render(b, SR);
		const bright = (a: number, z: number) => highs(M, a, z);
		expect(bright(0.2 * SR, 0.3 * SR)).toBeGreaterThan(
			1.2 * bright(0.005 * SR, 0.03 * SR),
		);
	});

	test("the pitch rises into the note: flat at the onset, in tune after", () => {
		const b = new VoiceBank(4, SR);
		b.noteOn(0, part("brass", { detune: 0, vibrato: 0 }), 0, 0, A3, 1, SR);
		const { M } = render(b, SR);
		expect(hzAt(M, 0.005 * SR)).toBeLessThan(219);
		expect(Math.abs(hzAt(M, 0.5 * SR) / 220 - 1)).toBeLessThan(0.005);
	});

	test("no bite at p: soft is darker than loud", () => {
		const one = (vel: number) => {
			const b = new VoiceBank(4, SR);
			b.noteOn(0, part("brass"), 0, 0, A3, vel, SR);
			return highs(render(b, SR).M, 0.4 * SR, 0.8 * SR);
		};
		expect(one(1)).toBeGreaterThan(1.5 * one(0.3));
	});
});
