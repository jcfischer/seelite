/**
 * The synth's voices (#560, after #543's D1): pad, pluck, FM, and the two
 * percussion voices, noise and tone, all summed by one bank.
 *
 * **Plain classes, with the sample rate passed in.** The worklet reads the
 * global `sampleRate` once, in its constructor, and hands it here (#541
 * measured reading it per sample at 6.3x the cost). So bun renders a voice
 * headless (`tests/music-voices.test.ts`) exactly as the worklet does.
 *
 * **No allocation in `render` or `noteOn`** (#543 D1). The bank holds its
 * voices as one set of typed arrays sized to the cap, and every pluck's delay
 * line is allocated once, in the constructor. A note takes a slot; it never
 * creates one.
 *
 * **Its own noise.** The percussion and the pluck draw from an xorshift
 * stream inside the bank, not from `Math.random()`: the worklet is its own
 * global scope, and a stream here renders the same way on every run, which is
 * what lets a probe band a render (#541). Whether *generative* variation in a
 * score draws a seeded stream is #548's to decide; this is noise inside a
 * voice.
 */

import { pickLayer, pickZone } from "./music-sample-pick";
import type { PartSpec, SampleBank, VoiceKind } from "./music-score";
import { stringsDefaults } from "./strings-params";

// Each voice's number in the bank's `kind` array, which is a `Uint8Array`
// rather than strings so a render reads no object. Named, so the two
// switches below cannot drift from this table (sage round 1).
const PAD = 0;
const PLUCK = 1;
const FM = 2;
const NOISE = 3;
const TONE = 4;
const ANALOG = 5;
const DRONE = 6;
const ACID = 7;
const KEYS = 8;
const KICK = 9;
const STRINGS = 10;
const BRASS = 11;
const FLUTE = 12;
const PULSE = 13;
const EPIANO = 14;
const HARPSI = 15;
const SOFTSAW = 16;
const SAMPLER = 17;
const MOOG = 18;
const KIND: Record<VoiceKind, number> = {
	pad: PAD,
	pluck: PLUCK,
	fm: FM,
	noise: NOISE,
	tone: TONE,
	analog: ANALOG,
	drone: DRONE,
	acid: ACID,
	keys: KEYS,
	kick: KICK,
	strings: STRINGS,
	brass: BRASS,
	flute: FLUTE,
	pulse: PULSE,
	epiano: EPIANO,
	harpsi: HARPSI,
	softsaw: SOFTSAW,
	sampler: SAMPLER,
	moog: MOOG,
};
/** The voices that are two signals, one a side; every other is one, panned.
 *  Indexed by kind, and filled by name (sage round 8), so a kind added or
 *  renumbered above cannot take another's row. */
const STEREO = new Uint8Array(Object.keys(KIND).length);
// The sampler is two signals whether its set is or not: a mono recording
// reads the same frame to both sides.
for (const k of [PAD, ANALOG, DRONE, KEYS, STRINGS, SOFTSAW, SAMPLER])
	STEREO[k] = 1;
/** The voices that can play legato, and carry their own weight to do it. */
const LEGATO = new Uint8Array(Object.keys(KIND).length);
for (const k of [STRINGS, BRASS, FLUTE]) LEGATO[k] = 1;

/** Every field a voice reads, with its defaults filled in and every time
 *  already in frames or a per-frame coefficient. */
export interface ResolvedPart {
	readonly kind: number;
	readonly level: number;
	readonly attackFrames: number;
	/** Per frame, toward `sustain`: 60 dB of fall in `decayS`. */
	readonly decayCoef: number;
	readonly sustain: number;
	/** Per frame, toward silence: 60 dB of fall in `releaseS`. */
	readonly releaseCoef: number;
	readonly ratio: number;
	readonly index: number;
	readonly feedback: number;
	readonly cutoffHz: number;
	/** Equal-power gains, scaled so the centre is 1 on each side. */
	readonly panL: number;
	readonly panR: number;
	readonly reverb: number;
	readonly echo: number;
	/** FM: the index's own fall per frame; 1 keeps it on the envelope. */
	readonly indexDecayCoef: number;
	readonly unison: number;
	readonly detune: number;
	/** Frames between drift draws; 0 for none. */
	readonly driftFrames: number;
	readonly spread: number;
	readonly envAmount: number;
	readonly envDecayCoef: number;
	/** The state-variable filter's damping, from the resonance. */
	readonly damp: number;
	readonly ladderK: number;
	readonly drive: number;
	/** Strings: the drive's gain into its `tanh` and the `1 / tanh` that
	 *  keeps its level — constants of the part, so not worked per sample. */
	readonly driveK: number;
	readonly driveNorm: number;
	/** Per frame, toward a slide's target; 1 for no glide. */
	readonly glideCoef: number;
	readonly vibrato: number;
	/** The sweep: cycles per frame (0 for none), and its depth in octaves. */
	readonly sweepInc: number;
	readonly sweepOct: number;
	readonly phaser: number;
	readonly phaserInc: number;
	readonly attackS: number;
	readonly decayS: number;
	readonly vibratoHz: number;
	readonly vibratoOnsetS: number;
	readonly vibratoRiseS: number;
	readonly bowS: number;
	readonly swell: number;
	readonly keyTrack: number;
	readonly rosin: number;
	readonly rosinLow: number;
	/** Pulse: the duty cycle, its sweep per frame (cycles) and depth. */
	readonly width: number;
	readonly pwmInc: number;
	readonly pwmDepth: number;
	/** Sampler: its set's name, and the synth part it plays while the set is
	 *  absent; `null` plays nothing then. */
	readonly samples: string;
	readonly fallback: ResolvedPart | null;
}

/**
 * Each voice's defaults. Placeholders in the sense every sound figure in this
 * repo is one: the test score is heard with them, and #547 and #548 set what
 * their own parts need.
 */
type VoiceDefaults = Required<
	Omit<PartSpec, "voice" | "level" | "samples" | "fallback">
>;

/** What no voice before #548's references had: off, or neutral, unless a
 *  voice below names it. */
const BASE: VoiceDefaults = {
	attackS: 0.01,
	decayS: 1,
	sustain: 1,
	releaseS: 0.3,
	ratio: 1,
	index: 0,
	feedback: 0,
	cutoffHz: 0,
	pan: 0,
	reverb: 0,
	echo: 0,
	indexDecayS: 0,
	unison: 1,
	detune: 0,
	drift: 0,
	spread: 0,
	envAmount: 0,
	envDecayS: 1,
	resonance: 0,
	drive: 0,
	glideS: 0,
	vibrato: 0,
	vibratoHz: 5,
	vibratoOnsetS: 0.3,
	vibratoRiseS: 0.5,
	bowS: 0.045,
	swell: 0.4,
	keyTrack: 0,
	rosin: 0,
	rosinLow: 1,
	sweepS: 0,
	sweepOct: 0,
	phaser: 0,
	phaserS: 9,
	width: 0.5,
	pwmHz: 0,
	pwmDepth: 0,
};

/** The strings' defaults are its parameter table's (#547 D15), but for the
 *  level, which every part names for itself. */
const { level: _stringsLevel, ...STRINGS_TABLE } = stringsDefaults();

const DEFAULTS: Record<VoiceKind, VoiceDefaults> = {
	pad: {
		...BASE,
		attackS: 0.35,
		decayS: 2,
		sustain: 0.75,
		releaseS: 1.2,
		cutoffHz: 1400,
	},
	pluck: {
		...BASE,
		attackS: 0.002,
		decayS: 2.5,
		sustain: 0,
		releaseS: 0.25,
		cutoffHz: 4000,
	},
	fm: {
		...BASE,
		attackS: 0.004,
		decayS: 1.6,
		sustain: 0.2,
		releaseS: 0.6,
		ratio: 2,
		index: 2.5,
		feedback: 0.3,
	},
	noise: {
		...BASE,
		attackS: 0.001,
		decayS: 0.12,
		sustain: 0,
		releaseS: 0.08,
		// The band's damping before it had a dial: 2 - 1.9 × 11/19 = 0.9.
		resonance: 11 / 19,
	},
	tone: {
		...BASE,
		attackS: 0.001,
		decayS: 0.35,
		sustain: 0,
		releaseS: 0.08,
		ratio: 2.5,
	},
	// After Oxygène's and Blade Runner's strings: three drifting saws across
	// the field, a filter that opens with the note and settles.
	analog: {
		...BASE,
		attackS: 0.01,
		decayS: 1.5,
		sustain: 0.7,
		releaseS: 0.6,
		cutoffHz: 1800,
		unison: 3,
		detune: 0.12,
		drift: 6,
		spread: 0.8,
		envAmount: 1.5,
		envDecayS: 1.2,
		resonance: 0.15,
	},
	// After "Cosmic Drone": eight oscillators over tables that morph.
	drone: {
		...BASE,
		attackS: 3,
		decayS: 1,
		sustain: 1,
		releaseS: 3.5,
		unison: 8,
		detune: 0.1,
		drift: 11,
		spread: 1,
	},
	// After DT303: a saw into two resonant stages, a snapping envelope.
	acid: {
		...BASE,
		attackS: 0.003,
		decayS: 0.25,
		sustain: 0.5,
		releaseS: 0.04,
		cutoffHz: 500,
		envAmount: 3.5,
		envDecayS: 0.3,
		resonance: 0.7,
		drive: 0.35,
		glideS: 0.06,
	},
	// After "Opening": damped partials, the highs dying first.
	keys: {
		...BASE,
		attackS: 0.002,
		decayS: 3,
		sustain: 1,
		releaseS: 0.4,
		ratio: 1.003,
		index: 1,
	},
	// After "Fat kick": a falling body under a slap and a click.
	kick: {
		...BASE,
		attackS: 0.001,
		decayS: 0.6,
		sustain: 0,
		releaseS: 0.05,
	},
	// A bowed section (#547 D8): five detuned saws a note across the field, a
	// bow's slow attack with its noise, a vibrato that arrives late, and a
	// lowpass that opens with the bow's weight. Held for the note's length.
	strings: { ...BASE, ...STRINGS_TABLE },
	// A soft horn (#547 D8): a saw and a pulse on one phase, through two lowpass
	// stages whose cutoff swells as the note speaks, the pitch rising into it
	// from a little below. Warm and dark at p; it brightens only when pushed.
	brass: {
		...BASE,
		attackS: 0.12,
		decayS: 1.5,
		sustain: 0.85,
		releaseS: 0.25,
		cutoffHz: 600,
		resonance: 0.2,
		unison: 1,
		detune: 0.03,
		drift: 3,
		spread: 0,
		envAmount: 2.4,
		envDecayS: 0.8,
		index: 0.4,
		vibrato: 0.05,
	},
	// A flute (#547 D10): a sine with a little of its second and third
	// harmonics, breath in a band above it that is loud as the note starts and
	// stays low under it, a soft attack and a vibrato that comes late.
	flute: {
		...BASE,
		attackS: 0.05,
		decayS: 1,
		sustain: 1,
		releaseS: 0.12,
		cutoffHz: 2600,
		index: 0.5,
		vibrato: 0.12,
		drift: 2,
		detune: 0.03,
	},
	// A chip's pulse: two band-limited saws a width apart, the width swept,
	// no filter unless a part asks for one.
	pulse: {
		...BASE,
		attackS: 0.002,
		decayS: 0.4,
		sustain: 0.8,
		releaseS: 0.05,
		width: 0.5,
	},
	// An electric piano, by phase modulation: the body a sine bent by its own
	// phase, brighter the harder it is struck and mellowing as it rings, and
	// a tine's clank — a partial far above, gone in a tenth of a second.
	epiano: {
		...BASE,
		attackS: 0.002,
		decayS: 4.5,
		sustain: 0,
		releaseS: 0.35,
		index: 2.4,
		envAmount: 1.2,
		envDecayS: 3,
		indexDecayS: 0.12,
		ratio: 11,
	},
	// A harpsichord: a plucked string in a delay line, plucked near its end so
	// some harmonics are missing, bright and long while the key is down, and
	// the damper's soft thunk when it is let go.
	harpsi: {
		...BASE,
		attackS: 0.001,
		decayS: 6,
		sustain: 1,
		releaseS: 0.12,
		cutoffHz: 7000,
		index: 0.13,
	},
	// A lead of soft saws: eight at random phases across the field, each
	// edge rounded wider as the note falls, so it mellows as it rings.
	softsaw: {
		...BASE,
		attackS: 0.005,
		decayS: 3,
		sustain: 0.35,
		releaseS: 0.4,
		unison: 8,
		detune: 0.06,
		spread: 0.8,
	},
	// A recorded instrument (map #1's sample ruling): the recording carries
	// its own decay, so the envelope only opens it and, on the key's release,
	// is the damper.
	sampler: {
		...BASE,
		attackS: 0.002,
		decayS: 1,
		sustain: 1,
		releaseS: 0.25,
	},
	moog: {
		...BASE,
		attackS: 0.005,
		decayS: 1.2,
		sustain: 0.6,
		releaseS: 0.3,
		cutoffHz: 600,
		unison: 3,
		detune: 0.07,
		drift: 0.3,
		envAmount: 2,
		envDecayS: 0.6,
		resonance: 0.35,
		index: 0,
		drive: 0.2,
	},
};

/** 60 dB in `seconds`, as a per-frame multiplier. */
const fall60 = (seconds: number, sampleRate: number) =>
	Math.exp(Math.log(1e-3) / Math.max(1, seconds * sampleRate));

export function resolvePart(spec: PartSpec, sampleRate: number): ResolvedPart {
	const d = { ...DEFAULTS[spec.voice], ...stripUndefined(spec) };
	return {
		kind: KIND[spec.voice],
		level: spec.level,
		attackFrames: Math.max(1, Math.round(d.attackS * sampleRate)),
		decayCoef: fall60(d.decayS, sampleRate),
		sustain: d.sustain,
		releaseCoef: fall60(d.releaseS, sampleRate),
		ratio: d.ratio,
		index: d.index,
		feedback: d.feedback,
		cutoffHz: d.cutoffHz,
		...panGains(d.pan),
		reverb: d.reverb,
		echo: d.echo,
		indexDecayCoef: d.indexDecayS > 0 ? fall60(d.indexDecayS, sampleRate) : 1,
		unison: Math.max(1, Math.min(MAX_OPS, Math.round(d.unison))),
		detune: d.detune,
		driftFrames:
			d.drift > 0 ? Math.max(1, Math.round(sampleRate / d.drift)) : 0,
		spread: Math.max(0, Math.min(1, d.spread)),
		envAmount: d.envAmount,
		envDecayCoef: fall60(d.envDecayS, sampleRate),
		damp: 2 - 1.9 * Math.max(0, Math.min(1, d.resonance)),
		ladderK: LADDER_K_MAX * Math.max(0, Math.min(1, d.resonance)),
		drive: d.drive,
		driveK: 1 + 8 * d.drive,
		driveNorm: 1 / Math.tanh(1 + 8 * d.drive),
		glideCoef: d.glideS > 0 ? 1 - Math.exp(-1 / (d.glideS * sampleRate)) : 1,
		vibrato: d.vibrato,
		sweepInc:
			d.sweepS > 0 && d.sweepOct !== 0 ? 1 / (d.sweepS * sampleRate) : 0,
		sweepOct: d.sweepS > 0 ? d.sweepOct : 0,
		phaser: Math.max(0, Math.min(1, d.phaser)),
		phaserInc: d.phaserS > 0 ? 1 / (d.phaserS * sampleRate) : 0,
		attackS: d.attackS,
		decayS: d.decayS,
		vibratoHz: d.vibratoHz,
		vibratoOnsetS: d.vibratoOnsetS,
		vibratoRiseS: d.vibratoRiseS,
		bowS: d.bowS,
		swell: d.swell,
		keyTrack: d.keyTrack,
		rosin: d.rosin,
		rosinLow: d.rosinLow,
		width: Math.max(PULSE_MIN_WIDTH, Math.min(0.5, d.width)),
		pwmInc: d.pwmHz > 0 ? d.pwmHz / sampleRate : 0,
		pwmDepth: d.pwmHz > 0 ? Math.max(0, d.pwmDepth) : 0,
		samples: spec.samples ?? "",
		fallback:
			spec.voice === "sampler" && spec.fallback
				? resolvePart({ ...spec, voice: spec.fallback }, sampleRate)
				: null,
	};
}

/** Equal power, scaled by √2 so a centred part is 1 on each side and a mono
 *  fold-down, (L + R) / 2, is the level the mono synth had. The one pan law:
 *  a part, a unison oscillator and a keys partial all sit in the field by it. */
const panLeft = (pan: number) =>
	Math.SQRT2 * Math.cos(((pan + 1) * Math.PI) / 4);
const panRight = (pan: number) =>
	Math.SQRT2 * Math.sin(((pan + 1) * Math.PI) / 4);

function panGains(pan: number): { panL: number; panR: number } {
	const p = Math.max(-1, Math.min(1, pan));
	return { panL: panLeft(p), panR: panRight(p) };
}

/** The three sends into one song's room, the length of the block. */
export interface RoomSends {
	readonly revL: Float32Array;
	readonly revR: Float32Array;
	readonly echo: Float32Array;
}

/**
 * Where a stereo render writes, beside the left channel it is handed: the
 * right channel, and each owner's sends into its own room, by owner (#587:
 * one room for every song let a new song bring a stopped song's tail back).
 * All the length of the block.
 */
export interface StereoOut {
	readonly right: Float32Array;
	readonly sends: readonly RoomSends[];
}

const stripUndefined = (spec: PartSpec) =>
	Object.fromEntries(Object.entries(spec).filter(([, v]) => v !== undefined));

/** What the bank multiplies each voice by: the engine's fades, per owner
 *  (song slot) and part, at a frame. */
export interface VoiceGain {
	gain(owner: number, part: number, frame: number): number;
}

/** Below this an envelope is silence, and its slot is free. */
const SILENT = 1e-4;
/** The lowest pluck the delay lines are sized for, Hz. */
const PLUCK_FLOOR_HZ = 20;
/** Pad detune, each saw, in cents either side. */
const PAD_DETUNE_CENTS = 5;
/** The tone voice's pitch glide: a time constant, s. */
const TONE_GLIDE_S = 0.012;
/** The most oscillators one note of a unison voice runs. */
const MAX_OPS = 8;
/** The keys' partials per note. */
const PARTIALS = 6;
/** The drone's tables: their length, and how long one morph takes. */
const TABLE = 2048;
const DRONE_MORPH_S = 12;
/** Harmonics in the drone's full tables, and in the thin ones a high note
 *  reads so its top harmonics stay under Nyquist. */
const DRONE_H = 32;
const DRONE_H_THIN = 6;
/** Rows of the next table built per block: the build is spread over time
 *  so no one `process()` pays for a whole table. */
const DRONE_ROWS = 64;
/** The analog wander's glide into each new draw, per frame. */
const DRIFT_GLIDE = 0.002;
/** Frames between filter-coefficient updates on the swept voices. */
const CUT_EVERY = 8;
const LADDER_K_MAX = 3.8;
const LADDER_MAX_HZ = 0.3;
const ladderCoef = (hz: number, sr: number) =>
	1 - Math.exp((-2 * Math.PI * Math.min(hz, LADDER_MAX_HZ * sr)) / sr);
/** The bow noise's one-pole that takes its lows away, per frame. */
const BOW_HIGHPASS = 0.2;
/** The rosin's comb: how much of each period feeds back, which is how
 *  narrowly its noise sits on the note's harmonics. */
const ROSIN_FEEDBACK = 0.85;
/** Rosin and key tracking both lean on the notes below this, Hz. */
const LOW_REF_HZ = 440;
/** The most a low note's rosin is multiplied by. */
const ROSIN_LOW_MAX = 4;
/** The brass's rise into its pitch: a time constant, s. */
const BRASS_SCOOP_S = 0.06;
/** A legato join: how far the last note may end before the next begins
 *  and still be carried on the same bow, s. */
const LEGATO_GAP_S = 0.03;
/** The flute's breath: how long the onset's burst lasts, s, and the share of
 *  it that stays under the held tone. */
const BREATH_ONSET_S = 0.06;
const BREATH_HELD = 0.18;
/** Per frame, how fast a legato note's weight follows the new note's. */
const LEGATO_VEL = 0.002;
/** The narrowest pulse: a width under this is a click train. */
const PULSE_MIN_WIDTH = 0.05;
/** The epiano's tine is left out where its sidebands would pass Nyquist. */
const TINE_NYQUIST = 0.45;
/** The harpsichord's string loss: the share of the last sample in each
 *  pass. Small, so the highs ring on — the instrument's brightness. */
const HARPSI_LOSS = 0.1;
/** Its pitch, per note, a little off: ± this share (about 2.6 cents). */
const HARPSI_DETUNE = 0.0015;
/** The damper's thunk: its level, its 60 dB fall in s, and the lowpass on
 *  its noise, per frame. */
const THUNK_LEVEL = 0.35;
const THUNK_S = 0.05;
const THUNK_LP = 0.04;
/** The least release envelope the thunk is divided by: past it, the thunk
 *  falls with the voice, which is about to free its slot. */
const THUNK_FLOOR = 0.1;
/** The soft saw's edge: the share of a cycle its fall takes at the peak of
 *  the envelope and as the note dies. */
const SOFT_EDGE_MIN = 0.02;
const SOFT_EDGE_MAX = 0.45;
/** Eight saws at random phases peak well past one where they line up; this
 *  keeps a held note under full scale. */
const SOFTSAW_GAIN = 0.6;

const STAGE_FREE = 0;
const STAGE_ATTACK = 1;
const STAGE_DECAY = 2;
const STAGE_RELEASE = 3;

const mtof = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

/** A four-point Hermite curve through `x0` and `x1`, at `t` between them. */
const hermite = (t: number, xm: number, x0: number, x1: number, x2: number) => {
	const c1 = 0.5 * (x1 - xm);
	const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2;
	const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1);
	return ((c3 * t + c2) * t + c1) * t + x0;
};

export class VoiceBank {
	private readonly stage: Uint8Array;
	private readonly kind: Uint8Array;
	private readonly owner: Uint8Array;
	private readonly partIx: Uint16Array;
	/** The frame a note starts on and the frame its release begins. */
	private readonly start: Float64Array;
	private readonly end: Float64Array;
	private readonly pitch: Float64Array;
	private readonly amp: Float64Array;
	private readonly env: Float64Array;
	/** Per-voice oscillator and filter state; each kind reads its own. */
	private readonly ph1: Float64Array;
	private readonly ph2: Float64Array;
	private readonly inc1: Float64Array;
	private readonly inc2: Float64Array;
	private readonly fb: Float64Array;
	private readonly lp: Float64Array;
	private readonly bp: Float64Array;
	/** The second filter's state (`svf2`): the pad's and the analog's right
	 *  side, and the acid's second stage. */
	private readonly lp2: Float64Array;
	private readonly bp2: Float64Array;
	/** The right side of the last `sample`, for the stereo voices. */
	private sideR = 0;
	/** Per oscillator of a unison voice (`MAX_OPS` a slot): phase, fixed
	 *  detune, drift and its target, and where it sits in the field. The kick
	 *  keeps its four layers' phases here too. */
	private readonly opPh: Float64Array;
	private readonly opOff: Float64Array;
	private readonly opJit: Float64Array;
	private readonly opJitTo: Float64Array;
	private readonly opL: Float32Array;
	private readonly opR: Float32Array;
	/** Frames to the next drift draw; filter envelope; the FM index's own
	 *  envelope; frames since the note began. */
	private readonly driftLeft: Float64Array;
	private readonly fenv: Float64Array;
	private readonly idxEnv: Float64Array;
	private readonly age: Float64Array;
	/** The acid's slide: the pitch it glides to, and when that begins. */
	private readonly glideTo: Float64Array;
	private readonly slideInc: Float64Array;
	private readonly slideAt: Float64Array;
	private readonly accent: Uint8Array;
	/** The strings' and brass's bow weight, and where a legato note takes it. */
	private readonly vel: Float64Array;
	private readonly velTo: Float64Array;
	/** The drone's table set per slot: 0 full, 1 thin. */
	private readonly thin: Uint8Array;
	/** The keys' partials: two past outputs and the two recurrence terms. */
	private readonly kY1: Float64Array;
	private readonly kY2: Float64Array;
	private readonly kC1: Float64Array;
	private readonly kC2: Float64Array;
	private readonly kL: Float32Array;
	private readonly kR: Float32Array;
	/** The drone's shared tables. */
	private readonly drone: DroneTables;
	/** Whether a drone voice ran this block: only then do the tables move. */
	private droneRan = false;
	private readonly g: Float64Array;
	private readonly apState: Float64Array;
	private readonly apCoef: Float64Array;
	/** The pluck's delay line: one per slot, sized once for the floor. */
	private readonly line: Float32Array[];
	private readonly lineW: Int32Array;
	private readonly lineD: Float64Array;
	private readonly parts: (ResolvedPart | null)[];
	/** The sample sets that have arrived, by name, and each sampler slot's
	 *  buffer: a reference into a set, never a copy. */
	private readonly sets = new Map<string, SampleBank>();
	private readonly sbuf: (Int16Array | null)[];
	/** A stereo set's right channel, per slot; `null` for a mono set. */
	private readonly sbufR: (Int16Array | null)[];
	/** What one step of the slot's recording is worth. */
	private readonly sscale: Float64Array;
	/** Set by `sampler` when a recording has run out: its slot is free. */
	private ended = false;
	/** The bank's own noise, -1..1: the bursts, the drift and the unison
	 *  phases. */
	private readonly noise = xorshift(0x9e3779b9);

	constructor(
		readonly cap: number,
		private readonly sampleRate: number,
	) {
		const f64 = () => new Float64Array(cap);
		this.stage = new Uint8Array(cap);
		this.kind = new Uint8Array(cap);
		this.owner = new Uint8Array(cap);
		this.partIx = new Uint16Array(cap);
		this.start = f64();
		this.end = f64();
		this.pitch = f64();
		this.amp = f64();
		this.env = f64();
		this.ph1 = f64();
		this.ph2 = f64();
		this.inc1 = f64();
		this.inc2 = f64();
		this.fb = f64();
		this.lp = f64();
		this.bp = f64();
		this.lp2 = f64();
		this.bp2 = f64();
		const ops = () => new Float64Array(cap * MAX_OPS);
		this.opPh = ops();
		this.opOff = ops();
		this.opJit = ops();
		this.opJitTo = ops();
		this.opL = new Float32Array(cap * MAX_OPS);
		this.opR = new Float32Array(cap * MAX_OPS);
		this.driftLeft = f64();
		this.fenv = f64();
		this.idxEnv = f64();
		this.age = f64();
		this.glideTo = f64();
		this.slideInc = f64();
		this.slideAt = f64();
		this.accent = new Uint8Array(cap);
		this.vel = f64();
		this.velTo = f64();
		this.thin = new Uint8Array(cap);
		const partials = () => new Float64Array(cap * PARTIALS);
		this.kY1 = partials();
		this.kY2 = partials();
		this.kC1 = partials();
		this.kC2 = partials();
		this.kL = new Float32Array(cap * PARTIALS);
		this.kR = new Float32Array(cap * PARTIALS);
		// Its own stream: drawn from the bank's, the tables moved every pluck
		// and noise burst after them, and a render of a song with no drone in
		// it changed.
		this.drone = new DroneTables(xorshift(0x2545f491));
		this.g = f64();
		this.apState = new Float64Array(cap * PHASER_SLOT);
		this.apCoef = new Float64Array(cap * 2);
		const lineLen = Math.ceil(sampleRate / PLUCK_FLOOR_HZ) + 4;
		this.line = Array.from({ length: cap }, () => new Float32Array(lineLen));
		this.lineW = new Int32Array(cap);
		this.lineD = f64();
		this.parts = new Array(cap).fill(null);
		this.sbuf = new Array(cap).fill(null);
		this.sbufR = new Array(cap).fill(null);
		this.sscale = f64();
	}

	/**
	 * Hold a sample set for the `sampler` voice, or merge into the one held
	 * (O27): the zones that carry `data` fill in the held set's, by layer
	 * index and root, and every other zone is kept — a recording sent once is
	 * not sent again, as its buffer was transferred. A set whose layers do not
	 * line up with the held one replaces it. Rebuilt rather than written in
	 * place, so a note started on the old arrays reads them to its end.
	 */
	addSamples(name: string, bank: SampleBank) {
		const held = this.sets.get(name);
		if (!held || held.layers.length !== bank.layers.length) {
			this.sets.set(name, bank);
			return;
		}
		this.sets.set(name, {
			...held,
			layers: held.layers.map((l, li) => ({
				...l,
				zones: l.zones.map(
					(z) =>
						bank.layers[li].zones.find((n) => n.root === z.root && n.data) ?? z,
				),
			})),
		});
	}

	/** Whether a sample set has arrived. */
	hasSamples(name: string): boolean {
		return this.sets.has(name);
	}

	/** Voices holding a slot: sounding, or waiting for their start frame. */
	get sounding(): number {
		let n = 0;
		for (let i = 0; i < this.cap; i++) if (this.stage[i] !== STAGE_FREE) n++;
		return n;
	}

	/** The pitch of every held slot. For tests and probes: it allocates. */
	pitches(): number[] {
		const out: number[] = [];
		for (let i = 0; i < this.cap; i++)
			if (this.stage[i] !== STAGE_FREE) out.push(this.pitch[i]);
		return out;
	}

	/** Whether any held slot is `owner`'s: a song whose notes still ring. */
	holds(owner: number): boolean {
		for (let i = 0; i < this.cap; i++)
			if (this.stage[i] !== STAGE_FREE && this.owner[i] === owner) return true;
		return false;
	}

	/** Free every slot one song holds: a song halted, or replaced. */
	clearOwner(owner: number) {
		for (let i = 0; i < this.cap; i++)
			if (this.owner[i] === owner) this.stage[i] = STAGE_FREE;
	}

	/**
	 * Start a note on `frame`, `durFrames` long before its release. Takes a
	 * free slot, or over the cap the voice that started first (#543 D7). A
	 * taken voice keeps its envelope's level and attacks from there, so the
	 * handover is not a step to zero.
	 */
	noteOn(
		frame: number,
		part: ResolvedPart,
		owner: number,
		partIndex: number,
		pitch: number,
		vel: number,
		durFrames: number,
	) {
		let zone: Int16Array | null = null;
		let zoneR: Int16Array | null = null;
		let zoneScale = 0;
		let zoneInc = 0;
		let zoneAmp = 0;
		if (part.kind === SAMPLER) {
			const set = this.sets.get(part.samples);
			const layer = set && pickLayer(set.layers, vel);
			const pick = layer && pickZone(layer.zones, pitch);
			// No set yet, or not this recording yet: the fallback, or nothing.
			if (!set || !layer || !pick || !pick.data) {
				if (part.fallback)
					this.noteOn(
						frame,
						part.fallback,
						owner,
						partIndex,
						pitch,
						vel,
						durFrames,
					);
				return;
			}
			zone = pick.data;
			zoneR = pick.right ?? null;
			zoneScale = pick.scale;
			zoneInc = 2 ** ((pitch - pick.root) / 12) * (set.rate / this.sampleRate);
			// A layer's recording is its loudest note: the velocity within it.
			const top = layer.maxVelocity > 0 ? layer.maxVelocity : 1;
			zoneAmp = part.level * set.gain * Math.min(1, Math.max(0, vel / top));
		}
		let slot = -1;
		let oldest = Number.POSITIVE_INFINITY;
		let mono = -1;
		// The acid is one voice per part. A note overlapping the one that
		// sounds slides to it — no new attack — and any other takes its slot.
		if (part.kind === ACID)
			for (let i = 0; i < this.cap; i++) {
				if (
					this.stage[i] === STAGE_FREE ||
					this.kind[i] !== ACID ||
					this.owner[i] !== owner ||
					this.partIx[i] !== partIndex
				)
					continue;
				if (frame < this.end[i] && part.glideCoef < 1) {
					this.slideInc[i] = mtof(pitch) / this.sampleRate;
					this.slideAt[i] = frame;
					this.end[i] = frame + durFrames;
					this.pitch[i] = pitch;
					return;
				}
				mono = i;
				break;
			}
		// Strings and brass played legato: a note that follows on from one
		// still sounding in the same part — or ending within a breath of it —
		// is carried on that voice, gliding to the new pitch with no new
		// attack. Of several, the nearest in pitch not already carried on.
		if (LEGATO[part.kind] && part.glideCoef < 1) {
			const gap = LEGATO_GAP_S * this.sampleRate;
			let best = -1;
			let bestD = Number.POSITIVE_INFINITY;
			for (let i = 0; i < this.cap; i++) {
				if (
					this.stage[i] === STAGE_FREE ||
					this.kind[i] !== part.kind ||
					this.owner[i] !== owner ||
					this.partIx[i] !== partIndex ||
					this.start[i] >= frame ||
					this.end[i] < frame - gap ||
					this.slideAt[i] === frame
				)
					continue;
				const d = Math.abs(this.pitch[i] - pitch);
				if (d < bestD) {
					bestD = d;
					best = i;
				}
			}
			if (best >= 0) {
				this.glideTo[best] = mtof(pitch) / this.sampleRate;
				this.slideAt[best] = frame;
				this.velTo[best] = vel;
				this.end[best] = frame + durFrames;
				this.pitch[best] = pitch;
				// Past its end already: bowed on from where its release had got to.
				if (this.stage[best] === STAGE_RELEASE) this.stage[best] = STAGE_ATTACK;
				return;
			}
		}
		for (let i = 0; mono < 0 && i < this.cap; i++) {
			if (this.stage[i] === STAGE_FREE) {
				slot = i;
				break;
			}
			if (this.start[i] < oldest) {
				oldest = this.start[i];
				slot = i;
			}
		}
		if (mono >= 0) slot = mono;
		if (slot < 0) return;
		const i = slot;
		const taken = this.stage[i] !== STAGE_FREE;
		// Read before the slot is rewritten: an acid slides on only from an
		// acid (sage round 8), never from the pitch of a voice it stole.
		const wasAcid = taken && this.kind[i] === ACID;
		const sr = this.sampleRate;
		const f = mtof(pitch);
		this.stage[i] = STAGE_ATTACK;
		this.kind[i] = part.kind;
		this.owner[i] = owner;
		this.partIx[i] = partIndex;
		this.parts[i] = part;
		this.start[i] = frame;
		this.end[i] = frame + durFrames;
		this.pitch[i] = pitch;
		// The strings and brass carry their weight themselves, so a legato
		// note can change it without a new attack.
		const weighted = LEGATO[part.kind] === 1;
		this.amp[i] = weighted ? part.level : vel * part.level;
		this.vel[i] = vel;
		this.velTo[i] = vel;
		if (!taken) this.env[i] = 0;
		this.ph1[i] = 0;
		this.ph2[i] = 0.25;
		this.fb[i] = 0;
		this.lp[i] = 0;
		this.bp[i] = 0;
		this.lp2[i] = 0;
		this.bp2[i] = 0;
		this.apState.fill(0, i * PHASER_SLOT, (i + 1) * PHASER_SLOT);
		this.fenv[i] = 0;
		this.idxEnv[i] = 1;
		this.age[i] = 0;
		this.slideAt[i] = Number.POSITIVE_INFINITY;
		const cents = PAD_DETUNE_CENTS / 1200;
		switch (part.kind) {
			case PAD: // two saws either side of the pitch, into a lowpass
				this.inc1[i] = (f * 2 ** cents) / sr;
				this.inc2[i] = (f * 2 ** -cents) / sr;
				this.g[i] = svfCoef(part.cutoffHz, sr);
				break;
			case PLUCK: // a burst of noise into a tuned delay line
				this.pluck(i, f, part.cutoffHz);
				break;
			case FM: // carrier and modulator
				this.inc1[i] = f / sr;
				this.inc2[i] = (f * part.ratio) / sr;
				break;
			case NOISE: // a band of it, centred on the pitch
				this.g[i] = svfCoef(f * sweep(part, frame), sr);
				break;
			case TONE: // starts `ratio` times high and glides down
				this.inc1[i] = f / sr;
				this.inc2[i] = (f * (part.ratio - 1)) / sr;
				this.g[i] = Math.exp(-1 / (TONE_GLIDE_S * sr));
				break;
			case ANALOG:
			case DRONE:
				this.inc1[i] = f / sr;
				this.unisonOn(i, part);
				this.thin[i] = f * DRONE_H > 0.4 * sr ? 1 : 0;
				this.g[i] = svfCoef(part.cutoffHz, sr);
				break;
			case ACID:
				this.inc1[i] = wasAcid ? this.inc1[i] : f / sr;
				this.glideTo[i] = f / sr;
				this.fenv[i] = 1;
				this.accent[i] = vel > 0.8 ? 1 : 0;
				this.g[i] = svfCoef(part.cutoffHz, sr);
				break;
			case KEYS:
				this.keysOn(i, part, f, vel);
				break;
			case KICK:
				this.inc1[i] = f / sr;
				for (let k = 0; k < 4; k++) this.opPh[i * MAX_OPS + k] = 0;
				break;
			case FLUTE:
				// The breath's band: at the part's cutoff, or above the note.
				this.g[i] = svfCoef(Math.max(part.cutoffHz, 2 * f), sr);
				this.inc1[i] = f / sr;
				this.glideTo[i] = f / sr;
				this.opOff[i * MAX_OPS] = 0;
				this.opJit[i * MAX_OPS] = 0;
				this.opJitTo[i * MAX_OPS] = 0;
				this.driftLeft[i] = 0;
				this.ph2[i] = 0.5 * (this.noise() + 1);
				break;
			case STRINGS:
			case BRASS:
				this.inc1[i] = f / sr;
				this.glideTo[i] = f / sr;
				this.unisonOn(i, part);
				if (part.rosin > 0) {
					this.line[i].fill(0);
					this.lineW[i] = 0;
				}
				// A section is not evenly tuned: evenly spaced detunes beat at one
				// common rate, and the section swells and fades on it. Each player
				// a little off their place.
				for (let k = 0; k < part.unison; k++)
					this.opOff[i * MAX_OPS + k] += 0.4 * part.detune * this.noise();
				// Each voice's vibrato on its own phase, so a section does not
				// pulse as one.
				this.ph2[i] = 0.5 * (this.noise() + 1);
				this.g[i] = svfCoef(part.cutoffHz, sr);
				break;
			case PULSE:
				this.inc1[i] = f / sr;
				this.glideTo[i] = f / sr;
				this.ph2[i] = 0;
				this.opPh[i * MAX_OPS] = 0;
				this.g[i] = part.cutoffHz > 0 ? stableCoef(part.cutoffHz, sr) : 0;
				break;
			case EPIANO:
				this.inc1[i] = f / sr;
				this.inc2[i] = (f * part.ratio) / sr;
				this.fenv[i] = 1;
				// No tine where its upper sideband would alias.
				this.opOff[i * MAX_OPS] =
					f * (part.ratio + 1) < TINE_NYQUIST * sr ? 1 : 0;
				break;
			case HARPSI:
				this.amp[i] = part.level * (0.85 + 0.15 * vel);
				this.harpsiOn(i, part, f);
				break;
			case SOFTSAW:
				this.inc1[i] = f / sr;
				this.glideTo[i] = f / sr;
				this.unisonOn(i, part);
				this.ph2[i] = 0.5 * (this.noise() + 1);
				break;
			case MOOG:
				this.inc1[i] = f / sr;
				this.unisonOn(i, part);
				this.g[i] = ladderCoef(part.cutoffHz, sr);
				break;
			case SAMPLER:
				// A read position into the recording, in its frames.
				this.sbuf[i] = zone;
				this.sbufR[i] = zoneR;
				this.sscale[i] = zoneScale;
				this.ph1[i] = 0;
				this.inc1[i] = zoneInc;
				this.amp[i] = zoneAmp;
				break;
		}
	}

	/** The harpsichord's string: a bright burst with the pluck point's comb
	 *  cut into it, the delay tuned a little off the note, and the loop gain
	 *  that gives its fundamental a `decayS` fall. */
	private harpsiOn(i: number, part: ResolvedPart, f: number) {
		const sr = this.sampleRate;
		const line = this.line[i];
		const a = 1 - Math.exp((-2 * Math.PI * part.cutoffHz) / sr);
		const tuned = f * (1 + HARPSI_DETUNE * this.noise());
		// The loss filter delays by its own weight; the line makes up the rest.
		const L = line.length;
		const D = Math.min(L - 2, sr / tuned - HARPSI_LOSS);
		const n = Math.min(L, Math.ceil(D) + 2);
		// One period of burst, `N` frames, made periodic before it is combed.
		const N = Math.max(2, Math.min(n, Math.round(D)));
		let y = 0;
		for (let k = 0; k < N; k++) {
			y += a * (this.noise() - y);
			line[k] = y;
		}
		// The pluck point: the period less itself `m` frames on, around the
		// period, which cuts every harmonic at a multiple of `N / m`. The
		// period's head is copied past its end first, so the comb reads only
		// burst; a note too low for the copy to fit is left uncombed.
		const m = Math.max(1, Math.min(N - 1, Math.round(part.index * N)));
		if (N + m <= L) {
			for (let k = 0; k < m; k++) line[N + k] = line[k];
			for (let k = 0; k < N; k++) line[k] = line[k + m] - line[k];
		}
		// The frames the read head starts behind, from the same period.
		for (let k = N; k < n; k++) line[k] = line[k - N];
		this.lineW[i] = n % L;
		this.lineD[i] = D;
		this.fb[i] = 0;
		this.g[i] = 10 ** (-3 / (tuned * Math.max(0.05, part.decayS)));
		this.accent[i] = 0;
		this.idxEnv[i] = 0;
		this.opOff[i * MAX_OPS] = fall60(THUNK_S, sr);
	}

	/** A unison note's oscillators: fixed detune spread evenly, each with its
	 *  own place in the field and a random phase, so they do not start as one. */
	private unisonOn(i: number, part: ResolvedPart) {
		const n = part.unison;
		for (let k = 0; k < n; k++) {
			const o = i * MAX_OPS + k;
			const t = n > 1 ? k / (n - 1) : 0.5;
			this.opOff[o] = part.detune * (2 * t - 1);
			this.opJit[o] = 0;
			this.opJitTo[o] = 0;
			this.opPh[o] = n > 1 ? 0.5 * (this.noise() + 1) : 0;
			// Across the field, scaled so the sum of `n` sits at the level of one.
			const pan = part.spread * (2 * t - 1);
			this.opL[o] = panLeft(pan) / Math.sqrt(n);
			this.opR[o] = panRight(pan) / Math.sqrt(n);
		}
		this.driftLeft[i] = 0;
	}

	/** The keys' partials: each a damped sine, higher ones quieter and
	 *  shorter, alternately left and right of the note. */
	private keysOn(i: number, part: ResolvedPart, f: number, vel: number) {
		const sr = this.sampleRate;
		const tilt = Math.max(0.3, 2.2 - part.index - 0.5 * vel);
		for (let k = 0; k < PARTIALS; k++) {
			const o = i * PARTIALS + k;
			const fk = f * (1 + k * part.ratio);
			const w = (2 * Math.PI * fk) / sr;
			const a = fk < 0.45 * sr ? 0.5 * (k + 1) ** -tilt : 0;
			const T = part.decayS / (1 + 0.6 * k);
			const r = Math.exp(Math.log(1e-3) / Math.max(1, T * sr));
			this.kC1[o] = 2 * r * Math.cos(w);
			this.kC2[o] = r * r;
			this.kY2[o] = 0;
			this.kY1[o] = a * r * Math.sin(w);
			const pan = k === 0 ? 0 : k % 2 ? -0.35 : 0.35;
			this.kL[o] = panLeft(pan);
			this.kR[o] = panRight(pan);
		}
	}

	/** Fill the delay line with a burst, softened by a one-pole lowpass at
	 *  `brightHz`, and tune the delay to the pitch. */
	private pluck(i: number, f: number, brightHz: number) {
		const line = this.line[i];
		const a = 1 - Math.exp((-2 * Math.PI * brightHz) / this.sampleRate);
		// The loop's averaging filter delays half a frame; the line makes up
		// the rest, fractionally, so a high note is not sharp.
		const D = Math.min(line.length - 2, this.sampleRate / f - 0.5);
		// Only the period the read head reaches, not the whole line sized for
		// 20 Hz (sage round 1: a C6 filled 50 times what it read). Writing starts
		// after it, so the head trails into fresh burst and then into the loop.
		const n = Math.min(line.length, Math.ceil(D) + 2);
		let y = 0;
		for (let k = 0; k < n; k++) {
			y += a * (this.noise() - y);
			line[k] = y;
		}
		this.lineW[i] = n % line.length;
		this.lineD[i] = D;
		this.fb[i] = 0;
	}

	/**
	 * Add every voice into `out`, which holds the frames from `frame` on.
	 * A voice is silent before its start frame and joins mid-block on it.
	 *
	 * With `stereo`, `out` is the left channel and the rest go where it
	 * says; without it, `out` gets the fold-down, (L + R) / 2, and no send.
	 */
	render(
		out: Float32Array,
		frame: number,
		gains: VoiceGain,
		stereo?: StereoOut,
	) {
		const n = out.length;
		if (this.droneRan) this.drone.advance(n, this.sampleRate);
		this.droneRan = false;
		for (let i = 0; i < this.cap; i++) {
			if (this.stage[i] === STAGE_FREE) continue;
			const part = this.parts[i] as ResolvedPart;
			const owner = this.owner[i];
			const room = stereo?.sends[owner];
			const pIx = this.partIx[i];
			const startAt = this.start[i] - frame;
			if (startAt >= n) continue;
			const s0 = startAt > 0 ? Math.ceil(startAt) : 0;
			const releaseAt = this.end[i] - frame;
			const kind = this.kind[i];
			const amp = this.amp[i];
			let env = this.env[i];
			let stage = this.stage[i];
			for (let s = s0; s < n; s++) {
				if (stage !== STAGE_RELEASE && s >= releaseAt) stage = STAGE_RELEASE;
				if (stage === STAGE_ATTACK) {
					env += 1 / part.attackFrames;
					if (env >= 1) {
						env = 1;
						stage = STAGE_DECAY;
					}
				} else if (stage === STAGE_DECAY) {
					env = part.sustain + (env - part.sustain) * part.decayCoef;
					if (part.sustain === 0 && env < SILENT) {
						stage = STAGE_FREE;
						break;
					}
				} else {
					env *= part.releaseCoef;
					if (env < SILENT) {
						stage = STAGE_FREE;
						break;
					}
				}
				const x = this.sample(i, kind, part, env, frame + s);
				// A recording that has run out ends its note, whatever the
				// envelope says.
				if (this.ended) {
					this.ended = false;
					stage = STAGE_FREE;
					break;
				}
				const k = env * amp * gains.gain(owner, pIx, frame + s);
				const l = x * k * part.panL;
				const r = (STEREO[kind] ? this.sideR : x) * k * part.panR;
				if (stereo) {
					out[s] += l;
					stereo.right[s] += r;
					// An owner with no sends is the caller's fault, and the voice
					// still reaches both channels dry (sage round 2).
					if (room) {
						room.revL[s] += l * part.reverb;
						room.revR[s] += r * part.reverb;
						room.echo[s] += 0.5 * (l + r) * part.echo;
					}
				} else out[s] += 0.5 * (l + r);
			}
			this.env[i] = env;
			this.stage[i] = stage;
		}
	}

	/** One frame of voice `i`'s oscillator, before its envelope. */
	private sample(
		i: number,
		kind: number,
		part: ResolvedPart,
		env: number,
		at: number,
	) {
		switch (kind) {
			case ANALOG:
				return this.analog(i, part, at);
			case DRONE:
				this.droneRan = true;
				return this.droneSample(i, part);
			case ACID:
				return this.acid(i, part, at);
			case KEYS:
				return this.keys(i);
			case KICK:
				return this.kick(i);
			case STRINGS:
				return this.bowed(i, part, at);
			case BRASS:
				return this.horn(i, part, at);
			case FLUTE:
				return this.flute(i, part, at);
			case PULSE:
				return this.pulse(i, part, at);
			case EPIANO:
				return this.epiano(i, part);
			case HARPSI:
				return this.harpsi(i, env, at);
			case SOFTSAW:
				return this.softsaw(i, part, env, at);
			case SAMPLER:
				return this.sampler(i);
			case MOOG:
				return this.moog(i, part, at);
			case PAD: {
				const a = saw(this.ph1[i], this.inc1[i]);
				const b = saw(this.ph2[i], this.inc2[i]);
				this.ph1[i] = wrap(this.ph1[i] + this.inc1[i]);
				this.ph2[i] = wrap(this.ph2[i] + this.inc2[i]);
				// One saw a side, each through its own filter: the width. Folded
				// down, (f(a) + f(b)) / 2 is f((a + b) / 2), the mono pad exactly.
				this.sideR = this.svf2(i, b, 1.1);
				return this.svf(i, a, 1.1, false);
			}
			case PLUCK: {
				const line = this.line[i];
				const L = line.length;
				const w = this.lineW[i];
				let r = w - this.lineD[i];
				if (r < 0) r += L;
				const r0 = Math.floor(r);
				const frac = r - r0;
				const y = line[r0] + (line[(r0 + 1) % L] - line[r0]) * frac;
				// The averaging filter: the string's loss, which rings the
				// highs away first.
				line[w] = 0.5 * (y + this.fb[i]) * 0.998;
				this.fb[i] = y;
				this.lineW[i] = w + 1 === L ? 0 : w + 1;
				return y;
			}
			case FM: {
				const m = Math.sin(
					2 * Math.PI * this.ph2[i] + part.feedback * this.fb[i],
				);
				this.fb[i] = m;
				// On its own clock when it has one: a bell darkening as it rings.
				let idx = part.index * env;
				if (part.indexDecayCoef < 1) {
					idx = part.index * this.idxEnv[i];
					this.idxEnv[i] *= part.indexDecayCoef;
				}
				const c = Math.sin(2 * Math.PI * this.ph1[i] + idx * m);
				this.ph1[i] = wrap(this.ph1[i] + this.inc1[i]);
				this.ph2[i] = wrap(this.ph2[i] + this.inc2[i]);
				return c * 0.6;
			}
			case NOISE:
				if (part.sweepInc > 0 && this.age[i]++ % CUT_EVERY === 0)
					this.g[i] = svfCoef(
						mtof(this.pitch[i]) * sweep(part, at),
						this.sampleRate,
					);
				return this.svf(i, this.noise(), part.damp, true) * 1.4;
			default: {
				// TONE
				const c = Math.sin(2 * Math.PI * this.ph1[i]);
				this.ph1[i] = wrap(this.ph1[i] + this.inc1[i] + this.inc2[i]);
				this.inc2[i] *= this.g[i];
				return c * 0.8;
			}
		}
	}

	/** Move a unison voice's drift: a new random target now and then, glided
	 *  into, per oscillator — the wander a string machine has. */
	private wander(i: number, part: ResolvedPart) {
		if (part.driftFrames === 0) return;
		const n = part.unison;
		const base = i * MAX_OPS;
		if (--this.driftLeft[i] <= 0) {
			this.driftLeft[i] = part.driftFrames;
			for (let k = 0; k < n; k++)
				this.opJitTo[base + k] = 0.5 * part.detune * this.noise();
		}
		for (let k = 0; k < n; k++)
			this.opJit[base + k] +=
				DRIFT_GLIDE * (this.opJitTo[base + k] - this.opJit[base + k]);
	}

	/** Analog unison: `unison` saws, each detuned and drifting and placed in
	 *  the field, through a lowpass a side whose cutoff rides an envelope. */
	private analog(i: number, part: ResolvedPart, at: number) {
		const sr = this.sampleRate;
		const n = part.unison;
		const base = i * MAX_OPS;
		const t = this.age[i]++ / sr;
		this.wander(i, part);
		let vib = 0;
		if (part.vibrato > 0)
			vib =
				part.vibrato * Math.min(1, t / 0.8) * Math.sin(2 * Math.PI * 5.2 * t);
		let bend = 1;
		if (part.index > 0) {
			bend = 1 + 0.5 * part.index * Math.sin(2 * Math.PI * this.ph2[i]);
			this.ph2[i] = wrap(this.ph2[i] + this.inc1[i] * part.ratio);
		}
		let l = 0;
		let r = 0;
		for (let k = 0; k < n; k++) {
			const o = base + k;
			const inc =
				this.inc1[i] * semis(this.opOff[o] + this.opJit[o] + vib) * bend;
			const v = saw(this.opPh[o], inc);
			this.opPh[o] = wrap(this.opPh[o] + inc);
			l += v * this.opL[o];
			r += v * this.opR[o];
		}
		// The filter envelope: up with the attack, then its own fall.
		// With no attack it opens at once (sage round 9): from 0, only the
		// attack ever raised it, and an attack of 0 left the envelope unheard.
		if (t < part.attackS) this.fenv[i] = t / part.attackS;
		else if (t === 0) this.fenv[i] = 1;
		else this.fenv[i] *= part.envDecayCoef;
		if (this.age[i] % CUT_EVERY === 1)
			this.g[i] = svfCoef(
				part.cutoffHz * 2 ** (part.envAmount * this.fenv[i]) * sweep(part, at),
				sr,
			);
		const outR = this.svf2(i, r, part.damp);
		const outL = this.svf(i, l, part.damp, false);
		if (part.phaser === 0) {
			this.sideR = outR;
			return outL;
		}
		if (this.age[i] % CUT_EVERY === 1) {
			this.apCoef[2 * i] = phaserCoef(part, at, 0, sr);
			this.apCoef[2 * i + 1] = phaserCoef(part, at, PHASER_STEREO, sr);
		}
		this.sideR = this.phase(i, 1, outR, part.phaser);
		return this.phase(i, 0, outL, part.phaser);
	}

	private phase(i: number, side: number, x: number, depth: number): number {
		const s = this.apState;
		const o = i * PHASER_SLOT + side * (2 * PHASER_STAGES + 1);
		const a = this.apCoef[2 * i + side];
		let y = x + PHASER_FEEDBACK * s[o + 2 * PHASER_STAGES];
		for (let k = 0; k < PHASER_STAGES; k++) {
			const x1 = o + 2 * k;
			const out = a * y + s[x1] - a * s[x1 + 1];
			s[x1] = y;
			s[x1 + 1] = out;
			y = out;
		}
		s[o + 2 * PHASER_STAGES] = y;
		return (x + depth * y) / (1 + depth);
	}

	/** A legato note's glide and change of weight, from the frame it begins;
	 *  and the vibrato, arriving once the note is under way. Returns the
	 *  vibrato, in semitones. */
	private carry(i: number, part: ResolvedPart, at: number, t: number) {
		if (at >= this.slideAt[i]) {
			this.inc1[i] += part.glideCoef * (this.glideTo[i] - this.inc1[i]);
			this.vel[i] += LEGATO_VEL * (this.velTo[i] - this.vel[i]);
		}
		if (part.vibrato <= 0 || t < part.vibratoOnsetS) return 0;
		// Guarded as the swell is: a rise of 0 divides 0 by 0 at the onset, and
		// the NaN reaches the filter's state and silences the voice for good.
		const depth = Math.min(
			1,
			(t - part.vibratoOnsetS) / Math.max(1e-3, part.vibratoRiseS),
		);
		return (
			part.vibrato *
			depth *
			Math.sin(2 * Math.PI * (part.vibratoHz * t + this.ph2[i]))
		);
	}

	/** Bowed strings: `unison` saws across the field, bow noise on the
	 *  attack, the late vibrato, and a lowpass a side opened by the bow's
	 *  weight and swelling with the attack. */
	private bowed(i: number, part: ResolvedPart, at: number) {
		const sr = this.sampleRate;
		const n = part.unison;
		const base = i * MAX_OPS;
		const t = this.age[i]++ / sr;
		this.wander(i, part);
		const vib = this.carry(i, part, at, t);
		let l = 0;
		let r = 0;
		for (let k = 0; k < n; k++) {
			const o = base + k;
			const inc = this.inc1[i] * semis(this.opOff[o] + this.opJit[o] + vib);
			const v = saw(this.opPh[o], inc);
			this.opPh[o] = wrap(this.opPh[o] + inc);
			l += v * this.opL[o];
			r += v * this.opR[o];
		}
		// The bow: a burst of high noise, dying as the string takes the note.
		if (t < 6 * part.bowS && part.index > 0) {
			const x = this.noise();
			this.fb[i] += BOW_HIGHPASS * (x - this.fb[i]);
			const bow = part.index * Math.exp(-t / part.bowS) * (x - this.fb[i]);
			l += bow;
			r += bow;
		}
		// The rosin (D16): noise through a comb tuned to the note's period, so
		// it sits on the harmonics, under the whole note and more of it low.
		if (part.rosin > 0) {
			const hz = this.inc1[i] * sr;
			const low = Math.min(ROSIN_LOW_MAX, (LOW_REF_HZ / hz) ** part.rosinLow);
			const y = this.comb(i, this.noise(), 1 / this.inc1[i]);
			const scratch = 0.25 * part.rosin * low * y;
			l += scratch;
			r += scratch;
		}
		const vel = this.vel[i];
		if (this.age[i] % CUT_EVERY === 1) {
			const swell =
				1 -
				part.swell +
				part.swell * Math.min(1, t / Math.max(1e-3, part.attackS));
			let cut = part.cutoffHz * 2 ** (part.envAmount * vel) * swell;
			// Key tracking (D16): a note below A4 opens the lowpass.
			if (part.keyTrack > 0) {
				const hz = this.inc1[i] * sr;
				if (hz < LOW_REF_HZ) cut *= (LOW_REF_HZ / hz) ** part.keyTrack;
			}
			// Held where the filter stays stable undamped: `svfCoef`'s own cap,
			// a sixth of the rate, is past it at no resonance, and key tracking
			// or the lab's sliders reach it. No default setting does.
			this.g[i] = svfCoef(Math.min(cut, sr / 8), sr);
		}
		let yl = this.svf(i, l, part.damp, false);
		let yr = this.svf2(i, r, part.damp);
		// The drive (D16): a saturation after the lowpass, its level kept.
		// After, not before: a saw is already every harmonic, and a lowpass
		// behind the drive takes away what the drive adds; after it, the
		// clipped edges are the grit.
		if (part.drive > 0) {
			yl = Math.tanh(part.driveK * yl) * part.driveNorm;
			yr = Math.tanh(part.driveK * yr) * part.driveNorm;
		}
		this.sideR = yr * vel;
		return yl * vel;
	}

	/** One step of voice `i`'s comb: `x` plus the line `period` frames back,
	 *  fed back. It shares the pluck's delay line, which a strings voice does
	 *  not otherwise use. */
	private comb(i: number, x: number, period: number) {
		const line = this.line[i];
		const L = line.length;
		const D = Math.min(L - 2, period);
		const w = this.lineW[i];
		let r = w - D;
		if (r < 0) r += L;
		const r0 = Math.floor(r);
		const frac = r - r0;
		const back = line[r0] + (line[(r0 + 1) % L] - line[r0]) * frac;
		const y = x + ROSIN_FEEDBACK * back;
		line[w] = y;
		this.lineW[i] = w + 1 === L ? 0 : w + 1;
		return (1 - ROSIN_FEEDBACK) * y;
	}

	/** Soft brass: a saw and a pulse on each oscillator's one phase — one
	 *  oscillator by default, since two detuned ones swell and fade as they
	 *  beat — rising into the pitch
	 *  from below, through two lowpass stages whose cutoff swells as the note
	 *  speaks — by as much as the note's weight allows. */
	private horn(i: number, part: ResolvedPart, at: number) {
		const sr = this.sampleRate;
		const n = part.unison;
		const base = i * MAX_OPS;
		const t = this.age[i]++ / sr;
		this.wander(i, part);
		const vib = this.carry(i, part, at, t);
		const scoop = -part.index * Math.exp(-t / BRASS_SCOOP_S);
		let x = 0;
		for (let k = 0; k < n; k++) {
			const o = base + k;
			const inc =
				this.inc1[i] * semis(this.opOff[o] + this.opJit[o] + vib + scoop);
			const ph = this.opPh[o];
			// The pulse is a saw less a shifted saw.
			const sw = saw(ph, inc);
			const v = sw + 0.6 * (sw - saw(wrap(ph + 0.4), inc));
			this.opPh[o] = wrap(ph + inc);
			x += v;
		}
		x /= 1.6 * Math.sqrt(n);
		// The swell: up over the attack and a little past it, then settling.
		const rise = 1.3 * Math.max(1e-3, part.attackS);
		if (t < rise) this.fenv[i] = t / rise;
		else this.fenv[i] = 0.75 + (this.fenv[i] - 0.75) * part.envDecayCoef;
		const vel = this.vel[i];
		if (this.age[i] % CUT_EVERY === 1)
			this.g[i] = svfCoef(
				part.cutoffHz *
					2 ** (part.envAmount * this.fenv[i] * (0.3 + 0.7 * vel)),
				sr,
			);
		const y = this.svf(i, x, part.damp, false);
		return this.svf2(i, y, part.damp) * vel;
	}

	/** A flute: a sine with a little of its second and third harmonics — more
	 *  of them the harder it is blown — and breath, a band of noise above the
	 *  note, loud as the note starts and low under it after. One oscillator,
	 *  wandering a little in pitch as a player does. */
	private flute(i: number, part: ResolvedPart, at: number) {
		const t = this.age[i]++ / this.sampleRate;
		const o = i * MAX_OPS;
		const vib = this.carry(i, part, at, t);
		if (part.driftFrames > 0 && --this.driftLeft[i] <= 0) {
			this.driftLeft[i] = part.driftFrames;
			this.opJitTo[o] = 0.5 * part.detune * this.noise();
		}
		this.opJit[o] += DRIFT_GLIDE * (this.opJitTo[o] - this.opJit[o]);
		const inc = this.inc1[i] * semis(this.opJit[o] + vib);
		const p = 2 * Math.PI * this.ph1[i];
		this.ph1[i] = wrap(this.ph1[i] + inc);
		const vel = this.vel[i];
		const h = 0.06 + 0.12 * vel;
		const tone = Math.sin(p) + h * Math.sin(2 * p) + 0.5 * h * Math.sin(3 * p);
		const breath =
			part.index *
			(BREATH_HELD + (1 - BREATH_HELD) * Math.exp(-t / BREATH_ONSET_S)) *
			this.svf(i, this.noise(), 1.2, true);
		return (0.7 * tone + breath) * vel;
	}

	/** The drone: eight oscillators reading the morphing tables. */
	private droneSample(i: number, part: ResolvedPart) {
		const n = part.unison;
		const base = i * MAX_OPS;
		this.wander(i, part);
		const d = this.drone;
		const set = this.thin[i];
		let l = 0;
		let r = 0;
		for (let k = 0; k < n; k++) {
			const o = base + k;
			const inc = this.inc1[i] * semis(this.opOff[o] + this.opJit[o]);
			const v = d.read(set, this.opPh[o]);
			this.opPh[o] = wrap(this.opPh[o] + inc);
			l += v * this.opL[o];
			r += v * this.opR[o];
		}
		this.sideR = r;
		return l;
	}

	private moog(i: number, part: ResolvedPart, at: number) {
		const sr = this.sampleRate;
		const n = part.unison;
		const base = i * MAX_OPS;
		const t = this.age[i]++ / sr;
		this.wander(i, part);
		let x = 0;
		for (let k = 0; k < n; k++) {
			const o = base + k;
			const inc = this.inc1[i] * semis(this.opOff[o] + this.opJit[o]);
			x += saw(this.opPh[o], inc);
			this.opPh[o] = wrap(this.opPh[o] + inc);
		}
		x /= Math.sqrt(n);
		if (part.index > 0) {
			const inc = this.inc1[i] / 2;
			const p = this.ph2[i];
			x += part.index * (saw(p, inc) - saw(wrap(p + 0.5), inc));
			this.ph2[i] = wrap(p + inc);
		}
		if (t < part.attackS) this.fenv[i] = t / part.attackS;
		else if (t === 0) this.fenv[i] = 1;
		else this.fenv[i] *= part.envDecayCoef;
		if (this.age[i] % CUT_EVERY === 1)
			this.g[i] = ladderCoef(
				part.cutoffHz * 2 ** (part.envAmount * this.fenv[i]) * sweep(part, at),
				sr,
			);
		const k = part.ladderK;
		const g = this.g[i];
		const u = Math.tanh((1 + 3 * part.drive) * 0.5 * x - k * this.bp2[i]);
		const a = this.lp[i] + g * (u - Math.tanh(this.lp[i]));
		const b = this.bp[i] + g * (Math.tanh(a) - Math.tanh(this.bp[i]));
		const c = this.lp2[i] + g * (Math.tanh(b) - Math.tanh(this.lp2[i]));
		const d = this.bp2[i] + g * (Math.tanh(c) - Math.tanh(this.bp2[i]));
		this.lp[i] = a;
		this.bp[i] = b;
		this.lp2[i] = c;
		this.bp2[i] = d;
		return d * (1 + 0.5 * k) * 1.6;
	}

	/** The acid: a saw into two resonant stages; an envelope that snaps the
	 *  cutoff open, harder on an accent; a slide; saturation. */
	private acid(i: number, part: ResolvedPart, at: number) {
		const sr = this.sampleRate;
		if (at >= this.slideAt[i]) {
			this.glideTo[i] = this.slideInc[i];
			this.slideAt[i] = Number.POSITIVE_INFINITY;
		}
		this.inc1[i] += part.glideCoef * (this.glideTo[i] - this.inc1[i]);
		const v = saw(this.ph1[i], this.inc1[i]);
		this.ph1[i] = wrap(this.ph1[i] + this.inc1[i]);
		this.fenv[i] *= part.envDecayCoef;
		if (this.age[i]++ % CUT_EVERY === 0) {
			const oct = part.envAmount * this.fenv[i] * (1 + 0.5 * this.accent[i]);
			this.g[i] = svfCoef(part.cutoffHz * 2 ** oct * sweep(part, at), sr);
		}
		let x = this.svf(i, v, part.damp, false);
		x = this.svf2(i, x, part.damp);
		if (part.drive > 0)
			x = softclip(x * (1 + 6 * part.drive)) / (1 + part.drive);
		return x * (1 + 0.3 * this.accent[i]) * 0.7;
	}

	/** The keys: each partial one step of its damped-sine recurrence. */
	private keys(i: number) {
		let l = 0;
		let r = 0;
		const base = i * PARTIALS;
		for (let k = 0; k < PARTIALS; k++) {
			const o = base + k;
			const y = this.kC1[o] * this.kY1[o] - this.kC2[o] * this.kY2[o];
			this.kY2[o] = this.kY1[o];
			this.kY1[o] = y;
			l += y * this.kL[o];
			r += y * this.kR[o];
		}
		this.sideR = r;
		return l;
	}

	/** The kick, in four layers: a sine body falling from four times the
	 *  note to it, a triangle thump and slap falling faster, and a click. */
	private kick(i: number) {
		const sr = this.sampleRate;
		const t = this.age[i]++ / sr;
		const f = this.inc1[i] * sr;
		const o = i * MAX_OPS;
		const body = f * (1 + 3 * Math.exp(-t / 0.045));
		const thump = f * (1.5 + 4.5 * Math.exp(-t / 0.03));
		const slap = f * (8 + 16 * Math.exp(-t / 0.01));
		const click = 4000 * Math.exp(-t / 0.004);
		this.opPh[o] = wrap(this.opPh[o] + body / sr);
		this.opPh[o + 1] = wrap(this.opPh[o + 1] + thump / sr);
		this.opPh[o + 2] = wrap(this.opPh[o + 2] + slap / sr);
		this.opPh[o + 3] = wrap(this.opPh[o + 3] + click / sr);
		const x =
			Math.sin(2 * Math.PI * this.opPh[o]) +
			0.35 * Math.exp(-t / 0.04) * tri(this.opPh[o + 1]) +
			0.25 * Math.exp(-t / 0.012) * tri(this.opPh[o + 2]) +
			0.3 * Math.exp(-t / 0.004) * Math.sin(2 * Math.PI * this.opPh[o + 3]);
		return softclip(1.3 * x) * 0.8;
	}

	/** The chip's pulse: a saw a width behind less the saw itself — high for
	 *  `width` of the cycle — the width swept, the vibrato arriving late. */
	private pulse(i: number, part: ResolvedPart, at: number) {
		const t = this.age[i]++ / this.sampleRate;
		const inc = this.inc1[i] * semis(this.carry(i, part, at, t));
		const o = i * MAX_OPS;
		let w = part.width;
		if (part.pwmInc > 0) {
			w += part.pwmDepth * Math.sin(2 * Math.PI * this.opPh[o]);
			this.opPh[o] = wrap(this.opPh[o] + part.pwmInc);
			w = Math.max(PULSE_MIN_WIDTH, Math.min(0.5, w));
		}
		const p = this.ph1[i];
		let x = saw(wrap(p + 1 - w), inc) - saw(p, inc);
		this.ph1[i] = wrap(p + inc);
		if (this.g[i] > 0) x = this.svf(i, x, part.damp, false);
		if (part.drive > 0) x = softclip(x * (1 + 3 * part.drive));
		return x * 0.5;
	}

	/** The electric piano: a body that is a sine bent by its own phase — the
	 *  bend from the velocity, falling as it rings — and beside it the same
	 *  sine bent by the tine's partial far above, which dies at once. */
	private epiano(i: number, part: ResolvedPart) {
		const p = 2 * Math.PI * this.ph1[i];
		const s = Math.sin(p);
		const v = this.vel[i];
		const body = Math.sin(p + part.index * v * Math.sqrt(v) * this.fenv[i] * s);
		this.fenv[i] *= part.envDecayCoef;
		let tine = s;
		if (this.opOff[i * MAX_OPS] > 0) {
			tine = Math.sin(
				p +
					part.envAmount *
						this.vel[i] *
						this.idxEnv[i] *
						Math.sin(2 * Math.PI * this.ph2[i]),
			);
			this.idxEnv[i] *= part.indexDecayCoef;
			this.ph2[i] = wrap(this.ph2[i] + this.inc2[i]);
		}
		this.ph1[i] = wrap(this.ph1[i] + this.inc1[i]);
		return 0.4 * (body + tine);
	}

	/** The harpsichord: one pass of its string's loop, and the damper's thunk
	 *  from the frame the key is let go — on its own envelope, so divided by
	 *  the release's, which multiplies everything a voice returns. */
	private harpsi(i: number, env: number, at: number) {
		const line = this.line[i];
		const L = line.length;
		const w = this.lineW[i];
		let r = w - this.lineD[i];
		if (r < 0) r += L;
		const r0 = Math.floor(r);
		const y = line[r0] + (line[(r0 + 1) % L] - line[r0]) * (r - r0);
		line[w] = ((1 - HARPSI_LOSS) * y + HARPSI_LOSS * this.fb[i]) * this.g[i];
		this.fb[i] = y;
		this.lineW[i] = w + 1 === L ? 0 : w + 1;
		if (this.accent[i] === 0 && at >= this.end[i]) {
			this.accent[i] = 1;
			this.idxEnv[i] = 1;
		}
		let thunk = 0;
		if (this.idxEnv[i] > SILENT) {
			this.lp[i] += THUNK_LP * (this.noise() - this.lp[i]);
			thunk =
				(THUNK_LEVEL * this.idxEnv[i] * this.lp[i]) /
				Math.max(env, THUNK_FLOOR);
			this.idxEnv[i] *= this.opOff[i * MAX_OPS];
		}
		return y + thunk;
	}

	/** The soft saws: each a ramp that falls back over a share of its cycle,
	 *  that share widening as the envelope falls — bright at the strike,
	 *  rounder as it rings. Never under two frames, so it does not alias. */
	private softsaw(i: number, part: ResolvedPart, env: number, at: number) {
		const n = part.unison;
		const base = i * MAX_OPS;
		const t = this.age[i]++ / this.sampleRate;
		this.wander(i, part);
		const vib = this.carry(i, part, at, t);
		const edge =
			SOFT_EDGE_MIN + (SOFT_EDGE_MAX - SOFT_EDGE_MIN) * (1 - Math.min(1, env));
		let l = 0;
		let r = 0;
		for (let k = 0; k < n; k++) {
			const o = base + k;
			const inc = this.inc1[i] * semis(this.opOff[o] + this.opJit[o] + vib);
			const w = Math.min(0.5, Math.max(edge, 2 * inc));
			const p = this.opPh[o];
			const v = p < 1 - w ? (2 * p) / (1 - w) - 1 : 1 - (2 * (p - 1 + w)) / w;
			this.opPh[o] = wrap(p + inc);
			l += v * this.opL[o];
			r += v * this.opR[o];
		}
		this.sideR = SOFTSAW_GAIN * r;
		return SOFTSAW_GAIN * l;
	}

	/** Voice `i`'s second filter, the same lowpass on its own state: the
	 *  right side of the pad and the analog, and the acid's second stage. */
	private svf2(i: number, x: number, damp: number): number {
		return svfStep(this.lp2, this.bp2, i, this.g[i], x, damp, false);
	}

	/** One frame of a recording, read at the note's rate between its samples
	 *  by a four-point Hermite curve on its 16-bit steps, then scaled; past its
	 *  last frame, `ended`. */
	private sampler(i: number) {
		const d = this.sbuf[i] as Int16Array;
		const pos = this.ph1[i];
		const k = pos | 0;
		if (k + 2 >= d.length) {
			this.ended = true;
			return 0;
		}
		const t = pos - k;
		const scale = this.sscale[i];
		const left =
			scale * hermite(t, k > 0 ? d[k - 1] : d[k], d[k], d[k + 1], d[k + 2]);
		// A stereo set's right side, read at the same place; a mono set's is
		// its left. Either way `pan` weighs the two, as a balance.
		const r = this.sbufR[i];
		this.sideR = r
			? scale * hermite(t, k > 0 ? r[k - 1] : r[k], r[k], r[k + 1], r[k + 2])
			: left;
		this.ph1[i] = pos + this.inc1[i];
		return left;
	}

	/** One step of voice `i`'s Chamberlin state-variable filter: its lowpass
	 *  output, or with `band` its bandpass. */
	private svf(i: number, x: number, damp: number, band: boolean): number {
		return svfStep(this.lp, this.bp, i, this.g[i], x, damp, band);
	}
}

/** One step of a Chamberlin state-variable filter whose state is row `i` of
 *  `lp` and `bp`: its lowpass output, or with `band` its bandpass. */
export function svfStep(
	lp: Float64Array,
	bp: Float64Array,
	i: number,
	g: number,
	x: number,
	damp: number,
	band: boolean,
): number {
	const c = g * (g + 2 * damp) > SVF_STABLE ? svfLimit(damp) : g;
	lp[i] += c * bp[i];
	bp[i] += c * (x - lp[i] - damp * bp[i]);
	return band ? bp[i] : lp[i];
}

/** The filter's poles stay inside the unit circle while `g² + 2·g·damp < 4`;
 *  this keeps a margin under that edge, where a pole rings at Nyquist and
 *  decays too slowly to hear before it has grown. */
export const SVF_STABLE = 3;

/** The largest coefficient the state-variable filter takes at `damp`. A
 *  cutoff swept toward the rate (a low rate puts the same cutoff nearer it)
 *  asks for more, and a coefficient past this grows without bound. */
export const svfLimit = (damp: number) =>
	Math.sqrt(damp * damp + SVF_STABLE) - damp;

/** Where a part's slow sweep has the filter at frame `at`: a multiple of
 *  the cutoff, 1 at the bottom of the cycle and `2^sweepOct` at its top. */
function sweep(part: ResolvedPart, at: number): number {
	if (part.sweepInc === 0) return 1;
	const ph = at * part.sweepInc;
	return (
		2 **
		(part.sweepOct * 0.5 * (1 - Math.cos(2 * Math.PI * (ph - Math.floor(ph)))))
	);
}

const PHASER_STAGES = 4;
const PHASER_SLOT = 2 * (2 * PHASER_STAGES + 1);
const PHASER_FEEDBACK = 0.45;
const PHASER_STEREO = 0.25;
const PHASER_LOW_HZ = 240;
const PHASER_OCT = 3.4;

function phaserCoef(
	part: ResolvedPart,
	at: number,
	offset: number,
	sampleRate: number,
): number {
	const ph = at * part.phaserInc + offset;
	const hz =
		PHASER_LOW_HZ *
		2 **
			(PHASER_OCT * 0.5 * (1 - Math.cos(2 * Math.PI * (ph - Math.floor(ph)))));
	const t = Math.tan((Math.PI * hz) / sampleRate);
	return (t - 1) / (t + 1);
}

/** Chamberlin state-variable coefficient, capped where it stays stable. */
const svfCoef = (hz: number, sampleRate: number) =>
	2 * Math.sin((Math.PI * Math.min(hz, sampleRate / 6)) / sampleRate);

/** The coefficient a new voice's filter takes: capped at an eighth of the
 *  rate, where a Chamberlin filter stays stable at any resonance — at the
 *  sixth `svfCoef` allows, an undamped one runs away and the NaN silences
 *  the song's room. */
const stableCoef = (hz: number, sampleRate: number) =>
	svfCoef(Math.min(hz, sampleRate / 8), sampleRate);

const wrap = (p: number) => (p >= 1 ? p - 1 : p);

/** A band-limited saw: the naive ramp with a polyBLEP at its step, so a high
 *  pad note does not alias into a whine. */
function saw(ph: number, inc: number): number {
	let v = 2 * ph - 1;
	if (ph < inc) {
		const t = ph / inc;
		v -= t + t - t * t - 1;
	} else if (ph > 1 - inc) {
		const t = (ph - 1) / inc;
		v -= t * t + t + t + 1;
	}
	return v;
}

/** A pitch offset in semitones as a frequency multiple. */
const semis = (x: number) => (x === 0 ? 1 : 2 ** (x / 12));

/** A triangle from a phase, -1..1. */
const tri = (p: number) => 4 * Math.abs(p - Math.floor(p + 0.5)) - 1;

/** A soft clip: linear near 0, flat past ±1. */
const softclip = (x: number) =>
	x <= -1.5 ? -1 : x >= 1.5 ? 1 : x - (4 / 27) * x * x * x;

/**
 * The drone's wavetables, shared by every drone voice in the bank, after
 * "Cosmic Drone" (#560 D10). Each table is additive: harmonic `h` at
 * `(1 / h) × r³` for a fresh random `r` and a random phase, so every table
 * has the same slope and a different colour. The voices read a morph between
 * two, and a third is built behind them a few rows per block, so when the
 * morph arrives there is always a next colour and no block pays for a whole
 * table. Two sets: the full one, and a thin one a high note reads so its
 * harmonics stay under Nyquist.
 */
class DroneTables {
	private readonly tables: Float32Array[][];
	private readonly scale: Float64Array[];
	private readonly amps: Float64Array;
	private readonly phases: Float64Array;
	private cur = 0;
	private nxt = 1;
	private building = 2;
	private row = TABLE;
	private peak = new Float64Array(2);
	private morph = 0;

	constructor(private readonly rand: () => number) {
		this.tables = [0, 1].map(() =>
			[0, 1, 2].map(() => new Float32Array(TABLE)),
		);
		this.scale = [new Float64Array(3), new Float64Array(3)];
		this.amps = new Float64Array(DRONE_H);
		this.phases = new Float64Array(DRONE_H);
		for (const t of [0, 1]) {
			this.begin();
			this.build(t, TABLE);
			this.finish(t);
		}
		this.begin();
	}

	/** A table set's value at phase `p`, between the two in the morph. */
	read(set: number, p: number): number {
		const x = p * TABLE;
		const j = Math.floor(x);
		const fr = x - j;
		const j1 = j + 1 === TABLE ? 0 : j + 1;
		const a = this.tables[set][this.cur];
		const b = this.tables[set][this.nxt];
		const va = (a[j] + (a[j1] - a[j]) * fr) * this.scale[set][this.cur];
		const vb = (b[j] + (b[j1] - b[j]) * fr) * this.scale[set][this.nxt];
		return va + (vb - va) * this.morph;
	}

	/** Move the morph by `n` frames and build a few more rows. */
	advance(n: number, sampleRate: number) {
		if (this.row < TABLE) {
			this.build(this.building, Math.min(TABLE, this.row + DRONE_ROWS));
			if (this.row === TABLE) this.finish(this.building);
		}
		this.morph += n / (DRONE_MORPH_S * sampleRate);
		if (this.morph >= 1) {
			if (this.row < TABLE) {
				this.morph = 1;
				return;
			}
			this.morph -= 1;
			const old = this.cur;
			this.cur = this.nxt;
			this.nxt = this.building;
			this.building = old;
			this.begin();
		}
	}

	/** Draw a new colour and start building it into `building`. */
	private begin() {
		for (let h = 0; h < DRONE_H; h++) {
			const r = 0.5 * (this.rand() + 1);
			this.amps[h] = (r * r * r) / (h + 1);
			this.phases[h] = 0.5 * (this.rand() + 1);
		}
		// The fundamental always sounds, so every colour has the same pitch.
		this.amps[0] = 1;
		this.row = 0;
		this.peak.fill(0);
	}

	/** Build rows up to `to` of table `idx`, in both sets. */
	private build(idx: number, to: number) {
		for (let set = 0; set < 2; set++) {
			const H = set === 0 ? DRONE_H : DRONE_H_THIN;
			const t = this.tables[set][idx];
			for (let j = this.row; j < to; j++) {
				const x = j / TABLE;
				let v = 0;
				for (let h = 0; h < H; h++)
					v +=
						this.amps[h] *
						Math.sin(2 * Math.PI * ((h + 1) * x + this.phases[h]));
				t[j] = v;
				this.peak[set] = Math.max(this.peak[set], Math.abs(v));
			}
		}
		this.row = to;
	}

	/** Normalise finished table `idx` to a peak of 1. */
	private finish(idx: number) {
		for (let set = 0; set < 2; set++)
			this.scale[set][idx] = this.peak[set] > 0 ? 1 / this.peak[set] : 0;
	}
}

/** A xorshift stream, -1..1, of its own. */
function xorshift(seed: number): () => number {
	let x = seed >>> 0 || 1;
	return () => {
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		x >>>= 0;
		return x / 2147483648 - 1;
	};
}
