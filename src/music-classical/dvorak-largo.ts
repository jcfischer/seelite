/**
 * Antonín Dvořák, Symphony No. 9 in E minor, op. 95, *From the New World*
 * (1893), II. *Largo*: the opening chorale and the English horn's theme,
 * hand-encoded as note data — a public-domain composition, synthesised at
 * runtime, nothing downloaded or recorded (#543 D2, on the map's
 * Constraints).
 *
 * **Encoded from the full score** (N. Simrock, Berlin, 1894; IMSLP #405834,
 * a reprint of that edition): printed pages 207–208, bars 1–18 as printed,
 * then one bar of this arrangement's own (below). At sounding pitch.
 *
 * - **The chorale** (bars 1–4, *ppp* to *f dim.*): read off the
 *   non-transposing staves — bassoons, trombones I–II (alto clef), bass
 *   trombone and tuba — with horns I–II in E (a minor sixth below the page)
 *   for the top voice: E major, G minor over D, E major, D♭7 over C♭, A
 *   major, G♭ with the trombone's D♭–E♭, and D♭ major held into bar 5.
 * - **The strings' answer** (bars 5–6, *con sordino, ppp*): D♭ major, the
 *   first violins F4–F4–F4, F4–E♭4–F4.
 * - **The English horn's theme** (bars 7–18): the page writes it in F on the
 *   oboes' staff, and it sounds a fifth lower — the first bar is written
 *   C5–E♭5–E♭5–C5–B♭4–A♭4 and sounds F4–A♭4–A♭4–F4–E♭4–D♭4. Bars 7–10,
 *   the rise to B♭4–D♭5 over the cellos' G♭ in bars 11–14, the return in
 *   15–16, and bar 17's climb to F5 and bar 18's *f* fall to D♭5.
 * - **Under the theme**: violins I and II and the cellos (the basses
 *   where they play: bars 5–6 and 15–18).
 *
 * **Reduced**: the violas are left out from bar 7 (their divided chords
 * could not be read with certainty off this reprint), and so are the
 * clarinets' low line in bars 1–4, the trumpets and horns III–IV (whose
 * transpositions this file did not settle), and the timpani. Each chord is
 * one voicing without the page's octave doublings.
 *
 * **Not certain**: violins II's last half in bar 10 (C4 against D♭4) and
 * in bar 18 (B♭3 against A♭3); the cellos' chords in bars 9–10; the basses'
 * second half in bar 18 (E♭). And **one bar is this arrangement's own**:
 * bar 18 closes the English horn's statement on D♭5 over the orchestra's
 * dominant, and bar 19 moves on to the clarinets; here that last sonority
 * is held through one more bar under the ritardando, so the excerpt ends on
 * a held chord.
 *
 * **Tempo**: *Largo*, M.M. ♩ = 52 as printed, broadened to 46 over bar 18
 * and the held bar.
 *
 * Imports only the score's types, the notation helpers and the Danube's
 * horn desk, so it is data.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** Score bars 1–18, then the held bar. */
const BARS = 19;

/** Bars 1–4: the chorale, a half note a chord, the tuba's line under it. */
const CHORALE: NoteEvent[] = [
	...chord("chorale", 0, 0, [47, 56, 59], 2, 0.3),
	...chord("chorale", 0, 2, [46, 55, 58], 2, 0.3),
	...chord("chorale", 1, 0, [47, 56, 59], 2, 0.34),
	...chord("chorale", 1, 2, [44, 47, 53, 61], 2, 0.34),
	...chord("chorale", 2, 0, [49, 52, 61], 2, 0.45),
	...chord("chorale", 2, 2, [44, 54, 58, 61], 2, 0.55),
	...line(
		"chorale",
		[
			[2, 2, 49, 1],
			[2, 3, 51, 1],
		],
		0.55,
	),
	// Bar 4: D♭ major, f dim., held into bar 5's first eighth.
	...chord("chorale", 3, 0, [49, 53, 56, 61], 4.5, 0.75),
	...line(
		"bed",
		[
			[0, 0, 40, 2],
			[0, 2, 38, 2],
			[1, 0, 40, 2],
			[1, 2, 35, 2],
			[2, 0, 45, 2],
			[2, 2, 42, 2],
			[3, 0, 37, 4.5],
		],
		(bar) => (bar < 2 ? 0.3 : bar < 3 ? 0.5 : 0.75),
	),
];

/** Bars 5–6: the strings' answer, con sordino. `[bar, beat, dur]`. */
const ANSWER_RHYTHM = [
	[4, 0, 1.5],
	[4, 1.5, 0.5],
	[4, 2, 2],
	[5, 0, 0.5],
] as const;
const ANSWER: NoteEvent[] = [
	...ANSWER_RHYTHM.flatMap(([bar, beat, dur]) => [
		...chord("strings", bar, beat, [53, 56, 61, 65], dur, 0.35),
		...line("low", [[bar, beat, 49, dur]], 0.35),
	]),
	// The eighth on A♭7, then D♭ major held.
	...chord("strings", 5, 0.5, [51, 56, 60, 63], 0.5, 0.35),
	...line("low", [[5, 0.5, 44, 0.5]], 0.35),
	...chord("strings", 5, 1, [53, 56, 61, 65], 3, 0.33),
	...chord("low", 5, 1, [37, 44, 49], 3, 0.33),
];

/** The English horn, at sounding pitch: `[bar, beat, pitch, dur]`. */
const PHRASE_A = (bar: number) =>
	[
		[bar, 0, 65, 0.75],
		[bar, 0.75, 68, 0.25],
		[bar, 1, 68, 1],
		[bar, 2, 65, 0.75],
		[bar, 2.75, 63, 0.25],
		[bar, 3, 61, 1],
	] as const;
const PHRASE_B = (bar: number) =>
	[
		[bar, 0, 63, 0.75],
		[bar, 0.75, 65, 0.25],
		[bar, 1, 68, 0.75],
		[bar, 1.75, 65, 0.25],
		[bar, 2, 63, 2],
	] as const;
const PHRASE_C = (bar: number) =>
	[
		[bar, 0, 70, 0.75],
		[bar, 0.75, 73, 0.25],
		[bar, 1, 73, 1],
		[bar, 2, 72, 0.5],
		[bar, 2.5, 68, 0.5],
		[bar, 3, 70, 1],
	] as const;
const PHRASE_D = (bar: number) =>
	[
		[bar, 0, 70, 0.5],
		[bar, 0.5, 73, 0.5],
		[bar, 1, 72, 0.5],
		[bar, 1.5, 68, 0.5],
		[bar, 2, 70, 2],
	] as const;

/** Loudness by bar: p, pp from bar 15, cresc. in 17, f in 18. */
const ehDyn = (bar: number) =>
	bar < 14 ? 0.55 : bar < 16 ? 0.45 : bar < 17 ? 0.6 : 0.8;

const THEME: NoteEvent[] = line(
	"eh",
	[
		...PHRASE_A(6),
		...PHRASE_B(7),
		...PHRASE_A(8),
		[9, 0, 63, 0.5],
		[9, 0.5, 65, 0.5],
		[9, 1, 63, 0.75],
		[9, 1.75, 61, 0.25],
		[9, 2, 61, 2],
		...PHRASE_C(10),
		...PHRASE_D(11),
		...PHRASE_C(12),
		...PHRASE_D(13),
		// Bar 15, pp: the first phrase again, its second beat pair in eighths.
		[14, 0, 65, 0.75],
		[14, 0.75, 68, 0.25],
		[14, 1, 68, 1],
		[14, 2, 65, 0.5],
		[14, 2.5, 63, 0.5],
		[14, 3, 61, 1],
		...PHRASE_B(15),
		// Bar 17: the climb to F5.
		[16, 0, 65, 0.75],
		[16, 0.75, 68, 0.25],
		[16, 1, 68, 1],
		[16, 2, 73, 0.75],
		[16, 2.75, 75, 0.25],
		[16, 3, 77, 1],
		// Bar 18, f: the fall to D♭5, held through the arrangement's bar.
		[17, 0, 75, 0.75],
		[17, 0.75, 73, 0.25],
		[17, 1, 75, 0.5],
		[17, 1.5, 70, 0.5],
		[17, 2, 73, 6],
	],
	ehDyn,
);

/** Violins I and II under the theme: `[bar, beat, pitch, dur]`. */
const UPPER: NoteEvent[] = line(
	"strings",
	[
		// Violins I.
		[6, 0, 65, 2],
		[6, 2, 61, 2],
		[7, 0, 60, 4],
		[8, 0, 61, 4],
		[9, 0, 61, 1],
		[9, 1, 56, 1],
		[9, 2, 56, 2],
		[10, 0, 61, 8],
		[12, 0, 61, 8],
		[14, 0, 61, 2],
		[14, 2, 61, 0.5],
		[14, 2.5, 56, 0.5],
		[14, 3, 65, 0.5],
		[14, 3.5, 61, 0.5],
		[15, 0, 60, 4],
		[16, 0, 65, 1],
		[16, 1, 63, 1],
		[16, 2, 61, 1],
		[16, 3, 70, 1],
		[17, 0, 70, 1.5],
		[17, 0, 66, 1.5],
		[17, 1.5, 66, 0.5],
		[17, 2, 65, 6],
		// Violins II.
		[6, 0, 61, 2],
		[6, 2, 56, 2],
		[7, 0, 56, 4],
		[8, 0, 56, 2],
		[8, 2, 57, 2],
		[9, 0, 58, 1],
		[9, 1, 60, 1],
		[9, 2, 60, 2],
		[10, 0, 58, 2],
		[10, 2, 56, 1],
		[10, 3, 58, 1],
		[11, 0, 58, 1],
		[11, 1, 56, 1],
		[11, 2, 58, 2],
		[12, 0, 58, 2],
		[12, 2, 56, 1],
		[12, 3, 58, 1],
		[13, 0, 58, 1],
		[13, 1, 56, 1],
		[13, 2, 58, 2],
		[14, 0, 56, 8],
		[16, 0, 58, 2],
		[16, 2, 61, 2],
		[17, 0, 61, 1.5],
		[17, 1.5, 60, 0.5],
		[17, 2, 58, 6],
	],
	(bar) => (bar < 14 ? 0.35 : bar < 16 ? 0.3 : bar < 17 ? 0.5 : 0.7),
);

/** Cellos, and the basses where they play, at sounding pitch. */
const LOWER: NoteEvent[] = line(
	"low",
	[
		[6, 0, 44, 8],
		[6, 0, 37, 8],
		[8, 0, 44, 2],
		[8, 0, 37, 2],
		[8, 2, 49, 2],
		[8, 2, 41, 2],
		[9, 0, 49, 1],
		[9, 0, 42, 1],
		[9, 1, 42, 1],
		[9, 2, 42, 2],
		[9, 2, 36, 2],
		[10, 0, 42, 8],
		[12, 0, 42, 8],
		[14, 0, 37, 8],
		[14, 0, 44, 8],
		// Bar 17: the descent, cellos and basses an octave apart.
		[16, 0, 49, 1],
		[16, 1, 48, 1],
		[16, 2, 46, 1],
		[16, 3, 44, 1],
		[16, 0, 37, 1],
		[16, 1, 36, 1],
		[16, 2, 34, 1],
		[16, 3, 32, 1],
		// Bar 18: A♭ held; the basses' A♭ then E♭, held on.
		[17, 0, 44, 8],
		[17, 0, 32, 2],
		[17, 2, 39, 6],
	],
	(bar) => (bar < 14 ? 0.35 : bar < 16 ? 0.3 : bar < 17 ? 0.5 : 0.7),
);

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The winds' chorale: the Danube's horn desk (no brass, #547 D14).
	chorale: {
		...DANUBE_VOICINGS.orchestra.horn,
		level: 0.24,
		attackS: 0.35,
		releaseS: 1.2,
		pan: -0.15,
		reverb: 0.55,
	},
	// Tuba and bass trombone: a soft held bed.
	bed: {
		voice: "drone",
		level: 0.28,
		attackS: 0.4,
		releaseS: 1.5,
		detune: 0.05,
		drift: 5,
		reverb: 0.5,
	},
	// The English horn: the flute voice, darker.
	eh: {
		voice: "flute",
		level: 0.36,
		attackS: 0.06,
		releaseS: 0.6,
		glideS: 0.03,
		cutoffHz: 1400,
		index: 0.3,
		vibrato: 0.1,
		pan: 0.2,
		reverb: 0.5,
	},
	// Violins, con sordino: slow, dark and soft.
	strings: {
		voice: "strings",
		level: 0.18,
		attackS: 0.45,
		releaseS: 1.2,
		unison: 3,
		cutoffHz: 1100,
		envAmount: 1,
		vibrato: 0.08,
		pan: -0.2,
		reverb: 0.55,
	},
	// Cellos and basses.
	low: {
		voice: "strings",
		level: 0.28,
		attackS: 0.5,
		releaseS: 1.4,
		unison: 3,
		cutoffHz: 600,
		envAmount: 1,
		vibrato: 0.05,
		pan: 0.1,
		reverb: 0.45,
	},
};

/** ♩ = 52 to bar 17, broadened to 46 over bar 18 and held. */
const BPM = 52;
const END_BPM = 46;

export const DVORAK_LARGO: Song = {
	name: "Largo (From the New World)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "largo",
			bars: BARS,
			events: [...CHORALE, ...ANSWER, ...THEME, ...UPPER, ...LOWER],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 17, bpm: BPM },
		{ bar: 18, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4 },
};

/**
 * The excerpt's length: 17 bars at 52; bar 18 on the ramp, whose four beats
 * take `4 × 60 / (52 − 46) × ln(52/46)` s; the held bar at 46.
 */
export const DVORAK_LARGO_SECONDS =
	(17 * 4 * 60) / BPM +
	((4 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(4 * 60) / END_BPM;
