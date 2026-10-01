/**
 * The neural voice's files and stores (#604): the parts the static host
 * accepts, the manifest's version, the guard on the one same-origin fetch,
 * the line cache's key and eviction, and the lexicon's IPA. How the voice
 * sounds is the principal's ear; that it ships, loads and is cached is here
 * and in `probe-neural-voice`.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	BACKEND_FILES,
	buildManifest,
	PART_BYTES,
	partName,
	planParts,
	REMOTE_FILES,
	VOICE_IDS,
} from "../scripts/lib/voice-model.mjs";
import { isBundlePath } from "../src/bundle-fetch";
import {
	backendBytes,
	NEURAL_VOICES,
	type VoiceManifest,
} from "../src/neural-voice";
import { LEXICON } from "../src/speech-lexicon";
import { IPA_GB, IPA_US } from "../src/voice-ipa";
import { evictionPlan, lineKey } from "../src/voice-store";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("the parts", () => {
	test("no part is over the host's 25 MiB, and the parts cover the file", () => {
		expect(PART_BYTES).toBeLessThan(25 * 1024 * 1024);
		for (const bytes of [1, PART_BYTES, PART_BYTES + 1, 163_234_740]) {
			const parts = planParts(bytes);
			expect(parts[0][0]).toBe(0);
			expect(parts.at(-1)?.[1]).toBe(bytes);
			for (let i = 1; i < parts.length; i++)
				expect(parts[i][0]).toBe(parts[i - 1][1]);
			for (const [a, b] of parts) expect(b - a).toBeLessThanOrEqual(PART_BYTES);
		}
		expect(() => planParts(0)).toThrow();
	});

	test("a part name is safe on any host", () => {
		expect(partName("voice:bm_george", 3)).toBe("voice_bm_george.3.part");
	});

	test("every voice the game ships is fetched and checksummed", () => {
		for (const v of VOICE_IDS)
			expect(REMOTE_FILES.find((f) => f.id === `voice:${v}`)?.sha256).toMatch(
				/^[0-9a-f]{64}$/,
			);
	});
});

describe("the manifest", () => {
	const entries = [
		{ id: "model-wasm", name: "m.onnx", bytes: 90e6, sha256: "a".repeat(64) },
		{
			id: "model-webgpu",
			name: "f.onnx",
			bytes: 160e6,
			sha256: "b".repeat(64),
		},
		{ id: "ort-wasm", name: "o.wasm", bytes: 11e6, sha256: "c".repeat(64) },
		{ id: "ort-webgpu", name: "j.wasm", bytes: 21e6, sha256: "d".repeat(64) },
		...VOICE_IDS.map((v, i) => ({
			id: `voice:${v}`,
			name: `${v}.bin`,
			bytes: 522240,
			sha256: String(i).repeat(64),
		})),
	];

	test("the version changes with any file, and not with the order they came in", () => {
		const a = buildManifest(entries, sha);
		const b = buildManifest([...entries].reverse(), sha);
		expect(a.version).toBe(b.version);
		const changed = entries.map((e) =>
			e.id === "ort-wasm" ? { ...e, sha256: "e".repeat(64) } : e,
		);
		expect(buildManifest(changed, sha).version).not.toBe(a.version);
	});

	test("each backend's download is its model, its runtime and every voice", () => {
		// The script's manifest, read the way the game reads `manifest.json`.
		const m = buildManifest(entries, sha) as unknown as VoiceManifest;
		const voices = VOICE_IDS.length * 522240;
		expect(backendBytes(m, "wasm")).toBe(90e6 + 11e6 + voices);
		expect(backendBytes(m, "webgpu")).toBe(160e6 + 21e6 + voices);
		expect(Object.keys(BACKEND_FILES).sort()).toEqual(["wasm", "webgpu"]);
	});

	test("the game offers exactly the voices the manifest ships", () => {
		// Two lists, one in the fetch script and one in the bundle: a voice in
		// one only is downloaded and never offered, or offered and never there.
		expect([...NEURAL_VOICES] as string[]).toEqual([...VOICE_IDS]);
	});
});

describe("the one same-origin fetch", () => {
	test("only a path of this origin is a bundle path", () => {
		expect(isBundlePath("/voice-model/manifest.json")).toBe(true);
		expect(isBundlePath("//evil.example/x")).toBe(false);
		expect(isBundlePath("https://huggingface.co/x")).toBe(false);
		expect(isBundlePath("voice-model/x")).toBe(false);
		expect(isBundlePath("/\\evil.example")).toBe(false);
	});
});

describe("the line cache", () => {
	test("a line is keyed by what makes it sound different", () => {
		const k = lineKey("Hello.", "bm_george", 1, "v1");
		expect(lineKey("Hello.", "bm_george", 1, "v1")).toBe(k);
		expect(lineKey("Hello.", "bf_emma", 1, "v1")).not.toBe(k);
		expect(lineKey("Hello.", "bm_george", 1.1, "v1")).not.toBe(k);
		expect(lineKey("Hello.", "bm_george", 1, "v2")).not.toBe(k);
		expect(lineKey("Hello!", "bm_george", 1, "v1")).not.toBe(k);
	});

	test("eviction drops the least recently used until the store fits", () => {
		const lines = [
			{ key: "a", bytes: 40, used: 3 },
			{ key: "b", bytes: 40, used: 1 },
			{ key: "c", bytes: 40, used: 2 },
		];
		expect(evictionPlan(lines, 100)).toEqual(["b"]);
		expect(evictionPlan(lines, 50)).toEqual(["b", "c"]);
		expect(evictionPlan(lines, 200)).toEqual([]);
	});
});

describe("the lexicon's IPA", () => {
	test("every word the game can say has IPA in both accents", () => {
		// A word with none is skipped by the neural voice without a sound —
		// regenerate with `node scripts/build-voice-ipa.mjs` after adding one.
		for (const word of Object.keys(LEXICON)) {
			expect(IPA_US[word], word).toBeTruthy();
			expect(IPA_GB[word], word).toBeTruthy();
		}
	});
});
