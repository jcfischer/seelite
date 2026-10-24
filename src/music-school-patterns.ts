/**
 * The sequence-school bed's patterns (2026-10-24): a pool per place a
 * pattern plays, drawn per system and per variant, and the evolution that
 * changes a pattern while it plays.
 *
 * A pattern is scale degrees of the section's mode, 7 the octave, or with
 * `pent` steps of its pentatonic, 5 the octave: the major pentatonic
 * (1 2 3 5 6) in a mode with a major third, the minor (1 b3 4 5 b7) in one
 * with a minor third. A pentatonic pattern moves with the chord in
 * pentatonic steps, so it never leaves the pentatonic.
 *
 * Odd lengths (3, 5, 7) against an even clock walk across the bar, the
 * Berlin school's phase shift; the pools mix them with fours and sixes so
 * two patterns of one place need not share a cycle.
 */
export type Step = number | null;

export interface Pattern {
	readonly steps: readonly Step[];
	readonly pent?: boolean;
}

const h = (...steps: Step[]): Pattern => ({ steps });
const p = (...steps: Step[]): Pattern => ({ steps, pent: true });

/** Low and rooted: roots, octaves, fifths, the third, the seventh. */
export const ANCHORS: readonly Pattern[] = [
	h(0, 7, 4, 2, 6),
	h(0, 0, 7, 4, 2),
	h(0, 7, 2, 4, 0, 5, 4),
	h(0, 4, 7, 0, 2, 0, 6),
	h(0, 7, 0, 4, 2),
	h(0, 0, 4, 7, 6),
	h(0, -3, 0, 4, 2),
	h(0, 7, 6, 4, 2, 4, 7),
	h(0, 2, 4, 7, 4),
	h(0, 0, 7, 0, 4, 0, 2),
	p(0, 3, 5, 3, 1),
	p(0, 0, 3, 5, 4),
	p(0, 5, 3, 2, 0, 3, 1),
];

/** High and soft, from the fifth. */
export const CANOPIES: readonly Pattern[] = [
	h(4, 7, 6, 4, 2),
	h(4, 9, 7, 6, 7),
	h(7, 4, 6, 9, 4),
	h(4, 6, 7, 9, 11, 9, 7),
	h(4, 2, 4, 7, 6),
	h(4, 7, 9, 7, 4, 2),
	h(4, 5, 4, 2, 0, 2),
	h(11, 9, 7, 4, 7),
	p(3, 5, 6, 5, 3, 2),
	p(3, 4, 6, 7, 6),
	p(5, 3, 2, 3, 4, 1, 3),
	p(6, 5, 3, 5, 7),
];

/** Root, fourth, fifth and octave only: the choir turns major and minor
 *  over them. */
export const MODAL_STEPS = [0, 3, 4, 7] as const;
export const MODALS: readonly Pattern[] = [
	h(0, 4, 3, 7, 4),
	h(0, 3, 4, 0, 7),
	h(7, 4, 0, 3, 4),
	h(0, 7, 4, 3, 0, 4),
	h(3, 0, 4, 7, 3, 4, 0),
	h(0, 0, 3, 4, 7, 4, 3),
	h(7, 3, 4, 0, 4),
	h(0, 4, 7, 4, 3, 7),
	h(4, 0, 3, 0, 7),
	h(0, 3, 7, 3, 4, 0, 7),
];

/** Four steps that never change, high. */
export const MANTRAS: readonly Pattern[] = [
	h(7, 4, 9, 4),
	h(4, 7, 4, 2),
	h(9, 7, 4, 7),
	h(4, 2, 4, 7),
	h(9, 4, 7, 4),
	h(2, 4, 7, 9),
	h(7, 6, 4, 6),
	p(5, 3, 6, 3),
	p(3, 5, 4, 1),
	p(2, 4, 3, 5),
	p(7, 5, 3, 5),
];

/** Half notes, four of seven steps sounding, octaves over them. */
export const MIRAGES: readonly Pattern[] = [
	h(0, null, 4, null, 7, null, 2),
	h(0, null, 2, null, 4, null, 7),
	h(7, null, 4, null, 2, null, 0),
	h(0, null, 4, null, 9, null, 6),
	h(4, null, 0, null, 2, null, 7),
	p(0, null, 3, null, 5, null, 2),
	p(3, null, 1, null, 5, null, 0),
];

/** The mirage's second line, a dotted half against its half notes. */
export const MIRAGE_ECHOES: readonly Pattern[] = [
	h(4, null, 7, 9, null),
	h(2, null, 4, 7, null),
	h(7, null, 9, 4, null),
	h(9, null, 7, null, 4),
	p(3, null, 5, 6, null),
	p(1, null, 3, 5, null),
];

/** The breathing's upper line, one note a beat. */
export const BREATHS: readonly Pattern[] = [
	h(0, 4),
	h(0, 4, 3),
	h(0, 7, 4),
	h(0, 2, 4),
	h(0, 4, 5),
	h(0, 5, 4),
	h(2, 4, 0),
	h(0, 4, 2, 6, 4),
	p(0, 3, 2),
	p(0, 3, 5, 4, 1),
];

/** The breathing's lower line, one note every two beats. */
export const BREATHS_LOW: readonly Pattern[] = [
	h(0, 4, 2),
	h(0, 3, 4),
	h(0, 4, 5, 4, 3),
	h(0, -3, 0, 2),
	h(0, 2, -1),
	p(0, 3, 1),
	p(0, -2, 0, 3, 2),
];

/** The frozen bass under a mantra and a canopy, one note a beat. */
export const MANTRA_BASSES: readonly Pattern[] = [
	h(0, 0, 4, 0, 6),
	h(0, 4, 0, 0, 3),
	h(0, 0, 7, 0, 4),
	h(0, 6, 0, 4, 0),
	h(0, 0, 0, 4, 2),
	p(0, 0, 3, 0, 4),
	p(0, 3, 0, 5, 1),
];

/** The fixed run over a mantra, sixteenths. */
export const RUNS: readonly Pattern[] = [
	h(0, 2, 4, 2),
	h(0, 1, 2, 4),
	h(4, 2, 1, 0),
	h(0, 4, 2, 4, 1, 4),
	h(2, 4, 7, 4),
	h(0, 2, 4, 6, 4, 2, 1),
	p(0, 1, 2, 3, 2, 1),
	p(0, 2, 3, 4),
	p(5, 3, 2, 3, 1),
];

/** The cross-current's three. */
export const CURRENTS: readonly Pattern[] = [
	h(0, 4, 2),
	h(0, 2, 4),
	h(4, 7, 2),
	h(0, 4, 7),
	h(2, 0, 4),
	p(0, 3, 1),
	p(1, 3, 5),
];

/** The cross-current's seven, high, with gaps. */
export const CURRENT_SEVENS: readonly Pattern[] = [
	h(7, null, 9, 4, null, 6, null),
	h(7, 9, null, 4, 6, null, 2),
	h(4, null, 7, null, 9, 6, null),
	h(11, null, 9, 7, null, 4, null),
	h(9, 7, null, 6, null, 4, 2),
	p(5, null, 6, 3, null, 4, null),
	p(7, null, 5, 6, null, 3, null),
];

/** The gallop, first one note, then the run that opens it; in harmonic
 *  minor, so 6 is the leading tone. */
export const GALLOPS: readonly (readonly [Pattern, Pattern])[] = [
	[h(0, 0, 7, 0), h(0, 0, 7, 0, 11, 9)],
	[h(0, 7, 0, 0), h(0, 7, 0, 0, 4, 6)],
	[h(0, 0, 4, 0), h(0, 0, 4, 0, 7, 6)],
	[h(0, 0, 7, 7), h(0, 7, 0, 9, 0, 11)],
	[h(0, 0, 0, 7), h(0, 0, 2, 0, 4, 6, 7)],
];

/** Wary's chord roots, four bars a chord, in aeolian. */
export const WARY_CHORDS: readonly (readonly number[])[] = [
	[0, 5, 4, 0],
	[0, 5, 3, 4],
	[0, 6, 5, 4],
	[0, 3, 5, 4],
	[0, 6, 3, 4],
	[0, 5, 6, 0],
	[0, 2, 5, 4],
];

/** The drive's chord roots, as degrees of its minor mode, eight bars a
 *  chord; every chord is a minor triad. */
export const DRIVE_PROGRESSIONS: readonly (readonly number[])[] = [
	[0, 0, 3, 4],
	[0, 3, 0, 4],
	[0, 4, 3, 3],
	[0, 0, 4, 3],
	[0, 3, 4, 0],
	[0, 6, 0, 3],
	[0, 0, 5, 4],
	[0, 3, 6, 4],
	[0, 4, 0, 3],
];

/** The drive's rooted sequence, semitones over the chord's root, unbroken
 *  sixteenths: five land the root a sixteenth later each time round, three
 *  and seven walk at their own rate. The first is C G c eb Bb. */
export const DRIVE_SHAPES: readonly (readonly number[])[] = [
	[0, 7, 12, 15, 10],
	[0, 12, 10, 7, 15],
	[0, 7, 15, 12, 10],
	[0, 12, 7, 10, 15],
	[0, 3, 7, 12, 10],
	[0, 5, 7, 12, 10],
	[0, 7, 12, 15, 12, 10, 7],
	[0, 12, 0, 10, 0, 7, 15],
	[0, 7, 10, 12, 15, 19, 12],
	[0, 3, 5, 7, 10, 12, 15],
	[0, 12, 7],
	[0, 7, 12, 7, 15, 10],
];

const ACCENT: Readonly<Record<string, number>> = {
	X: 1,
	x: 0.7,
	o: 0.45,
	".": 0.25,
};
const hits = (s: string) => [...s].map((c) => ACCENT[c] ?? 0);

/** The hats' accents, one character a sixteenth: X x o . loud to soft, `-`
 *  silent. A length that is not sixteen walks the accent across the bar:
 *  the fives with the drive, the threes and sevens against it. */
export const HAT_ACCENTS: readonly (readonly number[])[] = [
	hits("x.o.X.o.x.o.X.o."),
	hits("-.X-.-X-.-X-.-X."),
	hits("X..X..X.X..X..X."),
	hits("X.o.."),
	hits("x.Xo"),
	hits(".-o-.-o-X-o-.-o-"),
	hits("X.o.x.o"),
	hits("o.o.o.o.o.o.X.oX"),
	hits("X.."),
	hits("x-o.x-o.X-o.x-.o"),
];

/** The slow kick, two bars a pattern, one character a sixteenth. */
export const KICKS: readonly (readonly number[])[] = [
	hits("X-------x-------X-------x-------"),
	hits("X-----------x---X---------------"),
	hits("X--x----------x-X---------------"),
	hits("X---------------X-----x---------"),
	hits("X-------------------x---X-------"),
	hits("X---x-------X-------------------"),
	hits("X-----x-----x---X-----x-----x---"),
	hits("X---------------x---------------"),
];

/** The minor chord tones a drive step may move to. */
export const DRIVE_LADDER = [-2, 0, 3, 7, 10, 12, 15, 19, 22, 24] as const;

const MAJOR_PENT = [0, 1, 2, 4, 5] as const;
const MINOR_PENT = [0, 2, 3, 4, 6] as const;

type Deg = (base: number, d: number) => number;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** A pattern's step as a degree of the mode `deg` writes, over a chord on
 *  `root`: a pentatonic step moves with the chord in pentatonic steps. */
export function stepDegree(
	deg: Deg,
	pent: boolean | undefined,
	root: number,
	d: number,
): number {
	if (!pent) return root + d;
	const scale = deg(0, 2) - deg(0, 0) === 3 ? MINOR_PENT : MAJOR_PENT;
	const r = mod(root, 7);
	let at = 0;
	for (let i = 0; i < scale.length; i++) if (scale[i] <= r) at = i;
	const i = d + at + 5 * Math.floor(root / 7);
	return 7 * Math.floor(i / 5) + scale[mod(i, 5)];
}

/** How a pattern may change: its octave in steps, and the tones a step may
 *  move to, or a third either way when there is no ladder. */
export interface Ear {
	readonly octave: number;
	readonly ladder?: readonly number[];
}

export const earOf = (pattern: Pattern): Ear => ({
	octave: pattern.pent ? 5 : 7,
	ladder: pattern.pent
		? [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
		: undefined,
});

function nearest(ladder: readonly number[], d: number): number {
	let best = 0;
	for (let i = 1; i < ladder.length; i++)
		if (Math.abs(ladder[i] - d) < Math.abs(ladder[best] - d)) best = i;
	return best;
}

/** One change that keeps a pattern's length, so its walk across the bar
 *  holds: a rotation, two neighbours swapped, a step up or down an octave,
 *  a step moved to a neighbouring tone, or a gap moved. */
export function mutate(
	steps: readonly Step[],
	rand: () => number,
	ear: Ear,
): Step[] {
	const out = [...steps];
	const n = out.length;
	if (n < 2) return out;
	const notes = out.flatMap((d, i) => (d === null ? [] : [i]));
	const gaps = out.flatMap((d, i) => (d === null ? [i] : []));
	const pickIn = (xs: readonly number[]) =>
		xs[Math.floor(rand() * xs.length) % xs.length];
	const op = Math.floor(rand() * (gaps.length > 0 ? 5 : 4));
	if (op === 0) {
		const k = 1 + (Math.floor(rand() * (n - 1)) % (n - 1));
		return [...out.slice(k), ...out.slice(0, k)];
	}
	if (op === 1) {
		const i = Math.floor(rand() * (n - 1)) % (n - 1);
		[out[i], out[i + 1]] = [out[i + 1], out[i]];
		return out;
	}
	const later = notes.filter((i) => i > 0);
	if (op === 2 && later.length > 0) {
		const i = pickIn(later);
		const d = out[i] as number;
		out[i] = d >= ear.octave ? d - ear.octave : d + ear.octave;
		return out;
	}
	if (op === 4) {
		const g = pickIn(gaps);
		const near = [g - 1, g + 1].filter(
			(i) => i > 0 && i < n && out[i] !== null,
		);
		if (near.length > 0) {
			const i = pickIn(near);
			[out[g], out[i]] = [out[i], out[g]];
		}
		return out;
	}
	if (later.length === 0) return out;
	const i = pickIn(later);
	const d = out[i] as number;
	const dir = rand() < 0.5 ? -1 : 1;
	if (ear.ladder) {
		const at = nearest(ear.ladder, d);
		out[i] = ear.ladder[Math.max(0, Math.min(ear.ladder.length - 1, at + dir))];
	} else out[i] = d + 2 * dir;
	return out;
}

/** A pattern's versions, one every so many bars: every fourth is the
 *  pattern itself, the ones between each a change of the one before, so
 *  the pattern wanders and comes home, a different way each time. */
export function evolution(
	steps: readonly Step[],
	rand: () => number,
	ear: Ear,
	count: number,
): Step[][] {
	const out: Step[][] = [];
	for (let k = 0; k < count; k++)
		out.push(k % 4 === 0 ? [...steps] : mutate(out[k - 1], rand, ear));
	return out;
}
