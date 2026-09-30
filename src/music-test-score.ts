/**
 * The synth's test score (#560): two short pieces written here to exercise
 * every voice and every transport move, for the probe and for the principal's
 * ear in `npm run sounds`.
 *
 * **Not the game's music.** The Blue Danube arrangement is #547's and the
 * ambient material #548's. These are original four-bar sketches — a waltz in
 * D, with a lilt and a ritardando into its coda, and a march in A minor whose
 * lead and arpeggio are stems — so a listen hears each voice on its own and
 * each move once.
 *
 * Imports only the score's types, so it is data and nothing else.
 */
import type { NoteEvent, Song } from "./music-score";

/** Notes on the given beats of one bar, all of one part and length. */
const on = (
	part: string,
	bar: number,
	beats: readonly number[],
	pitches: readonly number[],
	dur: number,
	vel = 0.8,
): NoteEvent[] =>
	beats.flatMap((beat) =>
		pitches.map((pitch) => ({ part, bar, beat, dur, pitch, vel })),
	);

/** A melody: `[bar, beat, pitch, dur]` per note. */
const line = (
	part: string,
	notes: readonly (readonly [number, number, number, number])[],
	vel = 0.8,
): NoteEvent[] =>
	notes.map(([bar, beat, pitch, dur]) => ({
		part,
		bar,
		beat,
		dur,
		pitch,
		vel,
	}));

// Chords, as MIDI note numbers.
const D = [62, 66, 69];
const A7 = [61, 64, 67];
const G = [59, 62, 67];

/**
 * A waltz in D, 3/4. Intro, then four bars of oom-pah-pah that loop until
 * resolved, then a two-bar coda that slows into its last chord. The second
 * beat comes early and the third a little late: the lilt (#543 D5).
 */
export const TEST_WALTZ: Song = {
	name: "test waltz",
	beatsPerBar: 3,
	lilt: [0, -0.07, 0.03],
	parts: {
		bass: { voice: "pluck", level: 0.8, cutoffHz: 1600 },
		pad: { voice: "pad", level: 0.3 },
		bell: {
			voice: "fm",
			level: 0.35,
			ratio: 3.5,
			index: 2.2,
			decayS: 1.8,
			sustain: 0,
			feedback: 0.1,
		},
		kick: { voice: "tone", level: 0.55 },
		hat: { voice: "noise", level: 0.18 },
	},
	sections: [
		{
			name: "intro",
			bars: 2,
			events: [
				...on("pad", 0, [0], D, 3, 0.6),
				...on("pad", 1, [0], A7, 3, 0.6),
				...line("bell", [
					[0, 0, 81, 2],
					[1, 0, 79, 1],
					[1, 1, 76, 2],
				]),
			],
		},
		{
			name: "A",
			bars: 4,
			events: [
				...[D, A7, G, A7].flatMap((chord, bar) => [
					...on("bass", bar, [0], [[38, 33, 31, 33][bar]], 1),
					...on("pad", bar, [1, 2], chord, 0.6, 0.55),
					...on("kick", bar, [0], [38], 0.5),
					...on("hat", bar, [1, 2], [105], 0.25, 0.5),
				]),
				...line("bell", [
					[0, 0, 74, 1],
					[0, 1, 78, 1],
					[0, 2, 81, 1],
					[1, 0, 81, 1],
					[1, 1, 79, 1],
					[1, 2, 76, 1],
					[2, 0, 79, 1],
					[2, 1, 83, 1],
					[2, 2, 86, 1],
					[3, 0, 85, 1.5],
					[3, 2, 76, 1],
				]),
			],
		},
		{
			name: "coda",
			bars: 2,
			events: [
				...on("bass", 0, [0], [38], 2),
				...on("kick", 0, [0], [38], 0.5),
				...on("pad", 0, [0], D, 6, 0.6),
				...line("bell", [
					[0, 0, 86, 2],
					[1, 0, 81, 3],
				]),
				...on("bass", 1, [0], [26], 3),
			],
		},
	],
	// 138 through the waltz; the coda slows to 96 by its end.
	tempo: [
		{ bar: 0, bpm: 138 },
		{ bar: 6, bpm: 138 },
		{ bar: 8, bpm: 96, ramp: true },
	],
	loop: { from: "A", to: "A" },
	resolve: "coda",
};

/**
 * A march in A minor, 4/4, two bars that loop. `lead` and `arp` are the two
 * stems a crossfade between parts moves: the lead is a held FM voice, the
 * arpeggio a pluck, so the handover is heard as a change of colour.
 */
export const TEST_MARCH: Song = {
	name: "test march",
	beatsPerBar: 4,
	parts: {
		lead: {
			voice: "fm",
			level: 0.3,
			ratio: 1,
			index: 1.4,
			feedback: 0.5,
			sustain: 0.6,
			attackS: 0.02,
			releaseS: 0.3,
		},
		arp: { voice: "pluck", level: 0.45, cutoffHz: 5000 },
		kick: { voice: "tone", level: 0.6 },
		hat: { voice: "noise", level: 0.2 },
	},
	sections: [
		{
			name: "A",
			bars: 2,
			events: [
				...line("lead", [
					[0, 0, 69, 1.5],
					[0, 1.5, 72, 0.5],
					[0, 2, 76, 2],
					[1, 0, 74, 1],
					[1, 1, 72, 1],
					[1, 2, 71, 2],
				]),
				...[0, 1].flatMap((bar) =>
					[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((beat, i) => ({
						part: "arp",
						bar,
						beat,
						dur: 0.4,
						pitch: [57, 60, 64, 69, 64, 60, 57, 52][i] + (bar === 1 ? 2 : 0),
						vel: i % 2 === 0 ? 0.85 : 0.6,
					})),
				),
				...[0, 1].flatMap((bar) => [
					...on("kick", bar, [0, 2], [36], 0.5),
					...on("hat", bar, [1, 3], [100], 0.25, 0.6),
				]),
			],
		},
	],
	tempo: [{ bar: 0, bpm: 112 }],
	loop: { from: "A", to: "A" },
};

/** A chord held from a beat: one note per pitch, all one length. */
const chord = (
	part: string,
	bar: number,
	pitches: readonly number[],
	dur: number,
	vel = 0.7,
	beat = 0,
): NoteEvent[] =>
	pitches.map((pitch) => ({ part, bar, beat, dur, pitch, vel }));

// D minor, as MIDI note numbers: four chords, voiced around the middle.
const DM9 = [50, 53, 57, 60, 64];
const BBMAJ7 = [46, 53, 57, 58, 62];
const GM9 = [43, 50, 55, 58, 62];
const ASUS = [45, 52, 55, 57, 62];
const PROGRESSION = [DM9, BBMAJ7, GM9, ASUS];

/**
 * The synth's second voices in a room (#560 D10, after the principal's
 * references on #548), for the ear in `npm run sounds`. **Original sketches**
 * — the references are other people's compositions, and none of their notes
 * is here. Each section brings one voice forward over what came before: the
 * morphing drone with a darkening FM bell; the analog strings; an analog lead
 * with the echo; the resonator keys; the acid over the layered kick.
 */
export const TEST_VOICES: Song = {
	name: "test voices",
	beatsPerBar: 4,
	parts: {
		drone: { voice: "drone", level: 0.45, reverb: 0.5 },
		bell: {
			voice: "fm",
			level: 0.22,
			ratio: 3.5,
			index: 3,
			indexDecayS: 0.8,
			sustain: 0.3,
			decayS: 3,
			releaseS: 1.5,
			reverb: 0.5,
			echo: 0.3,
			pan: 0.3,
		},
		strings: {
			voice: "analog",
			level: 0.32,
			unison: 4,
			detune: 0.15,
			spread: 1,
			attackS: 1.2,
			sustain: 0.9,
			releaseS: 2.5,
			cutoffHz: 1400,
			envAmount: 1,
			envDecayS: 3,
			vibrato: 0.08,
			reverb: 0.55,
		},
		lead: {
			voice: "analog",
			level: 0.3,
			unison: 2,
			detune: 0.06,
			index: 0.3,
			ratio: 1.001,
			attackS: 0.02,
			sustain: 0.8,
			releaseS: 0.4,
			cutoffHz: 1200,
			envAmount: 2,
			envDecayS: 0.6,
			resonance: 0.3,
			vibrato: 0.15,
			reverb: 0.35,
			echo: 0.4,
		},
		keys: { voice: "keys", level: 0.4, reverb: 0.4, echo: 0.3 },
		acid: { voice: "acid", level: 0.35, reverb: 0.1, echo: 0.2 },
		kick: { voice: "kick", level: 0.7, reverb: 0.05 },
		hat: { voice: "noise", level: 0.08, pan: 0.3, reverb: 0.15 },
	},
	sections: [
		{
			name: "drone",
			bars: 4,
			events: [
				...chord("drone", 0, [38, 45, 50], 16, 0.8),
				...line(
					"bell",
					[
						[1, 0, 69, 3],
						[2, 2, 65, 3],
						[3, 1, 72, 4],
					],
					0.7,
				),
			],
		},
		{
			name: "strings",
			bars: 4,
			events: [
				...chord("drone", 0, [38], 16, 0.6),
				...PROGRESSION.flatMap((c, bar) => chord("strings", bar, c, 4, 0.6)),
			],
		},
		{
			name: "lead",
			bars: 4,
			events: [
				...PROGRESSION.flatMap((c, bar) => chord("strings", bar, c, 4, 0.45)),
				...line(
					"lead",
					[
						[0, 0, 69, 1.5],
						[0, 1.5, 67, 0.5],
						[0, 2, 65, 1],
						[0, 3, 64, 1],
						[1, 0, 62, 3],
						[1, 3, 65, 1],
						[2, 0, 67, 1],
						[2, 1, 69, 1],
						[2, 2, 70, 2],
						[3, 0, 69, 4],
					],
					0.75,
				),
			],
		},
		{
			name: "keys",
			bars: 4,
			events: [
				...chord("drone", 0, [38, 45], 16, 0.5),
				...PROGRESSION.flatMap((c, bar) =>
					[0, 1, 2, 3, 4, 3, 2, 1].map((k, i) => ({
						part: "keys",
						bar,
						beat: i / 2,
						dur: 1,
						pitch: c[k] + 12,
						vel: i === 0 ? 0.8 : 0.55,
					})),
				),
			],
		},
		{
			name: "acid",
			bars: 4,
			events: [
				...chord("drone", 0, [38, 45], 16, 0.5),
				...[0, 1, 2, 3].flatMap((bar) => [
					...on("kick", bar, [0, 1, 2, 3], [29], 0.5, 0.9),
					...on("hat", bar, [0.5, 1.5, 2.5, 3.5], [104], 0.1, 0.5),
					// Sixteenths on D; a step that overlaps the next slides to it,
					// and the loud ones are accents.
					...[
						38, 38, 50, 38, 41, 38, 53, 50, 38, 45, 38, 50, 48, 38, 50, 55,
					].map((pitch, i) => ({
						part: "acid",
						bar,
						beat: i / 4,
						dur: [3, 7, 13].includes(i) ? 0.3 : 0.15,
						pitch: pitch + (bar === 2 ? -2 : 0),
						vel: [0, 6, 12].includes(i) ? 0.9 : 0.6,
					})),
				]),
			],
		},
	],
	tempo: [{ bar: 0, bpm: 92 }],
	space: { reverbS: 5, echoBeats: 0.75, echoFeedback: 0.45 },
};

/** Every test song by the id the sound set loads it under. */
export const TEST_SONGS: Readonly<Record<string, Song>> = {
	waltz: TEST_WALTZ,
	march: TEST_MARCH,
	voices: TEST_VOICES,
};
