/**
 * The authored half of the generative bed (#548 D12): motifs, progressions
 * and arpeggio shapes that a system's seed picks from and develops.
 *
 * **Original material.** Written for seelite in the manner of the principal's
 * references — Elite Dangerous's ambient cues, Vangelis, No Man's Sky — and
 * taking no melody, progression or rhythm from any of them (the references
 * are other people's compositions; #560 D9 rules the same for the synth's
 * code). Every pitch here is a **scale degree** of whatever mode the level is
 * in, 0 the tonic, so one fragment serves every system's key and mode.
 *
 * A leaf: data and types only, imported by `music-generate.ts`.
 */

/** A motif: scale degrees and their lengths in beats. */
export interface Motif {
	readonly name: string;
	readonly degrees: readonly number[];
	readonly beats: readonly number[];
}

/**
 * Short cells a system's theme is grown from. Long notes and wide intervals
 * for space; each is one breath, four to eight beats, so a statement leaves
 * room around it.
 */
export const MOTIFS: readonly Motif[] = [
	{ name: "call", degrees: [0, 3, 4, 2], beats: [2, 1, 3, 2] },
	{ name: "sigh", degrees: [4, 3, 1, 0], beats: [1.5, 0.5, 2, 4] },
	{ name: "hover", degrees: [2, 4, 2, 1, 2], beats: [1, 1, 1, 1, 4] },
	{ name: "open", degrees: [0, 4, 7, 6, 4], beats: [1, 1, 2, 1, 3] },
	{ name: "ask", degrees: [0, 1, 2, 4], beats: [2, 1, 1, 4] },
	{ name: "wide", degrees: [7, 4, 5, 2], beats: [3, 1, 2, 2] },
	{ name: "turn", degrees: [2, 1, 2, 4, 3], beats: [1, 0.5, 0.5, 2, 4] },
	{ name: "descent", degrees: [5, 4, 2, 1, 0], beats: [1, 1, 1, 1, 4] },
];

/**
 * Calm progressions, as scale degrees of the system's bright mode, one chord
 * per eight bars. Each starts home; the generator ends the section's second
 * pass on the dominant, so the held loop leans back into its own top.
 */
export const CALM_PROGRESSIONS: readonly (readonly number[])[] = [
	[0, 3, 5, 4],
	[0, 1, 5, 3],
	[0, 4, 5, 3],
	[0, 5, 3, 1],
	[0, 2, 3, 4],
	[0, 3, 1, 4],
];

/** The chord a calm section's second pass substitutes on its third chord,
 *  by the chord it replaces: a relative, so the harmony moves on the repeat. */
export const CALM_SUBSTITUTE: Readonly<Record<number, number>> = {
	0: 5,
	1: 3,
	2: 0,
	3: 1,
	4: 2,
	5: 3,
	6: 4,
};

/** Arpeggio shapes for the cruise stem: indices into a chord's tones, one
 *  per eighth of a bar. */
export const ARP_SHAPES: readonly (readonly number[])[] = [
	[0, 1, 2, 3, 2, 1, 0, 2],
	[0, 2, 1, 3, 0, 2, 1, 3],
	[3, 2, 1, 0, 1, 2, 3, 1],
	[0, 1, 2, 1, 3, 1, 2, 1],
];

/** How a motif is developed on its successive statements (D12): the form a
 *  calm section walks, one entry per statement, repeating. */
export type Development =
	| "theme"
	| "transposed"
	| "inverted"
	| "augmented"
	| "fragment"
	| "retrograde";

export const CALM_FORM: readonly Development[] = [
	"theme",
	"transposed",
	"theme",
	"inverted",
	"augmented",
	"fragment",
	"theme",
	"retrograde",
	"transposed",
];
