/**
 * Camille Saint-Saëns, *Le carnaval des animaux* (1886), VII. *Aquarium*: the
 * opening, hand-encoded as note data — a public-domain composition,
 * synthesised at runtime, nothing downloaded or recorded (#543 D2, on the
 * map's Constraints).
 *
 * **Encoded from the full score as Durand prints it** (Paris, 1922, D. & F.
 * 10,154; IMSLP #576538): printed pages 17–19 (PDF pages 25–27), bars 1–12
 * as printed, then one bar of this arrangement's own — the downbeat of bar 13,
 * where the theme returns in A minor, held, so the excerpt ends on the tonic.
 * The notes are Saint-Saëns's as that score prints them, at sounding pitch:
 * piano I's right hand under its *8va* brackets an octave above the page.
 *
 * *Andantino*, 4/4, with no metronome mark; a quarter at 66 is this file's
 * reading of it, broadened to 54 over bar 12. The whole movement runs over
 * PDF pages 25–32, about 44 bars by an eye count of a low-resolution pass —
 * some 160 s at 66, over the 100 s a set-piece may run — so the excerpt
 * stops at the first return of the theme.
 *
 * - **The flute** — the theme, E5–D♯5–E5–D5 | E5–A4, twice, then the
 *   sequence to the half cadence on B4 (bars 1–8).
 * - **The glass harmonica** (*Harm.*) — the theme an octave up on the
 *   off-beat eighths.
 * - **The strings, *con sordino*** — violins I an octave above the flute,
 *   violins II and violas in octaves under it, the cellos' A3 and the chromatic
 *   bass of bars 5–8; then in bars 9–12, the interlude, the E pedal: the
 *   cellos' E2, the violas' E3, the second violins' syncopated E4, and the
 *   first violins' E5–E6 into the return.
 * - **Piano I, right hand** — the rippling figure, six (or five) notes
 *   falling from each beat, an octave above the page.
 *
 * **Reduced**: piano I's left hand (the figure's continuation into the middle
 * register) and all of piano II (the rising arpeggio under it) are left out:
 * both spell the same chord as piano I's right hand, and the polyphony budget
 * is better spent on the strings. In bars 9–12 both pianos' chromatic
 * sixteenth-note runs are left out, since they could not be read note by note
 * with certainty off this scan, so the interlude is the string pedal alone.
 * The violas' tied-eighth syncopation there is one held E3 a bar.
 *
 * **Re-spaced**: the page beams piano I's six right-hand notes and four
 * left-hand notes as one figure of ten to the beat. With the left hand left
 * out, the right hand's notes are spread a sixth of a beat apart, so the
 * figure fills its beat instead of stopping six-tenths of the way through.
 * Where a figure shows five heads (the D♯ and diminished figures, bars 6–7's
 * A7, A minor, B7 and E7), five are played and the sixth slot is left empty
 * rather than filled in.
 *
 * **Voices**: the pianos on a soft, short `keys` — the figure is idiomatic
 * piano glitter, and a bowed or blown re-voicing would smear sixth-of-a-beat
 * notes into a wash — and the glass harmonica on a quiet `fm` bell. Everything
 * else is bowed, the strings muted (dark, slow), and the flute on `flute`.
 *
 * Imports only the score's types and the notation helpers, so it is data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { line } from "./notation";

/** A quarter at 66, broadened to 54 over bar 12 into the held bar. */
const BPM = 66;
const END_BPM = 54;

/** Bars 1–12 as printed, and the held bar. */
const BARS = 13;

// Bars below are 0-based: score bar n is bar n − 1 here.

/** Piano I's right hand, one figure a beat, as the page writes it (an 8va
 *  bracket over each: `RH` adds the octave). */
const FIG = {
	am: [84, 88, 84, 83, 81, 76], // C6 E6 C6 B5 A5 E5, written
	fr: [83, 87, 83, 81, 75], // B5 D♯6 B5 A5 D♯5
	bd: [83, 86, 83, 81, 74], // B5 D6 B5 A5 D5
	dm: [77, 81, 77, 76, 74, 69], // F5 A5 F5 E5 D5 A4
	dM: [78, 81, 78, 76, 74, 69], // F♯5 A5 F♯5 E5 D5 A4
	fm: [84, 89, 84, 82, 80, 77], // C6 F6 C6 B♭5 A♭5 F5
	g: [83, 86, 83, 81, 79, 74], // B5 D6 B5 A5 G5 D5
	a7: [81, 85, 81, 79, 73], // A5 C♯6 A5 G5 C♯5
	e7a: [83, 88, 83, 81, 80, 76], // B5 E6 B5 A5 G♯5 E5
	am2: [81, 84, 81, 76, 72], // A5 C6 A5 E5 C5
	b7: [81, 83, 81, 75, 71], // A5 B5 A5 D♯5 B4
	e7b: [83, 86, 83, 80, 76], // B5 D6 B5 G♯5 E5
	e: [80, 83, 80, 78, 76, 71], // G♯5 B5 G♯5 F♯5 E5 B4
} as const;
type Fig = keyof typeof FIG;

/** Which figure each beat of bars 1–8 plays. */
const FIGURES: readonly (readonly [Fig, Fig, Fig, Fig])[] = [
	["am", "fr", "am", "bd"],
	["am", "dm", "dm", "dm"],
	["am", "fr", "am", "bd"],
	["am", "dM", "dM", "dM"],
	["am", "fr", "am", "fm"],
	["g", "a7", "g", "e7a"],
	["am2", "b7", "am2", "e7b"],
	["e", "e", "e", "e"],
];

/** A figure on one beat: a sixth of a beat a note, sounding an octave up. */
const figure = (bar: number, beat: number, f: Fig, vel: number): NoteEvent[] =>
	FIG[f].map((written, i) => ({
		part: "piano",
		bar,
		beat: beat + i / 6,
		dur: 0.2,
		pitch: written + 12,
		vel,
	}));

const PIANO: NoteEvent[] = [
	...FIGURES.flatMap((beats, bar) =>
		beats.flatMap((f, beat) =>
			figure(bar, beat, f, bar === 3 && beat === 1 ? 0.5 : 0.38),
		),
	),
	// The held bar: the return's first figure.
	...figure(12, 0, "am", 0.34),
];

/** The flute's theme (bars 1–8). */
export const FLUTE_THEME: readonly (readonly [
	number,
	number,
	number,
	number,
])[] = [
	[0, 0, 76, 1],
	[0, 1, 75, 1],
	[0, 2, 76, 1],
	[0, 3, 74, 1],
	[1, 0, 76, 1],
	[1, 1, 69, 2.5],
	[2, 0, 76, 1],
	[2, 1, 75, 1],
	[2, 2, 76, 1],
	[2, 3, 74, 1],
	[3, 0, 76, 1],
	[3, 1, 69, 2.5],
	[4, 0, 76, 1],
	[4, 1, 75, 1],
	[4, 2, 76, 1],
	[4, 3, 77, 1],
	[5, 0, 74, 1],
	[5, 1, 73, 1],
	[5, 2, 74, 1],
	[5, 3, 76, 1],
	[6, 0, 72, 1],
	[6, 1, 71, 1],
	[6, 2, 72, 1],
	[6, 3, 74, 1],
	[7, 0, 71, 4],
	[12, 0, 76, 4],
];

/** Four quarters in a bar. */
const quarters = (
	bar: number,
	pitches: readonly [number, number, number, number],
): (readonly [number, number, number, number])[] =>
	pitches.map((p, beat) => [bar, beat, p, 1] as const);

/** The glass harmonica: an eighth on each off-beat. */
const offbeats = (bar: number, pitches: readonly number[]) =>
	pitches.map((p, i) => [bar, i + 0.5, p, 0.5] as const);

const HARMONICA: NoteEvent[] = line(
	"harmonica",
	[
		...offbeats(0, [88, 87, 88, 86]),
		...offbeats(1, [88, 81]),
		...offbeats(2, [88, 87, 88, 86]),
		...offbeats(3, [88, 81]),
		...offbeats(4, [88, 87, 88, 89]),
		...offbeats(5, [86, 85, 86, 88]),
		...offbeats(6, [84, 83, 84, 88]),
		// Bar 8: quarter rests, and B5 on the second and fourth beats.
		[7, 1, 83, 1],
		[7, 3, 83, 1],
	],
	0.4,
);

const VIOLINS_I: NoteEvent[] = line(
	"violins",
	[
		...quarters(0, [88, 87, 88, 86]),
		[1, 0, 88, 1],
		[1, 1, 81, 3],
		...quarters(2, [88, 87, 88, 86]),
		[3, 0, 88, 1],
		[3, 1, 81, 3],
		...quarters(4, [88, 87, 88, 89]),
		...quarters(5, [86, 85, 86, 88]),
		...quarters(6, [84, 83, 84, 86]),
		[7, 0, 83, 4],
		// Bar 12: E5, then E6 into the return.
		[11, 1, 76, 1],
		[11, 2, 88, 2],
		[12, 0, 88, 4],
	],
	0.4,
);

const VIOLINS_II: NoteEvent[] = [
	...line(
		"inner",
		[
			...quarters(0, [84, 83, 84, 83]),
			[1, 0, 84, 1],
			[1, 1, 81, 3],
			...quarters(2, [84, 83, 84, 83]),
			[3, 0, 84, 1],
			[3, 1, 78, 3],
			...quarters(4, [76, 75, 76, 77]),
			...quarters(5, [74, 73, 74, 76]),
			...quarters(6, [72, 71, 72, 74]),
			[7, 0, 71, 4],
			[12, 0, 84, 4],
		],
		0.36,
	),
	// Bars 9–12: E4 syncopated — a half on the second beat, a quarter on the
	// fourth tied over the bar line.
	...line(
		"inner",
		[8, 9, 10, 11].flatMap((bar) =>
			bar < 11
				? [[bar, 1, 64, 2] as const, [bar, 3, 64, 2] as const]
				: [[bar, 1, 64, 2] as const],
		),
		0.3,
	),
];

const VIOLAS: NoteEvent[] = line(
	"violas",
	[
		...quarters(0, [64, 65, 64, 65]),
		[1, 0, 64, 1],
		[1, 1, 64, 3],
		...quarters(2, [64, 65, 64, 64]),
		[3, 0, 64, 1],
		[3, 1, 66, 3],
		...quarters(4, [64, 63, 64, 65]),
		...quarters(5, [62, 61, 62, 64]),
		...quarters(6, [60, 59, 60, 62]),
		[7, 0, 59, 4],
		// Bars 9–12: the E3 pedal, one held note a bar.
		[8, 0, 52, 4],
		[9, 0, 52, 4],
		[10, 0, 52, 4],
		[11, 0, 52, 3],
		[12, 0, 64, 4],
	],
	0.32,
);

const CELLOS: NoteEvent[] = line(
	"cellos",
	[
		// A3 tied from bar 1 through bar 5's dotted half.
		[0, 0, 57, 19],
		[4, 3, 56, 1],
		[5, 0, 55, 3],
		[5, 3, 52, 1],
		[6, 0, 57, 3],
		// E3 tied into bar 8's whole note.
		[6, 3, 52, 5],
		// Bars 9–12: E2 tied through the first half of bar 12.
		[8, 0, 40, 14],
		[12, 0, 57, 4],
	],
	0.4,
);

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Piano I: a soft, short key, its partials a little stretched toward glass.
	piano: {
		voice: "keys",
		level: 0.2,
		attackS: 0.005,
		decayS: 0.6,
		sustain: 0,
		releaseS: 0.25,
		ratio: 1.002,
		index: 0.35,
		pan: 0.2,
		reverb: 0.5,
	},
	// The glass harmonica: a quiet bell.
	harmonica: {
		voice: "fm",
		level: 0.12,
		attackS: 0.02,
		decayS: 1.2,
		sustain: 0.2,
		releaseS: 0.6,
		ratio: 3.5,
		index: 0.8,
		indexDecayS: 0.5,
		pan: 0.35,
		reverb: 0.6,
	},
	flute: {
		voice: "flute",
		level: 0.32,
		attackS: 0.08,
		releaseS: 0.6,
		glideS: 0.02,
		index: 0.15,
		pan: -0.1,
		reverb: 0.5,
	},
	// The strings are muted: slow in, dark.
	violins: {
		voice: "strings",
		level: 0.24,
		attackS: 0.15,
		releaseS: 0.7,
		glideS: 0.02,
		unison: 3,
		cutoffHz: 1500,
		envAmount: 0.8,
		vibrato: 0.08,
		pan: -0.3,
		reverb: 0.55,
	},
	inner: {
		voice: "strings",
		level: 0.2,
		attackS: 0.15,
		releaseS: 0.7,
		glideS: 0.02,
		unison: 3,
		cutoffHz: 1200,
		envAmount: 0.8,
		vibrato: 0.08,
		pan: -0.1,
		reverb: 0.55,
	},
	violas: {
		voice: "strings",
		level: 0.2,
		attackS: 0.15,
		releaseS: 0.7,
		glideS: 0.02,
		unison: 3,
		cutoffHz: 1000,
		envAmount: 0.8,
		vibrato: 0.08,
		pan: 0.1,
		reverb: 0.55,
	},
	cellos: {
		voice: "strings",
		level: 0.3,
		attackS: 0.4,
		releaseS: 1,
		unison: 3,
		cutoffHz: 700,
		envAmount: 0.8,
		vibrato: 0.05,
		pan: 0.25,
		reverb: 0.5,
	},
};

export const AQUARIUM: Song = {
	name: "Aquarium",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "aquarium",
			bars: BARS,
			events: [
				...PIANO,
				...line("flute", FLUTE_THEME, 0.45),
				...HARMONICA,
				...VIOLINS_I,
				...VIOLINS_II,
				...VIOLAS,
				...CELLOS,
			],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 11, bpm: BPM },
		{ bar: 12, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 3.5 },
};

/**
 * The excerpt's length: 11 bars at 66; bar 12 on the ramp to 54, whose four
 * beats take `4·60/(66−54) × ln(66/54)` s; the held bar at 54.
 */
export const AQUARIUM_SECONDS =
	(11 * 4 * 60) / BPM +
	((4 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(4 * 60) / END_BPM;
