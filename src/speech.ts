/**
 * A formant speech synthesiser: seelite's own, in the manner of Klatt's
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
 * tracks. A consonant holds its **locus**, where its place of articulation
 * puts the formants, and the vowel beside it starts part of the way from
 * that locus and glides to its own target (Klatt's locus rule): the glide,
 * not the consonant's own noise, is what says *b*, *d* or *g* through a
 * radio, whose band removes most of that noise. A stop's burst sits where
 * its place puts it — a velar's at the next vowel's second formant. Per sample, a
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
type Place = "lab" | "dent" | "alv" | "pal" | "vel";

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
	/** Where a consonant is made: its locus and its burst. */
	readonly place?: Place;
	/** A liquid or glide: the vowel beside it glides from its formants, not
	 *  from a locus. */
	readonly glide?: boolean;
	/** A nasal: the antiresonance in its murmur, Hz. */
	readonly nasalZero?: number;
	/** A stop: expanded into closure, burst and, voiceless, aspiration of
	 *  `vot` ms. */
	readonly stop?: { readonly voiced: boolean; readonly vot: number };
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
function fric(
	f: Formants,
	ms: number,
	av: number,
	af: number,
	ff: number,
	fb: number,
	place: Place,
): PhonemeSpec {
	return { f, ms, av, af, ff, fb, place };
}
function stop(
	f: Formants,
	voiced: boolean,
	vot: number,
	place: Place,
): PhonemeSpec {
	return { f, ms: 0, av: 0, place, stop: { voiced, vot } };
}

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
	L: { f: [330, 1050, 2880], ms: 70, av: 0.8, glide: true },
	R: { f: [310, 1060, 1380], ms: 70, av: 0.8, glide: true },
	W: { f: [290, 610, 2150], ms: 70, av: 0.8, glide: true },
	Y: { f: [260, 2070, 3020], ms: 60, av: 0.8, glide: true },
	// A nasal's murmur: the mouth closed, a zero where the closed cavity
	// traps its resonance — low for a labial, higher for an alveolar, above
	// the band for a velar. The zero is what tells M from N in the murmur.
	M: { f: [250, 1100, 2130], ms: 75, av: 0.55, place: "lab", nasalZero: 1000 },
	N: { f: [250, 1600, 2600], ms: 65, av: 0.55, place: "alv", nasalZero: 1800 },
	NG: { f: [250, 2000, 2900], ms: 80, av: 0.55, place: "vel" },
	// Fricatives placed for the radio, which passes 300–3400 Hz (the first
	// table put S at 5.5 kHz and F and TH near 5, and the band removed all
	// three): S bright at 3.3 kHz, the top of the band, SH dark at 2.3, F and TH
	// weak and flat, told apart mostly by their glides, as on a telephone.
	F: fric([340, 1100, 2080], 105, 0, 0.14, 3000, 6000, "lab"),
	V: fric([340, 1100, 2080], 65, 0.45, 0.1, 3000, 6000, "lab"),
	TH: fric([320, 1290, 2540], 105, 0, 0.09, 3500, 6000, "dent"),
	DH: fric([320, 1290, 2540], 50, 0.5, 0.07, 3500, 6000, "dent"),
	S: fric([320, 1390, 2530], 115, 0, 1, 3300, 1600, "alv"),
	Z: fric([320, 1390, 2530], 85, 0.45, 0.65, 3300, 1600, "alv"),
	SH: fric([300, 1840, 2750], 125, 0, 1, 2300, 900, "pal"),
	ZH: fric([300, 1840, 2750], 85, 0.45, 0.6, 2300, 900, "pal"),
	HH: { f: [500, 1500, 2500], ms: 65, av: 0, ah: 0.6, copyNext: true },
	// Voice onset times after English's: a velar's the longest, a labial's
	// the shortest; a voiced stop's is short lag and is not written out.
	P: stop([250, 900, 2100], false, 45, "lab"),
	B: stop([250, 900, 2100], true, 0, "lab"),
	T: stop([250, 1700, 2600], false, 55, "alv"),
	D: stop([250, 1700, 2600], true, 0, "alv"),
	K: stop([250, 1900, 2850], false, 65, "vel"),
	G: stop([250, 1900, 2850], true, 0, "vel"),
	CH: { ...stop([300, 1840, 2750], false, 0, "pal"), then: "SH" },
	JH: { ...stop([300, 1840, 2750], true, 0, "pal"), then: "ZH" },
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
	/** The glottis's open share of a cycle (KLGLOTT88's OQ): higher is
	 *  breathier and softer, lower pressed and buzzier. */
	readonly openQuotient: number;
	/** Spectral tilt, dB of loss at 3 kHz: a softer, darker source. */
	readonly tilt: number;
	/** Klatt's flutter: the slow wander of a real voice's pitch, 0..1. */
	readonly flutter: number;
}

export const VOICES: Readonly<Record<string, SpeechVoice>> = {
	// Approach control: a station's radio voice (#600), not the first day's
	// Station control.
	approach: {
		f0: 110,
		tract: 1,
		declination: 0.22,
		accent: 0.18,
		jitter: 0.01,
		breath: 0.04,
		rate: 1.05,
		openQuotient: 0.6,
		tilt: 4,
		flutter: 0.5,
	},
	pilot: {
		f0: 195,
		tract: 1.16,
		declination: 0.2,
		accent: 0.22,
		jitter: 0.012,
		breath: 0.07,
		rate: 1.1,
		openQuotient: 0.66,
		tilt: 3,
		flutter: 0.5,
	},
	pirate: {
		f0: 88,
		tract: 0.94,
		declination: 0.28,
		accent: 0.25,
		jitter: 0.03,
		breath: 0.12,
		rate: 0.95,
		openQuotient: 0.5,
		tilt: 8,
		flutter: 1,
	},
	machine: {
		f0: 100,
		tract: 1.02,
		declination: 0,
		accent: 0,
		jitter: 0,
		breath: 0,
		rate: 0.95,
		openQuotient: 0.5,
		tilt: 0,
		flutter: 0,
	},
};

/**
 * A phoneme token: an ARPAbet symbol, its stress and the number of the word
 * it belongs to (the duration rules read word edges); or a pause in ms, which
 * ends a phrase, with `q` when the phrase was a question.
 */
export type Token =
	| { readonly ph: string; readonly stress: 0 | 1 | 2; readonly w: number }
	| { readonly pause: number; readonly q?: boolean };

/** `"K AA1 B R AH0"` as tokens, all of word `w`. Throws on a symbol with no
 *  table row. */
export function parsePhonemes(text: string, w = 0): Token[] {
	const out: Token[] = [];
	for (const raw of text.trim().split(/\s+/)) {
		if (!raw) continue;
		if (raw === ",") out.push({ pause: 140 });
		else if (raw === ".") out.push({ pause: 320 });
		else if (raw === "?") out.push({ pause: 320, q: true });
		else {
			const m = /^([A-Z]+)([012])?$/.exec(raw.toUpperCase());
			if (!m || !PHONEMES[m[1]]) throw new Error(`speech: no phoneme ${raw}`);
			out.push({ ph: m[1], stress: Number(m[2] ?? 0) as 0 | 1 | 2, w });
		}
	}
	return out;
}

/** What a stretch of the frame track is, for the transitions and the tests. */
export type Role = "vowel" | "cons" | "closure" | "burst" | "asp" | "pause";

/** One stretch of the frame track: held or gliding targets. */
interface Seg {
	frames: number;
	role: Role;
	/** The phoneme it belongs to; `null` for a pause. */
	spec: PhonemeSpec | null;
	f: Formants;
	fEnd: Formants;
	av: number;
	ah: number;
	af: number;
	ff: number;
	fb: number;
	/** Pitch as a share of the voice's f0, at the segment's start and end. */
	pitch: number;
	pitchEnd: number;
	/** A burst: its amplitude track is not smoothed. */
	sharp: boolean;
	/** A nasal murmur's antiresonance, Hz; 0 for none. */
	nz: number;
}

const NASALS = new Set(["M", "N", "NG"]);

/**
 * Each vowel's pitch, start and end, as a share of f0: a hat pattern per
 * phrase ('t Hart, Collier and Cohen; Klatt's MITalk). The pitch rises into
 * the first stressed vowel, stays up across the phrase, and falls on the
 * last stressed vowel — or, in a question, rises there instead and stays up.
 * A voice with no accent speaks on one pitch.
 */
function intonation(
	tokens: readonly Token[],
	v: SpeechVoice,
): Map<number, [number, number]> {
	const out = new Map<number, [number, number]>();
	const a = v.accent;
	const fall = a > 0 ? 0.88 : 1;
	const rise = 1 + 1.6 * a;
	let phrase: number[] = [];
	const close = (q: boolean) => {
		const vowels = phrase.filter((i) => {
			const t = tokens[i];
			return "ph" in t && PHONEMES[t.ph].vowel;
		});
		const stressed = vowels.filter((i) => {
			const t = tokens[i];
			return "ph" in t && t.stress === 1;
		});
		const peaks = stressed.length ? stressed : vowels;
		const s0 = peaks[0];
		const sL = peaks[peaks.length - 1];
		for (const k of vowels) {
			const t = tokens[k];
			const on = "ph" in t && t.stress === 1;
			let p: [number, number];
			if (k < s0) p = [1, 1];
			else if (k === s0 && k === sL) p = q ? [1, rise] : [1 + a, fall];
			else if (k === s0) p = [1 + a, 1 + 0.8 * a];
			else if (k < sL)
				p = on ? [1 + 0.9 * a, 1 + 0.8 * a] : [1 + 0.7 * a, 1 + 0.7 * a];
			else if (k === sL) p = q ? [1 + 0.5 * a, rise] : [1 + 0.9 * a, fall];
			else p = q ? [rise, rise] : [fall, fall];
			out.set(k, p);
		}
		phrase = [];
	};
	tokens.forEach((t, i) => {
		if ("pause" in t) close(t.q === true);
		else phrase.push(i);
	});
	close(false);
	return out;
}

/**
 * A vowel's length, ms, by a subset of Klatt's duration rules (1979): only
 * the part above a floor of `VOWEL_FLOOR` of its inherent length is
 * stretched or shrunk. Unstressed is short; a vowel that is not its word's
 * last is shortened (a longer word is said faster); one before a voiceless
 * obstruent in its word is short and one before a voiced one long; and the
 * last vowel of a phrase is lengthened, as a speaker slows into a stop.
 */
const VOWEL_FLOOR = 0.45;
function vowelMs(
	tokens: readonly Token[],
	i: number,
	phraseFinal: boolean,
): number {
	const t = tokens[i] as Extract<Token, { ph: string }>;
	const p = PHONEMES[t.ph];
	let pr = t.stress === 0 ? 0.5 : t.stress === 2 ? 0.8 : 1.15;
	let lastInWord = true;
	for (let k = i + 1; k < tokens.length; k++) {
		const u = tokens[k];
		if (!("ph" in u) || u.w !== t.w) break;
		if (PHONEMES[u.ph].vowel) lastInWord = false;
	}
	if (!lastInWord) pr *= 0.8;
	const next = tokens[i + 1];
	if (next && "ph" in next && next.w === t.w) {
		const n = PHONEMES[next.ph];
		if (NASALS.has(next.ph)) pr *= 0.9;
		else if (n.stop) pr *= n.stop.voiced ? 1.2 : 0.7;
		else if ((n.af ?? 0) > 0) pr *= n.av > 0 ? 1.3 : 0.7;
	}
	const floor = VOWEL_FLOOR * p.ms;
	return (floor + (p.ms - floor) * pr) * (phraseFinal ? 1.4 : 1);
}

/** Whether a consonant token stands beside another consonant in its word:
 *  a cluster, each of whose members is shortened. */
function inCluster(tokens: readonly Token[], i: number): boolean {
	const t = tokens[i];
	if (!("ph" in t)) return false;
	for (const k of [i - 1, i + 1]) {
		const u = tokens[k];
		if (u && "ph" in u && u.w === t.w && !PHONEMES[u.ph].vowel) return true;
	}
	return false;
}

const framesOf = (ms: number) => Math.max(1, Math.round(ms / 1000 / FRAME_S));

/** The next vowel's formants after token `i`, before a pause. */
function nextVowel(tokens: readonly Token[], i: number): Formants | null {
	for (let k = i + 1; k < tokens.length; k++) {
		const t = tokens[k];
		if ("pause" in t) return null;
		const p = PHONEMES[t.ph];
		if (p.vowel) return p.f;
	}
	return null;
}

/** The next phoneme's own formants after token `i`, for HH. */
function nextFormants(tokens: readonly Token[], i: number): Formants | null {
	for (let k = i + 1; k < tokens.length; k++) {
		const t = tokens[k];
		if ("pause" in t) return null;
		const p = PHONEMES[t.ph];
		if (!p.stop && !p.copyNext) return p.f;
	}
	return null;
}

/** Where a burst's noise is centred, how wide, and how strong: a labial's
 *  low, diffuse and weak, an alveolar's high, a velar's compact and strong
 *  at its locus's F2. All inside the radio's band: an alveolar's at 3.9 kHz
 *  was above it, and the radio took the burst away. */
function burstBand(
	place: Place,
	vowel: Formants | null,
): [number, number, number] {
	switch (place) {
		case "lab":
			return [1000, 2500, 0.45];
		case "alv":
		case "dent":
			return [3200, 1500, 0.9];
		case "pal":
			return [2800, 1200, 0.9];
		case "vel":
			return [locus("vel", vowel ?? [500, 1500, 2500])[1], 500, 1];
	}
}

/** The phrase as segments, before the transitions. */
function segments(tokens: readonly Token[], v: SpeechVoice): Seg[] {
	const segs: Seg[] = [];
	const quiet = (
		ms: number,
		f: Formants,
		role: Role,
		spec: PhonemeSpec | null,
	): Seg => ({
		frames: framesOf(ms),
		role,
		spec,
		f,
		fEnd: f,
		av: 0,
		ah: 0,
		af: 0,
		ff: 3000,
		fb: 2000,
		pitch: 1,
		pitchEnd: 1,
		sharp: false,
		nz: 0,
	});
	const tune = intonation(tokens, v);
	// The last vowel of each phrase: lengthened.
	const phraseFinal = new Set<number>();
	let lastVowel = -1;
	tokens.forEach((t, i) => {
		if ("ph" in t && PHONEMES[t.ph].vowel) lastVowel = i;
		if ("pause" in t || i === tokens.length - 1) {
			if (lastVowel >= 0) phraseFinal.add(lastVowel);
			lastVowel = -1;
		}
	});
	// A consonant takes the pitch the voice was last at.
	let held = 1;
	tokens.forEach((t, i) => {
		if ("pause" in t) {
			segs.push({
				...quiet(
					t.pause,
					segs.at(-1)?.fEnd ?? [500, 1500, 2500],
					"pause",
					null,
				),
				pitch: held,
				pitchEnd: held,
			});
			return;
		}
		const p = PHONEMES[t.ph];
		const vowel = nextVowel(tokens, i);
		const [pitch, pitchEnd] = tune.get(i) ?? [held, held];
		held = pitchEnd;
		const cluster = inCluster(tokens, i) ? 0.8 : 1;
		if (p.stop) {
			// Closure and burst, formants at the stop's locus beside the vowel it
			// releases into; a voice bar if voiced.
			const at = vowel ? locus(p.place ?? "alv", vowel) : p.f;
			segs.push({
				...quiet((p.stop.voiced ? 45 : 60) * cluster, at, "closure", p),
				av: p.stop.voiced ? 0.12 : 0,
				pitch,
				pitchEnd: pitch,
			});
			const [ff, fb, amp] = burstBand(p.place ?? "alv", vowel);
			segs.push({
				...quiet(p.stop.voiced ? 10 : 12, at, "burst", p),
				af: (p.stop.voiced ? 0.8 : 1) * amp,
				ff,
				fb,
				pitch,
				pitchEnd: pitch,
				sharp: true,
			});
			if (p.then) {
				const fr = PHONEMES[p.then];
				segs.push({
					...quiet(fr.ms * 0.8, fr.f, "cons", fr),
					av: fr.av,
					af: fr.af ?? 0,
					ff: fr.ff ?? 3000,
					fb: fr.fb ?? 2000,
					pitch,
					pitchEnd: pitch,
				});
			} else if (p.stop.vot > 0)
				// The aspiration's formants are the vowel's, reached through the
				// transition from the release.
				segs.push({
					...quiet(p.stop.vot / v.rate, vowel ?? p.f, "asp", p),
					ah: 0.55,
					pitch,
					pitchEnd: pitch,
				});
			return;
		}
		const ms = p.vowel
			? vowelMs(tokens, i, phraseFinal.has(i))
			: p.ms * cluster;
		const f = p.copyNext ? (nextFormants(tokens, i) ?? p.f) : p.f;
		segs.push({
			frames: framesOf(ms / v.rate),
			role: p.vowel ? "vowel" : "cons",
			spec: p,
			f,
			fEnd: p.f2 ?? f,
			av: p.vowel && t.stress === 0 ? 0.8 * p.av : p.av,
			ah: p.ah ?? 0,
			af: p.af ?? 0,
			ff: p.ff ?? 3000,
			fb: p.fb ?? 2000,
			pitch,
			pitchEnd,
			sharp: false,
			nz: p.nasalZero ?? 0,
		});
	});
	return segs;
}

/** A place's locus beside a vowel: where the formants point during the
 *  consonant. A labial's F2 and F3 low; an alveolar's F3 high; a velar's
 *  moves with the vowel, its F2 and F3 pinched together just above it.
 *
 *  Retuned on the principal's ear (2026-09-30: *bay, day, gay sound the
 *  same*): before EY the first table started D and G 47 Hz apart in F2 and
 *  nowhere apart in F3. Now B, D and G start at 1050, 1776 and 2185 in F2 and
 *  2242, 2772 and 2511 in F3 (measured off `frameTracks`). */
function locus(place: Place, v: Formants): Formants {
	switch (place) {
		case "lab":
			return [200, 800, 2100];
		case "dent":
			return [200, 1650, 2700];
		case "alv":
			return [200, 1800, 2900];
		case "pal":
			return [200, 2000, 2800];
		case "vel": {
			const f2 = Math.min(2700, 1.3 * v[1] + 150);
			return [200, f2, f2 + 120];
		}
	}
}

/** How far from the locus toward the vowel a transition starts, per
 *  formant: Klatt's k. */
const LOCUS_K: Readonly<Record<Place, Formants>> = {
	lab: [0.35, 0.4, 0.5],
	dent: [0.35, 0.35, 0.5],
	alv: [0.35, 0.45, 0.5],
	pal: [0.35, 0.5, 0.5],
	vel: [0.35, 0.45, 0.5],
};
/** How long the transition in the vowel takes, ms: long enough to be heard
 *  as a glide, which is what carries the place through the radio. */
const TRANSITION_MS: Readonly<Record<Place | "glide" | "vowel", number>> = {
	lab: 55,
	dent: 60,
	alv: 60,
	pal: 65,
	vel: 90,
	glide: 80,
	vowel: 60,
};

/** Where the vowel's formants start (or end) beside consonant `c`, and over
 *  how many frames it glides from there to its target. */
function boundary(
	c: PhonemeSpec,
	v: Formants,
): { at: Formants; frames: number } | null {
	if (c.copyNext) return null;
	if (c.glide) return { at: c.f, frames: framesOf(TRANSITION_MS.glide) };
	if (c.vowel) return null;
	const place = c.place ?? "alv";
	const L = locus(place, v);
	const k = LOCUS_K[place];
	return {
		at: [0, 1, 2].map(
			(n) => L[n] + k[n] * (v[n] - L[n]),
		) as unknown as Formants,
		frames: framesOf(TRANSITION_MS[place]),
	};
}

/** Frame tracks: each parameter per 5 ms frame, and what each frame is. */
export interface Tracks {
	n: number;
	role: Role[];
	f1: Float64Array;
	f2: Float64Array;
	f3: Float64Array;
	av: Float64Array;
	ah: Float64Array;
	af: Float64Array;
	ff: Float64Array;
	fb: Float64Array;
	pitch: Float64Array;
	nz: Float64Array;
}

/** A centred moving average over `w` frames. */
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

/** The transitions: each vowel glides in from the consonant before it —
 *  from its release, so a voiceless stop's aspiration carries the start of
 *  the glide — and out toward the consonant after it. */
function transitions(t: Tracks, segs: readonly Seg[]) {
	const F = [t.f1, t.f2, t.f3];
	const start: number[] = [];
	let at = 0;
	for (const s of segs) {
		start.push(at);
		at += s.frames;
	}
	segs.forEach((s, j) => {
		if (s.role !== "vowel") return;
		const s0 = start[j];
		const e = s0 + s.frames;
		const own = (i: number) =>
			F.map((f) => f[Math.max(s0, Math.min(e - 1, i))]);
		// In: from the consonant before, or the vowel before.
		let r = s0;
		let spec: PhonemeSpec | null = null;
		const prev = segs[j - 1];
		if (prev?.role === "asp") {
			r = start[j - 1];
			spec = prev.spec;
		} else if (prev && (prev.role === "burst" || prev.role === "cons"))
			spec = prev.spec;
		let from: { at: Formants; frames: number } | null = null;
		if (spec) from = boundary(spec, s.f);
		else if (prev?.role === "vowel") {
			const pe = start[j - 1] + prev.frames - 1;
			from = {
				at: F.map((f, n) => 0.5 * (f[pe] + s.f[n])) as unknown as Formants,
				frames: framesOf(TRANSITION_MS.vowel / 2),
			};
		}
		if (from) {
			const target = own(r + from.frames);
			for (let i = r; i < Math.min(r + from.frames, e); i++) {
				const u = (i - r) / from.frames;
				const w = u * u * (3 - 2 * u);
				F.forEach((f, n) => {
					const goal = i < s0 ? target[n] : own(i)[n];
					f[i] = from.at[n] + (goal - from.at[n]) * w;
				});
			}
		}
		// Out: toward the consonant after.
		const next = segs[j + 1];
		if (
			next &&
			(next.role === "closure" || next.role === "cons") &&
			next.spec
		) {
			const to = boundary(next.spec, s.fEnd);
			if (to)
				for (let i = Math.max(s0, e - to.frames); i < e; i++) {
					const u = (i - (e - to.frames) + 1) / to.frames;
					const w = u * u * (3 - 2 * u);
					const o = own(i);
					F.forEach((f, n) => {
						f[i] = o[n] + (to.at[n] - o[n]) * w;
					});
				}
		}
	});
}

function tracks(segs: readonly Seg[], v: SpeechVoice): Tracks {
	const n = segs.reduce((a, s) => a + s.frames, 0);
	const t: Tracks = {
		n,
		role: [],
		f1: new Float64Array(n),
		f2: new Float64Array(n),
		f3: new Float64Array(n),
		av: new Float64Array(n),
		ah: new Float64Array(n),
		af: new Float64Array(n),
		ff: new Float64Array(n),
		fb: new Float64Array(n),
		pitch: new Float64Array(n),
		nz: new Float64Array(n),
	};
	const sharp = new Uint8Array(n);
	let i = 0;
	for (const s of segs)
		for (let k = 0; k < s.frames; k++, i++) {
			const u = s.frames > 1 ? k / (s.frames - 1) : 0;
			t.role.push(s.role);
			t.f1[i] = s.f[0] + (s.fEnd[0] - s.f[0]) * u;
			t.f2[i] = s.f[1] + (s.fEnd[1] - s.f[1]) * u;
			t.f3[i] = s.f[2] + (s.fEnd[2] - s.f[2]) * u;
			t.av[i] = s.av;
			t.ah[i] = s.ah;
			t.af[i] = s.af;
			t.ff[i] = s.ff;
			t.fb[i] = s.fb;
			t.pitch[i] = s.pitch + (s.pitchEnd - s.pitch) * u;
			t.nz[i] = s.nz;
			sharp[i] = s.sharp ? 1 : 0;
		}
	transitions(t, segs);
	// What the transitions do not cover — consonant to consonant — takes a
	// short glide, not a step; levels move over 15 ms.
	t.f1 = smooth(t.f1, 3);
	t.f2 = smooth(t.f2, 3);
	t.f3 = smooth(t.f3, 3);
	// A burst keeps its own voicing: smoothed, the vowel's voicing spilled
	// over a voiced stop's 8 ms burst and hid it.
	t.av = smooth(t.av, 3, sharp);
	t.ah = smooth(t.ah, 3);
	t.af = smooth(t.af, 3, sharp);
	// The contour is explicit now; this only rounds its corners, over 45 ms.
	t.pitch = smooth(t.pitch, 9);
	// The phrase's pitch falls as the breath runs out.
	for (let k = 0; k < n; k++)
		t.pitch[k] *= 1 + 0.5 * v.declination - v.declination * (k / n);
	for (const f of [t.f1, t.f2, t.f3])
		for (let k = 0; k < n; k++) f[k] *= v.tract;
	return t;
}

/** The frame tracks a phrase renders from: for tests and the lab. */
export const frameTracks = (tokens: readonly Token[], voice: SpeechVoice) =>
	tracks(segments(tokens, voice), voice);

/** A two-pole resonator, Klatt's: unity gain at DC. */
export class Resonator {
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

/** A two-zero antiresonator, Klatt's: the exact inverse of `Resonator` at
 *  the same frequency and bandwidth, and at 0 Hz an exact identity, so a
 *  frame with no nasal zero passes the cascade through untouched. */
export class AntiResonator {
	private x1 = 0;
	private x2 = 0;
	private a = 1;
	private b = 0;
	private c = 0;
	set(hz: number, bw: number) {
		if (hz <= 0) {
			this.a = 1;
			this.b = 0;
			this.c = 0;
			return;
		}
		const T = 1 / SPEECH_RATE;
		const f = Math.min(hz, 0.45 * SPEECH_RATE);
		const C = -Math.exp(-2 * Math.PI * bw * T);
		const B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T);
		const A = 1 - B - C;
		this.a = 1 / A;
		this.b = -B / A;
		this.c = -C / A;
	}
	step(x: number) {
		const y = this.a * x + this.b * this.x1 + this.c * this.x2;
		this.x2 = this.x1;
		this.x1 = x;
		return y;
	}
}

/** KLGLOTT88's glottal flow at phase `p` of a cycle: a cubic over the open
 *  share `oq`, peaking at 1, and closed for the rest. */
function glottal(p: number, oq: number): number {
	if (p >= oq) return 0;
	const u = p / oq;
	return 6.75 * u * u * (1 - u);
}

/** Klatt's flutter: f0's slow wander at `t` s, as a multiple, three
 *  incommensurate sines, at most ±2% at `amount` 1. */
export function flutter(t: number, amount: number): number {
	if (amount === 0) return 1;
	const w = 2 * Math.PI * t;
	return (
		1 +
		(amount *
			0.02 *
			(Math.sin(12.7 * w) + Math.sin(7.1 * w) + Math.sin(4.7 * w))) /
			3
	);
}

/** The one-pole lowpass that loses `tiltDb` at 3 kHz, as its coefficient; 1
 *  passes everything. */
function tiltCoef(tiltDb: number): number {
	if (tiltDb <= 0) return 1;
	const fc = 3000 / Math.sqrt(10 ** (tiltDb / 10) - 1);
	return 1 - Math.exp((-2 * Math.PI * fc) / SPEECH_RATE);
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
	const zero = new AntiResonator();
	let phase = 0;
	let flow = 0;
	let tilted = 0;
	const tiltA = tiltCoef(voice.tilt);
	let jit = 1;
	let fricGain = 1;
	for (let fr = 0; fr < t.n; fr++) {
		// A murmur's upper formants are damped: the sound leaves by the nose.
		const damp = t.nz[fr] > 0 ? 2.5 : 1;
		r[0].set(t.f1[fr], 60 + 0.05 * t.f1[fr]);
		r[1].set(t.f2[fr], (70 + 0.04 * t.f2[fr]) * damp);
		r[2].set(t.f3[fr], (110 + 0.03 * t.f3[fr]) * damp);
		zero.set(t.nz[fr], 200);
		r[3].set(3500 * voice.tract, 250);
		fric.set(t.ff[fr], t.fb[fr]);
		fricGain = 1 / fric.peak(t.ff[fr]);
		const f0 = voice.f0 * t.pitch[fr] * flutter(fr * FRAME_S, voice.flutter);
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
			const g = glottal(phase, voice.openQuotient);
			// The flow's derivative: the lips radiate its slope.
			let src = (g - flow) * (SPEECH_RATE / f0) * 0.12;
			flow = g;
			tilted += tiltA * (src - tilted);
			src = tilted;
			const n = rand();
			let x = av * src + (ah + voice.breath * av) * 0.35 * n;
			for (const res of r) x = res.step(x);
			x = zero.step(x);
			out[i] = x + af * 0.5 * fricGain * fric.step(rand());
		}
	}
	let peak = 0;
	for (const s of out) peak = Math.max(peak, Math.abs(s));
	if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
	return out;
}
