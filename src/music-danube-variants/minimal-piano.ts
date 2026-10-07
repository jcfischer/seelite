/**
 * The minimal version (`minimal.ts`) for pianos alone, as *Piano Phase* is:
 * every part on the FreePats Upright Piano KW samples
 * (`public/music-samples/piano-upright`, CC0), the principal's first choice
 * in the blind audition of 2026-10-06. Every note is `minimal.ts`'s; the two
 * phasing parts are two pianos, hard left and right, and each part falls back
 * to the synth voice it replaced where the samples cannot be decoded.
 */
import type { PartSpec, Song } from "../music-score";
import { DANUBE_MINIMAL } from "./minimal";

/** One piano: dry, so a pattern never rings into a chord bed — the fault
 *  the principal heard twice in `minimal.ts`. */
const upright = (
	level: number,
	pan: number,
	fallback: PartSpec["fallback"],
	releaseS = 0.12,
): PartSpec => ({
	voice: "sampler",
	samples: "piano-upright",
	fallback,
	level,
	releaseS,
	pan,
	reverb: 0.12,
});

export const VARIANT: Song = {
	...DANUBE_MINIMAL,
	name: "An der schönen blauen Donau (minimal, pianos)",
	parts: {
		...DANUBE_MINIMAL.parts,
		piano: upright(0.6, -0.1, "epiano"),
		phaseA: upright(0.54, -0.6, "fm"),
		phaseB: upright(0.54, 0.6, "fm"),
		pulse: upright(0.45, 0, "keys"),
		melody: upright(0.9, 0, "softsaw", 0.35),
	},
};
