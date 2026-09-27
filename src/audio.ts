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
 *
 * **The engine around the cues is #552's** (after #542's D1–D4 and D7): five
 * buses, one step per bus from the settings, a limiter on master, a voice pool
 * that caps each class, and a context seam so an `OfflineAudioContext` can
 * render every cue for a probe. It changes the plumbing and is meant to change
 * no sound: every bus at 100% reproduces the single master gain this file had,
 * and the limiter sits above anything one cue reaches.
 */
import {
	BUSES,
	type Bus,
	CUE_BUS,
	CUE_VOICE,
	type Cue,
	type CueBus,
	VOICE_CAPS,
	VOICE_MIX_CAP,
	VOICE_PRIORITY,
	VOICE_STEAL_FADE_S,
	type VoiceClass,
	type VoicedCueKind,
} from "./audio-cue";
import { VoicePool } from "./voice-pool";

/**
 * `hyperspace()`'s sweep, seconds. Owned here, beside the cue, and read by
 * `witchspace.ts`'s schedule: the cue is pushed to this layer and the layer
 * imports nothing (`tests/headless.test.ts`), so the figure lives with the
 * sound and the schedule reaches in for it.
 */
export const HYPERSPACE_SWEEP_S = 1.4;

/**
 * Each bus's gain at 100%. Master's is the 0.4 the single master gain had
 * before #552, so a build with every row at 100% sounds as the old one did.
 */
export const BUS_FULL_GAIN: Readonly<Record<Bus, number>> = {
	master: 0.4,
	ship: 1,
	combat: 1,
	console: 1,
	music: 1,
};

/**
 * A settings step, `0`..`1`, as a bus gain (#542 D2).
 *
 * Squared, for the reason `ambient()` squares its level: loudness is not linear
 * in amplitude, and a linear map makes 75% and 100% almost the same. So 50% is
 * a quarter of the gain, about 12 dB down, and 25% about 24 dB down. Off is
 * exactly zero, which is what makes master Off the mute.
 */
export const busGain = (bus: Bus, step: number): number => {
	const s = Math.min(1, Math.max(0, step));
	return BUS_FULL_GAIN[bus] * s * s;
};

/**
 * The limiter on master (D4): a `DynamicsCompressorNode` set to act only near
 * full scale, so it stops a sum of loud buses clipping and leaves any one cue
 * alone.
 *
 * **Threshold at 0 dBFS, and that is what keeps it from moving a sound.** The
 * node's own algorithm applies a makeup gain derived from the threshold and
 * ratio, and it is zero only when the threshold is 0 dB; any lower threshold
 * lifts *every* cue by a fixed amount, which is a changed mix rather than a
 * limit. The loudest cue this file plays peaks far below full scale after the
 * master's 0.4, so at 0 dB the compressor never engages on one cue.
 * `probe-audio-cues.mjs` renders cues with and without it and holds the level.
 */
export const LIMITER = {
	thresholdDb: 0,
	kneeDb: 0,
	ratio: 20,
	attackS: 0.003,
	releaseS: 0.1,
} as const;

/**
 * How long each pooled cue rings, s: the voice pool's end time for it. The
 * longest of the cue's parts, with the tail `tone` leaves before it stops.
 */
export const CUE_LENGTH_S: Readonly<Record<VoicedCueKind, number>> = {
	laser: 0.19,
	shieldHit: 0.25,
	hullHit: 0.25,
	explosion: 0.8,
	dock: 0.23,
	alert: 0.17,
	scoop: 0.17,
	ui: 0.11,
};

type CueBuses = Record<Exclude<Bus, "master">, GainNode>;

export class AudioFX {
	/** Whatever the cues build into: the realtime context, or an offline one. */
	private ctx: BaseAudioContext | null = null;
	/** The realtime context `ensure()` opened, which is the one that resumes. */
	private live: AudioContext | null = null;
	private master: GainNode | null = null;
	private buses: CueBuses | null = null;

	/** Each bus's settings step, `0`..`1`. Held before there is a graph, so a
	 *  row read at boot is in place when the first gesture opens a context. */
	private readonly levels: Record<Bus, number> = {
		master: 1,
		ship: 1,
		combat: 1,
		console: 1,
		music: 1,
	};

	private readonly pool = new VoicePool<VoiceClass>(
		VOICE_CAPS,
		VOICE_PRIORITY,
		VOICE_MIX_CAP,
	);
	/** Each pooled voice's own gain, so a steal can fade it. */
	private readonly voices = new Map<number, GainNode>();

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
		return this.live === null || this.live.state !== "running";
	}

	/** Must be called after a user gesture to unlock audio. */
	ensure() {
		if (!this.live) {
			const AC = window.AudioContext || (window as any).webkitAudioContext;
			if (!AC) return;
			this.live = new AC() as AudioContext;
			this.attach(this.live);
		}
		if (this.live.state === "suspended") this.live.resume();
	}

	/**
	 * Build the engine into `ctx`: the cue buses into master, master through the
	 * limiter to the destination (D1, D4).
	 *
	 * **The offline seam (D7).** `ensure()` calls this with the realtime context;
	 * a probe calls it with an `OfflineAudioContext`, plays cues, and renders
	 * them. Not through `ensure()`, because an offline context reads `suspended`
	 * until it renders and cannot be resumed. One engine per context: a second
	 * call is refused rather than leaving two graphs half-connected.
	 */
	attach(ctx: BaseAudioContext) {
		if (this.ctx) return;
		this.ctx = ctx;
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = LIMITER.thresholdDb;
		limiter.knee.value = LIMITER.kneeDb;
		limiter.ratio.value = LIMITER.ratio;
		limiter.attack.value = LIMITER.attackS;
		limiter.release.value = LIMITER.releaseS;
		limiter.connect(ctx.destination);
		this.master = ctx.createGain();
		this.master.gain.value = busGain("master", this.levels.master);
		this.master.connect(limiter);
		const bus = (name: Exclude<Bus, "master">) => {
			const g = ctx.createGain();
			g.gain.value = busGain(name, this.levels[name]);
			g.connect(this.master as GainNode);
			return g;
		};
		this.buses = {
			ship: bus("ship"),
			combat: bus("combat"),
			console: bus("console"),
			music: bus("music"),
		};
	}

	/**
	 * The music bus's input (D1's contract with #543): the synth connects its
	 * output here and creates no gain of its own that competes with it. Null
	 * until there is a context.
	 */
	get musicInput(): GainNode | null {
		return this.buses?.music ?? null;
	}

	/**
	 * Set a bus to a settings step, `0`..`1` (D2).
	 *
	 * Eased over a few tens of milliseconds rather than set, so a step is not a
	 * click — and **this is what fades a loop that is already running**. The bed
	 * and a sounding witchspace group do not read the settings when they fire,
	 * so a mute that only stopped new cues would leave them playing. Master at
	 * Off is the mute: every bus sums through it.
	 */
	setLevel(bus: Bus, step: number) {
		this.levels[bus] = Math.min(1, Math.max(0, step));
		const node = bus === "master" ? this.master : this.buses?.[bus];
		if (!node || !this.ctx) return;
		node.gain.setTargetAtTime(
			busGain(bus, this.levels[bus]),
			this.ctx.currentTime,
			0.03,
		);
	}

	/** Whether a cue on `bus` can be heard at all. A cue that cannot is not
	 *  built, as a muted one was not before #552. */
	private audible(bus: CueBus): boolean {
		return this.levels.master > 0 && this.levels[bus] > 0;
	}

	/**
	 * Play one cue (D3): the one entry point. `Game.play` is the one dispatcher
	 * that calls it.
	 *
	 * A pooled cue takes a voice of its class first (D4): over a class cap the
	 * oldest of the class is faded out, and in a full mix a lower class yields.
	 */
	play(cue: Cue) {
		if (!this.ctx || !this.buses) return;
		if (cue.kind === "witchspaceStop") {
			this.stopWitchspace();
			return;
		}
		const bus = CUE_BUS[cue.kind];
		if (!this.audible(bus)) return;
		if (cue.kind === "witchspaceHum") {
			this.chargeHum(cue.seconds);
			return;
		}
		if (cue.kind === "witchspaceSweep") {
			this.hyperspace();
			return;
		}
		const t = this.ctx.currentTime;
		const admission = this.pool.admit(
			CUE_VOICE[cue.kind],
			t,
			t + CUE_LENGTH_S[cue.kind],
		);
		for (const id of admission.steal) {
			this.voices.get(id)?.gain.setTargetAtTime(0, t, VOICE_STEAL_FADE_S);
			this.voices.delete(id);
		}
		// The pool forgets a voice that has ended; so does this map.
		const live = new Set(this.pool.live(t).map((v) => v.id));
		for (const id of this.voices.keys())
			if (!live.has(id)) this.voices.delete(id);
		if (!admission.admitted) return;
		const voice = this.ctx.createGain();
		voice.gain.value = 1;
		voice.connect(this.buses[bus]);
		this.voices.set(admission.id, voice);
		switch (cue.kind) {
			case "laser":
				return this.laser(voice);
			case "shieldHit":
			case "hullHit":
				return this.hit(voice);
			case "explosion":
				return this.explosion(voice);
			case "dock":
				return this.dock(voice);
			case "alert":
				return this.alert(voice);
			case "scoop":
				return this.scoop(voice);
			case "ui":
				return this.ui(voice);
		}
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
	 *
	 * It plays through the **ship** bus, and a muted bus fades it there; the bed
	 * keeps following the throttle underneath, so an unmute comes back at the
	 * level the drive is at rather than the one it was at.
	 */
	ambient(level: number) {
		if (!this.ctx || !this.buses) return;
		const want = Math.min(1, Math.max(0, level));
		if (!this.bed) {
			// nothing to hear; don't build the graph yet
			if (want <= 0 || !this.audible("ship")) return;
			this.bed = this.makeBed(this.ctx, this.buses.ship);
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
	private makeBed(ctx: BaseAudioContext, out: AudioNode) {
		const seconds = 2;
		const len = Math.floor(ctx.sampleRate * seconds);
		const fade = Math.floor(ctx.sampleRate * 0.05);
		const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
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
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		src.loop = true;
		const filter = ctx.createBiquadFilter();
		filter.type = "lowpass";
		filter.frequency.value = 180;
		filter.Q.value = 0.6;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		src.connect(filter);
		filter.connect(gain);
		gain.connect(out);
		src.start();
		return { gain, filter };
	}

	/** One oscillator note into `out`. Every argument after `type` is what the
	 *  primitive was before #552; `out` is now required, because every sound has
	 *  a bus and a voice to go through. */
	private tone(
		out: AudioNode,
		freq: number,
		dur: number,
		type: OscillatorType,
		vol = 0.3,
		slideTo?: number,
	) {
		if (!this.ctx) return;
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
		g.connect(out);
		osc.start(t);
		osc.stop(t + dur + 0.05);
	}

	/** A decaying burst of filtered white noise into `out`. */
	private noiseBurst(out: AudioNode, dur: number, vol = 0.3, filterFreq = 800) {
		if (!this.ctx) return;
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
		g.connect(out);
		src.start(t);
	}

	/*
	 * The cue list: what each cue sounds like, reached only through `play`.
	 *
	 * Placeholders in the sense that the *sounds* are unresolved — #544, #545
	 * and #546 design them — but not in the sense that they are throwaway: a
	 * caller names a cue and never learns what an oscillator is. #552 moved
	 * them behind `play` and changed no figure in them.
	 */
	/** Pulse laser: a short descending zap. */
	private laser(out: AudioNode) {
		this.tone(out, 880, 0.14, "square", 0.14, 180);
		this.noiseBurst(out, 0.08, 0.12, 3000);
	}
	/** A hit taken or landed on hull — thud, no debris. */
	private hit(out: AudioNode) {
		this.noiseBurst(out, 0.22, 0.35, 900);
		this.tone(out, 120, 0.2, "triangle", 0.2, 70);
	}
	/** A ship coming apart. */
	private explosion(out: AudioNode) {
		this.noiseBurst(out, 0.8, 0.5, 500);
		this.tone(out, 70, 0.6, "sine", 0.4, 30);
	}
	/** Docking clamps engaging. */
	private dock(out: AudioNode) {
		this.tone(out, 160, 0.18, "sine", 0.25, 240);
		this.noiseBurst(out, 0.12, 0.18, 600);
	}
	/**
	 * Witchspace entry: a rising sweep into nothing.
	 *
	 * #195's D3 places it: it starts `sweepS` before the cut so its top lands on
	 * the cut (`witchspace.ts` owns the schedule). It goes through its own
	 * group so `stopWitchspace` can take it back — a sweep that played on after
	 * a cancelled charge would announce a jump that did not happen.
	 */
	private hyperspace() {
		const out = this.witchspaceGroup("sweep");
		if (!out) return;
		this.tone(out, 90, HYPERSPACE_SWEEP_S, "sawtooth", 0.22, 1400);
		this.noiseBurst(out, 1.2, 0.18, 2200);
	}
	/**
	 * The drive charging: a low hum under the first part of §8's wind-up, before
	 * the sweep takes over (#195's D3). Two detuned low voices rising a fifth,
	 * swelling in and easing out so the hand-off to the sweep is not a step.
	 */
	private chargeHum(seconds: number) {
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
	private stopWitchspace() {
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
	/**
	 * A fresh group for a cue, replacing one still sounding under the same name.
	 * On the **ship** bus (D1), where it once went straight to master.
	 */
	private witchspaceGroup(cue: "hum" | "sweep"): GainNode | null {
		if (!this.ctx || !this.buses) return null;
		this.witchspaceGroups.get(cue)?.disconnect();
		const group = this.ctx.createGain();
		group.gain.value = 1;
		group.connect(this.buses.ship);
		this.witchspaceGroups.set(cue, group);
		return group;
	}

	/** Something is wrong — low fuel, incoming missile, hull critical. */
	private alert(out: AudioNode) {
		this.tone(out, 660, 0.12, "square", 0.16);
		this.tone(out, 440, 0.12, "square", 0.16);
	}
	/** A canister taken into the hold: a short rising chime, so a scoop is heard
	 *  as a gain rather than as the thud of something hitting the hull. */
	private scoop(out: AudioNode) {
		this.tone(out, 320, 0.1, "triangle", 0.16, 720);
		this.tone(out, 720, 0.12, "sine", 0.1, 960);
	}
	/** A button, a menu, a market row. */
	private ui(out: AudioNode) {
		this.tone(out, 520, 0.06, "square", 0.12);
	}
}
