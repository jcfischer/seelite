/**
 * The synth's space (#560, after the principal's first listening on #548):
 * a stereo reverb and a ping-pong echo that the voices send into.
 *
 * The first synth was mono and dry, and the principal heard it as not sounding
 * good; the references he named — Elite Dangerous, Vangelis, No Man's Sky —
 * all put their sound in a large space. So every part has a reverb send and an
 * echo send (`PartSpec.reverb`, `PartSpec.echo`), and this module is where
 * those sends go.
 *
 * - **The reverb** is an eight-line feedback delay network: a Hadamard mix
 *   between the lines, a one-pole damping in each loop so the highs die
 *   first, and a gain per line set from its length so the whole decays 60 dB
 *   in `reverbS`. The left send feeds the even lines and the right the odd,
 *   and each side reads its own set, so the tail is wide
 *   (`tests/music-space.test.ts` holds the decay and the width).
 * - **The echo** is a ping-pong: a repeat every `echoS`, left then right,
 *   each quieter by `echoFeedback` and darker by a lowpass, and a share of it
 *   (`echoToReverb`) sent on into the reverb.
 *
 * **Nothing allocates in `process`** (#543 D1): every line is sized once, in
 * the constructor. **And it goes exactly silent**: once nothing has come in
 * and nothing it holds is louder than -120 dB, the lines are cleared and
 * `process` adds nothing until the next send, so an idle synth writes zeros
 * rather than a decaying denormal hiss.
 */

export interface SpaceSpec {
	/** Seconds for the reverb to fall 60 dB. */
	readonly reverbS: number;
	/** Seconds between echoes. */
	readonly echoS: number;
	/** Each echo's level against the one before, `0`..`<1`. */
	readonly echoFeedback: number;
}

/** The longest echo the line holds. */
export const ECHO_MAX_S = 2;
/** Line lengths, ms: mutually prime-ish, so their echoes do not pile up. */
const LINES_MS = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
const PRE_DELAY_S = 0.02;
/** Where each loop's damping starts to eat the highs. */
const DAMP_HZ = 6500;
/** Where each echo's lowpass sits: every repeat is darker than the last. */
const ECHO_TONE_HZ = 4500;
/** Below this, what the space holds is silence (-120 dB). */
const QUIET = 1e-6;

const onePole = (hz: number, sr: number) =>
	1 - Math.exp((-2 * Math.PI * hz) / sr);

export class Space {
	/** The share of the echo sent on into the reverb. */
	echoToReverb = 0.35;
	private readonly lines: Float32Array[];
	private readonly len: Int32Array;
	private readonly pos: Int32Array;
	private readonly gain: Float64Array;
	private readonly damp: Float64Array;
	private readonly mix = new Float64Array(8);
	private readonly dampCoef: number;
	private readonly pre: Float32Array;
	private preW = 0;
	private readonly preLen: number;
	private readonly echoL: Float32Array;
	private readonly echoR: Float32Array;
	private echoW = 0;
	private echoD = 1;
	private fb = 0;
	private lpL = 0;
	private lpR = 0;
	private readonly echoCoef: number;
	private quietFrames = 0;
	private isSilent = true;

	constructor(
		private readonly sampleRate: number,
		spec: SpaceSpec,
	) {
		this.lines = LINES_MS.map(
			(ms) => new Float32Array(Math.round((ms / 1000) * sampleRate)),
		);
		this.len = Int32Array.from(this.lines.map((l) => l.length));
		this.pos = new Int32Array(8);
		this.gain = new Float64Array(8);
		this.damp = new Float64Array(8);
		this.dampCoef = onePole(DAMP_HZ, sampleRate);
		this.preLen = Math.round(PRE_DELAY_S * sampleRate);
		// Two interleaved channels: left at even indices, right at odd.
		this.pre = new Float32Array(2 * this.preLen);
		const echoLen = Math.ceil(ECHO_MAX_S * sampleRate) + 1;
		this.echoL = new Float32Array(echoLen);
		this.echoR = new Float32Array(echoLen);
		this.echoCoef = onePole(ECHO_TONE_HZ, sampleRate);
		this.set(spec);
	}

	/** Change the decay and the echo. Takes effect from the next frame. */
	set(spec: SpaceSpec) {
		const rt = Math.max(0.1, spec.reverbS);
		for (let i = 0; i < 8; i++)
			this.gain[i] = 10 ** ((-3 * this.len[i]) / this.sampleRate / rt);
		this.echoD = Math.max(
			1,
			Math.min(this.echoL.length - 1, Math.round(spec.echoS * this.sampleRate)),
		);
		this.fb = Math.min(0.95, Math.max(0, spec.echoFeedback));
	}

	/** True while the space holds nothing and adds nothing. */
	get silent(): boolean {
		return this.isSilent;
	}

	/**
	 * Take one block of sends and add the space's output into `outL`/`outR`.
	 * The three sends are the same length as the outputs.
	 */
	process(
		revL: Float32Array,
		revR: Float32Array,
		echo: Float32Array,
		outL: Float32Array,
		outR: Float32Array,
	) {
		const n = outL.length;
		let input = 0;
		for (let k = 0; k < n; k++)
			input = Math.max(
				input,
				Math.abs(revL[k]),
				Math.abs(revR[k]),
				Math.abs(echo[k]),
			);
		if (this.isSilent && input === 0) return;
		this.isSilent = false;

		const { lines, len, pos, gain, damp, mix } = this;
		const d = this.dampCoef;
		const ec = this.echoCoef;
		const eLen = this.echoL.length;
		let held = 0;
		for (let k = 0; k < n; k++) {
			// The echo: read, darken, cross-feed, and write.
			let r = this.echoW - this.echoD;
			if (r < 0) r += eLen;
			this.lpL += ec * (this.echoL[r] - this.lpL);
			this.lpR += ec * (this.echoR[r] - this.lpR);
			const eL = this.lpL;
			const eR = this.lpR;
			this.echoL[this.echoW] = echo[k] + this.fb * eR;
			this.echoR[this.echoW] = this.fb * eL;
			this.echoW = this.echoW + 1 === eLen ? 0 : this.echoW + 1;

			// The pre-delay, then into the network.
			const pw = 2 * this.preW;
			const inL = this.pre[pw];
			const inR = this.pre[pw + 1];
			this.pre[pw] = revL[k] + this.echoToReverb * eL;
			this.pre[pw + 1] = revR[k] + this.echoToReverb * eR;
			this.preW = this.preW + 1 === this.preLen ? 0 : this.preW + 1;

			for (let i = 0; i < 8; i++) {
				damp[i] += d * (lines[i][pos[i]] - damp[i]);
				mix[i] = damp[i];
			}
			// Each side reads its own lines, alternating in sign.
			const wetL = 0.5 * (mix[0] - mix[2] + mix[4] - mix[6]);
			const wetR = 0.5 * (mix[1] - mix[3] + mix[5] - mix[7]);
			// The Hadamard mix, in place, normalised so it loses nothing.
			for (let h = 1; h < 8; h *= 2)
				for (let i = 0; i < 8; i += 2 * h)
					for (let j = i; j < i + h; j++) {
						const a = mix[j];
						const b = mix[j + h];
						mix[j] = a + b;
						mix[j + h] = a - b;
					}
			for (let i = 0; i < 8; i++) {
				lines[i][pos[i]] =
					gain[i] * mix[i] * 0.35355339059327373 + (i % 2 === 0 ? inL : inR);
				pos[i] = pos[i] + 1 === len[i] ? 0 : pos[i] + 1;
			}
			outL[k] += wetL + eL;
			outR[k] += wetR + eR;
			held = Math.max(
				held,
				Math.abs(wetL),
				Math.abs(wetR),
				Math.abs(eL),
				Math.abs(eR),
			);
		}

		// Silence once every stored frame has been read below the floor: the
		// echo's line, the longest loop and the pre-delay all pass in that time.
		if (input === 0 && held < QUIET) {
			this.quietFrames += n;
			if (this.quietFrames > this.echoD + len[7] + this.preLen) this.clear();
		} else this.quietFrames = 0;
	}

	private clear() {
		for (const l of this.lines) l.fill(0);
		this.damp.fill(0);
		this.pre.fill(0);
		this.echoL.fill(0);
		this.echoR.fill(0);
		this.lpL = this.lpR = 0;
		this.quietFrames = 0;
		this.isSilent = true;
	}
}
