/**
 * The neural voice's pure half (#604): what the main thread and the worker
 * share — the model's rates and limits, the style row, the resampler, the
 * manifest's shape and the messages between the two threads. It imports
 * nothing, so the worker's bundle carries none of the main thread's code
 * (sage round 4 on #606); `neural-voice.ts` re-exports it.
 */

/** The model's output rate, and the length of one style row. */
export const KOKORO_RATE = 24000;
const STYLE = 256;
/** Kokoro's longest input, in tokens between the two pads. */
export const MAX_TOKENS = 510;

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
	// The taps depend only on where the output sample falls between two
	// input samples, and 24 kHz to 16 kHz has two such places: the weights
	// are worked out once per place rather than per sample (sage round 3 on
	// #606). A ratio with many places stops caching and stays correct.
	const kernels = new Map<number, { first: number; w: Float64Array }>();
	const kernel = (frac: number) => {
		const hit = kernels.get(frac);
		if (hit) return hit;
		const first = Math.ceil(frac - H);
		const last = Math.floor(frac + H);
		const w = new Float64Array(last - first + 1);
		for (let o = first; o <= last; o++) {
			const t = o - frac;
			const sinc =
				t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
			w[o - first] = sinc * (0.5 + 0.5 * Math.cos((Math.PI * t) / H));
		}
		const k = { first, w };
		if (kernels.size < 64) kernels.set(frac, k);
		return k;
	};
	for (let i = 0; i < n; i++) {
		const c = i * ratio;
		const base = Math.floor(c);
		const { first, w } = kernel(c - base);
		let s = 0;
		let sum = 0;
		for (let j = 0; j < w.length; j++) {
			const k = base + first + j;
			if (k < 0 || k >= x.length) continue;
			s += x[k] * w[j];
			sum += w[j];
		}
		out[i] = sum ? s / sum : 0;
	}
	return out;
}

/** The manifest's shape, as the browser reads it (`scripts/lib/voice-model.mjs`
 *  writes it). */
export interface VoiceManifest {
	version: string;
	backends: Record<NeuralBackend, string[]>;
	voices: string[];
	files: Record<string, { bytes: number; sha256: string; parts: string[] }>;
}
export type NeuralBackend = "wasm" | "webgpu";

/** The files a backend loads: its model, its runtime and every voice. */
export const backendFileIds = (m: VoiceManifest, b: NeuralBackend) => [
	...m.backends[b],
	...m.voices.map((v) => `voice:${v}`),
];

/** Bytes a backend downloads. */
export const backendBytes = (m: VoiceManifest, b: NeuralBackend) =>
	backendFileIds(m, b).reduce((n, id) => n + m.files[id].bytes, 0);

/** What the worker sends the main thread. */
export type Reply =
	| { type: "progress"; bytes: number; total: number }
	| { type: "ready"; backend: NeuralBackend; loadMs: number }
	| { type: "audio"; id: number; samples: Float32Array; ms: number }
	| { type: "error"; id?: number; stage: string; message: string };

/** What the main thread sends the worker. */
export type Request =
	| { type: "load"; manifest: VoiceManifest; base: string; ep: NeuralBackend }
	| {
			type: "say";
			id: number;
			key: string;
			ids: number[];
			voice: string;
			speed: number;
			urgent: boolean;
	  }
	| { type: "urgent"; key: string };
