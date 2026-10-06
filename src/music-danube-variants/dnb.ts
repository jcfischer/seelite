/**
 * The Blue Danube as liquid drum & bass: a listening spike beside the
 * docking computer's waltz (`../music-danube.ts`).
 *
 * **One waltz bar a 4/4 bar, at 172.** The theme and the harmony are the
 * waltz module's own tables (`THEME`, `HARMONY`). A waltz bar's three beats
 * land on 0, 1.5 and 3 of a 4/4 bar — a 3-3-2 of eighths — so the tune moves
 * in dotted quarters, half as fast as the break under it: the half-time feel
 * the genre floats on. Waltz No. 1's 32 bars stay 32.
 *
 * Liquid, so the major key stays: Strauss's D major, with the harmony's
 * chords held as a wide pad. The tune is on an electric-piano FM into the
 * echo, the woodwinds' answers on flute, the bass a reese — detuned saws,
 * dark — on each bar's root, and the break a two-step: kick on one and the
 * "and" of two, snare on two and four, ghost snares and sixteenth hats.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const DNB_BPM = 172;

const KICK = 29;
const SNARE = 88;
const HAT = 106;

const PARTS: Readonly<Record<string, PartSpec>> = {
	kick: { voice: "kick", level: 0.55, reverb: 0.04 },
	snare: {
		voice: "noise",
		level: 0.22,
		decayS: 0.2,
		releaseS: 0.1,
		resonance: 0.45,
		reverb: 0.3,
	},
	hat: {
		voice: "noise",
		level: 0.05,
		decayS: 0.05,
		releaseS: 0.03,
		pan: 0.3,
		reverb: 0.1,
	},
	reese: {
		voice: "analog",
		level: 0.34,
		unison: 6,
		detune: 0.28,
		drift: 2,
		spread: 0.3,
		attackS: 0.02,
		decayS: 1,
		sustain: 0.9,
		releaseS: 0.15,
		cutoffHz: 380,
		envAmount: 0.6,
		envDecayS: 0.4,
		resonance: 0.2,
		sweepS: 9,
		sweepOct: 1,
		reverb: 0.04,
	},
	pad: {
		voice: "analog",
		level: 0.11,
		unison: 4,
		detune: 0.14,
		drift: 6,
		spread: 1,
		attackS: 0.8,
		decayS: 2,
		sustain: 0.85,
		releaseS: 1.2,
		cutoffHz: 1600,
		envAmount: 0.4,
		reverb: 0.7,
	},
	// An electric piano: FM at 1:1, the bark falling fast.
	lead: {
		voice: "fm",
		level: 0.25,
		attackS: 0.003,
		decayS: 1.6,
		sustain: 0.2,
		releaseS: 0.4,
		ratio: 1,
		index: 1.6,
		indexDecayS: 0.25,
		feedback: 0.1,
		pan: -0.15,
		reverb: 0.4,
		echo: 0.3,
	},
	answer: {
		voice: "flute",
		level: 0.12,
		glideS: 0.02,
		pan: 0.3,
		reverb: 0.5,
		echo: 0.3,
	},
	// The intro's air: a wash of noise with its band moving.
	air: {
		voice: "noise",
		level: 0.04,
		attackS: 2,
		sustain: 1,
		releaseS: 2,
		resonance: 0.8,
		sweepS: 8,
		sweepOct: 2.5,
		reverb: 0.7,
	},
};

/** A waltz beat in this bar's 4/4: the three beats on a 3-3-2 of eighths. */
const fourBeat = (w: number): number => (w < 2 ? w * 1.5 : 3 + (w - 2));

const note = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

/** A note written in waltz time, re-metred within its bar (and past it). */
const fromWaltz = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => {
	const abs = (w: number) => {
		const b = Math.floor(w / 3);
		return b * 4 + fourBeat(w - b * 3);
	};
	const from = abs(bar * 3 + beat);
	const len = abs(bar * 3 + beat + dur) - from;
	return note(part, Math.floor(from / 4), from % 4, len, pitch, vel);
};

/** One bar of the two-step break. `full` adds the ghosts. */
function breakbeat(bar: number, vel: number, full = true): NoteEvent[] {
	const out = [
		note("kick", bar, 0, 0.5, KICK, vel),
		note("kick", bar, 2.5, 0.5, KICK, vel * 0.85),
		note("snare", bar, 1, 0.3, SNARE, vel),
		note("snare", bar, 3, 0.3, SNARE, vel),
	];
	if (full)
		out.push(
			note("snare", bar, 1.75, 0.15, SNARE + 4, vel * 0.3),
			note("snare", bar, 3.5, 0.15, SNARE + 4, vel * 0.35),
		);
	for (let i = 0; i < 16; i++)
		out.push(note("hat", bar, i / 4, 0.1, HAT, vel * (i % 2 ? 0.45 : 0.75)));
	return out;
}

// ── Intro: air, the pad, the call, the hats, then the drop ─────────────────

const PAD_D = [57, 62, 66, 69];
const PAD_A = [55, 61, 64, 69];

const INTRO: NoteEvent[] = [
	note("air", 0, 0, 28, 80, 0.6),
	...PAD_D.map((p) => note("pad", 0, 0, 16, p, 0.55)),
	...PAD_A.map((p) => note("pad", 4, 0, 16, p, 0.55)),
	// The call, A–C#–E into the held E; E–G#–B into the held B.
	...(
		[
			[1, 2, 69],
			[1, 2.5, 73],
			[1, 3, 76],
			[3, 2, 76],
			[3, 2.5, 80],
			[3, 3, 83],
		] as const
	).map(([bar, beat, p]) => note("lead", bar, beat, 0.5, p, 0.6)),
	note("lead", 2, 0, 4, 76, 0.55),
	note("lead", 4, 0, 4, 83, 0.55),
	// Hats from bar 4, the break without its kick from bar 6.
	...[4, 5].flatMap((bar) =>
		Array.from({ length: 16 }, (_, i) =>
			note("hat", bar, i / 4, 0.1, HAT, 0.4 + (bar - 4) * 0.15),
		),
	),
	...[6, 7].flatMap((bar) =>
		breakbeat(bar, 0.7, false).filter((n) => n.part !== "kick"),
	),
	note("reese", 7, 2, 2, 33, 0.7),
];

// ── Waltz No. 1, one waltz bar a 4/4 bar ────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.65 : bar < 17 ? 0.7 : bar < 25 ? 0.8 : bar < 29 ? 0.9 : 0.85;

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		fromWaltz("lead", bar, beat, dur, pitch, dyn(bar)),
		...(answer ? [fromWaltz("answer", bar, beat, dur, pitch, dyn(bar))] : []),
		...(answer && beat === 2
			? [fromWaltz("lead", bar, 1.9, 0.1, pitch - 1, dyn(bar) * 0.55)]
			: []),
	]),
	...HARMONY.flatMap((h, bar) => {
		const root = h ? h[0] : 38;
		const pad = h ? h[2] : PAD_D;
		return [
			...breakbeat(bar, dyn(bar)),
			// The reese on the root, an octave dropping in on the "and" of two.
			note("reese", bar, 0, 2.4, root - 12 < 26 ? root : root - 12, dyn(bar)),
			note(
				"reese",
				bar,
				2.5,
				1.4,
				root - 12 < 26 ? root : root - 12,
				dyn(bar) * 0.85,
			),
			...(bar % 2 === 0
				? pad.map((p) => note("pad", bar, 0, 8, p, dyn(bar) * 0.6))
				: []),
		];
	}),
];

// ── The cadence: Strauss's last three bars, then the pad left to ring ──────

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
	).map(([bar, beat, p, dur]) => fromWaltz("lead", bar, beat, dur, p, 0.85)),
	note("lead", 3, 0, 4, 74, 0.75),
	note("answer", 3, 0, 4, 86, 0.7),
	...breakbeat(0, 0.85),
	...breakbeat(1, 0.85),
	...breakbeat(2, 0.85, false).filter((n) => n.beat < 2),
	note("reese", 0, 0, 4, 31, 0.85),
	note("reese", 1, 0, 4, 33, 0.85),
	note("reese", 2, 0, 2, 38, 0.85),
	...[50, ...PAD_D].map((p) => note("pad", 2, 0, 8, p, 0.6)),
	note("kick", 3, 0, 0.5, KICK, 0.9),
	note("snare", 3, 0, 0.3, SNARE, 0.6),
];

/**
 * Score bars: the intro 0–7 (11 s), the waltz 8–39 (44.7 s a loop), the
 * cadence 40–43, which does not slow: the break stops instead.
 */
export const DANUBE_DNB: Song = {
	name: "An der schönen blauen Donau (liquid drum & bass)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [{ bar: 0, bpm: DNB_BPM }],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 3, echoBeats: 0.75, echoFeedback: 0.4 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_DNB;
