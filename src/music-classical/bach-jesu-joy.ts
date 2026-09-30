/**
 * Johann Sebastian Bach, *Herz und Mund und Tat und Leben*, BWV 147 (1723):
 * the chorale that closes its first part, "Wohl mir, dass ich Jesum habe" —
 * the tune the English-speaking world knows as *Jesu, Joy of Man's
 * Desiring*. Hand-encoded as note data for #589; a public-domain
 * composition, synthesised at runtime, nothing downloaded or recorded.
 *
 * **Encoded from the Bach-Gesellschaft edition**, Bd. 30 (Leipzig:
 * Breitkopf & Härtel, 1884), "Choral", printed pages 213–215 (IMSLP #01405,
 * PDF pages 23–25): bars 1–23 and the downbeat of bar 24. That is the
 * opening ritornello (1–8), the chorale's first two lines, "Wohl mir, dass
 * ich Jesum habe, / o wie feste halt' ich ihn" (9–17, cadencing on G), and
 * the ritornello again (17–23), up to the downbeat on which the third line
 * enters. The excerpt ends there, on that G major chord, held.
 *
 * Parts, each as printed:
 *
 * - **obbligato** — *Violino I* with *Oboi col Violino I*, in 9/8: the
 *   triplet line, on `flute` for the oboes' colour.
 * - **second** — *Violino II*, in 3/4: its dotted figure, bowed short.
 * - **chorale** — the *Soprano*, the tune (soprano clef), bowed legato.
 * - **choir** — *Alto* and *Tenore* (alto and tenor clefs), softer.
 * - **continuo** — the *Continuo*, low bowed strokes.
 *
 * **Reduced.** The viola is left out, and so is the *Basso* voice, which
 * doubles the continuo in these bars; the *Tromba*, which doubles the
 * soprano, is left out too. The soprano's trill in bar 16 is not played.
 * Bar 24 is the arrangement's close: the printed downbeat (violins, choir
 * and continuo on G) held as one chord, where the score goes on.
 *
 * **Grid.** 3/4, `beatsPerBar` 3. The first violin is written in 9/8, so
 * its eighths are triplets: a third of a beat each. The second violin and
 * the continuo write their figure as a dotted eighth and a sixteenth in
 * 3/4; against the triplets that is **assimilated** here to the triplet's
 * two-thirds and one-third, as the convention of the period plays it — the
 * one place the rhythm is the arrangement's reading rather than the page's.
 *
 * **Tempo.** The edition prints none. Crotchet = 72, easing to 56 over the
 * last two bars of the ritornello into the held chord.
 *
 * Imports only the score's types and the notation helpers.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { line } from "./notation";

const BPM = 72;
const FINAL_BPM = 56;

/** Pitches, MIDI. */
const D2 = 38;
const E2 = 40;
const G2 = 43;
const A2 = 45;
const B2 = 47;
const C3 = 48;
const Cs3 = 49;
const D3 = 50;
const E3 = 52;
const Fs3 = 54;
const G3 = 55;
const A3 = 57;
const B3 = 59;
const C4 = 60;
const D4 = 62;
const E4 = 64;
const Fs4 = 66;
const G4 = 67;
const A4 = 69;
const B4 = 71;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const Fs5 = 78;
const G5 = 79;

type Note = readonly [number, number, number, number];
const T = 1 / 3;

/** A 9/8 bar of the first violin: nine triplet eighths, `null` a rest.
 *  `bar` is the score's bar number, from 1. */
const triplets = (bar: number, pitches: readonly (number | null)[]): Note[] =>
	pitches.flatMap((p, i) =>
		p === null ? [] : [[bar - 1, i * T, p, T] as const],
	);

/** A bar of the second violin's figure: one [long, short] pair per beat,
 *  assimilated to the triplet (2/3 + 1/3); `null` a beat's rest. */
const dotted = (
	bar: number,
	pairs: readonly (readonly [number, number] | null)[],
): Note[] =>
	pairs.flatMap((pair, beat) =>
		pair === null
			? []
			: [
					[bar - 1, beat, pair[0], 2 * T] as const,
					[bar - 1, beat + 2 * T, pair[1], T] as const,
				],
	);

/** Quarters on every beat of a score bar. */
const quarters = (bar: number, pitches: readonly number[]): Note[] =>
	pitches.map((p, i) => [bar - 1, i, p, 1] as const);

/** Notes at score bar `bar`: [beat, pitch, dur]. */
const at = (
	bar: number,
	notes: readonly (readonly [number, number, number])[],
): Note[] => notes.map(([beat, p, d]) => [bar - 1, beat, p, d] as const);

// ---- Violino I (with the oboes) -----------------------------------------

const V1: Record<number, (number | null)[]> = {
	1: [null, G4, A4, B4, D5, C5, C5, E5, D5],
	2: [D5, G5, Fs5, G5, D5, B4, G4, A4, B4],
	3: [C5, D5, E5, D5, C5, B4, A4, B4, G4],
	4: [Fs4, G4, A4, D4, Fs4, A4, C5, B4, A4],
	5: [B4, G4, A4, B4, D5, C5, C5, E5, D5],
	7: [E4, D5, C5, B4, A4, G4, D4, G4, Fs4],
	8: [G4, B4, D5, G5, D5, B4, G4, B4, D5],
	12: [null, D4, E4, Fs4, A4, G4, A4, C5, B4],
	13: [C5, A4, Fs4, D4, Fs4, A4, C5, B4, A4],
	17: [G4, B4, A4, B4, D5, C5, C5, E5, D5],
};
/** Bar 6 repeats bar 2; the second ritornello (18–23) repeats bars 2–7,
 *  and bars 14–16 are bars 5, 2 and 7 — each checked against the page. */
const OBBLIGATO: Note[] = [
	...triplets(1, V1[1]),
	...triplets(2, V1[2]),
	...triplets(3, V1[3]),
	...triplets(4, V1[4]),
	...triplets(5, V1[5]),
	...triplets(6, V1[2]),
	...triplets(7, V1[7]),
	...triplets(8, V1[8]),
	...at(9, [[0, G5, 1]]),
	...triplets(12, V1[12]),
	...triplets(13, V1[13]),
	...triplets(14, V1[5]),
	...triplets(15, V1[2]),
	...triplets(16, V1[7]),
	...triplets(17, V1[17]),
	...triplets(18, V1[2]),
	...triplets(19, V1[3]),
	...triplets(20, V1[4]),
	...triplets(21, V1[5]),
	...triplets(22, V1[2]),
	...triplets(23, V1[7]),
];

// ---- Violino II ----------------------------------------------------------

type Pair = readonly [number, number] | null;
const V2: Record<number, Pair[]> = {
	1: [null, [G4, Fs4], [G4, A4]],
	2: [
		[B4, A4],
		[B4, G4],
		[E4, D4],
	],
	3: [
		[E4, Fs4],
		[G4, D4],
		[E4, B3],
	],
	4: [
		[A3, D4],
		[A4, G4],
		[A4, Fs4],
	],
	5: [
		[D4, Fs4],
		[G4, Fs4],
		[G4, A4],
	],
	6: [
		[B4, A4],
		[B4, G4],
		[E4, G4],
	],
	7: [
		[A4, Fs4],
		[G4, E4],
		[A3, C4],
	],
	8: [
		[B3, G4],
		[B4, D5],
		[G5, D5],
	],
	12: [null, [D4, E4], [Fs4, G4]],
	13: [
		[A4, C5],
		[A4, Fs4],
		[D4, Fs4],
	],
	14: [
		[G4, D4],
		[G4, Fs4],
		[G4, A4],
	],
	15: [
		[B4, A4],
		[G4, Fs4],
		[E4, G4],
	],
	16: [
		[A4, G4],
		[Fs4, G4],
		[A4, C4],
	],
	17: [
		[B3, D4],
		[G4, Fs4],
		[G4, A4],
	],
};
const SECOND: Note[] = [
	...[1, 2, 3, 4, 5, 6, 7, 8].flatMap((b) => dotted(b, V2[b])),
	...at(9, [[0, B4, 1]]),
	...[12, 13, 14, 15, 16, 17].flatMap((b) => dotted(b, V2[b])),
	// 18–23 repeat bars 2–7
	...[2, 3, 4, 5, 6, 7].flatMap((b) => dotted(b + 16, V2[b])),
];

// ---- The chorale: Soprano, Alto, Tenore (bars 9–17) ---------------------

const SOPRANO: Note[] = [
	...at(9, [
		[0, B4, 2],
		[2, C5, 1],
	]),
	...at(10, [
		[0, D5, 2],
		[2, D5, 1],
	]),
	...at(11, [
		[0, C5, 2],
		[2, B4, 1],
	]),
	...at(12, [
		[0, A4, 1],
		[1, A4, 1],
	]),
	...at(14, [
		[0, B4, 2],
		[2, C5, 1],
	]),
	...at(15, [
		[0, D5, 2],
		[2, B4, 1],
	]),
	...at(16, [
		[0, A4, 0.5],
		[0.5, B4, 0.25],
		[0.75, C5, 0.25],
		[1, B4, 1],
		[2, A4, 1],
	]),
	...at(17, [[0, G4, 2]]),
];

const ALTO_TENOR: Note[] = [
	// Alto
	...at(9, [
		[0, G4, 2],
		[2, G4, 1],
	]),
	...at(10, [
		[0, A4, 1],
		[1, G4, 1],
		[2, Fs4, 1],
	]),
	...at(11, [
		[0, G4, 1],
		[1, D4, 2],
	]),
	...at(12, [
		[0, D4, 1],
		[1, D4, 1],
	]),
	...at(14, [
		[0, G4, 2],
		[2, G4, 1],
	]),
	...at(15, [
		[0, G4, 1],
		[1, D4, 1],
		[2, E4, 1],
	]),
	...at(16, [
		[0, E4, 1],
		[1, Fs4, 0.5],
		[1.5, E4, 0.5],
		[2, Fs4, 1],
	]),
	...at(17, [[0, D4, 2]]),
	// Tenore
	...at(9, [
		[0, D4, 2],
		[2, E4, 1],
	]),
	...at(10, [
		[0, A3, 2],
		[2, B3, 1],
	]),
	...at(11, [
		[0, B3, 1],
		[1, A3, 1],
		[2, G3, 1],
	]),
	...at(12, [
		[0, Fs3, 1],
		[1, A3, 1],
	]),
	...at(14, [
		[0, D4, 2],
		[2, E4, 1],
	]),
	...at(15, [
		[0, D4, 1],
		[1, B3, 1],
		[2, B3, 1],
	]),
	...at(16, [
		[0, C4, 0.5],
		[0.5, A3, 0.5],
		[1, D4, 0.5],
		[1.5, B3, 0.5],
		[2, C4, 1],
	]),
	...at(17, [[0, B3, 2]]),
];

// ---- Continuo ------------------------------------------------------------

/** The continuo's upbeat figure on beats 2–3 (bars 8, 12, 13), assimilated
 *  like the second violin's: a sixteenth on the last third of beat 2, then
 *  a dotted eighth and a sixteenth. */
const upbeat = (bar: number, a: number, b: number, c: number): Note[] =>
	at(bar, [
		[1 + 2 * T, a, T],
		[2, b, 2 * T],
		[2 + 2 * T, c, T],
	]);

const CONTINUO: Note[] = [
	...quarters(1, [G2, G3, E3]),
	...quarters(2, [B2, E3, E2]),
	...quarters(3, [A2, B2, C3]),
	...quarters(4, [D3, Fs3, D3]),
	...quarters(5, [G3, E3, C3]),
	...quarters(6, [B2, E3, D3]),
	...quarters(7, [C3, Cs3, D3]),
	...at(8, [[0, G2, 1]]),
	...upbeat(8, G3, D3, B2),
	...quarters(9, [G2, Fs3, E3]),
	...quarters(10, [Fs3, E3, D3]),
	...quarters(11, [E3, Fs3, G3]),
	...at(12, [[0, D3, 1]]),
	...upbeat(12, D3, D3, D3),
	...at(13, [[0, D2, 1]]),
	...upbeat(13, D3, D3, D3),
	...quarters(14, [G3, Fs3, E3]),
	...quarters(15, [B3, B2, E3]),
	...quarters(16, [C3, D3, D2]),
	...quarters(17, [G2, G3, E3]),
	...quarters(18, [B2, E3, E2]),
	...quarters(19, [A2, B2, C3]),
	...quarters(20, [D3, Fs3, D3]),
	...quarters(21, [G3, E3, C3]),
	...quarters(22, [B2, E3, D3]),
	...quarters(23, [C3, Cs3, D3]),
];

// ---- The close: bar 24's downbeat, held ---------------------------------

const FINAL_DUR = 5;
const CLOSE: NoteEvent[] = [
	...line("obbligato", at(24, [[0, G4, FINAL_DUR]]), 0.7),
	...line("second", at(24, [[0, B3, FINAL_DUR]]), 0.6),
	...line("chorale", at(24, [[0, B4, FINAL_DUR]]), 0.75),
	...line(
		"choir",
		at(24, [
			[0, G4, FINAL_DUR],
			[0, D4, FINAL_DUR],
		]),
		0.65,
	),
	...line("continuo", at(24, [[0, G2, FINAL_DUR]]), 0.7),
];

const ALL: NoteEvent[] = [
	...line("obbligato", OBBLIGATO, 0.8),
	...line("second", SECOND, 0.65),
	...line("chorale", SOPRANO, 0.8),
	...line("choir", ALTO_TENOR, 0.7),
	...line("continuo", CONTINUO, 0.75),
	...CLOSE,
];

/** Sections, in song bars (score bar − 1): the ritornello, the chorale's
 *  two lines, the ritornello again, and the held close (one bar and its
 *  ring). */
const SPLITS: readonly (readonly [string, number])[] = [
	["ritornello", 8],
	["wohl-mir", 9],
	["ritornello-2", 6],
	["close", 2],
];
const SECTIONS = (() => {
	let from = 0;
	return SPLITS.map(([name, bars]) => {
		const start = from;
		from += bars;
		return {
			name,
			bars,
			events: ALL.filter((e) => e.bar >= start && e.bar < start + bars).map(
				(e) => ({ ...e, bar: e.bar - start }),
			),
		};
	});
})();

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Violin I with the oboes: the triplets, legato in their slurs, a
	// little breath on each.
	obbligato: {
		voice: "flute",
		level: 0.34,
		attackS: 0.03,
		releaseS: 0.22,
		index: 0.2,
		cutoffHz: 2600,
		vibrato: 0.05,
		pan: -0.2,
		reverb: 0.45,
	},
	// Violin II: the dotted figure, the bow lifted between pairs.
	second: {
		voice: "strings",
		level: 0.15,
		attackS: 0.04,
		releaseS: 0.18,
		unison: 3,
		cutoffHz: 1800,
		index: 0.2,
		vibrato: 0.06,
		pan: 0.3,
		reverb: 0.4,
	},
	// The soprano's tune: bowed, joined, above the choir.
	chorale: {
		voice: "strings",
		level: 0.3,
		attackS: 0.12,
		releaseS: 0.5,
		glideS: 0.02,
		cutoffHz: 1600,
		envAmount: 1.4,
		vibrato: 0.1,
		pan: 0.05,
		reverb: 0.55,
	},
	// Alto and tenor: a soft held body under it.
	choir: {
		voice: "strings",
		level: 0.14,
		attackS: 0.2,
		releaseS: 0.6,
		unison: 3,
		cutoffHz: 1100,
		vibrato: 0.08,
		pan: 0.1,
		reverb: 0.6,
	},
	// Continuo: cello and bass, detached quarters.
	continuo: {
		voice: "strings",
		level: 0.36,
		attackS: 0.04,
		releaseS: 0.3,
		cutoffHz: 700,
		envAmount: 1.1,
		index: 0.25,
		vibrato: 0,
		keyTrack: 0.4,
		pan: -0.05,
		reverb: 0.3,
	},
};

export const JESU_JOY: Song = {
	name: "Wohl mir, dass ich Jesum habe (BWV 147)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: SECTIONS,
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 21, bpm: BPM },
		{ bar: 23, bpm: FINAL_BPM, ramp: true },
	],
	space: { reverbS: 3.2 },
};

/** The excerpt's length from its tempo map: 21 bars at 72, a linear ramp
 *  (in beats) over two bars to 56, then the close's two bars at 56. */
export const JESU_JOY_SECONDS =
	(21 * 3 * 60) / BPM +
	((6 * 60) / (BPM - FINAL_BPM)) * Math.log(BPM / FINAL_BPM) +
	(2 * 3 * 60) / FINAL_BPM;
