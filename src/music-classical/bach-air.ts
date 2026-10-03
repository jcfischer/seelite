/**
 * Johann Sebastian Bach, Orchestral Suite No. 3 in D major, BWV 1068, II.
 * *Air* (c. 1730), hand-encoded as note data (#589) — a public-domain
 * composition, synthesised at runtime, nothing downloaded or recorded.
 *
 * **Encoded from the Bach-Gesellschaft Ausgabe**, Bd. 31.1 (Leipzig:
 * Breitkopf & Härtel, 1885; IMSLP #01468): printed page 54 (the PDF's page
 * 15), the Air's first half — bars 1–5 with the first-time bar, then bars
 * 1–5 again with the second-time bar, as the repeat sign asks. Violin I,
 * violin II, viola and continuo, every pitch read off that page; the
 * repeat's second-time bar closes on A major, the section's cadence to the
 * dominant, held one added bar.
 *
 * **4/4, a quarter per beat.** The edition prints no tempo; a quarter at 50
 * (the continuo walking its eighths at 100) is the arrangement's, slowing
 * over the last printed bar to 40, where the added bar holds the chord.
 *
 * **Voiced for strings, as printed.** Violin I legato on the first desk,
 * with a short glide so its 16ths and 32nds stay notes; violin II and viola
 * on softer desks either side; the continuo's eighths as short low strokes.
 *
 * **Where the arrangement reduces the score.** The two small-note
 * appoggiaturas of bar 2 (F-sharp 5 before the 16ths, B4 before the A4) are
 * played *before* their beat, a tenth of a beat long, on a desk of their own
 * with violin I's sound — a simplification of the on-beat appoggiatura the
 * period expects — and the note before each ends where it begins. Ties are
 * one long note; a tie across the first-time bar line is re-bowed. The
 * continuo is one line (no figured-bass realisation, which the page does not
 * print).
 *
 * Imports only the score's types and the notation helpers, so it is data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { line } from "./notation";

/** Quarters a minute: the arrangement's, the edition prints none. */
const BPM = 50;
/** Where the second-time bar slows to, and the added held bar stays. */
const END_BPM = 40;

type Note = readonly [number, number, number, number];

/** How far before its beat an appoggiatura starts, and how long it lasts. */
const GRACE_LEAD = 0.1;
const GRACE_DUR = 0.08;

// ── Bars 1–5 ───────────────────────────────────────────────────────────────

/** Violin I, `[bar (0-based), beat, pitch, beats]`. */
const VIOLIN_I: readonly Note[] = [
	[0, 0, 78, 4.5], // 1: F#5, tied into 2
	[1, 0.5, 83, 0.25], // 2: B5
	[1, 0.75, 79, 0.25 - GRACE_LEAD], // G5, to the grace
	[1, 1, 76, 0.25], // E5 D5 C#5 D5
	[1, 1.25, 74, 0.25],
	[1, 1.5, 73, 0.25],
	[1, 1.75, 74, 0.25],
	[1, 2, 73, 1 - GRACE_LEAD], // C#5, to the grace
	[1, 3, 69, 1], // A4
	[2, 0, 81, 2.25], // 3: A5, tied to a 16th
	[2, 2.25, 78, 0.25], // F#5
	[2, 2.5, 72, 0.25], // C-natural 5
	[2, 2.75, 71, 0.25], // B4
	[2, 3, 76, 0.25], // E5
	[2, 3.25, 75, 0.25], // D#5
	[2, 3.5, 81, 0.25], // A5
	[2, 3.75, 79, 0.25], // G5
	[3, 0, 79, 2.25], // 4: G5, tied to a 16th
	[3, 2.25, 76, 0.25], // E5
	[3, 2.5, 71, 0.25], // B4
	[3, 2.75, 69, 0.25], // A4
	[3, 3, 74, 0.25], // D5
	[3, 3.25, 73, 0.25], // C#5
	[3, 3.5, 79, 0.25], // G5
	[3, 3.75, 78, 0.25], // F#5
	[4, 0, 78, 1.5], // 5: F#5, dotted
	[4, 1.5, 80, 0.25], // G#5
	[4, 1.75, 81, 0.25], // A5
	[4, 2, 74, 0.5], // D5
	[4, 2.5, 74, 0.125], // D5, 32nd
	[4, 2.625, 76, 0.125], // E5, 32nd
	[4, 2.75, 78, 0.5], // F#5, tied
	[4, 3.25, 76, 0.25], // E5
	[4, 3.5, 76, 0.25], // E5
	[4, 3.75, 74, 0.25], // D5
];

/** Bar 2's appoggiaturas: `[bar, beat of the note they lead to, pitch]`. */
const GRACES: readonly (readonly [number, number, number])[] = [
	[1, 1, 78], // F#5 before the E5
	[1, 3, 71], // B4 before the A4
];

const VIOLIN_II: readonly Note[] = [
	[0, 0, 74, 5], // 1: D5, tied to a quarter
	[1, 1, 71, 1], // 2: B4
	[1, 2, 69, 2.5], // A4, tied to an eighth
	[2, 0.5, 72, 0.25], // 3: C-natural 5
	[2, 0.75, 71, 0.25], // B4
	[2, 1, 72, 0.5], // C5
	[2, 1.5, 81, 0.25], // A5
	[2, 1.75, 72, 0.25], // C5
	[2, 2, 71, 0.5], // B4
	[3, 0, 71, 0.5], // 4: B4
	[3, 0.5, 76, 0.25], // E5
	[3, 0.75, 74, 0.25], // D5
	[3, 1, 76, 0.25], // E5 F#5 G5 E5
	[3, 1.25, 78, 0.25],
	[3, 1.5, 79, 0.25],
	[3, 1.75, 76, 0.25],
	[3, 2, 69, 0.5], // A4
	[4, 0, 69, 2.5], // 5: A4, tied to an eighth
	[4, 2.5, 68, 0.25], // G#4
	[4, 2.75, 69, 0.25], // A4
	[4, 3, 71, 0.5], // B4
	[4, 3.5, 67, 0.5], // G4
];

const VIOLA: readonly Note[] = [
	[0, 0, 69, 2], // 1: A4
	[0, 2, 71, 2], // B4
	[1, 0, 59, 1], // 2: B3
	[1, 1, 64, 1], // E4
	[1, 2, 64, 2.5], // E4, tied to an eighth
	[2, 0.5, 63, 1], // 3: D#4, tied
	[2, 1.5, 64, 0.5], // E4
	[2, 2, 66, 0.5], // F#4
	[3, 0, 64, 0.5], // 4: E4
	[3, 0.5, 59, 1], // B3, tied
	[3, 1.5, 64, 0.5], // E4
	[3, 2, 64, 0.5], // E4
	[4, 0, 62, 1.5], // 5: D4, dotted
	[4, 1.5, 64, 0.5], // E4
	[4, 2, 66, 0.5], // F#4
	[4, 2.5, 62, 0.5], // D4
	[4, 3, 59, 0.5], // B3
	[4, 3.5, 64, 0.5], // E4, tied over the bar line (re-bowed there)
];

/** The continuo's eighths, eight a bar. */
const CONTINUO: readonly (readonly number[])[] = [
	[50, 62, 61, 49, 47, 59, 57, 45], // 1: D3 D4 C#4 C#3 B2 B3 A3 A2
	[43, 55, 56, 44, 45, 57, 55, 43], // 2: G2 G3 G#3 G#2 A2 A3 G3 G2
	[42, 54, 52, 40, 39, 51, 47, 59], // 3: F#2 F#3 E3 E2 D#2 D#3 B2 B3
	[40, 52, 50, 38, 37, 49, 45, 57], // 4: E2 E3 D3 D2 C#2 C#3 A2 A3
	[50, 62, 61, 49, 47, 59, 56, 52], // 5: D3 D4 C#4 C#3 B2 B3 G#3 E3
];

const EIGHTH_STROKE = 0.42;

const eighths = (bar: number, pitches: readonly number[], vel: number) =>
	line(
		"continuo",
		pitches.map((p, i) => [bar, i * 0.5, p, EIGHTH_STROKE] as const),
		vel,
	);

const graces = (
	list: readonly (readonly [number, number, number])[],
	vel: number,
): NoteEvent[] =>
	line(
		"grace",
		list.map(
			([bar, beat, pitch]) =>
				[bar, beat - GRACE_LEAD, pitch, GRACE_DUR] as const,
		),
		vel,
	);

const A_SECTION: NoteEvent[] = [
	...line("violin1", VIOLIN_I, 0.6),
	...graces(GRACES, 0.45),
	...line("violin2", VIOLIN_II, 0.5),
	...line("viola", VIOLA, 0.5),
	...CONTINUO.flatMap((pitches, bar) => eighths(bar, pitches, 0.55)),
];

// ── The first- and second-time bars ────────────────────────────────────────

/** Both endings' upper parts: `ring` adds beats to the final half notes. */
const ending = (ring: number): NoteEvent[] => [
	...line(
		"violin1",
		[
			[0, 0, 73, 0.25], // C#5
			[0, 0.25, 71, 0.25], // B4
			[0, 0.5, 71, 0.125], // B4, 32nd
			[0, 0.625, 73, 0.125], // C#5, 32nd
			[0, 0.75, 74, 0.75], // D5, tied to an eighth
			[0, 1.5, 73, 0.25], // C#5
			[0, 1.75, 71, 0.25], // B4
			[0, 2, 69, 2 + ring], // A4
		],
		0.58,
	),
	...line(
		"violin2",
		[
			[0, 0, 69, 0.5], // A4
			[0, 0.5, 69, 1], // A4, tied
			[0, 1.5, 68, 0.5], // G#4
			[0, 2, 64, 2 + ring], // E4
		],
		0.5,
	),
	...line(
		"viola",
		[
			[0, 0, 64, 0.5], // E4
			[0, 0.5, 66, 0.5], // F#4
			[0, 1, 59, 0.5], // B3
			[0, 1.5, 64, 0.5], // E4
			[0, 2, 61, 2 + ring], // C#4
		],
		0.5,
	),
	...eighths(0, [57, 50, 52, 40], 0.55), // A3 D3 E3 E2
];

const FIRST_TIME: NoteEvent[] = [
	...ending(0),
	// A2 B2 C#3 D3 E3 G-natural 3 F#3 E3, sixteenths back to the top.
	...line(
		"continuo",
		[45, 47, 49, 50, 52, 55, 54, 52].map(
			(p, i) => [0, 2 + i * 0.25, p, 0.22] as const,
		),
		0.5,
	),
];

/** The added bar the last chord rings through. */
const RING = 4;

const SECOND_TIME: NoteEvent[] = [
	...ending(RING),
	...line("continuo", [[0, 2, 45, 2 + RING]], 0.55), // A2, half
];

// ── The parts ──────────────────────────────────────────────────────────────

const VIOLIN_I_PART: PartSpec = {
	voice: "strings",
	level: 0.34,
	glideS: 0.008,
	attackS: 0.09,
	releaseS: 0.5,
	cutoffHz: 1500,
	envAmount: 1.6,
	vibrato: 0.12,
	pan: -0.2,
	reverb: 0.45,
};

const PARTS: Readonly<Record<string, PartSpec>> = {
	violin1: VIOLIN_I_PART,
	grace: { ...VIOLIN_I_PART, glideS: 0, attackS: 0.02, releaseS: 0.1 },
	violin2: {
		voice: "strings",
		level: 0.16,
		attackS: 0.12,
		releaseS: 0.5,
		unison: 3,
		cutoffHz: 1100,
		envAmount: 1,
		vibrato: 0.08,
		pan: 0.25,
		reverb: 0.5,
	},
	viola: {
		voice: "strings",
		level: 0.16,
		attackS: 0.12,
		releaseS: 0.5,
		unison: 3,
		cutoffHz: 900,
		envAmount: 1,
		vibrato: 0.08,
		pan: -0.35,
		reverb: 0.5,
	},
	// Cellos and basses: a short, soft stroke on each eighth.
	continuo: {
		voice: "strings",
		level: 0.3,
		attackS: 0.04,
		releaseS: 0.3,
		cutoffHz: 600,
		envAmount: 1,
		index: 0.2,
		vibrato: 0,
		pan: 0.1,
		reverb: 0.35,
	},
};

export const BACH_AIR: Song = {
	name: "Air (BWV 1068)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "a", bars: 5, events: A_SECTION },
		{ name: "first-time", bars: 1, events: FIRST_TIME },
		{ name: "a-repeat", bars: 5, events: A_SECTION },
		{ name: "second-time", bars: 2, events: SECOND_TIME },
	],
	// Score bars: a 0–4, first-time 5, the repeat 6–10, second-time 11 and
	// its added bar 12.
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 11, bpm: BPM },
		{ bar: 12, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 3.5 },
};

/** Eleven bars steady, the second-time bar slowing linearly, the held bar. */
export const BACH_AIR_SECONDS =
	(11 * 4 * 60) / BPM +
	((4 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(RING * 60) / END_BPM;
