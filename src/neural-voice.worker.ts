/**
 * The neural voice's worker (prototype): Kokoro-82M on onnxruntime-web's WASM
 * backend, off the main thread so a line never costs a frame. It loads the
 * model and the voices from the game's own files and runs token ids to a
 * waveform; the text side is `neural-voice.ts`'s.
 */
import { styleRow } from "./neural-voice";

type Ort = typeof import("onnxruntime-web/wasm");
let ort: Ort;
let session: import("onnxruntime-web/wasm").InferenceSession | null = null;
let base = "/voice-model/";
const voices = new Map<string, Float32Array>();

async function voice(id: string): Promise<Float32Array> {
	const hit = voices.get(id);
	if (hit) return hit;
	const buf = await (await fetch(`${base}voices/${id}.bin`)).arrayBuffer();
	const v = new Float32Array(buf);
	voices.set(id, v);
	return v;
}

self.onmessage = async (e: MessageEvent) => {
	const m = e.data;
	try {
		if (m.type === "load") {
			const t0 = performance.now();
			base = m.base;
			// WASM on the q8 model, or WebGPU on fp16 (q8 is not a WebGPU format).
			const gpu = m.ep === "webgpu";
			ort = (
				gpu
					? await import("onnxruntime-web/webgpu")
					: await import("onnxruntime-web/wasm")
			) as Ort;
			// Threads need a cross-origin-isolated page (COOP/COEP); without it,
			// one.
			// The WebGPU path runs its own scheduling: one WASM thread beside it.
			ort.env.wasm.numThreads = !gpu && self.crossOriginIsolated
				? Math.min(4, navigator.hardwareConcurrency || 1)
				: 1;
			// The bundle build carries its own glue; only the binary is fetched.
			ort.env.wasm.wasmPaths = {
				wasm: gpu
					? `${base}ort/ort-wasm-simd-threaded.jsep.wasm`
					: `${base}ort/ort-wasm-simd-threaded.wasm`,
			};
			session = await ort.InferenceSession.create(
				`${base}${gpu ? "model_fp16.onnx" : "model_quantized.onnx"}`,
				{
					executionProviders: [gpu ? "webgpu" : "wasm"],
				},
			);
			self.postMessage({ type: "ready", loadMs: performance.now() - t0 });
		} else if (m.type === "say") {
			if (!session) throw new Error("the model is not loaded");
			const t0 = performance.now();
			const ids: number[] = m.ids;
			const style = styleRow(await voice(m.voice), ids.length);
			const out = await session.run({
				input_ids: new ort.Tensor(
					"int64",
					BigInt64Array.from(ids.map((x) => BigInt(x))),
					[1, ids.length],
				),
				style: new ort.Tensor("float32", style, [1, style.length]),
				speed: new ort.Tensor("float32", new Float32Array([m.speed]), [1]),
			});
			const samples = new Float32Array(
				(out.waveform ?? Object.values(out)[0]).data as Float32Array,
			);
			self.postMessage(
				{ type: "audio", id: m.id, samples, ms: performance.now() - t0 },
				{ transfer: [samples.buffer] },
			);
		}
	} catch (err) {
		self.postMessage({ type: "error", id: m.id, message: String(err) });
	}
};
