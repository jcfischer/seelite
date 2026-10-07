/**
 * The ambient version (`ambient.ts`) with its tune on a sampled grand: the
 * six-layer stereo Salamander (`piano-grand-rich`, CC BY 3.0), the
 * principal's piano for the jazz trio, asked for here on 2026-10-06. Every
 * note is `ambient.ts`'s; only the piano part changes. It keeps the synth
 * piano's long release and its sends into the room and the echo, so the
 * piano still rings into the drone, and it falls back to the synth `keys`
 * where the samples cannot be decoded.
 */
import type { Song } from "../music-score";
import { VARIANT as DANUBE_AMBIENT } from "./ambient";

export const VARIANT: Song = {
	...DANUBE_AMBIENT,
	name: "An der schönen blauen Donau (ambient, grand piano)",
	parts: {
		...DANUBE_AMBIENT.parts,
		piano: {
			voice: "sampler",
			samples: "piano-grand-rich",
			fallback: "keys",
			level: 0.9,
			releaseS: 2,
			reverb: 0.8,
			echo: 0.4,
		},
	},
};
