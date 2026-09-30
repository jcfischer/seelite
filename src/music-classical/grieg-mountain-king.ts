/**
 * Edvard Grieg, *Peer Gynt* Suite No. 1, Op. 46 (1888), No. 4, "In der
 * Halle des Bergkönigs" — *In the Hall of the Mountain King*. Hand-encoded
 * as note data for #589; a public-domain composition, synthesised at
 * runtime, nothing downloaded or recorded.
 *
 * **Encoded from the Peters full score** (Edition Peters No. 2433, plate
 * 7188; IMSLP #912194), printed pages 24–39 (PDF pages 26–41). *Alla marcia
 * e molto marcato*, crotchet = 138.
 *
 * **Compressed, not complete.** The movement is some ninety bars that
 * state one four-bar phrase over and over, each time louder, higher and
 * faster; played whole it runs past two and a half minutes. This excerpt
 * keeps one pass of each stage of that climb and cuts between them on
 * phrase ends, where the harmony already joins:
 *
 * 1. **pianissimo** — bars 1–12 (pp. 24–25): the theme pizzicato in the
 *    cellos and basses, then in the bassoons, then the answer in F-sharp
 *    back in the cellos. (Bars 13–24, the answer in the bassoons and the
 *    theme twice more, are cut.)
 * 2. **rising** — the last statement before *B* (p. 31 bars 3–4, p. 32
 *    bars 1–2): oboes in octaves, the violins' figure, the basses' scale
 *    down to *B*, *cresc. molto*. (Everything from *A* to here is cut.)
 * 3. **piu-vivo** — *B, Più vivo*, its first eight bars (pp. 32–34): the
 *    theme *ff* in both violins over the cellos' falling ostinato.
 * 4. **stringendo** — the last four bars before *D* (p. 36 bars 4–5, p. 37
 *    bars 1–2): the final statement, *stringendo al fine*, landing on B.
 *    (*B*'s remaining bars and *C*'s first four are cut.)
 * 5. **coda** — *D* to the end, whole (pp. 37–39): the hammer blows, the
 *    theme's head in the woodwinds and then the violins, the swelling
 *    repeated Bs, the timpani alone, and the last *fff* chord.
 *
 * **Reduced.** Each stage keeps its tune (in the octaves printed), its bass
 * and its pulse, and leaves out the rest: the viola and cello quintuplets of
 * the rising stage, the violins' F-sharp pedal under the *Più vivo* tune,
 * the woodwinds' off-beat grace-note chords, the trombones and tuba, and the
 * stopped horn notes of the opening. The horns are kept in the *Più vivo*
 * and *stringendo* stages as the held Bs (and Ds) they sound — they are in
 * E, so written G sounds B — and their repeated eighths in the stringendo
 * are held. The trumpets (in E: written D sounds F-sharp) keep their
 * off-beat quarters. In the coda the grace-note runs and turns that lead
 * into each hammer blow are left out: the blow itself is kept, as the
 * strings' Bs in three octaves over the basses' downbeat. The coda's
 * closing timpani roll is written as eighth-note strokes (the Danube's
 * tremolo trick); through *Più vivo* and the stringendo the timpani's
 * rolls and repeated eighths are one stroke a bar. The final chord is the
 * printed *fff* stroke in the strings, cellos and basses, let ring; the
 * wind and brass in it are left out.
 *
 * **Sounding pitch.** Double basses sound an octave below the cellos'
 * written line. Horns and trumpets in E are transposed as above.
 *
 * **Tempo.** 138 as printed. The score asks for *stretto poco a poco*, then
 * *Più vivo*, then *stringendo al fine*, with no figures: here the rising
 * stage ramps 138 → 152 over its first three bars, *Più vivo* is 168,
 * and the stringendo ramps 168 → 190 → 212, reached ten bars into the coda
 * and held to the end.
 *
 * **Grid.** 4/4, `beatsPerBar` 4; the rising stage's violin quintuplets
 * are fifths of a beat.
 *
 * Imports only the score's types, the notation helpers and the Danube's
 * horn desk.
 */
import { DANUBE_VOICINGS } from "../music-danube";
import type {
	NoteEvent,
	PartSpec,
	Section,
	Song,
	TempoPoint,
} from "../music-score";
import { chord, line } from "./notation";

/** Pitches, MIDI. */
const B1 = 35;
const Cs2 = 37;
const D2 = 38;
const E2 = 40;
const Fs2 = 42;
const G2 = 43;
const A2 = 45;
const As2 = 46;
const B2 = 47;
const C3 = 48;
const Cs3 = 49;
const D3 = 50;
const E3 = 52;
const Es3 = 53;
const Fs3 = 54;
const G3 = 55;
const Gs3 = 56;
const A3 = 57;
const As3 = 58;
const B3 = 59;
const C4 = 60;
const Cs4 = 61;
const D4 = 62;
const E4 = 64;
const Es4 = 65;
const Fs4 = 66;
const G4 = 67;
const A4 = 69;
const As4 = 70;
const B4 = 71;
const C5 = 72;
const Cs5 = 73;
const D5 = 74;
const E5 = 76;
const Es5 = 77;
const Fs5 = 78;
const G5 = 79;
const A5 = 81;
const As5 = 82;
const B5 = 83;
const Cs6 = 85;
const B6 = 95;

type Note = readonly [number, number, number, number];

/** Shift a line by `n` semitones (an octave doubling). */
const up = (notes: readonly Note[], n: number): Note[] =>
	notes.map(([b, x, p, d]) => [b, x, p + n, d] as const);

/** Eighths from `beat` in `bar`. */
const eighths = (bar: number, beat: number, ps: readonly number[]): Note[] =>
	ps.map((p, i) => [bar, beat + i * 0.5, p, 0.5] as const);

/** Staccato quarters on every beat of `bar`. */
const quarters = (bar: number, ps: readonly number[], dur = 0.6): Note[] =>
	ps.map((p, i) => [bar, i, p, dur] as const);

// ---- The theme, as the cellos first print it (p. 24, bars 1–4) ----------

/** Bar 1: B C# D E F# D F#(crotchet). */
const t1 = (bar: number, o = 0): Note[] => [
	...eighths(
		bar,
		0,
		[B2, Cs3, D3, E3, Fs3, D3].map((p) => p + o),
	),
	[bar, 3, Fs3 + o, 1],
];
/** Bar 2: E# C# E#, E C E. */
const t2 = (bar: number, o = 0): Note[] => [
	...eighths(bar, 0, [Es3 + o, Cs3 + o]),
	[bar, 1, Es3 + o, 1],
	...eighths(bar, 2, [E3 + o, C3 + o]),
	[bar, 3, E3 + o, 1],
];
/** Bar 3: B C# D E F# D F# B, eighths. */
const t3 = (bar: number, o = 0): Note[] =>
	eighths(
		bar,
		0,
		[B2, Cs3, D3, E3, Fs3, D3, Fs3, B3].map((p) => p + o),
	);
/** Bar 4: A F# D F# A(crotchet), rest. */
const t4 = (bar: number, o = 0): Note[] => [
	...eighths(
		bar,
		0,
		[A3, Fs3, D3, Fs3].map((p) => p + o),
	),
	[bar, 2, A3 + o, 1],
];
const THEME = (bar: number, o = 0): Note[] => [
	...t1(bar, o),
	...t2(bar + 1, o),
	...t3(bar + 2, o),
	...t4(bar + 3, o),
];

/** The answer in F-sharp (p. 25, bars 9–12, cellos). */
const ANSWER: Note[] = [
	...eighths(8, 0, [Fs3, Gs3, As3, B3, Cs4, As3]),
	[8, 3, Cs4, 1],
	...eighths(9, 0, [D4, As3]),
	[9, 1, D4, 1],
	...eighths(9, 2, [Cs4, As3]),
	[9, 3, Cs4, 1],
	...eighths(10, 0, [Fs3, Gs3, As3, B3, Cs4, As3]),
	[10, 3, Cs4, 1],
	...eighths(11, 0, [D4, As3]),
	[11, 1, D4, 1],
	[11, 2, Cs4, 1],
];

// ---- 1. pianissimo: bars 1–12 -------------------------------------------

/** The bassoons' (bars 1–4, 9–12) and cellos' (5–8) crotchet ostinato:
 *  root and fifth, as printed. */
const OST_1: Note[] = [
	// bars 1–4, bassoon I (bassoon II an octave below, in `LOW_1`)
	...quarters(0, [B2, Fs3, B2, Fs3]),
	...quarters(1, [B2, Fs3, B2, Fs3]),
	...quarters(2, [B2, Fs3, B2, Fs3]),
	...quarters(3, [D3, A3, D3, A3]),
	// bars 5–8, cellos
	...quarters(4, [B2, Fs3, B2, Fs3]),
	...quarters(5, [B2, Fs3, B2, Fs3]),
	...quarters(6, [B2, Fs3, B2, Fs3]),
	...quarters(7, [D3, A3, D3, A3]),
	// bars 9–12, bassoon I under the answer
	...quarters(8, [Fs3, Cs4, Fs3, As3]),
	...quarters(9, [D3, As3, Fs3, As3]),
	...quarters(10, [Fs3, Cs4, Fs3, As3]),
	...quarters(11, [D3, As3, Fs3, As3]),
];
const S1_EVENTS: NoteEvent[] = [
	// the theme pizzicato, bars 1–4, and the answer, bars 9–12
	...line("pizz", [...THEME(0), ...ANSWER], 0.5),
	// the double basses under it, an octave down
	...line("low", up([...THEME(0), ...ANSWER], -12), 0.4),
	// the bassoons' statement, bars 5–8 (II an octave below I)
	...line("reed", [...THEME(4), ...up(THEME(4), -12)], 0.45),
	...line("ost", OST_1, 0.35),
	// bassoon II's octave below, bars 1–4 and 9–12; the basses', 5–8
	...line(
		"low",
		up(
			OST_1.filter(([b]) => b < 4 || b >= 8),
			-12,
		),
		0.3,
	),
	...line(
		"low",
		up(
			OST_1.filter(([b]) => b >= 4 && b < 8),
			-12,
		),
		0.3,
	),
	// gran cassa, pp, on the first beat of every other bar
	...[0, 2, 4, 6, 8, 10].flatMap((b) => chord("drum", b, 0, [30], 0.5, 0.35)),
];

// ---- 2. rising: p. 31 bars 3–4, p. 32 bars 1–2 --------------------------

const S2_OBOES: Note[] = [
	...t1(0, 24),
	...t2(1, 24),
	...t3(2, 24),
	...eighths(3, 0, [Fs5, D5, Fs5, B5]),
	[3, 2, B4, 2],
];
/** The violins' figure: a quintuplet F# G F# E# F# on beats 2 and 4, then
 *  sixteenths F# G F# E# on every beat from p. 32. */
const quint = (bar: number, beat: number): Note[] =>
	[Fs5, G5, Fs5, Es5, Fs5].map(
		(p, i) => [bar, beat + i / 5, p, 1 / 5] as const,
	);
const sixteens = (bar: number, beat: number): Note[] =>
	[Fs5, G5, Fs5, Es5].map((p, i) => [bar, beat + i / 4, p, 1 / 4] as const);
const S2_VIOLINS: Note[] = [
	...quint(0, 1),
	...quint(0, 3),
	...quint(1, 1),
	...quint(1, 3),
	...sixteens(2, 1),
	...sixteens(2, 2),
	...sixteens(2, 3),
	...sixteens(3, 0),
	...sixteens(3, 1),
	...sixteens(3, 2),
	...sixteens(3, 3),
];
const S2_EVENTS: NoteEvent[] = [
	...line("winds", [...S2_OBOES, ...up(S2_OBOES, -12)], 0.7),
	...line("violins", S2_VIOLINS, (b) => 0.3 + b * 0.08),
	// the basses: B in octaves, then the scale down to B with the cellos
	...line(
		"low",
		[
			...quarters(0, [B1, B2, B1, B2]),
			...quarters(1, [B1, B2, B1, B2]),
			[2, 0, B1, 0.6],
			...quarters(2, [B2, A2, G2]).map(
				([b, x, p, d]) => [b, x + 1, p, d] as const,
			),
			...quarters(3, [Fs2, E2, D2, Cs2]),
		],
		(b) => 0.45 + b * 0.08,
	),
	...line(
		"ost",
		[
			...quarters(2, [B3, A3, G3]).map(
				([b, x, p, d]) => [b, x + 1, p, d] as const,
			),
			...quarters(3, [Fs3, E3, D3, Cs3]),
		],
		(b) => 0.45 + b * 0.08,
	),
	// timpani: B on 1 and 3, then every beat, cresc. molto
	...line(
		"timp",
		[
			[0, 0, B2, 0.5],
			[0, 2, B2, 0.5],
			...quarters(2, [B2, B2, B2, B2], 0.5),
			...quarters(3, [B2, B2, B2, B2], 0.5),
		],
		(b) => 0.4 + b * 0.12,
	),
	...chord("drum", 0, 0, [30], 0.5, 0.5),
	...chord("drum", 2, 0, [30], 0.5, 0.6),
];

// ---- 3. piu-vivo: B, eight bars; 4. stringendo: four bars before D -------

/** The theme as the Più vivo violins play it: its crotchets split into two
 *  eighths, bar 4 closing on a minim. `o` puts it in Violin I's octave. */
const vivo = (bar: number, o: number, close: "A" | "B"): Note[] => [
	...eighths(
		bar,
		0,
		[B2, Cs3, D3, E3, Fs3, D3, Fs3, Fs3].map((p) => p + o),
	),
	...eighths(
		bar + 1,
		0,
		[Es3, Cs3, Es3, Es3, E3, C3, E3, E3].map((p) => p + o),
	),
	...t3(bar + 2, o),
	...(close === "A"
		? [
				...eighths(
					bar + 3,
					0,
					[A3, Fs3, D3, Fs3].map((p) => p + o),
				),
				[bar + 3, 2, A3 + o, 2] as const,
			]
		: [
				...eighths(
					bar + 3,
					0,
					[Fs3, D3, Fs3, B3].map((p) => p + o),
				),
				[bar + 3, 2, B2 + o, 2] as const,
			]),
];
/** The cellos' falling ostinato, eighths: B A G F# twice; D C# B A in each
 *  statement's fourth bar (B's) or B A G F# (D's lead-in). */
const falling = (bar: number, top: "B" | "D"): Note[] =>
	top === "B"
		? eighths(bar, 0, [B2, A2, G2, Fs2, B2, A2, G2, Fs2])
		: eighths(bar, 0, [D3, Cs3, B2, A2, D3, Cs3, B2, A2]);
/** Horns (in E): minims on the sounding B octave, or D–F# in the statement's
 *  fourth bar. */
const hornBar = (bar: number, dChord: boolean): NoteEvent[] => [
	...chord("horns", bar, 0, dChord ? [D4, Fs4] : [B3, B4], 2, 0.8),
	...chord("horns", bar, 2, dChord ? [D4, Fs4] : [B3, B4], 2, 0.75),
];
/** Trumpets (in E): off-beat crotchets on the sounding F# octave. */
const trumpetBar = (bar: number): NoteEvent[] => [
	...chord("trumpets", bar, 1, [Fs4, Fs5], 0.5, 0.7),
	...chord("trumpets", bar, 3, [Fs4, Fs5], 0.5, 0.7),
];
/** Gran cassa on 1 and 3, piatti on 2 and 4. */
const kitBar = (bar: number, vel: number): NoteEvent[] => [
	...chord("drum", bar, 0, [30], 0.5, vel),
	...chord("drum", bar, 2, [30], 0.5, vel),
	...chord("cymbal", bar, 1, [100], 0.4, vel * 0.8),
	...chord("cymbal", bar, 3, [100], 0.4, vel * 0.8),
];
/** One tutti statement from `bar`, the way B and the stringendo print it. */
const tutti = (bar: number, close: "A" | "B", vel: number): NoteEvent[] => {
	const tune = [...vivo(bar, 36, close), ...vivo(bar, 24, close)];
	const cellos = [
		...falling(bar, "B"),
		...falling(bar + 1, "B"),
		...falling(bar + 2, "B"),
		...falling(bar + 3, close === "A" ? "D" : "B"),
	];
	return [
		...line("violins", tune, vel),
		...line("ost", cellos, vel),
		...line("low", up(cellos, -12), vel),
		...[0, 1, 2, 3].flatMap((i) => [
			...hornBar(bar + i, close === "A" && i === 3),
			...trumpetBar(bar + i),
			...kitBar(bar + i, vel * 0.7),
		]),
		// the timpani's roll, one stroke a bar: B, and F# under the D bar
		...[0, 1, 2, 3].flatMap((i) =>
			chord("timp", bar + i, 0, [close === "A" && i === 3 ? Fs2 : B2], 1, vel),
		),
	];
};
const S3_EVENTS: NoteEvent[] = [...tutti(0, "A", 0.85), ...tutti(4, "A", 0.9)];
const S4_EVENTS: NoteEvent[] = tutti(0, "B", 0.95);

// ---- 5. coda: D to the end ----------------------------------------------

/** A hammer blow: the basses' B on the downbeat, the strings' B in three
 *  octaves on beat 2 (the grace-note run into it left out). */
const blow = (bar: number, vel: number): NoteEvent[] => [
	...chord("low", bar, 0, [B1, B2], 0.6, vel),
	...chord("timp", bar, 0, [B2], 1, vel),
	...chord("drum", bar, 0, [30], 0.5, vel * 0.7),
	...chord("violins", bar, 1, [B4, B5, B6], 0.6, vel),
	...chord("cymbal", bar, 1, [100], 0.5, vel * 0.7),
];
/** The theme's head and its turn home, as D's woodwinds and then violins
 *  print it: B C# D E F# D F# B | A# F# A# C# B(minim). */
const head = (bar: number, o: number): Note[] => [
	...eighths(
		bar,
		0,
		[B2, Cs3, D3, E3, Fs3, D3, Fs3, B3].map((p) => p + o),
	),
	...eighths(
		bar + 1,
		0,
		[As3, Fs3, As3, Cs4].map((p) => p + o),
	),
	[bar + 1, 2, B3 + o, 2],
];
/** The timpani roll as eighth strokes, swelling from `v0` to `v1`. */
const roll = (
	bar: number,
	from: number,
	v0: number,
	v1: number,
): NoteEvent[] => {
	const n = (4 - from) * 2;
	return Array.from({ length: n }, (_, i) =>
		chord(
			"timp",
			bar,
			from + i * 0.5,
			[B2],
			0.5,
			v0 + ((v1 - v0) * i) / (n - 1),
		),
	).flat();
};

const S5_EVENTS: NoteEvent[] = [
	// D, bars 1–2 (p. 37)
	...blow(0, 0.95),
	...blow(1, 0.95),
	// bars 3–4: the head in the oboes, in octaves; cellos and basses G., F#.
	// then F#., B.
	...line("winds", [...head(2, 24), ...up(head(2, 24), -12)], 0.75),
	...line(
		"low",
		[
			[2, 0, G2, 1.5],
			[2, 2, Fs2, 1.5],
			[3, 0, Fs2, 1.5],
			[3, 2, B2, 1.5],
		],
		0.6,
	),
	// bars 5–6: blows (p. 38)
	...blow(4, 0.95),
	...blow(5, 0.95),
	// bars 7–8: the head in the violins, the woodwinds with them
	...line("violins", [...head(6, 36), ...head(6, 24)], 0.8),
	...line("winds", head(6, 24), 0.7),
	...line(
		"low",
		[
			[6, 0, G2, 1],
			[6, 2, Fs2, 1],
			[7, 0, Fs2, 1],
			[7, 2, B2, 1],
		],
		0.6,
	),
	// bars 9–10: blows (p. 38 bar 6, p. 39 bar 1)
	...blow(8, 0.95),
	...blow(9, 0.95),
	// bars 11–12: repeated Bs, p cresc. molto (the turns into each left out)
	...line(
		"violins",
		[1, 2, 3].flatMap((x) => [
			[10, x, B6, 0.7] as const,
			[10, x, B5, 0.7] as const,
			[10, x, B4, 0.7] as const,
		]),
		(b) => 0.35 + (b - 10) * 0.1,
	),
	...line(
		"violins",
		[0, 1, 2, 3].flatMap((x) => [
			[11, x, B6, 0.7] as const,
			[11, x, B5, 0.7] as const,
			[11, x, B4, 0.7] as const,
		]),
		0.55,
	),
	// bars 13–14: the timpani alone, rolling from p to fff
	...roll(12, 2, 0.2, 0.45),
	...roll(13, 0, 0.5, 0.95),
	// bar 15: the last chord, fff — basses on the downbeat, everything on
	// beat 2, let ring
	...chord("low", 14, 0, [B1, B2], 0.8, 1),
	...chord("timp", 14, 0, [B2], 1, 1),
	...chord("drum", 14, 0, [30], 0.6, 0.9),
	...chord("violins", 14, 1, [B4, B5, B6], 2.8, 1),
	...chord("ost", 14, 1, [B2, B3], 2.8, 1),
	...chord("low", 14, 1, [B1], 2.8, 1),
	...chord("cymbal", 14, 1, [100], 1.5, 0.9),
];

const SECTIONS: Section[] = [
	{ name: "pianissimo", bars: 12, events: S1_EVENTS },
	{ name: "rising", bars: 4, events: S2_EVENTS },
	{ name: "piu-vivo", bars: 8, events: S3_EVENTS },
	{ name: "stringendo", bars: 4, events: S4_EVENTS },
	{ name: "coda", bars: 15, events: S5_EVENTS },
];

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Cellos and basses pizzicato: a plucked stroke on the strings voice.
	pizz: {
		voice: "strings",
		level: 0.34,
		attackS: 0.004,
		decayS: 0.45,
		sustain: 0,
		releaseS: 0.15,
		cutoffHz: 1200,
		envAmount: 1.5,
		index: 0.35,
		vibrato: 0,
		pan: -0.1,
		reverb: 0.4,
	},
	// The bassoons: short bowed strokes, darker, a little reed in the drive.
	reed: {
		voice: "strings",
		level: 0.3,
		attackS: 0.02,
		decayS: 0.3,
		sustain: 0.5,
		releaseS: 0.1,
		cutoffHz: 900,
		envAmount: 1.2,
		drive: 0.3,
		vibrato: 0,
		pan: 0.2,
		reverb: 0.35,
	},
	// The staccato ostinato: bassoons, then cellos, then the Più vivo run.
	ost: {
		voice: "strings",
		level: 0.24,
		attackS: 0.008,
		decayS: 0.25,
		sustain: 0.2,
		releaseS: 0.1,
		cutoffHz: 850,
		envAmount: 1.2,
		index: 0.3,
		vibrato: 0,
		pan: 0.15,
		reverb: 0.3,
	},
	// Double basses and bassoon II: the floor.
	low: {
		voice: "strings",
		level: 0.3,
		attackS: 0.01,
		decayS: 0.4,
		sustain: 0.3,
		releaseS: 0.15,
		cutoffHz: 520,
		envAmount: 1,
		keyTrack: 0.5,
		drive: 0.2,
		vibrato: 0,
		pan: 0,
		reverb: 0.3,
	},
	// Oboes and the coda's woodwinds.
	winds: {
		voice: "flute",
		level: 0.26,
		attackS: 0.015,
		releaseS: 0.12,
		index: 0.25,
		cutoffHz: 2600,
		vibrato: 0,
		pan: 0.25,
		reverb: 0.4,
	},
	// The violins: the rising figure, the tune in octaves, the hammer blows.
	violins: {
		voice: "strings",
		level: 0.32,
		attackS: 0.012,
		decayS: 0.3,
		sustain: 0.6,
		releaseS: 0.12,
		unison: 3,
		cutoffHz: 2600,
		envAmount: 1.6,
		index: 0.35,
		vibrato: 0.05,
		pan: -0.25,
		reverb: 0.4,
	},
	// Horns in E, on the Danube's horn desk (#547 D14/D17).
	horns: {
		...DANUBE_VOICINGS.orchestra.horn,
		level: 0.16,
		pan: -0.3,
		reverb: 0.5,
	},
	// Trumpets in E: short off-beat stabs.
	trumpets: {
		voice: "strings",
		level: 0.12,
		attackS: 0.006,
		decayS: 0.18,
		sustain: 0.1,
		releaseS: 0.08,
		cutoffHz: 3000,
		envAmount: 1.8,
		drive: 0.4,
		vibrato: 0,
		pan: 0.3,
		reverb: 0.35,
	},
	// Timpani in B and F#.
	timp: {
		voice: "tone",
		level: 0.22,
		decayS: 0.9,
		ratio: 1.3,
		pan: 0.1,
		reverb: 0.35,
	},
	// Gran cassa.
	drum: { voice: "kick", level: 0.14, pan: 0, reverb: 0.3 },
	// Piatti, sparingly.
	cymbal: {
		voice: "noise",
		level: 0.04,
		decayS: 0.5,
		releaseS: 0.3,
		pan: 0.2,
		reverb: 0.4,
	},
};

const TEMPO: readonly TempoPoint[] = [
	{ bar: 0, bpm: 138 },
	{ bar: 12, bpm: 138 },
	{ bar: 15, bpm: 152, ramp: true },
	{ bar: 16, bpm: 168 },
	{ bar: 24, bpm: 168 },
	{ bar: 28, bpm: 190, ramp: true },
	{ bar: 38, bpm: 212, ramp: true },
];

export const MOUNTAIN_KING: Song = {
	name: "In der Halle des Bergkönigs (Op. 46 No. 4)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: SECTIONS,
	tempo: TEMPO,
	space: { reverbS: 2.4 },
};

/** Seconds for `beats` beats ramping linearly (in beats) from `a` to `b`
 *  bpm; constant when `a === b`. */
const span = (beats: number, a: number, b: number): number =>
	a === b ? (beats * 60) / a : ((beats * 60) / (b - a)) * Math.log(b / a);

/** The excerpt's length from its tempo map, 43 bars of 4. */
export const MOUNTAIN_KING_SECONDS =
	span(12 * 4, 138, 138) +
	span(3 * 4, 138, 152) +
	span(1 * 4, 152, 152) +
	span(8 * 4, 168, 168) +
	span(4 * 4, 168, 190) +
	span(10 * 4, 190, 212) +
	span(5 * 4, 212, 212);
