/**
 * Claude Debussy, *Suite bergamasque*, III. "Clair de lune" (1890, published
 * 1905), hand-encoded as note data (#589) — a public-domain composition,
 * synthesised at runtime, nothing downloaded or recorded.
 *
 * **Encoded from the Jean Jobert edition** (Paris, 1927, on Fromont's 1905
 * plates, E. 1404 F.; IMSLP #27826): printed page 2, bars 1–14 — the whole
 * opening period, *Andante très expressif*, *pp con sordina*, from the first
 * falling thirds to the phrase that closes on B-flat minor before the *Tempo
 * rubato* of bar 15. Every pitch below was read off that page.
 *
 * **9/8 on the Danube's compound trick**: a beat is a dotted quarter, so a
 * bar is 3 beats and an eighth is a third of one. The printed duplets (two
 * eighths across a dotted quarter) are 1.5 eighths each.
 *
 * **Re-voiced for bowed strings, not `keys`.** The principal heard keys and
 * plucks as *plinky* in the waltz, and this page is almost all held
 * sonorities under a slow line, marked *con sordina* — a sound a muted string
 * desk carries better than a decaying piano tone. So: the top line on a
 * muted first desk, legato; the right hand's lower voice (the parallel
 * thirds, then the inner line) on a second desk; the left hand's chords on a
 * soft viola-like desk; the bass-clef notes of bars 8–14 on a low desk.
 *
 * **Where the arrangement reduces the page.** Ties are written as one long
 * note; a dotted half and the dotted quarter tied to it on the same pitch are
 * one note. The two voices sharing D-flat 3 in bars 10 and 12 sound once. The
 * pedal is not written: a note lasts what its printed value and ties say.
 * The last bar's notes ring on through one added silent bar at the slowed
 * tempo — the arrangement's fermata, so the excerpt ends on the B-flat minor
 * of bar 14 rather than stopping mid-air.
 */
import type { NoteEvent, Song } from "../music-score";
import { line } from "./notation";

/** The opening's pulse, dotted quarters a minute. */
const BPM = 46;
/** Where bar 14 has slowed to, and the held last bar stays. */
const END_BPM = 38;

/** `[printed bar, eighth (0-based, fractional for duplets), pitch, eighths]`. */
type Note = readonly [number, number, number, number];

/** A voice in eighths, printed bar numbers, to the score's beats and bars. */
const voice = (
	part: string,
	notes: readonly Note[],
	vel: number | ((bar: number) => number),
): NoteEvent[] =>
	line(
		part,
		notes.map(([bar, e, pitch, eighths]) => [
			bar - 1,
			e / 3,
			pitch,
			eighths / 3,
		]),
		vel,
	);

/** How much the last notes ring past bar 14, in eighths: the added bar. */
const RING = 9;

// The top line: the first desk.
const MELODY: readonly Note[] = [
	// 1–4: the falling thirds' upper voice.
	[1, 2, 80, 4],
	[1, 6, 77, 4],
	[2, 1, 75, 1],
	[2, 2, 77, 1],
	[2, 3, 75, 7],
	[3, 1, 73, 1],
	[3, 2, 75, 1],
	[3, 3, 73, 1.5],
	[3, 4.5, 77, 3],
	[3, 7.5, 73, 2.5],
	[4, 1, 72, 1],
	[4, 2, 73, 1],
	[4, 3, 72, 7],
	// 5–8: the line winding down in eighths.
	[5, 1, 70, 1],
	[5, 2, 72, 1],
	[5, 3, 70, 1],
	[5, 4, 75, 1],
	[5, 5, 70, 1],
	[5, 6, 68, 1],
	[5, 7, 70, 1],
	[5, 8, 68, 2],
	[6, 1, 66, 1],
	[6, 2, 68, 1],
	[6, 3, 66, 3],
	[6, 6, 65, 4],
	[7, 1, 65, 1],
	[7, 2, 66, 1],
	[7, 3, 65, 1],
	[7, 4, 73, 1],
	[7, 5, 65, 1],
	[7, 6, 63, 1],
	[7, 7, 65, 1],
	[7, 8, 63, 2],
	[8, 1, 61, 1],
	[8, 2, 63, 1],
	[8, 3, 61, 3],
	[8, 6, 61, 3],
	// 9–14: the opening thirds again, over the bass, to the duplets.
	[9, 3, 80, 3],
	[9, 6, 77, 4],
	[10, 1, 75, 1],
	[10, 2, 77, 1],
	[10, 3, 75, 7],
	[11, 1, 73, 1],
	[11, 2, 75, 1],
	[11, 3, 80, 3],
	[11, 6, 77, 4],
	[12, 1, 75, 1],
	[12, 2, 77, 1],
	[12, 3, 75, 3],
	[12, 6, 73, 4],
	[13, 1, 73, 1],
	[13, 2, 75, 1],
	[13, 3, 82, 1.5],
	[13, 4.5, 80, 3],
	[13, 7.5, 77, 2.5],
	[14, 1, 75, 1],
	[14, 2, 77, 1],
	[14, 3, 75, 1.5],
	[14, 4.5, 73, 3],
	[14, 7.5, 70, 1.5 + RING],
];

// The right hand's lower voice: the thirds' under-note, then the inner line.
const INNER: readonly Note[] = [
	[1, 2, 77, 4],
	[1, 6, 73, 4],
	[2, 1, 72, 1],
	[2, 2, 73, 1],
	[2, 3, 72, 7],
	[3, 1, 70, 1],
	[3, 2, 72, 1],
	[3, 3, 70, 7],
	[4, 1, 68, 1],
	[4, 2, 70, 1],
	[4, 3, 68, 6],
	[5, 0, 66, 9],
	[6, 0, 63, 6],
	[6, 6, 63, 3],
	[7, 0, 61, 6],
	[7, 6, 61, 3],
	[8, 0, 60, 6],
	[8, 6, 58, 3],
	[9, 3, 77, 3],
	[9, 6, 73, 4],
	[10, 1, 66, 8],
	[10, 1, 70, 8],
	[11, 1, 68, 2],
	[11, 1, 61, 1],
	[11, 2, 63, 1],
	[11, 3, 73, 3],
	[11, 3, 68, 3],
	[11, 6, 73, 4],
	[11, 6, 65, 4],
	[12, 1, 66, 8],
	[12, 1, 70, 8],
	[13, 1, 68, 2],
	[13, 1, 61, 1],
	[13, 2, 63, 1],
	[13, 3, 75, 6],
	[13, 3, 70, 1.5],
	[13, 4.5, 68, 3],
	[13, 7.5, 65, 2.5],
	[14, 1, 65, 8 + RING],
	[14, 1, 70, 8 + RING],
];

// The left hand's chords (treble clef to bar 6, bass clef from 7).
const LH: readonly Note[] = [
	[1, 1, 65, 8],
	[1, 1, 68, 8],
	[2, 0, 66, 9],
	[2, 0, 69, 9], // A natural
	[3, 0, 65, 9],
	[3, 0, 68, 9],
	[4, 0, 63, 9],
	[4, 0, 66, 9],
	[5, 0, 61, 6],
	[5, 0, 63, 6],
	[5, 6, 60, 3],
	[5, 6, 63, 3],
	[6, 0, 58, 6],
	[6, 0, 61, 6],
	[6, 6, 57, 3], // A natural
	[6, 6, 60, 3],
	[7, 0, 56, 6],
	[7, 0, 58, 6],
	[7, 6, 54, 3],
	[7, 6, 58, 3],
	[8, 0, 53, 6],
	[8, 0, 56, 6],
	[8, 6, 51, 3],
	[8, 6, 54, 3],
	// 9: the arpeggio up from the bass, F–A-flat in two octaves.
	[9, 1, 53, 8],
	[9, 1, 56, 8],
	[9, 2, 65, 7],
	[9, 2, 68, 7],
	[10, 1, 54, 8],
	[10, 1, 58, 8],
	[10, 1, 61, 8],
	[11, 1, 53, 2],
	[11, 1, 56, 2],
	[11, 3, 61, 3],
	[11, 3, 65, 3],
	[11, 6, 56, 3],
	[11, 6, 60, 3],
	[12, 1, 54, 8],
	[12, 1, 58, 8],
	[12, 1, 61, 8],
	// 13: the C-flat — D-flat seventh over A-flat.
	[13, 1, 53, 2],
	[13, 1, 59, 2],
	[13, 3, 59, 4],
	[13, 3, 61, 4],
	[13, 3, 65, 4],
	[14, 1, 53, 8 + RING],
	[14, 1, 58, 8 + RING],
	[14, 1, 63, 3.5],
	[14, 4.5, 61, 4.5 + RING],
];

// The bass-clef low notes, bars 8–14.
const BASS: readonly Note[] = [
	[8, 7.5, 44, 1.5 + 9], // A-flat, tied into bar 9
	[9, 0, 37, 9],
	[10, 0, 42, 9],
	[10, 0, 49, 9],
	[11, 0, 41, 9],
	[11, 0, 49, 9],
	[12, 0, 42, 9],
	[12, 0, 49, 9],
	[13, 0, 44, 9],
	[14, 0, 46, 9 + RING],
];

/** pp throughout; the swell under bars 13–14's duplets. */
const dyn = (bar: number) => (bar < 12 ? 0.5 : 0.58);

const EVENTS: NoteEvent[] = [
	...voice("melody", MELODY, dyn),
	...voice("inner", INNER, (bar) => dyn(bar) * 0.85),
	...voice("lh", LH, (bar) => dyn(bar) * 0.8),
	...voice("bass", BASS, (bar) => dyn(bar) * 0.9),
];

export const CLAIR_DE_LUNE: Song = {
	name: "Clair de lune",
	beatsPerBar: 3,
	parts: {
		// The first desk, muted: legato, dark, a slow vibrato.
		melody: {
			voice: "strings",
			level: 0.34,
			attackS: 0.25,
			releaseS: 1.2,
			glideS: 0.02,
			cutoffHz: 1300,
			envAmount: 1.2,
			vibrato: 0.08,
			vibratoHz: 4.5,
			pan: -0.1,
			reverb: 0.5,
		},
		inner: {
			voice: "strings",
			level: 0.16,
			attackS: 0.3,
			releaseS: 1.2,
			unison: 3,
			cutoffHz: 1100,
			envAmount: 1,
			vibrato: 0.06,
			pan: 0.25,
			reverb: 0.55,
		},
		lh: {
			voice: "strings",
			level: 0.15,
			attackS: 0.4,
			releaseS: 1.5,
			unison: 3,
			cutoffHz: 900,
			envAmount: 0.8,
			vibrato: 0.05,
			pan: -0.3,
			reverb: 0.55,
		},
		bass: {
			voice: "strings",
			level: 0.24,
			attackS: 0.35,
			releaseS: 2,
			cutoffHz: 600,
			envAmount: 0.8,
			vibrato: 0.04,
			pan: 0.1,
			reverb: 0.45,
		},
	},
	sections: [
		{ name: "a", bars: 14, events: EVENTS },
		// The fermata: bar 14's last notes ring through it.
		{ name: "hold", bars: 1, events: [] },
	],
	tempo: [
		{ bar: 0, bpm: BPM },
		{ bar: 13, bpm: BPM },
		{ bar: 14, bpm: END_BPM, ramp: true },
	],
	space: { reverbS: 4 },
};

/** Bars 1–13 at `BPM`; bar 14 slowing linearly (in beats) to `END_BPM`; the
 *  held bar at `END_BPM`. Three beats a bar. */
export const CLAIR_DE_LUNE_SECONDS =
	(13 * 3 * 60) / BPM +
	((3 * 60) / (BPM - END_BPM)) * Math.log(BPM / END_BPM) +
	(3 * 60) / END_BPM;
