/**
 * The first formant synthesiser (kept to compare by ear, like the music
 * beds): seelite's own, in the manner of Klatt's
 * cascade synthesiser (1980) and the speech chips of the early eighties.
 * Voices for the radio and for the music (prototype, 2026-09-30).
 *
 * **Why not `speechSynthesis`.** Its output cannot be routed into WebAudio,
 * so there is no radio chain; its voices differ per platform; and some are
 * network voices, which the map's no-network Constraint forbids. So speech
 * is synthesised here, like every other sound.
 *
 * **How.** A phrase is ARPAbet phonemes (`speech-lexicon.ts` turns the
 * game's words into them). Each phoneme is a target: three formants, a
 * voicing level, an aspiration level, a frication level and band. Stops are
 * expanded into closure, burst and aspiration. The targets become 5 ms frame
 * tracks, smoothed so the formants glide from one phoneme into the next —
 * which is most of what makes formant speech intelligible. Per sample, a
 * glottal pulse (Rosenberg's) and aspiration noise go through four formant
 * resonators in cascade, and frication noise through one more in parallel.
 *
 * Rendered offline, at `SPEECH_RATE`, into a `Float32Array`: a phrase is
 * short and said many times, so it is rendered once and played as a buffer.
 * Pure and deterministic, so `tests/speech.test.ts` holds it headless.
 */
import { xorshiftNoise as noise } from "./xorshift";

export const SPEECH_RATE = 16000;
const FRAME = 80; // 5 ms
const FRAME_S = FRAME / SPEECH_RATE;

type Formants = readonly [number, number, number];

/** One phoneme's targets. `f2` is a diphthong's end. Levels are 0..1. */
interface PhonemeSpec {
	readonly f: Formants;
	readonly f2?: Formants;
	readonly ms: number;
	/** Voicing, aspiration (noise through the formants), frication (noise
	 *  through its own band). */
	readonly av: number;
	readonly ah?: number;
	readonly af?: number;
	readonly ff?: number;
	readonly fb?: number;
	readonly vowel?: boolean;
	/** A stop: expanded into closure, burst and (voiceless) aspiration. */
	readonly stop?: { readonly voiced: boolean; readonly burstHz: number };
	/** An affricate: a stop into this fricative. */
	readonly then?: string;
	/** Take the next phoneme's formants (HH). */
	readonly copyNext?: boolean;
}

/** Adult male targets, after Peterson and Barney's and Klatt's tables. */
const V = (f: Formants, ms: number, f2?: Formants): PhonemeSpec => ({
	f,
	f2,
	ms,
	av: 1,
	vowel: true,
});
export const PHONEMES: Readonly<Record<string, PhonemeSpec>> = {
	IY: V([270, 2290, 3010], 150),
	IH: V([390, 1990, 2550], 105),
	EH: V([530, 1840, 2480], 125),
	AE: V([660, 1720, 2410], 170),
	AA: V([730, 1090, 2440], 170),
	AO: V([570, 840, 2410], 170),
	UH: V([440, 1020, 2240], 105),
	UW: V([300, 870, 2240], 150),
	AH: V([640, 1190, 2390], 105),
	AX: V([500, 1500, 2500], 65),
	ER: V([490, 1350, 1690], 160),
	EY: V([480, 1720, 2520], 175, [330, 2200, 2600]),
	AY: V([700, 1220, 2600], 210, [400, 1950, 2600]),
	OW: V([540, 1100, 2300], 180, [450, 900, 2300]),
	AW: V([720, 1250, 2600], 220, [450, 1000, 2400]),
	OY: V([550, 960, 2400], 230, [360, 1820, 2450]),
	L: { f: [330, 1050, 2880], ms: 70, av: 0.8 },
	R: { f: [310, 1060, 1380], ms: 70, av: 0.8 },
	W: { f: [290, 610, 2150], ms: 70, av: 0.8 },
	Y: { f: [260, 2070, 3020], ms: 60, av: 0.8 },
	M: { f: [250, 1100, 2130], ms: 75, av: 0.55 },
	N: { f: [250, 1600, 2600], ms: 65, av: 0.55 },
	NG: { f: [250, 2000, 2900], ms: 80, av: 0.55 },
	F: { f: [340, 1100, 2080], ms: 105, av: 0, af: 0.35, ff: 4500, fb: 3500 },
	V: { f: [340, 1100, 2080], ms: 65, av: 0.45, af: 0.25, ff: 4500, fb: 3500 },
	TH: { f: [320, 1290, 2540], ms: 105, av: 0, af: 0.3, ff: 5000, fb: 3500 },
	DH: { f: [320, 1290, 2540], ms: 50, av: 0.5, af: 0.2, ff: 5000, fb: 3500 },
	S: { f: [320, 1390, 2530], ms: 115, av: 0, af: 0.9, ff: 5500, fb: 1800 },
	Z: { f: [320, 1390, 2530], ms: 85, av: 0.45, af: 0.6, ff: 5500, fb: 1800 },
	SH: { f: [300, 1840, 2750], ms: 125, av: 0, af: 1, ff: 2900, fb: 1300 },
	ZH: { f: [300, 1840, 2750], ms: 85, av: 0.45, af: 0.6, ff: 2900, fb: 1300 },
	HH: { f: [500, 1500, 2500], ms: 65, av: 0, ah: 0.6, copyNext: true },
	P: {
		f: [250, 900, 2100],
		ms: 0,
		av: 0,
		stop: { voiced: false, burstHz: 900 },
	},
	B: {
		f: [250, 900, 2100],
		ms: 0,
		av: 0,
		stop: { voiced: true, burstHz: 900 },
	},
	T: {
		f: [250, 1700, 2600],
		ms: 0,
		av: 0,
		stop: { voiced: false, burstHz: 4200 },
	},
	D: {
		f: [250, 1700, 2600],
		ms: 0,
		av: 0,
		stop: { voiced: true, burstHz: 4200 },
	},
	K: {
		f: [250, 1900, 2850],
		ms: 0,
		av: 0,
		stop: { voiced: false, burstHz: 2000 },
	},
	G: {
		f: [250, 1900, 2850],
		ms: 0,
		av: 0,
		stop: { voiced: true, burstHz: 2000 },
	},
	CH: {
		f: [300, 1840, 2750],
		ms: 0,
		av: 0,
		stop: { voiced: false, burstHz: 3500 },
		then: "SH",
	},
	JH: {
		f: [300, 1840, 2750],
		ms: 0,
		av: 0,
		stop: { voiced: true, burstHz: 3500 },
		then: "ZH",
	},
};

/** A voice: its pitch, the size of its vocal tract, how it moves its pitch. */
export interface SpeechVoice {
	readonly f0: number;
	/** Formant scale: 1 an adult male tract, about 1.17 an adult female. */
	readonly tract: number;
	/** How far the pitch falls over a phrase, as a share. */
	readonly declination: number;
	/** How far a stressed vowel lifts the pitch, as a share. */
	readonly accent: number;
	/** Cycle-to-cycle pitch wobble, as a share. */
	readonly jitter: number;
	/** Breath in the voice: aspiration under the voicing. */
	readonly breath: number;
	/** Speaking rate: 1 the tables' durations, higher faster. */
	readonly rate: number;
}

export const VOICES: Readonly<Record<string, SpeechVoice>> = {
	control: {
		f0: 110,
		tract: 1,
		declination: 0.22,
		accent: 0.18,
		jitter: 0.01,
		breath: 0.04,
		rate: 1.05,
	},
	pilot: {
		f0: 195,
		tract: 1.16,
		declination: 0.2,
		accent: 0.22,
		jitter: 0.012,
		breath: 0.07,
		rate: 1.1,
	},
	pirate: {
		f0: 88,
		tract: 0.94,
		declination: 0.28,
		accent: 0.25,
		jitter: 0.03,
		breath: 0.12,
		rate: 0.95,
	},
	machine: {
		f0: 100,
		tract: 1.02,
		declination: 0,
		accent: 0,
		jitter: 0,
		breath: 0,
		rate: 0.95,
	},
};

/** A phoneme token: an ARPAbet symbol and its stress, or a pause in ms. */
export type Token =
	| { readonly ph: string; readonly stress: 0 | 1 | 2 }
	| { readonly pause: number };

/** `"K AA1 B R AH0"` as tokens. Throws on a symbol with no table row. */
export function parsePhonemes(text: string): Token[] {
	const out: Token[] = [];
	for (const raw of text.trim().split(/\s+/)) {
		if (!raw) continue;
		if (raw === ",") out.push({ pause: 140 });
		else if (raw === ".") out.push({ pause: 320 });
		else {
			const m = /^([A-Z]+)([012])?$/.exec(raw.toUpperCase());
			if (!m || !PHONEMES[m[1]]) throw new Error(`speech: no phoneme ${raw}`);
			out.push({ ph: m[1], stress: Number(m[2] ?? 0) as 0 | 1 | 2 });
		}
	}
	return out;
}

/** One stretch of the frame track: held or gliding targets. */
interface Seg {
	frames: number;
	f: Formants;
	fEnd: Formants;
	av: number;
	ah: number;
	af: number;
	ff: number;
	fb: number;
	/** Pitch as a share of the voice's f0, at the segment's start. */
	pitch: number;
	/** A burst: its amplitude track is not smoothed. */
	sharp: boolean;
}

const framesOf = (ms: number) => Math.max(1, Math.round(ms / 1000 / FRAME_S));

/** The next phoneme's formants after token `i`, for HH and aspiration. */
function nextFormants(tokens: readonly Token[], i: number): Formants | null {
	for (let k = i + 1; k < tokens.length; k++) {
		const t = tokens[k];
		if ("pause" in t) return null;
		const p = PHONEMES[t.ph];
		if (!p.stop && !p.copyNext) return p.f;
	}
	return null;
}

/** The phrase as segments, before smoothing. */
function segments(tokens: readonly Token[], v: SpeechVoice): Seg[] {
	const segs: Seg[] = [];
	const quiet = (ms: number, f: Formants): Seg => ({
		frames: framesOf(ms),
		f,
		fEnd: f,
		av: 0,
		ah: 0,
		af: 0,
		ff: 3000,
		fb: 2000,
		pitch: 1,
		sharp: false,
	});
	// The last vowel of a phrase is lengthened, as a speaker slows into a stop.
	let lastVowel = -1;
	tokens.forEach((t, i) => {
		if ("ph" in t && PHONEMES[t.ph].vowel) lastVowel = i;
	});
	tokens.forEach((t, i) => {
		if ("pause" in t) {
			segs.push(quiet(t.pause, segs.at(-1)?.fEnd ?? [500, 1500, 2500]));
			return;
		}
		const p = PHONEMES[t.ph];
		const next = nextFormants(tokens, i) ?? p.f;
		const pitch = p.vowel && t.stress === 1 ? 1 + v.accent : 1;
		if (p.stop) {
			// Closure, formants at the stop's locus; a voice bar if voiced.
			segs.push({
				...quiet(p.stop.voiced ? 45 : 60, p.f),
				av: p.stop.voiced ? 0.12 : 0,
				pitch,
			});
			segs.push({
				frames: framesOf(p.stop.voiced ? 8 : 12),
				f: p.f,
				fEnd: p.f,
				av: 0,
				ah: 0,
				af: p.stop.voiced ? 0.5 : 0.9,
				ff: p.stop.burstHz,
				fb: 1800,
				pitch,
				sharp: true,
			});
			if (p.then) {
				const fr = PHONEMES[p.then];
				segs.push({
					frames: framesOf(fr.ms * 0.8),
					f: fr.f,
					fEnd: fr.f,
					av: fr.av,
					ah: 0,
					af: fr.af ?? 0,
					ff: fr.ff ?? 3000,
					fb: fr.fb ?? 2000,
					pitch,
					sharp: false,
				});
			} else if (!p.stop.voiced)
				segs.push({
					frames: framesOf(40),
					f: next,
					fEnd: next,
					av: 0,
					ah: 0.55,
					af: 0,
					ff: 3000,
					fb: 2000,
					pitch,
					sharp: false,
				});
			return;
		}
		let ms = p.ms;
		if (p.vowel) {
			if (t.stress === 0) ms *= 0.72;
			if (t.stress === 1) ms *= 1.15;
			if (i === lastVowel) ms *= 1.4;
		}
		const f = p.copyNext ? next : p.f;
		segs.push({
			frames: framesOf(ms / v.rate),
			f,
			fEnd: p.f2 ?? f,
			av: p.vowel && t.stress === 0 ? 0.8 * p.av : p.av,
			ah: p.ah ?? 0,
			af: p.af ?? 0,
			ff: p.ff ?? 3000,
			fb: p.fb ?? 2000,
			pitch,
			sharp: false,
		});
	});
	return segs;
}

/** Frame tracks: each parameter per 5 ms frame. */
interface Tracks {
	n: number;
	f1: Float64Array;
	f2: Float64Array;
	f3: Float64Array;
	av: Float64Array;
	ah: Float64Array;
	af: Float64Array;
	ff: Float64Array;
	fb: Float64Array;
	pitch: Float64Array;
}

/** A centred moving average over `w` frames: the glide between targets. */
function smooth(x: Float64Array, w: number, keep?: Uint8Array): Float64Array {
	if (w <= 1) return x;
	const out = new Float64Array(x.length);
	const h = Math.floor(w / 2);
	for (let i = 0; i < x.length; i++) {
		if (keep?.[i]) {
			out[i] = x[i];
			continue;
		}
		let s = 0;
		let c = 0;
		for (let k = i - h; k <= i + h; k++)
			if (k >= 0 && k < x.length) {
				s += x[k];
				c++;
			}
		out[i] = s / c;
	}
	return out;
}

function tracks(segs: readonly Seg[], v: SpeechVoice): Tracks {
	const n = segs.reduce((a, s) => a + s.frames, 0);
	const t: Tracks = {
		n,
		f1: new Float64Array(n),
		f2: new Float64Array(n),
		f3: new Float64Array(n),
		av: new Float64Array(n),
		ah: new Float64Array(n),
		af: new Float64Array(n),
		ff: new Float64Array(n),
		fb: new Float64Array(n),
		pitch: new Float64Array(n),
	};
	const sharp = new Uint8Array(n);
	let i = 0;
	for (const s of segs)
		for (let k = 0; k < s.frames; k++, i++) {
			const u = s.frames > 1 ? k / (s.frames - 1) : 0;
			t.f1[i] = s.f[0] + (s.fEnd[0] - s.f[0]) * u;
			t.f2[i] = s.f[1] + (s.fEnd[1] - s.f[1]) * u;
			t.f3[i] = s.f[2] + (s.fEnd[2] - s.f[2]) * u;
			t.av[i] = s.av;
			t.ah[i] = s.ah;
			t.af[i] = s.af;
			t.ff[i] = s.ff;
			t.fb[i] = s.fb;
			t.pitch[i] = s.pitch;
			sharp[i] = s.sharp ? 1 : 0;
		}
	// Formants glide over 40 ms, levels over 15, a stressed vowel's pitch
	// rises and falls over 120.
	t.f1 = smooth(t.f1, 9);
	t.f2 = smooth(t.f2, 9);
	t.f3 = smooth(t.f3, 9);
	t.av = smooth(t.av, 3);
	t.ah = smooth(t.ah, 3);
	t.af = smooth(t.af, 3, sharp);
	t.pitch = smooth(t.pitch, 25);
	// The phrase's pitch falls as the breath runs out.
	for (let k = 0; k < n; k++)
		t.pitch[k] *= 1 + 0.5 * v.declination - v.declination * (k / n);
	for (const f of [t.f1, t.f2, t.f3])
		for (let k = 0; k < n; k++) f[k] *= v.tract;
	return t;
}

/** A two-pole resonator, Klatt's: unity gain at DC. */
class Resonator {
	private y1 = 0;
	private y2 = 0;
	private a = 1;
	private b = 0;
	private c = 0;
	set(hz: number, bw: number) {
		const T = 1 / SPEECH_RATE;
		const f = Math.min(hz, 0.45 * SPEECH_RATE);
		this.c = -Math.exp(-2 * Math.PI * bw * T);
		this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
		this.a = 1 - this.b - this.c;
	}
	/** The gain at the resonance, to normalise a bandpass use. */
	peak(hz: number): number {
		const w = (2 * Math.PI * Math.min(hz, 0.45 * SPEECH_RATE)) / SPEECH_RATE;
		const re = 1 - this.b * Math.cos(w) - this.c * Math.cos(2 * w);
		const im = this.b * Math.sin(w) + this.c * Math.sin(2 * w);
		return Math.abs(this.a) / Math.hypot(re, im);
	}
	step(x: number) {
		const y = this.a * x + this.b * this.y1 + this.c * this.y2;
		this.y2 = this.y1;
		this.y1 = y;
		return y;
	}
}

/** Rosenberg's glottal flow at phase `p` of a cycle. */
function glottal(p: number): number {
	const open = 0.4;
	const close = 0.16;
	if (p < open) return 0.5 * (1 - Math.cos((Math.PI * p) / open));
	if (p < open + close) return Math.cos((Math.PI * (p - open)) / (2 * close));
	return 0;
}

/** Render tokens in a voice, at `SPEECH_RATE`, peak-normalised to 0.9. */
export function speak(
	tokens: readonly Token[],
	voice: SpeechVoice,
	seed = 1,
): Float32Array {
	const t = tracks(segments(tokens, voice), voice);
	const out = new Float32Array(t.n * FRAME + FRAME * 4);
	const rand = noise(seed);
	const r = [
		new Resonator(),
		new Resonator(),
		new Resonator(),
		new Resonator(),
	];
	const fric = new Resonator();
	let phase = 0;
	let flow = 0;
	let jit = 1;
	let fricGain = 1;
	for (let fr = 0; fr < t.n; fr++) {
		r[0].set(t.f1[fr], 60 + 0.05 * t.f1[fr]);
		r[1].set(t.f2[fr], 70 + 0.04 * t.f2[fr]);
		r[2].set(t.f3[fr], 110 + 0.03 * t.f3[fr]);
		r[3].set(3500 * voice.tract, 250);
		fric.set(t.ff[fr], t.fb[fr]);
		fricGain = 1 / fric.peak(t.ff[fr]);
		const f0 = voice.f0 * t.pitch[fr];
		for (let k = 0; k < FRAME; k++) {
			const i = fr * FRAME + k;
			// Levels move within the frame too, so a burst has no step.
			const u = k / FRAME;
			const nx = Math.min(fr + 1, t.n - 1);
			const av = t.av[fr] + (t.av[nx] - t.av[fr]) * u;
			const ah = t.ah[fr] + (t.ah[nx] - t.ah[fr]) * u;
			const af = t.af[fr] + (t.af[nx] - t.af[fr]) * u;
			phase += (f0 * jit) / SPEECH_RATE;
			if (phase >= 1) {
				phase -= 1;
				jit = 1 + voice.jitter * rand();
			}
			const g = glottal(phase);
			// The flow's derivative: the lips radiate its slope.
			const src = (g - flow) * (SPEECH_RATE / f0) * 0.12;
			flow = g;
			const n = rand();
			let x = av * src + (ah + voice.breath * av) * 0.35 * n;
			for (const res of r) x = res.step(x);
			out[i] = x + af * 0.5 * fricGain * fric.step(rand());
		}
	}
	let peak = 0;
	for (const s of out) peak = Math.max(peak, Math.abs(s));
	if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
	return out;
}
