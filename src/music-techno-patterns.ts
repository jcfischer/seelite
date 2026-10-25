/**
 * The techno bed's pools (spike, 2026-10-24): the rhythms, bass lines,
 * chord voicings and progressions a system's techno tune draws from, and
 * the Euclidean rhythm that spreads `k` hits over `n` steps as evenly as
 * they go (Toussaint, 2005: https://cgm.cs.mcgill.ca/~godfried/publications/banff.pdf).
 *
 * A one-bar pattern is sixteen sixteenths, written as a string: `X` loud,
 * `x` medium, `o` soft, `.` a ghost, any other character a rest. A `Hit` is
 * a step's loudness, or `null` for a rest.
 */
export type Hit = number | null;

/** A pattern string as its steps' loudness. */
export const hits = (s: string): Hit[] =>
	[...s].map((c) =>
		c === "X"
			? 1
			: c === "x"
				? 0.7
				: c === "o"
					? 0.45
					: c === "."
						? 0.25
						: null,
	);

/** `k` hits over `n` steps, as evenly as they go, turned by `rotate`. */
export function euclid(k: number, n: number, rotate = 0): boolean[] {
	const r = ((rotate % n) + n) % n;
	return Array.from({ length: n }, (_, i) => ((i + r) * k) % n < k);
}

/** The kick's bars: the four on the floor, and the fills that end a phrase. */
export const KICK_MAIN = "X---X---X---X---";
export const KICK_FILLS = [
	"X---X---X---X-x-",
	"X---X---X--xX---",
	"X---X---X---X--x",
	"X---X---X-x-X-x-",
	"X---X---X---xxXx",
	"X---X---X-------",
].map(hits);

/** Closed hats: which sixteenths they play, and their accents. */
export const HATS = [
	"oxXxoxXxoxXxoxXx",
	"-.x.-.x.-.x.-.x.",
	"-oxo-oxo-oxo-oXo",
	".oX..oX..oX..oXo",
	"-x-x-x-x-x-x-x-x",
	"o.Xxo.Xxo.Xxo.XX",
	"-.X.-oX.-.X.-oXx",
	"--x---x---x-x-x-",
	"xoXoxoXoxoXoxoXX",
	"-.xo-.xo-.xo-.xo",
].map(hits);

/** Claps on two and four, and the ghosts around them. */
export const CLAPS = [
	"----X-------X---",
	"----X-------X--.",
	"----X------.X---",
	"----X--.----X---",
	"----X-------X-o-",
].map(hits);

/** The bass line's shape over one bar: `r` the chord's root, `o` its
 *  octave, `f` its fifth, any other character a rest. The kick owns the
 *  downbeats, so the bass sits between them. */
export const BASS_LINES = {
	offbeat: "--r---r---r---r-",
	offbeatOctave: "--r---r---r---o-",
	rolling: "-rrr-rrr-rrr-rro",
	gallop: "--rr--rr--rr--ro",
	sub: "--r-------r-----",
	pulse: "-r-r-r-r-r-r-r-f",
} as const;

/** A bass line's steps, in semitones over the root, or `null` for a rest. */
export const bassSteps = (line: string): (number | null)[] =>
	[...line].map((c) => (c === "r" ? 0 : c === "o" ? 12 : c === "f" ? 7 : null));

/** Chord memory: one voicing, moved whole to each root, as Detroit's
 *  machines held it. Semitones over the root. */
export const VOICINGS = [
	[0, 3, 7, 10],
	[0, 3, 7, 14],
	[0, 5, 7, 10],
	[0, 7, 10, 15],
	[3, 7, 10, 14],
	[0, 5, 10, 15],
	[0, 7, 12, 15],
] as const;

/** Progressions: the root's move, in semitones from the tonic, one per
 *  eight bars. Most of them hold still. */
export const PROGRESSIONS = [
	[0],
	[0, 0, 0, -2],
	[0, -2],
	[0, -4],
	[0, 5],
	[0, 3],
	[0, -5],
	[0, 0, -4, -2],
	[0, -2, -4, -2],
	[0, 3, 5, 3],
] as const;

/** The polymetric blip's lengths, in sixteenths: none divides sixteen, so
 *  it moves across the bar. */
export const BLIP_LENGTHS = [3, 5, 6, 7, 9] as const;
/** The blip's note pool, semitones over the tonic. */
export const BLIP_NOTES = [0, 7, 12, 10, 3, 15, 5, 19, 24] as const;
