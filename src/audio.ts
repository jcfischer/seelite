/**
 * Minimal procedural audio via WebAudio — synthesized tones and noise for
 * weapons, impacts and UI. No assets; everything is generated.
 *
 * Vendored from seekolous (`src/audio.ts`). The machinery is copied unchanged —
 * the context handshake, the looping filtered-noise bed with its crossfade, the
 * on-change gain writes, the mute path, and the `tone`/`noiseBurst` primitives.
 * What was left behind is the god-game cue list (`fireball`, `lightning`,
 * `raise`, `lower`, `flatten`); the cues below are seelite's.
 *
 * **`Math.random()` is deliberate here and nowhere else.** The world seed
 * governs anything a player could compare between two runs of the same seed;
 * the exact sample values of a noise burst are not that, and drawing them from
 * a seeded stream would couple the audio layer's draw count to the galaxy's
 * (`rng.ts` on why that is the failure worth avoiding). If a probe ever needs
 * to assert on a waveform, it wants its own stream — not this file borrowing
 * one.
 */
export class AudioFX {
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	muted = false;

	/** The engine bed: a noise loop, filtered, whose level follows the thrust. */
	private bed: { gain: GainNode; filter: BiquadFilterNode } | null = null;
	/** Last level written, so the gain is set on change and not every frame. */
	private bedLevel = -1;

	/**
	 * True while nothing can be heard — no context yet, or one the browser is
	 * holding suspended until a user gesture.
	 *
	 * The HTML specification's *activation triggering input event* is a list —
	 * pointer, keyboard, touch — and gamepad input is not on it, so a pad press
	 * does not grant user activation and cannot open a context. That is what the
	 * specification says; no browser has been tested against it here. A player
	 * who undocks with Cross and never touches keyboard or mouse therefore gets
	 * silence, and `Game.padAudioNotice` reads this to say so once (#283).
	 *
	 * `!== "running"` rather than `=== "suspended"`: a *closed* context makes no
	 * sound either, and reading that as audible would suppress the one line that
	 * explains the silence.
	 */
	get silent(): boolean {
		return this.ctx === null || this.ctx.state !== "running";
	}

	/** Must be called after a user gesture to unlock audio. */
	ensure() {
		if (!this.ctx) {
			const AC = window.AudioContext || (window as any).webkitAudioContext;
			if (!AC) return;
			this.ctx = new AC();
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.4;
			this.master.connect(this.ctx.destination);
		}
		if (this.ctx.state === "suspended") this.ctx.resume();
	}

	/**
	 * Hold the engine bed at a level, `0`..`1`.
	 *
	 * Called every frame with the throttle, so it writes the gain **on change**
	 * rather than on every call — a `GainNode` parameter set sixty times a second
	 * to the same number is sixty scheduled automation events for nothing.
	 *
	 * Starts nothing until there is a context. The browser will not open one
	 * before a user gesture, and opening a *silent* one is not a fix for that, so
	 * this is a no-op until `ensure()` has run behind a real click.
	 *
	 * The point of this being driven rather than constant: the drive note rises
	 * with thrust without the audio layer ever learning what a ship is.
	 */
	ambient(level: number) {
		if (!this.ctx || !this.master) return;
		const want = this.muted ? 0 : Math.min(1, Math.max(0, level));
		if (!this.bed) {
			if (want <= 0) return; // nothing to hear; don't build the graph yet
			this.bed = this.makeBed();
			if (!this.bed) return;
		}
		if (this.muted) {
			// Fast, not eased: a player who hits mute wants silence now, and the
			// 0.25 constant the level uses takes the better part of a second to
			// get there.
			if (this.bedLevel !== 0) {
				this.bedLevel = 0;
				this.bed.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
			}
			return;
		}
		if (Math.abs(want - this.bedLevel) < 0.01) return;
		this.bedLevel = want;
		// A gentle curve rather than a straight one: loudness is not linear in
		// amplitude, and a linear map made the difference between idle and full
		// burn almost inaudible while the throttle read visibly open.
		const t = this.ctx.currentTime;
		this.bed.gain.gain.setTargetAtTime(0.16 * want * want, t, 0.25);
		// Harder thrust is brighter as well as louder — a low rumble at any
		// setting reads as traffic rather than as a drive.
		this.bed.filter.frequency.setTargetAtTime(180 + 700 * want, t, 0.4);
	}

	/** Build the looping noise graph. Two seconds of it, cross-faded by chance. */
	private makeBed() {
		if (!this.ctx || !this.master) return null;
		const seconds = 2;
		const len = Math.floor(this.ctx.sampleRate * seconds);
		const fade = Math.floor(this.ctx.sampleRate * 0.05);
		const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
		const data = buffer.getChannelData(0);
		// Brown-ish noise: white noise integrated, which has the low-frequency
		// weighting a drive has. Raw white noise is a hiss, and a hiss is a
		// broken speaker rather than an engine.
		//
		// Generated `fade` samples longer than the buffer, so the tail can be
		// crossfaded into the head and the loop point lands mid-signal rather
		// than on a step. Fading the head toward `data[len - fade]` — which is
		// what seekolous did first — leaves the actual seam, `data[len - 1]` to
		// `data[0]`, exactly as discontinuous as it was: a click every two
		// seconds, forever.
		const raw = new Float32Array(len + fade);
		let last = 0;
		for (let i = 0; i < raw.length; i++) {
			last = (last + (Math.random() * 2 - 1) * 0.02) * 0.995;
			raw[i] = last * 3.2;
		}
		for (let i = 0; i < len; i++) data[i] = raw[i];
		for (let i = 0; i < fade; i++) {
			const k = i / fade;
			data[i] = raw[i] * k + raw[len + i] * (1 - k);
		}
		const src = this.ctx.createBufferSource();
		src.buffer = buffer;
		src.loop = true;
		const filter = this.ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 180;
		filter.Q.value = 0.6;
		const gain = this.ctx.createGain();
		gain.gain.value = 0;
		src.connect(filter);
		filter.connect(gain);
		gain.connect(this.master);
		src.start();
		return { gain, filter };
	}

	/**
	 * Silence, or restore, everything — including the bed.
	 *
	 * The one-shots check `muted` when they fire, but a loop that is already
	 * running does not, so muting has to reach into it. A bed the player cannot
	 * turn off would be worse than no bed at all.
	 */
	setMuted(muted: boolean) {
		this.muted = muted;
		if (!this.bed || !this.ctx) return;
		// -1 rather than 0, so the next `ambient` call is guaranteed to differ
		// from it and re-open the bed at whatever the throttle is doing by then.
		this.bedLevel = -1;
		if (muted)
			this.bed.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
	}

	private tone(
		freq: number,
		dur: number,
		type: OscillatorType,
		vol = 0.3,
		slideTo?: number,
		out?: AudioNode,
	) {
		if (!this.ctx || !this.master || this.muted) return;
		const t = this.ctx.currentTime;
		const osc = this.ctx.createOscillator();
		const g = this.ctx.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t);
		if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		osc.connect(g);
		g.connect(out ?? this.master);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	}

	private noiseBurst(
		dur: number,
		vol = 0.3,
		filterFreq = 800,
		out?: AudioNode,
	) {
		if (!this.ctx || !this.master || this.muted) return;
		const t = this.ctx.currentTime;
		const len = Math.floor(this.ctx.sampleRate * dur);
		const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < len; i++)
			data[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const src = this.ctx.createBufferSource();
		src.buffer = buffer;
		const filter = this.ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = filterFreq;
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(filter);
		filter.connect(g);
		g.connect(out ?? this.master);
		src.start(t);
	}

	/**
	 * The cue list.
	 *
	 * Placeholders in the sense that the *sounds* are unresolved — sound design
	 * beyond this kit is still fog on the map — but not in the sense that they
	 * are throwaway: the point of naming them here is that a caller says
	 * `audio.laser()` and never learns what an oscillator is.
	 */
	/** Pulse laser: a short descending zap. */
	laser() {
		this.tone(880, 0.14, "square", 0.14, 180);
		this.noiseBurst(0.08, 0.12, 3000);
	}
	/** A hit taken or landed on hull — thud, no debris. */
	hit() {
		this.noiseBurst(0.22, 0.35, 900);
		this.tone(120, 0.2, "triangle", 0.2, 70);
	}
	/** A ship coming apart. */
	explosion() {
		this.noiseBurst(0.8, 0.5, 500);
		this.tone(70, 0.6, "sine", 0.4, 30);
	}
	/** Docking clamps engaging. */
	dock() {
		this.tone(160, 0.18, "sine", 0.25, 240);
		this.noiseBurst(0.12, 0.18, 600);
	}
	/**
	 * Witchspace entry: a rising sweep into nothing.
	 *
	 * #195's D3 places it: it starts `sweepS` before the cut so its top lands on
	 * the whiteout (`witchspace.ts` owns the schedule). It goes through its own
	 * group so `stopWitchspace` can take it back — a sweep that played on after
	 * a cancelled charge would announce a jump that did not happen.
	 */
	hyperspace() {
		const out = this.witchspaceGroup("sweep");
		if (!out) return;
		this.tone(90, 1.4, "sawtooth", 0.22, 1400, out);
		this.noiseBurst(1.2, 0.18, 2200, out);
	}
	/**
	 * The drive charging: a low hum under the first part of §8's wind-up, before
	 * the sweep takes over (#195's D3). Two detuned low voices rising a fifth,
	 * swelling in and easing out so the hand-off to the sweep is not a step.
	 */
	chargeHum(seconds: number) {
		const out = this.witchspaceGroup("hum");
		if (!out || !this.ctx) return;
		const t = this.ctx.currentTime;
		const env = this.ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(0.16, t + seconds * 0.6);
		env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
		const filter = this.ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.setValueAtTime(220, t);
		filter.frequency.exponentialRampToValueAtTime(520, t + seconds);
		filter.connect(env);
		env.connect(out);
		for (const [freq, type] of [
			[55, "sawtooth"],
			[55.7, "triangle"],
		] as const) {
			const osc = this.ctx.createOscillator();
			osc.type = type;
			osc.frequency.setValueAtTime(freq, t);
			osc.frequency.exponentialRampToValueAtTime(freq * 1.5, t + seconds);
			osc.connect(filter);
			osc.start(t);
			osc.stop(t + seconds + 0.05);
		}
	}
	/**
	 * Silence both witchspace cues now: the charge was cancelled (#532). Fast
	 * rather than cut, so the stop is not a click.
	 */
	stopWitchspace() {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		for (const group of this.witchspaceGroups.values()) {
			group.gain.setTargetAtTime(0, t, 0.03);
			// Disconnected once the ramp has settled; the voices in it stop on
			// their own schedule and have nowhere to go.
			setTimeout(() => group.disconnect(), 300);
		}
		this.witchspaceGroups.clear();
	}
	/** The live witchspace cues, each behind its own gain. */
	private readonly witchspaceGroups = new Map<"hum" | "sweep", GainNode>();
	/** A fresh group for a cue, replacing one still sounding under the same name. */
	private witchspaceGroup(cue: "hum" | "sweep"): GainNode | null {
		if (!this.ctx || !this.master || this.muted) return null;
		this.witchspaceGroups.get(cue)?.disconnect();
		const group = this.ctx.createGain();
		group.gain.value = 1;
		group.connect(this.master);
		this.witchspaceGroups.set(cue, group);
		return group;
	}

	/** Something is wrong — low fuel, incoming missile, hull critical. */
	alert() {
		this.tone(660, 0.12, "square", 0.16);
		this.tone(440, 0.12, "square", 0.16);
	}
	/** A canister taken into the hold: a short rising chime, so a scoop is heard
	 *  as a gain rather than as the thud of something hitting the hull. */
	scoop() {
		this.tone(320, 0.1, "triangle", 0.16, 720);
		this.tone(720, 0.12, "sine", 0.1, 960);
	}
	/** A button, a menu, a market row. */
	ui() {
		this.tone(520, 0.06, "square", 0.12);
	}
}
