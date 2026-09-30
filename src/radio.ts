/**
 * A voice heard through a ship's radio (prototype, 2026-09-30): the band a
 * transmitter passes, the drive of a small speaker, a hiss under it, a
 * squelch burst as the carrier opens and closes, and a roger beep at the end.
 * Offline, on a rendered phrase, at `SPEECH_RATE`. The narrow band also hides
 * much of a formant synthesiser's roughness, which is why a radio is where
 * these voices are heard.
 */
import { SPEECH_RATE } from "./speech";

export interface RadioSettings {
	readonly lowHz: number;
	readonly highHz: number;
	/** Speaker drive, 0..1. */
	readonly drive: number;
	/** Hiss under the keyed carrier, against the voice's peak. An FM receiver
	 *  is captured by the carrier, not by the voice: while the transmitter is
	 *  keyed the hiss stays this low through every word and gap, and it is
	 *  loud only in the squelch bursts as the carrier opens and drops.
	 *  Measured (`scripts/measure-speech-contrast.ts`): the first figure, 0.03,
	 *  sat on a stop's burst and glide and took B, D and G from 3.65, 5.28 and
	 *  2.87 dry to 0.93, 1.60 and 1.08; ducking it on the voice's envelope left
	 *  a word-initial stop under the full hiss. */
	readonly hiss: number;
	/** Squelch bursts at the open and close. */
	readonly squelch: boolean;
	/** A roger beep at the close, Hz; 0 for none. */
	readonly beepHz: number;
}

/** A telephone's and an aviation radio's band: 350–2800 Hz, the first
 *  figure, cut F1 of IY, UW and ER, which is what tells the close vowels
 *  apart, and the top of F3. */
/** The keyed carrier's hiss, and the squelch bursts' level. */
export const HISS_KEYED = 0.002;
const SQUELCH_LEVEL = 0.5;

export const RADIO: RadioSettings = {
	lowHz: 300,
	highHz: 3400,
	drive: 0.5,
	hiss: HISS_KEYED,
	squelch: true,
	beepHz: 2475,
};

/** An RBJ biquad, high- or low-pass, Butterworth. */
function biquad(kind: "lp" | "hp", hz: number) {
	const w = (2 * Math.PI * hz) / SPEECH_RATE;
	const alpha = Math.sin(w) / Math.SQRT2;
	const cw = Math.cos(w);
	const b0 = kind === "lp" ? (1 - cw) / 2 : (1 + cw) / 2;
	const b1 = kind === "lp" ? 1 - cw : -(1 + cw);
	const a0 = 1 + alpha;
	const c = [b0 / a0, b1 / a0, b0 / a0, (-2 * cw) / a0, (1 - alpha) / a0];
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	return (x: number) => {
		const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = y;
		return y;
	};
}

/** The band: two poles each side, so the skirts fall 24 dB an octave. */
function band(s: RadioSettings) {
	const f = [
		biquad("hp", s.lowHz),
		biquad("hp", s.lowHz),
		biquad("lp", s.highHz),
		biquad("lp", s.highHz),
	];
	return (x: number) => f.reduce((y, g) => g(y), x);
}

function noise(seed: number): () => number {
	let x = seed >>> 0 || 1;
	return () => {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		x >>>= 0;
		return x / 2147483648 - 1;
	};
}

const SQUELCH_S = 0.09;
const TAIL_S = 0.16;
const BEEP_S = 0.18;

/** `voice` through the radio: a new buffer, with the squelch and beep.
 *  `noiseOut`, when given, receives the noise alone, sample for sample:
 *  what masks the voice, for `scripts/measure-speech-contrast.ts`. */
export function radio(
	voice: Float32Array,
	s: RadioSettings = RADIO,
	seed = 7,
	noiseOut?: (noise: Float32Array) => void,
): Float32Array {
	const rand = noise(seed);
	const open = s.squelch ? Math.round(SQUELCH_S * SPEECH_RATE) : 0;
	const tail = s.squelch ? Math.round(TAIL_S * SPEECH_RATE) : 0;
	const beep = s.beepHz > 0 ? Math.round(BEEP_S * SPEECH_RATE) : 0;
	const out = new Float32Array(open + voice.length + beep + tail);
	const noiseBuf = noiseOut ? new Float32Array(out.length) : null;
	const voiceBand = band(s);
	const hissBand = band(s);
	const k = 1 + 8 * s.drive;
	const norm = Math.tanh(k);
	for (let i = 0; i < out.length; i++) {
		const v = i >= open && i < open + voice.length ? voice[i - open] : 0;
		// The squelch: the carrier's noise, loud as it opens and as it drops.
		let burst = 0;
		if (i < open) burst = SQUELCH_LEVEL * (1 - i / open);
		const end = open + voice.length + beep;
		if (i >= end)
			burst =
				0.9 * SQUELCH_LEVEL * Math.exp((-6 * (i - end)) / Math.max(1, tail));
		let b = 0;
		if (beep && i >= open + voice.length && i < end)
			b =
				0.25 *
				Math.sin(
					(2 * Math.PI * s.beepHz * (i - open - voice.length)) / SPEECH_RATE,
				);
		const x = voiceBand(v) + b;
		const carrier = i < end ? s.hiss : 0;
		const n = hissBand(rand()) * (carrier + burst) * 3;
		out[i] = (Math.tanh(k * x) / norm) * 0.8 + n;
		if (noiseBuf) noiseBuf[i] = n;
	}
	if (noiseOut && noiseBuf) noiseOut(noiseBuf);
	return out;
}
