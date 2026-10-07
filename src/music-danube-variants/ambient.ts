/**
 * The Blue Danube as ambient music, after Eno's *Music for Airports*: a
 * listening spike beside the docking computer's waltz (`music-danube.ts`).
 *
 * **Strauss's notes, slowed until they float.** The theme is the waltz
 * module's own `THEME`, at 60 beats a minute against the waltz's 160, on a
 * soft decaying piano into a long echo; each answer the woodwinds double is
 * a quiet glass bell an octave up. Under it the harmony is a drone bed: each
 * run of bars that share one chord in `HARMONY` is one held chord, swelling
 * in and out. There is no beat.
 *
 * The form keeps the waltz's contract: an intro, the waltz looping, and a
 * `resolve` to the cadence on the next bar line.
 */
import { CADENCE_THEME, HARMONY, THEME } from "../music-danube";
import { note } from "../music-danube-remeter";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const AMBIENT_BPM = 60;

const PARTS: Readonly<Record<string, PartSpec>> = {
	piano: {
		voice: "keys",
		level: 0.4,
		attackS: 0.01,
		decayS: 4,
		sustain: 0,
		releaseS: 2,
		ratio: 1.002,
		index: 0.35,
		reverb: 0.8,
		echo: 0.4,
	},
	glass: {
		voice: "fm",
		level: 0.12,
		attackS: 0.02,
		decayS: 3,
		sustain: 0,
		releaseS: 1.5,
		ratio: 3.5,
		index: 0.8,
		indexDecayS: 1,
		feedback: 0,
		pan: 0.35,
		reverb: 0.9,
		echo: 0.5,
	},
	bed: {
		voice: "drone",
		level: 0.17,
		attackS: 3,
		releaseS: 3.5,
		detune: 0.08,
		drift: 5,
		spread: 1,
		reverb: 0.7,
	},
	low: {
		voice: "pad",
		level: 0.16,
		attackS: 2.5,
		releaseS: 3,
		cutoffHz: 400,
		reverb: 0.5,
	},
};

// ── Intro: the bed swells, the horn's call on the piano, slowly ────────────

const INTRO: NoteEvent[] = [
	...[50, 57, 62, 66].map((p) => note("bed", 0, 0, 9, p, 0.5)),
	note("low", 0, 0, 9, 38, 0.5),
	...[52, 57, 61, 64].map((p) => note("bed", 3, 0, 9, p, 0.5)),
	note("low", 3, 0, 9, 45, 0.5),
	...(
		[
			[1, 0, 69],
			[1, 1, 73],
			[1, 2, 76],
			[2, 1, 76],
			[3, 0, 76],
			[3, 1, 80],
			[3, 2, 83],
		] as const
	).map(([bar, beat, p]) => note("piano", bar, beat, 2, p, 0.45)),
	note("glass", 4, 0, 3, 88, 0.4),
];

// ── Waltz No. 1, slowed, over its harmony held as a bed ────────────────────

/** Loudness by bar: still quiet at the waltz's ff. */
const dyn = (bar: number) => (bar < 17 ? 0.45 : bar < 25 ? 0.55 : 0.62);

/** `HARMONY` merged into runs of one chord: `[from, bars, bass, pad]`. */
const runs = (): [number, number, number, readonly number[]][] => {
	const out: [number, number, number, readonly number[]][] = [];
	HARMONY.forEach((h, bar) => {
		if (!h) return;
		const last = out[out.length - 1];
		if (last && last[3].join() === h[2].join() && last[2] === h[0]) last[1]++;
		else out.push([bar, 1, h[0], h[2]]);
	});
	return out;
};

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		note("piano", bar, beat, Math.max(dur, 1), pitch, dyn(bar)),
		...(answer && beat === 2
			? [note("glass", bar, beat, 2, pitch + 12, dyn(bar) * 0.8)]
			: []),
	]),
	// The upbeat's bed, so the loop's seam is never bare.
	...[57, 62, 66].map((p) => note("bed", 0, 0, 3, p, 0.4)),
	...runs().flatMap(([bar, bars, bass, pad]) => [
		...pad.map((p) => note("bed", bar, 0, bars * 3, p, 0.45)),
		note("low", bar, 0, bars * 3, bass, 0.45),
	]),
];

// ── The cadence: Strauss's last three bars, the tonic left to fade ─────────

const CADENCE: NoteEvent[] = [
	...[...CADENCE_THEME, [3, 0, 74, 3] as const].map(([bar, beat, p, dur]) =>
		note("piano", bar, beat, dur, p, 0.55),
	),
	note("glass", 3, 0, 3, 86, 0.5),
	...[55, 59, 62].map((p) => note("bed", 0, 0, 3, p, 0.45)),
	...[55, 61, 64].map((p) => note("bed", 1, 0, 3, p, 0.45)),
	...[50, 57, 62, 66].map((p) => note("bed", 2, 0, 6, p, 0.5)),
	note("low", 0, 0, 3, 31, 0.45),
	note("low", 1, 0, 3, 33, 0.45),
	note("low", 2, 0, 6, 38, 0.5),
];

/**
 * Score bars: the intro 0–5, the waltz 6–37, the cadence 38–41. A loop of
 * the waltz is 96 s at `AMBIENT_BPM`; the cadence slows over its last two
 * bars.
 */
const DANUBE_AMBIENT: Song = {
	name: "An der schönen blauen Donau (ambient)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 6, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: AMBIENT_BPM },
		{ bar: 39, bpm: AMBIENT_BPM },
		{ bar: 41, bpm: 46, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 7, echoBeats: 1.5, echoFeedback: 0.45 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_AMBIENT;
