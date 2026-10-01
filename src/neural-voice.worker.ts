/**
 * The neural voice's worker (#604): Kokoro-82M on onnxruntime-web, off the
 * main thread, so a line generating does not hold the frame loop. It can
 * still slow frames on WebGPU, where the model shares the GPU with the game:
 * `scripts/measure-neural-voice.mjs` prints the p95.
 *
 * `load` downloads every file the backend needs — its model, its runtime
 * binary and every voice — through the cache (`voice-store.ts`), checks each
 * against the manifest's checksum, and hands the runtime its binary
 * directly, so the runtime fetches no binary of its own; on WASM it imports
 * its loader module from the URL this worker names (see `load`). Lines run **one at a
 * time**, urgent first: two runs overlapping in one session fail, and a
 * comms answer should not wait behind phrases rendered ahead. It still waits
 * for the one line running, which cannot be interrupted; `sayLine` speaks
 * the formant voice rather than wait at all. Each line leaves at 16 kHz, the
 * radio's rate, so the main thread does no resampling.
 */
import {
	backendBytes,
	KOKORO_RATE,
	type NeuralBackend,
	RADIO_RATE,
	type Reply,
	type Request,
	resample,
	styleRow,
	type VoiceManifest,
} from "./neural-voice-core";
import { cachedPart, dropOldModels, dropParts } from "./voice-store";

type Ort = typeof import("onnxruntime-web/wasm");

let ort: Ort;
let session: import("onnxruntime-web/wasm").InferenceSession | null = null;
const voices = new Map<string, Float32Array>();
/** Lines waiting, the urgent first: a comms answer is said before a phrase
 *  rendered ahead for the music, which could hold the worker for seconds. */
type SayMessage = Extract<Request, { type: "say" }>;

/** Every message to the main thread, typed against the one protocol. */
const post = (r: Reply, transfer?: Transferable[]) =>
	self.postMessage(r, transfer ? { transfer } : undefined);
const waiting: SayMessage[] = [];
let busy = false;

async function pump() {
	if (busy) return;
	busy = true;
	while (waiting.length) {
		const at = waiting.findIndex((m) => m.urgent);
		const [m] = waiting.splice(at >= 0 ? at : 0, 1);
		try {
			await say(m);
		} catch (err) {
			post({ type: "error", id: m.id, stage: "say", message: String(err) });
		}
	}
	busy = false;
}

const hex = (buf: ArrayBuffer) =>
	[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A whole file from its parts, checked against its checksum. */
async function assemble(
	manifest: VoiceManifest,
	base: string,
	id: string,
	progress: (bytes: number) => void,
): Promise<ArrayBuffer> {
	const file = manifest.files[id];
	if (!file) throw new Error(`no file ${id} in the manifest`);
	/** Drop this file's kept parts: the next start fetches them again. */
	const forget = () =>
		dropParts(
			manifest.version,
			file.parts.map((p) => `${base}${p}`),
		);
	const out = new Uint8Array(file.bytes);
	let at = 0;
	for (const part of file.parts) {
		const buf = new Uint8Array(
			await cachedPart(manifest.version, `${base}${part}`),
		);
		// A part longer than the room left is a bad part: forget it like a
		// checksum failure, or every later start fails on it (sage round 5).
		if (at + buf.length > file.bytes) {
			await forget();
			throw new Error(`${id}: more than ${file.bytes} bytes`);
		}
		out.set(buf, at);
		at += buf.length;
		progress(buf.length);
	}
	const got =
		at === file.bytes ? hex(await crypto.subtle.digest("SHA-256", out)) : null;
	if (got !== file.sha256) {
		await forget();
		throw new Error(
			got === null
				? `${id}: ${at} bytes, expected ${file.bytes}`
				: `${id}: checksum mismatch`,
		);
	}
	return out.buffer;
}

async function load(m: {
	manifest: VoiceManifest;
	base: string;
	ep: NeuralBackend;
}) {
	const t0 = performance.now();
	const { manifest, base, ep } = m;
	const total = backendBytes(manifest, ep);
	let done = 0;
	const tick = (b: number) => {
		done += b;
		post({ type: "progress", bytes: done, total });
	};
	const [modelId, runtimeId] = manifest.backends[ep];
	const model = await assemble(manifest, base, modelId, tick);
	const runtime = await assemble(manifest, base, runtimeId, tick);
	for (const v of manifest.voices)
		voices.set(
			v,
			new Float32Array(await assemble(manifest, base, `voice:${v}`, tick)),
		);
	await dropOldModels(manifest.version);
	ort = (
		ep === "webgpu"
			? await import("onnxruntime-web/webgpu")
			: await import("onnxruntime-web/wasm")
	) as Ort;
	// One WASM thread: threads would need the page cross-origin isolated,
	// which this node does not do (it would block the visit counter).
	ort.env.wasm.numThreads = 1;
	ort.env.wasm.wasmBinary = runtime;
	// The WASM backend's loader. onnxruntime-web's WASM bundle, unlike its
	// WebGPU one, does not carry its Emscripten loader: it imports
	// `ort-wasm-simd-threaded.mjs` from beside itself, which a dev server
	// serves out of `node_modules` and a build never emitted — so every
	// built game's WASM voice failed while every dev run passed. Named here
	// by `new URL(…, import.meta.url)`, the build emits it as a file of this
	// origin; the package's exports do not reach it by import, and an alias
	// was pre-bundled into a module the worker could not import.
	if (ep === "wasm")
		ort.env.wasm.wasmPaths = {
			mjs: new URL(
				"../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
				import.meta.url,
			).href,
		};
	session = await ort.InferenceSession.create(new Uint8Array(model), {
		executionProviders: [ep],
	});
	post({ type: "ready", backend: ep, loadMs: performance.now() - t0 });
}

async function say(m: SayMessage) {
	if (!session) throw new Error("the model is not loaded");
	const voice = voices.get(m.voice);
	if (!voice) throw new Error(`no voice ${m.voice}`);
	const t0 = performance.now();
	const style = styleRow(voice, m.ids.length);
	const out = await session.run({
		input_ids: new ort.Tensor(
			"int64",
			BigInt64Array.from(m.ids.map((x) => BigInt(x))),
			[1, m.ids.length],
		),
		style: new ort.Tensor("float32", style, [1, style.length]),
		speed: new ort.Tensor("float32", new Float32Array([m.speed]), [1]),
	});
	const wave = (out.waveform ?? Object.values(out)[0]).data as Float32Array;
	const samples = resample(wave, KOKORO_RATE, RADIO_RATE);
	post({ type: "audio", id: m.id, samples, ms: performance.now() - t0 }, [
		samples.buffer,
	]);
}

self.onmessage = (e: MessageEvent<Request>) => {
	const m = e.data;
	if (m.type === "load")
		load(m).catch((err) =>
			post({ type: "error", stage: "load", message: String(err) }),
		);
	else if (m.type === "say") {
		waiting.push(m);
		void pump();
	} else if (m.type === "urgent")
		// A line asked for ahead is now wanted at once. One already running
		// cannot be stopped; one still waiting moves up.
		for (const w of waiting) if (w.key === m.key) w.urgent = true;
};
