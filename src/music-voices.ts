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
import type { PartSpec, VoiceKind } from "./music-score";

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
};
/** The voices that are two signals, one a side; every other is one, panned.
 *  Indexed by kind, and filled by name (sage round 8), so a kind added or
 *  renumbered above cannot take another's row. */
const STEREO = new Uint8Array(Object.keys(KIND).length);
for (const k of [PAD, ANALOG, DRONE, KEYS]) STEREO[k] = 1;

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
	readonly drive: number;
	/** Per frame, toward a slide's target; 1 for no glide. */
	readonly glideCoef: number;
	readonly vibrato: number;
	readonly attackS: number;
	readonly decayS: number;
}

/**
 * Each voice's defaults. Placeholders in the sense every sound figure in this
 * repo is one: the test score is heard with them, and #547 and #548 set what
 * their own parts need.
 */
type VoiceDefaults = Required<Omit<PartSpec, "voice" | "level">>;

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
};

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
		drive: d.drive,
		glideCoef: d.glideS > 0 ? 1 - Math.exp(-1 / (d.glideS * sampleRate)) : 1,
		vibrato: d.vibrato,
		attackS: d.attackS,
		decayS: d.decayS,
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

/**
 * Where a stereo render writes, beside the left channel it is handed: the
 * right channel and the three sends into the space. All the length of the
 * block.
 */
export interface StereoOut {
	readonly right: Float32Array;
	readonly revL: Float32Array;
	readonly revR: Float32Array;
	readonly echo: Float32Array;
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

const STAGE_FREE = 0;
const STAGE_ATTACK = 1;
const STAGE_DECAY = 2;
const STAGE_RELEASE = 3;

const mtof = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);

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
	/** The pluck's delay line: one per slot, sized once for the floor. */
	private readonly line: Float32Array[];
	private readonly lineW: Int32Array;
	private readonly lineD: Float64Array;
	private readonly parts: (ResolvedPart | null)[];
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
		const lineLen = Math.ceil(sampleRate / PLUCK_FLOOR_HZ) + 4;
		this.line = Array.from({ length: cap }, () => new Float32Array(lineLen));
		this.lineW = new Int32Array(cap);
		this.lineD = f64();
		this.parts = new Array(cap).fill(null);
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
		this.amp[i] = vel * part.level;
		if (!taken) this.env[i] = 0;
		this.ph1[i] = 0;
		this.ph2[i] = 0.25;
		this.fb[i] = 0;
		this.lp[i] = 0;
		this.bp[i] = 0;
		this.lp2[i] = 0;
		this.bp2[i] = 0;
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
				this.g[i] = svfCoef(f, sr);
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
		}
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
				const k = env * amp * gains.gain(owner, pIx, frame + s);
				const l = x * k * part.panL;
				const r = (STEREO[kind] ? this.sideR : x) * k * part.panR;
				if (stereo) {
					out[s] += l;
					stereo.right[s] += r;
					stereo.revL[s] += l * part.reverb;
					stereo.revR[s] += r * part.reverb;
					stereo.echo[s] += 0.5 * (l + r) * part.echo;
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
				return this.analog(i, part);
			case DRONE:
				this.droneRan = true;
				return this.droneSample(i, part);
			case ACID:
				return this.acid(i, part, at);
			case KEYS:
				return this.keys(i);
			case KICK:
				return this.kick(i);
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
				return this.svf(i, this.noise(), 0.9, true) * 1.4;
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
	private analog(i: number, part: ResolvedPart) {
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
		if (t < part.attackS) this.fenv[i] = t / part.attackS;
		else this.fenv[i] *= part.envDecayCoef;
		if (this.age[i] % CUT_EVERY === 1)
			this.g[i] = svfCoef(
				part.cutoffHz * 2 ** (part.envAmount * this.fenv[i]),
				sr,
			);
		this.sideR = this.svf2(i, r, part.damp);
		return this.svf(i, l, part.damp, false);
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
			this.g[i] = svfCoef(part.cutoffHz * 2 ** oct, sr);
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

	/** Voice `i`'s second filter, the same lowpass on its own state: the
	 *  right side of the pad and the analog, and the acid's second stage. */
	private svf2(i: number, x: number, damp: number): number {
		return svfStep(this.lp2, this.bp2, i, this.g[i], x, damp, false);
	}

	/** One step of voice `i`'s Chamberlin state-variable filter: its lowpass
	 *  output, or with `band` its bandpass. */
	private svf(i: number, x: number, damp: number, band: boolean): number {
		return svfStep(this.lp, this.bp, i, this.g[i], x, damp, band);
	}
}

/** One step of a Chamberlin state-variable filter whose state is row `i` of
 *  `lp` and `bp`: its lowpass output, or with `band` its bandpass. */
function svfStep(
	lp: Float64Array,
	bp: Float64Array,
	i: number,
	g: number,
	x: number,
	damp: number,
	band: boolean,
): number {
	lp[i] += g * bp[i];
	bp[i] += g * (x - lp[i] - damp * bp[i]);
	return band ? bp[i] : lp[i];
}

/** Chamberlin state-variable coefficient, capped where it stays stable. */
const svfCoef = (hz: number, sampleRate: number) =>
	2 * Math.sin((Math.PI * Math.min(hz, sampleRate / 6)) / sampleRate);

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
