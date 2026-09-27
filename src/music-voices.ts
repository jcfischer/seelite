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

const KIND: Record<VoiceKind, number> = {
	pad: 0,
	pluck: 1,
	fm: 2,
	noise: 3,
	tone: 4,
};

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
}

/**
 * Each voice's defaults. Placeholders in the sense every sound figure in this
 * repo is one: the test score is heard with them, and #547 and #548 set what
 * their own parts need.
 */
const DEFAULTS: Record<VoiceKind, Required<Omit<PartSpec, "voice" | "level">>> =
	{
		pad: {
			attackS: 0.35,
			decayS: 2,
			sustain: 0.75,
			releaseS: 1.2,
			ratio: 1,
			index: 0,
			feedback: 0,
			cutoffHz: 1400,
		},
		pluck: {
			attackS: 0.002,
			decayS: 2.5,
			sustain: 0,
			releaseS: 0.25,
			ratio: 1,
			index: 0,
			feedback: 0,
			cutoffHz: 4000,
		},
		fm: {
			attackS: 0.004,
			decayS: 1.6,
			sustain: 0.2,
			releaseS: 0.6,
			ratio: 2,
			index: 2.5,
			feedback: 0.3,
			cutoffHz: 0,
		},
		noise: {
			attackS: 0.001,
			decayS: 0.12,
			sustain: 0,
			releaseS: 0.08,
			ratio: 1,
			index: 0,
			feedback: 0,
			cutoffHz: 0,
		},
		tone: {
			attackS: 0.001,
			decayS: 0.35,
			sustain: 0,
			releaseS: 0.08,
			ratio: 2.5,
			index: 0,
			feedback: 0,
			cutoffHz: 0,
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
	};
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
	private readonly g: Float64Array;
	/** The pluck's delay line: one per slot, sized once for the floor. */
	private readonly line: Float32Array[];
	private readonly lineW: Int32Array;
	private readonly lineD: Float64Array;
	private readonly parts: (ResolvedPart | null)[];
	private seed = 0x9e3779b9;

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

	/** Free every slot now. The engine calls it once a fade to silence has
	 *  run out. */
	clear() {
		this.stage.fill(STAGE_FREE);
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
		for (let i = 0; i < this.cap; i++) {
			if (this.stage[i] === STAGE_FREE) {
				slot = i;
				break;
			}
			if (this.start[i] < oldest) {
				oldest = this.start[i];
				slot = i;
			}
		}
		if (slot < 0) return;
		const i = slot;
		const taken = this.stage[i] !== STAGE_FREE;
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
		const cents = PAD_DETUNE_CENTS / 1200;
		switch (part.kind) {
			case 0: // pad: two saws either side of the pitch, into a lowpass
				this.inc1[i] = (f * 2 ** cents) / sr;
				this.inc2[i] = (f * 2 ** -cents) / sr;
				this.g[i] = svfCoef(part.cutoffHz, sr);
				break;
			case 1: // pluck: a burst of noise into a tuned delay line
				this.pluck(i, f, part.cutoffHz);
				break;
			case 2: // fm: carrier and modulator
				this.inc1[i] = f / sr;
				this.inc2[i] = (f * part.ratio) / sr;
				break;
			case 3: // noise: a band of it, centred on the pitch
				this.g[i] = svfCoef(f, sr);
				break;
			case 4: // tone: starts `ratio` times high and glides down
				this.inc1[i] = f / sr;
				this.inc2[i] = (f * (part.ratio - 1)) / sr;
				this.g[i] = Math.exp(-1 / (TONE_GLIDE_S * sr));
				break;
		}
	}

	/** Fill the delay line with a burst, softened by a one-pole lowpass at
	 *  `brightHz`, and tune the delay to the pitch. */
	private pluck(i: number, f: number, brightHz: number) {
		const line = this.line[i];
		const a = 1 - Math.exp((-2 * Math.PI * brightHz) / this.sampleRate);
		let y = 0;
		for (let k = 0; k < line.length; k++) {
			y += a * (this.noise() - y);
			line[k] = y;
		}
		this.lineW[i] = 0;
		// The loop's averaging filter delays half a frame; the line makes up
		// the rest, fractionally, so a high note is not sharp.
		this.lineD[i] = Math.min(line.length - 2, this.sampleRate / f - 0.5);
		this.fb[i] = 0;
	}

	private noise(): number {
		let x = this.seed;
		x ^= x << 13;
		x ^= x >>> 17;
		x ^= x << 5;
		this.seed = x >>> 0;
		return this.seed / 2147483648 - 1;
	}

	/**
	 * Add every voice into `out`, which holds the frames from `frame` on.
	 * A voice is silent before its start frame and joins mid-block on it.
	 */
	render(out: Float32Array, frame: number, gains: VoiceGain) {
		const n = out.length;
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
				const x = this.sample(i, kind, part, env);
				out[s] += x * env * amp * gains.gain(owner, pIx, frame + s);
			}
			this.env[i] = env;
			this.stage[i] = stage;
		}
	}

	/** One frame of voice `i`'s oscillator, before its envelope. */
	private sample(i: number, kind: number, part: ResolvedPart, env: number) {
		switch (kind) {
			case 0: {
				const a = saw(this.ph1[i], this.inc1[i]);
				const b = saw(this.ph2[i], this.inc2[i]);
				this.ph1[i] = wrap(this.ph1[i] + this.inc1[i]);
				this.ph2[i] = wrap(this.ph2[i] + this.inc2[i]);
				return this.svf(i, 0.5 * (a + b), 1.1, false);
			}
			case 1: {
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
			case 2: {
				const m = Math.sin(2 * Math.PI * this.ph2[i] + part.feedback * this.fb[i]);
				this.fb[i] = m;
				const c = Math.sin(2 * Math.PI * this.ph1[i] + part.index * env * m);
				this.ph1[i] = wrap(this.ph1[i] + this.inc1[i]);
				this.ph2[i] = wrap(this.ph2[i] + this.inc2[i]);
				return c * 0.6;
			}
			case 3:
				return this.svf(i, this.noise(), 0.9, true) * 1.4;
			default: {
				const c = Math.sin(2 * Math.PI * this.ph1[i]);
				this.ph1[i] = wrap(this.ph1[i] + this.inc1[i] + this.inc2[i]);
				this.inc2[i] *= this.g[i];
				return c * 0.8;
			}
		}
	}

	/** One step of voice `i`'s Chamberlin state-variable filter: its lowpass
	 *  output, or with `band` its bandpass. */
	private svf(i: number, x: number, damp: number, band: boolean): number {
		const g = this.g[i];
		this.lp[i] += g * this.bp[i];
		this.bp[i] += g * (x - this.lp[i] - damp * this.bp[i]);
		return band ? this.bp[i] : this.lp[i];
	}
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
