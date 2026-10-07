/**
 * Debussy's "La cathédrale engloutie" on the piano: the events of
 * `debussy-cathedrale.ts` — bars 14–30 read off the Durand pages — moved
 * from the organ-like bed back to two hands (`piano.ts`).
 *
 * - **Kept, as printed:** the held stacks and the chorale (`held`), the
 *   moving quarter chords (`rh`), the left hand's rocking fifths, arpeggios
 *   and the tenor's marqué figure (`lh`), and the pedal notes (`bass`) held
 *   across the bars the pianist's pedal carries them, as the strings version
 *   already holds them.
 * - **Dropped:** the `toll` — a low `tone` the arrangement struck under each
 *   pedal for a bell. The page prints no such note; on the piano the struck
 *   pedal octave is the bell.
 * - **The pedal:** not by lengthening. The quarter chords move over held
 *   stacks and a held bass, and holding each to its bar line would stack
 *   more strings than the synth's voices, which steals the oldest — the held
 *   bass. So the moving parts get a longer damper release instead, a half
 *   pedal, while the stacks and the bass keep the lengths the strings
 *   version gave them.
 */
import type { Song } from "../music-score";
import { CATHEDRALE } from "./debussy-cathedrale";
import { onPiano, pianoPart } from "./piano";

export const CATHEDRALE_PIANO: Song = onPiano(CATHEDRALE, {
	name: "La cathédrale engloutie (piano)",
	map: {
		stack: "held",
		chorale: "held",
		rh: "rh",
		lh: "lh",
		motif: "lh",
		pedal: "bass",
		toll: null,
	},
	pedalled: [],
	parts: {
		held: pianoPart(0.49, 0.1, 0.8),
		rh: pianoPart(0.45, 0.15, 0.5),
		lh: pianoPart(0.45, -0.15, 0.5),
		bass: pianoPart(0.57, -0.05, 1.2),
	},
	reverbS: 2.5,
});

export { CATHEDRALE_SECONDS as CATHEDRALE_PIANO_SECONDS } from "./debussy-cathedrale";
