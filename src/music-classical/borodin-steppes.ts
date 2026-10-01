/**
 * Alexander Borodin, *In the Steppes of Central Asia* (*В средней Азии*, *Eine
 * Steppenskizze aus Mittel-Asien*, 1880): the opening, hand-encoded as note
 * data — a public-domain composition, synthesised at runtime, nothing
 * downloaded or recorded (#543 D2, on the map's Constraints).
 *
 * **Encoded from the full score as M. P. Belaieff, Leipzig, prints it**
 * (plate 220, a reprint of the first edition — Rahter, 1882, per #589's
 * brief; IMSLP #1043849): printed pages 4–5 (PDF pages 6–7), bars 1–43, up to
 * the bar before rehearsal letter A. The notes are Borodin's as that score
 * prints them, at sounding pitch: the clarinets in A a minor third below the
 * page, the horns in F a fifth below it.
 *
 * *Allegretto con moto*, 2/4, a quarter at 92 as printed, held throughout.
 *
 * - **The pedal** — violins I *divisi*, harmonics, pp: E6, and E7 on the solo
 *   desk written an octave down under *8va*, held from the first bar to the
 *   last.
 * - **Flute and oboe** — the E5 answering over the pedal in bars 2–3 and 4–5,
 *   the oboe's pp E5s through bars 29–40, and the flutes' A5–E6 fifths.
 * - **Clarinet I** (bars 5–17, *p cantabile*) — the Russian song, E5–D5–C♯5,
 *   to its held E5.
 * - **Horn I** (bars 17–28) — the same song, sounding in C: G4–F4–E4, to
 *   its held E4.
 * - **The caravan** (bars 28–40) — the cellos *pizz.* on the beat, A♯2–B2,
 *   B♯2–C♯3, and the violas an octave above on the off-beat eighths; then the
 *   cellos' A2 alone, under the violas' A3s.
 * - **The horns and clarinets' held fifths and octaves** — the horns' E3–E4
 *   under the caravan (horns III–IV, then I–II), the horns' A2 from bar 40,
 *   the clarinets' A4–E5 with the flutes; and in bars 42–43 the cadence the
 *   excerpt ends on: A3–E4 in the clarinets, A4–E5 in the flutes, A2 in the
 *   horns and cellos, under the pedal.
 *
 * **Reduced**: the two clarinets' unison and the four horns' octave doublings
 * are one part each; the violas' pizzicato doubles the cellos' at the octave
 * on the off-beat, so it is kept, but every string pizzicato is a short
 * bowed stroke rather than a pluck. Bar 44 is rehearsal A, where the cor
 * anglais' theme begins over new harmony; the excerpt stops before it, at the
 * held A–E fifth of bars 42–43, the last cadence before the new theme.
 * That makes the excerpt shorter than the 70–90 s the node asked for; the
 * tempo is left at the printed 92 rather than slowed to reach it.
 *
 * Imports only the score's types, the notation helpers and the Danube's horn
 * desk, so it is data.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** A quarter at 92, as printed. */
const BPM = 92;

/** Bars 1–43. */
const BARS = 43;

// Bars below are 0-based: score bar n is bar n − 1 here.

/** The violins' pedal, E6 and E7, restruck where the song passes to the
 *  horn and to the caravan so no one note lasts a minute. */
const PEDAL: NoteEvent[] = [
	...chord("pedal", 0, 0, [88, 100], 32, 0.35),
	...chord("pedal", 16, 0, [88, 100], 22, 0.35),
	...chord("pedal", 27, 0, [88, 100], 32, 0.4),
];

/** Clarinet I in A, sounding a minor third below the page (bars 5–17). */
export const CLARINET_SONG: readonly (readonly [
	number,
	number,
	number,
	number,
])[] = [
	[4, 0, 76, 1.5],
	[4, 1.5, 74, 0.25],
	[4, 1.75, 73, 0.25],
	[5, 0, 71, 1],
	[5, 1, 73, 1],
	[6, 0, 69, 1],
	[6, 1, 64, 1],
	[7, 0, 71, 1.5],
	[7, 1.5, 73, 0.25],
	[7, 1.75, 71, 0.25],
	[8, 0, 69, 1],
	[8, 1, 76, 1],
	[9, 0, 78, 1],
	[9, 1, 76, 1],
	[10, 0, 74, 1],
	[10, 1, 78, 1],
	[11, 0, 73, 2],
	[12, 0, 76, 10],
];

/** Horn I in F, sounding a fifth below the page (bars 17–28). */
export const HORN_SONG: readonly (readonly [number, number, number, number])[] =
	[
		[16, 0, 67, 1.5],
		[16, 1.5, 65, 0.25],
		[16, 1.75, 64, 0.25],
		[17, 0, 62, 1],
		[17, 1, 64, 1],
		[18, 0, 60, 1],
		[18, 1, 55, 1],
		[19, 0, 62, 1.5],
		[19, 1.5, 64, 0.25],
		[19, 1.75, 62, 0.25],
		[20, 0, 60, 1],
		[20, 1, 67, 1],
		[21, 0, 69, 1],
		[21, 1, 67, 1],
		[22, 0, 65, 1],
		[22, 1, 69, 1],
		[23, 0, 64, 8],
	];

/** Flute and oboe: the E5 over the pedal, half then quarter, and the oboe's
 *  pp answers under the caravan (bars 2–5, 29–40). */
const WINDS: NoteEvent[] = [
	...line(
		"winds",
		[
			[1, 0, 76, 2],
			[2, 0, 76, 1],
			[3, 0, 76, 2],
			[4, 0, 76, 1],
		],
		0.4,
	),
	...line(
		"winds",
		[
			[28, 0, 76, 2],
			[29, 0, 76, 1],
			[30, 0, 76, 2],
			[31, 0, 76, 1],
			[32, 0, 76, 2],
			[33, 0, 76, 1],
			[34, 0, 76, 2],
			[35, 0, 76, 1],
			[36, 0, 76, 6],
			[39, 0, 76, 1],
		],
		0.35,
	),
	// The flutes' fifths, pp, each held over two bars.
	...[29, 33, 39].flatMap((bar) => chord("winds", bar, 0, [81, 88], 4, 0.35)),
	...chord("winds", 41, 0, [69, 76], 4, 0.4),
];

/** The clarinets' fifths with the flutes, and the cadence an octave down. */
const CLARINETS: NoteEvent[] = [
	...[29, 33, 39].flatMap((bar) =>
		chord("clarinets", bar, 0, [69, 76], 4, 0.4),
	),
	...chord("clarinets", 41, 0, [57, 64], 4, 0.45),
];

/** The horns: E3–E4 held (III–IV bars 28–31, I–II 32–35, III–IV 36–39), then
 *  I–II on A2 from bar 40. */
const HORNS: NoteEvent[] = [
	...chord("horns", 27, 0, [52, 64], 8, 0.4),
	...chord("horns", 31, 0, [52, 64], 8, 0.4),
	...chord("horns", 35, 0, [52, 64], 8, 0.35),
	...line("horns", [[39, 0, 45, 8]], 0.45),
];

/** The cellos' walk, one pair of quarters a bar (bars 28–39). */
const WALK: readonly (readonly [number, number])[] = [
	[46, 47],
	[46, 47],
	[48, 49],
	[48, 49],
	[46, 47],
	[46, 47],
	[48, 49],
	[48, 49],
	[46, 47],
	[46, 50],
	[49, 48],
	[47, 46],
];

const CARAVAN: NoteEvent[] = [
	...WALK.flatMap(([a, b], i) => [
		...line(
			"cellos",
			[
				[27 + i, 0, a, 0.45],
				[27 + i, 1, b, 0.45],
			],
			0.6,
		),
		...line(
			"violas",
			[
				[27 + i, 0.5, a + 12, 0.25],
				[27 + i, 1.5, b + 12, 0.25],
			],
			0.5,
		),
	]),
	// Bars 40–43: the cellos' A2 on the first beat of bars 40 and 42, pp,
	// the violas' A3 off the beat throughout.
	...line(
		"cellos",
		[
			[39, 0, 45, 0.45],
			[41, 0, 45, 0.45],
		],
		0.5,
	),
	...[39, 40, 41, 42].flatMap((bar) =>
		line(
			"violas",
			[
				[bar, 0.5, 57, 0.25],
				[bar, 1.5, 57, 0.25],
			],
			0.4,
		),
	),
];

/** A pizzicato: a short stroke, the bow off the string. */
const PIZZ: PartSpec = {
	voice: "strings",
	level: 0.36,
	attackS: 0.01,
	decayS: 0.3,
	sustain: 0.2,
	releaseS: 0.25,
	cutoffHz: 900,
	envAmount: 1.2,
	index: 0.3,
	vibrato: 0,
	reverb: 0.4,
};

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The violins' harmonics: thin and still, high over everything.
	pedal: {
		voice: "strings",
		level: 0.1,
		attackS: 2,
		releaseS: 2,
		unison: 3,
		index: 0,
		cutoffHz: 3000,
		envAmount: 0.3,
		vibrato: 0.02,
		pan: -0.2,
		reverb: 0.6,
	},
	// Clarinet I's song, legato.
	clarinet: {
		voice: "flute",
		level: 0.36,
		attackS: 0.08,
		releaseS: 0.6,
		glideS: 0.02,
		index: 0.12,
		cutoffHz: 1400,
		pan: 0.15,
		reverb: 0.5,
	},
	// Horn I's song: the Danube's bowed horn desk.
	horn: { ...DANUBE_VOICINGS.orchestra.horn, level: 0.3, reverb: 0.55 },
	// Flute and oboe, soft.
	winds: {
		voice: "flute",
		level: 0.2,
		attackS: 0.2,
		releaseS: 0.8,
		index: 0.2,
		pan: 0.35,
		reverb: 0.55,
	},
	// The clarinets' held fifths.
	clarinets: {
		voice: "flute",
		level: 0.18,
		attackS: 0.25,
		releaseS: 0.8,
		index: 0.1,
		cutoffHz: 1200,
		pan: 0.2,
		reverb: 0.5,
	},
	// The horns' held octaves, bowed softly.
	horns: {
		voice: "strings",
		level: 0.18,
		attackS: 0.6,
		releaseS: 1.2,
		unison: 3,
		cutoffHz: 800,
		envAmount: 0.8,
		vibrato: 0.04,
		pan: -0.3,
		reverb: 0.55,
	},
	cellos: { ...PIZZ, pan: -0.1 },
	violas: { ...PIZZ, level: 0.24, cutoffHz: 1300, pan: 0.25 },
};

export const STEPPES: Song = {
	name: "In the Steppes of Central Asia",
	beatsPerBar: 2,
	parts: PARTS,
	sections: [
		{
			name: "steppes",
			bars: BARS,
			events: [
				...PEDAL,
				...line("clarinet", CLARINET_SONG, 0.55),
				...line("horn", HORN_SONG, 0.55),
				...WINDS,
				...CLARINETS,
				...HORNS,
				...CARAVAN,
			],
		},
	],
	tempo: [{ bar: 0, bpm: BPM }],
	space: { reverbS: 3.5 },
};

/** Bars 1–43, two quarters each at 92. */
export const STEPPES_SECONDS = (BARS * 2 * 60) / BPM;
