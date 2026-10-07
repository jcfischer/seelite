/**
 * The jazz waltz (`jazz.ts`) with its piano on the FreePats Upright Piano KW
 * samples (`public/music-samples/piano-upright`, CC0), the principal's first
 * choice in the blind audition of 2026-10-06. Every note is `jazz.ts`'s; only
 * the piano part changes, and it falls back to the synth `keys` it replaced
 * where the samples cannot be decoded.
 */
import type { Song } from "../music-score";
import { DANUBE_JAZZ } from "./jazz";

export const VARIANT: Song = {
	...DANUBE_JAZZ,
	name: "An der schönen blauen Donau (jazz waltz, upright piano)",
	parts: {
		...DANUBE_JAZZ.parts,
		piano: {
			voice: "sampler",
			samples: "piano-upright",
			fallback: "keys",
			level: 0.43,
			releaseS: 0.25,
			pan: 0.2,
			reverb: 0.3,
		},
	},
};
