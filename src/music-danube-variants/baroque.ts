/**
 * The Blue Danube as a baroque minuet: a listening spike beside the waltz
 * (`music-danube.ts`).
 *
 * **Strauss's notes, a continuo band.** The tune is the waltz module's
 * `THEME` and the harmony its `HARMONY`, kept in D major and in 3/4. The tune
 * is on a harpsichord; under it a second harpsichord runs in eighths through
 * each bar's chord, and an organ holds the continuo's bass.
 *
 * **Terraced dynamics**, the baroque's loud and soft in blocks rather than
 * swells: the first phrase forte, its repeat piano as an echo, the third
 * forte with the strings doubling the tune and the organ filling the chord,
 * the last fortissimo. A trill on the cadence's leading note.
 *
 * The intro is a short prelude: the second harpsichord broken over the
 * Andantino's own harmonies, with the horn's call on the first.
 */
import { HARMONY, THEME } from "../music-danube";
import { note } from "../music-danube-remeter";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const BAROQUE_BPM = 126;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The harpsichord: bright, quick to speak, quick to die.
	harpsi: {
		voice: "pluck",
		level: 0.608,
		decayS: 1.6,
		releaseS: 0.15,
		cutoffHz: 6500,
		pan: -0.15,
		reverb: 0.3,
	},
	// The second manual, running in eighths.
	runner: {
		voice: "pluck",
		level: 0.418,
		decayS: 1.1,
		releaseS: 0.1,
		cutoffHz: 4800,
		pan: 0.25,
		reverb: 0.3,
	},
	// The organ's continuo: a held bass, its sixteen-foot octave under it.
	organ: {
		voice: "keys",
		level: 0.38,
		attackS: 0.02,
		decayS: 4,
		sustain: 1,
		releaseS: 0.12,
		ratio: 1,
		index: 0.5,
		reverb: 0.45,
	},
	// The organ's right hand, filling the chord in the loud terraces.
	fill: {
		voice: "keys",
		level: 0.152,
		attackS: 0.03,
		decayS: 4,
		sustain: 1,
		releaseS: 0.15,
		ratio: 1,
		index: 0.4,
		pan: 0.1,
		reverb: 0.5,
	},
	strings: {
		voice: "strings",
		level: 0.304,
		attackS: 0.05,
		releaseS: 0.25,
		cutoffHz: 2200,
		vibrato: 0.06,
		pan: -0.3,
		reverb: 0.4,
	},
};

/** Six eighths through a chord: up from its lowest tone to the octave and
 *  back down. */
const broken = (
	bar: number,
	chord: readonly number[],
	vel: number,
	part = "runner",
): NoteEvent[] => {
	const [a, b, c] = [...chord].sort((x, y) => x - y);
	return [a, b, c, a + 12, c, b].map((p, i) =>
		note(part, bar, i / 2, 0.5, p, vel * (i === 0 ? 1 : 0.8)),
	);
};

/** The terraces: the first phrase forte, its echo piano, forte, then
 *  fortissimo from the theme's climax. */
type Terrace = "p" | "f" | "ff";
const terrace = (bar: number): Terrace =>
	bar <= 8 ? "f" : bar <= 16 ? "p" : bar <= 24 ? "f" : "ff";
const VEL: Readonly<Record<Terrace, number>> = { p: 0.62, f: 0.72, ff: 0.86 };

// ── Intro: a prelude over the Andantino's harmonies ─────────────────────────

/** `[bass, chord]` per bar: A major, then E7 over D, E, and A7. */
const PRELUDE: readonly (readonly [number, readonly number[]])[] = [
	[45, [57, 61, 64]],
	[45, [57, 61, 64]],
	[45, [57, 61, 64]],
	[45, [57, 61, 64]],
	[38, [56, 59, 62]],
	[38, [56, 59, 62]],
	[40, [59, 62, 66]],
	[45, [55, 61, 64]],
];

const INTRO: NoteEvent[] = [
	...PRELUDE.flatMap(([bass, chord], bar) => [
		...broken(bar, chord, 0.6),
		note("organ", bar, 0, 2.9, bass, 0.55),
	]),
	// The call, A–C#–E into the held E; E–G#–B into the held B; then the
	// thirds rising twice.
	...(
		[
			[1, 1.5, 69],
			[1, 2, 73],
			[1, 2.5, 76],
			[3, 1.5, 76],
			[3, 2, 80],
			[3, 2.5, 83],
		] as const
	).map(([bar, beat, p]) => note("harpsi", bar, beat, 0.5, p, 0.65)),
	note("harpsi", 2, 0, 2.5, 76, 0.6),
	note("harpsi", 4, 0, 2.5, 83, 0.6),
	...[5, 7].flatMap((bar) =>
		(
			[
				[1.5, [68, 71]],
				[2, [71, 74]],
				[2.5, [74, 78]],
			] as const
		).flatMap(([beat, ps]) =>
			ps.map((p) => note("harpsi", bar, beat, 0.5, p, 0.6)),
		),
	),
	...[74, 78].map((p) => note("harpsi", 6, 0, 2.5, p, 0.6)),
];

// ── Waltz No. 1, as a minuet ────────────────────────────────────────────────

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => {
		const t = terrace(bar);
		return [
			note("harpsi", bar, beat, dur, pitch, VEL[t]),
			// The answers an octave down on the second manual, in the loud
			// terraces, as a lute stop would double them.
			...(answer && t !== "p"
				? [
						note(
							"runner",
							bar,
							beat,
							Math.min(dur, 1),
							pitch - 12,
							VEL[t] * 0.7,
						),
					]
				: []),
			...(t !== "p"
				? [note("strings", bar, beat, dur, pitch, VEL[t] * 0.8)]
				: []),
		];
	}),
	...HARMONY.flatMap((h, bar) => {
		if (!h) return [];
		const [bass, chord, pad, how] = h;
		const t = terrace(bar);
		const v = VEL[t];
		return [
			...(how === "end" ? [] : broken(bar, chord, v * 0.85)),
			note("organ", bar, 0, 2.9, bass, v),
			note("organ", bar, 0, 2.9, bass - 12, v * 0.6),
			...(t === "p"
				? []
				: pad.map((p) => note("fill", bar, 0, 2.9, p, v * 0.7))),
		];
	}),
];

// ── The cadence: Strauss's last three bars, a trill, the tonic ──────────────

/** A trill: `n` sixteenths alternating a note with the one above. */
const trill = (
	bar: number,
	beat: number,
	n: number,
	lower: number,
	upper: number,
	vel: number,
): NoteEvent[] =>
	Array.from({ length: n }, (_, i) =>
		note("harpsi", bar, beat + i / 4, 0.25, i % 2 === 0 ? upper : lower, vel),
	);

const CADENCE: NoteEvent[] = [
	note("harpsi", 0, 0, 2, 78, 0.85),
	note("harpsi", 0, 2, 1, 76, 0.85),
	note("harpsi", 1, 0, 2, 83, 0.85),
	...trill(1, 2, 4, 81, 83, 0.8),
	note("harpsi", 2, 0, 1, 74, 0.85),
	note("harpsi", 2, 1.5, 0.5, 74, 0.8),
	note("harpsi", 2, 2, 1, 74, 0.85),
	...(
		[
			[0, 0, 78, 2],
			[0, 2, 76, 1],
			[1, 0, 83, 2],
			[1, 2, 81, 1],
			[2, 0, 74, 3],
		] as const
	).map(([bar, beat, p, dur]) => note("strings", bar, beat, dur, p, 0.65)),
	...broken(0, [55, 59, 62], 0.75),
	...broken(1, [57, 61, 64], 0.75),
	...broken(2, [57, 62, 66], 0.75),
	note("organ", 0, 0, 2.9, 43, 0.85),
	note("organ", 1, 0, 2.9, 45, 0.85),
	note("organ", 2, 0, 2.9, 38, 0.85),
	note("organ", 0, 0, 2.9, 31, 0.5),
	note("organ", 1, 0, 2.9, 33, 0.5),
	note("organ", 2, 0, 2.9, 26, 0.5),
	// The last chord: rolled on the harpsichord, held on organ and strings.
	...[50, 57, 62, 66, 74].map((p, i) =>
		note("harpsi", 3, i * 0.08, 2.8, p, 0.75),
	),
	note("organ", 3, 0, 3, 38, 0.8),
	note("organ", 3, 0, 3, 26, 0.5),
	...[62, 66, 69].map((p) => note("fill", 3, 0, 3, p, 0.6)),
	...[74, 86].map((p) => note("strings", 3, 0, 3, p, 0.7)),
];

/**
 * Score bars: the prelude 0–7, the minuet 8–39, the cadence 40–43, which
 * broadens over its last two bars.
 */
export const DANUBE_BAROQUE: Song = {
	name: "An der schönen blauen Donau (baroque)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: BAROQUE_BPM },
		{ bar: 41, bpm: BAROQUE_BPM },
		{ bar: 43, bpm: 92, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 2.6 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_BAROQUE;
