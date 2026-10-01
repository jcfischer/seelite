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
	partName,
	planParts,
	REMOTE_FILES,
	RUNTIME_FILES,
	remoteUrl,
} from "./lib/voice-model.mjs";

const OUT = "public/voice-model";
const CACHE = ".voice-model-cache";
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
	join(OUT, "manifest.json"),
	`${JSON.stringify(manifest, null, "\t")}\n`,
);
const total = entries.reduce((n, e) => n + e.bytes, 0);
console.log(
	`voice model ${manifest.version}: ${entries.length} files, ${(total / 1048576).toFixed(1)} MiB in ${OUT}`,
);
