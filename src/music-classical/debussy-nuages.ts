/**
 * Claude Debussy, *Nocturnes*, I. "Nuages" (1899), hand-encoded as note
 * data (#589) — a public-domain composition, synthesised at runtime, nothing
 * downloaded or recorded.
 *
 * **Encoded from the Fromont full score** (Paris, E. Fromont, c. 1900;
 * IMSLP #34183): printed pages 1–2, bars 1–8 — the clarinets'
 * and bassoons' drifting fifths and thirds (1–4, the oboe's falling line in
 * 3), the held G–B they settle on, the English horn's call (5–8) and the
 * held G–B that flutes and horns carry in 6, and the whole-tone chord of
 * bar 7 — clarinets, bassoons, the muted violins and a timpani roll — under
 * the call. The pitches were read off those two pages, and are written here
 * at **sounding** pitch; bar 4 is taken as a repeat of bar 3 (the page
 * prints the same notes, più pp).
 *
 * **Transpositions, as the page prints them.** The clarinets are *en Si♭*
 * (the brief expected A): written a major second above sounding, four sharps
 * over the strings' two. The bassoons, in tenor clef at concert pitch, were
 * read separately and agree with them an octave below on the beats of bars
 * 1–3 checked — which is what settled the 72 ppi scan's half-step
 * ambiguities — except the fourth beat of bar 1, where the bassoon reads E
 * and the clarinet D; D is taken from bar 2's clearer copy of the same beat.
 * Bar 5's bassoon third is taken as the clarinets' an octave below. The English horn is in F, a fifth above
 * sounding, with one sharp — so its written C is a sounding F natural, the
 * bassoons' F natural in bar 7. The horns are in F, without a key signature.
 *
 * **The grid is the orchestra's 6/4**: six beats a bar, a beat a quarter.
 * The English horn alone is notated in 4/4 (C) inside the same barlines, so
 * its quarter is 1.5 of the orchestra's, and its triplet sixteenths a
 * quarter-beat each.
 *
 * **Voices.** Woodwinds on `flute`; the horns on the Danube's bowed horn
 * desk (#547 D14, no `brass`); the muted strings on `strings`; the timpani's
 * *ppp* roll a few soft `tone` strokes on B.
 *
 * **Where the arrangement reduces the score.** The violins' six-part divisi
 * chord is kept whole; the doublings are the page's. The roll is a stroke a
 * beat. The last bar's notes ring through one added silent bar at the slowed
 * tempo — the arrangement's fermata, so the call ends on its held B rather
 * than stopping mid-air.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type { NoteEvent, Song } from "../music-score";
import { chord, line } from "./notation";

/** *Modéré*: quarter notes a minute. */
const BPM = 66;
/** Where bar 8 has slowed to, and the held bar stays. */
const END_BPM = 54;
/** How far the last notes ring past bar 8: the held bar. */
const RING = 6;

// ── 1–4: the clarinets' dyads, sounding (bassoons an octave below) ─────────

/** `[upper, lower]` per quarter. Bars 1 and 2 differ only on the sixth. */
const DRIFT_1: readonly (readonly [number, number])[] = [
	[78, 71],
	[76, 73],
	[78, 71],
	[74, 70],
	[76, 69],
	[73, 70],
];
const DRIFT_2 = [...DRIFT_1.slice(0, 5), [73, 68] as const];
/** Bars 3 and 4 (the same notes, più pp): the fifth quarter's B is a half
 *  note, and the sixth quarter is the F# under it. */
const DRIFT_3: readonly (readonly [number, number])[] = [
	[74, 67],
	[69, 66],
	[73, 66],
	[68, 64],
];

const dyad = (
	bar: number,
	beat: number,
	[hi, lo]: readonly [number, number],
	dur: number,
	vel: number,
) => [
	...chord("clarinets", bar, beat, [hi, lo], dur, vel),
	...chord("bassoons", bar, beat, [hi - 12, lo - 12], dur, vel * 0.9),
];

const OPENING: NoteEvent[] = [
	...DRIFT_1.flatMap((d, q) => dyad(0, q, d, 1, 0.42)),
	...DRIFT_2.flatMap((d, q) => dyad(1, q, d, 1, 0.42)),
	...[2, 3].flatMap((bar) => {
		const vel = bar === 2 ? 0.42 : 0.34;
		return [
			...DRIFT_3.flatMap((d, q) => dyad(bar, q, d, 1, vel)),
			// The B: in bar 4 it is tied on into bar 5's held chord.
			...line("clarinets", [[bar, 4, 71, bar === 3 ? 2 + 6 : 2]], vel),
			...line("bassoons", [[bar, 4, 59, bar === 3 ? 2 + 6 : 2]], vel * 0.9),
			...line(
				"clarinets",
				[
					[bar, 4, 65, 1],
					[bar, 5, 66, 1],
				],
				vel,
			),
			...line(
				"bassoons",
				[
					[bar, 4, 53, 1],
					[bar, 5, 54, 1],
				],
				vel * 0.9,
			),
		];
	}),
	// The oboe, 1°, in bar 3: D, C# (held over the beat), B into bar 4.
	...line(
		"oboe",
		[
			[2, 0, 74, 2],
			[2, 2, 73, 2],
			[2, 4, 71, 3],
		],
		0.4,
	),
	// 5: the drift settles on G under the held B.
	...line("clarinets", [[4, 0, 67, 6]], 0.34),
	...line("bassoons", [[4, 0, 55, 6]], 0.3),
];

// ── 5–8: the English horn's call over the whole-tone chord ────────────────

/** Its 4/4 quarter in the orchestra's beats. */
const Q = 1.5;

const CALL: NoteEvent[] = line(
	"cor",
	[
		// 5: a quarter and an eighth rest, the triplet up to F, held over.
		[4, 1.5 * Q, 61, Q / 6],
		[4, 1.5 * Q + Q / 6, 62, Q / 6],
		[4, 1.5 * Q + (2 * Q) / 6, 64, Q / 6],
		[4, 2 * Q, 65, 3 * Q],
		// 6: E, D.
		[5, 1 * Q, 64, 2 * Q],
		[5, 3 * Q, 62, Q],
		// 7: C#, B, and the B held through 8.
		[6, 0, 61, Q],
		[6, 1 * Q, 59, Q],
		[6, 2 * Q, 59, 2 * Q + 6 + RING],
	],
	(bar) => (bar === 4 ? 0.6 : 0.55),
);

const CHORD: NoteEvent[] = [
	// 6: the flutes take the G–B; the horns sound B and G under it.
	...chord("flutes", 5, 0, [67, 71], 7, 0.36),
	...chord("horns", 5, 0, [55, 59], 7, 0.32),
	// 7 (rehearsal 1): clarinets B and G, bassoons F and F — whole-tone.
	...chord("clarinets", 6, 0, [55, 71], 7, 0.34),
	...chord("bassoons", 6, 0, [53, 65], 7, 0.32),
	// The violins, muted and divided in six, held through 8: A–C#–G below,
	// A–A–C# an octave up under the 8va.
	...chord("violins", 6, 0, [69, 73, 79, 81, 93, 97], 12 + RING, 0.34),
	// The timpani's roll on B, ppp: a soft stroke a beat.
	...Array.from({ length: 12 }, (_, i) =>
		line("timpani", [[6 + Math.floor(i / 6), i % 6, 47, 1]], 0.3),
	).flat(),
];

export const NUAGES: Song = {
	name: "Nuages",
	beatsPerBar: 6,
	parts: {
		clarinets: {
			voice: "flute",
			level: 0.28,
			attackS: 0.12,
			releaseS: 0.5,
			glideS: 0.02,
			index: 0.3,
			cutoffHz: 1400,
			pan: -0.2,
			reverb: 0.5,
		},
		bassoons: {
			voice: "flute",
			level: 0.24,
			attackS: 0.12,
			releaseS: 0.5,
			glideS: 0.02,
			index: 0.2,
			cutoffHz: 900,
			pan: 0.2,
			reverb: 0.5,
		},
		oboe: {
			voice: "flute",
			level: 0.22,
			attackS: 0.1,
			releaseS: 0.6,
			glideS: 0.03,
			index: 0.25,
			cutoffHz: 2000,
			pan: 0.3,
			reverb: 0.5,
		},
		// The English horn: the call, forward, legato.
		cor: {
			voice: "flute",
			level: 0.36,
			attackS: 0.08,
			releaseS: 1,
			glideS: 0.04,
			index: 0.35,
			cutoffHz: 1600,
			vibrato: 0.08,
			pan: -0.1,
			reverb: 0.45,
		},
		flutes: {
			voice: "flute",
			level: 0.2,
			attackS: 0.6,
			releaseS: 1,
			index: 0.3,
			pan: 0.35,
			reverb: 0.55,
		},
		horns: { ...DANUBE_VOICINGS.orchestra.horn, level: 0.18, reverb: 0.55 },
		// Muted violins: dark, slow in.
		violins: {
			voice: "strings",
			level: 0.18,
			attackS: 1,
			releaseS: 2,
			unison: 3,
			cutoffHz: 1500,
			envAmount: 0.8,
			vibrato: 0.05,
			pan: 0.15,
			reverb: 0.6,
		},
		timpani: { voice: "tone", level: 0.05, ratio: 1.2, pan: 0.25, reverb: 0.5 },
	},
	sections: [
		{ name: "a", bars: 8, events: [...OPENING, ...CALL, ...CHORD] },
		// The fermata: bar 8's held notes ring through it.
		{ name: "hold", bars: 1, events: [] },
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 7, bpm: BPM },
		{ bar: 8, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4.5 },
};

/** Bars 1–7 at `BPM`, bar 8 slowing linearly (in beats) to `END_BPM`, the
 *  held bar at `END_BPM`. Six beats a bar. */
export const NUAGES_SECONDS =
	(7 * 6 * 60) / BPM +
	((6 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(6 * 60) / END_BPM;
