/**
 * Solo-piano versions of the set-pieces that are piano works on the page —
 * Satie's *Gymnopédie* and *Gnossienne*, Debussy's "Clair de lune" and "La
 * cathédrale engloutie" — by the principal's choice (2026-10-06): *"ambient,
 * and the satie / debussy pieces"*. Each version takes its work's own events
 * and moves them onto a piano; nothing is re-encoded.
 *
 * The piano is the six-layer stereo Salamander (`piano-grand-rich`,
 * CC BY 3.0, map #1's ruling on open-licensed music samples), falling back to
 * the synth `keys` where the samples cannot be decoded.
 *
 * Imports only the score's types, so every version stays data.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";

/** The sample set every piano version plays. */
export const PIANO_SET = "piano-grand-rich";

/** One hand, or one voice of it, on the piano. */
export const pianoPart = (
	level: number,
	pan: number,
	releaseS = 0.3,
	reverb = 0.25,
): PartSpec => ({
	voice: "sampler",
	samples: PIANO_SET,
	fallback: "keys",
	level,
	releaseS,
	pan,
	reverb,
});

/**
 * The sustain pedal, as a pianist uses it under a bar of one harmony: every
 * note of `parts` rings to the end of its bar, or until the same key is
 * struck again in the same part, whichever is first — a struck key restarts
 * its string rather than adding a second. A note already longer keeps its
 * length. `beatsPerBar` is the song's.
 */
export function pedal(
	events: readonly NoteEvent[],
	parts: ReadonlySet<string>,
	beatsPerBar: number,
): NoteEvent[] {
	const at = (e: NoteEvent) => e.bar * beatsPerBar + e.beat;
	return events.map((e) => {
		if (!parts.has(e.part)) return e;
		const start = at(e);
		const barEnd = (e.bar + 1) * beatsPerBar;
		const restrike = events
			.filter(
				(o) =>
					o !== e && o.part === e.part && o.pitch === e.pitch && at(o) > start,
			)
			.reduce((m, o) => Math.min(m, at(o)), Number.POSITIVE_INFINITY);
		const end = Math.min(barEnd, restrike);
		return end - start > e.dur ? { ...e, dur: end - start } : e;
	});
}

/**
 * A work on the piano: its events re-parted by `map` (a part mapped to
 * `null` is dropped, as the arrangement added it and the page does not
 * print it), the pedal applied to `pedalled`, and `parts` the new parts.
 */
export function onPiano(
	song: Song,
	o: {
		readonly name: string;
		readonly map: Readonly<Record<string, string | null>>;
		readonly pedalled: readonly string[];
		readonly parts: Readonly<Record<string, PartSpec>>;
		readonly reverbS: number;
	},
): Song {
	const pedalled = new Set(o.pedalled);
	return {
		...song,
		name: o.name,
		parts: o.parts,
		sections: song.sections.map((s) => {
			const moved = s.events.flatMap((e) => {
				if (!(e.part in o.map))
					throw new Error(`${song.name}: no piano part for "${e.part}"`);
				const to = o.map[e.part];
				return to === null ? [] : [{ ...e, part: to }];
			});
			return { ...s, events: pedal(moved, pedalled, song.beatsPerBar) };
		}),
		space: { ...song.space, reverbS: o.reverbS },
	};
}
