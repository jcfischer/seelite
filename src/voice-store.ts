/**
 * What the neural voice keeps in the browser (#604), across sessions:
 *
 * - **The model's parts** in Cache Storage, in a cache named by the
 *   manifest's version, so a later session reads them back and downloads
 *   nothing, and a new build's version leaves the old cache to be deleted.
 * - **Spoken lines** in IndexedDB, 16 kHz and 16-bit, keyed by what makes a
 *   line sound different — text, voice, speed and model version — and kept
 *   under `LINE_STORE_BYTES` by dropping the least recently used.
 *
 * Both are the player's to delete: the settings row's Formant frees them
 * (`deleteVoiceData`). The browser may evict either under storage pressure;
 * the voice then downloads again or the formant voice speaks.
 */
import { fetchBundled } from "./bundle-fetch";

/** The cache name prefix; the manifest's version completes it. */
export const MODEL_CACHE_PREFIX = "seelite-voice-";
const LINE_DB = "seelite-voice-lines";
const LINE_STORE = "lines";
/** The spoken lines' budget: about 150 lines of four seconds. */
export const LINE_STORE_BYTES = 20 * 1024 * 1024;

/** A line's key: everything that makes two renders of it differ. */
export const lineKey = (
	text: string,
	voice: string,
	speed: number,
	version: string,
) => `${version}|${voice}|${speed.toFixed(3)}|${text}`;

/** The keys to drop, least recently used first, until the rest fit `cap`. */
export function evictionPlan(
	lines: readonly { key: string; bytes: number; used: number }[],
	cap: number,
): string[] {
	let total = lines.reduce((n, l) => n + l.bytes, 0);
	const drop: string[] = [];
	for (const l of [...lines].sort((a, b) => a.used - b.used)) {
		if (total <= cap) break;
		drop.push(l.key);
		total -= l.bytes;
	}
	return drop;
}

/** A part of the model: from the cache, or fetched and kept. */
export async function cachedPart(
	version: string,
	path: string,
): Promise<ArrayBuffer> {
	let cache: Cache | null = null;
	try {
		cache = await caches.open(MODEL_CACHE_PREFIX + version);
		const hit = await cache.match(path);
		if (hit) return await hit.arrayBuffer();
	} catch {
		// No Cache Storage (a private window): fetch and do not keep.
	}
	const res = await fetchBundled(path);
	if (!res.ok) throw new Error(`voice: ${path}: HTTP ${res.status}`);
	if (cache) await cache.put(path, res.clone());
	return await res.arrayBuffer();
}

/** Delete every model cache but `keep`'s: a new build leaves the old. */
export async function dropOldModels(keep: string | null) {
	try {
		for (const name of await caches.keys())
			if (
				name.startsWith(MODEL_CACHE_PREFIX) &&
				name !== MODEL_CACHE_PREFIX + keep
			)
				await caches.delete(name);
	} catch {
		// Nothing to drop where there is no Cache Storage.
	}
}

function openLines(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(LINE_DB, 1);
		req.onupgradeneeded = () =>
			req.result.createObjectStore(LINE_STORE, { keyPath: "key" });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

interface StoredLine {
	key: string;
	samples: Int16Array;
	bytes: number;
	used: number;
}

const request = <T>(req: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** A stored line as 16 kHz samples, or `null`; a hit is marked used. */
export async function loadLine(key: string): Promise<Float32Array | null> {
	try {
		const db = await openLines();
		const store = db
			.transaction(LINE_STORE, "readwrite")
			.objectStore(LINE_STORE);
		const hit = (await request(store.get(key))) as StoredLine | undefined;
		if (!hit) return null;
		store.put({ ...hit, used: Date.now() });
		const out = new Float32Array(hit.samples.length);
		for (let i = 0; i < out.length; i++) out[i] = hit.samples[i] / 32767;
		return out;
	} catch {
		return null;
	}
}

/** Keep a line, then drop the least used until the store fits its budget. */
export async function storeLine(key: string, samples: Float32Array) {
	try {
		const pcm = new Int16Array(samples.length);
		for (let i = 0; i < pcm.length; i++)
			pcm[i] = Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767);
		const db = await openLines();
		const store = db
			.transaction(LINE_STORE, "readwrite")
			.objectStore(LINE_STORE);
		store.put({ key, samples: pcm, bytes: pcm.byteLength, used: Date.now() });
		const all = (await request(store.getAll())) as StoredLine[];
		for (const k of evictionPlan(all, LINE_STORE_BYTES)) store.delete(k);
	} catch {
		// A line not kept is rendered again next time.
	}
}

/** Everything the neural voice keeps: the settings row's Formant. */
export async function deleteVoiceData() {
	await dropOldModels(null);
	await new Promise<void>((resolve) => {
		try {
			const req = indexedDB.deleteDatabase(LINE_DB);
			req.onsuccess = req.onerror = req.onblocked = () => resolve();
		} catch {
			resolve();
		}
	});
}
