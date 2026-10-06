/**
 * The Blue Danube as minimalism, after Glass's arpeggios and Reich's
 * *Piano Phase*: a listening spike beside the docking computer's waltz
 * (`music-danube.ts`), on the same synth.
 *
 * **No held chord anywhere.** The harmony is only what the patterns spell:
 *
 * - **The arpeggio** (`piano`) — Glass's broken chord, each bar's harmony
 *   from the waltz's `HARMONY` run up and down in steady eighths, accented
 *   on the downbeat. One part name for the piano-like sound, so a sampled
 *   piano is a one-line swap.
 * - **The phase pair** (`phaseA`, `phaseB`) — two woody mallets, one to
 *   each side, playing *Piano Phase*'s twelve-note cell shape over each
 *   bar's chord tones in straight sixteenths. Every eight bars `phaseB`
 *   pulls ahead: over four bars its offset grows continuously from nothing
 *   to one sixteenth, then for four bars it holds there, locked one note
 *   ahead (`phaseOf`). Four cycles a loop, four notes out.
 * - **The pulse** (`pulse`) — the root in eighths, low and soft, swelling
 *   and falling over four bars, as *Music for 18 Musicians* breathes.
 *
 * **The tune stays a tune.** Strauss's `THEME` is played as written, bar
 * for bar, on a soft lead over the patterns at a slow waltz's pace, so it is
 * heard at the rate it was written rather than unrolled into sixteenths.
 *
 * The form keeps the waltz's contract: an intro (the arpeggio alone, then
 * the pulse and the horn's call), Waltz No. 1 looping, and a `resolve` to
 * the cadence, where the phase pair falls back into unison and stops.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const MINIMAL_BPM = 120;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The arpeggio: an electric piano, low, its tine soft — and dry. Every
	// pattern part dies before its next note: rung on, ten eighths overlapped
	// into a held chord, which the principal heard as the chord bed again.
	piano: {
		voice: "epiano",
		level: 0.588,
		decayS: 0.35,
		sustain: 0,
		releaseS: 0.06,
		index: 1.6,
		pan: -0.1,
		reverb: 0.1,
	},
	// A marimba-ish mallet: FM at about the bar's fourth partial, the
	// brightness gone in a few hundredths of a second.
	phaseA: {
		voice: "fm",
		level: 0.42,
		attackS: 0.002,
		decayS: 0.3,
		sustain: 0,
		releaseS: 0.08,
		ratio: 3.98,
		index: 1.1,
		indexDecayS: 0.04,
		feedback: 0,
		pan: -0.55,
		reverb: 0.12,
	},
	phaseB: {
		voice: "fm",
		level: 0.42,
		attackS: 0.002,
		decayS: 0.3,
		sustain: 0,
		releaseS: 0.08,
		ratio: 4.02,
		index: 1.1,
		indexDecayS: 0.04,
		feedback: 0,
		pan: 0.55,
		reverb: 0.12,
	},
	pulse: {
		voice: "keys",
		level: 0.252,
		attackS: 0.004,
		decayS: 0.25,
		sustain: 0,
		releaseS: 0.06,
		index: 0.4,
		reverb: 0.05,
	},
	// The tune: soft saws that mellow as they ring, into the echo.
	melody: {
		voice: "softsaw",
		level: 0.588,
		attackS: 0.03,
		decayS: 2.5,
		sustain: 0.5,
		releaseS: 0.35,
		reverb: 0.25,
		echo: 0.15,
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

/** A chord's three tones, ascending. */
type Triad = readonly number[];
const D: Triad = [57, 62, 66];
const A7: Triad = [55, 61, 64];
const G: Triad = [55, 59, 62];

/** The chord under waltz bar `bar`: its pad, the upbeat taking bar 1's. */
const chordOf = (bar: number): Triad => {
	const h = HARMONY[bar] ?? HARMONY[bar + 1];
	return h ? [...h[2]].sort((a, b) => a - b) : D;
};

/** Glass's broken chord over one bar: up and back in six eighths, an
 *  octave below the chord, the top doubled an octave up. */
const arpeggio = (bar: number, c: Triad, vel: number): NoteEvent[] =>
	[0, 1, 2, 3, 2, 1].map((k, i) =>
		note(
			"piano",
			bar,
			i / 2,
			0.5,
			k === 3 ? c[0] : c[k] - 12,
			vel * (i === 0 ? 1 : 0.72),
		),
	);

/** *Piano Phase*'s cell, as steps into five chord tones over two octaves:
 *  E F# B C# D F# E C# B F# D C# is 0 1 2 3 4 1 0 3 2 1 4 3. */
const CELL = [0, 1, 2, 3, 4, 1, 0, 3, 2, 1, 4, 3];
const tonesOf = (c: Triad): number[] => [...c, c[0] + 12, c[1] + 12];

/** The sixteenths in one phase cycle, and in its drift. */
const CYCLE = 96;
const DRIFT = 48;

/** Where `phaseB` stands at sixteenth `s` of the loop: how many notes ahead
 *  it has locked, and how far into the next one it has drifted, in beats. */
const phaseOf = (s: number): { ahead: number; early: number } => {
	const cycle = Math.floor(s / CYCLE);
	const u = s % CYCLE;
	return u < DRIFT
		? { ahead: cycle, early: (0.25 * u) / DRIFT }
		: { ahead: cycle + 1, early: 0 };
};

/** The phase pair over `bars` bars of `chord`, from loop sixteenth `from`;
 *  `phased` false keeps both in unison. */
function phasePair(
	bars: number,
	chord: (bar: number) => Triad,
	vel: (bar: number) => number,
	phased: boolean,
): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (let s = 0; s < bars * 12; s++) {
		const bar = Math.floor(s / 12);
		const k = s % 12;
		const tones = tonesOf(chord(bar));
		const v = vel(bar) * (k === 0 ? 1 : 0.8);
		out.push(note("phaseA", bar, k / 4, 0.2, tones[CELL[k]], v));
		const { ahead, early } = phased ? phaseOf(s) : { ahead: 0, early: 0 };
		const t = s / 4 - early;
		if (t < 0) continue;
		const b = Math.floor(t / 3);
		out.push(
			note(
				"phaseB",
				b,
				t - b * 3,
				0.2,
				tones[CELL[(k + ahead) % 12]],
				v * 0.95,
			),
		);
	}
	return out;
}

/** The pulse: the chord's root an octave and more down, in eighths,
 *  swelling over four bars and falling back. */
const pulse = (bar: number, c: Triad, vel: number): NoteEvent[] => {
	const swell = 0.55 + 0.45 * Math.sin((Math.PI * (bar % 4)) / 4);
	const root = c[0] - 24 < 33 ? c[0] - 12 : c[0] - 24;
	return Array.from({ length: 6 }, (_, i) =>
		note("pulse", bar, i / 2, 0.4, root, vel * swell * (i % 2 ? 0.7 : 1)),
	);
};

// ── Intro: the arpeggio alone, the pulse, the horn's call ───────────────────

const INTRO_CHORDS: readonly Triad[] = [D, D, A7, A7];

const INTRO: NoteEvent[] = [
	...INTRO_CHORDS.flatMap((c, bar) => arpeggio(bar, c, 0.55)),
	...INTRO_CHORDS.slice(2).flatMap((c, i) => pulse(i + 2, c, 0.5)),
	...phasePair(
		1,
		() => A7,
		() => 0.45,
		false,
	).map((n) => ({ ...n, bar: 3 })),
	// The call, A–C#–E into the held E.
	note("melody", 2, 1.5, 0.5, 69, 0.55),
	note("melody", 2, 2, 0.5, 73, 0.55),
	note("melody", 2, 2.5, 0.5, 76, 0.6),
	note("melody", 3, 0, 3, 76, 0.55),
];

// ── Waltz No. 1 ─────────────────────────────────────────────────────────────

/** Loudness by bar, as the waltz's: p, then f from bar 17, ff at 25. */
const dyn = (bar: number) =>
	bar < 16 ? 0.58 : bar < 17 ? 0.64 : bar < 25 ? 0.74 : bar < 29 ? 0.86 : 0.8;

const WALTZ: NoteEvent[] = [
	...THEME.map(([bar, beat, pitch, dur]) =>
		note("melody", bar, beat, dur, pitch, dyn(bar)),
	),
	...Array.from({ length: 32 }, (_, bar) => [
		...arpeggio(bar, chordOf(bar), 0.5 + dyn(bar) * 0.3),
		...pulse(bar, chordOf(bar), 0.5),
	]).flat(),
	...phasePair(32, chordOf, (bar) => 0.45 + dyn(bar) * 0.2, true),
];

// ── The cadence: Strauss's last three bars, the pair back in unison ─────────

const CADENCE_CHORDS: readonly Triad[] = [G, A7, D, D];

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
			[3, 0, 74, 3],
		] as const
	).map(([bar, beat, p, dur]) => note("melody", bar, beat, dur, p, 0.8)),
	...CADENCE_CHORDS.slice(0, 3).flatMap((c, bar) => [
		...arpeggio(bar, c, 0.7),
		...pulse(bar, c, 0.5),
	]),
	...phasePair(
		3,
		(bar) => CADENCE_CHORDS[bar],
		() => 0.55,
		false,
	),
	// The last bar: the chord rolled once and left to ring.
	...[38, 50, 57, 62, 66].map((p, i) =>
		note("piano", 3, i * 0.15, 2.8 - i * 0.15, p, 0.65),
	),
];

/**
 * Score bars: the intro 0–3, the waltz 4–35, the cadence 36–39, slowing
 * over its last two bars.
 */
export const DANUBE_MINIMAL: Song = {
	name: "An der schönen blauen Donau (minimal)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 4, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: MINIMAL_BPM },
		{ bar: 37, bpm: MINIMAL_BPM },
		{ bar: 39, bpm: 92, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 1.6, echoBeats: 1.5, echoFeedback: 0.35 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_MINIMAL;
