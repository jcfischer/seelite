/**
 * Johann Sebastian Bach, *Wachet auf, ruft uns die Stimme*, BWV 645 — the
 * first of the six Schübler chorales for organ (published c. 1748), hand
 * encoded as note data for #589. A public-domain composition, synthesised
 * at runtime; nothing downloaded or recorded.
 *
 * **Encoded from the Bach-Gesellschaft edition**, Bd. 25.2 (Leipzig:
 * Breitkopf & Härtel, 1878), printed page 63 (IMSLP #661655, PDF page 1):
 * the anacrusis and bars 1–21, then the first beat of the first-time bar
 * 22 held as a final chord. That is the whole ritornello (bars 1–12) and
 * the chorale's first Stollen in the tenor (bars 13–21, "Wachet auf, ruft
 * uns die Stimme / der Wächter sehr hoch auf der Zinne / wach auf, du Stadt
 * Jerusalem"), which cadences on E-flat. The repeat is not taken.
 *
 * Three staves, three parts, each as printed:
 *
 * - **ritornello** — *Dextra 8 Fuss*, the right hand's obbligato, on
 *   `flute`. Written pitch is sounding pitch.
 * - **cantus** — *Sinistra 8 Fuss*, the cantus firmus in the tenor clef, on
 *   bowed `strings` with no vibrato, as an organ reed would have none.
 * - **pedal** — *Pedal 16 Fuss*: a 16' stop sounds an octave below the
 *   written note, so every pedal note here is the printed one minus 12.
 *
 * **Where the arrangement departs from the page.** Appoggiaturas are played
 * on the beat, each taking half the note it leans on; the small note before
 * bar 12's G and the one before bar 20's tenor E-flat are left out. A trill
 * (`tr`) is one upper-note stroke then the main note; the two mordents
 * (bar 12, the tenor in bar 18) are not ornamented. Bar 22 is the
 * arrangement's own close: the ritornello restarts there in the score, and
 * here its first note, the tenor's E-flat and a pedal E-flat (the score's
 * pedal has G) are held as a tonic chord, with a soft `drone` bed filling in
 * G and B-flat so it does not end in bare octaves.
 *
 * **Grid.** 4/4, `beatsPerBar` 4. The piece opens on an eighth-note
 * anacrusis, and a song's first bar starts at its first beat, so the whole
 * score is shifted half a beat later: song bar *n* begins on the "and" of
 * beat 4 of score bar *n*. The notes are written below in **score** bars
 * and beats, as the page numbers them, and `place` does the shift.
 *
 * **Tempo.** The edition prints none. Crotchet = 66, a moderate walking
 * pace, easing to 50 over the last two bars into the held chord.
 *
 * Imports only the score's types and the notation helpers.
 */
import type { NoteEvent, PartSpec, Song } from "../music-score";
import { chord, line } from "./notation";

const BPM = 66;
const FINAL_BPM = 50;

/** Pitches, MIDI. */
const C2 = 36;
const D2 = 38;
const Eb2 = 39;
const F2 = 41;
const G2 = 43;
const Ab2 = 44;
const A2 = 45;
const Bb2 = 46;
const C3 = 48;
const D3 = 50;
const Eb3 = 51;
const F3 = 53;
const G3 = 55;
const Ab3 = 56;
const A3 = 57;
const Bb3 = 58;
const C4 = 60;
const D4 = 62;
const Eb4 = 63;
const F4 = 65;
const G4 = 67;
const Ab4 = 68;
const A4 = 69;
const Bb4 = 70;
const C5 = 72;
const D5 = 74;
const Eb5 = 75;

type Note = readonly [number, number, number, number];

/** The half-beat shift: score bar `b`, beat `x` → song bar and beat. The
 *  anacrusis (score bar 0, beat 3.5) is song bar 0, beat 0. */
const SHIFT = 0.5 - 4;
const shift = ([bar, beat, pitch, dur]: Note): Note => {
	const t = bar * 4 + beat + SHIFT;
	return [Math.floor(t / 4), t - Math.floor(t / 4) * 4, pitch, dur];
};
const place = (
	part: string,
	notes: readonly Note[],
	vel: number,
	transpose = 0,
): NoteEvent[] =>
	line(
		part,
		notes.map(([b, x, p, d]) => shift([b, x, p + transpose, d])),
		vel,
	);

/** Bar 1's figure, which recurs in bars 3, 13, 15 and (first-time) 22. */
const figA = (bar: number): Note[] => [
	[bar, 0, Eb4, 0.25],
	[bar, 0.25, F4, 0.25],
	[bar, 0.5, G4, 0.5],
	[bar, 1, G4, 0.5],
	[bar, 1.5, F4, 0.5],
	[bar, 2, Ab4, 0.5],
	[bar, 2.5, G4, 0.5],
	[bar, 3, Bb3, 0.5],
	[bar, 3.5, Ab3, 0.5],
];
/** Bar 2's answer, in bars 4, 14 and 16; each ends on its own upbeat. */
const figB = (bar: number, upbeat: number): Note[] => [
	[bar, 0, G4, 0.25],
	[bar, 0.25, Eb4, 0.25],
	[bar, 0.5, F4, 0.5],
	[bar, 1, Ab3, 0.5],
	[bar, 1.5, G3, 0.5],
	[bar, 2, D4, 0.5],
	[bar, 2.5, Eb4, 0.5],
	[bar, 3.5, upbeat, 0.5],
];
/** A run of sixteenths from `beat`. */
const sixteenths = (bar: number, beat: number, pitches: number[]): Note[] =>
	pitches.map((p, i) => [bar, beat + i * 0.25, p, 0.25]);
/** Quarters on every beat of a bar. */
const quarters = (bar: number, pitches: number[]): Note[] =>
	pitches.map((p, i) => [bar, i, p, 1]);
/** Eighths from `beat`. */
const eighths = (bar: number, beat: number, pitches: number[]): Note[] =>
	pitches.map((p, i) => [bar, beat + i * 0.5, p, 0.5]);

/** Dextra: the ritornello and its continuation over the chorale. */
const RITORNELLO: Note[] = [
	[0, 3.5, Bb3, 0.5],
	...figA(1),
	...figB(2, Bb3),
	...figA(3),
	...figB(4, Bb4),
	// 5
	[5, 0, Bb4, 1],
	...sixteenths(5, 1, [Ab4, G4, F4, Eb4, F4, Eb4, D4, C4]),
	[5, 3, Bb3, 0.5],
	[5, 3.5, C4, 0.25],
	[5, 3.75, D4, 0.25],
	// 6
	...sixteenths(6, 0, [Eb4, F4, G4, F4, Ab4, G4, F4, Eb4]),
	[6, 2, G4, 0.5],
	[6, 2.5, F4, 0.5],
	[6, 3.5, Bb3, 0.5],
	// 7: the appoggiatura F takes half the E-flat it leans on
	[7, 0, G4, 0.5],
	[7, 0.5, A4, 1],
	[7, 1.5, Bb4, 0.5],
	[7, 2, F4, 0.125],
	[7, 2.125, Eb4, 0.125],
	[7, 2.25, D4, 0.25],
	[7, 2.5, Eb4, 0.5],
	[7, 3.5, C4, 0.5],
	// 8
	[8, 0, A4, 0.5],
	[8, 0.5, Bb4, 1],
	[8, 1.5, C5, 0.5],
	[8, 2, F4, 0.125],
	[8, 2.125, Eb4, 0.125],
	[8, 2.25, D4, 0.25],
	[8, 2.5, Eb4, 0.5],
	[8, 3.5, Eb5, 0.5],
	// 9: the trilled B-flat as one upper-note stroke
	[9, 0, D5, 0.25],
	[9, 0.25, C5, 0.25],
	[9, 0.5, Bb4, 0.5],
	[9, 1, C5, 0.125],
	[9, 1.125, Bb4, 0.125],
	[9, 1.25, A4, 0.25],
	[9, 1.5, Bb4, 0.5],
	...sixteenths(9, 2, [Bb4, A4, G4, F4, Eb4, D4, C4, Bb3]),
	// 10
	[10, 0, C4, 0.25],
	[10, 0.25, D4, 0.25],
	[10, 0.5, Eb4, 0.5],
	[10, 1, F4, 0.125],
	[10, 1.125, Eb4, 0.125],
	[10, 1.25, D4, 0.25],
	[10, 1.5, Eb4, 0.5],
	...sixteenths(10, 2, [Eb4, A4, Bb4, C5, Bb4, A4, G4, F4]),
	// 11: the trilled D the same way
	[11, 0, Bb4, 0.5],
	[11, 0.5, F4, 0.5],
	[11, 1, Eb4, 0.25],
	[11, 1.25, D4, 0.25],
	[11, 1.5, C4, 0.25],
	[11, 1.75, Bb3, 0.25],
	...sixteenths(11, 2, [Bb3, Eb4, D4, C4]),
	[11, 3, D4, 0.5],
	[11, 3.5, Bb3, 0.5],
	// 12: the ritornello's close on the dominant
	[12, 0, G3, 0.75],
	[12, 0.75, A3, 0.25],
	[12, 1, A3, 0.75],
	[12, 1.75, G3, 0.125],
	[12, 1.875, A3, 0.125],
	[12, 2, Bb3, 1],
	[12, 3.5, Bb3, 0.5],
	// 13–16: the ritornello's head again, over the chorale
	...figA(13),
	...figB(14, Bb3),
	...figA(15),
	...figB(16, F4),
	// 17
	[17, 0, G4, 0.5],
	[17, 0.5, A4, 1],
	[17, 1.5, Bb4, 0.5],
	[17, 2, F4, 0.125],
	[17, 2.125, Eb4, 0.125],
	[17, 2.25, D4, 0.25],
	[17, 2.5, Eb4, 0.5],
	[17, 3.5, Eb4, 0.5],
	// 18
	[18, 0, A4, 0.5],
	[18, 0.5, Bb4, 1],
	[18, 1.5, D5, 0.5],
	[18, 2, G4, 0.125],
	[18, 2.125, F4, 0.125],
	[18, 2.25, Eb4, 0.25],
	[18, 2.5, F4, 0.5],
	// 19
	[19, 1.5, Bb4, 0.5],
	[19, 2, Bb4, 1],
	...sixteenths(19, 3, [Ab4, G4, F4, Eb4]),
	// 20
	...sixteenths(20, 0, [F4, Eb4, D4, C4]),
	[20, 1, Bb3, 0.5],
	[20, 1.5, C4, 0.25],
	[20, 1.75, D4, 0.25],
	...sixteenths(20, 2, [Eb4, F4, G4, F4, Ab4, G4, F4, Eb4]),
	// 21, first time
	[21, 0, G4, 0.5],
	[21, 0.5, F4, 0.5],
	[21, 3.5, Bb3, 0.5],
];

/** Sinistra: the chorale in the tenor, from bar 13. */
const CANTUS: Note[] = [
	[13, 2, Eb3, 1],
	[13, 3, G3, 1],
	...quarters(14, [Bb3, Bb3, Bb3, Bb3]),
	[15, 0, C4, 2],
	[15, 2, Bb3, 2],
	[16, 3, Bb3, 1],
	[17, 0, Eb4, 1],
	[17, 1, Bb3, 1],
	[17, 2, Eb4, 0.5],
	[17, 2.5, F4, 0.5],
	[17, 3, G4, 1],
	[18, 0, F4, 1.5],
	[18, 1.5, Eb4, 0.5],
	[18, 2, D4, 1],
	[18, 3, C4, 0.75],
	[18, 3.75, Bb3, 0.125],
	[18, 3.875, C4, 0.125],
	[19, 0, Bb3, 2],
	[20, 1, Bb3, 1],
	[20, 2, Eb4, 1],
	[20, 3, Bb3, 1],
	[21, 0, C4, 1],
	[21, 1, G3, 0.75],
	[21, 1.75, Ab3, 0.125],
	[21, 1.875, Bb3, 0.125],
	[21, 2, Ab3, 0.5],
	[21, 2.5, G3, 0.5],
	// the trilled F: one upper-note stroke, then the note
	[21, 3, G3, 0.25],
	[21, 3.25, F3, 0.75],
];

/** Pedal, as written; `place` sounds it an octave down (16'). */
const PEDAL: Note[] = [
	...quarters(1, [Eb2, Eb2, Eb2, G2]),
	[2, 0, Ab2, 1],
	[2, 1, Bb2, 1],
	[2, 2, Eb2, 1],
	...quarters(3, [Eb2, Eb2, Eb2, G2]),
	[4, 0, Ab2, 1],
	[4, 1, Bb2, 1],
	[4, 2, Eb2, 1],
	...quarters(5, [G2, C3, Bb2, Ab2]),
	...quarters(6, [G2, Eb2, Bb2, D3]),
	...quarters(7, [Eb3, D3, C3, Eb3]),
	...quarters(8, [F3, G3, A3, F3]),
	...quarters(9, [Bb3, A3, G3, F3]),
	...quarters(10, [Eb3, D3, C3, Eb3]),
	...eighths(11, 0, [D3, Bb2, F3, F2, G2, A2, Bb2, D2]),
	...eighths(12, 0, [Eb2, C2]),
	[12, 1, F2, 1],
	...eighths(12, 2, [Bb2, C3, Bb2, Ab2]),
	...eighths(13, 0, [G2, F2, Eb2, D2]),
	[13, 2, C2, 1],
	[13, 3, C3, 1],
	...quarters(14, [G2, Bb2, Eb2, G2]),
	...quarters(15, [Ab2, Ab3, D3, Eb3]),
	...quarters(16, [C3, D3, Eb3, D3]),
	[17, 0, C3, 1],
	[17, 1, G2, 1],
	...eighths(17, 2, [C3, D3]),
	// E-flat tied over the bar line into bar 18's first eighth
	[17, 3, Eb3, 1.5],
	[18, 0.5, D3, 0.5],
	...eighths(18, 1, [G2, A2, Bb2, D2, Eb2, F2]),
	...eighths(19, 0, [Bb2, A2, Bb2, C3, D3, Bb2]),
	[19, 3, Eb3, 1],
	...quarters(20, [Bb2, Ab2, G2, Eb2]),
	...eighths(21, 0, [Ab2, Bb2]),
	[21, 1, C3, 1],
	[21, 2, F2, 1],
	...eighths(21, 3, [Bb2, Ab2]),
];

/** The arrangement's close, on score bar 22's downbeat (song bar 21, beat
 *  0.5): the tonic held into the release. */
const FINAL_DUR = 5.5;
const [finalBar, finalBeat] = shift([22, 0, 0, 0]);
const CLOSE: NoteEvent[] = [
	...place("ritornello", [[22, 0, Eb4, FINAL_DUR]], 0.75),
	...place("cantus", [[22, 0, Eb3, FINAL_DUR]], 0.8),
	...place("pedal", [[22, 0, Eb2, FINAL_DUR]], 0.75, -12),
	...chord("bed", finalBar, finalBeat, [G3, Bb3], FINAL_DUR, 0.6),
];

/** Every note, in song bars from the anacrusis. */
const ALL: NoteEvent[] = [
	...place("ritornello", RITORNELLO, 0.8),
	...place("cantus", CANTUS, 0.85),
	...place("pedal", PEDAL, 0.75, -12),
	...CLOSE,
];

/** The chorale enters in score bar 13; the section line falls on song bar
 *  12, the anacrusis to it. */
const SPLIT = 12;
const RITORNELLO_BARS = SPLIT;
const CHORALE_BARS = 23 - SPLIT;

const PARTS: Readonly<Record<string, PartSpec>> = {
	// Dextra: the obbligato, a flute stop, a little breath on each note.
	ritornello: {
		voice: "flute",
		level: 0.36,
		attackS: 0.03,
		releaseS: 0.25,
		index: 0.25,
		cutoffHz: 2400,
		vibrato: 0.03,
		pan: 0.2,
		reverb: 0.45,
	},
	// Sinistra: the chorale, bowed but steady as an organ reed.
	cantus: {
		voice: "strings",
		level: 0.3,
		attackS: 0.07,
		releaseS: 0.45,
		unison: 3,
		cutoffHz: 1500,
		envAmount: 1.2,
		vibrato: 0,
		pan: -0.2,
		reverb: 0.5,
	},
	// Pedal 16': low bowed strokes, some grit so the octave reads on
	// small speakers.
	pedal: {
		voice: "strings",
		level: 0.36,
		attackS: 0.05,
		releaseS: 0.35,
		cutoffHz: 600,
		envAmount: 1,
		vibrato: 0,
		drive: 0.3,
		keyTrack: 0.5,
		pan: 0,
		reverb: 0.35,
	},
	// The close's filling: a soft organ-like bed.
	bed: {
		voice: "drone",
		level: 0.12,
		attackS: 0.8,
		releaseS: 2,
		unison: 3,
		detune: 0.08,
		pan: 0.05,
		reverb: 0.6,
	},
};

export const WACHET_AUF: Song = {
	name: "Wachet auf, ruft uns die Stimme (BWV 645)",
	beatsPerBar: 4,
	parts: PARTS,
	sections: [
		{
			name: "ritornello",
			bars: RITORNELLO_BARS,
			events: ALL.filter((e) => e.bar < SPLIT),
		},
		{
			name: "chorale",
			bars: CHORALE_BARS,
			events: ALL.filter((e) => e.bar >= SPLIT).map((e) => ({
				...e,
				bar: e.bar - SPLIT,
			})),
		},
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 19, bpm: BPM },
		{ bar: 21, bpm: FINAL_BPM, ramp: true },
	],
	space: { reverbS: 3.8 },
};

/** The excerpt's length from its tempo map: 19 bars at 66, a linear
 *  ramp (in beats) over 8 beats to 50, then two bars at 50. */
export const WACHET_AUF_SECONDS =
	(19 * 4 * 60) / BPM +
	((8 * 60) / (BPM - FINAL_BPM)) * Math.log(BPM / FINAL_BPM) +
	(2 * 4 * 60) / FINAL_BPM;
