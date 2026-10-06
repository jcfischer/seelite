/**
 * The Blue Danube as Balinese gamelan: a listening spike beside the docking
 * computer's waltz (`music-danube.ts`), on the same synth.
 *
 * **Strauss's tune, retuned.** The theme is the waltz module's `THEME` and
 * the low gong tones follow its `HARMONY`; every pitch is moved onto a
 * pelog-like seven-tone scale, so the melody keeps its contour and loses
 * the equal temperament. The tuning, in cents above the tonic D, degree by
 * degree of D major (`PELOG_CENTS`):
 *
 *     D 0 · E 120 · F# 270 · G 540 · A 670 · B 785 · C# 950
 *
 * — narrow and wide steps, as pelog has, rather than tones and semitones. A
 * chromatic note snaps to the degree below it. Pitches are fractional MIDI.
 *
 * The ensemble: the tune an octave down on a metallophone (`fm` at a stretched ratio, so
 * the partials are inharmonic), the jegogan's low tones on each bar's root,
 * and two gangsa parts in **kotekan** — an interlocking sixteenth-note
 * figure around the melody tone that neither part plays alone: polos takes
 * the first and third sixteenths of each beat, sangsih the second and
 * fourth. Sangsih is tuned a little sharp of polos, so together they beat
 * (ombak). A kempli marks every beat; the gong closes each eight-bar cycle
 * and the kempur halves it.
 *
 * The meter stays 3/4. The form keeps the waltz's contract: an intro (the
 * horn's call on the metallophone, out of time, then the kotekan speeding
 * in), Waltz No. 1 looping, and a `resolve` to the cadence.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const GAMELAN_BPM = 132;
const OPENING_BPM = 72;

/** Cents above D for each degree of D major, as a pelog-like set. */
const PELOG_CENTS = [0, 120, 270, 540, 670, 785, 950];
/** Semitones above D to a degree of D major; chromatics snap down. */
const DEGREE_OF_SEMIS = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

/** A degree count from D4 (degree 0 = D4, 7 = D5, −1 = C#4…) to pitch. */
const pelog = (deg: number): number => {
	const oct = Math.floor(deg / 7);
	const d = deg - oct * 7;
	return 62 + oct * 12 + PELOG_CENTS[d] / 100;
};

/** A MIDI pitch to its degree count from D4. */
const degreeOf = (p: number): number => {
	const rel = Math.round(p) - 62;
	const oct = Math.floor(rel / 12);
	return oct * 7 + DEGREE_OF_SEMIS[rel - oct * 12];
};

/** Sangsih sharp of polos, in semitones: the ombak's beat. */
const OMBAK = 0.09;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// The tune: a metallophone, stretched partials, its brightness falling.
	melody: {
		voice: "fm",
		level: 0.39,
		attackS: 0.002,
		decayS: 2.6,
		sustain: 0,
		releaseS: 0.9,
		ratio: 3.93,
		index: 1.4,
		indexDecayS: 0.25,
		feedback: 0,
		reverb: 0.35,
	},
	polos: {
		voice: "fm",
		level: 0.208,
		attackS: 0.002,
		decayS: 0.9,
		sustain: 0,
		releaseS: 0.3,
		ratio: 2.76,
		index: 1.8,
		indexDecayS: 0.12,
		feedback: 0,
		pan: -0.45,
		reverb: 0.3,
	},
	sangsih: {
		voice: "fm",
		level: 0.208,
		attackS: 0.002,
		decayS: 0.9,
		sustain: 0,
		releaseS: 0.3,
		ratio: 2.76,
		index: 1.8,
		indexDecayS: 0.12,
		feedback: 0,
		pan: 0.45,
		reverb: 0.3,
	},
	// The jegogan: low, slow, long.
	jegogan: {
		voice: "fm",
		level: 0.468,
		attackS: 0.003,
		decayS: 3.5,
		sustain: 0,
		releaseS: 1.2,
		ratio: 2.01,
		index: 0.9,
		indexDecayS: 0.5,
		feedback: 0,
		reverb: 0.4,
	},
	// The kempli: a small gong, damped, on every beat.
	kempli: {
		voice: "fm",
		level: 0.117,
		attackS: 0.001,
		decayS: 0.25,
		sustain: 0,
		releaseS: 0.08,
		ratio: 2.32,
		index: 1.2,
		feedback: 0,
		pan: 0.15,
		reverb: 0.15,
	},
	// Gong and kempur: inharmonic, slow to bloom and slower to die.
	gong: {
		voice: "fm",
		level: 0.585,
		attackS: 0.03,
		decayS: 7,
		sustain: 0,
		releaseS: 3,
		ratio: 1.41,
		index: 1.6,
		indexDecayS: 2.5,
		feedback: 0.1,
		reverb: 0.55,
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

/** The gong at the cycle's end, and the kempur halfway (a fourth up). */
const gong = (bar: number, vel: number): NoteEvent =>
	note("gong", bar, 0, 6, pelog(-14), vel);
const kempur = (bar: number, vel: number): NoteEvent =>
	note("gong", bar, 0, 4, pelog(-11), vel * 0.7);

/** The kempli on each beat of `bars` bars, the first beat leaning. */
const kempli = (bar: number, bars: number, vel: number): NoteEvent[] =>
	Array.from({ length: bars * 3 }, (_, i) =>
		note(
			"kempli",
			bar + Math.floor(i / 3),
			i % 3,
			0.25,
			pelog(10),
			vel * (i % 3 === 0 ? 1 : 0.65),
		),
	);

/** One beat of kotekan around degree `d`: four sixteenths split between the
 *  parts, the figure turning up on even beats and down on odd. */
const kotekan = (
	bar: number,
	beat: number,
	d: number,
	vel: number,
): NoteEvent[] => {
	const figure =
		(bar * 3 + beat) % 2 === 0
			? [d, d + 1, d + 2, d + 1]
			: [d, d - 1, d, d + 1];
	return figure.map((deg, i) =>
		note(
			i % 2 === 0 ? "polos" : "sangsih",
			bar,
			beat + i / 4,
			0.2,
			pelog(deg + 7) + (i % 2 === 0 ? 0 : OMBAK),
			vel * (i === 0 ? 0.9 : 0.7),
		),
	);
};

/** The degree the tune is sounding at a waltz position: the latest note
 *  started at or before it. */
const toneAt = (bar: number, beat: number): number => {
	const t = bar * 3 + beat;
	let p = THEME[0][2];
	for (const [b, bt, pitch] of THEME) {
		if (b * 3 + bt > t + 1e-9) break;
		p = pitch;
	}
	return degreeOf(p) - 7;
};

// ── Intro: the call alone, out of time, then the kotekan speeding in ───────

const INTRO: NoteEvent[] = [
	gong(0, 0.8),
	// The horn's call, A–C#–E into a held E; E–G#–B into a held B.
	...(
		[
			[1, 1.5, 69, 0.5],
			[1, 2, 73, 0.5],
			[1, 2.5, 76, 0.5],
			[2, 0, 76, 3],
			[3, 1.5, 76, 0.5],
			[3, 2, 80, 0.5],
			[3, 2.5, 83, 0.5],
			[4, 0, 83, 3],
		] as const
	).map(([bar, beat, p, dur]) =>
		note("melody", bar, beat, dur, pelog(degreeOf(p) - 7), 0.65),
	),
	kempur(4, 0.7),
	note("jegogan", 4, 0, 3, pelog(degreeOf(57) - 7), 0.6),
	note("jegogan", 6, 0, 3, pelog(degreeOf(57) - 7), 0.6),
	...kempli(4, 4, 0.6),
	// The kotekan on the dominant's tone, entering softly and growing.
	...Array.from({ length: 12 }, (_, i) =>
		kotekan(4 + Math.floor(i / 3), i % 3, degreeOf(69) - 7, 0.4 + i * 0.04),
	).flat(),
	// The melody's upbeat lead-in is the waltz's own bar 0.
];

// ── Waltz No. 1: the tune on the metallophone, the kotekan around it ───────

/** Loudness by bar, as the waltz's: p, then f from bar 17, ff at 25. */
const dyn = (bar: number) =>
	bar < 16 ? 0.6 : bar < 17 ? 0.66 : bar < 25 ? 0.76 : bar < 29 ? 0.88 : 0.82;

const WALTZ: NoteEvent[] = [
	...THEME.map(([bar, beat, pitch, dur]) =>
		note("melody", bar, beat, dur, pelog(degreeOf(pitch) - 7), dyn(bar)),
	),
	...Array.from({ length: 32 * 3 }, (_, i) => {
		const bar = Math.floor(i / 3);
		const beat = i % 3;
		return kotekan(bar, beat, toneAt(bar, beat), dyn(bar));
	}).flat(),
	...HARMONY.flatMap((h, bar) =>
		h
			? [note("jegogan", bar, 0, 3, pelog(degreeOf(h[0] + 12) - 7), dyn(bar))]
			: [],
	),
	...kempli(0, 32, 0.7),
	...[0, 8, 16, 24].map((b) => gong(b, 0.75)),
	...[4, 12, 20, 28].map((b) => kempur(b, 0.75)),
];

// ── The cadence: Strauss's last three bars, the angsel, the gong ───────────

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
	).map(([bar, beat, p, dur]) =>
		note("melody", bar, beat, dur, pelog(degreeOf(p) - 7), 0.85),
	),
	...Array.from({ length: 6 }, (_, i) => {
		const bar = Math.floor(i / 3);
		const beat = i % 3;
		const d = degreeOf([78, 78, 76, 83, 83, 81][i]) - 7;
		return kotekan(bar, beat, d, 0.8);
	}).flat(),
	// The angsel: every part stops together on the D, and the gong sounds.
	...[0, 0.5, 0.75].flatMap((t, i) => [
		note("polos", 2, t, 0.2, pelog(7 - i), 0.85),
		note("sangsih", 2, t + 0.25, 0.2, pelog(7 - i) + OMBAK, 0.85),
	]),
	note("polos", 3, 0, 1, pelog(7), 0.9),
	note("sangsih", 3, 0, 1, pelog(7) + OMBAK, 0.9),
	note("jegogan", 0, 0, 3, pelog(degreeOf(43 + 12) - 7), 0.8),
	note("jegogan", 1, 0, 3, pelog(degreeOf(45 + 12) - 7), 0.8),
	note("jegogan", 3, 0, 3, pelog(-7), 0.85),
	...kempli(0, 2, 0.7),
	gong(3, 0.9),
];

/**
 * Score bars: the intro 0–7, the waltz 8–39, the cadence 40–43. The call
 * is slow and the kotekan speeds in over bars 4–7; the waltz holds
 * `GAMELAN_BPM`; the cadence broadens over its last two bars.
 */
export const DANUBE_GAMELAN: Song = {
	name: "An der schönen blauen Donau (gamelan)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 8, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: OPENING_BPM },
		{ bar: 4, bpm: OPENING_BPM },
		{ bar: 7, bpm: GAMELAN_BPM, ramp: true },
		{ bar: 41, bpm: GAMELAN_BPM },
		{ bar: 43, bpm: 84, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 3 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_GAMELAN;
