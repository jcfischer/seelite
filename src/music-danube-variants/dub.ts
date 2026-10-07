/**
 * The Blue Danube as dub techno, after Basic Channel: a listening spike
 * beside the docking computer's waltz (`music-danube.ts`).
 *
 * **Strauss's notes, re-metred and pushed into the echo.** The theme and the
 * harmony are the waltz module's own tables. As in the dark-techno version,
 * two waltz bars are one 4/4 bar on a 3-3-2 sixteenth grid (`fourBeats`), and
 * the key is D minor (F# to F, B to B flat). Here the tune is a quiet,
 * filtered lead, and what carries the track is the harmony: each waltz bar's
 * chord is one short stab on the off-beat, thrown into a dotted-eighth echo
 * that feeds back for most of a bar. Under it a sine sub on each bar's root,
 * a soft four-on-the-floor kick, hiss on the off-beats and a bed of crackle.
 *
 * The form keeps the waltz's contract: an intro, the waltz looping, and a
 * `resolve` to the cadence on the next bar line.
 */
import { CADENCE_THEME, HARMONY, THEME } from "../music-danube";
import { at, fromWaltz, minor } from "../music-danube-remeter";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const DUB_BPM = 116;

const KICK = 29;
const HAT = 106;
const CRACKLE = 112;

const PARTS: Readonly<Record<string, PartSpec>> = {
	kick: { voice: "kick", level: 0.5, reverb: 0.05 },
	hat: {
		voice: "noise",
		level: 0.05,
		decayS: 0.08,
		releaseS: 0.05,
		pan: 0.25,
		reverb: 0.15,
		echo: 0.2,
	},
	crackle: {
		voice: "noise",
		level: 0.022,
		attackS: 0.5,
		sustain: 1,
		releaseS: 0.5,
		resonance: 0.1,
		pan: -0.3,
		reverb: 0.2,
	},
	// The stab: a dark detuned chord, its filter snapping shut, into the echo.
	stab: {
		voice: "analog",
		level: 0.17,
		unison: 2,
		detune: 0.1,
		spread: 0.9,
		attackS: 0.004,
		decayS: 0.22,
		sustain: 0.1,
		releaseS: 0.12,
		cutoffHz: 650,
		envAmount: 1.6,
		envDecayS: 0.14,
		resonance: 0.25,
		reverb: 0.5,
		echo: 0.75,
	},
	// The tune, an octave down, soft and filtered, half in the echo.
	lead: {
		voice: "analog",
		level: 0.12,
		unison: 2,
		detune: 0.08,
		spread: 0.5,
		attackS: 0.02,
		decayS: 0.6,
		sustain: 0.45,
		releaseS: 0.2,
		cutoffHz: 900,
		envAmount: 0.8,
		envDecayS: 0.3,
		pan: -0.15,
		reverb: 0.45,
		echo: 0.45,
	},
	// A sine under each bar's root.
	sub: {
		voice: "tone",
		level: 0.42,
		attackS: 0.01,
		decayS: 1.2,
		sustain: 0.5,
		releaseS: 0.12,
		ratio: 1,
	},
};

/** The kit over `bars` bars: kick on the beat, hiss on the off-beat, and a
 *  bar of crackle held under each. */
function kit(bar: number, bars: number, kick = true): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (let b = bar; b < bar + bars; b++) {
		out.push(at("crackle", b * 4, 4, CRACKLE, 0.6));
		for (let q = 0; q < 4; q++) {
			if (kick) out.push(at("kick", b * 4 + q, 0.5, KICK, 0.8));
			out.push(at("hat", b * 4 + q + 0.5, 0.1, HAT, q % 2 ? 0.7 : 0.5));
		}
	}
	return out;
}

/** A stab of `chord` at `beat`. */
const stab = (beat: number, chord: readonly number[], vel: number) =>
	chord.map((p) => at("stab", beat, 0.25, p, vel));

const DM = [57, 62, 65];
const A = [57, 61, 64];

// ── Intro: crackle, the stabs alone, then the kick and the sub ─────────────

const INTRO: NoteEvent[] = [
	...kit(0, 4, false),
	...kit(4, 4),
	...Array.from({ length: 8 }, (_, b) =>
		stab(b * 4 + 0.5, b < 4 ? DM : A, 0.55 + b * 0.04),
	).flat(),
	...[4, 5].map((b) => at("sub", b * 4, 4, 38, 0.8)),
	...[6, 7].map((b) => at("sub", b * 4, 4, 33, 0.8)),
];

// ── Waltz No. 1, re-metred: the stabs carry the harmony ────────────────────

const dyn = (bar: number) => (bar < 17 ? 0.6 : bar < 25 ? 0.72 : 0.82);

const WALTZ: NoteEvent[] = [
	...THEME.map(([bar, beat, pitch, dur]) =>
		fromWaltz("lead", bar, beat, dur, minor(pitch) - 12, dyn(bar)),
	),
	// Each waltz bar: its chord as a stab on the off-beat of its half of the
	// 4/4 bar, and the sub on its root.
	...HARMONY.flatMap((h, bar) => {
		const pad = h ? h[2] : DM;
		const root = minor(h ? h[0] : 38);
		const t = bar * 2;
		return [
			...stab(t + 0.5, pad.map(minor), dyn(bar)),
			at("sub", t, 2, root, 0.8),
		];
	}),
	...kit(0, 16),
];

// ── The cadence: Strauss's last three bars, a last stab into the echo ──────

const CADENCE: NoteEvent[] = [
	...CADENCE_THEME.map(([bar, beat, p, dur]) =>
		fromWaltz("lead", bar, beat, dur, minor(p) - 12, 0.8),
	),
	at("lead", 6, 6, 62, 0.7),
	...stab(0.5, [55, 58, 62], 0.8),
	...stab(2.5, [55, 61, 64], 0.8),
	...stab(4.5, DM, 0.8),
	...stab(8.5, DM, 0.9),
	at("sub", 0, 2, 43, 0.8),
	at("sub", 2, 2, 33, 0.8),
	at("sub", 4, 6, 38, 0.8),
	...kit(0, 2),
	at("kick", 8, 0.5, KICK, 0.9),
	at("crackle", 8, 8, CRACKLE, 0.6),
];

/**
 * Score bars: the intro 0–7, the waltz 8–23, the cadence 24–27. A loop is
 * 16 bars, 33 s at `DUB_BPM`; the cadence slows over its last two bars.
 */
const DANUBE_DUB: Song = {
	name: "An der schönen blauen Donau (dub techno)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 16, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: DUB_BPM },
		{ bar: 25, bpm: DUB_BPM },
		{ bar: 27, bpm: 100, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 3.5, echoBeats: 0.75, echoFeedback: 0.62 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_DUB;
