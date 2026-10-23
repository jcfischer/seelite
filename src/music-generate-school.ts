import { berlinFlightBed } from "./music-generate-berlin";
import {
	calmChords,
	FLIGHT_LEVELS,
	inMode,
	MODES,
	type MusicTheme,
	musicTheme,
	PARTS,
	pickOf,
	STATION_ROLES,
	writer,
} from "./music-generate";
import type { NoteEvent, PartSpec, Song, SongSpace } from "./music-score";
import { mix, seededRand } from "./rng";
import type { StationType } from "./station";

/**
 * The fourth bed, a prototype for the principal's ear (2026-10-23): the
 * Berlin school rebuilt from the eight sequence types in Gary P Hayes's
 * video (https://www.youtube.com/watch?v=3uJIKlv7blI). Each type is a
 * sequence with its own register, clock, length and effect, and the bed is
 * the types handed over one to the next:
 *
 * - **anchor** — low, rooted: roots, octaves, fifths and the minor third,
 *   four steps and a fifth so it moves across the beat; it grows from all
 *   roots, a step at a time.
 * - **canopy** — high and soft, starting on the fifth, chords under it.
 * - **modal** — root, fourth, fifth and octave only, so the choir above can
 *   turn from major to minor and back over the same sequence.
 * - **cross-current** — three, five and seven steps against the bar, apart
 *   in register and pan: the anchor's five or seven under a three and a
 *   seven.
 * - **galloping** — one or two notes in eighths, the dotted-eighth echo as
 *   loud as the notes, so the echo is a second sequence.
 * - **breathing** — a slow clock, long notes, a resonant filter sweep on
 *   each of two lines at its own period.
 * - **mirage** — half notes, four of seven steps, octaves, the echo just
 *   under feedback.
 * - **mantra** — a four-step micro-loop that never changes, a frozen bass
 *   under it and a fixed run over it.
 *
 * Calm walks mirage, breathing, canopy, modal and mantra; wary is the anchor
 * growing into the cross-current; threat is the gallop over a kick. Combat is
 * the Berlin bed's own, which is already split and stripped of the cruise
 * stem.
 */
export const SCHOOL_CALM_BARS = 64;
export const SCHOOL_WARY_BARS = 32;
export const SCHOOL_THREAT_BARS = 24;
export const SCHOOL_STATION_BARS = 32;
export const SCHOOL_BPM_LOW = 96;
export const SCHOOL_LEVEL_TEMPO = {
	calm: 1,
	wary: 1.1,
	threat: 1.15,
} as const;

/** Calm's hand-overs, in bars: each type's span, overlapping the next. */
export const CALM_SPANS = {
	mirage: [0, 12],
	breathing: [8, 26],
	canopy: [24, 40],
	modal: [38, 50],
	mantra: [48, 64],
} as const;

/** The dotted-eighth echo every type leans on, louder than the other beds'. */
export const SCHOOL_SPACE: SongSpace = {
	reverbS: 5,
	echoBeats: 0.75,
	echoFeedback: 0.55,
};

const CHORD_BARS = 4;
const SCHOOL_TUNE = 0x7363686f;
const STREAM = { calm: 1, wary: 2, threat: 3, station: 5 } as const;

type Step = number | null;
type Deg = (base: number, d: number) => number;
type Writer = ReturnType<typeof writer>;

/** Scale degrees, 7 the octave. Five or seven steps: an odd length walks
 *  across the beat. */
export const ANCHORS: readonly (readonly Step[])[] = [
	[0, 7, 4, 2, 6],
	[0, 0, 7, 4, 2],
	[0, 7, 2, 4, 0, 5, 4],
	[0, 4, 7, 0, 2, 0, 6],
];
export const CANOPIES: readonly (readonly Step[])[] = [
	[4, 7, 6, 4, 2],
	[4, 9, 7, 6, 7],
	[7, 4, 6, 9, 4],
];
export const MODAL_STEPS = [0, 3, 4, 7] as const;
export const MODALS: readonly (readonly Step[])[] = [
	[0, 4, 3, 7, 4],
	[0, 3, 4, 0, 7],
	[7, 4, 0, 3, 4],
];
/** The patterns a flight and a station bed share. */
export const MIRAGE_STEPS: readonly Step[] = [0, null, 4, null, 7, null, 2];
export const MANTRA_BASS: readonly Step[] = [0, 0, 4, 0, 6];
export const CURRENT_THREE: readonly Step[] = [0, 4, 2];
export const MANTRAS: readonly (readonly Step[])[] = [
	[7, 4, 9, 4],
	[4, 7, 4, 2],
	[9, 7, 4, 7],
];

/** What the seed fixes: one pattern of each type. */
export interface SchoolTune {
	readonly anchor: readonly Step[];
	readonly canopy: readonly Step[];
	readonly modal: readonly Step[];
	readonly mantra: readonly Step[];
}

export function schoolTune(systemSeed: number): SchoolTune {
	const rand = seededRand(mix(systemSeed >>> 0, SCHOOL_TUNE));
	return {
		anchor: pickOf(rand, ANCHORS),
		canopy: pickOf(rand, CANOPIES),
		modal: pickOf(rand, MODALS),
		mantra: pickOf(rand, MANTRAS),
	};
}

export const schoolBpm = (theme: MusicTheme) =>
	SCHOOL_BPM_LOW + (theme.bpm - 66);

const barsS = (bars: number, bpm: number) => (bars * 4 * 60) / bpm;

const MOOG_BASE: PartSpec = {
	voice: "moog",
	level: 0.3,
	unison: 3,
	detune: 0.07,
	drift: 0.3,
	attackS: 0.06,
	decayS: 2.5,
	sustain: 0.5,
	releaseS: 1,
	cutoffHz: 500,
	envAmount: 1.5,
	envDecayS: 0.8,
	resonance: 0.3,
	drive: 0.3,
	reverb: 0.55,
	echo: 0.85,
};

/** The three ladder tones the principal chose by ear (2026-10-23): the fat
 *  sub is the mirage's, the resonant sweep the breathing's, the filter pluck
 *  the anchor's. Each part sets its own level and pan in the mix. */
export const MOOG_TONES = {
	fatSub: {
		...MOOG_BASE,
		index: 0.6,
		cutoffHz: 700,
		resonance: 0.25,
		drive: 0.55,
	},
	resonantSweep: {
		...MOOG_BASE,
		cutoffHz: 350,
		resonance: 0.7,
		envAmount: 1,
		sweepS: 20,
		sweepOct: 2.5,
	},
	filterPluck: {
		...MOOG_BASE,
		attackS: 0.005,
		cutoffHz: 250,
		envAmount: 3,
		envDecayS: 0.25,
		resonance: 0.55,
		sustain: 0.3,
	},
} as const satisfies Record<string, PartSpec>;

const seqVoice = (o: Partial<PartSpec>): PartSpec => ({
	voice: "analog",
	level: 0.26,
	unison: 2,
	detune: 0.06,
	attackS: 0.004,
	decayS: 0.25,
	sustain: 0,
	releaseS: 0.08,
	cutoffHz: 300,
	envAmount: 2,
	envDecayS: 0.12,
	resonance: 0.5,
	reverb: 0.25,
	echo: 0.35,
	...o,
});

function schoolParts(bpm: number): Record<string, PartSpec> {
	return {
		choir: {
			voice: "analog",
			level: 0.18,
			unison: 4,
			detune: 0.15,
			spread: 1,
			attackS: 1.5,
			sustain: 0.9,
			releaseS: 1,
			cutoffHz: 1000,
			envAmount: 0.6,
			envDecayS: 4,
			vibrato: 0.05,
			reverb: 0.65,
		},
		anchor: {
			...MOOG_TONES.filterPluck,
			level: 0.23,
			decayS: 0.3,
			sustain: 0,
			releaseS: 0.08,
			sweepS: barsS(16, bpm),
			sweepOct: 2.2,
			pan: -0.05,
			reverb: 0.25,
			echo: 0.4,
		},
		canopy: seqVoice({
			level: 0.3,
			attackS: 0.025,
			decayS: 0.5,
			cutoffHz: 1500,
			envAmount: 0.8,
			resonance: 0.2,
			sweepS: barsS(12, bpm),
			sweepOct: 1,
			pan: 0.25,
			reverb: 0.45,
			echo: 0.45,
		}),
		modal: seqVoice({
			level: 0.24,
			cutoffHz: 350,
			sweepS: barsS(8, bpm),
			sweepOct: 1.8,
			pan: -0.2,
		}),
		curL: seqVoice({ level: 0.18, cutoffHz: 600, pan: -0.65, echo: 0.2 }),
		curR: seqVoice({
			level: 0.15,
			cutoffHz: 1100,
			envAmount: 1.4,
			pan: 0.65,
			echo: 0.2,
		}),
		gallop: seqVoice({
			level: 0.26,
			cutoffHz: 400,
			envAmount: 2.2,
			resonance: 0.6,
			sweepS: barsS(8, bpm),
			sweepOct: 1.6,
			echo: 0.95,
		}),
		breathA: {
			...MOOG_TONES.resonantSweep,
			level: 0.22,
			attackS: 0.06,
			decayS: 1.2,
			sustain: 0.6,
			releaseS: 0.5,
			sweepS: barsS(8, bpm),
			pan: -0.3,
			reverb: 0.25,
			echo: 0.5,
		},
		breathB: {
			...MOOG_TONES.resonantSweep,
			level: 0.18,
			attackS: 0.1,
			decayS: 1.6,
			sustain: 0.6,
			releaseS: 0.7,
			cutoffHz: 300,
			sweepS: barsS(11, bpm),
			sweepOct: 2.2,
			pan: 0.35,
			reverb: 0.25,
			echo: 0.45,
		},
		mirage: { ...MOOG_TONES.fatSub, level: 0.08, pan: -0.4 },
		mirage2: {
			...MOOG_TONES.fatSub,
			level: 0.06,
			index: 0.4,
			cutoffHz: 800,
			drive: 0.5,
			pan: 0.5,
		},
		mantra: seqVoice({
			level: 0.15,
			attackS: 0.01,
			decayS: 0.35,
			cutoffHz: 1400,
			envAmount: 0.6,
			resonance: 0.15,
			pan: 0.15,
			reverb: 0.4,
			echo: 0.3,
		}),
		mantraBass: seqVoice({
			level: 0.26,
			decayS: 0.5,
			sustain: 0.2,
			cutoffHz: 160,
			envAmount: 1.6,
			pan: -0.35,
			echo: 0.1,
		}),
		run: seqVoice({
			level: 0.13,
			decayS: 0.12,
			cutoffHz: 900,
			envAmount: 1.2,
			pan: 0.45,
			echo: 0.15,
		}),
	};
}

/** A step sequence on `part` over bars `[from, to)`, its phase continuous
 *  across bar lines, transposed with the chord unless `fixed`. */
export interface Run {
	readonly part: string;
	readonly steps: readonly Step[];
	readonly step: number;
	readonly from: number;
	readonly to: number;
	readonly register: number;
	readonly len?: number;
	readonly vel?: number;
	readonly fixed?: boolean;
	readonly octave?: boolean;
	readonly ratchetEvery?: number;
}

function run(w: Writer, deg: Deg, chordAt: (bar: number) => number, r: Run) {
	const n = r.steps.length;
	const vel = r.vel ?? 0.7;
	const len = r.step * (r.len ?? 0.8);
	for (let t = r.from * 4, k = 0; t < r.to * 4 - 1e-9; t += r.step, k++) {
		const d = r.steps[k % n];
		if (d === null) continue;
		const root = r.fixed ? 0 : chordAt(Math.floor(t / 4));
		const pitch = deg(r.register, root + d);
		const v = k % n === 0 ? vel : vel * 0.75;
		if (r.ratchetEvery && k % r.ratchetEvery === r.ratchetEvery - 1) {
			w.at(r.part, t, r.step / 2.2, pitch, v);
			w.at(r.part, t + r.step / 2, r.step / 2.2, pitch, v * 0.8);
		} else w.at(r.part, t, len, pitch, v);
		if (r.octave) w.at(r.part, t, len, pitch + 12, v * 0.6);
	}
}

/** The anchor grown from roots: every `every` bars one more step takes its
 *  place in the pattern, the downbeat first held. */
export function anchorGrowth(
	pattern: readonly Step[],
	bars: number,
	every: number,
): Step[][] {
	const order = pattern.map((_, i) => i).filter((i) => i > 0);
	return Array.from({ length: bars }, (_, b) => {
		const shown = Math.floor(b / every);
		return pattern.map((d, i) => (order.indexOf(i) < shown ? d : 0));
	});
}

function choir(
	w: Writer,
	deg: Deg,
	chordAt: (bar: number) => number,
	from: number,
	to: number,
	vel: number,
) {
	for (let b = from; b < to; b += CHORD_BARS)
		for (const k of [0, 2, 4])
			w.at("choir", b * 4, CHORD_BARS * 4 - 1.5, deg(48, chordAt(b) + k), vel);
}

function drone(
	w: Writer,
	deg: Deg,
	chordAt: (bar: number) => number,
	from: number,
	to: number,
	vel: number,
) {
	for (let b = from; b < to; b += CHORD_BARS)
		w.at("drone", b * 4, CHORD_BARS * 4, deg(36, chordAt(b)), vel);
}

const streamOf = (systemSeed: number, variant: number, section: number) =>
	seededRand(mix(mix(systemSeed >>> 0, SCHOOL_TUNE + section), variant + 1));

function calm(
	theme: MusicTheme,
	tune: SchoolTune,
	rand: () => number,
): NoteEvent[] {
	const deg = inMode(theme, MODES[theme.calmMode]);
	const chords = calmChords(rand);
	const S = CALM_SPANS;
	const progression = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const chordAt = (b: number) =>
		b < S.mirage[1] || (b >= S.modal[0] && b < S.modal[1]) ? 0 : progression(b);
	const w = writer(4);
	const bars = SCHOOL_CALM_BARS;
	drone(w, deg, chordAt, 0, bars, 0.55);
	choir(w, deg, chordAt, 4, S.modal[0], 0.35);
	choir(w, deg, chordAt, S.modal[1], bars, 0.35);

	run(w, deg, chordAt, {
		part: "mirage",
		steps: MIRAGE_STEPS,
		step: 2,
		from: S.mirage[0],
		to: S.mirage[1],
		register: 60,
		len: 0.9,
		vel: 0.6,
		octave: true,
	});
	run(w, deg, chordAt, {
		part: "mirage2",
		steps: [4, null, 7, 9, null],
		step: 3,
		from: S.mirage[0] + 2,
		to: S.mirage[1],
		register: 60,
		len: 0.6,
		vel: 0.5,
	});

	run(w, deg, chordAt, {
		part: "breathA",
		steps: pickOf(rand, [
			[0, 4],
			[0, 4, 3],
			[0, 7, 4],
		]),
		step: 1,
		from: S.breathing[0],
		to: S.breathing[1],
		register: 48,
		len: 0.9,
		vel: 0.65,
	});
	run(w, deg, chordAt, {
		part: "breathB",
		steps: [0, 4, 2],
		step: 2,
		from: S.breathing[0] + 4,
		to: S.breathing[1],
		register: 36,
		len: 0.9,
		vel: 0.55,
	});

	run(w, deg, chordAt, {
		part: "canopy",
		steps: tune.canopy,
		step: 0.5,
		from: S.canopy[0],
		to: S.canopy[1],
		register: 72,
		len: 0.7,
		vel: 0.6,
	});
	run(w, deg, chordAt, {
		part: "mantraBass",
		steps: [0],
		step: 1,
		from: S.canopy[0] + 4,
		to: S.canopy[1],
		register: 36,
		len: 0.5,
		vel: 0.55,
	});

	const major = inMode(theme, MODES.ionian);
	const minor = inMode(theme, MODES.aeolian);
	for (let b = S.modal[0]; b < S.modal[1]; b += CHORD_BARS) {
		const third = Math.floor((b - S.modal[0]) / 8) % 2 === 0 ? minor : major;
		for (const k of [0, 2, 4])
			w.at("choir", b * 4, CHORD_BARS * 4 - 1.5, third(48, k), 0.35);
	}
	run(w, minor, () => 0, {
		part: "modal",
		steps: tune.modal,
		step: 0.25,
		from: S.modal[0],
		to: S.modal[1],
		register: 48,
		len: 0.8,
		vel: 0.65,
		fixed: true,
	});

	run(w, deg, chordAt, {
		part: "mantra",
		steps: tune.mantra,
		step: 0.5,
		from: S.mantra[0],
		to: S.mantra[1],
		register: 72,
		len: 0.6,
		vel: 0.6,
		fixed: true,
	});
	run(w, deg, chordAt, {
		part: "mantraBass",
		steps: MANTRA_BASS,
		step: 1,
		from: S.mantra[0] + 2,
		to: S.mantra[1],
		register: 36,
		len: 0.5,
		vel: 0.55,
	});
	run(w, deg, chordAt, {
		part: "run",
		steps: [0, 2, 4, 2],
		step: 0.25,
		from: S.mantra[0] + 8,
		to: S.mantra[1],
		register: 60,
		len: 0.5,
		vel: 0.5,
		fixed: true,
	});
	return w.events;
}

const WARY_CHORDS = [
	[0, 5, 4, 0],
	[0, 5, 3, 4],
	[0, 6, 5, 4],
] as const;

function wary(
	theme: MusicTheme,
	tune: SchoolTune,
	rand: () => number,
): NoteEvent[] {
	const deg = inMode(theme, MODES.aeolian);
	const chords = pickOf(rand, WARY_CHORDS);
	const chordAt = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const w = writer(4);
	const bars = SCHOOL_WARY_BARS;
	drone(w, deg, chordAt, 0, bars, 0.5);
	choir(w, deg, chordAt, 8, bars, 0.3);
	const growth = anchorGrowth(tune.anchor, bars, 3);
	for (let b = 0; b < bars; b++)
		run(w, deg, chordAt, {
			part: "anchor",
			steps: growth[b],
			step: 0.5,
			from: b,
			to: b + 1,
			register: 36,
			len: 0.7,
			vel: 0.75,
		});
	run(w, deg, chordAt, {
		part: "curL",
		steps: CURRENT_THREE,
		step: 0.25,
		from: 8,
		to: bars,
		register: 60,
		len: 0.6,
		vel: 0.5,
	});
	run(w, deg, chordAt, {
		part: "curR",
		steps: [7, null, 9, 4, null, 6, null],
		step: 0.25,
		from: 16,
		to: bars,
		register: 72,
		len: 0.6,
		vel: 0.45,
	});
	for (let b = 16; b < bars; b++)
		for (let q = 0; q < 4; q += 2) w.at("kick", b * 4 + q, 0.5, 36, 0.45);
	return w.events;
}

function threat(
	theme: MusicTheme,
	tune: SchoolTune,
	rand: () => number,
): NoteEvent[] {
	const deg = inMode(theme, MODES.harmonicMinor);
	const chords = pickOf(rand, WARY_CHORDS);
	const chordAt = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const w = writer(4);
	const bars = SCHOOL_THREAT_BARS;
	drone(w, deg, chordAt, 0, bars, 0.45);
	run(w, deg, chordAt, {
		part: "gallop",
		steps: [0, 0, 7, 0],
		step: 0.5,
		from: 0,
		to: 8,
		register: 48,
		len: 0.5,
		vel: 0.75,
	});
	run(w, deg, chordAt, {
		part: "gallop",
		steps: [0, 0, 7, 0, 11, 9],
		step: 0.5,
		from: 8,
		to: bars,
		register: 48,
		len: 0.5,
		vel: 0.75,
	});
	run(w, deg, chordAt, {
		part: "anchor",
		steps: tune.anchor,
		step: 0.25,
		from: 4,
		to: bars,
		register: 36,
		len: 0.6,
		vel: 0.65,
		ratchetEvery: 4,
	});
	for (let b = 0; b < bars; b++)
		for (let q = 0; q < 4; q++) {
			w.at("kick", b * 4 + q, 0.5, 36, 0.6);
			if (b >= 8) w.at("hat", b * 4 + q + 0.5, 0.25, 96, 0.5);
		}
	return w.events;
}

/** A system's flight bed, fourth form: calm, wary and threat from the eight
 *  types, combat the Berlin bed's. */
export function schoolFlightBed(systemSeed: number, variant: number): Song {
	const theme = musicTheme(systemSeed);
	const tune = schoolTune(systemSeed);
	const bpm = schoolBpm(theme);
	const berlin = berlinFlightBed(systemSeed, variant);
	const combat = berlin.sections.find((s) => s.name === "combat");
	if (!combat) throw new Error("the Berlin bed has no combat");
	const sections = [
		{
			name: "calm",
			bars: SCHOOL_CALM_BARS,
			events: calm(theme, tune, streamOf(systemSeed, variant, STREAM.calm)),
		},
		{
			name: "wary",
			bars: SCHOOL_WARY_BARS,
			events: wary(theme, tune, streamOf(systemSeed, variant, STREAM.wary)),
		},
		{
			name: "threat",
			bars: SCHOOL_THREAT_BARS,
			events: threat(theme, tune, streamOf(systemSeed, variant, STREAM.threat)),
		},
		combat,
	];
	const berlinCombatBpm = berlin.tempo[berlin.sections.indexOf(combat)].bpm;
	let bar = 0;
	const tempo = sections.map((s, i) => {
		const level = FLIGHT_LEVELS[i];
		const point = {
			bar,
			bpm:
				level === "combat"
					? berlinCombatBpm
					: Math.round(bpm * SCHOOL_LEVEL_TEMPO[level]),
		};
		bar += s.bars;
		return point;
	});
	return {
		name: `school ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: { ...berlin.parts, ...schoolParts(bpm) },
		sections,
		tempo,
		space: SCHOOL_SPACE,
	};
}

/** Which type a station's role plays: the market's mantra, the yard's
 *  cross-current, the refinery's breathing, the outpost's mirage. */
export type StationKind = "mantra" | "cross-current" | "breathing" | "mirage";
export const STATION_TYPE: Readonly<Record<StationType, StationKind>> = {
	trade: "mantra",
	shipyard: "cross-current",
	refinery: "breathing",
	outpost: "mirage",
};

export function schoolStationBed(
	systemSeed: number,
	role: StationType,
	variant: number,
): Song {
	const theme = musicTheme(systemSeed);
	const tune = schoolTune(systemSeed);
	const rand = seededRand(
		mix(
			mix(systemSeed >>> 0, SCHOOL_TUNE + STREAM.station),
			STATION_ROLES.indexOf(role) * 97 + variant,
		),
	);
	const bpm = Math.round(schoolBpm(theme) * 0.85);
	const deg = inMode(theme, MODES[theme.calmMode]);
	const p = calmChords(rand);
	const chords = [p[0], p[1], p[2], 4];
	const chordAt = (b: number) =>
		chords[Math.floor(b / (2 * CHORD_BARS)) % chords.length];
	const w = writer(4);
	const bars = SCHOOL_STATION_BARS;
	drone(w, deg, chordAt, 0, bars, 0.5);
	choir(w, deg, chordAt, 0, bars, 0.3);
	const kind = STATION_TYPE[role];
	switch (kind) {
		case "mantra":
			run(w, deg, chordAt, {
				part: "mantra",
				steps: tune.mantra,
				step: 0.5,
				from: 2,
				to: bars,
				register: 72,
				vel: 0.55,
				fixed: true,
			});
			run(w, deg, chordAt, {
				part: "mantraBass",
				steps: MANTRA_BASS,
				step: 1,
				from: 4,
				to: bars,
				register: 36,
				len: 0.5,
				vel: 0.5,
			});
			break;
		case "cross-current":
			run(w, deg, chordAt, {
				part: "anchor",
				steps: tune.anchor,
				step: 0.5,
				from: 2,
				to: bars,
				register: 36,
				len: 0.7,
				vel: 0.6,
			});
			run(w, deg, chordAt, {
				part: "curL",
				steps: CURRENT_THREE,
				step: 0.25,
				from: 6,
				to: bars,
				register: 60,
				len: 0.6,
				vel: 0.45,
			});
			break;
		case "breathing":
			run(w, deg, chordAt, {
				part: "breathA",
				steps: [0, 4, 3],
				step: 1,
				from: 2,
				to: bars,
				register: 48,
				len: 0.9,
				vel: 0.6,
			});
			break;
		case "mirage":
			run(w, deg, chordAt, {
				part: "mirage",
				steps: MIRAGE_STEPS,
				step: 2,
				from: 2,
				to: bars,
				register: 60,
				len: 0.9,
				vel: 0.55,
				octave: true,
			});
			break;
		default: {
			const never: never = kind;
			throw new Error(`no station type ${never}`);
		}
	}
	const parts = { ...PARTS, ...schoolParts(bpm) };
	const used = new Set(w.events.map((e) => e.part));
	return {
		name: `school station ${role} ${systemSeed >>> 0}/${variant}`,
		beatsPerBar: 4,
		parts: Object.fromEntries(
			Object.entries(parts).filter(([name]) => used.has(name)),
		),
		sections: [{ name: "bed", bars, events: w.events }],
		tempo: [{ bar: 0, bpm }],
		loop: { from: "bed", to: "bed" },
		space: SCHOOL_SPACE,
	};
}
