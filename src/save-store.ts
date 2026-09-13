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
 * a **whole median save** there — the synchronous serialize plus the
 * transaction, because the first version priced only the async half and the
 * half a player feels as a dropped frame is the other one. So the common case
 * is one transaction rather than a queue.
 *
 * The transaction is **almost entirely fixed cost**: the same probe writes the
 * live game's own save and the padded one in one interleaved run, and a factor
 * of ~380 in size costs about 2 ms. That is why a bigger save does not want a
 * bigger window, and it is measured in the shipped probe rather than quoted
 * from two runs of two revisions, which is what it was for a round. It does not clear the worst, and it is not meant to: a maximum over
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

/**
 * How many consecutive debounced-write failures re-arm the timer before it
 * stops drumming.
 *
 * Not a give-up: the dirty flag survives the cap, so the next dock, trade, jump
 * or quit still retries. What the cap ends is a refusing backend being asked
 * every window forever, each attempt paying the synchronous serialize a player
 * feels.
 */
export const SAVE_RETRY_LIMIT = 3;

/** A slot holds two records (#89's D7 correction). */
export type SaveRecordKind = "live" | "lastDocked";

/** Every record kind, for the operations that move a whole slot. A kind added
 *  to the type and missed here would be dropped by a rename. */
const SAVE_RECORD_KINDS = [
	"live",
	"lastDocked",
] as const satisfies readonly SaveRecordKind[];

/**
 * What a record key puts between its slot and its kind: `recordKey` builds the
 * key, `slotOfKey` reads the slot back, and `assertSlot` refuses a name that
 * holds it. Both backends key through these.
 */
const KEY_SEPARATOR = "\0";
const recordKey = (slot: string, kind: SaveRecordKind) =>
	`${slot}${KEY_SEPARATOR}${kind}`;
const slotOfKey = (key: unknown) => String(key).split(KEY_SEPARATOR)[0];

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
	/**
	 * The same bytes under several keys, in **one** transaction.
	 *
	 * A dock flush writes `live` and `lastDocked` from one blob, and running
	 * them as two sequential transactions cost twice the measured median and
	 * left a window where the pair disagreed. One transaction halves the
	 * latency and makes the checkpoint and the live record land together, which
	 * is what D1 chose a transactional store for.
	 */
	writeMany(
		slot: string,
		kinds: readonly SaveRecordKind[],
		blob: unknown,
	): Promise<void>;
	slots(): Promise<string[]>;
	deleteSlot(slot: string): Promise<void>;
	/**
	 * Both records of `from` under `to`, in **one** transaction.
	 *
	 * A rename is copy-then-delete (`persistent-world-state.md` §11.3), and the
	 * copy carries two different blobs — so it cannot be `writeMany`, and two
	 * `write`s would leave a window with half a Commander under the new name.
	 * Refuses when `from` holds no record, rather than copying nothing.
	 */
	copySlot(from: string, to: string): Promise<void>;
	/**
	 * A value in the **pointer store** (§11.4): the active Commander, the
	 * one-shot continue and a pending new game. Outside `SaveEnvelope` and its
	 * integrity hash, and outside the slots store, so `slots()` never lists one.
	 */
	readMeta(key: SaveMetaKey): Promise<unknown | null>;
	/** Several pointer-store values in one transaction. `null` deletes a key. */
	writeMeta(entries: Partial<Record<SaveMetaKey, unknown>>): Promise<void>;
	/** Read a pointer-store value and delete it, in one transaction — which is
	 *  what makes the one-shot continue consumed by exactly one boot. */
	takeMeta(key: SaveMetaKey): Promise<unknown | null>;
}

/** The pointer store's keys (§11.3, §11.4). */
export type SaveMetaKey = "active" | "oneShot" | "pending";

/**
 * A Commander's exclusive lock, per tab (§11.3).
 *
 * `tryHold` never waits: it returns a release, or `null` when anybody holds the
 * lock — another tab, or this tab's own attached store, because the same
 * exclusive lock is not granted twice. Injected, because bun has no Web Locks;
 * `webSlotLocks` is the browser's and `memorySlotLocks` the headless tier's.
 */
export interface SlotLocks {
	tryHold(slot: string): Promise<(() => void) | null>;
}

/** What New game chose, on disk before the reload (§11.3, S5). */
export interface PendingNewGame {
	name: string;
	seed: number;
	permadeath: boolean;
}

/** The Commander a boot is for, and how it was arrived at (§11.2, §11.4). */
export interface ActiveCommander {
	slot: string;
	/** Set when a pending new game names the slot, which has no record yet. */
	pending: PendingNewGame | null;
	/** The pointer named a Commander that is gone, so this is the default. */
	fellBack: boolean;
}

export interface SaveStoreOptions {
	backend: SaveBackend;
	/**
	 * What `hold` takes this store's Commander lock from. Required, not
	 * defaulted, for `FlightPerformance`'s reason: a store built without it could
	 * never hold its Commander, and the two are indistinguishable in a diff.
	 *
	 * **Holding is `hold`'s, not the constructor's.** A held lock refuses the
	 * catalog's rename and delete. It does not stop this store's own writes: a
	 * store whose `hold()` returned `false` still flushes, and the caller that
	 * attaches a store is what decides not to write then.
	 */
	locks: SlotLocks;
	/** The Commander debounced writes go to. `DEFAULT_SLOT` when omitted. */
	slot?: string;
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
	/** Called when a debounced write fails. Every other write path rejects to
	 *  its caller; this one has none. */
	onWriteFailed?: (error: unknown, consecutive: number) => void;
}

const fail = (message: string): never => {
	throw new Error(`save: ${message}`);
};

/**
 * A record is keyed by `recordKey`, so a name holding `KEY_SEPARATOR` makes one
 * slot addressable as another: `"a\0b"` lists as `"a"` and `deleteSlot("a")`
 * removes it. A space is allowed: `tests/source-bytes.test.ts` records why this
 * once refused one.
 *
 * Each refusal names its own reason, because the overlay shows it to a player.
 */
const assertSlot = (slot: string): void => {
	if (slot.length === 0)
		fail(`"" is not a slot name — a name may not be empty`);
	if (slot.includes(KEY_SEPARATOR))
		fail(
			`"${slot}" is not a slot name — a name may not contain a NUL character`,
		);
};

/**
 * A pending new game as read back, or `null` for none.
 *
 * Shape-checked rather than cast: the pointer store is outside the envelope's
 * hash, so nothing else stands between a stray value and a boot that builds a
 * world from it. A value that is not one is a named refusal, which the boot's
 * D9 path turns into a fault rather than a world built from garbage.
 */
const parsePending = (raw: unknown): PendingNewGame | null => {
	if (raw === null || raw === undefined) return null;
	const o = raw as Record<string, unknown>;
	if (
		typeof raw !== "object" ||
		typeof o.name !== "string" ||
		typeof o.seed !== "number" ||
		!Number.isInteger(o.seed) ||
		o.seed < 0 ||
		o.seed > 0xffff_ffff ||
		typeof o.permadeath !== "boolean"
	)
		fail("the pending new game on disk is not one this build can read");
	assertSlot(o.name as string);
	return {
		name: o.name as string,
		seed: o.seed as number,
		permadeath: o.permadeath as boolean,
	};
};

export class SaveStore {
	private readonly backend: SaveBackend;
	private readonly locks: SlotLocks;
	/** The release of this store's own lock, once `hold` has taken it. */
	private held: (() => void) | null = null;
	/**
	 * The record kinds whose last write failed (§11.5). A kind clears only on a
	 * write **of that kind** that lands: a debounced write carries `live` alone,
	 * so a failed dock flush keeps `lastDocked` held through any number of good
	 * debounced writes — the checkpoint a non-permadeath death restores is still
	 * the older one, and the badge must still say so.
	 *
	 * **Per kind, not per Commander, and that is enough.** A store writes one
	 * Commander for the life of its tab: it holds that Commander's lock, which
	 * refuses a rename or a delete of it, and the game flushes with no slot
	 * argument. `flush`'s `slot` parameter is the tests' and the probe's seam. A
	 * caller that aimed one store at two Commanders would mix their faults here.
	 */
	private readonly failed = new Set<SaveRecordKind>();
	private readonly schedule: Scheduler;
	private readonly current: () => SaveEnvelope;
	private dirty = false;
	private cancel: (() => void) | null = null;
	/** The write in flight, if any. One at a time: two overlapping
	 *  transactions can land in either order, and the loser would be the newer
	 *  state. */
	private inFlight: Promise<void> | null = null;
	private slot = DEFAULT_SLOT;
	/** Told when a debounced write fails — the one write path with no caller to
	 *  reject to, and the one D9's "the player is told" could not reach. */
	private readonly onWriteFailed?: (
		error: unknown,
		consecutive: number,
	) => void;
	/** Consecutive debounced-write failures, reset by any write that lands. */
	private failures = 0;

	constructor(options: SaveStoreOptions) {
		this.backend = options.backend;
		this.locks = options.locks;
		if (options.slot !== undefined) {
			assertSlot(options.slot);
			this.slot = options.slot;
		}
		this.schedule = options.schedule;
		this.current = options.current;
		this.onWriteFailed = options.onWriteFailed;
	}

	/** D4's trigger: any change to saved state, coalesced. */
	markDirty(): void {
		this.dirty = true;
		this.cancel?.();
		this.cancel = this.schedule(() => {
			this.cancel = null;
			void this.run(["live"], this.slot).catch((error) => {
				// A debounced write has no caller to reject to, and the record it
				// failed to replace is still there (D9's stale-not-broken).
				//
				// **It re-arms rather than waiting for a flush.** Setting the
				// flag alone was described as "the next flush retries", and it
				// armed nothing: a failed debounced write then sat until the next
				// dock, trade, jump or quit, which is the cadence doing almost
				// none of the writing waiting on the cadence doing almost all of
				// it. And D9 says the player is *told*; nothing reached them at
				// all, because `saveFault` is written once at boot.
				this.failures += 1;
				this.onWriteFailed?.(error, this.failures);
				// **Capped, and the cap is not a nicety.** Re-arming without one
				// paid the synchronous `serializeSave` hitch every window
				// forever against a backend that is simply refusing — a quota,
				// a private window — and paid it silently. After the cap the
				// flag stays dirty, so the next dock, trade, jump or quit still
				// retries; what stops is the drum.
				if (this.failures < SAVE_RETRY_LIMIT) this.markDirty();
				else this.dirty = true;
			});
		}, SAVE_DEBOUNCE_MS);
	}

	/**
	 * D4's unconditional write. `dock` additionally lays down the checkpoint.
	 *
	 * A flush with nothing dirty writes nothing: the record on disk already
	 * says what the world says, and rewriting it would spend a transaction to
	 * change no bytes.
	 *
	 * **`quit` is the exception, and it has to be.** The other three flushes
	 * each follow a `saveDirty()` at the transition that caused them, so the
	 * flag is set by the time they run; `pagehide` follows nothing. A new game
	 * flown in normal flight only and then closed had *never* dirtied, so it
	 * wrote no `live` record at all — and with `?permadeath`, the D7 choice went
	 * with it. The premise "the record on disk already says what the world says"
	 * is false when there is no record.
	 */
	async flush(reason: FlushReason, slot: string = this.slot): Promise<void> {
		assertSlot(slot);
		this.cancel?.();
		this.cancel = null;
		if (!this.dirty && reason !== "quit") return;
		const kinds: SaveRecordKind[] =
			reason === "dock" ? ["live", "lastDocked"] : ["live"];
		await this.run(kinds, slot);
	}

	/**
	 * Resolves once no write is in flight.
	 *
	 * **Quit does not await it**, and the comment here said it did. `pagehide`
	 * runs `saveFlush`, which is `void`-ed by construction, so the quit flush is
	 * best-effort: a page torn down mid-transaction loses that write. That is
	 * the same class of loss #89 already accepts for the debounce window and for
	 * permadeath on a tab close, and an async store cannot close it — but a
	 * module that claims otherwise is worse than the gap. The only caller is
	 * `scripts/probe-save.mjs`, which has to await the store because it reads
	 * the record back.
	 */
	async settled(): Promise<void> {
		while (this.inFlight) await this.inFlight.catch(() => {});
	}

	private async run(kinds: SaveRecordKind[], slot: string): Promise<void> {
		// Queue behind whatever is already writing rather than racing it. The
		// awaited chain is what keeps `maxInFlight` at one.
		//
		// **The rejection is swallowed, not inherited.** A bare `await` here
		// rethrows whatever the in-flight write failed with, so a `flush("dock")`
		// queued behind a failing debounced write threw before writing anything
		// — no `lastDocked` checkpoint, and `settled()` rejecting too. The
		// earlier write's failure is its own caller's; this one still has its
		// own to report.
		while (this.inFlight) await this.inFlight.catch(() => {});
		const blob = serializeSave(this.current());
		this.dirty = false;
		const work = this.backend.writeMany(slot, kinds, blob);
		this.inFlight = work.finally(() => {
			this.inFlight = null;
		});
		try {
			await this.inFlight;
			this.failures = 0;
			for (const kind of kinds) this.failed.delete(kind);
		} catch (error) {
			// The write did not land, so the save is still dirty. D9: the
			// previous record is untouched — stale rather than broken.
			this.dirty = true;
			for (const kind of kinds) this.failed.add(kind);
			throw error;
		}
	}

	/** The record kinds whose last write failed; §11.5's badge shows while this
	 *  is not empty. */
	get failedKinds(): ReadonlySet<SaveRecordKind> {
		return this.failed;
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

	/** The lock request in flight, shared by overlapping `hold` calls. */
	private holding: Promise<(() => void) | null> | null = null;

	/**
	 * Takes this store's own Commander lock for the life of the tab, or reports
	 * that another store already has it. Idempotent once held.
	 *
	 * An attached store holds it so that no other tab can rename or delete the
	 * Commander it is writing, and so a second tab cannot attach a second store
	 * to the same slot — two stores writing one slot.
	 *
	 * **Overlapping calls share one request.** Each call asking for itself let
	 * the second one's `null` (the first already held the lock) overwrite the
	 * first one's release, which left a lock nothing could give back. Rejects
	 * when the request itself fails, which is a fault and not a Commander held
	 * elsewhere.
	 */
	async hold(): Promise<boolean> {
		if (this.held) return true;
		this.holding ??= this.locks.tryHold(this.slot).finally(() => {
			this.holding = null;
		});
		const release = await this.holding;
		if (release && !this.held) this.held = release;
		return this.held !== null;
	}
}

/**
 * The Commander overlay's operations (`persistent-world-state.md` §11.3–§11.4),
 * on `{ backend, locks }` alone.
 *
 * **Not on `SaveStore`, because of dependency order.** A store writes one
 * Commander and needs `current`, which needs a constructed `Game`. The boot calls
 * `resolveActive` to learn which Commander that is, and an overlay in a fault
 * state, with no store attached, still has to reach New game and Load.
 */
export class CommanderCatalog {
	private readonly backend: SaveBackend;
	private readonly locks: SlotLocks;

	constructor(options: { backend: SaveBackend; locks: SlotLocks }) {
		this.backend = options.backend;
		this.locks = options.locks;
	}

	/**
	 * D6's import. Both records are parsed before either is written, so a file
	 * that is half a save cannot leave a slot half-filled.
	 */
	async importSlot(slot: string, text: string): Promise<void> {
		assertSlot(slot);
		// Into a **new** Commander, never over one (§11.3): a slot is the whole
		// save, so importing into a taken name would replace that Commander.
		await this.assertFree(slot);
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

	/**
	 * The Commander a boot is for (§11.2 step 1, §11.4).
	 *
	 * A pending new game wins before the pointer: its slot is empty by design.
	 * Otherwise the pointer; a pointer naming a Commander that is gone falls
	 * back to the default and says so. No pointer at all is the default, which
	 * is where every save before §11 lives — not a fallback.
	 */
	async resolveActive(): Promise<ActiveCommander> {
		const pending = await this.readPending();
		if (pending) {
			// **A pending record beside a `live` record lost only its clean-up**:
			// the tab closed between the first save and `finishNewGame`. The save
			// wins, so a boot never builds a fresh world over that progress.
			const landed = (await this.backend.read(pending.name, "live")) !== null;
			return {
				slot: pending.name,
				pending: landed ? null : pending,
				fellBack: false,
			};
		}
		const active = await this.backend.readMeta("active");
		if (active === null || active === DEFAULT_SLOT)
			return { slot: DEFAULT_SLOT, pending: null, fellBack: false };
		if (
			typeof active === "string" &&
			(await this.backend.slots()).includes(active)
		)
			return { slot: active, pending: null, fellBack: false };
		return { slot: DEFAULT_SLOT, pending: null, fellBack: true };
	}

	/**
	 * Load and Import's last step (§11.3): points at a Commander and writes the
	 * one-shot continue that lets the reload skip the overlay.
	 *
	 * Refuses a Commander another tab holds, without waiting — that would be two
	 * stores writing one slot. The check takes the lock and gives it straight
	 * back, so it leaves the Commander free for the boot the reload makes.
	 *
	 * **It clears a pending new game.** A pending record is read before the
	 * pointer, so one left by a new game whose tab closed before its first save
	 * would win over the Commander chosen here. That includes a pending record
	 * this build cannot read, so Load is also a way out of that fault.
	 */
	async chooseCommander(slot: string): Promise<void> {
		assertSlot(slot);
		await this.assertUnlocked(slot);
		await this.backend.writeMeta({
			pending: null,
			active: slot,
			oneShot: slot,
		});
	}

	/**
	 * The one-shot continue, consumed: the Commander it names, or `null`.
	 * A second call returns `null` — one transaction reads and deletes it.
	 */
	async takeOneShot(): Promise<string | null> {
		const value = await this.backend.takeMeta("oneShot");
		return typeof value === "string" ? value : null;
	}

	/**
	 * New game's choice, on disk before the reload (§11.3, S5): the pending
	 * record, the pointer and the one-shot, in one transaction.
	 *
	 * No envelope is built here — a `SaveEnvelope` needs a world and a flight,
	 * and only a constructed `Game` has those. `finishNewGame` clears the
	 * pending record once the new Commander's first `live` record has landed.
	 */
	async beginNewGame(choice: PendingNewGame): Promise<void> {
		const pending = parsePending(choice) as PendingNewGame;
		await this.assertFree(pending.name);
		await this.backend.writeMeta({
			pending,
			active: pending.name,
			oneShot: pending.name,
		});
	}

	/**
	 * Clears the pending new game, and refuses to while its Commander has no
	 * `live` record: until then the pending record is the only thing on disk
	 * holding what the player chose.
	 */
	async finishNewGame(): Promise<void> {
		const pending = await this.readPending();
		if (!pending) return;
		if ((await this.backend.read(pending.name, "live")) === null)
			fail(`the new Commander "${pending.name}" has no save yet`);
		await this.backend.writeMeta({ pending: null });
	}

	/**
	 * Copy-then-delete (§11.3). A failure between the two leaves two
	 * Commanders, never zero. The pointer follows the Commander it named.
	 */
	async renameSlot(from: string, to: string): Promise<void> {
		assertSlot(from);
		assertSlot(to);
		await this.assertFree(to);
		await this.withFreeLock(from, async () => {
			await this.backend.copySlot(from, to);
			if ((await this.backend.readMeta("active")) === from)
				await this.backend.writeMeta({ active: to });
			await this.backend.deleteSlot(from);
		});
	}

	/** Deletes a Commander. The overlay asks for confirmation first; the store
	 *  refuses one a tab has a store attached to. */
	async deleteSlot(slot: string): Promise<void> {
		assertSlot(slot);
		await this.withFreeLock(slot, () => this.backend.deleteSlot(slot));
	}

	/**
	 * One rule for names (§11.3): a name in `slots()` is taken, and so is the
	 * name a pending new game holds, which has no record yet.
	 */
	private async assertFree(name: string): Promise<void> {
		// **An unreadable pending record holds no name.** Refusing here would
		// refuse the `beginNewGame` that is meant to overwrite it, and import and
		// rename with it. The boot still faults on the record in `resolveActive`.
		// Only the parser's refusal is read as "no name": a backend that fails to
		// read rejects, because a name a readable pending game holds is not free
		// just because the read failed.
		const raw = await this.backend.readMeta("pending");
		let pending: PendingNewGame | null;
		try {
			pending = parsePending(raw);
		} catch {
			pending = null;
		}
		if (pending?.name === name || (await this.backend.slots()).includes(name))
			fail(`there is already a Commander named "${name}"`);
	}

	/** The pending new game on disk, or `null`. Refuses one this build cannot
	 *  read, by name. */
	private async readPending(): Promise<PendingNewGame | null> {
		return parsePending(await this.backend.readMeta("pending"));
	}

	/** Refuses a Commander whose lock anyone holds, and holds nothing itself: the
	 *  check takes the lock and gives it straight back. */
	private assertUnlocked(slot: string): Promise<void> {
		return this.withFreeLock(slot, async () => {});
	}

	/** Runs `work` while holding `slot`'s lock, refusing when anyone else — this
	 *  tab's own store included — already holds it. */
	private async withFreeLock(
		slot: string,
		work: () => Promise<void>,
	): Promise<void> {
		const release = await this.locks.tryHold(slot);
		if (!release)
			fail(`Commander "${slot}" is open in another tab or in play here`);
		try {
			await work();
		} finally {
			(release as () => void)();
		}
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
	/** Fail the next `deleteSlot`, so a rename can be interrupted between its
	 *  copy and its delete — a state a happy path never reaches. */
	failNextDelete(): void;
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
	// Its own map, so the pointer store is disjoint from the slots by
	// construction here — which is why the collision it guards against is
	// checked against the real IndexedDB backend instead (§11.4).
	const meta = new Map<SaveMetaKey, unknown>();
	let failDelete = false;
	let writes = 0;
	let inFlight = 0;
	let maxInFlight = 0;
	let gate: Promise<void> | null = null;
	let openGate: (() => void) | null = null;
	let failNext = false;
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
			return copy(rows.get(recordKey(slot, kind)) ?? null);
		},
		async write(slot, kind, blob) {
			return this.writeMany(slot, [kind], blob);
		},
		async writeMany(slot, kinds, blob) {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			try {
				if (gate) await gate;
				if (failNext) {
					failNext = false;
					throw new Error("backend: the write failed");
				}
				// One transaction, so either every key lands or none does — the
				// same all-or-nothing the IndexedDB backend gets for free.
				for (const kind of kinds) rows.set(recordKey(slot, kind), copy(blob));
				writes += 1;
			} finally {
				inFlight -= 1;
			}
		},
		async slots() {
			return [...new Set([...rows.keys()].map((k) => slotOfKey(k)))];
		},
		async deleteSlot(slot) {
			if (failDelete) {
				failDelete = false;
				throw new Error("backend: the delete failed");
			}
			for (const key of [...rows.keys()])
				if (slotOfKey(key) === slot) rows.delete(key);
		},
		async copySlot(from, to) {
			const found = SAVE_RECORD_KINDS.filter((kind) =>
				rows.has(recordKey(from, kind)),
			);
			if (found.length === 0) fail(`"${from}" holds no record to copy`);
			for (const kind of found)
				rows.set(recordKey(to, kind), copy(rows.get(recordKey(from, kind))));
		},
		async readMeta(key) {
			return copy(meta.get(key) ?? null);
		},
		async writeMeta(entries) {
			for (const [key, value] of Object.entries(entries) as [
				SaveMetaKey,
				unknown,
			][])
				if (value === null || value === undefined) meta.delete(key);
				else meta.set(key, copy(value));
		},
		async takeMeta(key) {
			const value = copy(meta.get(key) ?? null);
			meta.delete(key);
			return value;
		},
		failNextDelete() {
			failDelete = true;
		},
		async has(slot, kind) {
			return rows.has(recordKey(slot, kind));
		},
		async raw(slot, kind) {
			return copy(rows.get(recordKey(slot, kind)) ?? null);
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
			const row = rows.get(recordKey(slot, kind)) as Record<string, unknown>;
			rows.set(recordKey(slot, kind), { ...row, saveSchemaVersion: 0 });
		},
		async truncate(slot, kind) {
			const row = {
				...(rows.get(recordKey(slot, kind)) as Record<string, unknown>),
			};
			delete row.commander;
			rows.set(recordKey(slot, kind), row);
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
/**
 * The pointer store (§11.4): the active Commander, the one-shot continue and a
 * pending new game.
 *
 * **Its own object store, not a key in `slots`.** A record there is filed under
 * its slot name, a separator and its kind, and `slots()` lists the distinct
 * prefixes of every key — so a pointer stored there would be listed as a
 * Commander, and `deleteSlot` could match it.
 */
export const SAVE_POINTER_STORE_NAME = "pointer";
/**
 * 2 adds the pointer store. The upgrade creates it and touches nothing in
 * `slots`, so every version-1 save opens under version 2 intact —
 * `scripts/probe-save.mjs` seeds a version-1 database and checks it.
 */
export const SAVE_DB_VERSION = 2;

/** What `open` reports while another tab holds the database at an older
 *  version, and the upgrade is waiting for it (§11.4). */
export const SAVE_BLOCKED_MESSAGE =
	"save: another seelite tab is still open on an older version of the save — close it, then reload this one";

/** What every operation reports after another tab upgraded the database out
 *  from under this one, which closed its connection. */
export const SAVE_CLOSED_MESSAGE =
	"save: the save was upgraded by another seelite tab — reload this one";

const openSaveDb = (
	factory: IDBFactory,
	onVersionChange: () => void,
): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = factory.open(SAVE_DB_NAME, SAVE_DB_VERSION);
		let refused = false;
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(SAVE_STORE_NAME))
				db.createObjectStore(SAVE_STORE_NAME);
			if (!db.objectStoreNames.contains(SAVE_POINTER_STORE_NAME))
				db.createObjectStore(SAVE_POINTER_STORE_NAME);
		};
		// **A blocked upgrade is a named fault, not a hang.** A tab still open on
		// the version-1 build holds the database and the upgrade waits for it,
		// and the boot awaits this open before it builds a game — so a block with
		// no handler never boots at all. The request stays pending; if it does
		// succeed later, that connection is closed rather than leaked, because
		// this boot has already taken D9's path.
		request.onblocked = () => {
			refused = true;
			reject(new Error(SAVE_BLOCKED_MESSAGE));
		};
		request.onsuccess = () => {
			const db = request.result;
			if (refused) {
				db.close();
				return;
			}
			// The other half: when a newer build opens the database, this
			// connection steps aside rather than blocking it forever, and every
			// later operation here fails with a name the badge can show.
			db.onversionchange = () => {
				db.close();
				onVersionChange();
			};
			resolve(db);
		};
		request.onerror = () =>
			reject(new Error(`save: the save database would not open`));
	});

const asPromise = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(new Error("save: the backend refused"));
	});

/**
 * A transaction's outcome. Created before any request is issued, so a
 * transaction that completes during an `await` cannot be missed — and awaited
 * on the **transaction**, not on a request: a resolved `put` only means the
 * request was accepted, and a transaction that aborts afterwards leaves the old
 * record in place, which is D9's stale-not-broken and must be reported as a
 * failure rather than as a success.
 */
const transactionDone = (tx: IDBTransaction): Promise<void> =>
	new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onabort = () => reject(new Error("save: the backend aborted the write"));
		tx.onerror = () => reject(new Error("save: the backend refused"));
	});

export function indexedDbSaveBackend(
	factory: IDBFactory = indexedDB,
): SaveBackend {
	let db: Promise<IDBDatabase> | null = null;
	let closed = false;
	const open = () => {
		// A closed handle's `transaction()` throws a bare `InvalidStateError`,
		// which names nothing a player could act on.
		if (closed) return Promise.reject(new Error(SAVE_CLOSED_MESSAGE));
		const opening = (db ??= openSaveDb(factory, () => {
			closed = true;
			db = null;
		}));
		// A refused open is not cached: the next caller asks again.
		opening.catch(() => {
			if (db === opening) db = null;
		});
		return opening;
	};
	return {
		async read(slot, kind) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readonly");
			const value = await asPromise(
				tx.objectStore(SAVE_STORE_NAME).get(recordKey(slot, kind)),
			);
			return value ?? null;
		},
		async write(slot, kind, blob) {
			return this.writeMany(slot, [kind], blob);
		},
		async writeMany(slot, kinds, blob) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readwrite");
			const done = transactionDone(tx);
			const store = tx.objectStore(SAVE_STORE_NAME);
			for (const kind of kinds) store.put(blob, recordKey(slot, kind));
			await done;
		},
		async slots() {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readonly");
			const keys = await asPromise(
				tx.objectStore(SAVE_STORE_NAME).getAllKeys(),
			);
			return [...new Set(keys.map((key) => slotOfKey(key)).filter(Boolean))];
		},
		async deleteSlot(slot) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readwrite");
			const store = tx.objectStore(SAVE_STORE_NAME);
			const keys = await asPromise(store.getAllKeys());
			for (const key of keys) if (slotOfKey(key) === slot) store.delete(key);
			await transactionDone(tx);
		},
		async copySlot(from, to) {
			const handle = await open();
			const tx = handle.transaction(SAVE_STORE_NAME, "readwrite");
			const done = transactionDone(tx);
			const store = tx.objectStore(SAVE_STORE_NAME);
			let found = 0;
			let answered = 0;
			// Gets and puts chained on request callbacks, not on `await`: the
			// transaction commits once no request is pending, and a gap the event
			// loop can run through is where a copy would find it already finished.
			for (const kind of SAVE_RECORD_KINDS) {
				const get = store.get(recordKey(from, kind));
				get.onsuccess = () => {
					if (get.result !== undefined) {
						found += 1;
						store.put(get.result, recordKey(to, kind));
					}
					answered += 1;
					if (answered === SAVE_RECORD_KINDS.length && found === 0) tx.abort();
				};
			}
			try {
				await done;
			} catch (error) {
				if (found === 0) fail(`"${from}" holds no record to copy`);
				throw error;
			}
		},
		async readMeta(key) {
			const handle = await open();
			const tx = handle.transaction(SAVE_POINTER_STORE_NAME, "readonly");
			const value = await asPromise(
				tx.objectStore(SAVE_POINTER_STORE_NAME).get(key),
			);
			return value ?? null;
		},
		async writeMeta(entries) {
			const handle = await open();
			const tx = handle.transaction(SAVE_POINTER_STORE_NAME, "readwrite");
			const done = transactionDone(tx);
			const store = tx.objectStore(SAVE_POINTER_STORE_NAME);
			for (const [key, value] of Object.entries(entries))
				if (value === null || value === undefined) store.delete(key);
				else store.put(value, key);
			await done;
		},
		async takeMeta(key) {
			const handle = await open();
			const tx = handle.transaction(SAVE_POINTER_STORE_NAME, "readwrite");
			const done = transactionDone(tx);
			const store = tx.objectStore(SAVE_POINTER_STORE_NAME);
			let value: unknown = null;
			const get = store.get(key);
			get.onsuccess = () => {
				value = get.result ?? null;
				if (value !== null) store.delete(key);
			};
			await done;
			return value;
		},
	};
}

/**
 * The headless tier's locks: a set of held names in one process, standing in
 * for the tabs of one origin.
 */
export function memorySlotLocks(): SlotLocks {
	const held = new Set<string>();
	return {
		async tryHold(slot) {
			if (held.has(slot)) return null;
			held.add(slot);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				held.delete(slot);
			};
		},
	};
}

/** The prefix a Commander's Web Lock name carries, so no other lock on the
 *  origin can collide with one. */
const SAVE_LOCK_PREFIX = "seelite-commander:";

/**
 * The browser's locks: an exclusive Web Lock per Commander, requested with
 * `ifAvailable` so it never waits (§11.3).
 *
 * **A Web Lock lives only while its callback's promise is pending.** So the
 * callback returns a promise that the release resolves and nothing else does,
 * and `tryHold` resolves with that release as soon as the lock is granted — a
 * lock held for the life of the tab is one whose release is never called.
 *
 * **A request that fails rejects, and only a lock not granted is `null`.** Both
 * answered `null` for a round, so a document that was no longer active, or a
 * `SecurityError`, read as "open in another tab". A caller treats a rejection
 * as a fault.
 *
 * **It assumes a secure context.** `navigator.locks` exists only there, so on
 * plain http off localhost the default argument is `undefined` and `tryHold`
 * rejects. The probes run on localhost and the deploy target is HTTPS, so
 * neither meets it.
 */
export function webSlotLocks(locks: LockManager = navigator.locks): SlotLocks {
	return {
		tryHold(slot) {
			return new Promise((resolve, reject) => {
				locks
					.request(
						`${SAVE_LOCK_PREFIX}${slot}`,
						{ mode: "exclusive", ifAvailable: true },
						(lock) => {
							if (!lock) {
								resolve(null);
								return;
							}
							return new Promise<void>((release) => resolve(() => release()));
						},
					)
					.catch(reject);
			});
		},
	};
}
