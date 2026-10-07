/**
 * The jazz waltz's changes (`music-danube-variants/jazz.ts`): one chord a bar
 * of Waltz No. 1, the chord tones of each quality, and how the piano voices
 * and the bass roots them. The bossa comps the same changes a semitone lower.
 *
 * **Outside the variants folder on purpose**, as `music-danube-remeter.ts`
 * is: the loader globs that folder and loads each module on its own so one
 * that throws hides no other, and a version importing a sibling would undo
 * that (sage, #738 round 2).
 *
 * Imports nothing, so it is data and nothing else.
 */

/** Chord tones above the root, in semitones, by quality. */
export const QUALITY = {
	maj9: [4, 7, 11, 14],
	m9: [3, 7, 10, 14],
	m7: [3, 7, 10],
	"13": [4, 10, 14, 21],
	"9": [4, 10, 14],
	"7#9": [4, 10, 15],
	"69": [4, 9, 14],
} as const;
export type Quality = keyof typeof QUALITY;

/** A bar's chord: its root as a pitch class (0 = C), and its quality. */
export type Change = readonly [number, Quality];
export const D = 2;
export const E = 4;
export const G = 7;
export const A = 9;
export const B = 11;

/** The piano's voicing: every chord tone folded into the octave from
 *  `floor`, rootless — F3–F#4 by default; the bossa comps a semitone lower. */
export const voicing = ([root, q]: Change, floor = 53): number[] =>
	[
		...new Set(QUALITY[q].map((i) => floor + ((root + i - floor + 120) % 12))),
	].sort((a, b) => a - b);

/** The bass's root, folded into A1–G#2. */
export const bassRoot = ([root]: Change): number => 33 + ((root - 9 + 12) % 12);

/**
 * One chord a bar of Waltz No. 1, by its bar in `THEME` (bar 0 is the
 * upbeat). The tune's long notes sit on chord tones or on the ninth and
 * thirteenth; the original's four-bar blocks of D and A7 become ii–V–I.
 */
export const CHANGES: readonly Change[] = [
	[A, "13"], // the upbeat
	[D, "maj9"],
	[D, "maj9"],
	[B, "m9"],
	[B, "m9"],
	[E, "m9"],
	[E, "m9"],
	[A, "13"],
	[A, "13"],
	[E, "m9"],
	[E, "m9"],
	[A, "13"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[G, "maj9"],
	[G, "maj9"],
	[G, "maj9"],
	[E, "m7"],
	[A, "9"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[D, "69"],
];
