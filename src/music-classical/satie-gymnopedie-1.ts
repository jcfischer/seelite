/**
 * Erik Satie, *1ère Gymnopédie* (1888), hand-encoded as note data (#589) — a
 * public-domain composition, synthesised at runtime, nothing downloaded or
 * recorded.
 *
 * **Encoded from the 1895 second edition** (Paris, "Erik Satie, 6 rue
 * Cortot", red-ink engraving; the Gallica/BnF scan btv1b520000770, IMSLP
 * #965445): printed pages 1–2 (scan pages 9–10), bars 1–21 — *Lent et
 * douloureux*, the four bars of introduction and the whole first statement
 * of the melody, from its F-sharp–A entry in bar 5 to the E it holds from
 * bar 19 until the *p* of bar 22 begins the next phrase. Every pitch below
 * was read off those two pages.
 *
 * **It ends on a half-close on E, not a cadence to D.** Bar 21 is the
 * phrase's own end — E2 in the bass, F-natural–A–D over it, the melody's E
 * held — and it is where the page takes a breath before bar 22. The only
 * tonic close earlier (bar 12) gives about 36 s, under the set-pieces' floor,
 * so the excerpt ends on bar 21 held one added bar: the arrangement's
 * fermata, not a resolution the page does not print.
 *
 * **3/4, a quarter per beat.** Tempo: *Lent*, a quarter at 63, slowing over
 * bars 20–21 to 52, where the held bar stays.
 *
 * **Re-voiced, not on `keys`.** The principal heard keys and plucks as
 * *plinky* in the waltz, and this page is a slow sustained line over held
 * chords that the piano sustains only with the pedal. A breathed voice holds
 * the line the way the pedal does, so: the melody on `flute`, legato; the
 * right hand's half-note chords (with the note the stem reaches down into
 * the bass staff) on a soft, dark `strings` desk; the left hand's dotted-half
 * bass on a low bowed desk. No pluck, no keys — the character is a quiet
 * station bed.
 *
 * **Where the arrangement reduces the page.** The pedal is not written: a
 * note lasts what its printed value and ties say. The melody's ties (F-sharp
 * 4 through bars 9–12, E4 through bars 19–21) are one long note each. The
 * printed *f* of bar 9 is honoured as a modest swell and not a forte, the bed
 * being quiet; *pp* returns at bar 13 as printed.
 *
 * Imports only the score's types and the notation helpers, so it is data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** *Lent*: quarters a minute. */
const BPM = 63;
/** Where bars 20–21 slow to, and the added held bar stays. */
const END_BPM = 52;

/** The printed bars encoded, and the one added to hold the last. */
const BARS = 21;
const RING_BARS = 1;

// The bass's dotted halves and the chord on beats 2–3, per printed bar:
// `[bass, chord]`. G major 7 and D (F-sharp minor over D) alternate for
// sixteen bars, then F-sharp, B, E, E, and the F-natural chord over E.
const GMAJ7 = [59, 62, 66]; // B3 D4 F#4, over G2
const D_CHORD = [57, 61, 66]; // A3 C#4 F#4, over D2
type Harmony = readonly [number, readonly number[]];
const HARMONY: readonly Harmony[] = [
	...Array.from(
		{ length: 16 },
		(_, i): Harmony => (i % 2 === 0 ? [43, GMAJ7] : [38, D_CHORD]),
	),
	[42, D_CHORD], // 17: F#2
	[35, GMAJ7], // 18: B1
	[40, [55, 59]], // 19: E2; G3 B3
	[40, [59, 62, 67]], // 20: E2; B3 D4 G4
	[40, [53, 57, 62]], // 21: E2; F-natural 3, A3, D4
];

/** Loudness by printed bar: *pp*, the swell at the printed *f*, *pp* again. */
const dyn = (bar: number) => (bar < 8 ? 0.42 : bar < 12 ? 0.54 : 0.44);

const ACCOMPANIMENT: NoteEvent[] = HARMONY.flatMap(([bass, top], i) => {
	const last = i === HARMONY.length - 1;
	const ring = last ? RING_BARS * 3 : 0;
	return [
		...line("bass", [[i, 0, bass, 3 + ring]], dyn(i) * 0.95),
		...chord("chords", i, 1, top, 2 + ring, dyn(i) * 0.85),
	];
});

/** The melody, `[bar (0-based), beat, pitch, beats]`: bars 5–21. */
const MELODY: readonly (readonly [number, number, number, number])[] = [
	[4, 1, 78, 1], // 5: F#5
	[4, 2, 81, 1], // A5
	[5, 0, 79, 1], // 6: G5
	[5, 1, 78, 1], // F#5
	[5, 2, 73, 1], // C#5
	[6, 0, 71, 1], // 7: B4
	[6, 1, 73, 1], // C#5
	[6, 2, 74, 1], // D5
	[7, 0, 69, 3], // 8: A4
	[8, 0, 66, 12], // 9–12: F#4, tied
	[12, 1, 78, 1], // 13: F#5
	[12, 2, 81, 1], // A5
	[13, 0, 79, 1], // 14: G5
	[13, 1, 78, 1], // F#5
	[13, 2, 73, 1], // C#5
	[14, 0, 71, 1], // 15: B4
	[14, 1, 73, 1], // C#5
	[14, 2, 74, 1], // D5
	[15, 0, 69, 3], // 16: A4
	[16, 0, 73, 3], // 17: C#5
	[17, 0, 78, 3], // 18: F#5
	[18, 0, 64, 9 + RING_BARS * 3], // 19–21: E4, tied, and held
];

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The line: a soft flute, legato, a little breath.
	melody: {
		voice: "flute",
		level: 0.34,
		attackS: 0.12,
		releaseS: 0.9,
		glideS: 0.02,
		index: 0.25,
		vibrato: 0.08,
		pan: -0.1,
		reverb: 0.5,
	},
	// The right hand's chords: a muted, dark desk, bowed slowly in.
	chords: {
		voice: "strings",
		level: 0.13,
		attackS: 0.35,
		releaseS: 1.2,
		unison: 3,
		cutoffHz: 850,
		envAmount: 0.8,
		vibrato: 0.06,
		pan: 0.2,
		reverb: 0.55,
	},
	// The bass: low, soft, long.
	bass: {
		voice: "strings",
		level: 0.3,
		attackS: 0.2,
		releaseS: 1.2,
		cutoffHz: 520,
		envAmount: 0.8,
		vibrato: 0,
		pan: -0.05,
		reverb: 0.4,
	},
};

export const GYMNOPEDIE: Song = {
	name: "Gymnopédie No. 1",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{
			name: "a",
			bars: BARS + RING_BARS,
			events: [...line("melody", MELODY, dyn), ...ACCOMPANIMENT],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 19, bpm: BPM },
		{ bar: 21, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4 },
};

/** Bars 1–19 steady, bars 20–21 slowing linearly, the held bar at the end. */
export const GYMNOPEDIE_SECONDS =
	(19 * 3 * 60) / BPM +
	((6 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(RING_BARS * 3 * 60) / END_BPM;
