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
	type FlashVoice,
	type FlightMix,
	type HitPool,
	type HullHitVoice,
	type NotifyTone,
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

type CueBuses = Record<Exclude<Bus, "master">, GainNode>;

/** The witchspace voices, each behind a gain of its own so a stop reaches it:
 *  #195's two before the cut and #534's four after it. */
type WitchspaceVoice = "hum" | "sweep" | "flash" | "ride" | "unfold" | "rift";

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
			this.witchspaceSweep(cue.swallow);
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
		if (cue.kind === "witchspaceUnfold") {
			this.witchspaceUnfold(cue.seconds);
			return;
		}
		if (cue.kind === "witchspaceRift") {
			this.witchspaceRift(cue.seconds);
			return;
		}
		if (cue.kind === "cruiseEngage") {
			this.cruiseEngage(this.buses.ship);
			return;
		}
		if (cue.kind === "cruiseDrop") {
			this.cruiseDrop(this.buses.ship);
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
	 *
	 * With `swallow` (#534's arm), the sweep is drawn down into silence as the
	 * dark closes to a point: its level and its top both fall from `fromS` to
	 * nothing at `toS`, seconds from its start, so the point is heard as the
	 * absence of the sweep before the flash.
	 */
	private witchspaceSweep(swallow?: SweepSwallow) {
		const group = this.witchspaceGroup("sweep");
		if (!group || !this.ctx) return;
		let out: AudioNode = group;
		if (swallow) {
			const t = this.ctx.currentTime;
			const gain = this.ctx.createGain();
			gain.gain.setValueAtTime(1, t + swallow.fromS);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + swallow.toS);
			const filter = this.ctx.createBiquadFilter();
			filter.type = "lowpass";
			filter.frequency.setValueAtTime(12000, t + swallow.fromS);
			filter.frequency.exponentialRampToValueAtTime(250, t + swallow.toS);
			filter.connect(gain);
			gain.connect(group);
			out = filter;
		}
		this.tone(out, 90, HYPERSPACE_SWEEP_S, "sawtooth", 0.22, 1400);
		this.noiseBurst(out, 1.2, 0.18, 2200);
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
				[1568, 0.07, 1.1],
				[2349, 0.05, 0.9],
				[3322, 0.04, 0.7],
				[4699, 0.025, 0.5],
			] as const)
				this.tone(out, hz, dur, "sine", vol);
			this.bandBurst(out, 0.35, 0.12, 6000, 0.7);
			return;
		}
		this.tone(out, 95, 1.1, "sine", 0.42, 28);
		this.tone(out, 190, 0.4, "triangle", 0.12, 60);
		this.noiseBurst(out, 0.7, 0.3, 700);
	}
	/**
	 * The ride through the tunnel (#534), for the tunnel's whole life: in over
	 * `openS`, held, and out from `closeAtS` to `seconds`, as the tunnel opens
	 * out of the point and closes back into it.
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
		const closeAt =
			t + Math.min(cue.seconds, Math.max(cue.openS, cue.closeAtS));
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(1, t + cue.openS);
		env.gain.setValueAtTime(1, closeAt);
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		env.connect(out);
		const stops: AudioScheduledSourceNode[] = [];
		const noise = (kind: "brown" | "white") => {
			const src = ctx.createBufferSource();
			src.buffer = noiseLoop(ctx, kind);
			src.loop = true;
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
			band.frequency.setValueAtTime(600, t);
			band.frequency.exponentialRampToValueAtTime(1800, end);
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
	}
	/**
	 * The new light catching up (#534): a long fall from high to low, noise
	 * and a glide together, swelling in and easing out as the sky unfolds.
	 */
	private witchspaceUnfold(seconds: number) {
		const out = this.witchspaceGroup("unfold");
		if (!out || !this.ctx) return;
		const ctx = this.ctx;
		const t = ctx.currentTime;
		const end = t + seconds;
		const env = ctx.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.exponentialRampToValueAtTime(1, t + seconds * 0.4);
		env.gain.exponentialRampToValueAtTime(0.0001, end);
		env.connect(out);
		const src = ctx.createBufferSource();
		src.buffer = noiseLoop(ctx, "white");
		src.loop = true;
		const band = ctx.createBiquadFilter();
		band.type = "bandpass";
		band.Q.value = 2;
		band.frequency.setValueAtTime(5000, t);
		band.frequency.exponentialRampToValueAtTime(300, end);
		const noiseLevel = ctx.createGain();
		noiseLevel.gain.value = 0.16;
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
		glideLevel.gain.value = 0.06;
		glide.connect(soft);
		soft.connect(glideLevel);
		glideLevel.connect(env);
		for (const s of [src, glide]) {
			s.start(t);
			s.stop(end + 0.05);
		}
	}
	/**
	 * The rift behind the ship (#534): a low chord of slow-beating voices with
	 * a faint high shimmer, in with the new light and held, then falling in
	 * pitch and fading as the rift closes.
	 */
	private witchspaceRift(seconds: number) {
		const out = this.witchspaceGroup("rift");
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
