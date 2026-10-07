/**
 * The jazz waltz (`jazz.ts`) as a piano trio — piano, bass and drums — the
 * principal's O19 (2026-10-06): *"it could use more piano"*. Every note is
 * `jazz.ts`'s, moved between parts rather than rewritten:
 *
 * - the vibes' tune is the piano's right hand, doubled an octave down
 *   through the ff bars, as a trio pianist takes a climax in octaves;
 * - the piano's comping is its left hand;
 * - the flute's answers are gone, as a trio has no flute;
 * - the bass is a pizzicato double bass (`bass-pizz`, D. Smolken, CC0);
 * - the drums are unchanged.
 *
 * The piano is the six-layer stereo Salamander (`piano-grand-rich`,
 * CC BY 3.0), the principal's choice for it. Each sampled part falls back to
 * the synth voice it replaced where the samples cannot be decoded.
 */

import { pianoPart } from "../music-classical/piano";
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { DANUBE_JAZZ } from "./jazz";

/** One hand on the piano: the classical pieces' part, a touch more room. */
const piano = (level: number, pan: number, releaseS: number): PartSpec =>
	pianoPart(level, pan, releaseS, 0.28);

/** The waltz bars played ff (`jazz.ts`'s `dyn`): the tune in octaves. */
const OCTAVES = { from: 25, to: 30 };

/** One section's events moved into the trio's parts. */
const trio = (section: string, events: readonly NoteEvent[]): NoteEvent[] =>
	events.flatMap((e) => {
		if (e.part === "answer") return [];
		if (e.part === "vibes") {
			const rh = { ...e, part: "rh" };
			const octave =
				section === "waltz" &&
				e.bar >= OCTAVES.from &&
				e.bar <= OCTAVES.to &&
				e.dur > 0.2;
			return octave
				? [rh, { ...rh, pitch: e.pitch - 12, vel: e.vel * 0.8 }]
				: [rh];
		}
		if (e.part === "piano") return [{ ...e, part: "lh" }];
		return [e];
	});

const {
	vibes: _vibes,
	answer: _answer,
	piano: _piano,
	...rest
} = DANUBE_JAZZ.parts;

export const VARIANT: Song = {
	...DANUBE_JAZZ,
	name: "An der schönen blauen Donau (jazz waltz, piano trio)",
	parts: {
		...rest,
		rh: piano(0.98, -0.05, 0.3),
		lh: piano(0.59, 0.15, 0.2),
		bass: {
			voice: "sampler",
			samples: "bass-pizz",
			fallback: "pluck",
			level: 1,
			releaseS: 0.3,
			reverb: 0.08,
		},
	},
	sections: DANUBE_JAZZ.sections.map((s) => ({
		...s,
		events: trio(s.name, s.events),
	})),
};
