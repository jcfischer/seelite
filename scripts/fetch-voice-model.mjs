/**
 * Fetch the neural voice's files into `public/voice-model/` (#604): the model
 * and voices from their repository at the pinned revision, the runtime's
 * binaries from `node_modules`, each checked against its checksum, cut into
 * parts and listed in `manifest.json`. Git-ignored output; the deploy job
 * runs this on `main`, and a developer runs it once to hear the voice.
 *
 *   node scripts/fetch-voice-model.mjs
 *
 * Downloads are kept in `.voice-model-cache/` by checksum, so a second run
 * and a cached CI run fetch nothing. **A checksum that does not match stops
 * the run** — a file that changed under a pinned revision is not one to ship.
 *
 * It also writes `LICENSES.txt` beside the parts, because both works ship
 * under licences that travel with them: Kokoro-82M under Apache-2.0 (its
 * text read from `node_modules/typescript`, which carries it verbatim) and
 * onnxruntime-web under MIT.
 */
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	buildManifest,
	MODEL_REPO,
	MODEL_REVISION,
	partName,
	planParts,
	REMOTE_FILES,
	RUNTIME_FILES,
	remoteUrl,
} from "./lib/voice-model.mjs";

const OUT = "public/voice-model";
const APACHE = readFileSync("node_modules/typescript/LICENSE.txt", "utf8");
if (!APACHE.includes("Apache License") || !APACHE.includes("END OF TERMS"))
	throw new Error("voice model: the Apache-2.0 text was not where it was");
const MIT = `MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const CACHE = ".voice-model-cache";
const ORT_VERSION = JSON.parse(
	readFileSync("node_modules/onnxruntime-web/package.json", "utf8"),
).version;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function remote(file) {
	const cached = join(CACHE, file.sha256);
	if (existsSync(cached)) {
		const buf = readFileSync(cached);
		if (sha256(buf) === file.sha256) return buf;
	}
	process.stdout.write(`fetching ${file.path} … `);
	const res = await fetch(remoteUrl(file.path));
	if (!res.ok) throw new Error(`voice model: ${file.path}: HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	const got = sha256(buf);
	if (got !== file.sha256)
		throw new Error(
			`voice model: ${file.path} has checksum ${got}, expected ${file.sha256} — refusing to ship it`,
		);
	mkdirSync(CACHE, { recursive: true });
	writeFileSync(cached, buf);
	console.log(`${(buf.length / 1048576).toFixed(1)} MiB, checksum ok`);
	return buf;
}

const entries = [];
const buffers = new Map();
for (const f of REMOTE_FILES) {
	const buf = await remote(f);
	buffers.set(f.id, buf);
	entries.push({ id: f.id, name: f.path, bytes: buf.length, sha256: f.sha256 });
}
for (const f of RUNTIME_FILES) {
	const buf = readFileSync(join("node_modules/onnxruntime-web/dist", f.path));
	buffers.set(f.id, buf);
	entries.push({
		id: f.id,
		name: f.path,
		bytes: buf.length,
		sha256: sha256(buf),
	});
}

const manifest = buildManifest(entries, (s) => sha256(Buffer.from(s)));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [id, file] of Object.entries(manifest.files)) {
	const buf = buffers.get(id);
	planParts(buf.length, manifest.partBytes).forEach(([a, b], i) =>
		writeFileSync(join(OUT, partName(id, i)), buf.subarray(a, b)),
	);
	if (file.parts.length !== planParts(buf.length, manifest.partBytes).length)
		throw new Error(`voice model: ${id}: the manifest and the parts disagree`);
}
writeFileSync(
	join(OUT, "LICENSES.txt"),
	`The natural voice in seelite is made of two works, unmodified.

Kokoro-82M, by hexgrad (https://huggingface.co/hexgrad/Kokoro-82M), as
exported to ONNX by onnx-community
(https://huggingface.co/${MODEL_REPO}, revision ${MODEL_REVISION}):
the model and its voices, licensed under the Apache License, Version 2.0.

onnxruntime-web ${ORT_VERSION}, by Microsoft Corporation
(https://github.com/microsoft/onnxruntime): the WebAssembly runtime,
licensed under the MIT License.

The parts in this directory are those files cut into pieces for hosting;
joined in order they are the files as published.

================================================================================
Apache License 2.0 (Kokoro-82M)
================================================================================

${APACHE}
================================================================================
MIT License (onnxruntime-web)
================================================================================

${MIT}`,
);
writeFileSync(
	join(OUT, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);
const total = entries.reduce((n, e) => n + e.bytes, 0);
console.log(
	`voice model ${manifest.version}: ${entries.length} files, ${(total / 1048576).toFixed(1)} MiB in ${OUT}`,
);
