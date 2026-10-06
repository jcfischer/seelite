/**
 * The Blue Danube as Berlin school: the waltz over a sequencer, in the
 * language of the game's own flight beds (`music-generate-berlin.ts`) — so
 * the docking music and the music of flight are one family.
 *
 * **Strauss's harmony becomes the sequence.** Each bar of `HARMONY` is a
 * twelve-step sixteenth ostinato on its root, octave and chord tones,
 * through a resonant filter that a slow sweep opens and closes across the
 * loop; a pulsing eighth-note bass sits under it and a slow string machine
 * holds each harmony as long as it lasts. The theme (`THEME`, printed
 * octave) is on the bed's own lead, into a dotted-eighth echo, the
 * woodwinds' answers a glassy keys line in the echo. The meter stays 3/4: a
 * sequence of twelve sixteenths turns over once a bar, so it rolls rather
 * than marches. No drums.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const BERLIN_BPM = 120;

/** A bar of 3/4 at `BERLIN_BPM`, s. */
const BAR_S = (3 * 60) / BERLIN_BPM;

const PARTS: Readonly<Record<string, PartSpec>> = {
	seq: {
		voice: "analog",
		level: 0.36,
		unison: 2,
		detune: 0.06,
		spread: 0.5,
		attackS: 0.003,
		decayS: 0.22,
		sustain: 0,
		releaseS: 0.08,
		cutoffHz: 260,
		envAmount: 2.2,
		envDecayS: 0.12,
		resonance: 0.55,
		sweepS: 16 * BAR_S,
		sweepOct: 2.6,
		pan: -0.1,
		reverb: 0.25,
		echo: 0.35,
	},
	pulse: {
		voice: "analog",
		level: 0.336,
		unison: 2,
		detune: 0.04,
		spread: 0.2,
		attackS: 0.004,
		decayS: 0.18,
		sustain: 0.3,
		releaseS: 0.06,
		cutoffHz: 180,
		envAmount: 2.5,
		envDecayS: 0.09,
		resonance: 0.35,
		sweepS: 24 * BAR_S,
		sweepOct: 1.2,
		reverb: 0.08,
	},
	choir: {
		voice: "analog",
		level: 0.192,
		unison: 4,
		detune: 0.15,
		spread: 1,
		attackS: 1.5,
		sustain: 0.9,
		releaseS: 1,
		cutoffHz: 1100,
		envAmount: 0.6,
		envDecayS: 4,
		vibrato: 0.05,
		reverb: 0.65,
	},
	lead: {
		voice: "analog",
		level: 0.24,
		unison: 2,
		detune: 0.07,
		attackS: 0.03,
		decayS: 0.8,
		sustain: 0.7,
		releaseS: 0.5,
		cutoffHz: 900,
		envAmount: 1.8,
		envDecayS: 0.5,
		resonance: 0.3,
		vibrato: 0.15,
		reverb: 0.45,
		echo: 0.4,
	},
	sparkle: {
		voice: "keys",
		level: 0.168,
		decayS: 0.6,
		releaseS: 0.15,
		pan: 0.35,
		reverb: 0.4,
		echo: 0.5,
	},
};

const n = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

/** `p` moved by octaves into the octave above `floor`. */
const above = (p: number, floor: number): number =>
	floor + 1 + ((((p - floor - 1) % 12) + 12) % 12);

/**
 * One bar of the sequencer on `root` and `chord`: root, octave and the
 * chord's tones folded into the octave above the root, twelve sixteenths,
 * accented on the first and the seventh.
 */
function sequence(
	bar: number,
	root: number,
	chord: readonly number[],
	vel: number,
): NoteEvent[] {
	const r = root < 45 ? root + 12 : root;
	const [t0, t1, t2] = [...new Set(chord.map((p) => above(p, r)))].sort(
		(a, b) => a - b,
	);
	const tones = [t0, t1 ?? t0, t2 ?? t1 ?? t0];
	const steps = [
		r,
		r + 12,
		tones[0],
		tones[1],
		r,
		r + 12,
		tones[2],
		tones[1],
		r,
		r + 12,
		tones[0],
		tones[2],
	];
	return steps.map((p, i) =>
		n("seq", bar, i / 4, 0.2, p, vel * (i % 6 === 0 ? 1 : 0.72)),
	);
}

/** The pulse: the root in eighths, low. */
const pulse = (bar: number, root: number, vel: number): NoteEvent[] => {
	const r = root < 33 ? root + 12 : root > 45 ? root - 12 : root;
	return Array.from({ length: 6 }, (_, i) =>
		n("pulse", bar, i / 2, 0.4, r, vel * (i === 0 ? 1 : 0.75)),
	);
};

// ── Intro: the Andantino's harmony as a sequence fading up ──────────────────

/** `[root, chord, choir]` a bar of the Andantino, from the score's own
 *  violins and cellos. */
const ANDANTINO: readonly (readonly [
	number,
	readonly number[],
	readonly number[],
])[] = [
	...Array(4).fill([45, [61, 64, 69], [57, 61, 64, 69]]),
	...Array(2).fill([50, [64, 68, 71], [56, 62, 64, 71]]),
	...Array(2).fill([52, [62, 66, 71], [59, 62, 66, 71]]),
	[55, [61, 64, 66], [57, 61, 64, 67]],
];

const INTRO: NoteEvent[] = [
	...ANDANTINO.flatMap(([root, chord], bar) => [
		...sequence(bar, root, chord, 0.35 + bar * 0.05),
		...(bar >= 4 ? pulse(bar, root, 0.4 + (bar - 4) * 0.06) : []),
	]),
	...[57, 61, 64, 69].map((p) => n("choir", 0, 0, 12, p, 0.5)),
	...[56, 62, 64, 71].map((p) => n("choir", 4, 0, 6, p, 0.5)),
	...[59, 62, 66, 71].map((p) => n("choir", 6, 0, 6, p, 0.5)),
	...[57, 61, 64, 67].map((p) => n("choir", 8, 0, 3, p, 0.5)),
	// The horns' call on the lead, at their sounding pitch.
	...(
		[
			[1, 1.5, 57, 0.5],
			[1, 2, 61, 0.5],
			[1, 2.5, 64, 0.5],
			[2, 0, 64, 4.5],
			[3, 1.5, 52, 0.5],
			[3, 2, 56, 0.5],
			[3, 2.5, 59, 0.5],
			[4, 0, 59, 4],
			[5, 1.5, 59, 0.5],
			[5, 2, 62, 0.5],
			[5, 2.5, 66, 0.5],
			[6, 0, 66, 4],
			[7, 1.5, 59, 0.5],
			[7, 2, 62, 0.5],
			[7, 2.5, 66, 0.5],
			[8, 0, 66, 3],
		] as const
	).map(([bar, beat, p, dur]) => n("lead", bar, beat, dur, p, 0.6)),
];

// ── Waltz No. 1 ─────────────────────────────────────────────────────────────

const dyn = (bar: number) =>
	bar < 16 ? 0.6 : bar < 17 ? 0.66 : bar < 25 ? 0.78 : bar < 29 ? 0.9 : 0.85;

/** The choir holds each harmony for as many bars as it lasts. */
function choir(): NoteEvent[] {
	const out: NoteEvent[] = [];
	let from = 1;
	for (let bar = 2; bar <= HARMONY.length; bar++) {
		const a = HARMONY[from];
		const b = HARMONY[bar];
		if (b && a && b[2].join() === a[2].join()) continue;
		if (a)
			for (const p of a[2])
				out.push(n("choir", from, 0, (bar - from) * 3, p, dyn(from) * 0.7));
		from = bar;
	}
	return out;
}

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		n("lead", bar, beat, dur, pitch, dyn(bar)),
		...(answer
			? [n("sparkle", bar, beat, Math.min(dur, 0.5), pitch + 12, dyn(bar))]
			: []),
		...(answer && beat === 2
			? [n("lead", bar, 1.9, 0.1, pitch - 1, dyn(bar) * 0.6)]
			: []),
	]),
	...HARMONY.flatMap((h, bar) =>
		h
			? [...sequence(bar, h[0], h[1], dyn(bar)), ...pulse(bar, h[0], dyn(bar))]
			: sequence(bar, 45, [61, 64, 67], dyn(bar) * 0.8),
	),
	...choir(),
];

// ── The cadence: Strauss's last three bars, then the tonic held ────────────

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
	).map(([bar, beat, p, dur]) => n("lead", bar, beat, dur, p, 0.85)),
	n("sparkle", 3, 0, 0.5, 86, 0.8),
	...sequence(0, 43, [59, 62, 67], 0.85),
	...sequence(1, 45, [55, 61, 64], 0.85),
	...sequence(2, 38, [57, 62, 66], 0.85),
	...pulse(0, 43, 0.85),
	...pulse(1, 45, 0.85),
	...pulse(2, 38, 0.85),
	n("pulse", 3, 0, 3, 38, 0.85),
	...[55, 59, 62, 67].map((p) => n("choir", 0, 0, 3, p, 0.6)),
	...[55, 61, 64, 69].map((p) => n("choir", 1, 0, 3, p, 0.6)),
	...[50, 57, 62, 66].map((p) => n("choir", 2, 0, 6, p, 0.6)),
];

/**
 * Score bars: the intro 0–8, the waltz 9–40 (48 s a loop at `BERLIN_BPM`),
 * the cadence 41–44, broadening over its last two.
 */
export const DANUBE_BERLIN: Song = {
	name: "An der schönen blauen Donau (Berlin school)",
	beatsPerBar: 3,
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 9, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: BERLIN_BPM },
		{ bar: 42, bpm: BERLIN_BPM },
		{ bar: 44, bpm: 96, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 5, echoBeats: 0.75, echoFeedback: 0.45 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_BERLIN;
