/**
 * The Blue Danube as minimalism, after Reich's *Piano Phase* and Glass's
 * additive process: a listening spike beside the docking computer's waltz
 * (`music-danube.ts`), on the same synth.
 *
 * **Strauss's tune, unrolled into cells.** The waltz module's `THEME` is cut
 * into consecutive cells of twelve notes (`CELLS`), and each cell is played
 * as twelve straight sixteenths — one 3/4 bar — over and over, so the tune
 * is still heard in order, a cell at a time, at four times its note rate.
 *
 * Three processes run on each cell's six bars:
 *
 * - **Additive** — the first keyboard builds the cell up: four notes, then
 *   six, eight, ten, and all twelve, the rest of each bar silent.
 * - **Phasing** — the second keyboard enters on the third bar, in unison,
 *   and pulls ahead by written offsets until it is one sixteenth early;
 *   at the next cell it is rotated by one note and starts again from
 *   there, so each cell is heard against itself one step further out of
 *   phase than the last.
 * - **Held harmony** — the waltz's own pad chords (`HARMONY`) under the
 *   cell, and an eighth-note pulse on the root from the second cell.
 *
 * The form keeps the waltz's contract: an intro (the horn's call as an
 * arpeggio cell, built up the same way), the cells of Waltz No. 1 looping,
 * and a `resolve` to the cadence, where the two keyboards fall back into
 * unison on the tonic.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const MINIMAL_BPM = 132;

/** Bars per cell: the additive build and one sixteenth of phase. */
const CELL_BARS = 6;
const CELL_LEN = 12;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Two keyboards, each a short struck tone, one to each side.
	a: {
		voice: "keys",
		level: 0.55,
		attackS: 0.002,
		decayS: 0.7,
		sustain: 0,
		releaseS: 0.15,
		ratio: 1.0,
		index: 0.7,
		pan: -0.5,
		reverb: 0.25,
	},
	b: {
		voice: "keys",
		level: 0.5,
		attackS: 0.002,
		decayS: 0.7,
		sustain: 0,
		releaseS: 0.15,
		ratio: 1.002,
		index: 0.8,
		pan: 0.5,
		reverb: 0.25,
	},
	// The held harmony: an organ-like pad, slow in, slow out.
	pad: {
		voice: "pad",
		level: 0.225,
		attackS: 0.8,
		decayS: 2,
		sustain: 0.85,
		releaseS: 1.2,
		cutoffHz: 1200,
		reverb: 0.4,
	},
	// The pulse: the root in eighths, low and short.
	pulse: {
		voice: "keys",
		level: 0.45,
		attackS: 0.002,
		decayS: 0.35,
		sustain: 0,
		releaseS: 0.08,
		ratio: 1.0,
		index: 0.5,
		reverb: 0.15,
	},
};

const note = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

/** A note at an absolute sixteenth position, `from` sixteenths in. */
const at16 = (
	part: string,
	pos: number,
	pitch: number,
	vel: number,
): NoteEvent => {
	const beat = Math.max(0, pos) / 4;
	const bar = Math.floor(beat / 3 + 1e-9);
	return note(part, bar, Math.max(0, beat - bar * 3), 0.22, pitch, vel);
};

/** Twelve consecutive notes of the theme, from note `from`. */
const cellFrom = (from: number): number[] =>
	Array.from(
		{ length: CELL_LEN },
		(_, i) => THEME[Math.min(from + i, THEME.length - 1)][2],
	);

/** The theme in cells: 0–11, 12–23, … and the last twelve. */
const CELLS: readonly number[][] = [
	...Array.from({ length: Math.floor(THEME.length / CELL_LEN) }, (_, c) =>
		cellFrom(c * CELL_LEN),
	),
	cellFrom(THEME.length - CELL_LEN),
];

/** How many of a cell's notes the additive keyboard plays on repetition
 *  `rep` of a cell. */
const additive = (rep: number) => Math.min(CELL_LEN, 4 + rep * 2);

/**
 * One cell over `CELL_BARS` bars from `bar`: the additive keyboard, the
 * phasing keyboard from the third bar with rotation `rot`, its offset
 * growing to one sixteenth by the block's end.
 */
function block(
	bar: number,
	cell: readonly number[],
	rot: number,
	vel: number,
	o: { phase?: boolean; full?: boolean } = {},
): NoteEvent[] {
	const out: NoteEvent[] = [];
	const start = bar * 12;
	for (let rep = 0; rep < CELL_BARS; rep++) {
		const n = o.full ? CELL_LEN : additive(rep);
		for (let k = 0; k < n; k++)
			out.push(
				at16(
					"a",
					start + rep * 12 + k,
					cell[k],
					vel * (k % 3 === 0 ? 1 : 0.78),
				),
			);
	}
	if (o.phase === false) return out;
	// The phasing keyboard: from rep 2, its position drifting early.
	const from = 2 * 12;
	const span = (CELL_BARS - 2) * 12;
	for (let i = 0; i < span; i++) {
		const drift = i / span; // 0 → 1 sixteenth early
		out.push(
			at16(
				"b",
				start + from + i - drift,
				cell[(i + rot) % CELL_LEN],
				vel * ((i + rot) % 3 === 0 ? 0.95 : 0.72),
			),
		);
	}
	return out;
}

/** The pad chord held for `bars` bars from `bar`, and the pulse under it. */
function harmony(
	bar: number,
	bars: number,
	pad: readonly number[],
	root: number,
	vel: number,
	pulse: boolean,
): NoteEvent[] {
	return [
		...pad.map((p) => note("pad", bar, 0, bars * 3 - 0.25, p, vel * 0.8)),
		...(pulse
			? Array.from({ length: bars * 6 }, (_, i) =>
					note(
						"pulse",
						bar + Math.floor(i / 6),
						(i % 6) / 2,
						0.4,
						root,
						vel * (i % 2 === 0 ? 0.85 : 0.6),
					),
				)
			: []),
	];
}

/** The waltz's harmony at the theme bar a cell's note falls in. */
const harmonyAt = (themeIndex: number) => {
	const bar = THEME[Math.min(themeIndex, THEME.length - 1)][0];
	return HARMONY[bar] ?? HARMONY[bar + 1] ?? [38, [], [57, 62, 66], "oom"];
};

// ── Intro: the horn's call as an arpeggio cell, built up and phased ────────

const CALL_A = [57, 61, 64, 69, 64, 61, 57, 61, 64, 69, 73, 76];
const CALL_E = [52, 56, 59, 64, 59, 56, 52, 56, 59, 64, 68, 71];

const INTRO: NoteEvent[] = [
	...block(0, CALL_A, 0, 0.55, { phase: false }).filter((n) => n.bar < 4),
	...block(4, CALL_E, 0, 0.6, { phase: false, full: true }).filter(
		(n) => n.bar < 8,
	),
	...harmony(0, 4, [57, 61, 64], 45, 0.5, false),
	...harmony(4, 4, [56, 59, 64], 40, 0.55, true),
];

// ── Waltz No. 1, as cells ──────────────────────────────────────────────────

const WALTZ_BARS = CELLS.length * CELL_BARS;

const WALTZ: NoteEvent[] = CELLS.flatMap((cell, c) => {
	const bar = c * CELL_BARS;
	const vel = c < 2 ? 0.6 : c < 4 ? 0.72 : 0.82;
	// The harmony at the cell's start, and at its middle.
	const first = harmonyAt(Math.min(c * CELL_LEN, THEME.length - CELL_LEN));
	const mid = harmonyAt(
		Math.min(c * CELL_LEN, THEME.length - CELL_LEN) + CELL_LEN / 2,
	);
	return [
		...block(bar, cell, c % CELL_LEN, vel),
		...harmony(bar, CELL_BARS / 2, first[2], first[0], vel, c > 0),
		...harmony(bar + CELL_BARS / 2, CELL_BARS / 2, mid[2], mid[0], vel, c > 0),
	];
});

// ── The cadence: the last three bars as a cell, unison, and the tonic ──────

const CADENCE_CELL = [78, 76, 83, 81, 74, 74, 78, 76, 83, 81, 74, 74];

const CADENCE: NoteEvent[] = [
	...Array.from({ length: 24 }, (_, i) => [
		at16("a", i, CADENCE_CELL[i % 12], 0.82 * (i % 3 === 0 ? 1 : 0.78)),
		at16("b", i, CADENCE_CELL[i % 12], 0.78 * (i % 3 === 0 ? 1 : 0.72)),
	]).flat(),
	...harmony(0, 1, [55, 59, 62], 43, 0.8, true),
	...harmony(1, 1, [55, 61, 64], 45, 0.8, true),
	...[62, 66, 69, 74].map((p) => note("a", 2, 0, 3, p, 0.45)),
	...[62, 66, 69, 74].map((p) => note("b", 2, 0, 3, p, 0.4)),
	...harmony(2, 2, [50, 57, 62, 66], 38, 0.75, false),
	note("pulse", 2, 0, 3, 38, 0.8),
];

/**
 * Score bars: the intro 0–7, the waltz's cells 8 to 8 + `WALTZ_BARS` − 1,
 * the cadence the last four, slowing over its last two.
 */
export const DANUBE_MINIMAL: Song = {
	name: "An der schönen blauen Donau (minimalism)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: WALTZ_BARS, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: MINIMAL_BPM },
		{ bar: 8 + WALTZ_BARS + 1, bpm: MINIMAL_BPM },
		{ bar: 8 + WALTZ_BARS + 3, bpm: 100, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 2.5 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_MINIMAL;
