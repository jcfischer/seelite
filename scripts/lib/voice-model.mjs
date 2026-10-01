/**
 * The neural voice's files (#604): what the build fetches, pinned by revision
 * and checksum, and how each is cut into parts the static host accepts.
 *
 * Cloudflare Pages refuses a single asset over 25 MiB
 * (developers.cloudflare.com/pages/platform/limits, read 2026-10-01), and the
 * models are 88 and 156 MiB, so every file ships as parts of `PART_BYTES` and
 * the worker joins them. The weights are Kokoro-82M (Apache-2.0,
 * `hexgrad/Kokoro-82M`), converted to ONNX by onnx-community; the runtime's
 * binaries come from `onnxruntime-web` (MIT) at the version the lockfile pins.
 *
 * Pure: `scripts/fetch-voice-model.mjs` does the fetching and writing, and
 * `tests/voice-model.test.ts` holds this half.
 */

/** The model repository and the revision every file is fetched at. */
export const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const MODEL_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

/** Each part's size: under the host's 25 MiB with room to spare. */
export const PART_BYTES = 20 * 1024 * 1024;

/** The voices the game ships, by Kokoro's id, each with the checksum its
 *  file must have: one list, so a voice cannot be fetched without being
 *  offered or offered without being fetched. Kokoro's first letter is the
 *  accent: `a` American, `b` British. */
export const VOICE_SHA256 = {
	bm_george: "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc",
	bm_lewis: "b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97",
	am_michael:
		"1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1",
	bf_emma: "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73",
	af_bella: "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b",
	bf_isabella:
		"3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f",
	af_nicole: "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a",
	bf_alice: "08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573",
};

/** The voices, in the order the lab offers them. */
export const VOICE_IDS = Object.keys(VOICE_SHA256);

/** Files fetched from the model repository, with the checksum each must
 *  have. A mismatch stops the build. */
export const REMOTE_FILES = [
	{
		id: "model-wasm",
		path: "onnx/model_quantized.onnx",
		sha256: "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
	},
	{
		id: "model-webgpu",
		path: "onnx/model_fp16.onnx",
		sha256: "ba4527a874b42b21e35f468c10d326fdff3c7fc8cac1f85e9eb6c0dfc35c334a",
	},
	...Object.entries(VOICE_SHA256).map(([v, sha256]) => ({
		id: `voice:${v}`,
		path: `voices/${v}.bin`,
		sha256,
	})),
];

/** Files copied from the installed runtime: the lockfile pins them. */
export const RUNTIME_FILES = [
	{ id: "ort-wasm", path: "ort-wasm-simd-threaded.wasm" },
	{ id: "ort-webgpu", path: "ort-wasm-simd-threaded.jsep.wasm" },
];

/** What each backend downloads: its model, its runtime binary and every
 *  voice. */
export const BACKEND_FILES = {
	wasm: ["model-wasm", "ort-wasm"],
	webgpu: ["model-webgpu", "ort-webgpu"],
};

/** The URL a remote file is fetched from, at the pinned revision. */
export const remoteUrl = (path) =>
	`https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${path}`;

/** A file's parts: `[start, end)` byte ranges of at most `partBytes`. */
export function planParts(bytes, partBytes = PART_BYTES) {
	if (!(bytes > 0)) throw new Error(`voice model: a file of ${bytes} bytes`);
	const parts = [];
	for (let start = 0; start < bytes; start += partBytes)
		parts.push([start, Math.min(bytes, start + partBytes)]);
	return parts;
}

/** A part's file name: the id made safe, and its index. */
export const partName = (id, index) =>
	`${id.replace(/[^a-z0-9_-]/gi, "_")}.${index}.part`;

/**
 * The manifest the worker reads: each file's parts, size and checksum, and a
 * version that is a checksum of all of them, so a cache named by it can never
 * hold a file from another build.
 *
 * `entries` is `[{ id, name, bytes, sha256 }]`; `versionOf` the hash of a
 * string, passed in so this module stays free of `node:crypto`.
 */
export function buildManifest(entries, versionOf, partBytes = PART_BYTES) {
	const files = {};
	for (const e of [...entries].sort((a, b) => a.id.localeCompare(b.id))) {
		files[e.id] = {
			name: e.name,
			bytes: e.bytes,
			sha256: e.sha256,
			parts: planParts(e.bytes, partBytes).map((_, i) => partName(e.id, i)),
		};
	}
	const version = versionOf(
		Object.entries(files)
			.map(([id, f]) => `${id}:${f.sha256}`)
			.join("\n"),
	).slice(0, 16);
	return {
		version,
		revision: MODEL_REVISION,
		partBytes,
		backends: BACKEND_FILES,
		voices: VOICE_IDS,
		files,
	};
}
