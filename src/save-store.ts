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
 * `lastDocked`, the commander at its last station: written by the dock flush
 * and written again by the undock flush, so once a pilot has launched it is
 * the commander **as it launched** (#660 D1, built by node #702) and what was
 * bought at the dock survives a death. A non-permadeath death restores its
 * commander — genuine leg-loss, which is what the classic-Elite framing
 * described. The resolution's original wording ("rolls back to the last write")
 * was written against the dock-only cadence rejected in the same round, where
 * reloading the last write is dying again. The name stays: a launch record
 * still names the station it launched from.
 *
 * `lastDocked` is **not** a last-known-good fallback, and D9's rejection of one
 * stands: a `lastDocked` that will not parse is a named error, never a silent
 * substitution. **An absent one is not an error** (#660 D10): a pilot who has
 * never docked wakes as a new commander at the start system's trade station,
 * derived at the death by `firstCheckpoint` rather than written at new game.
 * Nothing here changes the schema; both records are the envelope they were.
 *
 * ## Transactional commit (#936 D1–D4, node #943)
 *
 * `commit(op)` is the shared durable-transaction write: the candidate is the
 * op applied to the current envelope, a landed commit adopts **only the
 * footprint** the op names (D1), a commit made while docked writes `live` and
 * `lastDocked` from one blob in one transaction (D2), one `txSeq` refuses
 * stale and repeat ops (D4), and a write that does not settle within
 * `SAVE_COMMIT_TIMEOUT_MS` is decided by reading `live` back, never by a blind
 * retry (D4's outcomes). The rules, the named failure cases and the footprint
 * itself are [#936's closing receipt](https://github.com/jcfischer/seelite/issues/936)
 * and are not restated here; the first consumer — refinery submission and
 * collection, with D3's Saving display and input suppression at the Game
 * level — comes with its own brief.
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

import { type FirstDayChoice, isFirstDayChoice } from "./first-day-choice";
import { firstCheckpoint, hasDocked } from "./death-checkpoint";
import {
	type DeathCause,
	type DeathWake,
	deathWake,
	ejectSurvivors,
	parseDeathWake,
} from "./death-cost";
import { holdingsAfterDeath } from "./holdings";
import {
	type CommanderRecord,
	parseSave,
	type SaveEnvelope,
	type SaveRecordBody,
	serializeSave,
} from "./save-envelope";

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

/**
 * How long a commit waits for its write before the outcome is taken from the
 * record instead (#936 D4).
 *
 * An engineering default exported for tuning, not a measured window: the
 * debounce has a browser figure (`SAVE_DEBOUNCE_MS`) because its cost lands on
 * every write, while this one only decides the rare transaction that neither
 * completed nor aborted in time — and that decision is a read, not a guess.
 * A shorter window reads a record back from writes that were merely slow;
 * 10 s is far past the ~400 ms the whole median save takes on the probe.
 */
export const SAVE_COMMIT_TIMEOUT_MS = 10_000;

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

/** `copySlot`'s refusal, shared by both backends so the wording cannot drift. */
const noRecordToCopy = (slot: string): never =>
	fail(`"${slot}" holds no record to copy`);

/**
 * Why a flush is happening. `dock` and `undock` are the two that also write
 * the checkpoint (`CHECKPOINT_FLUSHES`); the rest are D4's unconditional
 * flushes.
 *
 * `quit` means leaving this Commander, whichever way: a tab closing, or a
 * switch the overlay awaits before New game, Load or Import (§11.3). Both write
 * `live` with nothing dirty. `new-game` is the first write a new Commander
 * gets, which is neither.
 */
export type FlushReason = "dock" | "undock" | "jump" | "quit" | "new-game";

/**
 * The flushes that write `lastDocked` beside `live`: the arrival and the
 * launch (#660 D1, built by node #702). The launch's is the one a death
 * restores, so a pilot dies with what they bought at the dock; the arrival's
 * stands until then, which is what a death on the arrival's rails or in the
 * berth gets back.
 */
const CHECKPOINT_FLUSHES: ReadonlySet<FlushReason> = new Set([
	"dock",
	"undock",
]);

/**
 * The flushes that write with nothing dirty. `quit` and `new-game` for their
 * own reasons (`flush`); `undock` because the checkpoint can be stale while
 * `live` is not — a purchase at the dock lands in `live` through the debounce
 * and clears the flag, and a launch gated on the flag would leave `lastDocked`
 * at the arrival, undoing the purchase on a death.
 */
const FLUSHES_WHEN_CLEAN: ReadonlySet<FlushReason> = new Set([
	"quit",
	"new-game",
	"undock",
]);

/** What a record kind is held as a fault (§11.5): the flush that failed, the
 *  transaction commit that did not land, or the debounced write that reached
 *  `SAVE_RETRY_LIMIT`. Kept per kind, because the overlay has to name the
 *  failure that is still held — a later write that failed and then landed is
 *  not it.
 */
export type SaveFault =
	| { readonly reason: FlushReason; readonly error: unknown }
	| { readonly reason: "commit"; readonly error: unknown }
	| {
			readonly reason: "debounce";
			readonly error: unknown;
			readonly consecutive: number;
	  };

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

/** The pointer store's keys (§11.3, §11.4), and the wake a death leaves for
 *  the next boot (#660, node #704: `DeathWake`). */
export type SaveMetaKey = "active" | "oneShot" | "pending" | "wake";

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
	/** #408 D4. Absent on a record an older build wrote, which reads as free. */
	firstDay: FirstDayChoice;
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

/**
 * One transaction op for `SaveStore.commit` (#936 D1, D4).
 *
 * The store does not know what a gameplay op means — only the op does. What
 * the store owns is the *when*: the staleness gate at the head of the op's
 * turn, the one `txSeq` step, the single transaction, and the adoption that
 * must land before the in-flight write clears.
 */
export interface SaveCommitOp {
	/**
	 * The `txSeq` the action recorded when it was quoted or shown (#936 D4).
	 * A commit whose recorded value is not the current one resolves `stale`
	 * and writes nothing — which is also what refuses a second submission or
	 * collection of the same thing.
	 */
	readonly txSeq: number;
	/**
	 * True when the commit is also the dock checkpoint: `live` and
	 * `lastDocked` are written together from one blob, in one transaction
	 * (D2). The consumer names it — while docked, it reads this off the
	 * commander's own `dockedAt`, the same way the dock and undock flushes
	 * pick their kinds.
	 */
	readonly checkpoint?: boolean;
	/**
	 * The candidate: the envelope it is handed, with the op applied (D1).
	 *
	 * **A pure function of its argument, and the store calls it more than once.**
	 * The candidate is one call; the others are the checkpoint snapshots `flush`
	 * took before this commit adopted, which re-apply the landed footprint
	 * before they are written (D1: a queued write never serializes state from
	 * before adoption). So `apply` may read only the envelope it is given — a
	 * closure over live state, or a number computed outside it, would stamp the
	 * transaction's value into a moment it was never quoted at. It leaves
	 * `txSeq` alone: the store steps that.
	 */
	readonly apply: (envelope: SaveEnvelope) => SaveEnvelope;
	/**
	 * Adopt **only the footprint fields** into live state — the credits, cargo
	 * and carrier rows the op touched, plus the record's `txSeq` — and nothing
	 * else (D1). The store calls this synchronously before its in-flight write
	 * clears, so a debounced write queued behind the commit never serializes
	 * pre-adoption state; the game clock and every other part of the world are
	 * kept from live state, never taken from the record.
	 */
	readonly adopt: (committed: SaveEnvelope) => void;
}

/**
 * One commit's outcome (#936 D4).
 *
 * `committed` — the write landed (directly or on the read-back) and the
 * footprint was adopted. `failed` — a definite abort/error, nothing adopted,
 * a retry is allowed. `stale` — the op's recorded txSeq is not the current
 * one, nothing was written. `uncertain` — the write did not settle and the
 * read that should have decided it failed too; `commit` refuses until a read
 * succeeds.
 */
export type SaveCommitOutcome = "committed" | "failed" | "stale" | "uncertain";

/**
 * One `commit` the store still owes an answer to: its own acknowledgement, a
 * record read back, and a checkpoint queued behind it all need the same thing —
 * the op, the number it stamped, and which kinds it wrote.
 */
type CommitTransaction = {
	readonly op: SaveCommitOp;
	/** The sequence this transaction stamps onto its candidate (D4). */
	readonly candidateTxSeq: number;
	readonly stamped: SaveEnvelope;
	readonly kinds: readonly SaveRecordKind[];
};

/** A checkpoint a flush took at its transition and holds while its write
 *  queues (`flush`, `checkpointBlob`). */
type CheckpointSnapshot = {
	readonly blob: SaveRecordBody;
	readonly edits: number;
	/** How many footprints had been adopted when the snapshot was taken — the
	 *  ones after this number are the transactions it must be caught up with. */
	readonly adoptions: number;
};

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
		fail(`"" is not a Commander name — a name may not be empty`);
	if (slot.includes(KEY_SEPARATOR))
		fail(
			`"${slot}" is not a Commander name — a name may not contain a NUL character`,
		);
};

/**
 * A pending new game as read back, or `null` for none.
 *
 * Shape-checked rather than cast: the pointer store is outside the envelope's
 * hash, so nothing else stands between a stray value and a boot that builds a
 * world from it. A value that is not one is a named refusal, which the boot's
 * D9 path turns into a fault rather than a world built from garbage.
 *
 * `refusal` names what was being read: the same check guards the record on
 * disk and the choice New game is about to write, and the overlay shows the
 * message.
 */
const parsePending = (
	raw: unknown,
	refusal = "the pending new game on disk is not one this build can read",
): PendingNewGame | null => {
	if (raw === null || raw === undefined) return null;
	const o = raw as Record<string, unknown>;
	if (
		typeof raw !== "object" ||
		typeof o.name !== "string" ||
		typeof o.seed !== "number" ||
		!Number.isInteger(o.seed) ||
		o.seed < 0 ||
		o.seed > 0xffff_ffff ||
		typeof o.permadeath !== "boolean" ||
		(o.firstDay !== undefined && !isFirstDayChoice(o.firstDay))
	)
		fail(refusal);
	assertSlot(o.name as string);
	return {
		name: o.name as string,
		seed: o.seed as number,
		permadeath: o.permadeath as boolean,
		// A pending record lives only between New game and its reload, so an
		// absent key is a record written by the build before #408, mid-reload.
		firstDay: (o.firstDay as FirstDayChoice | undefined) ?? "free",
	};
};

export class SaveStore {
	private readonly backend: SaveBackend;
	private readonly locks: SlotLocks;
	/** The release of this store's own lock, once `hold` has taken it. */
	private held: (() => void) | null = null;
	/** The lock request in flight, shared by overlapping `hold` calls. */
	private holding: Promise<(() => void) | null> | null = null;
	/**
	 * The record kinds held as a fault (§11.5). **Raised** by any flush that
	 * fails, at once, and by a debounced write only once it has failed
	 * `SAVE_RETRY_LIMIT` times in a row: a retry that lands a moment later was
	 * never the player's business. A kind clears only on a write **of that kind**
	 * that lands: a debounced write carries `live` alone, so a failed dock flush
	 * keeps `lastDocked` held through any number of good debounced writes — the
	 * checkpoint a non-permadeath death restores is still the older one, and the
	 * badge must still say so.
	 *
	 * **Per kind, not per Commander, and that is enough.** A store writes one
	 * Commander for the life of its tab: it holds that Commander's lock, which
	 * refuses a rename or a delete of it, and the game flushes with no slot
	 * argument. `flush`'s `slot` parameter is the tests' and the probe's seam. A
	 * caller that aimed one store at two Commanders would mix their faults here.
	 */
	private readonly faultsHeld = new Map<SaveRecordKind, SaveFault>();
	private readonly schedule: Scheduler;
	private readonly current: () => SaveEnvelope;
	private dirty = false;
	/** Counts `markDirty` calls, so a checkpoint taken before its write can
	 *  tell whether saved state moved while it waited (`run`). */
	private edits = 0;
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
	/**
	 * Set by `revertToLastDocked`. A retired store writes nothing more: the page
	 * is about to reload into the dock it restored, and `current` still holds
	 * the ship that died.
	 */
	private retired = false;

	/**
	 * A commit whose outcome is unknown (#936 D4): the write did not settle
	 * and the read-back that should have decided it failed too. While this is
	 * set, `commit` refuses — a blind retry could write twice what already
	 * landed — and it clears on whichever answer arrives first: a late
	 * landing (adopt), a late definite failure (retry), or a successful read
	 * (`resolveUncertainCommit`).
	 */
	private uncertainCommit: CommitTransaction | null = null;

	/**
	 * The footprints a commit adopted while a checkpoint snapshot was queued
	 * behind it, oldest first, each named by how many adoptions went before it
	 * (#936 D1). `checkpointBlob` re-applies the ones a snapshot has not seen;
	 * they are dropped once no snapshot is outstanding, because any later
	 * snapshot already contains them.
	 */
	private readonly adoptedFootprints: {
		readonly seq: number;
		readonly apply: (envelope: SaveEnvelope) => SaveEnvelope;
	}[] = [];
	/** Footprints adopted so far — the sequence the next one takes. */
	private adoptions = 0;
	/** Checkpoint snapshots taken whose write has not finished. While one is
	 *  outstanding the footprints behind it have to be retained. */
	private outstandingCheckpoints = 0;

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
		if (this.retired) return;
		this.dirty = true;
		this.edits += 1;
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
				if (this.failures >= SAVE_RETRY_LIMIT)
					this.faultsHeld.set("live", {
						reason: "debounce",
						error,
						consecutive: this.failures,
					});
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
	 * D4's unconditional write. `dock` and `undock` additionally lay down the
	 * checkpoint (`CHECKPOINT_FLUSHES`).
	 *
	 * A flush with nothing dirty writes nothing: the record on disk already
	 * says what the world says, and rewriting it would spend a transaction to
	 * change no bytes. **`undock` is not covered by that premise**: `live` may
	 * say what the world says while `lastDocked` is still the arrival, so it
	 * writes clean too (`FLUSHES_WHEN_CLEAN`).
	 *
	 * **`quit` is the exception, and it has to be.** The other flushes
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
		if (this.retired) return;
		if (!this.dirty && !FLUSHES_WHEN_CLEAN.has(reason)) return;
		const checkpoint = CHECKPOINT_FLUSHES.has(reason);
		const kinds: SaveRecordKind[] = checkpoint
			? ["live", "lastDocked"]
			: ["live"];
		// **A checkpoint is taken at the transition, not when its write starts.**
		// `run` queues behind any write in flight, and the launch does not wait
		// for this flush: read `current()` after the queue and a slow earlier
		// write hands `lastDocked` the ship already clear of the station, with
		// whatever happened since — and a death restores flight, not the launch.
		// **A transaction that lands while it waits is the one thing the snapshot
		// may not stay without** (`checkpointBlob`): a queued write reversing an
		// accepted commit is D1's named hazard, and `lastDocked` is what a death
		// restores (#936 case 9).
		try {
			const snapshot: CheckpointSnapshot | undefined = checkpoint
				? {
						blob: serializeSave(this.current()),
						edits: this.edits,
						adoptions: this.adoptions,
					}
				: undefined;
			// Registered after the bytes exist and released by `run`'s `finally`:
			// the footprints adopted from here until then are what that snapshot
			// owes, and nothing else needs them kept.
			if (snapshot) this.outstandingCheckpoints += 1;
			await this.run(kinds, slot, snapshot); // glossary-ignore: slot
		} catch (error) {
			// A flush is a transition the player made — a dock, an undock, a jump,
			// a switch — so one failure is a fault, with no retry to wait for.
			const fault: SaveFault = { reason, error };
			for (const kind of kinds) this.faultsHeld.set(kind, fault);
			throw error;
		}
	}

	/**
	 * #936's shared transactional write: commit the op's candidate, and give
	 * exactly one outcome — committed, failed, stale or uncertain (D4).
	 *
	 * **The staleness gate is checked at the head of the op's turn, not at
	 * the call.** A retry queued behind an unsettled write is only answered
	 * `stale` if that write lands in the meantime, and the live `txSeq` is the
	 * witness — which it cannot be until the queue hands the turn over
	 * (failure case 4's retry row).
	 *
	 * **The store owns the +1.** No op can skip or double-advance the
	 * sequence: the record written and the live state adopted afterwards name
	 * one number (D4, and the criterion that the written record's txSeq is
	 * *the same* one live ends up holding).
	 *
	 * A retired store — the death restore has written its pair and the page is
	 * reloading — refuses, because writing after that would put the dead ship
	 * back on disk.
	 */
	async commit(op: SaveCommitOp): Promise<SaveCommitOutcome> {
		if (this.retired)
			fail(
				"this store is retired after the death restore — it does not commit",
			);
		if (this.uncertainCommit)
			fail("a commit is uncertain — nothing is written until a read succeeds");
		if (!Number.isSafeInteger(op.txSeq) || op.txSeq < 0)
			fail(
				`txSeq ${String(op.txSeq)} is not a non-negative whole transaction number`,
			);
		// Queue behind whatever is already writing, exactly as `run` does: two
		// overlapping transactions can land in either order, and the loser
		// would be the newer state. The rejection of the write awaited here is
		// swallowed for the same reason `run` swallows it — that failure is
		// its own caller's, and this op still has its own to report.
		while (this.inFlight) await this.inFlight.catch(() => {});
		const live = this.current();
		const base = live.commander.txSeq;
		if (op.txSeq !== base) return "stale";
		const applied = op.apply(live);
		const stamped: SaveEnvelope = {
			world: applied.world,
			commander: { ...applied.commander, txSeq: base + 1 },
		};
		const blob = serializeSave(stamped);
		const kinds: SaveRecordKind[] = op.checkpoint
			? ["live", "lastDocked"]
			: ["live"];
		let decided: SaveCommitOutcome | null = null;
		const tx: CommitTransaction = {
			op,
			candidateTxSeq: base + 1,
			stamped,
			kinds,
		};
		const work = this.backend.writeMany(this.slot, kinds, blob);
		// **Adoption runs inside the in-flight chain, before `inFlight`
		// clears.** A debounced write waiting on that chain resumes only after
		// the adopt, so it serializes the state that includes the commit —
		// #936's named hazard (case 6), closed by ordering rather than by a
		// new write path. A late landing is the strongest evidence there is:
		// it adopts even when the commit itself already resolved `failed` or
		// `uncertain` through the timeout path (case 4's retry row), and lifts
		// the uncertain refusal with it.
		const chain = work.then(
			() => {
				// `adoptCommitted`'s own guard decides whether this acknowledgement
				// or a read-back of the same bytes makes the adoption — in either
				// order, not only when the read finished first.
				this.adoptCommitted(tx, stamped);
				this.uncertainCommit = null;
				decided ??= "committed";
			},
			(error) => {
				// The record it refused to replace is still there (D9's
				// stale-not-broken), and the save is still dirty. A failure
				// named after an uncertain read-back is an answer too: the
				// retry is offered and the refusal lifts.
				if (decided !== "committed") {
					const fault: SaveFault = { reason: "commit", error };
					for (const kind of kinds) this.faultsHeld.set(kind, fault);
					this.dirty = true;
					decided ??= "failed";
				}
				this.uncertainCommit = null;
			},
		);
		this.inFlight = chain.finally(() => {
			this.inFlight = null;
		});
		let fireTimeout: () => void = () => {};
		const timedOut = new Promise<"timeout">((resolve) => {
			fireTimeout = () => resolve("timeout");
		});
		const cancelTimeout = this.schedule(
			() => fireTimeout(),
			SAVE_COMMIT_TIMEOUT_MS,
		);
		const raced = await Promise.race([
			work.then(
				() => ({ s: "landed" }) as const,
				(error: unknown) => ({ s: "rejected", error }) as const,
			),
			timedOut,
		]);
		if (raced !== "timeout") {
			cancelTimeout();
			// The chain arms above ran first — they were registered first — so
			// the adoption (or the held fault) has already happened by here.
			return raced.s === "landed" ? "committed" : "failed";
		}
		// No settle within the window: read `live` back and let the record
		// answer (D4). A blind retry of a write that committed before its
		// acknowledgement would write twice what already landed (case 4).
		const outcome = await this.readBackCommit(tx);
		decided = outcome;
		return outcome;
	}

	/**
	 * Adopt a landed commit's footprint into live state (#936 D1) — unless live
	 * has already moved past it.
	 *
	 * **The guard is what makes the order of the answers not matter.** Both this
	 * transaction's own acknowledgement and a read-back of it can make the
	 * adoption, and a read-back can answer last: the record it returns is the one
	 * its read transaction saw, not what the backend holds when the answer lands.
	 * If a later commit has been adopted in the meantime, re-applying the older
	 * footprint and the older `txSeq` would leave live behind durable and free
	 * the newer sequence to be written a second time. `txSeq` advances by exactly
	 * one per adoption (D4), so live at or past the candidate names an adoption
	 * that already covers this one — every later op was derived from state that
	 * contained it.
	 *
	 * **A footprint is recorded as well as adopted**, for the checkpoint queue:
	 * a queued `flush` re-serializes nothing by itself, so it needs the op to
	 * re-apply its own footprint (`checkpointBlob`).
	 */
	private adoptCommitted(tx: CommitTransaction, from: SaveEnvelope): void {
		if (this.current().commander.txSeq >= tx.candidateTxSeq) return;
		tx.op.adopt(from);
		this.adoptedFootprints.push({ seq: this.adoptions, apply: tx.op.apply });
		this.adoptions += 1;
		// Saved state moved on top of any checkpoint snapshot a flush queued
		// behind this commit (`run`'s `edits`), and any debounced write behind it
		// serializes the adopted state anyway.
		this.edits += 1;
		this.failures = 0;
		for (const kind of tx.kinds) this.faultsHeld.delete(kind);
		this.uncertainCommit = null;
	}

	/**
	 * The bytes a queued checkpoint writes: the snapshot its transition took,
	 * with every footprint adopted while it waited re-applied to it.
	 *
	 * Why the snapshot is taken at the transition at all is `flush`'s rule — a
	 * launch queued behind a slow write must not hand `lastDocked` the flight
	 * that followed it. Why it may not be written as it stands is D1's: a
	 * transaction the pilot was told about cannot be reversed by a write that was
	 * merely queued first, and `lastDocked` is the record a death restores (#936
	 * case 9). So the checkpoint keeps its own world — a live mutation, a markDirty
	 * or a debounced purchase behind it still reads as the launch to a death — and
	 * takes only the transactions it missed, each op's `apply` again over the
	 * parsed snapshot in the order they landed.
	 *
	 * **The round trip through `parseSave` is not a courtesy.** The snapshot is
	 * bytes rather than `current()`'s object because a live envelope handed to a
	 * queued write is the read-it-later the flush exists to refuse, and
	 * re-validating the caught-up pair before writing it is §9.9's no-graft rule
	 * reaching a pair this method assembled. An op whose `apply` cannot be re-run
	 * over the snapshot therefore fails as a failed flush does — with the fault
	 * held — rather than writing the reversal quietly.
	 *
	 * Each commit steps `txSeq` by exactly one (D4) and adoptions are counted in
	 * that same order, so the snapshot's own sequence counts the steps out: the
	 * record cannot claim a transaction no op made.
	 */
	private checkpointBlob(snapshot: CheckpointSnapshot): SaveRecordBody {
		const missed = this.adoptedFootprints.filter(
			(footprint) => footprint.seq >= snapshot.adoptions,
		);
		if (missed.length === 0) return snapshot.blob;
		let envelope = parseSave(snapshot.blob);
		let seq = envelope.commander.txSeq;
		for (const { apply } of missed) {
			envelope = apply(envelope);
			seq += 1;
			envelope = {
				...envelope,
				commander: { ...envelope.commander, txSeq: seq },
			};
		}
		return serializeSave(envelope);
	}

	/**
	 * Decide an unsettled commit by reading `live` back (#936 D4). The record
	 * is the only witness that survives the page: a txSeq that advanced means
	 * the write landed, and the footprint is taken **from the record read**
	 * — that state, not the candidate, is what the store durably has — unless
	 * live has moved past it meanwhile (`adoptCommitted`). The previous value
	 * means it did not land, and a retry is allowed. A read that fails — or
	 * answers with a number neither — leaves the outcome uncertain, and nothing
	 * writes until a read succeeds.
	 */
	private async readBackCommit(
		tx: CommitTransaction,
	): Promise<SaveCommitOutcome> {
		let raw: unknown;
		try {
			raw = await this.backend.read(this.slot, "live");
		} catch {
			this.uncertainCommit = tx;
			return "uncertain";
		}
		// **No record at all is definite, not unknown**: a transaction that
		// landed leaves a record behind, so there is nothing for the pending
		// write to have advanced. (In production a `live` record always exists
		// before the first commit — the new-game flush writes one — this is
		// the seam's cold case.) Definite means the refusal lifts too.
		if (raw === null || raw === undefined) {
			this.uncertainCommit = null;
			return "failed";
		}
		let record: SaveEnvelope;
		try {
			record = parseSave(raw);
		} catch {
			// A record that will not parse is D9's named error, not an answer:
			// it can neither be adopted nor compared, so the outcome stays
			// uncertain rather than pretending to decide.
			this.uncertainCommit = tx;
			return "uncertain";
		}
		if (record.commander.txSeq === tx.candidateTxSeq) {
			this.uncertainCommit = null;
			this.adoptCommitted(tx, record);
			return "committed";
		}
		if (record.commander.txSeq === tx.candidateTxSeq - 1) {
			// The record answered: the write did not land. That is an outcome,
			// and the refusal lifts with it — the retry queues behind the
			// unsettled write and meets `stale` there if it lands after all.
			this.uncertainCommit = null;
			return "failed";
		}
		this.uncertainCommit = tx;
		return "uncertain";
	}

	/** Whether a commit's outcome is unknown and `commit` is refusing (§11.5's
	 *  rule that the player is told): true from the failed read-back until the
	 *  write settles or a read succeeds. D3's suppression of departure reads
	 *  this when the first consumer arrives. */
	get hasUncertainCommit(): boolean {
		return this.uncertainCommit !== null;
	}

	/**
	 * Attempt the read again for an uncertain commit (#936 D4: the game
	 * "blocks retry and departure until a read succeeds"). Returns the
	 * outcome when this read decides it — `committed` (adopting from the
	 * record read) or `failed` (a retry is allowed) — and `uncertain` when it
	 * still cannot answer, which leaves the refusal standing. Refuses when
	 * nothing is uncertain: this is not a general record-read seam, `load`
	 * already is one.
	 */
	async resolveUncertainCommit(): Promise<SaveCommitOutcome> {
		const pending = this.uncertainCommit;
		if (pending) return this.readBackCommit(pending);
		return fail(
			"there is no uncertain commit to resolve — read records with load",
		);
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

	private async run(
		kinds: SaveRecordKind[],
		slot: string, // glossary-ignore: slot
		snapshot?: CheckpointSnapshot,
	): Promise<void> {
		// Queue behind whatever is already writing rather than racing it. The
		// awaited chain is what keeps `maxInFlight` at one.
		//
		// **The rejection is swallowed, not inherited.** A bare `await` here
		// rethrows whatever the in-flight write failed with, so a `flush("dock")`
		// queued behind a failing debounced write threw before writing anything
		// — no `lastDocked` checkpoint, and `settled()` rejecting too. The
		// earlier write's failure is its own caller's; this one still has its
		// own to report.
		//
		// A `snapshot` is a checkpoint `flush` took before queueing. It goes
		// under every kind in one transaction as before, so `live` may land a
		// little behind the world; when saved state moved while it waited
		// (`edits`), the save stays dirty and the debounce is re-armed once the
		// write lands, so `live` catches up on the cadence that writes it anyway.
		// A commit that adopted in that window is caught up into the bytes instead
		// of left behind them, because nothing re-serializes `live` for
		// `lastDocked` (`checkpointBlob`).
		try {
			while (this.inFlight) await this.inFlight.catch(() => {});
			const blob = snapshot
				? this.checkpointBlob(snapshot)
				: serializeSave(this.current());
			const behind = snapshot !== undefined && snapshot.edits !== this.edits;
			this.dirty = behind;
			const work = this.backend.writeMany(slot, kinds, blob);
			this.inFlight = work.finally(() => {
				this.inFlight = null;
			});
			try {
				await this.inFlight;
				this.failures = 0;
				for (const kind of kinds) this.faultsHeld.delete(kind);
				if (behind) this.markDirty();
			} catch (error) {
				// The write did not land, so the save is still dirty. D9: the
				// previous record is untouched — stale rather than broken. Whether
				// that is a fault yet is the caller's to say (`faultsHeld`).
				this.dirty = true;
				throw error;
			}
		} finally {
			if (snapshot) {
				this.outstandingCheckpoints -= 1;
				// With no snapshot outstanding, no adopted footprint is still owed
				// to anything: one taken from here on already contains it.
				if (this.outstandingCheckpoints === 0)
					this.adoptedFootprints.length = 0;
			}
		}
	}

	/** The record kinds held as a fault, each with the failure that raised it.
	 *  §11.5's badge shows while this is not empty (`heldSaveFault`). */
	get heldFaults(): ReadonlyMap<SaveRecordKind, SaveFault> {
		return this.faultsHeld;
	}

	/** The held kinds alone, for the tests and the probe. */
	get faultKinds(): ReadonlySet<SaveRecordKind> {
		return new Set(this.faultsHeld.keys());
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
			fail(`Commander "${slot}" has no ${kind} record`);
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

	/**
	 * #324's death path (principal's ruling O5, 2026-09-14), narrowed by #654
	 * (the principal's Q2 ruling on #238, 2026-10-03): **a death keeps the
	 * world.** `live` becomes the world as it stands at the death beside the
	 * last dock's commander, so the reload boots the pilot back at the dock
	 * into a galaxy that remembers the fatal leg — its kills, strikes, scans,
	 * trades, visits and heat. Then the store stops writing.
	 *
	 * **The world is `current`'s, not the last write's**: a change made inside
	 * the debounce window is the world's too. **And the play log is the dying
	 * commander's** (#581, closed into #654). `commanderAfterDeath` in
	 * `holdings.ts` owns which fields a death restores; this store only pairs
	 * that record with the world, serializes and writes.
	 *
	 * The envelope is serialized fresh, so its integrity hash covers the pair
	 * it actually is, and it is parsed before it is written: a mixed pair the
	 * parser would refuse is a named error here, with `live` untouched, rather
	 * than a save that fails on the reload.
	 *
	 * **A death-time write, on purpose.** #89 left death unflushed, and
	 * `restoreAfterDeath` above still reads only. This is the separate act the
	 * ruling asked for, and it is the one write a death makes. A permadeath
	 * commander gets `null` and nothing is written, so that stance is unchanged.
	 *
	 * Order matters, and the first order was wrong (sage round 1's blocker).
	 * The store first quiets itself — it cancels a debounce and waits out a
	 * write in flight, either of which could land after the copy and put the
	 * dead ship back. It then reads and validates the dock record, because D9
	 * makes a bad `lastDocked` a named error rather than something to
	 * substitute. **Only a record that validates retires the store**: a store
	 * that had already retired would have dropped every later write while
	 * still holding the tab's lock. On a refusal this throws with the store
	 * still writing and the lock still held. After the copy it gives the lock
	 * back, so the one-shot continue and the reload's boot can take the
	 * Commander.
	 *
	 * **A Commander who died before their first dock** has no `lastDocked`, and
	 * since #660 D10 that is not a refusal: `firstCheckpoint` derives a new
	 * commander docked at the start system's trade station, and it goes
	 * through `holdingsAfterDeath` and the same parse beside the dying world
	 * as a written record. The one absence that still refuses is a pilot who
	 * did dock — a held `lastDocked` fault, or a record that `hasDocked` says
	 * docked, which is the witness a reload keeps.
	 *
	 * **`cause` is what the death costs** (#660, node #704): an `eject` keeps
	 * the launch ship and loses the hold and the pod, a `destroyed` loses the
	 * ship for a stock courier (`holdingsAfterDeath`). Required, for
	 * `FlightPerformance`'s reason: a caller that forgot it would silently
	 * hand a pilot the cheaper death. The store also leaves the wake — what
	 * was lost — in the pointer store for the next boot (`takeWake`).
	 */
	async revertToLastDocked(
		commander: {
			permadeath: boolean;
		},
		cause: DeathCause,
		frameId?: string,
	): Promise<SaveEnvelope | null> {
		if (commander.permadeath) return null;
		const wasDirty = this.dirty;
		this.quiet();
		this.dirty = false;
		await this.settled();
		let raw: unknown;
		let restored: SaveEnvelope;
		let wake: DeathWake;
		try {
			const docked = await this.backend.read(this.slot, "lastDocked");
			const dying = this.current();
			const dock = this.checkpointFor(docked, dying);
			raw = serializeSave(holdingsAfterDeath(dock, dying, cause, frameId));
			restored = parseSave(raw);
			// `checkpointFor` derived a first checkpoint exactly when there was
			// no record to read, and then the loss is the dying commander's.
			const firstLife = docked === null || docked === undefined;
			wake = deathWake(
				this.slot, // glossary-ignore: slot
				firstLife ? dying.commander : dock,
				cause,
				firstLife,
				// What the pod brought back is read off the dying hold, as the
				// restore did (#977).
				cause === "eject" ? ejectSurvivors(dying.commander.state) : undefined,
			);
		} catch (error) {
			// Not retired, and the save the death interrupted is still owed: quieting
			// cleared the flag and the debounce, and without this a change made
			// just before the death would never be written (sage round 2).
			if (wasDirty) this.markDirty();
			throw error;
		}
		// Validated. From here this store writes nothing more — and a debounce
		// armed during the awaits above is cancelled with it.
		this.retired = true;
		this.quiet();
		await this.backend.write(this.slot, "live", raw);
		// What the death took, for the notice the next boot shows (node #704).
		// After `live`, and a courtesy rather than a part of the restore: a
		// write that fails here costs the pilot the notice, never the save, so
		// it is logged and not thrown.
		try {
			await this.backend.writeMeta({ wake });
		} catch (error) {
			console.warn("save: the wake notice was not written", error);
		}
		this.release();
		return restored;
	}

	/**
	 * The commander record a death restores from: the `lastDocked` record when
	 * there is one, and `firstCheckpoint` for a pilot who has never docked.
	 *
	 * A record that will not parse is refused with the record named, which is
	 * D9's named error rather than whatever the parser happened to say. An
	 * absent one beside a pilot who did dock is refused too: the write that
	 * would have made it failed, in this tab or before a reload, and waking
	 * them as a new commander would be the silent substitution D9 rules out.
	 * The record is the witness that survives the reload (`hasDocked`); the
	 * held fault is this tab's own.
	 */
	private checkpointFor(docked: unknown, dying: SaveEnvelope): CommanderRecord {
		if (docked !== null && docked !== undefined) {
			try {
				return parseSave(docked).commander;
			} catch (error) {
				const why = error instanceof Error ? error.message : String(error);
				return fail(
					`Commander "${this.slot}" has a lastDocked record that will not parse: ${why}`,
				);
			}
		}
		if (this.faultsHeld.has("lastDocked") || hasDocked(dying.commander))
			fail(`Commander "${this.slot}" has docked but has no lastDocked record`);
		return firstCheckpoint(dying.world.seed, dying.commander);
	}

	/** Cancels a pending debounced write. */
	private quiet(): void {
		this.cancel?.();
		this.cancel = null;
	}

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

	/**
	 * Gives the lock back. For a store that was never wired: an attach that
	 * found the record changed since the boot read it holds the lock only long
	 * enough to read it again.
	 */
	release(): void {
		this.held?.();
		this.held = null;
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

	/** Boot and import parse through one seam; #437 left it with no policy of
	 *  its own beyond `parseSave`. */
	parseRecord(raw: unknown): SaveEnvelope {
		return parseSave(raw);
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
		if (live !== null) this.parseRecord(live);
		if (lastDocked !== null) this.parseRecord(lastDocked);
		if (live !== null) await this.backend.write(slot, "live", live);
		if (lastDocked !== null)
			await this.backend.write(slot, "lastDocked", lastDocked);
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
			fail(`Commander "${slot}" has no record to export`);
		// **The file names no slot.** A slot is where the player filed the save,
		// not a property of it — and a file that carried one would either be
		// refused on import into a different slot or quietly disagree with
		// where it landed, so a re-export could not be byte-identical.
		return JSON.stringify({ live, lastDocked }, null, "\t");
	}

	/**
	 * The Commander a boot is for (§11.2 step 1, §11.4).
	 *
	 * A pending new game wins before the pointer: its slot is empty by design.
	 * Otherwise the pointer; a pointer naming a Commander that is gone falls
	 * back to the default and says so. No pointer at all is the default, which
	 * is where every save before §11 lives — not a fallback.
	 *
	 * **It writes in one case**: it clears a pending record whose Commander
	 * already has a `live` record.
	 */
	async resolveActive(): Promise<ActiveCommander> {
		const pending = await this.readPending();
		if (pending) {
			// **A pending record beside a `live` record lost only its clean-up**:
			// the tab closed between the first save and `finishNewGame`. The save
			// wins, so a boot never builds a fresh world over that progress, and
			// the boot finishes the clean-up: left on disk, the record would win
			// over the pointer again once a rename or delete empties the name.
			const landed = (await this.backend.read(pending.name, "live")) !== null;
			if (landed) await this.backend.writeMeta({ pending: null });
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
	 * The wake a death left (`revertToLastDocked`), consumed: what the death
	 * took, or `null` — none, or one this build cannot read. One transaction
	 * reads and deletes it, so it is shown by one boot at most, and every boot
	 * that reads storage takes it, so a wake never outlives the boot after
	 * its death. Which Commander it is for is the caller's to check (`saveSlot`).
	 */
	async takeWake(): Promise<DeathWake | null> {
		return parseDeathWake(await this.backend.takeMeta("wake"));
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
		const pending = parsePending(
			choice,
			"the New game choice is not one this build can write",
		) as PendingNewGame;
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
	 * Commanders, never zero. The pointer follows the Commander it named, and a
	 * pending record naming the old name is cleared.
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
			await this.clearPendingFor(from);
		});
	}

	/** Deletes a Commander. The overlay asks for confirmation first; the store
	 *  refuses one a tab has a store attached to. */
	async deleteSlot(slot: string): Promise<void> {
		assertSlot(slot);
		await this.withFreeLock(slot, async () => {
			await this.backend.deleteSlot(slot);
			await this.clearPendingFor(slot);
			// **The pointer goes too.** The player chose this delete, so the next
			// boot is the default with nothing to report. A pointer left naming the
			// gone Commander would say that something fell back.
			if ((await this.backend.readMeta("active")) === slot)
				await this.backend.writeMeta({ active: null });
		});
	}

	/**
	 * Clears a pending record that names `slot`. Rename and delete end that
	 * name, and a record left behind would win over the pointer at the next
	 * boot. Read raw, not parsed, so an unreadable record never blocks a delete.
	 */
	private async clearPendingFor(slot: string): Promise<void> {
		const raw = await this.backend.readMeta("pending");
		if ((raw as { name?: unknown } | null)?.name === slot)
			await this.backend.writeMeta({ pending: null });
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
	/**
	 * Gate the next write only, letting later ones through once `release`
	 * opens it — the transaction of a commit that neither completes nor
	 * aborts, while the cadence around it keeps moving.
	 */
	hangNextWrite(): void;
	/**
	 * Store the next write's rows immediately and gate only its
	 * acknowledgement until `release`: the record landed and the page never
	 * heard, which is the case the read-back exists to decide (#936 case 2).
	 */
	hangNextWriteApplied(): void;
	/** Fail the next `read`, so a commit read-back meets a backend that will
	 *  not answer and the outcome must stay uncertain. */
	failNextRead(): void;
	/**
	 * Take the next read's bytes when it starts and hold only its
	 * acknowledgement until `releaseRead` — on its own gate, so a write can
	 * settle while it is out. That is what a real read transaction is: the
	 * record it returns is the one its transaction read, whenever the answer
	 * lands, and a commit read-back can therefore come back naming an older
	 * moment than the live state it would be adopted into (#936 D4).
	 */
	hangNextRead(): void;
	releaseRead(): void;
	release(): void;
	failNextWrite(): void;
	/** Fail the next `deleteSlot`, so a rename can be interrupted between its
	 *  copy and its delete — a state a happy path never reaches. */
	failNextDelete(): void;
	corruptVersion(slot: string, kind: SaveRecordKind): Promise<void>;
	truncate(slot: string, kind: SaveRecordKind): Promise<void>;
	/** Every `writeMany` issued, in order: the kinds and bytes of each
	 *  transaction, so a test can name one call rather than infer it from the
	 *  rows it left behind. */
	readonly writeManyCalls: readonly {
		readonly slot: string;
		readonly kinds: readonly SaveRecordKind[];
		readonly blob: unknown;
	}[];
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
	let holdAll = false;
	let hangNext = 0;
	let hangAppliedNext = 0;
	let failNext = false;
	let failRead = false;
	// Its own gate, separate from the write gate: a read whose acknowledgement
	// is held has to stay out while a later write lands and commits.
	let readGate: Promise<void> | null = null;
	let openReadGate: (() => void) | null = null;
	let hangReadNext = 0;
	const calls: {
		slot: string;
		kinds: readonly SaveRecordKind[];
		blob: unknown;
	}[] = [];
	const ensureGate = () => {
		if (!gate)
			gate = new Promise<void>((resolve) => {
				openGate = resolve;
			});
	};
	/** A stored blob that exists: a serialized envelope, a parsed record, or a
	 *  pointer-store row — whatever a key holds, with the absent cases already
	 *  folded out by `copy` itself. The shape belongs to the caller; this names
	 *  only "a value", which is what the null-and-undefined refusal is not. */
	type StoredBlob =
		| Record<string, unknown>
		| readonly unknown[]
		| string
		| number
		| boolean;
	const copy = (value: unknown): StoredBlob | null => {
		if (value === null || value === undefined) return null;
		// Deep copy through JSON, as this helper has always done: what reaches
		// it is a `serializeSave` blob, a parsed record, or a pointer-store row,
		// and JSON-safe in means JSON-safe out. The named refusal is for a blob
		// that is not one — a caller bug that used to arrive from the seam as a
		// bare SyntaxError.
		try {
			return JSON.parse(JSON.stringify(value)) as StoredBlob;
		} catch (error) {
			return fail(
				`the memory backend was handed a blob that is not JSON-safe: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	};
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
		get writeManyCalls() {
			return calls;
		},
		async read(slot, kind) {
			if (failRead) {
				failRead = false;
				throw new Error("backend: the read failed");
			}
			// Captured before the gate: the bytes are what the read transaction
			// saw when it ran, and holding the ack must not silently update them.
			const captured = copy(rows.get(recordKey(slot, kind)) ?? null);
			if (hangReadNext > 0) {
				hangReadNext -= 1;
				readGate ??= new Promise<void>((resolve) => {
					openReadGate = resolve;
				});
				await readGate;
			}
			return captured;
		},
		async write(slot, kind, blob) {
			return this.writeMany(slot, [kind], blob);
		},
		async writeMany(slot, kinds, blob) {
			inFlight += 1;
			maxInFlight = Math.max(maxInFlight, inFlight);
			calls.push({ slot, kinds: [...kinds], blob: copy(blob) });
			// The ack-lost case stores its rows before the gate, not after it:
			// on disk the transaction is complete while the promise hangs.
			const appliedNow = hangAppliedNext > 0;
			const hungNext = hangNext > 0;
			if (appliedNow) {
				hangAppliedNext -= 1;
				for (const kind of kinds) rows.set(recordKey(slot, kind), copy(blob));
				writes += 1;
			}
			try {
				if (gate && (appliedNow || holdAll || hungNext)) {
					if (hungNext && !appliedNow) hangNext -= 1;
					await gate;
				}
				if (failNext) {
					failNext = false;
					throw new Error("backend: the write failed");
				}
				// One transaction, so either every key lands or none does — the
				// same all-or-nothing the IndexedDB backend gets for free.
				if (!appliedNow) {
					for (const kind of kinds) rows.set(recordKey(slot, kind), copy(blob));
					writes += 1;
				}
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
			if (found.length === 0) noRecordToCopy(from);
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
			holdAll = true;
			ensureGate();
		},
		hangNextWrite() {
			hangNext += 1;
			ensureGate();
		},
		hangNextWriteApplied() {
			hangAppliedNext += 1;
			ensureGate();
		},
		release() {
			openGate?.();
			gate = null;
			openGate = null;
			holdAll = false;
			hangNext = 0;
			hangAppliedNext = 0;
		},
		failNextWrite() {
			failNext = true;
		},
		failNextRead() {
			failRead = true;
		},
		hangNextRead() {
			hangReadNext += 1;
			readGate ??= new Promise<void>((resolve) => {
				openReadGate = resolve;
			});
		},
		releaseRead() {
			openReadGate?.();
			readGate = null;
			openReadGate = null;
			hangReadNext = 0;
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
	databaseName: string,
): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const request = factory.open(databaseName, SAVE_DB_VERSION);
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
	databaseName = SAVE_DB_NAME,
): SaveBackend {
	let db: Promise<IDBDatabase> | null = null;
	let closed = false;
	let blocked = false;
	const open = () => {
		// A closed handle's `transaction()` throws a bare `InvalidStateError`,
		// which names nothing a player could act on.
		if (closed) return Promise.reject(new Error(SAVE_CLOSED_MESSAGE));
		// **A blocked open is remembered, not retried.** The first request is
		// still pending behind the old tab, and a second open queues behind it
		// with no `blocked` event of its own, so a retry hung rather than
		// failing. The message already tells the player to reload.
		if (blocked) return Promise.reject(new Error(SAVE_BLOCKED_MESSAGE));
		const opening = (db ??= openSaveDb(
			factory,
			() => {
				closed = true;
				db = null;
			},
			databaseName,
		));
		// Any other refused open is not cached: the next caller asks again. This
		// handler is attached before any caller awaits `opening`, so the flag is
		// set before a caller's own rejection runs.
		opening.catch((error) => {
			if (db === opening) db = null;
			if (error instanceof Error && error.message === SAVE_BLOCKED_MESSAGE)
				blocked = true;
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
			// Only this abort means "no record". Any other failure of the transaction
			// is the backend's, and is reported as one.
			let aborted = false;
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
					if (answered === SAVE_RECORD_KINDS.length && found === 0) {
						aborted = true;
						tx.abort();
					}
				};
			}
			try {
				await done;
			} catch (error) {
				if (aborted) noRecordToCopy(from);
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
export function webSlotLocks(
	locks: LockManager = navigator.locks,
	prefix = SAVE_LOCK_PREFIX,
): SlotLocks {
	return {
		tryHold(slot) {
			return new Promise((resolve, reject) => {
				locks
					.request(
						`${prefix}${slot}`,
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
