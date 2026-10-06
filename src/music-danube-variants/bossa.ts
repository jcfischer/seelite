/**
 * The Blue Danube as bossa nova: the docking computer as a hotel lobby, a
 * listening spike beside the waltz (`music-danube.ts`).
 *
 * **Strauss's tune, re-metred into 4/4** as the techno version does it: two
 * waltz bars a bar, a waltz bar's beats on the 3-3-2 sixteenth grid
 * (`fourBeats`). That grid is the bossa's own syncopation, so the tune falls
 * into the style rather than against it. The harmony is the jazz waltz's
 * changes (one chord per waltz bar, so two a bar here), ninths and
 * thirteenths.
 *
 * The band: the tune on soft-edged saws, the woodwinds' answers on a soft
 * mallet an octave under it, an electric piano comping in the bossa pattern
 * (`keys`, one part, so a sampled piano is a one-line swap), an upright
 * bass on the root and fifth, a rim clave, a shaker and a soft kick. The
 * intro is the electric piano alone, then the horn's call on the lead.
 */
import { THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const BOSSA_BPM = 124;

const KICK = 29;
const RIM = 92;
const SHAKER = 106;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The tune: soft-edged saws, round and mellowing as each note rings,
	// into a little of the echo.
	lead: {
		voice: "softsaw",
		level: 0.4,
		attackS: 0.012,
		decayS: 2.4,
		sustain: 0.45,
		releaseS: 0.35,
		unison: 6,
		detune: 0.05,
		spread: 0.6,
		pan: -0.1,
		reverb: 0.35,
		echo: 0.22,
	},
	// The woodwinds' answers an octave under the tune: a soft mallet.
	answer: {
		voice: "fm",
		level: 0.34,
		attackS: 0.003,
		decayS: 1.6,
		sustain: 0,
		releaseS: 0.4,
		ratio: 1,
		index: 1.1,
		indexDecayS: 0.25,
		feedback: 0,
		pan: 0.3,
		reverb: 0.35,
	},
	// The comping: an electric piano, soft and rounded — the body darkened
	// and the tine's strike held back — in the bossa pattern.
	keys: {
		voice: "epiano",
		level: 0.35,
		decayS: 3,
		releaseS: 0.3,
		index: 1.4,
		envAmount: 0.6,
		pan: 0.2,
		reverb: 0.3,
	},
	// An upright bass on the root and fifth: a low pluck, dark and short.
	bass: {
		voice: "pluck",
		level: 0.85,
		decayS: 1,
		releaseS: 0.12,
		cutoffHz: 420,
		pan: 0.05,
		reverb: 0.08,
	},
	rim: {
		voice: "noise",
		level: 0.135,
		decayS: 0.04,
		releaseS: 0.03,
		resonance: 0.9,
		pan: -0.25,
		reverb: 0.2,
	},
	shaker: {
		voice: "noise",
		level: 0.075,
		attackS: 0.01,
		decayS: 0.06,
		releaseS: 0.04,
		resonance: 0.2,
		pan: 0.35,
		reverb: 0.1,
	},
	kick: { voice: "kick", level: 0.33, reverb: 0.05 },
};

/** A waltz position in 4/4 beats: two waltz bars a 4/4 bar, a waltz bar's
 *  beats on the 3-3-2 sixteenth grid. */
const fourBeats = (waltzBeats: number): number => {
	const bar = Math.floor(waltzBeats / 3);
	const w = waltzBeats - bar * 3;
	return bar * 2 + (w < 2 ? w * 0.75 : 1.5 + (w - 2) * 0.5);
};

/** One note at an absolute 4/4 beat of its section. */
const at = (
	part: string,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({
	part,
	bar: Math.floor(beat / 4),
	beat: beat - Math.floor(beat / 4) * 4,
	dur,
	pitch,
	vel,
});

/** A note written in waltz time, re-metred. */
const fromWaltz = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => {
	const from = fourBeats(bar * 3 + beat);
	return at(part, from, fourBeats(bar * 3 + beat + dur) - from, pitch, vel);
};

// ── The changes, as the jazz waltz has them ─────────────────────────────────

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
type Change = readonly [number, Quality];
const D = 2;
const E = 4;
const G = 7;
const A = 9;
const B = 11;

/** The comping's voicing: every chord tone folded into E3–D#4, rootless. */
const voicing = ([root, q]: Change): number[] =>
	[...new Set(QUALITY[q].map((i) => 52 + ((root + i - 52 + 120) % 12)))].sort(
		(a, b) => a - b,
	);

/** The bass's root, folded into A1–G#2. */
const bassRoot = ([root]: Change): number => 33 + ((root - 9 + 12) % 12);

/** One chord per waltz bar of `THEME` (bar 0 is the upbeat). */
const CHANGES: readonly Change[] = [
	[A, "13"],
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

/** Where the comping strikes in a two-beat half bar, alternating:
 *  the bossa's long-short push against the bass. */
const STRIKES: readonly (readonly number[])[] = [
	[0, 0.75, 1.5],
	[0.5, 1.25],
];

/** The comping and the bass over one half bar (two beats from `t`) on `c`. */
function comp(t: number, half: number, c: Change, vel: number): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (const s of STRIKES[half % 2])
		for (const p of voicing(c)) out.push(at("keys", t + s, 0.4, p, vel * 0.7));
	const root = bassRoot(c);
	out.push(
		at("bass", t, 1.4, root, vel),
		at("bass", t + 1, 0.9, root + 7, vel * 0.8),
	);
	return out;
}

/** The percussion over `bars` bars from `bar`: the rim's clave across two
 *  bars, the shaker on the sixteenths, the kick's dotted pulse. */
function kit(bar: number, bars: number, kick = true): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (let b = bar; b < bar + bars; b++) {
		const t = b * 4;
		const clave =
			(b - bar) % 2 === 0 ? [0, 0.75, 1.5, 2.5, 3.25] : [0.5, 1.5, 2.25, 3];
		for (const c of clave) out.push(at("rim", t + c, 0.05, RIM, 0.75));
		for (let i = 0; i < 16; i++)
			out.push(at("shaker", t + i / 4, 0.05, SHAKER, i % 2 === 1 ? 0.7 : 0.4));
		if (kick)
			for (const k of [0, 1.5, 2, 3.5])
				out.push(at("kick", t + k, 0.4, KICK, k % 2 === 0 ? 0.8 : 0.55));
	}
	return out;
}

// ── Intro: the keys alone, then the horn's call on the lead ─────────────────

const INTRO_CHANGES: readonly Change[] = [
	[D, "maj9"],
	[D, "maj9"],
	[E, "m9"],
	[A, "13"],
	[D, "maj9"],
	[D, "maj9"],
	[E, "m9"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
	[D, "maj9"],
	[B, "7#9"],
	[E, "m9"],
	[A, "13"],
];

const INTRO: NoteEvent[] = [
	...INTRO_CHANGES.flatMap((c, h) => comp(h * 2, h, c, 0.55)),
	...kit(2, 2, false),
	...kit(4, 4),
	// The call, A–C#–E into the held E, then E–G#–B into the held B.
	...(
		[
			[18.5, 69],
			[19, 73],
			[19.5, 76],
			[26.5, 76],
			[27, 80],
			[27.5, 83],
		] as const
	).map(([t, p]) => at("lead", t, 0.5, p, 0.55)),
	at("lead", 20, 5, 76, 0.5),
	at("lead", 28, 3.5, 83, 0.5),
];

// ── Waltz No. 1, as a bossa ─────────────────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.6 : bar < 17 ? 0.64 : bar < 25 ? 0.72 : bar < 29 ? 0.8 : 0.76;

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		fromWaltz("lead", bar, beat, dur, pitch, dyn(bar)),
		...(answer
			? [fromWaltz("answer", bar, beat, Math.min(dur, 1), pitch - 12, dyn(bar))]
			: []),
	]),
	...CHANGES.flatMap((c, bar) => comp(bar * 2, bar, c, dyn(bar))),
	...kit(0, 16),
];

// ── The cadence: Strauss's last three bars, and the keys' last chord ─────────

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
	).map(([bar, beat, p, dur]) => fromWaltz("lead", bar, beat, dur, p, 0.75)),
	at("lead", 6, 6, 74, 0.7),
	...comp(0, 0, [E, "m9"], 0.75),
	...comp(2, 1, [A, "13"], 0.75),
	...comp(4, 0, [D, "69"], 0.7),
	// The last chord, rolled slowly, with the bass on D.
	...voicing([D, "69"]).map((p, i) => at("keys", 8 + i * 0.1, 3, p, 0.6)),
	...[62, 66, 69, 74].map((p, i) => at("answer", 8.4 + i * 0.12, 3, p, 0.45)),
	at("bass", 8, 4, 38, 0.7),
	...kit(0, 2),
	at("rim", 8, 0.05, RIM, 0.8),
];

/**
 * Score bars: the intro 0–7, the waltz 8–23, the cadence 24–27. The loop is
 * the waltz, 16 bars, 31 s at `BOSSA_BPM`; the cadence slows over its last
 * two bars.
 */
export const DANUBE_BOSSA: Song = {
	name: "An der schönen blauen Donau (bossa nova)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 16, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: BOSSA_BPM },
		{ bar: 25, bpm: BOSSA_BPM },
		{ bar: 27, bpm: 100, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 2, echoBeats: 0.75, echoFeedback: 0.3 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_BOSSA;
