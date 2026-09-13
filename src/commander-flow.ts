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
	type PendingNewGame,
	type SaveBackend,
	type SaveStore,
} from "./save-store";

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------
// The overlay's words (§11.5)
// ---------------------------------------------------------------------------
//
// Every message a boot or an attach hands the overlay is built here, so the
// headless row that forbids the storage word reads the builders rather than a
// copy of their text.

/** A Commander whose `live` record this build refuses (D9). */
export const loadFault = (slot: string, error: unknown): string =>
	`Commander "${slot}" would not load: ${messageOf(error)}`;

/** A record that parsed and then would not build a game. */
export const restoreFault = (slot: string, error: unknown): string =>
	`Commander "${slot}" would not restore: ${messageOf(error)}`;

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
	`this tab could not reserve Commander "${slot}": ${messageOf(error)}`;

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
	/** Something to continue, and no fault. */
	canContinue: boolean;
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

// ---------------------------------------------------------------------------
// Attaching a store (§11.2 step 5)
// ---------------------------------------------------------------------------

export interface AttachInput {
	slot: string;
	catalog: CommanderCatalog;
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
}

/**
 * Continue's attach, for Continue on the overlay, a one-shot boot and a direct
 * boot alike.
 *
 * **A store whose lock was not granted is never wired.** The lock refuses the
 * catalog's rename and delete; it does not stop a store's own writes, so a
 * store attached without it would be a second tab writing one Commander.
 *
 * A pending new game writes its first `live` record here, and only once that
 * lands is the pending record cleared. A first write that fails leaves the
 * store attached — it holds the lock and the next write retries — and the
 * pending record on disk, so a tab closed now still loses nothing chosen.
 */
export async function attachCommander(
	input: AttachInput,
): Promise<AttachResult> {
	const { slot, catalog, pending, makeStore, onHeld } = input;
	const store = makeStore(slot);
	let held: boolean;
	try {
		held = await store.hold();
	} catch (error) {
		return { attached: false, fault: lockRequestFault(slot, error) };
	}
	if (!held) return { attached: false, fault: lockHeldFault(slot) };
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
