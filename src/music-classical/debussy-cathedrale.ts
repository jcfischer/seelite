/**
 * Claude Debussy, *Préludes*, Book I, No. 10, "La cathédrale engloutie"
 * (1910), hand-encoded as note data (#589) — a public-domain composition,
 * synthesised at runtime, nothing downloaded or recorded.
 *
 * **Encoded from the Durand edition** (Paris; IMSLP #521885, file "Durand
 * 7687", a scan of all of Book I): printed page 38, bars 14–15, and printed
 * page 39, bars 16–30. The pitches were read off those two pages; three
 * bars are written as copies, and say so where they are: bar 18 is read as
 * bar 17 (the page shows the same bar twice), bars 17–18's left hand as bar
 * 16's figure one triplet later, and bar 21's tenor figures as bar 20's.
 *
 * **The span starts at bar 14, the return of the opening chords, not at bar
 * 1.** Bars 1 to the chorale's first held chord (bar 30) are 90 half-note
 * beats: about 108 s at a *Profondément calme* half note of 50, over the
 * excerpt budget. Bars 14–30 keep what the brief asks for — the parallel
 * chords rising over a low pedal (14–15, the opening's own figure over C),
 * the cathedral emerging from the mist (*Peu à peu sortant de la brume*,
 * 16–21), the crescendo (*Augmentez progressivement*, 22–27) and the C-major
 * chorale (*Sonore sans dureté*, 28–30) — in about a minute. Bars 1–30 at a
 * half note of ~60 would be the alternative, at ~93 s.
 *
 * **The grid is 3/2**: the page is marked 6/4 = 3/2, and a beat here is a
 * half note, so a quarter is 0.5 beat and the left hand's unmarked triplet
 * eighths of bars 16–18 are a sixth of a beat each.
 *
 * **Re-voiced, organ-like, not on `keys`.** A piano's decay is the wrong
 * shape for a piece built of held sonorities over a pedal — the principal
 * heard keys as *plinky* — so the held stacks and the pedal are a `drone`
 * bed, the moving chords are bowed `strings`, the chorale is the `analog`
 * string machine, and each pedal's first stroke gets a low `tone` at a tenth
 * of the bed's level, for the bell.
 *
 * **Where the arrangement reduces the page.**
 * - Octave signs are applied: the 8va over bar 14's held stack and over bars
 *   23–25's chords, the *8ª bassa* under the chorale's C (taken to hold for
 *   its tied C through bar 30).
 * - The pedal notes are held across the bars the pianist's pedal would carry
 *   them — bar 14's C through 15, bar 16's B through 18, bar 20's E-flat
 *   through 21, the chorale's C through 30 — which is the arrangement's
 *   choice, not a printed tie.
 * - The left hand's arpeggios in bars 16–21 are kept in pitch and order but
 *   simplified in rhythm: repeated tied notes are one note, and the marqué
 *   sixteenth figures of 19–21 are three notes each.
 * - The chorale's last chord rings through one added silent bar at the
 *   slowed tempo — the arrangement's fermata, where the page ties it on.
 */
import type { NoteEvent, Song } from "../music-score";
import { chord } from "./notation";

/** A half note a minute: *Profondément calme*. */
const BPM = 52;
/** Where bar 30 has broadened to, and the held bar stays. */
const END_BPM = 44;
/** The first printed bar of the excerpt. */
const FIRST = 14;

/** Loudness by printed bar: pp, p at 19, f at 22, più f at 25, ff at 28. */
const dyn = (bar: number) =>
	bar < 19
		? 0.38
		: bar < 22
			? 0.45 + (bar - 19) * 0.04
			: bar < 25
				? 0.62
				: bar < 28
					? 0.74
					: 0.88;

/** A chord at a printed bar. */
const at = (
	part: string,
	bar: number,
	beat: number,
	pitches: readonly number[],
	dur: number,
	scale = 1,
): NoteEvent[] =>
	chord(part, bar - FIRST, beat, pitches, dur, Math.min(1, dyn(bar) * scale));

/** Quarter chords, one per half beat from `from`. */
const quarters = (
	part: string,
	bar: number,
	from: number,
	chords: readonly (readonly number[])[],
	scale = 1,
): NoteEvent[] =>
	chords.flatMap((c, i) => at(part, bar, from + i * 0.5, c, 0.5, scale));

// ── 14–15: the opening's chords over C (page 38) ───────────────────────────

/** The rising quarter chords, fourth over fifth, as bar 1 has them. */
const RISE = [
	[62, 67, 74],
	[64, 69, 76],
	[71, 76, 83],
	[74, 79, 86],
	[76, 81, 88],
];
/** Bar 15's six chords, falling from B back to D. */
const FALL = [
	[71 + 12, 76 + 12, 83 + 12],
	[76, 81, 88],
	[74, 79, 86],
	[71, 76, 83],
	[64, 69, 76],
	[62, 67, 74],
];
const G_D_A = [43, 50, 57];
const A_E_B = [45, 52, 59];

/** The left hand's rocking fifths under 14–15. */
const rock = (bar: number, from: number): NoteEvent[] => [
	...(from === 0.5 ? at("lh", bar, 0.5, G_D_A, 0.5) : []),
	...at("lh", bar, 1, A_E_B, 1),
	...at("lh", bar, 2, G_D_A, 0.5),
	...at("lh", bar, 2.5, A_E_B, bar === 14 ? 1 : 0.5),
];

const OPENING: NoteEvent[] = [
	// The held stack, B–E–B, under the 8va.
	...at("stack", 14, 0, [83, 88, 95], 3),
	// The pedal: C1–G1–C2, held through 15.
	...at("pedal", 14, 0, [24, 31, 36], 6),
	...at("toll", 14, 0, [36], 1),
	...quarters("rh", 14, 0.5, RISE),
	...rock(14, 0.5),
	...quarters("rh", 15, 0, FALL),
	...rock(15, 0.5),
];

// ── 16–18: out of the mist, over B (page 39) ───────────────────────────────

/** The right hand's five chords: B major, F#–C#–D#–G#, B an octave up, and
 *  back (the clef changes bass–treble–bass between them). */
const MIST = [
	[51, 59, 63, 66],
	[54, 61, 63, 68],
	[63, 66, 71, 75],
	[54, 61, 63, 68],
	[51, 59, 63, 66],
];
/** Bar 16's left hand: triplet eighths over the pedal, 18 a bar. G#3 and
 *  B3 sound together on the tenth; the thirteenth is the twelfth's tie. */
const MIST_FIGURE: readonly (readonly number[])[] = [
	[35],
	[42],
	[35],
	[42],
	[35],
	[42],
	[35],
	[42],
	[54],
	[56, 59],
	[54],
	[47],
	[],
	[42],
	[35],
	[42],
	[35],
	[42],
];

/** Bars 17–18 open on an eighth rest and the pedal B0, and the figure
 *  follows one triplet later; its last note falls off the bar. */
const MIST_FIGURE_LATE: readonly (readonly number[])[] = [
	[],
	[23],
	...MIST_FIGURE.slice(0, 16),
];

const mistBar = (bar: number): NoteEvent[] => [
	...quarters("rh", bar, 0.5, MIST),
	...(bar === 16 ? MIST_FIGURE : MIST_FIGURE_LATE).flatMap((ps, i) =>
		ps.length
			? at("lh", bar, i / 6, ps, ps[0] === 47 ? 1 / 3 : 1 / 4, 0.8)
			: [],
	),
];

const EMERGE: NoteEvent[] = [
	...at("pedal", 16, 0, [23], 9),
	...at("toll", 16, 0, [35], 1),
	...mistBar(16),
	// 17–18, p marqué: the held stacks in both hands, G#–C#–F#–G#. Struck
	// once and held through both bars: the page strikes them again in bar
	// 18, and that restrike over bar 17's tails passed the synth's cap and
	// stole the pedal B0.
	...at("stack", 17, 0, [78, 80, 87, 92], 6, 1.2),
	...at("stack", 17, 0, [56, 61, 66, 68], 6, 1.2),
	...[17, 18].flatMap(mistBar),
];

// ── 19–21: E-flat, the marqué figure in the tenor (page 39) ────────────────

const BB_F = [58, 65, 67, 70];
const C_EB = [60, 63, 67, 72];
const F_G = [65, 67, 70, 77];

/** One half of a bar's left hand from `s`: the chord and its three-note
 *  marqué figure, then the fall through the pedal's fifths. */
const tenor = (bar: number, s: number, figure: readonly number[]) => [
	...at("lh", bar, s, [55, 58], 0.5, 0.9),
	...figure.flatMap((p, i) =>
		at("motif", bar, s + i / 12, [p], i === figure.length - 1 ? 1 / 3 : 1 / 12),
	),
	...at("lh", bar, s + 0.5, [51], 0.25, 0.8),
	...at("lh", bar, s + 0.75, [46], 0.5, 0.8),
	...at("lh", bar, s + 1.25, [39], 0.125, 0.8),
	...at("lh", bar, s + 1.375, [34], 0.125, 0.8),
];

const DEEP: NoteEvent[] = [
	// 19: the stack E-flat–B-flat–E-flat, the pedal E-flat.
	...at("stack", 19, 0, [75, 82, 87], 3),
	...at("pedal", 19, 0, [27], 3),
	...at("toll", 19, 0, [39], 1),
	...quarters("rh", 19, 0.5, [BB_F, C_EB, F_G, BB_F, C_EB]),
	// The rising triplets to the chord, then the figure at the bar's middle.
	...at("lh", 19, 1 / 6, [39], 1 / 6, 0.8),
	...at("lh", 19, 2 / 6, [46], 0.5, 0.8),
	...at("lh", 19, 5 / 6, [51], 0.5, 0.8),
	...at("lh", 19, 8 / 6, [58], 1 / 6, 0.8),
	...tenor(19, 1.5, [62, 60, 58]),
	// 20–21, Augmentez progressivement: the E-flat chord on the downbeat.
	...at("pedal", 20, 0, [27], 6),
	...at("toll", 20, 0, [39], 1),
	...quarters("rh", 20, 0, [[67, 70, 75, 79], BB_F, C_EB, F_G, BB_F, C_EB]),
	...tenor(20, 0, [62, 61, 60]),
	...tenor(20, 1.5, [62, 60, 58]),
	...quarters("rh", 21, 0, [
		[67, 70, 79],
		BB_F,
		C_EB,
		[67, 70, 79],
		BB_F,
		C_EB,
	]),
	...tenor(21, 0, [62, 61, 60]),
	...tenor(21, 1.5, [62, 60, 58]),
];

// ── 22–27: the crescendo (page 39) ─────────────────────────────────────────

const G_C_D = [55, 60, 62];
const CLUSTER = [62, 65, 67, 69, 72];
const RISING: NoteEvent[] = [
	// 22, f: G–D–G over G, the G–C–D chord, the A octaves.
	...at("stack", 22, 0, [79, 86, 91], 3),
	...at("pedal", 22, 0, [31, 38, 43], 3),
	...at("toll", 22, 0, [43], 1),
	...at("rh", 22, 1, [67, 72, 74, 79], 1),
	...at("rh", 22, 2, [69, 81], 1),
	...at("lh", 22, 1, G_C_D, 1),
	...at("lh", 22, 2, [57], 1),
	// 23: the stack D–G–C–D; under the 8va, octaves D, C, B.
	...at("stack", 23, 0, [74, 79, 84, 86], 3),
	...at("rh", 23, 1.5, [86, 98], 0.5),
	...at("rh", 23, 2, [84, 96], 0.5),
	...at("rh", 23, 2, [91, 93], 1),
	...at("rh", 23, 2.5, [83, 95], 0.5),
	...at("lh", 23, 0, CLUSTER, 1),
	...at("lh", 23, 1, [...G_C_D, 67], 1),
	...at("lh", 23, 2, [57, 69], 1),
	// 24: still 8va, the octaves A B A G F E over D–F.
	...at("rh", 24, 0, [86, 89], 1),
	...quarters("rh", 24, 0, [
		[81, 93],
		[83, 95],
		[81, 93],
		[79, 91],
		[77, 89],
		[76, 88],
	]),
	...at("lh", 24, 0, [...CLUSTER, 74], 1),
	...at("lh", 24, 1, [...G_C_D, 67], 1),
	...at("lh", 24, 2, [57, 69], 1),
	// 25, più f: D–A–D (the 8va's last), the G chord, the A octaves; the
	// bass octaves falling D, C, B.
	...at("rh", 25, 0, [74, 81, 86], 1),
	...at("rh", 25, 1, [55, 57, 62, 65, 67], 1),
	...at("rh", 25, 2, [57, 69], 1),
	...at("lh", 25, 0, CLUSTER, 1),
	...quarters("lh", 25, 1.5, [
		[38, 50],
		[36, 48],
		[35, 47],
	]),
	// 26–27: the cluster and the G chord over the bass's octaves.
	...at("rh", 26, 0, [60, ...CLUSTER.slice(0, 4), 74], 1),
	...at("rh", 26, 1, [55, 57, 62, 65, 67], 1),
	...at("rh", 26, 2, [57, 69], 1),
	...quarters("lh", 26, 0, [
		[33, 45],
		[35, 47],
		[33, 45],
		[31, 43],
		[29, 41],
		[28, 40],
	]),
	...at("rh", 27, 0, [60, ...CLUSTER.slice(0, 4), 74], 1),
	// sff: the low G, the right hand's in the bass clef.
	...at("rh", 27, 2, [43], 1, 1.1),
	...quarters("lh", 27, 0, [
		[26, 38],
		[36, 48],
		[33, 45],
		[31, 43],
		[29, 41],
		[26, 38],
	]),
];

// ── 28–30: Sonore sans dureté, the chorale over C (page 39) ────────────────

/** `[bar, beat, right hand, left hand, dur]`. */
const CHORALE_CHORDS: readonly (readonly [
	number,
	number,
	readonly number[],
	readonly number[],
	number,
])[] = [
	[28, 1, [60, 64, 67, 72], [43, 48, 52, 55], 1],
	[28, 2, [62, 65, 69, 74], [45, 50, 53, 57], 1],
	[29, 0, [67, 71, 74, 79], [50, 55, 59, 62], 1.5],
	[29, 1.5, [65, 69, 72, 77], [48, 53, 57, 60], 0.5],
	[29, 2, [64, 67, 71, 76], [47, 52, 55, 59], 0.5],
	[29, 2.5, [62, 65, 69, 74], [45, 50, 53, 57], 0.5],
	[30, 0, [62, 65, 69, 74], [45, 50, 53, 57], 1],
	[30, 1, [60, 64, 69], [40, 45, 48, 52], 1],
	// Tied on over the page: it rings through the held bar.
	[30, 2, [64, 67, 71, 76], [47, 52, 55, 59], 1 + 3],
];

const CHORALE: NoteEvent[] = [
	// The C under the 8ª bassa, held through 30 and the fermata.
	...at("pedal", 28, 0, [24], 12),
	...at("toll", 28, 0, [36], 1.5),
	// The right hand's top note doubles its lowest an octave up and is left
	// out: eight voices a chord, three chords deep, stole the pedal C.
	...CHORALE_CHORDS.flatMap(([bar, beat, rh, lh, dur]) => [
		...at("chorale", bar, beat, rh.length > 3 ? rh.slice(0, 3) : rh, dur),
		...at("chorale", bar, beat, lh, dur, 0.9),
	]),
];

export const CATHEDRALE: Song = {
	name: "La cathédrale engloutie",
	beatsPerBar: 3,
	parts: {
		// The held stacks: the bells in the mist, organ-soft.
		stack: {
			voice: "drone",
			level: 0.16,
			attackS: 1.2,
			// 1, not 3: each bar restrikes the chord, and three seconds of
			// tail per restrike stole the pedal at the synth's cap.
			releaseS: 1,
			detune: 0.06,
			drift: 4,
			spread: 0.8,
			pan: 0.2,
			reverb: 0.6,
		},
		// The moving chords, bowed.
		// rh and lh at 0.25 s: the quarter chords are detached, and longer
		// tails overlapped three chords deep and stole the held pedal.
		rh: {
			voice: "strings",
			level: 0.2,
			attackS: 0.12,
			releaseS: 0.25,
			unison: 3,
			cutoffHz: 1500,
			envAmount: 1.2,
			vibrato: 0.06,
			pan: 0.15,
			reverb: 0.55,
		},
		lh: {
			voice: "strings",
			level: 0.2,
			attackS: 0.1,
			releaseS: 0.25,
			unison: 3,
			cutoffHz: 900,
			envAmount: 1,
			vibrato: 0.05,
			pan: -0.2,
			reverb: 0.5,
		},
		// The tenor's marqué figure in 19–21, a desk of its own.
		motif: {
			voice: "strings",
			level: 0.26,
			attackS: 0.05,
			releaseS: 0.5,
			glideS: 0.01,
			cutoffHz: 1400,
			envAmount: 1.4,
			vibrato: 0.08,
			pan: -0.3,
			reverb: 0.45,
		},
		// The pedal notes: a low organ bed.
		pedal: {
			voice: "drone",
			level: 0.3,
			attackS: 0.8,
			releaseS: 4,
			detune: 0.04,
			drift: 3,
			spread: 0.4,
			pan: -0.05,
			reverb: 0.55,
		},
		// The bell's stroke on each pedal, low and quiet.
		toll: { voice: "tone", level: 0.05, ratio: 1.5, pan: 0, reverb: 0.6 },
		// The chorale on the string machine.
		chorale: {
			voice: "analog",
			level: 0.3,
			unison: 4,
			detune: 0.1,
			drift: 4,
			spread: 0.9,
			attackS: 0.25,
			decayS: 2,
			sustain: 0.9,
			// 0.5, not 2.5: the room carries the ring, and a longer tail held
			// voices past the synth's cap, which stole the pedal and the stack.
			releaseS: 0.5,
			cutoffHz: 1600,
			envAmount: 0.6,
			envDecayS: 2,
			vibrato: 0.03,
			pan: 0,
			reverb: 0.6,
		},
	},
	sections: [
		{
			name: "a",
			bars: 17,
			events: [...OPENING, ...EMERGE, ...DEEP, ...RISING, ...CHORALE],
		},
		// The fermata: bar 30's tied chord rings through it.
		{ name: "hold", bars: 1, events: [] },
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 16, bpm: BPM },
		{ bar: 17, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 5 },
};

/** Bars 14–29 at `BPM`, bar 30 broadening linearly (in beats) to `END_BPM`,
 *  the held bar at `END_BPM`. Three half-note beats a bar. */
export const CATHEDRALE_SECONDS =
	(16 * 3 * 60) / BPM +
	((3 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(3 * 60) / END_BPM;
