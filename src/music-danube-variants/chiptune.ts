/**
 * The Blue Danube as chiptune: the waltz as a home computer's sound chip
 * played it in 1984, on this synth's existing voices.
 *
 * **Strauss's notes, three-channel thinking.** The theme is `THEME` at the
 * printed octave on a single bare oscillator with a late vibrato; each bar's
 * harmony is not held but **arpeggiated in 32nds** (`HARMONY`'s chord, cycled
 * up), which is how a three-voice chip sounded a chord; the bass bounces root
 * and octave on the oom-pah-pah; the drums are a falling sine and noise. The
 * woodwinds' answers get the chip's echo trick: the same note again half a
 * beat later, an octave down and quieter. The meter stays 3/4.
 *
 * **On the pulse voice, as a SID voices it.** The lead is a quarter-width
 * pulse whose width sweeps slowly and whose vibrato arrives only once a
 * note is held; the arpeggio is a narrow eighth-width pulse, the thin buzz a
 * chip chord is made of; the bass is a square through a low lowpass, which
 * is as near a triangle as a pulse gets. Three melodic channels, as on the
 * chip, plus the echo and the noise kit.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const CHIP_BPM = 168;
const INTRO_BPM = 132;

/** One chip channel: a pulse, hard-gated. */
const chip = (o: Partial<PartSpec>): PartSpec => ({
	voice: "pulse",
	level: 0.2,
	width: 0.5,
	attackS: 0.002,
	decayS: 0.2,
	sustain: 0.8,
	releaseS: 0.03,
	...o,
});

const PARTS: Readonly<Record<string, PartSpec>> = {
	// A quarter pulse breathing between thin and hollow over three seconds,
	// the vibrato in only after a fifth of a second.
	lead: chip({
		level: 0.405,
		width: 0.25,
		pwmHz: 0.33,
		pwmDepth: 0.17,
		decayS: 0.3,
		sustain: 0.75,
		releaseS: 0.04,
		vibrato: 0.25,
		vibratoHz: 6,
		vibratoOnsetS: 0.18,
		vibratoRiseS: 0.15,
		reverb: 0.12,
	}),
	echo: chip({
		level: 0.203,
		width: 0.5,
		cutoffHz: 2500,
		pan: 0.35,
		reverb: 0.12,
	}),
	arp: chip({
		level: 0.203,
		width: 0.125,
		decayS: 0.08,
		sustain: 0.5,
		releaseS: 0.015,
		pan: -0.25,
	}),
	// A square, low-passed: the triangle bass.
	bass: chip({
		level: 0.567,
		decayS: 0.15,
		sustain: 0.6,
		releaseS: 0.03,
		cutoffHz: 700,
	}),
	kick: {
		voice: "tone",
		level: 0.836,
		ratio: 4,
		decayS: 0.14,
		releaseS: 0.03,
	},
	snare: {
		voice: "noise",
		level: 0.293,
		decayS: 0.09,
		releaseS: 0.03,
		resonance: 0.2,
	},
	hat: { voice: "noise", level: 0.105, decayS: 0.025, releaseS: 0.02 },
};

const n = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

/** A chord as a 32nd-note arpeggio over `beats` beats from `beat`. */
const arp = (
	bar: number,
	pitches: readonly number[],
	vel: number,
	beat = 0,
	beats = 3,
): NoteEvent[] => {
	const up = [...pitches].sort((a, b) => a - b);
	return Array.from({ length: beats * 8 }, (_, i) =>
		n("arp", bar, beat + i / 8, 0.12, up[i % up.length], vel),
	);
};

/** The chip kit for one bar: kick on one, snare on three, hats on eighths. */
const kit = (bar: number, vel: number): NoteEvent[] => [
	n("kick", bar, 0, 0.3, 36, vel),
	n("snare", bar, 2, 0.2, 90, vel * 0.6),
	...[0, 0.5, 1, 1.5, 2, 2.5].map((b) => n("hat", bar, b, 0.1, 108, 0.5)),
];

// ── Intro: the Andantino's harmony arpeggiated, the horn call on the lead ──

const INTRO_CHORDS: readonly (readonly [number, readonly number[], number])[] =
	[
		[0, [69, 73, 76], 45],
		[1, [69, 73, 76], 45],
		[2, [69, 73, 76], 45],
		[3, [69, 73, 76], 45],
		[4, [68, 71, 76], 50],
		[5, [68, 71, 76], 50],
		[6, [71, 74, 78], 52],
		[7, [71, 74, 78], 52],
		[8, [69, 73, 76, 79], 55],
	];

const INTRO: NoteEvent[] = [
	...INTRO_CHORDS.flatMap(([bar, chord, bass]) => [
		...arp(bar, chord, 0.45 + bar * 0.03),
		n("bass", bar, 0, 2, bass, 0.55),
	]),
	// The call, an octave up: A–C#–E into E; E–G#–B into B; the thirds
	// rising twice, their top notes.
	...(
		[
			[1, 1.5, 69],
			[1, 2, 73],
			[1, 2.5, 76],
			[3, 1.5, 64],
			[3, 2, 68],
			[3, 2.5, 71],
			[5, 1.5, 71],
			[5, 2, 74],
			[5, 2.5, 78],
			[7, 1.5, 71],
			[7, 2, 74],
			[7, 2.5, 78],
		] as const
	).map(([bar, beat, p]) => n("lead", bar, beat, 0.45, p, 0.6)),
	n("lead", 2, 0, 4.5, 76, 0.55),
	n("lead", 4, 0, 4.5, 71, 0.55),
	n("lead", 6, 0, 4.5, 78, 0.6),
	n("lead", 8, 0, 3, 78, 0.55),
	// A snare fill into the waltz.
	...Array.from({ length: 6 }, (_, i) =>
		n("snare", 8, i / 2, 0.2, 90, 0.35 + i * 0.1),
	),
];

// ── Waltz No. 1 ─────────────────────────────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.6 : bar < 17 ? 0.66 : bar < 25 ? 0.78 : bar < 29 ? 0.9 : 0.85;

/** The waltz's harmony a bar: arpeggio, bouncing bass, kit. */
function accompany(bar: number, vel: number): NoteEvent[] {
	const h = HARMONY[bar];
	if (!h) return arp(bar, [62, 66, 69], vel * 0.6);
	const [root, chord, , how] = h;
	const bass =
		how === "end"
			? [
					n("bass", bar, 0, 1, root + 12, vel),
					n("bass", bar, 1.5, 0.4, root + 12, vel),
					n("bass", bar, 2, 0.8, root + 12, vel),
				]
			: how === "held"
				? [n("bass", bar, 0, 2.8, root + 12, vel)]
				: [
						n("bass", bar, 0, 0.9, root + 12, vel),
						n("bass", bar, 1, 0.4, root + 24, vel * 0.8),
						n("bass", bar, 2, 0.4, root + 24, vel * 0.8),
					];
	return [
		...arp(
			bar,
			chord.map((p) => p + 12),
			vel * 0.8,
		),
		...bass,
		...kit(bar, vel),
	];
}

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		n("lead", bar, beat, dur, pitch, dyn(bar)),
		// The echo: the answer again half a beat on, an octave down.
		...(answer
			? [
					beat + 0.5 < 3
						? n("echo", bar, beat + 0.5, 0.45, pitch - 12, dyn(bar))
						: n("echo", bar + 1, beat - 2.5, 0.45, pitch - 12, dyn(bar)),
				]
			: []),
		// The grace below each third-beat answer: the chip's slide up.
		...(answer && beat === 2
			? [n("lead", bar, 1.88, 0.12, pitch - 1, dyn(bar) * 0.7)]
			: []),
	]),
	...HARMONY.flatMap((_, bar) => accompany(bar, dyn(bar))),
];

// ── The cadence: Strauss's last three bars, then the tonic arpeggiated ────

const CADENCE: NoteEvent[] = [
	...(
		[
			[0, 0, 78, 2],
			[0, 2, 76, 1],
			[1, 0, 83, 2],
			[1, 2, 81, 1],
			[2, 0, 74, 1],
			[2, 1.5, 74, 0.5],
			[2, 2, 74, 1],
			[3, 0, 86, 3],
		] as const
	).map(([bar, beat, p, dur]) => n("lead", bar, beat, dur, p, 0.85)),
	...arp(0, [71, 74, 79], 0.7),
	...arp(1, [69, 73, 76, 79], 0.7),
	...arp(2, [66, 69, 74], 0.7),
	...arp(3, [62, 66, 69, 74], 0.6),
	n("bass", 0, 0, 2.8, 55, 0.85),
	n("bass", 1, 0, 2.8, 57, 0.85),
	n("bass", 2, 0, 1, 50, 0.85),
	n("bass", 2, 1.5, 0.4, 50, 0.85),
	n("bass", 2, 2, 0.8, 50, 0.85),
	n("bass", 3, 0, 3, 38, 0.85),
	...kit(0, 0.85),
	...kit(1, 0.85),
	...kit(2, 0.85),
	n("kick", 3, 0, 0.3, 36, 0.9),
	n("snare", 3, 0, 0.3, 90, 0.7),
];

/**
 * Score bars: the intro 0–8, the waltz 9–40, the cadence 41–44. The waltz
 * loops at `CHIP_BPM`, 32 bars in 34 s; the cadence slows over its last two.
 */
export const DANUBE_CHIPTUNE: Song = {
	name: "An der schönen blauen Donau (chiptune)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 9, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: INTRO_BPM },
		{ bar: 7, bpm: INTRO_BPM },
		{ bar: 8, bpm: 120, ramp: true },
		{ bar: 9, bpm: CHIP_BPM },
		{ bar: 42, bpm: CHIP_BPM },
		{ bar: 44, bpm: 120, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 0.8 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_CHIPTUNE;
