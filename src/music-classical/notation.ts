/**
 * Notation helpers for #589's classical set-pieces: the Danube's `line` and
 * `chord` (`music-danube.ts`), shared so every work is written the same way.
 * Imports only the score's types, so every work stays data and nothing else.
 */
import type { NoteEvent } from "../music-score";

/** A melody: `[bar, beat, pitch, dur]` per note. */
export const line = (
	part: string,
	notes: readonly (readonly [number, number, number, number])[],
	vel: number | ((bar: number) => number),
): NoteEvent[] =>
	notes.map(([bar, beat, pitch, dur]) => ({
		part,
		bar,
		beat,
		dur,
		pitch,
		vel: typeof vel === "number" ? vel : vel(bar),
	}));

/** A chord: every pitch at one time. */
export const chord = (
	part: string,
	bar: number,
	beat: number,
	pitches: readonly number[],
	dur: number,
	vel: number,
): NoteEvent[] =>
	pitches.map((pitch) => ({ part, bar, beat, dur, pitch, vel }));
