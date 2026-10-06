/**
 * The Blue Danube on a broken music box: a listening spike beside the
 * docking computer's waltz (`music-danube.ts`).
 *
 * **Strauss's notes on a worn comb.** The theme is the waltz module's own
 * `THEME`, an octave up, every note a bright pluck; the oom-pah-pah is the
 * comb's lower teeth — the bar's bass two octaves up on one, a chord tone on
 * two and on three. Each tooth is out of tune by its own fixed amount, a
 * few go flat as if worn (`tooth`), one in thirteen is missing, and a note
 * now and then drags late. A low hum and a ghost bell an octave under the
 * answers make the room. It is wound up in the intro, and it runs down in
 * the cadence: the tempo slows to a crawl and the pitch sags.
 *
 * The form keeps the waltz's contract: an intro, the waltz looping, and a
 * `resolve` to the cadence on the next bar line.
 */
import { HARMONY, THEME } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";

export const MUSICBOX_BPM = 132;

const PARTS: Readonly<Record<string, PartSpec>> = {
	comb: {
		voice: "pluck",
		level: 0.95,
		decayS: 1.6,
		releaseS: 0.3,
		cutoffHz: 6500,
		reverb: 0.5,
		echo: 0.08,
	},
	teeth: {
		voice: "pluck",
		level: 0.65,
		decayS: 1.2,
		releaseS: 0.25,
		cutoffHz: 4500,
		pan: 0.2,
		reverb: 0.5,
	},
	ghost: {
		voice: "fm",
		level: 0.15,
		attackS: 0.02,
		decayS: 2.5,
		sustain: 0,
		releaseS: 1,
		ratio: 3.5,
		index: 0.6,
		indexDecayS: 0.8,
		feedback: 0,
		pan: -0.4,
		reverb: 0.9,
	},
	hum: {
		voice: "drone",
		level: 0.12,
		attackS: 3,
		releaseS: 3,
		detune: 0.15,
		drift: 3,
		spread: 1,
		reverb: 0.6,
	},
	// The winding key's ratchet.
	click: {
		voice: "noise",
		level: 0.12,
		decayS: 0.02,
		releaseS: 0.02,
		resonance: 0.8,
		reverb: 0.3,
	},
};

/** A tooth's own mistuning, fixed by its position: up to ±0.15 semitones,
 *  and a worn one in seven a quarter-tone flat. */
let teeth = 0;
const tooth = (pitch: number): number => {
	const i = teeth++;
	const off = (((i * 37) % 11) - 5) * 0.03;
	return pitch + off - (i % 7 === 3 ? 0.25 : 0);
};

/** One note, unless its tooth is missing; now and then a little late. */
const note = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent[] => {
	const i = teeth;
	if (i % 13 === 7) {
		teeth++;
		return [];
	}
	const late = i % 9 === 4 ? 0.06 : 0;
	return [
		{
			part,
			bar,
			beat: Math.min(beat + late, 2.95),
			dur,
			pitch: tooth(pitch),
			vel,
		},
	];
};

/** A note that always sounds, in tune: the room, not the comb. */
const plain = (
	part: string,
	bar: number,
	beat: number,
	dur: number,
	pitch: number,
	vel: number,
): NoteEvent => ({ part, bar, beat, dur, pitch, vel });

// ── Intro: the key wound, then the horn's call on the comb ─────────────────

const INTRO: NoteEvent[] = [
	...Array.from({ length: 10 }, (_, i) =>
		plain("click", Math.floor(i / 6), (i % 6) / 2, 0.1, 100 + (i % 2) * 4, 0.7),
	),
	plain("hum", 2, 0, 12, 50, 0.4),
	plain("hum", 2, 0, 12, 57, 0.4),
	...(
		[
			[2, 1.5, 81],
			[2, 2, 85],
			[2, 2.5, 88],
			[3, 0, 88],
			[4, 1.5, 76],
			[4, 2, 80],
			[4, 2.5, 83],
			[5, 0, 83],
		] as const
	).flatMap(([bar, beat, p]) => note("comb", bar, beat, 1, p, 0.6)),
];

// ── Waltz No. 1 on the comb ────────────────────────────────────────────────

const dyn = (bar: number) => (bar < 17 ? 0.6 : bar < 25 ? 0.7 : 0.78);

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		...note("comb", bar, beat, dur, pitch + 12, dyn(bar)),
		...(answer && beat === 2
			? [plain("ghost", bar, beat, 2, pitch, dyn(bar))]
			: []),
	]),
	// The lower teeth: the bass two octaves up on one, the chord's tones on
	// two and three.
	...HARMONY.flatMap((h, bar) => {
		if (!h) return [];
		const [bass, chord] = h;
		return [
			...note("teeth", bar, 0, 1, bass + 24, dyn(bar) * 0.8),
			...note("teeth", bar, 1, 1, chord[1] + 12, dyn(bar) * 0.6),
			...note("teeth", bar, 2, 1, chord[2] + 12, dyn(bar) * 0.6),
		];
	}),
	plain("hum", 0, 0, 48, 50, 0.4),
	plain("hum", 16, 0, 48, 57, 0.4),
];

// ── The cadence: the spring runs down ──────────────────────────────────────

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
	).flatMap(([bar, beat, p, dur]) =>
		// The pitch sags as the spring gives out.
		note("comb", bar, beat, dur, p + 12 - bar * 0.12 - beat * 0.04, 0.7),
	),
	...note("teeth", 0, 0, 1, 67, 0.55),
	...note("teeth", 1, 0, 1, 69, 0.55),
	...note("teeth", 2, 0, 1, 62, 0.55),
	...note("teeth", 3, 0, 3, 61.6, 0.5),
	plain("ghost", 3, 0, 3, 74, 0.6),
	plain("hum", 0, 0, 12, 50, 0.4),
];

/**
 * Score bars: the intro 0–5, the waltz 6–37, the cadence 38–41. A loop is
 * 43.6 s at `MUSICBOX_BPM`; over the cadence the tempo falls to a crawl.
 */
const DANUBE_MUSICBOX: Song = {
	name: "An der schönen blauen Donau (music box)",
	beatsPerBar: 3,
	lilt: [0, -0.03, 0.02],
	parts: PARTS,
	sections: [
		{ name: "intro", bars: 6, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: MUSICBOX_BPM },
		{ bar: 38, bpm: MUSICBOX_BPM },
		{ bar: 41, bpm: 44, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 2.8 },
};

/** The loader's name for this version (`music-danube-variants.ts`). */
export const VARIANT: Song = DANUBE_MUSICBOX;
