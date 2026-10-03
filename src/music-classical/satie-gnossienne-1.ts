/**
 * Erik Satie, *Gnossienne* No. 1 (1890), hand-encoded as note data (#589) —
 * a public-domain composition, synthesised at runtime, nothing downloaded or
 * recorded.
 *
 * **Encoded from the Rouart, Lerolle et Cie first edition** (Paris, 1913,
 * R.L. 9884 & Cie; IMSLP #920505): the PDF's page 2, the first page of music, its
 * first four systems — the *Lent* opening, the second statement at *p*, and
 * the *Très luisant* section with its repeat, up to the bar before
 * *Questionnez*. Every pitch below was read off that page.
 *
 * **The page has no bar lines; the grid here is 4/4.** The left hand gives
 * it: a whole-note bass on the first beat, a quarter rest, a half-note chord
 * on the second and a quarter-note chord on the fourth, repeating without
 * exception through the excerpt. Each such group is one bar here, a quarter
 * per beat — 26 bars. Tempo: *Lent*, a quarter at 74, slowing over the last
 * bar to 58, where one added bar holds the final F.
 *
 * **Re-voiced, not on `keys`.** The principal heard keys and plucks as
 * *plinky* in the waltz, and the piece is a single, ornamented, sustained
 * line over a slow rocking bass — a wind line more than a struck one. So:
 * the melody on `flute`, legato, its grace notes on a desk of their own with
 * the same sound (so the pinned line stays the line); the left hand's chords
 * on a soft, dark `strings` desk; the bass on a low bowed desk.
 *
 * **Where the arrangement reduces the page.** The grace notes (small
 * slashed eighths) are played just before their beat, a tenth of a beat
 * long, and the note before one is shortened to end where it begins. Ties
 * are one long note. The dynamics are *p* and *f* as printed, the *f* as a
 * modest rise. Harmony, read off the left hand: F minor (F2; A-flat 3, C4,
 * F4), C minor in bars 7 and 16 (C3; E-flat 3, G3, C4), B-flat minor in the
 * *Très luisant* bars 19–20 and 23–24 (B-flat 1; F3, B-flat 3, D-flat 4).
 *
 * Imports only the score's types and the notation helpers, so it is data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** *Lent*: quarters a minute. */
const BPM = 74;
/** Where the last printed bar slows to, and the added held bar stays. */
const END_BPM = 58;

const BARS = 26;
const RING_BARS = 1;
const RING = RING_BARS * 4;

/** How far before its beat a grace note starts, and how long it lasts. */
const GRACE_LEAD = 0.12;
const GRACE_DUR = 0.1;

// ── The left hand ──────────────────────────────────────────────────────────

type Harmony = readonly [number, readonly number[]];
const FM: Harmony = [41, [56, 60, 65]];
const CM: Harmony = [48, [51, 55, 60]];
const BBM: Harmony = [34, [53, 58, 61]];

/** Per printed bar, 1–26. */
const HARMONY: readonly Harmony[] = [
	FM,
	FM,
	FM,
	FM,
	FM,
	FM,
	CM,
	FM,
	FM, // 1–9
	FM,
	FM,
	FM,
	FM,
	FM,
	FM,
	CM,
	FM,
	FM, // 10–18
	BBM,
	BBM,
	FM,
	FM, // 19–22, Très luisant
	BBM,
	BBM,
	FM,
	FM, // 23–26
];

/** Loudness by printed bar (1-based): *p*, *f* at 8, *p* at 10, *f* at 17 and 19. */
const dynPrinted = (bar: number) =>
	bar < 8 ? 0.45 : bar < 10 ? 0.58 : bar < 17 ? 0.45 : bar < 19 ? 0.58 : 0.6;
const dyn = (bar: number) => dynPrinted(bar + 1);

const LEFT_HAND: NoteEvent[] = HARMONY.flatMap(([bass, top], i) => {
	const last = i === HARMONY.length - 1;
	return [
		...line("bass", [[i, 0, bass, 4 + (last ? RING : 0)]], dyn(i)),
		...chord("chords", i, 1, top, 2, dyn(i) * 0.8),
		...chord("chords", i, 3, top, 1 + (last ? RING : 0), dyn(i) * 0.75),
	];
});

// ── The melody ─────────────────────────────────────────────────────────────

/** `[printed bar, beat, pitch, beats, grace pitch?]`. */
type Note = readonly [number, number, number, number, number?];

/** The phrase that opens bars 1, 3, 5, 10, 12 and 14: C5 E-flat 5 D5 C5. */
const turn = (p: number): Note[] => [
	[p, 1, 72, 0.5],
	[p, 1.5, 75, 0.5],
	[p, 2, 74, 1], // D-natural 5
	[p, 3, 72, 1],
];
/** Two halves, each after its grace. */
const halves = (
	p: number,
	a: [number, number],
	b: [number, number],
): Note[] => [
	[p, 0, a[1], 2, a[0]],
	[p, 2, b[1], 2, b[0]],
];
/** The G4 quarter and the long F4 of bars 8, 17, 21 and 25. */
const toF = (p: number, extra = 0): Note[] => [
	[p, 0, 67, 1, 68],
	[p, 1, 65, 7 + extra, 67],
];
/** The eight bars that open the piece and its second statement. */
const statement = (p: number): Note[] => [
	...turn(p),
	...halves(p + 1, [72, 71], [72, 71]), // C5 → B-natural 4, twice
	...turn(p + 2),
	...halves(p + 3, [76, 77], [76, 77]), // E-natural 5 → F5, twice
	...turn(p + 4),
	...halves(p + 5, [72, 71], [68, 67]), // C5 → B-natural 4, A-flat 4 → G4
	[p + 6, 0, 67, 1, 65], // F4 → G4
	[p + 6, 1, 67, 2.5, 65], // F4 → G4, tied to an eighth
	...toF(p + 7),
];
/** A *Très luisant* bar: A-flat 4 → B-flat 4, A-flat 4 → G4. */
const luisant = (p: number): Note[] => halves(p, [68, 70], [68, 67]);

const MELODY: readonly Note[] = [
	...statement(1), // 1–9
	...statement(10), // 10–18
	...luisant(19),
	...luisant(20),
	...toF(21), // 21–22
	...luisant(23),
	...luisant(24),
	...toF(25, RING), // 25–26, held
];

/** Beats from the start, for placing a grace before a beat. */
const abs = (bar: number, beat: number) => bar * 4 + beat;
const at = (t: number) => [Math.floor(t / 4), t - Math.floor(t / 4) * 4];

const graceOnsets = MELODY.filter((n) => n[4] !== undefined).map(
	([p, beat]) => abs(p - 1, beat) - GRACE_LEAD,
);

const MELODY_EVENTS: NoteEvent[] = MELODY.flatMap(
	([p, beat, pitch, dur, grace]) => {
		const t = abs(p - 1, beat);
		// A note before a grace ends where the grace begins.
		const cut = graceOnsets.find((g) => g > t && g < t + dur);
		const out = line(
			"melody",
			[[p - 1, beat, pitch, cut === undefined ? dur : cut - t]],
			dyn,
		);
		if (grace !== undefined) {
			const [gb, gbeat] = at(t - GRACE_LEAD);
			out.push(
				...line("grace", [[gb, gbeat, grace, GRACE_DUR]], (b) => dyn(b) * 0.8),
			);
		}
		return out;
	},
);

const MELODY_PART: PartSpec = {
	voice: "flute",
	level: 0.34,
	attackS: 0.08,
	releaseS: 0.7,
	glideS: 0.02,
	index: 0.25,
	vibrato: 0.09,
	pan: -0.1,
	reverb: 0.5,
};

const PARTS: Readonly<Record<string, PartSpec>> = {
	melody: MELODY_PART,
	grace: { ...MELODY_PART, attackS: 0.01, releaseS: 0.1, glideS: 0 },
	// The left hand's chords: a muted, dark desk.
	chords: {
		voice: "strings",
		level: 0.13,
		attackS: 0.2,
		releaseS: 0.8,
		unison: 3,
		cutoffHz: 850,
		envAmount: 0.8,
		vibrato: 0.05,
		pan: 0.2,
		reverb: 0.55,
	},
	// The whole-note bass: low and long.
	bass: {
		voice: "strings",
		level: 0.3,
		attackS: 0.15,
		releaseS: 1,
		cutoffHz: 500,
		envAmount: 0.8,
		vibrato: 0,
		pan: -0.05,
		reverb: 0.4,
	},
};

export const GNOSSIENNE: Song = {
	name: "Gnossienne No. 1",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "a",
			bars: BARS + RING_BARS,
			events: [...MELODY_EVENTS, ...LEFT_HAND],
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 25, bpm: BPM },
		{ bar: 26, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4 },
};

/** Bars 1–25 steady, bar 26 slowing linearly, the held bar at the end. */
export const GNOSSIENNE_SECONDS =
	(25 * 4 * 60) / BPM +
	((4 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(RING_BARS * 4 * 60) / END_BPM;
