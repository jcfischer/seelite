/**
 * Gustav Holst, *The Planets*, op. 32 (1914–16), I. *Mars, the Bringer of
 * War*: the opening, hand-encoded as note data — a public-domain
 * composition, synthesised at runtime, nothing downloaded or recorded (#543
 * D2, on the map's Constraints).
 *
 * **Encoded from the full score's first edition** (Goodwin & Tabb, London,
 * 1921, printed by arrangement with Boosey & Hawkes, B. & H. 15970; IMSLP
 * #24899): printed pages 1–7, bars 1–43 — the opening to rehearsal II and
 * the four bars its fff chord is held. The notes are Holst's as that score
 * prints them, at sounding pitch (horns in F, clarinets and tenor tuba in
 * B♭, cor anglais in F, bass oboe an octave down; tenor trombones in tenor
 * clef).
 *
 * - **The ostinato**, bars 1–39: strings col legno and the harps on G, the
 *   timpani with them — a triplet of eighths, two quarters, two eighths, a
 *   quarter. At rehearsal II the strings and low brass hammer the same
 *   rhythm on C in octaves.
 * - **The call** (bars 3–12): bassoons and horns V–VI, G held, D; D♭, C;
 *   again, rising through the horns' G♭ into G. The oboes answer (11–13).
 * - **Rehearsal I** (bars 17–24): tenor and bass trombones, D♭ to B♭, A;
 *   then F–B♭, C♯–E, F–B♭, A in three parts. **The tubas** (25–29) in
 *   octaves, E♭–C, B♭–F, E♭–C, B♭–D♭.
 * - **Flutes a 2 and first violins** (28–36): D♭6 and B♮5, then the
 *   violins' divided B major over the bassoons' G (34–39).
 * - **Rehearsal II** (40–43): D♭ major held fff over the hammered C.
 *
 * **Reduced**: harps, gong, organ and every doubling are left out; the
 * woodwinds' chords under the call (bars 10–13) are left out; the bar-14
 * chord keeps six of its notes; the horns' chords under the tubas (25–28),
 * the brass stabs (29–33) and the trumpets (23–24, 34–39) are left out; the
 * dotted-sixteenth figures of bars 34–39 in flutes, horns, trumpets and
 * tenor tuba are left out, keeping only the held notes they leave; the
 * piccolo and flutes' notes at rehearsal II, which could not be read with
 * certainty, are left out, and so are the timpani there.
 *
 * **Tempo**: the score prints *Allegro* with no metronome mark; a quarter at
 * 168 is this file's reading of it, held throughout. The excerpt ends where
 * the held chord does; the ostinato runs on in the score.
 *
 * Every event's bar is 0-based within its section: score bar n is bar
 * n − 1 in "opening" and n − 40 in "climax".
 *
 * Imports only the score's types, the notation helpers and the Danube's
 * voicings, so it is data.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

/** The printed marking is *Allegro* alone; a quarter at 168 is this file's
 *  reading of it. */
const BPM = 168;

const G2 = 43;
const G3 = 55;

/** The col legno rhythm of every bar: a triplet of eighths on beat 1, a
 *  quarter on 2 and 3, two eighths on 4, a quarter on 5. `[beat, dur]`. */
const RHYTHM: readonly (readonly [number, number])[] = [
	[0, 1 / 3],
	[1 / 3, 1 / 3],
	[2 / 3, 1 / 3],
	[1, 1],
	[2, 1],
	[3, 0.5],
	[3.5, 0.5],
	[4, 1],
];

/** The ostinato for bars `[from, to)` (0-based) on `pitches`, at a
 *  velocity by bar. Each stroke is short: col legno is the wood of the bow,
 *  so a stroke's body is a fraction of its written length. */
const ostinato = (
	part: string,
	from: number,
	to: number,
	pitches: readonly number[],
	vel: (bar: number) => number,
	body = 0.6,
): NoteEvent[] =>
	Array.from({ length: to - from }, (_, i) => from + i).flatMap((bar) =>
		RHYTHM.flatMap(([beat, dur]) =>
			chord(part, bar, beat, pitches, dur * body, vel(bar)),
		),
	);

/** By 0-based bar: p from the start, mf dim. at score bar 14, p at 17,
 *  cresc. through 23–27, mf/f from 28, f cresc. from 34, ff sempre cresc.
 *  from 37. */
const dyn = (bar: number) =>
	bar < 13
		? 0.45
		: bar < 16
			? 0.52
			: bar < 22
				? 0.42
				: bar < 27
					? 0.52
					: bar < 33
						? 0.62
						: bar < 36
							? 0.7
							: 0.8;

const ORCH = DANUBE_VOICINGS.orchestra;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Strings col legno, and the harps' G under them: the wood of the bow.
	ostinato: {
		voice: "strings",
		level: 0.3,
		attackS: 0.008,
		releaseS: 0.07,
		unison: 3,
		index: 0.9,
		bowS: 0.03,
		cutoffHz: 1100,
		envAmount: 0.6,
		vibrato: 0,
		pan: 0.1,
		reverb: 0.35,
	},
	// Timpani, wooden sticks, on the same G and the same rhythm.
	timpani: { voice: "tone", level: 0.14, ratio: 1.5, reverb: 0.3 },
	// Bassoons and horns V–VI: the call, on the Danube's horn desk.
	call: { ...ORCH.horn, pan: -0.3, reverb: 0.45 },
	// The oboes' line over it.
	winds: {
		voice: "flute",
		level: 0.22,
		glideS: 0.02,
		pan: 0.3,
		reverb: 0.5,
	},
	// The woodwinds' held chord (bars 14–16).
	chord: {
		voice: "drone",
		level: 0.14,
		attackS: 0.15,
		releaseS: 0.8,
		detune: 0.06,
		drift: 5,
		spread: 0.8,
		reverb: 0.55,
	},
	// Trombones, then tubas: the low desk, bowed and gritty.
	low: { ...ORCH.horn, level: 0.28, cutoffHz: 1300, pan: 0.25, reverb: 0.45 },
	// Flutes a 2 with the first violins, from bar 28.
	melody: { ...ORCH.melody, level: 0.3, pan: -0.1, reverb: 0.45 },
	// The violins' divided chord (bars 34–39).
	violins: {
		voice: "strings",
		level: 0.16,
		attackS: 0.12,
		releaseS: 0.4,
		unison: 3,
		cutoffHz: 1800,
		envAmount: 1.2,
		vibrato: 0.1,
		pan: -0.2,
		reverb: 0.5,
	},
	// The held wind chord at rehearsal II, bowed.
	tutti: {
		voice: "strings",
		level: 0.24,
		attackS: 0.08,
		releaseS: 2.2,
		unison: 4,
		cutoffHz: 1600,
		envAmount: 1.6,
		drive: 0.3,
		vibrato: 0.08,
		pan: 0.15,
		reverb: 0.55,
	},
};

// Every bar below is 0-based: score bar n is bar n − 1.

const OPENING: NoteEvent[] = [
	// Violins, violas on G3; cellos and basses on G2 (the basses sound G1,
	// written here at the cellos' octave).
	...ostinato("ostinato", 0, 39, [G2, G3], dyn),
	...ostinato("timpani", 0, 39, [G2], (b) => dyn(b) * 0.8, 0.5),
	// Bars 3–7, bassoons I II and horns V VI (sounding): G held, D; D♭, C.
	// Bars 8–12: G held, D; D♭, then the horns' G♭ into a held G.
	...line(
		"call",
		[
			[2, 0, 43, 8],
			[3, 3, 50, 2],
			[4, 0, 49, 3],
			[4, 3, 48, 5],
			[7, 0, 43, 8],
			[8, 3, 50, 2],
			[9, 0, 49, 3],
			[9, 3, 54, 2],
			[10, 0, 55, 6],
		],
		(b) => (b < 9 ? 0.5 : 0.58),
	),
	// Oboes a 2, bars 11–13: D; D♭, A♭; G, D.
	...line(
		"winds",
		[
			[10, 3, 62, 2],
			[11, 0, 61, 3],
			[11, 3, 68, 2],
			[12, 0, 67, 3],
			[12, 3, 74, 2],
		],
		0.55,
	),
	// Bar 14, mf dim., held to the first beat of bar 16: bassoons F–A–D♭,
	// the bass oboe's E♭, oboes A and E♭.
	...chord("chord", 13, 0, [53, 57, 61, 63, 69, 75], 11, 0.6),
	// Rehearsal I (bar 17): the trombones, p. Tenor trombones over the bass
	// trombone an octave down: D♭ held, B♭; A held.
	...line(
		"low",
		[
			[16, 0, 49, 8],
			[17, 3, 58, 2],
			[18, 0, 57, 8],
			[16, 0, 37, 8],
			[17, 3, 46, 2],
			[18, 0, 45, 8],
			// Tenor trombone II under the held A.
			[18, 0, 49, 8],
			// Bars 21–24: F, B♭; C♯, E; F, B♭; A — the bass trombone, with the
			// tenors' top two notes over it.
			[20, 0, 41, 3],
			[20, 0, 51, 3],
			[20, 3, 46, 2],
			[20, 3, 53, 2],
			[20, 3, 58, 2],
			[21, 0, 49, 3],
			[21, 0, 52, 3],
			[21, 0, 57, 3],
			[21, 3, 52, 2],
			[21, 3, 57, 2],
			[21, 3, 64, 2],
			[22, 0, 53, 3],
			[22, 0, 56, 3],
			[22, 0, 61, 3],
			[22, 3, 58, 2],
			[22, 3, 61, 2],
			[22, 3, 65, 2],
			[23, 0, 57, 5],
			[23, 0, 61, 5],
			[23, 0, 64, 5],
			// Bars 25–29, the tubas in octaves, mf cresc.: E♭, C; B♭, F; E♭, C;
			// B♭, and the tenor tuba's D♭ held into the brass's eighth.
			[24, 0, 39, 3],
			[24, 0, 51, 3],
			[24, 3, 48, 2],
			[24, 3, 60, 2],
			[25, 0, 46, 3],
			[25, 0, 58, 3],
			[25, 3, 53, 2],
			[25, 3, 65, 2],
			[26, 0, 51, 3],
			[26, 0, 63, 3],
			[26, 3, 60, 2],
			[27, 0, 58, 3],
			[27, 3, 61, 2.5],
		],
		dyn,
	),
	// Flutes a 2 and first violins, bars 28–33: D♭, then B♮ held, the D♭
	// above it and back.
	...line(
		"melody",
		[
			[27, 3, 85, 2],
			[28, 0, 83, 5],
			[29, 0, 83, 3],
			[29, 3, 85, 2],
			[30, 0, 83, 5],
			[31, 0, 83, 3],
			[31, 3, 85, 2],
			[32, 0, 83, 3],
			[32, 3, 85, 2],
		],
		0.62,
	),
	// Bars 34–39, f cresc. to ff: the flutes' B held into a quarter, then
	// their D♯–F♯ held the same way (bars 35–36); the dotted figures between
	// and over them (bars 34–39) are left out.
	...line(
		"melody",
		[
			[33, 0, 83, 4],
			[34, 0, 87, 4],
			[34, 0, 90, 4],
			[35, 0, 87, 4],
			[35, 0, 90, 4],
		],
		0.68,
	),
	// The violins' B major, divided: a dotted half and a half in every bar.
	...[33, 34, 35, 36, 37, 38].flatMap((bar) => [
		...chord("violins", bar, 0, [71, 75, 78, 83], 3, dyn(bar)),
		...chord("violins", bar, 3, [71, 75, 78, 83], 2, dyn(bar)),
	]),
	// Bassoons a 3: the G held under it all.
	...[33, 34, 35, 36, 37, 38].flatMap((bar) =>
		line("low", [[bar, 0, G2, 5]], dyn(bar)),
	),
];

// ── Rehearsal II (bars 40–43), fff ───────────────────────────────────────

const CLIMAX: NoteEvent[] = [
	// Horns, clarinets, bassoons, oboes and cor anglais, held for four bars:
	// D♭ major.
	...chord("tutti", 0, 0, [53, 56, 61, 65, 68, 73], 20, 0.9),
	// The ostinato on C in every string and the low brass: basses and
	// double bassoon C2, cellos C2–C3, violas C3–C4, violins C5–C6.
	...ostinato("ostinato", 0, 4, [36, 48, 60, 72], () => 0.9, 0.7),
];

/** Score bars 1–39, then rehearsal II to the end of the held chord. */
const OPENING_BARS = 39;
const CLIMAX_BARS = 4;

/** The excerpt's length at `BPM`: every bar five quarters. */
export const MARS_SECONDS = ((OPENING_BARS + CLIMAX_BARS) * 5 * 60) / BPM;

export const MARS: Song = {
	name: "Mars, the Bringer of War",
	beatsPerBar: 5,
	parts: PARTS,
	sections: [
		{ name: "opening", bars: OPENING_BARS, events: OPENING },
		{ name: "climax", bars: CLIMAX_BARS, events: CLIMAX },
	],
	tempo: [{ bar: 0, bpm: BPM }],
	space: { reverbS: 3 },
};
