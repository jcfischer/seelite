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
 * Both are the player's to delete: the settings row's Synthesised frees them
 * (`deleteVoiceData`). The browser may evict either under storage pressure;
 * the voice then downloads again or the formant voice speaks.
 */
import { fetchBundled } from "./bundle-fetch";

/** The cache name prefix; the manifest's version completes it. */
export const MODEL_CACHE_PREFIX = "seelite-voice-";
const LINE_DB = "seelite-voice-lines";
const LINE_STORE = "lines";
const LINE_META = "meta";
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
	// A server answers a path it does not have with its page and a 200 (vite
	// does); kept, that page would fail the checksum on every later start.
	if (res.headers.get("content-type")?.includes("text/html"))
		throw new Error(`voice: ${path}: the server has no such file`);
	if (cache) await cache.put(path, res.clone());
	return await res.arrayBuffer();
}

/** Forget a file's kept parts: one that failed its checksum is fetched
 *  again on the next start rather than failing it forever. */
export async function dropParts(version: string, paths: string[]) {
	try {
		const cache = await caches.open(MODEL_CACHE_PREFIX + version);
		for (const p of paths) await cache.delete(p);
	} catch {
		// Nothing kept where there is no Cache Storage.
	}
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

/**
 * The one connection this page holds, opened on first use. One, because a
 * connection per line was never closed and left `deleteVoiceData`'s delete
 * blocked behind them (sage round 1 on #606); and it closes itself when
 * another tab upgrades or deletes the database.
 */
let lineDb: Promise<IDBDatabase> | null = null;

function openLines(): Promise<IDBDatabase> {
	lineDb ??= new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(LINE_DB, 2);
		// Version 1 kept the samples and the bookkeeping in one record, so
		// eviction read every sample back; it only ever existed on dev
		// servers, and its lines are dropped rather than migrated.
		req.onupgradeneeded = () => {
			const db = req.result;
			for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
			db.createObjectStore(LINE_STORE, { keyPath: "key" });
			db.createObjectStore(LINE_META, { keyPath: "key" });
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				lineDb = null;
			};
			resolve(db);
		};
		req.onerror = () => {
			lineDb = null;
			reject(req.error);
		};
	});
	return lineDb;
}

/** A line's samples; its size and last use live beside it in `LINE_META`,
 *  so eviction reads a few numbers per line rather than every sample. */
interface StoredLine {
	key: string;
	samples: Int16Array;
}
interface LineMeta {
	key: string;
	bytes: number;
	used: number;
}

const request = <T>(req: IDBRequest<T>) =>
	new Promise<T>((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});

/** Whether a line is kept: its key alone, read-only, nothing decoded. */
export async function hasLine(key: string): Promise<boolean> {
	try {
		const db = await openLines();
		const meta = db.transaction(LINE_META, "readonly").objectStore(LINE_META);
		return (await request(meta.getKey(key))) !== undefined;
	} catch {
		return false;
	}
}

/** A stored line as 16 kHz samples, or `null`; a hit is marked used. */
export async function loadLine(key: string): Promise<Float32Array | null> {
	try {
		const db = await openLines();
		const tx = db.transaction([LINE_STORE, LINE_META], "readwrite");
		const hit = (await request(tx.objectStore(LINE_STORE).get(key))) as
			| StoredLine
			| undefined;
		if (!hit) return null;
		tx.objectStore(LINE_META).put({
			key,
			bytes: hit.samples.byteLength,
			used: Date.now(),
		} satisfies LineMeta);
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
		const tx = db.transaction([LINE_STORE, LINE_META], "readwrite");
		const lines = tx.objectStore(LINE_STORE);
		const meta = tx.objectStore(LINE_META);
		lines.put({ key, samples: pcm } satisfies StoredLine);
		meta.put({
			key,
			bytes: pcm.byteLength,
			used: Date.now(),
		} satisfies LineMeta);
		const all = (await request(meta.getAll())) as LineMeta[];
		for (const k of evictionPlan(all, LINE_STORE_BYTES)) {
			lines.delete(k);
			meta.delete(k);
		}
	} catch {
		// A line not kept is rendered again next time.
	}
}

/**
 * Everything the neural voice keeps: the settings row's Synthesised. `true`
 * when both are gone; `false` when the browser refused or another tab holds
 * the lines open — the delete then completes when that tab closes them.
 */
export async function deleteVoiceData(): Promise<boolean> {
	await dropOldModels(null);
	// This page's own connection first, or the delete waits behind it.
	const open = lineDb;
	lineDb = null;
	if (open) (await open.catch(() => null))?.close();
	return new Promise<boolean>((resolve) => {
		try {
			const req = indexedDB.deleteDatabase(LINE_DB);
			req.onsuccess = () => resolve(true);
			req.onerror = req.onblocked = () => resolve(false);
		} catch {
			resolve(false);
		}
	});
}
