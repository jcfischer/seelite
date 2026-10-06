/**
 * The Blue Danube as ska: a listening spike beside the waltz
 * (`music-danube.ts`).
 *
 * **The oom-pah-pah is already half a skank.** The waltz puts its chords off
 * the bass on two and three; ska puts them off every beat. So the tune and
 * the harmony are the waltz module's own (`THEME`, `HARMONY`), re-metred into
 * 4/4 as the techno version does it — two waltz bars a bar, a waltz bar's
 * beats on the 3-3-2 sixteenth grid (`fourBeats`) — and the "pah" becomes the
 * off-beat chop of an organ and a guitar.
 *
 * The band: the tune on a reedy synth lead with a flute on the woodwinds'
 * answers (no brass: the synth's brass was heard as bad), the skank on organ
 * and guitar, a walking bass, and a ska kit — kick on one and three, snare on
 * two and four, the hi-hat's off-beat. The intro is a snare roll and the
 * horn's call over the skank; the cadence ends on two band hits.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const SKA_BPM = 116;

const KICK = 29;
const SNARE = 88;
const HAT = 104;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The tune: two saws, a quick bite on the filter, like a reed section.
	lead: {
		voice: "analog",
		level: 0.5,
		unison: 2,
		detune: 0.06,
		spread: 0.5,
		attackS: 0.02,
		decayS: 0.4,
		sustain: 0.7,
		releaseS: 0.12,
		cutoffHz: 1400,
		envAmount: 1.5,
		envDecayS: 0.3,
		pan: -0.1,
		reverb: 0.3,
		echo: 0.12,
	},
	flute: {
		voice: "flute",
		level: 0.24,
		pan: 0.25,
		reverb: 0.35,
	},
	// The organ's chop.
	skank: {
		voice: "keys",
		level: 0.3,
		attackS: 0.002,
		decayS: 0.3,
		sustain: 0.6,
		releaseS: 0.05,
		ratio: 1,
		index: 0.7,
		pan: 0.3,
		reverb: 0.2,
	},
	// The guitar's chop, bright and short.
	chop: {
		voice: "pluck",
		level: 0.375,
		decayS: 0.4,
		releaseS: 0.05,
		cutoffHz: 3500,
		pan: -0.3,
		reverb: 0.15,
	},
	bass: {
		voice: "pluck",
		level: 0.75,
		decayS: 1,
		releaseS: 0.1,
		cutoffHz: 520,
		reverb: 0.05,
	},
	kick: { voice: "kick", level: 0.6, reverb: 0.05 },
	snare: {
		voice: "noise",
		level: 0.22,
		decayS: 0.15,
		releaseS: 0.08,
		reverb: 0.3,
	},
	hat: { voice: "noise", level: 0.06, pan: 0.25, reverb: 0.1 },
	crash: {
		voice: "noise",
		level: 0.105,
		decayS: 1.8,
		releaseS: 0.8,
		resonance: 0.3,
		reverb: 0.4,
	},
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

/** A bass note folded into A1–G#2. */
const low = (p: number): number => 33 + ((((p - 33) % 12) + 12) % 12);

/** One waltz bar's chord as a half bar from `t`: the chop on both
 *  off-beats, the bass on the root and walking into `next`. */
function half(
	t: number,
	bass: number,
	chord: readonly number[],
	next: number,
	vel: number,
): NoteEvent[] {
	const root = low(bass);
	const to = low(next);
	const walk = to === root ? root + 4 : to + (to > root ? -1 : 1);
	return [
		...[0.5, 1.5].flatMap((o) => [
			...chord.map((p) => at("skank", t + o, 0.22, p + 12, vel * 0.8)),
			...chord.map((p) => at("chop", t + o, 0.18, p, vel * 0.7)),
		]),
		at("bass", t, 0.9, root, vel),
		at("bass", t + 1, 0.9, walk, vel * 0.85),
	];
}

/** The ska kit over `bars` bars from `bar`. */
function kit(bar: number, bars: number): NoteEvent[] {
	const out: NoteEvent[] = [];
	for (let b = bar; b < bar + bars; b++)
		for (let q = 0; q < 4; q++) {
			const t = b * 4 + q;
			if (q % 2 === 0) out.push(at("kick", t, 0.4, KICK, 0.85));
			else out.push(at("snare", t, 0.2, SNARE, 0.75));
			out.push(
				at("hat", t, 0.08, HAT, 0.45),
				at("hat", t + 0.5, 0.15, HAT, 0.8),
			);
		}
	return out;
}

const D = [54, 57, 62];
const A7 = [55, 57, 61];

// ── Intro: a snare roll, then the skank with the horn's call ────────────────

const INTRO: NoteEvent[] = [
	...Array.from({ length: 16 }, (_, i) =>
		at("snare", i / 4, 0.1, SNARE, 0.3 + i * 0.04),
	),
	at("crash", 4, 1, 100, 0.7),
	...half(4, 38, D, 38, 0.6),
	...half(6, 38, D, 38, 0.6),
	...half(8, 38, D, 33, 0.6),
	...half(10, 38, D, 33, 0.6),
	...half(12, 33, A7, 33, 0.6),
	...half(14, 33, A7, 38, 0.6),
	...kit(1, 3),
	// The call, A–C#–E into the held E, then E–G#–B into the held B.
	...(
		[
			[6.5, 69],
			[7, 73],
			[7.5, 76],
			[10.5, 76],
			[11, 80],
			[11.5, 83],
		] as const
	).map(([t, p]) => at("lead", t, 0.5, p, 0.6)),
	at("lead", 8, 2, 76, 0.55),
	at("lead", 12, 2.5, 83, 0.55),
];

// ── Waltz No. 1, as ska ─────────────────────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.62 : bar < 17 ? 0.66 : bar < 25 ? 0.76 : bar < 29 ? 0.88 : 0.82;

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		fromWaltz("lead", bar, beat, dur, pitch, dyn(bar)),
		...(answer ? [fromWaltz("flute", bar, beat, dur, pitch, dyn(bar))] : []),
	]),
	...HARMONY.flatMap((h, bar) => {
		const [bass, chord] = h ?? [33, A7];
		const next = HARMONY[bar + 1]?.[0] ?? 33;
		return half(bar * 2, bass, chord, next, dyn(bar));
	}),
	...kit(0, 16),
];

// ── The cadence: Strauss's last three bars, two hits, the crash ─────────────

const CADENCE: NoteEvent[] = [
	...(
		[
			[0, 0, 78, 2],
			[0, 2, 76, 1],
			[1, 0, 83, 2],
			[1, 2, 81, 1],
			[2, 0, 74, 1],
			[2, 1.5, 74, 0.5],
		] as const
	).map(([bar, beat, p, dur]) => fromWaltz("lead", bar, beat, dur, p, 0.85)),
	...half(0, 43, [55, 59, 62], 45, 0.85),
	...half(2, 45, [55, 61, 64], 38, 0.85),
	...kit(0, 1),
	// The hits: the band on the tune's last D, and again on the next bar.
	...[5.5, 8].flatMap((t) => [
		at("lead", t, t === 8 ? 3 : 0.5, 74, 0.9),
		at("flute", t, t === 8 ? 3 : 0.5, 86, 0.8),
		...D.map((p) => at("skank", t, t === 8 ? 2.5 : 0.4, p + 12, 0.8)),
		...D.map((p) => at("chop", t, t === 8 ? 1.5 : 0.3, p, 0.8)),
		at("bass", t, t === 8 ? 2 : 0.5, 38, 0.9),
		at("kick", t, 0.4, KICK, 0.95),
		at("snare", t, 0.2, SNARE, 0.8),
	]),
	at("crash", 8, 2, 100, 0.9),
];

/**
 * Score bars: the intro 0–3, the waltz 4–19, the cadence 20–23. The loop is
 * the waltz, 16 bars, 33 s at `SKA_BPM`; the cadence holds its tempo to the
 * last hit and then lets it ring.
 */
export const DANUBE_SKA: Song = {
	name: "An der schönen blauen Donau (ska)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 4, events: INTRO },
		{ name: "waltz", bars: 16, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: SKA_BPM },
		{ bar: 21, bpm: SKA_BPM },
		{ bar: 22, bpm: 104, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 1.8, echoBeats: 0.75, echoFeedback: 0.35 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_SKA;
