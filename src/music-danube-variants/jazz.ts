/**
 * The Blue Danube as a jazz waltz: a listening spike beside the docking
 * computer's waltz (`music-danube.ts`) and the dark-techno one
 * (`music-danube-techno.ts`), on the same synth.
 *
 * **Strauss's tune, a jazz rhythm section's harmony.** The theme is the
 * waltz module's own `THEME`; the harmony under it is re-written as jazz
 * changes, one chord a bar (`CHANGES`), so the D-major oom-pah-pah becomes
 * ii–V–I motion with ninths and thirteenths. The meter stays 3/4. Eighths are
 * swung on the triplet (`swing`), so the turn's eighth-notes land late.
 *
 * The band: the tune on a mallet (`fm`), the woodwinds' answers doubled on
 * flute, a piano comping on the beat and the swung "and" of two, an upright
 * bass on the root and walking into the next bar, and brushes with a ride.
 * The intro is out of time on the piano, the horn's call on the mallet, then
 * a bar of the drums counting the band in.
 *
 * The form keeps the waltz's contract: intro, the waltz looping, and a
 * `resolve` to the cadence on the next bar line.
 */
import { THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const JAZZ_BPM = 152;
const RUBATO_BPM = 92;

const KICK = 29;
const RIDE = 100;
const CHICK = 96;
const BRUSH = 84;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// A mallet: FM at 1:1, the brightness falling fast, the ring slow.
	vibes: {
		voice: "fm",
		level: 0.6,
		attackS: 0.003,
		decayS: 1.8,
		sustain: 0,
		releaseS: 0.5,
		ratio: 1,
		index: 1.3,
		indexDecayS: 0.3,
		feedback: 0,
		pan: -0.15,
		reverb: 0.35,
	},
	answer: {
		voice: "flute",
		level: 0.33,
		glideS: 0.02,
		pan: 0.3,
		reverb: 0.4,
	},
	piano: {
		voice: "keys",
		level: 0.39,
		attackS: 0.003,
		decayS: 1.4,
		sustain: 0.2,
		releaseS: 0.25,
		ratio: 1.001,
		index: 0.55,
		pan: 0.2,
		reverb: 0.3,
	},
	bass: {
		voice: "pluck",
		level: 1,
		decayS: 1.3,
		releaseS: 0.12,
		cutoffHz: 650,
		reverb: 0.08,
	},
	ride: {
		voice: "noise",
		level: 0.15,
		decayS: 0.45,
		releaseS: 0.25,
		resonance: 0.35,
		pan: 0.3,
		reverb: 0.2,
	},
	chick: {
		voice: "noise",
		level: 0.105,
		decayS: 0.05,
		releaseS: 0.03,
		pan: 0.35,
		reverb: 0.1,
	},
	brush: {
		voice: "noise",
		level: 0.105,
		attackS: 0.12,
		decayS: 0.4,
		sustain: 0.3,
		releaseS: 0.25,
		resonance: 0.2,
		pan: -0.2,
		reverb: 0.3,
	},
	kick: { voice: "kick", level: 0.3, reverb: 0.1 },
};

/** A swung eighth: the "and" of a beat moved to its last triplet. */
const swing = (beat: number): number => {
	const whole = Math.floor(beat);
	return Math.abs(beat - whole - 0.5) < 1e-9 ? whole + 2 / 3 : beat;
};

const note = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

// ── The changes ─────────────────────────────────────────────────────────────

/** Chord tones above the root, in semitones, by quality. */
const QUALITY = {
	maj9: [4, 7, 11, 14],
	m9: [3, 7, 10, 14],
	m7: [3, 7, 10],
	"13": [4, 10, 14, 21],
	"9": [4, 10, 14],
	"7#9": [4, 10, 15],
	"69": [4, 9, 14],
} as const;
type Quality = keyof typeof QUALITY;

/** A bar's chord: its root as a pitch class (0 = C), and its quality. */
type Change = readonly [number, Quality];
const D = 2;
const E = 4;
const G = 7;
const A = 9;
const B = 11;

/** The piano's voicing: every chord tone folded into F3–F#4, rootless. */
const voicing = ([root, q]: Change): number[] =>
	[...new Set(QUALITY[q].map((i) => 53 + ((root + i - 53 + 120) % 12)))].sort(
		(a, b) => a - b,
	);

/** The bass's root, folded into A1–G#2. */
const bassRoot = ([root]: Change): number => 33 + ((root - 9 + 12) % 12);

/**
 * One chord a bar of Waltz No. 1, by its bar in `THEME` (bar 0 is the
 * upbeat). The tune's long notes sit on chord tones or on the ninth and
 * thirteenth; the original's four-bar blocks of D and A7 become ii–V–I.
 */
const CHANGES: readonly Change[] = [
	[A, "13"], // the upbeat
	[D, "maj9"],
	[D, "maj9"],
	[B, "m9"],
	[B, "m9"],
	[E, "m9"],
	[E, "m9"],
	[A, "13"],
	[A, "13"],
	[E, "m9"],
	[E, "m9"],
	[A, "13"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[G, "maj9"],
	[G, "maj9"],
	[G, "maj9"],
	[E, "m7"],
	[A, "9"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[D, "69"],
];

/** The rhythm section for one bar: piano, bass, brushes and ride. */
function band(
	bar: number,
	now: Change,
	next: Change,
	vel: number,
): NoteEvent[] {
	const out: NoteEvent[] = [];
	const chord = voicing(now);
	// The piano: on one and the swung "and" of two, or on two alone.
	const hits: [number, number][] =
		bar % 2 === 0
			? [
					[0, 0.7],
					[1 + 2 / 3, 0.6],
				]
			: [[1, 1.4]];
	for (const [beat, dur] of hits)
		for (const p of chord)
			out.push(note("piano", bar, beat, dur, p, vel * 0.75));
	// The bass: the root, the fifth when the band is up, and a half-step
	// into the next bar's root (or its fifth, when the root holds).
	const root = bassRoot(now);
	const to = bassRoot(next);
	const approach = to === root ? root + 7 : to + (to > root ? -1 : 1);
	if (vel >= 0.7) {
		out.push(note("bass", bar, 0, 1, root, vel));
		out.push(note("bass", bar, 1, 1, root + 7, vel * 0.8));
	} else out.push(note("bass", bar, 0, 2, root, vel));
	out.push(note("bass", bar, 2, 1, approach, vel * 0.85));
	// Ride: ding, ding-a, ding. The hi-hat's foot on two and three, the
	// brush swept through the bar, the kick feathered on one.
	out.push(
		note("ride", bar, 0, 0.5, RIDE, 0.85),
		note("ride", bar, 1, 0.4, RIDE, 0.6),
		note("ride", bar, 1 + 2 / 3, 0.3, RIDE, 0.45),
		note("ride", bar, 2, 0.5, RIDE, 0.65),
		note("chick", bar, 1, 0.1, CHICK, 0.6),
		note("chick", bar, 2, 0.1, CHICK, 0.5),
		note("brush", bar, 0, 2.5, BRUSH, 0.4),
		note("kick", bar, 0, 0.5, KICK, 0.5),
	);
	return out;
}

// ── Intro: rubato piano, the horn's call on the mallet, then a count-in ─────

/** A chord rolled up from the bass, held through the bar. */
const rolled = (bar: number, c: Change, vel: number): NoteEvent[] => [
	note("bass", bar, 0, 3, bassRoot(c), vel),
	...voicing(c).map((p, i) =>
		note("piano", bar, i * 0.12, 2.8 - i * 0.12, p, vel),
	),
];

const INTRO: NoteEvent[] = [
	...rolled(0, [E, "m9"], 0.5),
	...rolled(1, [A, "13"], 0.5),
	...rolled(2, [D, "maj9"], 0.5),
	...rolled(3, [E, "9"], 0.5),
	...rolled(4, [A, "13"], 0.5),
	...rolled(5, [E, "m9"], 0.5),
	...rolled(6, [B, "7#9"], 0.5),
	// The call, A–C#–E into the held E; E–G#–B into the held B; then the
	// thirds rising into the count-in.
	...(
		[
			[1, 1.5, 69],
			[1, 2, 73],
			[1, 2.5, 76],
			[3, 1.5, 76],
			[3, 2, 80],
			[3, 2.5, 83],
		] as const
	).map(([bar, beat, p]) => note("vibes", bar, swing(beat), 0.5, p, 0.6)),
	note("vibes", 2, 0, 3, 76, 0.55),
	note("vibes", 4, 0, 3, 83, 0.55),
	...[
		[1.5, [71, 74]],
		[2, [74, 78]],
		[2.5, [78, 81]],
	].flatMap(([beat, ps]) =>
		(ps as number[]).map((p) =>
			note("vibes", 5, swing(beat as number), 0.5, p, 0.55),
		),
	),
	note("vibes", 6, 0, 3, 78, 0.5),
	note("vibes", 6, 0, 3, 81, 0.5),
	// The count-in, in tempo: the drums alone, the bass walking up to A.
	note("ride", 7, 0, 0.5, RIDE, 0.7),
	note("ride", 7, 1, 0.4, RIDE, 0.55),
	note("ride", 7, 1 + 2 / 3, 0.3, RIDE, 0.45),
	note("ride", 7, 2, 0.5, RIDE, 0.6),
	note("chick", 7, 1, 0.1, CHICK, 0.6),
	note("chick", 7, 2, 0.1, CHICK, 0.5),
	note("bass", 7, 0, 1, 40, 0.55),
	note("bass", 7, 1, 1, 42, 0.55),
	note("bass", 7, 2, 1, 44, 0.6),
];

// ── Waltz No. 1 ─────────────────────────────────────────────────────────────

/** Loudness by bar, as the waltz's: p, then f from bar 17, ff at 25. */
const dyn = (bar: number) =>
	bar < 16 ? 0.58 : bar < 17 ? 0.64 : bar < 25 ? 0.74 : bar < 29 ? 0.86 : 0.8;

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => {
		const from = swing(beat);
		const len = swing(beat + dur) - from;
		return [
			note("vibes", bar, from, len, pitch, dyn(bar)),
			...(answer ? [note("answer", bar, from, len, pitch, dyn(bar))] : []),
			...(answer && beat === 2
				? [note("vibes", bar, 1.88, 0.12, pitch - 1, dyn(bar) * 0.55)]
				: []),
		];
	}),
	...CHANGES.flatMap((c, bar) =>
		band(bar, c, CHANGES[(bar + 1) % CHANGES.length], dyn(bar)),
	),
];

// ── The cadence: Strauss's last three bars, a ii–V–I, and the tag ─────────

const CADENCE: NoteEvent[] = [
	...(
		[
			[0, 0, 78, 2],
			[0, 2, 76, 1],
			[1, 0, 83, 2],
			[1, 2, 81, 1],
			[2, 0, 74, 1],
			[2, 1.5, 74, 0.5],
			[2, 2, 74, 1],
		] as const
	).map(([bar, beat, p, dur]) =>
		note("vibes", bar, swing(beat), swing(beat + dur) - swing(beat), p, 0.8),
	),
	note("vibes", 3, 0, 3, 74, 0.75),
	note("vibes", 3, 0, 3, 86, 0.75),
	note("answer", 3, 0, 3, 86, 0.7),
	...band(0, [E, "m9"], [A, "13"], 0.8),
	...band(1, [A, "13"], [D, "69"], 0.8),
	...band(2, [D, "69"], [D, "69"], 0.8).filter((n) => n.part !== "bass"),
	note("bass", 2, 0, 3, 38, 0.8),
	...rolled(3, [D, "69"], 0.6),
	note("ride", 3, 0, 2, RIDE, 0.9),
	note("kick", 3, 0, 0.5, KICK, 0.6),
];

/**
 * Score bars: the intro 0–7 (out of time to 6, the count-in at 7), the
 * waltz 8–39, the cadence 40–43, broadening over its last two bars.
 */
export const DANUBE_JAZZ: Song = {
	name: "An der schönen blauen Donau (jazz waltz)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: RUBATO_BPM },
		{ bar: 6, bpm: 80, ramp: true },
		{ bar: 7, bpm: JAZZ_BPM },
		{ bar: 41, bpm: JAZZ_BPM },
		{ bar: 43, bpm: 104, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 2.2 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_JAZZ;
