/**
 * The Blue Danube as Berlin school, after Tangerine Dream's and Klaus
 * Schulze's sequencer records of the mid-seventies (*Phaedra*, *Rubycon*,
 * *Timewind*, *Stratosfear*): a low sequence that never stops, a filter that
 * opens and closes over half a minute, a choir of string machines, and a
 * slow lead singing over it.
 *
 * **Strauss's harmony becomes the sequence.** Each bar of `HARMONY` is a
 * twelve-step sixteenth ostinato on its root, octave and chord tones, all
 * inside the octave above a low root and played nearly legato, so it rolls
 * rather than ticks. A slow sweep through its resonant filter is the music's
 * main movement. A second, darker sequence in eighths an octave and a fifth
 * up, on a sweep of its own period, drifts against the first. The choir
 * holds each harmony as long as it lasts.
 *
 * The theme (`THEME`, printed octave) is on a slow, singing lead into a
 * dotted-eighth echo; the woodwinds' answers swell on a soft pad an octave
 * below. Nothing is struck: no keys, no pluck, no bell, and no drums. The
 * meter stays 3/4, twelve sixteenths a bar.
 *
 * Every filter peaks well under 6 kHz: cutoff × envelope × sweep, which the
 * shared state-variable filter holds stable.
 */
import { CADENCE_THEME, HARMONY, THEME } from "../music-danube";
import { note as n } from "../music-danube-remeter";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const BERLIN_BPM = 116;

/** A bar of 3/4 at `BERLIN_BPM`, s. */
const BAR_S = (3 * 60) / BERLIN_BPM;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The sequencer: low, nearly legato, its resonant filter swept open and
	// shut over sixteen bars. Peak: 170 Hz × 2^(1.1 + 2.9) = 2.7 kHz.
	seq: {
		voice: "analog",
		level: 0.353,
		unison: 2,
		detune: 0.05,
		drift: 2,
		spread: 0.4,
		attackS: 0.004,
		decayS: 0.4,
		sustain: 0.65,
		releaseS: 0.05,
		cutoffHz: 170,
		envAmount: 1.1,
		envDecayS: 0.14,
		resonance: 0.62,
		sweepS: 16 * BAR_S,
		sweepOct: 2.9,
		pan: -0.12,
		reverb: 0.2,
		echo: 0.2,
	},
	// The second sequence: eighths, an octave and a fifth up, darker and
	// quieter, on a sweep of eleven bars so the two drift against each
	// other. Peak: 240 Hz × 2^(0.8 + 2.2) = 1.9 kHz.
	seq2: {
		voice: "analog",
		level: 0.134,
		unison: 2,
		detune: 0.08,
		drift: 3,
		spread: 0.8,
		attackS: 0.01,
		decayS: 0.5,
		sustain: 0.6,
		releaseS: 0.12,
		cutoffHz: 240,
		envAmount: 0.8,
		envDecayS: 0.2,
		resonance: 0.45,
		sweepS: 11 * BAR_S,
		sweepOct: 2.2,
		pan: 0.3,
		reverb: 0.45,
		echo: 0.35,
	},
	// The choir: a string machine, slow in, wide, a little vibrato.
	choir: {
		voice: "analog",
		level: 0.168,
		unison: 4,
		detune: 0.16,
		drift: 5,
		spread: 1,
		attackS: 1.8,
		decayS: 3,
		sustain: 0.9,
		releaseS: 1.6,
		cutoffHz: 850,
		envAmount: 0.5,
		envDecayS: 4,
		vibrato: 0.06,
		reverb: 0.7,
	},
	// The lead: slow to speak, singing, into the echo. Peak 2.1 kHz.
	lead: {
		voice: "analog",
		level: 0.218,
		unison: 2,
		detune: 0.06,
		drift: 3,
		spread: 0.3,
		attackS: 0.07,
		decayS: 1.4,
		sustain: 0.8,
		releaseS: 0.6,
		cutoffHz: 1050,
		envAmount: 1,
		envDecayS: 0.9,
		resonance: 0.25,
		vibrato: 0.18,
		pan: -0.05,
		reverb: 0.5,
		echo: 0.45,
	},
	// The woodwinds' answers: a soft pad an octave down, swelling in.
	answer: {
		voice: "analog",
		level: 0.109,
		unison: 3,
		detune: 0.12,
		drift: 4,
		spread: 0.9,
		attackS: 0.25,
		decayS: 2,
		sustain: 0.8,
		releaseS: 0.9,
		cutoffHz: 700,
		envAmount: 0.6,
		envDecayS: 1,
		pan: 0.35,
		reverb: 0.6,
		echo: 0.3,
	},
};

/** `p` moved by octaves into the octave above `floor`. */
const above = (p: number, floor: number): number =>
	floor + 1 + ((((p - floor - 1) % 12) + 12) % 12);

/** A root folded into A1–G#2, where the sequence sits. */
const low = (root: number): number => 33 + ((((root - 33) % 12) + 12) % 12);

/** The chord's three tones in the octave above `r`, lowest first. */
function tonesOver(r: number, chord: readonly number[]): number[] {
	const t = [...new Set(chord.map((p) => above(p, r)))].sort((a, b) => a - b);
	return [t[0], t[1] ?? t[0], t[2] ?? t[1] ?? t[0]];
}

/**
 * One bar of the sequencer on `root` and `chord`: twelve sixteenths that
 * never leave the octave above the low root, accented on one and on the
 * seventh step, each held almost to the next.
 */
function sequence(
	bar: number,
	root: number,
	chord: readonly number[],
	vel: number,
): NoteEvent[] {
	const r = low(root);
	const [a, b, c] = tonesOver(r, chord);
	const steps = [r, r, r + 12, a, r, b, r, r + 12, c, r, b, a];
	return steps.map((p, i) =>
		n("seq", bar, i / 4, 0.23, p, vel * (i % 6 === 0 ? 1 : 0.78)),
	);
}

/** One bar of the second sequence: six eighths, an octave and a fifth up,
 *  starting a sixteenth late so it falls between the first's accents. */
function sequence2(
	bar: number,
	root: number,
	chord: readonly number[],
	vel: number,
): NoteEvent[] {
	const r = low(root) + 12;
	const [a, b] = tonesOver(r, chord);
	const steps = [r + 7, a, r + 12, b, r + 7, r];
	return steps.map((p, i) =>
		n("seq2", bar, 0.25 + i / 2, i === 5 ? 0.2 : 0.45, p, vel * 0.8),
	);
}

/** The choir's chord: the harmony's pad tones, under a low root. */
const choirChord = (
	bar: number,
	root: number,
	pad: readonly number[],
	beats: number,
	vel: number,
) => [
	n("choir", bar, 0, beats, low(root) + 12, vel * 0.8),
	...pad.map((p) => n("choir", bar, 0, beats, p, vel)),
];

// ── Intro: the Andantino's harmony, the sequence fading up under the call ───

/** `[root, chord]` a bar of the Andantino, from the score's own violins and
 *  cellos. */
const ANDANTINO: readonly (readonly [number, readonly number[]])[] = [
	...Array(4).fill([45, [61, 64, 69]]),
	...Array(2).fill([50, [64, 68, 71]]),
	...Array(2).fill([52, [62, 66, 71]]),
	[55, [61, 64, 66]],
];

const INTRO: NoteEvent[] = [
	...ANDANTINO.flatMap(([root, chord], bar) => [
		...sequence(bar, root, chord, 0.4 + bar * 0.05),
		...(bar >= 4 ? sequence2(bar, root, chord, 0.45 + (bar - 4) * 0.05) : []),
	]),
	...choirChord(0, 45, [57, 61, 64, 69], 12, 0.45),
	...choirChord(4, 50, [56, 62, 64, 71], 6, 0.5),
	...choirChord(6, 52, [59, 62, 66, 71], 6, 0.5),
	...choirChord(8, 55, [57, 61, 64, 67], 3, 0.5),
	// The horns' call on the lead, at their sounding pitch.
	...(
		[
			[1, 1.5, 57, 0.5],
			[1, 2, 61, 0.5],
			[1, 2.5, 64, 0.5],
			[2, 0, 64, 4.5],
			[3, 1.5, 52, 0.5],
			[3, 2, 56, 0.5],
			[3, 2.5, 59, 0.5],
			[4, 0, 59, 4],
			[5, 1.5, 59, 0.5],
			[5, 2, 62, 0.5],
			[5, 2.5, 66, 0.5],
			[6, 0, 66, 4],
			[7, 1.5, 59, 0.5],
			[7, 2, 62, 0.5],
			[7, 2.5, 66, 0.5],
			[8, 0, 66, 3],
		] as const
	).map(([bar, beat, p, dur]) => n("lead", bar, beat, dur, p, 0.6)),
];

// ── Waltz No. 1 ─────────────────────────────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.6 : bar < 17 ? 0.66 : bar < 25 ? 0.78 : bar < 29 ? 0.9 : 0.85;

/** The choir holds each harmony for as many bars as it lasts. */
function choir(): NoteEvent[] {
	const out: NoteEvent[] = [];
	let from = 1;
	for (let bar = 2; bar <= HARMONY.length; bar++) {
		const a = HARMONY[from];
		const b = HARMONY[bar];
		if (b && a && b[2].join() === a[2].join()) continue;
		if (a)
			out.push(
				...choirChord(from, a[0], a[2], (bar - from) * 3, dyn(from) * 0.7),
			);
		from = bar;
	}
	return out;
}

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		n("lead", bar, beat, dur, pitch, dyn(bar)),
		...(answer
			? [n("answer", bar, beat, Math.max(dur, 1.5), pitch - 12, dyn(bar))]
			: []),
		...(answer && beat === 2
			? [n("lead", bar, 1.9, 0.1, pitch - 1, dyn(bar) * 0.6)]
			: []),
	]),
	...HARMONY.flatMap((h, bar) =>
		h
			? [
					...sequence(bar, h[0], h[1], dyn(bar)),
					...sequence2(bar, h[0], h[1], dyn(bar)),
				]
			: sequence(bar, 45, [61, 64, 67], dyn(bar) * 0.8),
	),
	...choir(),
];

// ── The cadence: Strauss's last three bars, then the tonic held ────────────

const CADENCE: NoteEvent[] = [
	...[...CADENCE_THEME, [3, 0, 74, 3] as const].map(([bar, beat, p, dur]) =>
		n("lead", bar, beat, dur, p, 0.85),
	),
	n("answer", 3, 0, 3, 62, 0.8),
	...sequence(0, 43, [59, 62, 67], 0.85),
	...sequence(1, 45, [55, 61, 64], 0.85),
	...sequence(2, 38, [57, 62, 66], 0.85),
	...sequence2(0, 43, [59, 62, 67], 0.85),
	...sequence2(1, 45, [55, 61, 64], 0.85),
	// The sequence stops on the low D; the choir holds the tonic.
	n("seq", 3, 0, 3, 38, 0.8),
	...choirChord(0, 43, [55, 59, 62, 67], 3, 0.6),
	...choirChord(1, 45, [55, 61, 64, 69], 3, 0.6),
	...choirChord(2, 38, [50, 57, 62, 66], 6, 0.6),
];

/**
 * Score bars: the intro 0–8, the waltz 9–40 (49.7 s a loop at
 * `BERLIN_BPM`), the cadence 41–44, broadening over its last two.
 */
export const DANUBE_BERLIN: Song = {
	name: "An der schönen blauen Donau (Berlin school)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 9, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: BERLIN_BPM },
		{ bar: 42, bpm: BERLIN_BPM },
		{ bar: 44, bpm: 92, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 6, echoBeats: 0.75, echoFeedback: 0.5 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_BERLIN;
