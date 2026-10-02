/**
 * The neural voice (prototype): Kokoro-82M (Apache-2.0) run in the player's
 * browser, in a Web Worker, from files served with the game — so speech is
 * generated at runtime, any line the lexicon can spell, with no request
 * beyond the bundle.
 *
 * The text side is ours and has no eSpeak in it: words become IPA from
 * `voice-ipa.ts`, generated at build time, and IPA becomes Kokoro's token
 * ids by its own symbol table. The worker only runs the model.
 *
 * Pure helpers here for the headless tier; `NeuralVoice` is the browser's.
 */
import { fetchBundled } from "./bundle-fetch";
import type { VoiceArms } from "./comms";
import {
	backendBytes,
	MAX_TOKENS,
	type NeuralBackend,
	type Reply,
	type Request,
	type VoiceManifest,
} from "./neural-voice-core";
import { IPA_GB, IPA_US, KOKORO_VOCAB } from "./voice-ipa";

export {
	backendBytes,
	type NeuralBackend,
	RADIO_RATE,
	resample,
	type VoiceManifest,
} from "./neural-voice-core";
import {
	dropParts,
	hasLine,
	lineKey,
	loadLine,
	storeLine,
} from "./voice-store";

/**
 * Which engine speaks (#604): the natural voice when `?voices=neural` forces
 * it, or when the settings row chose it and no arm overrides the row.
 * `ask` is not a yes: nothing downloads until the player answers.
 */
export const neuralWanted = (
	setting: "ask" | "neural" | "formant",
	engine: VoiceArms["engine"],
) => engine === "neural" || (engine === "setting" && setting === "neural");

/** Decoded lines held in memory: every comms line and a few phrases. */
const MEMO_LINES = 24;

/** The voices the prototype ships, by Kokoro's id: the first letter is the
 *  accent (`a` American, `b` British). */
export const NEURAL_VOICES = [
	"bm_lewis",
	"am_michael",
	"bf_emma",
	"af_bella",
	"bf_isabella",
	"af_nicole",
	"af_heart",
	"am_fenrir",
	"am_puck",
	"bm_fable",
	"af_sarah",
] as const;
export type NeuralVoiceId = (typeof NEURAL_VOICES)[number];

const DIGITS = [
	"ZERO",
	"ONE",
	"TWO",
	"THREE",
	"FOUR",
	"FIVE",
	"SIX",
	"SEVEN",
	"EIGHT",
	"NINE",
];

/** Text as Kokoro's IPA, in the voice's accent, and the words the lexicon
 *  lacks (skipped, as the formant voice skips them). */
export function textToIpa(
	text: string,
	voice: NeuralVoiceId,
): { ipa: string; unknown: string[] } {
	const table = voice.startsWith("b") ? IPA_GB : IPA_US;
	const unknown: string[] = [];
	let ipa = "";
	for (const p of text.match(/[A-Za-z']+|\d|[.,!?;:]/g) ?? []) {
		if (/^[.,!?;:]$/.test(p)) {
			ipa = `${ipa.trimEnd()}${p} `;
			continue;
		}
		const word = /^\d$/.test(p) ? DIGITS[Number(p)] : p.toUpperCase();
		const w = table[word];
		if (w) ipa += `${w} `;
		else unknown.push(p);
	}
	return { ipa: ipa.trim(), unknown };
}

/** IPA as Kokoro's token ids: unknown symbols dropped, as its normaliser
 *  drops them, and the pad (0) at both ends. */
export function tokenize(ipa: string): number[] {
	const ids: number[] = [];
	for (const ch of ipa) {
		const id = KOKORO_VOCAB[ch];
		if (id !== undefined) ids.push(id);
	}
	return [0, ...ids.slice(0, MAX_TOKENS), 0];
}

/** Each role's voice when no speaker is named — the lab, a probe, a line
 *  with nobody behind it. The machine's is the only one the game keeps. */
export const NEURAL_ROLE = {
	approach: "bm_lewis",
	pilot: "af_bella",
	pirate: "am_michael",
	machine: "af_nicole",
} as const satisfies Record<string, NeuralVoiceId>;

/** The voices a station or a pilot may speak with: every one the game
 *  ships but the machine's, which stays the numbers station's alone. */
export const SPEAKER_VOICES: readonly NeuralVoiceId[] = NEURAL_VOICES.filter(
	(v) => v !== NEURAL_ROLE.machine,
);

/** Who is speaking: an id — a station's, a carrier's — and the seed of the
 *  system it speaks in. A station's id is local to its system (every system
 *  has a `station-trade`), so the id alone names a kind of station, not one. */
export interface Speaker {
	readonly system: number;
	readonly id: string;
}

/**
 * Who speaks with which voice, by the principal's rulings on #604 and of
 * 2026-10-02: every voice but the ship's is **drawn per system**, for each
 * station and each pilot in it, and the machine stays one voice. The draw is
 * a hash rather than a stream, so a station answers in the same voice each
 * time the system is visited, this session and the next. The system is not
 * optional: without it every trade station in the galaxy spoke with one
 * voice. A role with no speaker named takes its default.
 */
export function speakerVoice(
	role: keyof typeof NEURAL_ROLE,
	speaker?: Speaker,
): NeuralVoiceId {
	if (role === "machine" || speaker === undefined) return NEURAL_ROLE[role];
	// FNV-1a over the system and the id: a stable spread over the voices,
	// with no draw from any of the world's streams.
	const key = `${speaker.system}:${speaker.id}`;
	let h = 0x811c9dc5;
	for (let i = 0; i < key.length; i++) {
		h ^= key.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return SPEAKER_VOICES[h % SPEAKER_VOICES.length];
}

/** Where the neural voice is. `failed` carries why, for the settings row
 *  and the lab; the formant voice speaks meanwhile in every state but
 *  `ready`. */
export type NeuralState =
	| { kind: "off" }
	| { kind: "loading"; backend: NeuralBackend; bytes: number; total: number }
	| { kind: "ready"; backend: NeuralBackend }
	| { kind: "failed"; reason: string };

/**
 * WebGPU cannot run this build here: free its files rather than keep both
 * (sage round 3 on #606). Only the lab asks for WebGPU now.
 */
function forgetWebGpu(m: VoiceManifest) {
	void dropParts(
		m.version,
		m.backends.webgpu.flatMap((id) =>
			m.files[id].parts.map((p) => `${VOICE_BASE}${p}`),
		),
	);
}

/** The fallback chain's next step after a backend fails. */
export const fallbackAfter = (b: NeuralBackend): NeuralBackend | null =>
	b === "webgpu" ? "wasm" : null;

export const VOICE_BASE = "/voice-model/";

/** Every message to the worker, typed against the one protocol. */
const send = (worker: Worker, message: Request) => worker.postMessage(message);

/**
 * The game's neural voice: the manifest read, a backend chosen, the files
 * downloaded and kept, lines spoken and kept (#604).
 *
 * `start` loads WASM, or the backend the lab forces — WASM again if a
 * forced WebGPU loads and cannot speak — and settles `ready` or `failed`. Every line goes through the line
 * cache first, so a line said in an earlier session is not generated again.
 */
export class NeuralVoice {
	state: NeuralState = { kind: "off" };
	manifest: VoiceManifest | null = null;
	onChange: ((s: NeuralState) => void) | null = null;
	private worker: Worker | null = null;
	/** Bumped by `stop`: a start begun before it gives up at its next step,
	 *  so choosing Synthesised mid-download does not load the voice anyway. */
	private gen = 0;
	/** The start in flight, so two callers share one download. */
	private starting: Promise<NeuralState> | null = null;
	/** Settles the load in flight `false` when its worker is stopped. */
	private settle: ((ok: boolean) => void) | null = null;
	private next = 1;
	private refuseWebGpu(m: VoiceManifest) {
		forgetWebGpu(m);
	}
	/** Lines being generated, by line key. */
	private inflight = new Map<
		string,
		{ samples: Promise<Float32Array | null> }
	>();
	private waiting = new Map<
		number,
		{ ok: (s: Float32Array) => void; no: (e: Error) => void }
	>();

	private set(s: NeuralState) {
		this.state = s;
		this.onChange?.(s);
	}

	/** The manifest, or `null` when this server has no voice (a dev server
	 *  that never ran the fetch, a pull-request build). */
	async readManifest(): Promise<VoiceManifest | null> {
		if (this.manifest) return this.manifest;
		try {
			const res = await fetchBundled(`${VOICE_BASE}manifest.json`);
			if (!res.ok) return null;
			this.manifest = (await res.json()) as VoiceManifest;
			return this.manifest;
		} catch {
			return null;
		}
	}

	/**
	 * The backend the game uses: WASM, everywhere (2026-10-02). WebGPU's fp16
	 * model renders every voice rougher than WASM's q8 —
	 * `scripts/measure-voice-backends.mjs` prints by how much — and the
	 * principal heard it as distortion the lab, on WASM, did not have. WASM is about 2.5x
	 * slower than real time, which the line cache and the background
	 * preparation absorb. The lab can still force WebGPU.
	 */
	async backend(): Promise<NeuralBackend> {
		return "wasm";
	}

	/** What starting would download here, bytes, or `null` with no voice. */
	async downloadBytes(): Promise<number | null> {
		const m = await this.readManifest();
		return m ? backendBytes(m, await this.backend()) : null;
	}

	/** Load the voice — WASM, or what the lab forces — and settle `ready` or
	 *  `failed`. */
	start(force?: NeuralBackend): Promise<NeuralState> {
		// A second caller during a start waits for the same one (sage round 4
		// on #606: the lab read "loading" back as "not ready").
		if (this.starting) return this.starting;
		if (this.state.kind === "ready" || this.state.kind === "loading")
			return Promise.resolve(this.state);
		// Cleared only if it is still this start: `stop` drops a start it
		// cancels, so a new one is not handed the cancelled promise (sage
		// round 3 on #606).
		const p: Promise<NeuralState> = this.begin(force).finally(() => {
			if (this.starting === p) this.starting = null;
		});
		this.starting = p;
		return p;
	}

	private async begin(force?: NeuralBackend): Promise<NeuralState> {
		const gen = this.gen;
		const m = await this.readManifest();
		if (gen !== this.gen) return this.state;
		if (!m) {
			this.set({ kind: "failed", reason: "this server has no voice" });
			return this.state;
		}
		let b: NeuralBackend | null = force ?? (await this.backend());
		try {
			await navigator.storage?.persist?.();
		} catch {
			// Storage the browser will not keep: try anyway.
		}
		while (b && gen === this.gen) {
			if (await this.load(m, b)) return this.state;
			// Stopped, not failed: `stop` settles the load `false` too, and a
			// player who chose Synthesised mid-download has not shown that
			// WebGPU cannot run (sage round 4 on #606).
			if (gen !== this.gen) return this.state;
			const next: NeuralBackend | null = force ? null : fallbackAfter(b);
			if (b === "webgpu" && next) this.refuseWebGpu(m);
			b = next;
		}
		return this.state;
	}

	private load(m: VoiceManifest, backend: NeuralBackend): Promise<boolean> {
		this.halt();
		this.set({
			kind: "loading",
			backend,
			bytes: 0,
			total: backendBytes(m, backend),
		});
		const worker = new Worker(
			new URL("./neural-voice.worker.ts", import.meta.url),
			{ type: "module" },
		);
		this.worker = worker;
		/** Whether a line has come back from this worker yet. */
		let spoke = false;
		return new Promise((settle) => {
			const resolve = (ok: boolean) => {
				if (this.settle === resolve) this.settle = null;
				settle(ok);
			};
			this.settle = resolve;
			/** A load that fails, or a ready voice whose worker dies: every
			 *  line waiting on it is refused and the worker is let go, so no
			 *  caller waits forever (sage round 3 on #606). */
			const fail = (message: string) => {
				if (this.worker !== worker) {
					worker.terminate();
					return resolve(false);
				}
				this.halt();
				this.set({ kind: "failed", reason: `${backend}: ${message}` });
				resolve(false);
			};
			worker.onmessage = (e: MessageEvent<Reply>) => {
				const r = e.data;
				if (r.type === "progress")
					this.set({
						kind: "loading",
						backend,
						bytes: r.bytes,
						total: r.total,
					});
				else if (r.type === "ready") {
					this.set({ kind: "ready", backend });
					resolve(true);
				} else if (r.type === "audio") {
					spoke = true;
					this.waiting.get(r.id)?.ok(r.samples);
					this.waiting.delete(r.id);
				} else if (r.id !== undefined) {
					this.waiting.get(r.id)?.no(new Error(r.message));
					this.waiting.delete(r.id);
					// A WebGPU session that loads but cannot speak a single line
					// is a backend that cannot run here: fall back to WASM
					// rather than keep a ready voice that never speaks (sage
					// round 4 on #606). One bad line after others spoke is a line.
					if (backend === "webgpu" && !spoke && this.worker === worker) {
						this.refuseWebGpu(m);
						fail(r.message);
						void this.start();
					}
				} else fail(r.message);
			};
			worker.onerror = (e) => fail(e.message);
			send(worker, {
				type: "load",
				manifest: m,
				base: VOICE_BASE,
				ep: backend,
			});
		});
	}

	/**
	 * A line at 16 kHz in `voice`: from the line cache, or generated and kept;
	 * `null` while the voice is not ready, when the formant voice speaks.
	 */
	line(
		text: string,
		voice: NeuralVoiceId,
		speed = 1,
		urgent = false,
		keep = true,
	): Promise<Float32Array | null> {
		const worker = this.worker;
		if (this.state.kind !== "ready" || !this.manifest || !worker)
			return Promise.resolve(null);
		const key = lineKey(
			text,
			voice,
			speed,
			this.manifest.version,
			this.state.backend,
		);
		// One generation per line: the numbers station's phrase is asked for
		// ahead and again when it is said (sage round 1 on #606). A later
		// urgent asking moves the queued one to the front.
		const running = this.inflight.get(key);
		if (running) {
			if (urgent) send(worker, { type: "urgent", key });
			return running.samples;
		}
		const samples = this.generate(worker, key, {
			text,
			voice,
			speed,
			urgent,
			keep,
		});
		this.inflight.set(key, { samples });
		// Settled either way; a rejection is the caller's to handle, and the
		// bookkeeping must not raise a second, unhandled one.
		const drop = () => this.inflight.delete(key);
		samples.then(drop, drop);
		return samples;
	}

	private async generate(
		worker: Worker,
		key: string,
		ask: {
			text: string;
			voice: NeuralVoiceId;
			speed: number;
			urgent: boolean;
			/** Into the line cache: a one-off phrase is not, or it would age
			 *  the comms lines out (sage round 6 on #606). */
			keep: boolean;
		},
	): Promise<Float32Array | null> {
		const { text, voice, speed, urgent, keep } = ask;
		const kept = await loadLine(key);
		if (kept) return kept;
		// Stopped during the lookup: that worker is gone and would never answer.
		if (this.worker !== worker || this.state.kind !== "ready") return null;
		const ids = tokenize(textToIpa(text, voice).ipa);
		const id = this.next++;
		const samples = await new Promise<Float32Array>((ok, no) => {
			this.waiting.set(id, { ok, no });
			send(worker, { type: "say", id, key, ids, voice, speed, urgent });
		});
		if (keep) {
			await storeLine(key, samples);
			this.remember(key, samples);
		}
		return samples;
	}

	/**
	 * Make sure a line is in the line cache, without decoding it: the
	 * background preparation runs every line in every speaker voice on each
	 * start, and most are kept already (sage round 5 on #606).
	 */
	async prepare(text: string, voice: NeuralVoiceId): Promise<void> {
		if (this.state.kind !== "ready" || !this.manifest) return;
		const key = lineKey(
			text,
			voice,
			1,
			this.manifest.version,
			this.state.backend,
		);
		if (this.memo.has(key) || (await hasLine(key))) return;
		await this.line(text, voice);
	}

	/** A line from the line cache only, or `null`: for a caller that would
	 *  rather speak the formant voice now than wait for a generation. */
	async kept(
		text: string,
		voice: NeuralVoiceId,
		speed = 1,
	): Promise<Float32Array | null> {
		if (this.state.kind !== "ready" || !this.manifest) return null;
		const key = lineKey(
			text,
			voice,
			speed,
			this.manifest.version,
			this.state.backend,
		);
		const hit = this.memo.get(key);
		if (hit) {
			this.remember(key, hit);
			return hit;
		}
		const kept = await loadLine(key);
		if (kept) this.remember(key, kept);
		return kept;
	}

	/**
	 * The last few lines, decoded, in front of the line cache: the same comms
	 * lines are said again and again, and each IndexedDB read is a
	 * transaction and a conversion (sage round 2 on #606). A line read from
	 * here does not refresh its last use in the store, so eviction there
	 * runs on when it was last *read from the store*.
	 */
	private memo = new Map<string, Float32Array>();
	private remember(key: string, samples: Float32Array) {
		this.memo.delete(key);
		this.memo.set(key, samples);
		if (this.memo.size > MEMO_LINES)
			this.memo.delete(this.memo.keys().next().value as string);
	}

	/** Stop the voice and any start in flight; `off`. */
	stop() {
		this.gen++;
		this.starting = null;
		this.halt();
		this.set({ kind: "off" });
	}

	/** The worker gone, its lines refused and its load settled `false`. */
	private halt() {
		this.worker?.terminate();
		this.worker = null;
		for (const w of this.waiting.values()) w.no(new Error("the voice stopped"));
		this.waiting.clear();
		this.settle?.(false);
	}
}
