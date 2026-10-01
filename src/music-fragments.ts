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

/**
 * Wary progressions, in the aeolian mode, one chord per eight bars: each
 * ends away from home, on the minor dominant, so the held section leans
 * back into its top.
 */
export const WARY_PROGRESSIONS: readonly (readonly number[])[] = [
	[0, 5, 6, 4],
	[0, 3, 5, 4],
	[0, 6, 3, 4],
	[0, 2, 6, 4],
];

/** Threat progressions, in the harmonic minor, one chord per four bars: the
 *  major dominant its raised seventh gives comes round again and again. */
export const THREAT_PROGRESSIONS: readonly (readonly number[])[] = [
	[0, 5, 3, 4, 5, 4],
	[0, 1, 4, 0, 5, 4],
	[0, 3, 1, 4, 0, 4],
];

/** Combat progressions, in the phrygian mode, one chord per two bars, four
 *  of them a pass: the flat second against the tonic is the fight. */
export const COMBAT_PROGRESSIONS: readonly (readonly number[])[] = [
	[0, 1, 0, 6],
	[0, 1, 3, 1],
	[0, 6, 5, 1],
	[0, 5, 6, 1],
];

/**
 * The wary bass: two bars of eighths, scale degrees above the chord's root
 * (7 an octave), `null` a rest. A figure that drives without hurrying.
 */
export const OSTINATOS: readonly (readonly (number | null)[])[] = [
	[0, null, 0, 7, null, 0, 4, null, 0, null, 0, 7, null, 5, 4, null],
	[0, 0, null, 0, 7, null, 0, null, 0, 0, null, 0, 4, null, 2, null],
	[0, null, 7, 0, null, 7, 0, 4, 0, null, 7, 0, null, 5, 4, 2],
];

/**
 * An acid bar: sixteen steps, each a scale degree above the chord's root
 * (7 an octave) or `null`, with `a` for an accent and `s` for a slide into
 * the next step.
 */
export type AcidStep = readonly [number | null, "" | "a" | "s" | "as"];
export const ACID_GROOVES: readonly (readonly AcidStep[])[] = [
	[
		[0, "a"],
		[0, ""],
		[7, ""],
		[0, ""],
		[0, ""],
		[5, "s"],
		[7, ""],
		[0, ""],
		[0, "a"],
		[0, ""],
		[3, ""],
		[0, ""],
		[7, "s"],
		[0, ""],
		[4, ""],
		[2, ""],
	],
	[
		[0, "a"],
		[null, ""],
		[0, ""],
		[7, "s"],
		[0, ""],
		[null, ""],
		[3, ""],
		[4, ""],
		[0, "a"],
		[0, ""],
		[null, ""],
		[7, ""],
		[6, "s"],
		[5, ""],
		[3, ""],
		[null, ""],
	],
	[
		[0, "a"],
		[0, ""],
		[1, ""],
		[0, ""],
		[7, ""],
		[0, ""],
		[1, "s"],
		[3, ""],
		[0, "a"],
		[null, ""],
		[0, ""],
		[1, ""],
		[5, "s"],
		[4, ""],
		[3, ""],
		[1, ""],
	],
];

/** A drum bar: sixteen steps per part, `x` a hit, `X` an accent. */
export interface KitBar {
	readonly kick: string;
	readonly snare: string;
	readonly hat: string;
}
export const COMBAT_GROOVES: readonly KitBar[] = [
	{
		kick: "x...x...x...x...",
		snare: "....X.......X...",
		hat: "x.X.x.X.x.X.x.X.",
	},
	{
		kick: "x...x..x..x.x...",
		snare: "....X.......X..x",
		hat: "x.X.x.X.xxX.x.X.",
	},
];
/** The fourth bar of every four in combat: a turn into the next phrase. */
export const COMBAT_FILLS: readonly KitBar[] = [
	{
		kick: "x...x...x.x.x.x.",
		snare: "....X...x.x.XxXX",
		hat: "x.X.x.X.xxxxxxxx",
	},
	{
		kick: "x..x..x...x.xxxx",
		snare: "....X..x..X.X.XX",
		hat: "x.x.x.x.x.x.x.x.",
	},
];
/** The threat's kit: offbeat hats, and a low tom every other bar. */
export const THREAT_KIT: KitBar = {
	kick: "x.......x.......",
	snare: "................",
	hat: "..x...x...x...x.",
};

/**
 * The third bed's material (the Berlin-school prototype): original, in the
 * manner of Tangerine Dream's sequencer records and Klaus Schulze, taking no
 * sequence, melody or progression from either (both are protected works, so
 * they give manner only, as the map's Constraints say).
 *
 * The second bed's motifs were heard as boring: four or five stepwise notes
 * in long values. These are two bars each, with repeated notes, leaps past
 * the octave and eighths and sixteenths against a long last note, so a
 * statement has a rhythm of its own and is answered (`answerOf` in
 * `music-generate-berlin.ts`) rather than left hanging.
 */
export const BERLIN_MOTIFS: readonly Motif[] = [
	{
		name: "signal",
		degrees: [4, 4, 7, 4, 3, 2, 0],
		beats: [0.75, 0.25, 1, 1, 0.5, 0.5, 4],
	},
	{
		name: "orbit",
		degrees: [0, 2, 4, 7, 9, 7, 4, 2],
		beats: [0.5, 0.5, 0.5, 0.5, 1.5, 0.5, 1, 3],
	},
	{
		name: "beacon",
		degrees: [7, 7, 7, 5, 4, 5, 2],
		beats: [0.5, 0.25, 0.25, 1, 1, 1, 4],
	},
	{
		name: "leap",
		degrees: [0, 7, 6, 4, 2, 4, 0, -1],
		beats: [1, 1.5, 0.5, 1, 0.5, 0.5, 1, 2],
	},
	{
		name: "drift",
		degrees: [2, 3, 2, 0, 4, 3, 2, 1],
		beats: [0.75, 0.75, 0.5, 2, 0.75, 0.75, 0.5, 2],
	},
	{
		name: "flare",
		degrees: [0, 4, 7, 11, 9, 7],
		beats: [0.5, 0.5, 0.5, 0.5, 2, 4],
	},
	{
		name: "relay",
		degrees: [4, 2, 4, 2, 5, 4, 2, 0],
		beats: [0.5, 0.5, 0.5, 0.5, 1, 1, 1, 3],
	},
	{
		name: "rise",
		degrees: [-3, 0, 2, 4, 2, 4, 7],
		beats: [1, 0.5, 0.5, 1, 0.5, 0.5, 4],
	},
];

/**
 * The running sequence: sixteen sixteenths a bar, scale degrees above the
 * chord's root (7 an octave), `null` a rest. Transposed with the harmony and
 * mutated a step at a time as it runs, as a player at a step sequencer would.
 */
export const SEQUENCES: readonly (readonly (number | null)[])[] = [
	[0, 7, 4, 7, 2, 7, 4, 7, 0, 7, 4, 7, 5, 4, 2, 4],
	[0, 0, 7, 0, 4, 0, 9, 0, 0, 0, 7, 0, 11, 9, 7, 4],
	[0, 4, 7, 4, 9, 7, 4, 7, 0, 4, 7, 4, 11, 9, 7, 9],
	[0, 2, 4, 0, 7, 4, 2, 4, 0, 2, 4, 0, 9, 7, 4, 2],
	[7, 0, 4, 0, 7, 0, 5, 0, 7, 0, 4, 0, 9, 0, 7, 4],
	[0, null, 7, 0, 4, null, 7, 5, 0, null, 7, 0, 4, 2, -1, 2],
];

/** The high counter-sequence: an odd length run in sixteenths, so it phases
 *  against the bar and the running sequence and lines up again only after
 *  that many bars. */
export const ODD_SEQUENCES: readonly (readonly number[])[] = [
	[0, 4, 7, 9, 4],
	[7, 4, 2, 4, 9, 7],
	[0, 2, 4, 7, 4, 2, 9],
	[11, 7, 4, 7, 9],
];

/** The bass pulse: eight eighths a bar above the chord's root, 7 an octave. */
export const PULSES: readonly (readonly number[])[] = [
	[0, 7, 0, 7, 0, 7, 0, 7],
	[0, 0, 7, 0, 0, 7, 0, 7],
	[0, 7, 0, 7, 0, 7, 4, 7],
];
