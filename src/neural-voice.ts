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
import { IPA_GB, IPA_US, KOKORO_VOCAB } from "./voice-ipa";

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

type Reply =
	| { type: "ready"; loadMs: number }
	| { type: "audio"; id: number; samples: Float32Array; ms: number }
	| { type: "error"; id?: number; message: string };

/** The browser's handle on the worker: load once, then say lines. */
export class NeuralVoice {
	private worker: Worker | null = null;
	private ready: Promise<number> | null = null;
	private next = 1;
	private waiting = new Map<
		number,
		{
			ok: (r: { samples: Float32Array; ms: number }) => void;
			no: (e: Error) => void;
		}
	>();

	constructor(readonly ep: "wasm" | "webgpu" = "wasm") {}

	/** Start loading the model; resolves with the load time, ms. */
	load(): Promise<number> {
		if (this.ready) return this.ready;
		this.worker = new Worker(
			new URL("./neural-voice.worker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		this.ready = new Promise((resolve, reject) => {
			(this.worker as Worker).onmessage = (e: MessageEvent<Reply>) => {
				const r = e.data;
				if (r.type === "ready") resolve(r.loadMs);
				else if (r.type === "audio") {
					this.waiting.get(r.id)?.ok({ samples: r.samples, ms: r.ms });
					this.waiting.delete(r.id);
				} else {
					const err = new Error(r.message);
					if (r.id === undefined) reject(err);
					else {
						this.waiting.get(r.id)?.no(err);
						this.waiting.delete(r.id);
					}
				}
			};
		});
		this.worker.postMessage({
			type: "load",
			base: "/voice-model/",
			ep: this.ep,
		});
		return this.ready;
	}

	/** A line in a voice, at `KOKORO_RATE`, and how long the model took. */
	async say(
		text: string,
		voice: NeuralVoiceId,
		speed = 1,
	): Promise<{
		samples: Float32Array;
		ms: number;
		unknown: string[];
		ipa: string;
	}> {
		await this.load();
		const { ipa, unknown } = textToIpa(text, voice);
		const ids = tokenize(ipa);
		const id = this.next++;
		const r = await new Promise<{ samples: Float32Array; ms: number }>(
			(ok, no) => {
				this.waiting.set(id, { ok, no });
				this.worker?.postMessage({ type: "say", id, ids, voice, speed });
			},
		);
		return { ...r, unknown, ipa };
	}
}
