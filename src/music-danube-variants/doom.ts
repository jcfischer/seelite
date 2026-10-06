/**
 * The Blue Danube as doom: a listening spike beside the docking computer's
 * waltz (`../music-danube.ts`).
 *
 * **Still 3/4, at a third of the speed.** The theme and the harmony are the
 * waltz module's own tables (`THEME`, `HARMONY`). A bar lasts three seconds,
 * so the loop is Waltz No. 1's first sixteen bars — the D phrase, the A7
 * phrase and back — and not all 32: the whole waltz at this tempo would be a
 * minute and a half before it repeated, longer than any docking run.
 *
 * In D minor, as the techno version is. The band is bowed strings driven into
 * grit, which is the nearest this synth has to a down-tuned guitar: each
 * bar's root as a power chord (root, fifth, octave), the theme an octave down
 * on a second, smoother desk, a drone under both, a kick on one and a snare
 * on three in a large room, and a cymbal wash at each phrase.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const DOOM_BPM = 60;

const KICK = 29;
const SNARE = 86;
const CRASH = 100;

/** The loop: the theme's first sixteen bars, upbeat included. */
const LOOP_BARS = 16;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The guitars: driven, rosined, slow to speak and slow to stop.
	riff: {
		voice: "strings",
		level: 0.07,
		unison: 6,
		detune: 0.14,
		attackS: 0.12,
		sustain: 1,
		releaseS: 1.2,
		cutoffHz: 1100,
		envAmount: 1,
		vibrato: 0,
		drive: 0.95,
		rosin: 0.8,
		rosinLow: 1,
		keyTrack: 0.6,
		reverb: 0.45,
	},
	lead: {
		voice: "strings",
		level: 0.115,
		unison: 4,
		detune: 0.08,
		attackS: 0.2,
		sustain: 0.95,
		releaseS: 1.4,
		glideS: 0.08,
		cutoffHz: 1500,
		envAmount: 1.2,
		vibrato: 0.18,
		vibratoHz: 4.5,
		drive: 0.5,
		rosin: 0.3,
		pan: -0.2,
		reverb: 0.6,
		echo: 0.15,
	},
	drone: {
		voice: "drone",
		level: 0.07,
		attackS: 4,
		releaseS: 4,
		detune: 0.12,
		drift: 5,
		spread: 1,
		reverb: 0.7,
	},
	kick: { voice: "kick", level: 0.35, reverb: 0.4 },
	snare: {
		voice: "noise",
		level: 0.12,
		decayS: 0.5,
		releaseS: 0.3,
		resonance: 0.4,
		reverb: 0.8,
	},
	crash: {
		voice: "noise",
		level: 0.04,
		decayS: 3.5,
		sustain: 0,
		releaseS: 2,
		resonance: 0.2,
		pan: 0.3,
		reverb: 0.7,
	},
	// A low bell for the intro and the end: tolled, not played.
	bell: {
		voice: "fm",
		level: 0.12,
		attackS: 0.003,
		decayS: 6,
		sustain: 0,
		releaseS: 3,
		ratio: 1.41,
		index: 3,
		indexDecayS: 2,
		reverb: 0.8,
	},
};

/** D major's F# and B lowered: D minor, its C# kept. */
const minor = (p: number): number => {
	const pc = ((Math.round(p) % 12) + 12) % 12;
	return pc === 6 || pc === 11 ? p - 1 : p;
};

const note = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

/** A power chord on `root`, held for `dur` beats. */
const power = (
	bar: number,
	root: number,
	dur: number,
	vel: number,
): NoteEvent[] =>
	[0, 7, 12].map((i) => note("riff", bar, 0, dur, root + i, vel));

/** One bar of drums: the kick on one, the snare on three. */
const drums = (bar: number, vel: number): NoteEvent[] => [
	note("kick", bar, 0, 0.5, KICK, vel),
	note("snare", bar, 2, 0.5, SNARE, vel * 0.9),
];

// ── Intro: the bell, the drone, the call on the guitars ─────────────────────

const INTRO: NoteEvent[] = [
	note("drone", 0, 0, 18, 38, 0.6),
	note("drone", 0, 0, 18, 45, 0.5),
	note("bell", 0, 0, 3, 50, 0.7),
	note("bell", 3, 0, 3, 45, 0.6),
	// The call, slow: A–C#–E into the held E, then the guitars land.
	note("lead", 1, 0, 1, 57, 0.6),
	note("lead", 1, 1, 1, 61, 0.6),
	note("lead", 1, 2, 1, 64, 0.65),
	note("lead", 2, 0, 3, 64, 0.6),
	...power(3, 33, 3, 0.6),
	note("crash", 3, 0, 1, CRASH, 0.7),
	...power(4, 38, 3, 0.7),
	...drums(4, 0.6),
	...power(5, 33, 3, 0.75),
	...drums(5, 0.7),
];

// ── The loop: the theme's first sixteen bars ───────────────────────────────

const dyn = (bar: number) => (bar < 8 ? 0.7 : 0.8);

const WALTZ: NoteEvent[] = [
	...THEME.filter(([bar]) => bar < LOOP_BARS).flatMap(
		([bar, beat, pitch, dur]) => [
			note("lead", bar, beat, dur, minor(pitch) - 12, dyn(bar)),
		],
	),
	...HARMONY.slice(0, LOOP_BARS).flatMap((h, bar) => {
		const root = minor(h ? h[0] : 38);
		return [
			...power(bar, root, 3, dyn(bar)),
			...drums(bar, dyn(bar)),
			...(bar % 4 === 1 ? [note("crash", bar, 0, 1, CRASH, 0.75)] : []),
			...(bar % 8 === 0
				? [note("drone", bar, 0, 24, minor(h ? h[0] : 38), 0.5)]
				: []),
		];
	}),
];

// ── The cadence: Strauss's last three bars, the tonic, the bell ─────────────

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
		note("lead", bar, beat, dur, minor(p) - 12, 0.85),
	),
	note("lead", 3, 0, 3, 62, 0.8),
	...power(0, 43, 3, 0.85),
	...power(1, 45, 3, 0.85),
	...power(2, 38, 6, 0.9),
	...drums(0, 0.85),
	...drums(1, 0.85),
	note("kick", 2, 0, 0.5, KICK, 1),
	note("crash", 2, 0, 1, CRASH, 0.9),
	note("bell", 3, 0, 3, 38, 0.8),
	note("drone", 2, 0, 6, 38, 0.5),
];

/**
 * Score bars: the intro 0–5 (18 s), the loop 6–21 (48 s), the cadence
 * 22–25, slowing over its last two bars.
 */
export const DANUBE_DOOM: Song = {
	name: "An der schönen blauen Donau (doom)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 6, events: INTRO },
		{ name: "waltz", bars: LOOP_BARS, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: DOOM_BPM },
		{ bar: 23, bpm: DOOM_BPM },
		{ bar: 25, bpm: 44, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 5, echoBeats: 1, echoFeedback: 0.3 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_DOOM;
