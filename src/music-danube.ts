/**
 * The docking computer's waltz (#547): Johann Strauss II, *An der schönen
 * blauen Donau*, op. 314 (1867), hand-encoded as note data — a public-domain
 * composition, synthesised at runtime, nothing downloaded or recorded (#543
 * D2, on the map's Constraints).
 *
 * **Encoded from the Breitkopf und Härtel full score** (Leipzig, c. 1920;
 * IMSLP #17764): the Introduktion on its printed page 2 and Waltz No. 1 on
 * pages 6–8. The arrangement for the synth is this file's own; the notes of
 * the melody, the horn call and the bass line are Strauss's as that score
 * prints them, transposed nowhere.
 *
 * The form is #547's rulings:
 *
 * - **D1** — the intro, then Waltz No. 1 **loops** until the ship crosses the
 *   plane; a `resolve` then goes to the **cadence** on the next bar line, and
 *   the song ends there, during the arrival.
 * - **D2** — a pilot who takes the stick: `stop` now, over
 *   `DANUBE_CANCEL_FADE_S`, two bars of the waltz.
 * - **D3** — the Andantino's opening nine bars (string tremolo, the horn's
 *   A–C#–E call), then Waltz No. 1 from its upbeat bar. The Tempo di Valse
 *   lead-in between them is left out: the Andantino's ninth bar is already
 *   the waltz's dominant, and the run is a minute long.
 * - **D4, re-voiced by D7/D8** — the first voicing, on keys, plucks and a
 *   bell, was heard as *too plinky*; the notes stood and the instruments
 *   changed. Everything is bowed now (`strings`): the Andantino's held chord
 *   with a tremolo of short strokes over it and the horns' call on a desk of
 *   its own (D14: it was `brass` until the principal heard it as *bad*); the
 *   theme legato on the first violins, the woodwinds' answers on a
 *   second desk; and the oom-pah-pah as a low stroke on the first beat and
 *   short detached chords on the second and third, over a soft held body. A
 *   kick at a tenth of the bed's level stands in for the timpani's weight.
 * - **D9–D12** — the orchestra was heard as *better, but still super cheesy*.
 *   It stays, and two voicings sit beside it to compare (`DANUBE_VOICINGS`):
 *   `oxygene`, on the string machine and drone of the principal's own
 *   references, and `hybrid`, that with its accompaniment bowed again.
 *
 * **The Andantino is 6/8 and the song is 3/4.** A song has one
 * `beatsPerBar`, so a 6/8 bar is written as a 3/4 bar whose eighth is half a
 * beat: its six eighths fill the bar's three beats, and the intro's tempo map
 * is set so a dotted quarter lasts what the Andantino's does. The lilt then
 * reaches the intro too, pulling its third eighth early and its fifth late by
 * a few hundredths of a beat; that is heard, if at all, as rubato.
 *
 * Imports only the score's types, so it is data and nothing else.
 */
import type { NoteEvent, PartSpec, Song } from "./music-score";

/** The waltz's tempo, quarter notes a minute: a beat is 0.375 s and a
 *  bar 1.125 s. */
export const WALTZ_BPM = 160;

/** The Andantino's, in the quarter-note beats its 6/8 is written in: a
 *  dotted quarter is 1.5 of them, so this is a dotted quarter at ~59. */
const INTRO_BPM = 88;

/** The cancel fade (D2): two bars of the waltz. */
export const DANUBE_CANCEL_FADE_S = (2 * 3 * 60) / WALTZ_BPM;

/** A melody: `[bar, beat, pitch, dur]` per note. */
const line = (
	part: string,
	notes: readonly (readonly [number, number, number, number])[],
	vel: number | ((bar: number) => number),
): NoteEvent[] =>
	notes.map(([bar, beat, pitch, dur]) => ({
		part,
		bar,
		beat,
		dur,
		pitch,
		vel: typeof vel === "number" ? vel : vel(bar),
	}));

/** A chord: every pitch at one time. */
const chord = (
	part: string,
	bar: number,
	beat: number,
	pitches: readonly number[],
	dur: number,
	vel: number,
): NoteEvent[] =>
	pitches.map((pitch) => ({ part, bar, beat, dur, pitch, vel }));

/** The parts every voicing names: the score writes to these and nothing
 *  else, so a voicing changes what they sound like and never which notes. */
export type DanubePart =
	| "violins"
	| "shimmer"
	| "horn"
	| "melody"
	| "answer"
	| "strings"
	| "bass"
	| "chords"
	| "kick";
type Voicing = Readonly<Record<DanubePart, PartSpec>>;

/** D8: the orchestra, bowed; D14 moved the horn call onto the strings too. */
const ORCHESTRA: Voicing = {
	// The Andantino's violins: a held chord, bowed slowly in and out.
	violins: {
		voice: "strings",
		level: 0.3,
		attackS: 0.6,
		releaseS: 1.5,
		cutoffHz: 1100,
		envAmount: 1.4,
		vibrato: 0.1,
		reverb: 0.6,
	},
	// The tremolo over it: the chord's top two notes in sixteenths, each a
	// short stroke of the bow, quietly.
	shimmer: {
		voice: "strings",
		level: 0.1,
		attackS: 0.03,
		releaseS: 0.08,
		unison: 2,
		index: 0.15,
		vibrato: 0,
		cutoffHz: 1600,
		pan: 0.2,
		reverb: 0.6,
	},
	// The horns' call (D14), a desk of its own so it stands out of the chord
	// it rises from: legato through its eighths into the held note, more bow
	// on each attack, a little brighter, to the left of the violins, and just
	// above them in level.
	//
	// And gritty (D16 — "the low strings" were this call, A3 to E4): the
	// saturation, the lowpass opened below A4, and the rosin under it. These
	// are the principal's own values from the strings lab (D17), which found
	// the legato glide the main fault: 0.03 s smeared the call's eighths, and
	// 0.005 s keeps them as bowed steps while the notes still join.
	horn: {
		voice: "strings",
		level: 0.26,
		unison: 6,
		detune: 0.1,
		attackS: 0.07,
		sustain: 0.9,
		releaseS: 0.6,
		glideS: 0.005,
		index: 0.47,
		vibrato: 0.09,
		vibratoHz: 2.9,
		cutoffHz: 1780,
		envAmount: 1.8,
		resonance: 0.24,
		keyTrack: 0.44,
		drive: 0.44,
		rosin: 0.43,
		rosinLow: 0.7,
		pan: -0.35,
		reverb: 0.5,
	},
	// The first violins: the theme, legato, the grace notes sliding in.
	melody: {
		voice: "strings",
		level: 0.34,
		glideS: 0.03,
		attackS: 0.08,
		releaseS: 0.4,
		cutoffHz: 1400,
		envAmount: 1.8,
		vibrato: 0.12,
		pan: -0.15,
		reverb: 0.4,
	},
	// The flutes' and oboes' answers, on the same pitches: a second desk,
	// brighter and to the other side.
	answer: {
		voice: "strings",
		level: 0.14,
		attackS: 0.06,
		releaseS: 0.35,
		unison: 3,
		cutoffHz: 2200,
		vibrato: 0.1,
		pan: 0.3,
		reverb: 0.45,
	},
	// The body under the bar: the inner strings' harmony, held softly.
	strings: {
		voice: "strings",
		level: 0.1,
		attackS: 0.3,
		releaseS: 0.6,
		unison: 3,
		cutoffHz: 900,
		envAmount: 1,
		vibrato: 0.08,
		reverb: 0.55,
	},
	// Cellos and basses on the first beat: a short stroke, low.
	bass: {
		voice: "strings",
		level: 0.42,
		attackS: 0.04,
		releaseS: 0.25,
		cutoffHz: 650,
		envAmount: 1.2,
		index: 0.25,
		vibrato: 0,
		reverb: 0.2,
	},
	// The oom-pah-pah's "pah": short detached chords, the bow off the string.
	chords: {
		voice: "strings",
		level: 0.2,
		attackS: 0.03,
		releaseS: 0.12,
		unison: 3,
		cutoffHz: 1500,
		index: 0.2,
		vibrato: 0,
		pan: 0.15,
		reverb: 0.3,
	},
	// A timpani's weight under the first beat, and no more.
	kick: { voice: "kick", level: 0.1, reverb: 0.1 },
};

/**
 * D12's first alternative, after the principal's references (#548 D11): the
 * waltz on a string machine. The `analog` voice is that machine — unison
 * saws that drift apart and back, which is the chorus movement; the synth has
 * no phaser — over a `drone` bed for the harmony, with the woodwinds'
 * answers on `flute`. No `pluck`, no `keys`, no `fm`.
 *
 * **The horn call is on the orchestra's bowed desk, not `analog`** (D14). The
 * call rises out of the chord the intro's machine is holding; on the same
 * voice it is one more line of the same colour and blurs into it. It was on
 * `brass` for that reason, and the principal heard the brass as *bad*; the
 * bowed desk keeps the contrast — a bow's attack against the machine's slow
 * swell — without it. No voicing plays `brass` now; the synth keeps it.
 */
const OXYGENE: Voicing = {
	// The intro's held chord: a slow machine, wide, drifting.
	violins: {
		voice: "analog",
		level: 0.24,
		unison: 4,
		detune: 0.15,
		drift: 6,
		spread: 1,
		attackS: 0.9,
		decayS: 3,
		sustain: 0.9,
		releaseS: 2,
		cutoffHz: 1300,
		envAmount: 0.6,
		envDecayS: 3,
		vibrato: 0.04,
		reverb: 0.65,
		echo: 0.15,
	},
	// The tremolo: short strokes of the machine, its filter snapping shut.
	shimmer: {
		voice: "analog",
		level: 0.08,
		unison: 2,
		detune: 0.08,
		spread: 0.6,
		attackS: 0.02,
		decayS: 0.15,
		sustain: 0.5,
		releaseS: 0.1,
		cutoffHz: 1800,
		envAmount: 1,
		envDecayS: 0.2,
		pan: 0.2,
		reverb: 0.6,
	},
	horn: ORCHESTRA.horn,
	// The theme: the machine's lead, a slower attack, the drift its chorus.
	melody: {
		voice: "analog",
		level: 0.3,
		unison: 4,
		detune: 0.14,
		drift: 6,
		spread: 0.9,
		attackS: 0.12,
		decayS: 1.5,
		sustain: 0.85,
		releaseS: 0.8,
		cutoffHz: 1600,
		envAmount: 0.8,
		envDecayS: 1.5,
		vibrato: 0.06,
		pan: -0.1,
		reverb: 0.5,
		echo: 0.2,
	},
	answer: {
		voice: "flute",
		level: 0.22,
		glideS: 0.03,
		pan: 0.3,
		reverb: 0.5,
		echo: 0.25,
	},
	// The harmony under the bar: the drone's morphing tables, held softly,
	// quick enough in to speak inside a bar.
	strings: {
		voice: "drone",
		level: 0.12,
		attackS: 0.4,
		releaseS: 0.8,
		detune: 0.08,
		drift: 8,
		spread: 1,
		reverb: 0.6,
	},
	// The first beat: a soft low machine note, dark, closing.
	bass: {
		voice: "analog",
		level: 0.35,
		unison: 2,
		detune: 0.04,
		spread: 0.3,
		attackS: 0.02,
		decayS: 0.5,
		sustain: 0.4,
		releaseS: 0.2,
		cutoffHz: 300,
		envAmount: 1.2,
		envDecayS: 0.25,
		reverb: 0.15,
	},
	// The second and third beats: soft short machine chords.
	chords: {
		voice: "analog",
		level: 0.14,
		unison: 2,
		detune: 0.06,
		spread: 0.5,
		attackS: 0.015,
		decayS: 0.25,
		sustain: 0.3,
		releaseS: 0.12,
		cutoffHz: 1200,
		envAmount: 1,
		envDecayS: 0.15,
		pan: 0.15,
		reverb: 0.35,
	},
	kick: ORCHESTRA.kick,
};

/** D12's second: the string machine, with the body and the bowed
 *  accompaniment — the held harmony, the first beat and the "pah" chords —
 *  back on `strings`. */
const HYBRID: Voicing = {
	...OXYGENE,
	strings: ORCHESTRA.strings,
	bass: ORCHESTRA.bass,
	chords: ORCHESTRA.chords,
};

/** Every voicing, by name: `orchestra` is D8's and what `BLUE_DANUBE` is.
 *  The docking computer plays `hybrid`, by the principal's ruling on #603
 *  (`DEFAULT_MUSIC_ARMS` in `music-director.ts`); `?music=` picks another. */
export const DANUBE_VOICINGS = {
	orchestra: ORCHESTRA,
	oxygene: OXYGENE,
	hybrid: HYBRID,
} as const satisfies Readonly<Record<string, Voicing>>;
export type DanubeVoicing = keyof typeof DANUBE_VOICINGS;

/** The kick's pitch, as the second bed's kit has it. */
const KICK_PITCH = 29;

// ── The Introduktion: Andantino, 6/8, A major (printed page 2) ─────────────
//
// In beats of the 3/4 it is written in: eighth n of a bar is at (n − 1) / 2.

const INTRO: NoteEvent[] = [
	// Violins I and II, tremolo pp: A major for four bars, E7 over the
	// cellos' D for two, then the chord the horns land on over E, then A7
	// with its thirteenth over the cellos' G.
	...chord("violins", 0, 0, [69, 73, 76], 12, 0.45),
	...chord("violins", 4, 0, [68, 71, 76], 6, 0.45),
	...chord("violins", 6, 0, [71, 74, 78], 6, 0.45),
	...chord("violins", 8, 0, [69, 73, 76, 78], 3, 0.45),
	// The tremolo: the violins' top two notes in sixteenths.
	...(
		[
			[0, 4, [73, 76]],
			[4, 2, [71, 76]],
			[6, 2, [74, 78]],
			[8, 1, [76, 78]],
		] as const
	).flatMap(([from, bars, top]) =>
		Array.from({ length: bars * 12 }, (_, i) =>
			chord(
				"shimmer",
				from + Math.floor(i / 12),
				(i % 12) / 4,
				top,
				0.25,
				0.35,
			),
		).flat(),
	),
	// Cellos: the rising C#–E–A into the D they hold under the E7, the E
	// under the horns' chord, and the G under the last bar.
	...line(
		"violins",
		[
			[3, 1.5, 49, 0.5],
			[3, 2, 52, 0.5],
			[3, 2.5, 57, 0.5],
			[4, 0, 50, 4],
			[6, 0, 52, 4],
			[8, 0, 55, 3],
		],
		0.5,
	),
	// The basses' pizzicato E.
	...line("bass", [[6, 0, 40, 1]], 0.45),
	// Horns in F, sounding a fifth below the page: Horn I's call A–C#–E and
	// its held E, Horn II's answer E–G#–B into E and B, then both rising to
	// D and F# twice, and C# and F# over the A7.
	...line(
		"horn",
		[
			[1, 1.5, 57, 0.5],
			[1, 2, 61, 0.5],
			[1, 2.5, 64, 0.5],
			[2, 0, 64, 4.5],
			[3, 1.5, 52, 0.5],
			[3, 2, 56, 0.5],
			[3, 2.5, 59, 0.5],
		],
		0.55,
	),
	...chord("horn", 4, 0, [52, 59], 4, 0.5),
	...[5, 7].flatMap((bar) => [
		...chord("horn", bar, 1.5, [56, 59], 0.5, 0.5),
		...chord("horn", bar, 2, [59, 62], 0.5, 0.55),
		...chord("horn", bar, 2.5, [62, 66], 0.5, 0.6),
	]),
	...chord("horn", 6, 0, [62, 66], 4, 0.6),
	...chord("horn", 8, 0, [61, 66], 3, 0.45),
];

// ── Waltz No. 1, D major (printed pages 6–8) ───────────────────────────────
//
// Violins I, as printed, from the upbeat bar (bar 0 here) to the bar before
// the repeat into No. 1b (bar 31). `answer` marks the notes the flutes and
// oboes double: the high answer on each phrase's third beat and the next
// downbeat. A grace note, a semitone below, leans on each answer.

/** `[bar, beat, pitch, dur, answer]`. */
export const THEME: readonly (readonly [
	number,
	number,
	number,
	number,
	boolean?,
])[] = [
	[0, 0, 62, 1],
	[0, 1, 66, 1],
	[0, 2, 69, 1],
	[1, 0, 69, 1],
	[1, 2, 81, 1, true],
	[2, 0, 81, 1, true],
	[2, 2, 78, 1, true],
	[3, 0, 78, 1, true],
	[3, 2, 62, 1],
	[4, 0, 62, 1],
	[4, 1, 66, 1],
	[4, 2, 69, 1],
	[5, 0, 69, 1],
	[5, 2, 81, 1, true],
	[6, 0, 81, 1, true],
	[6, 2, 79, 1, true],
	[7, 0, 79, 1, true],
	[7, 2, 61, 1],
	[8, 0, 61, 1],
	[8, 1, 64, 1],
	[8, 2, 71, 1],
	[9, 0, 71, 1],
	[9, 2, 83, 1, true],
	[10, 0, 83, 1, true],
	[10, 2, 79, 1, true],
	[11, 0, 79, 1, true],
	[11, 2, 61, 1],
	[12, 0, 61, 1],
	[12, 1, 64, 1],
	[12, 2, 71, 1],
	[13, 0, 71, 1],
	[13, 2, 83, 1, true],
	[14, 0, 83, 1, true],
	[14, 2, 78, 1, true],
	[15, 0, 78, 1, true],
	[15, 2, 62, 1],
	[16, 0, 62, 1],
	[16, 1, 66, 1],
	[16, 2, 69, 1],
	[17, 0, 74, 1],
	[17, 2, 86, 1, true],
	[18, 0, 86, 1, true],
	[18, 2, 81, 1, true],
	[19, 0, 81, 1, true],
	[19, 2, 62, 1],
	[20, 0, 62, 1],
	[20, 1, 66, 1],
	[20, 2, 69, 1],
	[21, 0, 74, 1],
	[21, 2, 86, 1, true],
	[22, 0, 86, 1, true],
	[22, 2, 83, 1, true],
	[23, 0, 83, 1, true],
	[23, 2, 76, 1],
	[24, 0, 76, 1],
	[24, 1, 79, 1],
	[24, 2, 83, 0.5],
	// ff: the held B and its turn, the held F# and its fall.
	[25, 0, 83, 4],
	[26, 1, 80, 0.5],
	[26, 2, 81, 0.5],
	[27, 0, 90, 4],
	[28, 1, 86, 0.5],
	[28, 2, 78, 0.5],
	[29, 0, 78, 2],
	[29, 2, 76, 1],
	[30, 0, 83, 2],
	[30, 2, 81, 1],
	[31, 0, 74, 1],
	[31, 1.5, 74, 0.5],
	[31, 2, 74, 1],
];

/** Strauss's last three bars of Waltz No. 1 — `THEME`'s bars 29–31 — counted
 *  from bar 0, as `[bar, beat, pitch, dur]`: the tune every version's cadence
 *  plays (`music-danube-variants/`). Derived, so it cannot drift from the
 *  theme; `tests/music-danube-cadence.test.ts` holds it to the page. */
export const CADENCE_THEME: readonly (readonly [
	number,
	number,
	number,
	number,
])[] = THEME.filter(([bar]) => bar >= 29).map(
	([bar, beat, pitch, dur]) => [bar - 29, beat, pitch, dur] as const,
);

/** Loudness by bar: p to the crescendo, f from bar 17, ff at 25. */
const dyn = (bar: number) =>
	bar < 16 ? 0.55 : bar < 17 ? 0.62 : bar < 25 ? 0.75 : bar < 29 ? 0.9 : 0.85;

/** The harmony under each bar, read off the basses and the inner strings:
 *  `[bass, plucked chord, pad, how]`. `oom` is bass on one and the chord on
 *  two and three; `pah` the chord alone; `held` all three held for the bar. */
export type How = "oom" | "pah" | "held" | "end";
const D = [54, 57, 62];
const A7 = [55, 57, 61];
const D6 = [57, 62, 66];
const G6 = [55, 59, 64];
const PAD_D = [57, 62, 66];
const PAD_A7 = [55, 61, 64];
const PAD_G = [55, 59, 64];
/** One bar of `HARMONY`. */
export type Bar = readonly [number, readonly number[], readonly number[], How];
/** `n` bars of one harmony. */
const bars = (n: number, h: Bar): Bar[] => Array<Bar>(n).fill(h);
export const HARMONY: readonly (Bar | null)[] = [
	null, // the upbeat
	...bars(4, [38, D, PAD_D, "oom"]),
	...bars(4, [40, A7, PAD_A7, "oom"]),
	...bars(4, [33, A7, PAD_A7, "oom"]),
	...bars(4, [38, D, PAD_D, "oom"]),
	...bars(4, [42, D6, PAD_D, "oom"]),
	...bars(3, [43, G6, PAD_G, "oom"]),
	[43, G6, PAD_G, "pah"],
	[40, [57, 64, 67], [57, 64, 67], "oom"],
	[33, [57, 61, 67], PAD_A7, "oom"],
	[38, D6, PAD_D, "oom"],
	[42, D6, PAD_D, "oom"],
	[43, [59, 62, 67], [55, 59, 62], "held"],
	[45, [55, 61, 64], PAD_A7, "held"],
	[38, D6, PAD_D, "end"],
];

/** The accompaniment for one bar of `HARMONY`, at `vel`. */
function accompany(bar: number, h: Bar, vel: number): NoteEvent[] {
	const [bass, pluck, pad, how] = h;
	const out: NoteEvent[] = [...chord("strings", bar, 0, pad, 3, vel * 0.8)];
	if (how === "held")
		return [
			...out,
			...line("bass", [[bar, 0, bass, 3]], vel),
			...chord("chords", bar, 0, pluck, 3, vel * 0.8),
			...line("kick", [[bar, 0, KICK_PITCH, 0.5]], vel * 0.8),
		];
	// The last bar's rhythm is the melody's: one, the "and" of two, three.
	const beats = how === "end" ? [0, 1.5, 2] : [1, 2];
	if (how === "oom" || how === "end")
		out.push(
			...line("bass", [[bar, 0, bass, 1]], vel),
			...line("kick", [[bar, 0, KICK_PITCH, 0.5]], vel * 0.8),
		);
	for (const beat of beats)
		out.push(...chord("chords", bar, beat, pluck, 0.5, vel * 0.7));
	if (how === "end") out.push(...line("bass", [[bar, 2, bass, 1]], vel));
	return out;
}

const WALTZ: NoteEvent[] = [
	...THEME.flatMap(([bar, beat, pitch, dur, answer]) => [
		...line("melody", [[bar, beat, pitch, dur]], dyn),
		...(answer
			? [
					...line("answer", [[bar, beat, pitch, dur]], dyn),
					// The grace before each answer on a third beat.
					...(beat === 2
						? line("melody", [[bar, 1.9, pitch - 1, 0.1]], (b) => dyn(b) * 0.6)
						: []),
				]
			: []),
	]),
	...HARMONY.flatMap((h, bar) => (h ? accompany(bar, h, dyn(bar)) : [])),
];

// ── The cadence (D1): Strauss's own last three bars, then the tonic held ───

const CADENCE: NoteEvent[] = [
	...line(
		"melody",
		[
			[0, 0, 78, 2],
			[0, 2, 76, 1],
			[1, 0, 83, 2],
			[1, 2, 81, 1],
			[2, 0, 74, 1],
			[2, 1.5, 74, 0.5],
			[2, 2, 74, 1],
			[3, 0, 74, 3],
			[3, 0, 86, 3],
		],
		0.85,
	),
	...line("answer", [[3, 0, 86, 3]], 0.85),
	...accompany(0, [43, [59, 62, 67], [55, 59, 62], "held"], 0.85),
	...accompany(1, [45, [55, 61, 64], PAD_A7, "held"], 0.85),
	...accompany(2, [38, D6, PAD_D, "end"], 0.85),
	...chord("strings", 3, 0, [50, 57, 62, 66], 3, 0.7),
	...line("bass", [[3, 0, 38, 3]], 0.9),
	...chord("chords", 3, 0, D6, 3, 0.7),
	...line("kick", [[3, 0, KICK_PITCH, 0.5]], 0.8),
];

const voiced = new Map<DanubeVoicing, Song>();

/** The waltz in one voicing: the same score, other instruments. Built once
 *  per voicing, so the director's cadence and its load share one song. */
export const danubeSong = (voicing: DanubeVoicing): Song => {
	const known = voiced.get(voicing);
	if (known) return known;
	const parts: Voicing | undefined = DANUBE_VOICINGS[voicing];
	if (!parts) throw new Error(`no Danube voicing "${voicing}"`);
	const song = { ...SCORE, name: `${SCORE.name} (${voicing})`, parts };
	voiced.set(voicing, song);
	return song;
};

/**
 * The song. Score bars: the intro 0–8, the waltz 9–40, the cadence 41–44.
 * The intro holds its tempo for six bars and slows over two into its last;
 * the waltz is at `WALTZ_BPM` throughout, so every loop is the same length;
 * the cadence broadens from its second bar to its last.
 */
const SCORE: Song = {
	name: "An der schönen blauen Donau",
	beatsPerBar: 3,
	lilt: [0, -0.06, 0.03],
	parts: ORCHESTRA,
	sections: [
		{ name: "intro", bars: 9, events: INTRO },
		{ name: "waltz", bars: 32, events: WALTZ },
		{ name: "cadence", bars: 4, events: CADENCE },
	],
	tempo: [
		{ bar: 0, bpm: INTRO_BPM },
		{ bar: 6, bpm: INTRO_BPM },
		{ bar: 8, bpm: 74, ramp: true },
		{ bar: 9, bpm: WALTZ_BPM },
		{ bar: 42, bpm: WALTZ_BPM },
		{ bar: 44, bpm: 120, ramp: true },
	],
	loop: { from: "waltz", to: "waltz" },
	resolve: "cadence",
	space: { reverbS: 3.5 },
};

/** The waltz in D8's orchestra: the offline renders' `danube`. It is not
 *  what the docking computer plays, which is `hybrid` (#603). */
export const BLUE_DANUBE: Song = SCORE;

/** Every render of the waltz by the id the sound set loads it under: the
 *  game's, and each voicing as `danube-<voicing>`. One map, so a voicing
 *  added here reaches `renderInPage` and the sound-set test together. */
export const danubeSongs = (): Readonly<Record<string, Song>> => ({
	danube: BLUE_DANUBE,
	...Object.fromEntries(
		(Object.keys(DANUBE_VOICINGS) as DanubeVoicing[])
			.filter((v) => v !== "orchestra")
			.map((v) => [`danube-${v}`, danubeSong(v)]),
	),
});
