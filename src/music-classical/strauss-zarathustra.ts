/**
 * Richard Strauss, *Also sprach Zarathustra*, op. 30 (1896): the
 * introduction, the sunrise, hand-encoded as note data — a public-domain
 * composition, synthesised at runtime, nothing downloaded or recorded (#543
 * D2, on the map's Constraints).
 *
 * **Encoded from the first edition's full score** (Jos. Aibl Verlag,
 * München, 1896, plate 2859; Harvard, Eda Kuhn Loeb Music Library copy;
 * IMSLP #74923): printed pages 3–5, bars 1–22 — everything before the
 * *Von den Hinterweltlern* heading. At sounding pitch: the trumpets are in C;
 * the contrabassoon, the double basses and the organ's pedal sound an octave
 * below the page, which puts the opening's C at C1 and C2.
 *
 * - **The pedal** (bars 1–14): the organ's pedal and the basses' tremolo on
 *   low C, then F in bars 15–16 under the F major chord.
 * - **The call** (trumpets I, *feierlich*): C4–G4–C5 three times. The first
 *   lands on a sixteenth of C major (E5) held into C minor (E♭5); the second
 *   the other way round, E♭5 into E5; the third on C major's sixteenth into
 *   a whole bar of F major (F5 under A5).
 * - **The chords** (the tutti under the call): C major and C minor, then F
 *   major; the ending's C major/E, F and G under the violins' climb, and C
 *   major *ff* for bars 19–21.
 * - **The climb** (violins I, bars 16–21): A5–B5–C6–D6, E6–F6–G6 (tied)
 *   –E6–F6 *immer breiter*, G6–A6–B6, then C7 in tremolo halves for two
 *   bars and a last eighth. Violins II a line below in bars 16–17.
 * - **The timpani**: the half-bar roll into each call's release, the C–G
 *   triplets after it and the *ff* eighth; the roll through bars 19–20.
 *
 * **Reduced**: every tutti chord is one held voicing, not the page's
 * doublings across three dozen staves; the tremolos (basses, timpani,
 * strings in bars 19–20) are held notes or a few strokes. The bass drum's
 * tremolo, the cymbals and trumpet II's held C are left out.
 *
 * **Not read off the page, and said so**: the lower strings of page 4 are
 * torn away from bar 16's third beat, so bar 17's bass is trombone III's
 * downbeat A, held; bar 16's last beat is the violas' B♭ chord under the
 * violins' D. The organ's *volles Werk* chord in bars 19–21 is voiced here
 * as C major across its range; the page's stacking was not legible in full.
 * **And one bar is this arrangement's own**: the score's organ lets go after
 * two and a half beats of bar 21 and bar 22 is the bass drum alone, *pp*;
 * here the organ's chord is held through bar 22, so the excerpt ends on it.
 *
 * **Tempo**: *Sehr breit*, Metr. ♩ = 69 as printed (the note in the mark is
 * small and worn; a quarter is this file's reading), *immer breiter* from
 * bar 17 broadened here to 54 by bar 19 and held.
 *
 * Imports only the score's types, the notation helpers and the Danube's
 * horn desk, so it is data.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** Score bars 1–22. */
const BARS = 22;

/** The tutti chords, without the call's top note. */
const C_MAJOR = [48, 55, 60, 64, 67, 72];
const C_MINOR = [48, 55, 60, 63, 67, 72];
const F_MAJOR = [53, 57, 60, 65, 69, 72, 77];

/** A timpani roll: strokes a quarter of a beat apart, swelling. */
const roll = (
	bar: number,
	beat: number,
	beats: number,
	from: number,
	to: number,
	pitch = 48,
): NoteEvent[] => {
	const n = beats * 4;
	return Array.from({ length: n }, (_, i) =>
		line(
			"timp",
			[[bar + Math.floor((beat + i / 4) / 4), (beat + i / 4) % 4, pitch, 0.25]],
			from + ((to - from) * i) / Math.max(1, n - 1),
		),
	).flat();
};

/** The timpani's C–G triplets across a bar, then the ff eighth. */
const triplets = (bar: number): NoteEvent[] => [
	...Array.from({ length: 12 }, (_, i) =>
		line("timp", [[bar, i / 3, i % 2 === 0 ? 48 : 43, 1 / 3]], 0.75),
	).flat(),
	...line("timp", [[bar + 1, 0, 48, 0.5]], 0.95),
];

/** Trumpets I, the call, the top line only: C4–G4–C5 and its landing. */
const CALL: NoteEvent[] = [
	// Bars 5–8: C major's sixteenth, C minor held, released on bar 8's first.
	...line(
		"call",
		[
			[4, 0, 60, 2],
			[4, 2, 67, 2],
			[5, 0, 72, 3.75],
		],
		0.55,
	),
	...line("call", [[5, 3.75, 76, 0.25]], 0.85),
	...line("call", [[6, 0, 75, 4.25]], 0.7),
	// Bars 9–12: C minor's sixteenth, C major held.
	...line(
		"call",
		[
			[8, 0, 60, 2],
			[8, 2, 67, 2],
			[9, 0, 72, 3.75],
		],
		0.62,
	),
	...line("call", [[9, 3.75, 75, 0.25]], 0.85),
	...line("call", [[10, 0, 76, 4.25]], 0.72),
	// Bars 13–15: C major's sixteenth into F major's A.
	...line(
		"call",
		[
			[12, 0, 60, 2],
			[12, 2, 67, 2],
			[13, 0, 72, 3.75],
		],
		0.7,
	),
	...line("call", [[13, 3.75, 76, 0.25]], 0.9),
	...line("call", [[14, 0, 81, 4]], 0.8),
];

/** The tutti: the sixteenth, then the held chord, as each call lands. */
const TUTTI: NoteEvent[] = [
	...chord("tutti", 5, 3.75, C_MAJOR, 0.25, 0.85),
	...chord("tutti", 6, 0, C_MINOR, 4.25, 0.65),
	...chord("tutti", 9, 3.75, C_MINOR, 0.25, 0.85),
	...chord("tutti", 10, 0, C_MAJOR, 4.25, 0.68),
	...chord("tutti", 13, 3.75, C_MAJOR, 0.25, 0.88),
	...chord("tutti", 14, 0, F_MAJOR, 4, 0.72),
	// Bar 16: F major under the climb, the violas' B♭ chord on the fourth.
	...chord("tutti", 15, 0, [53, 57, 60, 65], 3, 0.7),
	...chord("tutti", 15, 3, [58, 62, 65], 1, 0.75),
	// Bar 18: C/E, F, G — the cellos' chords.
	...chord("tutti", 17, 0, [55, 60, 64], 2, 0.85),
	...chord("tutti", 17, 2, [48, 53, 57, 60], 1, 0.88),
	...chord("tutti", 17, 3, [50, 55, 59], 1, 0.9),
	// Bars 19–21: C major ff, two bars and the last eighth.
	...chord("tutti", 18, 0, [55, 60, 64, 67, 72, 76], 8, 0.95),
	...chord("tutti", 20, 0, [55, 60, 64, 67, 72, 76], 0.5, 1),
];

/** Violins I from bar 16, the climb; violins II under it in bars 16–17. */
const CLIMB: NoteEvent[] = [
	...line(
		"melody",
		[
			[15, 0, 81, 0.25],
			[15, 0.25, 83, 0.25],
			[15, 0.5, 84, 2.5],
			[15, 3, 86, 1],
			[16, 0, 88, 0.5],
			[16, 0.5, 89, 0.5],
			[16, 1, 91, 2.5],
			[16, 3.5, 88, 0.25],
			[16, 3.75, 89, 0.25],
			[17, 0, 91, 2],
			[17, 2, 93, 1],
			[17, 3, 95, 1],
			[18, 0, 96, 2],
			[18, 2, 96, 2],
			[19, 0, 96, 2],
			[19, 2, 96, 2],
			[20, 0, 96, 0.5],
		],
		(bar) => (bar < 17 ? 0.75 : 0.95),
	),
	...line(
		"second",
		[
			[15, 0, 76, 0.25],
			[15, 0.25, 77, 0.25],
			[15, 0.5, 79, 2.5],
			[15, 3, 74, 1],
			[16, 0, 76, 0.5],
			[16, 0.5, 77, 0.5],
			[16, 1, 79, 2.5],
			[16, 3.5, 76, 0.25],
			[16, 3.75, 77, 0.25],
		],
		0.7,
	),
];

/** The organ's pedal and the basses: C, then F, then the ending's line. */
const LOW: NoteEvent[] = [
	...chord("organ", 0, 0, [24, 36], 56, 0.4),
	...chord("organ", 14, 0, [29, 41], 6, 0.55),
	...line(
		"bass",
		[
			[0, 0, 36, 56],
			[14, 0, 41, 8],
			[16, 0, 45, 4],
			[17, 0, 40, 2],
			[17, 2, 41, 1],
			[17, 3, 43, 1],
			[18, 0, 36, 8],
			[20, 0, 36, 0.5],
		],
		(bar) => (bar < 4 ? 0.4 : bar < 14 ? 0.5 : bar < 17 ? 0.7 : 0.9),
	),
	// Bars 19–22: the organ's full chord, held to the end.
	// Without the G3, E4 and C5 the tutti holds at the same pitches: eight
	// organ voices over the tutti's twelve passed the synth's cap and stole
	// the held C.
	...chord("organ", 18, 0, [24, 36, 48, 60, 67], 16, 0.7),
];

const TIMPANI: NoteEvent[] = [
	...roll(6, 2, 2, 0.3, 0.7),
	...triplets(7),
	...roll(10, 2, 2, 0.3, 0.7),
	...triplets(11),
	...roll(14, 2, 2, 0.3, 0.7),
	...line("timp", [[15, 0, 48, 0.5]], 0.95),
	...roll(15, 2, 2, 0.3, 0.7),
	...line("timp", [[16, 0, 48, 0.5]], 0.85),
	...roll(18, 0, 8, 0.7, 0.95),
	...line("timp", [[20, 0, 48, 0.5]], 1),
];

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The organ's pedal and, at the end, its full chord: a slow held bed.
	organ: {
		voice: "drone",
		level: 0.3,
		attackS: 1.2,
		releaseS: 3,
		detune: 0.06,
		drift: 6,
		reverb: 0.55,
	},
	// Contrabassoon and double basses: the low bowed line.
	bass: {
		voice: "strings",
		level: 0.34,
		attackS: 0.6,
		releaseS: 1.2,
		unison: 3,
		cutoffHz: 550,
		envAmount: 1,
		vibrato: 0,
		pan: -0.1,
		reverb: 0.4,
	},
	// Trumpets I, feierlich: the Danube's horn desk (the synth's brass was
	// heard as bad, #547 D14).
	call: { ...DANUBE_VOICINGS.orchestra.horn, pan: -0.2, reverb: 0.55 },
	// The tutti: a quick bow for the sixteenth, held for the chord.
	tutti: {
		voice: "strings",
		level: 0.2,
		attackS: 0.04,
		// 0.6, not 1: at 1 the tutti's tails filled the synth's cap at the
		// final chord and stole the organ's held C.
		releaseS: 0.6,
		unison: 3,
		cutoffHz: 1500,
		envAmount: 1.6,
		index: 0.3,
		vibrato: 0.08,
		pan: 0.15,
		reverb: 0.55,
	},
	// Violins I: the climb, legato and bright.
	melody: {
		voice: "strings",
		level: 0.36,
		glideS: 0.02,
		attackS: 0.06,
		releaseS: 1,
		cutoffHz: 2200,
		envAmount: 1.8,
		vibrato: 0.12,
		pan: -0.15,
		reverb: 0.5,
	},
	// Violins II, a line below.
	second: {
		voice: "strings",
		level: 0.2,
		glideS: 0.02,
		attackS: 0.06,
		releaseS: 0.8,
		unison: 3,
		cutoffHz: 1800,
		vibrato: 0.1,
		pan: 0.3,
		reverb: 0.5,
	},
	// The timpani: a sine that drops into the note, short.
	timp: {
		voice: "tone",
		level: 0.28,
		ratio: 1.4,
		decayS: 0.7,
		reverb: 0.4,
	},
};

/** ♩ = 69 to bar 16, broadened to 54 over bars 17–18 and held. */
const BPM = 69;
const END_BPM = 54;

export const ZARATHUSTRA: Song = {
	name: "Also sprach Zarathustra",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "sonnenaufgang",
			bars: BARS,
			events: [...LOW, ...CALL, ...TUTTI, ...CLIMB, ...TIMPANI],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 16, bpm: BPM },
		{ bar: 18, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4.5 },
};

/**
 * The excerpt's length: 16 bars at 69; bars 17–18 on the ramp, whose eight
 * beats take `8 × 60 / (69 − 54) × ln(69/54)` s; the last four bars at 54.
 */
export const ZARATHUSTRA_SECONDS =
	(16 * 4 * 60) / BPM +
	((8 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(4 * 4 * 60) / END_BPM;
