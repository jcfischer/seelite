/**
 * Gustav Holst, *The Planets*, op. 32 (1914–16), V. *Saturn, the Bringer of
 * Old Age*: the opening, hand-encoded as note data — a public-domain
 * composition, synthesised at runtime, nothing downloaded or recorded (#543
 * D2, on the map's Constraints).
 *
 * **Encoded from the full score's first edition** (Goodwin & Tabb, London,
 * 1921, printed by arrangement with Boosey & Hawkes, B. & H. 15970; IMSLP
 * #15437): printed pages 113–114, bars 1–17 as printed, then one bar of this
 * arrangement's own — the ostinato's second chord and the oboe's last note
 * held under a ritardando, so the excerpt ends on a held chord instead of
 * stopping mid-pulse. The notes are Holst's as that score prints them, at
 * sounding pitch.
 *
 * - **The ostinato** — flutes I–II and the bass flute in G (sounding a
 *   fourth below the page), doubled by both harps in harmonics (sounding an
 *   octave above the page, at the flutes' pitches): A3–F4–B4 for two beats,
 *   G3–E♭4–A♭4 for two, the second tied over each bar line.
 * - **The double basses** (sounding an octave below the page): F held from
 *   bar 4, the B–C step up and back in bars 5–7, then *div.* in octaves in
 *   bars 8–11.
 * - **Violins I, II and violas in unison** (bars 11–15): B3 held pp to the
 *   swell, the C4 step at f, and back to B3.
 * - **Oboe I** (bars 16–17): C5–D5, D5–C5.
 *
 * **Reduced**: the harps are left out — every note they play is a flute
 * note in harmonics, and the synth's bell voices are the ones the principal
 * heard as plinky; the bassoons' staff is only a cue for the bass flute. The
 * violas' unison with the violins is one part. The cellos, which enter in
 * bar 17 in tenor clef, are left out: their phrase belongs to page 115.
 *
 * **Tempo**: the score prints *Adagio* with no metronome mark; a quarter at
 * 60 is this file's reading of it, held to bar 15 and broadened to 44 over
 * the last three bars.
 *
 * Imports only the score's types and the notation helpers, so it is data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** The ostinato's two chords, sounding: flutes over the bass flute. */
const CHORD_A = [57, 65, 71];
const CHORD_B = [55, 63, 68];

/** Score bars 1–17 as printed, then the held bar. */
const BARS = 18;

/** Every bar: quarter rest (bar 1) or the tie in, chord A on beat 2, chord
 *  B on beat 4 tied into the next bar. The last B is held through the
 *  final bar. */
const OSTINATO: NoteEvent[] = Array.from({ length: BARS - 1 }, (_, bar) => {
	const last = bar === BARS - 2;
	const vel = 0.5;
	return [
		...chord("flutes", bar, 1, CHORD_A.slice(1), 2, vel),
		...line("bassFlute", [[bar, 1, CHORD_A[0], 2]], vel),
		...chord("flutes", bar, 3, CHORD_B.slice(1), last ? 5 : 2, vel),
		...line("bassFlute", [[bar, 3, CHORD_B[0], last ? 5 : 2]], vel),
	];
}).flat();

/** The double basses, sounding an octave below the page. */
const BASSES: NoteEvent[] = [
	// Bars 4–7: F, the B–C step, B held and let go.
	...line(
		"basses",
		[
			[3, 0, 29, 6],
			[4, 2, 35, 1.5],
			[4, 3.5, 36, 0.5],
			[5, 0, 36, 2],
			[5, 2, 35, 4],
			[6, 2, 35, 0.5],
		],
		0.55,
	),
	// Bars 8–12, div. in octaves: the same step, then F held, then B.
	...chord("basses", 7, 0, [29, 41], 2, 0.55),
	...chord("basses", 7, 2, [35, 47], 1.5, 0.55),
	...chord("basses", 7, 3.5, [36, 48], 0.5, 0.55),
	...chord("basses", 8, 0, [36, 48], 2, 0.5),
	...chord("basses", 8, 2, [35, 47], 2, 0.45),
	...chord("basses", 9, 0, [41, 53], 3.5, 0.5),
	...chord("basses", 9, 3.5, [41, 53], 0.5, 0.5),
	...line("basses", [[10, 0, 47, 4.5]], 0.45),
];

/** Violins I, II and violas in unison: pp, cresc. to f on the C, dim. */
const STRINGS: NoteEvent[] = [
	...line("strings", [[10, 0, 59, 11.5]], 0.4),
	...line("strings", [[12, 3.5, 60, 4.5]], 0.75),
	...line("strings", [[14, 0, 59, 3.5]], 0.5),
];

/** Oboe I, pp: its last C held through the final bar. */
const OBOE: NoteEvent[] = line(
	"oboe",
	[
		[15, 0, 72, 3.5],
		[15, 3.5, 74, 0.5],
		[16, 0, 74, 2],
		[16, 2, 72, 6],
	],
	0.45,
);

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Flutes I–II: the two upper notes of each chord, even and breathy.
	flutes: {
		voice: "flute",
		level: 0.26,
		attackS: 0.12,
		releaseS: 0.5,
		index: 0.2,
		pan: 0.25,
		reverb: 0.5,
	},
	// The bass flute: the chord's lowest note, a little darker.
	bassFlute: {
		voice: "flute",
		level: 0.24,
		attackS: 0.14,
		releaseS: 0.5,
		index: 0.25,
		cutoffHz: 1400,
		pan: -0.15,
		reverb: 0.5,
	},
	// Double basses: slow bows, low and dark.
	basses: {
		voice: "strings",
		level: 0.4,
		attackS: 0.5,
		releaseS: 1.2,
		unison: 3,
		cutoffHz: 700,
		envAmount: 1,
		vibrato: 0.05,
		pan: -0.1,
		reverb: 0.45,
	},
	// Violins and violas in unison: a slow swell.
	strings: {
		voice: "strings",
		level: 0.3,
		attackS: 0.9,
		releaseS: 1.5,
		unison: 4,
		cutoffHz: 1300,
		envAmount: 1.4,
		vibrato: 0.08,
		pan: 0.1,
		reverb: 0.55,
	},
	// Oboe I: the flute voice, its own desk to the right.
	oboe: {
		voice: "flute",
		level: 0.3,
		attackS: 0.08,
		releaseS: 0.8,
		glideS: 0.02,
		index: 0.15,
		pan: 0.35,
		reverb: 0.5,
	},
};

/** A quarter at 60 to bar 15, broadened to 44 over bars 16–17. */
const BPM = 60;
const END_BPM = 44;

export const SATURN: Song = {
	name: "Saturn, the Bringer of Old Age",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "opening",
			bars: BARS,
			events: [...OSTINATO, ...BASSES, ...STRINGS, ...OBOE],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 15, bpm: BPM },
		{ bar: 17, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4 },
};

/**
 * The excerpt's length: 15 bars at 60; bars 16–17 on the ramp, whose eight
 * beats take `60/2 × ln(60/44)` s with the tempo falling 2 bpm a beat; the
 * last bar at 44.
 */
export const SATURN_SECONDS =
	(15 * 4 * 60) / BPM +
	((8 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(4 * 60) / END_BPM;
