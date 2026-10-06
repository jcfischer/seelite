/**
 * Satie's *1ère Gymnopédie* on the piano it was written for: the events of
 * `satie-gymnopedie-1.ts` — every pitch read off the 1895 edition — moved
 * from the flute and strings back to two hands (`piano.ts`).
 *
 * - **Kept, as printed:** the melody (right hand), and the left hand's
 *   dotted-half bass and its half-note chord on beats 2–3, each bar.
 * - **Dropped:** nothing; the strings version adds no part the page lacks.
 * - **The pedal:** Satie's left hand already lasts its bar on the page — the
 *   bass a dotted half, the chord to the bar line — which is what the pedal
 *   holds, so `pedal` lengthens nothing here; the melody is left to the
 *   damper, as a legato line under a changing pedal is.
 */
import type { Song } from "../music-score";
import { onPiano, pianoPart } from "./piano";
import { GYMNOPEDIE } from "./satie-gymnopedie-1";

export const GYMNOPEDIE_PIANO: Song = onPiano(GYMNOPEDIE, {
	name: "Gymnopédie No. 1 (piano)",
	map: { melody: "rh", chords: "lh", bass: "lh" },
	pedalled: ["lh"],
	parts: { rh: pianoPart(1, -0.05, 0.35), lh: pianoPart(0.69, 0.1, 0.4) },
	reverbS: 2.4,
});

export { GYMNOPEDIE_SECONDS as GYMNOPEDIE_PIANO_SECONDS } from "./satie-gymnopedie-1";
