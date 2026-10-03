/**
 * Anton Bruckner, Symphony No. 7 in E major (1883), II. *Adagio*: the
 * opening phrase, hand-encoded as note data — a public-domain composition,
 * synthesised at runtime, nothing downloaded or recorded (#543 D2, on the
 * map's Constraints).
 *
 * **Encoded from the first edition's full score** (Albert J. Gutmann, Wien,
 * 1885; IMSLP #26842): printed page 33, bars 1–7 and the downbeat of bar 8,
 * then that downbeat held as this arrangement's own last bar — the phrase
 * closes there on A major and the violins' next phrase (*zart*) begins, so the
 * excerpt stops on the chord instead of running on into it. C♯ minor, C
 * time, *Sehr feierlich und langsam* (M. ♪ = 63). At sounding pitch: the
 * double basses an octave below the page.
 *
 * - **The theme** (bars 1–3): the violas, *hervortretend* — C♯4–G♯3,
 *   F𝄪3–A♯3–C♯4–D♯4, G♯3 held and falling, C♯4–E3–C♯4 and the turn up to
 *   D♯4 — then the first violins on the G string (bars 4–7): E4–F♯4, the
 *   dotted G♯4 twice, *sehr markirt* the run down from C♯5, and the phrase
 *   falling to A3–B3 into bar 8's C♯4.
 * - **The chorale** (bars 1–3): voiced on the Danube's horn desk from the
 *   cellos' divisi chords as the page prints them (the principal rejected
 *   the synth's brass). The Wagner tubas' own staves are not read: their
 *   transposition in this edition is not certain enough to trust, so the
 *   chorale's pitches are the strings'. Bar 7's chords are the trombones'
 *   (alto and bass clef, non-transposing).
 * - **The bass**: the double basses, C♯ through B♯–B, A–F♯, G♯–C♯–B,
 *   E–D♯–D, C♯, F♯–D, to A; the cellos double them an octave above from
 *   bar 4, as printed.
 *
 * **Reduced**: violas and violins II from bar 4, the horns, and the tubas'
 * doublings are left out; the cellos' bar 4 chord keeps its bass line only;
 * the cellos' eighths under bar 3's second half are left out.
 *
 * **Grid and tempo**: four quarter-note beats a bar; ♪ = 63 is a quarter at
 * 31.5. The held last bar is at 28, this arrangement's broadening.
 *
 * **Read, and not certain**: bar 1's second cello chord reads E3–A2 (with a
 * natural) over B1, against the violas' A♯3 on the same beat; bar 6's two
 * sixteenths after the dotted G♯4 read as A4–B4 (the first carries a natural
 * that could belong to G); the second half of bar 7's trombone chord.
 *
 * Imports only the score's types, the notation helpers and the Danube's
 * horn desk, so it is data.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** Bars 1–7, and bar 8's downbeat held. */
const BARS = 8;

/** Loudness by bar: p cresc., dim. in bar 3, mf, cresc., sehr markirt,
 *  p dim., and the held close. */
const dyn = (bar: number) =>
	[0.5, 0.6, 0.5, 0.65, 0.72, 0.85, 0.55, 0.45][bar] ?? 0.5;

/** The violas, bars 1–3, hervortretend. */
const VIOLAS: NoteEvent[] = line(
	"viola",
	[
		[0, 0, 61, 1.5],
		[0, 1.5, 56, 0.5],
		[0, 2, 55, 0.75],
		[0, 2.75, 58, 0.25],
		[0, 3, 61, 0.75],
		[0, 3.75, 63, 0.25],
		[1, 0, 56, 3.5],
		[1, 3.5, 54, 0.25],
		[1, 3.75, 52, 0.25],
		[2, 0, 61, 1],
		[2, 1, 52, 0.5],
		[2, 1.5, 61, 0.5],
		[2, 2, 61, 0.5],
		[2, 2.5, 60, 0.5],
		[2, 3, 61, 0.5],
		[2, 3.5, 63, 0.5],
	],
	dyn,
);

/** Violins I on the G string, bars 4–7, into bar 8's C♯4. */
const VIOLINS: NoteEvent[] = line(
	"violins",
	[
		[3, 2, 64, 1],
		[3, 3, 66, 1],
		[4, 0, 68, 1.5],
		[4, 1.5, 63, 0.25],
		[4, 1.75, 64, 0.25],
		[4, 2, 68, 1.5],
		[4, 3.5, 66, 0.25],
		[4, 3.75, 67, 0.25],
		[5, 0, 68, 1.5],
		[5, 1.5, 69, 0.25],
		[5, 1.75, 71, 0.25],
		[5, 2, 73, 0.5],
		[5, 2.5, 71, 0.5],
		[5, 3, 69, 0.5],
		[5, 3.5, 68, 0.5],
		[6, 0, 68, 1],
		[6, 1, 66, 1],
		[6, 2, 57, 1],
		[6, 3, 59, 1],
		[7, 0, 61, 4],
	],
	dyn,
);

/** The chorale: the cellos' divisi chords in bars 1–3, the trombones' in
 *  bar 7, and the held A major of bar 8. */
const CHORALE: NoteEvent[] = [
	...chord("tubas", 0, 0, [37, 44, 52], 2, 0.5),
	...chord("tubas", 0, 2, [35, 45, 52], 2, 0.55),
	...chord("tubas", 1, 0, [44, 51], 2, 0.6),
	...chord("tubas", 1, 2, [50, 52], 2, 0.6),
	...chord("tubas", 2, 0, [49, 52], 2, 0.55),
	...chord("tubas", 2, 2, [57], 2, 0.5),
	...chord("tubas", 6, 0, [61, 64], 2, 0.5),
	...chord("tubas", 6, 2, [56, 61], 1, 0.45),
	...chord("tubas", 6, 3, [56, 62], 1, 0.45),
	...chord("tubas", 7, 0, [52, 57, 61, 64], 4, 0.4),
];

/** The double basses, sounding; the cellos an octave above from bar 4. */
const BASS_LINE: readonly (readonly [number, number, number, number])[] = [
	[0, 0, 37, 4],
	[1, 0, 36, 2],
	[1, 2, 35, 2],
	[2, 0, 33, 2],
	[2, 2, 30, 2],
	[3, 0, 32, 2],
	[3, 2, 37, 1],
	[3, 3, 35, 1],
	[4, 0, 40, 1.5],
	[4, 1.5, 40, 0.5],
	[4, 2, 39, 1],
	[4, 3, 38, 1],
	[5, 0, 37, 1.5],
	[6, 0, 30, 2],
	[6, 2, 38, 2],
	[7, 0, 33, 4],
];

const LOW: NoteEvent[] = [
	...line("bass", BASS_LINE, dyn),
	...line(
		"cello",
		BASS_LINE.filter(([bar]) => bar >= 3).map(
			([bar, beat, pitch, dur]) => [bar, beat, pitch + 12, dur] as const,
		),
		dyn,
	),
];

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The violas' theme: legato, warm, a slow bow.
	viola: {
		voice: "strings",
		level: 0.36,
		glideS: 0.03,
		attackS: 0.12,
		releaseS: 0.8,
		cutoffHz: 1300,
		envAmount: 1.4,
		vibrato: 0.1,
		pan: 0.2,
		reverb: 0.55,
	},
	// Violins I on the G string: darker than an open violin, and markirt.
	violins: {
		voice: "strings",
		level: 0.38,
		glideS: 0.02,
		attackS: 0.08,
		releaseS: 0.9,
		cutoffHz: 1600,
		envAmount: 1.6,
		index: 0.35,
		vibrato: 0.12,
		pan: -0.2,
		reverb: 0.55,
	},
	// The Wagner tubas' chorale: the Danube's horn desk, held.
	tubas: {
		...DANUBE_VOICINGS.orchestra.horn,
		level: 0.22,
		attackS: 0.25,
		releaseS: 1.2,
		pan: -0.3,
		reverb: 0.6,
	},
	// Double basses: slow bows, low and dark.
	bass: {
		voice: "strings",
		level: 0.34,
		attackS: 0.4,
		releaseS: 1.2,
		unison: 3,
		cutoffHz: 600,
		envAmount: 1,
		vibrato: 0.04,
		pan: 0.05,
		reverb: 0.45,
	},
	// Cellos, an octave above them from bar 4.
	cello: {
		voice: "strings",
		level: 0.2,
		attackS: 0.3,
		releaseS: 1,
		unison: 3,
		cutoffHz: 900,
		envAmount: 1.2,
		vibrato: 0.08,
		pan: 0.3,
		reverb: 0.5,
	},
};

/** ♪ = 63: a quarter at 31.5; the held bar at 28. */
const BPM = 31.5;
const END_BPM = 28;

export const BRUCKNER_ADAGIO: Song = {
	name: "Bruckner 7, Adagio",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "opening",
			bars: BARS,
			events: [...VIOLAS, ...VIOLINS, ...CHORALE, ...LOW],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 7, bpm: END_BPM },
	],
	space: { reverbS: 5 },
};

/** The excerpt's length: seven bars at 31.5, the held bar at 28. */
export const BRUCKNER_ADAGIO_SECONDS = (7 * 4 * 60) / BPM + (4 * 60) / END_BPM;
