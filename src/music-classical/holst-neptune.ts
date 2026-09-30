/**
 * Gustav Holst, *The Planets*, op. 32, VII. "Neptune, the Mystic" (1914–16;
 * full score first published 1921), hand-encoded as note data (#589) — a
 * public-domain composition, synthesised at runtime, nothing downloaded or
 * recorded.
 *
 * **Encoded from the 1921 full score** (Goodwin & Tabb / J. Curwen & Sons,
 * reissued by Boosey & Hawkes on plate B. & H. 15970; IMSLP #15439):
 * printed pages 162–163, bars 1–8 — the opening, *Andante (3 beats followed
 * by 2)*, *sempre pp*: the flute and bass flute's alternating E-minor /
 * G-sharp-minor figure, the piccolo and oboes' held chord against the
 * trombones' A minor, the harps' tremolo, the figure again, the horns'
 * chord, and the piccolo and oboes' second answer. Every pitch below was
 * read off those two pages.
 *
 * **5/4 is five quarter beats a bar.** No metronome figure is printed, so
 * `BPM` is this file's reading of *Andante*; the last printed bar slows, and
 * its closing chord is held through one added bar (the arrangement's
 * fermata), so the excerpt ends on a sustained chord rather than mid-air.
 * The choir enters far later; this stops long before it.
 *
 * **Sounding pitch throughout.** The bass flute (in G) sounds a fourth below
 * the page, the piccolo an octave above it, the horns (in F) a fifth below.
 *
 * **Voices.** Flutes on `flute`; the bass flute on a darker, lower `flute`;
 * piccolo and oboes on a brighter `flute` desk (all woodwinds). The
 * trombones' and horns' two *pp* chords on `drone` (no brass: the principal
 * rejected it), a soft held bed. The harps' fingered tremolo — the same
 * G-sharp-minor chord alternated with its A-flat-minor spelling, so one
 * sounding chord — on a soft `pad` re-struck every eighth, not `pluck` or
 * `keys`, which the principal heard as *plinky*.
 *
 * **Where the arrangement reduces the page.**
 * - Bars 3 and 7: the two flutes' closing sixteenth figure (divided, in
 *   thirds) is left out — the scan is too smudged there to read every note
 *   with certainty. Flute I's line stops on the bar line; the bass flute's
 *   closing eighth is kept.
 * - Bar 8: the second harp's new tremolo chords (beats 4–5, after the pedal
 *   change) are left out for the same reason; the woodwinds' chord carries
 *   the harmony.
 * - The oboes are written as two voices of one desk; the harps as one.
 * - The held last chord (piccolo E-flat, flute II B-flat, oboes A-flat and
 *   C) is tied into the added bar.
 */
import type { NoteEvent, Song } from "../music-score";
import { chord, line } from "./notation";

/** *Andante*, quarter notes a minute (none printed). */
const BPM = 58;
/** Where bar 8 has slowed to, and the held added bar stays. */
const END_BPM = 48;

/** The flutes' figure, one bar: `[beat, pitch, dur]`, 3 beats then 2. */
const FIGURE_BEATS: readonly (readonly [number, number])[] = [
	[0, 1],
	[1, 1],
	[2, 0.5],
	[2.5, 0.5],
	[3, 0.5],
	[3.5, 0.5],
	[4, 0.5],
	[4.5, 0.5],
];

/** Flute I, printed bars 1/5 and 2/6: G E G E | D# G# B, then G# or C. */
const FLUTE_1 = [67, 64, 67, 64, 63, 68, 71, 68];
const FLUTE_2 = [67, 64, 67, 64, 63, 68, 71, 72];
/** Bass flute, sounding (written E C E C | C# E G# F#, then …G# C). */
const BASS_1 = [59, 55, 59, 55, 56, 59, 63, 61];
const BASS_2 = [59, 55, 59, 55, 56, 59, 63, 67];

const figure = (
	part: string,
	bar: number,
	pitches: readonly number[],
	vel: number,
): NoteEvent[] =>
	line(
		part,
		FIGURE_BEATS.map(([beat, dur], i) => [bar, beat, pitches[i], dur]),
		vel,
	);

/** The harps' tremolo: G#5 B5 D#6 re-struck every eighth, from `bar`'s
 *  `beat` for `beats` beats. */
const HARP_CHORD = [80, 83, 87];
const tremolo = (bar: number, beat: number, beats: number): NoteEvent[] =>
	Array.from({ length: beats * 2 }, (_, i) => {
		const t = beat + i / 2;
		return chord("harp", bar + Math.floor(t / 5), t % 5, HARP_CHORD, 0.5, 0.3);
	}).flat();

/** Printed bars 1–4 (score bars 0–3). */
const A: NoteEvent[] = [
	...figure("flute", 0, FLUTE_1, 0.5),
	...figure("flute", 1, FLUTE_2, 0.5),
	...figure("bassFlute", 0, BASS_1, 0.5),
	...figure("bassFlute", 1, BASS_2, 0.5),
	// Bar 3: the bass flute's closing eighth, written E5.
	...line("bassFlute", [[2, 0, 71, 0.5]], 0.45),
	// Bar 3: piccolo D#6 (written D#5) and oboes G#5–B5, a half tied to a
	// half from beat 2 to the bar line.
	...line("high", [[2, 1, 87, 4]], 0.4),
	...chord("high", 2, 1, [80, 83], 4, 0.4),
	// Bar 3, beat 4: trombones pp, A minor, tied into a dotted half.
	...chord("low", 2, 3, [45, 52, 60], 5, 0.4),
	// Bar 4: piccolo E6 C6 E6 and D#6; oboes A–C, F–A, A–C, G#–B.
	...line(
		"high",
		[
			[3, 0, 88, 1],
			[3, 1, 84, 1],
			[3, 2, 88, 1],
			[3, 3, 87, 2],
		],
		0.4,
	),
	...chord("high", 3, 0, [81, 84], 1, 0.4),
	...chord("high", 3, 1, [77, 81], 1, 0.4),
	...chord("high", 3, 2, [81, 84], 1, 0.4),
	...chord("high", 3, 3, [80, 83], 2, 0.4),
	// Bar 4 from beat 2 on: both harps' tremolo.
	...tremolo(3, 1, 4),
];

/** Printed bars 5–8 (score bars 4–7). */
const B: NoteEvent[] = [
	...figure("flute", 0, FLUTE_1, 0.5),
	...figure("flute", 1, FLUTE_2, 0.5),
	...figure("bassFlute", 0, BASS_1, 0.5),
	...figure("bassFlute", 1, BASS_2, 0.5),
	...line("bassFlute", [[2, 0, 71, 0.5]], 0.45),
	// Harps: bars 5 and 6 whole, bar 7's first beat, then one stroke.
	...tremolo(0, 0, 11),
	...chord("harp", 2, 1, HARP_CHORD, 0.5, 0.3),
	// Bar 7: piccolo and oboes as in bar 3.
	...line("high", [[2, 1, 87, 4]], 0.4),
	...chord("high", 2, 1, [80, 83], 4, 0.4),
	// Bar 7, beat 4: horns pp (sounding C3 G3 C4 E4), tied into bar 8.
	...chord("low", 2, 3, [48, 55, 60, 64], 4, 0.4),
	// Bar 8: piccolo E6 C6 E6, E-flat 6 held; oboes Ab–C, E–G, Ab–C, Ab–C
	// held; flute II's B-flat 5 under them. The held notes run on through
	// the added bar.
	...line(
		"high",
		[
			[3, 0, 88, 1],
			[3, 1, 84, 1],
			[3, 2, 88, 1],
			[3, 3, 87, 7],
		],
		0.4,
	),
	...chord("high", 3, 0, [80, 84], 1, 0.4),
	...chord("high", 3, 1, [76, 79], 1, 0.4),
	...chord("high", 3, 2, [80, 84], 1, 0.4),
	...chord("high", 3, 3, [80, 84], 7, 0.38),
	...line("flute", [[3, 3, 82, 7]], 0.4),
];

export const NEPTUNE: Song = {
	name: "Neptune, the Mystic",
	beatsPerBar: 5,
	parts: {
		flute: {
			voice: "flute",
			level: 0.34,
			glideS: 0.03,
			attackS: 0.08,
			releaseS: 0.6,
			index: 0.3,
			pan: -0.2,
			reverb: 0.55,
		},
		bassFlute: {
			voice: "flute",
			level: 0.3,
			glideS: 0.03,
			attackS: 0.1,
			releaseS: 0.7,
			index: 0.4,
			cutoffHz: 900,
			pan: 0.2,
			reverb: 0.55,
		},
		high: {
			voice: "flute",
			level: 0.18,
			attackS: 0.15,
			releaseS: 1.2,
			index: 0.2,
			pan: 0.1,
			reverb: 0.6,
		},
		low: {
			voice: "drone",
			level: 0.16,
			attackS: 0.8,
			releaseS: 2,
			detune: 0.06,
			drift: 4,
			spread: 0.8,
			pan: -0.1,
			reverb: 0.6,
		},
		harp: {
			voice: "pad",
			level: 0.12,
			attackS: 0.02,
			decayS: 0.4,
			sustain: 0.4,
			releaseS: 0.5,
			cutoffHz: 2400,
			pan: 0.35,
			reverb: 0.6,
		},
	},
	sections: [
		{ name: "a", bars: 4, events: A },
		{ name: "b", bars: 4, events: B },
		{ name: "hold", bars: 1, events: [] },
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 7, bpm: BPM },
		{ bar: 8, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 5 },
};

/** Seven bars at `BPM`, bar 8 slowing linearly (in beats) to `END_BPM`, and
 *  the held bar at `END_BPM`: 5 beats a bar. */
export const NEPTUNE_SECONDS =
	(7 * 5 * 60) / BPM +
	((5 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(5 * 60) / END_BPM;
