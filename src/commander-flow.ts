/**
 * What a boot of the game does before and after the Commander overlay
 * (`persistent-world-state.md` §11.2–§11.3), as decisions `main.ts` carries out.
 *
 * **Its own module because `main.ts` cannot be tested.** It builds a renderer
 * at module scope, so nothing in it can run under bun, and every §11.7 headless
 * obligation about the boot — the one-shot consumed once, a pending new game
 * booting into its empty Commander, no store before the choice, `?seed` setting
 * nothing aside without `?boot=direct` — would otherwise be a claim about code
 * no test executes. `tests/commander-flow.test.ts` drives these against the
 * in-memory backend.
 *
 * No DOM and no Three.js: the overlay's drawing is `commander-overlay.ts`'s, and
 * the held clock is the frame loop's.
 */

import type { BootMode } from "./boot-mode";
import { parseSave, type SaveEnvelope } from "./save-envelope";
import {
	type CommanderCatalog,
	DEFAULT_SLOT,
	type FlushReason,
	type PendingNewGame,
	type SaveBackend,
	type SaveFault,
	type SaveStore,
} from "./save-store";

/**
 * An error's message, or the thrown value as text, for the player.
 *
 * **Without the storage modules' `save: ` prefix.** `save-store.ts` and
 * `save-envelope.ts` put it on every error they throw, which names the source
 * in a console line. In the overlay it read `would not load: save: …`, and the
 * boot's own `save: ` log prefix doubled it (#306's frames).
 */
export const messageOf = (error: unknown): string =>
	(error instanceof Error ? error.message : String(error)).replace(
		/^save: /,
		"",
	);

/**
 * A fault the overlay shows: a sentence for the player, then the reason on its
 * own line, which the overlay draws dimmer as the detail. The reason is the
 * thrown message, and it is often a field name and a value; the sentence is
 * what the player acts on. No detail line when the reason has no words.
 */
const withDetail = (sentence: string, error: unknown): string => {
	const detail = messageOf(error);
	return detail ? `${sentence}\n${detail}` : sentence;
};

// ---------------------------------------------------------------------------
// The overlay's words (§11.5)
// ---------------------------------------------------------------------------
//
// Every message a boot or an attach hands the overlay is built here, so the
// headless row that forbids the storage word reads the builders rather than a
// copy of their text.

/** A Commander whose `live` record this build refuses (D9). */
export const loadFault = (slot: string, error: unknown): string =>
	withDetail(
		`Commander "${slot}" would not load. It is left as it is on disk; Export takes a copy of it.`,
		error,
	);

/** A record that parsed and then would not build a game. */
export const restoreFault = (slot: string, error: unknown): string =>
	withDetail(
		`Commander "${slot}" would not restore. It is left as it is on disk; Export takes a copy of it.`,
		error,
	);

/** `?seed`'s set-aside, which only a direct boot applies (§11.6). */
export const seedSetAsideFault = (
	slot: string,
	saved: number,
	asked: number,
): string =>
	`Commander "${slot}" is in galaxy seed ${saved}; ?seed=${asked} asked for ` +
	"another, so that Commander was left alone and not loaded";

/** Another tab has a store attached to the Commander (§11.3). */
export const lockHeldFault = (slot: string): string =>
	`Commander "${slot}" is open in another tab — close it there, then choose it here`;

/** The browser refused the lock request itself, which says nothing about
 *  another tab. */
export const lockRequestFault = (slot: string, error: unknown): string =>
	withDetail(`this tab could not reserve Commander "${slot}".`, error);

/** A dock, undock, jump or quit flush that did not land (§11.5). */
export const flushFault = (reason: FlushReason, error: unknown): string =>
	withDetail(`the ${reason} save would not write.`, error);

/** A debounced write that did not land, and how many in a row have not. */
export const writeFault = (consecutive: number, error: unknown): string =>
	withDetail(`the save would not write (${consecutive} in a row).`, error);

/** The words for a fault the store holds (§11.5). */
export const heldFaultText = (fault: SaveFault): string =>
	fault.reason === "debounce"
		? writeFault(fault.consecutive, fault.error)
		: flushFault(fault.reason, fault.error);

/** The pointer named a Commander that is gone (§11.4). Said, not a fault: the
 *  default Commander loads normally. */
export const FALLBACK_NOTICE = `the Commander this browser last played is gone, so this is Commander "${DEFAULT_SLOT}"`;

// ---------------------------------------------------------------------------
// The boot (§11.2)
// ---------------------------------------------------------------------------

export interface BootInput {
	catalog: CommanderCatalog;
	backend: SaveBackend;
	boot: BootMode;
	/** `?no-save`: nothing is read, consumed or written. */
	noSave: boolean;
	/** A usable `?seed`, or `null`. */
	querySeed: number | null;
}

export interface BootPlan {
	/**
	 * `direct`: no overlay, the clock runs and the store attaches now (§11.6).
	 * `continue`: a one-shot the overlay wrote, so the same, into its Commander.
	 * `overlay`: the overlay opens, the clock is held and no store attaches until
	 * the player chooses.
	 */
	mode: "direct" | "continue" | "overlay";
	/** The Commander this boot is for. */
	slot: string;
	loaded: SaveEnvelope | null;
	/** A new game chosen before the reload, whose Commander has no record yet. */
	pending: PendingNewGame | null;
	/** Shown on the overlay; while it is set no store attaches to `slot`. */
	fault: string | null;
	/** The Commander a fault concerns, which the overlay offers Export of. */
	faultSlot: string | null;
	notice: string | null;
	/**
	 * Something to continue, and no fault that concerns its record. A lock fault
	 * (`withLockFault`) keeps it: the Commander is continuable once the other tab
	 * closes.
	 */
	canContinue: boolean;
	/**
	 * The Commander's `live` record as this boot read it, as text (`recordText`),
	 * or `null` for none. An attach compares it with the record it reads once it
	 * holds the lock, because the page's game was built from this read.
	 */
	record: string | null;
	/** Under the overlay a `?seed` pre-fills New game and does nothing else. */
	seedPrefill: number | null;
}

/**
 * Which Commander a boot is for and how it begins.
 *
 * **The one-shot is consumed by every boot that reads storage, direct
 * included.** A one-shot a direct boot left on disk would skip the overlay on
 * the player's next boot, which is a choice nobody made on that boot. It is
 * taken before the pointer is resolved so that a pointer this build refuses
 * still discards it.
 */
export async function planBoot(input: BootInput): Promise<BootPlan> {
	const { catalog, backend, boot, noSave, querySeed } = input;
	const direct = boot === "direct";
	const plan: BootPlan = {
		mode: direct ? "direct" : "overlay",
		slot: DEFAULT_SLOT,
		loaded: null,
		pending: null,
		fault: null,
		faultSlot: null,
		notice: null,
		canContinue: false,
		seedPrefill: direct ? null : querySeed,
		record: null,
	};
	// A fresh game that saves nothing, so there is always something to continue.
	if (noSave) {
		plan.canContinue = true;
		return plan;
	}

	let oneShot: string | null;
	try {
		oneShot = await catalog.takeOneShot();
		const active = await catalog.resolveActive();
		plan.slot = active.slot;
		plan.pending = active.pending;
		if (active.fellBack) plan.notice = FALLBACK_NOTICE;
	} catch (error) {
		plan.fault = messageOf(error);
		return plan;
	}

	// §11.2 step 2: a pending new game's Commander has no record by design.
	if (!plan.pending) {
		try {
			const raw = await backend.read(plan.slot, "live");
			plan.record = recordText(raw);
			if (raw !== null) plan.loaded = parseSave(raw);
		} catch (error) {
			plan.fault = loadFault(plan.slot, error);
			plan.faultSlot = plan.slot;
		}
	}

	// §11.6: asking for a seed is asking for that world, but only where nothing
	// else asks. Under the overlay the seed field does.
	const seed = plan.loaded?.world.seed ?? plan.pending?.seed ?? null;
	if (direct && querySeed !== null && seed !== null && seed !== querySeed) {
		plan.fault = seedSetAsideFault(plan.slot, seed, querySeed);
		plan.faultSlot = plan.loaded ? plan.slot : null;
		plan.loaded = null;
		plan.pending = null;
	}

	plan.canContinue =
		plan.fault === null && (plan.loaded !== null || plan.pending !== null);
	// A one-shot naming another Commander, or one that cannot be continued, is
	// discarded: the overlay opens, with the fault when there is one (§11.3).
	if (!direct && oneShot === plan.slot && plan.canContinue)
		plan.mode = "continue";
	return plan;
}

/**
 * A record that parsed and then would not build a game (D9).
 *
 * **A one-shot into it opens the overlay.** A `continue` plan attaches a store,
 * and a store attached to that Commander would write over the record on the
 * first dirty event — the only copy of whatever is left. A new plan is
 * returned; the one given is not changed.
 */
export function withRestoreFault(plan: BootPlan, error: unknown): BootPlan {
	return {
		...plan,
		mode: plan.mode === "continue" ? "overlay" : plan.mode,
		fault: restoreFault(plan.slot, error),
		faultSlot: plan.slot,
		loaded: null,
		canContinue: false,
	};
}

/**
 * A one-shot boot whose attach failed after the boot read the record (§11.3):
 * the one-shot is discarded and the overlay opens with the fault. Continue
 * stays available, because the fault is one a retry can clear — another tab's
 * lock, which goes when that tab closes, or a read of a record the boot had
 * just read, which is the backend failing. A record this build refuses never
 * reaches here: the boot faults on it first. A new plan is returned.
 */
export function withLockFault(plan: BootPlan, fault: string): BootPlan {
	return { ...plan, mode: "overlay", fault };
}

/**
 * A `live` record as text, or `null` for none: what a boot read and what an
 * attach reads again are compared this way. IndexedDB hands back a structured
 * clone with the keys in the order they were written, so one stored value
 * always gives the same text.
 */
export const recordText = (raw: unknown): string | null =>
	raw === null || raw === undefined ? null : JSON.stringify(raw);

/** The pending new game an attach into `slot` finishes, or `null` when the
 *  pending record names another Commander or there is none. */
export function pendingFor(
	plan: BootPlan,
	slot: string,
): PendingNewGame | null {
	return plan.pending?.name === slot ? plan.pending : null;
}

/**
 * Whether an attach into `slot` chooses permadeath (#89's D7): New game's
 * choice, or `?permadeath` on a direct boot with nothing loaded. A query
 * parameter never chooses it for a Commander the overlay offered, nor for one
 * that already exists — that would make the flag a setting.
 */
export function permadeathAtAttach(
	plan: BootPlan,
	slot: string,
	queryPermadeath: boolean,
): boolean {
	const pending = pendingFor(plan, slot);
	if (pending) return pending.permadeath;
	return (
		plan.mode === "direct" &&
		plan.loaded === null &&
		plan.pending === null &&
		queryPermadeath
	);
}

/** A random galaxy seed, for a boot or a New game with none asked for. */
export const randomSeed = (): number => (Math.random() * 0x1_0000_0000) >>> 0;

// ---------------------------------------------------------------------------
// Attaching a store (§11.2 step 5)
// ---------------------------------------------------------------------------

export interface AttachInput {
	slot: string;
	catalog: CommanderCatalog;
	backend: SaveBackend;
	/** `BootPlan.record`: the record the page's game was built from. */
	bootRecord: string | null;
	pending: PendingNewGame | null;
	makeStore: (slot: string) => SaveStore;
	/**
	 * Wires the store into the game: the frame's writes, `pagehide`'s quit
	 * flush, a new game's permadeath choice. Called only once the lock is held.
	 */
	onHeld: (store: SaveStore) => void;
}

export interface AttachResult {
	attached: boolean;
	fault: string | null;
	/**
	 * Another tab saved this Commander after the boot read it. Nothing is
	 * attached and the lock is given back; the caller reloads into the save.
	 */
	stale?: true;
}

/**
 * Continue's attach, for Continue on the overlay, a one-shot boot and a direct
 * boot alike.
 *
 * **A store whose lock was not granted is never wired.** The lock refuses the
 * catalog's rename and delete; it does not stop a store's own writes, so a
 * store attached without it would be a second tab writing one Commander.
 *
 * **Nor is a store attached to a record that changed since the boot read it.**
 * The page's game was built from that read, and it lives on the page for as long
 * as the overlay is open. Another tab can play the same Commander in that time,
 * save, and close — and a store attached here would write the older world over
 * that progress on its first dirty event. So the record is read again once the
 * lock is held, which is the first moment no other tab can write it.
 *
 * A pending new game writes its first `live` record here, and only once that
 * lands is the pending record cleared. A first write that fails leaves the
 * store attached — it holds the lock and the next write retries — and the
 * pending record on disk, so a tab closed now still loses nothing chosen.
 */
export async function attachCommander(
	input: AttachInput,
): Promise<AttachResult> {
	const { slot, catalog, backend, bootRecord, pending, makeStore, onHeld } =
		input;
	const store = makeStore(slot);
	let held: boolean;
	try {
		held = await store.hold();
	} catch (error) {
		return { attached: false, fault: lockRequestFault(slot, error) };
	}
	if (!held) return { attached: false, fault: lockHeldFault(slot) };
	// **A pending new game is read again too.** Its boot read nothing, so its
	// `bootRecord` is `null` — and a record there now is another tab that booted
	// on the same pending record, continued, played and saved. The reload finds
	// that save, and `resolveActive` clears the pending record beside it.
	let now: unknown;
	try {
		now = await backend.read(slot, "live");
	} catch (error) {
		store.release();
		return { attached: false, fault: loadFault(slot, error) };
	}
	if (recordText(now) !== bootRecord) {
		store.release();
		return { attached: false, fault: null, stale: true };
	}
	onHeld(store);
	if (pending) {
		try {
			await store.flush("new-game");
			await catalog.finishNewGame();
		} catch (error) {
			return { attached: true, fault: messageOf(error) };
		}
	}
	return { attached: true, fault: null };
}

// ---------------------------------------------------------------------------
// The operations that change Commander (§11.3)
// ---------------------------------------------------------------------------

export interface SwitchInput {
	catalog: CommanderCatalog;
	/** The store this tab has attached, or `null` before the player chose. */
	store: () => SaveStore | null;
	reload: () => void;
}

/**
 * The overlay's operations, with §11.3's two rules held in one place.
 *
 * **New game, Load and Import end in a reload**; Export, Rename and Delete do
 * not. And **a switch out of a game in play awaits its flush**: `pagehide`'s
 * quit flush is best-effort, so a switch the player chose does not rely on it,
 * and a flush that fails refuses the switch before anything is written.
 */
export class CommanderSwitch {
	private readonly catalog: CommanderCatalog;
	private readonly store: () => SaveStore | null;
	private readonly reload: () => void;

	constructor(input: SwitchInput) {
		this.catalog = input.catalog;
		this.store = input.store;
		this.reload = input.reload;
	}

	async newGame(choice: PendingNewGame): Promise<void> {
		await this.flushOut();
		await this.catalog.beginNewGame(choice);
		this.reload();
	}

	async load(slot: string): Promise<void> {
		await this.flushOut();
		await this.catalog.chooseCommander(slot);
		this.reload();
	}

	async importCommander(name: string, text: string): Promise<void> {
		await this.flushOut();
		await this.catalog.importSlot(name, text);
		await this.catalog.chooseCommander(name);
		this.reload();
	}

	exportCommander(slot: string): Promise<string> {
		return this.catalog.exportSlot(slot);
	}

	rename(from: string, to: string): Promise<void> {
		return this.catalog.renameSlot(from, to);
	}

	remove(slot: string): Promise<void> {
		return this.catalog.deleteSlot(slot);
	}

	private async flushOut(): Promise<void> {
		await this.store()?.flush("quit");
	}
}
