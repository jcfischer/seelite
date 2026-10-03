/**
 * Sergei Rachmaninoff, *Die Toteninsel* (*Isle of the Dead*), symphonic poem
 * after Böcklin, op. 29 (1909): the opening, hand-encoded as note data — a
 * public-domain composition, synthesised at runtime, nothing downloaded or
 * recorded (#543 D2, on the map's Constraints).
 *
 * **Encoded from the full score's first edition** (A. Gutheil, Moscow, A.
 * 9048 G., engraved and printed by Breitkopf & Härtel; IMSLP #249809):
 * printed pages 3–5 (PDF pages 5–7), bars 1–20 as printed, then one bar of
 * this arrangement's own — the A-minor half of the ostinato held under a
 * ritardando, so the excerpt ends on the tonic instead of the ostinato's
 * second chord. The notes are Rachmaninoff's as that score prints them, at
 * sounding pitch: the double basses and the contrabassoon an octave below the
 * page.
 *
 * *Lento*, a quarter at 60 as printed; the song counts **eighths** — 5/8 is
 * five beats a bar at 120 — so a quarter is two beats and a dotted quarter
 * three. The score beats the bar 2+3 (quarter, dotted quarter) and from
 * rehearsal 1 (bar 13) to bar 16 3+2; the notes below keep both groupings.
 *
 * - **The oars** — the timpani's A2–E2, the harp's A1–E2 and the low strings'
 *   A: bars 1–4 alone, *pp*, the harp's figure filling out to eighths.
 * - **The cellos' rising line** (bar 5 on, *sempre legato*, both desks in
 *   unison): A2–C3–B2–E3–A3, the harp playing its last four notes with it in
 *   bars 5–8; from bar 9 C3–E3–B2–E3–A3; at rehearsal 1 turning to F major
 *   (E3–C3–A2–F2–C2) and C major (G3–E3–C3–A2–E2); from bar 17 the
 *   2+3 figure C3/E3–A2, D3/F3–A2–E2.
 * - **The violas** (bar 11 on): D3–E3–A3 off the beat, then with the cellos'
 *   harmony.
 * - **The harp** from bar 9: the cellos' line doubled and filled with chords,
 *   over A2–E2–A1 in the left hand.
 * - **The low winds** — horns V–VI on E2–A2 (bass clef, old notation: a fourth
 *   above the page) and the contrabassoon's A1, held from bar 5.
 *
 * **Reduced**: the two cello desks are one part in bars 5–20 (they are in
 * unison), with the second desk's pizzicato kept in bars 1–4; the basses'
 * four desks are the first desk's arco chord, with the second desk's
 * pizzicato in bars 1–9. Left out: the bass clarinet (its A–B rocking under
 * bars 5–13, in bass clef, where the edition does not say whether it sounds a
 * second or a ninth below the page), the bassoons' line from bar 9, horns
 * I–IV's chords from bar 13, the second violins from bar 17 and the basses'
 * second desk from bar 10. The harp is re-voiced on short bowed strokes
 * rather than a pluck, which the principal heard as plinky.
 *
 * Imports only the score's types and the notation helpers, so it is data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** An eighth at 120: the printed quarter at 60. */
const BPM = 120;
/** The last bar's, reached over bar 20. */
const END_BPM = 96;

/** Bars 1–20 as printed, and the held bar. */
const BARS = 21;

// Bars below are 0-based: score bar n is bar n − 1 here. Beats are eighths.

const A1 = 33;
const C2 = 36;
const E2 = 40;
const F2 = 41;
const A2 = 45;
const B2 = 47;
const C3 = 48;
const D3 = 50;
const E3 = 52;
const F3 = 53;
const G3 = 55;
const A3 = 57;
const B3 = 59;
const C4 = 60;
const D4 = 62;
const E4 = 64;

const range = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The timpani, A2 and E2. */
const TIMPANI: NoteEvent[] = [
	// Bars 1–3: A2 a quarter, E2 a dotted quarter; bar 4 the E under an A.
	...range(0, 2).flatMap((bar) =>
		line(
			"timpani",
			[
				[bar, 0, A2, 2],
				[bar, 2, E2, 3],
			],
			0.4,
		),
	),
	...line("timpani", [[3, 0, A2, 2]], 0.4),
	...chord("timpani", 3, 2, [E2, A2], 3, 0.4),
	// Every bar from 5: two sixteenths and an eighth on A2.
	...range(4, 15).flatMap((bar) =>
		line(
			"timpani",
			[
				[bar, 0, A2, 0.5],
				[bar, 0.5, A2, 0.5],
				[bar, 1, A2, bar >= 12 ? 2 : 1],
			],
			0.4,
		),
	),
	// Bars 9–12: the A–E chord on the dotted quarter; bars 15–16 on the
	// quarter that closes the 3+2 bar.
	...range(8, 11).flatMap((bar) => chord("timpani", bar, 2, [E2, A2], 3, 0.4)),
	...[14, 15].flatMap((bar) => chord("timpani", bar, 3, [E2, A2], 2, 0.4)),
	// Bars 17–20, pp: A2, and E2 trilled through the dotted quarter.
	...range(16, 19).flatMap((bar) => [
		...line("timpani", [[bar, 0, A2, 1]], 0.35),
		...range(0, 5).flatMap((i) =>
			line("timpani", [[bar, 2 + i * 0.5, E2, 0.5]], 0.22),
		),
	]),
];

/** The harp's left hand. */
const HARP_LOW: NoteEvent[] = [
	...line(
		"harp",
		[
			[0, 0, A1, 2],
			[0, 2, E2, 3],
			...[1, 2].flatMap(
				(bar) =>
					[
						[bar, 0, A1, 2],
						[bar, 2, E2, 2],
						[bar, 4, A2, 1],
					] as const,
			),
			[3, 0, A1, 1],
			[3, 1, E2, 1],
			[3, 2, A2, 1],
			[3, 3, E2, 1],
			[3, 4, A1, 1],
		],
		0.45,
	),
	// Bars 5–12: A2–E2 on the first two eighths, A1 a quarter, E2.
	...range(4, 11).flatMap((bar) =>
		line(
			"harp",
			[
				[bar, 0, A2, 1],
				[bar, 1, E2, 1],
				[bar, 2, A1, 2],
				[bar, 4, E2, 1],
			],
			0.4,
		),
	),
	// Rehearsal 1, 3+2: A2–E2–A1, then C2–F2 (bars 13–14) and A1–E2 (15–16).
	...range(12, 15).flatMap((bar) =>
		line(
			"harp",
			[
				[bar, 0, A2, 1],
				[bar, 1, E2, 1],
				[bar, 2, A1, 1],
				[bar, 3, bar < 14 ? C2 : A1, 1],
				[bar, 4, bar < 14 ? F2 : E2, 1],
			],
			0.4,
		),
	),
	// Bars 17–20, 2+3: A2 a quarter, A1–E2 a dotted quarter.
	...range(16, 19).flatMap((bar) => [
		...line("harp", [[bar, 0, A2, 2]], 0.4),
		...chord("harp", bar, 2, [A1, E2], 3, 0.4),
	]),
];

/** The harp's right hand, from bar 5. */
const HARP_HIGH: NoteEvent[] = [
	// Bars 5–8: an eighth's rest, then C3–B2–E3–A3.
	...range(4, 7).flatMap((bar) =>
		line(
			"harp",
			[
				[bar, 1, C3, 1],
				[bar, 2, B2, 1],
				[bar, 3, E3, 1],
				[bar, 4, A3, 1],
			],
			0.4,
		),
	),
	// Bars 9–12: C3–E3, B2 (with D3 from bar 11)–E3–A3.
	...range(8, 11).flatMap((bar) => [
		...line(
			"harp",
			[
				[bar, 0, C3, 1],
				[bar, 1, E3, 1],
				[bar, 3, E3, 1],
				[bar, 4, A3, 1],
			],
			0.4,
		),
		...chord("harp", bar, 2, bar < 10 ? [B2] : [B2, D3], 1, 0.4),
	]),
	// Bars 13–14: C3/E3–A3–C4, C3/F3–A3. Bars 15–16: E3/G3–C4–E4, E3/A3–C4.
	...range(12, 15).flatMap((bar) => {
		const f = bar < 14;
		return [
			...chord("harp", bar, 0, f ? [C3, E3] : [E3, G3], 1, 0.45),
			...line(
				"harp",
				[
					[bar, 1, f ? A3 : C4, 1],
					[bar, 2, f ? C4 : E4, 1],
					[bar, 4, f ? A3 : C4, 1],
				],
				0.45,
			),
			...chord("harp", bar, 3, f ? [C3, F3] : [E3, A3], 1, 0.45),
		];
	}),
	// Bars 17–20: a chord and a note, then the dotted chord.
	...(
		[
			[16, [C3, A3], C4, [D3, B3]],
			[17, [E3, C4], E4, [D3, B3]],
			[18, [E3, C4], E4, [F3, D4]],
			[19, [E3, C4], E4, [D3, B3]],
		] as const
	).flatMap(([bar, first, second, held]) => [
		...chord("harp", bar, 0, first, 1, 0.4),
		...line("harp", [[bar, 1, second, 1]], 0.4),
		...chord("harp", bar, 2, held, 3, 0.4),
	]),
];

/** The cellos' line, one eighth a note (bars 5–20). */
const CELLO_BARS: readonly (readonly number[])[] = [
	...Array<readonly number[]>(4).fill([A2, C3, B2, E3, A3]),
	...Array<readonly number[]>(4).fill([C3, E3, B2, E3, A3]),
	[E3, C3, A2, F2, C2],
	[E3, C3, A2, F2, C2],
	[G3, E3, C3, A2, E2],
	[G3, E3, C3, A2, E2],
	[C3, A2, D3, A2, E2],
	[E3, A2, D3, A2, E2],
	[E3, A2, F3, A2, E2],
	[E3, A2, D3, A2, E2],
];

export const CELLO_LINE: readonly (readonly [
	number,
	number,
	number,
	number,
])[] = CELLO_BARS.flatMap((notes, i) =>
	notes.map((pitch, beat) => [4 + i, beat, pitch, 1] as const),
);

const CELLOS: NoteEvent[] = [
	// Bars 1–4: the first desk's E2, arco, tied over each bar line; the A–E
	// fifth on the fourth bar's dotted quarter.
	...line(
		"cellos",
		[
			[0, 2, E2, 5],
			[1, 2, E2, 5],
			[2, 2, E2, 5],
		],
		0.4,
	),
	...chord("cellos", 3, 2, [E2, A2], 3, 0.4),
	...line("cellos", CELLO_LINE, 0.5),
	// The second desk's pizzicato under bars 1–4.
	...range(0, 2).flatMap((bar) => line("pizz", [[bar, 2, E2, 0.5]], 0.45)),
	...chord("pizz", 3, 2, [E2, A2], 0.5, 0.45),
];

/** The violas, from bar 11. */
const VIOLAS: NoteEvent[] = [
	...[10, 11].flatMap((bar) =>
		line(
			"violas",
			[
				[bar, 2, D3, 1],
				[bar, 3, E3, 1],
				[bar, 4, A3, 1],
			],
			0.4,
		),
	),
	...range(12, 19).flatMap((bar) => {
		const notes =
			bar < 14
				? [E3, A3, C4, F3, A3]
				: bar < 16
					? [G3, C4, E4, A3, C4]
					: [A3, C4, A3, E3, E4];
		return notes.map((pitch, beat) => ({
			part: "violas",
			bar,
			beat,
			dur: 1,
			pitch,
			vel: 0.4,
		}));
	}),
];

/** The basses, sounding an octave below the page. */
const BASSES: NoteEvent[] = [
	// The first desk, arco: A held (bars 1–4), A–E held (5–8).
	...range(0, 3).flatMap((bar) => line("basses", [[bar, 0, A1, 5]], 0.45)),
	...range(4, 7).flatMap((bar) => chord("basses", bar, 0, [A1, E2], 5, 0.45)),
	// Bars 9–12: A–E a quarter, E–A a dotted quarter.
	...range(8, 11).flatMap((bar) => [
		...chord("basses", bar, 0, [A1, E2], 2, 0.45),
		...chord("basses", bar, 2, [E2, A2], 3, 0.45),
	]),
	// Rehearsal 1: A–E a dotted quarter, then C–A (bars 13–14), E–C (15–16).
	...range(12, 15).flatMap((bar) => [
		...chord("basses", bar, 0, [A1, E2], 3, 0.45),
		...chord("basses", bar, 3, bar < 14 ? [C2, A2] : [E2, C3], 2, 0.5),
	]),
	// Bars 17–20, pizz.: E–A on the dotted quarter.
	...range(16, 19).flatMap((bar) => chord("pizz", bar, 2, [E2, A2], 0.5, 0.45)),
	// The second desk's pizzicato on the first beat, bars 1–9.
	...range(0, 3).flatMap((bar) => line("pizz", [[bar, 0, A1, 0.5]], 0.45)),
	...range(4, 8).flatMap((bar) => chord("pizz", bar, 0, [A1, E2], 0.5, 0.45)),
];

/** Horns V–VI (bars 5–12) and the contrabassoon (bars 5–17), tied over
 *  every bar line, so each is one long note. */
const LOW_WINDS: NoteEvent[] = [
	...chord("winds", 4, 0, [E2, A2], 8 * 5, 0.4),
	...line("winds", [[4, 0, A1, 12 * 5 + 1]], 0.4),
];

/** Bar 21, this arrangement's: the ostinato's A-minor half, held. */
const HELD: NoteEvent[] = [
	...chord("harp", 20, 0, [A1, E2], 5, 0.35),
	...chord("harp", 20, 0, [E3, C4], 5, 0.3),
	...line("cellos", [[20, 0, A2, 5]], 0.4),
	...line("violas", [[20, 0, A3, 5]], 0.35),
	...chord("basses", 20, 0, [A1, E2], 5, 0.4),
	...line("timpani", [[20, 0, A2, 1]], 0.3),
];

/** A short bowed stroke with a ring: the harp and the pizzicati. */
const STROKE: PartSpec = {
	voice: "strings",
	level: 0.3,
	attackS: 0.01,
	decayS: 0.8,
	sustain: 0.15,
	releaseS: 0.6,
	cutoffHz: 1200,
	envAmount: 1,
	index: 0.2,
	vibrato: 0,
	reverb: 0.55,
};

const PARTS: Readonly<Record<string, PartSpec>> = {
	harp: { ...STROKE, pan: 0.3 },
	pizz: { ...STROKE, level: 0.24, cutoffHz: 700, releaseS: 0.35, pan: -0.2 },
	// The cellos: the line, legato and dark, muted.
	cellos: {
		voice: "strings",
		level: 0.36,
		attackS: 0.12,
		releaseS: 0.6,
		glideS: 0.02,
		unison: 3,
		cutoffHz: 850,
		envAmount: 1,
		vibrato: 0.08,
		pan: -0.25,
		reverb: 0.5,
	},
	violas: {
		voice: "strings",
		level: 0.24,
		attackS: 0.12,
		releaseS: 0.6,
		glideS: 0.02,
		unison: 3,
		cutoffHz: 1000,
		envAmount: 1,
		vibrato: 0.08,
		pan: 0.15,
		reverb: 0.5,
	},
	basses: {
		voice: "strings",
		level: 0.34,
		attackS: 0.4,
		releaseS: 1,
		unison: 3,
		cutoffHz: 500,
		envAmount: 0.8,
		vibrato: 0.04,
		pan: -0.1,
		reverb: 0.45,
	},
	// Horns V–VI and the contrabassoon: a soft organ-like bed.
	winds: {
		voice: "drone",
		level: 0.16,
		attackS: 0.8,
		releaseS: 1.5,
		detune: 0.06,
		drift: 4,
		spread: 0.6,
		pan: 0.05,
		reverb: 0.5,
	},
	// The timpani: a low sine that drops into its pitch.
	timpani: { voice: "tone", level: 0.28, pan: 0, reverb: 0.4 },
};

export const ISLE_OF_THE_DEAD: Song = {
	name: "Die Toteninsel",
	beatsPerBar: 5,
	parts: PARTS,
	sections: [
		{
			name: "oars",
			bars: BARS,
			events: [
				...TIMPANI,
				...HARP_LOW,
				...HARP_HIGH,
				...CELLOS,
				...VIOLAS,
				...BASSES,
				...LOW_WINDS,
				...HELD,
			],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 19, bpm: BPM },
		{ bar: 20, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4.5 },
};

/**
 * The excerpt's length: 19 bars of five eighths at 120; bar 20 on the ramp to
 * 96, whose five beats take `5·60/(120−96) × ln(120/96)` s; the held bar at 96.
 */
export const ISLE_OF_THE_DEAD_SECONDS =
	(19 * 5 * 60) / BPM +
	((5 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(5 * 60) / END_BPM;
