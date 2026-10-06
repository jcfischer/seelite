/**
 * The `sampler` voice (map #1's ruling on open-licensed music samples,
 * 2026-10-06), on a synthetic bank of sine "recordings": which recording a
 * note reads, at what rate, and when it ends — by its key's release, or by
 * the recording running out. What the real sets sound like is the
 * principal's ear (`npm run sounds -- --set voices`).
 */
import { describe, expect, test } from "bun:test";
import { MusicEngine } from "../src/music-engine";
import type { PartSpec, SampleBank, Song } from "../src/music-score";
import {
	pickLayer,
	pickZone,
	resolvePart,
	VoiceBank,
} from "../src/music-voices";
import { period, rms } from "./lib/audio-measure";

const SR = 48000;
const unity = { gain: () => 1 };

/** A sine at MIDI `root`, `seconds` long, recorded at `rate`. */
const sine = (root: number, seconds: number, rate = SR) => {
	const hz = 440 * 2 ** ((root - 69) / 12);
	return Float32Array.from(
		{ length: Math.round(seconds * rate) },
		(_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate),
	);
};

/** Two layers, soft to 0.6 and loud above, each sampled on A2, A3 and A4. */
const bank = (seconds = 2, rate = SR): SampleBank => ({
	rate,
	gain: 1,
	layers: [0.6, 1].map((maxVelocity) => ({
		maxVelocity,
		zones: [45, 57, 69].map((root) => ({
			root,
			data: sine(root, seconds, rate),
		})),
	})),
});

const sampler = (over: Partial<PartSpec> = {}) =>
	resolvePart({ voice: "sampler", samples: "test", level: 1, ...over }, SR);

/** Mono render of `frames`, in 128-frame blocks. */
const render = (b: VoiceBank, frames: number) => {
	const out = new Float32Array(frames);
	for (let f = 0; f < frames; f += 128)
		b.render(out.subarray(f, Math.min(frames, f + 128)), f, unity);
	return out;
};

describe("which recording a note reads", () => {
	const set = bank();
	test("the softest layer that reaches the velocity, the loudest above all", () => {
		expect(pickLayer(set, 0.3)).toBe(set.layers[0]);
		expect(pickLayer(set, 0.6)).toBe(set.layers[0]);
		expect(pickLayer(set, 0.61)).toBe(set.layers[1]);
		expect(pickLayer({ ...set, layers: [set.layers[0]] }, 0.9)).toBe(
			set.layers[0],
		);
	});
	test("the nearest root, the lower of two equally near", () => {
		const l = set.layers[0];
		expect(pickZone(l, 58)?.root).toBe(57);
		expect(pickZone(l, 66)?.root).toBe(69);
		expect(pickZone(l, 63)?.root).toBe(57);
		expect(pickZone(l, 20)?.root).toBe(45);
		expect(pickZone(l, 100)?.root).toBe(69);
	});
});

describe("the sampler voice", () => {
	test("plays a note at its pitch, read from the nearest root", () => {
		const b = new VoiceBank(4, SR);
		b.addSamples("test", bank());
		// C4 from the A3 recording, three semitones up.
		b.noteOn(0, sampler(), 0, 0, 60, 0.5, SR);
		const out = render(b, SR / 2);
		const hz = 440 * 2 ** ((60 - 69) / 12);
		// Lags around one period of C4 (183 frames): a window that reaches two
		// periods finds the octave below.
		const p = period(out, 2000, 8000, 120, 250);
		expect(Math.abs(SR / p - hz) / hz).toBeLessThan(0.005);
	});

	test("a set recorded at another rate is read at the context's", () => {
		const b = new VoiceBank(4, SR);
		b.addSamples("test", bank(2, 24000));
		b.noteOn(0, sampler(), 0, 0, 57, 0.5, SR);
		const out = render(b, SR / 2);
		const p = period(out, 2000, 8000, 100, 400);
		expect(Math.abs(SR / p - 220) / 220).toBeLessThan(0.005);
	});

	test("velocity scales within a layer", () => {
		const level = (vel: number) => {
			const b = new VoiceBank(4, SR);
			b.addSamples("test", bank());
			b.noteOn(0, sampler(), 0, 0, 57, vel, SR);
			return rms(render(b, SR / 4), 2000);
		};
		expect(level(0.3) / level(0.6)).toBeCloseTo(0.5, 2);
	});

	test("the key's release is the damper: silence and a free slot", () => {
		const b = new VoiceBank(4, SR);
		b.addSamples("test", bank());
		b.noteOn(0, sampler({ releaseS: 0.1 }), 0, 0, 57, 0.8, SR * 0.2);
		const out = render(b, SR * 0.6);
		expect(rms(out, 0, SR * 0.2)).toBeGreaterThan(0.1);
		expect(rms(out, SR * 0.35, SR * 0.6)).toBe(0);
		expect(b.sounding).toBe(0);
	});

	test("a recording that runs out ends its note, held or not", () => {
		const b = new VoiceBank(4, SR);
		b.addSamples("test", bank(0.1));
		b.noteOn(0, sampler(), 0, 0, 57, 0.8, SR * 2);
		const out = render(b, SR * 0.3);
		expect(rms(out, 0, SR * 0.09)).toBeGreaterThan(0.1);
		expect(rms(out, SR * 0.11, SR * 0.3)).toBe(0);
		expect(b.sounding).toBe(0);
	});

	test("an absent set plays the fallback, or nothing", () => {
		const quiet = new VoiceBank(4, SR);
		quiet.noteOn(0, sampler(), 0, 0, 57, 0.8, SR);
		expect(quiet.sounding).toBe(0);
		const backed = new VoiceBank(4, SR);
		backed.noteOn(0, sampler({ fallback: "epiano" }), 0, 0, 57, 0.8, SR);
		expect(backed.sounding).toBe(1);
		expect(rms(render(backed, SR / 4))).toBeGreaterThan(0.01);
	});

	test("its output is finite at the edges of the bank", () => {
		const b = new VoiceBank(4, SR);
		b.addSamples("test", bank(0.5));
		for (const pitch of [21, 108]) b.noteOn(0, sampler(), 0, 0, pitch, 1, SR);
		const out = render(b, SR);
		expect(out.every(Number.isFinite)).toBe(true);
	});
});

describe("a stereo set", () => {
	/** A3 on the left, and on the right the same note at a quarter of the
	 *  level: two sides that cannot be told apart by accident. */
	const stereo: SampleBank = {
		rate: SR,
		gain: 1,
		layers: [
			{
				maxVelocity: 1,
				zones: [
					{
						root: 57,
						data: sine(57, 1),
						right: sine(57, 1).map((v) => v / 4),
					},
				],
			},
		],
	};
	/** Stereo render of one note's first quarter second. */
	const sides = (set: SampleBank, pan = 0) => {
		const b = new VoiceBank(4, SR);
		b.addSamples("test", set);
		b.noteOn(0, sampler({ pan }), 0, 0, 57, 1, SR);
		const n = SR / 4;
		const L = new Float32Array(n);
		const R = new Float32Array(n);
		const z = () => new Float32Array(128);
		const room = { revL: z(), revR: z(), echo: z() };
		for (let f = 0; f < n; f += 128)
			b.render(L.subarray(f, f + 128), f, unity, {
				right: R.subarray(f, f + 128),
				sends: [room],
			});
		return { l: rms(L, 2000), r: rms(R, 2000) };
	};

	test("plays each side's own recording", () => {
		const { l, r } = sides(stereo);
		expect(r / l).toBeCloseTo(0.25, 2);
	});

	test("a mono set is the same on both sides", () => {
		const { l, r } = sides(bank());
		expect(r / l).toBeCloseTo(1, 3);
	});

	test("pan weighs the two sides, as a balance", () => {
		const centre = sides(stereo);
		const left = sides(stereo, -1);
		expect(left.r).toBeLessThan(centre.r * 1e-6);
		expect(left.l).toBeGreaterThan(centre.l);
	});
});

test("the engine hands a set it is sent to the voice", () => {
	const song: Song = {
		name: "sampled",
		beatsPerBar: 4,
		parts: { piano: { voice: "sampler", samples: "test", level: 1 } },
		sections: [
			{
				name: "a",
				bars: 1,
				events: [{ part: "piano", bar: 0, beat: 0, dur: 2, pitch: 57, vel: 1 }],
			},
		],
		tempo: [{ bar: 0, bpm: 120 }],
	};
	const level = (send: boolean) => {
		const e = new MusicEngine(SR, 8);
		if (send) e.command({ type: "samples", set: "test", bank: bank() }, 0);
		e.command({ type: "load", id: "s", song }, 0);
		e.command({ type: "play", id: "s", at: "bar" }, 0);
		const out = new Float32Array(SR / 2);
		for (let f = 0; f < out.length; f += 128)
			e.render(out.subarray(f, f + 128), f);
		return rms(out);
	};
	expect(level(false)).toBe(0);
	expect(level(true)).toBeGreaterThan(0.01);
});
