/**
 * The helpers the 4/4 versions of the docking waltz share
 * (`music-danube-variants/`): the re-metre of a waltz position onto a 4/4
 * bar, and the turn from D major to D minor. One copy, so a change to the
 * 3-3-2 grid is one edit (sage, #738 round 1).
 *
 * **Outside the variants folder on purpose:** the loader
 * (`music-danube-variants.ts`) globs that folder and takes every module in
 * it for a version, so a module of helpers there would be read as one.
 *
 * Imports only the score's types, so it is data and nothing else.
 */
import type { NoteEvent } from "./music-score";

/** D major's F# and B lowered: D minor, its C# kept as the leading tone. */
export const minor = (p: number): number => {
	const pc = ((Math.round(p) % 12) + 12) % 12;
	return pc === 6 || pc === 11 ? p - 1 : p;
};

/** A waltz position in 4/4 beats from the section's start: two waltz bars a
 *  4/4 bar, a waltz bar's beats on the 3-3-2 sixteenth grid. */
export const fourBeats = (waltzBeats: number): number => {
	const bar = Math.floor(waltzBeats / 3);
	const w = waltzBeats - bar * 3;
	return bar * 2 + (w < 2 ? w * 0.75 : 1.5 + (w - 2) * 0.5);
};

/** One note at an absolute 4/4 beat of its section. */
export const at = (
	part: string,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({
	part,
	bar: Math.floor(beat / 4),
	beat: beat - Math.floor(beat / 4) * 4,
	dur,
	pitch,
	vel,
});

/** A note written in waltz time, re-metred. */
export const fromWaltz = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => {
	const from = fourBeats(bar * 3 + beat);
	return at(part, from, fourBeats(bar * 3 + beat + dur) - from, pitch, vel);
};
