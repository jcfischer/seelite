/**
 * Debussy's "Clair de lune" on the piano: the events of
 * `debussy-clair-de-lune.ts` — bars 1–14 read off the 1905 plates — moved
 * from the four string desks back to two hands (`piano.ts`).
 *
 * - **Kept, as printed:** the top line and the right hand's under-voice (the
 *   falling thirds, then the inner line), the left hand's chords and the
 *   bass-clef low notes of bars 8–14, and the held last bar.
 * - **Dropped:** nothing; the strings version adds no part the page lacks.
 * - **The pedal:** the left hand rings to its bar line or its next stroke of
 *   the same key (`pedal`), so the bar-9 arpeggio up from the bass holds as
 *   a chord, as the pedal under it does. The right hand keeps its printed
 *   lengths, which the page already ties long.
 */
import type { Song } from "../music-score";
import { CLAIR_DE_LUNE } from "./debussy-clair-de-lune";
import { onPiano, pianoPart } from "./piano";

export const CLAIR_DE_LUNE_PIANO: Song = onPiano(CLAIR_DE_LUNE, {
	name: "Clair de lune (piano)",
	map: { melody: "rh", inner: "inner", lh: "lh", bass: "lh" },
	pedalled: ["lh"],
	parts: {
		rh: pianoPart(1, -0.05, 0.4),
		inner: pianoPart(0.69, 0.05, 0.4),
		lh: pianoPart(0.69, 0.1, 0.5),
	},
	reverbS: 2.4,
});

export { CLAIR_DE_LUNE_SECONDS as CLAIR_DE_LUNE_PIANO_SECONDS } from "./debussy-clair-de-lune";
