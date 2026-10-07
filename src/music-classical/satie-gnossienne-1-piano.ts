/**
 * Satie's *Gnossienne* No. 1 on the piano: the events of
 * `satie-gnossienne-1.ts` — every pitch read off the 1913 first edition —
 * moved from the flute and strings back to two hands (`piano.ts`).
 *
 * - **Kept, as printed:** the ornamented melody and its grace notes (right
 *   hand; the graces stay a tenth of a beat before their note, as the
 *   strings version places them), and the left hand's whole-note bass with
 *   its half- and quarter-note chords.
 * - **Dropped:** nothing; the strings version adds no part the page lacks.
 * - **The pedal:** the left hand rings to its bar line or to the next stroke
 *   of the same key (`pedal`); the bass already holds the bar, and the
 *   chord on beat 2 is restruck on beat 4, so the pedal joins the two
 *   chords without doubling a string.
 */
import type { Song } from "../music-score";
import { onPiano, pianoPart } from "./piano";
import { GNOSSIENNE } from "./satie-gnossienne-1";

export const GNOSSIENNE_PIANO: Song = onPiano(GNOSSIENNE, {
	name: "Gnossienne No. 1 (piano)",
	map: { melody: "rh", grace: "rh", chords: "lh", bass: "lh" },
	pedalled: ["lh"],
	parts: { rh: pianoPart(1, -0.05, 0.3), lh: pianoPart(0.69, 0.1, 0.4) },
	reverbS: 2.4,
});

export { GNOSSIENNE_SECONDS as GNOSSIENNE_PIANO_SECONDS } from "./satie-gnossienne-1";
