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
	type Scheduler,
	SaveStore,
	memorySaveBackend,
	SAVE_DEBOUNCE_MS,
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
const harness = (options: { permadeath?: boolean } = {}) => {
	const clock = manualScheduler();
	const backend = memorySaveBackend();
	let state = envelope(100);
	if (options.permadeath)
		state = {
			...state,
			commander: { ...state.commander, permadeath: true },
		};
	const store = new SaveStore({
		backend,
		schedule: clock.scheduler,
		current: () => state,
	});
	return {
		clock,
		backend,
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

	test("a slot name that would address another slot is refused", async () => {
		// A record is keyed `${slot} ${kind}`, so `"a b"` lists as `"a"` and
		// `deleteSlot("a")` removes it. Only the default slot is reachable until
		// a naming surface lands; the boundary is closed before it opens.
		const h = harness();
		expect(() => h.store.setSlot("a b")).toThrow(/slot name/);
		expect(() => h.store.setSlot("")).toThrow(/slot name/);
		await expect(h.store.flush("dock", "a b")).rejects.toThrow(/slot name/);
		await expect(h.store.importSlot("a b", "{}")).rejects.toThrow(/slot name/);
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
