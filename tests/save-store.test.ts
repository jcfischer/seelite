/**
 * #89's D4, D6, D7, D8 and D9 as a state machine, driven by hand.
 *
 * Everything here runs against an in-memory backend and an injected scheduler.
 * That is not a convenience: bun has no fake `setTimeout`, and a debounce test
 * on the wall clock is a test that measures the machine it runs on. The
 * IndexedDB adapter is the thin half and gets a browser probe instead —
 * `scripts/probe-save.mjs` — because a transaction is the one thing only a
 * browser has.
 */

import { describe, expect, test } from "bun:test";
import { carrierKey } from "../src/carrier-key";
import {
	type CommanderRecord,
	newCommanderRecord,
	type SaveEnvelope,
	serializeSave,
} from "../src/save-envelope";
import {
	DEFAULT_SLOT,
	memorySaveBackend,
	memorySlotLocks,
	type Scheduler,
	SAVE_DEBOUNCE_MS,
	SAVE_RETRY_LIMIT,
	SaveStore,
	type SlotLocks,
} from "../src/save-store";
import { LOCAL_CARRIER_ID } from "../src/station";
import { newWorld, visit } from "../src/world-state";

const SEED = 0x5ee11e;
const KEY = carrierKey(3, LOCAL_CARRIER_ID.trade);

/** A scheduler the test drives. Holds at most one pending callback, which is
 *  the debouncer's own contract — a second `schedule` cancels the first. */
const manualScheduler = () => {
	let pending: (() => void) | null = null;
	let lastDelayMs = -1;
	const scheduler: Scheduler = (fn, ms) => {
		pending = fn;
		lastDelayMs = ms;
		return () => {
			if (pending === fn) pending = null;
		};
	};
	return {
		scheduler,
		get armed() {
			return pending !== null;
		},
		get lastDelayMs() {
			return lastDelayMs;
		},
		fire() {
			const fn = pending;
			pending = null;
			fn?.();
		},
	};
};

const envelope = (credits: number): SaveEnvelope => ({
	world: visit(newWorld(SEED), 0, 3),
	commander: {
		...newCommanderRecord("courier"),
		state: { ...newCommanderRecord("courier").state, credits },
	},
});

/** A store wired to a manual clock, with `current` returning whatever the test
 *  last set — which is what `Game` will pass: a getter, not a snapshot, so the
 *  debounced write serializes the world at the moment it fires. */
const harness = (
	options: {
		permadeath?: boolean;
		backend?: ReturnType<typeof memorySaveBackend>;
		locks?: SlotLocks;
		slot?: string;
	} = {},
) => {
	const clock = manualScheduler();
	const backend = options.backend ?? memorySaveBackend();
	const locks = options.locks ?? memorySlotLocks();
	let state = envelope(100);
	if (options.permadeath)
		state = {
			...state,
			commander: { ...state.commander, permadeath: true },
		};
	const store = new SaveStore({
		backend,
		locks,
		schedule: clock.scheduler,
		current: () => state,
		slot: options.slot,
	});
	return {
		clock,
		backend,
		locks,
		store,
		set(credits: number) {
			state = {
				...state,
				commander: {
					...state.commander,
					state: { ...state.commander.state, credits },
				},
			};
		},
		get commander(): CommanderRecord {
			return state.commander;
		},
	};
};

describe("#89 D4 — the write cadence", () => {
	test("N changes inside the window produce exactly one write", async () => {
		const h = harness();
		h.store.markDirty();
		h.set(200);
		h.store.markDirty();
		h.set(300);
		h.store.markDirty();
		expect(h.backend.writes).toBe(0);
		expect(h.clock.armed).toBe(true);
		expect(h.clock.lastDelayMs).toBe(SAVE_DEBOUNCE_MS);
		h.clock.fire();
		await h.store.settled();
		expect(h.backend.writes).toBe(1);
		// The write carries the *latest* state, not the one that first dirtied it.
		const back = await h.store.load("default");
		expect(back.commander.state.credits).toBe(300);
	});

	test("a dock, undock, jump or quit flushes regardless of the window", async () => {
		for (const reason of ["dock", "undock", "jump", "quit"] as const) {
			const h = harness();
			h.store.markDirty();
			await h.store.flush(reason);
			expect(h.backend.writes).toBeGreaterThanOrEqual(1);
			// And the debounce is disarmed — a pending timer that fired afterwards
			// would be a second write of the same state.
			expect(h.clock.armed).toBe(false);
		}
	});

	test("a flush with nothing dirty writes nothing — except quit", async () => {
		const h = harness();
		for (const reason of ["dock", "undock", "jump"] as const) {
			await h.store.flush(reason);
			expect(h.backend.writes).toBe(0);
		}
		// **Quit is the exception and has to be.** The other three each follow a
		// `saveDirty()` at the transition that caused them; `pagehide` follows
		// nothing, so a new game flown in normal flight only and then closed had
		// never dirtied and wrote no record at all — and with `?permadeath` the
		// D7 choice went with it.
		await h.store.flush("quit");
		expect(h.backend.writes).toBe(1);
		expect((await h.store.load("default")).commander.state.credits).toBe(100);
	});

	test("a flush during a debounced write queues behind it rather than racing", async () => {
		// **The check the previous version of this test could not make.** New
		// dirt during a write only arms the debounce, so nothing re-enters the
		// writer and a build with no queue passes — verified by deleting the
		// queue and watching all sixteen rows stay green. A *flush* is the path
		// that re-enters it, and two IndexedDB transactions in flight can land
		// in either order, with the loser being the newer state.
		const h = harness();
		h.backend.hold();
		h.store.markDirty();
		h.clock.fire();
		expect(h.backend.inFlight).toBe(1);
		h.set(900);
		h.store.markDirty();
		const flushed = h.store.flush("dock");
		h.backend.release();
		await flushed;
		await h.store.settled();
		expect(h.backend.maxInFlight).toBe(1);
		expect(
			(await h.store.load("default", "lastDocked")).commander.state.credits,
		).toBe(900);
	});

	test("dirt arriving during a write produces one more write, not an overlap", async () => {
		const h = harness();
		h.backend.hold();
		h.store.markDirty();
		h.clock.fire();
		// The first write is in flight. New dirt must not start a second
		// transaction beside it.
		h.set(900);
		h.store.markDirty();
		expect(h.backend.inFlight).toBe(1);
		h.backend.release();
		await h.store.settled();
		// The new dirt is on the debounce, as any other change is. Firing it is
		// what the browser's own timer does; the point of the check is that the
		// second write starts *after* the first lands rather than beside it.
		expect(h.clock.armed).toBe(true);
		h.clock.fire();
		await h.store.settled();
		expect(h.backend.maxInFlight).toBe(1);
		expect(h.backend.writes).toBe(2);
		expect((await h.store.load("default")).commander.state.credits).toBe(900);
	});
});

describe("#89's D7 correction — a slot holds two records", () => {
	test("a dock flush writes both records; anything else writes only live", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump");
		// `live` moved on; the checkpoint the player made by docking did not.
		expect((await h.store.load("default")).commander.state.credits).toBe(555);
		expect(
			(await h.store.load("default", "lastDocked")).commander.state.credits,
		).toBe(100);
	});

	test("a non-permadeath death restores the last dock, losing the leg", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump");
		const restored = await h.store.restoreAfterDeath("default", h.commander);
		expect(restored?.commander.state.credits).toBe(100);
	});

	test("a permadeath commander cannot be restored", async () => {
		const h = harness({ permadeath: true });
		h.store.markDirty();
		await h.store.flush("dock");
		expect(await h.store.restoreAfterDeath("default", h.commander)).toBeNull();
	});

	test("death does not flush — the tab-close window is left open on purpose", async () => {
		// #89's correction says so in as many words: permadeath is stated and not
		// enforced, and a death flush would be someone closing a hole the policy
		// deliberately leaves. `restoreAfterDeath` reads; it never writes.
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		const before = h.backend.writes;
		await h.store.restoreAfterDeath("default", h.commander);
		expect(h.backend.writes).toBe(before);
	});
});

describe("#89 D6 — slots, export and import", () => {
	test("a write to one slot changes no other slot's record", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		h.set(777);
		h.store.markDirty();
		await h.store.flush("dock", "beta");
		expect((await h.store.load("alpha")).commander.state.credits).toBe(100);
		expect((await h.store.load("beta")).commander.state.credits).toBe(777);
		expect((await h.store.slots()).sort()).toEqual(["alpha", "beta"]);
	});

	test("export then import reproduces the slot, both records", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		h.set(777);
		h.store.markDirty();
		await h.store.flush("jump", "alpha");
		const text = await h.store.exportSlot("alpha");
		await h.store.importSlot("copy", text);
		expect((await h.store.load("copy")).commander.state.credits).toBe(777);
		expect(
			(await h.store.load("copy", "lastDocked")).commander.state.credits,
		).toBe(100);
		// Byte-for-byte at the model boundary, which is what #89 asked for.
		expect(await h.store.exportSlot("copy")).toBe(text);
	});

	test("a queued write does not inherit the previous write's failure", async () => {
		// `while (this.inFlight) await this.inFlight` rethrew whatever the
		// in-flight write rejected with, so a dock flush queued behind a failing
		// debounced write threw before writing anything — no `lastDocked`
		// checkpoint, on a failure that was not its own.
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		h.clock.fire();
		await h.store.settled();
		h.set(321);
		h.store.markDirty();
		await h.store.flush("dock");
		expect(
			(await h.store.load("default", "lastDocked")).commander.state.credits,
		).toBe(321);
	});

	test("a failed debounced write re-arms rather than waiting for a flush", async () => {
		// Setting the dirty flag alone was described as "the next flush retries"
		// and armed nothing, so a failed debounced write sat until the next
		// dock, trade, jump or quit — the cadence doing almost none of the
		// writing waiting on the cadence doing almost all of it. And nothing
		// reached the player at all, which D9 says is what must not happen.
		const failures: string[] = [];
		const clock = manualScheduler();
		const backend = memorySaveBackend();
		const store = new SaveStore({
			backend,
			locks: memorySlotLocks(),
			schedule: clock.scheduler,
			current: () => envelope(100),
			onWriteFailed: (error) => failures.push(String(error)),
		});
		store.markDirty();
		backend.failNextWrite();
		clock.fire();
		await store.settled();
		expect(backend.writes).toBe(0);
		expect(failures.length).toBe(1);
		// Re-armed: the retry is a timer, not the next unrelated transition.
		expect(clock.armed).toBe(true);
		clock.fire();
		await store.settled();
		expect(backend.writes).toBe(1);
	});

	test("the retry stops drumming after the cap, and the save stays dirty", async () => {
		// **Re-arming without a cap was the fix becoming the next defect.** A
		// backend that simply refuses — a quota, a private window — was asked
		// every window forever, each attempt paying the synchronous serialize a
		// player feels, and silently. The cap ends the drum; it does not give
		// up, because the flag survives and the next flush still writes.
		const clock = manualScheduler();
		const backend = memorySaveBackend();
		const failures: number[] = [];
		const store = new SaveStore({
			backend,
			locks: memorySlotLocks(),
			schedule: clock.scheduler,
			current: () => envelope(100),
			onWriteFailed: (_error, consecutive) => failures.push(consecutive),
		});
		store.markDirty();
		for (let i = 0; i < SAVE_RETRY_LIMIT + 2 && clock.armed; i++) {
			backend.failNextWrite();
			clock.fire();
			await store.settled();
		}
		expect(failures).toEqual([1, 2, 3]);
		expect(clock.armed).toBe(false);
		expect(backend.writes).toBe(0);
		// Still dirty, so an unconditional flush writes.
		await store.flush("dock");
		expect(backend.writes).toBe(1);
	});

	test("a dock flush writes both records in one transaction", async () => {
		// Two sequential transactions of the same bytes cost twice the measured
		// median and left a window where the checkpoint and the live record
		// disagreed. `writes` counts transactions, not keys.
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock");
		expect(h.backend.writes).toBe(1);
		expect(await h.backend.has("default", "live")).toBe(true);
		expect(await h.backend.has("default", "lastDocked")).toBe(true);
	});

	test("a slot name that would address another slot is refused", async () => {
		// A record is keyed `${slot}\0${kind}`, so `"a\0b"` lists as `"a"` and
		// `deleteSlot("a")` removes it. This comment and the check both said a
		// space for a round: the Read tool renders the NUL byte as one, and the
		// check was written from what it showed. The space rule stays, because
		// §11.4 ratifies it; the separator is the rule that closes the collision.
		const h = harness();
		for (const name of ["a b", "a\0b", ""]) {
			expect(() => h.store.setSlot(name)).toThrow(/slot name/);
			await expect(h.store.flush("dock", name)).rejects.toThrow(/slot name/);
			await expect(h.store.importSlot(name, "{}")).rejects.toThrow(/slot name/);
		}
		expect(await h.store.slots()).toEqual([]);
	});

	test("importing a file that is not a save refuses and writes nothing", async () => {
		const h = harness();
		await expect(h.store.importSlot("copy", "{]")).rejects.toThrow(/save/i);
		expect(await h.store.slots()).toEqual([]);
	});
});

describe("#89 D8/D9 — refusal, and never overwriting the bad record", () => {
	test("a version mismatch is named, and the record is still there to export", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		await h.backend.corruptVersion("alpha", "live");
		await expect(h.store.load("alpha")).rejects.toThrow(/saveSchemaVersion/);
		// **The bad record is never overwritten.** It is the only copy of
		// whatever is left, and export is the whole reason D9 keeps it.
		expect(await h.backend.has("alpha", "live")).toBe(true);
		expect(typeof (await h.store.exportSlot("alpha"))).toBe("string");
	});

	test("a truncated record fails as a named error rather than as an empty world", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		await h.backend.truncate("alpha", "live");
		await expect(h.store.load("alpha")).rejects.toThrow(/save:/);
	});

	test("loading a slot that does not exist is a named refusal, not an empty save", async () => {
		const h = harness();
		await expect(h.store.load("nothing")).rejects.toThrow(/no .*record/i);
	});

	test("a failed write leaves the previous record in place", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		h.set(999);
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("jump", "alpha")).rejects.toThrow(/backend/);
		// Stale rather than broken — D9's residual risk, and the store must not
		// have made it worse.
		expect((await h.store.load("alpha")).commander.state.credits).toBe(100);
	});
});

/** A slot with a `live` and a `lastDocked` record, written through the store. */
const seeded = async (
	h: ReturnType<typeof harness>,
	slot: string,
	credits = 100,
) => {
	h.set(credits);
	h.store.markDirty();
	await h.store.flush("dock", slot);
};

describe("§11.4 — the active-Commander pointer", () => {
	test("with no pointer the active Commander is the default, and nothing fell back", async () => {
		const h = harness();
		expect(await h.store.resolveActive()).toEqual({
			slot: DEFAULT_SLOT,
			pending: null,
			fellBack: false,
		});
	});

	test("the pointer names the active Commander", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.store.chooseCommander("jameson");
		expect((await h.store.resolveActive()).slot).toBe("jameson");
	});

	test("a pointer naming a Commander that is gone falls back to the default, and says so", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.store.chooseCommander("jameson");
		await h.backend.deleteSlot("jameson");
		expect(await h.store.resolveActive()).toEqual({
			slot: DEFAULT_SLOT,
			pending: null,
			fellBack: true,
		});
	});
});

describe("§11.3 — the one-shot continue", () => {
	test("Load: consumed by exactly one boot, into the Commander the pointer names", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.store.chooseCommander("jameson");
		expect(await h.store.takeOneShot()).toBe("jameson");
		expect(await h.store.takeOneShot()).toBeNull();
		expect((await h.store.resolveActive()).slot).toBe("jameson");
	});

	test("Import: the imported Commander is the one the one-shot names", async () => {
		const h = harness();
		await seeded(h, "jameson");
		const text = await h.store.exportSlot("jameson");
		await h.store.importSlot("copy", text);
		await h.store.chooseCommander("copy");
		expect(await h.store.takeOneShot()).toBe("copy");
		expect((await h.store.resolveActive()).slot).toBe("copy");
	});

	test("New game: the pending Commander is the one the one-shot names", async () => {
		const h = harness();
		await h.store.beginNewGame({ name: "fresh", seed: 7, permadeath: true });
		expect(await h.store.takeOneShot()).toBe("fresh");
		expect(await h.store.takeOneShot()).toBeNull();
	});

	test("Load after an abandoned new game boots the loaded Commander, not the abandoned one", async () => {
		// The tab closed before the new Commander's first `live` record landed,
		// so the pending record is still on disk. A pending new game is read
		// before the pointer, so a Load that left it there would boot `fresh`.
		const h = harness();
		await seeded(h, "jameson");
		await h.store.beginNewGame({ name: "fresh", seed: 7, permadeath: false });
		await h.store.takeOneShot();
		await h.store.chooseCommander("jameson");
		expect(await h.store.resolveActive()).toEqual({
			slot: "jameson",
			pending: null,
			fellBack: false,
		});
	});

	test("Load refuses a Commander whose lock another store holds, and writes nothing", async () => {
		const locks = memorySlotLocks();
		const backend = memorySaveBackend();
		const tabA = harness({ backend, locks, slot: "jameson" });
		const tabB = harness({ backend, locks });
		await seeded(tabA, "jameson");
		expect(await tabA.store.hold()).toBe(true);
		await expect(tabB.store.chooseCommander("jameson")).rejects.toThrow(
			/open in another tab/,
		);
		expect(await tabB.store.takeOneShot()).toBeNull();
	});
});

describe("§11.3 — a pending new game", () => {
	test("a pending new game whose Commander has no record boots into that game, not the default", async () => {
		const h = harness();
		await h.store.beginNewGame({ name: "fresh", seed: 7, permadeath: true });
		expect(await h.backend.has("fresh", "live")).toBe(false);
		expect(await h.store.resolveActive()).toEqual({
			slot: "fresh",
			pending: { name: "fresh", seed: 7, permadeath: true },
			fellBack: false,
		});
	});

	test("it survives until its first live record lands, and not a moment earlier", async () => {
		const h = harness({ slot: "fresh" });
		await h.store.beginNewGame({ name: "fresh", seed: 7, permadeath: false });
		await expect(h.store.finishNewGame()).rejects.toThrow(/no save yet/);
		expect((await h.store.resolveActive()).pending).not.toBeNull();
		h.store.markDirty();
		await h.store.flush("quit");
		await h.store.finishNewGame();
		expect(await h.store.resolveActive()).toEqual({
			slot: "fresh",
			pending: null,
			fellBack: false,
		});
	});

	test("an unreadable pending record faults the boot, and a new game replaces it", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.backend.writeMeta({ pending: { name: "lost", seed: -1 } });
		await expect(h.store.resolveActive()).rejects.toThrow(/pending new game/);
		// It holds no name this build can read, so it takes none: import and
		// rename still work, and New game is the way out of the fault.
		const text = await h.store.exportSlot("jameson");
		await h.store.importSlot("copy", text);
		await h.store.beginNewGame({ name: "fresh", seed: 7, permadeath: false });
		expect((await h.store.resolveActive()).slot).toBe("fresh");
	});

	test("an unreadable pending record is also cleared by Load", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.backend.writeMeta({ pending: "garbage" });
		await h.store.chooseCommander("jameson");
		expect((await h.store.resolveActive()).slot).toBe("jameson");
	});
});

describe("§11.3 — one rule for names", () => {
	test("new game, import and rename each refuse a name already taken", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await seeded(h, "other");
		const text = await h.store.exportSlot("jameson");
		await expect(
			h.store.beginNewGame({ name: "jameson", seed: 1, permadeath: false }),
		).rejects.toThrow(/already a Commander/);
		await expect(h.store.importSlot("jameson", text)).rejects.toThrow(
			/already a Commander/,
		);
		await expect(h.store.renameSlot("other", "jameson")).rejects.toThrow(
			/already a Commander/,
		);
		// Nothing was replaced: the taken Commander still carries its own record.
		expect((await h.store.load("other")).commander.state.credits).toBe(100);
	});

	test("a name a pending new game holds is taken, although it has no record yet", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.store.beginNewGame({ name: "fresh", seed: 7, permadeath: false });
		const text = await h.store.exportSlot("jameson");
		await expect(h.store.importSlot("fresh", text)).rejects.toThrow(
			/already a Commander/,
		);
		await expect(h.store.renameSlot("jameson", "fresh")).rejects.toThrow(
			/already a Commander/,
		);
	});

	test("new game and rename refuse a name holding the key separator", async () => {
		// `"jameson\0x"` would list as `"jameson"`, so it would pass the name
		// rule against a Commander that exists and share its delete.
		const h = harness();
		await seeded(h, "jameson");
		await seeded(h, "other");
		await expect(
			h.store.beginNewGame({ name: "jameson\0x", seed: 1, permadeath: false }),
		).rejects.toThrow(/slot name/);
		await expect(h.store.renameSlot("other", "jameson\0x")).rejects.toThrow(
			/slot name/,
		);
		expect((await h.store.slots()).sort()).toEqual(["jameson", "other"]);
	});

	test("import refuses a record the parser refuses, and writes nothing", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.backend.corruptVersion("jameson", "live");
		const text = await h.store.exportSlot("jameson");
		await expect(h.store.importSlot("copy", text)).rejects.toThrow(
			/saveSchemaVersion/,
		);
		expect((await h.store.slots()).sort()).toEqual(["jameson"]);
	});
});

describe("§11.3 — rename and delete", () => {
	test("rename moves both records and the pointer, and leaves no old name behind", async () => {
		const h = harness();
		await seeded(h, "jameson", 100);
		h.set(555);
		h.store.markDirty();
		await h.store.flush("jump", "jameson");
		await h.store.chooseCommander("jameson");
		await h.store.renameSlot("jameson", "elite");
		expect((await h.store.slots()).sort()).toEqual(["elite"]);
		expect((await h.store.load("elite")).commander.state.credits).toBe(555);
		expect(
			(await h.store.load("elite", "lastDocked")).commander.state.credits,
		).toBe(100);
		expect((await h.store.resolveActive()).slot).toBe("elite");
	});

	test("a rename interrupted between copy and delete leaves two Commanders, never zero", async () => {
		const h = harness();
		await seeded(h, "jameson");
		h.backend.failNextDelete();
		await expect(h.store.renameSlot("jameson", "elite")).rejects.toThrow(
			/backend/,
		);
		expect((await h.store.slots()).sort()).toEqual(["elite", "jameson"]);
	});

	test("delete removes the Commander", async () => {
		const h = harness();
		await seeded(h, "jameson");
		await h.store.deleteSlot("jameson");
		expect(await h.store.slots()).toEqual([]);
	});

	test("delete and rename refuse a Commander whose lock is held — this tab's or another's", async () => {
		const locks = memorySlotLocks();
		const backend = memorySaveBackend();
		const tabA = harness({ backend, locks, slot: "jameson" });
		const tabB = harness({ backend, locks });
		await seeded(tabA, "jameson");
		expect(await tabA.store.hold()).toBe(true);
		for (const store of [tabA.store, tabB.store]) {
			await expect(store.deleteSlot("jameson")).rejects.toThrow(
				/open in another tab|in play/,
			);
			await expect(store.renameSlot("jameson", "elite")).rejects.toThrow(
				/open in another tab|in play/,
			);
		}
		expect(await tabB.store.slots()).toEqual(["jameson"]);
	});

	test("a second store cannot hold a Commander the first already holds", async () => {
		const locks = memorySlotLocks();
		const backend = memorySaveBackend();
		const tabA = harness({ backend, locks, slot: "jameson" });
		const tabB = harness({ backend, locks, slot: "jameson" });
		expect(await tabA.store.hold()).toBe(true);
		expect(await tabB.store.hold()).toBe(false);
	});

	test("the lock check gives the lock back, so a store may hold it afterwards", async () => {
		const locks = memorySlotLocks();
		const h = harness({ locks });
		await seeded(h, "jameson");
		await h.store.chooseCommander("jameson");
		// The check took the lock and gave it back: a store may now hold it.
		const tab = harness({ backend: h.backend, locks, slot: "jameson" });
		expect(await tab.store.hold()).toBe(true);
	});
});

describe("§11.5 — faults are held per record kind", () => {
	test("a lastDocked fault survives a good debounced write and clears on a good dock flush", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		await expect(h.store.flush("dock")).rejects.toThrow(/backend/);
		expect([...h.store.failedKinds].sort()).toEqual(["lastDocked", "live"]);
		// A debounced write carries `live` alone.
		h.store.markDirty();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.failedKinds]).toEqual(["lastDocked"]);
		h.store.markDirty();
		await h.store.flush("dock");
		expect([...h.store.failedKinds]).toEqual([]);
	});

	test("a debounced write failing holds a live fault until a write lands", async () => {
		const h = harness();
		h.store.markDirty();
		h.backend.failNextWrite();
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.failedKinds]).toEqual(["live"]);
		h.clock.fire();
		await h.store.settled();
		expect([...h.store.failedKinds]).toEqual([]);
	});
});

describe("the store writes what a parser accepts", () => {
	test("what the backend holds is exactly what serializeSave produces", async () => {
		const h = harness();
		h.store.markDirty();
		await h.store.flush("dock", "alpha");
		expect(await h.backend.raw("alpha", "live")).toEqual(
			serializeSave({
				world: visit(newWorld(SEED), 0, 3),
				commander: h.commander,
			}),
		);
		expect(KEY).toBeTruthy();
	});
});
