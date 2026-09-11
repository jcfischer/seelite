/**
 * #89's save policy, as a machine: what is written, when, and what a refusal
 * does.
 *
 * The policy sits behind a narrow backend interface and the store knows nothing
 * about IndexedDB. That is not a testing convenience — it is the only way the
 * cadence gets checked at all. Bun has no fake `setTimeout`, so a debounce
 * verified on the wall clock would be measuring the machine; the scheduler is
 * injected and `tests/save-store.test.ts` drives it by hand. What is left for
 * the browser is the one thing only a browser has: a real transaction, in
 * `indexedDbSaveBackend` below and `scripts/probe-save.mjs` beside it.
 *
 * ## The cadence (D4)
 *
 * **Any change to saved state marks the save dirty**, and a write fires once
 * the dirt settles. Docking, undock, hyperspace arrival and quit flush
 * unconditionally. Docking-only was the genre answer and #89 rejected it: it
 * loses a whole cruise leg and any combat in it.
 *
 * ## Two records per slot (#89's correction to D7)
 *
 * A slot holds `live`, which the debounce writes continuously, and
 * `lastDocked`, written at each docking flush. A non-permadeath death restores
 * `lastDocked` — genuine leg-loss, which is what the classic-Elite framing
 * described. The resolution's original wording ("rolls back to the last write")
 * was written against the dock-only cadence rejected in the same round, where
 * reloading the last write is dying again.
 *
 * `lastDocked` is **not** a last-known-good fallback, and D9's rejection of one
 * stands: a `lastDocked` that will not parse is a named error, never a silent
 * substitution.
 *
 * ## What deliberately is not here
 *
 * **There is no death flush.** A permadeath player who kills the tab inside the
 * debounce window keeps the commander. That is D7 applied consistently —
 * permadeath is stated and not enforced — rather than a hole to close.
 * `restoreAfterDeath` reads and never writes, and a test holds it to that.
 *
 * **There is no storage cap.** #89's D2: the model's §9.8 bound stands, and
 * IndexedDB holds it, so a cap here would be a policy inventing a limit the
 * store does not have.
 */

import { parseSave, type SaveEnvelope, serializeSave } from "./save-envelope";

/**
 * The debounce window, milliseconds.
 *
 * #89 left this to the wire-in on purpose: it is a browser-tier measurement
 * rather than an arithmetic one, and no bun figure can pick it. Measured by
 * `scripts/probe-save.mjs`, which does a real IndexedDB write and read of a
 * save at T4's byte scale in the page and prints the spread. The window clears
 * the **median** write there, so the common case is one transaction rather than
 * a queue. It does not clear the worst, and it is not meant to: a maximum over
 * a dozen samples is not a bound — the probe read 330–345 ms on three quiet
 * runs and 412 on a loaded one — and a write slower than the window is handled
 * rather than prevented, because `run` queues behind whatever is in flight
 * instead of racing it. The cost is asymmetric in the other direction too: too
 * long widens the loss on a tab close, and #89 already accepts a loss of one
 * window.
 *
 * **It is the bounded loss, and it is read off the page rather than restated**
 * — `window.__seelite.save.debounceMs` — so a probe cannot go falsely red
 * against its own copy.
 */
export const SAVE_DEBOUNCE_MS = 400;

/** The default slot, for a player who never names one. */
export const DEFAULT_SLOT = "default";

/** A slot holds two records (#89's D7 correction). */
export type SaveRecordKind = "live" | "lastDocked";

/** Why a flush is happening. `dock` is the one that also writes the
 *  checkpoint; the rest are D4's unconditional flushes. */
export type FlushReason = "dock" | "undock" | "jump" | "quit";

/**
 * The scheduler the debounce runs on, injected.
 *
 * Returns a cancel. `setTimeout` in the browser; a hand-driven stub in tests.
 */
export type Scheduler = (fn: () => void, ms: number) => () => void;

/** What a store needs of its storage, and nothing more. */
export interface SaveBackend {
	read(slot: string, kind: SaveRecordKind): Promise<unknown | null>;
	write(slot: string, kind: SaveRecordKind, blob: unknown): Promise<void>;
	slots(): Promise<string[]>;
	deleteSlot(slot: string): Promise<void>;
}

export interface SaveStoreOptions {
	backend: SaveBackend;
	schedule: Scheduler;
	/**
	 * The state to write, read **at the moment the write fires**.
	 *
	 * A getter rather than a snapshot: the whole point of a debounce is that
	 * the write carries the latest state, and a caller handing over a value at
	 * `markDirty` time would save the state that first dirtied the save rather
	 * than the state that settled.
	 */
	current: () => SaveEnvelope;
}

const fail = (message: string): never => {
	throw new Error(`save: ${message}`);
};

/**
 * A record is keyed `` `${slot} ${kind}` ``, so a space in a name makes one
 * slot addressable as another: `"a b"` lists as `"a"` and `deleteSlot("a")`
 * removes it. Only `DEFAULT_SLOT` is reachable until a naming surface lands, so
 * this is a boundary closed before it opens rather than a fix.
 */
const assertSlot = (slot: string): void => {
	if (slot.length === 0 || slot.includes(" "))
		fail(`"${slot}" is not a slot name — a name may not contain a space`);
};

export class SaveStore {
	private readonly backend: SaveBackend;
	private readonly schedule: Scheduler;
	private readonly current: () => SaveEnvelope;
	private dirty = false;
	private cancel: (() => void) | null = null;
	/** The write in flight, if any. One at a time: two overlapping
	 *  transactions can land in either order, and the loser would be the newer
	 *  state. */
	private inFlight: Promise<void> | null = null;
	private slot = DEFAULT_SLOT;

	constructor(options: SaveStoreOptions) {
		this.backend = options.backend;
		this.schedule = options.schedule;
		this.current = options.current;
	}

	/** The slot subsequent debounced writes go to. */
	setSlot(slot: string): void {
		assertSlot(slot);
		this.slot = slot;
	}

	/** D4's trigger: any change to saved state, coalesced. */
	markDirty(): void {
		this.dirty = true;
		this.cancel?.();
		this.cancel = this.schedule(() => {
			this.cancel = null;
			void this.run(["live"], this.slot).catch(() => {
				// A debounced write has no caller to reject to. The record it
				// failed to replace is still there (D9's stale-not-broken), and
				// the dirty flag survives, so the next flush retries.
				this.dirty = true;
			});
		}, SAVE_DEBOUNCE_MS);
	}

	/**
	 * D4's unconditional write. `dock` additionally lays down the checkpoint.
	 *
	 * A flush with nothing dirty writes nothing: the record on disk already
	 * says what the world says, and rewriting it would spend a transaction to
	 * change no bytes.
	 */
	async flush(reason: FlushReason, slot: string = this.slot): Promise<void> {
		assertSlot(slot);
		this.cancel?.();
		this.cancel = null;
		if (!this.dirty) return;
		const kinds: SaveRecordKind[] =
			reason === "dock" ? ["live", "lastDocked"] : ["live"];
		await this.run(kinds, slot);
	}

	/** Resolves once no write is in flight. Tests await it; so does quit. */
	async settled(): Promise<void> {
		while (this.inFlight) await this.inFlight;
	}

	private async run(kinds: SaveRecordKind[], slot: string): Promise<void> {
		// Queue behind whatever is already writing rather than racing it. The
		// awaited chain is what keeps `maxInFlight` at one.
		while (this.inFlight) await this.inFlight;
		const blob = serializeSave(this.current());
		this.dirty = false;
		const work = (async () => {
			for (const kind of kinds) await this.backend.write(slot, kind, blob);
		})();
		this.inFlight = work.finally(() => {
			this.inFlight = null;
		});
		try {
			await this.inFlight;
		} catch (error) {
			// The write did not land, so the save is still dirty. D9: the
			// previous record is untouched — stale rather than broken.
			this.dirty = true;
			throw error;
		}
	}

	/**
	 * Reads a record back, or throws with a named reason.
	 *
	 * Never repairs and never substitutes. D9: the player is told which slot
	 * failed and why, the bad record stays on disk as the only copy of what is
	 * left, and export is what they can still do with it.
	 */
	async load(
		slot: string,
		kind: SaveRecordKind = "live",
	): Promise<SaveEnvelope> {
		const raw = await this.backend.read(slot, kind);
		if (raw === null || raw === undefined)
			fail(`slot "${slot}" has no ${kind} record`);
		return parseSave(raw);
	}

	/**
	 * #89's D7, corrected: a death restores the last dock, or ends a permadeath
	 * commander.
	 *
	 * Returns `null` for permadeath. **It writes nothing** — see the header on
	 * the tab-close window.
	 */
	async restoreAfterDeath(
		slot: string,
		commander: { permadeath: boolean },
	): Promise<SaveEnvelope | null> {
		if (commander.permadeath) return null;
		return this.load(slot, "lastDocked");
	}

	async slots(): Promise<string[]> {
		return this.backend.slots();
	}

	/**
	 * D6's export: the **slot**, both records, as text.
	 *
	 * With no backend, a cleared profile or a storage eviction destroys the
	 * commander, and this file is the only mitigation that exists. It doubles
	 * as a bug report someone can attach, which is why it is plain JSON.
	 *
	 * The records are copied out unparsed, so a slot holding a record this
	 * build refuses can still be exported — which is the whole of D9's point.
	 */
	async exportSlot(slot: string): Promise<string> {
		const live = await this.backend.read(slot, "live");
		const lastDocked = await this.backend.read(slot, "lastDocked");
		if (live === null && lastDocked === null)
			fail(`slot "${slot}" has no record to export`);
		// **The file names no slot.** A slot is where the player filed the save,
		// not a property of it — and a file that carried one would either be
		// refused on import into a different slot or quietly disagree with
		// where it landed, so a re-export could not be byte-identical.
		return JSON.stringify({ live, lastDocked }, null, "\t");
	}

	/**
	 * D6's import. Both records are parsed before either is written, so a file
	 * that is half a save cannot leave a slot half-filled.
	 */
	async importSlot(slot: string, text: string): Promise<void> {
		assertSlot(slot);
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			fail("this file is not a save — it is not JSON");
		}
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			fail("this file is not a save");
		const o = parsed as Record<string, unknown>;
		const live = o.live ?? null;
		const lastDocked = o.lastDocked ?? null;
		if (live === null && lastDocked === null)
			fail("this file is not a save — it holds no record");
		// Validate first, write second.
		if (live !== null) parseSave(live);
		if (lastDocked !== null) parseSave(lastDocked);
		if (live !== null) await this.backend.write(slot, "live", live);
		if (lastDocked !== null)
			await this.backend.write(slot, "lastDocked", lastDocked);
	}
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

/** What the in-memory backend exposes beyond the interface, so a test can put
 *  a store under conditions a real one reaches and a happy path never does. */
export interface MemorySaveBackend extends SaveBackend {
	readonly writes: number;
	readonly inFlight: number;
	readonly maxInFlight: number;
	has(slot: string, kind: SaveRecordKind): Promise<boolean>;
	raw(slot: string, kind: SaveRecordKind): Promise<unknown | null>;
	/** Hold every write open until `release`, so dirt can arrive mid-write. */
	hold(): void;
	release(): void;
	failNextWrite(): void;
	corruptVersion(slot: string, kind: SaveRecordKind): Promise<void>;
	truncate(slot: string, kind: SaveRecordKind): Promise<void>;
}

/**
 * The headless backend. Deep-copies on the way in and out, because a store that
 * handed back its own object would let a test mutate what it thinks is on disk
 * — and so would a real one never do.
 */
export function memorySaveBackend(): MemorySaveBackend {
	const rows = new Map<string, unknown>();
	let writes = 0;
	let inFlight = 0;
	let maxInFlight = 0;
	let gate: Promise<void> | null = null;
	let openGate: (() => void) | null = null;
	let failNext = false;
	const at = (slot: string, kind: SaveRecordKind) => `${slot} ${kind}`;
	const copy = (value: unknown) =>
		value === null || value === undefined
			? null
			: (JSON.parse(JSON.stringify(value)) as unknown);
	return {
		get writes() {
			return writes;
		},
		get inFlight() {
			return inFlight;
		},
		get maxInFlight() {
			return maxInFlight;
		},
		async read(slot, kind) {
			return copy(rows.get(at(slot, kind)) ?? null);
		},
		async write(slot, kind, blob) {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			try {
				if (gate) await gate;
				if (failNext) {
					failNext = false;
					throw new Error("backend: the write failed");
				}
				rows.set(at(slot, kind), copy(blob));
				writes += 1;
			} finally {
				inFlight -= 1;
			}
		},
		async slots() {
			return [...new Set([...rows.keys()].map((k) => k.split(" ")[0]))];
		},
		async deleteSlot(slot) {
			for (const key of [...rows.keys()])
				if (key.startsWith(`${slot} `)) rows.delete(key);
		},
		async has(slot, kind) {
			return rows.has(at(slot, kind));
		},
		async raw(slot, kind) {
			return copy(rows.get(at(slot, kind)) ?? null);
		},
		hold() {
			gate = new Promise<void>((resolve) => {
				openGate = resolve;
			});
		},
		release() {
			openGate?.();
			gate = null;
			openGate = null;
		},
		failNextWrite() {
			failNext = true;
		},
		async corruptVersion(slot, kind) {
			const row = rows.get(at(slot, kind)) as Record<string, unknown>;
			rows.set(at(slot, kind), { ...row, saveSchemaVersion: 0 });
		},
		async truncate(slot, kind) {
			const row = { ...(rows.get(at(slot, kind)) as Record<string, unknown>) };
			delete row.commander;
			rows.set(at(slot, kind), row);
		},
	};
}

/**
 * The browser backend: one object store, one transaction per write.
 *
 * #89's D1. A transaction is what makes a torn write unrepresentable, and it is
 * the reason `localStorage` is out — that, and the measured size, which
 * `scripts/measure-save-size.ts` reprints rather than this comment restating.
 *
 * There is no quota probe, and that is not an omission: a store with no quota
 * worth probing was half the case for choosing it.
 */
export const SAVE_DB_NAME = "seelite-saves";
export const SAVE_STORE_NAME = "slots";
const SAVE_DB_VERSION = 1;

const openSaveDb = (factory: IDBFactory): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = factory.open(SAVE_DB_NAME, SAVE_DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(SAVE_STORE_NAME))
				db.createObjectStore(SAVE_STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(new Error(`save: the save database would not open`));
	});

const asPromise = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(new Error("save: the backend refused"));
	});

export function indexedDbSaveBackend(
	factory: IDBFactory = indexedDB,
): SaveBackend {
	let db: Promise<IDBDatabase> | null = null;
	const open = () => {
		db ??= openSaveDb(factory);
		return db;
	};
	const at = (slot: string, kind: SaveRecordKind) => `${slot} ${kind}`;
	return {
		async read(slot, kind) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readonly");
			const value = await asPromise(
				tx.objectStore(SAVE_STORE_NAME).get(at(slot, kind)),
			);
			return value ?? null;
		},
		async write(slot, kind, blob) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readwrite");
			// The write is awaited on the **transaction**, not on the request:
			// a resolved `put` only means the request was accepted, and a
			// transaction that aborts afterwards leaves the old record in
			// place — which is D9's stale-not-broken and must be reported as a
			// failure rather than as a success.
			const done = new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onabort = () =>
					reject(new Error("save: the backend aborted the write"));
				tx.onerror = () => reject(new Error("save: the backend refused"));
			});
			tx.objectStore(SAVE_STORE_NAME).put(blob, at(slot, kind));
			await done;
		},
		async slots() {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readonly");
			const keys = await asPromise(
				tx.objectStore(SAVE_STORE_NAME).getAllKeys(),
			);
			return [
				...new Set(keys.map((key) => String(key).split(" ")[0]).filter(Boolean)),
			];
		},
		async deleteSlot(slot) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readwrite");
			const store = tx.objectStore(SAVE_STORE_NAME);
			const keys = await asPromise(store.getAllKeys());
			for (const key of keys)
				if (String(key).startsWith(`${slot} `)) store.delete(key);
			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(new Error("save: the backend refused"));
			});
		},
	};
}
