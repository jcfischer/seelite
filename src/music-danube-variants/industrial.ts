/**
 * The Blue Danube as industrial / EBM that stays a waltz: a listening spike
 * beside the docking computer's waltz (`../music-danube.ts`).
 *
 * **Still 3/4, bar for bar.** The theme and the harmony are the waltz
 * module's own tables (`THEME`, `HARMONY`); nothing is re-metred. The
 * oom-pah-pah becomes a factory: the kick stamps the first beat, and the
 * "pah, pah" are two resonant metal hits — an anvil and a clank — with steam
 * hissing on the eighths. The bass is EBM's: a distorted acid line in eighths
 * between the kicks, on each bar's root.
 *
 * In D minor, as the techno version is: every F# an F, every B a B flat, the
 * C# kept. The theme is an octave down on a hard saw lead, and the
 * woodwinds' answers ring on an inharmonic FM bell, which is metal too.
 */
import {
	CADENCE_THEME,
	DANUBE_VOICINGS,
	HARMONY,
	THEME,
} from "../music-danube";
import { minor, note } from "../music-danube-remeter";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const INDUSTRIAL_BPM = 132;

const KICK = 29;
const ANVIL = [95, 99];
const CLANK = 77;
const STEAM = 108;

const PARTS: Readonly<Record<string, PartSpec>> = {
	kick: { voice: "kick", level: 0.6, reverb: 0.12 },
	// Resonant noise rings at its band's centre: struck metal.
	anvil: {
		voice: "noise",
		level: 0.16,
		decayS: 0.35,
		releaseS: 0.15,
		resonance: 0.95,
		pan: 0.25,
		reverb: 0.35,
	},
	clank: {
		voice: "noise",
		level: 0.2,
		decayS: 0.18,
		releaseS: 0.08,
		resonance: 0.9,
		pan: -0.25,
		reverb: 0.3,
	},
	steam: {
		voice: "noise",
		level: 0.05,
		decayS: 0.08,
		releaseS: 0.05,
		resonance: 0.2,
		pan: 0.4,
		reverb: 0.1,
	},
	// The intro's machinery: a wash of noise, its band sweeping.
	machine: {
		voice: "noise",
		level: 0.06,
		attackS: 1.5,
		sustain: 1,
		releaseS: 1.5,
		resonance: 0.85,
		sweepS: 6,
		sweepOct: 2.5,
		reverb: 0.6,
	},
	bass: {
		voice: "acid",
		level: 0.56,
		cutoffHz: 220,
		envAmount: 2.6,
		envDecayS: 0.14,
		resonance: 0.72,
		drive: 0.95,
		glideS: 0,
		sweepS: 20,
		sweepOct: 1.2,
		reverb: 0.05,
	},
	pad: {
		voice: "drone",
		level: 0.13,
		attackS: 1,
		releaseS: 1.2,
		detune: 0.12,
		drift: 8,
		spread: 1,
		reverb: 0.6,
	},
	lead: {
		voice: "analog",
		level: 0.34,
		unison: 2,
		detune: 0.08,
		spread: 0.5,
		attackS: 0.005,
		decayS: 0.4,
		sustain: 0.6,
		releaseS: 0.12,
		cutoffHz: 900,
		envAmount: 2.2,
		envDecayS: 0.18,
		resonance: 0.45,
		reverb: 0.3,
		echo: 0.2,
	},
	// An inharmonic bell: the modulator off any whole ratio rings as metal.
	bell: {
		voice: "fm",
		level: 0.15,
		attackS: 0.002,
		decayS: 1.2,
		sustain: 0,
		releaseS: 0.4,
		ratio: 3.53,
		index: 4,
		indexDecayS: 0.5,
		pan: 0.3,
		reverb: 0.5,
		echo: 0.3,
	},
	// The horn call on the waltz's bowed desk, ground harder.
	horn: {
		...DANUBE_VOICINGS.orchestra.horn,
		level: 0.24,
		drive: 0.8,
		rosin: 0.7,
		reverb: 0.6,
	},
};

/** The factory for one bar: the kick, the two metal "pahs", the steam. */
function factory(bar: number, vel: number, steam = true): NoteEvent[] {
	const out = [
		note("kick", bar, 0, 0.5, KICK, vel),
		note("anvil", bar, 1, 0.3, ANVIL[bar % 2], vel * 0.85),
		note("clank", bar, 2, 0.3, CLANK, vel * 0.9),
	];
	if (steam)
		for (const b of [0.5, 1.5, 2.5])
			out.push(note("steam", bar, b, 0.1, STEAM, vel * 0.7));
	return out;
}

/** The EBM bass for one bar: eighths on `root` after the kick. */
const grind = (bar: number, root: number, vel: number): NoteEvent[] =>
	[0.5, 1, 1.5, 2, 2.5].map((b, i) =>
		note(
			"bass",
			bar,
			b,
			0.25,
			i === 2 ? root + 12 : root,
			vel * (i % 2 ? 0.75 : 0.9),
		),
	);

// ── Intro: the machine starting up, the call, the stomp coming in ──────────

const INTRO: NoteEvent[] = [
	note("machine", 0, 0, 24, 70, 0.6),
	...[50, 57, 62, 65].map((p) => note("pad", 0, 0, 12, p, 0.45)),
	...[49, 57, 61, 64].map((p) => note("pad", 4, 0, 12, p, 0.45)),
	// The call, A–C#–E into the held E, then D–F–A into the held A.
	...(
		[
			[1, 1.5, 57],
			[1, 2, 61],
			[1, 2.5, 64],
			[3, 1.5, 50],
			[3, 2, 53],
			[3, 2.5, 57],
		] as const
	).map(([bar, beat, p]) => note("horn", bar, beat, 0.5, p, 0.55)),
	note("horn", 2, 0, 3, 64, 0.5),
	note("horn", 4, 0, 3, 57, 0.5),
	// The clank alone, then the whole factory.
	...[2, 3].map((bar) => note("clank", bar, 2, 0.3, CLANK, 0.6)),
	...[4, 5, 6, 7].flatMap((bar) =>
		factory(bar, 0.5 + (bar - 4) * 0.12, bar >= 6),
	),
	...[6, 7].flatMap((bar) => grind(bar, 33, 0.7)),
];

// ── Waltz No. 1, bar for bar ────────────────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.62 : bar < 17 ? 0.68 : bar < 25 ? 0.8 : bar < 29 ? 0.92 : 0.86;

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		note("lead", bar, beat, dur, minor(pitch) - 12, dyn(bar)),
		...(answer
			? [note("bell", bar, beat, Math.min(dur, 1), minor(pitch), dyn(bar))]
			: []),
		...(answer && beat === 2
			? [note("lead", bar, 1.9, 0.1, minor(pitch) - 13, dyn(bar) * 0.6)]
			: []),
	]),
	...HARMONY.flatMap((h, bar) => {
		const root = minor(h ? h[0] : 38);
		const pad = h ? h[2] : [57, 62, 65];
		return [
			...factory(bar, dyn(bar)),
			...grind(bar, root, dyn(bar)),
			...pad.map((p) => note("pad", bar, 0, 3, minor(p), dyn(bar) * 0.6)),
		];
	}),
];

// ── The cadence: Strauss's last three bars, then one last stamp ────────────

const CADENCE: NoteEvent[] = [
	...CADENCE_THEME.map(([bar, beat, p, dur]) =>
		note("lead", bar, beat, dur, minor(p) - 12, 0.86),
	),
	note("lead", 3, 0, 3, 62, 0.8),
	note("bell", 3, 0, 2, 74, 0.85),
	...factory(0, 0.86),
	...factory(1, 0.86),
	...factory(2, 0.86),
	...grind(0, 43, 0.86),
	...grind(1, 45, 0.86),
	...grind(2, 38, 0.86),
	...[50, 57, 62, 65].map((p) => note("pad", 2, 0, 6, p, 0.5)),
	note("kick", 3, 0, 0.5, KICK, 1),
	note("anvil", 3, 0, 0.5, ANVIL[0], 1),
	note("clank", 3, 0, 0.5, CLANK, 0.9),
];

/**
 * Score bars: the intro 0–7, the waltz 8–39, the cadence 40–43. One tempo
 * throughout, a loop of 32 bars, 43.6 s; the cadence slows in its last bar.
 */
export const DANUBE_INDUSTRIAL: Song = {
	name: "An der schönen blauen Donau (industrial)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: INDUSTRIAL_BPM },
		{ bar: 42, bpm: INDUSTRIAL_BPM },
		{ bar: 43, bpm: 110, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 2.8, echoBeats: 0.5, echoFeedback: 0.35 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_INDUSTRIAL;
