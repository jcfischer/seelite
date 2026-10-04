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
	type WeaponMix,
	CUE_BUS,
	CUE_VOICE,
	type Cue,
	type CueBus,
	type CueKind,
	type FlashVoice,
	type FlightMix,
	type HitPool,
	type HullHitVoice,
	type NotifyTone,
	type PunchVoice,
	type SweepSwallow,
	VOICE_CAPS,
	VOICE_MIX_CAP,
	VOICE_PRIORITY,
	VOICE_STEAL_FADE_S,
	type VoiceClass,
	type VoicedCueKind,
} from "./audio-cue";
import { VoicePool } from "./voice-pool";

/**
 * The witchspace sweep's length, seconds. Owned here, beside the cue, and read by
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

/** The buses a spoken line plays through (#600): comms on the console, a
 *  voice in the music on the music bus. */
export type SpeechBus = "console" | "music";

/** A far-off voice's room (#600): its level, and an echo that darkens as it
 *  repeats. */
export interface SpeechSpace {
	readonly level: number;
	readonly echoS: number;
	readonly feedback: number;
}
const SPEECH_ECHO_LOWPASS_HZ = 1800;
/** The longest a far-off voice's echo is kept connected after its line. */
export const SPEECH_ECHO_MAX_TAIL_S = 10;

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

/** A duck of `db` decibels as a gain: 0 dB is 1, 6 dB about a half. */
export const duckGain = (db: number): number => 10 ** (-db / 20);

/** How fast a duck eases in and out: about a second to settle, so the
 *  engine sinks under the waltz rather than dropping (#603). */
const DUCK_TAU_S = 0.3;

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
 *
 * **Two things it does do, measured on Chromium (#552).** Every cue reaches
 * the speakers **6 ms later**: the node's fixed look-ahead. The capture at
 * `origin/main` and at #552 renders every cue to within one 16-bit step of
 * the other once shifted by exactly 288 samples at 48 kHz. And for about the
 * **first tenth of a second of a context's life** it attenuates whatever
 * plays: a laser at the context's first sample rendered at 0.43 of its level,
 * 0.68 at 20 ms in, and 1.0000 from 100 ms on. The realtime context opens on
 * the player's first gesture, and that gesture is a likely moment for a cue —
 * a first shot on Space — so the first cue of a session can be the quieter
 * one. No probe covers that window: every render here starts half a second
 * in. It is a case for the ear, flown.
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
 * These are the `thin` voices'; `HEAVY_CUE_LENGTH_S` overrides the ones the
 * heavy arm lengthens (#577), so thin holds its voices exactly as long as it
 * did before.
 */
export const CUE_LENGTH_S: Readonly<Record<VoicedCueKind, number>> = {
	laser: 0.19,
	// #545's voices: the longest of each kind's variants, with its tail.
	gunLocked: 0.1,
	shieldHit: 0.32,
	hullHit: 0.45,
	hitLanded: 0.15,
	explosion: 0.8,
	dock: 0.23,
	alert: 0.17,
	scoop: 0.17,
	ui: 0.11,
	// #546's console voices: each tone's last start plus its ring.
	notify: 0.45,
	press: 0.08,
	refuse: 0.25,
	focus: 0.07,
};

/** The pooled cues the heavy arm rings longer than thin (#577): the
 *  explosion's rumble and the dock's second clamp. */
export const HEAVY_CUE_LENGTH_S: Readonly<
	Partial<Record<VoicedCueKind, number>>
> = {
	explosion: 1.75,
	dock: 0.36,
};

/**
 * How much of each weighted cue feeds its bus's reverb on the heavy arm
 * (#577): the tail the principal asked for after the first listen. A landed
 * hit sends more than its dry level would suggest, because further off is
 * wetter; the crack sends least, because it repeats and a crowded tail is mud.
 * The console cues and every loop send nothing.
 */
export const REVERB_SEND: Readonly<Partial<Record<CueKind, number>>> = {
	explosion: 0.7,
	witchspaceFlash: 0.7,
	hullHit: 0.45,
	cruiseEngage: 0.4,
	cruiseDrop: 0.35,
	dock: 0.35,
	hitLanded: 0.35,
	shieldHit: 0.25,
	laser: 0.15,
};

/**
 * The reverb's impulse (#577), after the trailer's hall: noise that darkens
 * as it decays, falling by `e` every `decayS` (so about 60 dB in
 * `6.9 × decayS`), after a short pre-delay so the tail stands apart from
 * the hit. Two channels, drawn separately, so the realtime context hears it
 * wide.
 *
 * **Scaled here so its squares sum to one, with the node's own normalisation
 * off.** The
 * first cut left `normalize` on and shaped the decay by `(1 - x) ^ 3.2`:
 * the node turned the impulse far down, the shape was dead by two seconds,
 * and the tail after a heavy explosion read about −80 dB. Scaled so, a
 * send's gain is the tail's rms against the hit's, for a broadband hit.
 */
export const REVERB = {
	seconds: 3,
	preDelayS: 0.012,
	decayS: 0.5,
	brightness: 0.6,
} as const;

/** How long a pooled cue rings on an arm, s: the pool's end time for it. */
export const cueLengthS = (kind: VoicedCueKind, punch: PunchVoice): number =>
	(punch === "heavy" ? HEAVY_CUE_LENGTH_S[kind] : undefined) ??
	CUE_LENGTH_S[kind];

type CueBuses = Record<Exclude<Bus, "master">, GainNode>;

/** The witchspace voices, each behind a gain of its own so a stop reaches it:
 *  #195's two before the cut and #534's four after it. */
type WitchspaceVoice = "hum" | "sweep" | "flash" | "ride" | "unfold" | "rift";

export class AudioFX {
	/**
	 * How much weight the one-shots carry (#577, `?punch=`): `heavy` gives
	 * every impact a body, `thin` is the sound before #577. Read as each cue
	 * is built, so a change reaches the next cue and never one already sounding.
	 * The loops and the console cues do not read it.
	 */
	punch: PunchVoice;

	constructor(punch: PunchVoice = "heavy") {
		this.punch = punch;
	}

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
	/** Each cue bus's duck, in dB (#603): the game's, under the player's row. */
	private readonly ducks: Record<Exclude<Bus, "master">, number> = {
		ship: 0,
		combat: 0,
		console: 0,
		music: 0,
	};
	/** A cue bus's gain: the player's step, then the game's duck. */
	private busValue(bus: Exclude<Bus, "master">): number {
		return busGain(bus, this.levels[bus]) * duckGain(this.ducks[bus]);
	}

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

	/**
	 * Must be called after a user gesture to unlock audio. Answers the
	 * `resume()` it started, if it started one: the context's state changes
	 * when that settles, not inside the call (node #550).
	 */
	ensure(): Promise<void> | undefined {
		if (!this.live) {
			const AC = window.AudioContext || (window as any).webkitAudioContext;
			if (!AC) return undefined;
			this.live = new AC() as AudioContext;
			this.attach(this.live);
		}
		if (this.live.state === "suspended") return this.live.resume();
		return undefined;
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
			g.gain.value = this.busValue(name);
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

	/** Per bus, when the line speaking now ends and the line waiting behind
	 *  it (#600). */
	private readonly spoken = new Map<
		SpeechBus,
		{
			speakingEnds: number;
			waiting: { src: AudioBufferSourceNode; from: number; len: number } | null;
		}
	>();

	/**
	 * Play a rendered speech line through `bus` (#600): comms on the console
	 * bus, where the ship's instruments speak (D1), and a far-off voice in the
	 * music on the music bus, through `space`'s echo. Every node is built here
	 * and ends on a bus, so the rows the player sets are still the only levels.
	 *
	 * One line speaks at a time per bus. A line that arrives while one speaks
	 * waits for its end, and a newer waiting line replaces the older, so a burst
	 * of answers says the latest rather than a backlog.
	 *
	 * Returns the line's length, s, or `null` before there is a context.
	 */
	speak(
		samples: Float32Array,
		sampleRate: number,
		bus: SpeechBus = "console",
		space?: SpeechSpace,
	): number | null {
		const ctx = this.ctx;
		const buses = this.buses;
		if (!ctx || !buses) return null;
		const buf = ctx.createBuffer(1, samples.length, sampleRate);
		buf.getChannelData(0).set(samples);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		const out = buses[bus];
		if (space) this.room(ctx, src, out, space);
		else src.connect(out);
		const len = samples.length / sampleRate;
		src.start(this.queueLine(bus, src, len, ctx.currentTime));
		return len;
	}

	/** A far-off voice's room between `src` and `out`: quieter, and mostly
	 *  its own echo, darkening as it repeats. */
	private room(
		ctx: BaseAudioContext,
		src: AudioBufferSourceNode,
		out: AudioNode,
		space: SpeechSpace,
	) {
		const level = ctx.createGain();
		level.gain.value = space.level;
		const delay = ctx.createDelay(2);
		delay.delayTime.value = space.echoS;
		const tone = ctx.createBiquadFilter();
		tone.type = "lowpass";
		tone.frequency.value = SPEECH_ECHO_LOWPASS_HZ;
		const fb = ctx.createGain();
		fb.gain.value = space.feedback;
		src.connect(level);
		level.connect(out);
		level.connect(delay);
		delay.connect(tone);
		tone.connect(fb);
		fb.connect(delay);
		tone.connect(out);
		// A loop never falls silent on its own terms, so it is taken apart
		// once the line has ended and the echo has fallen 60 dB — and never
		// later than `SPEECH_ECHO_MAX_TAIL_S`: at a feedback of 1 it would
		// never fall at all.
		const fb1 = Math.min(0.99, Math.max(1e-3, space.feedback));
		const tailS = Math.min(
			SPEECH_ECHO_MAX_TAIL_S,
			(space.echoS * Math.log(1e-3)) / Math.log(fb1),
		);
		src.onended = () =>
			setTimeout(() => {
				for (const n of [level, delay, tone, fb]) n.disconnect();
			}, tailS * 1000);
	}

	/** When a line of `len` s on `bus` starts, asked for at `now`: after the
	 *  one speaking, replacing a line still waiting. */
	private queueLine(
		bus: SpeechBus,
		src: AudioBufferSourceNode,
		len: number,
		now: number,
	): number {
		const slot = this.spoken.get(bus) ?? { speakingEnds: 0, waiting: null };
		let from: number;
		if (slot.waiting && slot.waiting.from > now) {
			slot.waiting.src.stop();
			from = slot.waiting.from;
		} else {
			if (slot.waiting)
				slot.speakingEnds = Math.max(
					slot.speakingEnds,
					slot.waiting.from + slot.waiting.len,
				);
			from = Math.max(now, slot.speakingEnds);
		}
		if (from > now) slot.waiting = { src, from, len };
		else {
			slot.speakingEnds = from + len;
			slot.waiting = null;
		}
		this.spoken.set(bus, slot);
		return from;
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
	 * The context the engine is built into, once there is one: what the music
	 * synth (#560) loads its worklet into, and for that only. A node built in
	 * it and connected anywhere but a bus is a level beside the settings rows,
	 * which #542 D1 rules out; the synth connects to `musicInput` and nowhere
	 * else (`tests/music-controller.test.ts`).
	 */
	get context(): BaseAudioContext | null {
		return this.ctx;
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
			bus === "master" ? busGain(bus, this.levels[bus]) : this.busValue(bus),
			this.ctx.currentTime,
			0.03,
		);
	}

	/**
	 * Duck a cue bus by `db` under something the game is playing over it —
	 * the ship bus under the docking computer's waltz (#603, #547 D5); 0 lets
	 * it back. Called every frame, and written on change only.
	 *
	 * A duck is the game's, not the player's: it multiplies the bus's row and
	 * never moves it, so the Sound tab still reads what the player set.
	 */
	duck(bus: Exclude<Bus, "master">, db: number) {
		if (this.ducks[bus] === db) return;
		this.ducks[bus] = db;
		const node = this.buses?.[bus];
		if (!node || !this.ctx) return;
		node.gain.setTargetAtTime(
			this.busValue(bus),
			this.ctx.currentTime,
			DUCK_TAU_S,
		);
	}

	/** Whether a cue on `bus` can be heard at all. A cue that cannot is not
	 *  built, as a muted one was not before #552. */
	audible(bus: Bus): boolean {
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
		// Before the mute check, as the stop is: it ends a ride already
		// sounding, which a mute has faded and not stopped.
		if (cue.kind === "witchspaceRideClose") {
			this.witchspaceRideClose(cue.seconds);
			return;
		}
		const bus = CUE_BUS[cue.kind];
		if (!this.audible(bus)) return;
		if (cue.kind === "witchspaceHum") {
			this.chargeHum(cue.seconds);
			return;
		}
		if (cue.kind === "witchspaceSweep") {
			if (cue.riseS === undefined) this.witchspaceSweep();
			else this.witchspaceRise(cue.riseS, cue.swallow);
			return;
		}
		if (cue.kind === "witchspaceFlash") {
			this.witchspaceFlash(cue.voice);
			return;
		}
		if (cue.kind === "witchspaceRide") {
			this.witchspaceRide(cue);
			return;
		}
		if (cue.kind === "witchspaceUnfold" || cue.kind === "witchspaceRift") {
			const render = (out?: AudioNode, finished?: () => void) =>
				cue.kind === "witchspaceRift"
					? this.witchspaceRift(cue.seconds, out, finished)
					: this.witchspaceUnfold(cue.seconds, out, finished);
			if (cue.spatial) {
				const gain = this.ctx.createGain(),
					pan = this.ctx.createStereoPanner();
				gain.gain.value = cue.spatial.gain;
				pan.pan.value = cue.spatial.pan;
				gain.connect(pan);
				pan.connect(this.sending(cue.kind));
				render(gain, () => {
					gain.disconnect();
					pan.disconnect();
				});
			} else render();
			return;
		}
		if (cue.kind === "cruiseEngage") {
			this.cruiseEngage(this.sending(cue.kind));
			return;
		}
		if (cue.kind === "cruiseDrop") {
			this.cruiseDrop(this.sending(cue.kind));
			return;
		}
		const t = this.ctx.currentTime;
		const admission = this.pool.admit(
			CUE_VOICE[cue.kind],
			t,
			t + cueLengthS(cue.kind, this.punch),
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
		this.sendToReverb(voice, bus, cue.kind);
		this.voices.set(admission.id, voice);
		switch (cue.kind) {
			case "laser":
				return cue.voice === "pew" ? this.laser(voice) : this.crack(voice);
			case "gunLocked":
				return this.gunLocked(voice);
			case "shieldHit":
				return this.shieldHit(voice, cue.pool, cue.share, cue.sided);
			case "hullHit":
				return this.hullHit(voice, cue.voice);
			case "hitLanded":
				return this.hitLanded(voice, cue.on);
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
			case "notify":
				return this.notify(voice, cue.tone);
			case "press":
				return this.press(voice);
			case "refuse":
				return this.refuse(voice);
			case "focus":
				return this.focus(voice);
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

	/** The combat loops (#545), built on the first step that has any to play. */
	private weaponGraph: WeaponGraph | null = null;
	/** Each combat level as last **written**, for the reason `flightWritten`
	 *  gives, and what a probe reads. */
	private readonly weaponWritten: {
		-readonly [K in keyof WeaponMix]?: number;
	} = {};

	/**
	 * Hold the combat loops at one step's levels (#545): the sustained beam
	 * while the gun fires, and a held enemy beam sizzling on each shield pool.
	 * `weapon-sound.ts` computes the mix. On the **combat** bus, written on
	 * change like `flight`, and nothing is built before a level is non-zero.
	 *
	 * The beam's onset is a discharge, played here and not as a cue: it is the
	 * loop's own attack, and it belongs to the edge the loop sees.
	 */
	weapons(mix: WeaponMix) {
		if (!this.ctx || !this.buses) return;
		const t = this.ctx.currentTime;
		const loud = mix.beam + mix.sizzleFore + mix.sizzleAft > 0;
		// Torn down once every loop has been silent a while (sage round 1), and
		// at once on a muted bus (round 2): the graph is ten running sources,
		// and a fight is short beside a session. The written levels are kept,
		// all zero, which is what a fresh graph's gains hold, so a rebuild
		// writes only what moves.
		if (!this.audible("combat")) {
			this.dropWeaponGraph();
			return;
		}
		if (loud) this.weaponLoudAt = t;
		else if (t - this.weaponLoudAt > WEAPON_IDLE_S) {
			this.dropWeaponGraph();
			return;
		}
		if (!this.weaponGraph) {
			if (!loud) return;
			this.weaponGraph = this.makeWeaponGraph(this.ctx, this.buses.combat);
		}
		const g = this.weaponGraph;
		const w = this.weaponWritten;
		const moved = (k: keyof WeaponMix) => {
			const had = w[k];
			const due =
				had === undefined ||
				(mix[k] === 0 && had !== 0) ||
				Math.abs(mix[k] - had) >= 0.005;
			if (due) w[k] = mix[k];
			return due;
		};
		const wasFiring = (w.beam ?? 0) > 0;
		if (moved("beam")) {
			// Quick in, a little slower out: a beam cut off rings for a moment.
			g.beam.gain.setTargetAtTime(0.11 * mix.beam, t, mix.beam ? 0.012 : 0.05);
			if (mix.beam > 0 && !wasFiring) this.discharge(this.buses.combat, 0.6);
		}
		if (moved("heat")) {
			const h = mix.heat;
			g.whine.frequency.setTargetAtTime(1400 * 2 ** (1.1 * h), t, 0.1);
			g.whineGain.gain.setTargetAtTime(0.012 + 0.12 * h * h, t, 0.1);
			g.beamFilter.frequency.setTargetAtTime(900 + 1400 * h, t, 0.1);
		}
		if (moved("sizzleFore"))
			g.sizzleFore.gain.setTargetAtTime(0.22 * mix.sizzleFore, t, 0.03);
		if (moved("sizzleAft"))
			g.sizzleAft.gain.setTargetAtTime(0.22 * mix.sizzleAft, t, 0.03);
	}

	/** When a weapon loop was last asked for, on the audio clock. */
	private weaponLoudAt = 0;

	/** Stop every weapon source and let the graph go. */
	private dropWeaponGraph() {
		const g = this.weaponGraph;
		if (!g) return;
		for (const src of g.sources) src.stop();
		g.root.disconnect();
		this.weaponGraph = null;
		// A muted bus faded the loops; what was written no longer holds.
		for (const k of Object.keys(this.weaponWritten) as (keyof WeaponMix)[])
			this.weaponWritten[k] = 0;
	}

	private makeWeaponGraph(ctx: BaseAudioContext, bus: AudioNode): WeaponGraph {
		const root = ctx.createGain();
		root.gain.value = 1;
		root.connect(bus);
		const sources: AudioScheduledSourceNode[] = [];
		const gain = (to: AudioNode, value = 0) => {
			const g = ctx.createGain();
			g.gain.value = value;
			g.connect(to);
			return g;
		};
		const filter = (type: BiquadFilterType, hz: number, q: number) => {
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = hz;
			f.Q.value = q;
			return f;
		};
		const osc = (type: OscillatorType, hz: number, to: AudioNode) => {
			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.value = hz;
			o.connect(to);
			o.start();
			sources.push(o);
			return o;
		};
		/** An oscillator swinging `param` by `depth` around its value. */
		const lfo = (
			type: OscillatorType,
			hz: number,
			param: AudioParam,
			depth: number,
		) => {
			const g = ctx.createGain();
			g.gain.value = depth;
			g.connect(param);
			osc(type, hz, g);
		};
		const white = noiseLoop(ctx, "white");
		const loop = (to: AudioNode, offset: number) => {
			const src = ctx.createBufferSource();
			src.buffer = white;
			src.loop = true;
			src.connect(to);
			src.start(0, offset % white.duration);
			sources.push(src);
		};

		// The beam: a low buzz of two detuned saws through a resonant low-pass,
		// a hiss of the discharge riding on it, and a thin whine that heat lifts.
		// A fast shimmer on the body keeps it from reading as a held note.
		const beam = gain(root);
		const shimmer = gain(beam, 0.8);
		lfo("sine", 23, shimmer.gain, 0.2);
		const beamFilter = filter("lowpass", 900, 4);
		beamFilter.connect(shimmer);
		osc("sawtooth", 82, beamFilter);
		osc("sawtooth", 82.7, beamFilter);
		osc("square", 164.3, gain(beamFilter, 0.3));
		const hissBand = filter("bandpass", 2600, 1.4);
		hissBand.connect(gain(shimmer, 0.9));
		loop(hissBand, 0.131);
		const whineGain = gain(beam, 0.012);
		const whine = osc("sine", 1400, whineGain);

		// A held enemy beam on a shield: noise in the pool's band, chopped by
		// two square LFOs at unrelated rates into a crackle. Fore is brighter
		// than aft, as a shield hit is on `sided`.
		const sizzle = (hz: number, offset: number, rates: [number, number]) => {
			const g = gain(root);
			const chop = gain(g, 0.5);
			for (const rate of rates) lfo("square", rate, chop.gain, 0.25);
			const band = filter("bandpass", hz, 1.2);
			band.connect(chop);
			loop(band, offset);
			return g;
		};
		return {
			root,
			sources,
			beam,
			beamFilter,
			whine,
			whineGain,
			sizzleFore: sizzle(3200, 0.577, [31, 47]),
			sizzleAft: sizzle(1500, 1.093, [23, 37]),
		};
	}

	/** The ship's loops (#544), built on the first frame that has any to play. */
	private flightGraph: FlightGraph | null = null;
	/** Each group's levels as last **written** to its gains: what `flight`
	 *  compares a new mix against, and what a probe reads. */
	private readonly flightWritten: Partial<FlightMix> = {};
	/** The audio clock at the last `flight` call: the span clicks are drawn over. */
	private flightAt = -1;
	/** When the loops next wander (`drift`), on the audio clock. */
	private driftAt = 0;

	/**
	 * Hold the ship's loops at one frame's levels (#544): the hum, the drive,
	 * the thrusters, the cruise wind-up and the cruise bed, and draw the hull's
	 * clicks. `flight-sound.ts` computes the mix; this only plays it.
	 *
	 * Called every frame, and like `ambient` it writes a gain **on change**. It
	 * builds nothing until a frame has something to play, and nothing before
	 * there is a context. On the **ship** bus, which fades it on a mute.
	 *
	 * **Clicks are placed here, at random** (#542 D6): the mix carries a mean
	 * rate and the span since the last call is a Poisson draw, so the rate holds
	 * whatever the frame rate. A span longer than a quarter second — a stall, a
	 * tab in the background — is not made up for in a burst.
	 */
	flight(mix: FlightMix) {
		if (!this.ctx || !this.buses) return;
		const t = this.ctx.currentTime;
		const span = this.flightAt < 0 ? 0 : Math.min(0.25, t - this.flightAt);
		this.flightAt = t;
		if (!this.audible("ship")) return;
		if (!this.flightGraph) {
			const any =
				mix.hum +
				mix.drive +
				mix.rcs +
				mix.spool +
				mix.cruise +
				mix.clickRate +
				mix.faintClickRate;
			if (!(any > 0)) return;
			this.flightGraph = this.makeFlightGraph(this.ctx, this.buses.ship);
		}
		const g = this.flightGraph;
		// **Against what was last written, not last frame** (sage round 1). A
		// level that moves less than the threshold every frame — cruise speed
		// through a leg, a three-second spool at 60 fps — never differs from the
		// frame before by enough, so comparing with the frame before froze the
		// bed and the wind-up at their first value. A group's keys are recorded
		// together, when that group is written.
		const w = this.flightWritten;
		const moved = (...keys: (keyof FlightMix)[]) => {
			const due = keys.some((k) => {
				const want = mix[k];
				const had = w[k];
				if (had === undefined) return true;
				// Silence is always written: a loop fading out must reach 0 and
				// not rest a threshold short of it.
				if (want === 0 && had !== 0) return true;
				return typeof want === "number"
					? Math.abs(want - (had as number)) >= 0.005
					: want !== had;
			});
			if (due) for (const k of keys) (w as Record<string, unknown>)[k] = mix[k];
			return due;
		};
		// About the rms of the level the principal settled on after "too loud";
		// noise through narrow bands passes less than the tone it replaced.
		if (moved("hum")) g.hum.gain.setTargetAtTime(0.048 * mix.hum, t, 0.3);
		if (t >= this.driftAt) this.drift(g, t);
		if (moved("drive")) {
			const d = mix.drive;
			g.drive.gain.setTargetAtTime(0.2 * d * d, t, 0.12);
			g.driveFilter.frequency.setTargetAtTime(200 + 900 * d, t, 0.2);
			g.driveTone.gain.setTargetAtTime(0.07 * d * d, t, 0.12);
			for (const [osc, base] of g.driveOscs)
				osc.frequency.setTargetAtTime(base * (1 + 0.3 * d), t, 0.3);
		}
		// Thrusters are quick: a puff starts and stops with the stick.
		if (moved("rcs")) g.rcs.gain.setTargetAtTime(0.16 * mix.rcs, t, 0.025);
		// The wind-up is a turbine spinning up (#544: "too simple" on the first
		// listen): slow to start and quick to finish, so pitch follows s^1.5;
		// a flutter that races from a few beats to a buzz; air rushing through
		// it; a sub that grows under it; and a whine that arrives only near the
		// top.
		if (moved("spool")) {
			const s = mix.spool;
			const lift = s ** 1.5;
			g.spool.gain.setTargetAtTime(s > 0 ? 0.1 * s ** 0.7 : 0, t, 0.05);
			g.spoolFilter.frequency.setTargetAtTime(300 + 3200 * lift, t, 0.05);
			for (const [osc, base] of g.spoolOscs)
				osc.frequency.setTargetAtTime(base * 2 ** (2.5 * lift), t, 0.05);
			g.spoolFlutter.frequency.setTargetAtTime(3 + 30 * s * s, t, 0.05);
			g.spoolAir.gain.setTargetAtTime(0.6 * s * s, t, 0.05);
			g.spoolAirBand.frequency.setTargetAtTime(300 + 3700 * lift, t, 0.05);
			g.spoolSub.gain.setTargetAtTime(1.2 * s, t, 0.05);
			g.spoolSubOsc.frequency.setTargetAtTime(32 + 18 * s, t, 0.05);
			g.spoolWhine.gain.setTargetAtTime(0.25 * s ** 3, t, 0.05);
			g.spoolWhineOsc.frequency.setTargetAtTime(900 + 1700 * lift, t, 0.05);
		}
		// Cruise follows the speed, and quickly: the first listen heard a bed
		// that faded in and out on a third of a second whatever the ship did.
		if (moved("cruise", "cruiseSpeed", "cruiseVoice")) {
			const on = 0.09 * mix.cruise;
			const s = mix.cruiseSpeed;
			const shimmer = mix.cruiseVoice === "shimmer";
			g.shimmer.gain.setTargetAtTime(shimmer ? on : 0, t, 0.15);
			g.throb.gain.setTargetAtTime(shimmer ? 0 : on * 1.3, t, 0.15);
			// Everything below moves with the speed and nothing moves on its
			// own: the second listen found the bed "pulses too much" and heard no
			// change from 1 to 30 c. The speed share has c as its knee
			// (`cruiseSpeedShare`), so that range is most of this travel.
			//
			// The rush under either voice: air that is not there, rising more
			// than four octaves and gaining weight with the speed.
			g.rush.gain.setTargetAtTime(0.1 * mix.cruise * (0.3 + s), t, 0.15);
			g.rushBand.frequency.setTargetAtTime(200 * 2 ** (4.3 * s), t, 0.15);
			// Air above it all, only at the top of the range.
			g.air.gain.setTargetAtTime(0.07 * mix.cruise * s * s, t, 0.15);
			// Shimmer: the band climbs four octaves, and the drone rises an
			// octave and opens from dark to bright.
			g.band.frequency.setTargetAtTime(300 * 2 ** (4 * s), t, 0.15);
			g.droneFilter.frequency.setTargetAtTime(200 + 2300 * s, t, 0.15);
			for (const [osc, base] of g.droneOscs)
				osc.frequency.setTargetAtTime(base * 2 ** s, t, 0.3);
			// Throb: the beat quickens from a slow pulse to a flutter, and the
			// note rises and opens.
			g.beatRate.frequency.setTargetAtTime(0.8 + 4 * s, t, 0.3);
			g.throbFilter.frequency.setTargetAtTime(140 + 600 * s, t, 0.15);
			for (const [osc, base] of g.throbOscs)
				osc.frequency.setTargetAtTime(base * (1 + 0.7 * s), t, 0.3);
		}
		// Two layers, on the principal's first listen: loud clicks that react,
		// over faint ones at a sparse steady rate.
		if (span > 0 && Math.random() < 1 - Math.exp(-mix.clickRate * span))
			this.click(this.buses.ship, t + Math.random() * 0.02, 1);
		if (span > 0 && Math.random() < 1 - Math.exp(-mix.faintClickRate * span))
			this.click(this.buses.ship, t + Math.random() * 0.02, 0.3);
	}

	/**
	 * Let the hum and the cruise bed wander (#544): a new random target every
	 * few seconds for the hum's level, colour and pitch and for the cruise
	 * bed's level, each reached slowly. The first listen found the hum "too
	 * uniform": two fixed LFOs are a period, and an ear finds a period.
	 */
	private drift(g: FlightGraph, t: number) {
		this.driftAt = t + 1.5 + Math.random() * 4;
		g.humSwell.gain.setTargetAtTime(0.55 + Math.random() * 0.6, t, 1.8);
		g.humFilter.frequency.setTargetAtTime(170 + Math.random() * 250, t, 2);
		g.pumpRate.frequency.setTargetAtTime(1 + Math.random() * 0.7, t, 3);
		g.fanRate.frequency.setTargetAtTime(9 + Math.random() * 4, t, 3);
		// Narrow and slow: a wider, quicker swell read as pulsing.
		g.cruiseSwell.gain.setTargetAtTime(0.92 + Math.random() * 0.12, t, 3);
	}

	private makeFlightGraph(ctx: BaseAudioContext, out: AudioNode): FlightGraph {
		const gain = (to: AudioNode) => {
			const g = ctx.createGain();
			g.gain.value = 0;
			g.connect(to);
			return g;
		};
		const filter = (type: BiquadFilterType, hz: number, q: number) => {
			const f = ctx.createBiquadFilter();
			f.type = type;
			f.frequency.value = hz;
			f.Q.value = q;
			return f;
		};
		const osc = (type: OscillatorType, hz: number, to: AudioNode) => {
			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.value = hz;
			o.connect(to);
			o.start();
			return o;
		};
		// Two noise buffers for the whole graph, each tapped at its own point
		// (sage round 2: four were filled on the first flight frame). Taps a
		// prime fraction of a second apart keep the loops that share a buffer
		// from moving in step, which they did when each started at zero.
		let taps = 0;
		const loop = (buffer: AudioBuffer, to: AudioNode) => {
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			src.loop = true;
			src.connect(to);
			src.start(0, (taps++ * 0.377) % buffer.duration);
		};
		const brown = noiseLoop(ctx, "brown");
		const white = noiseLoop(ctx, "white");

		// The hum is **machinery**, not mains: the first cut was a 48 Hz
		// sawtooth and its octave, which the principal heard as "too electric".
		// Now it is noise through the hull's low resonances, a pump churning at
		// about a beat a second and a fan's whirr, with no pitched tone in it.
		// Two breaths at unrelated rates, and `drift` moving level, colour and
		// the pump and fan rates at random on top: never one period an ear can
		// lock onto.
		const hum = gain(out);
		const humSwell = ctx.createGain();
		humSwell.gain.value = 1;
		humSwell.connect(hum);
		const humBody = ctx.createGain();
		humBody.gain.value = 1;
		humBody.connect(humSwell);
		const humFilter = filter("lowpass", 260, 0.7);
		humFilter.connect(humBody);
		// The hull's resonances: narrow bands of the brown noise, a plate ringing at
		// each. Gains lift the narrower bands, which pass less.
		for (const [hz, q, level] of [
			[62, 1.6, 1],
			[138, 3, 0.8],
			[231, 4.5, 0.6],
		]) {
			const band = filter("bandpass", hz, q);
			const g = ctx.createGain();
			g.gain.value = level;
			band.connect(g);
			g.connect(humFilter);
			loop(brown, band);
		}
		// The pump: a low band of the brown noise, churned by a slow beat.
		const pumpBand = filter("bandpass", 90, 1.5);
		const pump = ctx.createGain();
		pump.gain.value = 0.9;
		pumpBand.connect(pump);
		pump.connect(humFilter);
		loop(brown, pumpBand);
		const churn = ctx.createGain();
		churn.gain.value = 0.7;
		churn.connect(pump.gain);
		const pumpRate = osc("sine", 1.3, churn);
		// The fan: a faint whirr, beating at its blade rate. After the lowpass
		// the hum's colour drift sweeps over it, so it comes and goes.
		const fanBand = filter("bandpass", 420, 6);
		const fan = ctx.createGain();
		fan.gain.value = 0.5;
		fanBand.connect(fan);
		fan.connect(humBody);
		loop(white, fanBand);
		const blades = ctx.createGain();
		blades.gain.value = 0.4;
		blades.connect(fan.gain);
		const fanRate = osc("sine", 11, blades);
		for (const [rate, depth] of [
			[0.13, 0.22],
			[0.047, 0.18],
		]) {
			const breath = ctx.createGain();
			breath.gain.value = depth;
			breath.connect(humBody.gain);
			osc("sine", rate, breath);
		}

		// The drive: the brown noise the old bed was, plus a low tone that
		// rises with the burn, so full thrust is a note and not only a roar.
		const drive = gain(out);
		const driveFilter = filter("lowpass", 200, 0.6);
		driveFilter.connect(drive);
		loop(brown, driveFilter);
		const driveTone = gain(out);
		const toneFilter = filter("lowpass", 420, 0.9);
		toneFilter.connect(driveTone);
		const driveOscs: [OscillatorNode, number][] = [
			[osc("sawtooth", 38, toneFilter), 38],
			[osc("sawtooth", 57.4, toneFilter), 57.4],
		];

		// The thrusters: a hiss of gas, band-passed high.
		const rcs = gain(out);
		const rcsFilter = filter("bandpass", 2600, 0.9);
		rcsFilter.connect(rcs);
		loop(white, rcsFilter);

		// The cruise wind-up: a turbine spinning up (`flight` says how).
		const spool = gain(out);
		const spoolBody = ctx.createGain();
		spoolBody.gain.value = 0.7;
		spoolBody.connect(spool);
		const spoolFilter = filter("lowpass", 300, 2.5);
		spoolFilter.connect(spoolBody);
		const spoolOscs: [OscillatorNode, number][] = [
			[osc("sawtooth", 55, spoolFilter), 55],
			[osc("sawtooth", 55.6, spoolFilter), 55.6],
			[osc("square", 110.3, spoolFilter), 110.3],
		];
		const flutterDepth = ctx.createGain();
		flutterDepth.gain.value = 0.3;
		flutterDepth.connect(spoolBody.gain);
		const spoolFlutter = osc("sine", 3, flutterDepth);
		const spoolAir = gain(spool);
		const spoolAirBand = filter("bandpass", 300, 1.2);
		spoolAirBand.connect(spoolAir);
		loop(white, spoolAirBand);
		const spoolSub = gain(spool);
		const spoolSubOsc = osc("sine", 32, spoolSub);
		const spoolWhine = gain(spool);
		const spoolWhineOsc = osc("sine", 900, spoolWhine);

		// Cruise: both voices and the rush go through one swell, which `drift`
		// moves, so the bed breathes rather than holding one level.
		const cruiseSwell = ctx.createGain();
		cruiseSwell.gain.value = 1;
		cruiseSwell.connect(out);

		// The rush: wide-band noise whose pitch rises with the speed.
		const rush = gain(cruiseSwell);
		const rushBand = filter("bandpass", 250, 0.8);
		rushBand.connect(rush);
		loop(white, rushBand);

		// Cruise, shimmer: a swept band of noise over an open fifth, both rising
		// with the speed.
		const shimmer = gain(cruiseSwell);
		const band = filter("bandpass", 350, 5);
		band.connect(shimmer);
		loop(white, band);
		// No sweep on the band: a ±500-cent sweep was the wah the second
		// listen heard as pulsing. The drone is exact ratios for the same
		// reason — a partial a fraction of a hertz off beats against the others.
		const drone = ctx.createGain();
		drone.gain.value = 0.22;
		drone.connect(shimmer);
		const droneFilter = filter("lowpass", 200, 0.7);
		droneFilter.connect(drone);
		const droneOscs: [OscillatorNode, number][] = [55, 82.5, 110].map((hz) => [
			osc("sawtooth", hz, droneFilter),
			hz,
		]);
		// Air: a high hiss that only the top of the speed range lets in.
		const air = gain(cruiseSwell);
		const airFilter = filter("highpass", 6000, 0.7);
		airFilter.connect(air);
		loop(white, airFilter);

		// Cruise, throb: a low pulse, as if the drive were beating through the
		// hull, quickening with the speed.
		const throb = gain(cruiseSwell);
		const pulse = ctx.createGain();
		pulse.gain.value = 0.55;
		pulse.connect(throb);
		const throbFilter = filter("lowpass", 140, 0.8);
		throbFilter.connect(pulse);
		const throbOscs: [OscillatorNode, number][] = [
			[osc("sawtooth", 41, throbFilter), 41],
			[osc("sine", 41.3, throbFilter), 41.3],
		];
		const beat = ctx.createGain();
		// Shallow: the throb is a beat under the bed, not a tremolo on it.
		beat.gain.value = 0.18;
		beat.connect(pulse.gain);
		const beatRate = osc("sine", 0.9, beat);

		return {
			hum,
			humSwell,
			humFilter,
			pumpRate,
			fanRate,
			drive,
			driveFilter,
			driveTone,
			driveOscs,
			rcs,
			spool,
			spoolFilter,
			spoolOscs,
			spoolFlutter,
			spoolAir,
			spoolAirBand,
			spoolSub,
			spoolSubOsc,
			spoolWhine,
			spoolWhineOsc,
			shimmer,
			band,
			droneFilter,
			droneOscs,
			air,
			throb,
			throbFilter,
			throbOscs,
			beatRate,
			rush,
			rushBand,
			cruiseSwell,
		};
	}

	/**
	 * One click of a working hull (#544): a few milliseconds of band-passed
	 * noise at a random pitch and level, now and then a low knock instead.
	 * Unpooled: `flight` draws them at a few a second at most, so there is no
	 * burst for a cap to hold.
	 */
	private click(out: AudioNode, at: number, loudness: number) {
		if (!this.ctx) return;
		const ctx = this.ctx;
		if (Math.random() < 0.3) {
			const o = ctx.createOscillator();
			const g = ctx.createGain();
			o.type = "sine";
			o.frequency.value = 180 + Math.random() * 140;
			g.gain.setValueAtTime(0.0001, at);
			g.gain.exponentialRampToValueAtTime(
				(0.06 + Math.random() * 0.05) * loudness,
				at + 0.004,
			);
			g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
			o.connect(g);
			g.connect(out);
			o.start(at);
			o.stop(at + 0.08);
			return;
		}
		const dur = 0.004 + Math.random() * 0.008;
		const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
		const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < len; i++)
			data[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const src = ctx.createBufferSource();
		src.buffer = buffer;
		const f = ctx.createBiquadFilter();
		f.type = "bandpass";
		f.frequency.value = 1500 + Math.random() * 3500;
		f.Q.value = 8;
		const g = ctx.createGain();
		g.gain.value = (0.25 + Math.random() * 0.35) * loudness;
		src.connect(f);
		f.connect(g);
		g.connect(out);
		src.start(at);
	}

	/**
	 * Cruise engaging (#544): a rising rush, then the boom as the drive takes
	 * hold. **Up, then a punch** — the drop is the mirror, a punch then down.
	 * The first listen found the two "not distinct enough" when both fell.
	 */
	private cruiseEngage(out: AudioNode) {
		this.tone(out, 60, 0.5, "sawtooth", 0.07, 900);
		this.tone(out, 120, 0.5, "triangle", 0.05, 1800);
		this.noiseBurst(out, 0.45, 0.1, 2500);
		const boom = 0.45;
		if (this.punch === "heavy") {
			// #577: the boom as an impact — a punch and a sub with a floor
			// under the same click and air, where the thin boom fell to 35 Hz.
			this.impactPunch(out, {
				from: 150,
				to: 50,
				dur: 0.16,
				level: 0.4,
				drive: 3,
				delayS: boom,
			});
			this.sub(out, { from: 110, to: 42, len: 0.9, level: 0.4, delayS: boom });
			this.wash(out, {
				vol: 0.3,
				fromHz: 6000,
				toHz: 300,
				len: 0.6,
				delayS: boom,
			});
			this.noiseBurst(out, 0.5, 0.3, 400, boom);
			this.tone(out, 2400, 0.08, "triangle", 0.06, 1200, boom);
			return;
		}
		this.tone(out, 110, 0.9, "sine", 0.4, 35, boom);
		this.noiseBurst(out, 0.5, 0.3, 400, boom);
		this.tone(out, 2400, 0.08, "triangle", 0.06, 1200, boom);
	}
	/** Dropping out of cruise (#544): a sharp pop, then a long fall to a soft
	 *  thud as the ship settles into normal flight. */
	private cruiseDrop(out: AudioNode) {
		this.noiseBurst(out, 0.15, 0.25, 3000);
		this.tone(out, 60, 0.25, "sine", 0.3, 40);
		this.tone(out, 900, 1, "sawtooth", 0.08, 50);
		this.tone(out, 220, 0.9, "sine", 0.12, 55);
		this.tone(out, 70, 0.3, "sine", 0.18, 40, 0.8);
		if (this.punch !== "heavy") return;
		// #577: the pop is a hit, and the settle lands.
		this.snap(out, 0.3, 2500);
		this.impactPunch(out, {
			from: 150,
			to: 48,
			dur: 0.14,
			level: 0.35,
			drive: 3,
		});
		this.impactPunch(out, {
			from: 100,
			to: 45,
			dur: 0.18,
			level: 0.25,
			drive: 2.5,
			delayS: 0.8,
		});
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
		delayS = 0,
	) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime + delayS;
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
	private noiseBurst(
		out: AudioNode,
		dur: number,
		vol = 0.3,
		filterFreq = 800,
		delayS = 0,
	) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime + delayS;
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
	/** Pulse laser: a short descending zap. The `pew` voice since #545, which
	 *  the principal rejected as *pew pew*. */
	private laser(out: AudioNode) {
		this.tone(out, 880, 0.14, "square", 0.14, 180);
		this.noiseBurst(out, 0.08, 0.12, 3000);
	}
	/** A hit taken or landed on hull — thud, no debris. The `thud` hull voice
	 *  since #545. */
	private hit(out: AudioNode) {
		this.noiseBurst(out, 0.22, 0.35, 900);
		this.tone(out, 120, 0.2, "triangle", 0.2, 70);
	}

	/** A short burst of band-passed noise into `out`. */
	private bandBurst(
		out: AudioNode,
		dur: number,
		vol: number,
		hz: number,
		q: number,
		delayS = 0,
	) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime + delayS;
		const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
		const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < len; i++)
			data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
		const src = this.ctx.createBufferSource();
		src.buffer = buffer;
		const filter = this.ctx.createBiquadFilter();
		filter.type = "bandpass";
		filter.frequency.value = hz;
		filter.Q.value = q;
		const g = this.ctx.createGain();
		g.gain.value = vol;
		src.connect(filter);
		filter.connect(g);
		g.connect(out);
		src.start(t);
	}

	// The heavy arm's layers (#577), after the trailer's score. Every one ends
	// in an exponential ramp to silence and stops there, so a voice's length is
	// its own and `HEAVY_CUE_LENGTH_S` can cover it.

	/** A sine falling fast from `from` to `to` Hz, driven into a saturator:
	 *  the chest of an impact, and its harmonics are what a small speaker
	 *  hears. `level` is its peak out of the saturator; `drive` is how much
	 *  it is rounded off, which is how many harmonics it gains. */
	private impactPunch(
		out: AudioNode,
		{
			from,
			to,
			dur,
			level,
			drive,
			delayS = 0,
		}: {
			from: number;
			to: number;
			dur: number;
			level: number;
			drive: number;
			delayS?: number;
		},
	) {
		this.drivenSine(out, {
			from,
			to,
			sweepS: dur * 0.5,
			attackS: 0.003,
			dur,
			level,
			drive,
			delayS,
		});
	}
	/** A sine held at `hz`, driven: a thump with no pitch to fall. `level`
	 *  and `drive` as `impactPunch`'s. */
	private thump(
		out: AudioNode,
		hz: number,
		dur: number,
		level: number,
		drive: number,
	) {
		this.drivenSine(out, {
			from: hz,
			to: hz,
			sweepS: 0,
			attackS: 0.002,
			dur,
			level,
			drive,
		});
	}
	/** The body of an impact: a sine falling to a floor over `len`, driven
	 *  enough that its second and third harmonics carry it on a small speaker.
	 *  Never under 38 Hz: below that it costs headroom and is not heard.
	 *  `level` is its peak. */
	private sub(
		out: AudioNode,
		{
			from,
			to,
			len,
			level,
			delayS = 0,
		}: {
			from: number;
			to: number;
			len: number;
			level: number;
			delayS?: number;
		},
	) {
		this.drivenSine(out, {
			from,
			to: Math.max(38, to),
			sweepS: len * 0.7,
			attackS: 0.005,
			dur: len,
			level,
			drive: SUB_DRIVE,
			delayS,
		});
	}
	/**
	 * The one body under `impactPunch`, `thump` and `sub`: a sine from
	 * `from` to `to` Hz over `sweepS` (held when they are equal), in over
	 * `attackS` and down to silence at `dur`, driven into a saturator whose
	 * makeup puts its peak at `level`.
	 */
	private drivenSine(
		out: AudioNode,
		{
			from,
			to,
			sweepS,
			attackS,
			dur,
			level,
			drive,
			delayS = 0,
		}: {
			from: number;
			to: number;
			sweepS: number;
			attackS: number;
			dur: number;
			level: number;
			drive: number;
			delayS?: number;
		},
	) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime + delayS;
		const o = this.ctx.createOscillator();
		o.type = "sine";
		o.frequency.setValueAtTime(from, t);
		if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + sweepS);
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(1, t + attackS);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g);
		g.connect(this.saturator(drive, out, peakMakeup(drive, level)));
		o.start(t);
		o.stop(t + dur + 0.02);
	}
	/** The edge on an impact: a few milliseconds of high-passed noise. */
	private snap(out: AudioNode, vol: number, hz: number, delayS = 0) {
		this.filteredNoise(out, {
			dur: 0.03,
			vol,
			type: "highpass",
			fromHz: hz,
			toHz: hz,
			delayS,
		});
	}
	/** The air of an impact: noise under a low-pass closing from `fromHz` to
	 *  `toHz`, decaying over `len`. */
	private wash(
		out: AudioNode,
		{
			vol,
			fromHz,
			toHz,
			len,
			delayS = 0,
		}: {
			vol: number;
			fromHz: number;
			toHz: number;
			len: number;
			delayS?: number;
		},
	) {
		this.filteredNoise(out, {
			dur: len,
			vol,
			type: "lowpass",
			fromHz,
			toHz,
			delayS,
		});
	}
	/** A short low band of noise, driven: weight with no pitch in it. `vol`
	 *  is the gain into the saturator — a narrow band of noise passes little of
	 *  it — and `drive` sets the ceiling, `tanh(drive) / drive`. */
	private lowBurst(
		out: AudioNode,
		dur: number,
		vol: number,
		hz: number,
		drive: number,
	) {
		if (!this.ctx) return;
		this.filteredNoise(this.saturator(drive, out), {
			dur,
			vol,
			type: "bandpass",
			fromHz: hz,
			toHz: hz,
		});
	}
	/** Noise through one filter whose frequency moves from `fromHz` to `toHz`,
	 *  decaying exponentially to silence over `dur`. `q` is the filter's, 0.7
	 *  unless stated. */
	private filteredNoise(
		out: AudioNode,
		{
			dur,
			vol,
			type,
			fromHz,
			toHz,
			q = 0.7,
			delayS = 0,
		}: {
			dur: number;
			vol: number;
			type: BiquadFilterType;
			fromHz: number;
			toHz: number;
			q?: number;
			delayS?: number;
		},
	) {
		if (!this.ctx) return;
		const t = this.ctx.currentTime + delayS;
		// One loop of white noise for every heavy layer (sage round 1 on #578):
		// a heavy explosion drew about three seconds of fresh noise per cue.
		// Each layer starts at its own random point in it. Built on first use,
		// so the thin arm never draws for it.
		this.heavyNoise ??= noiseLoop(this.ctx, "white");
		const src = this.ctx.createBufferSource();
		src.buffer = this.heavyNoise;
		src.loop = true;
		const filter = this.ctx.createBiquadFilter();
		filter.type = type;
		filter.Q.value = q;
		filter.frequency.setValueAtTime(fromHz, t);
		if (toHz !== fromHz)
			filter.frequency.exponentialRampToValueAtTime(toHz, t + dur * 0.8);
		// `noiseLoop`'s white is at half scale; this noise was at full.
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(2 * vol, t + 0.002);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(filter);
		filter.connect(g);
		g.connect(out);
		src.start(t, Math.random() * (this.heavyNoise.duration - 0.01));
		src.stop(t + dur);
	}
	/** The heavy arm's noise loop (#577), built on first use. */
	private heavyNoise: AudioBuffer | null = null;

	/** Each bus's reverb (#577), built on the first heavy cue that sends. */
	private readonly reverbs = new Map<CueBus, ConvolverNode>();

	/**
	 * Feed `from` into its bus's reverb by `REVERB_SEND[kind]`, on the heavy
	 * arm only. The reverb returns into the bus, so the bus row and the mute
	 * reach the tail as they reach the hit. It is built on first use, so the
	 * thin arm never builds it and never draws the noise its impulse is made of.
	 */
	private sendToReverb(from: AudioNode, bus: CueBus, kind: CueKind) {
		const amount = REVERB_SEND[kind];
		if (!this.sends(kind) || !amount || !this.ctx || !this.buses) return;
		let reverb = this.reverbs.get(bus);
		if (!reverb) {
			reverb = this.ctx.createConvolver();
			reverb.normalize = false;
			// One impulse for every bus (sage round 3): two draws of the same
			// law are the same room, and the second cost another frame.
			this.impulse ??= reverbImpulse(this.ctx);
			reverb.buffer = this.impulse;
			reverb.connect(this.buses[bus]);
			this.reverbs.set(bus, reverb);
		}
		const send = this.ctx.createGain();
		send.gain.value = amount;
		from.connect(send);
		send.connect(reverb);
	}

	/** The reverb's impulse (#577), drawn once, on the first send. */
	private impulse: AudioBuffer | null = null;

	/** Whether a cue of `kind` feeds the reverb: heavy, and named in
	 *  `REVERB_SEND`. The one copy of that rule. */
	private sends(kind: CueKind): boolean {
		return this.punch === "heavy" && (REVERB_SEND[kind] ?? 0) > 0;
	}

	/** Its bus, with a reverb send beside it on the heavy arm, for a cue that
	 *  plays straight into its bus and has no voice of its own to send from. */
	private sending(kind: CueKind): AudioNode {
		const bus = CUE_BUS[kind];
		const out = (this.buses as CueBuses)[bus];
		if (!this.sends(kind) || !this.ctx) return out;
		const g = this.ctx.createGain();
		g.gain.value = 1;
		g.connect(out);
		this.sendToReverb(g, bus, kind);
		return g;
	}
	/**
	 * A saturator into `out`: `tanh(drive·x) / drive`, so a quiet signal
	 * passes at its own level and a loud one is rounded off, then `makeup`
	 * after it. The curve thickens and never boosts; any gain is the makeup's,
	 * stated at the call.
	 */
	private saturator(drive: number, out: AudioNode, makeup = 1): AudioNode {
		const ctx = this.ctx as BaseAudioContext;
		const shaper = ctx.createWaveShaper();
		shaper.curve = saturationCurve(drive);
		shaper.oversample = "2x";
		if (makeup === 1) shaper.connect(out);
		else {
			const g = ctx.createGain();
			g.gain.value = makeup;
			shaper.connect(g);
			g.connect(out);
		}
		return shaper;
	}

	/**
	 * A discharge (#545): a crack of bright noise over a short low punch, and
	 * no falling pitch — the fall is what made the zap a *pew*. The `crack`
	 * shot, and the beam's onset at `level`.
	 */
	private discharge(out: AudioNode, level: number) {
		this.bandBurst(out, 0.035, 0.5 * level, 3400, 0.9);
		this.bandBurst(out, 0.012, 0.35 * level, 7000, 1.5);
		this.tone(out, 110, 0.09, "sine", 0.16 * level, 75);
		this.tone(out, 1650, 0.05, "triangle", 0.03 * level);
		if (this.punch !== "heavy") return;
		// #577: a thump that holds its pitch — a falling one is the *pew* —
		// and a breath of low noise, so the shot has a body.
		this.thump(out, 62, 0.07, 0.3 * level, 3);
		this.lowBurst(out, 0.03, 3 * level, 180, 2);
	}
	private crack(out: AudioNode) {
		this.discharge(out, 1);
	}
	/** A trigger pulled on a heat-locked gun (#545): a dry click, and a small
	 *  drop that says the gun did not answer. */
	private gunLocked(out: AudioNode) {
		this.bandBurst(out, 0.008, 0.35, 2500, 5);
		this.tone(out, 240, 0.06, "sine", 0.06, 150);
	}

	/**
	 * A hit on a shield (#545): the field taking it, not the hull, and an
	 * electric sparkle — the principal's first listen heard the pitched body
	 * this began with as a tom. A bright zap at the onset, then a scatter of
	 * sparks, tiny high bursts crowded at the front and thinning out, over a
	 * short electrical buzz. No pitched body at all.
	 *
	 * Fore sparks sit higher than aft when the side is heard. `share` is what
	 * is left of the pool: as it nears zero the sparkle loses its density and
	 * stretches into a sputter, and the zap weakens.
	 */
	private shieldHit(
		out: AudioNode,
		pool: HitPool,
		share: number,
		sided: boolean,
	) {
		const [lo, hi] = !sided
			? [3500, 7500]
			: pool === "fore"
				? [5000, 10000]
				: [2500, 5500];
		const weak = 1 - Math.min(1, Math.max(0, share));
		this.bandBurst(out, 0.025, 0.5 * (1 - 0.4 * weak), (lo + hi) / 2, 0.8);
		this.tone(out, 118, 0.09, "sawtooth", 0.035);
		const sparks = Math.round(22 - 12 * weak);
		const spanS = 0.18 + 0.12 * weak;
		for (let i = 0; i < sparks; i++) {
			// Raised to a power, so the sparks crowd the front and thin out.
			const at = spanS * Math.random() ** 1.8;
			this.bandBurst(
				out,
				0.002 + Math.random() * 0.004,
				(0.18 + Math.random() * 0.22) * (1 - (0.7 * at) / spanS),
				lo + Math.random() * (hi - lo),
				6,
				at,
			);
		}
		if (this.punch !== "heavy") return;
		// #577: the field taking the blow, heard as a low shove of noise rather
		// than a tone (#545 heard a tone as a tom). Less of it as the pool empties.
		this.lowBurst(out, 0.05, 2.5 * (1 - 0.5 * weak), 260, 2);
	}

	/**
	 * A hit on the hull (#545). `clang`: metal struck — a low punch, a crunch,
	 * and a ring of inharmonic partials, each hit a little off the last so a
	 * run of them is not one sample repeated. `thud`: the thud before #545.
	 */
	private hullHit(out: AudioNode, voice: HullHitVoice) {
		if (voice === "thud") return this.hit(out);
		const spread = 0.96 + Math.random() * 0.08;
		this.tone(out, 72 * spread, 0.26, "sine", 0.3, 44);
		this.noiseBurst(out, 0.13, 0.32, 1500);
		for (const [hz, vol, dur] of [
			[197, 0.08, 0.4],
			[463, 0.06, 0.32],
			[821, 0.045, 0.24],
			[1307, 0.03, 0.18],
			[2011, 0.018, 0.12],
		] as const)
			this.tone(out, hz * spread, dur, "sine", vol);
		if (this.punch !== "heavy") return;
		// #577: the hull taking it — a punch, a snap on the strike and a crunch
		// closing down under the ring, which is still the clang.
		this.impactPunch(out, {
			from: 140,
			to: 50,
			dur: 0.14,
			level: 0.45,
			drive: 3,
		});
		this.snap(out, 0.3, 2500);
		this.wash(out, { vol: 0.3, fromHz: 5000, toHz: 400, len: 0.3 });
	}

	/** A hit the player landed (#545): smaller and further off than one taken
	 *  — a thin tick off a shield, a dull knock off a hull. */
	private hitLanded(out: AudioNode, on: "shield" | "hull") {
		if (on === "shield") {
			this.bandBurst(out, 0.06, 0.18, 2800, 3);
			this.tone(out, 900, 0.05, "sine", 0.03, 520);
			return;
		}
		this.noiseBurst(out, 0.1, 0.14, 500);
		this.tone(out, 110, 0.1, "sine", 0.07, 80);
		if (this.punch === "heavy")
			this.impactPunch(out, {
				from: 120,
				to: 60,
				dur: 0.08,
				level: 0.1,
				drive: 2,
			});
	}
	/** A ship coming apart. */
	private explosion(out: AudioNode) {
		if (this.punch === "heavy") return this.heavyExplosion(out);
		this.noiseBurst(out, 0.8, 0.5, 500);
		this.tone(out, 70, 0.6, "sine", 0.4, 30);
	}
	/**
	 * A ship coming apart, with weight (#577), after the trailer's impacts: a
	 * snap on the flash, a punch, a sub falling to its floor, a wash of noise whose
	 * low-pass closes, a rumble under it, and debris crackling as it scatters.
	 */
	private heavyExplosion(out: AudioNode) {
		this.snap(out, 0.3, 2000);
		this.impactPunch(out, {
			from: 160,
			to: 48,
			dur: 0.22,
			level: 0.5,
			drive: 3,
		});
		this.sub(out, { from: 90, to: 40, len: 1.5, level: 0.45 });
		this.wash(out, { vol: 0.4, fromHz: 6000, toHz: 250, len: 1.3 });
		this.wash(out, { vol: 0.5, fromHz: 450, toHz: 80, len: 1.7 });
		for (let i = 0; i < 10; i++) {
			// Under 1 s, so `1 - at` below keeps every spark's level positive
			// (sage round 2 on #578: at 0.9 the latest reached 1.02).
			const at = 0.12 + Math.random() ** 1.5 * 0.85;
			this.bandBurst(
				out,
				0.004 + Math.random() * 0.01,
				(0.08 + Math.random() * 0.16) * (1 - at),
				600 + Math.random() * 2400,
				4,
				at,
			);
		}
	}
	/** Docking clamps engaging. */
	private dock(out: AudioNode) {
		this.tone(out, 160, 0.18, "sine", 0.25, 240);
		this.noiseBurst(out, 0.12, 0.18, 600);
		if (this.punch !== "heavy") return;
		// #577: two clamps, each a clunk of metal with a short ring.
		for (const at of [0, 0.09]) {
			this.impactPunch(out, {
				from: 130,
				to: 55,
				dur: 0.1,
				level: 0.3,
				drive: 3,
				delayS: at,
			});
			this.snap(out, 0.15, 3000, at);
		}
		for (const [hz, vol, dur] of [
			[311, 0.03, 0.22],
			[733, 0.02, 0.16],
			[1289, 0.012, 0.1],
		] as const)
			this.tone(out, hz, dur, "sine", vol, undefined, 0.09);
	}
	/**
	 * Witchspace entry: a rising sweep into nothing.
	 *
	 * #195's D3 places it: it starts `sweepS` before the cut so its top lands on
	 * the cut (`witchspace.ts` owns the schedule). It goes through its own
	 * group so `stopWitchspace` can take it back — a sweep that played on after
	 * a cancelled charge would announce a jump that did not happen.
	 *
	 * Both of its parts decay from their onset, so most of it is heard in its
	 * first half second and the cut arrives under the engine bed (#534).
	 */
	private witchspaceSweep() {
		const out = this.witchspaceGroup("sweep");
		if (!out) return;
		this.tone(out, 90, HYPERSPACE_SWEEP_S, "sawtooth", 0.22, 1400);
		this.noiseBurst(out, 1.2, 0.18, 2200);
	}
	/**
	 * The sweep that holds to the cut (#534's `rise` arm): the same climb from
	 * 90 Hz to 1400, with a rising band of noise over it, swelling rather than
	 * decaying for `seconds` — the time left to the cut — and ended there, so
	 * the flash is what stops it.
	 *
	 * With `swallow`, it is drawn down into silence as the dark closes to a
	 * point: its level and its top both fall from `fromS` to nothing at
	 * `toS`, seconds from its start, so the point is heard as the sweep's
	 * absence before the flash.
	 */
	private witchspaceRise(seconds: number, swallow?: SweepSwallow) {
		const group = this.witchspaceGroup("sweep");
		if (!group || !this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const end = t + Math.max(0.05, seconds);
		let out: AudioNode = group;
		if (swallow) {
			const gain = ctx.createGain();
			gain.gain.setValueAtTime(1, t + swallow.fromS);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + swallow.toS);
			const filter = ctx.createBiquadFilter();
			filter.type = "lowpass";
			filter.frequency.setValueAtTime(12000, t + swallow.fromS);
			filter.frequency.exponentialRampToValueAtTime(250, t + swallow.toS);
			filter.connect(gain);
			gain.connect(group);
			out = filter;
		}
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(0.1, t + 0.05);
		env.gain.exponentialRampToValueAtTime(0.18, end - 0.02);
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		env.connect(out);
		const saw = ctx.createOscillator();
		saw.type = "sawtooth";
		saw.frequency.setValueAtTime(90, t);
		saw.frequency.exponentialRampToValueAtTime(1400, end);
		const soft = ctx.createBiquadFilter();
		soft.type = "lowpass";
		soft.frequency.setValueAtTime(900, t);
		soft.frequency.exponentialRampToValueAtTime(6000, end);
		saw.connect(soft);
		soft.connect(env);
		const src = this.loopedNoise("white");
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.Q.value = 1.5;
		band.frequency.setValueAtTime(800, t);
		band.frequency.exponentialRampToValueAtTime(5000, end);
		const air = ctx.createGain();
		air.gain.value = 0.7;
		src.connect(band);
		band.connect(air);
		air.connect(env);
		for (const s of [saw, src]) {
			s.start(t);
			s.stop(end + 0.05);
		}
	}
	/**
	 * The flash on the cut (#534). `boom`: a low impact, a sub dropping out
	 * under a burst of dark noise — the world replaced. `glass`: light — a
	 * bright inharmonic ring and a hiss of air, high and short.
	 */
	private witchspaceFlash(voice: FlashVoice) {
		const out = this.witchspaceGroup("flash");
		if (!out) return;
		if (voice === "glass") {
			for (const [hz, vol, dur] of [
				[1568, 0.11, 1.1],
				[2349, 0.08, 0.9],
				[3322, 0.06, 0.7],
				[4699, 0.04, 0.5],
			] as const)
				this.tone(out, hz, dur, "sine", vol);
			this.bandBurst(out, 0.35, 0.2, 6000, 0.7);
			return;
		}
		if (this.punch === "heavy") {
			this.sendToReverb(out, CUE_BUS.witchspaceFlash, "witchspaceFlash");
			// #577: the world replaced, as an impact — a punch and a sub with a
			// floor where the thin boom fell to 28 Hz, a snap, a wash closing
			// down and a long rumble under it.
			this.snap(out, 0.3, 2000);
			this.impactPunch(out, {
				from: 170,
				to: 45,
				dur: 0.24,
				level: 0.45,
				drive: 3,
			});
			this.sub(out, { from: 110, to: 40, len: 1.6, level: 0.42 });
			this.tone(out, 190, 0.4, "triangle", 0.12, 60);
			this.wash(out, { vol: 0.35, fromHz: 7000, toHz: 200, len: 1.5 });
			this.wash(out, { vol: 0.45, fromHz: 300, toHz: 70, len: 2 });
			return;
		}
		this.tone(out, 95, 1.1, "sine", 0.42, 28);
		this.tone(out, 190, 0.4, "triangle", 0.12, 60);
		this.noiseBurst(out, 0.7, 0.3, 700);
	}
	/**
	 * The ride through the tunnel (#534): in over `openS` as the tunnel opens
	 * out of the point, and held. Its close is a cue of its own
	 * (`witchspaceRideClose`), fired off the exit clock when the tunnel closes,
	 * so a stall after the cut cannot close it ahead of the tunnel. `seconds`
	 * only bounds a ride whose close never came.
	 *
	 * - `rings`: a rushing of band-passed noise that swells as each ring of
	 *   light passes on the wall (`ringHz`), rising in pitch through the ride,
	 *   over a low body.
	 * - `bed`: a steady drone — dark noise and two slow-beating low saws.
	 */
	private witchspaceRide(cue: Extract<Cue, { kind: "witchspaceRide" }>) {
		const out = this.witchspaceGroup("ride");
		if (!out || !this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const end = t + cue.seconds;
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(1, t + cue.openS);
		env.gain.setValueAtTime(1, Math.max(t + cue.openS, end - 0.3));
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		env.connect(out);
		const stops: AudioScheduledSourceNode[] = [];
		const noise = (kind: "brown" | "white") => {
			const src = this.loopedNoise(kind);
			stops.push(src);
			return src;
		};
		const osc = (hz: number, type: OscillatorType) => {
			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.setValueAtTime(hz, t);
			stops.push(o);
			return o;
		};
		if (cue.voice === "bed") {
			const low = ctx.createBiquadFilter();
			low.type = "lowpass";
			low.frequency.setValueAtTime(320, t);
			const level = ctx.createGain();
			level.gain.value = 0.22;
			noise("brown").connect(low);
			low.connect(level);
			level.connect(env);
			const drone = ctx.createBiquadFilter();
			drone.type = "lowpass";
			drone.frequency.setValueAtTime(180, t);
			const droneLevel = ctx.createGain();
			droneLevel.gain.value = 0.09;
			osc(41.2, "sawtooth").connect(drone);
			osc(41.7, "sawtooth").connect(drone);
			drone.connect(droneLevel);
			droneLevel.connect(env);
		} else {
			const band = ctx.createBiquadFilter();
			band.type = "bandpass";
			band.Q.value = 1.2;
			// Rising through the ride toward 1800 Hz, whenever the close comes.
			band.frequency.setValueAtTime(600, t);
			band.frequency.setTargetAtTime(1800, t, 1);
			// Each ring passing: a sharp swell and a longer fall, as the shader's
			// `pow(sin, 14)` is a narrow bright line with dark between.
			const pulse = ctx.createGain();
			const period = 1 / cue.ringHz;
			pulse.gain.setValueAtTime(0.25, t);
			for (let at = t + period; at < end; at += period) {
				pulse.gain.setValueAtTime(0.25, at - 0.05);
				pulse.gain.exponentialRampToValueAtTime(1, at);
				pulse.gain.exponentialRampToValueAtTime(0.25, at + 0.18);
			}
			const level = ctx.createGain();
			level.gain.value = 0.2;
			noise("white").connect(band);
			band.connect(pulse);
			pulse.connect(level);
			level.connect(env);
			const bodyLevel = ctx.createGain();
			bodyLevel.gain.value = 0.08;
			osc(55, "sine").connect(bodyLevel);
			bodyLevel.connect(env);
		}
		for (const s of stops) {
			s.start(t);
			s.stop(end + 0.05);
		}
		this.rideSources = stops;
	}
	/** The ride's running voices, so its close can stop them. */
	private rideSources: AudioScheduledSourceNode[] = [];
	/**
	 * The tunnel closing back into the point (#534): the ride's group taken
	 * down over `seconds`, and its voices stopped as it reaches silence rather
	 * than running on to their bound (sage round 2 on #575). It is let go, not
	 * disconnected, so a later stop has nothing of it to take.
	 */
	private witchspaceRideClose(seconds: number) {
		const group = this.witchspaceGroups.get("ride");
		if (!group || !this.ctx) return;
		const t = this.ctx.currentTime;
		group.gain.setValueAtTime(1, t);
		group.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
		for (const s of this.rideSources) s.stop(t + seconds + 0.05);
		this.rideSources = [];
		this.witchspaceGroups.delete("ride");
	}
	/** A two-second noise loop, brown or white, not yet started. */
	private loopedNoise(kind: "brown" | "white"): AudioBufferSourceNode {
		const ctx = this.ctx as BaseAudioContext;
		const src = ctx.createBufferSource();
		src.buffer = noiseLoop(ctx, kind);
		src.loop = true;
		return src;
	}
	/**
	 * The new light catching up (#534): a long fall from high to low, noise
	 * and a glide together, swelling in and easing out as the sky unfolds.
	 */
	private witchspaceUnfold(
		seconds: number,
		spatialOutput?: AudioNode,
		finished?: () => void,
	) {
		const out = spatialOutput ?? this.witchspaceGroup("unfold");
		if (!out || !this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const end = t + seconds;
		const env = ctx.createGain();
		// From a hundredth rather than from silence: an exponential ramp spends
		// most of its time far down, and from 0.0001 the first half of the
		// swell was under the bed.
		env.gain.setValueAtTime(0.01, t);
		env.gain.exponentialRampToValueAtTime(1, t + seconds * 0.4);
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		env.connect(out);
		const src = this.loopedNoise("white");
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.Q.value = 2;
		band.frequency.setValueAtTime(5000, t);
		band.frequency.exponentialRampToValueAtTime(300, end);
		const noiseLevel = ctx.createGain();
		noiseLevel.gain.value = 0.4;
		src.connect(band);
		band.connect(noiseLevel);
		noiseLevel.connect(env);
		const glide = ctx.createOscillator();
		glide.type = "sawtooth";
		glide.frequency.setValueAtTime(1200, t);
		glide.frequency.exponentialRampToValueAtTime(110, end);
		const soft = ctx.createBiquadFilter();
		soft.type = "lowpass";
		soft.frequency.setValueAtTime(3000, t);
		soft.frequency.exponentialRampToValueAtTime(400, end);
		const glideLevel = ctx.createGain();
		glideLevel.gain.value = 0.12;
		glide.connect(soft);
		soft.connect(glideLevel);
		glideLevel.connect(env);
		for (const s of [src, glide]) {
			s.start(t);
			s.stop(end + 0.05);
			s.onended = () => {
				s.disconnect();
				if (s === glide) {
					band.disconnect();
					noiseLevel.disconnect();
					soft.disconnect();
					glideLevel.disconnect();
					env.disconnect();
					finished?.();
				}
			};
		}
	}
	/**
	 * The rift behind the ship (#534): a low chord of slow-beating voices with
	 * a faint high shimmer, in with the new light and held, then falling in
	 * pitch and fading as the rift closes.
	 */
	private witchspaceRift(
		seconds: number,
		spatialOutput?: AudioNode,
		finished?: () => void,
	) {
		const out = spatialOutput ?? this.witchspaceGroup("rift");
		if (!out || !this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const end = t + seconds;
		const closeAt = t + Math.max(0.5, seconds - 1.5);
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(1, t + 0.5);
		env.gain.setValueAtTime(1, closeAt);
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		env.connect(out);
		const soft = ctx.createBiquadFilter();
		soft.type = "lowpass";
		soft.frequency.setValueAtTime(900, t);
		soft.connect(env);
		for (const [hz, type, vol] of [
			[73.4, "triangle", 0.07],
			[73.9, "triangle", 0.07],
			[110.2, "triangle", 0.05],
			[146.9, "sine", 0.04],
			[1760, "sine", 0.012],
			[1767, "sine", 0.012],
		] as const) {
			const o = ctx.createOscillator();
			o.type = type;
			o.frequency.setValueAtTime(hz, t);
			o.frequency.setValueAtTime(hz, closeAt);
			o.frequency.exponentialRampToValueAtTime(hz * 0.6, end);
			const g = ctx.createGain();
			g.gain.value = vol;
			o.connect(g);
			g.connect(hz > 1000 ? env : soft);
			o.start(t);
			o.stop(end + 0.05);
			o.onended = () => {
				o.disconnect();
				g.disconnect();
				if (hz === 1767) {
					soft.disconnect();
					env.disconnect();
					finished?.();
				}
			};
		}
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
	 * Silence every witchspace cue now: the charge was cancelled (#532), or
	 * the exit was cut short (#534). Fast rather than cut, so the stop is not a
	 * click.
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
	private readonly witchspaceGroups = new Map<WitchspaceVoice, GainNode>();
	/**
	 * A fresh group for a cue, replacing one still sounding under the same name.
	 * On the **ship** bus (D1), where it once went straight to master.
	 */
	private witchspaceGroup(cue: WitchspaceVoice): GainNode | null {
		if (!this.ctx || !this.buses) return null;
		this.witchspaceGroups.get(cue)?.disconnect();
		const group = this.ctx.createGain();
		group.gain.value = 1;
		group.connect(this.buses.ship);
		this.witchspaceGroups.set(cue, group);
		return group;
	}

	/**
	 * Something is wrong with the ship. Its callers before #546 were a
	 * carrier's hail and a refused scoop: a message spoke in this voice.
	 */
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
	/**
	 * The one button tick the engine had, and it had no caller before #546.
	 * Kept as the `square` press arm (`console-sound.ts`).
	 */
	private ui(out: AudioNode) {
		this.tone(out, 520, 0.06, "square", 0.12);
	}

	/**
	 * A console message (#546), by tone. Sine and triangle, where `alert` is
	 * two squares at once: an instrument speaking, not an alarm.
	 *
	 * - **message** — two notes up a fifth: news.
	 * - **good** — three notes rising: a thing done for the pilot.
	 * - **bad** — two notes falling, lower and duller: a thing gone wrong.
	 */
	private notify(out: AudioNode, tone: NotifyTone) {
		if (tone === "good") {
			this.tone(out, 784, 0.1, "sine", 0.1);
			this.tone(out, 988, 0.1, "sine", 0.1, undefined, 0.07);
			this.tone(out, 1319, 0.22, "sine", 0.1, undefined, 0.14);
		} else if (tone === "bad") {
			this.tone(out, 622, 0.16, "triangle", 0.16);
			this.tone(out, 466, 0.26, "triangle", 0.16, undefined, 0.13);
		} else {
			this.tone(out, 880, 0.14, "sine", 0.11);
			this.tone(out, 1319, 0.24, "sine", 0.09, undefined, 0.09);
		}
	}
	/** A console press that did what it said (#546): short and high. */
	private press(out: AudioNode) {
		this.tone(out, 1750, 0.025, "sine", 0.09);
		this.tone(out, 3500, 0.012, "sine", 0.03);
	}
	/** A console press the game refused (#546): a low double buzz. */
	private refuse(out: AudioNode) {
		this.tone(out, 196, 0.07, "square", 0.06);
		this.tone(out, 185, 0.09, "square", 0.06, undefined, 0.1);
	}
	/** The cursor landed on another row (#546): the quietest thing here. */
	private focus(out: AudioNode) {
		this.tone(out, 2600, 0.014, "sine", 0.035);
	}
}

/** How long every weapon loop must be silent before its graph is torn
 *  down, s: well past the beam's and the sizzle's release. */
export const WEAPON_IDLE_S = 2;

/** The nodes `AudioFX.weapons` writes (#545). */
interface WeaponGraph {
	/** Everything goes through this, so a teardown is one disconnect. */
	root: GainNode;
	/** Every running source, so a teardown can stop them. */
	sources: AudioScheduledSourceNode[];
	beam: GainNode;
	beamFilter: BiquadFilterNode;
	whine: OscillatorNode;
	whineGain: GainNode;
	sizzleFore: GainNode;
	sizzleAft: GainNode;
}

/** The nodes `AudioFX.flight` writes (#544). */
interface FlightGraph {
	hum: GainNode;
	drive: GainNode;
	driveFilter: BiquadFilterNode;
	driveTone: GainNode;
	driveOscs: [OscillatorNode, number][];
	rcs: GainNode;
	spool: GainNode;
	spoolFilter: BiquadFilterNode;
	spoolOscs: [OscillatorNode, number][];
	shimmer: GainNode;
	band: BiquadFilterNode;
	droneFilter: BiquadFilterNode;
	air: GainNode;
	spoolFlutter: OscillatorNode;
	spoolAir: GainNode;
	spoolAirBand: BiquadFilterNode;
	spoolSub: GainNode;
	spoolSubOsc: OscillatorNode;
	spoolWhine: GainNode;
	spoolWhineOsc: OscillatorNode;
	droneOscs: [OscillatorNode, number][];
	throb: GainNode;
	throbFilter: BiquadFilterNode;
	throbOscs: [OscillatorNode, number][];
	beatRate: OscillatorNode;
	rush: GainNode;
	rushBand: BiquadFilterNode;
	cruiseSwell: GainNode;
	humSwell: GainNode;
	humFilter: BiquadFilterNode;
	pumpRate: OscillatorNode;
	fanRate: OscillatorNode;
}

/** `REVERB`'s impulse, drawn from `Math.random()` like every noise here. */
function reverbImpulse(ctx: BaseAudioContext): AudioBuffer {
	const len = Math.floor(ctx.sampleRate * REVERB.seconds);
	const pre = Math.floor(ctx.sampleRate * REVERB.preDelayS);
	const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
	for (let c = 0; c < 2; c++) {
		const d = buffer.getChannelData(c);
		let lp = 0;
		let sumSq = 0;
		for (let i = pre; i < len; i++) {
			const x = (i - pre) / (len - pre);
			lp +=
				(Math.random() * 2 - 1 - lp) *
				(0.25 + 0.7 * REVERB.brightness * (1 - x));
			d[i] = lp * Math.exp(-(i - pre) / ctx.sampleRate / REVERB.decayS);
			sumSq += d[i] * d[i];
		}
		const scale = sumSq > 0 ? 1 / Math.sqrt(sumSq) : 0;
		for (let i = pre; i < len; i++) d[i] *= scale;
	}
	return buffer;
}

/** How hard the heavy arm's sub is driven (#577). */
const SUB_DRIVE = 2;

/** The gain after a `drive` saturator that puts a full-scale input's peak at
 *  `level`: the curve's own ceiling is `tanh(drive) / drive`. */
const peakMakeup = (drive: number, level: number) =>
	(level * drive) / Math.tanh(drive);

/** Each drive's saturation curve, built once: odd, through zero, bounded
 *  by 1. An odd length puts a sample exactly at zero, so silence stays silent. */
const SATURATION_CURVES = new Map<number, Float32Array<ArrayBuffer>>();
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
	let curve = SATURATION_CURVES.get(drive);
	if (!curve) {
		const n = 1025;
		curve = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const x = (i / (n - 1)) * 2 - 1;
			curve[i] = Math.tanh(drive * x) / drive;
		}
		SATURATION_CURVES.set(drive, curve);
	}
	return curve;
}

/**
 * Two seconds of looping noise, brown or white, with its tail crossfaded into
 * its head so the loop point has no step (`makeBed` on why the head is faded
 * toward the *extra* samples and not toward its own tail). The same brown law
 * as the bed; kept apart from `makeBed` so the bed before #544 renders
 * exactly as it did.
 */
function noiseLoop(
	ctx: BaseAudioContext,
	kind: "brown" | "white",
): AudioBuffer {
	const len = Math.floor(ctx.sampleRate * 2);
	const fade = Math.floor(ctx.sampleRate * 0.05);
	const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	const raw = new Float32Array(len + fade);
	let last = 0;
	for (let i = 0; i < raw.length; i++) {
		const white = Math.random() * 2 - 1;
		if (kind === "white") raw[i] = white * 0.5;
		else {
			last = (last + white * 0.02) * 0.995;
			raw[i] = last * 3.2;
		}
	}
	for (let i = 0; i < len; i++) data[i] = raw[i];
	for (let i = 0; i < fade; i++) {
		const k = i / fade;
		data[i] = raw[i] * k + raw[len + i] * (1 - k);
	}
	return buffer;
}
