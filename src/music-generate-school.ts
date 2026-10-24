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
import {
	ANCHORS,
	BREATHS,
	BREATHS_LOW,
	CANOPIES,
	CURRENT_SEVENS,
	CURRENTS,
	DRIVE_LADDER,
	DRIVE_PROGRESSIONS,
	DRIVE_SHAPES,
	type Ear,
	earOf,
	evolution,
	GALLOPS,
	HAT_ACCENTS,
	KICKS,
	MANTRA_BASSES,
	MANTRAS,
	MIRAGE_ECHOES,
	MIRAGES,
	MODALS,
	type Pattern,
	RUNS,
	type Step,
	stepDegree,
	WARY_CHORDS,
} from "./music-school-patterns";
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
 * - **drive** — the principal's ear of the video (2026-10-23): a rooted
 *   sixteenth sequence, C G c eb Bb, under minor chords on phased strings.
 *
 * Calm is one of the forms (`CALM_FORMS`), as long as the director's
 * refresh, so it does not loop before the next variant comes in; each
 * variant draws a new form and new patterns (`music-school-patterns.ts`),
 * every sequence but the mantra changes as it plays, and hats, a slow kick
 * and the noise wash come and go over it. Wary is the anchor growing into
 * the cross-current; threat is the gallop over a kick. Combat is the
 * Berlin bed's own, which is already split and stripped of the cruise stem.
 */
export const SCHOOL_CALM_S = 196;
export const SCHOOL_WARY_BARS = 32;
export const SCHOOL_THREAT_BARS = 24;
export const SCHOOL_STATION_BARS = 32;
export const SCHOOL_BPM_LOW = 96;
export const SCHOOL_LEVEL_TEMPO = {
	calm: 1,
	wary: 1.1,
	threat: 1.15,
} as const;
/** Bars between two versions of an evolving sequence. */
export const EVOLVE_BARS = 8;

/** The dotted-eighth echo every type leans on, louder than the other beds'. */
export const SCHOOL_SPACE: SongSpace = {
	reverbS: 5,
	echoBeats: 0.75,
	echoFeedback: 0.55,
};

const CHORD_BARS = 4;
const SCHOOL_TUNE = 0x7363686f;
const STREAM = { calm: 1, wary: 2, threat: 3, station: 5 } as const;
const LOOK_STREAM = 6;
const HAT_PITCH = 104;
const KICK_PITCH = 33;
const WASH_BARS = 4;
const WIND_S = [23, 31] as const;

type Deg = (base: number, d: number) => number;
type Writer = ReturnType<typeof writer>;

/** What a system and a variant fix: the calm form, and one pattern of each
 *  place a pattern plays. A new variant draws them again, so each refresh
 *  of calm is a new movement in the same key and tempo. */
export interface SchoolTune {
	readonly form: CalmForm;
	readonly drive: readonly number[];
	readonly driveChords: readonly number[];
	readonly anchor: Pattern;
	readonly canopy: Pattern;
	readonly modal: Pattern;
	readonly mantra: Pattern;
	readonly mirage: Pattern;
	readonly mirageEcho: Pattern;
	readonly breath: Pattern;
	readonly breathLow: Pattern;
	readonly mantraBass: Pattern;
	readonly run: Pattern;
	readonly current: Pattern;
	readonly currentSeven: Pattern;
	readonly gallop: readonly [Pattern, Pattern];
	readonly waryChords: readonly number[];
	readonly hats: readonly number[];
	readonly kick: readonly number[];
}

const lookOf = (systemSeed: number, variant: number) => {
	const base = mix(systemSeed >>> 0, SCHOOL_TUNE + LOOK_STREAM);
	return seededRand(variant === 0 ? base : mix(base, variant));
};

/** The calm form of a system's variant: the seed's first, then each
 *  variant a form other than the one before it. */
export function schoolForm(systemSeed: number, variant: number): CalmForm {
	let form = pickOf(lookOf(systemSeed, 0), CALM_FORM_NAMES);
	for (let v = 1; v <= variant; v++)
		form = pickOf(
			lookOf(systemSeed, v),
			CALM_FORM_NAMES.filter((f) => f !== form),
		);
	return form;
}

export function schoolTune(
	systemSeed: number,
	form?: CalmForm,
	variant = 0,
): SchoolTune {
	const base = mix(systemSeed >>> 0, SCHOOL_TUNE);
	const rand = seededRand(variant === 0 ? base : mix(base, variant));
	const look = lookOf(systemSeed, variant);
	look();
	return {
		form: form ?? schoolForm(systemSeed, variant),
		drive: pickOf(look, DRIVE_SHAPES),
		driveChords: pickOf(look, DRIVE_PROGRESSIONS),
		hats: pickOf(look, HAT_ACCENTS),
		kick: pickOf(look, KICKS),
		anchor: pickOf(rand, ANCHORS),
		canopy: pickOf(rand, CANOPIES),
		modal: pickOf(rand, MODALS),
		mantra: pickOf(rand, MANTRAS),
		mirage: pickOf(rand, MIRAGES),
		mirageEcho: pickOf(rand, MIRAGE_ECHOES),
		breath: pickOf(rand, BREATHS),
		breathLow: pickOf(rand, BREATHS_LOW),
		mantraBass: pickOf(rand, MANTRA_BASSES),
		run: pickOf(rand, RUNS),
		current: pickOf(rand, CURRENTS),
		currentSeven: pickOf(rand, CURRENT_SEVENS),
		gallop: pickOf(rand, GALLOPS),
		waryChords: pickOf(rand, WARY_CHORDS),
	};
}

/** Calm's bars at `bpm`: at least `SCHOOL_CALM_S`, in eights. */
export const schoolCalmBars = (bpm: number) =>
	8 * Math.ceil((SCHOOL_CALM_S * bpm) / 240 / 8);

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

const washOf = (
	level: number,
	sweepS: number,
	sweepOct: number,
	pan: number,
): PartSpec => ({
	voice: "noise",
	level,
	attackS: 1.5,
	sustain: 1,
	releaseS: 1.5,
	resonance: 0.85,
	sweepS,
	sweepOct,
	pan,
	reverb: 0.7,
});

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
		phased: {
			voice: "analog",
			level: 0.17,
			unison: 4,
			detune: 0.12,
			drift: 4,
			spread: 1,
			attackS: 1.2,
			sustain: 0.9,
			releaseS: 1.4,
			cutoffHz: 1500,
			envAmount: 0.4,
			envDecayS: 4,
			vibrato: 0.04,
			phaser: 0.9,
			phaserS: barsS(4, bpm),
			reverb: 0.6,
			echo: 0.15,
		},
		drive: {
			...MOOG_TONES.filterPluck,
			level: 0.26,
			decayS: 0.22,
			sustain: 0.1,
			releaseS: 0.06,
			sweepS: barsS(16, bpm),
			sweepOct: 2.4,
			pan: -0.08,
			reverb: 0.2,
			echo: 0.6,
		},
		drive2: seqVoice({
			level: 0.11,
			detune: 0.08,
			spread: 0.7,
			cutoffHz: 420,
			envAmount: 1.6,
			resonance: 0.4,
			sweepS: barsS(11, bpm),
			sweepOct: 1.8,
			pan: 0.4,
			reverb: 0.4,
			echo: 0.5,
		}),
		run: seqVoice({
			level: 0.13,
			decayS: 0.12,
			cutoffHz: 900,
			envAmount: 1.2,
			pan: 0.45,
			echo: 0.15,
		}),
		tick: {
			voice: "noise",
			level: 0.07,
			attackS: 0.002,
			decayS: 0.05,
			sustain: 0,
			releaseS: 0.04,
			resonance: 0.4,
			pan: 0.3,
			reverb: 0.15,
			echo: 0.3,
		},
		thud: { voice: "kick", level: 0.42, reverb: 0.1, echo: 0.1 },
		washL: washOf(0.045, WIND_S[0], 3.2, -0.6),
		washR: washOf(0.04, WIND_S[1], 2.8, 0.6),
		rise: {
			voice: "noise",
			level: 0.07,
			attackS: 0.12,
			sustain: 1,
			releaseS: 0.35,
			resonance: 0.7,
			reverb: 0.6,
			echo: 0.3,
		},
	};
}

/** How a sequence changes as it plays: a new version every `every` bars,
 *  each drawn from `rand` (`evolution`). */
export interface Evolve {
	readonly rand: () => number;
	readonly every: number;
	readonly ear?: Ear;
}

/** A step sequence on `part` over bars `[from, to)`, its phase continuous
 *  across bar lines, transposed with the chord unless `fixed`; with
 *  `semitones` its steps are semitones over the chord root, not degrees. */
export interface Run {
	readonly part: string;
	readonly steps: readonly Step[];
	readonly pent?: boolean;
	readonly step: number;
	readonly from: number;
	readonly to: number;
	readonly register: number;
	readonly len?: number;
	readonly vel?: number;
	readonly fixed?: boolean;
	readonly octave?: boolean;
	readonly ratchetEvery?: number;
	readonly evolve?: Evolve;
	readonly semitones?: boolean;
	readonly offset?: number;
	readonly soft?: number;
}

function run(w: Writer, deg: Deg, chordAt: (bar: number) => number, r: Run) {
	const n = r.steps.length;
	const vel = r.vel ?? 0.7;
	const len = r.step * (r.len ?? 0.8);
	const every = r.evolve?.every ?? Number.POSITIVE_INFINITY;
	const versions = r.evolve
		? evolution(
				r.steps,
				r.evolve.rand,
				r.evolve.ear ?? earOf(r),
				Math.ceil((r.to - r.from) / every) + 1,
			)
		: [r.steps];
	const soft = r.soft ?? 0.75;
	for (
		let t = r.from * 4 + (r.offset ?? 0), k = 0;
		t < r.to * 4 - 1e-9;
		t += r.step, k++
	) {
		const bar = Math.floor(t / 4);
		const v = Math.min(versions.length - 1, Math.floor((bar - r.from) / every));
		const d = versions[v][k % n];
		if (d === null) continue;
		const root = r.fixed ? 0 : chordAt(bar);
		const pitch = r.semitones
			? deg(r.register, root) + d
			: deg(r.register, stepDegree(deg, r.pent, root, d));
		const loud = k % n === 0 ? vel : vel * soft;
		if (r.ratchetEvery && k % r.ratchetEvery === r.ratchetEvery - 1) {
			w.at(r.part, t, r.step / 2.2, pitch, loud);
			w.at(r.part, t + r.step / 2, r.step / 2.2, pitch, loud * 0.8);
		} else w.at(r.part, t, len, pitch, loud);
		if (r.octave) w.at(r.part, t, len, pitch + 12, loud * 0.6);
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
			w.at(
				"choir",
				b * 4,
				Math.min(CHORD_BARS, to - b) * 4 - 1.5,
				deg(48, chordAt(b) + k),
				vel,
			);
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
		w.at(
			"drone",
			b * 4,
			Math.min(CHORD_BARS, to - b) * 4,
			deg(36, chordAt(b)),
			vel,
		);
}

function hats(
	w: Writer,
	accents: readonly number[],
	from: number,
	to: number,
	vel: number,
) {
	const n = accents.length;
	for (let t = from * 4, k = 0; t < to * 4 - 1e-9; t += 0.25, k++) {
		const turn = Math.floor((Math.floor(t / 4) - from) / EVOLVE_BARS);
		const a = accents[(k + turn) % n];
		if (a <= 0) continue;
		const fade = Math.min(1, (t - from * 4) / 16, (to * 4 - t) / 16);
		w.at(
			"tick",
			t,
			a >= 1 ? 0.2 : 0.08,
			HAT_PITCH + (a >= 1 ? -6 : 0),
			vel * a * fade,
		);
	}
}

function kicks(
	w: Writer,
	pattern: readonly number[],
	from: number,
	to: number,
	vel: number,
) {
	const n = pattern.length;
	for (let t = from * 4, k = 0; t < to * 4 - 1e-9; t += 0.25, k++) {
		const a = pattern[k % n];
		if (a > 0) w.at("thud", t, 0.5, KICK_PITCH, vel * a);
	}
}

function wash(w: Writer, from: number, to: number, base: number, vel: number) {
	for (let b = from; b < to; b += WASH_BARS) {
		const len = Math.min(WASH_BARS, to - b) * 4;
		w.at("washL", b * 4, len, base, vel);
		if (len > 2) w.at("washR", b * 4 + 2, len - 2, base + 7, vel * 0.9);
	}
}

function riser(w: Writer, at: number, bars: number, base: number) {
	const steps = bars * 8;
	const from = at - bars;
	for (let k = 0; k < steps; k++)
		w.at(
			"rise",
			from * 4 + k / 2,
			0.75,
			base + (18 * k) / steps,
			0.2 + (0.4 * k) / steps,
		);
}

const streamOf = (systemSeed: number, variant: number, section: number) =>
	seededRand(mix(mix(systemSeed >>> 0, SCHOOL_TUNE + section), variant + 1));

type CalmType =
	| "mirage"
	| "breathing"
	| "canopy"
	| "modal"
	| "mantra"
	| "drive";
type Span = readonly [CalmType, number, number];

const PEDAL: ReadonlySet<CalmType> = new Set(["mirage", "modal", "mantra"]);
const OWN_HARMONY: ReadonlySet<CalmType> = new Set(["modal", "drive"]);
const MINOR_TRIAD = [0, 3, 7] as const;
const DRIVE_CHORD_BARS = 8;
const MODAL_EAR: Ear = { octave: 7, ladder: [0, 3, 4, 7, 10, 11] };
const DRIVE_EAR: Ear = { octave: 12, ladder: DRIVE_LADDER };

interface Calm {
	readonly w: Writer;
	readonly deg: Deg;
	readonly chordAt: (bar: number) => number;
	readonly tune: SchoolTune;
	readonly theme: MusicTheme;
	readonly evolve: (every?: number, ear?: Ear) => Evolve;
}

const CALM_WRITERS: Readonly<
	Record<CalmType, (c: Calm, from: number, to: number) => void>
> = {
	mirage: ({ w, deg, chordAt, tune, evolve }, from, to) => {
		run(w, deg, chordAt, {
			part: "mirage",
			...tune.mirage,
			step: 2,
			from,
			to,
			register: 60,
			len: 0.9,
			vel: 0.6,
			octave: true,
			evolve: evolve(),
		});
		run(w, deg, chordAt, {
			part: "mirage2",
			...tune.mirageEcho,
			step: 3,
			from: from + 2,
			to,
			register: 60,
			len: 0.6,
			vel: 0.5,
			evolve: evolve(),
		});
	},
	breathing: ({ w, deg, chordAt, tune, evolve }, from, to) => {
		run(w, deg, chordAt, {
			part: "breathA",
			...tune.breath,
			step: 1,
			from,
			to,
			register: 48,
			len: 0.9,
			vel: 0.65,
			evolve: evolve(),
		});
		run(w, deg, chordAt, {
			part: "breathB",
			...tune.breathLow,
			step: 2,
			from: from + 4,
			to,
			register: 36,
			len: 0.9,
			vel: 0.55,
			evolve: evolve(16),
		});
	},
	canopy: ({ w, deg, chordAt, tune, evolve }, from, to) => {
		run(w, deg, chordAt, {
			part: "canopy",
			...tune.canopy,
			step: 0.5,
			from,
			to,
			register: 72,
			len: 0.7,
			vel: 0.6,
			evolve: evolve(),
		});
		run(w, deg, chordAt, {
			part: "mantraBass",
			steps: [0],
			step: 1,
			from: from + 4,
			to,
			register: 36,
			len: 0.5,
			vel: 0.55,
		});
	},
	modal: ({ w, theme, tune, evolve }, from, to) => {
		const major = inMode(theme, MODES.ionian);
		const minor = inMode(theme, MODES.aeolian);
		for (let b = from; b < to; b += CHORD_BARS) {
			const third = Math.floor((b - from) / 8) % 2 === 0 ? minor : major;
			const len = Math.min(CHORD_BARS, to - b) * 4 - 1.5;
			for (const k of [0, 2, 4]) w.at("choir", b * 4, len, third(48, k), 0.35);
		}
		run(w, minor, () => 0, {
			part: "modal",
			steps: tune.modal.steps,
			step: 0.25,
			from,
			to,
			register: 48,
			len: 0.8,
			vel: 0.65,
			fixed: true,
			evolve: evolve(EVOLVE_BARS, MODAL_EAR),
		});
	},
	mantra: ({ w, deg, chordAt, tune, evolve }, from, to) => {
		run(w, deg, chordAt, {
			part: "mantra",
			...tune.mantra,
			step: 0.5,
			from,
			to,
			register: 72,
			len: 0.6,
			vel: 0.6,
			fixed: true,
		});
		run(w, deg, chordAt, {
			part: "mantraBass",
			...tune.mantraBass,
			step: 1,
			from: from + 2,
			to,
			register: 36,
			len: 0.5,
			vel: 0.55,
			evolve: evolve(16),
		});
		run(w, deg, chordAt, {
			part: "run",
			...tune.run,
			step: 0.25,
			from: from + 8,
			to,
			register: 60,
			len: 0.5,
			vel: 0.5,
			fixed: true,
			evolve: evolve(),
		});
	},
	drive: ({ w, deg, chordAt, tune, evolve }, from, to) => {
		for (let b = from; b < to; b += CHORD_BARS) {
			const root = deg(48, chordAt(b));
			const len = Math.min(CHORD_BARS, to - b) * 4 - 0.5;
			for (const k of MINOR_TRIAD) w.at("phased", b * 4, len, root + k, 0.42);
			w.at("phased", b * 4, len, root + 12, 0.3);
		}
		const line = (
			part: string,
			step: number,
			register: number,
			start: number,
			vel: number,
			offset: number,
		) =>
			run(w, deg, chordAt, {
				part,
				steps: tune.drive,
				semitones: true,
				step,
				from: start,
				to,
				register,
				vel,
				soft: 0.68,
				offset,
				evolve: evolve(EVOLVE_BARS, DRIVE_EAR),
			});
		line("drive", 0.25, 36, from + 2, 0.85, 0);
		if (to - from >= 16) line("drive2", 0.5, 48, from + 12, 0.55, 0.25);
	},
};

/** Each calm form: which types play, in order, over which of 64 parts of
 *  calm (`calmSpans` scales them to its bars). A variant plays one, so two
 *  systems, and two refreshes of one, differ in what calm is made of. */
export const CALM_FORMS = {
	voyage: [
		["mirage", 0, 12],
		["breathing", 8, 26],
		["canopy", 24, 40],
		["modal", 38, 50],
		["mantra", 48, 64],
	],
	drive: [
		["drive", 0, 38],
		["mirage", 36, 50],
		["drive", 48, 64],
	],
	tide: [
		["breathing", 0, 24],
		["drive", 20, 48],
		["mantra", 44, 64],
	],
	lantern: [
		["mirage", 0, 16],
		["modal", 14, 30],
		["canopy", 28, 46],
		["breathing", 44, 64],
	],
	ascent: [
		["canopy", 0, 20],
		["mantra", 16, 40],
		["drive", 36, 64],
	],
	cathedral: [
		["modal", 0, 20],
		["breathing", 18, 40],
		["mirage", 38, 52],
		["mantra", 50, 64],
	],
	pulse: [
		["drive", 0, 28],
		["canopy", 24, 44],
		["drive", 40, 64],
	],
	nocturne: [
		["mirage", 0, 14],
		["mantra", 12, 30],
		["breathing", 28, 48],
		["drive", 44, 64],
	],
} as const satisfies Record<string, readonly Span[]>;
export type CalmForm = keyof typeof CALM_FORMS;
export const CALM_FORM_NAMES = Object.keys(CALM_FORMS) as CalmForm[];

/** A form's spans in bars of a calm `bars` long. */
export const calmSpans = (form: CalmForm, bars: number): readonly Span[] =>
	CALM_FORMS[form].map(
		([t, from, to]) =>
			[
				t,
				Math.round((from * bars) / 64),
				Math.round((to * bars) / 64),
			] as const,
	);

/** Where calm's rhythm and noise play: windows drawn per variant, so hats,
 *  the kick and the wash come and go at other bars each time. */
export interface CalmTexture {
	readonly hats: readonly (readonly [number, number])[];
	readonly kick: readonly (readonly [number, number])[];
	readonly wash: readonly (readonly [number, number])[];
	readonly risers: readonly number[];
}

export function calmTexture(rand: () => number, bars: number): CalmTexture {
	const at = (lo: number, hi: number) =>
		4 * Math.round((bars * (lo + rand() * (hi - lo))) / 4);
	const hats: [number, number][] = [];
	const kick: [number, number][] = [];
	const first = at(0.15, 0.4);
	const firstEnd = Math.min(bars, first + at(0.2, 0.35));
	hats.push([first, firstEnd]);
	if (rand() < 0.7 && firstEnd - first >= 16)
		kick.push([first + 8, firstEnd - 4]);
	if (rand() < 0.6) {
		const second = Math.min(bars - 8, firstEnd + at(0.1, 0.2));
		if (second < bars - 8) {
			hats.push([second, bars]);
			if (rand() < 0.5) kick.push([second + 4, bars]);
		}
	}
	const wash: [number, number][] = [];
	if (rand() < 0.6) wash.push([0, at(0.15, 0.3)]);
	const late = at(0.5, 0.75);
	if (rand() < 0.7) wash.push([late, Math.min(bars, late + at(0.12, 0.25))]);
	const risers = hats
		.map(([from]) => from)
		.filter((b) => b >= 4 && rand() < 0.6);
	return { hats, kick, wash, risers };
}

function calm(
	theme: MusicTheme,
	tune: SchoolTune,
	rand: () => number,
	bars: number,
): NoteEvent[] {
	const spans = calmSpans(tune.form, bars);
	const hasDrive = spans.some(([t]) => t === "drive");
	const mode = hasDrive
		? theme.calmMode === "dorian"
			? "dorian"
			: "aeolian"
		: theme.calmMode;
	const deg = inMode(theme, MODES[mode]);
	const chords = calmChords(rand);
	const active = (b: number) =>
		spans.filter(([, from, to]) => b >= from && b < to).map(([t]) => t);
	const chordAt = (b: number) => {
		const now = active(b);
		if (now.some((t) => PEDAL.has(t))) return 0;
		if (now.includes("drive"))
			return tune.driveChords[
				Math.floor(b / DRIVE_CHORD_BARS) % tune.driveChords.length
			];
		return chords[Math.floor(b / CHORD_BARS) % chords.length];
	};
	const w = writer(4);
	drone(w, deg, chordAt, 0, bars, 0.55);
	for (let b = 4; b < bars; b += CHORD_BARS)
		if (!active(b).some((t) => OWN_HARMONY.has(t)))
			choir(w, deg, chordAt, b, Math.min(bars, b + CHORD_BARS), 0.35);
	const evolve = (every = EVOLVE_BARS, ear?: Ear): Evolve => ({
		rand,
		every,
		ear,
	});
	const c: Calm = { w, deg, chordAt, tune, theme, evolve };
	for (const [type, from, to] of spans) CALM_WRITERS[type](c, from, to);
	const texture = calmTexture(rand, bars);
	for (const [from, to] of texture.hats) hats(w, tune.hats, from, to, 0.32);
	for (const [from, to] of texture.kick) kicks(w, tune.kick, from, to, 0.5);
	for (const [from, to] of texture.wash) wash(w, from, to, 76, 0.7);
	for (const b of texture.risers) riser(w, b, 2, 70);
	return w.events;
}

function wary(
	theme: MusicTheme,
	tune: SchoolTune,
	rand: () => number,
): NoteEvent[] {
	const deg = inMode(theme, MODES.aeolian);
	const chords = tune.waryChords;
	const chordAt = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const w = writer(4);
	const bars = SCHOOL_WARY_BARS;
	drone(w, deg, chordAt, 0, bars, 0.5);
	choir(w, deg, chordAt, 8, bars, 0.3);
	const growth = anchorGrowth(tune.anchor.steps, bars, 3);
	for (let b = 0; b < bars; b++)
		run(w, deg, chordAt, {
			part: "anchor",
			steps: growth[b],
			pent: tune.anchor.pent,
			step: 0.5,
			from: b,
			to: b + 1,
			register: 36,
			len: 0.7,
			vel: 0.75,
		});
	run(w, deg, chordAt, {
		part: "curL",
		...tune.current,
		step: 0.25,
		from: 8,
		to: bars,
		register: 60,
		len: 0.6,
		vel: 0.5,
		evolve: { rand, every: EVOLVE_BARS },
	});
	run(w, deg, chordAt, {
		part: "curR",
		...tune.currentSeven,
		step: 0.25,
		from: 16,
		to: bars,
		register: 72,
		len: 0.6,
		vel: 0.45,
		evolve: { rand, every: EVOLVE_BARS },
	});
	hats(w, tune.hats, 8, bars, 0.28);
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
	const chords = tune.waryChords;
	const chordAt = (b: number) =>
		chords[Math.floor(b / CHORD_BARS) % chords.length];
	const w = writer(4);
	const bars = SCHOOL_THREAT_BARS;
	const [gallopIn, gallopOn] = tune.gallop;
	drone(w, deg, chordAt, 0, bars, 0.45);
	run(w, deg, chordAt, {
		part: "gallop",
		...gallopIn,
		step: 0.5,
		from: 0,
		to: 8,
		register: 48,
		len: 0.5,
		vel: 0.75,
	});
	run(w, deg, chordAt, {
		part: "gallop",
		...gallopOn,
		step: 0.5,
		from: 8,
		to: bars,
		register: 48,
		len: 0.5,
		vel: 0.75,
		evolve: { rand, every: EVOLVE_BARS },
	});
	run(w, deg, chordAt, {
		part: "anchor",
		...tune.anchor,
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
 *  types, combat the Berlin bed's. Each variant is a new movement: its own
 *  form, patterns and texture. */
export function schoolFlightBed(
	systemSeed: number,
	variant: number,
	form?: CalmForm,
): Song {
	const theme = musicTheme(systemSeed);
	const tune = schoolTune(systemSeed, form, variant);
	const bpm = schoolBpm(theme);
	const calmBars = schoolCalmBars(bpm);
	const berlin = berlinFlightBed(systemSeed, variant);
	const combat = berlin.sections.find((s) => s.name === "combat");
	if (!combat) throw new Error("the Berlin bed has no combat");
	const sections = [
		{
			name: "calm",
			bars: calmBars,
			events: calm(
				theme,
				tune,
				streamOf(systemSeed, variant, STREAM.calm),
				calmBars,
			),
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
	const tune = schoolTune(systemSeed, undefined, variant);
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
	const evolve = { rand, every: EVOLVE_BARS };
	drone(w, deg, chordAt, 0, bars, 0.5);
	choir(w, deg, chordAt, 0, bars, 0.3);
	const kind = STATION_TYPE[role];
	switch (kind) {
		case "mantra":
			run(w, deg, chordAt, {
				part: "mantra",
				...tune.mantra,
				step: 0.5,
				from: 2,
				to: bars,
				register: 72,
				vel: 0.55,
				fixed: true,
			});
			run(w, deg, chordAt, {
				part: "mantraBass",
				...tune.mantraBass,
				step: 1,
				from: 4,
				to: bars,
				register: 36,
				len: 0.5,
				vel: 0.5,
				evolve,
			});
			break;
		case "cross-current":
			run(w, deg, chordAt, {
				part: "anchor",
				...tune.anchor,
				step: 0.5,
				from: 2,
				to: bars,
				register: 36,
				len: 0.7,
				vel: 0.6,
				evolve,
			});
			run(w, deg, chordAt, {
				part: "curL",
				...tune.current,
				step: 0.25,
				from: 6,
				to: bars,
				register: 60,
				len: 0.6,
				vel: 0.45,
				evolve,
			});
			break;
		case "breathing":
			run(w, deg, chordAt, {
				part: "breathA",
				...tune.breath,
				step: 1,
				from: 2,
				to: bars,
				register: 48,
				len: 0.9,
				vel: 0.6,
				evolve,
			});
			break;
		case "mirage":
			run(w, deg, chordAt, {
				part: "mirage",
				...tune.mirage,
				step: 2,
				from: 2,
				to: bars,
				register: 60,
				len: 0.9,
				vel: 0.55,
				octave: true,
				evolve,
			});
			break;
		default: {
			const never: never = kind;
			throw new Error(`no station type ${never}`);
		}
	}
	wash(w, 0, bars, 76, 0.5);
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
