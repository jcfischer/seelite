/**
 * The music synth's main-thread side (#560, after #543's D5, D6 and D8): it
 * loads the worklet, connects it to the music bus, and sends it transport
 * commands.
 *
 * **Late readiness (D8).** `AudioFX.attach` stays synchronous, so a cue is
 * never held up by this module's load. `attach` here returns a promise that
 * resolves once `addModule` has and the node exists; a command sent before
 * that is held and sent in order the moment it does. A song asked for then
 * starts on the worklet's first quantum with nothing playing, which is a bar
 * line of its own: it begins at its top, not partway through. The offline
 * capture awaits the promise before it renders.
 *
 * **It creates no gain** (D5, and #542 D1's contract): the worklet's output
 * goes straight into `AudioFX.musicInput`, the bus whose row is the only music
 * level the player sets. Every fade is inside the worklet.
 * `tests/music-controller.test.ts` holds that against this file's source.
 *
 * Not headless: the `?worker&url` import is vite's, and bun cannot resolve
 * it. Nothing here is arithmetic; that is all in the worklet's engine.
 */
import {
	MUSIC_PROCESSOR,
	type MusicCommand,
	type MusicReport,
	type Quantum,
	type Song,
} from "./music-score";
import workletUrl from "./music-worklet.ts?worker&url";

export class Music {
	private node: AudioWorkletNode | null = null;
	private readonly held: MusicCommand[] = [];
	private whenReady: Promise<void> | null = null;
	private syncs = 0;
	private readonly waiting = new Map<
		number,
		{ resolve: () => void; reject: (e: Error) => void }
	>();
	/** Every command the worklet refused, in order, with its reason, and a
	 *  worklet that failed to load. */
	readonly errors: string[] = [];
	/** The last load's failure, until an `attach` succeeds. */
	private failure: Error | null = null;

	/**
	 * Load the worklet into `ctx` and connect it to `out` — the music bus. A
	 * second call returns the first call's promise while it stands.
	 *
	 * **A failed load is recorded and can be retried** (sage round 1). Its
	 * reason goes to `errors`, every `sync` waiting on it is rejected rather
	 * than left hanging, and the next `attach` tries again; commands sent
	 * meanwhile stay held for it. Until then a new `sync` rejects at once with
	 * the same reason (sage round 7): the game makes no second attach, and a
	 * sync nothing would answer is a hang. The promise still rejects, for a
	 * caller that awaits it.
	 */
	attach(ctx: BaseAudioContext, out: AudioNode): Promise<void> {
		this.whenReady ??= this.loadWorklet(ctx, out).catch((err: unknown) => {
			const e = err instanceof Error ? err : new Error(String(err));
			this.failure = e;
			this.errors.push(`the worklet did not load: ${e.message}`);
			console.warn(`music: the worklet did not load: ${e.message}`);
			for (const w of this.waiting.values()) w.reject(e);
			this.waiting.clear();
			this.whenReady = null;
			throw e;
		});
		return this.whenReady;
	}

	private loadWorklet(ctx: BaseAudioContext, out: AudioNode): Promise<void> {
		return ctx.audioWorklet.addModule(workletUrl).then(() => {
			this.failure = null;
			const node = new AudioWorkletNode(ctx, MUSIC_PROCESSOR, {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [1],
			});
			node.port.onmessage = (e: MessageEvent<MusicReport>) => {
				if (e.data?.type === "synced") {
					this.waiting.get(e.data.token)?.resolve();
					this.waiting.delete(e.data.token);
					return;
				}
				if (e.data?.type !== "error") return;
				this.errors.push(e.data.message);
				console.warn(`music: ${e.data.message}`);
			};
			node.connect(out);
			this.node = node;
			for (const cmd of this.held.splice(0)) node.port.postMessage(cmd);
		});
	}

	/** True once the worklet is running and commands go straight to it. */
	get ready(): boolean {
		return this.node !== null;
	}

	/** Send a command, or hold it until the worklet is ready (D8). */
	send(cmd: MusicCommand) {
		if (this.node) this.node.port.postMessage(cmd);
		else this.held.push(cmd);
	}

	/**
	 * Resolves once the worklet has applied every command sent before this
	 * call, and not before it is ready. An offline render awaits it inside a
	 * suspend: a message sent there is otherwise applied only at the *next*
	 * suspend, because the render resumes before the worklet reads its port.
	 */
	sync(): Promise<void> {
		if (this.failure && !this.whenReady) return Promise.reject(this.failure);
		const token = ++this.syncs;
		const answered = new Promise<void>((resolve, reject) =>
			this.waiting.set(token, { resolve, reject }),
		);
		this.send({ type: "sync", token });
		return answered;
	}

	load(id: string, song: Song) {
		this.send({ type: "load", id, song });
	}

	play(id: string, opts: { section?: string; at?: Quantum } = {}) {
		this.send({
			type: "play",
			id,
			section: opts.section,
			at: opts.at ?? "bar",
		});
	}

	crossfade(
		to: string,
		fadeS: number,
		opts: { section?: string; at?: Quantum } = {},
	) {
		this.send({
			type: "crossfade",
			to,
			fadeS,
			section: opts.section,
			at: opts.at ?? "bar",
		});
	}

	jump(section: string, at: Quantum = "bar") {
		this.send({ type: "jump", section, at });
	}

	resolve(at: Quantum = "bar") {
		this.send({ type: "resolve", at });
	}

	/** On a quantum the last notes ring out; `"now"` fades over `fadeS`. */
	stop(at: Quantum | "now" = "bar", fadeS = 0.4) {
		this.send({ type: "stop", at, fadeS });
	}

	stem(
		part: string,
		level: number,
		fadeS: number,
		at: Quantum | "now" = "bar",
	) {
		this.send({ type: "stem", part, level, fadeS, at });
	}

	tempo(scale: number, rampBars = 0, at: Quantum = "bar") {
		this.send({ type: "tempo", scale, rampBars, at });
	}
}
