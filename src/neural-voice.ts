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
import { IPA_GB, IPA_US, KOKORO_VOCAB } from "./voice-ipa";
import { lineKey, loadLine, storeLine } from "./voice-store";

/** The model's output rate, and the length of one style row. */
export const KOKORO_RATE = 24000;
const STYLE = 256;
/** Kokoro's longest input, in tokens between the two pads. */
const MAX_TOKENS = 510;

/** The voices the prototype ships, by Kokoro's id: the first letter is the
 *  accent (`a` American, `b` British). */
export const NEURAL_VOICES = [
	"bm_george",
	"bm_lewis",
	"am_michael",
	"bf_emma",
	"af_bella",
	"bf_isabella",
	"af_nicole",
	"bf_alice",
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

/** The style row a voice gives an input of `tokens` ids (pads included):
 *  Kokoro's voices are one row per input length. */
export function styleRow(voice: Float32Array, tokens: number): Float32Array {
	const row = Math.min(Math.max(tokens - 2, 0), MAX_TOKENS - 1);
	return voice.slice(row * STYLE, (row + 1) * STYLE);
}

/** 24 kHz to `to` Hz: a windowed-sinc lowpass under the new Nyquist, then
 *  resampled. The radio runs at 16 kHz. */
export function resample(x: Float32Array, from: number, to: number) {
	const ratio = from / to;
	const n = Math.floor(x.length / ratio);
	const out = new Float32Array(n);
	const fc = (0.45 * to) / from;
	const H = 24;
	for (let i = 0; i < n; i++) {
		const c = i * ratio;
		let s = 0;
		let w = 0;
		for (let k = Math.ceil(c - H); k <= Math.floor(c + H); k++) {
			if (k < 0 || k >= x.length) continue;
			const t = k - c;
			const sinc =
				t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
			const win = 0.5 + 0.5 * Math.cos((Math.PI * t) / H);
			s += x[k] * sinc * win;
			w += sinc * win;
		}
		out[i] = w ? s / w : 0;
	}
	return out;
}

/** Who speaks with which neural voice. **The agent's defaults, not the
 *  principal's choice** — the principal heard the set and chose none; the
 *  voice lab lets every role be heard in every voice. */
export const NEURAL_ROLE = {
	approach: "bm_george",
	pilot: "af_bella",
	pirate: "am_michael",
	machine: "af_nicole",
} as const satisfies Record<string, NeuralVoiceId>;

/** The manifest's shape, as the browser reads it (`scripts/lib/voice-model.mjs`
 *  writes it). */
export interface VoiceManifest {
	version: string;
	backends: Record<NeuralBackend, string[]>;
	voices: string[];
	files: Record<string, { bytes: number; sha256: string; parts: string[] }>;
}
export type NeuralBackend = "wasm" | "webgpu";

/** Bytes a backend downloads: its files and every voice. */
export const backendBytes = (m: VoiceManifest, b: NeuralBackend) =>
	[...m.backends[b], ...m.voices.map((v) => `voice:${v}`)].reduce(
		(n, id) => n + m.files[id].bytes,
		0,
	);

/** Where the neural voice is. `failed` carries why, for the settings row
 *  and the lab; the formant voice speaks meanwhile in every state but
 *  `ready`. */
export type NeuralState =
	| { kind: "off" }
	| { kind: "loading"; backend: NeuralBackend; bytes: number; total: number }
	| { kind: "ready"; backend: NeuralBackend }
	| { kind: "failed"; reason: string };

/** The fallback chain's next step after a backend fails. */
export const fallbackAfter = (b: NeuralBackend): NeuralBackend | null =>
	b === "webgpu" ? "wasm" : null;

type Reply =
	| { type: "progress"; bytes: number; total: number }
	| { type: "ready"; backend: NeuralBackend; loadMs: number }
	| { type: "audio"; id: number; samples: Float32Array; ms: number }
	| { type: "error"; id?: number; stage: string; message: string };

export const VOICE_BASE = "/voice-model/";

type GpuNavigator = {
	gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> };
};

/**
 * The game's neural voice: the manifest read, a backend chosen, the files
 * downloaded and kept, lines spoken and kept (#604).
 *
 * `start` walks the fallback chain — WebGPU where the browser offers an
 * adapter with half floats, else WASM, and WASM again if WebGPU fails to
 * load — and settles `ready` or `failed`. Every line goes through the line
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

	/** The backend this browser would use: WebGPU with half floats, or WASM. */
	async backend(): Promise<NeuralBackend> {
		try {
			const adapter = await (navigator as GpuNavigator).gpu?.requestAdapter();
			if (adapter?.features.has("shader-f16")) return "webgpu";
		} catch {
			// No WebGPU: WASM.
		}
		return "wasm";
	}

	/** What starting would download here, bytes, or `null` with no voice. */
	async downloadBytes(): Promise<number | null> {
		const m = await this.readManifest();
		return m ? backendBytes(m, await this.backend()) : null;
	}

	/** Load the voice, falling back WebGPU → WASM; settles `ready` or
	 *  `failed`. `force` picks a backend, for the lab. */
	start(force?: NeuralBackend): Promise<NeuralState> {
		if (this.state.kind === "ready" || this.state.kind === "loading")
			return Promise.resolve(this.state);
		this.starting ??= this.begin(force).finally(() => {
			this.starting = null;
		});
		return this.starting;
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
			const room = await navigator.storage?.estimate?.();
			const free =
				room?.quota !== undefined && room.usage !== undefined
					? room.quota - room.usage
					: Number.POSITIVE_INFINITY;
			if (b === "webgpu" && free < backendBytes(m, b) * 1.1) b = "wasm";
			await navigator.storage?.persist?.();
		} catch {
			// Storage the browser will not describe: try anyway.
		}
		while (b && gen === this.gen) {
			if (await this.load(m, b)) return this.state;
			b = force ? null : fallbackAfter(b);
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
		return new Promise((settle) => {
			const resolve = (ok: boolean) => {
				if (this.settle === resolve) this.settle = null;
				settle(ok);
			};
			this.settle = resolve;
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
					this.waiting.get(r.id)?.ok(r.samples);
					this.waiting.delete(r.id);
				} else if (r.id !== undefined) {
					this.waiting.get(r.id)?.no(new Error(r.message));
					this.waiting.delete(r.id);
				} else {
					this.set({ kind: "failed", reason: `${backend}: ${r.message}` });
					worker.terminate();
					resolve(false);
				}
			};
			worker.onerror = (e) => {
				this.set({ kind: "failed", reason: `${backend}: ${e.message}` });
				worker.terminate();
				resolve(false);
			};
			worker.postMessage({
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
	): Promise<Float32Array | null> {
		const worker = this.worker;
		if (this.state.kind !== "ready" || !this.manifest || !worker)
			return Promise.resolve(null);
		const key = lineKey(text, voice, speed, this.manifest.version);
		// One generation per line: the numbers station's phrase is asked for
		// ahead and again when it is said (sage round 1 on #606). A later
		// urgent asking moves the queued one to the front.
		const running = this.inflight.get(key);
		if (running) {
			if (urgent) worker.postMessage({ type: "urgent", key });
			return running.samples;
		}
		const samples = this.generate(worker, key, text, voice, speed, urgent);
		this.inflight.set(key, { samples });
		void samples.finally(() => this.inflight.delete(key));
		return samples;
	}

	private async generate(
		worker: Worker,
		key: string,
		text: string,
		voice: NeuralVoiceId,
		speed: number,
		urgent: boolean,
	): Promise<Float32Array | null> {
		const kept = await loadLine(key);
		if (kept) return kept;
		// Stopped during the lookup: that worker is gone and would never answer.
		if (this.worker !== worker || this.state.kind !== "ready") return null;
		const ids = tokenize(textToIpa(text, voice).ipa);
		const id = this.next++;
		const samples = await new Promise<Float32Array>((ok, no) => {
			this.waiting.set(id, { ok, no });
			worker.postMessage({ type: "say", id, key, ids, voice, speed, urgent });
		});
		await storeLine(key, samples);
		return samples;
	}

	/** A line from the line cache only, or `null`: for a caller that would
	 *  rather speak the formant voice now than wait for a generation. */
	async kept(
		text: string,
		voice: NeuralVoiceId,
		speed = 1,
	): Promise<Float32Array | null> {
		if (this.state.kind !== "ready" || !this.manifest) return null;
		return loadLine(lineKey(text, voice, speed, this.manifest.version));
	}

	/** Stop the voice and any start in flight; `off`. */
	stop() {
		this.gen++;
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
